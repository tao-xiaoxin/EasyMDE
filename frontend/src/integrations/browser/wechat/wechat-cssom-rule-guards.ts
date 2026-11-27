/**
 * Canonical cross-realm CSSOM rule classification helpers shared across
 * WeChat padding-cascade and native table-grid stylesheet scanners.
 */
export function isCssRuleKind(
	rule: CSSRule,
	defaultView: (Window & typeof globalThis) | null | undefined,
	constructorName: string,
	tagName: string,
): boolean {
	const viewCtor =
		defaultView && constructorName in defaultView
			? (defaultView as unknown as Record<string, unknown>)[constructorName]
			: undefined;
	if ('function' === typeof viewCtor && rule instanceof (viewCtor as new () => CSSRule)) {
		return true;
	}
	const globalCtor =
		constructorName in globalThis
			? (globalThis as unknown as Record<string, unknown>)[constructorName]
			: undefined;
	if ('function' === typeof globalCtor && rule instanceof (globalCtor as new () => CSSRule)) {
		return true;
	}
	return tagName === Object.prototype.toString.call(rule);
}

export function isCssStyleRule(
	rule: CSSRule,
	defaultView: (Window & typeof globalThis) | null | undefined,
): rule is CSSStyleRule {
	return isCssRuleKind(rule, defaultView, 'CSSStyleRule', '[object CSSStyleRule]');
}

export function isCssMediaRule(
	rule: CSSRule,
	defaultView: (Window & typeof globalThis) | null | undefined,
): rule is CSSMediaRule {
	return isCssRuleKind(rule, defaultView, 'CSSMediaRule', '[object CSSMediaRule]');
}

export function isCssSupportsRule(
	rule: CSSRule,
	defaultView: (Window & typeof globalThis) | null | undefined,
): rule is CSSSupportsRule {
	return isCssRuleKind(rule, defaultView, 'CSSSupportsRule', '[object CSSSupportsRule]');
}

export function isCssNestedDeclarationsRule(
	rule: CSSRule,
	defaultView: (Window & typeof globalThis) | null | undefined,
): rule is CSSRule & { style?: CSSStyleDeclaration } {
	return isCssRuleKind(
		rule,
		defaultView,
		'CSSNestedDeclarations',
		'[object CSSNestedDeclarations]',
	);
}

export function isSkippableNonSelectorRule(
	rule: CSSRule,
	defaultView: (Window & typeof globalThis) | null | undefined,
): boolean {
	if (
		isCssRuleKind(rule, defaultView, 'CSSFontFaceRule', '[object CSSFontFaceRule]') ||
		(defaultView?.CSSRule && defaultView.CSSRule.FONT_FACE_RULE === rule.type)
	) {
		return true;
	}
	if (
		isCssRuleKind(rule, defaultView, 'CSSKeyframesRule', '[object CSSKeyframesRule]') ||
		(defaultView?.CSSRule && defaultView.CSSRule.KEYFRAMES_RULE === rule.type)
	) {
		return true;
	}
	if (
		isCssRuleKind(rule, defaultView, 'CSSViewTransitionRule', '[object CSSViewTransitionRule]')
	) {
		return true;
	}
	return isCssRuleKind(rule, defaultView, 'CSSLayerStatementRule', '[object CSSLayerStatementRule]');
}

export function isCssLayerBlockRule(
	rule: CSSRule,
	defaultView: (Window & typeof globalThis) | null | undefined,
): rule is CSSGroupingRule {
	if (isCssRuleKind(rule, defaultView, 'CSSLayerBlockRule', '[object CSSLayerBlockRule]')) {
		return true;
	}
	if (isSkippableNonSelectorRule(rule, defaultView)) {
		return false;
	}
	return (
		'name' in rule &&
		'cssRules' in rule &&
		!('conditionText' in rule) &&
		!('selectorText' in rule) &&
		!('start' in rule) &&
		!('end' in rule)
	);
}

export function isTransparentNestedGroupingRule(
	rule: CSSRule,
	defaultView: (Window & typeof globalThis) | null | undefined,
): rule is CSSGroupingRule {
	return (
		isCssMediaRule(rule, defaultView) ||
		isCssSupportsRule(rule, defaultView) ||
		isCssLayerBlockRule(rule, defaultView)
	);
}
