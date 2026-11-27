import { afterEach, describe, expect, it } from "vitest";

import {
  EditorStylesheetScopeError,
  scopeEditorStylesheet,
  scopeEditorStylesheets,
} from "./editor-stylesheet-scope";
import { splitSelectorList } from "./selector-list";

const styles: HTMLStyleElement[] = [];

function stylesheet(css: string): CSSStyleSheet {
  const element = document.createElement("style");
  element.textContent = css;
  document.head.append(element);
  styles.push(element);
  if (!element.sheet) throw new Error("test-stylesheet-unavailable");
  return element.sheet;
}

afterEach(() => {
  for (const element of styles.splice(0)) element.remove();
});

describe("splitSelectorList", () => {
  it("keeps commas inside selectors and rejects malformed lists", () => {
    expect(splitSelectorList('.a:is(.b, .c), [data-value="a,b"]')).toEqual([
      ".a:is(.b, .c)",
      '[data-value="a,b"]',
    ]);
    expect(splitSelectorList(".a,")).toBeNull();
    expect(splitSelectorList(".a:is(.b, .c")).toBeNull();
  });
});

describe("scopeEditorStylesheet", () => {
  it("adds one editor alias per selector and leaves originals intact", () => {
    const sheet = stylesheet(`
      body .article, :root .article, .card::before { color: red; }
      .card:hover { color: blue; }
    `);
    const before = Array.from(sheet.cssRules).map((rule) => rule.cssText);

    const lease = scopeEditorStylesheet(sheet);
    const rules = Array.from(sheet.cssRules);
    const aliases = rules.filter((rule) =>
      rule.cssText.includes("#easymde-editor-root"),
    );

    expect(
      before.every((rule) =>
        rules.some((candidate) => candidate.cssText === rule),
      ),
    ).toBe(true);
    expect(aliases.map((rule) => rule.cssText).join("\n")).toContain(
      "#easymde-editor-root :is(body .article)",
    );
    expect(aliases.map((rule) => rule.cssText).join("\n")).toContain(
      "#easymde-editor-root :is(.card)::before",
    );
    expect(aliases.map((rule) => rule.cssText).join("\n")).toContain(
      "#easymde-editor-root :is(.card:hover)",
    );

    lease.dispose();
    expect(Array.from(sheet.cssRules).map((rule) => rule.cssText)).toEqual(
      before,
    );
  });

  it("keeps group context and does not rewrite the parent of nested rules", () => {
    const sheet = stylesheet(`
      @media (min-width: 1px) { .article { color: red; } }
    `);
    const media = sheet.cssRules[0] as CSSMediaRule;
    const original = media.cssRules[0]?.cssText ?? "";
    const lease = scopeEditorStylesheet(sheet);

    expect(media.cssRules.length).toBe(2);
    expect(media.cssRules[0]?.cssText).toBe(original);
    expect(media.cssRules[1]?.cssText).toContain("#easymde-editor-root");
    lease.dispose();
    expect(media.cssRules.length).toBe(1);
  });

  it("is idempotent by stylesheet identity and reference-counted", () => {
    const sheet = stylesheet(".article { color: red; }");
    const first = scopeEditorStylesheet(sheet);
    const count = sheet.cssRules.length;
    const second = scopeEditorStylesheet(sheet);
    expect(sheet.cssRules.length).toBe(count);

    first.dispose();
    expect(sheet.cssRules.length).toBe(count);
    second.dispose();
    expect(sheet.cssRules.length).toBe(1);
  });

  it("rejects cancellation before reading and reports a stable code", () => {
    const sheet = stylesheet(".article { color: red; }");
    const controller = new AbortController();
    controller.abort();
    expect(() =>
      scopeEditorStylesheet(sheet, { signal: controller.signal }),
    ).toThrowError(
      new EditorStylesheetScopeError("editor-stylesheet-scope-stale"),
    );
  });

  it("rolls back the whole batch after an apply failure", () => {
    const sheet = stylesheet(".first { color: red; } .second { color: blue; }");
    const original = Array.from(sheet.cssRules).map((rule) => rule.cssText);
    const realInsertRule = sheet.insertRule.bind(sheet);
    let calls = 0;
    sheet.insertRule = ((text: string, index?: number) => {
      calls += 1;
      if (calls === 2) throw new Error("synthetic-apply-failure");
      return realInsertRule(text, index);
    }) as typeof sheet.insertRule;

    expect(() => scopeEditorStylesheet(sheet)).toThrowError(
      new EditorStylesheetScopeError("editor-stylesheet-apply-failed"),
    );
    expect(Array.from(sheet.cssRules).map((rule) => rule.cssText)).toEqual(
      original,
    );
  });

  it("applies multiple sheets atomically and disposes them as one lease", () => {
    const firstSheet = stylesheet(".first { color: red; }");
    const secondSheet = stylesheet(".second { color: blue; }");
    const beforeFirst = Array.from(firstSheet.cssRules).map((rule) => rule.cssText);
    const beforeSecond = Array.from(secondSheet.cssRules).map((rule) => rule.cssText);

    const lease = scopeEditorStylesheets([firstSheet, secondSheet]);

    expect(firstSheet.cssRules).toHaveLength(2);
    expect(secondSheet.cssRules).toHaveLength(2);
    lease.dispose();
    expect(Array.from(firstSheet.cssRules).map((rule) => rule.cssText)).toEqual(beforeFirst);
    expect(Array.from(secondSheet.cssRules).map((rule) => rule.cssText)).toEqual(beforeSecond);
  });

  it("rolls back earlier sheets when a later sheet fails to apply", () => {
    const firstSheet = stylesheet(".first { color: red; }");
    const secondSheet = stylesheet(".second { color: blue; }");
    const beforeFirst = Array.from(firstSheet.cssRules).map((rule) => rule.cssText);
    const beforeSecond = Array.from(secondSheet.cssRules).map((rule) => rule.cssText);
    const realInsertRule = secondSheet.insertRule.bind(secondSheet);
    secondSheet.insertRule = (() => {
      throw new Error("synthetic-second-sheet-failure");
    }) as typeof secondSheet.insertRule;

    expect(() => scopeEditorStylesheets([firstSheet, secondSheet])).toThrowError(
      new EditorStylesheetScopeError("editor-stylesheet-apply-failed"),
    );
    secondSheet.insertRule = realInsertRule;
    expect(Array.from(firstSheet.cssRules).map((rule) => rule.cssText)).toEqual(beforeFirst);
    expect(Array.from(secondSheet.cssRules).map((rule) => rule.cssText)).toEqual(beforeSecond);
  });

  it("returns a no-op lease for an empty stylesheet set", () => {
    const lease = scopeEditorStylesheets([]);
    expect(() => lease.dispose()).not.toThrow();
  });

  it("fails explicitly when a stylesheet rule list cannot be read", () => {
    const sheet = stylesheet(".article { color: red; }");
    Object.defineProperty(sheet, "cssRules", {
      configurable: true,
      get: () => {
        throw new Error("synthetic-read-failure");
      },
    });
    expect(() => scopeEditorStylesheet(sheet)).toThrowError(
      new EditorStylesheetScopeError("editor-stylesheet-read-failed"),
    );
  });
});
