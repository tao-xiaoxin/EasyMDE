import {
  createElement,
  createPortal,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from '@wordpress/element';

import type {
  EditorContextMenuItem,
  EditorContextMenuModel
} from '../editor-context-menu-model';
import {
  positionEditorContextSubmenu,
  type EditorContextMenuBoundary
} from './editor-context-menu-position';
import { MenuLayer, firstEnabled } from './EditorContextMenuLayer';

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

/**
 * The single menu presenter: one portal host, boundary-aware root/submenu
 * positioning, outside/scroll/resize dismissal, and focus restoration live
 * here. `MenuLayer` renders recursive layers inside this owner's host and never
 * creates a second portal or dismissal authority.
 */
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
