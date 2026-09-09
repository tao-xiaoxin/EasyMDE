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

type SafePreviewHtmlSinkProps = Readonly<{
  ariaBusy?: boolean;
  className?: string;
  contentEditable?: boolean;
  error?: boolean;
  html: SafePreviewHtml | null;
  htmlRevision?: number;
  label?: string;
  onDrop?: DragEventHandler<HTMLElement>;
  onInput?: FormEventHandler<HTMLElement>;
  onMaterializeComplete?: (revision: number, key: number) => void;
  onMaterializeFailure?: (
    revision: number,
    key: number,
    error: unknown
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
  style?: CSSProperties;
  surfaceRef: Ref<HTMLElement>;
}>;

type AppliedSurfaceState = Readonly<{
  html: SafePreviewHtml | null;
  revision: number;
  statusClassName: string | undefined;
  statusMessage: string | undefined;
  materializeCommitKey: number | null;
  windowedCommitKey: number | null;
}>;

function validateWindowChildren(
  surface: HTMLElement,
  desiredNodes: ReadonlyArray<Node>
): void {
  const desired = new Set<Node>();
  for (const node of desiredNodes) {
    if (desired.has(node) || node.ownerDocument !== surface.ownerDocument) {
      throw new Error('preview-window-node-sequence-invalid');
    }
    desired.add(node);
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

function startMaterializeChildrenCommit(
  surface: HTMLElement,
  desiredNodes: ReadonlyArray<Node>,
  scheduler: SafePreviewHtmlSinkScheduler,
  onComplete: () => void,
  onFailure: (error: unknown) => void
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
  let active = true;
  const rollback = (): void => {
    if (!surface.parentNode) return;
    for (const { attributes, node } of initialSpacerAttributes) {
      for (const attribute of Array.from(node.attributes)) {
        node.removeAttribute(attribute.name);
      }
      for (const { name, value } of attributes) node.setAttribute(name, value);
    }
    surface.replaceChildren(...initialChildren);
    if (canvas) canvas.scrollTop = initialScrollTop;
  };
  const fail = (error: unknown): void => {
    if (!active) return;
    active = false;
    try {
      rollback();
    } catch (rollbackError) {
      onFailure(rollbackError);
      return;
    }
    onFailure(error);
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
    rollback();
  };
}

function startWindowChildrenCommit(
  surface: HTMLElement,
  desiredNodes: ReadonlyArray<Node>,
  onComplete: () => void
): () => void {
  validateWindowChildren(surface, desiredNodes);
  if (!hasExactChildren(surface, desiredNodes)) {
    const selection = surface.ownerDocument.defaultView?.getSelection();
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
  }
  onComplete();
  return () => undefined;
}

export function SafePreviewHtmlSink({
  ariaBusy = false,
  className,
  contentEditable,
  error = false,
  html,
  htmlRevision = 0,
  label,
  materializeCommit,
  materializeScheduler,
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
  style,
  surfaceRef
}: SafePreviewHtmlSinkProps) {
  const htmlSurfaceRef = useRef<HTMLElement | null>(null);
  const appliedSurfaceStateRef = useRef<AppliedSurfaceState | null>(null);
  useImperativeHandle(surfaceRef, () => {
    if (!htmlSurfaceRef.current) throw new Error('preview-surface-missing');
    return htmlSurfaceRef.current;
  }, []);
  useLayoutEffect(() => {
    const surface = htmlSurfaceRef.current;
    if (!surface) throw new Error('preview-surface-missing');
    const appliedSurfaceState = appliedSurfaceStateRef.current;
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
      && null === appliedSurfaceState.windowedCommitKey
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
        () => {
          appliedSurfaceStateRef.current = {
            html,
            materializeCommitKey: activeMaterializeCommit.key,
            revision: htmlRevision,
            statusClassName,
            statusMessage,
            windowedCommitKey: null
          };
          onMaterializeComplete?.(
            activeMaterializeCommit.revision,
            activeMaterializeCommit.key
          );
        },
        (error) => {
          appliedSurfaceStateRef.current = {
            html,
            materializeCommitKey: activeMaterializeCommit.key,
            revision: htmlRevision,
            statusClassName,
            statusMessage,
            windowedCommitKey: null
          };
          onMaterializeFailure?.(
            activeMaterializeCommit.revision,
            activeMaterializeCommit.key,
            error
          );
        }
      );
      return () => {
        cancelMaterialize();
        appliedSurfaceStateRef.current = {
          html,
          materializeCommitKey: null,
          revision: htmlRevision,
          statusClassName,
          statusMessage,
          windowedCommitKey: null
        };
      };
    }

    if (windowCommit) {
      if (
        appliedSurfaceState
        && appliedSurfaceState.revision === htmlRevision
        && appliedSurfaceState.html === html
        && appliedSurfaceState.statusClassName === statusClassName
        && appliedSurfaceState.statusMessage === statusMessage
        && appliedSurfaceState.windowedCommitKey === windowCommit.key
      ) {
        return undefined;
      }
      return startWindowChildrenCommit(
        surface,
        windowCommit.nodes,
        () => {
          appliedSurfaceStateRef.current = {
            html,
            materializeCommitKey: null,
            revision: htmlRevision,
            statusClassName,
            statusMessage,
            windowedCommitKey: windowCommit.key
          };
          onStagedCommit?.(windowCommit.revision);
        }
      );
    }

    if (commit) {
      if (!hasExactChildren(surface, commit.nodes)) {
        surface.replaceChildren(...commit.nodes);
      }
      appliedSurfaceStateRef.current = {
        html,
        materializeCommitKey: null,
        revision: htmlRevision,
        statusClassName,
        statusMessage,
        windowedCommitKey: null
      };
      onStagedCommit?.(commit.revision);
      return undefined;
    }

    if (null !== html) {
      // This is the sole sink for PHP-rendered, server-sanitized Preview HTML.
      surface.innerHTML = html;
    } else {
      surface.replaceChildren();
      if (!statusMessage) {
        appliedSurfaceStateRef.current = {
          html,
          materializeCommitKey: null,
          revision: htmlRevision,
          statusClassName,
          statusMessage,
          windowedCommitKey: null
        };
        return undefined;
      }
      const message = surface.ownerDocument.createElement('p');
      if (statusClassName) message.className = statusClassName;
      message.textContent = statusMessage;
      surface.append(message);
    }
    appliedSurfaceStateRef.current = {
      html,
      materializeCommitKey: null,
      revision: htmlRevision,
      statusClassName,
      statusMessage,
      windowedCommitKey: null
    };
    return undefined;
  }, [
    html,
    htmlRevision,
    materializeScheduler,
    materializeCommit,
    onMaterializeComplete,
    onMaterializeFailure,
    onStagedCommit,
    stagedCommit,
    statusClassName,
    statusMessage,
    windowedCommit
  ]);

  return (
    <article
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
