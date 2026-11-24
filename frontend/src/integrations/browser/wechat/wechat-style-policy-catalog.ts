export const COPY_STYLE_PROPERTIES = [
	"display",
	"flex-direction",
	"flex-wrap",
	"flex-flow",
	"justify-content",
	"align-items",
	"align-content",
	"align-self",
	"order",
	"flex",
	"flex-grow",
	"flex-shrink",
	"flex-basis",
	"gap",
	"column-gap",
	"row-gap",
	"margin-top",
	"margin-right",
	"margin-bottom",
	"margin-left",
	"padding-top",
	"padding-right",
	"padding-bottom",
	"padding-left",
	"border-top-width",
	"border-right-width",
	"border-bottom-width",
	"border-left-width",
	"border-radius",
	"border-top-width",
	"border-right-width",
	"border-bottom-width",
	"border-left-width",
	"border-top-style",
	"border-right-style",
	"border-bottom-style",
	"border-left-style",
	"border-top-color",
	"border-right-color",
	"border-bottom-color",
	"border-left-color",
	"border-collapse",
	"border-spacing",
	"border-radius",
	"background",
	"background-color",
	"background-image",
	"background-position",
	"background-repeat",
	"background-size",
	"container-type",
	"color",
	"font",
	"font-family",
	"font-size",
	"font-style",
	"font-weight",
	"line-height",
	"letter-spacing",
	"word-spacing",
	"font-variant",
	"font-stretch",
	"text-align",
	"text-decoration",
	"text-transform",
	"text-indent",
	"text-shadow",
	"white-space",
	"word-break",
	"overflow-wrap",
	"vertical-align",
	"list-style-type",
	"list-style-position",
	"box-shadow",
	"opacity",
	"tab-size",
] as const;

export const SVG_STYLE_PROPERTIES = [
	"fill",
	"fill-opacity",
	"fill-rule",
	"stroke",
	"stroke-width",
	"stroke-linecap",
	"stroke-linejoin",
	"stroke-miterlimit",
	"stroke-opacity",
	"stroke-dasharray",
	"stroke-dashoffset",
	"marker-start",
	"marker-mid",
	"marker-end",
	"visibility",
	"transform-box",
	"clip-path",
	"clip-rule",
	"mask",
	"filter",
	"paint-order",
	"vector-effect",
	"shape-rendering",
	"mix-blend-mode",
	"text-rendering",
	"stop-color",
	"stop-opacity",
	"dominant-baseline",
	"text-anchor",
] as const;

export const SPECIAL_LAYOUT_PROPERTIES = [
	"position",
	"top",
	"right",
	"bottom",
	"left",
	"width",
	"min-width",
	"max-width",
	"height",
	"min-height",
	"max-height",
	"overflow",
	"overflow-x",
	"overflow-y",
	"box-sizing",
	"transform",
	"transform-origin",
	"z-index",
] as const;

export const ORDINARY_LAYOUT_PROPERTIES = [
	"position",
	"top",
	"right",
	"bottom",
	"left",
	"width",
	"min-width",
	"max-width",
	"height",
	"min-height",
	"max-height",
	"overflow",
	"overflow-x",
	"overflow-y",
	"box-sizing",
	"float",
	"clear",
	"transform",
	"transform-origin",
	"z-index",
] as const;

export const ORDINARY_DIMENSION_PROPERTIES = [
	"width",
	"min-width",
	"max-width",
	"height",
	"min-height",
	"max-height",
] as const;

export const SEMANTIC_MARGIN_PROPERTIES = [
	"margin-top",
	"margin-right",
	"margin-bottom",
	"margin-left",
] as const;

export const NATIVE_LAYOUT_PROPERTIES = ["table-layout"] as const;

export const SAFE_DISPLAY_VALUES: Record<string, true> = {
	block: true,
	inline: true,
	"inline-block": true,
	"inline-table": true,
	"inline-flex": true,
	"flow-root": true,
	flex: true,
	"list-item": true,
	table: true,
	contents: true,
	"table-caption": true,
	"table-cell": true,
	"table-column": true,
	"table-column-group": true,
	"table-footer-group": true,
	"table-header-group": true,
	"table-row": true,
	"table-row-group": true,
};

export const TRANSIENT_ATTRIBUTE =
	/^(?:aria-|data-|on|contenteditable$|role$|tabindex$|spellcheck$|draggable$)/i;

export const UNSAFE_STYLE_VALUE =
	/(?:url\s*\(|expression\s*\(|(?:java|vb)script\s*:|@(?:import|charset|font-face)|(?:-moz-binding|behavior)\s*:|--[a-z])/i;

export const UNSAFE_URL = /^(?:data|javascript|vbscript|file|about):/i;

export const URL_ATTRIBUTES = new Set([
	"action",
	"formaction",
	"href",
	"poster",
	"src",
	"xlink:href",
]);

export const DEFAULT_STYLE_VALUES: Record<string, Set<string>> = {
	"align-content": new Set(["normal", "stretch"]),
	"align-items": new Set(["normal", "stretch"]),
	"align-self": new Set(["auto"]),
	"box-shadow": new Set(["none"]),
	"column-gap": new Set(["normal", "0px"]),
	"container-type": new Set(["normal"]),
	display: new Set(),
	"flex-basis": new Set(["auto"]),
	"flex-direction": new Set(["row"]),
	"flex-flow": new Set(["row nowrap"]),
	"flex-wrap": new Set(["nowrap"]),
	"flex-grow": new Set(["0"]),
	"flex-shrink": new Set(["1"]),
	"font-stretch": new Set(["100%"]),
	"font-variant": new Set(["normal"]),
	gap: new Set(["normal", "0px"]),
	"justify-content": new Set(["normal", "flex-start"]),
	"list-style-position": new Set(["outside"]),
	opacity: new Set(["1"]),
	order: new Set(["0"]),
	"row-gap": new Set(["normal", "0px"]),
	"tab-size": new Set(["8"]),
	"text-indent": new Set(["0px"]),
	"text-shadow": new Set(["none"]),
	"text-transform": new Set(["none"]),
	"vertical-align": new Set(["baseline"]),
	"white-space": new Set(["normal"]),
};

export const PRESERVE_INHERITED_DEFAULT_STYLE_PROPERTIES = new Set([
	"font-style",
	"font-variant",
	"font-stretch",
	"letter-spacing",
	"text-transform",
	"white-space",
	"text-indent",
	"text-shadow",
	"tab-size",
	"list-style-position",
]);

export const PREPARED_PSEUDO_ELEMENTS = ["::before", "::after"] as const;

export function uniqueStyleProperties(
	...groups: ReadonlyArray<ReadonlyArray<string>>
): string[] {
	return [...new Set(groups.flat())];
}

export const ROOT_EXPORT_STYLE_PROPERTIES = new Set(
	uniqueStyleProperties(
		COPY_STYLE_PROPERTIES,
		ORDINARY_LAYOUT_PROPERTIES,
		SPECIAL_LAYOUT_PROPERTIES,
		SVG_STYLE_PROPERTIES,
		[
			"content",
			"direction",
			"box-sizing",
			"visibility",
			"content-visibility",
			"width",
			"height",
		],
	),
);

export const CONTENT_BOX_DIMENSION_PROPERTIES = [
	"width",
	"min-width",
	"max-width",
	"height",
	"min-height",
	"max-height",
] as const;

export const CONTENT_BOX_PERCENTAGE_TOKEN =
	/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?[0-9]+)?%$/;

export const CONTENT_BOX_PIXEL_TOKEN =
	/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?[0-9]+)?px$/i;

export const CONTENT_BOX_DIMENSION_KEYWORDS: Readonly<
	Record<(typeof CONTENT_BOX_DIMENSION_PROPERTIES)[number], ReadonlySet<string>>
> = {
	width: new Set(["auto"]),
	"min-width": new Set(["auto"]),
	"max-width": new Set(["none"]),
	height: new Set(["auto"]),
	"min-height": new Set(["auto"]),
	"max-height": new Set(["none"]),
};

export const CONTENT_BOX_REPLACED_ELEMENTS = new Set([
	"audio",
	"canvas",
	"embed",
	"iframe",
	"img",
	"input",
	"object",
	"picture",
	"select",
	"source",
	"textarea",
	"track",
	"video",
]);

export const CONTENT_BOX_PROMOTED_PROPERTIES = new Set([
	"box-sizing",
	"max-width",
]);

export const CONTENT_BOX_EXCLUDED_PARENT_DISPLAYS = new Set([
	"flex",
	"inline-flex",
	"grid",
	"inline-grid",
	"table",
	"inline-table",
	"table-caption",
	"table-cell",
	"table-column",
	"table-column-group",
	"table-footer-group",
	"table-header-group",
	"table-row",
	"table-row-group",
]);

export const CSS_PERCENTAGE_TOKEN =
	/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?%$/;

export const CSS_URL = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi;

export const SAFE_DATA_IMAGE =
	/^data:image\/(?:gif|jpe?g|png|webp);base64,[a-z\d+/=]+$/i;

export const MAX_DATA_IMAGE_LENGTH = 4_000_000;

export function hasOnlySafeDataImageUrls(value: string): boolean {
	const matches = [...value.matchAll(CSS_URL)];
	return (
		matches.length > 0 &&
		matches.every((match) =>
			SAFE_DATA_IMAGE.test((match[1] ?? match[2] ?? match[3] ?? "").trim()),
		)
	);
}

export const WECHAT_EXPORT_STYLE_CONTEXT_ATTRIBUTE =
	"data-easymde-wechat-export-style-context";

export const SIGNATURE_ORDINARY_ROOT_PROPERTIES = uniqueStyleProperties(
	COPY_STYLE_PROPERTIES,
	["direction", "position"],
);

export const SIGNATURE_ORDINARY_PROPERTIES = uniqueStyleProperties(
	COPY_STYLE_PROPERTIES,
	ORDINARY_LAYOUT_PROPERTIES,
	["direction"],
);

export const SIGNATURE_SPECIAL_PROPERTIES = uniqueStyleProperties(
	COPY_STYLE_PROPERTIES,
	SPECIAL_LAYOUT_PROPERTIES,
	["direction"],
);

export const SIGNATURE_SVG_PROPERTIES = uniqueStyleProperties(
	COPY_STYLE_PROPERTIES,
	SVG_STYLE_PROPERTIES,
	SPECIAL_LAYOUT_PROPERTIES,
	["direction"],
);

export const SIGNATURE_ORDINARY_ROOT_PSEUDO_PROPERTIES = uniqueStyleProperties(
	SIGNATURE_ORDINARY_ROOT_PROPERTIES,
	["content", "width", "height", "box-sizing"],
);

export const SIGNATURE_ORDINARY_PSEUDO_PROPERTIES = uniqueStyleProperties(
	SIGNATURE_ORDINARY_PROPERTIES,
	["content", "width", "height"],
);

export const SIGNATURE_SPECIAL_PSEUDO_PROPERTIES = uniqueStyleProperties(
	SIGNATURE_SPECIAL_PROPERTIES,
	["content", "width", "height"],
);

export const SIGNATURE_SVG_PSEUDO_PROPERTIES = uniqueStyleProperties(
	SIGNATURE_SVG_PROPERTIES,
	["content", "width", "height"],
);

export const TASK_LIST_CHECKBOX_STYLE_PROPERTIES = [
	"appearance",
	"-webkit-appearance",
	"-moz-appearance",
	"-ms-appearance",
	"accent-color",
] as const;
