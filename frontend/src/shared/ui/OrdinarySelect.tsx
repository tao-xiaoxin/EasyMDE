import {
  createElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState
} from '@wordpress/element';
import type { KeyboardEvent } from 'react';

import { Check, ChevronDown } from '../../generated/lucide-icons';

export type OrdinarySelectOption = Readonly<{
  group?: string;
  id: string;
  label: string;
}>;

type Props = Readonly<{
  className?: string;
  label: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<OrdinarySelectOption>;
  value: string;
}>;

type MenuPosition = Readonly<{
  left: number;
  maxHeight: number;
  top: number;
  width: number;
}>;

const VIEWPORT_PADDING = 12;
const MENU_GAP = 6;
const MENU_MAX_HEIGHT = 264;

function optionDomId(listboxId: string, id: string, index: number): string {
  return `${listboxId}-option-${index}-${id.replace(/[^a-z0-9_-]/gi, '-')}`;
}

export function OrdinarySelect({
  className,
  label,
  onChange,
  options,
  value
}: Props) {
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState(value);
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const selected = options.find((option) => option.id === value);
  const activeIndex = Math.max(
    0,
    options.findIndex((option) => option.id === activeId)
  );
  const activeOptionIndex = options.findIndex(
    (option) => option.id === activeId
  );
  const activeOptionDomId = -1 === activeOptionIndex
    ? undefined
    : optionDomId(listboxId, activeId, activeOptionIndex);

  const updatePosition = () => {
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    const windowRef = trigger?.ownerDocument.defaultView;
    if (!trigger || !menu || !windowRef) return;

    const rect = trigger.getBoundingClientRect();
    const width = Math.min(
      Math.max(rect.width, 180),
      windowRef.innerWidth - VIEWPORT_PADDING * 2
    );
    const left = Math.min(
      Math.max(VIEWPORT_PADDING, rect.left),
      windowRef.innerWidth - width - VIEWPORT_PADDING
    );
    const groupCount = new Set(
      options.flatMap((option) => option.group ? [option.group] : [])
    ).size;
    const fallbackHeight = options.length * 36 + groupCount * 24 + 10;
    const desiredHeight = Math.min(
      MENU_MAX_HEIGHT,
      menu.scrollHeight || fallbackHeight
    );
    const spaceBelow =
      windowRef.innerHeight - rect.bottom - MENU_GAP - VIEWPORT_PADDING;
    const spaceAbove = rect.top - MENU_GAP - VIEWPORT_PADDING;
    const placeAbove =
      spaceBelow < Math.min(160, desiredHeight) && spaceAbove > spaceBelow;
    const available = Math.max(0, placeAbove ? spaceAbove : spaceBelow);
    const maxHeight = Math.min(desiredHeight, available);
    const top = placeAbove
      ? Math.max(VIEWPORT_PADDING, rect.top - MENU_GAP - maxHeight)
      : rect.bottom + MENU_GAP;

    setPosition({ left, maxHeight, top, width });
  };

  const moveActive = (nextIndex: number) => {
    const boundedIndex = Math.min(
      options.length - 1,
      Math.max(0, nextIndex)
    );
    setActiveId(options[boundedIndex]?.id ?? value);
  };

  const close = () => {
    setOpen(false);
    setPosition(null);
  };

  const commit = (nextValue: string) => {
    onChange(nextValue);
    close();
    triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) setActiveId(value);
  }, [open, value]);

  useLayoutEffect(() => {
    if (open) updatePosition();
  }, [activeId, open, options.length]);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!open || !position || !menu || !activeOptionDomId) return;

    const activeOption = menu.ownerDocument.getElementById(activeOptionDomId);
    if (!activeOption) {
      throw new Error('ordinary-select-active-option-unavailable');
    }

    const optionTop = activeOption.offsetTop;
    const optionBottom = optionTop + activeOption.offsetHeight;
    const visibleTop = menu.scrollTop;
    const visibleBottom = visibleTop + menu.clientHeight;

    if (optionTop < visibleTop) {
      menu.scrollTop = optionTop;
    } else if (optionBottom > visibleBottom) {
      menu.scrollTop = optionBottom - menu.clientHeight;
    }
  }, [activeOptionDomId, open, position]);

  useEffect(() => {
    if (!open) return undefined;
    const documentRef = triggerRef.current?.ownerDocument;
    const windowRef = documentRef?.defaultView;
    if (!documentRef || !windowRef) {
      throw new Error('ordinary-select-document-unavailable');
    }
    const closeForPointer = (event: MouseEvent) => {
      if (
        event.target instanceof Node
        && rootRef.current?.contains(event.target)
      ) {
        return;
      }
      close();
    };
    const reposition = () => updatePosition();
    documentRef.addEventListener('click', closeForPointer);
    windowRef.addEventListener('resize', reposition);
    windowRef.addEventListener('scroll', reposition, true);
    return () => {
      documentRef.removeEventListener('click', closeForPointer);
      windowRef.removeEventListener('resize', reposition);
      windowRef.removeEventListener('scroll', reposition, true);
    };
  }, [open, options.length]);

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if ('Tab' === event.key) {
      close();
      return;
    }
    if ('Escape' === event.key) {
      if (!open) return;
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if ('ArrowDown' === event.key) {
      event.preventDefault();
      if (!open) setOpen(true);
      moveActive(activeIndex + 1);
      return;
    }
    if ('ArrowUp' === event.key) {
      event.preventDefault();
      if (!open) setOpen(true);
      moveActive(activeIndex - 1);
      return;
    }
    if ('Home' === event.key || 'End' === event.key) {
      event.preventDefault();
      if (!open) setOpen(true);
      moveActive('Home' === event.key ? 0 : options.length - 1);
      return;
    }
    if ('Enter' === event.key || ' ' === event.key) {
      event.preventDefault();
      if (open) {
        commit(options[activeIndex]?.id ?? value);
      } else {
        setOpen(true);
      }
      return;
    }
    if (
      1 === event.key.length
      && !event.altKey
      && !event.ctrlKey
      && !event.metaKey
    ) {
      const query = event.key.toLocaleLowerCase();
      const candidates = options
        .slice(activeIndex + 1)
        .concat(options.slice(0, activeIndex + 1));
      const matchOffset = candidates.findIndex((option) =>
        option.label.toLocaleLowerCase().startsWith(query)
      );
      if (-1 !== matchOffset) {
        event.preventDefault();
        const nextIndex = (activeIndex + 1 + matchOffset) % options.length;
        if (!open) setOpen(true);
        moveActive(nextIndex);
      }
    }
  };

  let currentGroup: string | undefined;
  return (
    <div
      ref={rootRef}
      className={`easymde-ordinary-select${className ? ` ${className}` : ''}`}
    >
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        className="easymde-ordinary-select-trigger"
        aria-label={label}
        aria-controls={listboxId}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-activedescendant={open ? activeOptionDomId : undefined}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={handleKeyDown}
      >
        <span>{selected?.label ?? ''}</span>
        <ChevronDown size={14} strokeWidth={2.1} aria-hidden="true" />
      </button>
      {open ? (
        <div
          ref={menuRef}
          id={listboxId}
          role="listbox"
          aria-label={label}
          className="easymde-ordinary-select-options"
          style={{
            left: position?.left,
            maxHeight: position?.maxHeight,
            position: 'fixed',
            top: position?.top,
            width: position?.width
          }}
        >
          {options.map((option, index) => {
            const groupChanged = option.group !== currentGroup;
            currentGroup = option.group;
            const active = option.id === activeId;
            const selectedOption = option.id === value;
            return (
              <div key={option.id}>
                {groupChanged && option.group ? (
                  <div
                    className="easymde-ordinary-select-group"
                    role="presentation"
                  >
                    {option.group}
                  </div>
                ) : null}
                <button
                  type="button"
                  id={optionDomId(listboxId, option.id, index)}
                  role="option"
                  tabIndex={-1}
                  aria-selected={selectedOption}
                  className={active ? 'is-active' : ''}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActiveId(option.id)}
                  onClick={() => commit(option.id)}
                >
                  <span className="easymde-ordinary-select-check" aria-hidden="true">
                    {selectedOption ? <Check size={13} strokeWidth={2.4} /> : null}
                  </span>
                  <span>{option.label}</span>
                </button>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
