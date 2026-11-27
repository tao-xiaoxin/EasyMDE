import { describe, expect, it } from 'vitest';

import {
  computeRootMenuPosition,
  positionEditorContextSubmenu,
  sameSubmenuPositions,
  type EditorContextMenuPosition,
  type EditorContextMenuRect
} from './editor-context-menu-position';

describe('positionEditorContextSubmenu', () => {
  const trigger: EditorContextMenuRect = {
    bottom: 320,
    height: 30,
    left: 100,
    right: 160,
    top: 290,
    width: 60
  };
  const boundary = { bottom: 360, left: 0, right: 400, top: 0 };


  it('places LTR forward menus to the right and clamps both axes', () => {
    expect(positionEditorContextSubmenu({
      direction: 'ltr',
      menu: { height: 100, width: 200 },
      trigger,
      boundary,
      viewport: { height: 360, width: 400 }
    })).toEqual({
      left: 176,
      overlapped: false,
      placement: 'right',
      pointerTop: 53,
      top: 252
    });
  });

  it('keeps RTL submenus on the fixed left side when it fits', () => {
    const rtlTrigger = { ...trigger, left: 180, right: 240 };
    const result = positionEditorContextSubmenu({
      direction: 'rtl',
      menu: { height: 100, width: 80 },
      trigger: rtlTrigger,
      boundary: { ...boundary, bottom: 492 },
      viewport: { height: 500, width: 400 }
    });
    expect(result).toEqual({
      left: 84,
      overlapped: false,
      placement: 'left',
      pointerTop: 24,
      top: 281
    });
    if (result.overlapped) throw new Error('expected-non-overlapped-rtl-submenu');
    expect(result.top + result.pointerTop).toBe(rtlTrigger.top + rtlTrigger.height / 2);
  });

  it('flips LTR menus to the left when the forward side is insufficient', () => {
    expect(positionEditorContextSubmenu({
      direction: 'ltr',
      menu: { height: 100, width: 240 },
      trigger: { ...trigger, left: 320, right: 380 },
      boundary,
      viewport: { height: 360, width: 400 }
    })).toEqual({
      left: 64,
      overlapped: false,
      placement: 'left',
      pointerTop: 53,
      top: 252
    });
  });

  it('marks RTL menus overlapped and uses the wider side without pointer outset when both sides are narrow', () => {
    expect(positionEditorContextSubmenu({
      direction: 'rtl',
      menu: { height: 100, width: 380 },
      trigger: { ...trigger, left: 120, right: 180, top: 400 },
      boundary,
      viewport: { height: 360, width: 400 }
    })).toEqual({
      left: 12,
      overlapped: true,
      placement: 'right',
      top: 252
    });
  });

  it('marks narrow LTR submenus overlapped toward the side with more horizontal room inside the viewport gutter', () => {
    const narrowViewport = { height: 800, width: 390 };
    const narrowBoundary = { bottom: 792, left: 8, right: 382, top: 8 };

    const moreSpaceRight = positionEditorContextSubmenu({
      direction: 'ltr',
      menu: { height: 120, width: 220 },
      trigger: { bottom: 130, height: 30, left: 26, right: 234, top: 100, width: 208 },
      boundary: narrowBoundary,
      viewport: narrowViewport
    });
    expect(moreSpaceRight).toEqual({
      left: 162,
      overlapped: true,
      placement: 'right',
      top: 91
    });
    expect(moreSpaceRight.left + 220).toBe(382);

    const moreSpaceLeft = positionEditorContextSubmenu({
      direction: 'ltr',
      menu: { height: 120, width: 220 },
      trigger: { bottom: 130, height: 30, left: 156, right: 364, top: 100, width: 208 },
      boundary: narrowBoundary,
      viewport: narrowViewport
    });
    expect(moreSpaceLeft).toEqual({
      left: 8,
      overlapped: true,
      placement: 'left',
      top: 91
    });
  });

  it('tie-breaks overlapped submenus to the preferred direction when both sides have equal space', () => {
    const viewport = { height: 600, width: 360 };
    const symmetricBoundary = { bottom: 592, left: 8, right: 352, top: 8 };
    const centeredTrigger: EditorContextMenuRect = {
      bottom: 130,
      height: 30,
      left: 80,
      right: 280,
      top: 100,
      width: 200
    };

    const ltrResult = positionEditorContextSubmenu({
      direction: 'ltr',
      menu: { height: 100, width: 220 },
      trigger: centeredTrigger,
      boundary: symmetricBoundary,
      viewport
    });
    expect(ltrResult.overlapped).toBe(true);
    expect(ltrResult.placement).toBe('right');
    expect(ltrResult.left).toBe(132);

    const rtlResult = positionEditorContextSubmenu({
      direction: 'rtl',
      menu: { height: 100, width: 220 },
      trigger: centeredTrigger,
      boundary: symmetricBoundary,
      viewport
    });
    expect(rtlResult.overlapped).toBe(true);
    expect(rtlResult.placement).toBe('left');
    expect(rtlResult.left).toBe(8);
  });
});

describe('computeRootMenuPosition', () => {
  it('keeps horizontal clamping inside a wide-enough boundary', () => {
    const boundary = { bottom: 400, left: 0, right: 220, top: 0 };
    const position = computeRootMenuPosition({
      boundary,
      layout: {
        boundaryBottom: boundary.bottom,
        boundaryLeft: boundary.left,
        boundaryRight: boundary.right,
        boundaryTop: boundary.top,
        rootHeight: 56,
        rootWidth: 180
      },
      mode: 'reclamp',
      origin: { left: 100, top: 100 },
      viewport: { height: 600, width: 800 }
    });

    expect(position).toEqual({
      left: 40,
      maxBlockSize: 300,
      top: 100
    });
  });

  it('expands horizontal bounds to the viewport when the boundary is narrower than the root menu', () => {
    const boundary = { bottom: 400, left: 20, right: 180, top: 60 };
    const anchored = computeRootMenuPosition({
      boundary,
      layout: {
        boundaryBottom: boundary.bottom,
        boundaryLeft: boundary.left,
        boundaryRight: boundary.right,
        boundaryTop: boundary.top,
        rootHeight: 140,
        rootWidth: 220
      },
      mode: 'anchor',
      origin: { left: 120, top: 100 },
      viewport: { height: 800, width: 640 }
    });

    expect(anchored).toEqual({
      left: 120,
      maxBlockSize: 300,
      top: 100
    });
    expect(anchored.clipPath).toBeUndefined();

    const clampedNearRightEdge = computeRootMenuPosition({
      boundary,
      layout: {
        boundaryBottom: boundary.bottom,
        boundaryLeft: boundary.left,
        boundaryRight: boundary.right,
        boundaryTop: boundary.top,
        rootHeight: 140,
        rootWidth: 220
      },
      mode: 'anchor',
      origin: { left: 500, top: 320 },
      viewport: { height: 800, width: 640 }
    });

    expect(clampedNearRightEdge.left).toBe(412);
    expect(clampedNearRightEdge.top).toBe(260);
    expect(clampedNearRightEdge.maxBlockSize).toBe(140);
    expect(clampedNearRightEdge.clipPath).toBeUndefined();
  });
});

describe('sameSubmenuPositions', () => {
  const attachedPosition: EditorContextMenuPosition = {
    left: 162,
    maxBlockSize: 400,
    overlapped: false,
    placement: 'right',
    pointerLeft: 162,
    pointerTop: 24,
    top: 91
  };
  const overlappedPosition: EditorContextMenuPosition = {
    left: 162,
    maxBlockSize: 400,
    overlapped: true,
    placement: 'right',
    top: 91
  };

  it('detects transitions between attached and overlapped submenu layouts', () => {
    expect(
      sameSubmenuPositions({ '0': attachedPosition }, { '0': overlappedPosition })
    ).toBe(false);
    expect(
      sameSubmenuPositions({ '0': overlappedPosition }, { '0': attachedPosition })
    ).toBe(false);
    expect(
      sameSubmenuPositions({ '0': overlappedPosition }, { '0': { ...overlappedPosition } })
    ).toBe(true);
    expect(
      sameSubmenuPositions(
        { '0': attachedPosition },
        { '0': { ...attachedPosition, pointerTop: 32 } }
      )
    ).toBe(false);
  });
});
