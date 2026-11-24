import { splitSelectorList } from './selector-list';

export const EDITOR_STYLESHEET_SCOPE = '#easymde-editor-root';
const CSS_IMPORT_RULE_TYPE = 3;
const STYLESHEET_READINESS_TIMEOUT_MS = 15_000;

type RuleContainer = Readonly<{
  cssRules: CSSRuleList;
  deleteRule: (index: number) => void;
  insertRule: (rule: string, index?: number) => number;
}>;

type ScopeOptions = Readonly<{
  rootSelector?: string;
  signal?: AbortSignal;
}>;

type PlannedInsertion = Readonly<{
  container: RuleContainer;
  index: number;
  order: number;
  text: string;
}>;

type AppliedInsertion = Readonly<{
  container: RuleContainer;
  rule: CSSRule;
}>;

type AppliedSheet = {
  entries: AppliedInsertion[];
  identities: CSSStyleSheet[];
  references: number;
  rootSelector: string;
  stylesheet: CSSStyleSheet;
};

export type EditorStylesheetElement = HTMLLinkElement | HTMLStyleElement | SVGStyleElement;

type StylesheetReadinessResult = ReadonlyMap<
  EditorStylesheetElement,
  CSSStyleSheet
>;

export type EditorStylesheetReadinessGate = Readonly<{
  ready: boolean;
  run: (
    onReady: (sheets: StylesheetReadinessResult) => void,
    onError: (error: Error) => void
  ) => () => void;
  cancel: () => void;
}>;

export type EditorStylesheetScopeLease = Readonly<{
  dispose: () => void;
}>;

export class EditorStylesheetScopeError extends Error {
  public readonly code: string;

  public constructor(code: string) {
    super(code);
    this.name = 'EditorStylesheetScopeError';
    this.code = code;
  }
}

const appliedSheets = new WeakMap<CSSStyleSheet, AppliedSheet>();

function scopeError(code: string): EditorStylesheetScopeError {
  return new EditorStylesheetScopeError(code);
}

function sheetOf(element: EditorStylesheetElement): CSSStyleSheet | null {
  try {
    return element.sheet ?? null;
  } catch {
    throw scopeError('editor-stylesheet-read-failed');
  }
}

function stylesheetElementName(element: EditorStylesheetElement): string {
  return element instanceof HTMLLinkElement ? 'link' : 'style';
}

export function createEditorStylesheetReadiness(
  elements: ReadonlyArray<EditorStylesheetElement>,
  {
    signal,
    timeoutMs = STYLESHEET_READINESS_TIMEOUT_MS
  }: Readonly<{
    signal?: AbortSignal;
    timeoutMs?: number;
  }> = {}
): EditorStylesheetReadinessGate {
  if (!elements.length) {
    throw scopeError('editor-stylesheet-readiness-empty');
  }
  const sheets = new Map<EditorStylesheetElement, CSSStyleSheet>();
  const pending = new Set<EditorStylesheetElement>();
  const timers = new Map<EditorStylesheetElement, ReturnType<typeof setTimeout>>();
  const listeners = new Map<EditorStylesheetElement, { error: () => void; load: () => void }>();
  let failure: Error | null = null;
  let cancelled = false;
  let callbacks: Array<{
    onError: (error: Error) => void;
    onReady: (result: StylesheetReadinessResult) => void;
  }> = [];

  const cleanup = () => {
    for (const [element, listener] of listeners) {
      element.removeEventListener('load', listener.load);
      element.removeEventListener('error', listener.error);
    }
    listeners.clear();
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    signal?.removeEventListener('abort', abort);
  };
  const finishError = (error: Error) => {
    if (failure || cancelled) return;
    failure = error;
    cleanup();
    const waiting = callbacks;
    callbacks = [];
    for (const callback of waiting) callback.onError(error);
  };
  const finishReady = () => {
    if (failure || cancelled || pending.size) return;
    cleanup();
    const result = new Map(sheets) as StylesheetReadinessResult;
    const waiting = callbacks;
    callbacks = [];
    for (const callback of waiting) callback.onReady(result);
  };
  const checkElement = (element: EditorStylesheetElement) => {
    let sheet: CSSStyleSheet | null;
    try {
      sheet = sheetOf(element);
    } catch (error) {
      finishError(error instanceof Error ? error : scopeError('editor-stylesheet-read-failed'));
      return;
    }
    if (sheet) {
      sheets.set(element, sheet);
      pending.delete(element);
      finishReady();
      return;
    }
    if (!(element instanceof HTMLLinkElement)) {
      finishError(scopeError(`editor-stylesheet-${stylesheetElementName(element)}-unavailable`));
      return;
    }
    pending.add(element);
    const onLoad = () => {
      const loaded = sheetOf(element);
      if (!loaded) {
        finishError(scopeError('editor-stylesheet-load-unavailable'));
        return;
      }
      sheets.set(element, loaded);
      pending.delete(element);
      const timer = timers.get(element);
      if (timer) clearTimeout(timer);
      timers.delete(element);
      const listener = listeners.get(element);
      if (listener) {
        element.removeEventListener('load', listener.load);
        element.removeEventListener('error', listener.error);
      }
      listeners.delete(element);
      finishReady();
    };
    const onError = () => finishError(scopeError('editor-stylesheet-load-failed'));
    listeners.set(element, { error: onError, load: onLoad });
    element.addEventListener('load', onLoad);
    element.addEventListener('error', onError);
    timers.set(element, setTimeout(() => {
      finishError(scopeError('editor-stylesheet-load-timeout'));
    }, timeoutMs));
  };
  const abort = () => finishError(scopeError('editor-stylesheet-readiness-stale'));
  for (const element of elements) checkElement(element);
  if (signal) {
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  }

  return {
    ready: !failure && !cancelled && !pending.size,
    run: (onReady, onError) => {
      if (failure) {
        onError(failure);
        return () => undefined;
      }
      if (cancelled) {
        onError(scopeError('editor-stylesheet-readiness-stale'));
        return () => undefined;
      }
      if (!pending.size) {
        onReady(new Map(sheets) as StylesheetReadinessResult);
        return () => undefined;
      }
      const callback = { onError, onReady };
      callbacks.push(callback);
      return () => {
        callbacks = callbacks.filter((candidate) => candidate !== callback);
      };
    },
    cancel: () => {
      if (failure || cancelled) return;
      cancelled = true;
      cleanup();
      callbacks = [];
    }
  };
}

function hasRules(value: unknown): value is RuleContainer {
  if (!value || 'object' !== typeof value) return false;
  const candidate = value as Partial<RuleContainer>;
  return (
    !!candidate.cssRules
    && 'function' === typeof candidate.insertRule
    && 'function' === typeof candidate.deleteRule
  );
}

function readRules(container: RuleContainer): CSSRule[] {
  try {
    return Array.from(container.cssRules);
  } catch {
    throw scopeError('editor-stylesheet-read-failed');
  }
}

function nestedRuleList(rule: CSSRule): CSSRule[] | null {
  const candidate = rule as CSSRule & { cssRules?: CSSRuleList };
  if (!candidate.cssRules) return null;
  try {
    return Array.from(candidate.cssRules);
  } catch {
    throw scopeError('editor-stylesheet-read-failed');
  }
}

function nestedRules(rule: CSSRule): RuleContainer | null {
  const candidate = rule as CSSRule & { cssRules?: CSSRuleList };
  if (!candidate.cssRules || !hasRules(candidate)) return null;
  return candidate;
}

function styleRule(rule: CSSRule): CSSStyleRule | null {
  const candidate = rule as CSSStyleRule;
  if (
    'string' !== typeof candidate.selectorText
    || !candidate.style
    || 'string' !== typeof candidate.style.cssText
  ) {
    return null;
  }
  return candidate;
}

function importRule(rule: CSSRule): CSSImportRule | null {
  const candidate = rule as CSSImportRule;
  if (
    candidate.type !== CSS_IMPORT_RULE_TYPE
    && 'string' !== typeof candidate.href
  ) {
    return null;
  }
  return candidate;
}

function selectorSuffix(selector: string): Readonly<{
  prefix: string;
  suffix: string;
}> {
  const match = selector.match(
    /(:{1,2}(?:before|after|first-line|first-letter|selection|marker|backdrop|placeholder|file-selector-button|cue|part|slotted)(?:\([^()]*\))?)$/iu
  );
  if (!match?.[1]) return { prefix: selector, suffix: '' };
  return {
    prefix: selector.slice(0, -match[1].length).trimEnd(),
    suffix: match[1]
  };
}

function rootScopedSelector(selector: string, rootSelector: string): string {
  const trimmed = selector.trim();
  if (!trimmed) throw scopeError('editor-stylesheet-selector-invalid');
  const { prefix, suffix } = selectorSuffix(trimmed);
  if (!prefix) return `${rootSelector}${suffix}`;
  return `${rootSelector} :is(${prefix})${suffix}`;
}

function scopedSelectors(selectorText: string, rootSelector: string): string[] {
  const selectors = splitSelectorList(selectorText);
  if (!selectors) throw scopeError('editor-stylesheet-selector-invalid');
  return selectors.map((selector) => rootScopedSelector(selector, rootSelector));
}

function ruleText(selectors: ReadonlyArray<string>, declarations: string): string {
  if (!selectors.length || !declarations.trim()) {
    throw scopeError('editor-stylesheet-rule-invalid');
  }
  return `${selectors.join(', ')} {${declarations}}`;
}

function isKeyframesContainer(container: RuleContainer): boolean {
  const candidate = container as unknown as CSSRule & { cssText?: string };
  return /^@(?:-webkit-)?keyframes\b/iu.test(candidate.cssText ?? '');
}

function nestedWrapperText(
  parent: CSSStyleRule,
  rootSelector: string
): string | null {
  const children = nestedRuleList(parent);
  if (!children?.length) return null;
  const childText = children.map((child) => child.cssText ?? '').join('');
  if (!childText.trim()) throw scopeError('editor-stylesheet-nested-rule-invalid');
  const parentSelectors = splitSelectorList(parent.selectorText);
  if (!parentSelectors) throw scopeError('editor-stylesheet-selector-invalid');
  const suffixPresent = parentSelectors.some((selector) => selectorSuffix(selector).suffix);
  const wrapperSelectors = suffixPresent
    ? scopedSelectors(parent.selectorText, rootSelector).join(', ')
    : `${rootSelector} :is(${parent.selectorText})`;
  return `${wrapperSelectors} {${childText}}`;
}

type CollectionState = {
  borrowedStates: Set<AppliedSheet>;
  discoveredSheets: CSSStyleSheet[];
  operations: PlannedInsertion[];
  visitedContainers: WeakSet<object>;
  visitedSheets: WeakSet<CSSStyleSheet>;
};

function collectContainer(
  container: RuleContainer,
  rootSelector: string,
  state: CollectionState
): void {
  if (state.visitedContainers.has(container as object)) return;
  state.visitedContainers.add(container as object);
  if (isKeyframesContainer(container)) return;
  const rules = readRules(container);
  for (let index = 0; index < rules.length; index += 1) {
    const rule = rules[index];
    if (!rule) continue;
    const imported = importRule(rule);
    if (imported) {
      const importedSheet = imported.styleSheet;
      if (!importedSheet) throw scopeError('editor-stylesheet-import-unavailable');
      const existing = appliedSheets.get(importedSheet);
      if (existing) {
        if (existing.rootSelector !== rootSelector) {
          throw scopeError('editor-stylesheet-scope-conflict');
        }
        state.borrowedStates.add(existing);
        continue;
      }
      if (!state.visitedSheets.has(importedSheet)) {
        state.visitedSheets.add(importedSheet);
        state.discoveredSheets.push(importedSheet);
        collectContainer(importedSheet, rootSelector, state);
      }
      continue;
    }
    const direct = styleRule(rule);
    if (direct) {
      const selectors = scopedSelectors(direct.selectorText, rootSelector);
      if (direct.style.cssText.trim()) {
        state.operations.push({
          container,
          index,
          order: 0,
          text: ruleText(selectors, direct.style.cssText)
        });
      }
      const wrapper = nestedWrapperText(direct, rootSelector);
      if (wrapper) {
        state.operations.push({
          container,
          index,
          order: 1,
          text: wrapper
        });
      }
      continue;
    }
    const childContainer = nestedRules(rule);
    if (childContainer) collectContainer(childContainer, rootSelector, state);
  }
}

function rollbackEntries(entries: ReadonlyArray<AppliedInsertion[]>): void {
  const flattened = entries.flat();
  for (let index = flattened.length - 1; index >= 0; index -= 1) {
    const entry = flattened[index];
    if (!entry) continue;
    let rules: CSSRule[];
    try {
      rules = readRules(entry.container);
    } catch {
      throw scopeError('editor-stylesheet-rollback-failed');
    }
    const ruleIndex = rules.indexOf(entry.rule);
    if (-1 === ruleIndex) continue;
    try {
      entry.container.deleteRule(ruleIndex);
    } catch {
      throw scopeError('editor-stylesheet-rollback-failed');
    }
  }
}

function removeState(state: AppliedSheet): void {
  if (state.references > 0) state.references -= 1;
  if (state.references > 0) return;
  try {
    rollbackEntries([state.entries]);
  } finally {
    for (const stylesheet of state.identities) appliedSheets.delete(stylesheet);
  }
}

function leaseForStates(states: ReadonlyArray<AppliedSheet>): EditorStylesheetScopeLease {
  let disposed = false;
  return {
    dispose: () => {
      if (disposed) return;
      disposed = true;
      for (const state of [...states].reverse()) removeState(state);
    }
  };
}

export function scopeEditorStylesheets(
  stylesheets: ReadonlyArray<CSSStyleSheet>,
  { rootSelector = EDITOR_STYLESHEET_SCOPE, signal }: ScopeOptions = {}
): EditorStylesheetScopeLease {
  if (!stylesheets.length) {
    return { dispose: () => undefined };
  }
  if (signal?.aborted) throw scopeError('editor-stylesheet-scope-stale');
  if (!rootSelector.trim()) throw scopeError('editor-stylesheet-scope-invalid');

  const uniqueStylesheets = [...new Set(stylesheets)];
  const primaryStylesheet = uniqueStylesheets[0];
  if (!primaryStylesheet) throw scopeError('editor-stylesheet-scope-empty');
  const borrowedStates = new Set<AppliedSheet>();
  const state: CollectionState = {
    borrowedStates,
    discoveredSheets: [],
    operations: [],
    visitedContainers: new WeakSet<object>(),
    visitedSheets: new WeakSet<CSSStyleSheet>()
  };

  for (const stylesheet of uniqueStylesheets) {
    const existing = appliedSheets.get(stylesheet);
    if (existing) {
      if (existing.rootSelector !== rootSelector) {
        throw scopeError('editor-stylesheet-scope-conflict');
      }
      borrowedStates.add(existing);
      continue;
    }
    if (state.visitedSheets.has(stylesheet)) continue;
    state.visitedSheets.add(stylesheet);
    state.discoveredSheets.push(stylesheet);
    try {
      collectContainer(stylesheet, rootSelector, state);
    } catch (error) {
      if (error instanceof EditorStylesheetScopeError) throw error;
      throw scopeError('editor-stylesheet-read-failed');
    }
  }

  if (signal?.aborted) throw scopeError('editor-stylesheet-scope-stale');
  if (!state.discoveredSheets.length) {
    for (const borrowed of borrowedStates) borrowed.references += 1;
    return leaseForStates([...borrowedStates]);
  }
  const operationsByContainer = new Map<RuleContainer, PlannedInsertion[]>();
  for (const operation of state.operations) {
    const group = operationsByContainer.get(operation.container) ?? [];
    group.push(operation);
    operationsByContainer.set(operation.container, group);
  }
  const inserted: AppliedInsertion[] = [];
  try {
    for (const group of operationsByContainer.values()) {
      group.sort((left, right) => left.index === right.index
        ? right.order - left.order
        : right.index - left.index);
      for (const operation of group) {
        if (signal?.aborted) throw scopeError('editor-stylesheet-scope-stale');
        const result = operation.container.insertRule(operation.text, operation.index + 1);
        const insertedRule = operation.container.cssRules[result];
        if (!insertedRule) throw scopeError('editor-stylesheet-apply-failed');
        inserted.push({ container: operation.container, rule: insertedRule });
      }
    }
  } catch (error) {
    try {
      rollbackEntries([inserted]);
    } catch {
      throw scopeError('editor-stylesheet-rollback-failed');
    }
    if (error instanceof EditorStylesheetScopeError) throw error;
    throw scopeError('editor-stylesheet-apply-failed');
  }
  if (signal?.aborted) {
    try {
      rollbackEntries([inserted]);
    } catch {
      throw scopeError('editor-stylesheet-rollback-failed');
    }
    throw scopeError('editor-stylesheet-scope-stale');
  }

  for (const borrowed of borrowedStates) borrowed.references += 1;
  const applied: AppliedSheet = {
    entries: inserted,
    identities: state.discoveredSheets,
    references: 1,
    rootSelector,
    stylesheet: primaryStylesheet
  };
  for (const identity of state.discoveredSheets) appliedSheets.set(identity, applied);
  const states: AppliedSheet[] = [applied, ...borrowedStates];
  return leaseForStates(states);
}

export function scopeEditorStylesheet(
  stylesheet: CSSStyleSheet,
  options: ScopeOptions = {}
): EditorStylesheetScopeLease {
  return scopeEditorStylesheets([stylesheet], options);
}

export function scopeEditorStyleElement(
  element: HTMLStyleElement | SVGStyleElement,
  options?: ScopeOptions
): EditorStylesheetScopeLease {
  const sheet = sheetOf(element);
  if (!sheet) throw scopeError('editor-stylesheet-unavailable');
  return scopeEditorStylesheet(sheet, options);
}

export function scopeEditorStylesheetLink(
  element: HTMLLinkElement,
  options?: ScopeOptions
): EditorStylesheetScopeLease {
  const sheet = sheetOf(element);
  if (!sheet) throw scopeError('editor-stylesheet-unavailable');
  return scopeEditorStylesheet(sheet, options);
}
