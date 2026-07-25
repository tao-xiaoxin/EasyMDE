import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createBrowserCodeCopyOwner,
  type CodeCopyRuntime
} from './create-browser-code-copy-owner';

const strings = {
  codeCopied: 'Code copied',
  codeCopyFailed: 'Unable to copy code. Try again.',
  copied: 'Copied',
  copyCode: 'Copy code'
};

type RuntimeOptions = Readonly<{
  executeCopy?: () => boolean;
  getSelection?: () => Selection | null;
  writeClipboardText?: ((text: string) => Promise<void> | void) | null;
}>;

function deferred(): Readonly<{
  promise: Promise<void>;
  reject: (error: Error) => void;
  resolve: () => void;
}> {
  let rejectPromise: ((error: Error) => void) | null = null;
  let resolvePromise: (() => void) | null = null;
  const promise = new Promise<void>((resolve, reject) => {
    rejectPromise = reject;
    resolvePromise = resolve;
  });

  return {
    promise,
    reject: (error) => {
      rejectPromise?.(error);
    },
    resolve: () => {
      resolvePromise?.();
    }
  };
}

function fixture(): void {
  document.body.innerHTML = [
    '<button id="before" type="button">Before</button>',
    '<p id="selection">Selected text</p>',
    '<article class="easymde-rendered-content">',
    '<pre class="theme-frame"><code class="language-js hljs">\talpha\n  beta\n</code></pre>',
    '<pre><code class="language-mermaid">graph TD; A--&gt;B;</code></pre>',
    '</article>'
  ].join('');
}

function createRuntime(options: RuntimeOptions = {}): {
  failures: Array<string>;
  owner: ReturnType<typeof createBrowserCodeCopyOwner>;
  runtime: CodeCopyRuntime;
  scrollTo: ReturnType<typeof vi.fn>;
} {
  const failures: Array<string> = [];
  const scrollTo = vi.fn();
  const runtime: CodeCopyRuntime = {
    clearTimeout: (timerId) => window.clearTimeout(timerId),
    document,
    executeCopy: options.executeCopy ?? (() => false),
    getScrollPosition: () => ({ x: 7, y: 11 }),
    getSelection: options.getSelection ?? (() => window.getSelection()),
    reportFailure: (code) => {
      failures.push(code);
    },
    scrollTo,
    setTimeout: (callback, delay) => window.setTimeout(callback, delay),
    writeClipboardText: options.writeClipboardText ?? null
  };

  return { failures, owner: createBrowserCodeCopyOwner(runtime), runtime, scrollTo };
}

function config(): unknown {
  return { features: { codeCopy: true }, strings };
}

async function settle(): Promise<void> {
  for (let iteration = 0; iteration < 10; iteration += 1) {
    await Promise.resolve();
  }
}

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
  window.getSelection()?.removeAllRanges();
});

describe('createBrowserCodeCopyOwner', () => {
  it('adds one exact Lucide control, skips Mermaid, and remains idempotent', () => {
    fixture();
    const { owner } = createRuntime();

    const cleanup = owner.enhance(document, config());
    owner.enhance(document, config());

    const root = document.querySelector<HTMLElement>('.easymde-rendered-content');
    const button = root?.querySelector<HTMLButtonElement>('.easymde-code-copy__button');
    const svg = button?.querySelector('svg');
    expect(root?.querySelectorAll('.easymde-code-copy__button')).toHaveLength(1);
    expect(button?.type).toBe('button');
    expect(button?.getAttribute('aria-label')).toBe('Copy code');
    expect(button?.getAttribute('title')).toBe('Copy code');
    expect(svg?.getAttribute('class')).toBe('lucide lucide-copy');
    expect(svg?.getAttribute('width')).toBe('14');
    expect(svg?.getAttribute('height')).toBe('14');
    expect(svg?.querySelector('rect')?.getAttribute('x')).toBe('8');
    expect(svg?.querySelector('path')?.getAttribute('d')).toBe(
      'M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2'
    );
    expect(root?.querySelector('.language-mermaid')?.parentElement?.children).toHaveLength(1);
    expect(root?.querySelector('[role="status"]')?.getAttribute('aria-live')).toBe('polite');

    cleanup();
    expect(root?.querySelector('.easymde-code-copy__button')).toBeNull();
    expect(root?.classList.contains('easymde-code-copy-enabled')).toBe(false);
  });

  it('copies exact text and resets the reference success state after 1500ms', async () => {
    vi.useFakeTimers();
    fixture();
    const copied: Array<string> = [];
    const { owner } = createRuntime({
      writeClipboardText: async (text) => {
        copied.push(text);
      }
    });
    owner.enhance(document, config());
    const button = document.querySelector<HTMLButtonElement>('.easymde-code-copy__button');

    button?.click();
    await settle();

    expect(copied).toEqual(['\talpha\n  beta\n']);
    expect(button?.classList.contains('is-copied')).toBe(true);
    expect(button?.getAttribute('aria-label')).toBe('Code copied');
    expect(button?.getAttribute('title')).toBe('Copied');
    expect(button?.querySelector('svg')?.getAttribute('class')).toBe('lucide lucide-check');
    expect(document.querySelector('[role="status"]')?.textContent).toBe('Code copied');

    vi.advanceTimersByTime(1499);
    expect(button?.classList.contains('is-copied')).toBe(true);
    vi.advanceTimersByTime(1);
    expect(button?.classList.contains('is-copied')).toBe(false);
    expect(button?.getAttribute('aria-label')).toBe('Copy code');
  });

  it('serializes cross-block writes so the last click remains in the clipboard', async () => {
    fixture();
    const root = document.querySelector<HTMLElement>('.easymde-rendered-content');
    root?.insertAdjacentHTML('beforeend', '<pre><code>second block</code></pre>');
    const firstWrite = deferred();
    const writes: Array<string> = [];
    const { owner } = createRuntime({
      writeClipboardText: (text): Promise<void> | void => {
        writes.push(text);
        if (1 === writes.length) {
          return firstWrite.promise;
        }
        return;
      }
    });
    owner.enhance(document, config());
    const buttons = document.querySelectorAll<HTMLButtonElement>('.easymde-code-copy__button');

    buttons[0]?.click();
    buttons[1]?.click();
    await settle();
    expect(writes).toEqual(['\talpha\n  beta\n']);

    firstWrite.resolve();
    await settle();
    expect(writes).toEqual(['\talpha\n  beta\n', 'second block']);
    expect(buttons[0]?.classList.contains('is-copied')).toBe(false);
    expect(buttons[1]?.classList.contains('is-copied')).toBe(true);
  });

  it('does not run fallback or feedback for an older cross-block rejection', async () => {
    fixture();
    const root = document.querySelector<HTMLElement>('.easymde-rendered-content');
    root?.insertAdjacentHTML('beforeend', '<pre><code>second block</code></pre>');
    const firstWrite = deferred();
    const secondWrite = deferred();
    const executeCopy = vi.fn(() => true);
    let writeCount = 0;
    const { owner } = createRuntime({
      executeCopy,
      writeClipboardText: () => {
        writeCount += 1;
        return 1 === writeCount ? firstWrite.promise : secondWrite.promise;
      }
    });
    owner.enhance(document, config());
    const buttons = document.querySelectorAll<HTMLButtonElement>('.easymde-code-copy__button');

    buttons[0]?.click();
    buttons[1]?.click();
    firstWrite.reject(new Error('older write denied'));
    await settle();
    expect(writeCount).toBe(2);

    secondWrite.resolve();
    await settle();

    expect(executeCopy).not.toHaveBeenCalled();
    expect(buttons[0]?.classList.contains('is-copied')).toBe(false);
    expect(buttons[1]?.classList.contains('is-copied')).toBe(true);
    expect(buttons[0]?.hasAttribute('aria-busy')).toBe(false);
    expect(buttons[1]?.hasAttribute('aria-busy')).toBe(false);
  });

  it('restarts feedback timing without allowing an older timer to clear a newer success', async () => {
    vi.useFakeTimers();
    fixture();
    const { owner } = createRuntime({
      writeClipboardText: async () => {}
    });
    owner.enhance(document, config());
    const button = document.querySelector<HTMLButtonElement>('.easymde-code-copy__button');

    button?.click();
    await settle();
    vi.advanceTimersByTime(1000);
    button?.click();
    await settle();

    vi.advanceTimersByTime(500);
    expect(button?.classList.contains('is-copied')).toBe(true);
    vi.advanceTimersByTime(999);
    expect(button?.classList.contains('is-copied')).toBe(true);
    vi.advanceTimersByTime(1);
    expect(button?.classList.contains('is-copied')).toBe(false);
  });

  it('excludes Mermaid blocks regardless of language-class casing', () => {
    fixture();
    const mermaid = document.querySelector<HTMLElement>('.language-mermaid');
    if (mermaid) mermaid.className = 'language-Mermaid';
    const { owner } = createRuntime();

    owner.enhance(document, config());

    expect(document.querySelectorAll('.easymde-code-copy__button')).toHaveLength(1);
    expect(mermaid?.parentElement?.children).toHaveLength(1);
  });

  it('uses the fallback only after clipboard rejection and restores focus, selection, and scroll', async () => {
    fixture();
    const before = document.querySelector<HTMLButtonElement>('#before');
    const selected = document.querySelector<HTMLElement>('#selection');
    before?.focus();
    const range = document.createRange();
    range.selectNodeContents(selected as HTMLElement);
    const selection = {
      addRange: vi.fn(),
      getRangeAt: vi.fn(() => range),
      rangeCount: 1,
      removeAllRanges: vi.fn()
    } as unknown as Selection;
    const executeCopy = vi.fn(() => true);
    const { owner, scrollTo } = createRuntime({
      executeCopy,
      getSelection: () => selection,
      writeClipboardText: async () => {
        throw new Error('denied');
      }
    });
    owner.enhance(document, config());

    document.querySelector<HTMLButtonElement>('.easymde-code-copy__button')?.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true })
    );
    document.querySelector<HTMLButtonElement>('.easymde-code-copy__button')?.click();
    await settle();

    expect(executeCopy).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(before);
    expect(selection.removeAllRanges).toHaveBeenCalledOnce();
    expect(selection.addRange).toHaveBeenCalledOnce();
    expect(selection.addRange).toHaveBeenCalledWith(expect.any(Range));
    expect(scrollTo).toHaveBeenCalledWith(7, 11);
    expect(document.querySelector('.easymde-code-copy__fallback')).toBeNull();
  });

  it('restores the most recent collapsed selection after fallback copy', async () => {
    fixture();
    const selected = document.querySelector<HTMLElement>('#selection');
    const selectedText = selected?.firstChild;
    if (!selectedText) throw new Error('code-copy-selection-fixture-missing');
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(selectedText);
    selection?.removeAllRanges();
    selection?.addRange(range);
    const { owner } = createRuntime({
      executeCopy: () => true,
      writeClipboardText: async () => {
        throw new Error('denied');
      }
    });
    owner.enhance(document, config());
    document.dispatchEvent(new Event('selectionchange'));

    selection?.collapse(selectedText, 2);
    document.dispatchEvent(new Event('selectionchange'));
    const button = document.querySelector<HTMLButtonElement>('.easymde-code-copy__button');
    button?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

    const focusRange = document.createRange();
    if (!button) throw new Error('code-copy-button-fixture-missing');
    focusRange.selectNodeContents(button);
    focusRange.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(focusRange);
    document.dispatchEvent(new Event('selectionchange'));
    button.click();
    await settle();

    expect(selection?.isCollapsed).toBe(true);
    expect(selection?.anchorNode).toBe(selectedText);
    expect(selection?.anchorOffset).toBe(2);
  });

  it('reports failure without false success when both clipboard paths fail', async () => {
    vi.useFakeTimers();
    fixture();
    const { failures, owner } = createRuntime({
      executeCopy: () => false,
      writeClipboardText: async () => {
        throw new Error('denied');
      }
    });
    owner.enhance(document, config());
    const button = document.querySelector<HTMLButtonElement>('.easymde-code-copy__button');

    button?.click();
    await settle();

    expect(failures).toEqual(['clipboard-write-failed']);
    expect(button?.classList.contains('is-copied')).toBe(false);
    expect(button?.getAttribute('aria-label')).toBe('Unable to copy code. Try again.');
    expect(document.querySelector('[role="status"]')?.textContent).toBe(
      'Unable to copy code. Try again.'
    );
  });

  it('does not let a stale failure timer clear a newer successful copy state', async () => {
    vi.useFakeTimers();
    fixture();
    let writeCount = 0;
    const { owner } = createRuntime({
      executeCopy: () => false,
      writeClipboardText: async () => {
        writeCount += 1;
        if (1 === writeCount) throw new Error('denied');
      }
    });
    owner.enhance(document, config());
    const button = document.querySelector<HTMLButtonElement>('.easymde-code-copy__button');

    button?.click();
    await settle();
    expect(button?.getAttribute('aria-label')).toBe('Unable to copy code. Try again.');
    vi.advanceTimersByTime(1000);

    button?.click();
    await settle();
    expect(button?.classList.contains('is-copied')).toBe(true);
    vi.advanceTimersByTime(500);
    expect(button?.classList.contains('is-copied')).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(button?.classList.contains('is-copied')).toBe(false);
  });

  it('ignores pending completion after cleanup and releases every owned node and class', async () => {
    fixture();
    const pendingWrite = deferred();
    const { failures, owner } = createRuntime({
      writeClipboardText: () => pendingWrite.promise
    });
    const root = document.querySelector<HTMLElement>('.easymde-rendered-content');
    const cleanup = owner.enhance(document, config());

    root?.querySelector<HTMLButtonElement>('.easymde-code-copy__button')?.click();
    cleanup();
    pendingWrite.resolve();
    await settle();

    expect(failures).toEqual([]);
    expect(root?.querySelector('.easymde-code-copy__button')).toBeNull();
    expect(root?.querySelector('[role="status"]')).toBeNull();
    expect(root?.querySelector('pre')?.classList.contains('easymde-code-copy')).toBe(false);
    expect(root?.querySelector('code')?.classList.contains('easymde-code-copy__code')).toBe(false);
  });

  it('does not invoke fallback after cleanup rejects a pending clipboard write', async () => {
    fixture();
    const pendingWrite = deferred();
    const executeCopy = vi.fn(() => true);
    const { failures, owner } = createRuntime({
      executeCopy,
      writeClipboardText: () => pendingWrite.promise
    });
    const cleanup = owner.enhance(document, config());
    document.querySelector<HTMLButtonElement>('.easymde-code-copy__button')?.click();

    cleanup();
    pendingWrite.reject(new Error('denied after cleanup'));
    await settle();

    expect(executeCopy).not.toHaveBeenCalled();
    expect(failures).toEqual([]);
    expect(document.querySelector('.easymde-code-copy__fallback')).toBeNull();
  });

  it('clears feedback timers and makes removed controls inert during cleanup', async () => {
    vi.useFakeTimers();
    fixture();
    let writes = 0;
    const { owner } = createRuntime({
      writeClipboardText: async () => {
        writes += 1;
      }
    });
    const cleanup = owner.enhance(document, config());
    const button = document.querySelector<HTMLButtonElement>('.easymde-code-copy__button');
    button?.click();
    await settle();
    expect(vi.getTimerCount()).toBe(1);

    cleanup();
    button?.click();
    await settle();

    expect(writes).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(document.querySelector('.easymde-code-copy__button')).toBeNull();
  });

  it('stays inert when disabled and fails fast for an enabled missing string', () => {
    fixture();
    const { owner } = createRuntime();

    owner.enhance(document, { features: { codeCopy: false }, strings });
    expect(document.querySelector('.easymde-code-copy__button')).toBeNull();
    expect(() =>
      owner.enhance(document, {
        features: { codeCopy: true },
        strings: { ...strings, copyCode: '' }
      })
    ).toThrow('easymde-code-copy-missing-string:copyCode');
  });
});
