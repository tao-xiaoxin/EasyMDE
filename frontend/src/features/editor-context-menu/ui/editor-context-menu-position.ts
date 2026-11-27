import { parentLayerPath } from './editor-context-menu-keyboard';

export type EditorContextMenuRect = Readonly<{
  bottom: number;
  height: number;
  left: number;
  right: number;
  top: number;
  width: number;
}>;

export type EditorContextMenuViewport = Readonly<{
  height: number;
  width: number;
}>;

export type EditorContextMenuBoundary = Readonly<{
  bottom: number;
  left: number;
  right: number;
  top: number;
}>;

type EditorContextMenuSize = Readonly<{
  height: number;
  width: number;
}>;

export type EditorContextMenuSubmenuPlacement = 'left' | 'right';

export type EditorContextMenuPosition = Readonly<{
  clipPath?: string;
  left: number;
  maxBlockSize?: number;
  top: number;
  placement?: EditorContextMenuSubmenuPlacement;
  pointerLeft?: number;
  pointerTop?: number;
}>;

export type EditorContextMenuRootPosition = Readonly<{
  clipPath?: string;
  left: number;
  maxBlockSize?: number;
  top: number;
}>;

export type EditorContextMenuMeasuredLayout = Readonly<{
  boundaryBottom: number;
  boundaryLeft: number;
  boundaryRight: number;
  boundaryTop: number;
  rootHeight: number;
  rootWidth: number;
}>;

const VIEWPORT_GUTTER = 8;
const MENU_GAP = 16;
const POINTER_SAFE_EDGE = 24;
const POINTER_OUTSET = 15;
const FALLBACK_MENU_WIDTH = 240;
const FALLBACK_MENU_HEIGHT = 180;

function viewportBoundary(
  viewport: EditorContextMenuViewport
): EditorContextMenuBoundary {
  return {
    bottom: viewport.height - VIEWPORT_GUTTER,
    left: VIEWPORT_GUTTER,
    right: viewport.width - VIEWPORT_GUTTER,
    top: VIEWPORT_GUTTER
  };
}

export function readBoundary(
  element: HTMLElement | undefined,
  windowRef: Window
): EditorContextMenuBoundary | null {
  if (!element) {
    return viewportBoundary({
      height: windowRef.innerHeight,
      width: windowRef.innerWidth
    });
  }
  if (!element.isConnected) return null;
  const rect = element.getBoundingClientRect();
  if (
    rect.right <= VIEWPORT_GUTTER
    || rect.left >= windowRef.innerWidth - VIEWPORT_GUTTER
    || rect.bottom <= VIEWPORT_GUTTER
    || rect.top >= windowRef.innerHeight - VIEWPORT_GUTTER
  ) {
    return null;
  }
  return {
    bottom: rect.bottom,
    left: rect.left,
    right: rect.right,
    top: rect.top
  };
}

function visibleBoundary(
  boundary: EditorContextMenuBoundary,
  viewport: EditorContextMenuViewport
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
  viewport: EditorContextMenuViewport,
  fromTop?: number
): number {
  const visible = visibleBoundary(boundary, viewport);
  const top = Math.max(visible.top, fromTop ?? visible.top);
  return Math.max(1, visible.bottom - top);
}

function panelClipPath(
  left: number,
  top: number,
  width: number,
  height: number,
  boundary: EditorContextMenuBoundary,
  viewport: EditorContextMenuViewport
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

export function measureRootLayout(
  root: HTMLElement,
  boundary: EditorContextMenuBoundary
): EditorContextMenuMeasuredLayout {
  return {
    boundaryBottom: boundary.bottom,
    boundaryLeft: boundary.left,
    boundaryRight: boundary.right,
    boundaryTop: boundary.top,
    rootHeight: root.offsetHeight || root.getBoundingClientRect().height || FALLBACK_MENU_HEIGHT,
    rootWidth: root.offsetWidth || root.getBoundingClientRect().width || FALLBACK_MENU_WIDTH
  };
}

export function sameMeasuredLayout(
  left: EditorContextMenuMeasuredLayout | null,
  right: EditorContextMenuMeasuredLayout
): boolean {
  return Boolean(
    left
    && left.rootWidth === right.rootWidth
    && left.rootHeight === right.rootHeight
    && left.boundaryLeft === right.boundaryLeft
    && left.boundaryTop === right.boundaryTop
    && left.boundaryRight === right.boundaryRight
    && left.boundaryBottom === right.boundaryBottom
  );
}

export function sameRootMenuPosition(
  left: EditorContextMenuRootPosition,
  right: EditorContextMenuRootPosition
): boolean {
  return (
    left.left === right.left
    && left.top === right.top
    && left.maxBlockSize === right.maxBlockSize
    && left.clipPath === right.clipPath
  );
}

export function sameSubmenuPositions(
  left: Readonly<Record<string, EditorContextMenuPosition>>,
  right: Readonly<Record<string, EditorContextMenuPosition>>
): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  for (const key of leftKeys) {
    const leftValue = left[key];
    const rightValue = right[key];
    if (!leftValue || !rightValue) return false;
    if (
      leftValue.left !== rightValue.left
      || leftValue.top !== rightValue.top
      || leftValue.placement !== rightValue.placement
      || leftValue.pointerLeft !== rightValue.pointerLeft
      || leftValue.pointerTop !== rightValue.pointerTop
      || leftValue.maxBlockSize !== rightValue.maxBlockSize
      || leftValue.clipPath !== rightValue.clipPath
    ) {
      return false;
    }
  }
  return true;
}

export function computeRootMenuPosition(input: Readonly<{
  boundary: EditorContextMenuBoundary;
  layout: EditorContextMenuMeasuredLayout;
  mode: 'anchor' | 'reclamp';
  origin: Readonly<{ left: number; top: number }>;
  viewport: EditorContextMenuViewport;
}>): EditorContextMenuRootPosition {
  const { boundary, layout, mode, origin, viewport } = input;
  const bounds = visibleBoundary(boundary, viewport);
  const width = layout.rootWidth;
  const measuredHeight = layout.rootHeight;
  const fullBoundaryHeight = availableBlockSize(boundary, viewport);
  const nextLeft = Math.max(
    bounds.left,
    Math.min(origin.left, Math.max(bounds.left, bounds.right - width))
  );
  const nextTop = 'anchor' === mode
    ? Math.max(
        bounds.top,
        Math.min(
          origin.top,
          Math.max(bounds.top, bounds.bottom - Math.min(measuredHeight, fullBoundaryHeight))
        )
      )
    : origin.top < bounds.top
      ? bounds.top
      : origin.top > bounds.bottom
        ? Math.max(bounds.top, bounds.bottom - Math.min(measuredHeight, fullBoundaryHeight))
        : origin.top;
  const maxBlockSize = availableBlockSize(boundary, viewport, nextTop);
  const effectiveHeight = Math.min(measuredHeight, maxBlockSize);
  const clipPath = panelClipPath(
    nextLeft,
    nextTop,
    width,
    effectiveHeight,
    boundary,
    viewport
  );
  return {
    ...(clipPath ? { clipPath } : {}),
    left: nextLeft,
    maxBlockSize,
    top: nextTop
  };
}

export function positionEditorContextSubmenu(input: Readonly<{
  direction: 'ltr' | 'rtl';
  menu: EditorContextMenuSize;
  trigger: EditorContextMenuRect;
  boundary: EditorContextMenuBoundary;
  viewport: EditorContextMenuViewport;
}>): Readonly<{
  left: number;
  placement: EditorContextMenuSubmenuPlacement;
  pointerTop: number;
  top: number;
}> {
  const boundaryLeft = Math.max(VIEWPORT_GUTTER, input.boundary.left);
  const boundaryRight = Math.max(
    boundaryLeft,
    Math.min(input.viewport.width - VIEWPORT_GUTTER, input.boundary.right)
  );
  const boundaryTop = Math.max(VIEWPORT_GUTTER, input.boundary.top);
  const boundaryBottom = Math.max(
    boundaryTop,
    Math.min(input.viewport.height - VIEWPORT_GUTTER, input.boundary.bottom)
  );
  const preferredLeft = 'ltr' === input.direction
    ? input.trigger.right + MENU_GAP
    : input.trigger.left - input.menu.width - MENU_GAP;
  const oppositeLeft = 'ltr' === input.direction
    ? input.trigger.left - input.menu.width - MENU_GAP
    : input.trigger.right + MENU_GAP;
  const preferredPlacement: EditorContextMenuSubmenuPlacement =
    'ltr' === input.direction ? 'right' : 'left';
  const oppositePlacement: EditorContextMenuSubmenuPlacement =
    'right' === preferredPlacement ? 'left' : 'right';
  const fits = (
    left: number,
    placement: EditorContextMenuSubmenuPlacement
  ): boolean => {
    const panelRight = left + input.menu.width;
    return left >= boundaryLeft
      && panelRight <= boundaryRight
      && ('right' === placement
        ? left >= boundaryLeft + POINTER_OUTSET
        : panelRight <= boundaryRight - POINTER_OUTSET);
  };
  const placement = fits(preferredLeft, preferredPlacement)
    ? preferredPlacement
    : fits(oppositeLeft, oppositePlacement)
      ? oppositePlacement
      : preferredPlacement;
  const candidateLeft = preferredPlacement === placement
    ? preferredLeft
    : oppositeLeft;
  const minLeft = 'right' === placement
    ? boundaryLeft + POINTER_OUTSET
    : boundaryLeft;
  const maxLeft = Math.max(
    minLeft,
    boundaryRight
      - ('left' === placement ? POINTER_OUTSET : 0)
      - input.menu.width
  );
  const nextLeft = Math.max(minLeft, Math.min(maxLeft, candidateLeft));
  const minTop = boundaryTop;
  const maxTop = Math.max(minTop, boundaryBottom - input.menu.height);
  const preferredTop = input.trigger.top + input.trigger.height / 2 - POINTER_SAFE_EDGE;
  const nextTop = Math.max(minTop, Math.min(maxTop, preferredTop));
  const pointerMax = Math.max(POINTER_SAFE_EDGE, input.menu.height - POINTER_SAFE_EDGE);
  const pointerTop = Math.max(
    POINTER_SAFE_EDGE,
    Math.min(pointerMax, input.trigger.top + input.trigger.height / 2 - nextTop)
  );
  return {
    left: nextLeft,
    placement,
    pointerTop,
    top: nextTop
  };
}

export function computeOpenSubmenuPositions(input: Readonly<{
  closeScrolledDescendants: boolean;
  direction: 'ltr' | 'rtl';
  openPath: string | null;
  root: HTMLElement;
  submenuRefs: ReadonlyMap<string, HTMLDivElement>;
  triggerRefs: ReadonlyMap<string, HTMLButtonElement>;
  viewport: EditorContextMenuViewport;
}>): Readonly<{
  focusPathAfterClose: string | null;
  nextOpenPath: string | null;
  nextPositions: Record<string, EditorContextMenuPosition>;
}> {
  const {
    closeScrolledDescendants,
    direction,
    openPath,
    root,
    submenuRefs,
    triggerRefs,
    viewport
  } = input;
  const childBoundary = viewportBoundary(viewport);
  const nextPositions: Record<string, EditorContextMenuPosition> = {};
  const positionDeltas = new Map<string, Readonly<{ x: number; y: number }>>();
  let nextOpenPath = openPath;
  let focusPathAfterClose: string | null = null;
  const entries = Array.from(submenuRefs.entries()).sort(
    ([left], [right]) => left.split('.').length - right.split('.').length
  );

  for (const [path, submenu] of entries) {
    const trigger = triggerRefs.get(path);
    if (!trigger) continue;
    const triggerRect = trigger.getBoundingClientRect();
    const submenuRect = submenu.getBoundingClientRect();
    const parentPath = parentLayerPath(path);
    const parentDelta = positionDeltas.get(parentPath);
    const adjustedTrigger = {
      bottom: triggerRect.bottom + (parentDelta?.y ?? 0),
      height: triggerRect.height,
      left: triggerRect.left + (parentDelta?.x ?? 0),
      right: triggerRect.right + (parentDelta?.x ?? 0),
      top: triggerRect.top + (parentDelta?.y ?? 0),
      width: triggerRect.width
    };
    const submenuWidth = submenuRect.width || submenu.offsetWidth || FALLBACK_MENU_WIDTH;
    const submenuHeight = submenuRect.height || submenu.offsetHeight || FALLBACK_MENU_HEIGHT;
    const nextPosition = positionEditorContextSubmenu({
      boundary: childBoundary,
      direction,
      menu: { height: submenuHeight, width: submenuWidth },
      trigger: adjustedTrigger,
      viewport
    });
    const maxBlockSize = availableBlockSize(
      childBoundary,
      viewport,
      nextPosition.top
    );
    const clipPath = panelClipPath(
      nextPosition.left,
      nextPosition.top,
      submenuWidth,
      Math.min(submenuHeight, maxBlockSize),
      childBoundary,
      viewport
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
      const parentElement = parentPath ? submenuRefs.get(parentPath) : root;
      const parentRect = parentElement?.getBoundingClientRect();
      if (parentRect) {
        const parentLeft = parentPosition?.left ?? parentRect.left;
        const parentTop = parentPosition?.top ?? parentRect.top;
        const parentRight = parentLeft + (parentRect.width || parentElement?.offsetWidth || FALLBACK_MENU_WIDTH);
        const parentBottom = parentTop + (parentRect.height || parentElement?.offsetHeight || FALLBACK_MENU_HEIGHT);
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

  return { focusPathAfterClose, nextOpenPath, nextPositions };
}
