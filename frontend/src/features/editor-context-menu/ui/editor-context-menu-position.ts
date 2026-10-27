export type EditorContextMenuRect = Readonly<{
  bottom: number;
  height: number;
  left: number;
  right: number;
  top: number;
  width: number;
}>;

type EditorContextMenuViewport = Readonly<{
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

const MENU_GAP = 16;
const POINTER_SAFE_EDGE = 24;
const POINTER_OUTSET = 15;

export type EditorContextMenuSubmenuPlacement = 'left' | 'right';

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
  const boundaryLeft = Math.max(8, input.boundary.left);
  const boundaryRight = Math.max(
    boundaryLeft,
    Math.min(input.viewport.width - 8, input.boundary.right)
  );
  const boundaryTop = Math.max(8, input.boundary.top);
  const boundaryBottom = Math.max(
    boundaryTop,
    Math.min(input.viewport.height - 8, input.boundary.bottom)
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
