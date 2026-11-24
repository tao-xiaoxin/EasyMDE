// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';

import {
  compositeSourceOver as directCompositeSourceOver,
  formatCompositedColor as directFormatCompositedColor,
  hasVisibleBackgroundColor as directHasVisibleBackgroundColor,
  isOpaqueBackgroundColor as directIsOpaqueBackgroundColor,
  parseCssColorAlpha as directParseCssColorAlpha,
  parseCssOpacity as directParseCssOpacity,
  parseCssSolidColor as directParseCssSolidColor,
} from './wechat-css-color';
import {
  applyMermaidBackground,
  compositeSourceOver,
  formatCompositedColor,
  hasBackgroundImage,
  hasNonZeroBorderRadius,
  hasRoundedNonOpaqueBackground,
  hasUnsafeOrImageBackgroundShorthand,
  hasVisibleBackgroundColor,
  inlineConnectedMermaidRootPaint,
  isOpaqueBackgroundColor,
  isRoundedNonOpaquePaint,
  isSafeBackgroundImage,
  parseCssColorAlpha,
  parseCssOpacity,
  parseCssSolidColor,
  resolveMermaidBorderRadii,
  resolveMermaidInheritedBackground,
  stripMermaidBorderRadius,
} from './wechat-mermaid-background';
import {
  isZeroMermaidRadiusValue,
  mermaidCssPixelValue,
  parseMermaidRadiusAxis,
  parseMermaidRadiusPair,
  parseMermaidRadiusShorthand,
} from './wechat-mermaid-policy';

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
      expect(parseCssColorAlpha('oklch(0.7 0.2 30)')).toBe(1);
      expect(parseCssColorAlpha('color(display-p3 1 0 0)')).toBe(1);
      expect(parseCssColorAlpha('rgb(255, 0, 0)')).toBe(1);
      expect(parseCssColorAlpha('white')).toBe(1);
      expect(parseCssColorAlpha('rebeccapurple')).toBe(1);
    });

    it('rejects relative colors without explicit alpha, malformed slashes, unbalanced groups, and invalid legacy/modern syntax', () => {
      // CSS Color 5 relative colors without top-level / inherit origin alpha and cannot be assumed opaque.
      expect(parseCssColorAlpha('rgb(from rgba(255, 0, 0, 0.5) r g b)')).toBeNull();
      expect(isOpaqueBackgroundColor('rgb(from rgba(255, 0, 0, 0.5) r g b)')).toBe(false);
      expect(parseCssColorAlpha('oklch(from oklch(0.7 0.2 30 / 0.25) l c h)')).toBeNull();
      expect(isOpaqueBackgroundColor('oklch(from oklch(0.7 0.2 30 / 0.25) l c h)')).toBe(false);
      expect(parseCssColorAlpha('oklch(from oklch(0.7 0.2 30 / 0.25) l c h / 0.8)')).toBe(0.8);
      expect(parseCssColorAlpha('rgb(from rgba(255, 0, 0, 0.5) r g b / 0.8)')).toBe(0.8);
      expect(parseCssColorAlpha('oklch(from oklch(0.7 0.2 30 / 0.25) l c h / alpha)')).toBeNull();
      expect(parseCssColorAlpha('oklch(from oklch(0.7 0.2 30 / 0.25) l c h / 1)')).toBe(1);

      // Empty/duplicate slashes and unbalanced parentheses across multiple functions.
      expect(parseCssColorAlpha('rgb(255 0 0 / )')).toBeNull();
      expect(parseCssColorAlpha('rgb( / 0.5)')).toBeNull();
      expect(parseCssColorAlpha('rgb(255 0 0 / 0.5 / 0.2)')).toBeNull();
      expect(parseCssColorAlpha('rgb(255, 0, 0) rgb(0, 0, 0)')).toBeNull();
      expect(parseCssColorAlpha('rgb(255, 0, 0))')).toBeNull();
      expect(parseCssColorAlpha('rgb((255, 0, 0)')).toBeNull();
      expect(parseCssColorAlpha('rgb()')).toBeNull();

      // Legacy comma syntax rejects `none`, mixed slash, wrong arity, and empty arguments; modern space syntax allows `none`.
      expect(parseCssColorAlpha('rgba(255, 0, 0, none)')).toBeNull();
      expect(parseCssColorAlpha('rgb(255 0 0 / none)')).toBe(0);
      expect(parseCssColorAlpha('rgb(255, 0, 0 / 0.5)')).toBeNull();
      expect(parseCssColorAlpha('rgb(255, 0)')).toBeNull();
      expect(parseCssColorAlpha('rgba(255, 0, 0, 0.5, 1)')).toBeNull();
      expect(parseCssColorAlpha('rgba(255, 0, 0, )')).toBeNull();
      expect(parseCssColorAlpha('oklch(0.7, 0.2, 30)')).toBeNull();
      expect(parseCssColorAlpha('color(display-p3, 1, 0, 0)')).toBeNull();
      expect(parseCssColorAlpha('rgb(255 0 0 0.5)')).toBeNull();
      expect(parseCssColorAlpha('rgb(var(--c))')).toBeNull();

      // Valid opaque modern and legacy colors remain opaque.
      expect(isOpaqueBackgroundColor('rgb(255, 0, 0)')).toBe(true);
      expect(isOpaqueBackgroundColor('oklch(0.7 0.2 30)')).toBe(true);
      expect(isOpaqueBackgroundColor('color(display-p3 1 0 0)')).toBe(true);
    });

    it('rejects unspaced var() and env() substitution functions across slash and non-slash color syntax', () => {
      const dynamicColors = [
        'rgb(100% 0% 0%var(--alpha))',
        'rgb(100%, 0%, 0%var(--alpha))',
        'rgb(calc(255) 0 calc(0)var(--alpha))',
        'color(srgb 100%var(--rest))',
        'rgb(255 0 env(--tail))',
        'rgb(255, 0, env(--tail))',
        'rgb(100% 0% 0%var(--alpha) / 0.5)',
        'rgb(100% 0% 0% / var(--alpha))',
        'rgb(100% 0% 0% / env(--alpha))',
        'rgb(100% 0% 0%env(--alpha) / 1)',
      ];
      for (const color of dynamicColors) {
        expect(parseCssColorAlpha(color)).toBeNull();
        expect(isOpaqueBackgroundColor(color)).toBe(false);
      }
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

    it('validates multi-layer background-image lists and blocks CSS escapes, cross-fade, variables, and trailing tokens', () => {
      expect(hasBackgroundImage('')).toBe(false);
      expect(hasBackgroundImage('none')).toBe(false);
      expect(hasBackgroundImage('none, none')).toBe(false);
      expect(hasBackgroundImage('none, initial')).toBe(false);
      expect(hasBackgroundImage('none, linear-gradient(red, blue)')).toBe(true);

      expect(isSafeBackgroundImage('none, none')).toBe(false);
      expect(isSafeBackgroundImage('none, initial')).toBe(false);
      expect(isSafeBackgroundImage('none, linear-gradient(red, blue)')).toBe(true);
      expect(isSafeBackgroundImage('none, linear-gradient(rgb(255, 0, 0), rgb(0, 0, 255))')).toBe(true);
      expect(isSafeBackgroundImage('linear-gradient(red, blue), none')).toBe(true);
      expect(isSafeBackgroundImage('repeating-conic-gradient(from 45deg, red, blue)')).toBe(true);
      expect(isSafeBackgroundImage('-webkit-linear-gradient(top, #fff, #000)')).toBe(true);

      const unsafeImages = [
        'u\\72l(https://evil.example/bg.png)',
        '\\75rl(https://evil.example/bg.png)',
        'linear-gradient(re\\64, blue)',
        'cross-fade("https://evil.example/bg.png", linear-gradient(red, blue))',
        '-webkit-cross-fade(url(x), url(y), 50%)',
        'linear-gradient(red, blue) url(x)',
        'linear-gradient(red, blue) extra',
        'linear-gradient(red, blue) linear-gradient(green, yellow)',
        'url(https://evil.example/bg.png)',
        'image-set("a.png" 1x)',
        'image(red)',
        'src("https://evil.example/bg.png")',
        'element(#foo)',
        'linear-gradient(var(--a), blue)',
        'linear-gradient(100%var(--a), blue)',
        'linear-gradient(env(--a), blue)',
        'linear-gradient(red, blue), ',
        'linear-gradient()',
        'linear-gradient(red, blue))',
        'linear-gradient((red, blue)',
        'none, initial, linear-gradient(red, blue)',
      ];
      for (const candidate of unsafeImages) {
        expect(isSafeBackgroundImage(candidate), candidate).toBe(false);
      }

      // Shared rounded non-opaque predicate stays consistent across multi-layer none, gradients, and blocked images.
      expect(
        hasRoundedNonOpaqueBackground(
          styleDeclaration({
            'background-color': 'rgba(0, 0, 0, 0)',
            'background-image': 'none, none',
            'border-radius': '12px',
          }),
        ),
      ).toBe(false);
      expect(
        hasRoundedNonOpaqueBackground(
          styleDeclaration({
            'background-color': 'rgba(0, 0, 0, 0)',
            'background-image': 'none, linear-gradient(red, blue)',
            'border-radius': '12px',
          }),
        ),
      ).toBe(true);
      expect(
        hasRoundedNonOpaqueBackground(
          styleDeclaration({
            'background-color': 'rgba(0, 0, 0, 0)',
            'background-image': 'u\\72l(https://evil.example/bg.png)',
            'border-radius': '12px',
          }),
        ),
      ).toBe(false);
      expect(
        hasRoundedNonOpaqueBackground(
          styleDeclaration({
            'background-color': 'rgb(255, 0, 0)',
            'background-image': 'linear-gradient(red, blue)',
            'border-radius': '12px',
          }),
        ),
      ).toBe(false);
      expect(
        isRoundedNonOpaquePaint({
          color: 'rgba(255, 0, 0, 0.5)',
          hasNonZeroRadius: true,
          safeImage: '',
        }),
      ).toBe(true);
    });

    it('detects unsafe and image tokens in background shorthand via hasUnsafeOrImageBackgroundShorthand', () => {
      for (const safe of [
        '',
        'none',
        'transparent',
        '#f8f6ef',
        'rgb(255, 255, 255)',
        'rgba(248, 246, 239, 0.9) none repeat scroll 0% 0%',
      ]) {
        expect(hasUnsafeOrImageBackgroundShorthand(safe), safe).toBe(false);
      }

      for (const unsafe of [
        'var(--x)',
        'rgb(255, 0, 0) var(--danger)',
        'VAR ( --danger )',
        'env(--x)',
        'env(safe-area-inset-top)',
        'u\\72l(https://evil.example/bg.png)',
        '\\76ar(--danger)',
        'url(https://evil.example/bg.png)',
        'url (https://evil.example/bg.png)',
        'gradient(linear, left top, left bottom, from(#fff), to(#000))',
        'linear-gradient(red, blue)',
        'radial-gradient (circle, red, blue)',
        'repeating-conic-gradient(from 0deg, red, blue)',
        'cross-fade("https://evil.example/bg.png", red)',
        '-webkit-cross-fade(url(a), url(b), 50%)',
        'image-set("a.png" 1x)',
        'image(red)',
        'src("https://evil.example/bg.png")',
        'element(#foo)',
        'paint(checkerboard)',
        'red PAINT (worklet)',
      ]) {
        expect(hasUnsafeOrImageBackgroundShorthand(unsafe), unsafe).toBe(true);
      }
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

    it('fails closed on cascade-dependent border-radius keywords while treating static zero keywords as zero', () => {
      for (const keyword of ['inherit', 'revert', 'revert-layer']) {
        expect(isZeroMermaidRadiusValue(keyword)).toBe(false);
        expect(hasNonZeroBorderRadius(styleDeclaration({ 'border-radius': keyword }))).toBe(true);
        expect(hasNonZeroBorderRadius(styleDeclaration({ 'border-top-left-radius': keyword }))).toBe(true);
        expect(resolveMermaidBorderRadii(styleDeclaration({ 'border-radius': keyword }), undefined, 100, 60)).toBeNull();
        expect(
          resolveMermaidBorderRadii(styleDeclaration({ 'border-top-left-radius': keyword }), undefined, 100, 60),
        ).toBeNull();
      }

      for (const keyword of ['initial', 'none', 'unset', '0px']) {
        expect(isZeroMermaidRadiusValue(keyword)).toBe(true);
        expect(hasNonZeroBorderRadius(styleDeclaration({ 'border-radius': keyword }))).toBe(false);
      }
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

    it('preserves ancestor backdrop behind a non-direct opaque root with border-radius: inherit', () => {
      const canvas = document.createElement('div');
      canvas.className = 'easymde-immersive-preview-canvas';
      const source = document.createElement('div');
      source.className = 'easymde-mermaid';
      source.setAttribute('style', 'border-radius: inherit; background-color: #ffffff');
      canvas.append(source);
      document.body.append(canvas);

      const reader = makeReader(
        new Map([
          [canvas, { 'background-color': 'rgb(30, 30, 46)', 'background-image': 'none' }],
        ]),
      );

      expect(resolveMermaidInheritedBackground(source, reader)).toEqual({
        color: 'rgb(30, 30, 46)',
      });
    });

    it('composites translucent intermediate ancestors over the opaque backing canvas', () => {
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
        color: 'rgb(33, 33, 36)',
        image: 'linear-gradient(180deg, rgba(255, 255, 255, 0.05), transparent)',
        position: '0% 0%',
        repeat: 'no-repeat',
        size: '100% 100%',
      });
    });

    it('composites semi-transparent solid ancestor layers over an opaque backing canvas in paint order', () => {
      const canvas = document.createElement('div');
      canvas.className = 'easymde-immersive-preview-canvas';
      const middleLayer = document.createElement('div');
      const source = document.createElement('div');
      source.className = 'easymde-mermaid';
      middleLayer.append(source);
      canvas.append(middleLayer);
      document.body.append(canvas);

      const whiteOverBlackReader = makeReader(
        new Map([
          [source, { 'background-color': 'rgba(0, 0, 0, 0)', 'background-image': 'none' }],
          [middleLayer, { 'background-color': 'rgba(255, 255, 255, 0.5)', 'background-image': 'none' }],
          [canvas, { 'background-color': 'rgb(0, 0, 0)', 'background-image': 'none' }],
        ]),
      );
      expect(resolveMermaidInheritedBackground(source, whiteOverBlackReader)).toEqual({
        color: 'rgb(128, 128, 128)',
      });

      const innerLayer = document.createElement('div');
      innerLayer.append(source);
      middleLayer.append(innerLayer);
      const multiLayerReader = makeReader(
        new Map([
          [source, { 'background-color': 'transparent', 'background-image': 'none' }],
          [innerLayer, { 'background-color': 'rgba(255, 0, 0, 0.5)', 'background-image': 'none' }],
          [middleLayer, { 'background-color': 'rgba(0, 0, 255, 0.5)', 'background-image': 'none' }],
          [canvas, { 'background-color': 'black', 'background-image': 'none' }],
        ]),
      );
      expect(resolveMermaidInheritedBackground(source, multiLayerReader)).toEqual({
        color: 'rgb(128, 0, 64)',
      });

      // Without an opaque backing canvas, composite translucent layers to rgba().
      const translucentOnlyReader = makeReader(
        new Map([
          [source, { 'background-color': 'transparent', 'background-image': 'none' }],
          [innerLayer, { 'background-color': 'rgba(255, 255, 255, 0.5)', 'background-image': 'none' }],
          [middleLayer, { 'background-color': 'rgba(0, 0, 0, 0.5)', 'background-image': 'none' }],
          [canvas, { 'background-color': 'transparent', 'background-image': 'none' }],
        ]),
      );
      expect(resolveMermaidInheritedBackground(source, translucentOnlyReader)).toEqual({
        color: 'rgba(170, 170, 170, 0.75)',
      });

      // Unparseable translucent layers gracefully preserve the opaque backing color.
      const unparseableLayerReader = makeReader(
        new Map([
          [source, { 'background-color': 'transparent', 'background-image': 'none' }],
          [innerLayer, { 'background-color': 'oklch(0.7 0.1 200 / 0.4)', 'background-image': 'none' }],
          [middleLayer, { 'background-color': 'color-mix(in srgb, white 50%, transparent)', 'background-image': 'none' }],
          [canvas, { 'background-color': 'rgb(0, 0, 0)', 'background-image': 'none' }],
        ]),
      );
      expect(resolveMermaidInheritedBackground(source, unparseableLayerReader)).toEqual({
        color: 'rgb(0, 0, 0)',
      });

      // Unparseable opaque backing is never dropped even if a nearer layer is parseable.
      const unparseableOpaqueReader = makeReader(
        new Map([
          [source, { 'background-color': 'transparent', 'background-image': 'none' }],
          [innerLayer, { 'background-color': 'rgba(255, 255, 255, 0.5)', 'background-image': 'none' }],
          [middleLayer, { 'background-color': 'transparent', 'background-image': 'none' }],
          [canvas, { 'background-color': 'oklch(0.95 0 0)', 'background-image': 'none' }],
        ]),
      );
      expect(resolveMermaidInheritedBackground(source, unparseableOpaqueReader)).toEqual({
        color: 'oklch(0.95 0 0)',
      });
    });

    it('attenuates reduced-opacity ancestor solid colors and never promotes reduced-opacity gradients at opacity 1', () => {
      const canvas = document.createElement('div');
      canvas.className = 'easymde-immersive-preview-canvas';
      const tintedLayer = document.createElement('div');
      const source = document.createElement('div');
      source.className = 'easymde-mermaid';
      tintedLayer.append(source);
      canvas.append(tintedLayer);
      document.body.append(canvas);

      const tintedOverWhiteReader = makeReader(
        new Map([
          [source, { 'background-color': 'transparent', 'background-image': 'none' }],
          [
            tintedLayer,
            {
              'background-color': 'rgb(0, 0, 0)',
              'background-image': 'linear-gradient(90deg, rgb(0, 0, 0), rgb(255, 255, 255))',
              opacity: '0.1',
            },
          ],
          [canvas, { 'background-color': 'rgb(255, 255, 255)', 'background-image': 'none' }],
        ]),
      );
      expect(resolveMermaidInheritedBackground(source, tintedOverWhiteReader)).toEqual({
        color: 'rgb(230, 230, 230)',
      });

      const tintedWithoutCanvasReader = makeReader(
        new Map([
          [source, { 'background-color': 'transparent', 'background-image': 'none' }],
          [
            tintedLayer,
            {
              'background-color': 'rgb(0, 0, 0)',
              'background-image': 'linear-gradient(90deg, red, blue)',
              opacity: '0.1',
            },
          ],
          [canvas, { 'background-color': 'transparent', 'background-image': 'none' }],
        ]),
      );
      expect(resolveMermaidInheritedBackground(source, tintedWithoutCanvasReader)).toEqual({
        color: 'rgba(0, 0, 0, 0.1)',
      });

      const lowOpacityGradientOnlyReader = makeReader(
        new Map([
          [source, { 'background-color': 'transparent', 'background-image': 'none' }],
          [
            tintedLayer,
            {
              'background-color': 'transparent',
              'background-image': 'linear-gradient(180deg, rgb(0, 0, 0), rgb(255, 255, 255))',
              opacity: '0.05',
            },
          ],
          [canvas, { 'background-color': 'transparent', 'background-image': 'none' }],
        ]),
      );
      expect(resolveMermaidInheritedBackground(source, lowOpacityGradientOnlyReader)).toBeNull();

      // Reduced-opacity unsafe url() still blocks outer gradients while keeping outer solid backing.
      const lowOpacityBlockedUrlReader = makeReader(
        new Map([
          [source, { 'background-color': 'transparent', 'background-image': 'none' }],
          [
            tintedLayer,
            {
              'background-color': 'transparent',
              'background-image': 'url("https://blocked.example/overlay.png")',
              opacity: '0.5',
            },
          ],
          [
            canvas,
            {
              'background-color': 'rgb(30, 30, 46)',
              'background-image': 'linear-gradient(90deg, red, blue)',
              opacity: '1',
            },
          ],
        ]),
      );
      expect(resolveMermaidInheritedBackground(source, lowOpacityBlockedUrlReader)).toEqual({
        color: 'rgb(30, 30, 46)',
      });

      // Unparseable reduced-opacity color is never promoted at full opacity 1.
      const unparseableLowOpacityReader = makeReader(
        new Map([
          [source, { 'background-color': 'transparent', 'background-image': 'none' }],
          [
            tintedLayer,
            {
              'background-color': 'oklch(0.2 0.05 260)',
              'background-image': 'none',
              opacity: '0.1',
            },
          ],
          [canvas, { 'background-color': 'transparent', 'background-image': 'none' }],
        ]),
      );
      expect(resolveMermaidInheritedBackground(source, unparseableLowOpacityReader)).toBeNull();
    });

    it('folds nested CSS group opacity bottom-up, clears inner layers on opacity 0, and preserves tint-over-gradient paint order', () => {
      const canvas = document.createElement('div');
      canvas.className = 'easymde-immersive-preview-canvas';
      const outerLayer = document.createElement('div');
      const innerLayer = document.createElement('div');
      const source = document.createElement('div');
      source.className = 'easymde-mermaid';
      innerLayer.append(source);
      outerLayer.append(innerLayer);
      canvas.append(outerLayer);
      document.body.append(canvas);

      // 1. 50% red inner tint over outer black gradient stacks tint ABOVE gradient in background-image.
      const tintOverGradientReader = makeReader(
        new Map([
          [source, { 'background-color': 'transparent', 'background-image': 'none' }],
          [innerLayer, { 'background-color': 'rgba(255, 0, 0, 0.5)', 'background-image': 'none' }],
          [
            outerLayer,
            {
              'background-color': 'transparent',
              'background-image': 'linear-gradient(black, black)',
              'background-position': '50% 50%',
              'background-repeat': 'no-repeat',
              'background-size': 'cover',
            },
          ],
          [canvas, { 'background-color': 'transparent', 'background-image': 'none' }],
        ]),
      );
      expect(resolveMermaidInheritedBackground(source, tintOverGradientReader)).toEqual({
        image: 'linear-gradient(rgba(255, 0, 0, 0.5), rgba(255, 0, 0, 0.5)), linear-gradient(black, black)',
        position: '0% 0%, 50% 50%',
        repeat: 'repeat, no-repeat',
        size: 'auto, cover',
      });

      // Multi-layer outer gradient with implicit position/size/repeat and solid backdrop beneath keeps all lists aligned.
      const tintOverMultiGradientReader = makeReader(
        new Map([
          [source, { 'background-color': 'transparent', 'background-image': 'none' }],
          [innerLayer, { 'background-color': 'rgba(255, 0, 0, 0.5)', 'background-image': 'none' }],
          [
            outerLayer,
            {
              'background-color': 'rgb(0, 0, 0)',
              'background-image': 'linear-gradient(black, black), linear-gradient(blue, green)',
              'background-repeat': 'no-repeat',
            },
          ],
          [canvas, { 'background-color': 'transparent', 'background-image': 'none' }],
        ]),
      );
      expect(resolveMermaidInheritedBackground(source, tintOverMultiGradientReader)).toEqual({
        color: 'rgb(0, 0, 0)',
        image:
          'linear-gradient(rgba(255, 0, 0, 0.5), rgba(255, 0, 0, 0.5)), linear-gradient(black, black), linear-gradient(blue, green)',
        position: '0% 0%, 0% 0%, 0% 0%',
        repeat: 'repeat, no-repeat, no-repeat',
        size: 'auto, auto, auto',
      });

      // An inner unparseable translucent color does not leak into background-color beneath an outer gradient.
      const unparseableAboveTintOverGradientReader = makeReader(
        new Map([
          [source, { 'background-color': 'transparent', 'background-image': 'none' }],
          [innerLayer, { 'background-color': 'oklch(0.7 0.1 200 / 0.4)', 'background-image': 'none' }],
          [outerLayer, { 'background-color': 'rgba(255, 0, 0, 0.5)', 'background-image': 'none' }],
          [
            canvas,
            {
              'background-color': 'transparent',
              'background-image': 'linear-gradient(black, black)',
            },
          ],
        ]),
      );
      expect(
        resolveMermaidInheritedBackground(source, unparseableAboveTintOverGradientReader),
      ).toEqual({
        image: 'linear-gradient(rgba(255, 0, 0, 0.5), rgba(255, 0, 0, 0.5)), linear-gradient(black, black)',
        position: '0% 0%, 0% 0%',
        repeat: 'repeat, repeat',
        size: 'auto, auto',
      });

      // 2. Opaque red inner inside opacity: 0.5 outer over white canvas -> pink rgb(255, 128, 128).
      const opaqueInnerUnderHalfOpacityReader = makeReader(
        new Map([
          [source, { 'background-color': 'transparent', 'background-image': 'none' }],
          [innerLayer, { 'background-color': 'rgb(255, 0, 0)', 'background-image': 'none', opacity: '1' }],
          [outerLayer, { 'background-color': 'transparent', 'background-image': 'none', opacity: '0.5' }],
          [canvas, { 'background-color': 'rgb(255, 255, 255)', 'background-image': 'none', opacity: '1' }],
        ]),
      );
      expect(resolveMermaidInheritedBackground(source, opaqueInnerUnderHalfOpacityReader)).toEqual({
        color: 'rgb(255, 128, 128)',
      });

      // 3. Inner rgba(255, 255, 255, 0.5) inside outer rgb(255, 0, 0) + opacity: 0.5 over black -> rgb(128, 64, 64).
      const nestedGroupOpacityReader = makeReader(
        new Map([
          [source, { 'background-color': 'transparent', 'background-image': 'none' }],
          [innerLayer, { 'background-color': 'rgba(255, 255, 255, 0.5)', 'background-image': 'none', opacity: '1' }],
          [outerLayer, { 'background-color': 'rgb(255, 0, 0)', 'background-image': 'none', opacity: '0.5' }],
          [canvas, { 'background-color': 'rgb(0, 0, 0)', 'background-image': 'none', opacity: '1' }],
        ]),
      );
      expect(resolveMermaidInheritedBackground(source, nestedGroupOpacityReader)).toEqual({
        color: 'rgb(128, 64, 64)',
      });

      // 4. Inner linear-gradient inside outer opacity: 0.5 is cleared rather than promoted at opacity 1.
      const innerGradientDimmedTransparentCanvasReader = makeReader(
        new Map([
          [source, { 'background-color': 'transparent', 'background-image': 'none' }],
          [
            innerLayer,
            {
              'background-color': 'transparent',
              'background-image': 'linear-gradient(90deg, red, blue)',
              opacity: '1',
            },
          ],
          [outerLayer, { 'background-color': 'transparent', 'background-image': 'none', opacity: '0.5' }],
          [canvas, { 'background-color': 'transparent', 'background-image': 'none', opacity: '1' }],
        ]),
      );
      expect(
        resolveMermaidInheritedBackground(source, innerGradientDimmedTransparentCanvasReader),
      ).toBeNull();

      const innerGradientDimmedOpaqueCanvasReader = makeReader(
        new Map([
          [source, { 'background-color': 'transparent', 'background-image': 'none' }],
          [
            innerLayer,
            {
              'background-color': 'transparent',
              'background-image': 'linear-gradient(90deg, red, blue)',
              opacity: '1',
            },
          ],
          [outerLayer, { 'background-color': 'transparent', 'background-image': 'none', opacity: '0.5' }],
          [canvas, { 'background-color': 'rgb(0, 0, 0)', 'background-image': 'none', opacity: '1' }],
        ]),
      );
      expect(resolveMermaidInheritedBackground(source, innerGradientDimmedOpaqueCanvasReader)).toEqual({
        color: 'rgb(0, 0, 0)',
      });

      // 5. Outer opacity: 0 clears already-collected inner color, gradient, and blocked url() layers.
      const outerZeroOpacityOverCanvasReader = makeReader(
        new Map([
          [source, { 'background-color': 'transparent', 'background-image': 'none' }],
          [
            innerLayer,
            {
              'background-color': 'rgb(255, 0, 0)',
              'background-image': 'url("https://blocked.example/hidden.png")',
              opacity: '1',
            },
          ],
          [outerLayer, { 'background-color': 'rgb(0, 255, 0)', 'background-image': 'none', opacity: '0' }],
          [
            canvas,
            {
              'background-color': 'rgb(30, 30, 46)',
              'background-image': 'linear-gradient(90deg, rgb(30, 30, 46), rgb(45, 45, 65))',
              opacity: '1',
            },
          ],
        ]),
      );
      expect(resolveMermaidInheritedBackground(source, outerZeroOpacityOverCanvasReader)).toEqual({
        color: 'rgb(30, 30, 46)',
        image: 'linear-gradient(90deg, rgb(30, 30, 46), rgb(45, 45, 65))',
      });

      const outerZeroOpacityTransparentCanvasReader = makeReader(
        new Map([
          [source, { 'background-color': 'transparent', 'background-image': 'none' }],
          [innerLayer, { 'background-color': 'rgb(255, 0, 0)', 'background-image': 'linear-gradient(red, blue)' }],
          [outerLayer, { 'background-color': 'rgb(0, 255, 0)', 'background-image': 'none', opacity: '0' }],
          [canvas, { 'background-color': 'transparent', 'background-image': 'none' }],
        ]),
      );
      expect(
        resolveMermaidInheritedBackground(source, outerZeroOpacityTransparentCanvasReader),
      ).toBeNull();
    });

    it('preserves a direct SVG own background even with border-radius and guards direct SVG by opacity > 0', () => {
      const canvas = document.createElement('div');
      canvas.className = 'easymde-immersive-preview-canvas';
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      canvas.append(svg);
      document.body.append(canvas);

      const roundedSvgReader = makeReader(
        new Map<Element, Readonly<Record<string, string>>>([
          [
            svg,
            {
              'background-color': 'rgb(245, 247, 250)',
              'background-image': 'none',
              'border-radius': '12px',
              opacity: '1',
            },
          ],
          [canvas, { 'background-color': 'rgb(30, 30, 46)', 'background-image': 'none' }],
        ]),
      );
      expect(
        resolveMermaidInheritedBackground(svg, roundedSvgReader, {
          directSvgCapture: true,
        }),
      ).toEqual({
        color: 'rgb(245, 247, 250)',
      });

      const invisibleSvgReader = makeReader(
        new Map<Element, Readonly<Record<string, string>>>([
          [
            svg,
            {
              'background-color': 'rgb(245, 247, 250)',
              'background-image': 'none',
              opacity: '0',
            },
          ],
          [canvas, { 'background-color': 'rgb(30, 30, 46)', 'background-image': 'none' }],
        ]),
      );
      expect(
        resolveMermaidInheritedBackground(svg, invisibleSvgReader, {
          directSvgCapture: true,
        }),
      ).toEqual({
        color: 'rgb(30, 30, 46)',
      });

      // Translucent direct <svg> background-color composites over the dark ancestor canvas.
      const translucentSvgReader = makeReader(
        new Map<Element, Readonly<Record<string, string>>>([
          [
            svg,
            {
              'background-color': 'rgba(255, 255, 255, 0.08)',
              'background-image': 'none',
              opacity: '1',
            },
          ],
          [canvas, { 'background-color': 'rgb(30, 30, 46)', 'background-image': 'none' }],
        ]),
      );
      expect(
        resolveMermaidInheritedBackground(svg, translucentSvgReader, {
          directSvgCapture: true,
        }),
      ).toEqual({
        color: 'rgb(48, 48, 63)',
      });

      // Reduced-opacity direct <svg> never promotes its background-image gradient at opacity 1.
      const reducedOpacitySvgGradientReader = makeReader(
        new Map<Element, Readonly<Record<string, string>>>([
          [
            svg,
            {
              'background-color': 'transparent',
              'background-image': 'linear-gradient(90deg, red, blue)',
              opacity: '0.5',
            },
          ],
          [canvas, { 'background-color': 'rgb(30, 30, 46)', 'background-image': 'none' }],
        ]),
      );
      expect(
        resolveMermaidInheritedBackground(svg, reducedOpacitySvgGradientReader, {
          directSvgCapture: true,
        }),
      ).toEqual({
        color: 'rgb(30, 30, 46)',
      });

      const reducedOpacitySvgGradientOnlyReader = makeReader(
        new Map<Element, Readonly<Record<string, string>>>([
          [
            svg,
            {
              'background-color': 'transparent',
              'background-image': 'linear-gradient(90deg, red, blue)',
              opacity: '0.5',
            },
          ],
          [canvas, { 'background-color': 'transparent', 'background-image': 'none' }],
        ]),
      );
      expect(
        resolveMermaidInheritedBackground(svg, reducedOpacitySvgGradientOnlyReader, {
          directSvgCapture: true,
        }),
      ).toBeNull();
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

      const reducedOpacityCardReader = makeReader(
        new Map<Element, Readonly<Record<string, string>>>([
          [svg, { 'background-color': 'rgba(0, 0, 0, 0)', 'background-image': 'none' }],
          [
            wrapper,
            {
              'background-color': 'rgb(255, 255, 255)',
              'background-image': 'none',
              opacity: '0.5',
            },
          ],
          [canvas, { 'background-color': 'rgb(0, 0, 0)', 'background-image': 'none' }],
        ]),
      );
      expect(
        resolveMermaidInheritedBackground(svg, reducedOpacityCardReader, {
          directSvgCapture: true,
          retainedParentWrapper: true,
        }),
      ).toBeNull();

      // Translucent direct <svg> inside a retained translucent parent keeps its own tint without double-compositing the wrapper.
      const translucentSvgInTranslucentWrapperReader = makeReader(
        new Map<Element, Readonly<Record<string, string>>>([
          [
            svg,
            {
              'background-color': 'rgba(255, 255, 255, 0.08)',
              'background-image': 'none',
              opacity: '1',
            },
          ],
          [
            wrapper,
            {
              'background-color': 'rgba(255, 255, 255, 0.06)',
              'background-image': 'none',
              opacity: '1',
            },
          ],
          [canvas, { 'background-color': 'rgb(30, 30, 46)', 'background-image': 'none' }],
        ]),
      );
      expect(
        resolveMermaidInheritedBackground(svg, translucentSvgInTranslucentWrapperReader, {
          directSvgCapture: true,
          retainedParentWrapper: true,
        }),
      ).toEqual({
        color: 'rgba(255, 255, 255, 0.08)',
      });

      // Transparent retained wrapper with opacity < 1 stops before walking to the dark preview backdrop
      // so the retained wrapper applies opacity once in WeChat HTML without double-attenuating the PNG.
      const transparentHalfOpacityWrapperWithRedSvgReader = makeReader(
        new Map<Element, Readonly<Record<string, string>>>([
          [
            svg,
            {
              'background-color': 'rgb(255, 0, 0)',
              'background-image': 'none',
              opacity: '1',
            },
          ],
          [
            wrapper,
            {
              'background-color': 'transparent',
              'background-image': 'none',
              opacity: '0.5',
            },
          ],
          [canvas, { 'background-color': 'rgb(0, 0, 0)', 'background-image': 'none' }],
        ]),
      );
      expect(
        resolveMermaidInheritedBackground(svg, transparentHalfOpacityWrapperWithRedSvgReader, {
          directSvgCapture: true,
          retainedParentWrapper: true,
        }),
      ).toEqual({
        color: 'rgb(255, 0, 0)',
      });

      const transparentHalfOpacityWrapperWithTransparentSvgReader = makeReader(
        new Map<Element, Readonly<Record<string, string>>>([
          [
            svg,
            {
              'background-color': 'transparent',
              'background-image': 'none',
              opacity: '1',
            },
          ],
          [
            wrapper,
            {
              'background-color': 'transparent',
              'background-image': 'none',
              opacity: '0.5',
            },
          ],
          [canvas, { 'background-color': 'rgb(0, 0, 0)', 'background-image': 'none' }],
        ]),
      );
      expect(
        resolveMermaidInheritedBackground(
          svg,
          transparentHalfOpacityWrapperWithTransparentSvgReader,
          {
            directSvgCapture: true,
            retainedParentWrapper: true,
          },
        ),
      ).toBeNull();

      // Retained wrapper with opacity: 0 also stops cleanly before walking past it into the preview backdrop.
      const zeroOpacityWrapperWithRedSvgReader = makeReader(
        new Map<Element, Readonly<Record<string, string>>>([
          [
            svg,
            {
              'background-color': 'rgb(255, 0, 0)',
              'background-image': 'none',
              opacity: '1',
            },
          ],
          [
            wrapper,
            {
              'background-color': 'transparent',
              'background-image': 'none',
              opacity: '0',
            },
          ],
          [canvas, { 'background-color': 'rgb(0, 0, 0)', 'background-image': 'none' }],
        ]),
      );
      expect(
        resolveMermaidInheritedBackground(svg, zeroOpacityWrapperWithRedSvgReader, {
          directSvgCapture: true,
          retainedParentWrapper: true,
        }),
      ).toEqual({
        color: 'rgb(255, 0, 0)',
      });

      const zeroOpacityWrapperWithTransparentSvgReader = makeReader(
        new Map<Element, Readonly<Record<string, string>>>([
          [
            svg,
            {
              'background-color': 'transparent',
              'background-image': 'none',
              opacity: '1',
            },
          ],
          [
            wrapper,
            {
              'background-color': 'rgb(255, 255, 255)',
              'background-image': 'none',
              opacity: '0',
            },
          ],
          [canvas, { 'background-color': 'rgb(0, 0, 0)', 'background-image': 'none' }],
        ]),
      );
      expect(
        resolveMermaidInheritedBackground(svg, zeroOpacityWrapperWithTransparentSvgReader, {
          directSvgCapture: true,
          retainedParentWrapper: true,
        }),
      ).toBeNull();

      // SVG presentation attribute opacity="0.5" isolates SVG own paint for the rasterizer opacity group
      // and resolves only the ancestor backdrop, while CSS opacity: 1 overrides the presentation attribute.
      svg.setAttribute('opacity', '0.5');
      const attrOpacityReader = makeReader(
        new Map<Element, Readonly<Record<string, string>>>([
          [svg, { 'background-color': 'rgba(255, 0, 0, 0.5)', 'background-image': 'none' }],
          [wrapper, { 'background-color': 'rgb(255, 255, 255)', 'background-image': 'none' }],
          [canvas, { 'background-color': 'rgb(0, 0, 0)', 'background-image': 'none' }],
        ]),
      );
      expect(
        resolveMermaidInheritedBackground(svg, attrOpacityReader, {
          directSvgCapture: true,
          retainedParentWrapper: true,
        }),
      ).toEqual({
        color: 'rgb(255, 255, 255)',
      });

      const cssOverridesAttrOpacityReader = makeReader(
        new Map<Element, Readonly<Record<string, string>>>([
          [
            svg,
            {
              'background-color': 'rgba(255, 0, 0, 0.5)',
              'background-image': 'none',
              opacity: '1',
            },
          ],
          [wrapper, { 'background-color': 'rgb(255, 255, 255)', 'background-image': 'none' }],
          [canvas, { 'background-color': 'rgb(0, 0, 0)', 'background-image': 'none' }],
        ]),
      );
      expect(
        resolveMermaidInheritedBackground(svg, cssOverridesAttrOpacityReader, {
          directSvgCapture: true,
          retainedParentWrapper: true,
        }),
      ).toEqual({
        color: 'rgb(255, 128, 128)',
      });
    });

    it('resolves ancestor-only backdrops for reduced-opacity direct SVGs and bounds retained ancestor walks', () => {
      // 1. Direct <svg style="background-color: blue; opacity: 0.5"> over opaque white ancestor
      // returns pure white (never pre-blends blue into the ancestor backdrop).
      const whiteParent = document.createElement('div');
      whiteParent.className = 'easymde-preview';
      const blueHalfOpacitySvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      whiteParent.append(blueHalfOpacitySvg);
      document.body.append(whiteParent);

      const whiteParentReader = makeReader(
        new Map<Element, Readonly<Record<string, string>>>([
          [
            blueHalfOpacitySvg,
            { 'background-color': 'rgb(0, 0, 255)', 'background-image': 'none', opacity: '0.5' },
          ],
          [whiteParent, { 'background-color': 'rgb(255, 255, 255)', 'background-image': 'none' }],
        ]),
      );
      expect(
        resolveMermaidInheritedBackground(blueHalfOpacitySvg, whiteParentReader, {
          directSvgCapture: true,
        }),
      ).toEqual({
        color: 'rgb(255, 255, 255)',
      });

      // Detached direct <svg> with opacity < 1 and no parentElement returns null.
      const detachedHalfOpacitySvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const detachedReader = makeReader(
        new Map<Element, Readonly<Record<string, string>>>([
          [
            detachedHalfOpacitySvg,
            { 'background-color': 'rgb(0, 0, 255)', 'background-image': 'none', opacity: '0.5' },
          ],
        ]),
      );
      expect(
        resolveMermaidInheritedBackground(detachedHalfOpacitySvg, detachedReader, {
          directSvgCapture: true,
        }),
      ).toBeNull();

      // 2. Direct <svg style="background-color: blue; opacity: 0.5"> inside translucent retained wrapper
      // stops before the translucent wrapper and returns null (zero double alpha / zero pre-blended blue).
      const preview = document.createElement('div');
      preview.className = 'easymde-preview';
      const blockquote = document.createElement('blockquote');
      const wrapper = document.createElement('div');
      wrapper.className = 'easymde-mermaid';
      const nestedSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      wrapper.append(nestedSvg);
      blockquote.append(wrapper);
      preview.append(blockquote);
      document.body.append(preview);

      const translucentWrapperWithHalfSvgReader = makeReader(
        new Map<Element, Readonly<Record<string, string>>>([
          [
            nestedSvg,
            { 'background-color': 'rgb(0, 0, 255)', 'background-image': 'none', opacity: '0.5' },
          ],
          [
            wrapper,
            { 'background-color': 'rgba(255, 255, 255, 0.1)', 'background-image': 'none', opacity: '1' },
          ],
          [blockquote, { 'background-color': 'transparent', 'background-image': 'none', opacity: '1' }],
          [preview, { 'background-color': 'rgb(30, 30, 46)', 'background-image': 'none' }],
        ]),
      );
      expect(
        resolveMermaidInheritedBackground(nestedSvg, translucentWrapperWithHalfSvgReader, {
          directSvgCapture: true,
          retainedParentWrapper: true,
        }),
      ).toBeNull();

      // 3. Track B #3 Counterexample 1: opaque white .easymde-mermaid (opacity: 1) inside
      // <blockquote style="background-color: rgb(0,0,0); opacity: 0.5"> inside dark .easymde-preview
      // stops immediately after the opaque retained wrapper -> pure white, zero double-dimming.
      const opaqueWrapperInDimmedQuoteReader = makeReader(
        new Map<Element, Readonly<Record<string, string>>>([
          [nestedSvg, { 'background-color': 'transparent', 'background-image': 'none', opacity: '1' }],
          [wrapper, { 'background-color': 'rgb(255, 255, 255)', 'background-image': 'none', opacity: '1' }],
          [blockquote, { 'background-color': 'rgb(0, 0, 0)', 'background-image': 'none', opacity: '0.5' }],
          [preview, { 'background-color': 'rgb(0, 0, 0)', 'background-image': 'none', opacity: '1' }],
        ]),
      );
      expect(
        resolveMermaidInheritedBackground(nestedSvg, opaqueWrapperInDimmedQuoteReader, {
          directSvgCapture: true,
          retainedParentWrapper: true,
        }),
      ).toEqual({
        color: 'rgb(255, 255, 255)',
      });

      // 4. Track B #3 Counterexample 2: transparent .easymde-mermaid inside
      // <blockquote style="background-color: rgba(255,0,0,0.4)"> inside transparent/opaque .easymde-preview
      // stops before folding blockquote -> null, zero double-compositing.
      const transparentWrapperInTranslucentQuoteReader = makeReader(
        new Map<Element, Readonly<Record<string, string>>>([
          [nestedSvg, { 'background-color': 'transparent', 'background-image': 'none', opacity: '1' }],
          [wrapper, { 'background-color': 'transparent', 'background-image': 'none', opacity: '1' }],
          [
            blockquote,
            { 'background-color': 'rgba(255, 0, 0, 0.4)', 'background-image': 'none', opacity: '1' },
          ],
          [preview, { 'background-color': 'transparent', 'background-image': 'none', opacity: '1' }],
        ]),
      );
      expect(
        resolveMermaidInheritedBackground(nestedSvg, transparentWrapperInTranslucentQuoteReader, {
          directSvgCapture: true,
          retainedParentWrapper: true,
        }),
      ).toBeNull();

      // 5. Track B #3 Counterexample 3: .easymde-mermaid with background-image: linear-gradient(...)
      // and retainedParentWrapper: true stops before folding the wrapper gradient (zero double gradient).
      const gradientWrapperReader = makeReader(
        new Map<Element, Readonly<Record<string, string>>>([
          [nestedSvg, { 'background-color': 'transparent', 'background-image': 'none', opacity: '1' }],
          [
            wrapper,
            {
              'background-color': 'rgb(255, 255, 255)',
              'background-image': 'linear-gradient(90deg, red, blue)',
              opacity: '1',
            },
          ],
          [blockquote, { 'background-color': 'transparent', 'background-image': 'none', opacity: '1' }],
          [preview, { 'background-color': 'rgb(30, 30, 46)', 'background-image': 'none', opacity: '1' }],
        ]),
      );
      expect(
        resolveMermaidInheritedBackground(nestedSvg, gradientWrapperReader, {
          directSvgCapture: true,
          retainedParentWrapper: true,
        }),
      ).toBeNull();

      const gradientWrapperWithOwnSvgBgReader = makeReader(
        new Map<Element, Readonly<Record<string, string>>>([
          [
            nestedSvg,
            { 'background-color': 'rgba(255, 255, 255, 0.2)', 'background-image': 'none', opacity: '1' },
          ],
          [
            wrapper,
            {
              'background-color': 'transparent',
              'background-image': 'linear-gradient(90deg, red, blue)',
              opacity: '1',
            },
          ],
          [blockquote, { 'background-color': 'transparent', 'background-image': 'none', opacity: '1' }],
          [preview, { 'background-color': 'rgb(30, 30, 46)', 'background-image': 'none', opacity: '1' }],
        ]),
      );
      expect(
        resolveMermaidInheritedBackground(nestedSvg, gradientWrapperWithOwnSvgBgReader, {
          directSvgCapture: true,
          retainedParentWrapper: true,
        }),
      ).toEqual({
        color: 'rgba(255, 255, 255, 0.2)',
      });

      // 6. Track B #3 Counterexample 4: transparent .easymde-mermaid and transparent blockquote
      // inside dark .easymde-preview legitimately resolve the preview backdrop.
      const transparentRetainedAncestorsInDarkPreviewReader = makeReader(
        new Map<Element, Readonly<Record<string, string>>>([
          [nestedSvg, { 'background-color': 'transparent', 'background-image': 'none', opacity: '1' }],
          [wrapper, { 'background-color': 'transparent', 'background-image': 'none', opacity: '1' }],
          [blockquote, { 'background-color': 'transparent', 'background-image': 'none', opacity: '1' }],
          [preview, { 'background-color': 'rgb(30, 30, 46)', 'background-image': 'none', opacity: '1' }],
        ]),
      );
      expect(
        resolveMermaidInheritedBackground(nestedSvg, transparentRetainedAncestorsInDarkPreviewReader, {
          directSvgCapture: true,
          retainedParentWrapper: true,
        }),
      ).toEqual({
        color: 'rgb(30, 30, 46)',
      });

      // 7. Explicit retainedBoundary ends retained-wrapper treatment even on a plain custom container.
      const customBoundary = document.createElement('div');
      const customWrapper = document.createElement('div');
      customWrapper.className = 'easymde-mermaid';
      const customSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      customWrapper.append(customSvg);
      customBoundary.append(customWrapper);
      document.body.append(customBoundary);

      const customBoundaryReader = makeReader(
        new Map<Element, Readonly<Record<string, string>>>([
          [customSvg, { 'background-color': 'transparent', 'background-image': 'none', opacity: '1' }],
          [customWrapper, { 'background-color': 'transparent', 'background-image': 'none', opacity: '1' }],
          [
            customBoundary,
            {
              'background-color': 'rgb(20, 24, 32)',
              'background-image': 'linear-gradient(180deg, rgba(255, 255, 255, 0.05), transparent)',
              opacity: '1',
            },
          ],
        ]),
      );
      expect(
        resolveMermaidInheritedBackground(customSvg, customBoundaryReader, {
          directSvgCapture: true,
          retainedBoundary: customBoundary,
          retainedParentWrapper: true,
        }),
      ).toEqual({
        color: 'rgb(20, 24, 32)',
        image: 'linear-gradient(180deg, rgba(255, 255, 255, 0.05), transparent)',
      });

      // 8. Track B #4: Explicit retainedBoundary does NOT prematurely flip inRetainedSubtree
      // on a nested <article> strictly inside retainedBoundary.
      const outerPreview = document.createElement('div');
      outerPreview.className = 'easymde-preview';
      const innerArticle = document.createElement('article');
      const innerMermaid = document.createElement('div');
      innerMermaid.className = 'easymde-mermaid';
      const innerArticleSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      innerMermaid.append(innerArticleSvg);
      innerArticle.append(innerMermaid);
      outerPreview.append(innerArticle);
      document.body.append(outerPreview);

      const translucentInnerArticleReader = makeReader(
        new Map<Element, Readonly<Record<string, string>>>([
          [innerArticleSvg, { 'background-color': 'transparent', 'background-image': 'none', opacity: '1' }],
          [innerMermaid, { 'background-color': 'transparent', 'background-image': 'none', opacity: '1' }],
          [
            innerArticle,
            { 'background-color': 'rgba(255, 0, 0, 0.4)', 'background-image': 'none', opacity: '1' },
          ],
          [outerPreview, { 'background-color': 'rgb(255, 255, 255)', 'background-image': 'none', opacity: '1' }],
        ]),
      );
      expect(
        resolveMermaidInheritedBackground(innerArticleSvg, translucentInnerArticleReader, {
          directSvgCapture: true,
          retainedBoundary: outerPreview,
          retainedParentWrapper: true,
        }),
      ).toBeNull();

      const gradientInnerArticleReader = makeReader(
        new Map<Element, Readonly<Record<string, string>>>([
          [innerArticleSvg, { 'background-color': 'transparent', 'background-image': 'none', opacity: '1' }],
          [innerMermaid, { 'background-color': 'transparent', 'background-image': 'none', opacity: '1' }],
          [
            innerArticle,
            {
              'background-color': 'transparent',
              'background-image': 'linear-gradient(90deg, red, blue)',
              opacity: '1',
            },
          ],
          [outerPreview, { 'background-color': 'rgb(255, 255, 255)', 'background-image': 'none', opacity: '1' }],
        ]),
      );
      expect(
        resolveMermaidInheritedBackground(innerArticleSvg, gradientInnerArticleReader, {
          directSvgCapture: true,
          retainedBoundary: outerPreview,
          retainedParentWrapper: true,
        }),
      ).toBeNull();

      const transparentInnerArticleReader = makeReader(
        new Map<Element, Readonly<Record<string, string>>>([
          [innerArticleSvg, { 'background-color': 'transparent', 'background-image': 'none', opacity: '1' }],
          [innerMermaid, { 'background-color': 'transparent', 'background-image': 'none', opacity: '1' }],
          [innerArticle, { 'background-color': 'transparent', 'background-image': 'none', opacity: '1' }],
          [outerPreview, { 'background-color': 'rgb(30, 30, 46)', 'background-image': 'none', opacity: '1' }],
        ]),
      );
      expect(
        resolveMermaidInheritedBackground(innerArticleSvg, transparentInnerArticleReader, {
          directSvgCapture: true,
          retainedBoundary: outerPreview,
          retainedParentWrapper: true,
        }),
      ).toEqual({
        color: 'rgb(30, 30, 46)',
      });
    });

    it('returns ancestor-only backdrop for rounded direct SVG with visible non-opaque background-color', () => {
      const whiteCanvas = document.createElement('div');
      whiteCanvas.className = 'easymde-immersive-preview-canvas';
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      whiteCanvas.append(svg);
      document.body.append(whiteCanvas);

      // Rounded translucent direct <svg> returns pure ancestor backdrop (not square folded pink).
      const roundedTranslucentReader = makeReader(
        new Map<Element, Readonly<Record<string, string>>>([
          [
            svg,
            {
              'background-color': 'rgba(255, 0, 0, 0.5)',
              'background-image': 'none',
              'border-radius': '12px',
              opacity: '1',
            },
          ],
          [whiteCanvas, { 'background-color': 'rgb(255, 255, 255)', 'background-image': 'none' }],
        ]),
      );
      expect(
        resolveMermaidInheritedBackground(svg, roundedTranslucentReader, {
          directSvgCapture: true,
        }),
      ).toEqual({
        color: 'rgb(255, 255, 255)',
      });

      // Over transparent ancestor, rounded translucent direct <svg> returns null (own fill is painted by rasterizer <path>).
      const roundedTranslucentOnTransparentReader = makeReader(
        new Map<Element, Readonly<Record<string, string>>>([
          [
            svg,
            {
              'background-color': 'rgba(255, 0, 0, 0.5)',
              'background-image': 'none',
              'border-radius': '12px',
              opacity: '1',
            },
          ],
          [whiteCanvas, { 'background-color': 'transparent', 'background-image': 'none' }],
        ]),
      );
      expect(
        resolveMermaidInheritedBackground(svg, roundedTranslucentOnTransparentReader, {
          directSvgCapture: true,
        }),
      ).toBeNull();

      // Opaque control with border-radius still folds its own opaque background-color.
      const roundedOpaqueReader = makeReader(
        new Map<Element, Readonly<Record<string, string>>>([
          [
            svg,
            {
              'background-color': 'rgb(255, 0, 0)',
              'background-image': 'none',
              'border-radius': '12px',
              opacity: '1',
            },
          ],
          [whiteCanvas, { 'background-color': 'rgb(255, 255, 255)', 'background-image': 'none' }],
        ]),
      );
      expect(
        resolveMermaidInheritedBackground(svg, roundedOpaqueReader, {
          directSvgCapture: true,
        }),
      ).toEqual({
        color: 'rgb(255, 0, 0)',
      });

      // Rounded translucent direct <svg> with safe background-image returns ancestor-only backdrop
      // so <foreignObject> renders the rounded translucent color + gradient once without double-compositing.
      const roundedTranslucentWithGradientReader = makeReader(
        new Map<Element, Readonly<Record<string, string>>>([
          [
            svg,
            {
              'background-color': 'rgba(255, 0, 0, 0.5)',
              'background-image': 'linear-gradient(90deg, rgba(0, 0, 255, 0.2), transparent)',
              'border-radius': '12px',
              opacity: '1',
            },
          ],
          [whiteCanvas, { 'background-color': 'rgb(255, 255, 255)', 'background-image': 'none' }],
        ]),
      );
      expect(
        resolveMermaidInheritedBackground(svg, roundedTranslucentWithGradientReader, {
          directSvgCapture: true,
        }),
      ).toEqual({
        color: 'rgb(255, 255, 255)',
      });

      // Rounded transparent direct <svg> with safe background-image returns ancestor-only backdrop
      // so <foreignObject> renders the rounded gradient once over the square canvas.
      const roundedTransparentWithGradientReader = makeReader(
        new Map<Element, Readonly<Record<string, string>>>([
          [
            svg,
            {
              'background-color': 'transparent',
              'background-image': 'linear-gradient(90deg, rgba(0, 0, 255, 0.4), transparent)',
              'border-radius': '12px',
              opacity: '1',
            },
          ],
          [whiteCanvas, { 'background-color': 'rgb(255, 255, 255)', 'background-image': 'none' }],
        ]),
      );
      expect(
        resolveMermaidInheritedBackground(svg, roundedTransparentWithGradientReader, {
          directSvgCapture: true,
        }),
      ).toEqual({
        color: 'rgb(255, 255, 255)',
      });

      // Rounded translucent direct <svg> with blocked url(...) still isolates its translucent fill
      // and blocks ancestor gradients, matching square direct <svg> behavior.
      const roundedTranslucentWithBlockedUrlReader = makeReader(
        new Map<Element, Readonly<Record<string, string>>>([
          [
            svg,
            {
              'background-color': 'rgba(255, 0, 0, 0.5)',
              'background-image': 'url("https://evil.example/bg.png")',
              'border-radius': '12px',
              opacity: '1',
            },
          ],
          [
            whiteCanvas,
            {
              'background-color': 'rgb(255, 255, 255)',
              'background-image': 'linear-gradient(green, blue)',
            },
          ],
        ]),
      );
      expect(
        resolveMermaidInheritedBackground(svg, roundedTranslucentWithBlockedUrlReader, {
          directSvgCapture: true,
        }),
      ).toEqual({
        color: 'rgb(255, 255, 255)',
      });

      // Reduced-opacity direct <svg> carrying a blocked url(...) also blocks ancestor gradients.
      const reducedOpacityWithBlockedUrlReader = makeReader(
        new Map<Element, Readonly<Record<string, string>>>([
          [
            svg,
            {
              'background-color': 'rgba(255, 0, 0, 0.5)',
              'background-image': 'url("https://evil.example/bg.png")',
              'border-radius': '0px',
              opacity: '0.5',
            },
          ],
          [
            whiteCanvas,
            {
              'background-color': 'rgb(255, 255, 255)',
              'background-image': 'linear-gradient(green, blue)',
            },
          ],
        ]),
      );
      expect(
        resolveMermaidInheritedBackground(svg, reducedOpacityWithBlockedUrlReader, {
          directSvgCapture: true,
        }),
      ).toEqual({
        color: 'rgb(255, 255, 255)',
      });

      // Invisible direct <svg> (opacity: 0) does not encounter its blocked url(...), preserving ancestor gradient.
      const zeroOpacityWithBlockedUrlReader = makeReader(
        new Map<Element, Readonly<Record<string, string>>>([
          [
            svg,
            {
              'background-color': 'rgba(255, 0, 0, 0.5)',
              'background-image': 'url("https://evil.example/bg.png")',
              'border-radius': '12px',
              opacity: '0',
            },
          ],
          [
            whiteCanvas,
            {
              'background-color': 'rgb(255, 255, 255)',
              'background-image': 'linear-gradient(green, blue)',
            },
          ],
        ]),
      );
      expect(
        resolveMermaidInheritedBackground(svg, zeroOpacityWithBlockedUrlReader, {
          directSvgCapture: true,
        }),
      ).toEqual({
        color: 'rgb(255, 255, 255)',
        image: 'linear-gradient(green, blue)',
      });

      // Rounded opaque direct <svg> with safe background-image still folds its own opaque color + gradient.
      const roundedOpaqueWithGradientReader = makeReader(
        new Map<Element, Readonly<Record<string, string>>>([
          [
            svg,
            {
              'background-color': 'rgb(255, 0, 0)',
              'background-image': 'linear-gradient(90deg, rgba(0, 0, 255, 0.2), transparent)',
              'border-radius': '12px',
              opacity: '1',
            },
          ],
          [whiteCanvas, { 'background-color': 'rgb(255, 255, 255)', 'background-image': 'none' }],
        ]),
      );
      expect(
        resolveMermaidInheritedBackground(svg, roundedOpaqueWithGradientReader, {
          directSvgCapture: true,
        }),
      ).toEqual({
        color: 'rgb(255, 0, 0)',
        image: 'linear-gradient(90deg, rgba(0, 0, 255, 0.2), transparent)',
      });
    });

    it('propagates blockedImageEncountered from source for directSvgCapture: false when opacity > 0 and leaves opacity: 0 unblocked', () => {
      const canvas = document.createElement('div');
      canvas.className = 'easymde-immersive-preview-canvas';
      const source = document.createElement('div');
      source.className = 'easymde-mermaid';
      canvas.append(source);
      document.body.append(canvas);

      try {
        for (const visibleOpacity of ['1', '0.5'] as const) {
          const blockedReader = makeReader(
            new Map<Element, Readonly<Record<string, string>>>([
              [
                source,
                {
                  'background-color': 'rgba(255, 0, 0, 0.5)',
                  'background-image': 'url("https://evil.example/bg.png")',
                  opacity: visibleOpacity,
                },
              ],
              [
                canvas,
                {
                  'background-color': 'rgb(255, 255, 255)',
                  'background-image': 'linear-gradient(green, blue)',
                },
              ],
            ]),
          );
          expect(
            resolveMermaidInheritedBackground(source, blockedReader, {
              directSvgCapture: false,
            }),
            `directSvgCapture: false opacity=${visibleOpacity}`,
          ).toEqual({
            color: 'rgb(255, 255, 255)',
          });
        }

        const invisibleReader = makeReader(
          new Map<Element, Readonly<Record<string, string>>>([
            [
              source,
              {
                'background-color': 'rgba(255, 0, 0, 0.5)',
                'background-image': 'url("https://evil.example/bg.png")',
                opacity: '0',
              },
            ],
            [
              canvas,
              {
                'background-color': 'rgb(255, 255, 255)',
                'background-image': 'linear-gradient(green, blue)',
              },
            ],
          ]),
        );
        expect(
          resolveMermaidInheritedBackground(source, invisibleReader, {
            directSvgCapture: false,
          }),
        ).toEqual({
          color: 'rgb(255, 255, 255)',
          image: 'linear-gradient(green, blue)',
        });
      } finally {
        canvas.remove();
      }
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

    it('rejects CSS-escaped u\\72l() and cross-fade() images while treating multi-layer none, none as empty', () => {
      const canvas = document.createElement('div');
      canvas.className = 'easymde-immersive-preview-canvas';
      const wrapper = document.createElement('div');
      const source = document.createElement('div');
      source.className = 'easymde-mermaid';
      wrapper.append(source);
      canvas.append(wrapper);
      document.body.append(canvas);

      for (const unsafeImage of [
        'u\\72l(https://evil.example/bg.png)',
        '\\75rl(https://evil.example/bg.png)',
        'cross-fade("https://evil.example/bg.png", linear-gradient(red, blue))',
        '-webkit-cross-fade(url(x), url(y), 50%)',
      ]) {
        const reader = makeReader(
          new Map<Element, Readonly<Record<string, string>>>([
            [source, { 'background-color': 'rgba(0, 0, 0, 0)', 'background-image': 'none' }],
            [
              wrapper,
              {
                'background-color': 'rgba(0, 0, 0, 0)',
                'background-image': unsafeImage,
              },
            ],
            [
              canvas,
              {
                'background-color': 'rgb(30, 30, 46)',
                'background-image': 'linear-gradient(90deg, red, blue)',
              },
            ],
          ]),
        );
        expect(resolveMermaidInheritedBackground(source, reader), unsafeImage).toEqual({
          color: 'rgb(30, 30, 46)',
        });
      }

      // Multi-layer `none, none` does not block outer gradients or emit `image: 'none, none'`.
      const multiNoneReader = makeReader(
        new Map<Element, Readonly<Record<string, string>>>([
          [source, { 'background-color': 'rgba(0, 0, 0, 0)', 'background-image': 'none, none' }],
          [wrapper, { 'background-color': 'rgba(0, 0, 0, 0)', 'background-image': 'none, none' }],
          [
            canvas,
            {
              'background-color': 'rgb(30, 30, 46)',
              'background-image': 'linear-gradient(90deg, rgb(30, 30, 46), rgb(45, 45, 65))',
            },
          ],
        ]),
      );
      expect(resolveMermaidInheritedBackground(source, multiNoneReader)).toEqual({
        color: 'rgb(30, 30, 46)',
        image: 'linear-gradient(90deg, rgb(30, 30, 46), rgb(45, 45, 65))',
      });
    });
  });

  describe('parseCssSolidColor', () => {
    it('parses rgb/rgba, hex, hsl/hsla, transparent, and named colors into RGBA channels', () => {
      expect(parseCssSolidColor('transparent')).toEqual({ a: 0, b: 0, g: 0, r: 0 });
      expect(parseCssSolidColor('rgb(10, 20, 30)')).toEqual({ a: 1, b: 30, g: 20, r: 10 });
      expect(parseCssSolidColor('rgba(255, 255, 255, 0.5)')).toEqual({
        a: 0.5,
        b: 255,
        g: 255,
        r: 255,
      });
      expect(parseCssSolidColor('rgb(10 20 30 / 50%)')).toEqual({ a: 0.5, b: 30, g: 20, r: 10 });
      expect(parseCssSolidColor('rgb(100%, 50%, 0%)')).toEqual({ a: 1, b: 0, g: 127.5, r: 255 });
      expect(parseCssSolidColor('#fff')).toEqual({ a: 1, b: 255, g: 255, r: 255 });
      expect(parseCssSolidColor('#0008')).toEqual({ a: 8 / 15, b: 0, g: 0, r: 0 });
      expect(parseCssSolidColor('#1e1e2e')).toEqual({ a: 1, b: 46, g: 30, r: 30 });
      expect(parseCssSolidColor('#11223380')).toEqual({ a: 128 / 255, b: 51, g: 34, r: 17 });
      expect(parseCssSolidColor('white')).toEqual({ a: 1, b: 255, g: 255, r: 255 });
      expect(parseCssSolidColor('black')).toEqual({ a: 1, b: 0, g: 0, r: 0 });
      expect(parseCssSolidColor('rebeccapurple')).toEqual({ a: 1, b: 153, g: 51, r: 102 });
      expect(parseCssSolidColor('hsla(120, 100%, 50%, 0.25)')).toEqual({
        a: 0.25,
        b: 0,
        g: 255,
        r: 0,
      });
      expect(parseCssSolidColor('oklch(0.7 0.1 200 / 0.4)')).toBeNull();
      expect(parseCssSolidColor('color-mix(in srgb, red 50%, blue)')).toBeNull();
      expect(parseCssSolidColor('rgb(calc(100 / 2) 20 30)')).toBeNull();
      expect(parseCssSolidColor('currentColor')).toBeNull();
      expect(parseCssSolidColor('none')).toBeNull();
    });
  });

  describe('inlineConnectedMermaidRootPaint', () => {
    it('strips unsafe inline background-image and stale overridden inline background-color before applying computed paint', () => {
      const source = document.createElement('div');
      source.className = 'easymde-mermaid';
      source.setAttribute(
        'style',
        'background-image: url("https://evil.example/a.png"); background-color: red; background-position: 10px 20px; background-size: cover; background-repeat: repeat-x;',
      );
      document.body.append(source);
      const clone = source.cloneNode(true) as HTMLDivElement;

      const reader = makeReader(
        new Map([
          [
            source,
            {
              'background-color': 'rgba(0, 0, 0, 0)',
              'background-image': 'url("https://evil.example/a.png")',
              'background-position': '10px 20px',
              'background-repeat': 'repeat-x',
              'background-size': 'cover',
              'border-radius': '0px',
            },
          ],
        ]),
      );

      inlineConnectedMermaidRootPaint(source, clone, reader);

      expect(clone.style.getPropertyValue('background')).toBe('');
      expect(clone.style.getPropertyValue('background-color')).toBe('');
      expect(clone.style.getPropertyValue('background-image')).toBe('');
      expect(clone.style.getPropertyValue('background-position')).toBe('');
      expect(clone.style.getPropertyValue('background-size')).toBe('');
      expect(clone.style.getPropertyValue('background-repeat')).toBe('');
      expect(clone.getAttribute('style') ?? '').not.toContain('evil.example');
      expect(clone.getAttribute('style') ?? '').not.toContain('red');
    });

    it('strips stale inline border-radius and corner longhands overridden to 0 by stylesheet', () => {
      const source = document.createElement('div');
      source.className = 'easymde-mermaid';
      source.setAttribute(
        'style',
        'border-radius: 16px; border-top-left-radius: 16px; border-top-right-radius: 12px; border-bottom-right-radius: 8px; border-bottom-left-radius: 4px;',
      );
      document.body.append(source);
      const clone = source.cloneNode(true) as HTMLDivElement;

      const reader = makeReader(
        new Map([
          [
            source,
            {
              'background-color': 'rgba(0, 0, 0, 0)',
              'background-image': 'none',
              'border-bottom-left-radius': '0px',
              'border-bottom-right-radius': '0px',
              'border-radius': '0px',
              'border-top-left-radius': '0px',
              'border-top-right-radius': '0px',
            },
          ],
        ]),
      );

      inlineConnectedMermaidRootPaint(source, clone, reader);

      expect(clone.style.getPropertyValue('border-radius')).toBe('');
      expect(clone.style.getPropertyValue('border-top-left-radius')).toBe('');
      expect(clone.style.getPropertyValue('border-top-right-radius')).toBe('');
      expect(clone.style.getPropertyValue('border-bottom-right-radius')).toBe('');
      expect(clone.style.getPropertyValue('border-bottom-left-radius')).toBe('');
      expect(clone.getAttribute('style') ?? '').not.toContain('border-');
    });

    it('skips re-inlining computed background-* while still stripping stale background and preserving border-radius when includeBackground is false', () => {
      const source = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
      source.setAttribute(
        'style',
        'background-color: rgba(255, 0, 0, 0.5); background-image: linear-gradient(red, blue); background-position: 10px 20px; border-radius: 16px; display: block;',
      );
      document.body.append(source);
      const clone = source.cloneNode(true) as SVGSVGElement;

      const reader = makeReader(
        new Map<Element, Readonly<Record<string, string>>>([
          [
            source,
            {
              'background-color': 'rgba(255, 0, 0, 0.5)',
              'background-image': 'linear-gradient(red, blue)',
              'background-position': '10px 20px',
              'border-radius': '12px',
            },
          ],
        ]),
      );

      inlineConnectedMermaidRootPaint(source, clone, reader, { includeBackground: false });

      expect(clone.style.getPropertyValue('background')).toBe('');
      expect(clone.style.getPropertyValue('background-color')).toBe('');
      expect(clone.style.getPropertyValue('background-image')).toBe('');
      expect(clone.style.getPropertyValue('background-position')).toBe('');
      expect(clone.style.getPropertyValue('border-radius')).toBe('12px');
      expect(clone.style.getPropertyValue('display')).toBe('block');
    });
  });

  describe('parseCssOpacity', () => {
    it('parses numbers and percentages clamped to [0, 1] and rejects invalid tokens', () => {
      expect(parseCssOpacity('0')).toBe(0);
      expect(parseCssOpacity('-0.5')).toBe(0);
      expect(parseCssOpacity('0.5')).toBe(0.5);
      expect(parseCssOpacity('50%')).toBe(0.5);
      expect(parseCssOpacity('1')).toBe(1);
      expect(parseCssOpacity('1.5')).toBe(1);
      expect(parseCssOpacity('')).toBeNull();
      expect(parseCssOpacity('auto')).toBeNull();
      expect(parseCssOpacity('50px')).toBeNull();
    });
  });

  describe('applyMermaidBackground', () => {
    it('applies visible color and safe gradient only, skipping null and unsafe url()', () => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
      expect(applyMermaidBackground(svg, null)).toBe(false);
      expect(svg.getAttribute('style')).toBeNull();

      expect(
        applyMermaidBackground(svg, {
          color: 'rgba(0, 0, 0, 0)',
          image: 'url("https://blocked.example/bg.png")',
          position: '0 0',
        }),
      ).toBe(false);
      expect(svg.style.getPropertyValue('background-color')).toBe('');
      expect(svg.style.getPropertyValue('background-image')).toBe('');

      expect(
        applyMermaidBackground(svg, {
          color: 'rgb(30, 30, 46)',
          image: 'linear-gradient(90deg, rgb(30, 30, 46), rgb(45, 45, 65))',
          position: '50% 50%',
          repeat: 'no-repeat',
          size: 'cover',
        }),
      ).toBe(true);
      expect(svg.style.getPropertyValue('background-color')).toBe('rgb(30, 30, 46)');
      expect(svg.style.getPropertyValue('background-image')).toBe(
        'linear-gradient(90deg, rgb(30, 30, 46), rgb(45, 45, 65))',
      );
      expect(svg.style.getPropertyValue('background-position')).toBe('50% 50%');
      expect(svg.style.getPropertyValue('background-repeat')).toBe('no-repeat');
      expect(svg.style.getPropertyValue('background-size')).toBe('cover');
    });

    it('strips stale inline background-* declarations when omitted or when background is null', () => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
      svg.setAttribute(
        'style',
        'background-color: rgba(255, 0, 0, 0.5); background-image: linear-gradient(red, blue); background-position: 10px 20px; background-size: cover; background-repeat: repeat-x; display: block;',
      );

      // Omitting color, position, size, and repeat clears all stale background-* declarations.
      expect(
        applyMermaidBackground(svg, {
          image: 'linear-gradient(rgba(255, 0, 0, 0.5), rgba(255, 0, 0, 0.5)), linear-gradient(black, black)',
        }),
      ).toBe(true);
      expect(svg.style.getPropertyValue('background-color')).toBe('');
      expect(svg.style.getPropertyValue('background-position')).toBe('');
      expect(svg.style.getPropertyValue('background-size')).toBe('');
      expect(svg.style.getPropertyValue('background-repeat')).toBe('');
      expect(svg.style.getPropertyValue('background-image')).toBe(
        'linear-gradient(rgba(255, 0, 0, 0.5), rgba(255, 0, 0, 0.5)), linear-gradient(black, black)',
      );
      expect(svg.style.getPropertyValue('display')).toBe('block');

      // Omitting image clears the previously applied background-image.
      expect(applyMermaidBackground(svg, { color: 'rgb(30, 30, 46)' })).toBe(true);
      expect(svg.style.getPropertyValue('background-color')).toBe('rgb(30, 30, 46)');
      expect(svg.style.getPropertyValue('background-image')).toBe('');
      expect(svg.style.getPropertyValue('display')).toBe('block');

      // Receiving null clears all background-* declarations while keeping non-background styles.
      expect(applyMermaidBackground(svg, null)).toBe(false);
      expect(svg.style.getPropertyValue('background-color')).toBe('');
      expect(svg.style.getPropertyValue('background-image')).toBe('');
      expect(svg.style.getPropertyValue('display')).toBe('block');

      // Receiving null removes an otherwise empty style attribute and leaves unstyled SVGs untouched.
      const backgroundOnlySvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
      backgroundOnlySvg.setAttribute('style', 'background: red no-repeat center/cover;');
      expect(applyMermaidBackground(backgroundOnlySvg, null)).toBe(false);
      expect(backgroundOnlySvg.getAttribute('style')).toBeNull();

      const unstyledSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
      expect(applyMermaidBackground(unstyledSvg, null)).toBe(false);
      expect(unstyledSvg.getAttribute('style')).toBeNull();
    });
  });

  describe('stripMermaidBorderRadius', () => {
    it('strips border-radius shorthand and corner longhands while preserving other inline styles', () => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
      svg.setAttribute(
        'style',
        'background-color: rgb(30, 30, 46); border-radius: 12px; border-top-left-radius: 12px; border-top-right-radius: 8px; border-bottom-right-radius: 6px; border-bottom-left-radius: 4px;',
      );
      stripMermaidBorderRadius(svg);
      expect(svg.style.getPropertyValue('background-color')).toBe('rgb(30, 30, 46)');
      expect(svg.style.getPropertyValue('border-radius')).toBe('');
      expect(svg.style.getPropertyValue('border-top-left-radius')).toBe('');
      expect(svg.style.getPropertyValue('border-top-right-radius')).toBe('');
      expect(svg.style.getPropertyValue('border-bottom-right-radius')).toBe('');
      expect(svg.style.getPropertyValue('border-bottom-left-radius')).toBe('');
      expect(svg.getAttribute('style') ?? '').not.toContain('radius');

      const radiusOnlySvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
      radiusOnlySvg.setAttribute('style', 'border-radius: 12px;');
      stripMermaidBorderRadius(radiusOnlySvg);
      expect(radiusOnlySvg.getAttribute('style')).toBeNull();
    });
  });

  describe('resolveMermaidBorderRadii', () => {
    it('resolves pixel, percentage, elliptical, and corner-override radii and rejects unparseable tokens', () => {
      expect(resolveMermaidBorderRadii(styleDeclaration({ 'border-radius': '0px' }), undefined, 100, 60)).toBeNull();
      expect(resolveMermaidBorderRadii(styleDeclaration({ 'border-radius': '12px' }), undefined, 100, 60)).toEqual([
        [12, 12],
        [12, 12],
        [12, 12],
        [12, 12],
      ]);
      expect(resolveMermaidBorderRadii(styleDeclaration({ 'border-radius': '50%' }), undefined, 100, 50)).toEqual([
        [50, 25],
        [50, 25],
        [50, 25],
        [50, 25],
      ]);
      expect(
        resolveMermaidBorderRadii(
          styleDeclaration({ 'border-radius': '10px 20px / 5px 15px' }),
          undefined,
          100,
          60,
        ),
      ).toEqual([
        [10, 5],
        [20, 15],
        [10, 5],
        [20, 15],
      ]);
      expect(
        resolveMermaidBorderRadii(
          styleDeclaration({ 'border-radius': '12px', 'border-top-left-radius': '4px 8px' }),
          undefined,
          100,
          60,
        ),
      ).toEqual([
        [4, 8],
        [12, 12],
        [12, 12],
        [12, 12],
      ]);
      expect(
        resolveMermaidBorderRadii(
          styleDeclaration({
            'border-bottom-left-radius': '0px',
            'border-bottom-right-radius': '0px',
            'border-radius': '12px',
            'border-top-left-radius': '0px',
            'border-top-right-radius': '0px',
          }),
          undefined,
          100,
          60,
        ),
      ).toEqual([
        [12, 12],
        [12, 12],
        [12, 12],
        [12, 12],
      ]);
      expect(
        resolveMermaidBorderRadii(
          styleDeclaration({
            'border-bottom-left-radius': '12px',
            'border-bottom-right-radius': '12px',
            'border-radius': '12px',
            'border-top-left-radius': '0px',
            'border-top-right-radius': '12px',
          }),
          undefined,
          100,
          60,
        ),
      ).toEqual([
        [0, 0],
        [12, 12],
        [12, 12],
        [12, 12],
      ]);
      expect(
        resolveMermaidBorderRadii(
          styleDeclaration({
            'border-radius': '12px',
            'border-top-left-radius': '0px',
          }),
          undefined,
          100,
          60,
        ),
      ).toEqual([
        [0, 0],
        [12, 12],
        [12, 12],
        [12, 12],
      ]);
      expect(
        resolveMermaidBorderRadii(styleDeclaration({ 'border-radius': '12px / 0px' }), undefined, 100, 60),
      ).toBeNull();
      expect(
        resolveMermaidBorderRadii(styleDeclaration({ 'border-radius': 'calc(10px + 2%)' }), undefined, 100, 60),
      ).toBeNull();
    });
  });

  describe('shared wechat-css-color and wechat-mermaid-policy helpers', () => {
    it('re-exports CSS color primitives identically from wechat-css-color and wechat-mermaid-background', () => {
      expect(parseCssColorAlpha).toBe(directParseCssColorAlpha);
      expect(parseCssSolidColor).toBe(directParseCssSolidColor);
      expect(parseCssOpacity).toBe(directParseCssOpacity);
      expect(compositeSourceOver).toBe(directCompositeSourceOver);
      expect(formatCompositedColor).toBe(directFormatCompositedColor);
      expect(hasVisibleBackgroundColor).toBe(directHasVisibleBackgroundColor);
      expect(isOpaqueBackgroundColor).toBe(directIsOpaqueBackgroundColor);

      const composited = compositeSourceOver(
        { a: 0.5, b: 0, g: 0, r: 255 },
        { a: 1, b: 255, g: 255, r: 255 },
      );
      expect(formatCompositedColor(composited)).toBe('rgb(255, 128, 128)');
    });

    it('unifies px-only and px-or-percent CSS border-radius parsing in wechat-mermaid-policy', () => {
      expect(mermaidCssPixelValue('0')).toBe(0);
      expect(mermaidCssPixelValue('12.5px')).toBe(12.5);
      expect(mermaidCssPixelValue('50%')).toBeNull();
      expect(isZeroMermaidRadiusValue('0px / 0%')).toBe(true);
      expect(isZeroMermaidRadiusValue('calc(10% + 4px)')).toBe(false);

      expect(parseMermaidRadiusAxis('4px 8px')).toEqual([4, 8]);
      expect(parseMermaidRadiusAxis('10% 20%', 200)).toEqual([20, 40]);
      expect(parseMermaidRadiusAxis('10%')).toBeNull();

      expect(parseMermaidRadiusPair('12px')).toEqual({ horizontal: 12, vertical: 12 });
      expect(parseMermaidRadiusPair('10% 25%', { height: 80, kind: 'px-or-percent', width: 200 })).toEqual({
        horizontal: 20,
        vertical: 20,
      });
      expect(parseMermaidRadiusPair('12px / 8px')).toBeNull();

      expect(parseMermaidRadiusShorthand('10px 20px / 5px 15px')).toEqual([
        { horizontal: 10, vertical: 5 },
        { horizontal: 20, vertical: 15 },
        { horizontal: 10, vertical: 5 },
        { horizontal: 20, vertical: 15 },
      ]);
      expect(parseMermaidRadiusShorthand('50%', { height: 50, kind: 'px-or-percent', width: 100 })).toEqual([
        { horizontal: 50, vertical: 25 },
        { horizontal: 50, vertical: 25 },
        { horizontal: 50, vertical: 25 },
        { horizontal: 50, vertical: 25 },
      ]);
      expect(parseMermaidRadiusShorthand('50%')).toBeNull();
      expect(parseMermaidRadiusShorthand('calc(10% + 4px)', { height: 60, kind: 'px-or-percent', width: 100 })).toBeNull();
    });

    it('rejects malformed slash/empty zero-radius values and non-px/percent tokens in px-or-percent mode', () => {
      const pxOrPercentMode = { height: 80, kind: 'px-or-percent', width: 200 } as const;

      expect(isZeroMermaidRadiusValue('/')).toBe(false);
      expect(isZeroMermaidRadiusValue('0px / ')).toBe(false);
      expect(isZeroMermaidRadiusValue(' / 0px')).toBe(false);
      expect(isZeroMermaidRadiusValue('0px / 0px / 0px')).toBe(false);
      expect(isZeroMermaidRadiusValue('0px 0px 0px 0px 0px')).toBe(false);
      expect(isZeroMermaidRadiusValue('0px / 0px')).toBe(true);
      expect(isZeroMermaidRadiusValue('0px 0px 0px 0px / 0px 0px 0px 0px')).toBe(true);

      expect(parseMermaidRadiusPair('10px inherit', pxOrPercentMode)).toBeNull();
      expect(parseMermaidRadiusPair('10px 0rem', pxOrPercentMode)).toBeNull();
      expect(parseMermaidRadiusPair('inherit', pxOrPercentMode)).toBeNull();
      expect(parseMermaidRadiusPair('none', pxOrPercentMode)).toBeNull();
      expect(parseMermaidRadiusShorthand('10px none', pxOrPercentMode)).toBeNull();
      expect(parseMermaidRadiusShorthand('10px 0rem', pxOrPercentMode)).toBeNull();

      expect(parseMermaidRadiusPair('10px 0', pxOrPercentMode)).toEqual({
        horizontal: 10,
        vertical: 0,
      });
      expect(parseMermaidRadiusPair('10px 0%', pxOrPercentMode)).toEqual({
        horizontal: 10,
        vertical: 0,
      });
      expect(parseMermaidRadiusPair('10px 0px', pxOrPercentMode)).toEqual({
        horizontal: 10,
        vertical: 0,
      });
      expect(parseMermaidRadiusPair('.5px 50%', pxOrPercentMode)).toEqual({
        horizontal: 0.5,
        vertical: 40,
      });
    });
  });
});
