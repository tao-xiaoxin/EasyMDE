import { createElement, useState } from "@wordpress/element";
import type { ReactNode } from "react";
import type { SettingsCenterBootstrap } from "../../contracts/bootstrap/settings-center-bootstrap";
import type { MarkdownSettings } from "../../contracts/settings-center-settings";
import { ChevronDown, Code2, Puzzle } from "../../generated/lucide-icons";
import {
	SettingsRow,
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
	"System Default": "system",
	Monospace: "monospace",
	"Source Han Sans": "source-han-sans",
	"Auto align by content": "auto",
	"Align left": "left",
	"Align center": "center",
	"Follow editor": "follow-editor",
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
		livePreview: true,
		wordWrap: true,
		lineNumbers: false,
		fixedToolbar: true,
		editorTheme: "system",
		editorFontSize: "14px",
		editorFont: "system",
		githubFlavor: true,
		smartPunctuation: true,
		tableAlignment: "auto",
		codeTheme: "light",
		codeLineNumbers: "show",
		taskLists: true,
		emoji: true,
		math: true,
		htmlRendering: false,
		tableExtension: true,
		footnotes: true,
		definitionLists: true,
		toc: false,
		imageSizeSyntax: true,
		pasteAsMarkdown: true,
		lineEnding: "system",
		unorderedMarker: "-",
		orderedStart: "1",
		blockquoteStyle: "standard",
	};
}

function MarkdownSelect({
	label,
	onChange,
	options,
	value,
}: {
	label: string;
	onChange: (value: string) => void;
	options: ReadonlyArray<SelectOption>;
	value: string;
}) {
	return (
		<div className="easymde-settings-center__compact-select">
			<select
				aria-label={label}
				value={value}
				onChange={(event) => onChange(event.target.value)}
			>
				{options.map((option) => (
					<option key={option.value} value={option.value}>
						{option.label}
					</option>
				))}
			</select>
			<ChevronDown size={15} />
		</div>
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
	const editorFontSizeOptions: ReadonlyArray<SelectOption> = [
		"12px",
		"13px",
		"14px",
		"15px",
		"16px",
		"18px",
	].map((value) => ({ value, label: value }));
	const editorFontOptions: ReadonlyArray<SelectOption> = [
		{ value: "system", label: strings.systemDefault },
		{ value: "monospace", label: strings.monospaceFont },
		{ value: "source-han-sans", label: strings.sourceHanSans },
	];
	const tableAlignmentOptions: ReadonlyArray<SelectOption> = [
		{ value: "auto", label: strings.autoAlignByContent },
		{ value: "left", label: strings.alignLeft },
		{ value: "center", label: strings.alignCenter },
	];
	const codeThemeOptions: ReadonlyArray<SelectOption> = [
		{ value: "light", label: strings.lightCodeTheme },
		{ value: "dark", label: strings.darkCodeTheme },
		{ value: "follow-editor", label: strings.followEditor },
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
		editorFontSize: normalizeMarkdownValue(
			rawSettings.editorFontSize,
			editorFontSizeOptions,
			"14px",
		),
		editorFont: normalizeMarkdownValue(
			rawSettings.editorFont,
			editorFontOptions,
			"system",
		),
		tableAlignment: normalizeMarkdownValue(
			rawSettings.tableAlignment,
			tableAlignmentOptions,
			"auto",
		),
		codeTheme: normalizeMarkdownValue(
			rawSettings.codeTheme,
			codeThemeOptions,
			"light",
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
				label={strings.settingsUnavailable}
				description={strings.settingsUnavailableDescription}
			/>
			<fieldset
				disabled
				className="easymde-settings-center__unavailable-fields"
			>
				<section className="easymde-settings-center__markdown-group">
					<h2>
						<EditPencilIcon size={25} />
						{strings.markdownEditorSettings}
					</h2>
					{(
						[
							[
								"livePreview",
								strings.markdownLivePreview,
								strings.livePreviewDescription,
							],
							["wordWrap", strings.wordWrap, strings.wordWrapDescription],
							[
								"lineNumbers",
								strings.showLineNumbers,
								strings.markdownLineNumbersDescription,
							],
							[
								"fixedToolbar",
								strings.fixedToolbar,
								strings.fixedToolbarDescription,
							],
						] as const
					).map(([key, label, description]) => (
						<MarkdownRow key={key} label={label} description={description}>
							<SettingsToggle
								label={label}
								checked={settings[key]}
								onChange={() => setValue(key, !settings[key])}
							/>
						</MarkdownRow>
					))}
					<MarkdownRow label={strings.editorTheme}>
						<MarkdownSelect
							label={strings.editorTheme}
							value={settings.editorTheme}
							options={editorThemeOptions}
							onChange={(value) => setValue("editorTheme", value)}
						/>
					</MarkdownRow>
					<MarkdownRow label={strings.editorFontSize}>
						<MarkdownSelect
							label={strings.editorFontSize}
							value={settings.editorFontSize}
							options={editorFontSizeOptions}
							onChange={(value) => setValue("editorFontSize", value)}
						/>
					</MarkdownRow>
					<MarkdownRow label={strings.editorFont}>
						<MarkdownSelect
							label={strings.editorFont}
							value={settings.editorFont}
							options={editorFontOptions}
							onChange={(value) => setValue("editorFont", value)}
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
								label={label}
								checked={settings[key]}
								onChange={() => setValue(key, !settings[key])}
							/>
						</MarkdownRow>
					))}
					<MarkdownRow label={strings.tableAlignment}>
						<MarkdownSelect
							label={strings.tableAlignment}
							value={settings.tableAlignment}
							options={tableAlignmentOptions}
							onChange={(value) => setValue("tableAlignment", value)}
						/>
					</MarkdownRow>
					<MarkdownRow label={strings.codeBlockTheme}>
						<MarkdownSelect
							label={strings.codeBlockTheme}
							value={settings.codeTheme}
							options={codeThemeOptions}
							onChange={(value) => setValue("codeTheme", value)}
						/>
					</MarkdownRow>
					<MarkdownRow label={strings.codeBlockLineNumbers}>
						<MarkdownSelect
							label={strings.codeBlockLineNumbers}
							value={settings.codeLineNumbers}
							options={codeLineNumberOptions}
							onChange={(value) => setValue("codeLineNumbers", value)}
						/>
					</MarkdownRow>
					{(
						[
							["taskLists", strings.taskLists, strings.taskListsDescription],
							["emoji", strings.emoji, strings.emojiDescription],
							["math", strings.mathSupport, strings.mathSupportDescription],
							[
								"htmlRendering",
								strings.htmlRendering,
								strings.htmlRenderingDescription,
							],
						] as const
					).map(([key, label, description]) => (
						<MarkdownRow key={key} label={label} description={description}>
							<SettingsToggle
								label={label}
								checked={settings[key]}
								onChange={() => setValue(key, !settings[key])}
							/>
						</MarkdownRow>
					))}
				</section>

				<section className="easymde-settings-center__markdown-group is-compact-heading">
					<h2>
						<Puzzle size={25} />
						{strings.markdownExtensions}
					</h2>
					{(
						[
							[
								"tableExtension",
								strings.tableExtension,
								strings.tableExtensionDescription,
							],
							["footnotes", strings.footnotes, strings.footnotesDescription],
							[
								"definitionLists",
								strings.definitionLists,
								strings.definitionListsDescription,
							],
							["toc", strings.tocDirectory, strings.tocDirectoryDescription],
							[
								"imageSizeSyntax",
								strings.imageSizeSyntax,
								strings.imageSizeSyntaxDescription,
							],
						] as const
					).map(([key, label, description]) => (
						<MarkdownRow key={key} label={label} description={description}>
							<SettingsToggle
								label={label}
								checked={settings[key]}
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
							label={strings.pasteAsMarkdown}
							checked={settings.pasteAsMarkdown}
							onChange={() =>
								setValue("pasteAsMarkdown", !settings.pasteAsMarkdown)
							}
						/>
					</MarkdownRow>
					<MarkdownRow label={strings.defaultLineEnding}>
						<MarkdownSelect
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
							value={settings.orderedStart}
							onChange={(event) => setValue("orderedStart", event.target.value)}
						/>
					</MarkdownRow>
					<MarkdownRow label={strings.blockquoteIndentStyle}>
						<MarkdownSelect
							label={strings.blockquoteIndentStyle}
							value={settings.blockquoteStyle}
							options={blockquoteOptions}
							onChange={(value) => setValue("blockquoteStyle", value)}
						/>
					</MarkdownRow>
				</section>
			</fieldset>
		</div>
	);
}
