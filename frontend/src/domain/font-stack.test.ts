import { describe, expect, it } from 'vitest';

import type { FontControlsOptions } from '../contracts/bootstrap/font-controls-bootstrap';
import { buildFontStack } from './font-stack';

const options: FontControlsOptions = {
  customFonts: [
    { id: 'custom', label: 'Custom', fontFamily: '"Inter", Arial' }
  ],
  windowsFonts: [
    { id: 'windows', label: 'Windows', fontFamily: 'arial, "Microsoft YaHei"' }
  ],
  appleFonts: [
    { id: 'apple', label: 'Apple', fontFamily: '"PingFang SC", "Inter"' }
  ],
  serifOptions: [
    { id: 'serif', label: 'Serif', fontFamily: 'Georgia, serif' }
  ]
};

describe('buildFontStack', () => {
  it('deduplicates families case-insensitively in custom, Windows, Apple, serif order', () => {
    expect(buildFontStack(options, {
      customFont: 'custom',
      windowsFont: 'windows',
      appleFont: 'apple',
      serifFont: 'serif'
    })).toBe('"Inter", Arial, "Microsoft YaHei", "PingFang SC", Georgia, serif');
  });

  it('keeps the theme fallback after explicit font selections', () => {
    expect(buildFontStack({
      ...options,
      serifOptions: [
        { id: 'theme-default', label: 'Theme default', fontFamily: 'var(--easymde-theme-font-family)' }
      ]
    }, {
      customFont: 'custom',
      windowsFont: 'windows',
      appleFont: 'apple',
      serifFont: 'theme-default'
    }, 'var(--easymde-theme-font-family, sans-serif)')).toBe('"Inter", Arial, "Microsoft YaHei", "PingFang SC", var(--easymde-theme-font-family, sans-serif)');
  });

  it('keeps a safe fallback when the active theme has no font variable', () => {
    expect(buildFontStack({
      ...options,
      serifOptions: [
        { id: 'theme-default', label: 'Theme default', fontFamily: 'var(--easymde-theme-font-family)' }
      ]
    }, {
      customFont: 'custom',
      windowsFont: 'windows',
      appleFont: 'apple',
      serifFont: 'theme-default'
    }, 'var(--easymde-theme-font-family, sans-serif)')).toBe('"Inter", Arial, "Microsoft YaHei", "PingFang SC", var(--easymde-theme-font-family, sans-serif)');
  });

  it('returns an empty stack when theme default is the only selection', () => {
    expect(buildFontStack({
      customFonts: [{ id: 'none', label: 'None', fontFamily: '' }],
      windowsFonts: [{ id: 'none', label: 'None', fontFamily: '' }],
      appleFonts: [{ id: 'none', label: 'None', fontFamily: '' }],
      serifOptions: [
        { id: 'theme-default', label: 'Theme default', fontFamily: 'var(--easymde-theme-font-family)' }
      ]
    }, {
      customFont: 'none',
      windowsFont: 'none',
      appleFont: 'none',
      serifFont: 'theme-default'
    })).toBe('');
  });
});
