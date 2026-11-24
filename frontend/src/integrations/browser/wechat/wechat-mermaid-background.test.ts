// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';

import {
  applyMermaidBackground,
  hasNonZeroBorderRadius,
  hasVisibleBackgroundColor,
  isOpaqueBackgroundColor,
  isSafeBackgroundImage,
  parseCssColorAlpha,
  resolveMermaidInheritedBackground,
} from './wechat-mermaid-background';

function styleDeclaration(values: Readonly<Record<string, string>>): CSSStyleDeclaration {
  return {
    backgroundColor: values['background-color'] ?? '',
    backgroundImage: values['background-image'] ?? '',
    backgroundPosition: values['background-position'] ?? '',
    backgroundRepeat: values['background-repeat'] ?? '',
    backgroundSize: values['background-size'] ?? '',
    borderBottomLeftRadius: values['border-bottom-left-radius'] ?? '',
    borderBottomRightRadius: values['border-bottom-right-radius'] ?? '',
    borderRadius: values['border-radius'] ?? '',
    borderTopLeftRadius: values['border-top-left-radius'] ?? '',
    borderTopRightRadius: values['border-top-right-radius'] ?? '',
    getPropertyValue: (property: string) => values[property] ?? '',
    opacity: values.opacity ?? '',
  } as unknown as CSSStyleDeclaration;
}

function makeReader(
  overrides: ReadonlyMap<Element, Readonly<Record<string, string>>>,
): (element: Element) => CSSStyleDeclaration {
  return (element) => {
    const custom = overrides.get(element);
    if (custom) return styleDeclaration(custom);
    return window.getComputedStyle(element);
  };
}

afterEach(() => {
  document.body.replaceChildren();
  document.body.style.backgroundColor = '';
});

describe('wechat-mermaid-background', () => {
  describe('parseCssColorAlpha', () => {
    it('parses transparent, empty, keywords, hex, functional, modern CSS, and named colors', () => {
      expect(parseCssColorAlpha('')).toBeNull();
      expect(parseCssColorAlpha('none')).toBeNull();
      expect(parseCssColorAlpha('initial')).toBeNull();
      expect(parseCssColorAlpha('inherit')).toBeNull();
      expect(parseCssColorAlpha('unset')).toBeNull();
      expect(parseCssColorAlpha('revert')).toBeNull();
      expect(parseCssColorAlpha('currentColor')).toBeNull();
      expect(parseCssColorAlpha('color-mix(in srgb, red 50%, blue)')).toBeNull();

      expect(parseCssColorAlpha('transparent')).toBe(0);
      expect(parseCssColorAlpha('rgba(0, 0, 0, 0)')).toBe(0);
      expect(parseCssColorAlpha('rgb(255 255 255 / 0)')).toBe(0);
      expect(parseCssColorAlpha('rgb(255 255 255 / 0%)')).toBe(0);
      expect(parseCssColorAlpha('rgb(255 255 255 / none)')).toBe(0);
      expect(parseCssColorAlpha('oklch(0.7 0.1 200 / 0)')).toBe(0);
      expect(parseCssColorAlpha('#0000')).toBe(0);
      expect(parseCssColorAlpha('#11223300')).toBe(0);

      expect(parseCssColorAlpha('rgba(10, 20, 30, 0.5)')).toBe(0.5);
      expect(parseCssColorAlpha('rgb(10 20 30 / 50%)')).toBe(0.5);
      expect(parseCssColorAlpha('hsla(120, 100%, 50%, 0.25)')).toBe(0.25);
      expect(parseCssColorAlpha('hsl(120deg 100% 50% / 25%)')).toBe(0.25);
      expect(parseCssColorAlpha('oklch(0.7 0.1 200 / 0.4)')).toBe(0.4);
      expect(parseCssColorAlpha('oklab(0.6 0.1 -0.1 / 60%)')).toBe(0.6);
      expect(parseCssColorAlpha('lab(50% 40 59.5 / 0.2)')).toBe(0.2);
      expect(parseCssColorAlpha('lch(52.2% 72.2 50 / 80%)')).toBe(0.8);
      expect(parseCssColorAlpha('color(display-p3 1 0.5 0 / 0.5)')).toBe(0.5);
      expect(parseCssColorAlpha('#123f')).toBe(1);
      expect(parseCssColorAlpha('#1238')).toBeCloseTo(8 / 15, 6);
      expect(parseCssColorAlpha('#11223380')).toBeCloseTo(128 / 255, 6);

      expect(parseCssColorAlpha('#fff')).toBe(1);
      expect(parseCssColorAlpha('#1e1e2e')).toBe(1);
      expect(parseCssColorAlpha('#1e1e2eff')).toBe(1);
      expect(parseCssColorAlpha('rgb(240, 240, 240)')).toBe(1);
      expect(parseCssColorAlpha('rgba(240, 240, 240, 1)')).toBe(1);
      expect(parseCssColorAlpha('rgb(240 240 240 / 100%)')).toBe(1);
      expect(parseCssColorAlpha('rgb(240 240 240 / 1.5)')).toBe(1);
      expect(parseCssColorAlpha('rgb(calc(100 / 2) 20 30)')).toBe(1);
      expect(parseCssColorAlpha('oklch(0.95 0 0)')).toBe(1);
      expect(parseCssColorAlpha('white')).toBe(1);
      expect(parseCssColorAlpha('rebeccapurple')).toBe(1);
    });

    it('distinguishes visible vs opaque colors and safe vs blocked images', () => {
      expect(hasVisibleBackgroundColor('rgba(10, 20, 30, 0.5)')).toBe(true);
      expect(isOpaqueBackgroundColor('rgba(10, 20, 30, 0.5)')).toBe(false);
      expect(hasVisibleBackgroundColor('rgb(10, 20, 30)')).toBe(true);
      expect(isOpaqueBackgroundColor('rgb(10, 20, 30)')).toBe(true);
      expect(hasVisibleBackgroundColor('rgba(0, 0, 0, 0)')).toBe(false);
      expect(hasVisibleBackgroundColor('transparent')).toBe(false);
      expect(hasVisibleBackgroundColor('none')).toBe(false);
      expect(hasVisibleBackgroundColor('color-mix(in srgb, red 50%, blue)')).toBe(true);
      expect(isOpaqueBackgroundColor('color-mix(in srgb, red 50%, blue)')).toBe(false);

      expect(isSafeBackgroundImage('linear-gradient(135deg, #fff, #eee)')).toBe(true);
      expect(isSafeBackgroundImage('radial-gradient(circle, red, blue)')).toBe(true);
      expect(isSafeBackgroundImage('url("https://example.test/bg.png")')).toBe(false);
      expect(isSafeBackgroundImage('image-set("a.png" 1x)')).toBe(false);
      expect(isSafeBackgroundImage('none')).toBe(false);
    });
  });

  describe('hasNonZeroBorderRadius', () => {
    it('detects zero vs non-zero radii across longhands and shorthand', () => {
      expect(hasNonZeroBorderRadius(styleDeclaration({}))).toBe(false);
      expect(
        hasNonZeroBorderRadius(
          styleDeclaration({
            'border-bottom-left-radius': '0px',
            'border-bottom-right-radius': '0px',
            'border-top-left-radius': '0px',
            'border-top-right-radius': '0px',
          }),
        ),
      ).toBe(false);
      expect(
        hasNonZeroBorderRadius(
          styleDeclaration({
            'border-bottom-left-radius': '0px 0px',
            'border-bottom-right-radius': '0px',
            'border-top-left-radius': '12px',
            'border-top-right-radius': '0px',
          }),
        ),
      ).toBe(true);
      expect(hasNonZeroBorderRadius(styleDeclaration({ 'border-radius': '12px' }))).toBe(true);
      expect(
        hasNonZeroBorderRadius(
          styleDeclaration({
            'border-bottom-left-radius': '0px',
            'border-bottom-right-radius': '0px',
            'border-radius': '12px',
            'border-top-left-radius': '0px',
            'border-top-right-radius': '0px',
          }),
        ),
      ).toBe(true);
      expect(hasNonZeroBorderRadius(styleDeclaration({ 'border-radius': '0px / 0px' }))).toBe(false);
      expect(hasNonZeroBorderRadius(styleDeclaration({ 'border-radius': '50%' }))).toBe(true);
    });
  });

  describe('resolveMermaidInheritedBackground', () => {
    it('walks strictly past a 50%-opacity Mermaid root to the opaque canvas without repeating root color', () => {
      const canvas = document.createElement('div');
      canvas.className = 'easymde-immersive-preview-canvas';
      const source = document.createElement('div');
      source.className = 'easymde-mermaid';
      canvas.append(source);
      document.body.append(canvas);

      const reader = makeReader(
        new Map([
          [source, { 'background-color': 'rgba(10, 20, 30, 0.5)', 'background-image': 'none' }],
          [canvas, { 'background-color': 'rgb(240, 240, 240)', 'background-image': 'none' }],
        ]),
      );

      expect(resolveMermaidInheritedBackground(source, reader)).toEqual({
        color: 'rgb(240, 240, 240)',
      });
    });

    it('returns null for a 50%-opacity Mermaid root with no preview backdrop before body', () => {
      document.body.style.backgroundColor = 'rgb(240, 240, 241)';
      const source = document.createElement('div');
      source.className = 'easymde-mermaid';
      document.body.append(source);

      const reader = makeReader(
        new Map([[source, { 'background-color': 'rgba(10, 20, 30, 0.5)', 'background-image': 'none' }]]),
      );

      expect(resolveMermaidInheritedBackground(source, reader)).toBeNull();
    });

    it('resolves the dark backing canvas behind a rounded opaque Mermaid card', () => {
      const canvas = document.createElement('div');
      canvas.className = 'easymde-immersive-preview-canvas';
      const source = document.createElement('div');
      source.className = 'easymde-mermaid';
      canvas.append(source);
      document.body.append(canvas);

      const reader = makeReader(
        new Map([
          [
            source,
            {
              'background-color': 'rgb(245, 247, 250)',
              'background-image': 'none',
              'border-radius': '12px',
            },
          ],
          [canvas, { 'background-color': 'rgb(30, 30, 46)', 'background-image': 'none' }],
        ]),
      );

      expect(resolveMermaidInheritedBackground(source, reader)).toEqual({
        color: 'rgb(30, 30, 46)',
      });
    });

    it('returns null for a square opaque Mermaid card even when an ancestor has a gradient', () => {
      const ancestor = document.createElement('div');
      const source = document.createElement('div');
      source.className = 'easymde-mermaid';
      ancestor.append(source);
      document.body.append(ancestor);

      const reader = makeReader(
        new Map([
          [
            source,
            {
              'background-color': 'rgb(28, 31, 38)',
              'background-image': 'none',
              'border-radius': '0px',
            },
          ],
          [
            ancestor,
            {
              'background-color': 'rgb(250, 240, 230)',
              'background-image': 'linear-gradient(red, blue)',
            },
          ],
        ]),
      );

      expect(resolveMermaidInheritedBackground(source, reader)).toBeNull();
    });

    it('continues past translucent intermediate ancestors until reaching an opaque backing canvas', () => {
      const canvas = document.createElement('div');
      canvas.className = 'easymde-immersive-preview-canvas';
      const translucentLayer = document.createElement('div');
      const source = document.createElement('div');
      source.className = 'easymde-mermaid';
      translucentLayer.append(source);
      canvas.append(translucentLayer);
      document.body.append(canvas);

      const reader = makeReader(
        new Map([
          [source, { 'background-color': 'rgba(255, 255, 255, 0.06)', 'background-image': 'none' }],
          [
            translucentLayer,
            {
              'background-color': 'rgba(255, 255, 255, 0.04)',
              'background-image': 'linear-gradient(180deg, rgba(255, 255, 255, 0.05), transparent)',
              'background-position': '0% 0%',
              'background-repeat': 'no-repeat',
              'background-size': '100% 100%',
            },
          ],
          [canvas, { 'background-color': 'rgb(24, 24, 27)', 'background-image': 'none' }],
        ]),
      );

      expect(resolveMermaidInheritedBackground(source, reader)).toEqual({
        color: 'rgb(24, 24, 27)',
        image: 'linear-gradient(180deg, rgba(255, 255, 255, 0.05), transparent)',
        position: '0% 0%',
        repeat: 'no-repeat',
        size: '100% 100%',
      });
    });

    it('handles mermaid-responsive direct SVG across transparent, opaque, and semi-transparent wrappers', () => {
      const canvas = document.createElement('div');
      canvas.className = 'easymde-immersive-preview-canvas';
      const wrapper = document.createElement('div');
      wrapper.className = 'easymde-mermaid';
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      wrapper.append(svg);
      canvas.append(wrapper);
      document.body.append(canvas);

      const transparentWrapperReader = makeReader(
        new Map<Element, Readonly<Record<string, string>>>([
          [svg, { 'background-color': 'rgba(0, 0, 0, 0)', 'background-image': 'none' }],
          [wrapper, { 'background-color': 'rgba(0, 0, 0, 0)', 'background-image': 'none' }],
          [
            canvas,
            {
              'background-color': 'rgb(250, 240, 230)',
              'background-image': 'linear-gradient(90deg, rgb(250, 240, 230), rgb(230, 240, 250))',
              'background-position': '0% 0%',
              'background-repeat': 'no-repeat',
              'background-size': '100% 100%',
            },
          ],
        ]),
      );
      expect(
        resolveMermaidInheritedBackground(svg, transparentWrapperReader, {
          directSvgCapture: true,
          retainedParentWrapper: true,
        }),
      ).toEqual({
        color: 'rgb(250, 240, 230)',
        image: 'linear-gradient(90deg, rgb(250, 240, 230), rgb(230, 240, 250))',
        position: '0% 0%',
        repeat: 'no-repeat',
        size: '100% 100%',
      });

      const opaqueCardReader = makeReader(
        new Map<Element, Readonly<Record<string, string>>>([
          [svg, { 'background-color': 'rgba(0, 0, 0, 0)', 'background-image': 'none' }],
          [
            wrapper,
            {
              'background-color': 'rgb(248, 246, 239)',
              'background-image': 'none',
              'border-radius': '12px',
            },
          ],
          [canvas, { 'background-color': 'rgb(30, 30, 46)', 'background-image': 'none' }],
        ]),
      );
      expect(
        resolveMermaidInheritedBackground(svg, opaqueCardReader, {
          directSvgCapture: true,
          retainedParentWrapper: true,
        }),
      ).toEqual({
        color: 'rgb(248, 246, 239)',
      });

      const translucentCardReader = makeReader(
        new Map<Element, Readonly<Record<string, string>>>([
          [svg, { 'background-color': 'rgba(0, 0, 0, 0)', 'background-image': 'none' }],
          [
            wrapper,
            {
              'background-color': 'rgba(255, 255, 255, 0.06)',
              'background-image': 'none',
              'border-radius': '12px',
            },
          ],
          [canvas, { 'background-color': 'rgb(24, 24, 27)', 'background-image': 'none' }],
        ]),
      );
      expect(
        resolveMermaidInheritedBackground(svg, translucentCardReader, {
          directSvgCapture: true,
          retainedParentWrapper: true,
        }),
      ).toBeNull();
    });

    it('stops before measure-host and wp-admin containers and drops unsafe url() images', () => {
      const wpbody = document.createElement('div');
      wpbody.id = 'wpbody';
      const measureHost = document.createElement('div');
      measureHost.setAttribute('data-easymde-wechat-measure-host', '1');
      const preview = document.createElement('div');
      preview.className = 'easymde-preview';
      const source = document.createElement('div');
      source.className = 'easymde-mermaid';
      preview.append(source);
      measureHost.append(preview);
      wpbody.append(measureHost);
      document.body.append(wpbody);

      const reader = makeReader(
        new Map<Element, Readonly<Record<string, string>>>([
          [source, { 'background-color': 'rgba(0, 0, 0, 0)', 'background-image': 'none' }],
          [
            preview,
            {
              'background-color': 'rgba(0, 0, 0, 0)',
              'background-image': 'url("https://blocked.example/bg.png")',
            },
          ],
          [measureHost, { 'background-color': 'rgb(10, 10, 10)', 'background-image': 'none' }],
          [wpbody, { 'background-color': 'rgb(240, 240, 241)', 'background-image': 'none' }],
        ]),
      );

      expect(resolveMermaidInheritedBackground(source, reader)).toBeNull();
    });
  });

  describe('applyMermaidBackground', () => {
    it('applies visible color and safe gradient only, skipping null and unsafe url()', () => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
      applyMermaidBackground(svg, null);
      expect(svg.getAttribute('style')).toBeNull();

      applyMermaidBackground(svg, {
        color: 'rgba(0, 0, 0, 0)',
        image: 'url("https://blocked.example/bg.png")',
        position: '0 0',
      });
      expect(svg.style.getPropertyValue('background-color')).toBe('');
      expect(svg.style.getPropertyValue('background-image')).toBe('');

      applyMermaidBackground(svg, {
        color: 'rgb(30, 30, 46)',
        image: 'linear-gradient(90deg, rgb(30, 30, 46), rgb(45, 45, 65))',
        position: '50% 50%',
        repeat: 'no-repeat',
        size: 'cover',
      });
      expect(svg.style.getPropertyValue('background-color')).toBe('rgb(30, 30, 46)');
      expect(svg.style.getPropertyValue('background-image')).toBe(
        'linear-gradient(90deg, rgb(30, 30, 46), rgb(45, 45, 65))',
      );
      expect(svg.style.getPropertyValue('background-position')).toBe('50% 50%');
      expect(svg.style.getPropertyValue('background-repeat')).toBe('no-repeat');
      expect(svg.style.getPropertyValue('background-size')).toBe('cover');
    });
  });
});
