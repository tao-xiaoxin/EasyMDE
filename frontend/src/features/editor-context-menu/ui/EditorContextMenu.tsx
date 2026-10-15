import {
  Fragment,
  createElement,
  createPortal,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from '@wordpress/element';
import type {
  CSSProperties,
  KeyboardEvent,
  MutableRefObject,
  MouseEvent as ReactMouseEvent
} from 'react';

import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Bold,
  Code2,
  Clipboard,
  ClipboardCopy,
  ClipboardPaste,
  Copy,
  Download,
  ExternalLink,
  FileCode2,
  Image,
  Link2,
  Pencil,
  Plus,
  Scissors,
  Table2,
  Trash2,
  Upload,
  type LucideIcon,
  WandSparkles,
  ZoomIn
} from '../../../generated/lucide-icons';

import type {
  EditorContextMenuItem,
  EditorContextMenuModel
} from '../editor-context-menu-model';
import {
  positionEditorContextSubmenu,
  type EditorContextMenuBoundary
} from './editor-context-menu-position';

export type EditorContextMenuDirection = 'ltr' | 'rtl';

export type EditorContextMenuPosition = Readonly<{
  clipPath?: string;
  left: number;
  maxBlockSize?: number;
  top: number;
  placement?: 'left' | 'right';
  pointerLeft?: number;
  pointerTop?: number;
}>;

export type EditorContextMenuDismiss = Readonly<{
  restoreFocus: boolean;
}>;

export type EditorContextMenuProps = Readonly<{
  anchor: Readonly<{ x: number; y: number }>;
  ariaLabel?: string;
  direction: EditorContextMenuDirection;
  initialFocus?: 'first' | 'last';
  model: EditorContextMenuModel;
  onAction: (id: string) => void;
  onDismiss: (dismiss: EditorContextMenuDismiss) => void;
  onMenuPointerDown?: () => void;
  onPortalOwnerChange?: (element: HTMLElement | null) => void;
  open: boolean;
  boundaryElement?: HTMLElement;
  surfaceElement?: HTMLElement;
}>;

type MenuLayerProps = Readonly<{
  direction: EditorContextMenuDirection;
  focusPath: string | null;
  hoverPath: string | null;
  items: ReadonlyArray<EditorContextMenuItem>;
  onInteraction: () => void;
  onMenuPointerDown?: () => void;
  openPath: string | null;
  onAction: (id: string) => void;
  onDismiss: (dismiss: EditorContextMenuDismiss) => void;
  onFocusPath: (path: string) => void;
  onHoverPath: (path: string | null) => void;
  onCloseSubmenusToLayer: (path: string) => void;
  onOpenSubmenu: (
    path: string,
    button?: HTMLButtonElement,
    children?: ReadonlyArray<EditorContextMenuItem>
  ) => void;
  onCloseSubmenu: (path: string) => void;
  onSubmenuScroll: () => void;
  path: string;
  portalTarget: HTMLElement | null;
  refs: MutableRefObject<Map<string, HTMLButtonElement>>;
  registerSubmenuRef: (path: string, element: HTMLDivElement | null) => void;
  submenuPositions: Readonly<Record<string, EditorContextMenuPosition>>;
  submenuPosition?: EditorContextMenuPosition | undefined;
  ariaLabel?: string;
}>;

type MenuPosition = Readonly<{
  clipPath?: string;
  left: number;
  maxBlockSize?: number;
  top: number;
}>;

const VIEWPORT_GUTTER = 8;

function visibleBoundary(
  boundary: EditorContextMenuBoundary,
  viewport: Readonly<{ height: number; width: number }>
): EditorContextMenuBoundary {
  const left = Math.max(VIEWPORT_GUTTER, boundary.left);
  const right = Math.max(
    left,
    Math.min(viewport.width - VIEWPORT_GUTTER, boundary.right)
  );
  const top = Math.max(VIEWPORT_GUTTER, boundary.top);
  const bottom = Math.max(
    top,
    Math.min(viewport.height - VIEWPORT_GUTTER, boundary.bottom)
  );
  return { bottom, left, right, top };
}

function availableBlockSize(
  boundary: EditorContextMenuBoundary,
  viewport: Readonly<{ height: number; width: number }>,
  fromTop?: number
): number {
  const visible = visibleBoundary(boundary, viewport);
  const top = Math.max(visible.top, fromTop ?? visible.top);
  const bottom = visible.bottom;
  return Math.max(1, bottom - top);
}

const CONTEXT_MENU_ICONS: Readonly<Record<string, LucideIcon>> = {
  'align-center': AlignCenter,
  'align-left': AlignLeft,
  'align-right': AlignRight,
  'bold': Bold,
  'copy': ClipboardCopy,
  'copy-as-html': FileCode2,
  'copy-as-markdown': ClipboardCopy,
  'copy-paste-as': Clipboard,
  'copy-code-block': ClipboardCopy,
  'copy-code-content': ClipboardCopy,
  'copy-generated': ClipboardCopy,
  'copy-generated-image': Copy,
  'copy-generated-mathml': Code2,
  'copy-generated-source': Code2,
  'copy-image': Copy,
  'copy-table': ClipboardCopy,
  'copy-simplified-formatting': WandSparkles,
  'cut': Scissors,
  'delete-code-block': Trash2,
  'delete-column': Trash2,
  'delete-generated-content': Trash2,
  'delete-image': Trash2,
  'delete-row': Trash2,
  'delete-table': Trash2,
  'delete-thematic-break': Trash2,
  'edit-generated-content': Pencil,
  'save-generated-image': Download,
  'image': Image,
  'image-scale': ZoomIn,
  'image-scale-25': ZoomIn,
  'image-scale-33': ZoomIn,
  'image-scale-50': ZoomIn,
  'image-scale-67': ZoomIn,
  'image-scale-100': ZoomIn,
  'image-scale-150': ZoomIn,
  'image-scale-200': ZoomIn,
  'insert': Plus,
  'insert-column-left': ArrowLeft,
  'insert-column-right': ArrowRight,
  'insert-image': Image,
  'insert-table': Table2,
  'insert-paragraph-above': ArrowUp,
  'insert-paragraph-above-code': ArrowUp,
  'insert-paragraph-above-generated': ArrowUp,
  'insert-paragraph-above-table': ArrowUp,
  'insert-paragraph-below': ArrowDown,
  'insert-paragraph-below-code': ArrowDown,
  'insert-paragraph-below-generated': ArrowDown,
  'insert-paragraph-below-table': ArrowDown,
  'insert-row-above': ArrowUp,
  'insert-row-below': ArrowDown,
  'format-table-source': FileCode2,
  'indent-code-block': ArrowRight,
  'indent-selected-code': ArrowRight,
  'open-link': ExternalLink,
  'paste': ClipboardPaste,
  'paste-plain-text': Clipboard,
  'table': Table2,
  'table-alignment': AlignCenter,
  'upload-image': Upload,
  'code-block': FileCode2,
  'generated-content': WandSparkles,
  'copy-link-address': Link2
};

function panelClipPath(
  left: number,
  top: number,
  width: number,
  height: number,
  boundary: EditorContextMenuBoundary,
  viewport: Readonly<{ height: number; width: number }>
): string | undefined {
  const visibleLeft = Math.max(VIEWPORT_GUTTER, boundary.left);
  const visibleRight = Math.min(viewport.width - VIEWPORT_GUTTER, boundary.right);
  const visibleTop = Math.max(VIEWPORT_GUTTER, boundary.top);
  const visibleBottom = Math.min(viewport.height - VIEWPORT_GUTTER, boundary.bottom);
  const insetTop = Math.max(0, visibleTop - top);
  const insetRight = Math.max(0, left + width - visibleRight);
  const insetBottom = Math.max(0, top + height - visibleBottom);
  const insetLeft = Math.max(0, visibleLeft - left);
  if (0 === insetTop && 0 === insetRight && 0 === insetBottom && 0 === insetLeft) {
    return undefined;
  }
  return `inset(${insetTop}px ${insetRight}px ${insetBottom}px ${insetLeft}px)`;
}

function enabledIndices(items: ReadonlyArray<EditorContextMenuItem>): number[] {
  return items.flatMap((item, index) => item.disabled ? [] : [index]);
}

function firstEnabled(items: ReadonlyArray<EditorContextMenuItem>, last: boolean): number | null {
  const indexes = enabledIndices(items);
  return indexes.length ? indexes[last ? indexes.length - 1 : 0] ?? null : null;
}

function nextEnabled(
  items: ReadonlyArray<EditorContextMenuItem>,
  current: number,
  delta: number
): number | null {
  const indexes = enabledIndices(items);
  if (!indexes.length) return null;
  const currentIndex = Math.max(0, indexes.indexOf(current));
  const nextIndex = (currentIndex + delta + indexes.length) % indexes.length;
  return indexes[nextIndex] ?? null;
}

function itemPath(path: string, index: number): string {
  return '' === path ? String(index) : `${path}.${index}`;
}

function MenuLayer({
  direction,
  focusPath,
  hoverPath,
  items,
  onInteraction,
  onMenuPointerDown,
  openPath,
  onAction,
  onDismiss,
  onFocusPath,
  onHoverPath,
  onCloseSubmenusToLayer,
  onOpenSubmenu,
  onCloseSubmenu,
  onSubmenuScroll,
  path,
  portalTarget,
  refs,
  registerSubmenuRef,
  submenuPositions,
  submenuPosition,
  ariaLabel
}: MenuLayerProps) {
  const focusItem = (index: number | null): void => {
    if (null === index) return;
    const target = refs.current.get(itemPath(path, index));
    target?.focus();
  };

  const handleKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
    item: EditorContextMenuItem,
    currentPath: string
  ): void => {
    onHoverPath(null);
    const forward = 'rtl' === direction ? 'ArrowLeft' : 'ArrowRight';
    const backward = 'rtl' === direction ? 'ArrowRight' : 'ArrowLeft';
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        focusItem(nextEnabled(items, index, 1));
        return;
      case 'ArrowUp':
        event.preventDefault();
        focusItem(nextEnabled(items, index, -1));
        return;
      case 'Home':
        event.preventDefault();
        focusItem(firstEnabled(items, false));
        return;
      case 'End':
        event.preventDefault();
        focusItem(firstEnabled(items, true));
        return;
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        if ('' !== path) {
          onCloseSubmenu(path);
          return;
        }
        onDismiss({ restoreFocus: true });
        return;
      case 'Tab':
        event.preventDefault();
        onDismiss({ restoreFocus: true });
        return;
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (item.disabled) return;
        if ('submenu' === item.kind) {
          onOpenSubmenu(currentPath, event.currentTarget, item.children);
        } else {
          onAction(item.id);
          onDismiss({ restoreFocus: true });
        }
        return;
      default:
        break;
    }

    if (event.key === forward && 'submenu' === item.kind && !item.disabled) {
      event.preventDefault();
      onOpenSubmenu(currentPath, event.currentTarget, item.children);
      return;
    }
    if (event.key === backward && '' !== path) {
      event.preventDefault();
      onCloseSubmenu(path);
    }
  };

  const layer = (
    <div
      aria-label={ariaLabel}
      className={`easymde-editor-context-menu__layer${'' === path ? '' : ' easymde-editor-context-menu__submenu'}${null === hoverPath ? '' : ' is-pointer-hovering'}`}
      data-easymde-context-menu-layer={path || 'root'}
      data-easymde-context-menu-placement={'' === path ? undefined : submenuPosition?.placement}
      dir={direction}
      role="menu"
      ref={'' === path ? undefined : (element) => registerSubmenuRef(path, element)}
      onMouseLeave={(event) => {
        const related = event.relatedTarget;
        if (!(related instanceof Node) || !portalTarget?.contains(related)) {
          onHoverPath(null);
        }
      }}
      onScroll={onSubmenuScroll}
      style={'' === path
        ? undefined
        : submenuPosition
          ? {
              clipPath: submenuPosition.clipPath,
              left: `${submenuPosition.left}px`,
              maxBlockSize: submenuPosition.maxBlockSize
                ? `${submenuPosition.maxBlockSize}px`
                : undefined,
              top: `${submenuPosition.top}px`
            }
          : { visibility: 'hidden' }}
    >
      {items.map((item, index) => {
        const currentPath = itemPath(path, index);
        const childPosition = submenuPositions[currentPath];
        const expanded = openPath === currentPath || Boolean(openPath?.startsWith(`${currentPath}.`));
        const className = `easymde-editor-context-menu__item${expanded ? ' is-expanded' : ''}`;
        const hovered = hoverPath === currentPath;
        const Icon = CONTEXT_MENU_ICONS[item.id];
        return (
          <div className={className} key={item.id}>
            <button
              aria-disabled={item.disabled ? 'true' : 'false'}
              aria-expanded={'submenu' === item.kind ? expanded : undefined}
              aria-haspopup={'submenu' === item.kind ? 'menu' : undefined}
              className={`easymde-editor-context-menu__button${hovered ? ' is-hovered' : ''}`}
              data-easymde-context-menu-item={item.id}
              disabled={item.disabled}
              onClick={() => {
                if (item.disabled) return;
                if ('submenu' === item.kind) {
                  onOpenSubmenu(currentPath, refs.current.get(currentPath), item.children);
                  return;
                }
                onAction(item.id);
                onDismiss({ restoreFocus: true });
              }}
              onFocus={() => {
                onInteraction();
                onFocusPath(currentPath);
                if ('submenu' !== item.kind || item.disabled) {
                  onCloseSubmenusToLayer(currentPath);
                }
              }}
              onKeyDown={(event) => handleKeyDown(event, index, item, currentPath)}
              onMouseDown={(event) => {
                onInteraction();
                event.preventDefault();
              }}
              onPointerDown={(event) => {
                onInteraction();
                event.preventDefault();
                onMenuPointerDown?.();
              }}
              onMouseEnter={(event: ReactMouseEvent<HTMLButtonElement>) => {
                onHoverPath(currentPath);
                if ('submenu' === item.kind && !item.disabled) {
                  onOpenSubmenu(currentPath, event.currentTarget, item.children);
                } else {
                  onCloseSubmenusToLayer(currentPath);
                }
              }}
              ref={(button) => {
                if (button) refs.current.set(currentPath, button);
                else refs.current.delete(currentPath);
              }}
              role="menuitem"
              tabIndex={focusPath === currentPath || ('' === path && null === focusPath && 0 === index) ? 0 : -1}
              type="button"
            >
              {Icon ? (
                <Icon
                  aria-hidden="true"
                  className="easymde-editor-context-menu__icon"
                  size={16}
                  strokeWidth={1.8}
                />
              ) : (
                <span
                  aria-hidden="true"
                  className="easymde-editor-context-menu__icon"
                />
              )}
              <span className="easymde-editor-context-menu__label">{item.label}</span>
              {'shortcut' in item && item.shortcut ? (
                <span className="easymde-editor-context-menu__shortcut">{item.shortcut}</span>
              ) : null}
              {'submenu' === item.kind ? (
                <span aria-hidden="true" className="easymde-editor-context-menu__chevron">
                  {'rtl' === direction ? '‹' : '›'}
                </span>
              ) : null}
            </button>
            {'submenu' === item.kind && expanded
              ? createPortal(
                  <Fragment>
                    {childPosition ? (
                      <span
                        aria-hidden="true"
                        className="easymde-editor-context-menu__pointer"
                        data-easymde-context-menu-layer={currentPath}
                        data-easymde-context-menu-pointer="true"
                        data-easymde-context-menu-pointer-placement={childPosition.placement}
                        style={{
                          left: `${childPosition.pointerLeft ?? childPosition.left}px`,
                          top: `${childPosition.top + (childPosition.pointerTop ?? 20)}px`
                        }}
                      />
                    ) : null}
                    <MenuLayer
                      direction={direction}
                      focusPath={focusPath}
                      hoverPath={hoverPath}
                      items={item.children}
                      onInteraction={onInteraction}
                      {...(onMenuPointerDown ? { onMenuPointerDown } : {})}
                      openPath={openPath}
                      onAction={onAction}
                      onDismiss={onDismiss}
                      onFocusPath={onFocusPath}
                      onHoverPath={onHoverPath}
                      onCloseSubmenusToLayer={onCloseSubmenusToLayer}
                      onOpenSubmenu={onOpenSubmenu}
                      onCloseSubmenu={onCloseSubmenu}
                      onSubmenuScroll={onSubmenuScroll}
                      path={currentPath}
                      portalTarget={portalTarget}
                      refs={refs}
                      registerSubmenuRef={registerSubmenuRef}
                      submenuPositions={submenuPositions}
                      submenuPosition={childPosition}
                      ariaLabel={item.label}
                    />
                  </Fragment>,
                  portalTarget
                    ?? refs.current.get(currentPath)?.ownerDocument.body
                    ?? document.body,
                  currentPath
                )
              : null}
          </div>
        );
      })}
    </div>
  );

  if ('' === path) return layer;

  const frameStyle: CSSProperties & { '--easymde-context-menu-pointer-top'?: string } = submenuPosition
    ? {
        '--easymde-context-menu-pointer-top': `${submenuPosition.pointerTop ?? 20}px`,
        clipPath: submenuPosition.clipPath,
        left: `${submenuPosition.left}px`,
        top: `${submenuPosition.top}px`
      }
    : { visibility: 'hidden' };

  return (
    <div
      className="easymde-editor-context-menu__submenu-frame"
      data-easymde-context-menu-placement={submenuPosition?.placement}
      style={frameStyle}
    >
      {layer}
    </div>
  );
}

export function EditorContextMenu({
  anchor,
  ariaLabel = 'Context menu',
  direction,
  initialFocus = 'first',
  model,
  onAction,
  onDismiss,
  onMenuPointerDown,
  onPortalOwnerChange,
  open,
  boundaryElement,
  surfaceElement
}: EditorContextMenuProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const refs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const submenuRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const pendingParentFocus = useRef<string | null>(null);
  const pendingSubmenuFocus = useRef<string | null>(null);
  const openPathRef = useRef<string | null>(null);
  const initialFocusCancelledRef = useRef(false);
  const [focusPath, setFocusPath] = useState<string | null>(null);
  const [hoverPath, setHoverPath] = useState<string | null>(null);
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [position, setPosition] = useState<MenuPosition>({ left: anchor.x, top: anchor.y });
  const [submenuPositions, setSubmenuPositions] = useState<Record<string, EditorContextMenuPosition>>({});

  const readBoundary = (
    element: HTMLElement | undefined,
    windowRef: Window
  ): EditorContextMenuBoundary | null => {
    if (!element) {
      return {
        bottom: windowRef.innerHeight - VIEWPORT_GUTTER,
        left: VIEWPORT_GUTTER,
        right: windowRef.innerWidth - VIEWPORT_GUTTER,
        top: VIEWPORT_GUTTER
      };
    }
    if (!element.isConnected) return null;
    const rect = element.getBoundingClientRect();
    if (
      rect.right <= VIEWPORT_GUTTER
      || rect.left >= windowRef.innerWidth - VIEWPORT_GUTTER
      || rect.bottom <= VIEWPORT_GUTTER
      || rect.top >= windowRef.innerHeight - VIEWPORT_GUTTER
    ) return null;
    return {
      bottom: rect.bottom,
      left: rect.left,
      right: rect.right,
      top: rect.top
    };
  };

  const surfaceBoundary = (windowRef: Window): EditorContextMenuBoundary | null =>
    readBoundary(boundaryElement, windowRef);

  const viewportBoundary = (windowRef: Window): EditorContextMenuBoundary => ({
    bottom: windowRef.innerHeight - VIEWPORT_GUTTER,
    left: VIEWPORT_GUTTER,
    right: windowRef.innerWidth - VIEWPORT_GUTTER,
    top: VIEWPORT_GUTTER
  });

  const clampPosition = (): boolean => {
    const root = rootRef.current;
    const windowRef = root?.ownerDocument.defaultView;
    if (!root || !windowRef) throw new Error('editor-context-menu-window-unavailable');
    const boundary = surfaceBoundary(windowRef);
    if (!boundary) {
      onDismiss({ restoreFocus: true });
      return false;
    }
    const viewport = { height: windowRef.innerHeight, width: windowRef.innerWidth };
    const bounds = visibleBoundary(boundary, viewport);
    const width = root.offsetWidth || root.getBoundingClientRect().width || 240;
    const measuredHeight = root.offsetHeight || root.getBoundingClientRect().height || 180;
    const height = Math.min(
      measuredHeight,
      availableBlockSize(boundary, viewport)
    );
    const nextLeft = Math.max(
      bounds.left,
      Math.min(anchor.x, Math.max(bounds.left, bounds.right - width))
    );
    const nextTop = Math.max(
      bounds.top,
      Math.min(anchor.y, Math.max(bounds.top, bounds.bottom - height))
    );
    const maxBlockSize = availableBlockSize(boundary, viewport, nextTop);
    const effectiveHeight = Math.min(measuredHeight, maxBlockSize);
    const panelClip = panelClipPath(
      nextLeft,
      nextTop,
      width,
      effectiveHeight,
      boundary,
      viewport
    );
    setPosition({
      ...(panelClip ? { clipPath: panelClip } : {}),
      left: nextLeft,
      maxBlockSize,
      top: nextTop
    });
    return true;
  };

  const updateClip = (): void => {
    const root = rootRef.current;
    const windowRef = root?.ownerDocument.defaultView;
    if (!root || !windowRef) return;
    const boundary = surfaceBoundary(windowRef);
    if (!boundary) {
      onDismiss({ restoreFocus: true });
      return;
    }
    const viewport = { height: windowRef.innerHeight, width: windowRef.innerWidth };
    const bounds = visibleBoundary(boundary, viewport);
    const width = root.offsetWidth || root.getBoundingClientRect().width || 240;
    const measuredHeight = root.offsetHeight || root.getBoundingClientRect().height || 180;
    setPosition((current) => {
      const nextLeft = Math.max(
        bounds.left,
        Math.min(current.left, Math.max(bounds.left, bounds.right - width))
      );
      const fullBoundaryHeight = availableBlockSize(boundary, viewport);
      const nextTop = current.top < bounds.top
        ? bounds.top
        : current.top > bounds.bottom
          ? Math.max(bounds.top, bounds.bottom - Math.min(measuredHeight, fullBoundaryHeight))
          : current.top;
      const maxBlockSize = availableBlockSize(boundary, viewport, nextTop);
      const effectiveHeight = Math.min(measuredHeight, maxBlockSize);
      const panelClip = panelClipPath(
        nextLeft,
        nextTop,
        width,
        effectiveHeight,
        boundary,
        viewport
      );
      const next = {
        ...(panelClip ? { clipPath: panelClip } : {}),
        left: nextLeft,
        maxBlockSize,
        top: nextTop
      };
      if (
        current.left === next.left
        && current.top === next.top
        && current.maxBlockSize === next.maxBlockSize
        && current.clipPath === next.clipPath
      ) return current;
      return next;
    });
    if (openPathRef.current) positionOpenSubmenus();
  };

  const openSubmenu = (
    path: string,
    button?: HTMLButtonElement,
    children?: ReadonlyArray<EditorContextMenuItem>
  ): void => {
    initialFocusCancelledRef.current = true;
    openPathRef.current = path;
    setFocusPath(path);
    setOpenPath(path);
    const first = children ? firstEnabled(children, false) : null;
    pendingSubmenuFocus.current = null === first ? null : `${path}.${first}`;
    if (!button) return;
  };

  const closeSubmenusToLayer = (path: string): void => {
    pendingSubmenuFocus.current = null;
    pendingParentFocus.current = null;
    const layerPath = path.slice(0, path.lastIndexOf('.'));
    const currentOpenPath = openPathRef.current;
    const nextOpenPath = currentOpenPath
      && (currentOpenPath === layerPath || currentOpenPath.startsWith(`${layerPath}.`))
      ? (layerPath || null)
      : null;
    openPathRef.current = nextOpenPath;
    setOpenPath(nextOpenPath);
    setFocusPath(path);
  };

  const registerSubmenuRef = (path: string, element: HTMLDivElement | null): void => {
    if (element) submenuRefs.current.set(path, element);
    else submenuRefs.current.delete(path);
  };

  const positionOpenSubmenus = (closeScrolledDescendants = false): void => {
    const root = rootRef.current;
    const windowRef = root?.ownerDocument.defaultView;
    if (!root || !windowRef) throw new Error('editor-context-menu-window-unavailable');
    const boundary = surfaceBoundary(windowRef);
    if (!boundary) {
      onDismiss({ restoreFocus: true });
      return;
    }
    const childBoundary = viewportBoundary(windowRef);
    const viewportSize = {
      height: windowRef.innerHeight,
      width: windowRef.innerWidth
    };
    const nextPositions: Record<string, EditorContextMenuPosition> = {};
    const positionDeltas = new Map<string, Readonly<{ x: number; y: number }>>();
    const currentOpenPath = openPathRef.current;
    let nextOpenPath = currentOpenPath;
    let focusPathAfterClose: string | null = null;
    const entries = Array.from(submenuRefs.current.entries()).sort(
      ([left], [right]) => left.split('.').length - right.split('.').length
    );
    for (const [path, submenu] of entries) {
      const trigger = refs.current.get(path);
      if (!trigger) continue;
      const triggerRect = trigger.getBoundingClientRect();
      const submenuRect = submenu.getBoundingClientRect();
      const adjustedTrigger = {
        bottom: triggerRect.bottom,
        height: triggerRect.height,
        left: triggerRect.left,
        right: triggerRect.right,
        top: triggerRect.top,
        width: triggerRect.width
      };
      const parentPath = path.slice(0, path.lastIndexOf('.'));
      const parentDelta = positionDeltas.get(parentPath);
      if (parentDelta) {
        adjustedTrigger.left += parentDelta.x;
        adjustedTrigger.right += parentDelta.x;
        adjustedTrigger.top += parentDelta.y;
        adjustedTrigger.bottom += parentDelta.y;
      }
      const submenuWidth = submenuRect.width || submenu.offsetWidth || 240;
      const submenuHeight = submenuRect.height || submenu.offsetHeight || 180;
      const nextPosition = positionEditorContextSubmenu({
        boundary: childBoundary,
        direction,
        menu: {
          height: submenuHeight,
          width: submenuWidth
        },
        trigger: adjustedTrigger,
        viewport: viewportSize
      });
      const maxBlockSize = availableBlockSize(
        childBoundary,
        viewportSize,
        nextPosition.top
      );
      const effectiveHeight = Math.min(submenuHeight, maxBlockSize);
      const clipPath = panelClipPath(
        nextPosition.left,
        nextPosition.top,
        submenuWidth,
        effectiveHeight,
        childBoundary,
        viewportSize
      );
      nextPositions[path] = {
        ...nextPosition,
        ...(clipPath ? { clipPath } : {}),
        maxBlockSize,
        pointerLeft: 'right' === nextPosition.placement
          ? nextPosition.left
          : nextPosition.left + submenuWidth
      };
      const currentLeft = Number.parseFloat(submenu.style.left);
      const currentTop = Number.parseFloat(submenu.style.top);
      positionDeltas.set(path, {
        x: nextPosition.left - (Number.isFinite(currentLeft) ? currentLeft : submenuRect.left),
        y: nextPosition.top - (Number.isFinite(currentTop) ? currentTop : submenuRect.top)
      });
      if (
        closeScrolledDescendants
        && (nextOpenPath === path || nextOpenPath?.startsWith(`${path}.`))
      ) {
        const parentPosition = nextPositions[parentPath];
        const parentElement = parentPath
          ? submenuRefs.current.get(parentPath)
          : root;
        const parentRect = parentElement?.getBoundingClientRect();
        if (parentRect) {
          const parentLeft = parentPosition?.left ?? parentRect.left;
          const parentTop = parentPosition?.top ?? parentRect.top;
          const parentRight = parentLeft + (parentRect.width || parentElement?.offsetWidth || 240);
          const parentBottom = parentTop + (parentRect.height || parentElement?.offsetHeight || 180);
          if (
            adjustedTrigger.bottom <= parentTop
            || adjustedTrigger.top >= parentBottom
            || adjustedTrigger.right <= parentLeft
            || adjustedTrigger.left >= parentRight
          ) {
            nextOpenPath = parentPath || null;
            focusPathAfterClose = path;
          }
        }
      }
    }
    if (nextOpenPath !== currentOpenPath) {
      const nextFocusPath = focusPathAfterClose ?? nextOpenPath;
      pendingParentFocus.current = focusPathAfterClose ?? (nextFocusPath ?? '');
      if (focusPathAfterClose) {
        refs.current.get(focusPathAfterClose)?.focus({ preventScroll: true });
      }
      openPathRef.current = nextOpenPath;
      setFocusPath(nextFocusPath);
      setOpenPath(nextOpenPath);
    }
    setSubmenuPositions(nextPositions);
  };

  const closeSubmenu = (parentPath: string): void => {
    initialFocusCancelledRef.current = true;
    pendingSubmenuFocus.current = null;
    pendingParentFocus.current = parentPath;
    const ancestorPath = parentPath.split('.').slice(0, -1).join('.');
    openPathRef.current = '' === ancestorPath ? null : ancestorPath;
    refs.current.get(parentPath)?.focus({ preventScroll: true });
    setOpenPath('' === ancestorPath ? null : ancestorPath);
    setFocusPath('' === parentPath ? null : parentPath);
  };

  useLayoutEffect(() => {
    if (!open) {
      pendingSubmenuFocus.current = null;
      pendingParentFocus.current = null;
      openPathRef.current = null;
      initialFocusCancelledRef.current = false;
      return;
    }
    initialFocusCancelledRef.current = false;
    clampPosition();
    const first = firstEnabled(model.items, 'last' === initialFocus);
    setOpenPath(null);
    setHoverPath(null);
    setSubmenuPositions({});
    setFocusPath(null);
    const frame = requestAnimationFrame(() => {
      if (
        !initialFocusCancelledRef.current
        && null === openPathRef.current
        && null !== first
      ) {
        refs.current.get(String(first))?.focus();
      }
    });
    openPathRef.current = null;
    return () => cancelAnimationFrame(frame);
  }, [anchor.x, anchor.y, initialFocus, open]);

  useLayoutEffect(() => {
    if (openPath) positionOpenSubmenus();
  }, [direction, openPath, position.left, position.top]);

  useLayoutEffect(() => {
    if (open) updateClip();
  }, [model, open]);

  useEffect(() => {
    if (!open) return;
    const root = rootRef.current;
    if (!root || 'undefined' === typeof ResizeObserver) return;
    const observer = new ResizeObserver(() => updateClip());
    observer.observe(root);
    if (boundaryElement && boundaryElement !== root) observer.observe(boundaryElement);
    return () => observer.disconnect();
  }, [boundaryElement, onDismiss, open, openPath]);

  useLayoutEffect(() => {
    const path = pendingSubmenuFocus.current;
    if (!path || !focusPath) return;
    const parentPath = path.slice(0, path.lastIndexOf('.'));
    if (!submenuPositions[parentPath]) return;
    const child = refs.current.get(path);
    if (!child) return;
    pendingSubmenuFocus.current = null;
    child.focus();
  }, [focusPath, submenuPositions]);

  useLayoutEffect(() => {
    const path = pendingParentFocus.current;
    if (!path || focusPath !== path) return;
    const parent = refs.current.get(path);
    if (!parent) return;
    pendingParentFocus.current = null;
    parent.focus();
  }, [focusPath]);

  useLayoutEffect(() => {
    if (!open) {
      onPortalOwnerChange?.(null);
      return;
    }
    const overlay = overlayRef.current;
    if (!overlay) throw new Error('editor-context-menu-portal-owner-unavailable');
    onPortalOwnerChange?.(overlay);
    return () => onPortalOwnerChange?.(null);
  }, [onPortalOwnerChange, open]);

  useEffect(() => {
    if (!open) return;
    const root = rootRef.current;
    const windowRef = root?.ownerDocument.defaultView;
    const documentRef = root?.ownerDocument;
    if (!root || !windowRef || !documentRef) throw new Error('editor-context-menu-owner-unavailable');
    const isMenuTarget = (target: EventTarget | null): boolean =>
      target instanceof Element
      && Boolean(target.closest(
        '[data-easymde-context-menu-layer], [data-easymde-context-menu-pointer]'
      ));
    const dismissOutside = (event: PointerEvent): void => {
      if (
        event.target instanceof Node
        && !root.contains(event.target)
        && !isMenuTarget(event.target)
      ) {
        onDismiss({ restoreFocus: true });
      }
    };
    const dismissOutsideContextMenu = (event: MouseEvent): void => {
      if (!(event.target instanceof Node)) return;
      if (
        root.contains(event.target)
        || isMenuTarget(event.target)
        || surfaceElement?.contains(event.target)
      ) return;
      onDismiss({ restoreFocus: true });
    };
    documentRef.addEventListener('pointerdown', dismissOutside);
    documentRef.addEventListener('contextmenu', dismissOutsideContextMenu, true);
    const handleResize = (): void => updateClip();
    const handleDocumentKeyDown = (event: globalThis.KeyboardEvent): void => {
      if ('Escape' !== event.key || event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      const currentOpenPath = openPathRef.current;
      if (currentOpenPath) {
        closeSubmenu(currentOpenPath);
        return;
      }
      onDismiss({ restoreFocus: true });
    };
    const handleScroll = (event: Event): void => {
      if (
        event.target instanceof Node
        && overlayRef.current?.contains(event.target)
      ) {
        const target = event.target instanceof Element
          ? event.target.closest<HTMLElement>('.easymde-editor-context-menu__submenu')
          : null;
        if (target) positionOpenSubmenus(true);
        return;
      }
      onDismiss({ restoreFocus: true });
    };
    windowRef.addEventListener('resize', handleResize);
    documentRef.addEventListener('keydown', handleDocumentKeyDown, true);
    windowRef.addEventListener('scroll', handleScroll, true);
    return () => {
      documentRef.removeEventListener('pointerdown', dismissOutside);
      documentRef.removeEventListener('contextmenu', dismissOutsideContextMenu, true);
      windowRef.removeEventListener('resize', handleResize);
      documentRef.removeEventListener('keydown', handleDocumentKeyDown, true);
      windowRef.removeEventListener('scroll', handleScroll, true);
    };
  }, [
    open,
    direction,
    openPath,
    anchor.x,
    anchor.y,
    boundaryElement,
    onDismiss,
    surfaceElement
  ]);

  if (!open) return null;

  const ownerDocument = surfaceElement?.ownerDocument
    ?? boundaryElement?.ownerDocument
    ?? document;
  if (!ownerDocument.body) throw new Error('editor-context-menu-owner-unavailable');

  return createPortal(
    <div
      className="easymde-editor-context-menu__viewport"
      data-easymde-context-menu-viewport="true"
      ref={overlayRef}
      style={{}}
    >
      <div
        className="easymde-editor-context-menu"
        data-easymde-context-menu="true"
        dir={direction}
        ref={rootRef}
        onScroll={() => positionOpenSubmenus(true)}
        style={{
          clipPath: position.clipPath,
          left: `${position.left}px`,
          maxBlockSize: position.maxBlockSize
            ? `${position.maxBlockSize}px`
            : undefined,
          top: `${position.top}px`
        }}
      >
        <MenuLayer
          direction={direction}
          focusPath={focusPath}
          hoverPath={hoverPath}
          items={model.items}
          onInteraction={() => {
            initialFocusCancelledRef.current = true;
          }}
          {...(onMenuPointerDown ? { onMenuPointerDown } : {})}
          openPath={openPath}
          onAction={onAction}
          onDismiss={onDismiss}
          onFocusPath={setFocusPath}
          onHoverPath={setHoverPath}
          onCloseSubmenusToLayer={closeSubmenusToLayer}
          onOpenSubmenu={openSubmenu}
          onCloseSubmenu={closeSubmenu}
          onSubmenuScroll={() => positionOpenSubmenus(true)}
          path=""
          portalTarget={overlayRef.current}
          refs={refs}
          registerSubmenuRef={registerSubmenuRef}
          submenuPositions={submenuPositions}
          ariaLabel={ariaLabel}
        />
      </div>
    </div>,
    ownerDocument.body
  );
}
