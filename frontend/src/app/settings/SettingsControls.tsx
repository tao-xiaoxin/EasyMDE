import {
	createElement,
	createPortal,
	useId,
	useLayoutEffect,
	useRef,
	useState,
} from "@wordpress/element";
import type { CSSProperties, KeyboardEvent, ReactNode } from "react";
import { Check, ChevronDown } from "../../generated/lucide-icons";

type SearchField = ReadonlyArray<string | undefined>;

export type SettingsSelectOption = Readonly<{
	disabled?: boolean;
	label: string;
	value: string;
}>;

type SelectPosition = Readonly<{
	left: number;
	maxHeight: number;
	top: number;
	width: number;
}>;

const SELECT_VIEWPORT_MARGIN = 8;
const SELECT_OPTION_HEIGHT = 24;
const SELECT_POPUP_PADDING = 10;
const SELECT_POPUP_MAX_HEIGHT = 280;
const SELECT_TYPEAHEAD_RESET_DELAY = 600;

export function matchesSettingsQuery(
	query: string,
	field: SearchField,
): boolean {
	return !query || field.some((value) => value?.toLowerCase().includes(query));
}

function nextEnabledOptionIndex(
	options: ReadonlyArray<SettingsSelectOption>,
	startIndex: number,
	direction: 1 | -1,
): number {
	if (!options.some((option) => !option.disabled)) return -1;
	let index = startIndex;
	for (let attempt = 0; attempt < options.length; attempt += 1) {
		index = (index + direction + options.length) % options.length;
		if (!options[index]?.disabled) return index;
	}
	return -1;
}

export function SettingsSelect({
	ariaDescribedBy,
	className = "easymde-settings-center__select-wrap",
	disabled = false,
	label,
	onChange,
	options,
	value,
}: {
	ariaDescribedBy?: string;
	className?: string;
	disabled?: boolean;
	label: string;
	onChange: (value: string) => void;
	options: ReadonlyArray<SettingsSelectOption>;
	value: string;
}) {
	const triggerRef = useRef<HTMLButtonElement>(null);
	const listboxRef = useRef<HTMLDivElement>(null);
	const repositionFrameRef = useRef<number | null>(null);
	const typeaheadRef = useRef("");
	const typeaheadTimerRef = useRef<number | null>(null);
	const listboxId = `settings-select-${useId().replace(/:/g, "")}`;
	const selectedIndex = options.findIndex((option) => option.value === value);
	if (selectedIndex < 0)
		throw new Error(`settings-select-${label}-value-invalid`);
	const selectedOption = options[selectedIndex];
	if (!selectedOption)
		throw new Error(`settings-select-${label}-option-missing`);
	const [isOpen, setIsOpen] = useState(false);
	const [activeIndex, setActiveIndex] = useState(selectedIndex);
	const [position, setPosition] = useState<SelectPosition | null>(null);

	const close = () => {
		setIsOpen(false);
		setPosition(null);
	};

	const readPosition = (): SelectPosition => {
		const trigger = triggerRef.current;
		if (!trigger) throw new Error("settings-select-trigger-missing");
		const windowRef = trigger.ownerDocument.defaultView;
		if (!windowRef) throw new Error("settings-select-window-missing");
		const rect = trigger.getBoundingClientRect();
		const availableWidth = Math.max(
			0,
			windowRef.innerWidth - SELECT_VIEWPORT_MARGIN * 2,
		);
		const width = Math.min(rect.width, availableWidth);
		const left = Math.min(
			Math.max(rect.left, SELECT_VIEWPORT_MARGIN),
			Math.max(
				SELECT_VIEWPORT_MARGIN,
				windowRef.innerWidth - width - SELECT_VIEWPORT_MARGIN,
			),
		);
		const desiredHeight = Math.min(
			SELECT_POPUP_MAX_HEIGHT,
			options.length * SELECT_OPTION_HEIGHT + SELECT_POPUP_PADDING,
		);
		const measuredHeight = listboxRef.current?.offsetHeight || desiredHeight;
		const maxHeight = Math.min(
			SELECT_POPUP_MAX_HEIGHT,
			Math.max(
				SELECT_OPTION_HEIGHT + SELECT_POPUP_PADDING,
				windowRef.innerHeight - SELECT_VIEWPORT_MARGIN * 2,
			),
		);
		const renderedHeight = Math.min(measuredHeight, maxHeight);
		const selectedOptionCenter =
			SELECT_POPUP_PADDING / 2 +
			selectedIndex * SELECT_OPTION_HEIGHT +
			SELECT_OPTION_HEIGHT / 2;
		const selectedTop =
			rect.top + rect.height / 2 - selectedOptionCenter;
		const top = Math.min(
			Math.max(selectedTop, SELECT_VIEWPORT_MARGIN),
			Math.max(
				SELECT_VIEWPORT_MARGIN,
				windowRef.innerHeight - renderedHeight - SELECT_VIEWPORT_MARGIN,
			),
		);
		return { left, maxHeight, top, width };
	};

	const open = () => {
		if (disabled) return;
		setActiveIndex(
			selectedOption.disabled
				? nextEnabledOptionIndex(options, selectedIndex, 1)
				: selectedIndex,
		);
		setPosition(readPosition());
		setIsOpen(true);
	};

	const commit = (index: number) => {
		const option = options[index];
		if (!option || option.disabled) return;
		if (option.value !== value) onChange(option.value);
		close();
		triggerRef.current?.focus({ preventScroll: true });
	};

	const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
		if (disabled) return;
		if ("ArrowDown" === event.key || "ArrowUp" === event.key) {
			event.preventDefault();
			if (!isOpen) {
				open();
				return;
			}
			const nextIndex = nextEnabledOptionIndex(
				options,
				activeIndex,
				"ArrowDown" === event.key ? 1 : -1,
			);
			if (nextIndex >= 0) setActiveIndex(nextIndex);
			return;
		}
		if ("Home" === event.key || "End" === event.key) {
			if (!isOpen) return;
			event.preventDefault();
			const nextIndex = nextEnabledOptionIndex(
				options,
				"Home" === event.key ? -1 : 0,
				"Home" === event.key ? 1 : -1,
			);
			if (nextIndex >= 0) setActiveIndex(nextIndex);
			return;
		}
		if ("Enter" === event.key || " " === event.key) {
			event.preventDefault();
			if (isOpen) commit(activeIndex);
			else open();
			return;
		}
		if ("Escape" === event.key && isOpen) {
			event.preventDefault();
			close();
			triggerRef.current?.focus({ preventScroll: true });
			return;
		}
		if ("Tab" === event.key && isOpen) {
			close();
			return;
		}
		if (
			!isOpen ||
			event.key.length !== 1 ||
			event.ctrlKey ||
			event.metaKey ||
			event.altKey
		)
			return;
		const windowRef = triggerRef.current?.ownerDocument.defaultView;
		if (!windowRef) throw new Error("settings-select-typeahead-window-missing");
		typeaheadRef.current += event.key.toLocaleLowerCase();
		if (typeaheadTimerRef.current !== null)
			windowRef.clearTimeout(typeaheadTimerRef.current);
		typeaheadTimerRef.current = windowRef.setTimeout(() => {
			typeaheadRef.current = "";
			typeaheadTimerRef.current = null;
		}, SELECT_TYPEAHEAD_RESET_DELAY);
		const nextIndex = options.findIndex(
			(option) =>
				!option.disabled &&
				option.label.toLocaleLowerCase().startsWith(typeaheadRef.current),
		);
		if (nextIndex >= 0) setActiveIndex(nextIndex);
	};

	useLayoutEffect(() => {
		if (!isOpen) return;
		const trigger = triggerRef.current;
		const listbox = listboxRef.current;
		if (!trigger || !listbox)
			throw new Error("settings-select-open-elements-missing");
		const documentRef = trigger.ownerDocument;
		const windowRef = documentRef.defaultView;
		if (!windowRef) throw new Error("settings-select-open-window-missing");
		setPosition(readPosition());
		const schedulePosition = () => {
			if (repositionFrameRef.current !== null) return;
			repositionFrameRef.current = windowRef.requestAnimationFrame(() => {
				repositionFrameRef.current = null;
				setPosition(readPosition());
			});
		};
		const closeForOutsidePointer = (event: PointerEvent) => {
			const target = event.target;
			if (!(target instanceof Node)) return;
			if (trigger.contains(target) || listbox.contains(target)) return;
			close();
		};
		documentRef.addEventListener("pointerdown", closeForOutsidePointer);
		windowRef.addEventListener("resize", schedulePosition);
		windowRef.addEventListener("scroll", schedulePosition, true);
		return () => {
			documentRef.removeEventListener("pointerdown", closeForOutsidePointer);
			windowRef.removeEventListener("resize", schedulePosition);
			windowRef.removeEventListener("scroll", schedulePosition, true);
			if (repositionFrameRef.current !== null) {
				windowRef.cancelAnimationFrame(repositionFrameRef.current);
				repositionFrameRef.current = null;
			}
			if (typeaheadTimerRef.current !== null) {
				windowRef.clearTimeout(typeaheadTimerRef.current);
				typeaheadTimerRef.current = null;
				typeaheadRef.current = "";
			}
		};
	}, [isOpen, options.length]);

	const portalRoot = triggerRef.current?.ownerDocument.body;
	if (isOpen && !portalRoot)
		throw new Error("settings-select-portal-root-missing");

	return (
		<div className={`easymde-settings-center__settings-select ${className}`}>
			<button
				ref={triggerRef}
				type="button"
				role="combobox"
				aria-label={label}
				aria-describedby={ariaDescribedBy}
				aria-controls={listboxId}
				aria-expanded={isOpen}
				aria-haspopup="listbox"
				aria-activedescendant={
					isOpen && activeIndex >= 0
						? `${listboxId}-option-${activeIndex}`
						: undefined
				}
				disabled={disabled}
				onClick={() => (isOpen ? close() : open())}
				onKeyDown={handleKeyDown}
			>
				<span>{selectedOption.label}</span>
				<ChevronDown size={15} strokeWidth={2.2} aria-hidden="true" />
			</button>
			{isOpen && portalRoot && position
				? createPortal(
						<div
							ref={listboxRef}
							id={listboxId}
							className="easymde-settings-center__select-listbox"
							role="listbox"
							aria-label={label}
							style={
								{
									left: position.left,
									maxHeight: position.maxHeight,
									top: position.top,
									width: position.width,
								} satisfies CSSProperties
							}
						>
							{options.map((option, index) => (
								<button
									key={option.value}
									type="button"
									id={`${listboxId}-option-${index}`}
									role="option"
									tabIndex={-1}
									aria-disabled={option.disabled || undefined}
									aria-selected={option.value === value}
									data-active={activeIndex === index || undefined}
									disabled={option.disabled}
									onPointerMove={() => {
										if (!option.disabled) setActiveIndex(index);
									}}
									onPointerDown={(event) => event.preventDefault()}
									onClick={() => commit(index)}
								>
									<span aria-hidden="true">
										{option.value === value ? <Check size={13} /> : null}
									</span>
									<strong>{option.label}</strong>
								</button>
							))}
						</div>,
						portalRoot,
					)
				: null}
		</div>
	);
}

export function SettingsToggle({
	ariaDescribedBy,
	checked,
	disabled = false,
	label,
	onChange,
}: {
	ariaDescribedBy?: string;
	checked: boolean;
	disabled?: boolean;
	label: string;
	onChange: () => void;
}) {
	return (
		<button
			type="button"
			role="switch"
			aria-checked={checked}
			aria-label={label}
			aria-describedby={ariaDescribedBy}
			disabled={disabled}
			onClick={onChange}
			className="easymde-settings-center__switch"
		>
			<span className="easymde-settings-center__switch-thumb" />
		</button>
	);
}

export function UnavailableSettingsNotice({
	description,
	id,
	label,
}: {
	description: string;
	id: string;
	label: string;
}) {
	return (
		<div
			id={id}
			className="easymde-settings-center__unavailable easymde-settings-center__visually-hidden"
			role="note"
		>
			<strong>{label}</strong>
			<p>{description}</p>
		</div>
	);
}

export function SettingsRow({
	children,
	description,
	label,
	minHeight,
	query = "",
	searchableText,
	searchGroup,
}: {
	children: ReactNode;
	description?: string;
	label: string;
	minHeight?: 60 | 65 | 70 | 76 | 82 | 150;
	query?: string;
	searchableText?: string;
	searchGroup?: string;
}) {
	if (!matchesSettingsQuery(query, [label, description])) return null;

	const className = [
		"easymde-settings-center__row",
		description ? "has-description" : "",
		minHeight ? `is-height-${minHeight}` : "",
	]
		.filter(Boolean)
		.join(" ");

	return (
		<div
			className={className}
			data-setting-search={`${label} ${description ?? ""} ${searchableText ?? ""}`}
			data-setting-label={label}
			data-setting-description={description ?? ""}
			data-setting-group={searchGroup}
		>
			<div className="easymde-settings-center__row-label">
				<div>{label}</div>
				{description ? <p>{description}</p> : null}
			</div>
			<div className="easymde-settings-center__row-control">{children}</div>
		</div>
	);
}
