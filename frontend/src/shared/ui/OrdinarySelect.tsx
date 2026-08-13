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

export type OrdinarySelectSwatch = string | readonly [string, string];

export type OrdinarySelectOption = Readonly<{
  id: string;
  label: string;
  swatch?: OrdinarySelectSwatch;
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
const MENU_MIN_HEIGHT = 96;

function optionDomId(listboxId: string, id: string, index: number): string {
  return `${listboxId}-option-${index}-${id.replace(/[^a-z0-9_-]/gi, '-')}`;
}

function rectanglesIntersect(first: DOMRect, second: DOMRect): boolean {
  return (
    first.bottom > second.top
    && first.right > second.left
    && first.top < second.bottom
    && first.left < second.right
  );
}

function triggerIsVisibleForScroll(
  trigger: HTMLButtonElement,
  scrollOwner: EventTarget | null,
  windowRef: Window
): boolean {
  const triggerRect = trigger.getBoundingClientRect();
  const viewportRect = DOMRect.fromRect({
    width: windowRef.innerWidth,
    height: windowRef.innerHeight
  });
  if (!rectanglesIntersect(triggerRect, viewportRect)) {
    return false;
  }
  return !(
    scrollOwner instanceof Element
    && scrollOwner.contains(trigger)
    && !rectanglesIntersect(triggerRect, scrollOwner.getBoundingClientRect())
  );
}

function OrdinarySelectSwatch({
  swatch
}: Readonly<{ swatch: OrdinarySelectSwatch }>) {
  return Array.isArray(swatch) ? (
    <span
      className="easymde-ordinary-select-swatch is-split"
      aria-hidden="true"
    >
      <span style={{ background: swatch[0] }} />
      <span style={{ background: swatch[1] }} />
    </span>
  ) : (
    <span
      className="easymde-ordinary-select-swatch"
      aria-hidden="true"
      style={{ background: swatch as string }}
    />
  );
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
  const activeOptionIndex = options.findIndex(
    (option) => option.id === activeId
  );
  const activeIndex = activeOptionIndex;
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
    const fallbackHeight = options.length * 36 + 10;
    const desiredHeight = Math.min(
      MENU_MAX_HEIGHT,
      menu.scrollHeight || fallbackHeight
    );
    const belowTop = rect.bottom + MENU_GAP;
    const availableBelow = Math.max(
      0,
      windowRef.innerHeight - belowTop - VIEWPORT_PADDING
    );
    const availableAbove = Math.max(
      0,
      rect.top - MENU_GAP - VIEWPORT_PADDING
    );
    const maxViewportHeight = Math.max(
      0,
      windowRef.innerHeight - VIEWPORT_PADDING * 2
    );
    const minimumHeight = Math.min(desiredHeight, MENU_MIN_HEIGHT);
    const canOpenBelow = availableBelow >= minimumHeight;
    const canOpenAbove = availableAbove >= minimumHeight;
    const opensAbove =
      !canOpenBelow && (canOpenAbove || availableAbove > availableBelow);
    const availableVerticalSpace = opensAbove ? availableAbove : availableBelow;
    const maxHeight = canOpenBelow || canOpenAbove
      ? Math.max(minimumHeight, Math.min(desiredHeight, availableVerticalSpace))
      : Math.min(desiredHeight, availableVerticalSpace);
    const visibleHeight = Math.min(maxHeight, maxViewportHeight);
    const top = opensAbove
      ? Math.max(VIEWPORT_PADDING, rect.top - MENU_GAP - visibleHeight)
      : Math.min(
          Math.max(VIEWPORT_PADDING, belowTop),
          windowRef.innerHeight - VIEWPORT_PADDING - visibleHeight
        );

    setPosition({ left, maxHeight: visibleHeight, top, width });
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
    if (nextValue !== value || !selected) onChange(nextValue);
    close();
    triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) setActiveId(value);
  }, [open, value]);

  useLayoutEffect(() => {
    if (open) updatePosition();
  }, [open, options.length]);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!open || !position || !menu || !activeOptionDomId) return;

    const activeOption = menu.ownerDocument.getElementById(activeOptionDomId);
    if (!activeOption) {
      return;
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
    const repositionForScroll = (event: Event) => {
      if (event.target === menuRef.current) return;
      const trigger = triggerRef.current;
      if (
        trigger
        && !triggerIsVisibleForScroll(trigger, event.target, windowRef)
      ) {
        close();
        return;
      }
      updatePosition();
    };
    documentRef.addEventListener('click', closeForPointer);
    windowRef.addEventListener('resize', reposition);
    windowRef.addEventListener('scroll', repositionForScroll, true);
    return () => {
      documentRef.removeEventListener('click', closeForPointer);
      windowRef.removeEventListener('resize', reposition);
      windowRef.removeEventListener('scroll', repositionForScroll, true);
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
        commit(-1 === activeIndex ? value : (options[activeIndex]?.id ?? value));
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
      const searchStartIndex = Math.max(0, activeIndex);
      const candidates = options
        .slice(searchStartIndex + 1)
        .concat(options.slice(0, searchStartIndex + 1));
      const matchOffset = candidates.findIndex((option) =>
        option.label.toLocaleLowerCase().startsWith(query)
      );
      if (-1 !== matchOffset) {
        event.preventDefault();
        const nextIndex = (searchStartIndex + 1 + matchOffset) % options.length;
        if (!open) setOpen(true);
        moveActive(nextIndex);
      }
    }
  };

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
        {selected?.swatch ? (
          <span className="easymde-ordinary-select-value has-swatch">
            <OrdinarySelectSwatch swatch={selected.swatch} />
            <span>{selected.label}</span>
          </span>
        ) : (
          <span>{selected?.label ?? ''}</span>
        )}
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
            const active = option.id === activeId;
            const selectedOption = option.id === value;
            return (
              <button
                key={option.id}
                type="button"
                id={optionDomId(listboxId, option.id, index)}
                role="option"
                tabIndex={-1}
                aria-selected={selectedOption}
                className={[
                  active ? 'is-active' : '',
                  option.swatch ? 'has-swatch' : ''
                ].filter(Boolean).join(' ')}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveId(option.id)}
                onClick={() => commit(option.id)}
              >
                <span className="easymde-ordinary-select-check" aria-hidden="true">
                  {selectedOption ? <Check size={13} strokeWidth={2.4} /> : null}
                </span>
                {option.swatch ? (
                  <OrdinarySelectSwatch swatch={option.swatch} />
                ) : null}
                <span>{option.label}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
