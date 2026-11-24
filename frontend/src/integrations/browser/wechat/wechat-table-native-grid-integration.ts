import type { BrowserWechatClipboardRuntime } from "./wechat-clipboard-runtime";
import {
	HIDDEN_NODES,
	visualRasterizationKind,
	WECHAT_PNG_VISUAL_CLONES,
} from "./wechat-clone-metadata";
import { appendDeclarations } from "./wechat-style-policy";
import {
	collectWechatTableNativeGridEvidence,
	planWechatTableNativeGridApply,
	readWechatTableNativeGridInput,
	type WechatTableNativeGridInput,
	type WechatTableNativeGridPlan,
} from "./wechat-table-native-grid";

export type WechatTableNativeGridSerializationPlan = WechatTableNativeGridPlan &
	Readonly<{
		source: HTMLTableElement;
		target: HTMLTableElement;
	}>;

export type WechatTableNativeGridGuard = Readonly<{
	assertCurrent: () => void;
}>;

type TableBaseline = Readonly<{
	input: string | null;
	omitted: boolean;
	source: HTMLTableElement;
}>;

function tableInputSignature(input: WechatTableNativeGridInput): string {
	return JSON.stringify({
		issues: input.issues,
		key: input.key,
		state: input.state,
	});
}

function explicitTableGridIssue(
	input: WechatTableNativeGridInput,
): string | null {
	if ("unreadable" === input.state) return input.issues[0] ?? "unreadable";
	const snapshot = input.snapshot;
	if (!snapshot) return null;
	const pseudo = snapshot.pseudoStyles;
	const table = snapshot.tableStyles;
	if ('""' !== (pseudo.content ?? "") && "''" !== (pseudo.content ?? "")) {
		return "pseudo-recognition";
	}
	if ("table-caption" !== (pseudo.display ?? "")) return "pseudo-recognition";
	if ("none" !== (table["animation-name"] ?? "none")) return "table-animation";
	if ("none" !== (pseudo["animation-name"] ?? "none"))
		return "pseudo-animation";
	if ("auto" !== (table["table-layout"] ?? "")) return "table-layout";
	if ("collapse" !== (table["border-collapse"] ?? "")) return "table-collapse";
	if ("2px" !== (table["border-spacing"] ?? "")) return "table-spacing";
	return null;
}

function readTableInput(
	source: HTMLTableElement,
	runtime: BrowserWechatClipboardRuntime,
): WechatTableNativeGridInput {
	return readWechatTableNativeGridInput(
		source,
		runtime.getComputedStyle(source),
		runtime,
	);
}

function sourceTables(sourceRoot: Element): HTMLTableElement[] {
	return sourceRoot.matches("table")
		? [sourceRoot as HTMLTableElement]
		: Array.from(sourceRoot.querySelectorAll("table"));
}

function guardSourceTableIsOmitted(
	source: Element,
	sourceRoot: Element,
	runtime: BrowserWechatClipboardRuntime,
	conversionActive: boolean,
): boolean {
	let current: Element | null = source;
	while (current) {
		if (
			"none" ===
				runtime
					.getComputedStyle(current)
					.getPropertyValue("display")
					.trim()
					.toLowerCase() ||
			(conversionActive && visualRasterizationKind(current))
		) {
			return true;
		}
		if (current === sourceRoot) return false;
		current = current.parentElement;
	}
	return false;
}

function plannedSourceTableIsOmitted(
	source: Element,
	sourceRoot: Element,
	cloneIdentity: ReadonlyMap<Element, Element>,
): boolean {
	if (!cloneIdentity.get(source)) {
		let current = source.parentElement;
		while (current) {
			const clone = cloneIdentity.get(current);
			if (
				clone &&
				(HIDDEN_NODES.has(clone) || WECHAT_PNG_VISUAL_CLONES.has(clone))
			) {
				return true;
			}
			if (current === sourceRoot) break;
			current = current.parentElement;
		}
	}
	const clone = cloneIdentity.get(source);
	return Boolean(
		clone && (HIDDEN_NODES.has(clone) || WECHAT_PNG_VISUAL_CLONES.has(clone)),
	);
}

/**
 * Pure auxiliary fingerprint used by every existing layout/dimension sink.
 * Non-target tables stay distinguishable from admitted, keyed targets without
 * caching source state or retaining DOM references.
 */
export function wechatTableNativeGridAuxiliarySignature(
	source: Element,
	runtime: BrowserWechatClipboardRuntime,
	computed?: CSSStyleDeclaration,
): string {
	if ("TABLE" !== source.tagName) return "";
	const input = readWechatTableNativeGridInput(
		source,
		computed ?? runtime.getComputedStyle(source),
		runtime,
	);
	return `table-native-grid:${tableInputSignature(input)}`;
}

/**
 * Captures the complete table input state once. The transaction owns this
 * guard only; there is no cache or lazy baseline refresh.
 */
export function createWechatTableNativeGridGuard(
	sourceRoot: HTMLElement,
	runtime: BrowserWechatClipboardRuntime,
	conversionActive = false,
): WechatTableNativeGridGuard {
	const tables = sourceTables(sourceRoot);
	const baseline: readonly TableBaseline[] = Object.freeze(
		tables.map((source) => {
			const omitted = guardSourceTableIsOmitted(
				source,
				sourceRoot,
				runtime,
				conversionActive,
			);
			if (omitted) return Object.freeze({ input: null, omitted, source });
			const input = readTableInput(source, runtime);
			const issue = explicitTableGridIssue(input);
			if (issue) {
				throw new Error(`wechat-table-native-grid-${issue}`);
			}
			return Object.freeze({
				input: tableInputSignature(input),
				omitted,
				source,
			});
		}),
	);
	return Object.freeze({
		assertCurrent: (): void => {
			const currentTables = sourceTables(sourceRoot);
			if (currentTables.length !== baseline.length) {
				throw new Error("wechat-table-native-grid-source-changed");
			}
			currentTables.forEach((source, index) => {
				const frozen = baseline[index];
				if (!frozen || frozen.source !== source) {
					throw new Error("wechat-table-native-grid-source-changed");
				}
				const omitted = guardSourceTableIsOmitted(
					source,
					sourceRoot,
					runtime,
					conversionActive,
				);
				if (frozen.omitted) {
					if (omitted) return;
					const input = readTableInput(source, runtime);
					const issue = explicitTableGridIssue(input);
					throw new Error(
						`wechat-table-native-grid-${issue ?? "source-changed"}`,
					);
				}
				if (omitted) {
					throw new Error("wechat-table-native-grid-source-changed");
				}
				const current = readTableInput(source, runtime);
				const issue = explicitTableGridIssue(current);
				if (issue) {
					throw new Error(`wechat-table-native-grid-${issue}`);
				}
				if (tableInputSignature(current) !== frozen.input) {
					throw new Error("wechat-table-native-grid-source-changed");
				}
			});
		},
	});
}

/**
 * Plans exact source identities after inline styles have populated computed
 * output. Admission still belongs exclusively to the frozen helper.
 */
export function planWechatTableNativeGridForSerialization(
	sourceRoot: HTMLElement,
	cloneIdentity: ReadonlyMap<Element, Element>,
	runtime: BrowserWechatClipboardRuntime,
): readonly WechatTableNativeGridSerializationPlan[] {
	const plans: WechatTableNativeGridSerializationPlan[] = [];
	sourceTables(sourceRoot).forEach((source) => {
		if (plannedSourceTableIsOmitted(source, sourceRoot, cloneIdentity)) return;
		const evidence = collectWechatTableNativeGridEvidence(
			source,
			runtime.getComputedStyle(source),
			runtime,
		);
		if (!evidence) return;
		const target = cloneIdentity.get(source);
		if ("TABLE" !== target?.tagName) {
			throw new Error("wechat-table-native-grid-clone-missing");
		}
		plans.push(
			Object.freeze({
				...planWechatTableNativeGridApply(evidence),
				source,
				target: target as HTMLTableElement,
			}),
		);
	});
	return Object.freeze(plans);
}

/**
 * Applies only the approved display declaration after existing finalization
 * has created the SECTION scroll owner and written sizing, margin, paint, and
 * overflow declarations.
 */
export function applyWechatTableNativeGridForSerialization(
	cloneRoot: HTMLElement,
	plans: readonly WechatTableNativeGridSerializationPlan[],
): void {
	plans.forEach((plan) => {
		if (!cloneRoot.contains(plan.target) || "TABLE" !== plan.target.tagName) {
			throw new Error("wechat-table-native-grid-clone-missing");
		}
		const [property, value] = plan.declarations;
		appendDeclarations(plan.target, [`${property}:${value}`], true);
	});
}
