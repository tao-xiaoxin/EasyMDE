import {
  createElement,
  useImperativeHandle,
  useLayoutEffect,
  useRef
} from '@wordpress/element';
import type {
  ClipboardEventHandler,
  CSSProperties,
  DragEventHandler,
  FormEventHandler,
  KeyboardEventHandler,
  Ref
} from 'react';

import type { SafePreviewHtml } from '../../../contracts/ports/preview-request';
import { prepareVisualProtectedNodeAdoption } from '../../../shared/dom/visual-protected-node-adoption';

export type SafePreviewHtmlSinkCommit = Readonly<{
  nodes: ReadonlyArray<Node>;
  revision: number;
}>;

export type SafePreviewHtmlSinkWindowCommit = Readonly<{
  key: number;
  nodes: ReadonlyArray<Node>;
  revision: number;
}>;

export type SafePreviewHtmlSinkMaterializeCommit = Readonly<{
  key: number;
  nodes: ReadonlyArray<Node>;
  revision: number;
}>;

export type SafePreviewHtmlSinkScheduler = Readonly<{
  yield: () => Promise<void>;
}>;

export type SafePreviewHtmlSinkVerifiedView = Readonly<{
  html: SafePreviewHtml | null;
  htmlRevision: number;
  windowedCommit: SafePreviewHtmlSinkWindowCommit | null;
}>;

export type SafePreviewHtmlSinkFailureOutcome = Readonly<{
  error: unknown;
  kind: 'restored';
  previous: SafePreviewHtmlSinkVerifiedView | null;
}> | Readonly<{
  error: unknown;
  kind: 'unverified';
  rollbackError: unknown;
}>;

type SafePreviewHtmlSinkProps = Readonly<{
  ariaBusy?: boolean;
  acceptedHtml?: boolean;
  className?: string;
  contentEditable?: boolean;
  error?: boolean;
  html: SafePreviewHtml | null;
  htmlRevision?: number;
  label?: string;
  onDomMutation?: ((surface: HTMLElement) => void) | ((surface: HTMLElement) => Error);
  onDomMutationFailure?: (outcome: SafePreviewHtmlSinkFailureOutcome) => void;
  onDrop?: DragEventHandler<HTMLElement>;
  onInput?: FormEventHandler<HTMLElement>;
  onMaterializeComplete?: (revision: number, key: number) => void;
  onMaterializeFailure?: (
    revision: number,
    key: number,
    outcome: SafePreviewHtmlSinkFailureOutcome
  ) => void;
  onKeyDown?: KeyboardEventHandler<HTMLElement>;
  onPaste?: ClipboardEventHandler<HTMLElement>;
  onStagedCommit?: (revision: number) => void;
  materializeCommit?: SafePreviewHtmlSinkMaterializeCommit | null;
  materializeScheduler?: SafePreviewHtmlSinkScheduler;
  refreshing?: boolean;
  role?: string;
  spellCheck?: boolean;
  stagedCommit?: SafePreviewHtmlSinkCommit | null;
  windowedCommit?: SafePreviewHtmlSinkWindowCommit | null;
  statusClassName?: string;
  statusMessage?: string;
  statusRole?: string;
  style?: CSSProperties;
  surfaceRef: Ref<HTMLElement>;
}>;

type AppliedSurfaceState = Readonly<{
  html: SafePreviewHtml | null;
  revision: number;
  statusClassName: string | undefined;
  statusMessage: string | undefined;
  statusRole: string | undefined;
  materializeCommitKey: number | null;
  windowedCommitKey: number | null;
  windowedCommit: SafePreviewHtmlSinkWindowCommit | null;
  stagedCommit?: SafePreviewHtmlSinkCommit;
  stagedCommitNodes?: ReadonlyArray<Node>;
}>;

function verifiedSinkView(
  state: AppliedSurfaceState | null
): SafePreviewHtmlSinkVerifiedView | null {
  if (!state) return null;
  return {
    html: state.html,
    htmlRevision: state.revision,
    windowedCommit: state.windowedCommit ?? null
  };
}

function validateUniqueChildren(desiredNodes: ReadonlyArray<Node>): void {
  const desired = new Set<Node>();
  for (const node of desiredNodes) {
    if (desired.has(node)) {
      throw new Error('preview-window-node-sequence-invalid');
    }
    desired.add(node);
  }
}

function validateWindowChildren(
  surface: HTMLElement,
  desiredNodes: ReadonlyArray<Node>
): void {
  validateUniqueChildren(desiredNodes);
  if (desiredNodes.some((node) =>
    node.ownerDocument !== surface.ownerDocument
  )) {
    throw new Error('preview-window-node-sequence-invalid');
  }
}

function defaultSafePreviewHtmlSinkScheduler(
  documentRef: Document
): SafePreviewHtmlSinkScheduler {
  const windowRef = documentRef.defaultView;
  return {
    yield: () => new Promise<void>((resolve) => {
      if (windowRef) windowRef.setTimeout(resolve, 0);
      else setTimeout(resolve, 0);
    })
  };
}

const MATERIALIZE_BATCH_SIZE = 512;

function materializeSpacerRange(
  spacer: HTMLElement,
  nodeCount: number
): Readonly<{ end: number; start: number }> {
  const start = Number.parseInt(
    spacer.getAttribute('data-easymde-preview-window-start') ?? '',
    10
  );
  const end = Number.parseInt(
    spacer.getAttribute('data-easymde-preview-window-end') ?? '',
    10
  );
  if (
    !Number.isInteger(start)
    || !Number.isInteger(end)
    || start < 0
    || end <= start
    || end > nodeCount
  ) {
    throw new Error('preview-window-materialize-range-invalid');
  }
  return { end, start };
}

function hasExactChildren(
  surface: HTMLElement,
  nodes: ReadonlyArray<Node>
): boolean {
  if (surface.childNodes.length !== nodes.length) return false;
  return nodes.every((node, index) => surface.childNodes[index] === node);
}

type SurfaceSnapshot = Readonly<{
  children: ReadonlyArray<Node>;
  canvas: HTMLElement | null;
  scrollTop: number;
  spacerAttributes: ReadonlyArray<{
    attributes: ReadonlyArray<{ name: string; value: string }>;
    node: Element;
  }>;
}>;

type DomMutationCallback =
  | ((surface: HTMLElement) => void)
  | ((surface: HTMLElement) => Error)
  | undefined;

function captureSurfaceSnapshot(surface: HTMLElement): SurfaceSnapshot {
  return {
    canvas: surface.parentElement,
    children: Array.from(surface.childNodes),
    scrollTop: surface.parentElement?.scrollTop ?? 0,
    spacerAttributes: Array.from(surface.children).flatMap((node) =>
      node.hasAttribute('data-easymde-preview-window-spacer')
        ? [{
            attributes: Array.from(node.attributes).map(({ name, value }) => ({
              name,
              value
            })),
            node
          }]
        : []
    )
  };
}

function restoreSurfaceSnapshot(snapshot: SurfaceSnapshot, surface: HTMLElement): void {
  if (!surface.parentNode) throw new Error('preview-sink-rollback-failed');
  for (const { attributes, node } of snapshot.spacerAttributes) {
    for (const attribute of Array.from(node.attributes)) {
      node.removeAttribute(attribute.name);
    }
    for (const { name, value } of attributes) node.setAttribute(name, value);
  }
  surface.replaceChildren(...snapshot.children);
  if (snapshot.canvas) snapshot.canvas.scrollTop = snapshot.scrollTop;
}

function runRollbackSteps(
  steps: ReadonlyArray<() => void>
): Error | null {
  let failure: Error | null = null;
  for (const step of steps) {
    try {
      step();
    } catch (error) {
      failure ??= error instanceof Error
        ? error
        : new Error('preview-sink-rollback-failed');
    }
  }
  return failure;
}

function notifyDomMutation(
  surface: HTMLElement,
  callback: DomMutationCallback
): Error | null {
  try {
    const result = callback?.(surface);
    if (result instanceof Error) return result;
    return null;
  } catch (error) {
    return error instanceof Error
      ? error
      : new Error('preview-sink-dom-mutation-failed');
  }
}

function clearUnverifiedSurface(
  surface: HTMLElement,
  onDomMutation: DomMutationCallback
): void {
  surface.replaceChildren();
  const styleError = notifyDomMutation(surface, onDomMutation);
  if (styleError) throw styleError;
}

function restoreAfterDomMutationFailure(
  surface: HTMLElement,
  mutationError: Error,
  previous: SafePreviewHtmlSinkVerifiedView | null,
  restore: () => void,
  onDomMutation: DomMutationCallback,
  onFailure?: (outcome: SafePreviewHtmlSinkFailureOutcome) => void
): void {
  let rollbackFailure: Error | null = null;
  try {
    restore();
  } catch (error) {
    rollbackFailure = error instanceof Error
      ? error
      : new Error('preview-sink-rollback-failed');
  }
  if (!rollbackFailure) {
    const restoredError = notifyDomMutation(surface, onDomMutation);
    if (restoredError) rollbackFailure = restoredError;
  }
  if (!rollbackFailure) {
    onFailure?.({ error: mutationError, kind: 'restored', previous });
    return;
  }
  try {
    clearUnverifiedSurface(surface, onDomMutation);
  } catch {
    // The first rollback error remains the causal failure; the sink is already
    // unverified and the owner will discard the corresponding View state.
  }
  onFailure?.({
    error: mutationError,
    kind: 'unverified',
    rollbackError: rollbackFailure
  });
}

function appendStatusMessage(
  surface: HTMLElement,
  statusClassName: string | undefined,
  statusMessage: string,
  statusRole: string | undefined
): void {
  const message = surface.ownerDocument.createElement('p');
  if (statusClassName) message.className = statusClassName;
  if (statusRole) message.setAttribute('role', statusRole);
  message.textContent = statusMessage;
  surface.append(message);
}

function startMaterializeChildrenCommit(
  surface: HTMLElement,
  desiredNodes: ReadonlyArray<Node>,
  scheduler: SafePreviewHtmlSinkScheduler,
  onDomMutation: DomMutationCallback,
  previousAppliedState: AppliedSurfaceState | null,
  onComplete: () => void,
  onFailure: (outcome: SafePreviewHtmlSinkFailureOutcome) => void
): () => void {
  const initialChildren = Array.from(surface.childNodes);
  const initialSpacerAttributes = initialChildren.flatMap((node) =>
    node instanceof HTMLElement
    && node.hasAttribute('data-easymde-preview-window-spacer')
      ? [{
          attributes: Array.from(node.attributes).map(({ name, value }) => ({
            name,
            value
          })),
          node
        }]
      : []
  );
  const canvas = surface.parentElement;
  const initialScrollTop = canvas?.scrollTop ?? 0;
  const anchor = desiredNodes.find((node) => node.parentNode === surface);
  const anchorTop = anchor instanceof HTMLElement
    ? anchor.getBoundingClientRect().top
    : null;
  const previous = verifiedSinkView(previousAppliedState);
  let active = true;
  const rollback = (): void => {
    const failure = runRollbackSteps([
      () => {
        if (!surface.parentNode) throw new Error('preview-sink-rollback-failed');
      },
      () => {
        for (const { attributes, node } of initialSpacerAttributes) {
          for (const attribute of Array.from(node.attributes)) {
            node.removeAttribute(attribute.name);
          }
          for (const { name, value } of attributes) node.setAttribute(name, value);
        }
      },
      () => surface.replaceChildren(...initialChildren),
      () => {
        const restoredError = notifyDomMutation(surface, onDomMutation);
        if (restoredError) throw restoredError;
      },
      () => {
        if (canvas) canvas.scrollTop = initialScrollTop;
      }
    ]);
    if (failure) throw failure;
  };
  const reportFailure = (error: unknown): void => {
    let rollbackError: Error | null = null;
    try {
      rollback();
    } catch (failure) {
      rollbackError = failure instanceof Error
        ? failure
        : new Error('preview-sink-rollback-failed');
    }
    if (rollbackError) {
      try {
        clearUnverifiedSurface(surface, onDomMutation);
      } catch {
        // The first rollback error remains the causal failure.
      }
      onFailure({ error, kind: 'unverified', rollbackError });
      return;
    }
    onFailure({ error, kind: 'restored', previous });
  };
  const fail = (error: unknown): void => {
    if (!active) return;
    active = false;
    reportFailure(error);
  };
  const step = (): void => {
    if (!active) return;
    try {
      const spacer = Array.from(surface.children).find((child) =>
        child.hasAttribute('data-easymde-preview-window-spacer')
      ) as HTMLElement | undefined;
      if (!spacer) {
        if (!hasExactChildren(surface, desiredNodes)) {
          throw new Error('preview-window-materialize-sequence-invalid');
        }
        if (canvas) {
          canvas.scrollTop = initialScrollTop;
          if (anchor instanceof HTMLElement && null !== anchorTop) {
            canvas.scrollTop += anchor.getBoundingClientRect().top - anchorTop;
          }
        }
        active = false;
        onComplete();
        return;
      }
      const range = materializeSpacerRange(spacer, desiredNodes.length);
      const count = Math.min(MATERIALIZE_BATCH_SIZE, range.end - range.start);
      const batch = desiredNodes.slice(range.start, range.start + count);
      const height = Number.parseFloat(spacer.style.blockSize);
      if (batch.length !== count || !Number.isFinite(height) || height < 0) {
        throw new Error('preview-window-materialize-sequence-invalid');
      }
      for (const node of batch) {
        if (node.parentNode && node.parentNode !== surface && node.isConnected) {
          throw new Error('preview-window-materialize-node-detached');
        }
        spacer.before(node);
      }
      const nextStart = range.start + count;
      if (nextStart === range.end) {
        spacer.remove();
      } else {
        spacer.setAttribute(
          'data-easymde-preview-window-start',
          String(nextStart)
        );
        spacer.style.blockSize = `${
          height * (range.end - nextStart) / (range.end - range.start)
        }px`;
      }
      const mutationError = notifyDomMutation(surface, onDomMutation);
      if (mutationError) throw mutationError;
      if (canvas) canvas.scrollTop = initialScrollTop;
      void scheduler.yield().then(step, fail);
    } catch (error) {
      fail(error);
    }
  };
  try {
    validateWindowChildren(surface, desiredNodes);
    void scheduler.yield().then(step, fail);
  } catch (error) {
    fail(error);
  }
  return () => {
    if (!active) return;
    active = false;
    try {
      rollback();
    } catch (error) {
      const rollbackError = error instanceof Error
        ? error
        : new Error('preview-sink-rollback-failed');
      try {
        clearUnverifiedSurface(surface, onDomMutation);
      } catch {
        // The first rollback error remains the causal failure.
      }
      onFailure({
        error: new Error('preview-sink-materialize-cancelled'),
        kind: 'unverified',
        rollbackError
      });
    }
  };
}

function startWindowChildrenCommit(
  surface: HTMLElement,
  desiredNodes: ReadonlyArray<Node>,
  previous: SafePreviewHtmlSinkVerifiedView | null,
  onDomMutation: DomMutationCallback,
  onDomMutationFailure: ((outcome: SafePreviewHtmlSinkFailureOutcome) => void) | undefined,
  onComplete: () => void
): () => void {
  validateWindowChildren(surface, desiredNodes);
  const snapshot = captureSurfaceSnapshot(surface);
  if (!hasExactChildren(surface, desiredNodes)) {
    const selection = surface.ownerDocument.defaultView?.getSelection();
    const fullRootSelection = (() => {
      if (
        !selection
        || selection.isCollapsed
        || !surface.isConnected
        || surface.ownerDocument.activeElement !== surface
        || selection.anchorNode !== surface
        || selection.focusNode !== surface
      ) {
        return null;
      }
      const childCount = surface.childNodes.length;
      if (
        selection.anchorOffset === 0
        && selection.focusOffset === childCount
      ) {
        return 'forward' as const;
      }
      if (
        selection.anchorOffset === childCount
        && selection.focusOffset === 0
      ) {
        return 'backward' as const;
      }
      return null;
    })();
    const rootBoundary = selection?.isCollapsed
      && selection.anchorNode === surface
      && selection.focusNode === surface
      && selection.anchorOffset === selection.focusOffset
      ? 0 === selection.anchorOffset
        ? 'start'
        : surface.childNodes.length === selection.anchorOffset
          ? 'end'
          : null
      : null;
    const preservesSelection = Boolean(
      selection?.anchorNode
      && selection.focusNode
      && selection.anchorNode !== surface
      && selection.focusNode !== surface
      && surface.contains(selection.anchorNode)
      && surface.contains(selection.focusNode)
    );
    if (!preservesSelection) {
      surface.replaceChildren(...desiredNodes);
    } else {
      const desired = new Set(desiredNodes);
      for (const child of Array.from(surface.childNodes)) {
        if (!desired.has(child)) child.remove();
      }
      let cursor = surface.firstChild;
      for (const node of desiredNodes) {
        if (node === cursor) {
          cursor = cursor.nextSibling;
          continue;
        }
        surface.insertBefore(node, cursor);
      }
      if (!hasExactChildren(surface, desiredNodes)) {
        throw new Error('preview-window-node-sequence-invalid');
      }
    }
    if (fullRootSelection && selection) {
      const newChildCount = surface.childNodes.length;
      selection.setBaseAndExtent(
        surface,
        'forward' === fullRootSelection ? 0 : newChildCount,
        surface,
        'forward' === fullRootSelection ? newChildCount : 0
      );
    }
    if (rootBoundary && selection) {
      const range = surface.ownerDocument.createRange();
      range.setStart(
        surface,
        'start' === rootBoundary ? 0 : surface.childNodes.length
      );
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    const mutationError = notifyDomMutation(surface, onDomMutation);
    if (mutationError) {
      restoreAfterDomMutationFailure(
        surface,
        mutationError,
        previous,
        () => restoreSurfaceSnapshot(snapshot, surface),
        onDomMutation,
        onDomMutationFailure
      );
      return () => undefined;
    }
  }
  onComplete();
  return () => undefined;
}

export function SafePreviewHtmlSink({
  acceptedHtml = false,
  ariaBusy = false,
  className,
  contentEditable,
  error = false,
  html,
  htmlRevision = 0,
  label,
  materializeCommit,
  materializeScheduler,
  onDomMutation,
  onDomMutationFailure,
  onDrop,
  onInput,
  onMaterializeComplete,
  onMaterializeFailure,
  onKeyDown,
  onPaste,
  onStagedCommit,
  refreshing = false,
  role,
  spellCheck,
  stagedCommit,
  windowedCommit,
  statusClassName,
  statusMessage,
  statusRole,
  style,
  surfaceRef
}: SafePreviewHtmlSinkProps) {
  const htmlSurfaceRef = useRef<HTMLElement | null>(null);
  const appliedSurfaceStateRef = useRef<AppliedSurfaceState | null>(null);
  const lastVerifiedViewRef = useRef<SafePreviewHtmlSinkVerifiedView | null>(null);
  useImperativeHandle(surfaceRef, () => {
    if (!htmlSurfaceRef.current) throw new Error('preview-surface-missing');
    return htmlSurfaceRef.current;
  }, []);
  useLayoutEffect(() => {
    const surface = htmlSurfaceRef.current;
    if (!surface) throw new Error('preview-surface-missing');
    const appliedSurfaceState = appliedSurfaceStateRef.current;
    const previousVerifiedView = lastVerifiedViewRef.current
      ?? verifiedSinkView(appliedSurfaceState);
    const activeMaterializeCommit = materializeCommit?.revision === htmlRevision
      ? materializeCommit
      : null;
    const windowCommit = windowedCommit?.revision === htmlRevision
      ? windowedCommit
      : null;
    const commit = stagedCommit?.revision === htmlRevision
      ? stagedCommit
      : null;
    if (
      !windowCommit
      &&
      !commit
      && !activeMaterializeCommit
      && appliedSurfaceState
      && appliedSurfaceState.revision === htmlRevision
      && appliedSurfaceState.html === html
      && appliedSurfaceState.statusClassName === statusClassName
      && appliedSurfaceState.statusMessage === statusMessage
      && appliedSurfaceState.statusRole === statusRole
      && null === appliedSurfaceState.windowedCommitKey
    ) {
      return;
    }

    if (
      !windowCommit
      && !commit
      && !activeMaterializeCommit
      && lastVerifiedViewRef.current
      && lastVerifiedViewRef.current.html === html
      && lastVerifiedViewRef.current.htmlRevision === htmlRevision
      && appliedSurfaceState
      && appliedSurfaceState.statusClassName === statusClassName
      && appliedSurfaceState.statusMessage === statusMessage
      && appliedSurfaceState.statusRole === statusRole
      && (
        !lastVerifiedViewRef.current.windowedCommit
        || hasExactChildren(
          surface,
          lastVerifiedViewRef.current.windowedCommit.nodes
        )
      )
    ) {
      return;
    }

    if (activeMaterializeCommit) {
      if (
        appliedSurfaceState
        && appliedSurfaceState.revision === htmlRevision
        && appliedSurfaceState.html === html
        && appliedSurfaceState.statusClassName === statusClassName
        && appliedSurfaceState.statusMessage === statusMessage
        && appliedSurfaceState.statusRole === statusRole
        && appliedSurfaceState.materializeCommitKey === activeMaterializeCommit.key
      ) {
        return undefined;
      }
      const cancelMaterialize = startMaterializeChildrenCommit(
        surface,
        activeMaterializeCommit.nodes,
        materializeScheduler ?? defaultSafePreviewHtmlSinkScheduler(
          surface.ownerDocument
        ),
        onDomMutation,
        appliedSurfaceState,
        () => {
          lastVerifiedViewRef.current = {
            html,
            htmlRevision,
            windowedCommit: null
          };
          appliedSurfaceStateRef.current = {
            html,
            materializeCommitKey: activeMaterializeCommit.key,
            revision: htmlRevision,
            statusClassName,
            statusMessage,
            statusRole,
            windowedCommit: null,
            windowedCommitKey: null
          };
          onMaterializeComplete?.(
            activeMaterializeCommit.revision,
            activeMaterializeCommit.key
          );
        },
        (outcome) => {
          lastVerifiedViewRef.current =
            'restored' === outcome.kind ? outcome.previous : null;
          appliedSurfaceStateRef.current =
            'restored' === outcome.kind && appliedSurfaceState
              ? appliedSurfaceState
              : null;
          onMaterializeFailure?.(
            activeMaterializeCommit.revision,
            activeMaterializeCommit.key,
            outcome
          );
        }
      );
      return () => {
        cancelMaterialize();
        if (
          appliedSurfaceStateRef.current?.materializeCommitKey
          === activeMaterializeCommit.key
        ) {
          appliedSurfaceStateRef.current = appliedSurfaceState;
        }
      };
    }

    if (windowCommit) {
      const committedWindow = windowCommit;
      if (
        appliedSurfaceState
        && appliedSurfaceState.revision === htmlRevision
        && appliedSurfaceState.html === html
        && appliedSurfaceState.statusClassName === statusClassName
        && appliedSurfaceState.statusMessage === statusMessage
        && appliedSurfaceState.statusRole === statusRole
        && appliedSurfaceState.windowedCommitKey === committedWindow.key
      ) {
        return undefined;
      }
      return startWindowChildrenCommit(
        surface,
        committedWindow.nodes,
        previousVerifiedView,
        onDomMutation,
        onDomMutationFailure,
        () => {
          lastVerifiedViewRef.current = {
            html,
            htmlRevision,
            windowedCommit: committedWindow
          };
          appliedSurfaceStateRef.current = {
            html,
            materializeCommitKey: null,
            revision: htmlRevision,
            statusClassName,
            statusMessage,
            statusRole,
            windowedCommit: committedWindow,
            windowedCommitKey: committedWindow.key
          };
          onStagedCommit?.(committedWindow.revision);
        }
      );
    }

    if (commit && appliedSurfaceState?.stagedCommit === commit) {
      const committedNodes = appliedSurfaceState.stagedCommitNodes;
      if (!committedNodes) {
        throw new Error('preview-staged-commit-state-incomplete');
      }
      if (!hasExactChildren(surface, committedNodes)) {
        throw new Error('preview-staged-commit-surface-drifted');
      }
      return undefined;
    }

    if (commit) {
      const snapshot = captureSurfaceSnapshot(surface);
      const protectedReuse = prepareVisualProtectedNodeAdoption(
        Array.from(surface.childNodes),
        commit.nodes,
        Boolean(contentEditable)
      );
      try {
        validateUniqueChildren(protectedReuse.nodes);
        if (!hasExactChildren(surface, protectedReuse.nodes)) {
          surface.replaceChildren(...protectedReuse.nodes);
        }
      } catch (error) {
        const rollbackFailure = runRollbackSteps([
          () => protectedReuse.rollback()
        ]);
        throw rollbackFailure ?? error;
      }
      if (statusMessage) {
        appendStatusMessage(surface, statusClassName, statusMessage, statusRole);
      }
      const mutationError = notifyDomMutation(surface, onDomMutation);
      if (mutationError) {
        restoreAfterDomMutationFailure(
          surface,
          mutationError,
          previousVerifiedView,
          () => {
            const rollbackFailure = runRollbackSteps([
              () => protectedReuse.rollback(),
              () => restoreSurfaceSnapshot(snapshot, surface)
            ]);
            if (rollbackFailure) throw rollbackFailure;
          },
          onDomMutation,
          onDomMutationFailure
        );
        return undefined;
      }
      lastVerifiedViewRef.current = {
        html,
        htmlRevision,
        windowedCommit: null
      };
      appliedSurfaceStateRef.current = {
        html,
        materializeCommitKey: null,
        revision: htmlRevision,
        statusClassName,
        statusMessage,
        statusRole,
        windowedCommit: null,
        windowedCommitKey: null,
        stagedCommit: commit,
        stagedCommitNodes: Array.from(surface.childNodes)
      };
      onStagedCommit?.(commit.revision);
      return undefined;
    }

    const snapshot = captureSurfaceSnapshot(surface);
    if (null !== html) {
      // This is the sole sink for PHP-rendered, server-sanitized Preview HTML.
      surface.innerHTML = html;
    } else {
      surface.replaceChildren();
      if (!statusMessage) {
        const mutationError = notifyDomMutation(surface, onDomMutation);
        if (mutationError) {
          restoreAfterDomMutationFailure(
            surface,
            mutationError,
            previousVerifiedView,
            () => restoreSurfaceSnapshot(snapshot, surface),
            onDomMutation,
            onDomMutationFailure
          );
          return undefined;
        }
        lastVerifiedViewRef.current = {
          html,
          htmlRevision,
          windowedCommit: null
        };
        appliedSurfaceStateRef.current = {
          html,
          materializeCommitKey: null,
          revision: htmlRevision,
          statusClassName,
          statusMessage,
          statusRole,
          windowedCommit: null,
          windowedCommitKey: null
        };
        return undefined;
      }
      appendStatusMessage(surface, statusClassName, statusMessage, statusRole);
    }
    const mutationError = notifyDomMutation(surface, onDomMutation);
    if (mutationError) {
      restoreAfterDomMutationFailure(
        surface,
        mutationError,
        previousVerifiedView,
        () => restoreSurfaceSnapshot(snapshot, surface),
        onDomMutation,
        onDomMutationFailure
      );
      return undefined;
    }
    lastVerifiedViewRef.current = {
      html,
      htmlRevision,
      windowedCommit: null
    };
    appliedSurfaceStateRef.current = {
      html,
      materializeCommitKey: null,
      revision: htmlRevision,
      statusClassName,
      statusMessage,
      statusRole,
      windowedCommit: null,
      windowedCommitKey: null
    };
    return undefined;
  }, [
    html,
    htmlRevision,
    materializeScheduler,
    materializeCommit,
    onDomMutation,
    onDomMutationFailure,
    onMaterializeComplete,
    onMaterializeFailure,
    onStagedCommit,
    stagedCommit,
    statusClassName,
    statusMessage,
    statusRole,
    windowedCommit
  ]);

  return (
    <article
      data-easymde-preview-accepted={acceptedHtml ? '1' : undefined}
      aria-busy={ariaBusy ? 'true' : 'false'}
      aria-label={label}
      aria-live={contentEditable ? undefined : 'polite'}
      className={className}
      contentEditable={contentEditable}
      data-easymde-preview-error={error ? '1' : undefined}
      data-easymde-preview-html-sink="1"
      data-easymde-preview-refreshing={refreshing ? '1' : undefined}
      onDrop={onDrop}
      onInput={onInput}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
      ref={htmlSurfaceRef}
      role={role}
      spellCheck={spellCheck}
      style={style}
      suppressContentEditableWarning={contentEditable}
    />
  );
}
