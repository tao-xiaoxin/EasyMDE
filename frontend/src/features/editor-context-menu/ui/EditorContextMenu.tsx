import {
  createElement,
  createPortal,
  useCallback,
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
  captureEditorContextMenuScrollBaseline,
  editorContextMenuScrollMoved
} from '../editor-context-menu-scroll';
import {
  firstEnabled,
  handleEditorContextMenuKeyDown,
  parentLayerPath
} from './editor-context-menu-keyboard';
import {
  computeOpenSubmenuPositions,
  computeRootMenuPosition,
  measureRootLayout,
  readBoundary,
  sameMeasuredLayout,
  sameRootMenuPosition,
  sameSubmenuPositions,
  type EditorContextMenuMeasuredLayout,
  type EditorContextMenuPosition,
  type EditorContextMenuRootPosition
} from './editor-context-menu-position';
import { MenuLayer } from './EditorContextMenuLayer';

export type { EditorContextMenuPosition } from './editor-context-menu-position';
export type EditorContextMenuDirection = 'ltr' | 'rtl';
export type EditorContextMenuSubmenuActivation = 'keyboard' | 'pointer';

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

function isMenuTarget(target: EventTarget | null): boolean {
  return target instanceof Element
    && Boolean(target.closest('[data-easymde-context-menu-layer], [data-easymde-context-menu-pointer]'));
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
  const hoverPathRef = useRef<string | null>(null);
  const submenuPositionsRef = useRef<Record<string, EditorContextMenuPosition>>({});
  const latestRef = useRef({ direction, model, onAction, onDismiss, onMenuPointerDown });
  latestRef.current = { direction, model, onAction, onDismiss, onMenuPointerDown };
  const lastMeasuredLayoutRef = useRef<EditorContextMenuMeasuredLayout | null>(null);
  const lastClipModelRef = useRef<EditorContextMenuModel | null>(null);
  const scrollBaselineRef = useRef<
    ReturnType<typeof captureEditorContextMenuScrollBaseline> | null
  >(null);
  const positionOpenSubmenusRef = useRef<(closeScrolledDescendants?: boolean) => void>(
    () => undefined
  );
  const initialFocusCancelledRef = useRef(false);
  const [focusPath, setFocusPath] = useState<string | null>(null);
  const [hoverPath, setHoverPath] = useState<string | null>(null);
  const [pointerHovering, setPointerHovering] = useState(false);
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [position, setPosition] = useState<EditorContextMenuRootPosition>({
    left: anchor.x,
    top: anchor.y
  });
  const [submenuPositions, setSubmenuPositions] = useState<
    Record<string, EditorContextMenuPosition>
  >({});

  const ensureMenuContainerFocus = useCallback((): void => {
    const root = rootRef.current;
    const overlay = overlayRef.current;
    if (!root || !overlay) return;
    if (overlay.contains(root.ownerDocument.activeElement)) return;
    root.focus({ preventScroll: true });
  }, []);

  const preserveFocusBeforeSubmenuClose = useCallback(
    (nextOpenPath: string | null): void => {
      const root = rootRef.current;
      const activeElement = root?.ownerDocument.activeElement;
      if (!root || !activeElement) return;
      for (const [layerPath, submenuElement] of submenuRefs.current.entries()) {
        const staysMounted = null !== nextOpenPath
          && (nextOpenPath === layerPath || nextOpenPath.startsWith(`${layerPath}.`));
        if (!staysMounted && submenuElement.contains(activeElement)) {
          root.focus({ preventScroll: true });
          return;
        }
      }
    },
    []
  );

  const handleInteraction = useCallback((): void => {
    initialFocusCancelledRef.current = true;
    ensureMenuContainerFocus();
  }, [ensureMenuContainerFocus]);

  const handleAction = useCallback((id: string): void => {
    latestRef.current.onAction(id);
  }, []);

  const handleDismiss = useCallback((dismiss: EditorContextMenuDismiss): void => {
    latestRef.current.onDismiss(dismiss);
  }, []);

  const handleMenuPointerDown = useCallback((): void => {
    latestRef.current.onMenuPointerDown?.();
  }, []);

  const handleHoverPath = useCallback((nextPath: string | null): void => {
    hoverPathRef.current = nextPath;
    setHoverPath(nextPath);
    if (null !== nextPath) {
      setPointerHovering(true);
      ensureMenuContainerFocus();
    }
  }, [ensureMenuContainerFocus]);

  const clearPointerHover = useCallback((): void => {
    hoverPathRef.current = null;
    setHoverPath(null);
    setPointerHovering(false);
  }, []);

  const syncRootPosition = (mode: 'anchor' | 'reclamp'): void => {
    const root = rootRef.current;
    const windowRef = root?.ownerDocument.defaultView;
    if (!root || !windowRef) {
      if ('anchor' === mode) throw new Error('editor-context-menu-window-unavailable');
      return;
    }
    const boundary = readBoundary(boundaryElement, windowRef);
    if (!boundary) {
      latestRef.current.onDismiss({ restoreFocus: true });
      return;
    }
    const viewport = { height: windowRef.innerHeight, width: windowRef.innerWidth };
    const layout = measureRootLayout(root, boundary);
    lastMeasuredLayoutRef.current = layout;
    if ('anchor' === mode) {
      setPosition(computeRootMenuPosition({
        boundary,
        layout,
        mode: 'anchor',
        origin: { left: anchor.x, top: anchor.y },
        viewport
      }));
      return;
    }
    setPosition((current) => {
      const next = computeRootMenuPosition({
        boundary,
        layout,
        mode: 'reclamp',
        origin: current,
        viewport
      });
      return sameRootMenuPosition(current, next) ? current : next;
    });
    if (openPathRef.current) positionOpenSubmenus();
  };

  const openSubmenu = useCallback((
    path: string,
    children?: ReadonlyArray<EditorContextMenuItem>,
    activation: EditorContextMenuSubmenuActivation = 'keyboard'
  ): void => {
    initialFocusCancelledRef.current = true;
    pendingParentFocus.current = null;
    if ('pointer' === activation) {
      preserveFocusBeforeSubmenuClose(path);
      openPathRef.current = path;
      setOpenPath(path);
      pendingSubmenuFocus.current = null;
      ensureMenuContainerFocus();
      return;
    }
    openPathRef.current = path;
    setOpenPath(path);
    const first = children ? firstEnabled(children, false) : null;
    const firstPath = null === first ? null : `${path}.${first}`;
    if (null !== firstPath) {
      const existingChild = submenuPositionsRef.current[path]
        ? refs.current.get(firstPath)
        : undefined;
      if (existingChild) {
        pendingSubmenuFocus.current = null;
        setFocusPath(firstPath);
        existingChild.focus();
      } else {
        setFocusPath(path);
        pendingSubmenuFocus.current = firstPath;
      }
    } else {
      setFocusPath(path);
      pendingSubmenuFocus.current = null;
    }
  }, [ensureMenuContainerFocus, preserveFocusBeforeSubmenuClose]);

  const closeSubmenusToLayer = useCallback((
    path: string,
    updateFocusPath = true
  ): void => {
    pendingSubmenuFocus.current = null;
    pendingParentFocus.current = null;
    const layerPath = parentLayerPath(path);
    const currentOpenPath = openPathRef.current;
    const nextOpenPath = currentOpenPath
      && (currentOpenPath === layerPath || currentOpenPath.startsWith(`${layerPath}.`))
      ? (layerPath || null)
      : null;
    if (!updateFocusPath) preserveFocusBeforeSubmenuClose(nextOpenPath);
    openPathRef.current = nextOpenPath;
    setOpenPath(nextOpenPath);
    if (updateFocusPath) setFocusPath(path);
  }, [preserveFocusBeforeSubmenuClose]);

  const registerSubmenuRef = useCallback((path: string, element: HTMLDivElement | null): void => {
    if (element) submenuRefs.current.set(path, element);
    else submenuRefs.current.delete(path);
  }, []);

  const positionOpenSubmenus = (closeScrolledDescendants = false): void => {
    const root = rootRef.current;
    const windowRef = root?.ownerDocument.defaultView;
    if (!root || !windowRef) throw new Error('editor-context-menu-window-unavailable');
    if (!readBoundary(boundaryElement, windowRef)) {
      latestRef.current.onDismiss({ restoreFocus: true });
      return;
    }
    const currentOpenPath = openPathRef.current;
    const { focusPathAfterClose, nextOpenPath, nextPositions } = computeOpenSubmenuPositions({
      closeScrolledDescendants,
      direction: latestRef.current.direction,
      openPath: currentOpenPath,
      root,
      submenuRefs: submenuRefs.current,
      triggerRefs: refs.current,
      viewport: { height: windowRef.innerHeight, width: windowRef.innerWidth }
    });
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
    if (!sameSubmenuPositions(submenuPositionsRef.current, nextPositions)) {
      submenuPositionsRef.current = nextPositions;
      setSubmenuPositions(nextPositions);
    }
  };
  positionOpenSubmenusRef.current = positionOpenSubmenus;

  const handleSubmenuScroll = useCallback((): void => {
    positionOpenSubmenusRef.current(true);
  }, []);

  const closeSubmenu = useCallback((parentPath: string): void => {
    initialFocusCancelledRef.current = true;
    pendingSubmenuFocus.current = null;
    pendingParentFocus.current = parentPath;
    const ancestorPath = parentLayerPath(parentPath);
    openPathRef.current = '' === ancestorPath ? null : ancestorPath;
    refs.current.get(parentPath)?.focus({ preventScroll: true });
    setOpenPath('' === ancestorPath ? null : ancestorPath);
    setFocusPath('' === parentPath ? null : parentPath);
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      pendingSubmenuFocus.current = null;
      pendingParentFocus.current = null;
      openPathRef.current = null;
      hoverPathRef.current = null;
      submenuPositionsRef.current = {};
      lastMeasuredLayoutRef.current = null;
      lastClipModelRef.current = null;
      scrollBaselineRef.current = null;
      initialFocusCancelledRef.current = false;
      return;
    }
    initialFocusCancelledRef.current = false;
    syncRootPosition('anchor');
    lastClipModelRef.current = model;
    if (scrollBaselineRef.current) {
      const windowRef = rootRef.current?.ownerDocument.defaultView;
      if (windowRef) {
        scrollBaselineRef.current = captureEditorContextMenuScrollBaseline(
          surfaceElement,
          windowRef
        );
      }
    }
    const first = firstEnabled(model.items, 'last' === initialFocus);
    hoverPathRef.current = null;
    submenuPositionsRef.current = {};
    setOpenPath(null);
    setHoverPath(null);
    setPointerHovering(false);
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
    if (!open || lastClipModelRef.current === model) return;
    lastClipModelRef.current = model;
    syncRootPosition('reclamp');
  }, [model, open]);

  useEffect(() => {
    if (!open) return;
    const root = rootRef.current;
    if (!root || 'undefined' === typeof ResizeObserver) return;
    const observer = new ResizeObserver(() => {
      const windowRef = root.ownerDocument.defaultView;
      if (!windowRef) return;
      const boundary = readBoundary(boundaryElement, windowRef);
      if (boundary && sameMeasuredLayout(lastMeasuredLayoutRef.current, measureRootLayout(root, boundary))) {
        return;
      }
      syncRootPosition('reclamp');
    });
    observer.observe(root);
    if (boundaryElement && boundaryElement !== root) observer.observe(boundaryElement);
    return () => observer.disconnect();
  }, [boundaryElement, open]);

  useLayoutEffect(() => {
    const childPath = pendingSubmenuFocus.current;
    if (childPath && focusPath && submenuPositions[parentLayerPath(childPath)]) {
      const child = refs.current.get(childPath);
      if (child) {
        pendingSubmenuFocus.current = null;
        child.focus();
      }
    }
    const parentPath = pendingParentFocus.current;
    if (parentPath && focusPath === parentPath) {
      const parent = refs.current.get(parentPath);
      if (parent) {
        pendingParentFocus.current = null;
        parent.focus();
      }
    }
  }, [focusPath, submenuPositions]);

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
    // Preview acceptance can restore an ancestor's scroll position before this
    // menu mounts, while its queued native scroll event arrives afterwards.
    // Only movement relative to this listener's opening snapshot dismisses a
    // known container; unrelated external scroll targets are ignored.
    scrollBaselineRef.current = captureEditorContextMenuScrollBaseline(surfaceElement, windowRef);
    const dismissOutside = (event: PointerEvent): void => {
      if (event.target instanceof Node && !root.contains(event.target) && !isMenuTarget(event.target)) {
        latestRef.current.onDismiss({ restoreFocus: true });
      }
    };
    const dismissOutsideContextMenu = (event: MouseEvent): void => {
      if (!(event.target instanceof Node)) return;
      if (root.contains(event.target) || isMenuTarget(event.target) || surfaceElement?.contains(event.target)) {
        return;
      }
      latestRef.current.onDismiss({ restoreFocus: true });
    };
    const handleResize = (): void => syncRootPosition('reclamp');
    const handleDocumentKeyDown = (event: globalThis.KeyboardEvent): void => {
      handleEditorContextMenuKeyDown(event, {
        activeElement: documentRef.activeElement,
        clearPointerHover,
        closeSubmenu,
        closeSubmenusToLayer,
        direction: latestRef.current.direction,
        focusItem: (path) => refs.current.get(path)?.focus(),
        hoverPath: hoverPathRef.current,
        items: latestRef.current.model.items,
        onAction: (id) => latestRef.current.onAction(id),
        onDismiss: (dismiss) => latestRef.current.onDismiss(dismiss),
        openPath: openPathRef.current,
        openSubmenu,
        overlay: overlayRef.current
      });
    };
    const handleScroll = (event: Event): void => {
      if (event.target instanceof Node && overlayRef.current?.contains(event.target)) {
        const target = event.target instanceof Element
          ? event.target.closest<HTMLElement>('.easymde-editor-context-menu__submenu')
          : null;
        if (target) positionOpenSubmenus(true);
        return;
      }
      const baseline = scrollBaselineRef.current;
      if (!baseline || !editorContextMenuScrollMoved(event, baseline, documentRef, windowRef)) return;
      latestRef.current.onDismiss({ restoreFocus: true });
    };
    documentRef.addEventListener('pointerdown', dismissOutside);
    documentRef.addEventListener('contextmenu', dismissOutsideContextMenu, true);
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
  }, [open, boundaryElement, surfaceElement]);

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
        tabIndex={-1}
        onScroll={handleSubmenuScroll}
        style={{
          clipPath: position.clipPath,
          left: `${position.left}px`,
          maxBlockSize: position.maxBlockSize ? `${position.maxBlockSize}px` : undefined,
          top: `${position.top}px`
        }}
      >
        <MenuLayer
          direction={direction}
          focusPath={focusPath}
          hoverPath={hoverPath}
          items={model.items}
          onInteraction={handleInteraction}
          {...(onMenuPointerDown ? { onMenuPointerDown: handleMenuPointerDown } : {})}
          openPath={openPath}
          onAction={handleAction}
          onDismiss={handleDismiss}
          onFocusPath={setFocusPath}
          onHoverPath={handleHoverPath}
          onCloseSubmenusToLayer={closeSubmenusToLayer}
          onOpenSubmenu={openSubmenu}
          onSubmenuScroll={handleSubmenuScroll}
          path=""
          pointerHovering={pointerHovering}
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
