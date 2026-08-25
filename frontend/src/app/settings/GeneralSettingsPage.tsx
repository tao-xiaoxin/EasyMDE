import { createElement, useState } from "@wordpress/element";
import type { ReactNode } from "react";
import type { SettingsCenterBootstrap } from "../../contracts/bootstrap/settings-center-bootstrap";
import type {
	GeneralSettings,
	SummaryMode,
} from "../../contracts/settings-center-settings";
import {
	matchesSettingsQuery,
	SettingsRow,
	SettingsSelect,
	SettingsToggle,
} from "./SettingsControls";
import {
	DocumentIcon,
	EditPencilIcon,
	SlidersIcon,
} from "./settings-center-icons";
import { formatSinglePlaceholder } from "./settings-center-utils";

type Draft = GeneralSettings;

type Strings = SettingsCenterBootstrap["strings"];

const DEFAULT_DRAFT: Draft = {
	interfaceLanguage: "zh-CN",
	editingMode: "live-preview",
	autoFocusEditor: true,
	showLineNumbers: true,
	syntaxHighlight: true,
	statusBarMode: "words-reading-time",
	autoSave: true,
	autoSaveInterval: "60",
	syncScroll: true,
	publishVisibility: "public",
	openPreviewAfterPublish: true,
	applyEditorThemeToFrontend: true,
	showPublishedCodeCopyButton: true,
	summaryMode: "auto-55",
	featuredImagePlaceholder: true,
};

function NativeSelect({
	label,
	onChange,
	options,
	value,
}: {
	label: string;
	onChange: (value: string) => void;
	options: ReadonlyArray<readonly [string, string]>;
	value: string;
}) {
	return (
		<SettingsSelect
			label={label}
			value={value}
			onChange={onChange}
			options={options.map(([optionValue, optionLabel]) => ({
				value: optionValue,
				label: optionLabel,
			}))}
		/>
	);
}

export function matchesGeneralSettingsQuery(
	query: string,
	s: Strings,
): boolean {
	const normalizedQuery = query.trim().toLowerCase();
	const searchFields: ReadonlyArray<ReadonlyArray<string | undefined>> = [
		[s.defaultEditingMode],
		[s.autoFocusEditor, s.autoFocusEditorDescription],
		[s.showLineNumbers, s.showLineNumbersDescription],
		[s.syntaxHighlight, s.syntaxHighlightDescription],
		[s.statusBarDisplay],
		[s.autoSave, s.autoSaveDescription],
		[s.autoSaveInterval],
		[s.syncScroll, s.syncScrollDescription],
		[s.defaultVisibility],
		[s.openPreviewAfterPublish, s.openPreviewAfterPublishDescription],
		[s.applyEditorThemeToFrontend, s.applyEditorThemeToFrontendDescription],
		[s.showPublishedCodeCopyButton, s.showPublishedCodeCopyButtonDescription],
		[s.summaryMode, s.summaryModeDescription],
		[s.featuredImagePlaceholder, s.featuredImagePlaceholderDescription],
	];

	return searchFields.some((field) =>
		matchesSettingsQuery(normalizedQuery, field),
	);
}

function SettingsSection({
	children,
	icon: Icon,
	title,
}: {
	children: ReactNode;
	icon: typeof SlidersIcon;
	title: string;
}) {
	return (
		<section className="easymde-settings-center__section">
			<h2>
				<Icon size={24} />
				<span>{title}</span>
			</h2>
			<div className="easymde-settings-center__section-body">{children}</div>
		</section>
	);
}

export function GeneralSettingsPage({
	embedded = false,
	onChange,
	query,
	searchEmptyIllustrationUrl,
	settings,
	strings: s,
}: {
	embedded?: boolean;
	onChange?: (settings: Draft) => void;
	query: string;
	searchEmptyIllustrationUrl: string;
	settings?: Draft;
	strings: Strings;
}) {
	const [localDraft, setLocalDraft] = useState<Draft>(DEFAULT_DRAFT);
	const draft = settings ?? localDraft;
	const normalizedQuery = query.trim().toLowerCase();
	const setValue = <Key extends keyof Draft>(key: Key, value: Draft[Key]) => {
		const next = { ...draft, [key]: value };
		if (onChange) onChange(next);
		else setLocalDraft(next);
	};

	if (normalizedQuery && !matchesGeneralSettingsQuery(normalizedQuery, s)) {
		return (
			<section
				className="easymde-settings-center__no-results"
				aria-live="polite"
			>
				<div className="easymde-settings-center__no-results-body">
					<div aria-hidden="true">
						<img src={searchEmptyIllustrationUrl} alt="" />
					</div>
					<h2>{formatSinglePlaceholder(s.noSearchResults, query.trim())}</h2>
					<p>{s.noSearchResultsDescription}</p>
				</div>
			</section>
		);
	}

	return (
		<div
			className={
				embedded
					? "easymde-settings-center__general-settings"
					: "easymde-settings-center__sections"
			}
		>
			<SettingsSection icon={SlidersIcon} title={s.basePreferences}>
				<SettingsRow label={s.defaultEditingMode} query={normalizedQuery}>
					<NativeSelect
						label={s.defaultEditingMode}
						value={draft.editingMode}
						onChange={(value) => setValue("editingMode", value)}
						options={[
							["live-preview", s.livePreview],
							["source", s.sourceEditing],
							["preview", s.previewOnly],
						]}
					/>
				</SettingsRow>
				<SettingsRow label={s.statusBarDisplay} query={normalizedQuery}>
					<NativeSelect
						label={s.statusBarDisplay}
						value={draft.statusBarMode}
						onChange={(value) => setValue("statusBarMode", value)}
						options={[
							["words-reading-time", s.wordsAndReadingTime],
							["words", s.wordsOnly],
							["hidden", s.hiddenStatusBar],
						]}
					/>
				</SettingsRow>
				<SettingsRow
					label={s.autoFocusEditor}
					description={s.autoFocusEditorDescription}
					query={normalizedQuery}
				>
					<SettingsToggle
						label={s.autoFocusEditor}
						checked={draft.autoFocusEditor}
						onChange={() => setValue("autoFocusEditor", !draft.autoFocusEditor)}
					/>
				</SettingsRow>
				<SettingsRow
					label={s.showLineNumbers}
					description={s.showLineNumbersDescription}
					query={normalizedQuery}
				>
					<SettingsToggle
						label={s.showLineNumbers}
						checked={draft.showLineNumbers}
						onChange={() => setValue("showLineNumbers", !draft.showLineNumbers)}
					/>
				</SettingsRow>
				<SettingsRow
					label={s.syntaxHighlight}
					description={s.syntaxHighlightDescription}
					query={normalizedQuery}
				>
					<SettingsToggle
						label={s.syntaxHighlight}
						checked={draft.syntaxHighlight}
						onChange={() => setValue("syntaxHighlight", !draft.syntaxHighlight)}
					/>
				</SettingsRow>
			</SettingsSection>
			<SettingsSection icon={EditPencilIcon} title={s.editorBehavior}>
				<SettingsRow
					label={s.autoSave}
					description={s.autoSaveDescription}
					query={normalizedQuery}
				>
					<SettingsToggle
						label={s.autoSave}
						checked={draft.autoSave}
						onChange={() => setValue("autoSave", !draft.autoSave)}
					/>
				</SettingsRow>
				<SettingsRow label={s.autoSaveInterval} query={normalizedQuery}>
					<NativeSelect
						label={s.autoSaveInterval}
						value={draft.autoSaveInterval}
						onChange={(value) => setValue("autoSaveInterval", value)}
						options={[
							["30", s.seconds30],
							["60", s.seconds60],
							["120", s.minutes2],
							["300", s.minutes5],
						]}
					/>
				</SettingsRow>
				<SettingsRow
					label={s.syncScroll}
					description={s.syncScrollDescription}
					query={normalizedQuery}
				>
					<SettingsToggle
						label={s.syncScroll}
						checked={draft.syncScroll}
						onChange={() => setValue("syncScroll", !draft.syncScroll)}
					/>
				</SettingsRow>
			</SettingsSection>
			<SettingsSection icon={DocumentIcon} title={s.documentDefaults}>
				<SettingsRow label={s.defaultVisibility} query={normalizedQuery}>
					<NativeSelect
						label={s.defaultVisibility}
						value={draft.publishVisibility}
						onChange={(value) => setValue("publishVisibility", value)}
						options={[
							["public", s.publicVisibility],
							["private", s.privateVisibility],
							["password", s.passwordProtected],
						]}
					/>
				</SettingsRow>
				<SettingsRow
					label={s.openPreviewAfterPublish}
					description={s.openPreviewAfterPublishDescription}
					query={normalizedQuery}
				>
					<SettingsToggle
						label={s.openPreviewAfterPublish}
						checked={draft.openPreviewAfterPublish}
						onChange={() =>
							setValue(
								"openPreviewAfterPublish",
								!draft.openPreviewAfterPublish,
							)
						}
					/>
				</SettingsRow>
				<SettingsRow
					label={s.applyEditorThemeToFrontend}
					description={s.applyEditorThemeToFrontendDescription}
					query={normalizedQuery}
				>
					<SettingsToggle
						label={s.applyEditorThemeToFrontend}
						checked={draft.applyEditorThemeToFrontend}
						onChange={() =>
							setValue(
								"applyEditorThemeToFrontend",
								!draft.applyEditorThemeToFrontend,
							)
						}
					/>
				</SettingsRow>
				<SettingsRow
					label={s.showPublishedCodeCopyButton}
					description={s.showPublishedCodeCopyButtonDescription}
					query={normalizedQuery}
				>
					<SettingsToggle
						label={s.showPublishedCodeCopyButton}
						checked={draft.showPublishedCodeCopyButton}
						onChange={() =>
							setValue(
								"showPublishedCodeCopyButton",
								!draft.showPublishedCodeCopyButton,
							)
						}
					/>
				</SettingsRow>
				<SettingsRow
					label={s.summaryMode}
					description={s.summaryModeDescription}
					query={normalizedQuery}
				>
					<NativeSelect
						label={s.summaryMode}
						value={draft.summaryMode}
						onChange={(value) =>
							setValue("summaryMode", value as SummaryMode)
						}
						options={[
							["auto-55", s.summary55],
							["auto-100", s.summary100],
							["manual", s.manualSummary],
						]}
					/>
				</SettingsRow>
				<SettingsRow
					label={s.featuredImagePlaceholder}
					description={s.featuredImagePlaceholderDescription}
					query={normalizedQuery}
				>
					<SettingsToggle
						label={s.featuredImagePlaceholder}
						checked={draft.featuredImagePlaceholder}
						onChange={() =>
							setValue(
								"featuredImagePlaceholder",
								!draft.featuredImagePlaceholder,
							)
						}
					/>
				</SettingsRow>
			</SettingsSection>
		</div>
	);
}
