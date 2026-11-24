import { createElement, useEffect, useRef } from "@wordpress/element";
import type {
	SettingsCenterBootstrap,
	SettingsCenterStringKey,
} from "../../contracts/bootstrap/settings-center-bootstrap";
import {
	buildImageObjectKeyPreview,
	type ImageSettings,
} from "../../contracts/settings-center-settings";
import { SettingsRow } from "./SettingsControls";

export type FileNameRulePair = Readonly<{
	storagePath: string;
	fileNameRule: string;
}>;

const FILE_NAME_RULE_PRESETS: ReadonlyArray<
	Readonly<
		FileNameRulePair & {
			label: SettingsCenterStringKey;
		}
	>
> = [
	{
		label: "fileNamePresetDate",
		storagePath: "{date}",
		fileNameRule: "{uuid}",
	},
	{
		label: "fileNamePresetMd5",
		storagePath: "{year}/{month}",
		fileNameRule: "{md5}",
	},
	{
		label: "fileNamePresetYearMonth",
		storagePath: "{year}/{month}",
		fileNameRule: "{uuid}",
	},
	{
		label: "fileNamePresetOriginal",
		storagePath: "{date}",
		fileNameRule: "{name}",
	},
	{
		label: "fileNamePresetArticle",
		storagePath: "{post_id}",
		fileNameRule: "{name}",
	},
	{
		label: "fileNamePresetTime",
		storagePath: "{date}",
		fileNameRule: "{time}",
	},
];

const FILE_NAME_RULE_VARIABLES: ReadonlyArray<
	Readonly<{
		token: string;
		label: SettingsCenterStringKey;
	}>
> = [
	{ token: "{year}", label: "yearVariable" },
	{ token: "{month}", label: "monthVariable" },
	{ token: "{day}", label: "dayVariable" },
	{ token: "{date}", label: "fullDateVariable" },
	{ token: "{time}", label: "uploadTimeVariable" },
	{ token: "{post_id}", label: "postIdVariable" },
	{ token: "{md5}", label: "fileMd5Variable" },
	{ token: "{uuid}", label: "uuidVariable" },
	{ token: "{name}", label: "originalNameVariable" },
];

export function ImageFileNameRuleEditor({
	fileNameRule,
	onChange,
	onPresetChange,
	storagePath,
	strings,
	uploadFormats,
}: {
	fileNameRule: string;
	onChange: (field: "fileNameRule" | "storagePath", value: string) => void;
	onPresetChange: (pair: FileNameRulePair) => void;
	storagePath: string;
	strings: SettingsCenterBootstrap["strings"];
	uploadFormats: ImageSettings["uploadFormats"];
}) {
	const storagePathInputRef = useRef<HTMLInputElement>(null);
	const fileNameRuleInputRef = useRef<HTMLInputElement>(null);
	const activeFieldRef = useRef<"fileNameRule" | "storagePath">("fileNameRule");
	const pendingCursorRef = useRef<{
		field: "fileNameRule" | "storagePath";
		position: number;
	} | null>(null);

	useEffect(() => {
		const pendingCursor = pendingCursorRef.current;
		if (pendingCursor === null) return;
		const input =
			pendingCursor.field === "storagePath"
				? storagePathInputRef.current
				: fileNameRuleInputRef.current;
		if (!input) throw new Error("settings-center-file-name-rule-input-missing");
		pendingCursorRef.current = null;
		input.focus();
		input.setSelectionRange(pendingCursor.position, pendingCursor.position);
	}, [fileNameRule, storagePath]);

	const insertVariable = (token: string) => {
		const field = activeFieldRef.current;
		const input =
			field === "storagePath"
				? storagePathInputRef.current
				: fileNameRuleInputRef.current;
		if (!input) throw new Error("settings-center-file-name-rule-input-missing");
		const start = input.selectionStart;
		const end = input.selectionEnd;
		if (start === null || end === null) {
			throw new Error("settings-center-file-name-rule-selection-unavailable");
		}
		const value = field === "storagePath" ? storagePath : fileNameRule;
		pendingCursorRef.current = { field, position: start + token.length };
		onChange(field, `${value.slice(0, start)}${token}${value.slice(end)}`);
	};

	const example = buildImageObjectKeyPreview(
		storagePath,
		fileNameRule,
		uploadFormats,
	);
	return (
		<div className="easymde-settings-center__file-name-editor">
			<SettingsRow
				label={strings.storagePath}
				description={strings.storagePathDescription}
				minHeight={60}
			>
				<div className="easymde-settings-center__image-field-control">
					<input
						ref={storagePathInputRef}
						className="easymde-settings-center__file-name-input"
						aria-label={strings.storagePath}
						value={storagePath}
						onFocus={() => {
							activeFieldRef.current = "storagePath";
						}}
						onChange={(event) => onChange("storagePath", event.target.value)}
					/>
				</div>
			</SettingsRow>
			<SettingsRow
				label={strings.fileNameRule}
				description={strings.fileNameRuleDescription}
				minHeight={60}
			>
				<div className="easymde-settings-center__image-field-control">
					<input
						ref={fileNameRuleInputRef}
						className="easymde-settings-center__file-name-input"
						aria-label={strings.fileNameRule}
						value={fileNameRule}
						onFocus={() => {
							activeFieldRef.current = "fileNameRule";
						}}
						onChange={(event) => onChange("fileNameRule", event.target.value)}
					/>
				</div>
			</SettingsRow>
			<div className="easymde-settings-center__file-name-details">
				<div aria-hidden="true" />
				<div>
					<div className="easymde-settings-center__file-name-template-heading">
						<span>{strings.commonFileNameTemplates}</span>
						<span>{strings.selectTemplateToFillRule}</span>
					</div>
					<div className="easymde-settings-center__file-name-presets">
						{FILE_NAME_RULE_PRESETS.map((preset, index) => {
							const active =
								storagePath === preset.storagePath &&
								fileNameRule === preset.fileNameRule;
							return (
								<button
									key={preset.label}
									type="button"
									aria-label={strings[preset.label]}
									aria-pressed={active}
									data-preset-index={index}
									onClick={() =>
										onPresetChange({
											storagePath: preset.storagePath,
											fileNameRule: preset.fileNameRule,
										})
									}
								>
									<span className="easymde-settings-center__preset-radio">
										{active ? <span /> : null}
									</span>
									<span>
										<span>{strings[preset.label]}</span>
										<code>
											{`${preset.storagePath}/${preset.fileNameRule}`}
										</code>
									</span>
								</button>
							);
						})}
					</div>
					<div className="easymde-settings-center__file-name-variables">
						<span>{strings.availableVariables}</span>
						<div>
							{FILE_NAME_RULE_VARIABLES.map(({ label, token }) => (
								<button
									key={token}
									type="button"
									title={strings[label]}
									aria-label={`${strings.insertFileNameVariable.replace("%s", () => strings[label])} ${token}`}
									onMouseDown={(event) => event.preventDefault()}
									onClick={() => insertVariable(token)}
								>
									{token}
								</button>
							))}
						</div>
					</div>
					<div className="easymde-settings-center__file-name-preview">
						<span>{strings.examplePreview}</span>
						<code>{example || strings.enterFileNameRule}</code>
					</div>
				</div>
			</div>
		</div>
	);
}
