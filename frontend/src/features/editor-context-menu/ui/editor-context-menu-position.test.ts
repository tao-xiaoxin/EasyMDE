import { describe, expect, it } from 'vitest';

import {
  positionEditorContextSubmenu,
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
    })).toEqual({ left: 176, placement: 'right', pointerTop: 53, top: 252 });
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
    expect(result).toEqual({ left: 84, placement: 'left', pointerTop: 24, top: 281 });
    expect(result.top + result.pointerTop).toBe(rtlTrigger.top + rtlTrigger.height / 2);
  });

  it('flips LTR menus to the left when the forward side is insufficient', () => {
    expect(positionEditorContextSubmenu({
      direction: 'ltr',
      menu: { height: 100, width: 240 },
      trigger: { ...trigger, left: 320, right: 380 },
      boundary,
      viewport: { height: 360, width: 400 }
    })).toEqual({ left: 64, placement: 'left', pointerTop: 53, top: 252 });
  });

  it('clamps RTL menus to the viewport when both sides are narrow', () => {
    expect(positionEditorContextSubmenu({
      direction: 'rtl',
      menu: { height: 100, width: 380 },
      trigger: { ...trigger, left: 120, right: 180, top: 400 },
      boundary,
      viewport: { height: 360, width: 400 }
    })).toEqual({ left: 8, placement: 'left', pointerTop: 76, top: 252 });
  });
});
