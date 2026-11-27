import {
  Fragment,
  createElement,
  createPortal,
  memo,
  useCallback,
  useRef
} from '@wordpress/element';
import type {
  CSSProperties,
  MutableRefObject
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
  EditorContextMenuItem
} from '../editor-context-menu-model';
import type {
  EditorContextMenuDirection,
  EditorContextMenuDismiss,
  EditorContextMenuSubmenuActivation
} from './EditorContextMenu';
import type { EditorContextMenuPosition } from './editor-context-menu-position';

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
  onCloseSubmenusToLayer: (path: string, updateFocusPath?: boolean) => void;
  onOpenSubmenu: (
    path: string,
    children?: ReadonlyArray<EditorContextMenuItem>,
    activation?: EditorContextMenuSubmenuActivation
  ) => void;
  onSubmenuScroll: () => void;
  path: string;
  pointerHovering: boolean;
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

function itemPath(path: string, index: number): string {
  return '' === path ? String(index) : `${path}.${index}`;
}

/**
 * One recursive menu layer. The outer EditorContextMenu owns the single
 * portal host, positioning, keyboard navigation, dismissal, and focus
 * restoration; this component only renders the current layer and its submenu
 * layers into that host.
 */
function MenuLayerComponent({
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
  onSubmenuScroll,
  path,
  pointerHovering,
  portalTarget,
  refs,
  registerSubmenuRef,
  submenuPositions,
  submenuPosition,
  ariaLabel
}: MenuLayerProps) {
  const buttonRefCallbacks = useRef<
    Map<string, (button: HTMLButtonElement | null) => void>
  >(new Map());
  const submenuLayerRef = useCallback(
    (element: HTMLDivElement | null): void => {
      registerSubmenuRef(path, element);
    },
    [path, registerSubmenuRef]
  );
  const getButtonRefCallback = (
    currentPath: string
  ): ((button: HTMLButtonElement | null) => void) => {
    let callback = buttonRefCallbacks.current.get(currentPath);
    if (!callback) {
      callback = (button: HTMLButtonElement | null): void => {
        if (button) refs.current.set(currentPath, button);
        else refs.current.delete(currentPath);
      };
      buttonRefCallbacks.current.set(currentPath, callback);
    }
    return callback;
  };

  const layer = (
    <div
      aria-label={ariaLabel}
      className={`easymde-editor-context-menu__layer${'' === path ? '' : ' easymde-editor-context-menu__submenu'}${pointerHovering ? ' is-pointer-hovering' : ''}`}
      data-easymde-context-menu-layer={path || 'root'}
      data-easymde-context-menu-placement={'' === path ? undefined : submenuPosition?.placement}
      dir={direction}
      role="menu"
      ref={'' === path ? undefined : submenuLayerRef}
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
              data-easymde-context-menu-path={currentPath}
              data-easymde-context-menu-checked={
                'item' === item.kind && item.checked ? 'true' : undefined
              }
              disabled={item.disabled}
              onClick={() => {
                if (item.disabled) return;
                if ('submenu' === item.kind) {
                  onOpenSubmenu(currentPath, item.children, 'keyboard');
                  return;
                }
                onAction(item.id);
                onDismiss({ restoreFocus: true });
              }}
              onFocus={() => {
                onInteraction();
                onFocusPath(currentPath);
                if ('submenu' !== item.kind || item.disabled) {
                  onCloseSubmenusToLayer(currentPath, true);
                }
              }}
              onMouseDown={(event) => {
                onInteraction();
                event.preventDefault();
              }}
              onPointerDown={(event) => {
                onInteraction();
                event.preventDefault();
                onMenuPointerDown?.();
              }}
              onMouseEnter={() => {
                onHoverPath(currentPath);
                if ('submenu' === item.kind && !item.disabled) {
                  onOpenSubmenu(currentPath, item.children, 'pointer');
                } else {
                  onCloseSubmenusToLayer(currentPath, false);
                }
              }}
              ref={getButtonRefCallback(currentPath)}
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
                    {childPosition && !childPosition.overlapped ? (
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
                      onSubmenuScroll={onSubmenuScroll}
                      path={currentPath}
                      pointerHovering={pointerHovering}
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
      data-easymde-context-menu-overlapped={submenuPosition?.overlapped ? 'true' : undefined}
      data-easymde-context-menu-placement={submenuPosition?.placement}
      style={frameStyle}
    >
      {layer}
    </div>
  );
}

export const MenuLayer = memo(MenuLayerComponent);
