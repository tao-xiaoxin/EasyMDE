import { createElement } from "@wordpress/element";
import type { ReactNode } from "react";

type SearchField = ReadonlyArray<string | undefined>;

export function matchesSettingsQuery(
	query: string,
	field: SearchField,
): boolean {
	return !query || field.some((value) => value?.toLowerCase().includes(query));
}

export function SettingsToggle({
	checked,
	disabled = false,
	label,
	onChange,
}: {
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
