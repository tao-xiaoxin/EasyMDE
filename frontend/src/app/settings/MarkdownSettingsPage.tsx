import { createElement, useState } from "@wordpress/element";
import type { ReactNode } from "react";
import type { SettingsCenterBootstrap } from "../../contracts/bootstrap/settings-center-bootstrap";
import type { MarkdownSettings } from "../../contracts/settings-center-settings";
import { Code2 } from "../../generated/lucide-icons";
import {
	SettingsRow,
	SettingsSelect,
	SettingsToggle,
	UnavailableSettingsNotice,
} from "./SettingsControls";
import { EditPencilIcon, GeneralIcon } from "./settings-center-icons";

type MarkdownSettingsDraft = MarkdownSettings;

type Strings = SettingsCenterBootstrap["strings"];
type SelectOption = Readonly<{ value: string; label: string }>;

const LEGACY_MARKDOWN_VALUE_ALIASES: Readonly<Record<string, string>> = {
	"Follow System": "system",
	Light: "light",
	Dark: "dark",
	"Auto align by content": "auto",
	"Align left": "left",
	"Align center": "center",
	Show: "show",
	Hide: "hide",
	LF: "lf",
	CRLF: "crlf",
	Standard: "standard",
	Spaced: "spaced",
};

function normalizeMarkdownValue(
	value: string,
	options: ReadonlyArray<SelectOption>,
	fallback: string,
): string {
	const legacyValue = LEGACY_MARKDOWN_VALUE_ALIASES[value] ?? value;
	return (
		options.find(
			(option) => option.value === legacyValue || option.label === value,
		)?.value ?? fallback
	);
}

function createDefaultSettings(): MarkdownSettingsDraft {
	return {
		wordWrap: true,
		lineNumbers: false,
		editorTheme: "system",
		githubFlavor: true,
		smartPunctuation: true,
		tableAlignment: "auto",
		codeLineNumbers: "show",
		htmlRendering: false,
		pasteAsMarkdown: true,
		lineEnding: "system",
		unorderedMarker: "-",
		orderedStart: "1",
		blockquoteStyle: "standard",
	};
}

function MarkdownSelect({
	ariaDescribedBy,
	disabled = false,
	label,
	onChange,
	options,
	value,
}: {
	ariaDescribedBy?: string;
	disabled?: boolean;
	label: string;
	onChange: (value: string) => void;
	options: ReadonlyArray<SelectOption>;
	value: string;
}) {
	return (
		<SettingsSelect
			{...(ariaDescribedBy ? { ariaDescribedBy } : {})}
			className="easymde-settings-center__compact-select"
			disabled={disabled}
			label={label}
			value={value}
			onChange={onChange}
			options={options}
		/>
	);
}

function MarkdownRow({
	children,
	description,
	label,
}: {
	children: ReactNode;
	description?: string;
	label: string;
}) {
	return (
		<SettingsRow
			label={label}
			minHeight={65}
			{...(description ? { description } : {})}
		>
			<div className="easymde-settings-center__markdown-field-control">
				{children}
			</div>
		</SettingsRow>
	);
}

export function MarkdownSettingsPage({
	onChange,
	settings: externalSettings,
	strings,
}: {
	onChange?: (settings: MarkdownSettingsDraft) => void;
	settings?: MarkdownSettingsDraft;
	strings: Strings;
}) {
	const editorThemeOptions: ReadonlyArray<SelectOption> = [
		{ value: "system", label: strings.automaticFollowSystem },
		{ value: "light", label: strings.light },
		{ value: "dark", label: strings.dark },
	];
	const tableAlignmentOptions: ReadonlyArray<SelectOption> = [
		{ value: "auto", label: strings.autoAlignByContent },
		{ value: "left", label: strings.alignLeft },
		{ value: "center", label: strings.alignCenter },
	];
	const codeLineNumberOptions: ReadonlyArray<SelectOption> = [
		{ value: "show", label: strings.show },
		{ value: "hide", label: strings.hide },
	];
	const lineEndingOptions: ReadonlyArray<SelectOption> = [
		{ value: "system", label: strings.automaticFollowSystem },
		{ value: "lf", label: "LF" },
		{ value: "crlf", label: "CRLF" },
	];
	const blockquoteOptions: ReadonlyArray<SelectOption> = [
		{ value: "standard", label: strings.standardBlockquote },
		{ value: "spaced", label: strings.spacedBlockquote },
	];
	const [localSettings, setLocalSettings] = useState<MarkdownSettingsDraft>(
		() => createDefaultSettings(),
	);
	const rawSettings = externalSettings ?? localSettings;
	const settings: MarkdownSettingsDraft = {
		...rawSettings,
		editorTheme: normalizeMarkdownValue(
			rawSettings.editorTheme,
			editorThemeOptions,
			"system",
		),
		tableAlignment: normalizeMarkdownValue(
			rawSettings.tableAlignment,
			tableAlignmentOptions,
			"auto",
		),
		codeLineNumbers: normalizeMarkdownValue(
			rawSettings.codeLineNumbers,
			codeLineNumberOptions,
			"show",
		),
		lineEnding: normalizeMarkdownValue(
			rawSettings.lineEnding,
			lineEndingOptions,
			"system",
		),
		blockquoteStyle: normalizeMarkdownValue(
			rawSettings.blockquoteStyle,
			blockquoteOptions,
			"standard",
		),
	};

	function setValue<K extends keyof MarkdownSettingsDraft>(
		key: K,
		value: MarkdownSettingsDraft[K],
	) {
		const next = { ...settings, [key]: value };
		if (onChange) onChange(next);
		else setLocalSettings(next);
	}

	return (
		<div className="easymde-settings-center__markdown-page">
			<UnavailableSettingsNotice
				id="easymde-markdown-unavailable"
				label={strings.settingsUnavailable}
				description={strings.settingsUnavailableDescription}
			/>
			<div className="easymde-settings-center__unavailable-fields">
				<section className="easymde-settings-center__markdown-group">
					<h2>
						<EditPencilIcon size={25} />
						{strings.markdownEditorSettings}
					</h2>
					{(
						[
							["wordWrap", strings.wordWrap, strings.wordWrapDescription],
							[
								"lineNumbers",
								strings.showLineNumbers,
								strings.markdownLineNumbersDescription,
							],
						] as const
					).map(([key, label, description]) => (
						<MarkdownRow key={key} label={label} description={description}>
							<SettingsToggle
								{...(key === "wordWrap"
									? {}
									: { ariaDescribedBy: "easymde-markdown-unavailable" })}
								label={label}
								checked={settings[key]}
								disabled={key !== "wordWrap"}
								onChange={() => setValue(key, !settings[key])}
							/>
						</MarkdownRow>
					))}
					<MarkdownRow label={strings.editorTheme}>
						<MarkdownSelect
							ariaDescribedBy="easymde-markdown-unavailable"
							disabled
							label={strings.editorTheme}
							value={settings.editorTheme}
							options={editorThemeOptions}
							onChange={(value) => setValue("editorTheme", value)}
						/>
					</MarkdownRow>
				</section>

				<section className="easymde-settings-center__markdown-group">
					<h2>
						<Code2 size={25} />
						{strings.markdownParsingRendering}
					</h2>
					{(
						[
							[
								"githubFlavor",
								strings.githubFlavor,
								strings.githubFlavorDescription,
							],
							[
								"smartPunctuation",
								strings.smartPunctuation,
								strings.smartPunctuationDescription,
							],
						] as const
					).map(([key, label, description]) => (
						<MarkdownRow key={key} label={label} description={description}>
							<SettingsToggle
								ariaDescribedBy="easymde-markdown-unavailable"
								label={label}
								checked={settings[key]}
								disabled
								onChange={() => setValue(key, !settings[key])}
							/>
						</MarkdownRow>
					))}
					<MarkdownRow label={strings.tableAlignment}>
						<MarkdownSelect
							ariaDescribedBy="easymde-markdown-unavailable"
							disabled
							label={strings.tableAlignment}
							value={settings.tableAlignment}
							options={tableAlignmentOptions}
							onChange={(value) => setValue("tableAlignment", value)}
						/>
					</MarkdownRow>
					<MarkdownRow label={strings.codeBlockLineNumbers}>
						<MarkdownSelect
							ariaDescribedBy="easymde-markdown-unavailable"
							disabled
							label={strings.codeBlockLineNumbers}
							value={settings.codeLineNumbers}
							options={codeLineNumberOptions}
							onChange={(value) => setValue("codeLineNumbers", value)}
						/>
					</MarkdownRow>
					{(
						[
							[
								"htmlRendering",
								strings.htmlRendering,
								strings.htmlRenderingDescription,
							],
						] as const
					).map(([key, label, description]) => (
						<MarkdownRow key={key} label={label} description={description}>
							<SettingsToggle
								ariaDescribedBy="easymde-markdown-unavailable"
								label={label}
								checked={settings[key]}
								disabled
								onChange={() => setValue(key, !settings[key])}
							/>
						</MarkdownRow>
					))}
				</section>

				<section className="easymde-settings-center__markdown-group is-compact-heading">
					<h2>
						<GeneralIcon size={25} />
						{strings.otherSettings}
					</h2>
					<MarkdownRow
						label={strings.pasteAsMarkdown}
						description={strings.pasteAsMarkdownDescription}
					>
						<SettingsToggle
							ariaDescribedBy="easymde-markdown-unavailable"
							label={strings.pasteAsMarkdown}
							checked={settings.pasteAsMarkdown}
							disabled
							onChange={() =>
								setValue("pasteAsMarkdown", !settings.pasteAsMarkdown)
							}
						/>
					</MarkdownRow>
					<MarkdownRow label={strings.defaultLineEnding}>
						<MarkdownSelect
							ariaDescribedBy="easymde-markdown-unavailable"
							disabled
							label={strings.defaultLineEnding}
							value={settings.lineEnding}
							options={lineEndingOptions}
							onChange={(value) => setValue("lineEnding", value)}
						/>
					</MarkdownRow>
					<MarkdownRow label={strings.unorderedListMarker}>
						<input
							className="easymde-settings-center__markdown-input"
							aria-label={strings.unorderedListMarker}
							aria-describedby="easymde-markdown-unavailable"
							disabled
							value={settings.unorderedMarker}
							onChange={(event) =>
								setValue("unorderedMarker", event.target.value)
							}
						/>
					</MarkdownRow>
					<MarkdownRow label={strings.orderedListStart}>
						<input
							className="easymde-settings-center__markdown-input"
							aria-label={strings.orderedListStart}
							aria-describedby="easymde-markdown-unavailable"
							disabled
							value={settings.orderedStart}
							onChange={(event) => setValue("orderedStart", event.target.value)}
						/>
					</MarkdownRow>
					<MarkdownRow label={strings.blockquoteIndentStyle}>
						<MarkdownSelect
							ariaDescribedBy="easymde-markdown-unavailable"
							disabled
							label={strings.blockquoteIndentStyle}
							value={settings.blockquoteStyle}
							options={blockquoteOptions}
							onChange={(value) => setValue("blockquoteStyle", value)}
						/>
					</MarkdownRow>
				</section>
			</div>
		</div>
	);
}
