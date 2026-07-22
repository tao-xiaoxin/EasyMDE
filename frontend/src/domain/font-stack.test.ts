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
});
