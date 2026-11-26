import { isTaskListCheckbox } from "./wechat-clone-metadata";
import {
	CONTENT_BOX_REPLACED_ELEMENTS,
	DEFAULT_STYLE_VALUES,
	WECHAT_GRADIENT_FUNCTION,
} from "./wechat-style-policy-catalog";
import {
	isInsideTable,
	type WechatTreePredicateCache,
} from "./wechat-tree-predicates";

const NOOP_BACKGROUND_SHORTHAND_TOKENS: ReadonlySet<string> = new Set([
	"transparent",
	"none",
	"repeat",
	"scroll",
	"0%",
	"0px",
	"0",
	"/",
	"auto",
	"padding-box",
	"border-box",
]);

const DEFAULT_BACKGROUND_POSITION_VALUES: ReadonlySet<string> = new Set([
	"0% 0%",
	"0px 0px",
	"0 0",
]);

const DEFAULT_BACKGROUND_REPEAT_VALUES: ReadonlySet<string> = new Set([
	"repeat",
	"repeat repeat",
]);

const DEFAULT_BACKGROUND_SIZE_VALUES: ReadonlySet<string> = new Set([
	"auto",
	"auto auto",
]);

const BORDER_PRUNE_EXCLUDED_TAGS: ReadonlySet<string> = new Set([
	"table",
	"thead",
	"tbody",
	"tfoot",
	"tr",
	"th",
	"td",
	"caption",
	"colgroup",
	"col",
	"hr",
	"blockquote",
	"input",
	"fieldset",
	"button",
	"textarea",
	"select",
	"iframe",
]);

type BorderSide = "top" | "right" | "bottom" | "left";

/**
 * Per-element memoized cache for computed-style pruning reads across the
 * property loop of a single element snapshot. Construct once per
 * `(source, computed, pseudoElement, root)` context and discard after its
 * declaration loop completes.
 */
export type WechatElementStylePruningCache = {
	readonly borderPruneEligible: boolean;
	borderlessSides?: Partial<Record<BorderSide, boolean>>;
	hasPaintedBackgroundImage?: boolean;
	readonly localName: string;
	nonTableBorderModel?: boolean;
	readonly taskListCheckbox: boolean;
};

export type ShouldPruneDefaultStyleOptions = Readonly<{
	computed?: CSSStyleDeclaration | undefined;
	isSvg: boolean;
	predicates?: WechatTreePredicateCache | undefined;
	pruningCache?: WechatElementStylePruningCache | undefined;
	pseudoElement: boolean;
	root: boolean;
}>;

const BORDER_EDGE_SIDE_BY_PROPERTY: ReadonlyMap<string, BorderSide> = new Map([
	["border-top-width", "top"],
	["border-top-style", "top"],
	["border-top-color", "top"],
	["border-right-width", "right"],
	["border-right-style", "right"],
	["border-right-color", "right"],
	["border-bottom-width", "bottom"],
	["border-bottom-style", "bottom"],
	["border-bottom-color", "bottom"],
	["border-left-width", "left"],
	["border-left-style", "left"],
	["border-left-color", "left"],
]);

const TABLE_DISPLAY_VALUES: ReadonlySet<string> = new Set([
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

const OVERFLOW_PROPERTIES: ReadonlySet<string> = new Set([
	"overflow",
	"overflow-x",
	"overflow-y",
]);

const TASK_CHECKBOX_PRESERVED_DEFAULT_PROPERTIES: ReadonlySet<string> = new Set(
	["position", "transform"],
);

const SVG_PRESENTATION_ATTRIBUTE_OVERRIDE_PROPERTIES: ReadonlySet<string> =
	new Set(["clip-path", "filter", "mask", "transform", "vector-effect"]);

function computeBorderPruneEligible(
	localName: string,
	taskListCheckbox: boolean,
	pseudoElement: boolean,
	root: boolean,
): boolean {
	return (
		!root &&
		!pseudoElement &&
		!taskListCheckbox &&
		!BORDER_PRUNE_EXCLUDED_TAGS.has(localName)
	);
}

/**
 * Canonical factory for per-element style-pruning state so `borderPruneEligible`,
 * `localName`, and `taskListCheckbox` have a single source of truth.
 */
export function createElementStylePruningCache(
	source: Element,
	options?: Readonly<{ pseudoElement?: boolean; root?: boolean }>,
): WechatElementStylePruningCache {
	const pseudoElement = options?.pseudoElement ?? false;
	const root = options?.root ?? false;
	const localName = source.localName.toLowerCase();
	const taskListCheckbox = isTaskListCheckbox(source);
	return {
		borderPruneEligible: computeBorderPruneEligible(
			localName,
			taskListCheckbox,
			pseudoElement,
			root,
		),
		localName,
		taskListCheckbox,
	};
}

function isNoopTransparentBackgroundShorthand(value: string): boolean {
	const normalized = value.trim().toLowerCase();
	if (
		!normalized ||
		normalized.includes("url(") ||
		WECHAT_GRADIENT_FUNCTION.test(normalized)
	) {
		return false;
	}
	let hasTransparentColor = false;
	const withoutTransparentRgba = normalized
		.replace(/rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0(?:\.0+)?\s*\)/g, () => {
			hasTransparentColor = true;
			return " transparent ";
		})
		.replace(/rgba?\(\s*0\s+0\s+0\s*\/\s*0(?:\.0+)?%?\s*\)/g, () => {
			hasTransparentColor = true;
			return " transparent ";
		});
	if (withoutTransparentRgba.includes(",")) return false;
	const tokens = withoutTransparentRgba.trim().split(/\s+/);
	if (!tokens.length) return false;
	for (const token of tokens) {
		if ("transparent" === token) hasTransparentColor = true;
		if (!NOOP_BACKGROUND_SHORTHAND_TOKENS.has(token)) return false;
	}
	return hasTransparentColor;
}

function hasPaintedBackgroundImage(computed: CSSStyleDeclaration): boolean {
	const backgroundImage = computed
		.getPropertyValue("background-image")
		.trim()
		.toLowerCase();
	if (backgroundImage && "none" !== backgroundImage) return true;
	const background = computed
		.getPropertyValue("background")
		.trim()
		.toLowerCase();
	return (
		Boolean(background) &&
		(background.includes("url(") || WECHAT_GRADIENT_FUNCTION.test(background))
	);
}

function resolveHasPaintedBackgroundImage(
	computed: CSSStyleDeclaration,
	pruningCache: WechatElementStylePruningCache | undefined,
): boolean {
	if (undefined !== pruningCache?.hasPaintedBackgroundImage) {
		return pruningCache.hasPaintedBackgroundImage;
	}
	const painted = hasPaintedBackgroundImage(computed);
	if (pruningCache) pruningCache.hasPaintedBackgroundImage = painted;
	return painted;
}

function shouldOmitDefaultBackgroundProperty(
	property: string,
	value: string,
	computed: CSSStyleDeclaration | undefined,
	pruningCache: WechatElementStylePruningCache | undefined,
): boolean {
	if (!property.startsWith("background")) return false;
	if ("background" === property) {
		return isNoopTransparentBackgroundShorthand(value);
	}
	const normalized = value.trim().toLowerCase();
	if ("background-image" === property) {
		return (
			"none" === normalized &&
			(!computed || !resolveHasPaintedBackgroundImage(computed, pruningCache))
		);
	}
	if (!computed) return false;
	if ("background-position" === property) {
		return (
			DEFAULT_BACKGROUND_POSITION_VALUES.has(normalized) &&
			!resolveHasPaintedBackgroundImage(computed, pruningCache)
		);
	}
	if ("background-repeat" === property) {
		return (
			DEFAULT_BACKGROUND_REPEAT_VALUES.has(normalized) &&
			!resolveHasPaintedBackgroundImage(computed, pruningCache)
		);
	}
	if ("background-size" === property) {
		return (
			DEFAULT_BACKGROUND_SIZE_VALUES.has(normalized) &&
			!resolveHasPaintedBackgroundImage(computed, pruningCache)
		);
	}
	return false;
}

function isBorderSideBorderless(
	side: BorderSide,
	computed: CSSStyleDeclaration,
	pruningCache: WechatElementStylePruningCache | undefined,
): boolean {
	const cached = pruningCache?.borderlessSides?.[side];
	if (undefined !== cached) return cached;
	const edgeStyle = computed
		.getPropertyValue(`border-${side}-style`)
		.trim()
		.toLowerCase();
	let borderless = false;
	if ("none" === edgeStyle) {
		const edgeWidth = computed
			.getPropertyValue(`border-${side}-width`)
			.trim()
			.toLowerCase();
		borderless = "0px" === edgeWidth || "0" === edgeWidth;
	}
	if (pruningCache) {
		if (!pruningCache.borderlessSides) pruningCache.borderlessSides = {};
		pruningCache.borderlessSides[side] = borderless;
	}
	return borderless;
}

function shouldOmitBorderlessProperty(
	property: string,
	value: string,
	localName: string,
	pseudoElement: boolean,
	root: boolean,
	computed: CSSStyleDeclaration | undefined,
	pruningCache: WechatElementStylePruningCache | undefined,
	getTaskListCheckbox: () => boolean,
): boolean {
	if ("border-radius" === property) {
		if ("0px" !== value && "0" !== value) return false;
		return pruningCache
			? pruningCache.borderPruneEligible
			: computeBorderPruneEligible(
					localName,
					getTaskListCheckbox(),
					pseudoElement,
					root,
				);
	}
	if (!computed || !property.startsWith("border-")) return false;
	const side = BORDER_EDGE_SIDE_BY_PROPERTY.get(property);
	if (!side) return false;
	const eligible = pruningCache
		? pruningCache.borderPruneEligible
		: computeBorderPruneEligible(
				localName,
				getTaskListCheckbox(),
				pseudoElement,
				root,
			);
	if (!eligible) return false;
	return isBorderSideBorderless(side, computed, pruningCache);
}

function shouldOmitNonTableBorderModel(
	property: string,
	value: string,
	source: Element,
	isSvg: boolean,
	computed: CSSStyleDeclaration | undefined,
	predicates: WechatTreePredicateCache | undefined,
	pruningCache: WechatElementStylePruningCache | undefined,
): boolean {
	const isDefaultBorderModel =
		("border-collapse" === property &&
			"separate" === value.trim().toLowerCase()) ||
		("border-spacing" === property &&
			("0px" === value || "0px 0px" === value || "0" === value));
	if (!isDefaultBorderModel) return false;
	if (isSvg) return true;
	if (undefined !== pruningCache?.nonTableBorderModel) {
		return pruningCache.nonTableBorderModel;
	}
	const display = computed
		? computed.getPropertyValue("display").trim().toLowerCase()
		: "";
	let nonTable = !TABLE_DISPLAY_VALUES.has(display);
	if (nonTable) {
		const insideTable = predicates
			? predicates.isInsideTable(source)
			: isInsideTable(source);
		nonTable = !insideTable;
	}
	if (pruningCache) pruningCache.nonTableBorderModel = nonTable;
	return nonTable;
}

function preservesSvgPresentationAttributeOverride(
	property: string,
	source: Element,
	isSvg: boolean,
): boolean {
	return (
		isSvg &&
		SVG_PRESENTATION_ATTRIBUTE_OVERRIDE_PROPERTIES.has(property) &&
		source.hasAttribute(property)
	);
}

export function shouldPruneDefaultStyle(
	property: string,
	value: string,
	source: Element,
	options: ShouldPruneDefaultStyleOptions,
): boolean {
	const { computed, isSvg, predicates, pruningCache, pseudoElement, root } =
		options;
	const localName = pruningCache
		? pruningCache.localName
		: source.localName.toLowerCase();
	if (
		("stop-color" === property || "stop-opacity" === property) &&
		"stop" !== localName
	) {
		return true;
	}
	let resolvedTaskListCheckbox = pruningCache?.taskListCheckbox;
	const getTaskListCheckbox = (): boolean => {
		if (undefined === resolvedTaskListCheckbox) {
			resolvedTaskListCheckbox = isTaskListCheckbox(source);
		}
		return resolvedTaskListCheckbox;
	};
	if (
		property.startsWith("background") &&
		!getTaskListCheckbox() &&
		shouldOmitDefaultBackgroundProperty(property, value, computed, pruningCache)
	) {
		return true;
	}
	if (
		shouldOmitBorderlessProperty(
			property,
			value,
			localName,
			pseudoElement,
			root,
			computed,
			pruningCache,
			getTaskListCheckbox,
		)
	) {
		return true;
	}
	if (
		shouldOmitNonTableBorderModel(
			property,
			value,
			source,
			isSvg,
			computed,
			predicates,
			pruningCache,
		)
	) {
		return true;
	}
	if (
		DEFAULT_STYLE_VALUES[property]?.has(value) &&
		!(
			OVERFLOW_PROPERTIES.has(property) &&
			(isSvg || CONTENT_BOX_REPLACED_ELEMENTS.has(localName))
		) &&
		!(
			TASK_CHECKBOX_PRESERVED_DEFAULT_PROPERTIES.has(property) &&
			getTaskListCheckbox()
		) &&
		!preservesSvgPresentationAttributeOverride(property, source, isSvg)
	) {
		return true;
	}
	return false;
}
