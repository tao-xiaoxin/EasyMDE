import { createElement, useEffect, useRef, useState } from "@wordpress/element";

import type {
	SettingsCenterBootstrap,
	SettingsCenterStringKey,
} from "../../contracts/bootstrap/settings-center-bootstrap";
import type {
	ShortcutId,
	ShortcutValue,
	ShortcutValues,
	ShortcutsSettings,
} from "../../contracts/settings-center-settings";
import {
	canonicalizeKeyboardShortcut,
	formatKeyboardShortcut,
	keyboardShortcutFromEvent,
	type KeyboardShortcutPlatform,
} from "../../shared/keyboard/keyboard-shortcut";
import { CircleAlert, Code2, RotateCcw, X } from "../../generated/lucide-icons";
import { KeyboardIcon } from "./settings-center-icons";
import {
	formatSinglePlaceholder,
	useDialogFocusTrap,
} from "./settings-center-utils";

type Strings = SettingsCenterBootstrap["strings"];
type ShortcutPlatform = keyof ShortcutValue;
type ShortcutRow = Readonly<{ id: ShortcutId; label: SettingsCenterStringKey }>;
type ShortcutGroup = Readonly<{
	title: SettingsCenterStringKey;
	icon: "keyboard" | "type" | "code";
	rows: ReadonlyArray<ShortcutRow>;
}>;
type ShortcutConflictBinding = Readonly<{
	id: string;
	label: string;
	editable: boolean;
}>;

export type ShortcutConflict = Readonly<{
	platform: ShortcutPlatform;
	shortcut: string;
	bindings: ReadonlyArray<ShortcutConflictBinding>;
}>;

const SHORTCUT_LABEL_KEYS: Readonly<
	Record<ShortcutId, SettingsCenterStringKey>
> = {
	save: "saveArticle",
	bold: "bold",
	italic: "italic",
	strikethrough: "strikethrough",
	paragraph: "paragraph",
	link: "insertLink",
	image: "insertImage",
	"heading-one": "headingOne",
	"heading-two": "headingTwo",
	"heading-three": "headingThree",
	"heading-four": "headingFour",
	"heading-five": "headingFive",
	"heading-six": "headingSix",
	quote: "quote",
	"unordered-list": "unorderedList",
	"ordered-list": "orderedList",
	"inline-code": "inlineCode",
	"code-fence": "codeFence",
	"math-block": "mathBlock",
};

function shortcutRows(
	ids: ReadonlyArray<ShortcutId>,
): ReadonlyArray<ShortcutRow> {
	return ids.map((id) => ({ id, label: SHORTCUT_LABEL_KEYS[id] }));
}

const SHORTCUT_GROUPS: ReadonlyArray<ShortcutGroup> = [
	{
		title: "commonShortcuts",
		icon: "keyboard",
		rows: shortcutRows([
			"save",
			"bold",
			"italic",
			"strikethrough",
			"link",
			"image",
		]),
	},
	{
		title: "headingAndFormatting",
		icon: "type",
		rows: shortcutRows([
			"paragraph",
			"heading-one",
			"heading-two",
			"heading-three",
			"heading-four",
			"heading-five",
			"heading-six",
			"quote",
			"unordered-list",
			"ordered-list",
		]),
	},
	{
		title: "codeAndFormula",
		icon: "code",
		rows: shortcutRows(["inline-code", "code-fence", "math-block"]),
	},
];

function keyboardPlatform(
	platform: ShortcutPlatform,
): KeyboardShortcutPlatform {
	return platform === "mac" ? "mac" : "win";
}

function normalizedShortcut(value: string, platform: ShortcutPlatform): string {
	if (!value.trim()) return "";
	const shortcut = canonicalizeKeyboardShortcut(
		value,
		keyboardPlatform(platform),
	);
	if (shortcut === null)
		throw new Error("settings-center-shortcut-binding-invalid");
	return shortcut;
}

export function findShortcutConflicts(
	values: ShortcutValues,
	reservedShortcuts: SettingsCenterBootstrap["reservedShortcuts"],
	strings: Strings,
): ReadonlyArray<ShortcutConflict> {
	const conflicts: ShortcutConflict[] = [];
	for (const platform of ["windows", "mac"] as const) {
		const owners = new Map<string, ShortcutConflictBinding[]>();
		for (const [id, value] of Object.entries(values) as Array<
			[ShortcutId, ShortcutValue]
		>) {
			const shortcut = normalizedShortcut(value[platform], platform);
			if (!shortcut) continue;
			owners.set(shortcut, [
				...(owners.get(shortcut) ?? []),
				{ id, label: strings[SHORTCUT_LABEL_KEYS[id]], editable: true },
			]);
		}
		for (const reserved of reservedShortcuts) {
			const shortcut = normalizedShortcut(reserved[platform], platform);
			if (!shortcut) continue;
			owners.set(shortcut, [
				...(owners.get(shortcut) ?? []),
				{ id: reserved.id, label: reserved.label, editable: false },
			]);
		}
		for (const [shortcut, bindings] of owners) {
			if (
				bindings.length > 1 &&
				bindings.some((binding) => binding.editable)
			)
				conflicts.push({ platform, shortcut, bindings });
		}
	}
	return conflicts;
}

function isModifierKey(key: string): boolean {
	return ["Alt", "Control", "Meta", "Shift"].includes(key);
}

function shouldIgnoreKeyboardEvent(event: KeyboardEvent): boolean {
	return (
		event.isComposing ||
		event.keyCode === 229 ||
		event.repeat ||
		["Dead", "Process", "Unidentified"].includes(event.key)
	);
}

function ShortcutKeys({ value }: { value: string }) {
	return (
		<span className="easymde-settings-center__shortcut-keys">
			{formatKeyboardShortcut(value)
				.split("+")
				.map((key) => (
					<kbd key={key}>{key}</kbd>
				))}
		</span>
	);
}

function ShortcutRecorder({
	conflict,
	id,
	label,
	onChange,
	platform,
	strings,
	value,
}: {
	conflict: ShortcutConflict | undefined;
	id: ShortcutId;
	label: string;
	onChange: (value: string) => void;
	platform: ShortcutPlatform;
	strings: Strings;
	value: string;
}) {
	const [recording, setRecording] = useState(false);
	const [invalid, setInvalid] = useState(false);
	const platformLabel =
		platform === "mac" ? strings.macOS : strings.windowsLinux;
	const controlLabel = `${label} ${platformLabel}`;
	const accessibleValue = value
		? formatKeyboardShortcut(value)
		: strings.shortcutDisabled;
	const errorId = `shortcut-${platform}-${id}-error`;
	const conflictingLabels = conflict?.bindings
		.filter((binding) => !binding.editable || binding.id !== id)
		.map((binding) => binding.label)
		.join(", ");
	const errorMessage = invalid
		? strings.shortcutInvalid
		: conflictingLabels
			? formatSinglePlaceholder(
					strings.shortcutConflictInline,
					conflictingLabels,
				)
			: "";

	return (
		<div className="easymde-settings-center__shortcut-cell">
			<button
				type="button"
				className="easymde-settings-center__shortcut-recorder"
				data-recording={recording ? "true" : undefined}
				aria-label={`${formatSinglePlaceholder(
					strings.recordShortcut,
					controlLabel,
				)}: ${accessibleValue}`}
				aria-invalid={errorMessage ? "true" : undefined}
				aria-describedby={errorMessage ? errorId : undefined}
				onBlur={() => {
					setRecording(false);
					setInvalid(false);
				}}
				onClick={() => {
					setRecording(true);
					setInvalid(false);
				}}
				onKeyDown={(event) => {
					if (!recording) return;
					if (event.key === "Escape") {
						event.preventDefault();
						event.stopPropagation();
						setRecording(false);
						setInvalid(false);
						return;
					}
					if (event.key === "Tab") return;
					event.preventDefault();
					event.stopPropagation();
					if (
						isModifierKey(event.key) ||
						shouldIgnoreKeyboardEvent(event.nativeEvent)
					)
						return;
					const shortcut = keyboardShortcutFromEvent(
						event.nativeEvent,
						keyboardPlatform(platform),
					);
					if (!shortcut) {
						setInvalid(true);
						return;
					}
					onChange(shortcut);
					setInvalid(false);
					setRecording(false);
				}}
			>
				{recording ? (
					<span>{strings.shortcutRecording}</span>
				) : value ? (
					<ShortcutKeys value={value} />
				) : (
					<span>{strings.shortcutDisabled}</span>
				)}
			</button>
			<button
				type="button"
				className="easymde-settings-center__shortcut-clear"
				aria-label={formatSinglePlaceholder(
					strings.clearShortcut,
					controlLabel,
				)}
				disabled={!value}
				onClick={() => onChange("")}
			>
				<X size={15} />
			</button>
			{errorMessage ? (
				<small id={errorId} role="alert">
					{errorMessage}
				</small>
			) : null}
		</div>
	);
}

function ShortcutCard({
	conflicts,
	group,
	onChange,
	onReset,
	strings,
	values,
}: {
	conflicts: ReadonlyArray<ShortcutConflict>;
	group: ShortcutGroup;
	onChange: (id: ShortcutId, platform: ShortcutPlatform, value: string) => void;
	onReset: (() => void) | undefined;
	strings: Strings;
	values: ShortcutValues;
}) {
	return (
		<section className="easymde-settings-center__shortcut-card">
			<div className="easymde-settings-center__shortcut-heading">
				<h2>
					{group.icon === "keyboard" ? (
						<KeyboardIcon size={25} />
					) : group.icon === "code" ? (
						<Code2 size={25} />
					) : (
						<span aria-hidden="true">T</span>
					)}
					{strings[group.title]}
				</h2>
				{onReset ? (
					<button type="button" onClick={onReset}>
						<RotateCcw size={16} />
						{strings.restoreDefaultShortcuts}
					</button>
				) : null}
			</div>
			<div className="easymde-settings-center__shortcut-table-heading">
				<span>{strings.shortcutFunction}</span>
				<span>{strings.windowsLinux}</span>
				<span>{strings.macOS}</span>
			</div>
			{group.rows.map((row) => {
				const value = values[row.id];
				return (
					<div
						key={row.id}
						className="easymde-settings-center__shortcut-row"
						data-setting-search={`${strings[row.label]} ${strings[group.title]} ${value.windows} ${value.mac}`}
						data-setting-label={strings[row.label]}
						data-setting-description=""
						data-setting-group={strings[group.title]}
					>
						<span>{strings[row.label]}</span>
						{(["windows", "mac"] as const).map((platform) => (
							<ShortcutRecorder
								key={platform}
								id={row.id}
								label={strings[row.label]}
								platform={platform}
								value={value[platform]}
								strings={strings}
								conflict={conflicts.find(
									(item) =>
										item.platform === platform &&
										item.bindings.some(
											(binding) => binding.editable && binding.id === row.id,
										),
								)}
								onChange={(nextValue) => onChange(row.id, platform, nextValue)}
							/>
						))}
					</div>
				);
			})}
		</section>
	);
}

export function ShortcutConflictDialog({
	conflicts,
	onClose,
	returnFocus,
	strings,
}: {
	conflicts: ReadonlyArray<ShortcutConflict>;
	onClose: () => void;
	returnFocus: HTMLElement;
	strings: Strings;
}) {
	const closeButtonRef = useRef<HTMLButtonElement>(null);
	const dialogRef = useRef<HTMLDivElement>(null);
	const onCloseRef = useRef(onClose);
	onCloseRef.current = onClose;
	useDialogFocusTrap(dialogRef, closeButtonRef);
	useEffect(() => {
		const dialog = dialogRef.current;
		if (!dialog)
			throw new Error("settings-center-shortcut-conflict-dialog-missing");
		const ownerDocument = dialog.ownerDocument;
		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key === "Escape") onCloseRef.current();
		};
		ownerDocument.addEventListener("keydown", closeOnEscape);
		return () => {
			ownerDocument.removeEventListener("keydown", closeOnEscape);
			returnFocus.focus();
		};
	}, [returnFocus]);

	return (
		<div
			className="easymde-settings-center__transfer-dialog-layer"
			role="presentation"
		>
			<button
				type="button"
				className="easymde-settings-center__dialog-backdrop"
				aria-label={strings.returnToShortcutSettings}
				onClick={onClose}
			/>
			<div
				ref={dialogRef}
				role="alertdialog"
				aria-modal="true"
				aria-labelledby="easymde-shortcut-conflict-title"
				aria-describedby="easymde-shortcut-conflict-description"
				className="easymde-settings-center__transfer-dialog easymde-settings-center__shortcut-conflict-dialog"
			>
				<header>
					<span className="is-destructive">
						<CircleAlert size={22} />
					</span>
					<div>
						<h2 id="easymde-shortcut-conflict-title">
							{strings.shortcutConflictTitle}
						</h2>
						<p id="easymde-shortcut-conflict-description">
							{strings.shortcutConflictDescription}
						</p>
					</div>
				</header>
				{conflicts.length ? (
					<div className="easymde-settings-center__transfer-dialog-body">
						<ul>
							{conflicts.map((conflict) => (
								<li key={`${conflict.platform}:${conflict.shortcut}`}>
									<span>
										{conflict.platform === "mac"
											? strings.macOS
											: strings.windowsLinux}
									</span>
									<ShortcutKeys value={conflict.shortcut} />
									<strong>
										{conflict.bindings
											.map((binding) => binding.label)
											.join(", ")}
									</strong>
								</li>
							))}
						</ul>
					</div>
				) : null}
				<footer>
					<button ref={closeButtonRef} type="button" onClick={onClose}>
						{strings.returnToShortcutSettings}
					</button>
				</footer>
			</div>
		</div>
	);
}

export function ShortcutsSettingsPage({
	conflicts,
	defaultValues,
	onChange,
	settings: externalSettings,
	strings,
}: {
	conflicts: ReadonlyArray<ShortcutConflict>;
	defaultValues: ShortcutValues;
	onChange?: (settings: ShortcutsSettings) => void;
	settings?: ShortcutsSettings;
	strings: Strings;
}) {
	const [localSettings, setLocalSettings] = useState<ShortcutsSettings>(() => ({
		values: defaultValues,
	}));
	const settings = externalSettings ?? localSettings;
	const update = (next: ShortcutsSettings) => {
		if (onChange) onChange(next);
		else setLocalSettings(next);
	};
	const updateShortcut = (
		id: ShortcutId,
		platform: ShortcutPlatform,
		value: string,
	) => {
		update({
			values: {
				...settings.values,
				[id]: { ...settings.values[id], [platform]: value },
			},
		});
	};

	return (
		<div className="easymde-settings-center__shortcuts-settings">
			<div className="easymde-settings-center__shortcut-groups">
				{SHORTCUT_GROUPS.map((group, groupIndex) => (
					<ShortcutCard
						key={group.title}
						group={group}
						conflicts={conflicts}
						strings={strings}
						values={settings.values}
						onChange={updateShortcut}
						onReset={
							groupIndex === 0
								? () => update({ values: defaultValues })
								: undefined
						}
					/>
				))}
			</div>
		</div>
	);
}
