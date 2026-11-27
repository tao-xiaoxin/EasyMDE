import type { EditorContextMenuItem } from '../editor-context-menu-model';

export type EditorContextMenuKeyboardContext = Readonly<{
  activeElement: Element | null;
  clearPointerHover: () => void;
  closeSubmenu: (parentPath: string) => void;
  closeSubmenusToLayer: (path: string, updateFocusPath?: boolean) => void;
  direction: 'ltr' | 'rtl';
  focusItem: (path: string) => void;
  hoverPath: string | null;
  items: ReadonlyArray<EditorContextMenuItem>;
  onAction: (id: string) => void;
  onDismiss: (dismiss: Readonly<{ restoreFocus: boolean }>) => void;
  openPath: string | null;
  openSubmenu: (
    path: string,
    children?: ReadonlyArray<EditorContextMenuItem>,
    activation?: 'keyboard' | 'pointer'
  ) => void;
  overlay: HTMLElement | null;
}>;

function enabledIndices(items: ReadonlyArray<EditorContextMenuItem>): number[] {
  return items.flatMap((item, index) => (item.disabled ? [] : [index]));
}

export function firstEnabled(
  items: ReadonlyArray<EditorContextMenuItem>,
  last: boolean
): number | null {
  const indexes = enabledIndices(items);
  return indexes.length ? (indexes[last ? indexes.length - 1 : 0] ?? null) : null;
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

export function parentLayerPath(path: string): string {
  const separator = path.lastIndexOf('.');
  return -1 === separator ? '' : path.slice(0, separator);
}

function itemsAtLayer(
  rootItems: ReadonlyArray<EditorContextMenuItem>,
  layerPath: string
): ReadonlyArray<EditorContextMenuItem> | null {
  if ('' === layerPath) return rootItems;
  const segments = layerPath.split('.');
  let current = rootItems;
  for (const segment of segments) {
    const index = Number(segment);
    const entry = Number.isInteger(index) ? current[index] : undefined;
    if ('submenu' !== entry?.kind) return null;
    current = entry.children;
  }
  return current;
}

function itemAtPath(
  rootItems: ReadonlyArray<EditorContextMenuItem>,
  path: string
): Readonly<{
  index: number;
  item: EditorContextMenuItem;
  items: ReadonlyArray<EditorContextMenuItem>;
  layerPath: string;
}> | null {
  const layerPath = parentLayerPath(path);
  const items = itemsAtLayer(rootItems, layerPath);
  if (!items) return null;
  const lastSegment = '' === layerPath ? path : path.slice(layerPath.length + 1);
  const index = Number(lastSegment);
  const item = Number.isInteger(index) ? items[index] : undefined;
  if (!item) return null;
  return { index, item, items, layerPath };
}

function menuItemPathFromNode(
  node: EventTarget | null,
  overlay: HTMLElement | null
): string | null {
  if (!(node instanceof Element) || !overlay) return null;
  const menuItem = node.closest<HTMLElement>(
    '[role="menuitem"][data-easymde-context-menu-path]'
  );
  if (!menuItem || !overlay.contains(menuItem)) return null;
  return menuItem.dataset.easymdeContextMenuPath ?? null;
}

function layerItemPath(layerPath: string, index: number): string {
  return '' === layerPath ? String(index) : `${layerPath}.${index}`;
}

export function handleEditorContextMenuKeyDown(
  event: globalThis.KeyboardEvent,
  context: EditorContextMenuKeyboardContext
): void {
  if (event.defaultPrevented) return;

  const {
    activeElement,
    clearPointerHover,
    closeSubmenu,
    closeSubmenusToLayer,
    direction,
    focusItem,
    hoverPath,
    items,
    onAction,
    onDismiss,
    openPath,
    openSubmenu,
    overlay
  } = context;

  const forward = 'rtl' === direction ? 'ArrowLeft' : 'ArrowRight';
  const backward = 'rtl' === direction ? 'ArrowRight' : 'ArrowLeft';
  const isNavigationKey =
    'ArrowDown' === event.key
    || 'ArrowUp' === event.key
    || 'Home' === event.key
    || 'End' === event.key
    || 'ArrowRight' === event.key
    || 'ArrowLeft' === event.key;
  const isActivationKey = 'Enter' === event.key || ' ' === event.key;

  if (
    'Escape' !== event.key
    && 'Tab' !== event.key
    && !isNavigationKey
    && !isActivationKey
  ) {
    return;
  }

  const originPath =
    hoverPath
    ?? menuItemPathFromNode(event.target, overlay)
    ?? menuItemPathFromNode(activeElement, overlay);

  if ('Escape' === event.key) {
    event.preventDefault();
    event.stopPropagation();
    clearPointerHover();
    if (openPath) {
      closeSubmenu(openPath);
      return;
    }
    onDismiss({ restoreFocus: true });
    return;
  }

  if ('Tab' === event.key) {
    event.preventDefault();
    event.stopPropagation();
    clearPointerHover();
    onDismiss({ restoreFocus: true });
    return;
  }

  if (null === originPath) {
    if (!isNavigationKey) return;
    event.preventDefault();
    event.stopPropagation();
    clearPointerHover();
    const targetLayerPath = openPath ?? '';
    if (event.key === backward && '' !== targetLayerPath) {
      closeSubmenu(targetLayerPath);
      return;
    }
    const layerItems = itemsAtLayer(items, targetLayerPath);
    if (!layerItems) return;
    const targetIndex = firstEnabled(
      layerItems,
      'ArrowUp' === event.key || 'End' === event.key
    );
    if (null === targetIndex) return;
    focusItem(layerItemPath(targetLayerPath, targetIndex));
    return;
  }

  const entry = itemAtPath(items, originPath);
  if (!entry) return;
  event.preventDefault();
  event.stopPropagation();
  clearPointerHover();

  const focusLayerIndex = (targetIndex: number | null): void => {
    if (null === targetIndex) return;
    const nextPath = layerItemPath(entry.layerPath, targetIndex);
    closeSubmenusToLayer(nextPath, true);
    focusItem(nextPath);
  };

  switch (event.key) {
    case 'ArrowDown':
      focusLayerIndex(nextEnabled(entry.items, entry.index, 1));
      return;
    case 'ArrowUp':
      focusLayerIndex(nextEnabled(entry.items, entry.index, -1));
      return;
    case 'Home':
      focusLayerIndex(firstEnabled(entry.items, false));
      return;
    case 'End':
      focusLayerIndex(firstEnabled(entry.items, true));
      return;
    case 'Enter':
    case ' ':
      if (entry.item.disabled) return;
      if ('submenu' === entry.item.kind) {
        openSubmenu(originPath, entry.item.children, 'keyboard');
      } else {
        onAction(entry.item.id);
        onDismiss({ restoreFocus: true });
      }
      return;
    default:
      break;
  }

  if (event.key === forward) {
    if ('submenu' === entry.item.kind && !entry.item.disabled) {
      openSubmenu(originPath, entry.item.children, 'keyboard');
    } else {
      focusItem(originPath);
    }
    return;
  }

  if (event.key === backward) {
    if ('' !== entry.layerPath) {
      closeSubmenu(entry.layerPath);
    } else if (
      openPath === originPath
      || openPath?.startsWith(`${originPath}.`)
    ) {
      closeSubmenu(originPath);
    } else {
      focusItem(originPath);
    }
  }
}
