import { createElement } from '@wordpress/element';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, vi } from 'vitest';

import type { EditorClipboardPort } from '../../contracts/ports/editor-clipboard-port';
import {
  EditorContextMenuFeature,
  type EditorContextMenuSurfaceSnapshot,
  type EditorContextMenuTargetLease
} from './EditorContextMenuFeature';

export const labels = {
  alignCenter: 'Align center',
  alignLeft: 'Align left',
  alignRight: 'Align right',
  alignment: 'Alignment',
  ariaLabel: 'Editor context menu',
  bold: 'Bold',
  codeBlock: 'Code block',
  copy: 'Copy',
  copyAsHtml: 'Copy as HTML code',
  copyAsMarkdown: 'Copy as Markdown',
  copyCodeBlock: 'Copy code block',
  copyCodeContent: 'Copy Code Block Content',
  indentCodeBlock: 'Adjust Code Block Indentation',
  indentSelectedCode: 'Adjust Selected Code Indentation',
  copyDiagramSource: 'Copy code',
  copyGeneratedImage: 'Copy as image',
  copyGeneratedMathMl: 'Copy MathML',
  copyImage: 'Copy image',
  copyLinkAddress: 'Copy link address',
  copyPasteAs: 'Copy / Paste as',
  copyMathSource: 'Copy TeX',
  copySimplifiedFormatting: 'Copy with simplified formatting',
  copyTable: 'Copy table',
  formatTableSource: 'Format Table Source',
  cut: 'Cut',
  deleteCodeBlock: 'Delete code block',
  deleteColumn: 'Delete column',
  deleteGeneratedContent: 'Delete',
  deleteImage: 'Delete image',
  deleteRow: 'Delete row',
  deleteTable: 'Delete table',
  deleteThematicBreak: 'Delete horizontal rule',
  diagramBlock: 'Diagram',
  editGeneratedContent: 'Edit',
  image: 'Image',
  imageScale: 'Image scale',
  insert: 'Insert',
  insertAbove: 'Insert paragraph above',
  insertBelow: 'Insert paragraph below',
  insertCodeAbove: 'Insert paragraph above code block',
  insertCodeBelow: 'Insert paragraph below code block',
  insertImageAbove: 'Insert image above',
  insertImageBelow: 'Insert image below',
  insertColumnLeft: 'Insert column left',
  insertColumnRight: 'Insert column right',
  insertParagraphAboveGenerated: 'Insert paragraph above',
  insertParagraphAboveTable: 'Insert paragraph above table',
  insertParagraphBelowGenerated: 'Insert paragraph below',
  insertParagraphBelowTable: 'Insert paragraph below table',
  insertTableAbove: 'Insert table above',
  insertTableBelow: 'Insert table below',
  insertRowAbove: 'Insert row above',
  insertRowBelow: 'Insert row below',
  mathBlock: 'Formula',
  paste: 'Paste',
  pastePlainText: 'Paste as plain text',
  statusActionFailed: 'The editor action could not be completed.',
  statusClipboardUnavailable: 'Clipboard text is unavailable in this browser.',
  table: 'Table',
  unsupported: 'Unsupported for this selection.',
  uploadImage: 'Upload image'
} as const;

export function clipboard(): EditorClipboardPort {
  return {
    check: vi.fn().mockResolvedValue({ status: 'available', text: 'clipboard' }),
    dispose: vi.fn(),
    getState: vi.fn(() => ({ status: 'available' as const })),
    read: vi.fn().mockResolvedValue({ status: 'available', text: 'clipboard' }),
    subscribe: vi.fn(() => () => undefined),
    write: vi.fn().mockResolvedValue({ status: 'written' })
  };
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

export function layoutSurface(element: HTMLElement): void {
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      bottom: 300,
      height: 300,
      left: 0,
      right: 400,
      top: 0,
      width: 400,
      x: 0,
      y: 0,
      toJSON: () => ({})
    })
  });
}

export function selectBackward(element: HTMLElement): Text {
  const text = element.firstChild;
  if (!(text instanceof Text)) throw new Error('context-menu-selection-text-missing');
  const selection = element.ownerDocument.defaultView?.getSelection();
  if (!selection) throw new Error('context-menu-selection-owner-missing');
  selection.removeAllRanges();
  selection.setBaseAndExtent(text, text.length, text, 0);
  return text;
}

export function expectBackwardSelection(text: Text): void {
  const selection = text.ownerDocument.defaultView?.getSelection();
  expect(selection?.anchorNode).toBe(text);
  expect(selection?.anchorOffset).toBe(text.length);
  expect(selection?.focusNode).toBe(text);
  expect(selection?.focusOffset).toBe(0);
}

/**
 * A source-like surface whose menu can be retained across a refresh that
 * returns pending readiness, so retention can be exercised without a real
 * Preview or block-index owner.
 */
export function retainedPendingMenu() {
  const source = document.createElement('div');
  source.contentEditable = 'true';
  layoutSurface(source);
  document.body.append(source);
  const port = clipboard();
  const listeners = {
    readiness: new Set<() => void>(),
    selection: new Set<() => void>(),
    snapshot: new Set<() => void>()
  };
  const state = {
    link: null as Readonly<{ href: string }> | null,
    ready: true,
    selection: { direction: 'none' as const, end: 0, start: 0 },
    value: 'alpha'
  };
  const subscribe = (registry: Set<() => void>) => (listener: () => void) => {
    registry.add(listener);
    return () => registry.delete(listener);
  };
  const buildSource = () => ({
    boundaryElement: source,
    element: source,
    getActionContext: () => (state.link ? { link: state.link } : null),
    // A fresh provider identity per owner replacement is what makes the
    // Feature treat this as an owner-drift refresh.
    getBlockIndex: () => null,
    getContextReadiness: () =>
      state.ready ? { status: 'ready' as const } : { status: 'pending' as const },
    getSnapshot: () => ({ selection: state.selection, value: state.value }),
    isEditable: () => true,
    kind: 'source' as const,
    subscribeReadiness: subscribe(listeners.readiness),
    subscribeSelection: subscribe(listeners.selection),
    subscribeSnapshot: subscribe(listeners.snapshot)
  });
  const renderFeature = () => (
    <EditorContextMenuFeature
      clipboard={port}
      direction="ltr"
      labels={labels}
      onAction={vi.fn()}
      onFailure={vi.fn()}
      source={buildSource()}
      visual={null}
    />
  );
  const view = render(renderFeature());
  return {
    /** Deliver one subscription's notifications, as the surface owner does. */
    fire: (name: 'readiness' | 'selection' | 'snapshot'): void => {
      for (const listener of listeners[name]) listener();
    },
    /** Open the menu, then replace its owner so the rebuilt inventory is pending. */
    retain: async (): Promise<void> => {
      fireEvent.contextMenu(source, { clientX: 20, clientY: 30 });
      await screen.findByRole('menu');
      state.ready = false;
      view.rerender(renderFeature());
      expect(screen.getByRole('menu')).toBeTruthy();
    },
    state
  };
}

/**
 * A pending-demand fixture whose target lease can publish the owner's
 * accepted selection transition. The surface keeps its revision and value
 * fixed and only moves the selection, which is exactly the accepted
 * presentation normalization the receipt exists for.
 */
export function acceptedSelectionFixture(options: {
  armed?: boolean;
  initialSelection?: { direction: 'backward' | 'forward' | 'none'; end: number; start: number };
  revision?: number | undefined;
} = {}) {
  const surfaceElement = document.createElement('div');
  surfaceElement.contentEditable = 'true';
  layoutSurface(surfaceElement);
  const target = document.createElement('p');
  target.textContent = 'a | b';
  surfaceElement.append(target);
  document.body.append(surfaceElement);
  const readinessListeners = new Set<() => void>();
  const selectionListeners = new Set<() => void>();
  const snapshotListeners = new Set<() => void>();
  const state = {
    ready: false,
    selection: options.initialSelection ?? {
      direction: 'none' as const,
      end: 9,
      start: 9
    },
    value: 'a | b\n--- | ---'
  };
  let preflights = 0;
  let captures = 0;
  let resolves = 0;
  let armed = options.armed ?? true;
  let consumed = false;
  // The owner's armed publication: it knows the exact before/after it is
  // about to publish, so the receipt is checked against that, not against
  // whatever the surface currently reports.
  const initialSelection = options.initialSelection ?? {
    direction: 'none' as const,
    end: 9,
    start: 9
  };
  // Declared with the real selection direction union: the armed publication
  // may legitimately stage a directional selection, so narrowing this to
  // 'none' would be a lie about the owner's own record.
  let armedAfter: {
    direction: 'backward' | 'forward' | 'none';
    end: number;
    start: number;
  } = { direction: 'none', end: 0, start: 0 };
  // The owner's own record of the selection it staged BEFORE its write. It is
  // independent of what the demand captured, so a mismatch is detectable.
  let armedBefore = initialSelection;
  const consumes: Array<{
    before: EditorContextMenuSurfaceSnapshot;
    after: EditorContextMenuSurfaceSnapshot;
  }> = [];
  const prepares: Array<Element | null | undefined> = [];
  const actionContexts: Array<Element | null> = [];
  const released = vi.fn();
  const onFailure = vi.fn();
  const port = clipboard();
  const surface = () => ({
    boundaryElement: surfaceElement,
    element: surfaceElement,
    captureTarget: (): EditorContextMenuTargetLease => {
      captures += 1;
      return {
        release: released,
        resolve: () => {
          resolves += 1;
          return target;
        },
        // Stands in for the owner's real closed-over publication record:
        // armed around its own canonical write, single use, and every
        // non-matching call is a plain false.
        consumeAcceptedSelectionTransition: (before, after) => {
          consumes.push({ before, after });
          if (!armed || consumed) return false;
          // Both sides must state the same known revision: a missing
          // revision is a rejection, never undefined === undefined.
          if (undefined === before.revision || before.revision !== after.revision) {
            return false;
          }
          if (before.value !== after.value) return false;
          if (
            before.selection.start !== armedBefore.start
            || before.selection.end !== armedBefore.end
            || before.selection.direction !== armedBefore.direction
          ) return false;
          if (
            after.selection.start !== armedAfter.start
            || after.selection.end !== armedAfter.end
            || after.selection.direction !== armedAfter.direction
          ) return false;
          consumed = true;
          return true;
        }
      };
    },
    getActionContext: (element: Element | null) => {
      actionContexts.push(element);
      return null;
    },
    getBlockIndex: () => null,
    getContextReadiness: () => state.ready
      ? { status: 'ready' as const }
      : { status: 'pending' as const },
    getSnapshot: () => ({
      ...(undefined === options.revision ? {} : { revision: options.revision }),
      selection: state.selection,
      value: state.value
    }),
    isEditable: () => true,
    kind: 'visual' as const,
    prepare: (element?: Element | null) => {
      prepares.push(element);
      return true;
    },
    prepareDemand: () => {
      preflights += 1;
      return true;
    },
    subscribeReadiness: (listener: () => void) => {
      readinessListeners.add(listener);
      return () => readinessListeners.delete(listener);
    },
    subscribeSelection: (listener: () => void) => {
      selectionListeners.add(listener);
      return () => selectionListeners.delete(listener);
    },
    subscribeSnapshot: (listener: () => void) => {
      snapshotListeners.add(listener);
      return () => snapshotListeners.delete(listener);
    }
  });
  const view = render(
    <EditorContextMenuFeature
      clipboard={port}
      direction="ltr"
      labels={labels}
      onAction={vi.fn()}
      onFailure={onFailure}
      source={null}
      visual={surface()}
    />
  );
  return {
    actionContexts,
    arm: (next: boolean) => {
      armed = next;
    },
    /** The exact selection the armed publication will install. */
    armAcceptedAfter: (selection: {
      direction: 'backward' | 'forward' | 'none';
      end: number;
      start: number;
    }) => {
      armedAfter = { ...selection };
    },
    /** The exact selection the owner staged before its own write. */
    armAcceptedBefore: (selection: {
      direction: 'backward' | 'forward' | 'none';
      end: number;
      start: number;
    }) => {
      armedBefore = selection;
    },
    captures: () => captures,
    consumes,
    fire: (name: 'readiness' | 'selection' | 'snapshot'): void => {
      const registry = 'readiness' === name
        ? readinessListeners
        : 'selection' === name
          ? selectionListeners
          : snapshotListeners;
      for (const listener of [...registry]) listener();
    },
    /** Open the gesture on the surface element and park on readiness. */
    open: (): void => {
      fireEvent.pointerDown(target, { button: 2, clientX: 20, clientY: 30 });
      fireEvent.contextMenu(target, { clientX: 20, clientY: 30 });
    },
    onFailure,
    preflights: () => preflights,
    prepares,
    releases: released,
    resolves: () => resolves,
    setReady: (ready: boolean) => {
      state.ready = ready;
    },
    setSelection: (
      selection: { direction: 'backward' | 'forward' | 'none'; end: number; start: number }
    ) => {
      state.selection = selection;
    },
    setValue: (value: string) => {
      state.value = value;
    },
    state,
    surfaceElement,
    target,
    unmount: () => view.unmount()
  };
}
