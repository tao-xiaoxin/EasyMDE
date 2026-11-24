import {
  Fragment,
  createElement,
  createPortal
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
  Check,
  Code2,
  Clipboard,
  ClipboardCopy,
  ClipboardPaste,
  Copy,
  FileCode2,
  Hash,
  Image,
  Link2,
  Pencil,
  Pilcrow,
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
} from '../editor-context-menu-model';
import type {
  EditorContextMenuDirection,
  EditorContextMenuDismiss,
  EditorContextMenuPosition
} from './EditorContextMenu';

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
  'insert-image-above': Image,
  'insert-image-below': Image,
  'insert-paragraph-above': Pilcrow,
  'insert-paragraph-above-code': Pilcrow,
  'insert-paragraph-above-generated': Pilcrow,
  'insert-paragraph-above-table': Pilcrow,
  'insert-paragraph-below': Pilcrow,
  'insert-paragraph-below-code': Pilcrow,
  'insert-paragraph-below-generated': Pilcrow,
  'insert-paragraph-below-table': Pilcrow,
  'insert-row-above': ArrowUp,
  'insert-row-below': ArrowDown,
  'insert-table-above': Table2,
  'insert-table-below': Table2,
  'format-table-source': FileCode2,
  'indent-code-block': ArrowRight,
  'indent-selected-code': ArrowRight,
  'paste': ClipboardPaste,
  'paste-plain-text': Clipboard,
  'table': Table2,
  'table-alignment': AlignCenter,
  'upload-image': Upload,
  'code-block': FileCode2,
  'generated-content': WandSparkles,
  'copy-link-address': Link2
};

function enabledIndices(items: ReadonlyArray<EditorContextMenuItem>): number[] {
  return items.flatMap((item, index) => item.disabled ? [] : [index]);
}

export function firstEnabled(
  items: ReadonlyArray<EditorContextMenuItem>,
  last: boolean
): number | null {
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

/**
 * One recursive menu layer. The outer EditorContextMenu owns the single
 * portal host, positioning, dismissal, and focus restoration; this component
 * only renders the current layer and its submenu layers into that host.
 */
export function MenuLayer({
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
        const Icon = CONTEXT_MENU_ICONS[item.id] ?? ('heading-level' === item.id ? Hash : undefined);
        const ItemIcon = 'item' === item.kind && item.checked ? Check : Icon;
        return (
          <div className={className} key={item.id}>
            <button
              aria-disabled={item.disabled ? 'true' : 'false'}
              aria-expanded={'submenu' === item.kind ? expanded : undefined}
              aria-haspopup={'submenu' === item.kind ? 'menu' : undefined}
              className={`easymde-editor-context-menu__button${hovered ? ' is-hovered' : ''}`}
              data-easymde-context-menu-item={item.id}
              data-easymde-context-menu-checked={
                'item' === item.kind && item.checked ? 'true' : undefined
              }
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
              {ItemIcon ? (
                <ItemIcon
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
