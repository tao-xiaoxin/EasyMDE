const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const SUCCESS_DURATION = 1500;

type Cleanup = () => void;

type CodeCopyStrings = Readonly<{
  codeCopied: string;
  codeCopyFailed: string;
  copied: string;
  copyCode: string;
}>;

type CodeCopyRuntime = Readonly<{
  clearTimeout: (timerId: number) => void;
  document: Document;
  executeCopy: () => boolean;
  getScrollPosition: () => Readonly<{ x: number; y: number }>;
  getSelection: () => Selection | null;
  reportFailure: (code: 'clipboard-write-failed') => void;
  scrollTo: (x: number, y: number) => void;
  setTimeout: (callback: () => void, delay: number) => number;
  writeClipboardText: ((text: string) => Promise<void> | void) | null;
}>;

type CodeControl = {
  button: HTMLButtonElement;
  code: HTMLElement;
  onClick: () => void;
  onMouseDown: () => void;
  pending: boolean;
  pre: HTMLPreElement;
  strings: CodeCopyStrings;
  timerGeneration: number;
  timerId: number;
};

type RootState = {
  activeControl: CodeControl | null;
  cleanup: Cleanup;
  controls: Array<CodeControl>;
  destroyed: boolean;
  operationGeneration: number;
  pendingControl: CodeControl | null;
  root: HTMLElement;
  selectionFrozen: boolean;
  selectionListener: () => void;
  selectionMouseUpListener: (event: MouseEvent) => void;
  selectionOwner: HTMLButtonElement | null;
  selectionRanges: Array<Range>;
  status: HTMLSpanElement | null;
};

type QueuedCopy = Readonly<{
  canStart: () => boolean;
  preservedRanges: ReadonlyArray<Range>;
  reject: (reason?: unknown) => void;
  resolve: (copied: boolean) => void;
  text: string;
}>;

const noop: Cleanup = () => {};

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && 'object' === typeof value && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isEnabled(config: unknown): boolean {
  const features = objectValue(objectValue(config)?.features);
  return true === features?.codeCopy;
}

function requiredString(config: unknown, key: keyof CodeCopyStrings): string {
  const strings = objectValue(objectValue(config)?.strings);
  const value = strings?.[key];

  if ('string' !== typeof value || '' === value) {
    throw new Error(`easymde-code-copy-missing-string:${key}`);
  }

  return value;
}

function parseStrings(config: unknown): CodeCopyStrings {
  return {
    codeCopied: requiredString(config, 'codeCopied'),
    codeCopyFailed: requiredString(config, 'codeCopyFailed'),
    copied: requiredString(config, 'copied'),
    copyCode: requiredString(config, 'copyCode')
  };
}

export function createBrowserCodeCopyOwner(runtime: CodeCopyRuntime): Readonly<{
  enhance: (root: ParentNode, config: unknown) => Cleanup;
}> {
  const rootStates = new WeakMap<HTMLElement, RootState>();
  const clipboardWriteQueue: Array<QueuedCopy> = [];
  let clipboardWriteActive = false;

  function createSvg(className: string): SVGSVGElement {
    const svg = runtime.document.createElementNS(SVG_NAMESPACE, 'svg');

    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.setAttribute('width', '14');
    svg.setAttribute('height', '14');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.classList.add('lucide', className);

    return svg;
  }

  function createCopyIcon(): SVGSVGElement {
    const svg = createSvg('lucide-copy');
    const rect = runtime.document.createElementNS(SVG_NAMESPACE, 'rect');
    const path = runtime.document.createElementNS(SVG_NAMESPACE, 'path');

    rect.setAttribute('width', '14');
    rect.setAttribute('height', '14');
    rect.setAttribute('x', '8');
    rect.setAttribute('y', '8');
    rect.setAttribute('rx', '2');
    rect.setAttribute('ry', '2');
    path.setAttribute('d', 'M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2');
    svg.append(rect, path);

    return svg;
  }

  function createCheckIcon(): SVGSVGElement {
    const svg = createSvg('lucide-check');
    const path = runtime.document.createElementNS(SVG_NAMESPACE, 'path');

    path.setAttribute('d', 'M20 6 9 17l-5-5');
    svg.append(path);

    return svg;
  }

  function announce(state: RootState, message: string): void {
    if (state.status) {
      state.status.textContent = message;
    }
  }

  function setReadyState(state: RootState, control: CodeControl): void {
    if (control.timerId) {
      runtime.clearTimeout(control.timerId);
      control.timerId = 0;
    }

    control.timerGeneration += 1;
    control.button.classList.remove('is-copied');
    control.button.setAttribute('aria-label', control.strings.copyCode);
    control.button.setAttribute('title', control.strings.copyCode);
    control.button.replaceChildren(createCopyIcon());
    if (state.activeControl === control) {
      state.activeControl = null;
      announce(state, '');
    }
  }

  function prepareFeedbackState(state: RootState, control: CodeControl): number {
    if (state.activeControl && state.activeControl !== control) {
      setReadyState(state, state.activeControl);
    }

    state.activeControl = control;
    if (control.timerId) {
      runtime.clearTimeout(control.timerId);
      control.timerId = 0;
    }

    control.timerGeneration += 1;
    return control.timerGeneration;
  }

  function scheduleReadyState(
    state: RootState,
    control: CodeControl,
    generation: number
  ): void {
    control.timerId = runtime.setTimeout(() => {
      if (state.destroyed || generation !== control.timerGeneration) {
        return;
      }

      control.timerId = 0;
      setReadyState(state, control);
    }, SUCCESS_DURATION);
  }

  function setCopiedState(state: RootState, control: CodeControl): void {
    const generation = prepareFeedbackState(state, control);

    control.button.classList.add('is-copied');
    control.button.setAttribute('aria-label', control.strings.codeCopied);
    control.button.setAttribute('title', control.strings.copied);
    control.button.replaceChildren(createCheckIcon());
    announce(state, control.strings.codeCopied);
    scheduleReadyState(state, control, generation);
  }

  function setFailedState(state: RootState, control: CodeControl): void {
    const generation = prepareFeedbackState(state, control);

    control.button.classList.remove('is-copied');
    control.button.setAttribute('aria-label', control.strings.codeCopyFailed);
    control.button.setAttribute('title', control.strings.codeCopyFailed);
    control.button.replaceChildren(createCopyIcon());
    announce(state, control.strings.codeCopyFailed);
    scheduleReadyState(state, control, generation);
  }

  function captureSelection(selection: Selection | null): Array<Range> {
    const ranges: Array<Range> = [];

    if (!selection) {
      return ranges;
    }

    for (let index = 0; index < selection.rangeCount; index += 1) {
      ranges.push(selection.getRangeAt(index).cloneRange());
    }

    return ranges;
  }

  function restoreSelection(selection: Selection | null, ranges: ReadonlyArray<Range>): void {
    if (!selection) {
      return;
    }

    selection.removeAllRanges();
    for (const range of ranges) {
      selection.addRange(range);
    }
  }

  function rememberSelection(state: RootState): void {
    if (!state.selectionFrozen) {
      state.selectionRanges = captureSelection(runtime.getSelection());
    }
  }

  function copyWithFallback(text: string, preservedRanges: ReadonlyArray<Range>): boolean {
    const activeElement = runtime.document.activeElement;
    const selection = runtime.getSelection();
    const ranges = preservedRanges.length
      ? preservedRanges.map((range) => range.cloneRange())
      : captureSelection(selection);
    const scroll = runtime.getScrollPosition();
    const textarea = runtime.document.createElement('textarea');
    let copied = false;

    textarea.className = 'easymde-code-copy__fallback';
    textarea.value = text;
    textarea.setAttribute('aria-hidden', 'true');
    textarea.setAttribute('readonly', '');
    runtime.document.body.append(textarea);

    try {
      textarea.select();
      textarea.setSelectionRange(0, textarea.value.length);
      copied = true === runtime.executeCopy();
    } catch {
      copied = false;
    } finally {
      textarea.remove();
      if (activeElement instanceof HTMLElement) {
        activeElement.focus({ preventScroll: true });
      }
      restoreSelection(selection, ranges);
      runtime.scrollTo(scroll.x, scroll.y);
    }

    return copied;
  }

  async function copyText(
    text: string,
    preservedRanges: ReadonlyArray<Range>,
    canUseFallback: () => boolean
  ): Promise<boolean> {
    if (runtime.writeClipboardText) {
      try {
        await runtime.writeClipboardText(text);
        return true;
      } catch {
        return canUseFallback() ? copyWithFallback(text, preservedRanges) : false;
      }
    }

    return canUseFallback() ? copyWithFallback(text, preservedRanges) : false;
  }

  function drainClipboardWriteQueue(): void {
    if (clipboardWriteActive) {
      return;
    }

    let queued = clipboardWriteQueue.shift();
    while (queued && !queued.canStart()) {
      queued.resolve(false);
      queued = clipboardWriteQueue.shift();
    }

    if (!queued) {
      return;
    }

    clipboardWriteActive = true;
    copyText(queued.text, queued.preservedRanges, queued.canStart).then(
      (copied) => {
        clipboardWriteActive = false;
        queued.resolve(copied);
        drainClipboardWriteQueue();
      },
      (error: unknown) => {
        clipboardWriteActive = false;
        queued.reject(error);
        drainClipboardWriteQueue();
      }
    );
  }

  function enqueueCopyText(
    text: string,
    preservedRanges: ReadonlyArray<Range>,
    canStart: () => boolean
  ): Promise<boolean> {
    return new Promise((resolve, reject) => {
      clipboardWriteQueue.push({ canStart, preservedRanges, reject, resolve, text });
      drainClipboardWriteQueue();
    });
  }

  function createControl(
    state: RootState,
    pre: HTMLPreElement,
    code: HTMLElement,
    strings: CodeCopyStrings
  ): CodeControl {
    const button = runtime.document.createElement('button');
    const control: CodeControl = {
      button,
      code,
      onClick: noop,
      onMouseDown: noop,
      pending: false,
      pre,
      strings,
      timerGeneration: 0,
      timerId: 0
    };

    button.type = 'button';
    button.className = 'easymde-code-copy__button';
    button.setAttribute('aria-label', strings.copyCode);
    button.setAttribute('title', strings.copyCode);
    button.append(createCopyIcon());
    pre.classList.add('easymde-code-copy');
    code.classList.add('easymde-code-copy__code');
    pre.append(button);

    control.onClick = () => {
      if (state.destroyed || control.pending) {
        return;
      }

      const preservedRanges = state.selectionRanges.map((range) => range.cloneRange());
      state.operationGeneration += 1;
      const operationGeneration = state.operationGeneration;
      if (state.pendingControl && state.pendingControl !== control) {
        state.pendingControl.pending = false;
        state.pendingControl.button.removeAttribute('aria-busy');
      }
      state.pendingControl = control;
      state.selectionFrozen = false;
      state.selectionOwner = null;
      control.pending = true;
      button.setAttribute('aria-busy', 'true');

      enqueueCopyText(code.textContent ?? '', preservedRanges, () =>
        !state.destroyed && operationGeneration === state.operationGeneration
      ).then(
        (copied) => {
          if (
            state.destroyed
            || operationGeneration !== state.operationGeneration
            || state.pendingControl !== control
          ) {
            return;
          }

          state.pendingControl = null;
          control.pending = false;
          button.removeAttribute('aria-busy');
          if (copied) {
            setCopiedState(state, control);
          } else {
            setFailedState(state, control);
            runtime.reportFailure('clipboard-write-failed');
          }
        },
        () => {
          if (
            !state.destroyed
            && operationGeneration === state.operationGeneration
            && state.pendingControl === control
          ) {
            state.pendingControl = null;
            control.pending = false;
            button.removeAttribute('aria-busy');
            setFailedState(state, control);
            runtime.reportFailure('clipboard-write-failed');
          }
        }
      );
    };

    control.onMouseDown = () => {
      state.selectionRanges = captureSelection(runtime.getSelection());
      state.selectionFrozen = true;
      state.selectionOwner = button;
    };

    button.addEventListener('mousedown', control.onMouseDown);
    button.addEventListener('click', control.onClick);
    return control;
  }

  function isMermaidCode(code: Element): boolean {
    return [...code.classList].some(
      (className) => 'language-mermaid' === className.toLowerCase()
    );
  }

  function findRoots(root: ParentNode): Array<HTMLElement> {
    const roots: Array<HTMLElement> = [];

    if (root instanceof HTMLElement && root.classList.contains('easymde-rendered-content')) {
      roots.push(root);
    }

    for (const renderedRoot of root.querySelectorAll<HTMLElement>('.easymde-rendered-content')) {
      if (!roots.includes(renderedRoot)) {
        roots.push(renderedRoot);
      }
    }

    return roots;
  }

  function enhanceRoot(root: HTMLElement, config: unknown): Cleanup {
    const existing = rootStates.get(root);
    if (existing) {
      return existing.cleanup;
    }

    const strings = parseStrings(config);
    const state: RootState = {
      activeControl: null,
      cleanup: noop,
      controls: [],
      destroyed: false,
      operationGeneration: 0,
      pendingControl: null,
      root,
      selectionFrozen: false,
      selectionListener: noop,
      selectionMouseUpListener: noop,
      selectionOwner: null,
      selectionRanges: captureSelection(runtime.getSelection()),
      status: null
    };

    state.selectionListener = () => {
      rememberSelection(state);
    };
    state.selectionMouseUpListener = (event) => {
      if (state.selectionOwner && event.target !== state.selectionOwner) {
        state.selectionFrozen = false;
        state.selectionOwner = null;
        rememberSelection(state);
      }
    };

    for (const code of root.querySelectorAll<HTMLElement>('pre > code')) {
      const pre = code.parentElement;
      if (!(pre instanceof HTMLPreElement) || isMermaidCode(code)) {
        continue;
      }

      state.controls.push(createControl(state, pre, code, strings));
    }

    if (0 === state.controls.length) {
      return noop;
    }

    state.status = runtime.document.createElement('span');
    state.status.className = 'easymde-code-copy__status';
    state.status.setAttribute('aria-atomic', 'true');
    state.status.setAttribute('aria-live', 'polite');
    state.status.setAttribute('role', 'status');
    root.append(state.status);

    runtime.document.addEventListener('selectionchange', state.selectionListener);
    runtime.document.addEventListener('mouseup', state.selectionMouseUpListener);
    root.classList.add('easymde-code-copy-enabled');
    state.cleanup = () => {
      if (state.destroyed) {
        return;
      }

      state.destroyed = true;
      state.operationGeneration += 1;
      state.pendingControl = null;
      for (const control of state.controls) {
        if (control.timerId) {
          runtime.clearTimeout(control.timerId);
          control.timerId = 0;
        }
        control.pending = false;
        control.timerGeneration += 1;
        control.button.removeEventListener('mousedown', control.onMouseDown);
        control.button.removeEventListener('click', control.onClick);
        control.button.remove();
        control.pre.classList.remove('easymde-code-copy');
        control.code.classList.remove('easymde-code-copy__code');
      }
      runtime.document.removeEventListener('selectionchange', state.selectionListener);
      runtime.document.removeEventListener('mouseup', state.selectionMouseUpListener);
      state.status?.remove();
      root.classList.remove('easymde-code-copy-enabled');
      rootStates.delete(root);
    };

    rootStates.set(root, state);
    return state.cleanup;
  }

  return {
    enhance(root, config): Cleanup {
      if (!isEnabled(config)) {
        return noop;
      }

      const cleanups = findRoots(root).map((renderedRoot) => enhanceRoot(renderedRoot, config));
      return () => {
        for (const cleanup of cleanups) {
          cleanup();
        }
      };
    }
  };
}

export type { CodeCopyRuntime };
