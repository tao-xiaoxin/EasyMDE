import { describe, expect, it, vi } from 'vitest';

import { declaration } from './wechat-clipboard-test-fixtures';
import type { BrowserWechatClipboardRuntime } from './wechat-clipboard-runtime';
import type { WechatDimensionSemanticsContext } from './wechat-dimension-semantics';
import { ordinaryDimensionSemanticsSignature } from './wechat-fidelity-signature';
import {
  appendPortableStyleDeclaration,
  createStyleDeclarationContext,
  semanticTransformOriginSignature,
  transportableTransformOriginSemantics
} from './wechat-style-policy';
import { styleDeclarations, styleDeclarationsSynchronously } from './wechat-pseudo-elements';

function style(values: Record<string, string>): CSSStyleDeclaration {
  return declaration(values);
}

function dimensionSemantics(transformOrigin: string): WechatDimensionSemanticsContext {
  const computed = style({
    'box-sizing': 'border-box',
    height: '3px',
    'margin-bottom': '0px',
    'margin-left': '0px',
    'margin-right': '0px',
    'margin-top': '0px',
    'transform-origin': transformOrigin,
    width: '100px'
  });
  return {
    cleanup: vi.fn(),
    getComputedStyle: () => computed,
    getFormattingOwnerDisplay: () => null,
    getRootComputedStyle: () => computed,
    refresh: vi.fn()
  };
}

function runtime(measured: CSSStyleDeclaration): BrowserWechatClipboardRuntime {
  return {
    blob: Blob,
    clipboardItem: null,
    document,
    getComputedStyle: () => measured,
    getSelection: () => null,
    pageOffset: () => ({ x: 0, y: 0 }),
    scrollTo: () => undefined,
    write: null
  };
}

function transformOriginDeclaration(declarations: readonly string[]): string | undefined {
  return declarations.find((declaration) => declaration.startsWith('transform-origin:'));
}

async function serializeTransformOrigin(
  rawTransformOrigin: string,
  measuredTransformOrigin = '327.5px 1.5px'
): Promise<Readonly<{ modern: string | undefined; legacy: string | undefined }>> {
  const source = document.createElement('hr');
  const measured = style({
    display: 'block',
    height: '3px',
    position: 'static',
    transform: 'matrix(0.8, 0, 0, 1, 0, 0)',
    'transform-origin': measuredTransformOrigin,
    width: '655px'
  });
  const semantics = dimensionSemantics(rawTransformOrigin);
  const modern = await styleDeclarations(
    source,
    measured,
    false,
    false,
    runtime(measured),
    new Map(),
    null,
    undefined,
    semantics
  );
  const legacy = styleDeclarationsSynchronously(source, measured, false, false, runtime(measured), semantics);
  if (null === legacy) throw new Error('wechat-style-policy-test-legacy-style-serialization-failed');
  return {
    legacy: transformOriginDeclaration(legacy),
    modern: transformOriginDeclaration(modern)
  };
}

describe('transform-origin portable style semantics', () => {
  it.each([
    ['50% 50%', '50% 50%'],
    ['left top', 'left top'],
    ['25% 10px', '25% 10px'],
    ['120px 40px', '120px 40px']
  ])('preserves the raw %s origin instead of the measured pixels', async (raw, expected) => {
    await expect(serializeTransformOrigin(raw)).resolves.toEqual({
      legacy: `transform-origin:${expected}`,
      modern: `transform-origin:${expected}`
    });
  });

  it('keeps modern and legacy style serialization identical for an explicit pixel origin', async () => {
    await expect(serializeTransformOrigin('120px 40px')).resolves.toEqual({
      legacy: 'transform-origin:120px 40px',
      modern: 'transform-origin:120px 40px'
    });
  });

  it('keeps measured pixels when the raw origin grammar is not transportable', async () => {
    await expect(serializeTransformOrigin('calc(50% + 1px) 50%')).resolves.toEqual({
      legacy: 'transform-origin:327.5px 1.5px',
      modern: 'transform-origin:327.5px 1.5px'
    });
  });

  it('distinguishes raw semantics with the same resolved center used value', () => {
    const source = document.createElement('hr');
    const percentageSignature = ordinaryDimensionSemanticsSignature(source, dimensionSemantics('50% 50%'));
    const keywordSignature = ordinaryDimensionSemanticsSignature(source, dimensionSemantics('center center'));
    expect(percentageSignature).not.toBe(keywordSignature);
    expect(semanticTransformOriginSignature(source, style({ 'transform-origin': '50% 50%' }))).toBe(
      'transform-origin=50% 50%'
    );
    expect(semanticTransformOriginSignature(source, style({ 'transform-origin': 'center center' }))).toBe(
      'transform-origin=center center'
    );
  });

  it('does not transport transform-origin semantics from special layout nodes', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    expect(transportableTransformOriginSemantics('50% 50%')).toBe('50% 50%');
    expect(semanticTransformOriginSignature(svg, style({ 'transform-origin': '50% 50%' }))).toBe('');
  });

  it('uses the measured value when no raw dimension context is available', () => {
    const source = document.createElement('hr');
    const measured = style({ 'transform-origin': '327.5px 1.5px' });
    const declarations: string[] = [];
    appendPortableStyleDeclaration(
      createStyleDeclarationContext(source, measured, false, false, null),
      'transform-origin',
      '327.5px 1.5px',
      '327.5px 1.5px',
      declarations
    );
    expect(declarations).toContain('transform-origin:327.5px 1.5px');
  });
});
