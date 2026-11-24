import { describe, expect, it, vi } from 'vitest';

import {
  createMermaidInitializationOptions,
  initializeMermaidRuntime,
  initializedMermaidRuntimes,
  markIntrinsicMermaidLayout,
  MERMAID_LABEL_FONT_FAMILY,
  MERMAID_LABEL_GEOMETRY_CSS,
  type MermaidInitializableRuntime,
  type MermaidInitializationOptions
} from './mermaid-runtime-config';

describe('mermaid-runtime-config', () => {
  it('initializes a Mermaid runtime once with strict security, Gantt width, and root-scoped tracking CSS', () => {
    const initialize = vi.fn<(options: MermaidInitializationOptions) => void>();
    const mermaid: MermaidInitializableRuntime = { initialize };

    initializeMermaidRuntime(mermaid);
    initializeMermaidRuntime(mermaid);

    expect(initialize).toHaveBeenCalledTimes(1);
    const config = initialize.mock.calls[0]?.[0];
    expect(config).toEqual(createMermaidInitializationOptions());
    expect(config).toEqual({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'default',
      fontFamily: MERMAID_LABEL_FONT_FAMILY,
      fontSize: 16,
      flowchart: {
        diagramPadding: 12
      },
      gantt: {
        useMaxWidth: true,
        useWidth: 1200
      },
      themeCSS: MERMAID_LABEL_GEOMETRY_CSS
    });

    const rootRule = config?.themeCSS.match(/&\s*\{[^}]*\}/u)?.[0] ?? '';
    expect(rootRule).toMatch(/letter-spacing:\s*normal;/u);
    expect(rootRule).toMatch(/word-spacing:\s*normal;/u);
    expect(config?.themeCSS.replace(rootRule, '')).not.toMatch(
      /(?:letter|word)-spacing:/u
    );
    expect(initializedMermaidRuntimes.has(mermaid)).toBe(true);
  });

  it('registers the shared WeakSet on globalThis via Symbol.for so separate bundles deduplicate initialization', () => {
    const symbolKey = Symbol.for('easymde.initializedMermaidRuntimes');
    const globalRegistry = (
      globalThis as typeof globalThis & Record<symbol, unknown>
    )[symbolKey];
    expect(globalRegistry).toBe(initializedMermaidRuntimes);
  });

  it('does not cache failed initialization in the shared WeakSet and retries cleanly on the next call', () => {
    const flakyInitialize = vi
      .fn<(options: MermaidInitializationOptions) => void>()
      .mockImplementationOnce(() => {
        throw new Error('init-rejected');
      })
      .mockImplementationOnce(() => undefined);
    const flakyRuntime: MermaidInitializableRuntime = {
      initialize: flakyInitialize
    };

    expect(() => initializeMermaidRuntime(flakyRuntime)).toThrowError(
      'init-rejected'
    );
    expect(initializedMermaidRuntimes.has(flakyRuntime)).toBe(false);
    expect(flakyInitialize).toHaveBeenCalledTimes(1);

    expect(() => initializeMermaidRuntime(flakyRuntime)).not.toThrow();
    expect(initializedMermaidRuntimes.has(flakyRuntime)).toBe(true);
    expect(flakyInitialize).toHaveBeenCalledTimes(2);

    initializeMermaidRuntime(flakyRuntime);
    expect(flakyInitialize).toHaveBeenCalledTimes(2);

    const minimalRuntime: MermaidInitializableRuntime = {};
    expect(() => initializeMermaidRuntime(minimalRuntime)).not.toThrow();
    expect(initializedMermaidRuntimes.has(minimalRuntime)).toBe(true);
  });

  it.each([
    ['gantt', '0 0 1200 268', '1200px'],
    ['sequence', '-40.5 8.25 640.5 268.25', '640.5px'],
    ['timeline', '12.5 -6.75 900.25 320.5', '900.25px']
  ] as const)(
    'stamps intrinsic Mermaid layout attributes and width for %s SVGs',
    (role, viewBox, expectedWidth) => {
      const container = document.createElement('div');
      container.className = 'easymde-mermaid';
      container.innerHTML = `<svg aria-roledescription="${role}" viewBox="${viewBox}"><rect width="10" height="10"></rect></svg>`;

      markIntrinsicMermaidLayout(container);

      const svg = container.querySelector('svg');
      expect(container.dataset.easymdeMermaidLayout).toBe(role);
      expect(svg?.style.width).toBe(expectedWidth);
      expect(svg?.style.height).toBe('auto');
    }
  );

  it('clears stale intrinsic layout markers and fails closed for non-intrinsic or malformed SVGs', () => {
    const container = document.createElement('div');
    container.dataset.easymdeMermaidLayout = 'gantt';
    container.innerHTML =
      '<svg aria-roledescription="flowchart" viewBox="0 0 400 200"><rect></rect></svg>';

    markIntrinsicMermaidLayout(container);

    const svg = container.querySelector('svg');
    expect(container.hasAttribute('data-easymde-mermaid-layout')).toBe(false);
    expect(svg?.style.width).toBe('');
    expect(svg?.style.height).toBe('');

    container.dataset.easymdeMermaidLayout = 'gantt';
    container.innerHTML =
      '<svg aria-roledescription="gantt" viewBox="0 0 0 100"></svg>';
    markIntrinsicMermaidLayout(container);
    expect(container.hasAttribute('data-easymde-mermaid-layout')).toBe(false);

    container.dataset.easymdeMermaidLayout = 'gantt';
    container.innerHTML =
      '<svg aria-roledescription="gantt" viewBox="0 0 1200 268"></svg>'
      + '<svg aria-roledescription="gantt" viewBox="0 0 1200 268"></svg>';
    markIntrinsicMermaidLayout(container);
    expect(container.hasAttribute('data-easymde-mermaid-layout')).toBe(false);
  });
});
