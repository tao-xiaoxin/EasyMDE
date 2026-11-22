import {
  act,
  render,
  type RenderResult,
  waitFor,
} from "@testing-library/react";
import { createElement } from "@wordpress/element";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";

import type {
  PreviewEditMap,
  PreviewRequest,
  PreviewResponse,
  SafePreviewHtml,
} from "../../../contracts/ports/preview-request";
import { VISUAL_MARKDOWN_READ_ONLY_SELECTOR } from "../../../contracts/visual-markdown-read-only";
import { createBrowserPreviewScroll } from "../../../integrations/browser/preview/create-browser-preview-scroll";
import { markdownLineStarts } from "../../../shared/markdown/markdown-line-model";
import { createCodeMirrorDocumentSession } from "../../document-source/adapters/code-mirror-document-session";
import { createNativeTitleSession } from "../../document-source/adapters/native-title-session";
import { createEditorDocumentSession } from "../../document-source/editor-document-session";
import {
  ImmersiveVisualEditor,
  type ImmersiveVisualEditorRuntime,
  type VisualPreviewSnapshot,
} from "../../immersive-editor/ui/ImmersiveVisualEditor";
import { WindowedImmersiveVisualEditor } from "../../immersive-editor/ui/WindowedImmersiveVisualEditor";
import { createEditorMarkdownBlockIndex as createProfiledMarkdownBlockIndex } from "../../editor-context-menu/editor-markdown-block-index";
import {
  type GeneratedImageTargetIndex,
  hydrateGeneratedImageTargetIndex,
} from "../../generated-content-export/generated-image-target";
import { parseMarkdownImageScale } from "../../image-scale/image-scale-contract";
import type { PreviewRequestSession } from "../model/create-preview-request-session";
import type { PreviewEnhancementPort } from "../ports/preview-enhancement-port";
import type { PreviewScrollPort } from "../ports/preview-scroll-port";
import {
  type PreviewAcceptedWindowSnapshot,
  type PreviewGeneratedContentTargetIndex,
  type PreviewSourceSnapshot,
  PreviewSurfaceOwner,
  PreviewWindowInstallFault,
  type PreviewSurfaceRuntime,
  type PreviewSurfaceStagingScheduler,
  type PreviewSurfaceStatus,
} from "./PreviewSurfaceOwner";

const messages = {
  empty: "Start writing Markdown to preview the article.",
  error: "Preview failed. Please keep writing; saving is not affected.",
  loading: "Loading preview...",
};

const request = (markdown: string, signature = markdown): PreviewRequest => ({
  markdown,
  postId: 7,
  markdownTheme: "default",
  codeTheme: "atom-one-dark",
  customCssId: "",
  signature,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

type MaterializeScheduler = Readonly<{
  pending: Array<ReturnType<typeof deferred<void>>>;
  yield: ReturnType<typeof vi.fn<() => Promise<void>>>;
}>;

function safeHtml(value: string): SafePreviewHtml {
  return value as SafePreviewHtml;
}

function previewRect(top: number, height: number): DOMRect {
  return {
    bottom: top + height,
    height,
    left: 0,
    right: 320,
    top,
    width: 320,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

// Layout depends on the installed sibling sequence, including an owned P/BR.
// Removing that paragraph therefore changes BOTH following rects and the real
// ratio adapter's scrollable extent. Block IDs are deliberately irrelevant.
function installSequenceGeometry() {
  const nativeRect = HTMLElement.prototype.getBoundingClientRect;
  const height = (node: Element): number => {
    if (node.hasAttribute("data-easymde-preview-window-spacer"))
      return Number.parseFloat((node as HTMLElement).style.blockSize) || 0;
    if (node.tagName === "PRE") return 72;
    if (/^H[1-6]$/.test(node.tagName)) return 32;
    return 24;
  };
  const extent = (root: HTMLElement): number =>
    Array.from(root.children).reduce((sum, node) => sum + height(node), 0);
  let canvas: HTMLElement | null = null;
  const spy = vi
    .spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains("easymde-immersive-preview-canvas"))
        return previewRect(0, 240);
      if (this.tagName === "ARTICLE")
        return previewRect(-(canvas?.scrollTop ?? 0), extent(this));
      if (
        this.hasAttribute("data-easymde-visual-block-id") ||
        this.hasAttribute("data-easymde-preview-window-spacer")
      ) {
        let top = 0;
        for (
          let sibling = this.previousElementSibling;
          sibling;
          sibling = sibling.previousElementSibling
        )
          top += height(sibling);
        return previewRect(
          top - (this.closest("article") ? (canvas?.scrollTop ?? 0) : 0),
          height(this),
        );
      }
      return nativeRect.call(this);
    });
  return {
    attach: (next: HTMLElement, surface: HTMLElement) => {
      canvas = next;
      Object.defineProperty(next, "scrollHeight", {
        configurable: true,
        get: () => extent(surface),
      });
    },
    restore: () => spy.mockRestore(),
  };
}

async function flushAnimationFrames(count = 8): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
  }
}

type PreviewResponseFixture = Omit<PreviewResponse, "editMap"> &
  Partial<Pick<PreviewResponse, "editMap">>;

type PreviewResponseDeferred = Readonly<{
  promise: Promise<PreviewResponse>;
  reject: (reason?: unknown) => void;
  resolve: (response: PreviewResponseFixture) => void;
}>;

function normalizePreviewResponse(
  response: PreviewResponseFixture,
  previewRequest: PreviewRequest,
): PreviewResponse {
  // Explicit structural fixtures already carry their exact IDs and line map.
  // Do not parse and relabel hundreds of roots only to discard that DOM for
  // every pending Undo/Redo response, including superseded responses.
  if (response.editMap) return { ...response, editMap: response.editMap };
  const template = document.createElement("template");
  template.innerHTML = response.html;
  const blocks = Array.from(template.content.children).map((element, index) => {
    const id = `b${index}`;
    element.setAttribute("data-easymde-visual-block-id", id);
    return {
      editable: true as const,
      endLine: index + 1,
      id,
      startLine: index,
    };
  });
  if (0 === blocks.length) throw new Error("preview-response-fixture-empty");
  return {
    ...response,
    html: template.innerHTML as SafePreviewHtml,
    editMap: {
      version: 1,
      coordinate: "line",
      signature: previewRequest.signature,
      blocks,
    },
  };
}

function deferredPreviewResponse(
  previewRequest: PreviewRequest,
): PreviewResponseDeferred {
  const pending = deferred<PreviewResponse>();
  return {
    promise: pending.promise,
    reject: pending.reject,
    resolve: (response) =>
      pending.resolve(normalizePreviewResponse(response, previewRequest)),
  };
}

function windowedFixture(count: number, signature: string) {
  const blocks = Array.from({ length: count }, (_, index) => ({
    id: `b${index}`,
    startLine: index * 2,
    endLine: index * 2 + 1,
    editable: true as const,
  }));
  return {
    editMap: {
      version: 1 as const,
      coordinate: "line" as const,
      signature,
      blocks,
    },
    html: blocks
      .map(({ id }) => `<p data-easymde-visual-block-id="${id}">${id}</p>`)
      .join("") as SafePreviewHtml,
  };
}

function windowedPreviewForMarkdown(markdown: string, signature: string) {
  const sources = markdown.split("\n\n");
  const template = document.createElement("template");
  const blocks: PreviewEditMap["blocks"][number][] = [];
  // This focused plaintext fixture models rendered document children, not a
  // Markdown parser. A whitespace-only suffix after the final populated
  // section produces no block, while the canonical source keeps those bytes.
  // Internal empty sections remain represented; do not generalize this rule.
  const lastPopulatedSource = sources.reduce(
    (last, source, index) => (source.trim() ? index : last),
    -1,
  );
  let line = 0;
  for (const [index, source] of sources.entries()) {
    const lineCount = source.split("\n").length;
    if (index > lastPopulatedSource) {
      line += lineCount + 1;
      continue;
    }
    const id = `b${index}`;
    const paragraph = document.createElement("p");
    paragraph.setAttribute("data-easymde-visual-block-id", id);
    if (source) paragraph.textContent = source;
    else paragraph.append(document.createElement("br"));
    template.content.append(paragraph);
    blocks.push({
      id,
      startLine: line,
      endLine: line + lineCount,
      editable: true,
    });
    line += lineCount + 1;
  }
  return {
    editMap: {
      version: 1 as const,
      coordinate: "line" as const,
      signature,
      blocks,
    },
    features: {},
    html: safeHtml(template.innerHTML),
  };
}

function documentEndWindowFixture(
  count: number,
  signature: string,
  terminal: "mermaid" | "text",
) {
  if ("text" === terminal) {
    const fixture = windowedFixture(count, signature);
    return {
      ...fixture,
      markdown: Array.from({ length: count }, (_, index) => `b${index}`).join(
        "\n\n",
      ),
    };
  }
  const paragraphs = Array.from(
    { length: count - 1 },
    (_, index) => `b${index}`,
  );
  const terminalSource = "```mermaid\ngraph TD\nA-->B\n```\n";
  const markdown = [...paragraphs, terminalSource].join("\n\n");
  const blocks: PreviewEditMap["blocks"][number][] = paragraphs.map(
    (_, index) => ({
      editable: true,
      endLine: index * 2 + 1,
      id: `b${index}`,
      startLine: index * 2,
    }),
  );
  const terminalStart = (count - 1) * 2;
  blocks.push({
    editable: true,
    endLine: terminalStart + 5,
    id: `b${count - 1}`,
    startLine: terminalStart,
  });
  const html = [
    ...paragraphs.map(
      (source, index) =>
        `<p data-easymde-visual-block-id="b${index}">${source}</p>`,
    ),
    `<div class="easymde-mermaid" data-easymde-rendered="1" data-easymde-visual-block-id="b${count - 1}"><pre><code>graph TD\nA--&gt;B</code></pre></div>`,
  ].join("");
  return {
    editMap: {
      blocks,
      coordinate: "line" as const,
      signature,
      version: 1 as const,
    },
    html: safeHtml(html),
    markdown,
  };
}

const NESTED_LIST_FENCE_SOURCE = "- item\n\n  ~~~js\n  alpha\n  ~~~";
const NESTED_QUOTE_FENCE_SOURCE = "> ```bash linenos\n> beta\n> ```";

/**
 * A windowed article whose nested fences are rendered exactly like the
 * structural renderer does: one list or blockquote root that owns a PRE
 * descendant. Their metadata therefore lives inside the root's innerHTML,
 * unlike a root-level fence whose own attributes are outside it.
 */
function nestedFenceWindowFixture(
  count: number,
  signature: string,
  nested: Readonly<{ list: number; quote: number }>,
) {
  const blocks: Array<{
    editable: true;
    endLine: number;
    id: string;
    startLine: number;
  }> = [];
  const sources: string[] = [];
  const markup: string[] = [];
  let line = 0;
  for (let index = 0; index < count; index += 1) {
    const id = `b${index}`;
    const source =
      index === nested.list
        ? NESTED_LIST_FENCE_SOURCE
        : index === nested.quote
          ? NESTED_QUOTE_FENCE_SOURCE
          : `Paragraph ${index}`;
    const lineCount = source.split("\n").length;
    blocks.push({
      editable: true,
      endLine: line + lineCount,
      id,
      startLine: line,
    });
    sources.push(source);
    markup.push(
      index === nested.list
        ? `<ul data-easymde-visual-block-id="${id}"><li><p>item</p>` +
            "<pre><code>alpha\n</code></pre></li></ul>"
        : index === nested.quote
          ? `<blockquote data-easymde-visual-block-id="${id}">` +
            "<pre><code>beta\n</code></pre></blockquote>"
          : `<p data-easymde-visual-block-id="${id}">Paragraph ${index}</p>`,
    );
    line += lineCount + 1;
  }
  return {
    editMap: {
      blocks,
      coordinate: "line" as const,
      signature,
      version: 1 as const,
    },
    html: markup.join("") as SafePreviewHtml,
    markdown: sources.join("\n\n"),
  };
}

function markdownDocumentSource(markdown: string) {
  const submissionField = document.createElement("textarea");
  submissionField.value = submissionField.defaultValue = markdown;
  const container = document.createElement("div");
  document.body.append(container, submissionField);
  const owner = createCodeMirrorDocumentSession({
    container,
    label: "Markdown",
    submissionField,
  });
  owner.applyTextChange({
    selection: { direction: "none", start: 0, end: 0 },
    value: markdown,
  });
  const session = createEditorDocumentSession(
    owner,
    createNativeTitleSession(null),
  );
  session.registerSubmissionState({
    appleFont: "system",
    codeTheme: "github",
    codeThemeExplicit: false,
    customCssId: "",
    customFont: "none",
    markdownTheme: "default",
    serifFont: "off",
    windowsFont: "system",
  });
  return { container, owner, session, submissionField };
}

function documentEndFixture(
  count: number,
  signature: string,
  terminalSuffix = "",
) {
  const markdown =
    [...Array.from({ length: count }, (_, index) => `line-${index}`)].join(
      "\n",
    ) + terminalSuffix;
  const blocks = Array.from({ length: count }, (_, index) => ({
    id: `b${index}`,
    startLine: index,
    endLine: index + 1,
    editable: true as const,
  }));
  return {
    editMap: {
      version: 1 as const,
      coordinate: "line" as const,
      signature,
      blocks,
    },
    html: blocks
      .map(({ id }) => `<p data-easymde-visual-block-id="${id}">${id}</p>`)
      .join("") as SafePreviewHtml,
    markdown,
  };
}

function documentEndWithGeneratedRootsFixture(
  count: number,
  signature: string,
  terminalSuffix = "",
) {
  const fixture = documentEndFixture(count, signature, terminalSuffix);
  const generatedRoots = [
    `<hr data-easymde-visual-block-id="b${count}" class="footnotes-sep">`,
    `<div data-easymde-visual-block-id="b${count + 1}" class="footnotes">` +
      "<ol><li>Generated note</li></ol></div>",
  ];
  const lastSourceBlock = fixture.editMap.blocks[count - 1];
  if (!lastSourceBlock)
    throw new Error("preview-test-document-end-source-missing");

  return {
    ...fixture,
    editMap: {
      ...fixture.editMap,
      blocks: [
        ...fixture.editMap.blocks,
        ...generatedRoots.map((_, index) => ({
          id: `b${count + index}`,
          startLine: lastSourceBlock.endLine,
          endLine: lastSourceBlock.endLine,
          editable: false,
        })),
      ],
    },
    html: (fixture.html + generatedRoots.join("")) as SafePreviewHtml,
  };
}

function protectedPreviewFixture(
  paragraph: string,
  signature: string,
  options?: Readonly<{
    footnote?: string;
    mathWrapper?: boolean;
    tocHref?: string;
    order?: ReadonlyArray<
      "paragraph" | "toc" | "math" | "footnote-separator" | "footnotes"
    >;
  }>,
) {
  const htmlByBlock = {
    paragraph: `<p data-easymde-visual-block-id="b0">${paragraph}</p>`,
    toc:
      '<div data-easymde-visual-block-id="b1" class="easymde-toc">' +
      `<ul><li><a href="${options?.tocHref ?? "#heading"}">Heading</a></li></ul>` +
      "</div>",
    math:
      '<p data-easymde-visual-block-id="b2">Result ' +
      (options?.mathWrapper ? "<span>" : "") +
      '<span class="easymde-math" data-easymde-rendered="1">' +
      "<span>2</span></span>" +
      (options?.mathWrapper ? "</span>" : "") +
      "</p>",
    "footnote-separator":
      '<hr data-easymde-visual-block-id="b3" ' + 'class="footnotes-sep">',
    footnotes:
      '<div data-easymde-visual-block-id="b4" class="footnotes">' +
      `<ol><li>${options?.footnote ?? "Note"}</li></ol></div>`,
  };
  const order = options?.order ?? [
    "paragraph",
    "toc",
    "math",
    "footnote-separator",
    "footnotes",
  ];
  return {
    editMap: {
      version: 1 as const,
      coordinate: "line" as const,
      signature,
      blocks: order.map((key, index) => ({
        id: `b${
          {
            paragraph: 0,
            toc: 1,
            math: 2,
            "footnote-separator": 3,
            footnotes: 4,
          }[key]
        }`,
        startLine: index * 2,
        endLine: index * 2 + 1,
        editable: true,
      })),
    },
    html: order.map((key) => htmlByBlock[key]).join("") as SafePreviewHtml,
  };
}

function previewWindowRanges(children: ReadonlyArray<Element>): Array<{
  end: number;
  start: number;
}> {
  return children.map((child) => {
    const spacer = child.getAttribute("data-easymde-preview-window-spacer");
    if (null !== spacer) {
      return {
        end: Number(child.getAttribute("data-easymde-preview-window-end")),
        start: Number(child.getAttribute("data-easymde-preview-window-start")),
      };
    }
    const id = child.getAttribute("data-easymde-visual-block-id");
    const index = id?.match(/^b(0|[1-9]\d*)$/)?.[1];
    if (undefined === index)
      throw new Error("preview-window-test-block-id-invalid");
    const start = Number(index);
    return { end: start + 1, start };
  });
}

function visualSourceMarkerCount(surface: HTMLElement): number {
  const walker = surface.ownerDocument.createTreeWalker(
    surface,
    NodeFilter.SHOW_COMMENT,
  );
  let count = 0;
  while (walker.nextNode()) {
    if ("easymde-visual-markdown-source" === walker.currentNode.nodeValue) {
      count += 1;
    }
  }
  return count;
}

function setup(options?: {
  className?: string;
  contentEditable?: boolean;
  emptyMode?: "message" | "paper";
  enhance?: PreviewEnhancementPort["enhance"];
  initialHtml?: string;
  initialEditMap?: PreviewEditMap;
  initialSignature?: string;
  currentSourceSnapshot?: () => PreviewSourceSnapshot | null;
  sourceRevision?: number;
  onDiagnostic?: (code: string) => void;
  onHtmlChange?: (html: SafePreviewHtml) => void;
  onSnapshotReady?: (
    html: SafePreviewHtml,
    signature: string,
    editMap: PreviewEditMap | null,
  ) => void;
  onImageReadinessChange?: () => void;
  onStatusChange?: (status: PreviewSurfaceStatus) => void;
  onWindowReady?: () => void;
  scrollPort?: PreviewScrollPort;
  materializeScheduler?: MaterializeScheduler;
  stagingScheduler?: Readonly<{
    now?: () => number;
    yield: () => Promise<void>;
  }>;
  windowed?: boolean;
}) {
  let windowed = options?.windowed;
  let className = options?.className;
  let currentSourceSnapshot = options?.currentSourceSnapshot;
  let sourceRevision = options?.sourceRevision;
  let session!: PreviewRequestSession;
  let runtime!: PreviewSurfaceRuntime;
  const responses: PreviewResponseDeferred[] = [];
  const renderPreview = vi.fn((previewRequest: PreviewRequest) => {
    const response = deferredPreviewResponse(previewRequest);
    responses.push(response);
    return response.promise;
  });
  const enhancementPort: PreviewEnhancementPort = {
    prepareCodeTheme: vi.fn().mockResolvedValue({
      cancel: vi.fn(),
      commit: vi.fn(),
    }),
    syncCodeFrameBackgrounds: vi.fn(),
    enhance: options?.enhance ?? vi.fn().mockResolvedValue(undefined),
  };
  const onDiagnostic = options?.onDiagnostic ?? vi.fn();
  const defaultScrollPort: PreviewScrollPort = {
    capture: (surface) => ({
      left: surface.scrollLeft,
      ratio: 0,
      top: surface.scrollTop,
    }),
    restore: (surface, snapshot) => {
      surface.scrollLeft = snapshot.left;
      surface.scrollTop = snapshot.top;
    },
  };
  const owner = (emptyMode = options?.emptyMode) => (
    <div className="easymde-immersive-preview-canvas">
      <PreviewSurfaceOwner
        {...(undefined !== className ? { className } : {})}
        {...(undefined !== options?.contentEditable
          ? { contentEditable: options.contentEditable }
          : {})}
        enhancementPort={enhancementPort}
        initial={{
          codeTheme: "github",
          ...(options?.initialEditMap
            ? { editMap: options.initialEditMap }
            : {}),
          features: {},
          html: safeHtml(options?.initialHtml ?? "<p>Initial preview</p>"),
          signature: options?.initialSignature ?? "initial",
        }}
        initialRevision={0}
        messages={messages}
        {...(emptyMode ? { emptyMode } : {})}
        {...(options?.stagingScheduler
          ? { stagingScheduler: options.stagingScheduler }
          : {})}
        {...(options?.materializeScheduler
          ? { materializeScheduler: options.materializeScheduler }
          : {})}
        {...(undefined !== windowed ? { windowed } : {})}
        onDiagnostic={onDiagnostic}
        {...(options?.onHtmlChange
          ? { onHtmlChange: options.onHtmlChange }
          : {})}
        {...(options?.onSnapshotReady
          ? { onSnapshotReady: options.onSnapshotReady }
          : {})}
        {...(options?.onImageReadinessChange
          ? { onImageReadinessChange: options.onImageReadinessChange }
          : {})}
        {...(options?.onStatusChange
          ? { onStatusChange: options.onStatusChange }
          : {})}
        {...(options?.onWindowReady
          ? { onWindowReady: options.onWindowReady }
          : {})}
        {...(undefined !== sourceRevision ? { sourceRevision } : {})}
        {...(currentSourceSnapshot ? { currentSourceSnapshot } : {})}
        onReady={(readySession) => {
          runtime = readySession;
          session = readySession.session;
        }}
        port={{ render: renderPreview }}
        scrollPort={options?.scrollPort ?? defaultScrollPort}
      />
    </div>
  );
  const result = render(owner());
  const surface = result.container.querySelector("article");
  if (!(surface instanceof HTMLElement)) throw new Error("surface missing");
  const canvas = result.container.querySelector(
    ".easymde-immersive-preview-canvas",
  );
  if (!(canvas instanceof HTMLElement)) throw new Error("canvas missing");
  return {
    enhancementPort,
    onDiagnostic,
    renderPreview,
    responses,
    runtime,
    session,
    setEmptyMode: (emptyMode: "message" | "paper") =>
      result.rerender(owner(emptyMode)),
    canvas,
    surface,
    ...result,
    rerender: () => result.rerender(owner()),
    setCurrentSourceSnapshot: (
      next: (() => PreviewSourceSnapshot | null) | undefined,
    ) => {
      currentSourceSnapshot = next;
      result.rerender(owner());
    },
    setSourceRevision: (next: number | undefined) => {
      sourceRevision = next;
      result.rerender(owner());
    },
    setWindowed: (value: boolean) => {
      windowed = value;
      result.rerender(owner());
    },
    setClassName: (value: string | undefined) => {
      className = value;
      result.rerender(owner());
    },
  };
}

async function mountLiveWindowedDocumentEnd(
  signature: string,
  options?: Readonly<{
    deferWindowReadyRerender?: boolean;
    onDiagnostic?: (code: string) => void;
    onWindowReady?: () => void;
    stagingScheduler?: Readonly<{
      now?: () => number;
      yield: () => Promise<void>;
    }>;
    terminal?: "mermaid" | "text";
  }>,
) {
  const geometry = installSequenceGeometry();
  const fixture = documentEndWindowFixture(
    320,
    signature,
    options?.terminal ?? "text",
  );
  const markdown = fixture.markdown;
  const sourceDocument = markdownDocumentSource(markdown);
  const revision = () => sourceDocument.owner.getRevision?.() ?? 0;
  const diagnostics: string[] = [];
  const windowedDiagnostics: string[] = [];
  type LivePreviewRequest = Readonly<{
    markdown: string;
    path: "document-end" | "preview" | "test-request";
    revision: number;
    signature: string;
  }>;
  const requests: LivePreviewRequest[] = [];
  const ownerSnapshotReady: Array<
    Readonly<{ editMap: PreviewEditMap; signature: string }>
  > = [];
  const ownerStatusChanges: PreviewSurfaceStatus[] = [];
  const windowReadyKeys: number[] = [];
  const pendingChanges: boolean[] = [];
  const onFailure = vi.fn();
  const onTransferFailure = vi.fn();
  const onDispose = vi.fn();
  const onCanonicalDocumentChange = vi.fn();
  const onMarkdownChange = vi.fn();
  const onReady = vi.fn();
  let ownerPreviewStatus: PreviewSurfaceStatus = "loading";
  let previewPending = false;
  let view: RenderResult | null = null;
  let readAcceptedSnapshot: () => PreviewAcceptedWindowSnapshot | null = () =>
    null;
  let editorEditMap: PreviewEditMap = fixture.editMap;
  let editorPreviewSnapshot: {
    editMap: PreviewEditMap;
    revision: number;
    signature: string;
  } = {
    editMap: fixture.editMap,
    revision: 0,
    signature: fixture.editMap.signature,
  };
  let acceptedWindowNotificationCount = 0;
  let renderedAcceptedWindowNotifications = 0;
  let acceptedWindowSnapshotKey: number | null = null;
  let editorActive = false;
  let renderEditor = () => {};
  const rerenderEditor = () => {
    if (editorActive) renderEditor();
  };
  const onWindowedDiagnostic = (code: string) => {
    windowedDiagnostics.push(code);
  };
  let retainCompositionSurfaceImpl: () => ReturnType<
    PreviewSurfaceRuntime["retainCompositionSurface"]
  > = () => {
    throw new Error("live-retain-composition-surface-inactive");
  };
  const retainCompositionSurface = () => retainCompositionSurfaceImpl();
  const onSnapshotReady = vi.fn(
    (
      _html: SafePreviewHtml,
      nextSignature: string,
      nextEditMap: PreviewEditMap | null,
    ) => {
      if (!nextEditMap) throw new Error("live-owner-snapshot-edit-map-missing");
      ownerSnapshotReady.push({
        editMap: nextEditMap,
        signature: nextSignature,
      });
      editorEditMap = nextEditMap;
      editorPreviewSnapshot = {
        editMap: nextEditMap,
        revision: editorPreviewSnapshot.revision + 1,
        signature: nextSignature,
      };
      rerenderEditor();
    },
  );
  const onStatusChange = vi.fn((status: PreviewSurfaceStatus) => {
    ownerStatusChanges.push(status);
    if (ownerPreviewStatus === status) return;
    ownerPreviewStatus = status;
    rerenderEditor();
  });
  const onPendingChange = vi.fn((pending: boolean) => {
    pendingChanges.push(pending);
    if (previewPending === pending) return;
    previewPending = pending;
    rerenderEditor();
  });
  const onWindowReady = vi.fn(() => {
    const accepted = readAcceptedSnapshot();
    if (accepted && accepted.key !== acceptedWindowSnapshotKey) {
      acceptedWindowSnapshotKey = accepted.key;
      acceptedWindowNotificationCount += 1;
      windowReadyKeys.push(accepted.key);
      if (options?.deferWindowReadyRerender) {
        queueMicrotask(() => {
          if (editorActive) rerenderEditor();
        });
      } else {
        rerenderEditor();
      }
    }
    options?.onWindowReady?.();
  });
  const current = setup({
    contentEditable: true,
    currentSourceSnapshot: () => ({
      revision: revision(),
      value: sourceDocument.owner.getValue(),
    }),
    initialEditMap: fixture.editMap,
    initialHtml: fixture.html,
    initialSignature: fixture.editMap.signature,
    onDiagnostic: (code) => {
      diagnostics.push(code);
      options?.onDiagnostic?.(code);
    },
    onSnapshotReady,
    onStatusChange,
    sourceRevision: revision(),
    stagingScheduler: options?.stagingScheduler ?? {
      yield: () => Promise.resolve(),
    },
    windowed: true,
    onWindowReady,
  });
  readAcceptedSnapshot = () => current.runtime.getAcceptedWindowSnapshot();
  retainCompositionSurfaceImpl = () =>
    current.runtime.retainCompositionSurface();
  geometry.attach(current.canvas, current.surface);
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    editorActive = false;
    renderEditor = () => {};
    view?.unmount();
    current.unmount();
    sourceDocument.session.destroy();
    sourceDocument.container.remove();
    sourceDocument.submissionField.remove();
    geometry.restore();
  };
  const settle = async (frames = 8) => {
    await act(async () => {
      for (let index = 0; index < 24; index += 1) await Promise.resolve();
      await flushAnimationFrames(frames);
    });
  };
  try {
    await settle(12);
    const accepted = current.runtime.getAcceptedWindowSnapshot();
    if (!accepted)
      throw new Error("live-document-end-initial-snapshot-missing");
    if (null === acceptedWindowSnapshotKey) {
      // Mirror EditorRoot: the initial accepted key is one logical readiness
      // notification. Never derive this counter from the Preview epoch.
      acceptedWindowSnapshotKey = accepted.key;
      acceptedWindowNotificationCount = Math.max(
        1,
        acceptedWindowNotificationCount,
      );
    }
    const nextRequestSignature = () => `${signature}-${revision() + 1}`;
    const recordRequest = (
      path: LivePreviewRequest["path"],
      next: string,
      requestSignature: string,
      requestRevision: number,
    ) => {
      const recorded = {
        markdown: next,
        path,
        revision: requestRevision,
        signature: requestSignature,
      } as const;
      requests.push(recorded);
      return recorded;
    };
    const requestPreview = (next: string) => {
      const requestSignature = nextRequestSignature();
      const requestRevision = current.session.schedule(
        request(next, requestSignature),
        true,
      );
      recordRequest("preview", next, requestSignature, requestRevision);
      return requestSignature;
    };
    const requestPreviewAtDocumentEnd = (
      next: string,
      selection?: Readonly<{ end: number; start: number }>,
    ) => {
      const requestSignature = nextRequestSignature();
      const pin = current.runtime.prepareDocumentEndWindowPin(
        requestSignature,
        selection,
      );
      try {
        const requestRevision = current.session.schedule(
          request(next, requestSignature),
          true,
        );
        recordRequest("document-end", next, requestSignature, requestRevision);
        return { signature: requestSignature, release: pin.release };
      } catch (error) {
        pin.release();
        throw error;
      }
    };
    const requestPreviewForTest = (next: string) => {
      // This is an explicit public Preview-session read requested by the
      // test/port. Ordinary local visual edits do not auto-request it.
      const requestSignature = nextRequestSignature();
      const requestRevision = current.session.schedule(
        request(next, requestSignature),
        true,
      );
      return recordRequest(
        "test-request",
        next,
        requestSignature,
        requestRevision,
      );
    };
    const resolvePreview = async () => {
      const requested = requests.at(-1);
      const response = current.responses.at(-1);
      if (!requested || !response) {
        throw new Error("live-preview-request-missing");
      }
      const preview = windowedPreviewForMarkdown(
        requested.markdown,
        requested.signature,
      );
      await act(async () => {
        response.resolve(preview);
        for (let index = 0; index < 24; index += 1) {
          await Promise.resolve();
        }
        await flushAnimationFrames(8);
      });
      return { preview, requested };
    };
    const syncSourceRevision = () => {
      current.setSourceRevision(revision());
    };
    const revealFaults: unknown[] = [];
    const revealAcceptedWindowRow = (
      request: Parameters<PreviewSurfaceRuntime["revealAcceptedWindowRow"]>[0],
    ) => {
      try {
        return current.runtime.revealAcceptedWindowRow(request);
      } catch (error) {
        revealFaults.push(error);
        throw error;
      }
    };
    const editor = () => {
      renderedAcceptedWindowNotifications = acceptedWindowNotificationCount;
      return (
        <WindowedImmersiveVisualEditor
          referenceLabelCaseFoldProfile={14}
          acceptedWindowSnapshotGeneration={acceptedWindowNotificationCount}
          documentSession={sourceDocument.session}
          editMap={editorEditMap}
          getAcceptedWindowRow={current.runtime.getAcceptedWindowRow}
          getAcceptedWindowSnapshot={current.runtime.getAcceptedWindowSnapshot}
          imagePasteUploadEnabled={false}
          imageUploadEnabled={false}
          onCanonicalDocumentChange={onCanonicalDocumentChange}
          onDiagnostic={onWindowedDiagnostic}
          onDispose={onDispose}
          onFailure={onFailure}
          onMarkdownChange={onMarkdownChange}
          onPendingChange={onPendingChange}
          onReady={onReady}
          onTransferFailure={onTransferFailure}
          pending={previewPending}
          prepareWindowBlockAdoption={
            current.runtime.prepareWindowBlockAdoption
          }
          previewSnapshot={editorPreviewSnapshot}
          previewStatus={ownerPreviewStatus}
          requestPreview={requestPreview}
          requestPreviewAtDocumentEnd={requestPreviewAtDocumentEnd}
          retainCompositionSurface={retainCompositionSurface}
          revealAcceptedWindowRow={revealAcceptedWindowRow}
          surface={current.surface}
        />
      );
    };
    renderEditor = () => view?.rerender(editor());
    view = render(editor());
    editorActive = true;
    current.surface.tabIndex = 0;
    current.surface.focus();
    window
      .getSelection()
      ?.collapse(current.surface, current.surface.childNodes.length);
    const reveal = () => {
      act(() => {
        current.surface.ownerDocument.dispatchEvent(
          new Event("selectionchange"),
        );
      });
      const row = current.surface.querySelector<HTMLElement>(
        '[data-easymde-visual-block-id="b319"]',
      );
      if (!(row instanceof HTMLElement)) {
        throw new Error("live-document-end-row-missing");
      }
      const revealed = current.runtime.getAcceptedWindowSnapshot();
      if (!revealed) {
        throw new Error("live-document-end-revealed-snapshot-missing");
      }
      return { accepted, onFailure, revealed, row };
    };
    return {
      cleanup,
      current,
      diagnostics,
      getWindowedState: () => ({
        acceptedWindowNotifications: acceptedWindowNotificationCount,
        pending: previewPending,
        renderedAcceptedWindowNotifications,
        previewSnapshot: editorPreviewSnapshot,
        previewStatus: ownerPreviewStatus,
      }),
      markdown,
      onCanonicalDocumentChange,
      onDispose,
      onFailure,
      onMarkdownChange,
      onReady,
      onTransferFailure,
      ownerSnapshotReady,
      ownerStatusChanges,
      pendingChanges,
      requestPreviewForTest,
      requests,
      resolvePreview,
      reveal,
      revealFaults,
      sourceDocument,
      syncSourceRevision,
      windowedDiagnostics,
      windowReadyKeys,
    };
  } catch (error) {
    cleanup();
    throw error;
  }
}

describe("PreviewSurfaceOwner", () => {
  let activeTestSignal: AbortSignal | null = null;
  beforeEach((context) => {
    activeTestSignal = context.signal;
  });
  it("keeps the full editor usable after canceling a held obsolete candidate", async () => {
    const document = markdownDocumentSource("before");
    const revision = document.owner.getRevision;
    if (!revision) throw new Error("retained-document-revision-missing");
    const editMap: PreviewEditMap = {
      version: 1,
      coordinate: "line",
      signature: "initial",
      blocks: [{ id: "b0", editable: true, startLine: 0, endLine: 1 }],
    };
    const status = vi.fn();
    const snapshots = vi.fn();
    const current = setup({
      contentEditable: true,
      currentSourceSnapshot: () => ({
        value: document.owner.getValue(),
        revision: revision(),
      }),
      initialHtml: '<p data-easymde-visual-block-id="b0">before</p>',
      initialEditMap: editMap,
      initialSignature: "initial",
      onStatusChange: status,
      onSnapshotReady: snapshots,
    });
    let view: RenderResult | null = null;
    try {
      await waitFor(() => expect(status).toHaveBeenLastCalledWith("ready"));
      const failure = vi.fn();
      view = render(
        <ImmersiveVisualEditor
          referenceLabelCaseFoldProfile={14}
          documentSession={document.session}
          imageUploadEnabled={false}
          imagePasteUploadEnabled={false}
          onCanonicalDocumentChange={vi.fn()}
          onDiagnostic={vi.fn()}
          onDispose={vi.fn()}
          onFailure={failure}
          onMarkdownChange={vi.fn()}
          onPendingChange={vi.fn()}
          onReady={vi.fn()}
          onTransferFailure={vi.fn()}
          pending={false}
          previewSnapshot={{ editMap, revision: 1, signature: "initial" }}
          previewStatus="ready"
          retainCompositionSurface={() =>
            current.runtime.retainCompositionSurface()
          }
          requestPreview={() => "history"}
          surface={current.surface}
        />,
      );
      const paragraph = current.surface.querySelector("p");
      const text = paragraph?.firstChild;
      if (!(text instanceof Text))
        throw new Error("retained-document-text-missing");
      current.surface.focus();
      window.getSelection()?.collapse(text, text.length);
      const lease = current.runtime.retainCompositionSurface();
      act(() => current.session.schedule(request("before", "old"), true));
      await act(async () => {
        current.responses[0]?.resolve({
          html: safeHtml("<p>before</p>"),
          features: {},
        });
        for (let index = 0; index < 20; index += 1) await Promise.resolve();
      });
      await waitFor(() =>
        expect(current.surface.dataset.easymdePreviewPhase).toBe("committing"),
      );
      const insert = (value: string) => {
        const before = new InputEvent("beforeinput", {
          bubbles: true,
          cancelable: true,
          inputType: "insertText",
          data: value,
        });
        const range = window.getSelection()?.getRangeAt(0).cloneRange();
        Object.defineProperty(before, "getTargetRanges", {
          value: () => (range ? [range] : []),
        });
        act(() => {
          current.surface.dispatchEvent(before);
          if (!before.defaultPrevented) {
            const offset = text.length;
            text.insertData(offset, value);
            window.getSelection()?.collapse(text, offset + value.length);
            current.surface.dispatchEvent(
              new InputEvent("input", {
                bubbles: true,
                inputType: "insertText",
                data: value,
              }),
            );
          }
        });
        expect(before.defaultPrevented).toBe(false);
      };
      insert("X");
      await waitFor(() => expect(document.owner.getValue()).toBe("beforeX"));
      const published = snapshots.mock.calls.length;
      act(() => lease.release());
      expect(status).toHaveBeenLastCalledWith("ready");
      expect(snapshots).toHaveBeenCalledTimes(published);
      expect(current.surface.querySelector("p")).toBe(paragraph);
      insert("Y");
      await waitFor(() => expect(document.owner.getValue()).toBe("beforeXY"));
      act(() =>
        current.surface.dispatchEvent(
          new InputEvent("beforeinput", {
            bubbles: true,
            cancelable: true,
            inputType: "historyUndo",
          }),
        ),
      );
      expect(document.owner.getValue()).toBe("beforeX");
      act(() =>
        current.surface.dispatchEvent(
          new InputEvent("beforeinput", {
            bubbles: true,
            cancelable: true,
            inputType: "historyRedo",
          }),
        ),
      );
      expect(document.owner.getValue()).toBe("beforeXY");
      expect(failure).not.toHaveBeenCalled();
    } finally {
      view?.unmount();
      current.unmount();
      document.session.destroy();
      document.container.remove();
      document.submissionField.remove();
    }
  });
  it("does not install a held formal candidate after its source changes", async () => {
    let source = "before";
    let revision = 0;
    const onSnapshotReady = vi.fn();
    const onStatusChange = vi.fn();
    const current = setup({
      contentEditable: true,
      currentSourceSnapshot: () => ({ value: source, revision }),
      initialHtml: "<p>before</p>",
      onSnapshotReady,
      onStatusChange,
    });
    try {
      await waitFor(() =>
        expect(current.surface.dataset.easymdePreviewPhase).toBe("ready"),
      );
      const lease = current.runtime.retainCompositionSurface();
      act(() => current.session.schedule(request(source, "old"), true));
      await act(async () => {
        current.responses[0]?.resolve({
          html: safeHtml("<p>before</p>"),
          features: {},
        });
        for (let index = 0; index < 20; index += 1) await Promise.resolve();
      });
      await waitFor(() =>
        expect(current.surface.dataset.easymdePreviewPhase).toBe("committing"),
      );
      const paragraph = current.surface.querySelector("p");
      if (!paragraph) throw new Error("held-source-paragraph-missing");
      paragraph.textContent = "edited";
      current.surface.focus();
      window.getSelection()?.collapse(paragraph.firstChild, 3);
      source = "edited";
      revision += 1;
      const snapshotCount = onSnapshotReady.mock.calls.length;
      act(() => lease.release());
      expect(current.surface.querySelector("p")).toBe(paragraph);
      expect(paragraph.textContent).toBe("edited");
      expect(window.getSelection()?.anchorNode).toBe(paragraph.firstChild);
      expect(window.getSelection()?.anchorOffset).toBe(3);
      expect(onSnapshotReady).toHaveBeenCalledTimes(snapshotCount);
      expect(onStatusChange).toHaveBeenLastCalledWith("ready");
      expect(current.surface.getAttribute("aria-busy")).toBe("false");
      current.rerender();
      expect(current.surface.querySelector("p")).toBe(paragraph);
      act(() => current.session.schedule(request(source, "new"), true));
      await act(async () => {
        current.responses[1]?.resolve({
          html: safeHtml("<p>edited</p>"),
          features: {},
        });
        for (let index = 0; index < 20; index += 1) await Promise.resolve();
      });
      await waitFor(() =>
        expect(onSnapshotReady).toHaveBeenCalledWith(
          expect.any(String),
          "new",
          expect.anything(),
        ),
      );
      expect(current.surface.querySelector("p")?.textContent).toBe("edited");
    } finally {
      current.unmount();
    }
  });
  // Forty edits plus complete real-history traversal and twelve accepted
  // transfers share this budget; each readiness barrier still has eight frames.
  const runPreviewWindowCadence = async (
    scenario:
      "code history" | "empty fence gap" | "empty fence gap composition",
  ) => {
    const signal = activeTestSignal;
    const throwIfAborted = (): void => {
      if (signal?.aborted) throw signal.reason;
    };
    let resolveCleanup!: () => void;
    const cleanupDone = new Promise<void>((resolve) => {
      resolveCleanup = resolve;
    });
    throwIfAborted();
    const probe =
      scenario === "code history"
        ? {
            startedAt: Date.now(),
            stages: [] as Array<{
              stage: string;
              at: number;
              frames: number;
              requests: number;
              responses: number;
              ready: boolean;
              accepted: boolean;
              status: string;
            }>,
            frames: 0,
            completedFrames: 0,
            requests: 0,
            responses: 0,
            ready: false,
            accepted: false,
            status: "idle",
            finallyEntered: false,
            finallyCompleted: false,
            hookRan: false,
          }
        : null;
    const mark = (stage: string): void => {
      if (!probe || probe.stages.length >= 32) return;
      probe.stages.push({
        stage,
        at: Date.now() - probe.startedAt,
        frames: probe.frames,
        requests: probe.requests,
        responses: probe.responses,
        ready: probe.ready,
        accepted: probe.accepted,
        status: probe.status,
      });
    };
    if (probe) {
      mark("test-start");
      onTestFinished((context) => {
        probe.hookRan = true;
        mark("on-test-finished");
        try {
          const receipt = {
            scenario: "code history",
            elapsedMs: Date.now() - probe.startedAt,
            frames: probe.frames,
            completedFrames: probe.completedFrames,
            requests: probe.requests,
            responses: probe.responses,
            ready: probe.ready,
            accepted: probe.accepted,
            status: probe.status,
            finallyEntered: probe.finallyEntered,
            finallyCompleted: probe.finallyCompleted,
            hookRan: probe.hookRan,
            runnerState: context.task.result?.state ?? "unknown",
            aborted: context.signal.aborted,
            stages: probe.stages.slice(),
          };
          process.stdout.write(
            `PREVIEW_SURFACE_OWNER_CODE_HISTORY ${JSON.stringify(receipt)}\n`,
          );
        } catch {
          // Probe output must never replace the runner's original failure.
        }
      });
    }
    const body =
      "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ\n";
    const initialMarkdown = Array.from({ length: 320 }, (_, index) =>
      [1, 3].includes(index)
        ? `~~~js\n${body}~~~`
        : [4, 60].includes(index)
          ? "$x$"
          : `Paragraph ${index}`,
    ).join("\n\n");
    const previewFor = (markdown: string, signature: string) => {
      const sourceBlocks = Array.from(
        markdown.matchAll(/~~~js\n[\s\S]*?^~~~$|[^\n]+/gm),
      );
      return {
        features: {},
        editMap: {
          version: 1 as const,
          coordinate: "line" as const,
          signature,
          blocks: sourceBlocks.map((match, index) => {
            const startLine =
              markdown.slice(0, match.index).split("\n").length - 1;
            return {
              id: `b${index}`,
              editable: true,
              startLine,
              endLine: startLine + match[0].split("\n").length,
            };
          }),
        },
        html: sourceBlocks
          .map(([source], index) =>
            source.startsWith("~~~js\n")
              ? `<pre data-easymde-visual-block-id="b${index}"><code class="language-js">${source.slice(6, -3)}</code></pre>`
              : `<p data-easymde-visual-block-id="b${index}">${source === "$x$" ? '<span class="easymde-math" data-easymde-rendered="1" data-easymde-visual-markdown-source="x"><span class="katex">x</span></span>' : source}</p>`,
          )
          .join(
            scenario === "empty fence gap" ||
              scenario === "empty fence gap composition"
              ? "\n"
              : "",
          ) as SafePreviewHtml,
      };
    };
    const initial = previewFor(initialMarkdown, "window-cadence");
    mark("setup:preview-fixture");
    const submissionField = document.createElement("textarea");
    submissionField.value = submissionField.defaultValue = initialMarkdown;
    const container = document.createElement("div");
    document.body.append(container, submissionField);
    const documentOwner = createCodeMirrorDocumentSession({
      container,
      label: "Markdown",
      submissionField,
    });
    const initialCaret = initialMarkdown.indexOf("~~~js\n") + 6 + 40;
    documentOwner.applyTextChange({
      value: initialMarkdown,
      selection: { direction: "none", start: initialCaret, end: initialCaret },
    });
    const documentSession = createEditorDocumentSession(
      documentOwner,
      createNativeTitleSession(null),
    );
    const getRevision = documentOwner.getRevision;
    if (!getRevision) throw new Error("window-cadence-revision-owner-missing");
    documentSession.registerSubmissionState({
      appleFont: "system",
      codeTheme: "github",
      codeThemeExplicit: false,
      customCssId: "",
      customFont: "none",
      markdownTheme: "default",
      serifFont: "off",
      windowsFont: "system",
    });
    mark("setup:document-session");
    let generation = 0;
    let snapshot: {
      editMap: PreviewEditMap;
      revision: number;
      signature: string;
    } = {
      editMap: initial.editMap,
      revision: 1,
      signature: initial.editMap.signature,
    };
    let status: PreviewSurfaceStatus = "ready";
    let updateVisual: (() => void) | null = null;
    let readAccepted: (() => boolean) | null = null;
    const readAcceptedSafe = (): boolean => {
      if (!readAccepted) return false;
      try {
        return readAccepted();
      } catch {
        return false;
      }
    };
    const onFailure = vi.fn();
    const onDiagnostic = vi.fn();
    let scrollCanvas: HTMLElement | null = null;
    const nativeRect = HTMLElement.prototype.getBoundingClientRect;
    const rectSpy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        if (this.classList.contains("easymde-immersive-preview-canvas"))
          return previewRect(0, 240);
        if (this.tagName === "ARTICLE")
          return previewRect(-(scrollCanvas?.scrollTop ?? 0), 320 * 24);
        const id = this.getAttribute("data-easymde-visual-block-id");
        return id?.startsWith("b")
          ? previewRect(
              Number.parseInt(id.slice(1), 10) * 24 -
                (scrollCanvas?.scrollTop ?? 0),
              24,
            )
          : nativeRect.call(this);
      });
    const current = setup({
      contentEditable: true,
      initialEditMap: initial.editMap,
      initialHtml: initial.html,
      initialSignature: initial.editMap.signature,
      currentSourceSnapshot: () => ({
        revision: getRevision(),
        value: documentOwner.getValue(),
      }),
      onDiagnostic,
      onWindowReady: () => {
        generation += 1;
        if (probe) probe.accepted = readAcceptedSafe();
        updateVisual?.();
      },
      onSnapshotReady: (_html, signature, editMap) => {
        if (!editMap) throw new Error("window-cadence-edit-map-missing");
        snapshot = { editMap, signature, revision: snapshot.revision + 1 };
        if (probe) probe.accepted = readAcceptedSafe();
        updateVisual?.();
      },
      onStatusChange: (next) => {
        status = next;
        if (probe) {
          probe.status = next;
          probe.ready = "ready" === next;
        }
        updateVisual?.();
      },
      stagingScheduler: { now: () => 0, yield: () => Promise.resolve() },
      windowed: true,
    });
    readAccepted = () => Boolean(current.runtime.getAcceptedWindowSnapshot());
    if (probe) {
      probe.accepted = readAcceptedSafe();
      probe.status = status;
      probe.ready = status === "ready";
    }
    mark("setup:owner");
    scrollCanvas = current.canvas;
    Object.defineProperty(current.canvas, "clientHeight", {
      configurable: true,
      value: 240,
    });
    current.canvas.dispatchEvent(new Event("scroll"));
    let view: RenderResult | null = null;
    const menuButton = document.createElement("button");
    menuButton.setAttribute("role", "menuitem");
    const outsideButton = document.createElement("button");
    onTestFinished(async () => {
      await cleanupDone;
    });
    try {
      const settleFrames = async () => {
        throwIfAborted();
        await act(async () => {
          for (let index = 0; index < 16; index += 1) await Promise.resolve();
        });
        throwIfAborted();
        // Flush React after each real frame, and stop when the actual owner
        // publishes a ready certificate instead of sleeping eight frames.
        for (let frame = 0; frame < 8; frame += 1) {
          throwIfAborted();
          if (probe) probe.frames += 1;
          await act(async () => {
            await flushAnimationFrames(1);
          });
          throwIfAborted();
          if (probe) {
            probe.completedFrames += 1;
            probe.accepted = readAcceptedSafe();
          }
          if (status === "ready" && current.runtime.getAcceptedWindowSnapshot())
            return;
        }
        expect(status).toBe("ready");
        expect(current.runtime.getAcceptedWindowSnapshot()).not.toBeNull();
      };
      await settleFrames();
      current.canvas.dispatchEvent(new Event("scroll"));
      await settleFrames();
      expect(onDiagnostic.mock.calls).toEqual([]);
      const firstWindow = current.runtime.getAcceptedWindowSnapshot();
      expect(firstWindow).not.toBeNull();
      mark("setup:initial-ready");
      expect(firstWindow?.blocks.map((block) => block.id)).toContain("b4");
      for (const block of firstWindow?.blocks ?? []) {
        expect(block.innerHTML).toBe(block.node.innerHTML);
      }
      expect(
        current.surface
          .querySelector(".easymde-math")
          ?.getAttribute("contenteditable"),
      ).toBe("false");
      const requests: Array<{ markdown: string; signature: string }> = [];
      const requestPreview = (markdown: string) => {
        const signature = `window-history-${requests.length + 1}`;
        requests.push({ markdown, signature });
        if (probe) probe.requests += 1;
        current.session.schedule(request(markdown, signature), true);
        return signature;
      };
      const requestPreviewAtDocumentEnd = (
        markdown: string,
        selection?: Readonly<{ end: number; start: number }>,
      ) => {
        const pin = current.runtime.prepareDocumentEndWindowPin(
          `window-history-${requests.length + 1}`,
          selection,
        );
        try {
          return { signature: requestPreview(markdown), release: pin.release };
        } catch (error) {
          pin.release();
          throw error;
        }
      };
      let visualRuntime: ImmersiveVisualEditorRuntime | null = null;
      const onReady = (runtime: ImmersiveVisualEditorRuntime) => {
        visualRuntime = runtime;
      };
      const onTransferFailure = vi.fn();
      const props = {
        documentSession,
        imagePasteUploadEnabled: false,
        imageUploadEnabled: false,
        onCanonicalDocumentChange: vi.fn(),
        onDiagnostic,
        onDispose: vi.fn(),
        onFailure,
        onMarkdownChange: vi.fn(),
        onPendingChange: vi.fn(),
        onReady,
        onTransferFailure,
        pending: false,
        prepareWindowBlockAdoption: current.runtime.prepareWindowBlockAdoption,
        retainCompositionSurface: () =>
          current.runtime.retainCompositionSurface(),
        requestPreview,
        requestPreviewAtDocumentEnd,
        getAcceptedWindowSnapshot: current.runtime.getAcceptedWindowSnapshot,
        surface: current.surface,
      };
      const visual = () => (
        <WindowedImmersiveVisualEditor
          referenceLabelCaseFoldProfile={14}
          {...props}
          editMap={snapshot.editMap}
          previewSnapshot={snapshot}
          previewStatus={status}
          acceptedWindowSnapshotGeneration={generation}
        />
      );
      view = render(visual());
      updateVisual = () =>
        queueMicrotask(() => {
          if (signal?.aborted) return;
          if (updateVisual) view?.rerender(visual());
        });
      current.surface.tabIndex = 0;
      current.surface.focus();
      mark("setup:visual-mounted");
      const codeAt = (id: string) => {
        const code = current.surface.querySelector(
          `[data-easymde-visual-block-id="${id}"] > code`,
        );
        if (!(code instanceof HTMLElement))
          throw new Error("window-cadence-code-missing");
        return code;
      };
      const select = (code: HTMLElement, start: number, end = start) => {
        const text = code.firstChild;
        if (!(text instanceof Text))
          throw new Error("window-cadence-text-missing");
        window.getSelection()?.setBaseAndExtent(text, start, text, end);
      };
      const remove = (
        code: HTMLElement,
        start: number,
        end: number,
        step = "empty body",
      ) => {
        select(code, start, end);
        const range = window.getSelection()?.getRangeAt(0).cloneRange();
        if (!range) throw new Error("window-cadence-range-missing");
        if (start === end) range.setStart(range.startContainer, start - 1);
        const event = new InputEvent("beforeinput", {
          bubbles: true,
          cancelable: true,
          inputType: "deleteContentBackward",
        });
        Object.defineProperty(event, "getTargetRanges", {
          value: () => [range],
        });
        current.surface.dispatchEvent(event);
        expect(event.defaultPrevented, step).toBe(false);
        range.deleteContents();
        window
          .getSelection()
          ?.collapse(range.startContainer, range.startOffset);
        current.surface.dispatchEvent(
          new InputEvent("input", {
            bubbles: true,
            inputType: "deleteContentBackward",
          }),
        );
      };
      let expected = initialMarkdown;
      const committedSelections = new Map([
        [initialMarkdown, documentOwner.getSelection()],
      ]);
      const sourceBodyStart = (id: string): number => {
        const block = initial.editMap.blocks.find((entry) => entry.id === id);
        if (!block) throw new Error("window-cadence-source-block-missing");
        const start = markdownLineStarts(expected)[block.startLine];
        if (start === undefined)
          throw new Error("window-cadence-source-line-missing");
        expect(expected.slice(start, start + 6)).toBe("~~~js\n");
        return start + 6;
      };
      if (
        scenario === "empty fence gap" ||
        scenario === "empty fence gap composition"
      ) {
        const code = codeAt("b1");
        act(() => remove(code, 0, code.textContent?.length ?? 0));
        act(() =>
          current.surface.dispatchEvent(
            new KeyboardEvent("keydown", {
              bubbles: true,
              cancelable: true,
              key: "Backspace",
            }),
          ),
        );
        const paragraph = current.surface.querySelector(
          '[data-easymde-visual-block-id="b1"]',
        );
        if (
          !(paragraph instanceof HTMLParagraphElement) ||
          !(paragraph.firstChild instanceof HTMLBRElement)
        )
          throw new Error("window-gap-placeholder-missing");
        const placeholder = paragraph.firstChild;
        const afterExit = documentOwner.getValue();
        const start = documentOwner.getSelection().start;
        const mounted = Array.from(current.surface.childNodes);
        // The caret must be collapsed inside the owned empty placeholder;
        // its exact node and offset are presentation, not contract.
        const caretInPlaceholder = (): boolean => {
          const selected = window.getSelection();
          const anchor = selected?.anchorNode ?? null;
          return Boolean(
            selected?.isCollapsed &&
            anchor &&
            (anchor === paragraph || paragraph.contains(anchor)),
          );
        };
        expect(caretInPlaceholder()).toBe(true);
        act(() => {
          current.surface.dispatchEvent(
            new KeyboardEvent("keydown", {
              bubbles: true,
              cancelable: true,
              key: "Enter",
            }),
          );
          current.surface.dispatchEvent(
            new InputEvent("beforeinput", {
              bubbles: true,
              cancelable: true,
              inputType: "insertParagraph",
            }),
          );
        });
        expect(status).toBe("loading");
        expect(Array.from(current.surface.childNodes)).toEqual(mounted);
        expect(caretInPlaceholder()).toBe(true);
        expect(documentOwner.getSelection()).toEqual({
          direction: "none",
          end: start + 1,
          start: start + 1,
        });
        expect(
          current.surface.querySelectorAll(
            "[data-easymde-preview-window-spacer]",
          ).length,
        ).toBeGreaterThan(0);
        const afterEnter = `${afterExit.slice(0, start)}\n${afterExit.slice(start)}`;
        expect(documentOwner.getValue()).toBe(afterEnter);
        if (scenario === "empty fence gap composition") {
          // A native IME draft that began while the Enter Preview is still
          // outstanding must survive acceptance: the sink holds its DOM
          // writes, compositionend restores the draft and publishes the
          // committed data exactly once through the canonical session.
          const historyBefore = documentOwner.getHistoryState();
          act(() => {
            current.surface.dispatchEvent(
              new CompositionEvent("compositionstart", { bubbles: true }),
            );
            current.surface.dispatchEvent(
              new InputEvent("beforeinput", {
                bubbles: true,
                cancelable: false,
                isComposing: true,
                inputType: "insertCompositionText",
                data: "文",
              }),
            );
            const native = window.getSelection();
            const draft = native?.rangeCount
              ? native.getRangeAt(0).cloneRange()
              : null;
            if (!draft) throw new Error("gap-ime-range-missing");
            const text = document.createTextNode("文");
            draft.insertNode(text);
            native?.collapse(text, 1);
            current.surface.dispatchEvent(
              new InputEvent("input", {
                bubbles: true,
                isComposing: true,
                inputType: "insertCompositionText",
                data: "文",
              }),
            );
          });
          expect(documentOwner.getValue()).toBe(afterEnter);
          await act(async () => {
            for (const [index, response] of current.responses.entries()) {
              const requested = requests[index];
              if (!requested) throw new Error("gap-ime-request-missing");
              response.resolve(
                previewFor(requested.markdown, requested.signature),
              );
            }
          });
          await act(async () => {
            await flushAnimationFrames(6);
          });
          // While the draft is live the editor must not lose it: acceptance
          // may proceed in whatever order its owner chooses, but the committed
          // character below must still reach canonical exactly once.
          act(() => {
            current.surface.dispatchEvent(
              new CompositionEvent("compositionend", {
                bubbles: true,
                data: "文",
              }),
            );
          });
          // compositionend publishes one canonical transaction and requests a
          // fresh Preview; resolve it so the sink can install that frame.
          await act(async () => {
            for (let index = 0; index < 8; index += 1) await Promise.resolve();
          });
          await act(async () => {
            for (const [index, response] of current.responses.entries()) {
              const requested = requests[index];
              if (!requested) throw new Error("gap-ime-request-missing");
              response.resolve(
                previewFor(requested.markdown, requested.signature),
              );
            }
          });
          await settleFrames();
          const composed = `${afterEnter.slice(0, start + 1)}文${afterEnter.slice(start + 1)}`;
          expect(documentOwner.getValue()).toBe(composed);
          expect(documentOwner.getSelection()).toEqual({
            direction: "none",
            start: start + 2,
            end: start + 2,
          });
          expect(documentOwner.getHistoryState().undoDepth).toBe(
            historyBefore.undoDepth + 1,
          );
          expect(onFailure).not.toHaveBeenCalled();
          expect(onDiagnostic).not.toHaveBeenCalled();
          return;
        }
        const input = new InputEvent("beforeinput", {
          bubbles: true,
          cancelable: true,
          inputType: "insertText",
          data: "gap",
        });
        const target = document.createRange();
        target.setStart(placeholder, 0);
        target.collapse(true);
        Object.defineProperty(input, "getTargetRanges", {
          value: () => [target],
        });
        act(() => current.surface.dispatchEvent(input));
        expect(input.defaultPrevented).toBe(true);
        const typed = `${afterEnter.slice(0, start + 1)}gap${afterEnter.slice(start + 1)}`;
        expect(documentOwner.getValue()).toBe(typed);
        expect(documentOwner.getSelection()).toEqual({
          direction: "none",
          start: start + 4,
          end: start + 4,
        });
        expect(onFailure).not.toHaveBeenCalled();
        expect(onTransferFailure).not.toHaveBeenCalled();
        await act(async () => {
          for (const [index, response] of current.responses.entries()) {
            const requested = requests[index];
            if (!requested) throw new Error("window-gap-request-missing");
            response.resolve(
              previewFor(requested.markdown, requested.signature),
            );
          }
        });
        await settleFrames();
        const accepted = current.surface.querySelector(
          '[data-easymde-visual-block-id="b1"]',
        )?.firstChild;
        if (!(accepted instanceof Text))
          throw new Error("window-gap-accepted-text-missing");
        expect(accepted.data).toBe("gap");
        expect(window.getSelection()?.anchorNode).toBe(accepted);
        expect(window.getSelection()?.anchorOffset).toBe(3);
        act(() => {
          current.surface.dispatchEvent(
            new InputEvent("beforeinput", {
              bubbles: true,
              cancelable: true,
              inputType: "insertText",
              data: "Z",
            }),
          );
          accepted.appendData("Z");
          window.getSelection()?.collapse(accepted, 4);
          current.surface.dispatchEvent(
            new InputEvent("input", {
              bubbles: true,
              inputType: "insertText",
              data: "Z",
            }),
          );
        });
        expect(documentOwner.getValue()).toBe(
          `${afterEnter.slice(0, start + 1)}gapZ${afterEnter.slice(start + 1)}`,
        );
        expect(current.surface.getAttribute("contenteditable")).toBe("true");
        expect(onFailure).not.toHaveBeenCalled();
        expect(onDiagnostic).not.toHaveBeenCalled();
        expect(onTransferFailure).not.toHaveBeenCalled();
        return;
      }
      mark("edits:start");
      throwIfAborted();
      for (const id of ["b1", "b3"]) {
        const code = codeAt(id);
        for (let key = 0; key < 20; key += 1) {
          throwIfAborted();
          const from = sourceBodyStart(id) + 39 - key;
          expect(from).toBeGreaterThan(5);
          expected = expected.slice(0, from) + expected.slice(from + 1);
          act(() =>
            remove(code, 40 - key, 40 - key, `${id} Backspace ${key + 1}`),
          );
          expect(documentOwner.getValue()).toBe(expected);
          committedSelections.set(expected, documentOwner.getSelection());
          if (key === 7) {
            const oldNodes = Array.from(current.surface.childNodes);
            current.canvas.scrollTop = id === "b1" ? 1440 : 1680;
            current.canvas.dispatchEvent(new Event("scroll"));
            mark(`scroll:${id}`);
            await settleFrames();
            throwIfAborted();
            expect(onDiagnostic.mock.calls).toEqual([]);
            expect(current.runtime.getAcceptedWindowSnapshot()).not.toBeNull();
            expect(Array.from(current.surface.childNodes)).not.toEqual(
              oldNodes,
            );
          }
        }
        window.getSelection()?.removeAllRanges();
        current.canvas.scrollTop = 0;
        current.canvas.dispatchEvent(new Event("scroll"));
        await settleFrames();
        throwIfAborted();
      }
      mark("edits:end");
      const code = codeAt("b3");
      const remaining = code.textContent ?? "";
      const bodyStart = sourceBodyStart("b3");
      expected = `${expected.slice(0, bodyStart)}\n${expected.slice(bodyStart + remaining.length)}`;
      act(() => remove(code, 0, remaining.length));
      expect(documentOwner.getValue()).toBe(expected);
      committedSelections.set(expected, documentOwner.getSelection());
      expect(code.textContent).toBe("");
      if (!visualRuntime) throw new Error("window-cadence-runtime-missing");
      mark("menu:start");
      throwIfAborted();
      const menuCode = codeAt("b1");
      select(menuCode, 20);
      const menuFence = `~~~js\n${menuCode.textContent ?? ""}~~~`;
      const from = expected.indexOf(menuFence);
      const to = from + menuFence.length;
      const removed = expected.slice(0, from) + expected.slice(to);
      act(() => {
        expect(
          (
            visualRuntime as ImmersiveVisualEditorRuntime
          ).prepareContextMenuSelection?.(menuCode.parentElement),
        ).toBe(true);
      });
      expect(documentOwner.getSelection().start).toBe(from);
      expect(documentOwner.getSelection().end).toBeGreaterThanOrEqual(to);
      // Root's context preparation excludes the fence's trailing terminator.
      act(() =>
        documentOwner.applyTextChange({
          value: expected,
          selection: {
            ...documentOwner.getSelection(),
            start: from,
            end: to,
          },
        }),
      );
      document.body.append(menuButton);
      menuButton.focus();
      expect(document.activeElement).toBe(menuButton);
      // The menu restores its captured native caret without changing the
      // canonical whole-fence selection prepared above.
      select(menuCode, 20);
      act(() => {
        expect(
          (visualRuntime as ImmersiveVisualEditorRuntime).applyCanonicalChange({
            change: {
              changes: { from, insert: "", to },
              selection: { direction: "none", start: from, end: from },
              value: removed,
            },
            expected: {
              revision: getRevision(),
              selection: documentOwner.getSelection(),
              value: expected,
            },
          }),
        ).toBe("handled");
      });
      menuButton.remove();
      current.surface.focus();
      select(menuCode, 20);
      expect(documentOwner.getValue()).toBe(removed);
      committedSelections.set(removed, documentOwner.getSelection());
      mark("menu:end");
      const history = (redo: boolean, keyboard: boolean) =>
        act(() => {
          throwIfAborted();
          const event = keyboard
            ? new KeyboardEvent("keydown", {
                bubbles: true,
                cancelable: true,
                key: "z",
                ctrlKey: true,
                shiftKey: redo,
              })
            : new InputEvent("beforeinput", {
                bubbles: true,
                cancelable: true,
                inputType: redo ? "historyRedo" : "historyUndo",
              });
          current.surface.dispatchEvent(event);
          expect(event.defaultPrevented).toBe(true);
          throwIfAborted();
        });
      const captureHistory = () => ({
        value: documentOwner.getValue(),
        selection: documentOwner.getSelection(),
        history: documentOwner.getHistoryState(),
      });
      let deliveredResponses = 0;
      const acceptResponses = async () => {
        throwIfAborted();
        await act(async () => {
          expect(current.responses).toHaveLength(requests.length);
          for (
            ;
            deliveredResponses < requests.length;
            deliveredResponses += 1
          ) {
            throwIfAborted();
            const previewRequest = requests[deliveredResponses];
            if (!previewRequest)
              throw new Error("window-cadence-preview-request-missing");
            current.responses[deliveredResponses]?.resolve(
              previewFor(previewRequest.markdown, previewRequest.signature),
            );
            if (probe) probe.responses += 1;
          }
        });
        throwIfAborted();
        await settleFrames();
        throwIfAborted();
      };
      const compose = async (data: string, acceptWhileComposing: boolean) => {
        throwIfAborted();
        mark(
          acceptWhileComposing
            ? "composition:accepted:start"
            : "composition:held:start",
        );
        const before = captureHistory();
        expect(status).toBe("loading");
        act(() => {
          current.surface.dispatchEvent(
            new CompositionEvent("compositionstart", {
              bubbles: true,
              data: "",
            }),
          );
          expect(onFailure.mock.calls).toEqual([]);
          current.surface.dispatchEvent(
            new InputEvent("beforeinput", {
              bubbles: true,
              cancelable: false,
              isComposing: true,
              inputType: "insertCompositionText",
              data,
            }),
          );
          const native = window.getSelection();
          const draft = native?.rangeCount
            ? native.getRangeAt(0).cloneRange()
            : null;
          if (!draft) throw new Error("window-cadence-ime-range-missing");
          expect(draft.collapsed).toBe(true);
          const text = document.createTextNode(data);
          draft.insertNode(text);
          native?.collapse(text, data.length);
          current.surface.dispatchEvent(
            new InputEvent("input", {
              bubbles: true,
              isComposing: true,
              inputType: "insertCompositionText",
              data,
            }),
          );
        });
        expect(captureHistory()).toEqual(before);
        if (acceptWhileComposing) await acceptResponses();
        act(() =>
          current.surface.dispatchEvent(
            new CompositionEvent("compositionend", { bubbles: true, data }),
          ),
        );
        expect(onFailure.mock.calls).toEqual([]);
        const composed =
          before.value.slice(0, before.selection.start) +
          data +
          before.value.slice(before.selection.end);
        expect(documentOwner.getValue()).toBe(composed);
        expect(documentOwner.getSelection()).toEqual({
          direction: "none",
          start: before.selection.start + data.length,
          end: before.selection.start + data.length,
        });
        expect(documentOwner.getHistoryState().undoDepth).toBe(
          before.history.undoDepth + 1,
        );
        throwIfAborted();
        mark("composition:end");
      };
      // This draft is in the deleted frame's old DOM, not its new canonical caret.
      await compose("中", false);
      history(false, true);
      expect(documentOwner.getValue()).toBe(removed);
      const insertion = documentOwner.getSelection().start;
      for (const data of ["Z", "X"]) {
        act(() => {
          const event = new InputEvent("beforeinput", {
            bubbles: true,
            cancelable: true,
            inputType: "insertText",
            data,
          });
          const target = window.getSelection()?.getRangeAt(0).cloneRange();
          if (!target) throw new Error("window-cadence-pending-target-missing");
          Object.defineProperty(event, "getTargetRanges", {
            value: () => [target],
          });
          current.surface.dispatchEvent(event);
          expect(event.defaultPrevented).toBe(true);
          current.surface.dispatchEvent(
            new InputEvent("input", {
              bubbles: true,
              inputType: "insertText",
              data,
            }),
          );
        });
      }
      const typed = `${removed.slice(0, insertion)}ZX${removed.slice(insertion)}`;
      expect(status).toBe("loading");
      expect(documentOwner.getValue()).toBe(typed);
      await acceptResponses();
      expect(documentOwner.getValue()).toBe(typed);
      expect(status).toBe("ready");
      history(false, true);
      history(false, false);
      expect(documentOwner.getValue()).toBe(removed);
      // A real late Preview replaces the IME draft before its final data arrives.
      await compose("文", true);
      const afterLateComposition = captureHistory();
      act(() => {
        const event = new InputEvent("beforeinput", {
          bubbles: true,
          cancelable: true,
          inputType: "insertText",
          data: "Q",
        });
        const target = window.getSelection()?.getRangeAt(0).cloneRange();
        if (!target) throw new Error("window-cadence-after-ime-range-missing");
        Object.defineProperty(event, "getTargetRanges", {
          value: () => [target],
        });
        current.surface.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
      });
      expect(documentOwner.getValue()).toBe(
        `${afterLateComposition.value.slice(0, afterLateComposition.selection.start)}Q${afterLateComposition.value.slice(afterLateComposition.selection.end)}`,
      );
      history(false, true);
      expect(documentOwner.getValue()).toBe(afterLateComposition.value);
      history(false, true);
      expect(documentOwner.getValue()).toBe(removed);
      history(false, false);
      expect(documentOwner.getValue()).toBe(expected);
      await acceptResponses();
      expect(documentOwner.getValue()).toBe(expected);
      history(true, true);
      expect(documentOwner.getValue()).toBe(removed);
      document.body.append(outsideButton);
      outsideButton.focus();
      await acceptResponses();
      expect(document.activeElement).toBe(outsideButton);
      outsideButton.remove();
      current.surface.focus();

      const undoStates = [captureHistory()];
      mark("undo:start");
      throwIfAborted();
      for (
        let count = 0;
        count < 64 && documentOwner.getValue() !== initialMarkdown;
        count += 1
      ) {
        throwIfAborted();
        history(false, count % 2 === 0);
        expect(documentOwner.getValue()).not.toBe(undoStates.at(-1)?.value);
        undoStates.push(captureHistory());
      }
      mark("undo:end");
      throwIfAborted();
      expect(documentOwner.getValue()).toBe(initialMarkdown);
      await acceptResponses();
      expect(documentOwner.getValue()).toBe(initialMarkdown);
      expect(captureHistory()).toEqual(undoStates.at(-1));
      expect(documentOwner.getSelection()).toEqual({
        direction: "none",
        start: initialCaret,
        end: initialCaret,
      });
      const restoredCode = codeAt("b1");
      const restoredSelection = window.getSelection();
      if (!restoredSelection?.anchorNode)
        throw new Error("window-cadence-restored-caret-missing");
      expect(restoredSelection.anchorNode.isConnected).toBe(true);
      expect(restoredCode.contains(restoredSelection.anchorNode)).toBe(true);
      const caretRange = document.createRange();
      caretRange.selectNodeContents(restoredCode);
      caretRange.setEnd(
        restoredSelection.anchorNode,
        restoredSelection.anchorOffset,
      );
      expect(caretRange.toString().length).toBe(40);
      expect(status).toBe("ready");
      expect(current.surface.querySelectorAll("pre")).toHaveLength(2);
      mark("redo:start");
      throwIfAborted();
      for (const [index, state] of undoStates
        .slice(0, -1)
        .reverse()
        .entries()) {
        throwIfAborted();
        history(true, index % 2 !== 0);
        expect(documentOwner.getValue()).toBe(state.value);
        expect(documentOwner.getHistoryState()).toEqual(state.history);
        // A later deliberate caret move is the next edit's before-selection,
        // not the preceding edit's committed selection restored by Redo.
        expect(documentOwner.getSelection()).toEqual(
          committedSelections.get(state.value),
        );
      }
      mark("redo:end");
      await acceptResponses();
      throwIfAborted();
      expect(documentOwner.getValue()).toBe(removed);
      expect(captureHistory()).toEqual(undoStates[0]);
      expect(window.getSelection()?.anchorNode?.isConnected).toBe(true);
      expect(status).toBe("ready");
      expect(current.surface.querySelectorAll("pre")).toHaveLength(1);
      expect(onFailure).not.toHaveBeenCalled();
      expect(onDiagnostic).not.toHaveBeenCalled();
      expect(onTransferFailure).not.toHaveBeenCalled();
      mark("handler-completed");
    } finally {
      if (probe) {
        probe.finallyEntered = true;
        mark("finally-entered");
      }
      let cleanupSucceeded = false;
      try {
        updateVisual = null;
        view?.unmount();
        current.unmount();
        documentOwner.destroy();
        container.remove();
        menuButton.remove();
        outsideButton.remove();
        submissionField.remove();
        rectSpy.mockRestore();
        cleanupSucceeded = true;
      } finally {
        try {
          if (probe && cleanupSucceeded) {
            probe.finallyCompleted = true;
            mark("finally-completed");
          }
        } finally {
          resolveCleanup();
        }
      }
    }
  };

  // Measured isolated workload: normal same-chain 9322ms, 40 edits 2810ms,
  // all Undo 1029ms, all Redo 1037ms, and 97/97 responses completed. 20s is
  // only this workload's runner cap, not a product/performance change.
  it("keeps exact local code edits and pending real history across Preview window cadence (code history)", async () => {
    await runPreviewWindowCadence("code history");
  }, 20_000);

  it.each(["empty fence gap", "empty fence gap composition"] as const)(
    "keeps exact local code edits and pending real history across Preview window cadence (%s)",
    async (scenario) => {
      await runPreviewWindowCadence(scenario);
    },
    10_000,
  );

  it("certifies list- and blockquote-nested fence metadata in one accepted window transaction", async () => {
    const fixture = nestedFenceWindowFixture(200, "nested-fence-window", {
      list: 1,
      quote: 2,
    });
    const {
      container,
      owner,
      session: documentSession,
      submissionField,
    } = markdownDocumentSource(fixture.markdown);
    const getRevision = owner.getRevision;
    if (!getRevision) throw new Error("nested-fence-revision-owner-missing");
    let scrollCanvas: HTMLElement | null = null;
    const nativeRect = HTMLElement.prototype.getBoundingClientRect;
    const rectSpy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        if (this.classList.contains("easymde-immersive-preview-canvas"))
          return previewRect(0, 240);
        if ("ARTICLE" === this.tagName)
          return previewRect(-(scrollCanvas?.scrollTop ?? 0), 200 * 24);
        const id = this.getAttribute("data-easymde-visual-block-id");
        return id?.startsWith("b")
          ? previewRect(
              Number.parseInt(id.slice(1), 10) * 24 -
                (scrollCanvas?.scrollTop ?? 0),
              24,
            )
          : nativeRect.call(this);
      });
    let generation = 0;
    let snapshot: {
      editMap: PreviewEditMap;
      revision: number;
      signature: string;
    } = {
      editMap: fixture.editMap,
      revision: 1,
      signature: fixture.editMap.signature,
    };
    let status: PreviewSurfaceStatus = "loading";
    let updateVisual: (() => void) | null = null;
    const onFailure = vi.fn();
    const onDiagnostic = vi.fn();
    const onTransferFailure = vi.fn();
    const current = setup({
      contentEditable: true,
      currentSourceSnapshot: () => ({
        revision: getRevision(),
        value: owner.getValue(),
      }),
      initialEditMap: fixture.editMap,
      initialHtml: fixture.html,
      initialSignature: fixture.editMap.signature,
      onDiagnostic,
      onSnapshotReady: (_html, signature, editMap) => {
        if (!editMap) throw new Error("nested-fence-edit-map-missing");
        snapshot = { editMap, revision: snapshot.revision + 1, signature };
        updateVisual?.();
      },
      onStatusChange: (next) => {
        status = next;
        updateVisual?.();
      },
      onWindowReady: () => {
        generation += 1;
        updateVisual?.();
      },
      sourceRevision: getRevision(),
      stagingScheduler: { yield: () => Promise.resolve() },
      windowed: true,
    });
    scrollCanvas = current.canvas;
    Object.defineProperty(current.canvas, "clientHeight", {
      configurable: true,
      value: 240,
    });
    const settleWindow = async (minimumGeneration: number) => {
      await act(async () => {
        for (let index = 0; index < 16; index += 1) await Promise.resolve();
      });
      for (let frame = 0; frame < 16; frame += 1) {
        await act(async () => {
          await flushAnimationFrames(1);
        });
        if (
          generation >= minimumGeneration &&
          "ready" === status &&
          current.runtime.getAcceptedWindowSnapshot()
        )
          return;
      }
      throw new Error("nested-fence-window-settle-timeout");
    };
    let view: RenderResult | null = null;
    try {
      current.canvas.dispatchEvent(new Event("scroll"));
      await settleWindow(1);
      let visualRuntime: ImmersiveVisualEditorRuntime | null = null;
      const requestPreview = vi.fn((_markdown?: string) => "next");
      const props = {
        documentSession,
        imagePasteUploadEnabled: false,
        imageUploadEnabled: false,
        onCanonicalDocumentChange: vi.fn(),
        onDiagnostic,
        onDispose: vi.fn(),
        onFailure,
        onMarkdownChange: vi.fn(),
        onPendingChange: vi.fn(),
        onReady: (runtime: ImmersiveVisualEditorRuntime) => {
          visualRuntime = runtime;
        },
        onTransferFailure,
        pending: false,
        prepareWindowBlockAdoption: current.runtime.prepareWindowBlockAdoption,
        retainCompositionSurface: () =>
          current.runtime.retainCompositionSurface(),
        requestPreview,
        requestPreviewAtDocumentEnd: (markdown: string) => ({
          release: vi.fn(),
          signature: requestPreview(markdown),
        }),
        getAcceptedWindowSnapshot: current.runtime.getAcceptedWindowSnapshot,
        surface: current.surface,
      };
      const visual = () => (
        <WindowedImmersiveVisualEditor
          referenceLabelCaseFoldProfile={14}
          {...props}
          acceptedWindowSnapshotGeneration={generation}
          editMap={snapshot.editMap}
          previewSnapshot={snapshot}
          previewStatus={status}
        />
      );
      view = render(visual());
      updateVisual = () =>
        queueMicrotask(() => {
          if (updateVisual) view?.rerender(visual());
        });
      const mountedRoot = (id: string): HTMLElement => {
        const root = current.surface.querySelector<HTMLElement>(
          `[data-easymde-visual-block-id="${id}"]`,
        );
        if (!root) throw new Error(`nested-fence-root-missing:${id}`);
        return root;
      };
      const acceptedCertificate = () => {
        const accepted = current.runtime.getAcceptedWindowSnapshot();
        expect(accepted).not.toBeNull();
        // The certificate and the mounted DOM must describe one normalized
        // transaction, including metadata nested inside a container root.
        for (const block of accepted?.blocks ?? [])
          expect(block.innerHTML).toBe(block.node.innerHTML);
        return accepted;
      };
      const navigate = () => {
        if (!visualRuntime) throw new Error("nested-fence-runtime-missing");
        return (
          visualRuntime as ImmersiveVisualEditorRuntime
        ).prepareSourceNavigation({
          revision: getRevision(),
          value: owner.getValue(),
        });
      };
      const initial = acceptedCertificate();
      const initialList = initial?.blocks.find((block) => "b1" === block.id);
      expect(initialList?.innerHTML).toContain(
        'data-easymde-visual-fence="~~~"',
      );
      expect(initialList?.innerHTML).toContain(
        'data-easymde-visual-fence-info="js"',
      );
      const initialQuote = initial?.blocks.find((block) => "b2" === block.id);
      expect(initialQuote?.innerHTML).toContain(
        'data-easymde-visual-fence="```"',
      );
      expect(initialQuote?.innerHTML).toContain(
        'data-easymde-visual-fence-info="bash linenos"',
      );
      const firstListMarkup = mountedRoot("b1").innerHTML;
      const firstQuoteMarkup = mountedRoot("b2").innerHTML;
      expect(firstListMarkup).toContain('data-easymde-visual-fence-info="js"');
      expect(firstQuoteMarkup).toContain(
        'data-easymde-visual-fence-info="bash linenos"',
      );
      const canonicalBefore = {
        history: owner.getHistoryState(),
        revision: getRevision(),
        selection: owner.getSelection(),
        value: owner.getValue(),
      };
      expect(navigate()).toBe(true);
      expect({
        history: owner.getHistoryState(),
        revision: getRevision(),
        selection: owner.getSelection(),
        value: owner.getValue(),
      }).toEqual(canonicalBefore);

      // A ready-to-ready window replacement leaves the nested fences
      // unmounted, then a second replacement mounts them again.
      current.canvas.scrollTop = 60 * 24;
      current.canvas.dispatchEvent(new Event("scroll"));
      await settleWindow(generation + 1);
      expect(
        current.surface.querySelector('[data-easymde-visual-block-id="b1"]'),
      ).toBeNull();
      acceptedCertificate();
      expect(navigate()).toBe(true);
      current.canvas.scrollTop = 0;
      current.canvas.dispatchEvent(new Event("scroll"));
      await settleWindow(generation + 1);
      acceptedCertificate();
      expect(mountedRoot("b1").innerHTML).toBe(firstListMarkup);
      expect(mountedRoot("b2").innerHTML).toBe(firstQuoteMarkup);
      expect(navigate()).toBe(true);
      expect({
        history: owner.getHistoryState(),
        revision: getRevision(),
        selection: owner.getSelection(),
        value: owner.getValue(),
      }).toEqual(canonicalBefore);

      // A remount re-registers the same accepted transaction.
      view.unmount();
      view = render(visual());
      updateVisual = () =>
        queueMicrotask(() => {
          if (updateVisual) view?.rerender(visual());
        });
      await act(async () => {
        await flushAnimationFrames(1);
      });
      expect(navigate()).toBe(true);
      current.canvas.scrollTop = 80 * 24;
      current.canvas.dispatchEvent(new Event("scroll"));
      await settleWindow(generation + 1);
      acceptedCertificate();
      expect(navigate()).toBe(true);
      expect({
        history: owner.getHistoryState(),
        revision: getRevision(),
        selection: owner.getSelection(),
        value: owner.getValue(),
      }).toEqual(canonicalBefore);

      // A non-derived DOM mutation is still a stale accepted window.
      current.canvas.scrollTop = 0;
      current.canvas.dispatchEvent(new Event("scroll"));
      await settleWindow(generation + 1);
      acceptedCertificate();
      const item = mountedRoot("b1").querySelector("li > p");
      if (!(item instanceof HTMLElement))
        throw new Error("nested-fence-list-item-missing");
      item.textContent = "Foreign";
      expect(navigate()).toBe(false);
      expect(onFailure).toHaveBeenCalledWith(
        "visual-editor-window-source-navigation-dom-stale",
      );
    } finally {
      updateVisual = null;
      view?.unmount();
      current.unmount();
      owner.destroy();
      container.remove();
      submissionField.remove();
      rectSpy.mockRestore();
    }
  });

  it("normalizes nested fence metadata before reactivating a materialized ready surface", async () => {
    const geometry = installSequenceGeometry();
    const fixture = nestedFenceWindowFixture(200, "nested-fence-materialized", {
      list: 40,
      quote: 41,
    });
    const {
      container,
      owner,
      session: documentSession,
      submissionField,
    } = markdownDocumentSource(fixture.markdown);
    const getRevision = owner.getRevision;
    if (!getRevision) throw new Error("nested-fence-revision-owner-missing");
    let generation = 0;
    let status: PreviewSurfaceStatus = "loading";
    let updateVisual: (() => void) | null = null;
    const onFailure = vi.fn();
    const onDiagnostic = vi.fn();
    const current = setup({
      contentEditable: true,
      currentSourceSnapshot: () => ({
        revision: getRevision(),
        value: owner.getValue(),
      }),
      initialHtml: "",
      onDiagnostic,
      onStatusChange: (next) => {
        status = next;
        updateVisual?.();
      },
      onWindowReady: () => {
        generation += 1;
        updateVisual?.();
      },
      sourceRevision: getRevision(),
      stagingScheduler: { yield: () => Promise.resolve() },
      windowed: false,
    });
    geometry.attach(current.canvas, current.surface);
    Object.defineProperty(current.canvas, "clientHeight", {
      configurable: true,
      value: 240,
    });
    const settleWindow = async (minimumGeneration: number) => {
      await act(async () => {
        for (let index = 0; index < 16; index += 1) await Promise.resolve();
      });
      for (let frame = 0; frame < 16; frame += 1) {
        await act(async () => {
          await flushAnimationFrames(1);
        });
        if (
          generation >= minimumGeneration &&
          "ready" === status &&
          current.runtime.getAcceptedWindowSnapshot()
        )
          return;
      }
      throw new Error("nested-fence-window-settle-timeout");
    };
    let visualRuntime: ImmersiveVisualEditorRuntime | null = null;
    const requestPreview = vi.fn((_markdown?: string) => "next");
    const props = {
      documentSession,
      imagePasteUploadEnabled: false,
      imageUploadEnabled: false,
      onCanonicalDocumentChange: vi.fn(),
      onDiagnostic,
      onDispose: vi.fn(),
      onFailure,
      onMarkdownChange: vi.fn(),
      onPendingChange: vi.fn(),
      onReady: (runtime: ImmersiveVisualEditorRuntime) => {
        visualRuntime = runtime;
      },
      onTransferFailure: vi.fn(),
      pending: false,
      prepareWindowBlockAdoption: current.runtime.prepareWindowBlockAdoption,
      retainCompositionSurface: () =>
        current.runtime.retainCompositionSurface(),
      requestPreview,
      requestPreviewAtDocumentEnd: (markdown: string) => ({
        release: vi.fn(),
        signature: requestPreview(markdown),
      }),
      getAcceptedWindowSnapshot: current.runtime.getAcceptedWindowSnapshot,
      surface: current.surface,
    };
    const previewSnapshot = {
      editMap: fixture.editMap,
      revision: 1,
      signature: fixture.editMap.signature,
    };
    const visual = () => (
      <WindowedImmersiveVisualEditor
        referenceLabelCaseFoldProfile={14}
        {...props}
        acceptedWindowSnapshotGeneration={generation}
        editMap={previewSnapshot.editMap}
        previewSnapshot={previewSnapshot}
        previewStatus={status}
      />
    );
    try {
      act(() => {
        current.session.schedule(
          request(fixture.markdown, fixture.editMap.signature),
          true,
        );
      });
      await act(async () => {
        current.responses[0]?.resolve({
          editMap: fixture.editMap,
          features: {},
          html: fixture.html,
        });
        for (let index = 0; index < 32; index += 1) await Promise.resolve();
        await flushAnimationFrames(4);
      });
      expect(current.surface.children).toHaveLength(200);
      expect(current.runtime.getAcceptedWindowSnapshot()).toBeNull();

      // Reactivating the same ready surface installs a bounded window over
      // the already materialized DOM, which is where the accepted baseline
      // is captured for every repository root.
      current.setWindowed(true);
      await settleWindow(1);
      const view = render(visual());
      updateVisual = () => queueMicrotask(() => view.rerender(visual()));
      const mountedRoot = (id: string): HTMLElement => {
        const root = current.surface.querySelector<HTMLElement>(
          `[data-easymde-visual-block-id="${id}"]`,
        );
        if (!root) throw new Error(`nested-fence-root-missing:${id}`);
        return root;
      };
      const acceptedCertificate = () => {
        const accepted = current.runtime.getAcceptedWindowSnapshot();
        expect(accepted).not.toBeNull();
        for (const block of accepted?.blocks ?? [])
          expect(block.innerHTML).toBe(block.node.innerHTML);
        return accepted;
      };
      acceptedCertificate();

      current.canvas.scrollTop = 40 * 24;
      current.canvas.dispatchEvent(new Event("scroll"));
      await settleWindow(generation + 1);
      const accepted = acceptedCertificate();
      const listEntry = accepted?.blocks.find((block) => "b40" === block.id);
      expect(listEntry?.innerHTML).toContain('data-easymde-visual-fence="~~~"');
      expect(listEntry?.innerHTML).toContain(
        'data-easymde-visual-fence-info="js"',
      );
      const quoteEntry = accepted?.blocks.find((block) => "b41" === block.id);
      expect(quoteEntry?.innerHTML).toContain(
        'data-easymde-visual-fence="```"',
      );
      expect(quoteEntry?.innerHTML).toContain(
        'data-easymde-visual-fence-info="bash linenos"',
      );
      const listMarkup = mountedRoot("b40").innerHTML;
      expect(listMarkup).toContain('data-easymde-visual-fence-info="js"');
      const canonicalBefore = {
        history: owner.getHistoryState(),
        revision: getRevision(),
        value: owner.getValue(),
      };
      if (!visualRuntime) throw new Error("nested-fence-runtime-missing");
      expect(
        (visualRuntime as ImmersiveVisualEditorRuntime).prepareSourceNavigation(
          {
            revision: getRevision(),
            value: owner.getValue(),
          },
        ),
      ).toBe(true);
      expect({
        history: owner.getHistoryState(),
        revision: getRevision(),
        value: owner.getValue(),
      }).toEqual(canonicalBefore);

      // Repeated commits reuse the one normalized baseline: the metadata is
      // exact and byte-identical rather than accumulated.
      current.canvas.scrollTop = 0;
      current.canvas.dispatchEvent(new Event("scroll"));
      await settleWindow(generation + 1);
      acceptedCertificate();
      current.canvas.scrollTop = 40 * 24;
      current.canvas.dispatchEvent(new Event("scroll"));
      await settleWindow(generation + 1);
      acceptedCertificate();
      expect(mountedRoot("b40").innerHTML).toBe(listMarkup);
      view.unmount();
      current.unmount();
    } finally {
      updateVisual = null;
      geometry.restore();
      owner.destroy();
      container.remove();
      submissionField.remove();
    }
  });

  it("reports verified Preview image load and error readiness", async () => {
    const onImageReadinessChange = vi.fn();
    const current = setup({
      initialHtml: '<p><img src="https://img.test/ready.png"></p>',
      onImageReadinessChange,
    });
    await act(async () => {
      for (let index = 0; index < 16; index += 1) await Promise.resolve();
      await flushAnimationFrames(6);
    });
    const image = current.surface.querySelector("img");
    if (!(image instanceof HTMLImageElement)) throw new Error("image-missing");
    expect(onImageReadinessChange).not.toHaveBeenCalled();
    image.dispatchEvent(new Event("load"));
    image.dispatchEvent(new Event("error"));
    expect(onImageReadinessChange).toHaveBeenCalledTimes(2);
    current.unmount();
  });

  it("removes Preview image readiness listeners on teardown", async () => {
    const onImageReadinessChange = vi.fn();
    const current = setup({
      initialHtml: '<p><img src="https://img.test/teardown.png"></p>',
      onImageReadinessChange,
    });
    await act(async () => {
      for (let index = 0; index < 16; index += 1) await Promise.resolve();
      await flushAnimationFrames(6);
    });
    const image = current.surface.querySelector("img");
    if (!(image instanceof HTMLImageElement)) throw new Error("image-missing");
    current.unmount();
    image.dispatchEvent(new Event("load"));
    image.dispatchEvent(new Event("error"));
    expect(onImageReadinessChange).not.toHaveBeenCalled();
  });

  it("ignores image readiness events from a stale Preview generation", async () => {
    const onImageReadinessChange = vi.fn();
    const current = setup({
      initialHtml: '<p><img src="https://img.test/first.png"></p>',
      onImageReadinessChange,
    });
    await act(async () => {
      for (let index = 0; index < 16; index += 1) await Promise.resolve();
      await flushAnimationFrames(6);
    });
    const staleImage = current.surface.querySelector("img");
    if (!(staleImage instanceof HTMLImageElement))
      throw new Error("image-missing");
    act(() => current.session.schedule(request("next", "next-image"), true));
    current.responses[0]?.resolve({
      features: {},
      html: safeHtml('<p><img src="https://img.test/second.png"></p>'),
    });
    await act(async () => {
      for (let index = 0; index < 24; index += 1) await Promise.resolve();
      await flushAnimationFrames(8);
    });
    const nextImage = current.surface.querySelector("img");
    if (!(nextImage instanceof HTMLImageElement))
      throw new Error("next-image-missing");
    staleImage.dispatchEvent(new Event("load"));
    expect(onImageReadinessChange).not.toHaveBeenCalled();
    nextImage.dispatchEvent(new Event("load"));
    expect(onImageReadinessChange).toHaveBeenCalledTimes(1);
    current.unmount();
  });

  it("leases only the accepted current generated math root and releases it safely", async () => {
    const source = "$x$";
    const signature = "generated-math-initial";
    let currentSource = source;
    let currentRevision = 41;
    const current = setup({
      contentEditable: true,
      currentSourceSnapshot: () => ({
        revision: currentRevision,
        value: currentSource,
      }),
      initialHtml: "<p>Initial preview</p>",
      initialSignature: signature,
      sourceRevision: 41,
    });
    await act(async () => {
      for (let index = 0; index < 16; index += 1) await Promise.resolve();
      await flushAnimationFrames(4);
    });
    act(() => {
      current.session.schedule(request(source, signature), true);
    });
    expect(current.responses).toHaveLength(1);
    current.responses[0]?.resolve({
      features: {},
      editMap: {
        version: 1,
        coordinate: "line",
        signature,
        blocks: [
          {
            editable: true,
            endLine: 1,
            id: "b0",
            startLine: 0,
          },
        ],
      },
      html: safeHtml(
        '<p data-easymde-visual-block-id="b0">' +
          '<span class="easymde-math">' +
          '<span class="katex-mathml"><math><mi>x</mi></math></span>' +
          "</span></p>",
      ),
    });
    await act(async () => {
      for (let index = 0; index < 16; index += 1) await Promise.resolve();
      await flushAnimationFrames(6);
    });
    expect(current.surface.easymdePreviewSignature).toBe(signature);

    const math = current.surface.querySelector(".easymde-math");
    expect(math).toBeInstanceOf(HTMLElement);
    if (!(math instanceof HTMLElement)) throw new Error("math-root-missing");
    const sourceIndex: PreviewGeneratedContentTargetIndex = {
      blocks: [
        {
          editable: true,
          from: 0,
          kind: "math",
          lineEnd: 0,
          lineStart: 0,
          to: 3,
        },
      ],
      length: source.length,
      mathSpans: [
        {
          bodyFrom: 1,
          bodyTo: 2,
          displayMode: false,
          from: 0,
          to: 3,
        },
      ],
      revision: 41,
      source,
    };

    const lease = current.runtime.prepareGeneratedContentTarget({
      element: math,
      index: sourceIndex,
      kind: "math",
      ordinal: 0,
    });
    expect(current.runtime.getGeneratedPreviewIdentity()).toMatchObject({
      revision: 2,
      signature,
      sourceRevision: 41,
    });
    expect(lease?.root).toBe(math);
    expect(lease?.isCurrent()).toBe(true);

    const staleLease = current.runtime.prepareGeneratedContentTarget({
      element: math,
      index: sourceIndex,
      kind: "math",
      ordinal: 0,
    });
    expect(staleLease?.isCurrent()).toBe(true);
    if (!staleLease) throw new Error("stale-lease-missing");
    currentSource = "changed";
    expect(current.runtime.getGeneratedPreviewIdentity()).toBeNull();
    expect(
      current.runtime.prepareGeneratedContentTarget({
        element: math,
        index: sourceIndex,
        kind: "math",
        ordinal: 0,
      }),
    ).toBeNull();
    currentRevision = 42;
    expect(staleLease.isCurrent()).toBe(false);
    currentSource = source;
    currentRevision = 41;
    await act(async () => {
      current.session.schedule(request("next", "next-signature"), true);
      await Promise.resolve();
    });
    expect(staleLease?.isCurrent()).toBe(false);

    const wrongOrdinal = current.runtime.prepareGeneratedContentTarget({
      element: math,
      index: sourceIndex,
      kind: "math",
      ordinal: 1,
    });
    expect(wrongOrdinal).toBeNull();

    lease?.release();
    expect(lease?.isCurrent()).toBe(false);
    current.unmount();
    expect(staleLease?.isCurrent()).toBe(false);
    expect(current.runtime.getGeneratedPreviewIdentity()).toBeNull();
  });

  it("rejects a duplicate math root whose DOM ordinal does not match its source span", async () => {
    const source = "$a$ and $b$";
    const signature = "generated-math-duplicates";
    const current = setup({
      contentEditable: true,
      currentSourceSnapshot: () => ({ revision: 9, value: source }),
      initialHtml: "<p>Initial preview</p>",
      initialSignature: signature,
      sourceRevision: 9,
    });
    await act(async () => {
      for (let index = 0; index < 16; index += 1) await Promise.resolve();
      await flushAnimationFrames(4);
    });
    current.session.schedule(request(source, signature), true);
    current.responses[0]?.resolve({
      features: {},
      editMap: {
        version: 1,
        coordinate: "line",
        signature,
        blocks: [
          {
            editable: true,
            endLine: 1,
            id: "b0",
            startLine: 0,
          },
        ],
      },
      html: safeHtml(
        '<p data-easymde-visual-block-id="b0">' +
          '<span class="easymde-math"><span class="katex-mathml">' +
          "<math><mi>a</mi></math></span></span>" +
          '<span class="easymde-math"><span class="katex-mathml">' +
          "<math><mi>b</mi></math></span></span></p>",
      ),
    });
    await act(async () => {
      for (let index = 0; index < 16; index += 1) await Promise.resolve();
      await flushAnimationFrames(6);
    });
    const roots = Array.from(
      current.surface.querySelectorAll<HTMLElement>(".easymde-math"),
    );
    expect(roots).toHaveLength(2);
    const sourceIndex: PreviewGeneratedContentTargetIndex = {
      blocks: [
        {
          editable: true,
          from: 0,
          kind: "paragraph",
          lineEnd: 0,
          lineStart: 0,
          to: source.length,
        },
      ],
      length: source.length,
      mathSpans: [
        { bodyFrom: 1, bodyTo: 2, displayMode: false, from: 0, to: 3 },
        { bodyFrom: 9, bodyTo: 10, displayMode: false, from: 8, to: 11 },
      ],
      revision: 9,
      source,
    };
    expect(
      current.runtime.prepareGeneratedContentTarget({
        element: roots[0] as HTMLElement,
        index: sourceIndex,
        kind: "math",
        ordinal: 1,
      }),
    ).toBeNull();
    const secondLease = current.runtime.prepareGeneratedContentTarget({
      element: roots[1] as HTMLElement,
      index: sourceIndex,
      kind: "math",
      ordinal: 1,
    });
    expect(secondLease?.isCurrent()).toBe(true);
    const replacement = roots[1]?.cloneNode(true);
    if (!(replacement instanceof HTMLElement)) {
      throw new Error("generated-root-replacement-missing");
    }
    roots[1]?.replaceWith(replacement);
    expect(secondLease?.isCurrent()).toBe(false);
    current.unmount();
  });

  it("does not accept a rendered candidate after the canonical source changes", async () => {
    const source = "$x$";
    const signature = "generated-math-late-commit";
    let currentSource = source;
    const current = setup({
      contentEditable: true,
      currentSourceSnapshot: () => ({ revision: 17, value: currentSource }),
      initialHtml: "<p>Initial preview</p>",
      initialSignature: signature,
      sourceRevision: 17,
    });
    await act(async () => {
      for (let index = 0; index < 16; index += 1) await Promise.resolve();
      await flushAnimationFrames(4);
    });
    current.session.schedule(request(source, signature), true);
    currentSource = "changed";
    current.responses[0]?.resolve({
      features: {},
      editMap: {
        version: 1,
        coordinate: "line",
        signature,
        blocks: [{ editable: true, endLine: 1, id: "b0", startLine: 0 }],
      },
      html: safeHtml(
        '<p data-easymde-visual-block-id="b0">' +
          '<span class="easymde-math"><span class="katex-mathml">' +
          "<math><mi>x</mi></math></span></span></p>",
      ),
    });
    await act(async () => {
      for (let index = 0; index < 16; index += 1) await Promise.resolve();
      await flushAnimationFrames(6);
    });
    expect(current.runtime.getGeneratedPreviewIdentity()).toBeNull();
    current.unmount();
  });

  it("mints a Mermaid target for a visual block that is itself the generated root", async () => {
    const source = "```mermaid\r\nA-->B\r\n```";
    const signature = "generated-mermaid-root";
    const current = setup({
      contentEditable: true,
      currentSourceSnapshot: () => ({ revision: 23, value: source }),
      initialHtml: "<p>Initial preview</p>",
      initialSignature: signature,
      sourceRevision: 23,
    });
    await act(async () => {
      for (let index = 0; index < 16; index += 1) await Promise.resolve();
      await flushAnimationFrames(4);
    });
    current.session.schedule(request(source, signature), true);
    current.responses[0]?.resolve({
      features: {},
      editMap: {
        version: 1,
        coordinate: "line",
        signature,
        blocks: [
          {
            editable: true,
            endLine: 3,
            id: "b0",
            startLine: 0,
          },
        ],
      },
      html: safeHtml(
        '<div data-easymde-visual-block-id="b0" ' +
          'class="easymde-mermaid"><svg></svg></div>',
      ),
    });
    await act(async () => {
      for (let index = 0; index < 16; index += 1) await Promise.resolve();
      await flushAnimationFrames(6);
    });
    const mermaid = current.surface.querySelector(".easymde-mermaid");
    expect(mermaid).toBeInstanceOf(HTMLElement);
    if (!(mermaid instanceof HTMLElement)) {
      throw new Error("mermaid-root-missing");
    }
    const index: PreviewGeneratedContentTargetIndex = {
      blocks: [
        {
          editable: true,
          from: 0,
          kind: "code",
          lineEnd: 2,
          lineStart: 0,
          to: source.length,
        },
      ],
      length: source.length,
      mathSpans: [],
      revision: 23,
      source,
    };
    const lease = current.runtime.prepareGeneratedContentTarget({
      element: mermaid,
      index,
      kind: "mermaid",
      ordinal: 0,
    });
    expect(lease?.isCurrent()).toBe(true);
    expect(lease?.target.original).toEqual({
      body: "A-->B\r\n",
      bodyRange: { from: 12, to: 19 },
      full: source,
      fullRange: { from: 0, to: source.length },
    });
    current.unmount();
  });

  it("mints a standalone math block root from the indexed display span", async () => {
    const source = "$$x$$";
    const signature = "generated-math-block-root";
    const current = setup({
      contentEditable: true,
      currentSourceSnapshot: () => ({ revision: 24, value: source }),
      initialHtml: "<p>Initial preview</p>",
      initialSignature: signature,
      sourceRevision: 24,
    });
    await act(async () => {
      for (let index = 0; index < 16; index += 1) await Promise.resolve();
      await flushAnimationFrames(4);
    });
    act(() => {
      current.session.schedule(request(source, signature), true);
    });
    expect(current.responses).toHaveLength(1);
    await act(async () => {
      current.responses[0]?.resolve({
        editMap: {
          version: 1,
          coordinate: "line",
          signature,
          blocks: [{ editable: true, endLine: 1, id: "b0", startLine: 0 }],
        },
        features: {},
        html: safeHtml(
          '<div data-easymde-visual-block-id="b0" ' +
            'class="easymde-math"><span class="katex-mathml">' +
            "<math><mi>x</mi></math></span></div>",
        ),
      });
      for (let index = 0; index < 16; index += 1) await Promise.resolve();
      await flushAnimationFrames(6);
    });
    const root = current.surface.querySelector(".easymde-math");
    if (!(root instanceof HTMLElement))
      throw new Error("math-block-root-missing");
    const index: PreviewGeneratedContentTargetIndex = {
      blocks: [
        {
          editable: true,
          from: 0,
          kind: "math",
          lineEnd: 0,
          lineStart: 0,
          to: source.length,
        },
      ],
      length: source.length,
      mathSpans: [
        {
          bodyFrom: 2,
          bodyTo: 3,
          displayMode: true,
          from: 0,
          to: source.length,
        },
      ],
      revision: 24,
      source,
    };
    const lease = current.runtime.prepareGeneratedContentTarget({
      element: root,
      index,
      kind: "math",
      ordinal: 0,
    });
    expect(lease?.isCurrent()).toBe(true);
    const selectionPin =
      current.runtime.prepareGeneratedContentTargetForSelection({
        index,
        selection: { end: source.length, start: 0 },
      });
    expect(selectionPin?.target.kind).toBe("math");
    expect(selectionPin?.target.ordinal).toBe(0);
    expect(selectionPin?.getLease()?.root).toBe(root);
    selectionPin?.release();
    current.unmount();
  });

  it("looks up a dense math selection from the sorted index without minting every span", async () => {
    const source = Array.from({ length: 100 }, () => "$x$").join(" ");
    const signature = "generated-dense-selection";
    const parsed = createEditorMarkdownBlockIndex(source);
    const current = setup({
      contentEditable: true,
      currentSourceSnapshot: () => ({ revision: 25, value: source }),
      initialHtml: "<p>Initial preview</p>",
      initialSignature: signature,
      sourceRevision: 25,
    });
    await act(async () => {
      for (let index = 0; index < 16; index += 1) await Promise.resolve();
      await flushAnimationFrames(4);
    });
    act(() => {
      current.session.schedule(request(source, signature), true);
    });
    expect(current.responses).toHaveLength(1);
    await act(async () => {
      current.responses[0]?.resolve({
        editMap: {
          version: 1,
          coordinate: "line",
          signature,
          blocks: [{ editable: true, endLine: 1, id: "b0", startLine: 0 }],
        },
        features: {},
        html: safeHtml(
          '<p data-easymde-visual-block-id="b0">' +
            Array.from(
              { length: 100 },
              () =>
                '<span class="easymde-math"><span class="katex-mathml">' +
                "<math><mi>x</mi></math></span></span>",
            ).join("") +
            "</p>",
        ),
      });
      for (let index = 0; index < 16; index += 1) await Promise.resolve();
      await flushAnimationFrames(6);
    });
    const mathSpans = parsed.mathSpans;
    const lastSpan = mathSpans[mathSpans.length - 1];
    if (!lastSpan) throw new Error("dense-selection-span-missing");
    const index: PreviewGeneratedContentTargetIndex = {
      blocks: parsed.blocks,
      length: source.length,
      mathSpans,
      revision: 25,
      source,
    };
    const pin = current.runtime.prepareGeneratedContentTargetForSelection({
      index,
      selection: { end: lastSpan.to, start: lastSpan.from },
    });
    expect(pin?.target.kind).toBe("math");
    expect(pin?.target.ordinal).toBe(mathSpans.length - 1);
    expect(pin?.target.original.fullRange).toEqual({
      from: lastSpan.from,
      to: lastSpan.to,
    });
    pin?.release();
    current.unmount();
  });

  it("returns no candidate before checking an active generated pin", async () => {
    const source = "$a$ and $b$";
    const signature = "generated-selection-pin-conflict";
    const parsed = createEditorMarkdownBlockIndex(source);
    const current = setup({
      contentEditable: true,
      currentSourceSnapshot: () => ({ revision: 26, value: source }),
      initialHtml: "<p>Initial preview</p>",
      initialSignature: signature,
      sourceRevision: 26,
      windowed: true,
    });
    await act(async () => {
      for (let index = 0; index < 16; index += 1) await Promise.resolve();
      await flushAnimationFrames(4);
    });
    act(() => {
      current.session.schedule(request(source, signature), true);
    });
    expect(current.responses).toHaveLength(1);
    await act(async () => {
      current.responses[0]?.resolve({
        editMap: {
          version: 1,
          coordinate: "line",
          signature,
          blocks: [{ editable: true, endLine: 1, id: "b0", startLine: 0 }],
        },
        features: {},
        html: safeHtml(
          '<p data-easymde-visual-block-id="b0">' +
            '<span class="easymde-math"><span class="katex-mathml">' +
            "<math><mi>a</mi></math></span></span>" +
            '<span class="easymde-math"><span class="katex-mathml">' +
            "<math><mi>b</mi></math></span></span></p>",
        ),
      });
      for (let index = 0; index < 16; index += 1) await Promise.resolve();
      await flushAnimationFrames(6);
    });
    const firstSpan = parsed.mathSpans[0];
    if (!firstSpan) throw new Error("pin-conflict-span-missing");
    const index: PreviewGeneratedContentTargetIndex = {
      blocks: parsed.blocks,
      length: source.length,
      mathSpans: parsed.mathSpans,
      revision: 26,
      source,
    };
    const activePin = current.runtime.prepareGeneratedContentTargetForSelection(
      {
        index,
        selection: { end: firstSpan.to, start: firstSpan.from },
      },
    );
    expect(activePin).not.toBeNull();
    expect(() =>
      current.runtime.prepareGeneratedContentTargetForSelection({
        index,
        selection: { end: firstSpan.to, start: firstSpan.from },
      }),
    ).toThrow("preview-window-generated-target-pin-already-active");
    expect(
      current.runtime.prepareGeneratedContentTargetForSelection({
        index,
        selection: { end: 0, start: 0 },
      }),
    ).toBeNull();
    activePin?.release();
    current.unmount();
  });

  it("pins one offscreen generated block from source selection without full materialization", async () => {
    const geometry = installSequenceGeometry();
    const blockCount = 320;
    const lines = Array.from({ length: blockCount }, (_, index) =>
      index === blockCount - 1 ? "$a$ and $b$" : `line-${index}`,
    );
    const source = lines.join("\n");
    const signature = "generated-windowed-selection";
    let currentSource = source;
    const statuses: PreviewSurfaceStatus[] = [];
    const current = setup({
      contentEditable: true,
      currentSourceSnapshot: () => ({ revision: 31, value: currentSource }),
      initialHtml: "<p>Initial preview</p>",
      initialSignature: signature,
      onStatusChange: (status) => statuses.push(status),
      sourceRevision: 31,
      stagingScheduler: { yield: () => Promise.resolve() },
      windowed: true,
    });
    geometry.attach(current.canvas, current.surface);
    await act(async () => {
      for (let index = 0; index < 16; index += 1) await Promise.resolve();
      await flushAnimationFrames(4);
    });
    const blocks = Array.from({ length: blockCount }, (_, index) => ({
      editable: true,
      endLine: index + 1,
      id: `b${index}`,
      startLine: index,
    }));
    const html = blocks
      .map(({ id }, index) =>
        index === blockCount - 1
          ? `<p data-easymde-visual-block-id="${id}">` +
            '<span class="easymde-math"><span class="katex-mathml">' +
            "<math><mi>a</mi></math></span></span>" +
            '<span class="easymde-math"><span class="katex-mathml">' +
            "<math><mi>b</mi></math></span></span></p>"
          : `<p data-easymde-visual-block-id="${id}">${id}</p>`,
      )
      .join("");
    act(() => {
      current.session.schedule(request(source, signature), true);
    });
    expect(current.responses).toHaveLength(1);
    await act(async () => {
      current.responses[0]?.resolve({
        editMap: {
          version: 1,
          coordinate: "line",
          signature,
          blocks,
        },
        features: {},
        html: safeHtml(html),
      });
      for (let index = 0; index < 48; index += 1) await Promise.resolve();
      await flushAnimationFrames(30);
    });
    expect(statuses).toContain("ready");
    expect(current.surface.easymdePreviewSignature).toBe(signature);
    expect(
      current.surface.querySelector(
        '[data-easymde-visual-block-id="b319"] .easymde-math',
      ),
    ).toBeNull();
    const firstMathStart = source.lastIndexOf("$a$");
    const mathStart = source.lastIndexOf("$b$");
    const sourceLineStarts: number[] = [];
    let sourceOffset = 0;
    for (const line of lines) {
      sourceLineStarts.push(sourceOffset);
      sourceOffset += line.length + 1;
    }
    const index: PreviewGeneratedContentTargetIndex = {
      blocks: blocks.map((block, blockIndex) => {
        const line = lines[blockIndex];
        const from = sourceLineStarts[blockIndex];
        if (undefined === line || undefined === from) {
          throw new Error("windowed-source-index-line-missing");
        }
        return {
          editable: block.editable,
          from,
          kind: blockIndex === blockCount - 1 ? "math" : "paragraph",
          lineEnd: block.endLine,
          lineStart: block.startLine,
          to: from + line.length,
        };
      }),
      length: source.length,
      mathSpans: [
        {
          bodyFrom: firstMathStart + 1,
          bodyTo: firstMathStart + 2,
          displayMode: false,
          from: firstMathStart,
          to: firstMathStart + 3,
        },
        {
          bodyFrom: mathStart + 1,
          bodyTo: mathStart + 2,
          displayMode: false,
          from: mathStart,
          to: mathStart + 3,
        },
      ],
      revision: 31,
      source,
    };
    expect(current.runtime.getGeneratedPreviewIdentity()).toMatchObject({
      signature,
      sourceRevision: 31,
    });
    expect(
      current.runtime.prepareGeneratedContentTargetBySelection({
        index,
        kind: "math",
        ordinal: 0,
        selection: { end: mathStart + 3, start: mathStart },
      }),
    ).toBeNull();
    const pin = current.runtime.prepareGeneratedContentTargetBySelection({
      index,
      kind: "math",
      ordinal: 1,
      selection: { end: mathStart + 3, start: mathStart },
    });
    expect(pin?.target.blockId).toBe("b319");
    expect(pin?.getLease()).toBeNull();
    await act(async () => {
      await flushAnimationFrames(12);
    });
    const lease = pin?.getLease();
    expect(lease?.target.blockId).toBe("b319");
    expect(lease?.isCurrent()).toBe(true);
    pin?.release();
    expect(pin?.isCurrent()).toBe(false);
    expect(lease?.isCurrent()).toBe(false);
    currentSource = "changed";
    current.unmount();
    geometry.restore();
  });

  it("leases the exact visual image node and keeps duplicate destinations distinct", async () => {
    const source =
      "![one](https://img.test/a.png) ![two](https://img.test/a.png)";
    const signature = "generated-image-lease";
    const firstImage = parseMarkdownImageScale(source, 0);
    const secondStart = source.indexOf("![two]");
    const secondImage = parseMarkdownImageScale(source, secondStart);
    if (!firstImage || !secondImage)
      throw new Error("image-target-fixture-invalid");
    const current = setup({
      contentEditable: true,
      currentSourceSnapshot: () => ({ revision: 55, value: source }),
      initialHtml: "<p>Initial preview</p>",
      initialSignature: signature,
    });
    await act(async () => {
      for (let index = 0; index < 16; index += 1) await Promise.resolve();
      await flushAnimationFrames(4);
    });
    act(() => {
      current.session.schedule(request(source, signature), true);
    });
    expect(current.responses).toHaveLength(1);
    await act(async () => {
      current.responses[0]?.resolve({
        editMap: {
          version: 1,
          coordinate: "line",
          signature,
          blocks: [{ editable: true, endLine: 1, id: "b0", startLine: 0 }],
        },
        features: {},
        html: safeHtml(
          '<p data-easymde-visual-block-id="b0">' +
            '<img src="https://img.test/a.png" alt="one">' +
            '<img src="https://img.test/a.png" alt="two"></p>',
        ),
      });
      for (let index = 0; index < 16; index += 1) await Promise.resolve();
      await flushAnimationFrames(6);
    });
    const images = Array.from(current.surface.querySelectorAll("img"));
    expect(images).toHaveLength(2);
    const index: GeneratedImageTargetIndex = {
      blockImages: [
        {
          end: source.length,
          images: [firstImage, secondImage],
          start: 0,
          status: "ready",
        },
      ],
      blocks: [
        {
          editable: true,
          from: 0,
          kind: "paragraph",
          lineEnd: 0,
          lineStart: 0,
          to: source.length,
        },
      ],
      complete: true,
      images: [firstImage, secondImage],
      length: source.length,
      revision: 55,
      source,
      sourceBytes: source.length,
    };
    const firstLease = current.runtime.prepareImageTarget({
      element: images[0] as HTMLImageElement,
      index,
      selection: { end: firstImage.end, start: firstImage.start },
    });
    const secondLease = current.runtime.prepareImageTarget({
      element: images[1] as HTMLImageElement,
      index,
      selection: { end: secondImage.end, start: secondImage.start },
    });
    expect(firstLease?.target.original.raw).toBe(firstImage.raw);
    expect(secondLease?.target.original.start).toBe(secondImage.start);
    expect(firstLease?.isCurrent()).toBe(true);
    const endSelectionPin = current.runtime.prepareImageTargetBySelection({
      index,
      selection: { end: secondImage.end, start: secondImage.start },
    });
    expect(endSelectionPin?.target.blockId).toBe("b0");
    expect(endSelectionPin?.getLease()?.root).toBe(images[1]);
    endSelectionPin?.release();
    const firstSelectionPin = current.runtime.prepareImageTargetBySelection({
      index,
      selection: { end: firstImage.end, start: firstImage.start },
    });
    expect(firstSelectionPin?.getLease()?.root).toBe(images[0]);
    const visualBlock = images[0]?.closest("[data-easymde-visual-block-id]");
    visualBlock?.insertBefore(
      images[1] as HTMLImageElement,
      images[0] as HTMLImageElement,
    );
    expect(firstSelectionPin?.getLease()).toBeNull();
    expect(firstSelectionPin?.isCurrent()).toBe(false);
    firstSelectionPin?.release();
    visualBlock?.insertBefore(
      images[0] as HTMLImageElement,
      images[1] as HTMLImageElement,
    );
    expect(secondLease?.isCurrent()).toBe(true);
    images[1]?.setAttribute("srcset", "https://img.test/a-2x.png 2x");
    expect(secondLease?.isCurrent()).toBe(false);
    const fingerprintLease = current.runtime.prepareImageTarget({
      element: images[1] as HTMLImageElement,
      index,
      selection: { end: secondImage.end, start: secondImage.start },
    });
    expect(fingerprintLease?.isCurrent()).toBe(true);
    images[1]?.setAttribute("sizes", "50vw");
    expect(fingerprintLease?.isCurrent()).toBe(false);
    const currentSrcLease = current.runtime.prepareImageTarget({
      element: images[1] as HTMLImageElement,
      index,
      selection: { end: secondImage.end, start: secondImage.start },
    });
    Object.defineProperty(images[1], "currentSrc", {
      configurable: true,
      value: "https://img.test/a-2x.png",
    });
    expect(currentSrcLease?.isCurrent()).toBe(false);
    const naturalSizeLease = current.runtime.prepareImageTarget({
      element: images[1] as HTMLImageElement,
      index,
      selection: { end: secondImage.end, start: secondImage.start },
    });
    Object.defineProperties(images[1], {
      naturalHeight: { configurable: true, value: 120 },
      naturalWidth: { configurable: true, value: 240 },
    });
    expect(naturalSizeLease?.isCurrent()).toBe(false);
    images[0]?.setAttribute("src", "https://img.test/changed.png");
    expect(firstLease?.isCurrent()).toBe(false);
    current.unmount();
  });

  it("pins a source-selected offscreen image without materializing the document", async () => {
    const geometry = installSequenceGeometry();
    const blockCount = 320;
    const lines = Array.from({ length: blockCount }, (_, index) =>
      index === blockCount - 1
        ? "![tail](https://img.test/tail.png)"
        : `line-${index}`,
    );
    const source = lines.join("\n\n");
    const signature = "generated-image-windowed-selection";
    const current = setup({
      contentEditable: true,
      currentSourceSnapshot: () => ({ revision: 81, value: source }),
      initialHtml: "<p>Initial preview</p>",
      initialSignature: signature,
      sourceRevision: 81,
      stagingScheduler: { yield: () => Promise.resolve() },
      windowed: true,
    });
    geometry.attach(current.canvas, current.surface);
    await act(async () => {
      for (let index = 0; index < 16; index += 1) await Promise.resolve();
      await flushAnimationFrames(4);
    });
    const blocks = Array.from({ length: blockCount }, (_, index) => ({
      id: `b${index}`,
      startLine: index * 2,
      endLine: index * 2 + 1,
      editable: true as const,
    }));
    act(() => {
      current.session.schedule(request(source, signature), true);
    });
    expect(current.responses).toHaveLength(1);
    await act(async () => {
      current.responses[0]?.resolve({
        editMap: {
          version: 1,
          coordinate: "line",
          signature,
          blocks,
        },
        features: {},
        html: safeHtml(
          blocks
            .map(({ id }, index) =>
              index === blockCount - 1
                ? `<p data-easymde-visual-block-id="${id}">` +
                  '<img src="https://img.test/tail.png" alt="tail"></p>'
                : `<p data-easymde-visual-block-id="${id}">${id}</p>`,
            )
            .join(""),
        ),
      });
      for (let index = 0; index < 48; index += 1) await Promise.resolve();
      await flushAnimationFrames(30);
    });
    expect(
      current.surface.querySelector('[data-easymde-visual-block-id="b319"]'),
    ).toBeNull();
    const parsed = createEditorMarkdownBlockIndex(source);
    const indexResult = await hydrateGeneratedImageTargetIndex({
      deadline: 10_000,
      blocks: parsed.blocks,
      imageIndex: {
        blocks: parsed.blocks,
        imageBlocks: parsed.imageBlocks ?? [],
        imageRanges: parsed.imageRanges ?? [],
        length: parsed.length,
        mathSpans: parsed.mathSpans,
      },
      revision: 81,
      now: () => 0,
      signal: new AbortController().signal,
      source,
      yield: async () => undefined,
    });
    const image = indexResult.images[0];
    if (!image) throw new Error("windowed-image-index-empty");
    const pin = current.runtime.prepareImageTargetBySelection({
      index: indexResult,
      selection: { end: image.end, start: image.start },
    });
    expect(pin?.target.blockId).toBe("b319");
    expect(pin?.getLease()).toBeNull();
    await act(async () => {
      await flushAnimationFrames(12);
    });
    const lease = pin?.getLease();
    expect(lease?.target.original.start).toBe(image.start);
    expect(lease?.isCurrent()).toBe(true);
    pin?.release();
    expect(pin?.isCurrent()).toBe(false);
    expect(lease?.isCurrent()).toBe(false);
    current.unmount();
    geometry.restore();
  });

  it("accepts a generated export again after a legitimate source revision and Preview commit", async () => {
    let source = "$x$";
    let revision = 41;
    const signature = "generated-source-revision";
    const current = setup({
      contentEditable: true,
      currentSourceSnapshot: () => ({ revision, value: source }),
      initialHtml: "<p>Initial preview</p>",
      initialSignature: signature,
    });
    const accept = async (
      markdown: string,
      htmlValue: string,
    ): Promise<void> => {
      const responseIndex = current.responses.length;
      act(() => {
        current.session.schedule(request(markdown, signature), true);
      });
      expect(current.responses).toHaveLength(responseIndex + 1);
      await act(async () => {
        current.responses[responseIndex]?.resolve({
          editMap: {
            version: 1,
            coordinate: "line",
            signature,
            blocks: [{ editable: true, endLine: 1, id: "b0", startLine: 0 }],
          },
          features: {},
          html: safeHtml(
            `<p data-easymde-visual-block-id="b0">${htmlValue}</p>`,
          ),
        });
        for (let index = 0; index < 16; index += 1) await Promise.resolve();
        await flushAnimationFrames(6);
      });
    };
    await act(async () => {
      for (let index = 0; index < 16; index += 1) await Promise.resolve();
      await flushAnimationFrames(4);
    });
    await accept(
      source,
      '<span class="easymde-math">' +
        '<span class="katex-mathml"><math><mi>x</mi></math></span></span>',
    );
    expect(current.runtime.getGeneratedPreviewIdentity()?.sourceRevision).toBe(
      41,
    );
    source = "$y$";
    revision = 42;
    await accept(
      source,
      '<span class="easymde-math">' +
        '<span class="katex-mathml"><math><mi>y</mi></math></span></span>',
    );
    expect(current.runtime.getGeneratedPreviewIdentity()).toMatchObject({
      signature,
      sourceRevision: 42,
    });
    current.unmount();
  });

  it("uses a replaced source snapshot provider when a later Preview commits", async () => {
    const source = "$x$";
    const signature = "generated-provider-replacement";
    const current = setup({
      contentEditable: true,
      initialHtml: "<p>Initial preview</p>",
      initialSignature: signature,
    });
    await act(async () => {
      for (let index = 0; index < 16; index += 1) await Promise.resolve();
      await flushAnimationFrames(4);
    });
    current.setCurrentSourceSnapshot(() => ({ revision: 7, value: source }));
    act(() => {
      current.session.schedule(request(source, signature), true);
    });
    expect(current.responses).toHaveLength(1);
    await act(async () => {
      current.responses[0]?.resolve({
        editMap: {
          version: 1,
          coordinate: "line",
          signature,
          blocks: [{ editable: true, endLine: 1, id: "b0", startLine: 0 }],
        },
        features: {},
        html: safeHtml(
          '<p data-easymde-visual-block-id="b0">' +
            '<span class="easymde-math"><span class="katex-mathml">' +
            "<math><mi>x</mi></math></span></span></p>",
        ),
      });
      for (let index = 0; index < 16; index += 1) await Promise.resolve();
      await flushAnimationFrames(6);
    });
    expect(current.runtime.getGeneratedPreviewIdentity()).toMatchObject({
      revision: 2,
      signature,
      sourceRevision: 7,
    });
    current.unmount();
  });

  it("preserves accepted protected Preview nodes in real staged rematerializations", async () => {
    const initialSignature = "protected-identity-initial";
    const initialFixture = protectedPreviewFixture(
      "Paragraph",
      initialSignature,
    );
    const current = setup({
      contentEditable: true,
      initialEditMap: initialFixture.editMap,
      initialHtml: initialFixture.html,
      initialSignature,
      stagingScheduler: { yield: () => Promise.resolve() },
      windowed: false,
    });
    await act(async () => {
      for (let index = 0; index < 16; index += 1) await Promise.resolve();
      await flushAnimationFrames(4);
    });

    const protectedNodes = Array.from(
      current.surface.querySelectorAll<HTMLElement>(
        VISUAL_MARKDOWN_READ_ONLY_SELECTOR,
      ),
    );
    expect(protectedNodes).toHaveLength(4);
    for (const node of protectedNodes)
      node.setAttribute("contenteditable", "false");
    const oldToc = current.surface.querySelector(".easymde-toc");
    const oldMath = current.surface.querySelector(".easymde-math");
    const oldFootnoteSeparator =
      current.surface.querySelector(".footnotes-sep");
    const oldFootnotes = current.surface.querySelector(".footnotes");
    if (!oldToc || !oldMath || !oldFootnoteSeparator || !oldFootnotes) {
      throw new Error("preview-protected-test-node-missing");
    }

    const replaceChildren = vi.spyOn(current.surface, "replaceChildren");
    const accept = async (
      fixture: ReturnType<typeof protectedPreviewFixture>,
      markdown: string,
    ): Promise<void> => {
      const responseIndex = current.responses.length;
      act(() => {
        current.session.schedule(
          request(markdown, fixture.editMap.signature),
          true,
        );
      });
      await act(async () => {
        current.responses[responseIndex]?.resolve({
          editMap: fixture.editMap,
          features: {},
          html: fixture.html,
        });
        for (let index = 0; index < 24; index += 1) await Promise.resolve();
        await flushAnimationFrames(8);
      });
    };

    const firstFixture = protectedPreviewFixture(
      "Paragraph!",
      "protected-identity-first",
    );
    await accept(firstFixture, "Paragraph!");

    expect(current.surface.getAttribute("aria-busy")).toBe("false");
    expect(current.surface.easymdePreviewSignature).toBe(
      firstFixture.editMap.signature,
    );
    expect(current.onDiagnostic).not.toHaveBeenCalled();
    expect(replaceChildren.mock.calls[0]).toEqual(
      expect.arrayContaining([oldToc, oldFootnoteSeparator, oldFootnotes]),
    );
    expect(current.surface.querySelector(".easymde-toc")).toBe(oldToc);
    expect(current.surface.querySelector(".easymde-math")).toBe(oldMath);
    expect(current.surface.querySelector(".footnotes-sep")).toBe(
      oldFootnoteSeparator,
    );
    expect(current.surface.querySelector(".footnotes")).toBe(oldFootnotes);

    const secondFixture = protectedPreviewFixture(
      "Paragraph!?",
      "protected-identity-second",
    );
    await accept(secondFixture, "Paragraph!?");
    expect(current.surface.querySelector(".easymde-toc")).toBe(oldToc);
    expect(current.surface.querySelector(".easymde-math")).toBe(oldMath);
    expect(current.surface.querySelector(".footnotes-sep")).toBe(
      oldFootnoteSeparator,
    );
    expect(current.surface.querySelector(".footnotes")).toBe(oldFootnotes);

    const changedAttributeFixture = protectedPreviewFixture(
      "Paragraph!?#",
      "protected-identity-changed-attribute",
      { tocHref: "#changed" },
    );
    await accept(changedAttributeFixture, "Paragraph!?#");
    const changedAttributeToc =
      current.surface.querySelector<HTMLElement>(".easymde-toc");
    expect(changedAttributeToc).not.toBe(oldToc);
    expect(changedAttributeToc?.getAttribute("contenteditable")).toBe("false");
    expect(current.surface.querySelector(".easymde-math")).toBe(oldMath);
    expect(current.surface.querySelector(".footnotes-sep")).toBe(
      oldFootnoteSeparator,
    );
    expect(current.surface.querySelector(".footnotes")).toBe(oldFootnotes);

    const changedHtmlFixture = protectedPreviewFixture(
      "Paragraph!?#$",
      "protected-identity-changed-html",
      { footnote: "Changed note", tocHref: "#changed" },
    );
    await accept(changedHtmlFixture, "Paragraph!?#$");
    const changedHtmlFootnotes =
      current.surface.querySelector<HTMLElement>(".footnotes");
    expect(changedHtmlFootnotes).not.toBe(oldFootnotes);
    expect(changedHtmlFootnotes?.getAttribute("contenteditable")).toBe("false");
    expect(current.surface.querySelector(".easymde-toc")).toBe(
      changedAttributeToc,
    );
    expect(current.surface.querySelector(".easymde-math")).toBe(oldMath);
    expect(current.surface.querySelector(".footnotes-sep")).toBe(
      oldFootnoteSeparator,
    );

    const changedPathFixture = protectedPreviewFixture(
      "Paragraph!?#$%",
      "protected-identity-changed-path",
      { footnote: "Changed note", mathWrapper: true, tocHref: "#changed" },
    );
    await accept(changedPathFixture, "Paragraph!?#$%");
    const changedPathMath =
      current.surface.querySelector<HTMLElement>(".easymde-math");
    expect(changedPathMath).not.toBe(oldMath);
    expect(changedPathMath?.getAttribute("contenteditable")).toBe("false");
    expect(current.surface.querySelector(".easymde-toc")).toBe(
      changedAttributeToc,
    );
    expect(current.surface.querySelector(".footnotes")).toBe(
      changedHtmlFootnotes,
    );
    expect(current.surface.querySelector(".footnotes-sep")).toBe(
      oldFootnoteSeparator,
    );

    const reorderedFixture = protectedPreviewFixture(
      "Paragraph!?#$%&",
      "protected-identity-reordered",
      {
        footnote: "Changed note",
        mathWrapper: true,
        order: ["paragraph", "footnotes", "math", "footnote-separator", "toc"],
        tocHref: "#changed",
      },
    );
    await accept(reorderedFixture, "Paragraph!?#$%&");
    const reorderedToc =
      current.surface.querySelector<HTMLElement>(".easymde-toc");
    const reorderedFootnotes =
      current.surface.querySelector<HTMLElement>(".footnotes");
    expect(reorderedToc).not.toBe(changedAttributeToc);
    expect(reorderedFootnotes).not.toBe(changedHtmlFootnotes);
    expect(reorderedToc?.getAttribute("contenteditable")).toBe("false");
    expect(reorderedFootnotes?.getAttribute("contenteditable")).toBe("false");
    expect(current.surface.querySelector(".easymde-math")).toBe(
      changedPathMath,
    );
    expect(current.surface.querySelector(".footnotes-sep")).toBe(
      oldFootnoteSeparator,
    );

    replaceChildren.mockRestore();
  });

  it("does not expose an editable visual surface as a live region", async () => {
    const editable = setup({ contentEditable: true });

    expect(editable.surface.getAttribute("contenteditable")).toBe("true");
    expect(editable.surface.hasAttribute("aria-live")).toBe(false);
    await act(async () => {});
  });

  it("renders initial server HTML through the single preview sink", async () => {
    const { surface } = setup({ initialHtml: "<h2>Server preview</h2>" });

    expect(surface.matches("[data-easymde-preview-html-sink]")).toBe(true);
    expect(surface.querySelector("h2")?.textContent).toBe("Server preview");
    await act(async () => {});
    expect(surface.getAttribute("aria-busy")).toBe("false");
    expect(surface.easymdePreviewSignature).toBe("initial");
  });

  it("publishes enhanced generation-zero server HTML for visual editing", async () => {
    const onHtmlChange = vi.fn<(html: SafePreviewHtml) => void>();
    const current = setup({
      enhance: async (surface) => {
        surface.querySelector("h2")?.setAttribute("data-enhanced", "1");
      },
      initialHtml: "<h2>Server preview</h2>",
      onHtmlChange,
    });

    await act(async () => {});

    expect(current.surface.easymdePreviewSignature).toBe("initial");
    expect(onHtmlChange).toHaveBeenCalledOnce();
    expect(onHtmlChange).toHaveBeenCalledWith(
      safeHtml('<h2 data-enhanced="1">Server preview</h2>'),
    );
  });

  it("commits only the bounded window on the first windowed ready state", async () => {
    const fixture = windowedFixture(320, "windowed");
    const enhancement = deferred<void>();
    const enhance = vi.fn<PreviewEnhancementPort["enhance"]>(
      () => enhancement.promise,
    );
    const current = setup({
      contentEditable: true,
      enhance,
      initialEditMap: fixture.editMap,
      initialHtml: fixture.html,
      initialSignature: "windowed",
      stagingScheduler: {
        now: () => 0,
        yield: () => Promise.resolve(),
      },
      windowed: true,
    });

    await act(async () => {
      for (let index = 0; index < 12; index += 1) await Promise.resolve();
    });
    expect(enhance).toHaveBeenCalledOnce();
    expect(enhance.mock.calls[0]?.[0].isConnected).toBe(false);
    expect(enhance.mock.calls[0]?.[0].style.display).toBe("none");
    const replaceChildren = vi.spyOn(current.surface, "replaceChildren");

    await act(async () => {
      enhancement.resolve();
      await enhancement.promise;
    });
    await act(async () => flushAnimationFrames());
    expect(replaceChildren).toHaveBeenCalledOnce();
    expect(
      current.surface.querySelectorAll("[data-easymde-visual-block-id]").length,
    ).toBeLessThanOrEqual(160);
    expect(
      current.surface.querySelector("[data-easymde-preview-window-spacer]"),
    ).not.toBeNull();
    expect(
      current.surface.querySelector('[data-easymde-visual-block-id="b319"]'),
    ).toBeNull();
    expect(current.surface.getAttribute("contenteditable")).toBe("true");

    current.setWindowed(false);
    await act(async () => flushAnimationFrames(8));
    expect(replaceChildren).toHaveBeenCalledOnce();
    expect(
      current.surface.querySelectorAll("[data-easymde-visual-block-id]"),
    ).toHaveLength(320);
    expect(
      current.surface.querySelector("[data-easymde-preview-window-spacer]"),
    ).toBeNull();
    replaceChildren.mockRestore();
  });

  it("certifies only the actually installed window commit for source navigation", async () => {
    const fixture = windowedFixture(320, "accepted-window-certificate");
    const current = setup({
      contentEditable: true,
      initialEditMap: fixture.editMap,
      initialHtml: fixture.html,
      initialSignature: fixture.editMap.signature,
      stagingScheduler: { yield: () => Promise.resolve() },
      windowed: true,
    });

    expect(current.runtime.getAcceptedWindowSnapshot()).toBeNull();
    await act(async () => {
      for (let index = 0; index < 16; index += 1) await Promise.resolve();
      await flushAnimationFrames(12);
    });

    const accepted = current.runtime.getAcceptedWindowSnapshot();
    expect(accepted).not.toBeNull();
    expect(accepted?.revision).toBe(0);
    expect(accepted?.signature).toBe(fixture.editMap.signature);
    expect(accepted?.key).toBeGreaterThan(0);
    expect(accepted?.blocks.length).toBeGreaterThan(0);
    expect(accepted?.blocks.length).toBeLessThanOrEqual(160);
    expect(accepted?.nodes).toEqual(Array.from(current.surface.childNodes));
    expect(accepted?.blocks[0]).toMatchObject({
      id: "b0",
      innerHTML: "b0",
    });
    act(() => {
      current.session.schedule(
        request("pending replacement", "pending-replacement"),
        true,
      );
    });
    expect(current.runtime.getAcceptedWindowSnapshot()).toBeNull();

    const visible = current.surface.querySelector<HTMLElement>(
      '[data-easymde-visual-block-id="b0"]',
    );
    if (!visible) throw new Error("accepted-window-visible-block-missing");
    const foreign = document.createElement("p");
    foreign.setAttribute("data-easymde-visual-block-id", "b0");
    foreign.textContent = "foreign";
    visible.replaceWith(foreign);
    expect(current.runtime.getAcceptedWindowSnapshot()).toBeNull();

    current.unmount();
    expect(current.runtime.getAcceptedWindowSnapshot()).toBeNull();
  });

  it("readmits the current request after a windowed unlock and mode round trip at a newer commit generation", async () => {
    const geometry = installSequenceGeometry();
    const first = windowedFixture(320, "1:round-trip");
    const second = windowedFixture(320, "2:round-trip");
    const onWindowReady = vi.fn();
    const current = setup({
      onWindowReady,
      stagingScheduler: { now: () => 0, yield: () => Promise.resolve() },
      windowed: false,
    });
    geometry.attach(current.canvas, current.surface);
    await act(async () => {
      for (let index = 0; index < 16; index += 1) await Promise.resolve();
    });
    act(() =>
      current.session.schedule(
        request("article", first.editMap.signature),
        true,
      ),
    );
    await act(async () => {
      current.responses[0]?.resolve({ ...first, features: {} });
      for (let index = 0; index < 32; index += 1) await Promise.resolve();
    });
    current.setWindowed(true);
    await act(async () => flushAnimationFrames());
    expect(current.runtime.getAcceptedWindowSnapshot()).toMatchObject({
      revision: 2,
      signature: first.editMap.signature,
    });
    expect(onWindowReady).toHaveBeenCalled();

    // Leaving visual editing materializes before the source-mode refresh.
    let materialization!: Promise<boolean>;
    act(() => {
      materialization = current.runtime.materialize();
    });
    await act(async () => flushAnimationFrames());
    await expect(materialization).resolves.toBe(true);
    onWindowReady.mockClear();
    current.setClassName("source-mode-handoff");
    await act(async () => flushAnimationFrames());
    expect(current.surface.children).toHaveLength(320);
    expect(onWindowReady).not.toHaveBeenCalled();

    // Hidden source mode keeps the windowed owner. Its second request
    // commits generation 4: loading and success each advance that clock.
    act(() =>
      current.session.schedule(
        request("article", second.editMap.signature),
        true,
      ),
    );
    await act(async () => {
      current.responses[1]?.resolve({ ...second, features: {} });
      for (let index = 0; index < 32; index += 1) await Promise.resolve();
    });
    await act(async () => flushAnimationFrames());
    expect(current.session.isCurrent(2, second.editMap.signature)).toBe(true);
    expect(current.runtime.getAcceptedWindowSnapshot()).toMatchObject({
      revision: 4,
      signature: second.editMap.signature,
    });

    // Returning to read-only Preview materializes that same generation.
    current.setWindowed(false);
    await act(async () => flushAnimationFrames());
    expect(current.surface.children).toHaveLength(320);
    expect(current.runtime.getAcceptedWindowSnapshot()).toBeNull();
    onWindowReady.mockClear();
    current.setWindowed(true);
    await waitFor(() => expect(onWindowReady).toHaveBeenCalled());

    expect(current.onDiagnostic).not.toHaveBeenCalled();
    expect(onWindowReady).toHaveBeenCalled();
    expect(current.runtime.getAcceptedWindowSnapshot()).toMatchObject({
      revision: 4,
      signature: second.editMap.signature,
    });
    expect(
      current.surface.querySelectorAll("[data-easymde-visual-block-id]").length,
    ).toBeLessThanOrEqual(160);
    current.unmount();
    geometry.restore();
  });

  it.each(["complete", "fail"] as const)(
    "settles windowed reentry when an in-flight materialization must %s",
    async (outcome) => {
      const geometry = installSequenceGeometry();
      const fixture = windowedFixture(320, "pending-reentry");
      const pending: Array<ReturnType<typeof deferred<void>>> = [];
      const onWindowReady = vi.fn();
      const statuses: PreviewSurfaceStatus[] = [];
      const current = setup({
        contentEditable: true,
        initialEditMap: fixture.editMap,
        initialHtml: fixture.html,
        initialSignature: fixture.editMap.signature,
        materializeScheduler: {
          pending,
          yield: vi.fn(() => {
            const next = deferred<void>();
            pending.push(next);
            return next.promise;
          }),
        },
        onStatusChange: (status) => statuses.push(status),
        onWindowReady,
        stagingScheduler: { now: () => 0, yield: () => Promise.resolve() },
        windowed: true,
      });
      geometry.attach(current.canvas, current.surface);
      await act(async () => {
        for (let index = 0; index < 32; index += 1) await Promise.resolve();
        await flushAnimationFrames();
      });
      expect(current.runtime.getAcceptedWindowSnapshot()).not.toBeNull();
      current.setWindowed(false);
      expect(pending.length).toBeGreaterThan(0);
      onWindowReady.mockClear();
      current.setWindowed(true);
      await act(async () => flushAnimationFrames(2));
      expect(onWindowReady).not.toHaveBeenCalled();
      expect(current.runtime.getAcceptedWindowSnapshot()).toBeNull();

      for (let index = 0; index < 32; index += 1) {
        const next = pending.shift();
        if (!next) break;
        await act(async () => {
          if (outcome === "fail")
            next.reject(new Error("synthetic-materialization-failure"));
          else next.resolve();
          for (let turn = 0; turn < 16; turn += 1) await Promise.resolve();
        });
      }
      await waitFor(() => {
        if (outcome === "complete") expect(onWindowReady).toHaveBeenCalled();
        else expect(statuses.at(-1)).toBe("error");
      });
      expect(pending).toHaveLength(0);
      if (outcome === "complete") {
        expect(current.onDiagnostic).not.toHaveBeenCalled();
        expect(onWindowReady).toHaveBeenCalled();
        expect(current.runtime.getAcceptedWindowSnapshot()).not.toBeNull();
        expect(
          current.surface.querySelectorAll("[data-easymde-visual-block-id]")
            .length,
        ).toBeLessThanOrEqual(160);
      } else {
        expect(current.onDiagnostic).toHaveBeenCalledWith(
          "preview-enhancement-failed",
        );
        expect(statuses.at(-1)).toBe("error");
        expect(current.surface.getAttribute("contenteditable")).toBe("false");
        expect(onWindowReady).not.toHaveBeenCalled();
        expect(current.runtime.getAcceptedWindowSnapshot()).toBeNull();
      }
      current.unmount();
      geometry.restore();
    },
  );

  it("retains the current window repository across hidden mode materialization and reactivation", async () => {
    const geometry = installSequenceGeometry();
    const fixture = windowedFixture(640, "hidden-window-round-trip");
    const refreshed = windowedFixture(640, "hidden-window-round-trip-current");
    const statuses: PreviewSurfaceStatus[] = [];
    const onWindowReady = vi.fn();
    const pending: Array<ReturnType<typeof deferred<void>>> = [];
    const current = setup({
      initialEditMap: fixture.editMap,
      initialHtml: fixture.html,
      initialSignature: fixture.editMap.signature,
      materializeScheduler: {
        pending,
        yield: vi.fn(() => {
          const next = deferred<void>();
          pending.push(next);
          return next.promise;
        }),
      },
      onStatusChange: (status) => statuses.push(status),
      onWindowReady,
      stagingScheduler: { now: () => 0, yield: () => Promise.resolve() },
      windowed: false,
    });
    geometry.attach(current.canvas, current.surface);
    const mountedIds = (): Array<string> =>
      Array.from(
        current.surface.querySelectorAll<HTMLElement>(
          "[data-easymde-visual-block-id]",
        ),
      ).map((node) => node.getAttribute("data-easymde-visual-block-id") ?? "");
    const spacers = (): number =>
      current.surface.querySelectorAll("[data-easymde-preview-window-spacer]")
        .length;
    const spacerRange = (): Readonly<{ end: number; start: number }> => {
      const spacer = current.surface.querySelector<HTMLElement>(
        "[data-easymde-preview-window-spacer]",
      );
      if (!spacer) throw new Error("window-spacer-missing");
      const start = Number.parseInt(
        spacer.getAttribute("data-easymde-preview-window-start") ?? "",
        10,
      );
      const end = Number.parseInt(
        spacer.getAttribute("data-easymde-preview-window-end") ?? "",
        10,
      );
      if (!Number.isInteger(start) || !Number.isInteger(end)) {
        throw new Error("window-spacer-range-invalid");
      }
      return { end, start };
    };
    const lastMountedIndex = (): number => {
      const last = mountedIds().at(-1);
      const index = Number.parseInt(last?.replace(/^b/u, "") ?? "", 10);
      if (!Number.isInteger(index)) {
        throw new Error("window-mounted-index-invalid");
      }
      return index;
    };
    const drainMaterialization = async (): Promise<void> => {
      for (let index = 0; index < 32; index += 1) {
        const next = pending.shift();
        if (!next) break;
        await act(async () => {
          next.resolve();
          for (let turn = 0; turn < 16; turn += 1) await Promise.resolve();
        });
      }
      await act(async () => flushAnimationFrames(8));
    };
    await act(async () => {
      for (let index = 0; index < 32; index += 1) await Promise.resolve();
      await flushAnimationFrames(8);
    });
    // Read-only visible materialization: the complete accepted node set, no spacer.
    expect(mountedIds()).toHaveLength(640);
    expect(spacers()).toBe(0);
    expect(current.runtime.getAcceptedWindowSnapshot()).toBeNull();

    // Hidden activation (Root's source mode) installs one bounded window whose
    // spacer declares the range it actually covers.
    current.setWindowed(true);
    await act(async () => flushAnimationFrames(12));
    expect(spacers()).toBe(1);
    expect(spacerRange()).toEqual({ end: 640, start: lastMountedIndex() + 1 });
    const hiddenRange = spacerRange();
    const hiddenIds = mountedIds();
    expect(hiddenIds.length).toBeGreaterThan(0);
    expect(hiddenIds.length).toBeLessThanOrEqual(160);

    // Returning to the visible read-only Preview materializes the full document.
    pending.length = 0;
    current.setWindowed(false);
    await act(async () => {
      for (let index = 0; index < 32; index += 1) await Promise.resolve();
    });
    await drainMaterialization();
    expect(mountedIds()).toHaveLength(640);
    expect(spacers()).toBe(0);
    expect(current.onDiagnostic).not.toHaveBeenCalled();
    expect(statuses.at(-1)).toBe("ready");

    // Reactivating the hidden window must commit the same window again from
    // the same repository, with the same declared range.
    onWindowReady.mockClear();
    current.setWindowed(true);
    await waitFor(() => expect(onWindowReady).toHaveBeenCalled());
    expect(current.onDiagnostic).not.toHaveBeenCalled();
    expect(statuses.at(-1)).toBe("ready");
    expect(spacers()).toBe(1);
    expect(spacerRange()).toEqual(hiddenRange);
    expect(spacerRange().start).toBe(lastMountedIndex() + 1);
    expect(mountedIds()).toEqual(hiddenIds);
    expect(onWindowReady).toHaveBeenCalled();

    // The reactivated window keeps the repository usable: the next visible
    // materialization consumes its spacer and restores every mounted node.
    pending.length = 0;
    current.setWindowed(false);
    await act(async () => {
      for (let index = 0; index < 32; index += 1) await Promise.resolve();
    });
    await drainMaterialization();
    expect(current.onDiagnostic).not.toHaveBeenCalled();
    expect(statuses.at(-1)).toBe("ready");
    expect(spacers()).toBe(0);
    expect(mountedIds()).toHaveLength(640);

    // A newer legitimate refresh generation must still replace the repository.
    act(() =>
      current.session.schedule(
        request("article", refreshed.editMap.signature),
        true,
      ),
    );
    await act(async () => {
      current.responses[0]?.resolve({ ...refreshed, features: {} });
      for (let index = 0; index < 32; index += 1) await Promise.resolve();
    });
    await act(async () => flushAnimationFrames(12));
    expect(current.onDiagnostic).not.toHaveBeenCalled();
    expect(statuses.at(-1)).toBe("ready");
    expect(spacers()).toBeLessThanOrEqual(1);
    current.unmount();
    geometry.restore();
  });

  it.each(["\n", "\n<!-- root gap -->\n"])(
    "retains the complete Preview across pre-window Source reentry with inter-root nodes (%j)",
    async (separator) => {
      const fixture = windowedFixture(320, "full-surface-source-reentry");
      const pending: MaterializeScheduler["pending"] = [];
      let now = 0;
      const current = setup({
        initialEditMap: fixture.editMap,
        initialHtml: fixture.html.replaceAll("><", `>${separator}<`),
        initialSignature: fixture.editMap.signature,
        materializeScheduler: {
          pending,
          yield: vi.fn(() => {
            const next = deferred<void>();
            pending.push(next);
            return next.promise;
          }),
        },
        stagingScheduler: {
          now: () => (now += 1),
          yield: () => Promise.resolve(),
        },
        windowed: false,
      });
      await act(async () => {
        for (let index = 0; index < 16; index += 1) await Promise.resolve();
        await flushAnimationFrames(8);
      });
      const originalNodes = Array.from(current.surface.childNodes);
      const originalRoots = Array.from(current.surface.children);
      for (const [index, node] of originalRoots.entries()) {
        if (!(node instanceof HTMLElement))
          throw new Error("source-reentry-root-missing");
        node.style.marginBlockStart = "0px";
        node.style.marginBlockEnd = "0px";
        Object.defineProperty(node, "offsetHeight", {
          configurable: true,
          value: 24,
        });
        vi.spyOn(node, "getBoundingClientRect").mockReturnValue({
          bottom: (index + 1) * 24,
          height: 24,
          left: 0,
          right: 320,
          top: index * 24,
          width: 320,
          x: 0,
          y: index * 24,
          toJSON: () => ({}),
        } as DOMRect);
      }
      current.setWindowed(true);
      await act(async () => {
        await Promise.resolve();
      });
      expect(
        current.surface.querySelector("[data-easymde-preview-window-spacer]"),
      ).toBeNull();
      expect(current.surface.children).toHaveLength(originalRoots.length);
      current.setWindowed(false);
      await act(async () => {
        for (let index = 0; index < 64; index += 1) {
          pending.shift()?.resolve();
          await Promise.resolve();
        }
        await flushAnimationFrames(8);
      });
      expect(current.surface.getAttribute("data-easymde-preview-phase")).toBe(
        "ready",
      );
      expect(current.onDiagnostic).not.toHaveBeenCalled();
      expect(
        Array.from(current.surface.childNodes).every(
          (node, index) => node === originalNodes[index],
        ),
      ).toBe(true);
      expect(current.surface.childNodes).toHaveLength(originalNodes.length);
      expect(
        current.surface.querySelector("[data-easymde-preview-window-spacer]"),
      ).toBeNull();
      current.setWindowed(true);
      await act(async () => {
        for (let index = 0; index < 128; index += 1) await Promise.resolve();
        await flushAnimationFrames(8);
      });
      expect(current.runtime.getAcceptedWindowSnapshot()).not.toBeNull();
      expect(
        current.surface.querySelector("[data-easymde-preview-window-spacer]"),
      ).not.toBeNull();
      expect(current.onDiagnostic).not.toHaveBeenCalled();
      current.unmount();
    },
  );

  it.each(["unsliced", "budgeted continuation"] as const)(
    "defers an unmeasured connected Preview until resize and completes its consumer (%s)",
    async (scheduling) => {
      const signature = `initially-unmeasured-${scheduling}`;
      const sources = Array.from({ length: 320 }, (_, index) =>
        180 === index
          ? "```js\nalpha < beta\n```"
          : 270 === index
            ? '![Geometry image](https://example.test/geometry.png "Geometry title")'
            : `Paragraph ${index}`,
      );
      let nextLine = 0;
      const editMap: PreviewEditMap = {
        version: 1,
        coordinate: "line",
        signature,
        blocks: sources.map((source, index) => {
          const startLine = nextLine;
          nextLine += source.split("\n").length + 1;
          return {
            id: `b${index}`,
            startLine,
            endLine: nextLine - 1,
            editable: true,
          };
        }),
      };
      const html = sources
        .map((source, index) =>
          180 === index
            ? `<pre data-easymde-visual-block-id="b${index}"><code class="language-js">alpha &lt; beta\n</code></pre>`
            : 270 === index
              ? `<p data-easymde-visual-block-id="b${index}"><img src="https://example.test/geometry.png" alt="Geometry image" title="Geometry title"></p>`
              : `<p data-easymde-visual-block-id="b${index}">${source}</p>`,
        )
        .join("");
      const source = markdownDocumentSource(sources.join("\n\n"));
      source.owner.applyTextChange({
        value: source.owner.getValue(),
        selection: { direction: "backward", start: 2, end: 8 },
      });
      const sourceBefore = {
        value: source.owner.getValue(),
        selection: source.owner.getSelection(),
        revision: source.owner.getRevision(),
        history: source.owner.getHistoryState(),
        submission: source.submissionField.value,
      };
      const onWindowReady = vi.fn();
      let measurable = false;
      let clock = 0;
      const current = setup({
        contentEditable: true,
        initialEditMap: editMap,
        initialHtml: html,
        initialSignature: signature,
        currentSourceSnapshot: () => ({
          revision: source.owner.getRevision(),
          value: source.owner.getValue(),
        }),
        sourceRevision: source.owner.getRevision(),
        onWindowReady,
        stagingScheduler: {
          now: (): number => {
            if (!measurable || "budgeted continuation" !== scheduling) return 0;
            clock += 1 / 16;
            return clock;
          },
          yield: () => Promise.resolve(),
        },
        windowed: false,
      });
      try {
        await act(async () => {
          for (let turn = 0; turn < 16; turn += 1) await Promise.resolve();
          await flushAnimationFrames(2);
        });
        const roots = Array.from(current.surface.children);
        expect(roots).toHaveLength(sources.length);
        const originalContent = roots.map((node) => ({
          id: node.getAttribute("data-easymde-visual-block-id"),
          tag: node.tagName,
          html: node.innerHTML,
        }));
        const heights = new Map(
          roots.map((node) => [node, "PRE" === node.tagName ? 72 : 24]),
        );
        const height = (node: Element): number =>
          node.hasAttribute("data-easymde-preview-window-spacer")
            ? Number.parseFloat((node as HTMLElement).style.blockSize)
            : (heights.get(node) ?? 0);
        const extent = () =>
          Array.from(current.surface.children).reduce(
            (sum, node) => sum + height(node),
            0,
          );
        const origin = 100.59375;
        const positiveReads = new Set<Element>();
        let zeroReads = 0;
        vi.spyOn(current.canvas, "getBoundingClientRect").mockImplementation(
          () => previewRect(0, 240),
        );
        Object.defineProperty(current.canvas, "clientHeight", {
          configurable: true,
          value: 240,
        });
        Object.defineProperty(current.canvas, "scrollHeight", {
          configurable: true,
          get: () => (measurable ? origin + extent() : 0),
        });
        vi.spyOn(current.surface, "getBoundingClientRect").mockImplementation(
          () =>
            previewRect(
              -current.canvas.scrollTop,
              measurable ? origin + extent() : 0,
            ),
        );
        current.surface.style.paddingBlockStart = `${origin}px`;
        for (const node of roots) {
          if (!(node instanceof HTMLElement))
            throw new Error("unmeasured-consumer-root-missing");
          node.style.marginBlockStart = node.style.marginBlockEnd = "0px";
          Object.defineProperty(node, "offsetHeight", {
            configurable: true,
            get: () => (measurable ? height(node) : 0),
          });
          Object.defineProperty(node, "offsetWidth", {
            configurable: true,
            get: () => (measurable ? 320 : 0),
          });
          vi.spyOn(node, "getClientRects").mockImplementation(
            () =>
              (measurable
                ? [node.getBoundingClientRect()]
                : []) as unknown as DOMRectList,
          );
          vi.spyOn(node, "getBoundingClientRect").mockImplementation(() => {
            if (!measurable) {
              zeroReads += 1;
              return new DOMRect(0, 0, 0, 0);
            }
            positiveReads.add(node);
            let top = origin;
            for (
              let sibling = node.previousElementSibling;
              sibling;
              sibling = sibling.previousElementSibling
            )
              top += height(sibling);
            return previewRect(top - current.canvas.scrollTop, height(node));
          });
        }
        const first = roots[0];
        const last = roots.at(-1);
        const text = first?.firstChild;
        const selection = window.getSelection();
        if (
          !(first instanceof HTMLElement) ||
          !last ||
          !(text instanceof Text) ||
          !selection
        )
          throw new Error("unmeasured-consumer-selection-missing");
        selection.setBaseAndExtent(text, 8, text, 2);
        const expectPreservedSourceAndSelection = () => {
          expect({
            value: source.owner.getValue(),
            selection: source.owner.getSelection(),
            revision: source.owner.getRevision(),
            history: source.owner.getHistoryState(),
            submission: source.submissionField.value,
          }).toEqual(sourceBefore);
          expect(selection.anchorNode).toBe(text);
          expect(selection.anchorOffset).toBe(8);
          expect(selection.focusNode).toBe(text);
          expect(selection.focusOffset).toBe(2);
          expect(text.isConnected).toBe(true);
        };
        current.setWindowed(true);
        await act(async () => {
          await flushAnimationFrames(1);
          expect(zeroReads).toBeGreaterThan(0);
          expect(current.runtime.getAcceptedWindowSnapshot()).toBeNull();
          expect(onWindowReady).not.toHaveBeenCalled();
          expect(Array.from(current.surface.children)).toEqual(roots);
          const readsWhileWaiting = zeroReads;
          await flushAnimationFrames(2);
          expect(zeroReads).toBe(readsWhileWaiting);
          expectPreservedSourceAndSelection();
          // Layout becomes available between the scheduler's work and React's
          // sink installation. Capturing the zero-metric anchor before this
          // boundary must not become a staged flow-anchor verification failure.
          measurable = true;
          window.dispatchEvent(new Event("resize"));
        });
        if ("budgeted continuation" === scheduling) {
          await act(async () => flushAnimationFrames(1));
          // This is a mounted-measurement continuation, not preparation yields:
          // the first root was read, the final root was not, and no window landed.
          expect(positiveReads.has(first)).toBe(true);
          expect(positiveReads.has(last)).toBe(false);
          expect(current.runtime.getAcceptedWindowSnapshot()).toBeNull();
          expect(Array.from(current.surface.children)).toEqual(roots);
        }
        for (
          let frame = 0;
          frame < 16 && !current.runtime.getAcceptedWindowSnapshot();
          frame += 1
        )
          await act(async () => flushAnimationFrames(1));
        expect(current.onDiagnostic).not.toHaveBeenCalled();
        expect(current.queryByRole("alert")).toBeNull();
        const accepted = current.runtime.getAcceptedWindowSnapshot();
        expect(accepted).not.toBeNull();
        if (!accepted) throw new Error("unmeasured-consumer-window-not-ready");
        expect(onWindowReady).toHaveBeenCalled();
        expect(accepted.signature).toBe(signature);
        expect(accepted.editMap).toEqual(editMap);
        expect(accepted.sourceRevision).toBe(sourceBefore.revision);
        expect(accepted.nodes).toEqual(Array.from(current.surface.childNodes));
        expect(accepted.blocks.length).toBeGreaterThan(0);
        expect(accepted.blocks.length).toBeLessThanOrEqual(160);
        for (const block of accepted.blocks) {
          const index = editMap.blocks.findIndex(({ id }) => id === block.id);
          expect(block.node).toBe(roots[index]);
          expect(block.innerHTML).toBe(originalContent[index]?.html);
        }
        const ranges = previewWindowRanges(
          Array.from(current.surface.children),
        );
        expect(ranges[0]?.start).toBe(0);
        expect(ranges.at(-1)?.end).toBe(sources.length);
        for (let index = 1; index < ranges.length; index += 1)
          expect(ranges[index]?.start).toBe(ranges[index - 1]?.end);
        for (const spacer of current.surface.querySelectorAll<HTMLElement>(
          "[data-easymde-preview-window-spacer]",
        )) {
          const start = Number(
            spacer.getAttribute("data-easymde-preview-window-start"),
          );
          const end = Number(
            spacer.getAttribute("data-easymde-preview-window-end"),
          );
          expect(Number.parseFloat(spacer.style.blockSize)).toBe(
            roots
              .slice(start, end)
              .reduce((sum, node) => sum + height(node), 0),
          );
        }
        expect(
          current.surface.querySelector('[data-easymde-visual-block-id="b0"]'),
        ).toBe(first);
        expect(current.surface.contains(last)).toBe(false);
        expect(
          first.getBoundingClientRect().top + current.canvas.scrollTop,
        ).toBe(origin);
        expect(current.canvas.scrollTop).toBe(0);
        expect(current.surface.getAttribute("data-easymde-preview-phase")).toBe(
          "ready",
        );
        expect(current.surface.getAttribute("aria-busy")).toBe("false");
        expectPreservedSourceAndSelection();
        let materialized: boolean | undefined;
        act(() => {
          void current.runtime.materialize().then((value) => {
            materialized = value;
          });
        });
        for (
          let frame = 0;
          frame < 16 && undefined === materialized;
          frame += 1
        )
          await act(async () => flushAnimationFrames(1));
        expect(materialized).toBe(true);
        expect(Array.from(current.surface.children)).toEqual(roots);
        expect(
          Array.from(current.surface.children).map((node) => ({
            id: node.getAttribute("data-easymde-visual-block-id"),
            tag: node.tagName,
            html: node.innerHTML,
          })),
        ).toEqual(originalContent);
        expect(current.surface.querySelector("pre > code")?.textContent).toBe(
          "alpha < beta\n",
        );
        expect(current.surface.querySelector("img")?.getAttribute("src")).toBe(
          "https://example.test/geometry.png",
        );
        expect(current.surface.querySelector("img")?.getAttribute("alt")).toBe(
          "Geometry image",
        );
        expect(
          current.surface.querySelector("[data-easymde-preview-window-spacer]"),
        ).toBeNull();
        expect(current.surface.getAttribute("data-easymde-preview-phase")).toBe(
          "ready",
        );
        expect(current.surface.getAttribute("aria-busy")).toBe("false");
        expect(current.onDiagnostic).not.toHaveBeenCalled();
        expect(current.queryByRole("alert")).toBeNull();
        expectPreservedSourceAndSelection();
      } finally {
        current.unmount();
        source.owner.destroy();
        source.container.remove();
        source.submissionField.remove();
      }
    },
  );

  it.each(["visible bootstrap", "resize recovery"] as const)(
    "admits a laid-out zero-height first root and completes its consumer (%s)",
    async (activation) => {
      const geometry = installSequenceGeometry();
      const signature = `zero-height-${activation}`;
      const sources = Array.from({ length: 320 }, (_, index) =>
        0 === index ? "#" : `Paragraph ${index}`,
      );
      const markdown = sources.join("\n\n");
      const editMap: PreviewEditMap = {
        version: 1,
        coordinate: "line",
        signature,
        blocks: sources.map((_source, index) => ({
          id: `b${index}`,
          startLine: index * 2,
          endLine: index * 2 + 1,
          editable: true,
        })),
      };
      const html = sources
        .map((text, index) =>
          0 === index
            ? '<h1 data-easymde-visual-block-id="b0"></h1>'
            : `<p data-easymde-visual-block-id="b${index}">${text}</p>`,
        )
        .join("");
      const source = markdownDocumentSource(markdown);
      source.owner.applyTextChange({
        value: markdown,
        selection: { direction: "backward", start: 5, end: 11 },
      });
      const sourceBefore = {
        value: source.owner.getValue(),
        selection: source.owner.getSelection(),
        revision: source.owner.getRevision(),
        history: source.owner.getHistoryState(),
        submission: source.submissionField.value,
      };
      const deliveredWindows: Array<PreviewAcceptedWindowSnapshot | null> = [];
      let current: ReturnType<typeof setup>;
      const onWindowReady = vi.fn(() =>
        deliveredWindows.push(current.runtime.getAcceptedWindowSnapshot()),
      );
      current = setup({
        contentEditable: true,
        initialEditMap: editMap,
        initialHtml: html,
        initialSignature: signature,
        currentSourceSnapshot: () => ({
          revision: source.owner.getRevision(),
          value: source.owner.getValue(),
        }),
        sourceRevision: source.owner.getRevision(),
        onWindowReady,
        stagingScheduler: { now: () => 0, yield: () => Promise.resolve() },
        windowed: false,
      });
      geometry.attach(current.canvas, current.surface);
      const restoreRootGeometry: Array<() => void> = [];
      try {
        await waitFor(() =>
          expect(
            current.surface.getAttribute("data-easymde-preview-phase"),
          ).toBe("ready"),
        );
        const roots = Array.from(current.surface.children);
        expect(roots).toHaveLength(sources.length);
        const content = roots.map((node) => node.innerHTML);
        const first = roots[0];
        const text = roots[1]?.firstChild;
        const selection = window.getSelection();
        if (
          !(first instanceof HTMLElement) ||
          !(text instanceof Text) ||
          !selection
        )
          throw new Error("zero-height-consumer-root-selection-missing");
        let laidOut = "visible bootstrap" === activation;
        const sequenceRect = vi
          .mocked(HTMLElement.prototype.getBoundingClientRect)
          .getMockImplementation();
        if (!sequenceRect)
          throw new Error("zero-height-consumer-sequence-geometry-missing");
        let surfaceWidth = 600;
        const surfaceRectDescriptor = Object.getOwnPropertyDescriptor(
          current.surface,
          "getBoundingClientRect",
        );
        restoreRootGeometry.push(() => {
          if (surfaceRectDescriptor)
            Object.defineProperty(
              current.surface,
              "getBoundingClientRect",
              surfaceRectDescriptor,
            );
          else Reflect.deleteProperty(current.surface, "getBoundingClientRect");
        });
        Object.defineProperty(current.surface, "getBoundingClientRect", {
          configurable: true,
          value: () => ({
            ...sequenceRect.call(current.surface),
            right: surfaceWidth,
            width: surfaceWidth,
          }),
        });
        for (const node of roots) {
          if (!(node instanceof HTMLElement))
            throw new Error("zero-height-consumer-root-missing");
          const descriptors = [
            "getBoundingClientRect",
            "getClientRects",
            "offsetHeight",
            "offsetWidth",
          ].map(
            (property) =>
              [
                property,
                Object.getOwnPropertyDescriptor(node, property),
              ] as const,
          );
          restoreRootGeometry.push(() => {
            for (const [property, descriptor] of descriptors) {
              if (descriptor) Object.defineProperty(node, property, descriptor);
              else Reflect.deleteProperty(node, property);
            }
          });
          node.style.marginBlockStart = node.style.marginBlockEnd = "0px";
          Object.defineProperty(node, "offsetHeight", {
            configurable: true,
            get: () => (laidOut && node !== first ? 24 : 0),
          });
          Object.defineProperty(node, "offsetWidth", {
            configurable: true,
            get: () => (laidOut ? 320 : 0),
          });
          Object.defineProperty(node, "getBoundingClientRect", {
            configurable: true,
            value: () =>
              !laidOut
                ? new DOMRect(0, 0, 0, 0)
                : node === first
                  ? previewRect(sequenceRect.call(node).top, 0)
                  : sequenceRect.call(node),
          });
          Object.defineProperty(node, "getClientRects", {
            configurable: true,
            value: () =>
              (laidOut
                ? [node.getBoundingClientRect()]
                : []) as unknown as DOMRectList,
          });
        }
        // The shared sequence fixture gives headings a 32px vertical slot.
        // Here that slot is an end margin: the actual border box is zero-height.
        first.style.marginBlockEnd = "32px";
        selection.setBaseAndExtent(text, 8, text, 2);
        current.setWindowed(true);
        if (!laidOut) {
          await act(async () => flushAnimationFrames(2));
          expect(current.runtime.getAcceptedWindowSnapshot()).toBeNull();
          expect(onWindowReady).not.toHaveBeenCalled();
          expect(Array.from(current.surface.children)).toEqual(roots);
          laidOut = true;
          window.dispatchEvent(new Event("resize"));
        }
        await waitFor(() => {
          expect(onWindowReady).toHaveBeenCalled();
          const accepted = current.runtime.getAcceptedWindowSnapshot();
          expect(accepted?.signature).toBe(signature);
          expect(
            accepted?.blocks.find((block) => block.id === "b0")?.node,
          ).toBe(first);
        });
        const accepted = current.runtime.getAcceptedWindowSnapshot();
        expect(accepted?.editMap).toEqual(editMap);
        expect(accepted?.sourceRevision).toBe(sourceBefore.revision);
        expect(accepted?.blocks.length).toBeGreaterThan(1);
        expect(accepted?.blocks.length).toBeLessThanOrEqual(160);
        expect(current.surface.contains(roots[319] ?? null)).toBe(false);
        let coveredThrough = 0;
        for (const range of previewWindowRanges(
          Array.from(current.surface.children),
        )) {
          expect(range.start).toBe(coveredThrough);
          expect(range.end).toBeGreaterThan(range.start);
          coveredThrough = range.end;
        }
        expect(coveredThrough).toBe(sources.length);
        expect(first.getBoundingClientRect().height).toBe(0);
        expect(first.offsetHeight).toBe(0);
        expect(first.getBoundingClientRect().width).toBe(320);
        expect(first.getClientRects()).toHaveLength(1);
        expect(
          first.getBoundingClientRect().top + current.canvas.scrollTop,
        ).toBe(0);
        expect({
          value: source.owner.getValue(),
          selection: source.owner.getSelection(),
          revision: source.owner.getRevision(),
          history: source.owner.getHistoryState(),
          submission: source.submissionField.value,
        }).toEqual(sourceBefore);
        expect(selection.anchorNode).toBe(text);
        expect(selection.anchorOffset).toBe(8);
        expect(selection.focusNode).toBe(text);
        expect(selection.focusOffset).toBe(2);
        expect(current.surface.getBoundingClientRect().width).toBe(600);
        onWindowReady.mockClear();
        deliveredWindows.length = 0;
        surfaceWidth = 700;
        act(() => window.dispatchEvent(new Event("resize")));
        await waitFor(() => {
          const resized = current.runtime.getAcceptedWindowSnapshot();
          expect(onWindowReady).toHaveBeenCalled();
          expect(resized?.signature).toBe(signature);
          expect(resized?.blocks.find((block) => block.id === "b0")?.node).toBe(
            first,
          );
          const delivered = deliveredWindows.at(-1);
          expect(delivered?.signature).toBe(signature);
          expect(delivered?.sourceRevision).toBe(sourceBefore.revision);
          expect(delivered?.editMap).toEqual(editMap);
          expect(
            delivered?.blocks.find((block) => block.id === "b0")?.node,
          ).toBe(first);
        });
        const resized = current.runtime.getAcceptedWindowSnapshot();
        expect(resized?.editMap).toEqual(editMap);
        expect(resized?.sourceRevision).toBe(sourceBefore.revision);
        expect(resized?.nodes).toEqual(Array.from(current.surface.childNodes));
        expect(resized?.blocks.length).toBeGreaterThan(1);
        expect(resized?.blocks.length).toBeLessThanOrEqual(160);
        expect(first.getBoundingClientRect().width).toBe(320);
        expect(first.getBoundingClientRect().height).toBe(0);
        expect(first.offsetHeight).toBe(0);
        expect(first.getClientRects()).toHaveLength(1);
        expect(current.onDiagnostic).not.toHaveBeenCalled();
        expect(current.queryByRole("alert")).toBeNull();
        expect(current.surface.getAttribute("aria-busy")).toBe("false");
        expect({
          value: source.owner.getValue(),
          selection: source.owner.getSelection(),
          revision: source.owner.getRevision(),
          history: source.owner.getHistoryState(),
          submission: source.submissionField.value,
        }).toEqual(sourceBefore);
        expect(selection.anchorNode).toBe(text);
        expect(selection.anchorOffset).toBe(8);
        expect(selection.focusNode).toBe(text);
        expect(selection.focusOffset).toBe(2);
        let materialized: boolean | undefined;
        act(() => {
          void current.runtime.materialize().then((value) => {
            materialized = value;
          });
        });
        await waitFor(() => expect(materialized).toBe(true));
        expect(Array.from(current.surface.children)).toEqual(roots);
        expect(roots.map((node) => node.innerHTML)).toEqual(content);
        expect(first.tagName).toBe("H1");
        expect(first.textContent).toBe("");
        expect(
          current.surface.querySelector("[data-easymde-preview-window-spacer]"),
        ).toBeNull();
        expect(current.surface.getAttribute("data-easymde-preview-phase")).toBe(
          "ready",
        );
        expect(current.surface.getAttribute("aria-busy")).toBe("false");
        expect(current.onDiagnostic).not.toHaveBeenCalled();
        expect(current.queryByRole("alert")).toBeNull();
        expect({
          value: source.owner.getValue(),
          selection: source.owner.getSelection(),
          revision: source.owner.getRevision(),
          history: source.owner.getHistoryState(),
          submission: source.submissionField.value,
        }).toEqual(sourceBefore);
        expect(selection.anchorNode).toBe(text);
        expect(selection.anchorOffset).toBe(8);
        expect(selection.focusNode).toBe(text);
        expect(selection.focusOffset).toBe(2);
        expect(text.isConnected).toBe(true);
      } finally {
        current.unmount();
        for (const restore of restoreRootGeometry) restore();
        source.owner.destroy();
        source.container.remove();
        source.submissionField.remove();
        geometry.restore();
      }
    },
  );

  it("prepares a connected full surface in bounded slices before the first window commit", async () => {
    const fixture = windowedFixture(320, "window-bootstrap");
    const newlineSeparatedHtml = safeHtml(
      fixture.html.replaceAll("><", ">\n<"),
    );
    const diagnostics: string[] = [];
    let now = 0;
    let yieldCount = 0;
    const current = setup({
      initialEditMap: fixture.editMap,
      initialHtml: newlineSeparatedHtml,
      initialSignature: fixture.editMap.signature,
      onDiagnostic: (code) => diagnostics.push(code),
      stagingScheduler: {
        now: () => (now += 1),
        yield: async () => {
          yieldCount += 1;
          await Promise.resolve();
        },
      },
      windowed: false,
    });
    await act(async () => {
      for (let index = 0; index < 16; index += 1) await Promise.resolve();
      await flushAnimationFrames(8);
    });
    for (const [index, node] of Array.from(
      current.surface.children,
    ).entries()) {
      if (!(node instanceof HTMLElement))
        throw new Error("window-bootstrap-root-not-element");
      node.style.marginBlockStart = "0px";
      node.style.marginBlockEnd = "0px";
      Object.defineProperty(node, "offsetHeight", {
        configurable: true,
        value: 24,
      });
      vi.spyOn(node, "getBoundingClientRect").mockReturnValue({
        bottom: (index + 1) * 24,
        height: 24,
        left: 0,
        right: 320,
        top: index * 24,
        width: 320,
        x: 0,
        y: index * 24,
        toJSON: () => ({}),
      } as DOMRect);
    }

    current.setWindowed(true);
    await act(async () => {
      await Promise.resolve();
    });
    expect(
      current.surface.querySelector("[data-easymde-preview-window-spacer]"),
    ).toBeNull();
    expect(current.surface.children).toHaveLength(320);

    await act(async () => {
      for (let index = 0; index < 128; index += 1) await Promise.resolve();
      await flushAnimationFrames(8);
    });
    expect(yieldCount).toBeGreaterThan(1);
    expect(diagnostics).toEqual([]);
    expect(
      current.surface.querySelector("[data-easymde-preview-window-spacer]"),
    ).not.toBeNull();
    expect(
      current.surface.querySelectorAll("[data-easymde-visual-block-id]").length,
    ).toBeLessThanOrEqual(160);
    current.unmount();
  });

  it("remeasures mounted flow geometry after a same-epoch layout change", async () => {
    const fixture = windowedFixture(320, "window-same-epoch-layout");
    let sliced = true;
    let now = 0;
    let yieldCount = 0;
    const geometryReadByIndex = Array.from({ length: 320 }, () => 0);
    const geometry = Array.from({ length: 320 }, (_, index) => ({
      height: 24,
      top: index * 24,
    }));
    const current = setup({
      initialEditMap: fixture.editMap,
      initialHtml: fixture.html,
      initialSignature: fixture.editMap.signature,
      stagingScheduler: {
        now: () => {
          if (!sliced) return 0;
          now += 1;
          return now;
        },
        yield: async () => {
          yieldCount += 1;
          await Promise.resolve();
        },
      },
      windowed: false,
    });
    await act(async () => {
      for (let index = 0; index < 16; index += 1) await Promise.resolve();
      await flushAnimationFrames(8);
    });
    for (const [index, node] of Array.from(
      current.surface.children,
    ).entries()) {
      if (!(node instanceof HTMLElement))
        throw new Error("same-epoch-root-not-element");
      node.style.marginBlockStart = "0px";
      node.style.marginBlockEnd = "0px";
      Object.defineProperty(node, "offsetHeight", {
        configurable: true,
        value: 24,
      });
      vi.spyOn(node, "getBoundingClientRect").mockImplementation(() => {
        geometryReadByIndex[index] = (geometryReadByIndex[index] ?? 0) + 1;
        const metric = geometry[index];
        if (!metric) throw new Error("same-epoch-geometry-missing");
        return previewRect(metric.top, metric.height);
      });
    }

    current.setWindowed(true);
    await act(async () => {
      for (let index = 0; index < 128; index += 1) await Promise.resolve();
      await flushAnimationFrames(8);
    });
    expect(yieldCount).toBeGreaterThan(1);
    const firstRootReadsBeforeHotPass = geometryReadByIndex[0] ?? 0;
    const before = current.surface.querySelector<HTMLElement>(
      "[data-easymde-preview-window-spacer]",
    );
    expect(before).not.toBeNull();
    if (!before) throw new Error("same-epoch-spacer-missing");

    sliced = false;
    geometry[0] = { height: 48, top: 0 };
    for (let index = 1; index < geometry.length; index += 1) {
      geometry[index] = { height: 24, top: index * 24 + 24 };
    }
    current.canvas.dispatchEvent(new Event("scroll"));
    await act(async () => {
      await flushAnimationFrames(8);
    });
    expect(geometryReadByIndex[0]).toBeGreaterThan(firstRootReadsBeforeHotPass);

    const after = current.surface.querySelector<HTMLElement>(
      "[data-easymde-preview-window-spacer]",
    );
    expect(after).not.toBeNull();
    if (!after) throw new Error("same-epoch-updated-spacer-missing");
    current.unmount();
  });

  it("does not publish an estimated Ready window after an epoch reset during a transform", async () => {
    const fixture = windowedFixture(320, "window-reset-transform");
    const diagnostics: string[] = [];
    let surfaceWidth = 600;
    const current = setup({
      contentEditable: true,
      initialEditMap: fixture.editMap,
      initialHtml: fixture.html,
      initialSignature: fixture.editMap.signature,
      onDiagnostic: (code) => diagnostics.push(code),
      stagingScheduler: { yield: () => Promise.resolve() },
      windowed: false,
    });
    vi.spyOn(current.surface, "getBoundingClientRect").mockImplementation(
      () =>
        ({
          ...previewRect(0, 7680),
          right: surfaceWidth,
          width: surfaceWidth,
          toJSON: () => ({}),
        }) as DOMRect,
    );
    for (const [index, node] of Array.from(
      current.surface.children,
    ).entries()) {
      if (!(node instanceof HTMLElement))
        throw new Error("window-reset-transform-root-not-element");
      node.style.marginBlockStart = "0px";
      node.style.marginBlockEnd = "0px";
      Object.defineProperty(node, "offsetHeight", {
        configurable: true,
        value: 24,
      });
      vi.spyOn(node, "getBoundingClientRect").mockReturnValue(
        previewRect(index * 24, 24),
      );
    }
    current.setWindowed(true);
    await act(async () => {
      for (let index = 0; index < 64; index += 1) await Promise.resolve();
      await flushAnimationFrames(8);
    });
    const hovered = current.surface.querySelector<HTMLElement>(
      '[data-easymde-visual-block-id="b0"]',
    );
    if (!hovered) throw new Error("window-reset-transform-hovered-missing");
    hovered.style.transform = "scale(1.01)";
    Object.defineProperty(hovered, "offsetHeight", {
      configurable: true,
      value: 0,
    });
    vi.spyOn(hovered, "getBoundingClientRect").mockReturnValue(
      previewRect(0, 0),
    );

    surfaceWidth = 700;
    window.dispatchEvent(new Event("resize"));
    await act(async () => {
      await flushAnimationFrames(8);
    });
    expect(diagnostics).toContain(
      "preview-window-flow-measurement-unavailable",
    );
    expect(current.surface.getAttribute("contenteditable")).toBe("false");
    expect(
      current.surface.querySelector("[data-easymde-preview-window-spacer]"),
    ).not.toBeNull();
    current.unmount();
  });

  it("keeps an ordinary bounded resize usable with mounted current-epoch geometry", async () => {
    const fixture = windowedFixture(320, "window-reset-ordinary");
    const diagnostics: string[] = [];
    let surfaceWidth = 600;
    const current = setup({
      contentEditable: true,
      initialEditMap: fixture.editMap,
      initialHtml: fixture.html,
      initialSignature: fixture.editMap.signature,
      onDiagnostic: (code) => diagnostics.push(code),
      stagingScheduler: { yield: () => Promise.resolve() },
      windowed: false,
    });
    vi.spyOn(current.surface, "getBoundingClientRect").mockImplementation(
      () =>
        ({
          ...previewRect(0, 7680),
          right: surfaceWidth,
          width: surfaceWidth,
          toJSON: () => ({}),
        }) as DOMRect,
    );
    for (const [index, node] of Array.from(
      current.surface.children,
    ).entries()) {
      if (!(node instanceof HTMLElement))
        throw new Error("window-reset-ordinary-root-not-element");
      node.style.marginBlockStart = "0px";
      node.style.marginBlockEnd = "0px";
      Object.defineProperty(node, "offsetHeight", {
        configurable: true,
        value: 24,
      });
      vi.spyOn(node, "getBoundingClientRect").mockReturnValue(
        previewRect(index * 24, 24),
      );
    }
    current.setWindowed(true);
    await act(async () => {
      for (let index = 0; index < 64; index += 1) await Promise.resolve();
      await flushAnimationFrames(8);
    });
    const prototypeRect = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        const id = this.getAttribute("data-easymde-visual-block-id");
        if (id?.startsWith("b")) {
          const index = Number.parseInt(id.slice(1), 10);
          return previewRect(index * 24, 24);
        }
        return previewRect(0, 0);
      });

    surfaceWidth = 700;
    window.dispatchEvent(new Event("resize"));
    await act(async () => {
      await flushAnimationFrames(8);
    });
    expect(diagnostics).toEqual([]);
    expect(current.surface.getAttribute("contenteditable")).toBe("true");
    expect(
      current.surface.querySelectorAll("[data-easymde-visual-block-id]").length,
    ).toBeLessThanOrEqual(160);
    prototypeRect.mockRestore();
    current.unmount();
  });

  it("retains measured flow when the editing presentation class is added", async () => {
    const fixture = windowedFixture(320, "window-editing-class");
    const diagnostics: string[] = [];
    const geometry = Array.from({ length: 320 }, (_, index) => ({
      height: 24 + (index % 3) * 8,
      top: 0,
    }));
    let top = 0;
    for (const metric of geometry) {
      metric.top = top;
      top += metric.height;
    }
    const current = setup({
      className: "easymde-preview",
      contentEditable: true,
      initialEditMap: fixture.editMap,
      initialHtml: fixture.html,
      initialSignature: fixture.editMap.signature,
      onDiagnostic: (code) => diagnostics.push(code),
      stagingScheduler: { yield: () => Promise.resolve() },
      windowed: false,
    });
    await act(async () => {
      for (let index = 0; index < 16; index += 1) await Promise.resolve();
      await flushAnimationFrames(8);
    });
    for (const [index, node] of Array.from(
      current.surface.children,
    ).entries()) {
      if (!(node instanceof HTMLElement))
        throw new Error("window-editing-class-root-not-element");
      const metric = geometry[index];
      if (!metric) throw new Error("window-editing-class-geometry-missing");
      node.style.marginBlockStart = "0px";
      node.style.marginBlockEnd = "0px";
      Object.defineProperty(node, "offsetHeight", {
        configurable: true,
        value: metric.height,
      });
      vi.spyOn(node, "getBoundingClientRect").mockReturnValue(
        previewRect(metric.top, metric.height),
      );
    }

    current.setWindowed(true);
    await act(async () => {
      for (let index = 0; index < 128; index += 1) await Promise.resolve();
      await flushAnimationFrames(8);
    });
    const before = current.surface.querySelector<HTMLElement>(
      "[data-easymde-preview-window-spacer]",
    );
    if (!before) throw new Error("window-editing-class-spacer-missing");
    const beforeHeight = Number.parseFloat(before.style.blockSize);
    current.setClassName("easymde-preview easymde-immersive-visual-editor");
    await act(async () => {
      await flushAnimationFrames(8);
    });
    const after = current.surface.querySelector<HTMLElement>(
      "[data-easymde-preview-window-spacer]",
    );
    if (!after) throw new Error("window-editing-class-spacer-lost");
    expect(diagnostics).toEqual([]);
    expect(Number.parseFloat(after.style.blockSize)).toBe(beforeHeight);
    expect(current.surface.getAttribute("contenteditable")).toBe("true");
    current.unmount();
  });

  it("cancels a paused geometry bootstrap when a newer Preview supersedes it", async () => {
    const fixture = windowedFixture(320, "window-bootstrap-cancel");
    const pendingYields: Array<ReturnType<typeof deferred<void>>> = [];
    const diagnostics: string[] = [];
    const onWindowReady = vi.fn();
    let now = 0;
    const current = setup({
      initialEditMap: fixture.editMap,
      initialHtml: fixture.html,
      initialSignature: fixture.editMap.signature,
      onDiagnostic: (code) => diagnostics.push(code),
      onWindowReady,
      stagingScheduler: {
        now: () => {
          now += 1;
          return now;
        },
        yield: () => {
          const next = deferred<void>();
          pendingYields.push(next);
          return next.promise;
        },
      },
      windowed: false,
    });
    await act(async () => {
      for (let index = 0; index < 16; index += 1) await Promise.resolve();
      await flushAnimationFrames(8);
    });
    for (const [index, node] of Array.from(
      current.surface.children,
    ).entries()) {
      if (!(node instanceof HTMLElement))
        throw new Error("bootstrap-cancel-root-not-element");
      node.style.marginBlockStart = "0px";
      node.style.marginBlockEnd = "0px";
      Object.defineProperty(node, "offsetHeight", {
        configurable: true,
        value: 24,
      });
      vi.spyOn(node, "getBoundingClientRect").mockReturnValue(
        previewRect(index * 24, 24),
      );
    }

    current.setWindowed(true);
    await act(async () => {
      for (let index = 0; index < 32; index += 1) await Promise.resolve();
    });
    expect(pendingYields.length).toBeGreaterThan(0);
    expect(current.surface.children).toHaveLength(320);
    expect(
      current.surface.querySelector("[data-easymde-preview-window-spacer]"),
    ).toBeNull();

    act(() =>
      current.session.schedule(request("superseding", "superseding"), true),
    );
    for (const pending of pendingYields) pending.resolve();
    await act(async () => {
      for (let index = 0; index < 32; index += 1) await Promise.resolve();
      await flushAnimationFrames(8);
    });

    expect(onWindowReady).not.toHaveBeenCalled();
    expect(diagnostics).toEqual([]);
    expect(current.surface.children).toHaveLength(320);
    expect(
      current.surface.querySelector("[data-easymde-preview-window-spacer]"),
    ).toBeNull();
    current.unmount();
  });

  it("retains the installed bounded window when hot geometry becomes unavailable", async () => {
    const fixture = windowedFixture(320, "window-geometry-failure");
    const diagnostics: string[] = [];
    const current = setup({
      contentEditable: true,
      initialEditMap: fixture.editMap,
      initialHtml: fixture.html,
      initialSignature: fixture.editMap.signature,
      onDiagnostic: (code) => diagnostics.push(code),
      stagingScheduler: { yield: () => Promise.resolve() },
      windowed: true,
    });
    await act(async () => {
      for (let index = 0; index < 16; index += 1) await Promise.resolve();
      await flushAnimationFrames(12);
    });

    const first = current.surface.querySelector<HTMLElement>(
      '[data-easymde-visual-block-id="b0"]',
    );
    if (!first) throw new Error("window-geometry-failure-first-missing");
    first.style.transform = "scale(1.01)";
    vi.spyOn(first, "getBoundingClientRect").mockReturnValue({
      bottom: 24,
      height: 24,
      left: 0,
      right: 320,
      top: 0,
      width: 320,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    current.canvas.dispatchEvent(new Event("scroll"));
    await act(async () => {
      await flushAnimationFrames(8);
    });

    expect(diagnostics).toContain("preview-window-flow-transform-unmeasured");
    expect(
      current.surface.querySelectorAll("[data-easymde-visual-block-id]").length,
    ).toBeLessThanOrEqual(160);
    expect(
      current.surface.querySelector("[data-easymde-preview-window-spacer]"),
    ).not.toBeNull();
    expect(current.surface.getAttribute("contenteditable")).toBe("false");
    current.unmount();
  });

  it("advances only the explicitly adopted same-node content baseline", async () => {
    const geometry = installSequenceGeometry();
    const fixture = windowedFixture(320, "same-node-baseline");
    const current = setup({
      initialEditMap: fixture.editMap,
      initialHtml: fixture.html,
      initialSignature: fixture.editMap.signature,
      stagingScheduler: { yield: () => Promise.resolve() },
      windowed: true,
    });
    geometry.attach(current.canvas, current.surface);
    await act(async () => {
      for (let index = 0; index < 16; index += 1) await Promise.resolve();
      await flushAnimationFrames(8);
    });
    const original = current.runtime.getAcceptedWindowSnapshot();
    const target = current.surface.querySelector(
      '[data-easymde-visual-block-id="b0"]',
    );
    const unrelated = current.surface.querySelector(
      '[data-easymde-visual-block-id="b1"]',
    );
    if (!(target instanceof HTMLElement) || !(unrelated instanceof HTMLElement))
      throw new Error("same-node-baseline-target-missing");
    target.textContent = "accepted local content";
    unrelated.textContent = "unowned foreign mutation";
    const finalize = current.runtime.prepareWindowBlockAdoption(target);
    expect(finalize?.()).toBe(true);
    current.surface.ownerDocument.dispatchEvent(new Event("selectionchange"));
    await act(async () => flushAnimationFrames(8));
    const accepted = current.runtime.getAcceptedWindowSnapshot();
    expect(accepted?.blocks.find((block) => block.id === "b0")?.innerHTML).toBe(
      "accepted local content",
    );
    expect(accepted?.blocks.find((block) => block.id === "b1")?.innerHTML).toBe(
      "b1",
    );
    expect(
      accepted?.blocks.find((block) => block.id === "b1")?.innerHTML,
    ).not.toBe(unrelated.innerHTML);
    expect(original?.blocks.find((block) => block.id === "b0")?.innerHTML).toBe(
      "b0",
    );
    current.unmount();
    geometry.restore();
  });

  it("reuses accepted block baselines across a Ready-to-Ready window scroll", async () => {
    const geometry = installSequenceGeometry();
    const fixture = windowedFixture(320, "window-baseline-scroll");
    const current = setup({
      initialEditMap: fixture.editMap,
      initialHtml: fixture.html,
      initialSignature: fixture.editMap.signature,
      stagingScheduler: { yield: () => Promise.resolve() },
      windowed: true,
    });
    geometry.attach(current.canvas, current.surface);
    await act(async () => {
      for (let index = 0; index < 16; index += 1) await Promise.resolve();
      await flushAnimationFrames(12);
    });
    const initial = current.runtime.getAcceptedWindowSnapshot();
    expect(initial).not.toBeNull();

    const first = current.surface.querySelector<HTMLElement>(
      '[data-easymde-visual-block-id="b0"]',
    );
    if (!first) throw new Error("window-baseline-scroll-first-missing");
    first.textContent = "foreign edit";

    current.canvas.scrollTop = 7_440;
    current.canvas.dispatchEvent(new Event("scroll"));
    await act(async () => {
      for (let index = 0; index < 16; index += 1) await Promise.resolve();
      await flushAnimationFrames(12);
    });
    const bottom = current.runtime.getAcceptedWindowSnapshot();
    expect(bottom).not.toBeNull();

    current.canvas.scrollTop = 0;
    current.canvas.dispatchEvent(new Event("scroll"));
    await act(async () => {
      await flushAnimationFrames(8);
    });
    const restored = current.runtime.getAcceptedWindowSnapshot();
    expect(restored).not.toBeNull();
    expect(restored?.blocks.find((block) => block.id === "b0")?.innerHTML).toBe(
      "b0",
    );
    expect(restored?.key).not.toBe(initial?.key);
    current.unmount();
    geometry.restore();
  });

  it("retains only request-bound formal reference source across local changes", async () => {
    const geometry = installSequenceGeometry();
    const fixture = windowedFixture(320, "reference-source-witness");
    const markdown = Array.from(
      { length: 320 },
      (_, index) => `b${index}`,
    ).join("\n\n");
    let currentSource = markdown.replace("b0", "x0");
    const current = setup({
      currentSourceSnapshot: () => ({ revision: 0, value: currentSource }),
      initialEditMap: fixture.editMap,
      initialHtml: fixture.html,
      initialSignature: fixture.editMap.signature,
      sourceRevision: 0,
      stagingScheduler: { yield: () => Promise.resolve() },
      windowed: true,
    });
    geometry.attach(current.canvas, current.surface);
    try {
      await act(async () => {
        for (let index = 0; index < 16; index += 1) await Promise.resolve();
        await flushAnimationFrames(12);
      });
      const initial = current.runtime.getAcceptedWindowSnapshot();
      if (!initial) throw new Error("reference-source-initial-window-missing");
      const initialRequest = {
        revision: initial.revision,
        signature: initial.signature,
      };
      expect(currentSource.length).toBe(markdown.length);
      expect(
        current.runtime.getAcceptedReferenceSource(initialRequest),
      ).toBeNull();
      currentSource = markdown;
      act(() =>
        current.session.schedule(
          request(markdown, fixture.editMap.signature),
          true,
        ),
      );
      await act(async () => {
        current.responses[0]?.resolve({ ...fixture, features: {} });
        for (let index = 0; index < 32; index += 1) await Promise.resolve();
        await flushAnimationFrames(12);
      });
      const accepted = current.runtime.getAcceptedWindowSnapshot();
      if (!accepted)
        throw new Error("reference-source-accepted-window-missing");
      const acceptedRequest = {
        revision: accepted.revision,
        signature: accepted.signature,
      };
      expect(current.runtime.getAcceptedReferenceSource(acceptedRequest)).toBe(
        markdown,
      );
      currentSource = markdown.replace("b0", "x0");
      expect(current.runtime.getAcceptedReferenceSource(acceptedRequest)).toBe(
        markdown,
      );
      expect(
        current.runtime.getAcceptedReferenceSource({
          ...acceptedRequest,
          revision: acceptedRequest.revision + 1,
        }),
      ).toBeNull();
      currentSource = markdown;
      act(() =>
        current.session.schedule(
          request(markdown, fixture.editMap.signature),
          true,
        ),
      );
      await act(async () => {
        current.responses[1]?.resolve({ ...fixture, features: {} });
        for (let index = 0; index < 32; index += 1) await Promise.resolve();
        await flushAnimationFrames(12);
      });
      const newer = current.runtime.getAcceptedWindowSnapshot();
      if (!newer) throw new Error("reference-source-new-window-missing");
      expect(
        current.runtime.getAcceptedReferenceSource(acceptedRequest),
      ).toBeNull();
      expect(
        current.runtime.getAcceptedReferenceSource({
          revision: newer.revision,
          signature: newer.signature,
        }),
      ).toBe(markdown);
    } finally {
      current.unmount();
      geometry.restore();
    }
  });

  it("certifies an unmounted formal row without exposing a mutable repository node", async () => {
    const geometry = installSequenceGeometry();
    const fixture = windowedFixture(320, "formal-row-witness");
    const markdown = Array.from(
      { length: 320 },
      (_, index) => `b${index}`,
    ).join("\n\n");
    let currentSource = markdown;
    let currentRevision = 0;
    const current = setup({
      currentSourceSnapshot: () => ({
        revision: currentRevision,
        value: currentSource,
      }),
      initialEditMap: fixture.editMap,
      initialHtml: fixture.html,
      initialSignature: fixture.editMap.signature,
      sourceRevision: 0,
      stagingScheduler: { yield: () => Promise.resolve() },
      windowed: true,
    });
    geometry.attach(current.canvas, current.surface);
    try {
      await act(async () => {
        for (let index = 0; index < 16; index += 1) await Promise.resolve();
        await flushAnimationFrames(12);
      });
      const accepted = current.runtime.getAcceptedWindowSnapshot();
      if (!accepted) throw new Error("formal-row-witness-snapshot-missing");
      expect(
        current.surface.querySelector('[data-easymde-visual-block-id="b319"]'),
      ).toBeNull();
      const rowRequest = {
        id: "b319",
        index: 319,
        revision: accepted.revision,
        signature: accepted.signature,
      };
      const row = current.runtime.getAcceptedWindowRow(rowRequest);
      expect(row?.source).toBe(markdown);
      expect(row?.sourceRange).toEqual({
        start: markdown.lastIndexOf("b319"),
        end: markdown.length,
      });
      expect(row?.root.isConnected).toBe(false);
      expect(row?.root.textContent).toBe("b319");
      if (!row) throw new Error("formal-row-witness-missing");
      row.root.textContent = "foreign clone mutation";
      expect(
        current.runtime.getAcceptedWindowRow(rowRequest)?.root.textContent,
      ).toBe("b319");
      currentSource = `${markdown}\nnew`;
      currentRevision += 1;
      expect(current.runtime.getAcceptedWindowRow(rowRequest)?.source).toBe(
        markdown,
      );
      expect(
        current.runtime.getAcceptedWindowRow({
          ...rowRequest,
          revision: rowRequest.revision + 1,
        }),
      ).toBeNull();
      expect(
        current.runtime.getAcceptedWindowRow({ ...rowRequest, index: 318 }),
      ).toBeNull();
      const first = current.surface.querySelector(
        '[data-easymde-visual-block-id="b0"]',
      );
      if (!(first instanceof HTMLElement))
        throw new Error("formal-row-witness-first-missing");
      first.setAttribute("contenteditable", "false");
      expect(
        current.runtime.getAcceptedWindowRow({
          ...rowRequest,
          id: "b0",
          index: 0,
        }),
      ).toBeNull();
      currentSource = markdown;
      currentRevision = 0;
      act(() =>
        current.session.schedule(
          request(markdown, fixture.editMap.signature),
          true,
        ),
      );
      await act(async () => {
        current.responses[0]?.resolve({ ...fixture, features: {} });
        for (let index = 0; index < 32; index += 1) await Promise.resolve();
        await flushAnimationFrames(12);
      });
      const fresh = current.runtime.getAcceptedWindowSnapshot();
      if (!fresh) throw new Error("formal-row-witness-new-snapshot-missing");
      expect(fresh.revision).not.toBe(rowRequest.revision);
      expect(current.runtime.getAcceptedWindowRow(rowRequest)).toBeNull();
      expect(
        current.runtime.getAcceptedWindowRow({
          ...rowRequest,
          revision: fresh.revision,
        })?.source,
      ).toBe(markdown);
    } finally {
      current.unmount();
      geometry.restore();
    }
  });

  it("reveals an accepted unmounted row without displacing the retained end gap", async () => {
    const geometry = installSequenceGeometry();
    const fixture = windowedFixture(320, "reveal-formal-row");
    const markdown = Array.from(
      { length: 320 },
      (_, index) => `b${index}`,
    ).join("\n\n");
    const current = setup({
      contentEditable: true,
      currentSourceSnapshot: () => ({ revision: 0, value: markdown }),
      initialEditMap: fixture.editMap,
      initialHtml: fixture.html,
      initialSignature: fixture.editMap.signature,
      sourceRevision: 0,
      stagingScheduler: { yield: () => Promise.resolve() },
      windowed: true,
    });
    geometry.attach(current.canvas, current.surface);
    try {
      await act(async () => {
        for (let index = 0; index < 16; index += 1) await Promise.resolve();
        await flushAnimationFrames(12);
      });
      current.canvas.scrollTop = 7440;
      current.canvas.dispatchEvent(new Event("scroll"));
      await act(async () => {
        await flushAnimationFrames(12);
      });
      const accepted = current.runtime.getAcceptedWindowSnapshot();
      if (!accepted) throw new Error("reveal-window-snapshot-missing");
      expect(
        current.surface.querySelector('[data-easymde-visual-block-id="b0"]'),
      ).toBeNull();
      const gap = document.createElement("p");
      gap.append(document.createElement("br"));
      current.surface.append(gap);
      current.surface.tabIndex = 0;
      current.surface.focus();
      window.getSelection()?.collapse(gap, 0);
      const lease = current.runtime.retainCompositionSurface();
      lease.retainGap?.({
        node: gap,
        markdown,
        sourceRevision: 0,
        html: gap.innerHTML,
        surface: current.surface,
        historyState: { undoDepth: 0, redoDepth: 0 },
        before: {
          start: markdown.lastIndexOf("b319"),
          end: markdown.length,
          source: "b319",
        },
        after: { start: markdown.length, end: markdown.length, source: "" },
        isLive: () => gap.parentNode === current.surface,
      });
      lease.release();
      const request = {
        gap,
        id: "b0",
        index: 0,
        revision: accepted.revision,
        signature: accepted.signature,
        source: markdown,
        sourceRevision: 0,
      };
      const refusal = vi.fn();
      expect(
        current.runtime.revealAcceptedWindowRow({
          ...request,
          sourceRevision: 1,
          onRefusal: refusal,
        }),
      ).toBeNull();
      expect(refusal).toHaveBeenCalledWith(
        "source-epoch",
        expect.objectContaining({
          sourceMatches: true,
          sourceRevisionMatches: false,
        }),
      );
      expect(JSON.stringify(refusal.mock.calls)).not.toContain(markdown);
      let revealed: ReturnType<typeof current.runtime.revealAcceptedWindowRow> =
        null;
      act(() => {
        revealed = current.runtime.revealAcceptedWindowRow(request);
      });
      expect(revealed).not.toBeNull();
      expect(
        current.surface.querySelector('[data-easymde-visual-block-id="b0"]')
          ?.isConnected,
      ).toBe(true);
      expect(gap.isConnected).toBe(true);
      expect(window.getSelection()?.anchorNode).toBe(gap);
      expect(current.runtime.getAcceptedWindowSnapshot()).toEqual(revealed);

      let revealedNext: ReturnType<
        typeof current.runtime.revealAcceptedWindowRow
      > = null;
      act(() => {
        revealedNext = current.runtime.revealAcceptedWindowRow({
          ...request,
          id: "b1",
          index: 1,
        });
      });
      expect(revealedNext).not.toBeNull();
      expect(
        current.surface.querySelector('[data-easymde-visual-block-id="b1"]')
          ?.isConnected,
      ).toBe(true);
      expect(gap.isConnected).toBe(true);
      expect(window.getSelection()?.anchorNode).toBe(gap);
      expect(current.runtime.getAcceptedWindowSnapshot()).toEqual(revealedNext);
    } finally {
      current.unmount();
      geometry.restore();
    }
  });

  it("installs the accepted document-end row synchronously before the first key in a windowed lifecycle", async () => {
    const geometry = installSequenceGeometry();
    const fixture = windowedFixture(320, "live-document-end-first-key");
    const markdown = Array.from(
      { length: 320 },
      (_, index) => `b${index}`,
    ).join("\n\n");
    const sourceDocument = markdownDocumentSource(markdown);
    const revision = () => sourceDocument.owner.getRevision?.() ?? 0;
    const diagnostics: string[] = [];
    const current = setup({
      contentEditable: true,
      currentSourceSnapshot: () => ({
        revision: revision(),
        value: sourceDocument.owner.getValue(),
      }),
      initialEditMap: fixture.editMap,
      initialHtml: fixture.html,
      initialSignature: fixture.editMap.signature,
      sourceRevision: 0,
      stagingScheduler: { yield: () => Promise.resolve() },
      windowed: true,
      onDiagnostic: (code) => diagnostics.push(code),
    });
    geometry.attach(current.canvas, current.surface);
    let view: RenderResult | null = null;
    try {
      await act(async () => {
        for (let index = 0; index < 16; index += 1) await Promise.resolve();
        await flushAnimationFrames(12);
      });
      const accepted = current.runtime.getAcceptedWindowSnapshot();
      if (!accepted)
        throw new Error("live-document-end-initial-snapshot-missing");
      expect(
        current.surface.querySelector('[data-easymde-visual-block-id="b319"]'),
      ).toBeNull();
      expect(
        Array.from(current.surface.children)
          .at(-1)
          ?.hasAttribute("data-easymde-preview-window-spacer"),
      ).toBe(true);
      const requestPreview = (next: string) => {
        const signature = `live-document-end-${revision() + 1}`;
        current.session.schedule(request(next, signature), true);
        return signature;
      };
      const requestPreviewAtDocumentEnd = (
        next: string,
        selection?: Readonly<{ end: number; start: number }>,
      ) => {
        const pin = current.runtime.prepareDocumentEndWindowPin(
          `live-document-end-${revision() + 1}`,
          selection,
        );
        try {
          return { signature: requestPreview(next), release: pin.release };
        } catch (error) {
          pin.release();
          throw error;
        }
      };
      const onFailure = vi.fn();
      const syntheticPreview = {
        editMap: fixture.editMap,
        revision: accepted.revision,
        signature: accepted.signature,
      };
      const visual = () => (
        <WindowedImmersiveVisualEditor
          referenceLabelCaseFoldProfile={14}
          acceptedWindowSnapshotGeneration={accepted.revision}
          documentSession={sourceDocument.session}
          editMap={fixture.editMap}
          getAcceptedWindowRow={current.runtime.getAcceptedWindowRow}
          getAcceptedWindowSnapshot={current.runtime.getAcceptedWindowSnapshot}
          imagePasteUploadEnabled={false}
          imageUploadEnabled={false}
          onCanonicalDocumentChange={vi.fn()}
          onDiagnostic={vi.fn()}
          onDispose={vi.fn()}
          onFailure={onFailure}
          onMarkdownChange={vi.fn()}
          onPendingChange={vi.fn()}
          onReady={vi.fn()}
          onTransferFailure={vi.fn()}
          pending={false}
          prepareWindowBlockAdoption={
            current.runtime.prepareWindowBlockAdoption
          }
          previewSnapshot={syntheticPreview}
          previewStatus="ready"
          requestPreview={requestPreview}
          requestPreviewAtDocumentEnd={requestPreviewAtDocumentEnd}
          retainCompositionSurface={() =>
            current.runtime.retainCompositionSurface()
          }
          revealAcceptedWindowRow={current.runtime.revealAcceptedWindowRow}
          surface={current.surface}
        />
      );
      view = render(visual());
      current.surface.tabIndex = 0;
      current.surface.focus();
      window
        .getSelection()
        ?.collapse(current.surface, current.surface.childNodes.length);
      act(() => {
        current.surface.ownerDocument.dispatchEvent(
          new Event("selectionchange"),
        );
      });
      const first = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Backspace",
      });
      act(() => {
        current.surface.dispatchEvent(first);
      });
      const row = current.surface.querySelector<HTMLElement>(
        '[data-easymde-visual-block-id="b319"]',
      );
      if (!(row instanceof HTMLElement))
        throw new Error("live-document-end-row-missing");
      const revealed = current.runtime.getAcceptedWindowSnapshot();
      expect(revealed?.key).toBeGreaterThan(accepted.key);
      expect(revealed?.nodes).toContain(row);
      expect(revealed?.ownedGap).toBeUndefined();
      expect(row.contains(window.getSelection()?.anchorNode ?? null)).toBe(
        true,
      );
      expect(sourceDocument.owner.getValue()).toBe(markdown);
      expect(onFailure).not.toHaveBeenCalled();
      expect(diagnostics).toEqual([]);
      await act(async () => {
        await flushAnimationFrames(4);
      });
      expect(
        current.surface.querySelector('[data-easymde-visual-block-id="b319"]'),
      ).toBe(row);
      expect(row.contains(window.getSelection()?.anchorNode ?? null)).toBe(
        true,
      );
      expect(
        current.runtime.getAcceptedWindowSnapshot()?.key,
      ).toBeGreaterThanOrEqual(revealed?.key ?? -1);
    } finally {
      view?.unmount();
      current.unmount();
      sourceDocument.session.destroy();
      sourceDocument.container.remove();
      sourceDocument.submissionField.remove();
      geometry.restore();
    }
  });

  it.each(["Backspace", "text input"] as const)(
    "keeps the first %s local through the real windowed owner and continues from its natural caret",
    async (action) => {
      const live = await mountLiveWindowedDocumentEnd(
        `live-first-${"Backspace" === action ? "backspace" : "text-input"}`,
      );
      try {
        const { onFailure, revealed, row } = live.reveal();
        expect(revealed.ownedGap).toBeUndefined();
        expect(onFailure).not.toHaveBeenCalled();
        const terminalSelection = () => {
          const natural = window.getSelection();
          if (
            !natural ||
            natural.rangeCount !== 1 ||
            !natural.isCollapsed ||
            natural.anchorNode !== natural.focusNode ||
            !row.contains(natural.anchorNode)
          )
            throw new Error("live-first-edit-natural-selection-missing");
          const naturalRange = natural.getRangeAt(0);
          const caretFromRowStart = document.createRange();
          caretFromRowStart.setStart(row, 0);
          caretFromRowStart.setEnd(
            naturalRange.startContainer,
            naturalRange.startOffset,
          );
          // Compare visible semantic position, not the DOM boundary container:
          // P@childCount and Text@end are equivalent terminal carets.
          expect(caretFromRowStart.toString().length).toBe(
            (row.textContent ?? "").length,
          );
          return naturalRange;
        };
        // The reveal itself must leave a real collapsed caret at the
        // terminal visible end. P@childCount is a legal EOF caret.
        const initialNatural = terminalSelection().cloneRange();
        const nodesBefore = Array.from(live.current.surface.childNodes);
        const historyBefore = live.sourceDocument.owner.getHistoryState();
        let expected: string;
        let expectedVisible: string;
        if ("Backspace" === action) {
          let deletionText: Text | null =
            initialNatural.startContainer instanceof Text &&
            initialNatural.startOffset > 0
              ? initialNatural.startContainer
              : null;
          if (!deletionText) {
            const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
            while (walker.nextNode()) {
              const candidate = walker.currentNode;
              if (candidate instanceof Text && candidate.length > 0) {
                deletionText = candidate;
              }
            }
          }
          if (!deletionText) {
            throw new Error("live-first-edit-previous-character-missing");
          }
          const range = document.createRange();
          range.setStart(deletionText, deletionText.length - 1);
          range.setEnd(deletionText, deletionText.length);
          const before = new InputEvent("beforeinput", {
            bubbles: true,
            cancelable: true,
            inputType: "deleteContentBackward",
          });
          Object.defineProperty(before, "getTargetRanges", {
            value: () => [range],
          });
          await act(async () => {
            live.current.surface.dispatchEvent(before);
            if (!before.defaultPrevented) {
              // Browser default mutation happens only after an
              // uncancelled beforeinput event.
              range.deleteContents();
              window
                .getSelection()
                ?.collapse(range.startContainer, range.startOffset);
              live.current.surface.dispatchEvent(
                new InputEvent("input", {
                  bubbles: true,
                  inputType: "deleteContentBackward",
                }),
              );
            }
            live.syncSourceRevision();
            for (let index = 0; index < 8; index += 1) {
              await Promise.resolve();
            }
          });
          expected = live.markdown.slice(0, -1);
          expectedVisible = "b31";
        } else {
          const range = initialNatural.cloneRange();
          const before = new InputEvent("beforeinput", {
            bubbles: true,
            cancelable: true,
            data: "X",
            inputType: "insertText",
          });
          Object.defineProperty(before, "getTargetRanges", {
            value: () => [range],
          });
          await act(async () => {
            live.current.surface.dispatchEvent(before);
            if (!before.defaultPrevented) {
              let caretNode: Node = range.startContainer;
              let caretOffset = range.startOffset + 1;
              if (range.startContainer instanceof Text) {
                range.startContainer.insertData(range.startOffset, "X");
              } else {
                const inserted = document.createTextNode("X");
                range.startContainer.insertBefore(
                  inserted,
                  range.startContainer.childNodes[range.startOffset] ?? null,
                );
                caretNode = inserted;
                caretOffset = 1;
              }
              live.current.surface.ownerDocument.defaultView
                ?.getSelection()
                ?.collapse(caretNode, caretOffset);
              live.current.surface.dispatchEvent(
                new InputEvent("input", {
                  bubbles: true,
                  data: "X",
                  inputType: "insertText",
                }),
              );
            }
            live.syncSourceRevision();
            for (let index = 0; index < 8; index += 1) {
              await Promise.resolve();
            }
          });
          expected = `${live.markdown}X`;
          expectedVisible = "b319X";
        }
        expect(live.sourceDocument.owner.getValue()).toBe(expected);
        const historyAfterFirst = live.sourceDocument.owner.getHistoryState();
        expect(historyAfterFirst.undoDepth).toBeGreaterThan(
          historyBefore.undoDepth,
        );
        expect(historyAfterFirst.redoDepth).toBe(0);
        expect(
          live.current.surface.querySelector(
            "[data-easymde-visual-block-id='b319']",
          ),
        ).toBe(row);
        expect(Array.from(live.current.surface.childNodes)).toEqual(
          nodesBefore,
        );
        expect(row.textContent).toBe(expectedVisible);
        terminalSelection();
        expect(live.requests).toHaveLength(0);
        expect(live.current.responses).toHaveLength(0);
        expect(live.onMarkdownChange).toHaveBeenCalled();
        expect(onFailure).not.toHaveBeenCalled();
        expect(live.onTransferFailure).not.toHaveBeenCalled();
        expect(live.onDispose).not.toHaveBeenCalled();
        expect(live.onCanonicalDocumentChange).not.toHaveBeenCalled();
        expect(live.diagnostics).toEqual([]);
        expect(live.windowedDiagnostics).toEqual([]);

        // Continue with the caret left by the first edit. There is no
        // pre-key collapse or DOM rescue in this emulation.
        const continuationTarget = terminalSelection().cloneRange();
        const continuation = new InputEvent("beforeinput", {
          bubbles: true,
          cancelable: true,
          data: "Y",
          inputType: "insertText",
        });
        Object.defineProperty(continuation, "getTargetRanges", {
          value: () => [continuationTarget],
        });
        await act(async () => {
          live.current.surface.dispatchEvent(continuation);
          if (!continuation.defaultPrevented) {
            let caretNode: Node = continuationTarget.startContainer;
            let caretOffset = continuationTarget.startOffset + 1;
            if (continuationTarget.startContainer instanceof Text) {
              continuationTarget.startContainer.insertData(
                continuationTarget.startOffset,
                "Y",
              );
            } else {
              const inserted = document.createTextNode("Y");
              continuationTarget.startContainer.insertBefore(
                inserted,
                continuationTarget.startContainer.childNodes[
                  continuationTarget.startOffset
                ] ?? null,
              );
              caretNode = inserted;
              caretOffset = 1;
            }
            window.getSelection()?.collapse(caretNode, caretOffset);
            live.current.surface.dispatchEvent(
              new InputEvent("input", {
                bubbles: true,
                data: "Y",
                inputType: "insertText",
              }),
            );
          }
          live.syncSourceRevision();
          for (let index = 0; index < 8; index += 1) {
            await Promise.resolve();
          }
        });
        expect(live.sourceDocument.owner.getValue()).toBe(`${expected}Y`);
        expect(
          live.sourceDocument.owner.getHistoryState().undoDepth,
        ).toBeGreaterThan(historyBefore.undoDepth);
        expect(
          live.current.surface.querySelector(
            "[data-easymde-visual-block-id='b319']",
          ),
        ).toBe(row);
        expect(row.textContent).toBe(`${expectedVisible}Y`);
        terminalSelection();
        expect(live.requests).toHaveLength(0);
        expect(onFailure).not.toHaveBeenCalled();
        expect(live.onTransferFailure).not.toHaveBeenCalled();
        expect(live.onDispose).not.toHaveBeenCalled();
        expect(live.diagnostics).toEqual([]);
        expect(live.windowedDiagnostics).toEqual([]);
      } finally {
        live.cleanup();
      }
    },
  );

  it("requests the public document-end Preview path for the first structural Enter", async () => {
    const live = await mountLiveWindowedDocumentEnd("live-first-enter");
    try {
      const { onFailure, row } = live.reveal();
      const natural = window.getSelection();
      if (
        !natural ||
        natural.rangeCount !== 1 ||
        !natural.isCollapsed ||
        !row.contains(natural.anchorNode)
      )
        throw new Error("live-first-enter-natural-selection-missing");
      const target = natural.getRangeAt(0).cloneRange();
      const historyBefore = live.sourceDocument.owner.getHistoryState();
      const readyCallsBefore = live.ownerSnapshotReady.length;
      const editorReadyCallsBefore = live.onReady.mock.calls.length;
      const acceptedWindowNotificationsBefore =
        live.getWindowedState().acceptedWindowNotifications;
      const windowReadyKeysBefore = live.windowReadyKeys.length;
      await act(async () => {
        const key = new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "Enter",
        });
        live.current.surface.dispatchEvent(key);
        if (!key.defaultPrevented) {
          const before = new InputEvent("beforeinput", {
            bubbles: true,
            cancelable: true,
            inputType: "insertParagraph",
          });
          Object.defineProperty(before, "getTargetRanges", {
            value: () => [target],
          });
          live.current.surface.dispatchEvent(before);
          if (!before.defaultPrevented) {
            const paragraph = document.createElement("p");
            paragraph.append(document.createElement("br"));
            row.after(paragraph);
            window.getSelection()?.collapse(paragraph, 0);
            live.current.surface.dispatchEvent(
              new InputEvent("input", {
                bubbles: true,
                inputType: "insertParagraph",
              }),
            );
          }
        }
        live.syncSourceRevision();
        for (let index = 0; index < 8; index += 1) {
          await Promise.resolve();
        }
      });
      const expected = `${live.markdown}\n\n`;
      expect(expected.endsWith("\n\n")).toBe(true);
      expect(live.sourceDocument.owner.getValue()).toBe(expected);
      expect(
        live.sourceDocument.owner.getHistoryState().undoDepth,
      ).toBeGreaterThan(historyBefore.undoDepth);
      expect(
        live.current.surface.querySelector(
          "[data-easymde-visual-block-id='b319']",
        ),
      ).toBe(row);
      expect(live.requests).toHaveLength(1);
      const requested = live.requests[0];
      if (!requested) throw new Error("live-first-enter-request-missing");
      expect(requested.path).toBe("document-end");
      expect(requested.markdown).toBe(expected);
      expect(live.pendingChanges).toContain(true);
      expect(live.getWindowedState().pending).toBe(true);
      expect(live.onReady).toHaveBeenCalledTimes(editorReadyCallsBefore);
      expect(live.onDispose).not.toHaveBeenCalled();
      expect(onFailure).not.toHaveBeenCalled();
      expect(live.onTransferFailure).not.toHaveBeenCalled();
      const { preview: resolvedPreview } = await live.resolvePreview();
      expect(resolvedPreview.editMap.blocks).toHaveLength(320);
      expect(resolvedPreview.editMap.blocks.at(-1)).toMatchObject({
        id: "b319",
        startLine: 638,
        endLine: 639,
      });
      expect(live.ownerSnapshotReady.length).toBeGreaterThan(readyCallsBefore);
      expect(live.ownerSnapshotReady.at(-1)?.signature).toBe(
        requested.signature,
      );
      expect(live.getWindowedState().previewSnapshot.signature).toBe(
        requested.signature,
      );
      expect(live.getWindowedState().pending).toBe(false);
      expect(live.pendingChanges.at(-1)).toBe(false);
      const accepted = live.current.runtime.getAcceptedWindowSnapshot();
      if (!accepted)
        throw new Error("live-first-enter-accepted-snapshot-missing");
      expect(live.windowReadyKeys).toHaveLength(windowReadyKeysBefore + 1);
      expect(live.windowReadyKeys.at(-1)).toBe(accepted.key);
      expect(live.getWindowedState().acceptedWindowNotifications).toBe(
        acceptedWindowNotificationsBefore + 1,
      );
      expect(live.onReady).toHaveBeenCalledTimes(editorReadyCallsBefore);
      expect(live.onDispose).not.toHaveBeenCalled();
      expect(accepted.signature).toBe(requested.signature);
      expect(accepted.nodes).toEqual(
        Array.from(live.current.surface.childNodes),
      );
      expect(accepted.editMap?.blocks).toHaveLength(320);
      expect(accepted.editMap?.blocks.at(-1)).toMatchObject({
        id: "b319",
        startLine: 638,
        endLine: 639,
      });
      expect(
        live.getWindowedState().previewSnapshot.editMap?.blocks.at(-1),
      ).toMatchObject({ id: "b319", startLine: 638, endLine: 639 });
      expect(live.ownerStatusChanges.at(-1)).toBe("ready");
      expect(onFailure).not.toHaveBeenCalled();

      const restoredNatural = window.getSelection();
      const restoredAnchor = restoredNatural?.anchorNode ?? null;
      if (
        !restoredNatural ||
        restoredNatural.rangeCount !== 1 ||
        !restoredNatural.isCollapsed ||
        !restoredAnchor ||
        !live.current.surface.contains(restoredAnchor) ||
        live.current.surface.ownerDocument.activeElement !==
          live.current.surface
      )
        throw new Error("live-first-enter-natural-selection-not-restored");
      const restoredFromSurfaceStart = document.createRange();
      restoredFromSurfaceStart.setStart(live.current.surface, 0);
      restoredFromSurfaceStart.setEnd(
        restoredAnchor,
        restoredNatural.anchorOffset,
      );
      expect(restoredFromSurfaceStart.toString().length).toBe(
        (live.current.surface.textContent ?? "").length,
      );

      // Continue from the restored natural caret without moving it first.
      const historyBeforeContinuation =
        live.sourceDocument.owner.getHistoryState();
      const readyCallsBeforeContinuation = live.ownerSnapshotReady.length;
      const windowReadyKeysBeforeContinuation = live.windowReadyKeys.length;
      const acceptedWindowNotificationsBeforeContinuation =
        live.getWindowedState().acceptedWindowNotifications;
      const continuationTarget = restoredNatural.getRangeAt(0).cloneRange();
      const continuation = new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        data: "Z",
        inputType: "insertText",
      });
      Object.defineProperty(continuation, "getTargetRanges", {
        value: () => [continuationTarget],
      });
      await act(async () => {
        live.current.surface.dispatchEvent(continuation);
        if (!continuation.defaultPrevented) {
          let caretNode: Node = continuationTarget.startContainer;
          let caretOffset = continuationTarget.startOffset + 1;
          if (continuationTarget.startContainer instanceof Text) {
            continuationTarget.startContainer.insertData(
              continuationTarget.startOffset,
              "Z",
            );
          } else {
            const inserted = document.createTextNode("Z");
            continuationTarget.startContainer.insertBefore(
              inserted,
              continuationTarget.startContainer.childNodes[
                continuationTarget.startOffset
              ] ?? null,
            );
            caretNode = inserted;
            caretOffset = 1;
          }
          window.getSelection()?.collapse(caretNode, caretOffset);
          live.current.surface.dispatchEvent(
            new InputEvent("input", {
              bubbles: true,
              data: "Z",
              inputType: "insertText",
            }),
          );
        }
        live.syncSourceRevision();
        for (let index = 0; index < 8; index += 1) {
          await Promise.resolve();
        }
      });
      const continuedSource = `${expected}Z`;
      expect(live.sourceDocument.owner.getValue()).toBe(continuedSource);
      expect(live.current.surface.textContent?.endsWith("Z")).toBe(true);
      expect(live.requests).toHaveLength(2);
      const continuationRequest = live.requests[1];
      if (!continuationRequest)
        throw new Error("live-first-enter-continuation-request-missing");
      expect(continuationRequest.path).toBe("document-end");
      expect(continuationRequest.markdown).toBe(continuedSource);
      expect(live.pendingChanges).toContain(true);
      expect(live.getWindowedState().pending).toBe(true);
      expect(onFailure).not.toHaveBeenCalled();
      expect(live.onTransferFailure).not.toHaveBeenCalled();

      const { preview: continuationPreview } = await live.resolvePreview();
      expect(continuationPreview.editMap.blocks).toHaveLength(321);
      expect(continuationPreview.editMap.blocks.at(-1)).toMatchObject({
        id: "b320",
        startLine: 640,
        endLine: 641,
      });
      expect(live.ownerSnapshotReady.length).toBeGreaterThan(
        readyCallsBeforeContinuation,
      );
      expect(live.ownerSnapshotReady.at(-1)?.signature).toBe(
        continuationRequest.signature,
      );
      expect(live.getWindowedState().previewSnapshot.signature).toBe(
        continuationRequest.signature,
      );
      expect(live.getWindowedState().pending).toBe(false);
      expect(live.pendingChanges.at(-1)).toBe(false);
      const continuationAccepted =
        live.current.runtime.getAcceptedWindowSnapshot();
      if (!continuationAccepted)
        throw new Error("live-first-enter-continuation-snapshot-missing");
      expect(continuationAccepted.signature).toBe(
        continuationRequest.signature,
      );
      expect(continuationAccepted.nodes).toEqual(
        Array.from(live.current.surface.childNodes),
      );
      expect(continuationAccepted.editMap?.blocks).toHaveLength(321);
      expect(continuationAccepted.editMap?.blocks.at(-1)).toMatchObject({
        id: "b320",
        startLine: 640,
        endLine: 641,
      });
      expect(continuationAccepted.sourceRevision).toBe(
        live.sourceDocument.owner.getRevision?.(),
      );
      expect(live.windowReadyKeys).toHaveLength(
        windowReadyKeysBeforeContinuation + 1,
      );
      expect(live.windowReadyKeys.at(-1)).toBe(continuationAccepted.key);
      expect(live.getWindowedState().acceptedWindowNotifications).toBe(
        acceptedWindowNotificationsBeforeContinuation + 1,
      );
      expect(live.ownerStatusChanges.at(-1)).toBe("ready");
      expect(
        live.sourceDocument.owner.getHistoryState().undoDepth,
      ).toBeGreaterThan(historyBeforeContinuation.undoDepth);
      expect(onFailure).not.toHaveBeenCalled();
      expect(live.onTransferFailure).not.toHaveBeenCalled();

      const continuationNatural = window.getSelection();
      const continuationAnchor = continuationNatural?.anchorNode ?? null;
      if (
        !continuationNatural ||
        continuationNatural.rangeCount !== 1 ||
        !continuationNatural.isCollapsed ||
        !continuationAnchor ||
        !live.current.surface.contains(continuationAnchor) ||
        live.current.surface.ownerDocument.activeElement !==
          live.current.surface
      )
        throw new Error("live-first-enter-continuation-caret-not-restored");
      const continuationFromSurfaceStart = document.createRange();
      continuationFromSurfaceStart.setStart(live.current.surface, 0);
      continuationFromSurfaceStart.setEnd(
        continuationAnchor,
        continuationNatural.anchorOffset,
      );
      expect(continuationFromSurfaceStart.toString().length).toBe(
        (live.current.surface.textContent ?? "").length,
      );

      // The next plain character starts from the unchanged restored row caret
      // and must not invent another per-character formal request.
      const plainTarget = continuationNatural.getRangeAt(0).cloneRange();
      const plain = new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        data: "Y",
        inputType: "insertText",
      });
      Object.defineProperty(plain, "getTargetRanges", {
        value: () => [plainTarget],
      });
      await act(async () => {
        live.current.surface.dispatchEvent(plain);
        if (!plain.defaultPrevented) {
          let caretNode: Node = plainTarget.startContainer;
          let caretOffset = plainTarget.startOffset + 1;
          if (plainTarget.startContainer instanceof Text) {
            plainTarget.startContainer.insertData(plainTarget.startOffset, "Y");
          } else {
            const inserted = document.createTextNode("Y");
            plainTarget.startContainer.insertBefore(
              inserted,
              plainTarget.startContainer.childNodes[plainTarget.startOffset] ??
                null,
            );
            caretNode = inserted;
            caretOffset = 1;
          }
          window.getSelection()?.collapse(caretNode, caretOffset);
          live.current.surface.dispatchEvent(
            new InputEvent("input", {
              bubbles: true,
              data: "Y",
              inputType: "insertText",
            }),
          );
        }
        live.syncSourceRevision();
        for (let index = 0; index < 8; index += 1) {
          await Promise.resolve();
        }
      });
      expect(live.sourceDocument.owner.getValue()).toBe(`${continuedSource}Y`);
      expect(live.current.surface.textContent?.endsWith("ZY")).toBe(true);
      expect(live.requests).toHaveLength(2);
      expect(live.getWindowedState().pending).toBe(false);
      expect(
        live.sourceDocument.owner.getHistoryState().undoDepth,
      ).toBeGreaterThan(historyBeforeContinuation.undoDepth);
      expect(onFailure).not.toHaveBeenCalled();
      expect(live.onTransferFailure).not.toHaveBeenCalled();
      expect(live.diagnostics).toEqual([]);
      expect(live.windowedDiagnostics).toEqual([]);
    } finally {
      live.cleanup();
    }
  });

  it("refreshes the public Preview session after a local edit and continues editing", async () => {
    const live = await mountLiveWindowedDocumentEnd(
      "live-explicit-preview-refresh",
    );
    try {
      const { onFailure, row } = live.reveal();
      const insertAtNaturalCaret = async (text: string) => {
        const natural = window.getSelection();
        if (
          !natural ||
          natural.rangeCount !== 1 ||
          !natural.isCollapsed ||
          !row.contains(natural.anchorNode)
        )
          throw new Error("live-preview-refresh-natural-selection-missing");
        const target = natural.getRangeAt(0).cloneRange();
        const before = new InputEvent("beforeinput", {
          bubbles: true,
          cancelable: true,
          data: text,
          inputType: "insertText",
        });
        Object.defineProperty(before, "getTargetRanges", {
          value: () => [target],
        });
        await act(async () => {
          live.current.surface.dispatchEvent(before);
          if (!before.defaultPrevented) {
            if (target.startContainer instanceof Text) {
              target.startContainer.insertData(target.startOffset, text);
            } else {
              const inserted = document.createTextNode(text);
              target.startContainer.insertBefore(
                inserted,
                target.startContainer.childNodes[target.startOffset] ?? null,
              );
            }
            const insertedNode =
              target.startContainer instanceof Text
                ? target.startContainer
                : (target.startContainer.childNodes[target.startOffset] ??
                  null);
            if (insertedNode) {
              window
                .getSelection()
                ?.collapse(
                  insertedNode,
                  target.startContainer instanceof Text
                    ? target.startOffset + text.length
                    : text.length,
                );
            }
            live.current.surface.dispatchEvent(
              new InputEvent("input", {
                bubbles: true,
                data: text,
                inputType: "insertText",
              }),
            );
          }
          live.syncSourceRevision();
          for (let index = 0; index < 8; index += 1) {
            await Promise.resolve();
          }
        });
      };
      const firstExpected = `${live.markdown}X`;
      await insertAtNaturalCaret("X");
      expect(live.sourceDocument.owner.getValue()).toBe(firstExpected);
      expect(row.textContent).toBe("b319X");
      expect(live.requests).toHaveLength(0);
      expect(onFailure).not.toHaveBeenCalled();
      const ownerSnapshotsBefore = live.ownerSnapshotReady.length;
      let requested:
        | Readonly<{
            markdown: string;
            path: "document-end" | "preview" | "test-request";
            revision: number;
            signature: string;
          }>
        | undefined;
      act(() => {
        requested = live.requestPreviewForTest(firstExpected);
      });
      if (!requested) throw new Error("live-preview-refresh-request-missing");
      expect(requested.path).toBe("test-request");
      expect(requested.markdown).toBe(firstExpected);
      await live.resolvePreview();
      expect(live.ownerSnapshotReady.length).toBeGreaterThan(
        ownerSnapshotsBefore,
      );
      expect(live.ownerSnapshotReady.at(-1)?.signature).toBe(
        requested.signature,
      );
      expect(live.getWindowedState().previewSnapshot.signature).toBe(
        requested.signature,
      );
      const refreshed = live.current.runtime.getAcceptedWindowSnapshot();
      if (!refreshed) throw new Error("live-preview-refresh-snapshot-missing");
      expect(refreshed.signature).toBe(requested.signature);
      expect(live.ownerStatusChanges.at(-1)).toBe("ready");

      // Continue editing from the same natural caret after the explicit
      // public Preview refresh; this second local key must not auto-request.
      await insertAtNaturalCaret("Y");
      expect(live.sourceDocument.owner.getValue()).toBe(`${firstExpected}Y`);
      expect(row.textContent).toBe("b319XY");
      expect(
        live.current.surface.querySelector(
          "[data-easymde-visual-block-id='b319']",
        ),
      ).toBe(row);
      expect(live.requests).toHaveLength(1);
      expect(onFailure).not.toHaveBeenCalled();
      expect(live.onTransferFailure).not.toHaveBeenCalled();
      expect(live.onDispose).not.toHaveBeenCalled();
      expect(live.diagnostics).toEqual([]);
      expect(live.windowedDiagnostics).toEqual([]);
    } finally {
      live.cleanup();
    }
  });

  it.each([false, true] as const)("keeps a pinned text-tail caret editable across an unconsumed same-source ready window reorder (fresh public Preview epoch=%s)", async (refreshPreview) => {
    const live = await mountLiveWindowedDocumentEnd(`live-ready-reorder-tail-${refreshPreview ? "fresh-preview" : "steady"}`, {
      deferWindowReadyRerender: true,
      stagingScheduler: { now: () => 0, yield: () => Promise.resolve() },
    });
    let restoreAnimationFrames: (() => void) | null = null;
    try {
      const ownerSurface = live.current.surface;
      const ownerDisposeCalls = live.onDispose.mock.calls.length;
      const ownerReadyCalls = live.ownerSnapshotReady.length;
      Object.defineProperty(live.current.canvas, "clientHeight", {
        configurable: true,
        value: 240,
      });
      let row = live.reveal().row;
      await act(async () => {
        for (let index = 0; index < 12; index += 1) {
          await Promise.resolve();
        }
        await flushAnimationFrames(8);
      });
      if (refreshPreview) {
        const source = live.sourceDocument.owner.getValue();
        const revision = live.sourceDocument.owner.getRevision?.();
        let requested:
          | ReturnType<typeof live.requestPreviewForTest>
          | undefined;
        act(() => {
          requested = live.requestPreviewForTest(source);
        });
        if (!requested)
          throw new Error("live-ready-reorder-refresh-request-missing");
        await live.resolvePreview();
        expect(live.sourceDocument.owner.getValue()).toBe(source);
        expect(live.sourceDocument.owner.getRevision?.()).toBe(revision);
        expect(live.current.surface).toBe(ownerSurface);
        expect(live.onDispose).toHaveBeenCalledTimes(ownerDisposeCalls);
        expect(live.ownerSnapshotReady.length).toBeGreaterThan(ownerReadyCalls);
        expect(live.ownerSnapshotReady.at(-1)?.signature).toBe(
          requested.signature,
        );
        expect(live.getWindowedState().previewSnapshot.signature).toBe(
          requested.signature,
        );
        expect(live.current.runtime.getAcceptedWindowSnapshot()?.signature).toBe(
          requested.signature,
        );
        const refreshedRow = live.current.surface.querySelector<HTMLElement>(
          "[data-easymde-visual-block-id='b319']",
        );
        if (!(refreshedRow instanceof HTMLElement))
          throw new Error("live-ready-reorder-refresh-row-missing");
        row = refreshedRow;
        const refreshedSelection = window.getSelection();
        if (
          !refreshedSelection ||
          refreshedSelection.rangeCount !== 1 ||
          !refreshedSelection.isCollapsed ||
          !row.contains(refreshedSelection.anchorNode)
        )
          throw new Error("live-ready-reorder-refresh-caret-missing");
      }
      expect(live.current.surface).toBe(ownerSurface);
      expect(live.onDispose).toHaveBeenCalledTimes(ownerDisposeCalls);
      const publishedBefore = live.current.runtime.getAcceptedWindowSnapshot();
      if (!publishedBefore)
        throw new Error("live-ready-reorder-initial-publication-missing");
      const nodesBefore = Array.from(live.current.surface.childNodes);
      const sourceBefore = live.sourceDocument.owner.getValue();
      const revisionBefore = live.sourceDocument.owner.getRevision?.();
      const historyBefore = live.sourceDocument.owner.getHistoryState();
      const renderedNotificationsBefore =
        live.getWindowedState().renderedAcceptedWindowNotifications;
      const acceptedNotificationsBefore =
        live.getWindowedState().acceptedWindowNotifications;
      const previewSnapshotBefore = live.getWindowedState().previewSnapshot;

      const queuedFrames: FrameRequestCallback[] = [];
      const animationFrameSpy = vi
        .spyOn(window, "requestAnimationFrame")
        .mockImplementation((callback) => {
          queuedFrames.push(callback);
          return queuedFrames.length;
        });
      restoreAnimationFrames = () => animationFrameSpy.mockRestore();

      act(() => {
        live.current.canvas.scrollTop = 96 * 24;
        live.current.canvas.dispatchEvent(new Event("scroll"));
      });
      if (queuedFrames.length === 0)
        throw new Error("live-ready-reorder-frame-missing");

      let framesRun = 0;
      const observed: {
        deletionEvent: InputEvent | null;
        published: PreviewAcceptedWindowSnapshot | null;
      } = { deletionEvent: null, published: null };
      let renderedNotificationsAtCommit = -1;
      let acceptedNotificationsAtCommit = -1;
      let sourceAtCommit = "";
      let revisionAtCommit: number | undefined;
      let historyAtCommit = historyBefore;
      let rowTextBeforeDelete = "";
      act(() => {
        while (queuedFrames.length > 0 && framesRun < 8) {
          const callback = queuedFrames.shift();
          if (!callback) break;
          callback(0);
          framesRun += 1;
          const candidate = live.current.runtime.getAcceptedWindowSnapshot();
          if (candidate && candidate.key !== publishedBefore.key) {
            observed.published = candidate;
            break;
          }
        }
        observed.published = live.current.runtime.getAcceptedWindowSnapshot();
        renderedNotificationsAtCommit =
          live.getWindowedState().renderedAcceptedWindowNotifications;
        acceptedNotificationsAtCommit =
          live.getWindowedState().acceptedWindowNotifications;
        sourceAtCommit = live.sourceDocument.owner.getValue();
        revisionAtCommit = live.sourceDocument.owner.getRevision?.();
        historyAtCommit = live.sourceDocument.owner.getHistoryState();
        if (!observed.published)
          throw new Error("live-ready-reorder-publication-missing");
        const canonicalRevisionAtCommit =
          live.sourceDocument.owner.getRevision?.();
        if (!Number.isSafeInteger(canonicalRevisionAtCommit))
          throw new Error("live-ready-reorder-canonical-revision-missing");
        const readyAtCommit = live.getWindowedState();
        expect(readyAtCommit.pending).toBe(false);
        expect(readyAtCommit.previewStatus).toBe("ready");
        expect(observed.published.sourceRevision).toBe(
          canonicalRevisionAtCommit,
        );
        expect(observed.published.revision).toBe(publishedBefore.revision);
        expect(observed.published.signature).toBe(publishedBefore.signature);
        expect(readyAtCommit.previewSnapshot.revision).toBe(
          previewSnapshotBefore.revision,
        );
        expect(readyAtCommit.previewSnapshot.signature).toBe(
          previewSnapshotBefore.signature,
        );
        const naturalSelection = window.getSelection();
        if (
          !naturalSelection ||
          naturalSelection.rangeCount !== 1 ||
          !naturalSelection.isCollapsed ||
          naturalSelection.anchorNode !== naturalSelection.focusNode ||
          naturalSelection.anchorOffset !== naturalSelection.focusOffset
        )
          throw new Error("live-ready-reorder-natural-selection-missing");
        expect(live.current.surface.ownerDocument.activeElement).toBe(
          live.current.surface,
        );
        expect(row.contains(naturalSelection.anchorNode)).toBe(true);
        const naturalRange = naturalSelection.getRangeAt(0).cloneRange();
        const rowPrefix = document.createRange();
        rowPrefix.selectNodeContents(row);
        rowPrefix.setEnd(naturalRange.endContainer, naturalRange.endOffset);
        expect(rowPrefix.toString()).toBe(row.textContent ?? "");
        rowTextBeforeDelete = row.textContent ?? "";
        if (rowTextBeforeDelete.length < 1)
          throw new Error("live-ready-reorder-tail-row-empty");
        const targetText =
          naturalRange.startContainer instanceof Text
            ? naturalRange.startContainer
            : naturalRange.startContainer.childNodes[
                naturalRange.startOffset - 1
              ];
        const targetOffset =
          targetText instanceof Text
            ? naturalRange.startContainer instanceof Text
              ? naturalRange.startOffset
              : targetText.length
            : -1;
        if (!(targetText instanceof Text) || targetOffset < 1)
          throw new Error("live-ready-reorder-natural-tail-text-missing");
        const deletionTarget = naturalRange.cloneRange();
        deletionTarget.setStart(targetText, targetOffset - 1);
        deletionTarget.setEnd(targetText, targetOffset);
        const before = new InputEvent("beforeinput", {
          bubbles: true,
          cancelable: true,
          inputType: "deleteContentBackward",
        });
        Object.defineProperty(before, "getTargetRanges", {
          value: () => [deletionTarget],
        });
        observed.deletionEvent = before;
        live.current.surface.dispatchEvent(before);
        if (!before.defaultPrevented) {
          deletionTarget.deleteContents();
          window
            .getSelection()
            ?.collapse(
              deletionTarget.startContainer,
              deletionTarget.startOffset,
            );
          live.current.surface.dispatchEvent(
            new InputEvent("input", {
              bubbles: true,
              inputType: "deleteContentBackward",
            }),
          );
        }
      });

      if (!observed.published)
        throw new Error("live-ready-reorder-publication-missing");
      const publishedAtCommit = observed.published;
      expect(publishedAtCommit.key).not.toBe(publishedBefore.key);
      expect(publishedAtCommit.signature).toBe(publishedBefore.signature);
      expect(publishedAtCommit.nodes).not.toEqual(nodesBefore);
      expect(Array.from(live.current.surface.childNodes)).toEqual(
        publishedAtCommit.nodes,
      );
      expect(publishedAtCommit.nodes).toContain(row);
      expect(renderedNotificationsAtCommit).toBe(renderedNotificationsBefore);
      expect(acceptedNotificationsAtCommit).toBe(
        acceptedNotificationsBefore + 1,
      );
      expect(sourceAtCommit).toBe(sourceBefore);
      expect(revisionAtCommit).toBe(revisionBefore);
      expect(historyAtCommit).toEqual(historyBefore);
      expect(framesRun).toBeGreaterThan(0);

      const expected = sourceBefore.slice(0, -1);
      const failureCodes = live.onFailure.mock.calls.map(([code]) =>
        String(code),
      );
      const mountChildDiagnostics = live.windowedDiagnostics.filter(
        (code) =>
          "visual-editor-window-source-navigation-dom-stale:mount-child-identity" ===
          code,
      );
      expect(acceptedNotificationsAtCommit).toBe(
        acceptedNotificationsBefore + 1,
      );
      expect(mountChildDiagnostics).toHaveLength(0);
      expect(failureCodes).toEqual([]);
      expect(live.sourceDocument.owner.getValue()).toBe(expected);
      expect(
        live.sourceDocument.owner.getHistoryState().undoDepth,
      ).toBeGreaterThan(historyBefore.undoDepth);
      // The manual queue exists only for the one same-turn handoff above.
      // Drain any bounded callbacks it already owns before restoring the real
      // scheduler for later history/Preview work.
      act(() => {
        let drainedFrames = 0;
        while (queuedFrames.length > 0 && drainedFrames < 8) {
          queuedFrames.shift()?.(0);
          drainedFrames += 1;
        }
      });
      if (queuedFrames.length > 0)
        throw new Error("live-ready-reorder-frames-undrained");
      restoreAnimationFrames?.();
      restoreAnimationFrames = null;

      await act(async () => {
        for (let index = 0; index < 12; index += 1) {
          await Promise.resolve();
        }
      });
      expect(live.getWindowedState().renderedAcceptedWindowNotifications).toBe(
        acceptedNotificationsBefore + 1,
      );
      const settledSelection = window.getSelection();
      const settledAnchor = settledSelection?.anchorNode ?? null;
      if (
        !settledSelection ||
        settledSelection.rangeCount !== 1 ||
        !settledSelection.isCollapsed ||
        !settledAnchor ||
        !row.contains(settledAnchor)
      )
        throw new Error("live-ready-reorder-settled-caret-missing");
      expect(live.current.surface.ownerDocument.activeElement).toBe(
        live.current.surface,
      );
      const settledRange = settledSelection.getRangeAt(0);
      const settledPrefix = document.createRange();
      settledPrefix.selectNodeContents(row);
      settledPrefix.setEnd(
        settledRange.endContainer,
        settledRange.endOffset,
      );
      const expectedRowText = rowTextBeforeDelete.slice(0, -1);
      expect(row.textContent).toBe(expectedRowText);
      expect(settledPrefix.toString()).toBe(expectedRowText);

      const nextTarget = settledSelection.getRangeAt(0).cloneRange();
      const next = new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        data: "Z",
        inputType: "insertText",
      });
      Object.defineProperty(next, "getTargetRanges", {
        value: () => [nextTarget],
      });
      await act(async () => {
        live.current.surface.dispatchEvent(next);
        if (!next.defaultPrevented) {
          let caretNode: Node = nextTarget.startContainer;
          let caretOffset = nextTarget.startOffset + 1;
          if (nextTarget.startContainer instanceof Text) {
            nextTarget.startContainer.insertData(nextTarget.startOffset, "Z");
          } else {
            const inserted = document.createTextNode("Z");
            nextTarget.startContainer.insertBefore(
              inserted,
              nextTarget.startContainer.childNodes[nextTarget.startOffset] ??
                null,
            );
            caretNode = inserted;
            caretOffset = 1;
          }
          window.getSelection()?.collapse(caretNode, caretOffset);
          live.current.surface.dispatchEvent(
            new InputEvent("input", {
              bubbles: true,
              data: "Z",
              inputType: "insertText",
            }),
          );
        }
        live.syncSourceRevision();
        for (let index = 0; index < 8; index += 1) {
          await Promise.resolve();
        }
      });
      const sourceAfterContinuation = `${expected}Z`;
      const continuedRowText = `${expectedRowText}Z`;
      const terminalRowState = (source: string, expectedVisible: string) => {
        expect(live.sourceDocument.owner.getValue()).toBe(source);
        const terminalRow = live.current.surface.querySelector<HTMLElement>(
          "[data-easymde-visual-block-id='b319']",
        );
        if (!(terminalRow instanceof HTMLElement))
          throw new Error("live-ready-reorder-terminal-row-missing");
        expect(terminalRow.textContent).toBe(expectedVisible);
        const selection = window.getSelection();
        if (
          !selection ||
          selection.rangeCount !== 1 ||
          !selection.isCollapsed ||
          selection.anchorNode !== selection.focusNode ||
          selection.anchorOffset !== selection.focusOffset ||
          !terminalRow.contains(selection.anchorNode)
        )
          throw new Error("live-ready-reorder-terminal-caret-missing");
        expect(live.current.surface.ownerDocument.activeElement).toBe(
          live.current.surface,
        );
        const range = selection.getRangeAt(0);
        const prefix = document.createRange();
        prefix.selectNodeContents(terminalRow);
        prefix.setEnd(range.endContainer, range.endOffset);
        expect(prefix.toString()).toBe(expectedVisible);
      };
      expect(
        live.current.surface.querySelector(
          "[data-easymde-visual-block-id='b319']",
        ),
      ).toBe(row);
      terminalRowState(sourceAfterContinuation, continuedRowText);
      expect(
        live.sourceDocument.owner.getHistoryState().undoDepth,
      ).toBeGreaterThan(historyBefore.undoDepth);
      const historyAfterNextKey =
        live.sourceDocument.owner.getHistoryState();
      const requestsBeforeUndo = live.requests.length;
      const undo = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        key: "z",
      });
      await act(async () => {
        live.current.surface.dispatchEvent(undo);
        expect(undo.defaultPrevented).toBe(true);
        for (let index = 0; index < 8; index += 1) {
          await Promise.resolve();
        }
        await flushAnimationFrames(2);
      });
      const afterUndo = live.sourceDocument.owner.getValue();
      const historyAfterUndo = live.sourceDocument.owner.getHistoryState();
      if (live.requests.length > requestsBeforeUndo) {
        await live.resolvePreview();
      }
      expect(live.sourceDocument.owner.getValue()).toBe(afterUndo);
      const undoState =
        afterUndo === sourceBefore
          ? { rowText: rowTextBeforeDelete, source: sourceBefore }
          : afterUndo === expected
            ? { rowText: expectedRowText, source: expected }
            : null;
      if (!undoState)
        throw new Error("live-ready-reorder-undo-source-invalid");
      terminalRowState(undoState.source, undoState.rowText);
      expect(historyAfterUndo.undoDepth).toBeLessThan(
        historyAfterNextKey.undoDepth,
      );
      expect(historyAfterUndo.redoDepth).toBeGreaterThan(
        historyAfterNextKey.redoDepth,
      );
      const requestsBeforeRedo = live.requests.length;
      const redo = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        key: "z",
        shiftKey: true,
      });
      await act(async () => {
        live.current.surface.dispatchEvent(redo);
        expect(redo.defaultPrevented).toBe(true);
        for (let index = 0; index < 8; index += 1) {
          await Promise.resolve();
        }
        await flushAnimationFrames(2);
      });
      if (live.requests.length > requestsBeforeRedo) {
        await live.resolvePreview();
      }
      terminalRowState(sourceAfterContinuation, continuedRowText);
      expect(live.onFailure).not.toHaveBeenCalled();
      expect(live.onTransferFailure).not.toHaveBeenCalled();
      expect(live.diagnostics).toEqual([]);
      expect(live.windowedDiagnostics).toEqual([]);
    } finally {
      restoreAnimationFrames?.();
      live.cleanup();
    }
  });

  it.each([
    { diagnosticThrows: false, label: "primary post-install failure" },
    { diagnosticThrows: true, label: "diagnostic callback failure" },
  ] as const)(
    "retains the installed atomic gap and native owner after $label",
    async ({ diagnosticThrows, label }) => {
      let failReady = false;
      let throwDiagnostic = false;
      const previewDiagnostics: string[] = [];
      const live = await mountLiveWindowedDocumentEnd(
        `live-post-install-${label.replaceAll(" ", "-")}`,
        {
          onDiagnostic: (code) => {
            previewDiagnostics.push(code);
            if (throwDiagnostic) throw new Error("private-diagnostic-failure");
          },
          onWindowReady: () => {
            if (failReady) throw new Error("preview-enhancement-failed");
          },
          terminal: "mermaid",
        },
      );
      try {
        const beforeRootOffset = live.current.surface.childNodes.length;
        const historyBefore = live.sourceDocument.owner.getHistoryState();
        live.current.surface.focus();
        window.getSelection()?.collapse(live.current.surface, beforeRootOffset);
        failReady = true;
        throwDiagnostic = diagnosticThrows;
        const key = new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "Backspace",
        });
        act(() => {
          live.current.surface.dispatchEvent(key);
        });
        expect(key.defaultPrevented).toBe(true);
        const installedNodes = Array.from(live.current.surface.childNodes);
        const gaps = installedNodes.filter(
          (node): node is HTMLElement =>
            node instanceof HTMLElement &&
            "P" === node.tagName &&
            !node.hasAttribute("data-easymde-visual-block-id") &&
            "BR" === node.firstElementChild?.tagName,
        );
        expect(gaps).toHaveLength(1);
        const gap = gaps[0];
        if (!gap) throw new Error("installed-atomic-gap-missing");
        const native = window.getSelection();
        if (!native?.anchorNode)
          throw new Error("installed-atomic-selection-missing");
        const anchorNode = native.anchorNode;
        const anchorOffset = native.anchorOffset;
        expect(gap.contains(anchorNode)).toBe(true);
        expect(
          native.anchorNode === live.current.surface &&
            native.anchorOffset === beforeRootOffset,
        ).toBe(false);
        expect(live.current.runtime.getAcceptedWindowSnapshot()).toBeNull();
        expect(live.sourceDocument.owner.getValue()).toBe(live.markdown);
        expect(live.sourceDocument.owner.getHistoryState()).toEqual(
          historyBefore,
        );
        expect(previewDiagnostics).toEqual(["preview-enhancement-failed"]);
        const installedDiagnostic = live.windowedDiagnostics.find((code) =>
          code.startsWith(
            "visual-editor-window-install:installed:preview-enhancement-failed",
          ),
        );
        expect(installedDiagnostic).toBe(
          `visual-editor-window-install:installed:preview-enhancement-failed;diagnosticFailed=${diagnosticThrows}`,
        );
        expect(live.diagnostics).toContain("preview-enhancement-failed");
        const revealFault = live.revealFaults.at(-1);
        expect(revealFault).toBeInstanceOf(PreviewWindowInstallFault);
        if (!(revealFault instanceof PreviewWindowInstallFault)) {
          throw new Error("installed-reveal-fault-missing");
        }
        expect(revealFault.stage).toBe("installed");
        expect(revealFault.code).toBe("preview-enhancement-failed");
        expect(revealFault.diagnosticCause instanceof Error).toBe(
          diagnosticThrows,
        );
        await act(async () => {
          for (let index = 0; index < 16; index += 1) await Promise.resolve();
          await flushAnimationFrames(8);
        });
        expect(Array.from(live.current.surface.childNodes)).toEqual(
          installedNodes,
        );
        expect(gap.parentNode).toBe(live.current.surface);
        expect(gap.isConnected).toBe(true);
        expect(window.getSelection()?.anchorNode).toBe(anchorNode);
        expect(window.getSelection()?.anchorOffset).toBe(anchorOffset);
        expect(live.current.runtime.getAcceptedWindowSnapshot()).toBeNull();
        expect(live.onFailure).toHaveBeenCalledOnce();
        expect(live.onFailure).toHaveBeenCalledWith(
          "preview-enhancement-failed",
        );
      } finally {
        live.cleanup();
      }
    },
  );

  it("refuses a document-end reveal after a formal preview advances the accepted generation", async () => {
    const live = await mountLiveWindowedDocumentEnd("live-formal-generation");
    try {
      const accepted = live.current.runtime.getAcceptedWindowSnapshot();
      const block = accepted?.editMap?.blocks.at(-1);
      if (!accepted || !block)
        throw new Error("live-formal-generation-accepted-missing");
      const gap = document.createElement("p");
      gap.append(document.createElement("br"));
      live.current.surface.append(gap);
      const refusal = vi.fn();
      let result: PreviewAcceptedWindowSnapshot | null = null;
      act(() => {
        live.current.session.schedule(
          request(live.markdown, "live-formal-generation-next"),
          true,
        );
        result = live.current.runtime.revealAcceptedWindowRow({
          gap,
          id: block.id,
          index: accepted.editMap?.blocks.length
            ? accepted.editMap.blocks.length - 1
            : -1,
          onRefusal: refusal,
          retainGap: true,
          revision: accepted.revision,
          signature: accepted.signature,
          source: live.markdown,
          sourceRevision: accepted.sourceRevision ?? 0,
        });
      });
      expect(result).toBeNull();
      expect(refusal).toHaveBeenCalledWith(
        "owner-state",
        expect.objectContaining({ generationMatches: false }),
      );
      expect(gap.parentNode).toBe(live.current.surface);
    } finally {
      live.cleanup();
    }
  });

  it("adopts a mounted replacement before the next window commit can restore the old node", async () => {
    const fixture = windowedFixture(320, "adopt-window-block");
    const current = setup({
      contentEditable: true,
      initialEditMap: fixture.editMap,
      initialHtml: fixture.html,
      initialSignature: "adopt-window-block",
      stagingScheduler: { yield: () => Promise.resolve() },
      windowed: true,
    });
    await act(async () => {
      for (let index = 0; index < 12; index += 1) await Promise.resolve();
      await flushAnimationFrames();
    });

    const previous = current.surface.querySelector<HTMLElement>(
      '[data-easymde-visual-block-id="b0"]',
    );
    if (!previous) throw new Error("adopt-window-block-source-missing");
    const replacement = document.createElement("h2");
    replacement.setAttribute("data-easymde-visual-block-id", "b0");
    replacement.textContent = "adopted block";
    previous.replaceWith(replacement);

    const finalize = current.runtime.prepareWindowBlockAdoption(replacement);
    expect(finalize).not.toBeNull();
    expect(finalize?.()).toBe(true);
    current.surface.ownerDocument.dispatchEvent(new Event("selectionchange"));
    await act(async () => flushAnimationFrames(2));

    expect(
      current.surface.querySelector('[data-easymde-visual-block-id="b0"]'),
    ).toBe(replacement);
    expect(previous.isConnected).toBe(false);
  });

  it("publishes a replacement queued behind an installed window commit and retains its identity", async () => {
    const geometry = installSequenceGeometry();
    const fixture = windowedFixture(320, "adopt-pending-window-block");
    const acceptedAtReady: Array<PreviewAcceptedWindowSnapshot | null> = [];
    let current: ReturnType<typeof setup>;
    const onWindowReady = vi.fn(() => {
      acceptedAtReady.push(current.runtime.getAcceptedWindowSnapshot());
    });
    const diagnostics: string[] = [];
    current = setup({
      contentEditable: true,
      initialEditMap: fixture.editMap,
      initialHtml: fixture.html,
      initialSignature: "adopt-pending-window-block",
      onDiagnostic: (code) => diagnostics.push(code),
      onWindowReady,
      stagingScheduler: { now: () => 0, yield: () => Promise.resolve() },
      windowed: true,
    });
    geometry.attach(current.canvas, current.surface);
    await act(async () => {
      for (let index = 0; index < 12; index += 1) await Promise.resolve();
      await flushAnimationFrames(12);
    });

    const previous = current.surface.querySelector<HTMLElement>(
      '[data-easymde-visual-block-id="b0"]',
    );
    if (!previous) throw new Error("adopt-pending-window-source-missing");
    Object.defineProperty(current.canvas, "clientHeight", {
      configurable: true,
      value: 240,
    });
    const replacement = document.createElement("pre");
    replacement.setAttribute("data-easymde-visual-block-id", "b0");
    replacement.textContent = "adopted pending block";
    let finalized = false;
    let observedBeforeSink = false;
    let readyCallsBeforeAdoption = 0;
    let deferredRecertification: { mockRestore: () => void } | null = null;
    const frameCallbacks: FrameRequestCallback[] = [];
    const deferredCallbacks: FrameRequestCallback[] = [];
    const nativeRequestAnimationFrame =
      window.requestAnimationFrame.bind(window);
    const requestAnimationFrame = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation(nativeRequestAnimationFrame)
      .mockImplementationOnce((callback: FrameRequestCallback) => {
        frameCallbacks.push(callback);
        return -1;
      });

    try {
      await act(async () => {
        await new Promise<void>((resolve) => {
          nativeRequestAnimationFrame(() => resolve());
        });
      });
      current.canvas.scrollTop = 24;
      current.canvas.dispatchEvent(new Event("scroll"));
      current.surface.ownerDocument.dispatchEvent(new Event("selectionchange"));
      const commitWindow = frameCallbacks.shift();
      if (!commitWindow) throw new Error("adopt-pending-window-frame-missing");
      requestAnimationFrame.mockRestore();
      deferredRecertification = vi
        .spyOn(window, "requestAnimationFrame")
        .mockImplementation((callback: FrameRequestCallback) => {
          deferredCallbacks.push(callback);
          return deferredCallbacks.length;
        });
      act(() => {
        commitWindow(0);
        expect(current.surface.contains(previous)).toBe(true);
        observedBeforeSink = true;
        previous.replaceWith(replacement);
        const finalize =
          current.runtime.prepareWindowBlockAdoption(replacement);
        expect(finalize).not.toBeNull();
        readyCallsBeforeAdoption = acceptedAtReady.length;
        deferredCallbacks.length = 0;
        finalized = finalize?.() ?? false;
        const deferredPass = deferredCallbacks.shift();
        if (!deferredPass)
          throw new Error("adopt-recertification-frame-missing");
        // React has not committed the adopted state update yet. The existing
        // owner must either publish from its synchronized current state or
        // leave a later callback; it must never certify the old node.
        deferredPass(0);
        expect(
          acceptedAtReady
            .slice(readyCallsBeforeAdoption)
            .some((accepted) =>
              accepted?.blocks.some(
                (block) => block.id === "b0" && block.node === previous,
              ),
            ),
        ).toBe(false);
      });
    } finally {
      requestAnimationFrame.mockRestore();
      deferredRecertification?.mockRestore();
    }
    if (deferredCallbacks.length > 0) {
      await act(async () => {
        for (const callback of deferredCallbacks.splice(0)) callback(0);
      });
    }
    await waitFor(() => {
      expect(
        current.runtime
          .getAcceptedWindowSnapshot()
          ?.blocks.find((block) => block.id === "b0")?.node,
      ).toBe(replacement);
      expect(
        acceptedAtReady.some((accepted) =>
          accepted?.blocks.some(
            (block) => block.id === "b0" && block.node === replacement,
          ),
        ),
      ).toBe(true);
    });

    expect(observedBeforeSink).toBe(true);
    expect(finalized).toBe(true);
    expect(
      current.surface.querySelector('[data-easymde-visual-block-id="b0"]'),
    ).toBe(replacement);
    expect(current.surface.contains(previous)).toBe(false);
    expect(diagnostics).toEqual([]);
    expect(
      current.runtime
        .getAcceptedWindowSnapshot()
        ?.blocks.find((block) => block.id === "b0")?.node,
    ).toBe(replacement);
    expect(acceptedAtReady).toHaveLength(readyCallsBeforeAdoption + 1);
    const published = acceptedAtReady.at(-1);
    expect(published?.nodes).toEqual(Array.from(current.surface.childNodes));
    expect(published?.blocks.find((block) => block.id === "b0")?.node).toBe(
      replacement,
    );

    window.getSelection()?.removeAllRanges();
    current.canvas.scrollTop =
      current.canvas.scrollHeight - current.canvas.clientHeight;
    current.canvas.dispatchEvent(new Event("scroll"));
    await waitFor(() =>
      expect(
        current.runtime
          .getAcceptedWindowSnapshot()
          ?.blocks.some((block) => block.id === "b319"),
      ).toBe(true),
    );
    expect(
      current.surface.querySelector('[data-easymde-visual-block-id="b319"]'),
    ).not.toBeNull();
    expect(
      current.surface.querySelector('[data-easymde-visual-block-id="b0"]'),
    ).toBeNull();

    current.canvas.scrollTop = 0;
    current.canvas.dispatchEvent(new Event("scroll"));
    await waitFor(() =>
      expect(
        current.runtime
          .getAcceptedWindowSnapshot()
          ?.blocks.find((block) => block.id === "b0")?.node,
      ).toBe(replacement),
    );

    expect(
      current.surface.querySelector('[data-easymde-visual-block-id="b0"]'),
    ).toBe(replacement);
    expect(current.surface.contains(previous)).toBe(false);
    current.unmount();
    geometry.restore();
  });

  it("does not mutate the repository when a prepared adoption fails its final identity check", async () => {
    const geometry = installSequenceGeometry();
    const fixture = windowedFixture(320, "adopt-window-atomic");
    const current = setup({
      contentEditable: true,
      initialEditMap: fixture.editMap,
      initialHtml: fixture.html,
      initialSignature: "adopt-window-atomic",
      stagingScheduler: { yield: () => Promise.resolve() },
      windowed: true,
    });
    geometry.attach(current.canvas, current.surface);
    await act(async () => {
      for (let index = 0; index < 12; index += 1) await Promise.resolve();
      await flushAnimationFrames();
    });

    const previous = current.surface.querySelector<HTMLElement>(
      '[data-easymde-visual-block-id="b0"]',
    );
    if (!previous) throw new Error("adopt-window-atomic-source-missing");
    Object.defineProperty(current.canvas, "clientHeight", {
      configurable: true,
      value: 240,
    });
    const replacement = document.createElement("h2");
    replacement.setAttribute("data-easymde-visual-block-id", "b0");
    replacement.textContent = "atomic replacement";
    const duplicate = document.createElement("p");
    duplicate.setAttribute("data-easymde-visual-block-id", "b0");
    const frameCallbacks: FrameRequestCallback[] = [];
    const nativeRequestAnimationFrame =
      window.requestAnimationFrame.bind(window);
    const requestAnimationFrame = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback: FrameRequestCallback) => {
        frameCallbacks.push(callback);
        return frameCallbacks.length;
      });

    try {
      await act(async () => {
        await new Promise<void>((resolve) => {
          nativeRequestAnimationFrame(() => resolve());
        });
      });
      current.canvas.scrollTop = 24;
      current.canvas.dispatchEvent(new Event("scroll"));
      const commitWindow = frameCallbacks.shift();
      if (!commitWindow) throw new Error("adopt-window-atomic-frame-missing");
      act(() => {
        commitWindow(0);
        previous.replaceWith(replacement);
        const finalize =
          current.runtime.prepareWindowBlockAdoption(replacement);
        if (!finalize) throw new Error("adopt-window-atomic-prepare-missing");
        current.surface.append(duplicate);
        expect(finalize()).toBe(false);
        duplicate.remove();
      });
      const stableWindow = frameCallbacks.shift();
      if (!stableWindow) {
        throw new Error("adopt-window-atomic-stable-frame-missing");
      }
      act(() => stableWindow(1));
    } finally {
      requestAnimationFrame.mockRestore();
    }

    await act(async () => flushAnimationFrames(2));
    expect(
      current.surface.querySelector<HTMLElement>(
        '[data-easymde-visual-block-id="b0"]',
      )?.tagName,
    ).toBe("P");
    expect(
      current.surface.querySelector<HTMLElement>(
        '[data-easymde-visual-block-id="b0"]',
      )?.textContent,
    ).toBe("b0");
    expect(replacement.isConnected).toBe(false);
    current.unmount();
    geometry.restore();
  });

  it("rejects a prepared adoption after the Preview revision becomes stale", async () => {
    const fixture = windowedFixture(320, "adopt-window-stale");
    const current = setup({
      contentEditable: true,
      initialEditMap: fixture.editMap,
      initialHtml: fixture.html,
      initialSignature: "adopt-window-stale",
      stagingScheduler: { yield: () => Promise.resolve() },
      windowed: true,
    });
    await act(async () => {
      for (let index = 0; index < 12; index += 1) await Promise.resolve();
      await flushAnimationFrames();
    });

    const previous = current.surface.querySelector<HTMLElement>(
      '[data-easymde-visual-block-id="b0"]',
    );
    if (!previous) throw new Error("adopt-window-stale-source-missing");
    const replacement = document.createElement("h2");
    replacement.setAttribute("data-easymde-visual-block-id", "b0");
    replacement.textContent = "stale replacement";
    previous.replaceWith(replacement);
    const finalize = current.runtime.prepareWindowBlockAdoption(replacement);
    if (!finalize) throw new Error("adopt-window-stale-prepare-missing");

    act(() => current.session.schedule(request("stale", "stale"), true));
    expect(finalize()).toBe(false);
    expect(
      current.surface.querySelector<HTMLElement>(
        '[data-easymde-visual-block-id="b0"]',
      )?.tagName,
    ).toBe("P");
    expect(
      current.surface.querySelector<HTMLElement>(
        '[data-easymde-visual-block-id="b0"]',
      )?.textContent,
    ).toBe("b0");
    current.unmount();
  });

  it("returns null when the owner is not serving a windowed repository", () => {
    const current = setup();
    const block = current.surface.firstElementChild;
    if (!(block instanceof HTMLElement)) {
      throw new Error("adopt-window-disabled-block-missing");
    }
    expect(current.runtime.prepareWindowBlockAdoption(block)).toBeNull();
  });

  it("rejects unknown, duplicate, detached, stale, and unmounted window blocks", async () => {
    const fixture = windowedFixture(320, "adopt-window-reject");
    const current = setup({
      contentEditable: true,
      initialEditMap: fixture.editMap,
      initialHtml: fixture.html,
      initialSignature: "adopt-window-reject",
      stagingScheduler: { yield: () => Promise.resolve() },
      windowed: true,
    });
    await act(async () => {
      for (let index = 0; index < 12; index += 1) await Promise.resolve();
      await flushAnimationFrames();
    });

    const source = current.surface.querySelector<HTMLElement>(
      '[data-easymde-visual-block-id="b0"]',
    );
    if (!source) throw new Error("adopt-window-block-reject-source-missing");
    const unknown = document.createElement("p");
    unknown.setAttribute("data-easymde-visual-block-id", "unknown");
    current.surface.append(unknown);
    expect(current.runtime.prepareWindowBlockAdoption(unknown)).toBeNull();
    unknown.remove();

    const duplicate = document.createElement("p");
    duplicate.setAttribute("data-easymde-visual-block-id", "b0");
    current.surface.append(duplicate);
    expect(current.runtime.prepareWindowBlockAdoption(source)).toBeNull();
    duplicate.remove();

    const detached = document.createElement("p");
    detached.setAttribute("data-easymde-visual-block-id", "b0");
    expect(current.runtime.prepareWindowBlockAdoption(detached)).toBeNull();

    act(() => current.session.schedule(request("stale", "stale"), true));
    expect(current.runtime.prepareWindowBlockAdoption(source)).toBeNull();

    const runtime = current.runtime;
    current.unmount();
    expect(runtime.prepareWindowBlockAdoption(source)).toBeNull();
  });

  it("commits the complete enhanced DOM directly at the window cap", async () => {
    const fixture = windowedFixture(160, "windowed-cap");
    const enhancement = deferred<void>();
    const enhancementStarted = deferred<HTMLElement>();
    const enhance = vi.fn<PreviewEnhancementPort["enhance"]>((candidate) => {
      candidate
        .querySelector('[data-easymde-visual-block-id="b159"]')
        ?.setAttribute("data-enhanced", "1");
      enhancementStarted.resolve(candidate);
      return enhancement.promise;
    });
    const materializeScheduler: MaterializeScheduler = {
      pending: [],
      yield: vi.fn(() => Promise.resolve()),
    };
    const statuses: PreviewSurfaceStatus[] = [];
    const htmlChanges: SafePreviewHtml[] = [];
    const current = setup({
      contentEditable: true,
      enhance,
      initialEditMap: fixture.editMap,
      initialHtml: fixture.html,
      initialSignature: "windowed-cap",
      materializeScheduler,
      onHtmlChange: (html) => htmlChanges.push(html),
      onStatusChange: (status) => statuses.push(status),
      stagingScheduler: {
        now: () => 0,
        yield: () => Promise.resolve(),
      },
      windowed: true,
    });
    const replaceChildren = vi.spyOn(current.surface, "replaceChildren");
    let candidate!: HTMLElement;

    await act(async () => {
      candidate = await enhancementStarted.promise;
    });

    expect(enhance).toHaveBeenCalledOnce();
    expect(
      candidate.querySelectorAll("[data-easymde-visual-block-id]"),
    ).toHaveLength(160);
    expect(candidate.isConnected).toBe(false);
    expect(candidate.style.display).toBe("none");
    expect(materializeScheduler.yield).not.toHaveBeenCalled();

    await act(async () => {
      enhancement.resolve();
      await enhancement.promise;
    });
    await act(async () => flushAnimationFrames());

    expect(replaceChildren).toHaveBeenCalledOnce();
    expect(
      current.surface.querySelectorAll("[data-easymde-visual-block-id]"),
    ).toHaveLength(160);
    expect(
      current.surface.querySelector("[data-easymde-preview-window-spacer]"),
    ).toBeNull();
    expect(
      current.surface
        .querySelector('[data-easymde-visual-block-id="b159"]')
        ?.getAttribute("data-enhanced"),
    ).toBe("1");
    expect(current.surface.easymdePreviewSignature).toBe("windowed-cap");
    expect(statuses.at(-1)).toBe("ready");
    expect(htmlChanges).toHaveLength(1);
    expect(htmlChanges[0]).toContain('data-enhanced="1"');
    expect(materializeScheduler.yield).not.toHaveBeenCalled();
    replaceChildren.mockRestore();
  });

  it("preserves Block markers for windowing after a complete Preview enhancement", async () => {
    const geometry = installSequenceGeometry();
    const fixture = windowedFixture(200, "complete-then-windowed");
    const current = setup({
      contentEditable: true,
      enhance: async (surface) => {
        const replaced = surface.querySelector(
          '[data-easymde-visual-block-id="b199"]',
        );
        if (!replaced) throw new Error("replacement-target-missing");
        const enhanced = surface.ownerDocument.createElement("section");
        enhanced.textContent = "enhanced final Block";
        replaced.replaceWith(enhanced);
      },
      initialEditMap: fixture.editMap,
      initialHtml: fixture.html,
      initialSignature: "complete-then-windowed",
      stagingScheduler: { now: () => 0, yield: () => Promise.resolve() },
      windowed: false,
    });
    geometry.attach(current.canvas, current.surface);

    await act(async () => {
      for (let index = 0; index < 12; index += 1) await Promise.resolve();
      await flushAnimationFrames(24);
    });
    expect(
      current.surface.querySelector('[data-easymde-visual-block-id="b199"]')
        ?.tagName,
    ).toBe("SECTION");

    current.setWindowed(true);
    await waitFor(() =>
      expect(current.runtime.getAcceptedWindowSnapshot()?.signature).toBe(
        fixture.editMap.signature,
      ),
    );

    expect(current.onDiagnostic).not.toHaveBeenCalled();
    expect(
      current.surface.getAttribute("data-easymde-preview-error"),
    ).toBeNull();
    expect(
      current.surface.querySelector("[data-easymde-preview-window-spacer]"),
    ).not.toBeNull();
    current.unmount();
    geometry.restore();
  });

  it("pins the document-end block when a windowed root caret reaches the trailing boundary", async () => {
    const geometry = installSequenceGeometry();
    const fixture = windowedFixture(320, "root-boundary");
    const current = setup({
      contentEditable: true,
      initialEditMap: fixture.editMap,
      initialHtml: fixture.html,
      initialSignature: "root-boundary",
      stagingScheduler: { now: () => 0, yield: () => Promise.resolve() },
      windowed: true,
    });
    geometry.attach(current.canvas, current.surface);
    await act(async () => {
      for (let index = 0; index < 12; index += 1) await Promise.resolve();
      await flushAnimationFrames();
    });
    expect(
      current.surface.querySelector('[data-easymde-visual-block-id="b319"]'),
    ).toBeNull();
    const range = document.createRange();
    range.setStart(current.surface, current.surface.childNodes.length);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    current.surface.ownerDocument.dispatchEvent(new Event("selectionchange"));
    await waitFor(() =>
      expect(
        current.runtime
          .getAcceptedWindowSnapshot()
          ?.blocks.some((block) => block.id === "b319"),
      ).toBe(true),
    );

    expect(
      current.surface.querySelector('[data-easymde-visual-block-id="b319"]'),
    ).not.toBeNull();
    expect(
      current.surface.querySelector("[data-easymde-preview-window-spacer]"),
    ).not.toBeNull();
    current.unmount();
    geometry.restore();
  });

  it("pins a direct-child thematic-break selection across a window commit", async () => {
    const geometry = installSequenceGeometry();
    const fixture = windowedFixture(320, "windowed-thematic-break-selection");
    const blockIndex = 319;
    const html = safeHtml(
      fixture.html.replace(
        `<p data-easymde-visual-block-id="b${blockIndex}">b${blockIndex}</p>`,
        `<hr data-easymde-visual-block-id="b${blockIndex}">`,
      ),
    );
    const current = setup({
      contentEditable: true,
      initialEditMap: fixture.editMap,
      initialHtml: html,
      initialSignature: fixture.editMap.signature,
      stagingScheduler: { yield: () => Promise.resolve() },
      windowed: true,
    });
    geometry.attach(current.canvas, current.surface);
    Object.defineProperty(current.canvas, "clientHeight", {
      configurable: true,
      value: 240,
    });
    await act(async () => {
      for (let index = 0; index < 16; index += 1) await Promise.resolve();
      await flushAnimationFrames(12);
    });
    current.canvas.scrollTop = 7_440;
    current.canvas.dispatchEvent(new Event("scroll"));
    await act(async () => flushAnimationFrames(12));

    const thematicBreak = current.surface.querySelector<HTMLElement>(
      `[data-easymde-visual-block-id="b${blockIndex}"]`,
    );
    if (!thematicBreak) throw new Error("preview-test-thematic-break-missing");
    const childIndex = Array.prototype.indexOf.call(
      current.surface.childNodes,
      thematicBreak,
    );
    if (childIndex < 0)
      throw new Error("preview-test-thematic-break-index-missing");
    const selection = window.getSelection();
    if (!selection) throw new Error("preview-test-selection-missing");
    current.surface.focus();
    selection.removeAllRanges();
    selection.setBaseAndExtent(
      current.surface,
      childIndex,
      current.surface,
      childIndex + 1,
    );
    current.surface.ownerDocument.dispatchEvent(new Event("selectionchange"));
    await act(async () => flushAnimationFrames(2));

    expect(
      current.surface.querySelector<HTMLElement>(
        `[data-easymde-visual-block-id="b${blockIndex}"]`,
      ),
    ).toBe(thematicBreak);
    expect(selection.isCollapsed).toBe(false);
    expect(selection.anchorNode).toBe(current.surface);
    expect(selection.focusNode).toBe(current.surface);
    current.unmount();
    geometry.restore();
  });

  it("commits a prepared document-end pin through the Safe Preview sink until release", async () => {
    const geometry = installSequenceGeometry();
    const signature = "history-document-end";
    const fixture = documentEndFixture(220, signature, "\n\n");
    const current = setup({
      contentEditable: true,
      initialHtml: "<p>Initial preview</p>",
      stagingScheduler: { now: () => 0, yield: () => Promise.resolve() },
      windowed: true,
    });
    geometry.attach(current.canvas, current.surface);
    await act(async () => flushAnimationFrames());
    Object.defineProperty(current.canvas, "clientHeight", {
      configurable: true,
      value: 10_000,
    });
    const replaceChildren = vi.spyOn(current.surface, "replaceChildren");
    window.getSelection()?.removeAllRanges();

    const lease = current.runtime.prepareDocumentEndWindowPin(signature);
    expect(() =>
      current.runtime.prepareDocumentEndWindowPin(signature),
    ).toThrow("preview-window-document-end-pin-already-active");
    replaceChildren.mockClear();
    act(() => {
      current.session.schedule(request(fixture.markdown, signature), true);
    });
    await act(async () => {
      current.responses[0]?.resolve({
        editMap: fixture.editMap,
        features: {},
        html: fixture.html,
      });
      for (let index = 0; index < 24; index += 1) await Promise.resolve();
      await flushAnimationFrames(12);
    });

    const initialCommit = replaceChildren.mock.calls[0];
    expect(initialCommit).toBeDefined();
    expect(
      initialCommit?.some(
        (node) =>
          node instanceof HTMLElement &&
          "b219" === node.getAttribute("data-easymde-visual-block-id"),
      ),
    ).toBe(true);
    const initialElements =
      initialCommit?.filter(
        (node): node is HTMLElement => node instanceof HTMLElement,
      ) ?? [];
    const initialBlockCount = initialElements.filter((node) =>
      node.hasAttribute("data-easymde-visual-block-id"),
    ).length;
    expect(initialBlockCount).toBeGreaterThan(0);
    expect(initialBlockCount).toBeLessThanOrEqual(160);
    let coveredThrough = 0;
    for (const range of previewWindowRanges(initialElements)) {
      expect(range.start).toBe(coveredThrough);
      expect(range.end).toBeGreaterThan(range.start);
      coveredThrough = range.end;
    }
    expect(coveredThrough).toBe(220);
    expect(
      current.surface.querySelector('[data-easymde-visual-block-id="b219"]'),
    ).not.toBeNull();

    const rootCaret = document.createRange();
    rootCaret.setStart(current.surface, 0);
    rootCaret.collapse(true);
    window.getSelection()?.addRange(rootCaret);
    current.surface.ownerDocument.dispatchEvent(new Event("selectionchange"));
    await act(async () => flushAnimationFrames(2));
    expect(
      current.surface.querySelector('[data-easymde-visual-block-id="b219"]'),
    ).not.toBeNull();
    const pinnedElements = Array.from(current.surface.children);
    expect(
      pinnedElements.filter((node) =>
        node.hasAttribute("data-easymde-visual-block-id"),
      ).length,
    ).toBeLessThanOrEqual(160);
    coveredThrough = 0;
    for (const range of previewWindowRanges(pinnedElements)) {
      expect(range.start).toBe(coveredThrough);
      expect(range.end).toBeGreaterThan(range.start);
      coveredThrough = range.end;
    }
    expect(coveredThrough).toBe(220);

    const finalBlock = current.surface.querySelector(
      '[data-easymde-visual-block-id="b219"]',
    );
    const finalText = finalBlock?.firstChild;
    if (!finalText) throw new Error("preview-test-document-end-text-missing");
    const finalCaret = document.createRange();
    finalCaret.setStart(finalText, 0);
    finalCaret.collapse(true);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(finalCaret);
    current.surface.ownerDocument.dispatchEvent(new Event("selectionchange"));
    const pinnedWindowKey = current.runtime.getAcceptedWindowSnapshot()?.key;
    act(() => lease.release());
    await waitFor(() => {
      const accepted = current.runtime.getAcceptedWindowSnapshot();
      expect(accepted?.key).not.toBe(pinnedWindowKey);
      expect(accepted?.blocks.length).toBeGreaterThan(160);
    });

    expect(
      current.surface.querySelector('[data-easymde-visual-block-id="b219"]'),
    ).not.toBeNull();
    const releasedElements = Array.from(current.surface.children);
    const releasedBlockCount = releasedElements.filter((node) =>
      node.hasAttribute("data-easymde-visual-block-id"),
    ).length;
    expect(releasedBlockCount).toBeLessThanOrEqual(192);
    expect(releasedBlockCount).toBeGreaterThan(160);
    expect(
      current.surface.querySelector("[data-easymde-preview-window-spacer]"),
    ).not.toBeNull();
    act(() => lease.release());
    replaceChildren.mockRestore();
    current.unmount();
    geometry.restore();
  });

  it("pins the accepted Preview block for a non-document-end source selection", async () => {
    const signature = "history-source-selection";
    const fixture = documentEndFixture(220, signature, "\n\n");
    const current = setup({
      contentEditable: true,
      initialHtml: "<p>Initial preview</p>",
      stagingScheduler: { yield: () => Promise.resolve() },
      windowed: true,
    });
    await act(async () => flushAnimationFrames());
    const sourceOffset = fixture.markdown.indexOf("line-180");
    const sourceEnd = fixture.markdown.indexOf("line-181");
    if (sourceOffset < 0 || sourceEnd < 0) {
      throw new Error("preview-test-source-selection-missing");
    }
    const lease = current.runtime.prepareDocumentEndWindowPin(signature, {
      end: sourceEnd,
      start: sourceOffset,
    });
    const replaceChildren = vi.spyOn(current.surface, "replaceChildren");
    act(() => {
      current.session.schedule(request(fixture.markdown, signature), true);
    });
    await act(async () => {
      current.responses[0]?.resolve({
        editMap: fixture.editMap,
        features: {},
        html: fixture.html,
      });
      for (let index = 0; index < 24; index += 1) await Promise.resolve();
      await flushAnimationFrames(12);
    });

    const initialCommit = replaceChildren.mock.calls[0];
    expect(initialCommit).toBeDefined();
    expect(
      initialCommit?.some(
        (node) =>
          node instanceof HTMLElement &&
          "b180" === node.getAttribute("data-easymde-visual-block-id"),
      ),
    ).toBe(true);
    expect(
      initialCommit?.some(
        (node) =>
          node instanceof HTMLElement &&
          "b181" === node.getAttribute("data-easymde-visual-block-id"),
      ),
    ).toBe(true);
    expect(
      current.surface.querySelectorAll("[data-easymde-visual-block-id]").length,
    ).toBeLessThanOrEqual(160);
    expect(
      current.surface.querySelector('[data-easymde-visual-block-id="b180"]'),
    ).not.toBeNull();
    expect(current.onDiagnostic).not.toHaveBeenCalled();
    lease.release();
    replaceChildren.mockRestore();
  });

  it.each([
    {
      first: "b0",
      label: "whole-document",
      last: "b219",
      select: (markdown: string) => ({ end: markdown.length, start: 0 }),
    },
    {
      first: "b20",
      label: "partial-wide",
      last: "b200",
      select: (markdown: string) => ({
        end: markdown.indexOf("line-200"),
        start: markdown.indexOf("line-20"),
      }),
    },
  ])(
    "pins only bounded endpoints for a $label history selection",
    async ({ first, last, select }) => {
      const signature = "history-source-selection-bounded";
      const fixture = documentEndFixture(220, signature);
      const current = setup({
        contentEditable: true,
        initialHtml: "<p>Initial preview</p>",
        stagingScheduler: { yield: () => Promise.resolve() },
        windowed: true,
      });
      await act(async () => flushAnimationFrames());
      const selection = select(fixture.markdown);
      if (selection.start < 0 || selection.end <= selection.start) {
        throw new Error("preview-test-wide-selection-missing");
      }
      const lease = current.runtime.prepareDocumentEndWindowPin(
        signature,
        selection,
      );
      const replaceChildren = vi.spyOn(current.surface, "replaceChildren");
      act(() => {
        current.session.schedule(request(fixture.markdown, signature), true);
      });
      await act(async () => {
        current.responses[0]?.resolve({
          editMap: fixture.editMap,
          features: {},
          html: fixture.html,
        });
        for (let index = 0; index < 24; index += 1) await Promise.resolve();
        await flushAnimationFrames(12);
      });

      const initialCommit = replaceChildren.mock.calls[0];
      expect(current.onDiagnostic).not.toHaveBeenCalled();
      expect(initialCommit).toBeDefined();
      const initialElements =
        initialCommit?.filter(
          (node): node is HTMLElement => node instanceof HTMLElement,
        ) ?? [];
      const initialBlockCount = initialElements.filter((node) =>
        node.hasAttribute("data-easymde-visual-block-id"),
      ).length;
      expect(initialBlockCount).toBeLessThanOrEqual(160);
      expect(
        initialElements.some(
          (node) => first === node.getAttribute("data-easymde-visual-block-id"),
        ),
      ).toBe(true);
      expect(
        initialElements.some(
          (node) => last === node.getAttribute("data-easymde-visual-block-id"),
        ),
      ).toBe(true);
      let coveredThrough = 0;
      for (const range of previewWindowRanges(initialElements)) {
        expect(range.start).toBe(coveredThrough);
        expect(range.end).toBeGreaterThan(range.start);
        coveredThrough = range.end;
      }
      expect(coveredThrough).toBe(220);
      expect(
        current.surface.querySelector(
          `[data-easymde-visual-block-id="${first}"]`,
        ),
      ).not.toBeNull();
      expect(
        current.surface.querySelector(
          `[data-easymde-visual-block-id="${last}"]`,
        ),
      ).not.toBeNull();
      expect(current.renderPreview.mock.calls[0]?.[0]).toEqual(
        expect.objectContaining({ markdown: fixture.markdown }),
      );

      act(() => lease.release());
      await act(async () => flushAnimationFrames(12));
      expect(current.onDiagnostic).not.toHaveBeenCalled();
      expect(current.runtime.getAcceptedWindowSnapshot()).not.toBeNull();
      replaceChildren.mockRestore();
      current.unmount();
    },
  );

  it("maps a selection ending at an empty line boundary to the previous Preview block", async () => {
    const signature = "history-source-selection-empty-line-boundary";
    const lines = Array.from({ length: 220 }, (_, index) =>
      index === 180 ? "" : `line-${index}`,
    );
    const markdown = lines.join("\n");
    const blocks = lines.flatMap((line, index) =>
      line
        ? [
            {
              editable: true as const,
              endLine: index + 1,
              id: `b${index}`,
              startLine: index,
            },
          ]
        : [],
    );
    const html = blocks
      .map(({ id }) => `<p data-easymde-visual-block-id="${id}">${id}</p>`)
      .join("") as SafePreviewHtml;
    const current = setup({
      contentEditable: true,
      initialHtml: "<p>Initial preview</p>",
      stagingScheduler: { yield: () => Promise.resolve() },
      windowed: true,
    });
    await act(async () => flushAnimationFrames());
    const start = markdown.indexOf("line-179");
    const end = markdown.indexOf("\n\nline-181") + 1;
    if (start < 0 || end <= start) {
      throw new Error("preview-test-empty-line-boundary-missing");
    }
    const pin = current.runtime.prepareDocumentEndWindowPin(signature, {
      end,
      start,
    });
    act(() => current.session.schedule(request(markdown, signature), true));
    await act(async () => {
      current.responses[0]?.resolve({
        editMap: {
          version: 1,
          coordinate: "line",
          signature,
          blocks,
        },
        features: {},
        html,
      });
      for (let index = 0; index < 32; index += 1) await Promise.resolve();
      await flushAnimationFrames(24);
    });

    expect(current.onDiagnostic).not.toHaveBeenCalledWith(
      "preview-window-selection-block-unavailable",
    );
    expect(
      current.surface.querySelector('[data-easymde-visual-block-id="b179"]'),
    ).not.toBeNull();
    pin.release();
    current.unmount();
  });

  it("mounts the following block for a collapsed pinned caret on an empty line", async () => {
    const signature = "history-source-selection-collapsed-empty-line";
    const lines = Array.from({ length: 220 }, (_, index) =>
      index === 180 ? "" : `line-${index}`,
    );
    const markdown = lines.join("\n");
    const blocks = lines.flatMap((line, index) =>
      line
        ? [
            {
              editable: true as const,
              endLine: index + 1,
              id: `b${index}`,
              startLine: index,
            },
          ]
        : [],
    );
    const html = blocks
      .map(({ id }) => `<p data-easymde-visual-block-id="${id}">${id}</p>`)
      .join("") as SafePreviewHtml;
    const current = setup({
      contentEditable: true,
      initialHtml: "<p>Initial preview</p>",
      stagingScheduler: { yield: () => Promise.resolve() },
      windowed: true,
    });
    await act(async () => flushAnimationFrames());
    // A removal collapses its caret where the removed block started, which
    // can be the empty line its former line terminator left behind.
    const gap = markdown.indexOf("\n\nline-181") + 1;
    if (gap <= 0 || "\n" !== markdown[gap]) {
      throw new Error("preview-test-empty-line-caret-missing");
    }
    const pin = current.runtime.prepareDocumentEndWindowPin(signature, {
      end: gap,
      start: gap,
    });
    act(() => current.session.schedule(request(markdown, signature), true));
    await act(async () => {
      current.responses[0]?.resolve({
        editMap: {
          version: 1,
          coordinate: "line",
          signature,
          blocks,
        },
        features: {},
        html,
      });
      for (let index = 0; index < 32; index += 1) await Promise.resolve();
      await flushAnimationFrames(24);
    });

    expect(current.onDiagnostic).not.toHaveBeenCalledWith(
      "preview-window-selection-block-unavailable",
    );
    expect(
      current.surface.querySelector('[data-easymde-visual-block-id="b181"]'),
    ).not.toBeNull();
    pin.release();
    current.unmount();
  });

  it("rejects an accepted source selection outside the request Markdown", async () => {
    const signature = "history-source-selection-invalid-endpoint";
    const fixture = documentEndFixture(220, signature);
    const current = setup({
      contentEditable: true,
      initialHtml: "<p>Initial preview</p>",
      stagingScheduler: { yield: () => Promise.resolve() },
      windowed: true,
    });
    await act(async () => flushAnimationFrames());
    const invalidOffset = fixture.markdown.length + 1;
    const lease = current.runtime.prepareDocumentEndWindowPin(signature, {
      end: invalidOffset,
      start: invalidOffset,
    });
    act(() => {
      current.session.schedule(request(fixture.markdown, signature), true);
    });
    await act(async () => {
      current.responses[0]?.resolve({
        editMap: fixture.editMap,
        features: {},
        html: fixture.html,
      });
      for (let index = 0; index < 24; index += 1) await Promise.resolve();
      await flushAnimationFrames(8);
    });

    expect(current.onDiagnostic).toHaveBeenCalledWith(
      "preview-window-selection-range-invalid",
    );
    expect(current.surface.getAttribute("data-easymde-preview-error")).toBe(
      "1",
    );
    lease.release();
  });

  it("releases an active selection pin when the windowed owner exits", async () => {
    const signature = "history-selection-owner-transition";
    const current = setup({
      initialHtml: "<p>Initial preview</p>",
      stagingScheduler: { yield: () => Promise.resolve() },
      windowed: true,
    });
    await act(async () => flushAnimationFrames());
    const lease = current.runtime.prepareDocumentEndWindowPin(signature);

    current.setWindowed(false);
    await act(async () => flushAnimationFrames(2));
    current.setWindowed(true);
    await act(async () => flushAnimationFrames(2));

    const replacementLease =
      current.runtime.prepareDocumentEndWindowPin("replacement");
    replacementLease.release();
    lease.release();
  });

  it.each([8, 160] as const)(
    "releases a matching document-end pin when the accepted Preview has %i blocks",
    async (blockCount) => {
      const signature = `history-document-end-small-${blockCount}`;
      const fixture = documentEndFixture(blockCount, signature, "\n\n");
      const current = setup({
        contentEditable: true,
        initialHtml: "<p>Initial preview</p>",
        stagingScheduler: { yield: () => Promise.resolve() },
        windowed: true,
      });
      await act(async () => flushAnimationFrames());

      const lease = current.runtime.prepareDocumentEndWindowPin(signature);
      act(() => {
        current.session.schedule(request(fixture.markdown, signature), true);
      });
      await act(async () => {
        current.responses[0]?.resolve({
          editMap: fixture.editMap,
          features: {},
          html: fixture.html,
        });
        for (let index = 0; index < 24; index += 1) await Promise.resolve();
        await flushAnimationFrames(8);
      });

      expect(current.surface.getAttribute("aria-busy")).toBe("false");
      expect(current.surface.getAttribute("contenteditable")).toBe("true");
      expect(current.surface.easymdePreviewSignature).toBe(signature);
      expect(
        current.surface.querySelectorAll("[data-easymde-visual-block-id]"),
      ).toHaveLength(blockCount);
      expect(
        current.surface.querySelector("[data-easymde-preview-window-spacer]"),
      ).toBeNull();
      expect(current.onDiagnostic).not.toHaveBeenCalled();

      lease.release();
      lease.release();
      const nextLease = current.runtime.prepareDocumentEndWindowPin("next");
      nextLease.release();
    },
  );

  it.each([
    { label: "CRLF blank lines", signature: "crlf", suffix: "\r\n\r\n" },
    {
      label: "a lone-CR omitted whitespace-only line",
      signature: "lone-cr-whitespace",
      suffix: "\r \t",
    },
  ])(
    "pins the final block with $label",
    async ({ signature: caseSignature, suffix }) => {
      const signature = `history-document-end-${caseSignature}`;
      const fixture = documentEndFixture(220, signature, suffix);
      const current = setup({
        contentEditable: true,
        initialHtml: "<p>Initial preview</p>",
        stagingScheduler: { yield: () => Promise.resolve() },
        windowed: true,
      });
      await act(async () => flushAnimationFrames());
      const replaceChildren = vi.spyOn(current.surface, "replaceChildren");
      window.getSelection()?.removeAllRanges();

      const lease = current.runtime.prepareDocumentEndWindowPin(signature);
      replaceChildren.mockClear();
      act(() => {
        current.session.schedule(request(fixture.markdown, signature), true);
      });
      await act(async () => {
        current.responses[0]?.resolve({
          editMap: fixture.editMap,
          features: {},
          html: fixture.html,
        });
        for (let index = 0; index < 24; index += 1) await Promise.resolve();
        await flushAnimationFrames(12);
      });

      const initialCommit = replaceChildren.mock.calls[0];
      expect(initialCommit).toBeDefined();
      expect(
        initialCommit?.some(
          (node) =>
            node instanceof HTMLElement &&
            "b219" === node.getAttribute("data-easymde-visual-block-id"),
        ),
      ).toBe(true);
      expect(
        current.surface.querySelector('[data-easymde-visual-block-id="b219"]'),
      ).not.toBeNull();
      expect(current.onDiagnostic).not.toHaveBeenCalledWith(
        "preview-window-document-end-block-unavailable",
      );
      lease.release();
      replaceChildren.mockRestore();
    },
  );

  it("rejects nonempty source after a lone-CR document-end block", async () => {
    const signature = "history-document-end-lone-cr-hidden-source";
    const fixture = documentEndFixture(
      220,
      signature,
      "\r\r[ref]: https://example.test\r",
    );
    const current = setup({
      contentEditable: true,
      initialHtml: "<p>Initial preview</p>",
      stagingScheduler: { yield: () => Promise.resolve() },
      windowed: true,
    });
    await act(async () => flushAnimationFrames());
    const lease = current.runtime.prepareDocumentEndWindowPin(signature);
    act(() => {
      current.session.schedule(request(fixture.markdown, signature), true);
    });
    await act(async () => {
      current.responses[0]?.resolve({
        editMap: fixture.editMap,
        features: {},
        html: fixture.html,
      });
      for (let index = 0; index < 24; index += 1) await Promise.resolve();
      await flushAnimationFrames(8);
    });

    expect(current.onDiagnostic).toHaveBeenCalledWith(
      "preview-window-document-end-block-unavailable",
    );
    expect(current.surface.getAttribute("data-easymde-preview-error")).toBe(
      "1",
    );
    lease.release();
  });

  it.each(["", "\n\n"])(
    "pins the EOF source block before trailing generated zero-width roots with suffix %j",
    async (terminalSuffix) => {
      const signature = `history-document-end-generated-${terminalSuffix.length}`;
      const fixture = documentEndWithGeneratedRootsFixture(
        220,
        signature,
        terminalSuffix,
      );
      const current = setup({
        contentEditable: true,
        initialHtml: "<p>Initial preview</p>",
        stagingScheduler: { yield: () => Promise.resolve() },
        windowed: true,
      });
      await act(async () => flushAnimationFrames());
      const lease = current.runtime.prepareDocumentEndWindowPin(signature);
      act(() => {
        current.session.schedule(request(fixture.markdown, signature), true);
      });
      await act(async () => {
        current.responses[0]?.resolve({
          editMap: fixture.editMap,
          features: {},
          html: fixture.html,
        });
        for (let index = 0; index < 24; index += 1) await Promise.resolve();
        await flushAnimationFrames(8);
      });

      expect(
        current.surface.getAttribute("data-easymde-preview-error"),
      ).toBeNull();
      expect(current.surface.easymdePreviewSignature).toBe(signature);
      expect(
        current.surface.querySelector('[data-easymde-visual-block-id="b219"]'),
      ).not.toBeNull();
      let materialization!: Promise<boolean>;
      act(() => {
        materialization = current.runtime.materialize();
      });
      await act(async () => flushAnimationFrames(8));
      await expect(materialization).resolves.toBe(true);
      expect(
        current.surface
          .querySelector('[data-easymde-visual-block-id="b220"]')
          ?.getAttribute("contenteditable"),
      ).toBe("false");
      expect(
        current.surface
          .querySelector('[data-easymde-visual-block-id="b221"]')
          ?.getAttribute("contenteditable"),
      ).toBe("false");
      expect(current.onDiagnostic).not.toHaveBeenCalled();
      lease.release();
    },
  );

  it("rejects an ambiguous EOF map with a trailing editable block", async () => {
    const signature = "history-document-end-trailing-editable";
    const fixture = documentEndFixture(220, signature, "\n\n");
    const trailingEditableBlock = {
      id: "b220",
      startLine: 220,
      endLine: 221,
      editable: true,
    } as const;
    const editMap = {
      ...fixture.editMap,
      blocks: [...fixture.editMap.blocks, trailingEditableBlock],
    };
    const html = (fixture.html +
      '<p data-easymde-visual-block-id="b220">Trailing source</p>') as SafePreviewHtml;
    const current = setup({
      contentEditable: true,
      initialHtml: "<p>Initial preview</p>",
      stagingScheduler: { yield: () => Promise.resolve() },
      windowed: true,
    });
    const lease = current.runtime.prepareDocumentEndWindowPin(signature);
    act(() => {
      current.session.schedule(request(fixture.markdown, signature), true);
    });
    await act(async () => {
      current.responses[0]?.resolve({ editMap, features: {}, html });
      for (let index = 0; index < 24; index += 1) await Promise.resolve();
      await flushAnimationFrames(8);
    });

    expect(current.onDiagnostic).toHaveBeenCalledWith(
      "preview-window-document-end-block-unavailable",
    );
    expect(current.surface.getAttribute("data-easymde-preview-error")).toBe(
      "1",
    );
    lease.release();
  });

  it("invalidates a superseded document-end lease by token without clearing its replacement", async () => {
    const current = setup({
      contentEditable: true,
      initialHtml: "<p>Initial preview</p>",
      stagingScheduler: { yield: () => Promise.resolve() },
      windowed: true,
    });
    const staleLease = current.runtime.prepareDocumentEndWindowPin("stale", {
      end: 0,
      start: 0,
    });
    act(() => {
      current.session.schedule(request("# Superseded", "superseded"), true);
    });
    const signature = "replacement";
    const fixture = documentEndFixture(220, signature);
    const sourceOffset = fixture.markdown.indexOf("line-219");
    if (sourceOffset < 0)
      throw new Error("preview-test-stale-selection-missing");
    const replacementLease = current.runtime.prepareDocumentEndWindowPin(
      signature,
      {
        end: sourceOffset,
        start: sourceOffset,
      },
    );
    act(() => {
      current.session.schedule(request(fixture.markdown, signature), true);
      staleLease.release();
    });
    await act(async () => {
      current.responses[1]?.resolve({
        editMap: fixture.editMap,
        features: {},
        html: fixture.html,
      });
      for (let index = 0; index < 24; index += 1) await Promise.resolve();
      await flushAnimationFrames(12);
    });

    expect(
      current.surface.querySelector('[data-easymde-visual-block-id="b219"]'),
    ).not.toBeNull();
    act(() => replacementLease.release());
  });

  it("rejects invalid document-end maps and releases the lease on enhancement failure", async () => {
    const signature = "invalid-document-end";
    const fixture = documentEndFixture(220, signature);
    const invalidMap = {
      ...fixture.editMap,
      blocks: fixture.editMap.blocks.map((block, index) =>
        index === 219 ? { ...block, editable: false } : block,
      ),
    };
    const current = setup({
      contentEditable: true,
      initialHtml: "<p>Initial preview</p>",
      stagingScheduler: { yield: () => Promise.resolve() },
      windowed: true,
    });
    const lease = current.runtime.prepareDocumentEndWindowPin(signature);
    act(() => {
      current.session.schedule(request(fixture.markdown, signature), true);
    });
    await act(async () => {
      current.responses[0]?.resolve({
        editMap: invalidMap,
        features: {},
        html: fixture.html,
      });
      for (let index = 0; index < 24; index += 1) await Promise.resolve();
      await flushAnimationFrames(8);
    });

    expect(current.onDiagnostic).toHaveBeenCalledWith(
      "preview-window-document-end-block-unavailable",
    );
    expect(current.surface.getAttribute("data-easymde-preview-error")).toBe(
      "1",
    );
    const nextLease = current.runtime.prepareDocumentEndWindowPin("next");
    lease.release();
    nextLease.release();
  });

  it("does not apply a cancelled source-selection pin to a later matching request", async () => {
    const signature = "cancelled-document-end";
    const fixture = documentEndFixture(220, signature);
    const current = setup({
      contentEditable: true,
      initialHtml: "<p>Initial preview</p>",
      stagingScheduler: { yield: () => Promise.resolve() },
      windowed: true,
    });
    const lease = current.runtime.prepareDocumentEndWindowPin(signature, {
      end: 0,
      start: 0,
    });
    lease.release();
    const replaceChildren = vi.spyOn(current.surface, "replaceChildren");
    act(() => {
      current.session.schedule(request(fixture.markdown, signature), true);
    });
    await act(async () => {
      current.responses[0]?.resolve({
        editMap: fixture.editMap,
        features: {},
        html: fixture.html,
      });
      for (let index = 0; index < 24; index += 1) await Promise.resolve();
      await flushAnimationFrames(12);
    });

    expect(
      replaceChildren.mock.calls.some((nodes) =>
        nodes.some(
          (node) =>
            node instanceof HTMLElement &&
            "b219" === node.getAttribute("data-easymde-visual-block-id"),
        ),
      ),
    ).toBe(false);
    expect(
      current.surface.querySelector('[data-easymde-visual-block-id="b219"]'),
    ).toBeNull();
    replaceChildren.mockRestore();
  });

  it("rejects an accepted Preview with a mismatched edit-map signature", async () => {
    const signature = "requested-document-end";
    const fixture = documentEndFixture(220, "stale-edit-map-signature");
    const current = setup({
      contentEditable: true,
      initialHtml: "<p>Initial preview</p>",
      stagingScheduler: { yield: () => Promise.resolve() },
      windowed: true,
    });
    const lease = current.runtime.prepareDocumentEndWindowPin(signature);
    act(() => {
      current.session.schedule(request(fixture.markdown, signature), true);
    });
    await act(async () => {
      current.responses[0]?.resolve({
        editMap: fixture.editMap,
        features: {},
        html: fixture.html,
      });
      for (let index = 0; index < 24; index += 1) await Promise.resolve();
      await flushAnimationFrames(8);
    });

    expect(current.onDiagnostic).toHaveBeenCalledWith(
      "preview-window-edit-map-invalid",
    );
    expect(current.surface.getAttribute("data-easymde-preview-error")).toBe(
      "1",
    );
    lease.release();
  });

  it("invalidates a prepared document-end lease on owner teardown", () => {
    const current = setup({
      contentEditable: true,
      initialHtml: "<p>Initial preview</p>",
      windowed: true,
    });
    const lease = current.runtime.prepareDocumentEndWindowPin("teardown");

    current.unmount();

    expect(() => lease.release()).not.toThrow();
    expect(() => current.runtime.prepareDocumentEndWindowPin("late")).toThrow(
      "preview-window-document-end-owner-inactive",
    );
  });

  it("materializes the complete Preview asynchronously for a same-activation consumer", async () => {
    const fixture = windowedFixture(320, "materialize-now");
    const current = setup({
      contentEditable: true,
      initialEditMap: fixture.editMap,
      initialHtml: fixture.html,
      initialSignature: "materialize-now",
      stagingScheduler: { yield: () => Promise.resolve() },
      windowed: true,
    });

    await act(async () => {
      for (let index = 0; index < 12; index += 1) await Promise.resolve();
    });
    await act(async () => flushAnimationFrames());
    expect(
      current.surface.querySelector("[data-easymde-preview-window-spacer]"),
    ).not.toBeNull();

    let materialization!: Promise<boolean>;
    act(() => {
      materialization = current.runtime.materialize();
    });
    await act(async () => flushAnimationFrames(8));
    await expect(materialization).resolves.toBe(true);

    expect(
      current.surface.querySelectorAll("[data-easymde-visual-block-id]"),
    ).toHaveLength(320);
    expect(
      current.surface.querySelector("[data-easymde-preview-window-spacer]"),
    ).toBeNull();
  });

  it("cancels stale window materialization when an authoritative empty Preview replaces it", async () => {
    const fixture = windowedFixture(320, "materialize-empty-transition");
    const pending: Array<ReturnType<typeof deferred<void>>> = [];
    const materializeScheduler: MaterializeScheduler = {
      pending,
      yield: vi.fn(() => {
        const next = deferred<void>();
        pending.push(next);
        return next.promise;
      }),
    };
    const current = setup({
      emptyMode: "paper",
      initialEditMap: fixture.editMap,
      initialHtml: fixture.html,
      initialSignature: "materialize-empty-transition",
      materializeScheduler,
      stagingScheduler: { yield: () => Promise.resolve() },
      windowed: true,
    });

    await act(async () => {
      for (let index = 0; index < 12; index += 1) await Promise.resolve();
    });
    await act(async () => flushAnimationFrames());
    expect(
      current.surface.querySelector("[data-easymde-preview-window-spacer]"),
    ).not.toBeNull();

    let staleMaterialization!: Promise<boolean>;
    act(() => {
      staleMaterialization = current.runtime.materialize();
    });
    expect(materializeScheduler.yield).toHaveBeenCalledOnce();

    act(() => {
      current.session.schedule(request("", "authoritative-empty"), true);
    });
    await expect(staleMaterialization).resolves.toBe(false);
    await act(async () => {
      await Promise.resolve();
      await flushAnimationFrames(2);
    });

    expect(current.surface.innerHTML).toBe("");
    let freshMaterialization!: Promise<boolean>;
    act(() => {
      freshMaterialization = current.runtime.materialize();
    });
    await expect(freshMaterialization).resolves.toBe(true);
    expect(current.onDiagnostic).not.toHaveBeenCalled();

    pending.shift()?.resolve();
    await act(async () => {
      await Promise.resolve();
    });
  });

  it("does not report materialization success while a newer Preview is loading", async () => {
    const fixture = windowedFixture(320, "materialize-loading-transition");
    const current = setup({
      initialEditMap: fixture.editMap,
      initialHtml: fixture.html,
      initialSignature: "materialize-loading-transition",
      stagingScheduler: { yield: () => Promise.resolve() },
      windowed: true,
    });

    await act(async () => {
      for (let index = 0; index < 12; index += 1) await Promise.resolve();
    });
    await act(async () => flushAnimationFrames());
    const partialChildren = Array.from(current.surface.childNodes);
    expect(
      current.surface.querySelector("[data-easymde-preview-window-spacer]"),
    ).not.toBeNull();

    act(() => {
      current.session.schedule(
        request("# Loading", "materialize-loading"),
        true,
      );
    });
    current.surface.replaceChildren(...partialChildren);
    expect(
      current.surface.querySelector("[data-easymde-preview-window-spacer]"),
    ).not.toBeNull();
    await expect(current.runtime.materialize()).resolves.toBe(false);
    expect(current.onDiagnostic).toHaveBeenCalledWith(
      "preview-window-materialize-not-ready",
    );
    current.unmount();
  });

  it("publishes the installed window snapshot before a post-install scheduler yield", async () => {
    const fixture = windowedFixture(320, "installed-window-owner");
    const held = deferred<void>();
    const snapshots: string[] = [];
    let editorOwner = "full";
    let ownerAtUndo: string | null = null;
    let current!: ReturnType<typeof setup>;
    const stagingScheduler: PreviewSurfaceStagingScheduler = {
      yield: vi.fn(() =>
        current?.surface.querySelector("[data-easymde-preview-window-spacer]")
          ? held.promise
          : Promise.resolve(),
      ),
    };
    current = setup({
      initialHtml: "<p>Before</p>",
      onSnapshotReady: (_html, signature) => {
        snapshots.push(signature);
        if (signature === "installed-window-owner") editorOwner = "windowed";
      },
      stagingScheduler,
      windowed: true,
    });
    try {
      current.surface.addEventListener("keydown", (event) => {
        if (event.key === "z" && event.ctrlKey) ownerAtUndo = editorOwner;
      });
      act(() =>
        current.session.schedule(
          request("# Windowed", "installed-window-owner"),
          true,
        ),
      );
      await act(async () => {
        current.responses[0]?.resolve({
          editMap: fixture.editMap,
          features: {},
          html: fixture.html,
        });
        for (let index = 0; index < 20; index += 1) await Promise.resolve();
        await flushAnimationFrames(2);
      });
      expect(
        current.surface.querySelector("[data-easymde-preview-window-spacer]"),
      ).not.toBeNull();
      current.surface.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          ctrlKey: true,
          key: "z",
        }),
      );
      expect(ownerAtUndo).toBe("windowed");
      expect(snapshots.at(-1)).toBe("installed-window-owner");
    } finally {
      held.resolve();
      current.unmount();
    }
  });

  it("rejects materialization while a window candidate is still staging", async () => {
    const fixture = windowedFixture(320, "materialize-committing");
    const pending: Array<ReturnType<typeof deferred<void>>> = [];
    const stagingScheduler: PreviewSurfaceStagingScheduler = {
      yield: vi.fn(() => {
        const next = deferred<void>();
        pending.push(next);
        return next.promise;
      }),
    };
    const current = setup({
      initialEditMap: fixture.editMap,
      initialHtml: fixture.html,
      initialSignature: "materialize-committing",
      stagingScheduler,
      windowed: true,
    });

    await act(async () => {
      for (let index = 0; index < 12; index += 1) await Promise.resolve();
    });
    const first = pending.shift();
    if (!first) throw new Error("materialize-committing-first-yield-missing");
    await act(async () => {
      first.resolve();
      await first.promise;
      await Promise.resolve();
    });
    const second = pending.shift();
    if (!second) throw new Error("materialize-committing-second-yield-missing");
    await act(async () => {
      second.resolve();
      await second.promise;
      await Promise.resolve();
      await flushAnimationFrames(2);
    });
    const stagingYield = pending.shift();
    if (!stagingYield) {
      throw new Error("materialize-staging-yield-missing");
    }
    expect(
      current.surface.querySelector("[data-easymde-preview-window-spacer]"),
    ).toBeNull();

    await expect(current.runtime.materialize()).resolves.toBe(false);
    expect(current.onDiagnostic).toHaveBeenCalledWith(
      "preview-window-materialize-not-ready",
    );
    stagingYield.resolve();
    await act(async () => {
      await stagingYield.promise;
      await Promise.resolve();
    });
    current.unmount();
  });

  it("materializes a windowed Preview asynchronously in bounded batches and preserves the anchor", async () => {
    const fixture = windowedFixture(320, "materialize-async");
    const pending: Array<ReturnType<typeof deferred<void>>> = [];
    const materializeScheduler: MaterializeScheduler = {
      pending,
      yield: vi.fn(() => {
        const next = deferred<void>();
        pending.push(next);
        return next.promise;
      }),
    };
    const current = setup({
      initialEditMap: fixture.editMap,
      initialHtml: fixture.html,
      initialSignature: "materialize-async",
      materializeScheduler,
      stagingScheduler: { yield: () => Promise.resolve() },
      windowed: true,
    });

    await act(async () => {
      for (let index = 0; index < 12; index += 1) await Promise.resolve();
    });
    await act(async () => flushAnimationFrames());

    const anchor = current.surface.querySelector<HTMLElement>(
      '[data-easymde-visual-block-id="b0"]',
    );
    if (!anchor) throw new Error("materialize anchor missing");
    let anchorReads = 0;
    vi.spyOn(anchor, "getBoundingClientRect").mockImplementation(
      () =>
        ({
          bottom: 120,
          height: 20,
          left: 0,
          right: 100,
          top: 100 + (anchorReads++ > 0 ? 18 : 0),
          width: 100,
          x: 0,
          y: 100,
        }) as DOMRect,
    );
    current.canvas.scrollTop = 42;

    let materialization!: Promise<boolean>;
    act(() => {
      materialization = current.runtime.materialize();
    });

    expect(materializeScheduler.yield).toHaveBeenCalledOnce();
    expect(
      current.surface.querySelectorAll("[data-easymde-visual-block-id]").length,
    ).toBeLessThan(320);
    expect(
      current.surface.querySelector("[data-easymde-preview-window-spacer]"),
    ).not.toBeNull();

    for (let index = 0; index < 32; index += 1) {
      const next = pending.shift();
      if (next) {
        await act(async () => {
          next.resolve();
          await next.promise;
          await Promise.resolve();
        });
        continue;
      }
      await act(async () => {
        await Promise.resolve();
      });
      if (0 === pending.length) break;
    }

    await act(async () => {
      while (pending.length > 0) {
        const next = pending.shift();
        if (!next) continue;
        next.resolve();
        await next.promise;
        await Promise.resolve();
      }
    });

    await expect(materialization).resolves.toBe(true);
    expect(
      current.surface.querySelectorAll("[data-easymde-visual-block-id]"),
    ).toHaveLength(320);
    expect(
      current.surface.querySelector("[data-easymde-preview-window-spacer]"),
    ).toBeNull();
    expect(current.canvas.scrollTop).toBe(60);
    expect(materializeScheduler.yield.mock.calls.length).toBeGreaterThan(1);
  });

  it("cancels pending materialization on owner teardown without publishing completion", async () => {
    const fixture = windowedFixture(320, "materialize-teardown");
    const pending: Array<ReturnType<typeof deferred<void>>> = [];
    const materializeScheduler: MaterializeScheduler = {
      pending,
      yield: vi.fn(() => {
        const next = deferred<void>();
        pending.push(next);
        return next.promise;
      }),
    };
    const current = setup({
      initialEditMap: fixture.editMap,
      initialHtml: fixture.html,
      initialSignature: "materialize-teardown",
      materializeScheduler,
      stagingScheduler: { yield: () => Promise.resolve() },
      windowed: true,
    });

    await act(async () => {
      for (let index = 0; index < 12; index += 1) await Promise.resolve();
    });
    await act(async () => flushAnimationFrames());

    let materialization!: Promise<boolean>;
    act(() => {
      materialization = current.runtime.materialize();
    });
    expect(materializeScheduler.yield).toHaveBeenCalledOnce();

    current.unmount();
    await expect(materialization).resolves.toBe(false);

    const next = pending.shift();
    next?.resolve();
    await act(async () => {
      await next?.promise;
      await Promise.resolve();
    });
  });

  it("restores the prior window when a newer Preview supersedes materialization", async () => {
    const fixture = windowedFixture(320, "materialize-stale");
    const pending: Array<ReturnType<typeof deferred<void>>> = [];
    const materializeScheduler: MaterializeScheduler = {
      pending,
      yield: vi.fn(() => {
        const next = deferred<void>();
        pending.push(next);
        return next.promise;
      }),
    };
    const current = setup({
      initialEditMap: fixture.editMap,
      initialHtml: fixture.html,
      initialSignature: "materialize-stale",
      materializeScheduler,
      stagingScheduler: { yield: () => Promise.resolve() },
      windowed: true,
    });

    await act(async () => {
      for (let index = 0; index < 12; index += 1) await Promise.resolve();
    });
    await act(async () => flushAnimationFrames());
    const initialChildren = Array.from(current.surface.childNodes);

    let materialization!: Promise<boolean>;
    act(() => {
      materialization = current.runtime.materialize();
    });
    const firstBatch = pending.shift();
    if (!firstBatch) throw new Error("materialize first batch missing");

    act(() => {
      current.session.schedule(request("# New Preview", "new-preview"), true);
    });
    await expect(materialization).resolves.toBe(false);
    await act(async () => {
      firstBatch.resolve();
      await firstBatch.promise;
      await Promise.resolve();
    });
    expect(Array.from(current.surface.childNodes)).toEqual(initialChildren);
  });

  it("builds a fresh window after lock refresh and a second unlock", async () => {
    const geometry = installSequenceGeometry();
    const initial = windowedFixture(320, "first-window");
    const refreshed = windowedFixture(321, "second-window");
    const current = setup({
      initialEditMap: initial.editMap,
      initialHtml: initial.html,
      initialSignature: "first-window",
      stagingScheduler: { yield: () => Promise.resolve() },
      windowed: true,
    });
    geometry.attach(current.canvas, current.surface);

    await act(async () => {
      for (let index = 0; index < 12; index += 1) await Promise.resolve();
    });
    await act(async () => flushAnimationFrames());
    current.setWindowed(false);
    await act(async () => flushAnimationFrames(12));

    act(() => {
      current.session.schedule(request("# Refreshed", "second-window"), true);
    });
    await act(async () => {
      current.responses[0]?.resolve({
        editMap: refreshed.editMap,
        features: {},
        html: refreshed.html,
      });
      for (let index = 0; index < 12; index += 1) await Promise.resolve();
    });
    await act(async () => flushAnimationFrames());
    expect(
      current.surface.querySelectorAll("[data-easymde-visual-block-id]"),
    ).toHaveLength(321);

    current.setWindowed(true);
    await act(async () => flushAnimationFrames());

    expect(
      current.surface.querySelectorAll("[data-easymde-visual-block-id]").length,
    ).toBeLessThanOrEqual(160);
    expect(
      current.surface.querySelector("[data-easymde-preview-window-spacer]"),
    ).not.toBeNull();
    current.unmount();
    geometry.restore();
  });

  it("updates a ready Preview window without a source owner when the canvas scrolls", async () => {
    const geometry = installSequenceGeometry();
    const fixture = windowedFixture(320, "windowed-scroll");
    const current = setup({
      contentEditable: true,
      initialEditMap: fixture.editMap,
      initialHtml: fixture.html,
      initialSignature: "windowed-scroll",
      stagingScheduler: { now: () => 0, yield: () => Promise.resolve() },
      windowed: true,
    });
    geometry.attach(current.canvas, current.surface);
    Object.defineProperty(current.canvas, "clientHeight", {
      configurable: true,
      value: 240,
    });
    await act(async () => {
      for (let index = 0; index < 12; index += 1) await Promise.resolve();
    });
    await act(async () => flushAnimationFrames());
    expect(
      current.surface.querySelector('[data-easymde-visual-block-id="b319"]'),
    ).toBeNull();

    window.getSelection()?.removeAllRanges();
    current.canvas.scrollTop = 7_440;
    current.canvas.dispatchEvent(new Event("scroll"));
    await waitFor(() =>
      expect(
        current.runtime
          .getAcceptedWindowSnapshot()
          ?.blocks.some((block) => block.id === "b319"),
      ).toBe(true),
    );

    expect(
      current.surface.querySelector('[data-easymde-visual-block-id="b319"]'),
    ).not.toBeNull();
    current.unmount();
    geometry.restore();
  });

  it.each([
    { caseName: "null source" },
    { caseName: "same-body newer revision" },
    { caseName: "different source body" },
  ] as const)(
    "blocks a ready viewport reorder when the provided source owner returns $caseName",
    async ({ caseName }) => {
      const geometry = installSequenceGeometry();
      const fixture = windowedFixture(320, "windowed-blocked-source");
      const markdown = Array.from(
        { length: 320 },
        (_, index) => `b${index}`,
      ).join("\n\n");
      let sourceSnapshot: PreviewSourceSnapshot | null = {
        revision: 0,
        value: markdown,
      };
      const current = setup({
        contentEditable: true,
        currentSourceSnapshot: () => sourceSnapshot,
        initialEditMap: fixture.editMap,
        initialHtml: fixture.html,
        initialSignature: fixture.editMap.signature,
        sourceRevision: 0,
        stagingScheduler: { now: () => 0, yield: () => Promise.resolve() },
        windowed: true,
      });
      geometry.attach(current.canvas, current.surface);
      Object.defineProperty(current.canvas, "clientHeight", {
        configurable: true,
        value: 240,
      });
      await act(async () => {
        for (let index = 0; index < 12; index += 1) await Promise.resolve();
        await flushAnimationFrames();
      });
      const accepted = current.runtime.getAcceptedWindowSnapshot();
      if (!accepted)
        throw new Error("windowed-blocked-source-accepted-missing");
      const installedNodes = Array.from(current.surface.childNodes);
      const sameBodyNewerRevision = "same-body newer revision" === caseName;
      sourceSnapshot =
        "null source" === caseName
          ? null
          : sameBodyNewerRevision
            ? { revision: 1, value: markdown }
            : { revision: 0, value: `${markdown} stale` };

      window.getSelection()?.removeAllRanges();
      current.canvas.scrollTop = 7_440;
      current.canvas.dispatchEvent(new Event("scroll"));
      await act(async () => {
        await flushAnimationFrames(8);
      });

      expect(current.runtime.getAcceptedWindowSnapshot()).toBe(
        sameBodyNewerRevision ? accepted : null,
      );
      expect(Array.from(current.surface.childNodes)).toEqual(installedNodes);
      expect(
        current.surface.querySelector('[data-easymde-visual-block-id="b319"]'),
      ).toBeNull();
      sourceSnapshot = { revision: 0, value: markdown };
      expect(current.runtime.getAcceptedWindowSnapshot()).toBe(accepted);
      expect(current.runtime.getAcceptedWindowSnapshot()?.sourceRevision).toBe(
        accepted.sourceRevision,
      );
      expect(current.onDiagnostic).not.toHaveBeenCalled();
      current.unmount();
      geometry.restore();
    },
  );

  it("fails closed when the server block marker does not match editMap", async () => {
    const fixture = windowedFixture(2, "invalid-map");
    const diagnostics: string[] = [];
    const current = setup({
      contentEditable: true,
      initialEditMap: fixture.editMap,
      initialHtml: fixture.html.replace("b1", "wrong"),
      initialSignature: "invalid-map",
      onDiagnostic: (code) => diagnostics.push(code),
      windowed: true,
    });

    await act(async () => {
      for (let index = 0; index < 8; index += 1) await Promise.resolve();
    });

    expect(diagnostics).toContain("preview-window-block-map-marker-mismatch");
    expect(current.surface.getAttribute("contenteditable")).toBe("false");
    expect(
      current.surface.querySelector("[data-easymde-preview-window-spacer]"),
    ).toBeNull();
  });

  it("offers an immersive ready empty paper without changing the ordinary empty message", () => {
    const ordinaryStatuses: PreviewSurfaceStatus[] = [];
    const ordinary = setup({
      initialHtml: "",
      onStatusChange: (status) => ordinaryStatuses.push(status),
    });

    act(() => {
      ordinary.session.schedule(request(""), true);
    });

    expect(ordinary.surface.textContent).toBe(messages.empty);
    expect(ordinaryStatuses.at(-1)).toBe("empty");

    const paperHtmlChanges: SafePreviewHtml[] = [];
    const paperStatuses: PreviewSurfaceStatus[] = [];
    const paper = setup({
      emptyMode: "paper",
      initialHtml: "",
      onHtmlChange: (html) => paperHtmlChanges.push(html),
      onStatusChange: (status) => paperStatuses.push(status),
    });

    act(() => {
      paper.session.schedule(request(""), true);
    });

    expect(paper.renderPreview).not.toHaveBeenCalled();
    expect(paper.surface.matches("[data-easymde-preview-html-sink]")).toBe(
      true,
    );
    expect(paper.surface.innerHTML).toBe("");
    expect(paper.surface.getAttribute("aria-busy")).toBe("false");
    expect(paperStatuses.at(-1)).toBe("ready");
    expect(paperHtmlChanges).toEqual([safeHtml("")]);
  });

  it("announces a non-empty initial request while leaving empty paper mode", () => {
    const statuses: PreviewSurfaceStatus[] = [];
    const current = setup({
      initialHtml: "",
      onStatusChange: (status) => statuses.push(status),
    });

    act(() => {
      current.session.schedule(request("# Still rendering"), true);
      current.setEmptyMode("paper");
      current.setEmptyMode("message");
    });

    expect(current.surface.textContent).toBe(messages.loading);
    expect(current.surface.querySelector('[role="status"]')?.textContent).toBe(
      messages.loading,
    );
    expect(current.surface.getAttribute("aria-busy")).toBe("true");
    expect(statuses.at(-1)).toBe("loading");
    expect(current.surface.textContent).not.toBe(messages.empty);
  });

  it("keeps an empty paper surface blank while its preview request is pending", () => {
    const current = setup({ emptyMode: "paper", initialHtml: "" });
    act(() => current.session.schedule(request("# Paper pending"), true));

    expect(current.surface.innerHTML).toBe("");
    expect(current.surface.querySelector('[role="status"]')).toBeNull();
    expect(current.surface.getAttribute("aria-busy")).toBe("true");
  });

  it("keeps the loading status while an empty response is being enhanced", async () => {
    const enhancement = deferred<void>();
    const current = setup({
      enhance: () => enhancement.promise,
      initialHtml: "",
    });

    act(() => current.session.schedule(request("# Empty response"), true));
    await act(async () => {
      current.responses[0]?.resolve({
        editMap: {
          version: 1,
          coordinate: "line",
          signature: "# Empty response",
          blocks: [],
        },
        features: {},
        html: safeHtml(""),
      });
      await Promise.resolve();
    });

    expect(current.surface.getAttribute("aria-busy")).toBe("true");
    expect(current.surface.querySelector('[role="status"]')?.textContent).toBe(
      messages.loading,
    );

    await act(async () => {
      enhancement.resolve();
      await enhancement.promise;
    });

    expect(current.surface.getAttribute("aria-busy")).toBe("false");
    expect(current.surface.querySelector('[role="status"]')).toBeNull();
    expect(current.surface.innerHTML).toBe("");
  });

  it("preserves a failed non-empty request when leaving empty paper mode", async () => {
    const statuses: PreviewSurfaceStatus[] = [];
    const current = setup({
      initialHtml: "",
      onStatusChange: (status) => statuses.push(status),
    });

    act(() => {
      current.session.schedule(request("# Failure"), true);
      current.setEmptyMode("paper");
    });
    await act(async () => {
      current.responses[0]?.reject(new Error("private response detail"));
      await Promise.resolve();
    });
    act(() => current.setEmptyMode("message"));

    expect(current.surface.textContent).toBe(messages.error);
    expect(statuses.at(-1)).toBe("error");
    expect(current.surface.textContent).not.toBe(messages.empty);
  });

  it("keeps the previously committed snapshot available while the next request is loading", async () => {
    const { session, surface } = setup();
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      session.schedule(request("# Updated"), true);
    });

    expect(surface.getAttribute("aria-busy")).toBe("true");
    expect(surface.getAttribute("data-easymde-preview-refreshing")).toBe("1");
    expect(surface.getAttribute("data-easymde-preview-accepted")).toBe("1");
    expect(surface.textContent).toContain("Initial preview");
    expect(surface.querySelector('[role="status"]')).toBeNull();
  });

  it("retains the bounded window commit while a replacement HTML revision is enhancing", async () => {
    const initial = windowedFixture(161, "windowed-refresh-initial");
    const markdown = Array.from(
      { length: 322 },
      (_, index) => `line-${index}`,
    ).join("\n");
    const current = setup({
      initialEditMap: initial.editMap,
      initialHtml: initial.html,
      initialSignature: initial.editMap.signature,
      stagingScheduler: { yield: () => Promise.resolve() },
      windowed: true,
    });
    await act(async () => {
      for (let index = 0; index < 24; index += 1) await Promise.resolve();
      await flushAnimationFrames(16);
    });
    const mountedCount = () =>
      current.surface.querySelectorAll("[data-easymde-visual-block-id]").length;
    expect(
      current.surface.querySelector("[data-easymde-preview-window-spacer]"),
    ).not.toBeNull();
    expect(mountedCount()).toBeLessThan(161);

    const next = windowedFixture(161, "windowed-refresh-next");
    act(() =>
      current.session.schedule(request(markdown, next.editMap.signature), true),
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(
      current.surface.querySelector("[data-easymde-preview-window-spacer]"),
    ).not.toBeNull();
    expect(mountedCount()).toBeLessThan(161);

    await act(async () => {
      current.responses[0]?.resolve({
        editMap: next.editMap,
        features: {},
        html: next.html,
      });
      for (let index = 0; index < 32; index += 1) await Promise.resolve();
      await flushAnimationFrames(20);
    });
    expect(
      current.surface.querySelector("[data-easymde-preview-window-spacer]"),
    ).not.toBeNull();
    expect(mountedCount()).toBeLessThan(161);
  });

  it("keeps the previous accepted HTML visible while the next response is pending", async () => {
    const current = setup({ initialHtml: "<p>Stable preview</p>" });
    await act(async () => {
      await Promise.resolve();
    });
    act(() => current.session.schedule(request("# New version", "new"), true));

    expect(current.surface.innerHTML).toBe("<p>Stable preview</p>");
    expect(current.surface.getAttribute("aria-busy")).toBe("true");
    expect(
      current.surface.getAttribute("data-easymde-preview-refreshing"),
    ).toBe("1");
    expect(current.surface.getAttribute("data-easymde-preview-accepted")).toBe(
      "1",
    );
    expect(current.surface.querySelector('[role="status"]')).toBeNull();
  });

  it("keeps only the previous enhanced snapshot accepted until its replacement commits", async () => {
    const enhancement = deferred<void>();
    const current = setup({
      enhance: vi
        .fn()
        .mockImplementationOnce(() => Promise.resolve())
        .mockImplementationOnce(() => enhancement.promise),
      initialHtml: "<p>Stable preview</p>",
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(current.surface.getAttribute("data-easymde-preview-accepted")).toBe(
      "1",
    );

    act(() =>
      current.session.schedule(request("# Replacement", "replacement"), true),
    );
    await act(async () => {
      current.responses[0]?.resolve({
        html: safeHtml("<p>Unenhanced replacement</p>"),
        features: {},
      });
      await Promise.resolve();
    });

    expect(current.surface.textContent).toContain("Stable preview");
    expect(current.surface.textContent).not.toContain("Unenhanced replacement");
    expect(current.surface.getAttribute("data-easymde-preview-accepted")).toBe(
      "1",
    );

    await act(async () => {
      enhancement.resolve();
      await enhancement.promise;
    });
    expect(current.surface.textContent).toContain("Unenhanced replacement");
    expect(current.surface.getAttribute("data-easymde-preview-accepted")).toBe(
      "1",
    );
    expect(current.surface.getAttribute("aria-busy")).toBe("false");
  });

  it("renders accessible empty and error states without reporting readiness", async () => {
    const empty = setup();
    act(() => {
      empty.session.schedule(request(""), true);
    });
    expect(empty.surface.textContent).toBe(messages.empty);
    expect(empty.surface.getAttribute("aria-busy")).toBe("false");
    expect(empty.surface.easymdePreviewSignature).toBe("");

    const failed = setup();
    act(() => {
      failed.session.schedule(request("# Failure"), true);
    });
    await act(async () => {
      failed.responses[0]?.reject(new Error("private response detail"));
      await Promise.resolve();
    });
    expect(failed.surface.textContent).toBe(messages.error);
    expect(failed.surface.getAttribute("aria-busy")).toBe("false");
    expect(failed.surface.easymdePreviewSignature).toBe("");
  });

  it("marks a successful response ready only after enhancement completes", async () => {
    const enhancement = deferred<void>();
    const enhance = vi.fn<PreviewEnhancementPort["enhance"]>(
      () => enhancement.promise,
    );
    const statuses: PreviewSurfaceStatus[] = [];
    const current = setup({
      enhance,
      initialHtml: "",
      onStatusChange: (status) => statuses.push(status),
    });

    act(() => {
      current.session.schedule(request("# Current", "current-signature"), true);
    });
    expect(statuses.at(-1)).toBe("loading");
    await act(async () => {
      current.responses[0]?.resolve({
        html: safeHtml("<pre><code>const current = true;</code></pre>"),
        features: { syntaxHighlight: true },
      });
      await Promise.resolve();
    });

    expect(enhance).toHaveBeenCalledTimes(1);
    expect(enhance.mock.calls[0]?.[3]).toEqual(
      expect.objectContaining({ codeTheme: "atom-one-dark" }),
    );
    expect(current.surface.getAttribute("aria-busy")).toBe("true");
    expect(current.surface.textContent).toContain("const current = true;");
    expect(current.surface.easymdePreviewSignature).toBe("");
    expect(statuses.at(-1)).toBe("loading");

    await act(async () => {
      enhancement.resolve();
      await enhancement.promise;
    });
    expect(current.surface.getAttribute("aria-busy")).toBe("false");
    expect(current.surface.easymdePreviewSignature).toBe("current-signature");
    expect(statuses.at(-1)).toBe("ready");
  });

  it("retains the previous HTML until the accepted candidate is committed", async () => {
    const enhancement = deferred<void>();
    const initialHtml = "<p>Stable enhanced Preview</p>";
    const enhance = vi.fn<PreviewEnhancementPort["enhance"]>((candidate) => {
      if (enhance.mock.calls.length === 1) return Promise.resolve();
      expect(candidate.tagName).toBe("DIV");
      expect(
        candidate
          .closest(".easymde-immersive-preview-canvas")
          ?.querySelectorAll("article"),
      ).toHaveLength(1);
      expect(candidate.isConnected).toBe(true);
      expect(candidate.getAttribute("aria-hidden")).toBe("true");
      expect(candidate.hasAttribute("inert")).toBe(true);
      expect(candidate.hasAttribute("tabindex")).toBe(false);
      expect(candidate.hasAttribute("contenteditable")).toBe(false);
      expect(candidate.hasAttribute("role")).toBe(false);
      expect(candidate.hasAttribute("aria-live")).toBe(false);
      expect(
        candidate.querySelector('[data-easymde-visual-block-id="b0"]')
          ?.textContent,
      ).toBe("Candidate Preview");
      return enhancement.promise;
    });
    const current = setup({ enhance, initialHtml });
    const activeIdentity = current.surface;

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      current.session.schedule(request("# Candidate", "candidate"), true);
    });
    await act(async () => {
      current.responses[0]?.resolve({
        html: safeHtml("<p>Candidate Preview</p>"),
        features: {},
      });
      await Promise.resolve();
    });

    expect(current.surface).toBe(activeIdentity);
    expect(current.surface.innerHTML).toBe(initialHtml);
    expect(current.surface.getAttribute("aria-busy")).toBe("true");
    expect(current.surface.easymdePreviewSignature).toBe("");

    await act(async () => {
      enhancement.resolve();
      await enhancement.promise;
    });

    expect(current.surface).toBe(activeIdentity);
    expect(current.surface.innerHTML).toBe(
      '<p data-easymde-visual-block-id="b0">Candidate Preview</p>',
    );
  });

  it("does not let a parent rerender roll back a committed enhanced sink", async () => {
    const current = setup({
      initialHtml: "<p>Stable</p>",
      enhance: async (candidate) => {
        candidate.querySelector("p")?.setAttribute("data-enhanced", "1");
      },
    });
    await act(async () => {
      await Promise.resolve();
    });

    const setInnerHTML = vi.spyOn(current.surface, "innerHTML", "set");
    expect(current.surface.innerHTML).toBe('<p data-enhanced="1">Stable</p>');
    current.rerender();

    expect(current.surface.innerHTML).toBe('<p data-enhanced="1">Stable</p>');
    expect(setInnerHTML).not.toHaveBeenCalled();
    setInnerHTML.mockRestore();
  });

  it("preheats an inert connected staging surface while retaining the active preview", async () => {
    const enhancement = deferred<void>();
    let enhancementCalls = 0;
    const enhance = vi.fn<PreviewEnhancementPort["enhance"]>((candidate) => {
      enhancementCalls += 1;
      if (1 === enhancementCalls) return Promise.resolve();
      expect(candidate.isConnected).toBe(true);
      expect(candidate.getAttribute("aria-hidden")).toBe("true");
      expect(candidate.hasAttribute("inert")).toBe(true);
      expect(candidate.matches("[data-easymde-preview-html-sink]")).toBe(false);
      return enhancement.promise;
    });
    const current = setup({
      enhance,
      initialHtml: "<p>Stable</p>",
    });
    await act(async () => {
      await Promise.resolve();
    });

    const setInnerHTML = vi.spyOn(current.surface, "innerHTML", "set");
    act(() => {
      current.session.schedule(request("candidate", "candidate"), true);
    });
    await act(async () => {
      current.responses[0]?.resolve({
        html: safeHtml("<p>Candidate</p>"),
        features: {},
      });
      await Promise.resolve();
    });

    expect(current.surface.innerHTML).toBe("<p>Stable</p>");
    expect(setInnerHTML).not.toHaveBeenCalled();
    await act(async () => {
      enhancement.resolve();
      await enhancement.promise;
    });

    expect(current.surface.innerHTML).toBe(
      '<p data-easymde-visual-block-id="b0">Candidate</p>',
    );
    expect(setInnerHTML).not.toHaveBeenCalled();
    expect(
      current.surface.parentElement?.querySelectorAll(
        "[data-easymde-preview-staging]",
      ),
    ).toHaveLength(0);
    setInnerHTML.mockRestore();
  });

  it("keeps initial server HTML unaccepted while enhancement is pending", async () => {
    const enhancement = deferred<void>();
    const current = setup({
      enhance: () => enhancement.promise,
      initialHtml: "",
    });
    act(() => current.session.schedule(request("# First Preview"), true));
    await act(async () => {
      current.responses[0]?.resolve({
        html: safeHtml("<p>First safe preview</p>"),
        features: {},
      });
      await Promise.resolve();
    });

    expect(current.surface.textContent).toBe("First safe preview");
    expect(current.surface.getAttribute("aria-busy")).toBe("true");
    expect(
      current.surface.getAttribute("data-easymde-preview-accepted"),
    ).toBeNull();
    expect(current.surface.easymdePreviewSignature).toBe("");

    await act(async () => {
      enhancement.resolve();
      await enhancement.promise;
    });
    expect(current.surface.easymdePreviewSignature).toBe("# First Preview");
    expect(current.surface.getAttribute("data-easymde-preview-accepted")).toBe(
      "1",
    );
  });

  it("yields connected staging when elapsed work reaches its time budget", async () => {
    const firstYield = deferred<void>();
    let clockReads = 0;
    let releaseFirstYield = true;
    const stagingScheduler = {
      now: () => {
        clockReads += 1;
        return clockReads * 3;
      },
      yield: vi.fn(() => {
        if (releaseFirstYield) {
          releaseFirstYield = false;
          return firstYield.promise;
        }
        return Promise.resolve();
      }),
    };
    const totalNodes = 130;
    const enhance = vi.fn<PreviewEnhancementPort["enhance"]>(
      async (candidate) => {
        expect(candidate.isConnected).toBe(true);
        expect(candidate.childElementCount).toBe(totalNodes);
      },
    );
    const current = setup({
      enhance,
      initialHtml: "<p>Stable</p>",
      stagingScheduler,
    });
    await act(async () => {
      await Promise.resolve();
    });
    enhance.mockClear();

    const activeChild = current.surface.firstChild;
    const setInnerHTML = vi.spyOn(current.surface, "innerHTML", "set");
    const stagingMutations: MutationRecord[] = [];
    const stagingObserver = new MutationObserver((records) => {
      stagingMutations.push(
        ...records.filter(
          (record) =>
            record.target instanceof HTMLElement &&
            record.target.hasAttribute("data-easymde-preview-staging"),
        ),
      );
    });
    stagingObserver.observe(current.canvas, { childList: true, subtree: true });
    act(() => {
      current.session.schedule(request("large", "large"), true);
    });
    await act(async () => {
      current.responses[0]?.resolve({
        html: safeHtml(
          Array.from(
            { length: totalNodes },
            (_, index) => `<p>node-${index}</p>`,
          ).join(""),
        ),
        features: {},
      });
      await Promise.resolve();
    });

    const staging = current.canvas.querySelector<HTMLElement>(
      "[data-easymde-preview-staging]",
    );
    expect(staging).not.toBeNull();
    expect(staging?.isConnected).toBe(true);
    expect(staging?.childElementCount).toBe(3);
    expect(staging?.childElementCount).toBeLessThan(totalNodes);
    expect(stagingScheduler.yield).toHaveBeenCalledOnce();
    stagingMutations.push(
      ...stagingObserver
        .takeRecords()
        .filter((record) => record.target === staging),
    );
    stagingObserver.disconnect();
    expect(
      stagingMutations.filter((record) => record.target === staging),
    ).toHaveLength(1);
    expect(stagingMutations[0]?.addedNodes).toHaveLength(3);
    expect(enhance).not.toHaveBeenCalled();
    expect(current.surface.firstChild).toBe(activeChild);
    expect(setInnerHTML).not.toHaveBeenCalled();

    await act(async () => {
      firstYield.resolve();
      await firstYield.promise;
    });

    expect(enhance).toHaveBeenCalledOnce();
    expect(current.surface.querySelectorAll("p")).toHaveLength(totalNodes);
    expect(
      current.canvas.querySelectorAll("[data-easymde-preview-staging]"),
    ).toHaveLength(0);
    expect(setInnerHTML).not.toHaveBeenCalled();
    setInnerHTML.mockRestore();
  });

  it("aborts a staging batch before enhancement and removes its connected candidate", async () => {
    const firstYield = deferred<void>();
    let clockReads = 0;
    let firstBatch = true;
    const stagingScheduler = {
      now: () => {
        clockReads += 1;
        return clockReads * 3;
      },
      yield: vi.fn(() => {
        if (firstBatch) {
          firstBatch = false;
          return firstYield.promise;
        }
        return Promise.resolve();
      }),
    };
    let enhancedText = "";
    const enhance = vi.fn<PreviewEnhancementPort["enhance"]>(
      async (candidate) => {
        enhancedText = candidate.textContent ?? "";
      },
    );
    const current = setup({
      enhance,
      initialHtml: "<p>Stable</p>",
      stagingScheduler,
    });
    await act(async () => {
      await Promise.resolve();
    });
    enhance.mockClear();

    act(() => {
      current.session.schedule(request("stale", "stale"), true);
    });
    await act(async () => {
      current.responses[0]?.resolve({
        html: safeHtml(
          Array.from(
            { length: 130 },
            (_, index) => `<p>stale-${index}</p>`,
          ).join(""),
        ),
        features: {},
      });
      await Promise.resolve();
    });
    expect(
      current.canvas.querySelector("[data-easymde-preview-staging]"),
    ).not.toBeNull();

    act(() => {
      current.session.schedule(request("current", "current"), true);
    });
    await act(async () => {
      current.responses[1]?.resolve({
        html: safeHtml("<p>Current</p>"),
        features: {},
      });
      await Promise.resolve();
    });
    firstYield.resolve();
    await act(async () => {
      await firstYield.promise;
      await Promise.resolve();
    });

    expect(enhance).toHaveBeenCalledOnce();
    expect(enhancedText).toBe("Current");
    expect(current.surface.textContent).toBe("Current");
    expect(
      current.canvas.querySelectorAll("[data-easymde-preview-staging]"),
    ).toHaveLength(0);
  });

  it("synchronizes layout-dependent code-frame styles only after the candidate commits", async () => {
    const syncSurfaces: HTMLElement[] = [];
    const phases: string[] = [];
    const current = setup({
      initialHtml: "<p>Stable</p>",
      enhance: async (candidate) => {
        phases.push("enhance");
        const code = candidate.ownerDocument.createElement("code");
        code.className = "hljs";
        const pre = candidate.ownerDocument.createElement("pre");
        pre.append(code);
        candidate.append(pre);
      },
    });
    vi.mocked(
      current.enhancementPort.syncCodeFrameBackgrounds,
    ).mockImplementation((surface: HTMLElement) => {
      phases.push("sync");
      syncSurfaces.push(surface);
      expect(surface).toBe(current.surface);
      expect(surface.isConnected).toBe(true);
    });

    await act(async () => {
      await Promise.resolve();
    });
    syncSurfaces.length = 0;
    phases.length = 0;
    act(() => {
      current.session.schedule(request("code", "code"), true);
    });
    await act(async () => {
      current.responses[0]?.resolve({
        html: safeHtml("<pre><code>code</code></pre>"),
        features: { syntaxHighlight: true },
      });
      await Promise.resolve();
    });
    expect(phases).toEqual(["enhance", "sync"]);
    expect(syncSurfaces).toEqual([current.surface]);
  });

  it("restores identical server HTML before enhancing a newer response", async () => {
    const enhancementInputs: string[] = [];
    const current = setup({
      initialHtml: "",
      enhance: async (surface) => {
        const code = surface.querySelector("pre > code");
        if (!(code instanceof HTMLElement)) throw new Error("code missing");
        enhancementInputs.push(code.innerHTML);
        code.classList.add("hljs");
        code.dataset.highlighted = "yes";
        code.dataset.easymdeHighlighted = "1";
        code.innerHTML = '<span class="hljs-keyword">const</span> value = 1;';
      },
    });
    const html = safeHtml(
      '<pre><code class="language-js">const value = 1;</code></pre>',
    );

    act(() =>
      current.session.schedule(
        request("```js\nconst value = 1;\n```", "first"),
        true,
      ),
    );
    await act(async () => {
      current.responses[0]?.resolve({
        features: { syntaxHighlight: true },
        html,
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    act(() =>
      current.session.schedule(
        {
          ...request("```js\nconst value = 1;\n```", "second"),
          codeTheme: "github",
        },
        true,
      ),
    );
    await act(async () => {
      current.responses[1]?.resolve({
        features: { syntaxHighlight: true },
        html,
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(enhancementInputs).toEqual(["const value = 1;", "const value = 1;"]);
  });

  it("hands enhanced Preview markup to visual editing with Markdown sources attached", async () => {
    const onHtmlChange = vi.fn();
    const current = setup({
      initialHtml: "",
      onHtmlChange,
      enhance: async (surface) => {
        const math = surface.querySelector<HTMLElement>(".easymde-math");
        if (math) {
          math.innerHTML = '<span class="katex">rendered math</span>';
          math.dataset.easymdeRendered = "1";
        }
        const mermaid = surface.querySelector(
          "pre:has(> code.language-mermaid)",
        );
        mermaid?.replaceWith(
          Object.assign(document.createElement("div"), {
            className: "easymde-mermaid",
            innerHTML: "<svg><text>rendered diagram</text></svg>",
          }),
        );
      },
    });

    act(() => {
      current.session.schedule(request("# Enhanced", "enhanced"), true);
    });
    await act(async () => {
      current.responses[0]?.resolve({
        features: { math: true, mermaid: true },
        html: safeHtml(
          [
            '<div class="easymde-math easymde-math-block">$$x^2$$</div>',
            '<pre><code class="language-mermaid">flowchart TD\nA--&gt;B</code></pre>',
          ].join(""),
        ),
      });
      await Promise.resolve();
    });

    expect(onHtmlChange).toHaveBeenCalledOnce();
    const enhanced = document.createElement("article");
    enhanced.innerHTML = onHtmlChange.mock.calls[0]?.[0] ?? "";
    expect(enhanced.querySelector(".katex")).not.toBeNull();
    expect(
      enhanced
        .querySelector(".easymde-math")
        ?.getAttribute("data-easymde-visual-markdown-source"),
    ).toBe("$$x^2$$");
    expect(enhanced.querySelector(".easymde-mermaid svg")).not.toBeNull();
    expect(
      enhanced
        .querySelector(".easymde-mermaid")
        ?.getAttribute("data-easymde-visual-markdown-source"),
    ).toBe("flowchart TD\nA-->B");
  });

  it("keeps each visual Markdown source attached when enhancement changes node counts", async () => {
    const onHtmlChange = vi.fn();
    const current = setup({
      initialHtml: "",
      onHtmlChange,
      enhance: async (surface) => {
        for (const math of surface.querySelectorAll<HTMLElement>(
          ".easymde-math",
        )) {
          math.innerHTML = `<span class="katex">${math.dataset.case}</span>`;
          math.dataset.easymdeRendered = "1";
        }
        for (const code of surface.querySelectorAll<HTMLElement>(
          "pre > code.language-mermaid",
        )) {
          const replacement = document.createElement("div");
          replacement.className = "easymde-mermaid";
          replacement.dataset.case = code.dataset.case;
          replacement.innerHTML = `<svg><text>${code.dataset.case}</text></svg>`;
          code.parentElement?.replaceWith(replacement);
        }

        const extraMath = document.createElement("div");
        extraMath.className = "easymde-math";
        extraMath.dataset.case = "extra-math";
        const extraMermaid = document.createElement("div");
        extraMermaid.className = "easymde-mermaid";
        extraMermaid.dataset.case = "extra-mermaid";
        surface.prepend(extraMath, extraMermaid);
      },
    });

    act(() => {
      current.session.schedule(request("# Enhanced", "enhanced"), true);
    });
    await act(async () => {
      current.responses[0]?.resolve({
        features: { math: true, mermaid: true },
        html: safeHtml(
          [
            '<div class="easymde-math" data-case="math-one">$$one$$</div>',
            '<pre><code class="language-mermaid" data-case="mermaid-one">flowchart TD\nA--&gt;B</code></pre>',
            '<div class="easymde-math" data-case="math-two">$$two$$</div>',
            '<pre><code class="language-mermaid" data-case="mermaid-two">flowchart TD\nC--&gt;D</code></pre>',
          ].join(""),
        ),
      });
      await Promise.resolve();
    });

    const enhanced = document.createElement("article");
    enhanced.innerHTML = onHtmlChange.mock.calls[0]?.[0] ?? "";
    expect(
      enhanced
        .querySelector('[data-case="extra-math"]')
        ?.hasAttribute("data-easymde-visual-markdown-source"),
    ).toBe(false);
    expect(
      enhanced
        .querySelector('[data-case="extra-mermaid"]')
        ?.hasAttribute("data-easymde-visual-markdown-source"),
    ).toBe(false);
    expect(
      enhanced
        .querySelector('[data-case="math-one"]')
        ?.getAttribute("data-easymde-visual-markdown-source"),
    ).toBe("$$one$$");
    expect(
      enhanced
        .querySelector('[data-case="math-two"]')
        ?.getAttribute("data-easymde-visual-markdown-source"),
    ).toBe("$$two$$");
    expect(
      enhanced
        .querySelector('[data-case="mermaid-one"]')
        ?.getAttribute("data-easymde-visual-markdown-source"),
    ).toBe("flowchart TD\nA-->B");
    expect(
      enhanced
        .querySelector('[data-case="mermaid-two"]')
        ?.getAttribute("data-easymde-visual-markdown-source"),
    ).toBe("flowchart TD\nC-->D");
  });

  it("removes visual source markers when enhanced output no longer matches its source", async () => {
    const current = setup({
      enhance: async (surface) => {
        surface
          .querySelector(".easymde-math")
          ?.replaceWith(document.createElement("p"));
      },
      initialHtml: "",
    });

    act(() => {
      current.session.schedule(request("$x$", "mismatched"), true);
    });
    await act(async () => {
      current.responses[0]?.resolve({
        features: { math: true },
        html: safeHtml('<span class="easymde-math">$x$</span>'),
      });
      await Promise.resolve();
    });

    expect(visualSourceMarkerCount(current.surface)).toBe(0);
    expect(current.surface.getAttribute("data-easymde-preview-error")).toBe(
      "1",
    );
    expect(current.onDiagnostic).toHaveBeenCalledWith(
      "preview-enhancement-visual-source-missing",
    );
  });

  it("does not bind visual Markdown sources that are nested inside code", async () => {
    const current = setup({
      enhance: async (surface) => {
        const code = surface.querySelector("pre > code");
        if (!code) throw new Error("preview-enhancement-code-missing");
        code.innerHTML = '<span class="hljs-string">printf "$x$"</span>';
        surface
          .querySelector(".easymde-math:not(pre .easymde-math)")
          ?.setAttribute("data-easymde-rendered", "1");
      },
      initialHtml: "",
    });

    act(() => {
      current.session.schedule(request("code and math", "code-and-math"), true);
    });
    await act(async () => {
      current.responses[0]?.resolve({
        features: { math: true, syntaxHighlight: true },
        html: safeHtml(
          '<pre><code class="language-bash"><span class="easymde-math">$x$</span></code></pre>' +
            '<div class="easymde-math">$$real$$</div>',
        ),
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(current.onDiagnostic).not.toHaveBeenCalled();
    expect(
      current.surface.getAttribute("data-easymde-preview-error"),
    ).toBeNull();
    expect(
      current.surface
        .querySelector(".easymde-math")
        ?.getAttribute("data-easymde-visual-markdown-source"),
    ).toBe("$$real$$");
  });

  it("preserves the stable visual-source diagnostic when enhanced output loses a source node", async () => {
    const onDiagnostic = vi.fn();
    const current = setup({
      initialHtml: "",
      onDiagnostic,
      enhance: async (surface) => {
        surface
          .querySelector(".easymde-math")
          ?.replaceWith(document.createElement("p"));
      },
    });

    act(() => {
      current.session.schedule(request("$x$", "visual-source-missing"), true);
    });
    await act(async () => {
      current.responses[0]?.resolve({
        features: { math: true },
        html: safeHtml('<div class="easymde-math">$x$</div>'),
      });
      await Promise.resolve();
    });

    expect(onDiagnostic).toHaveBeenCalledWith(
      "preview-enhancement-visual-source-missing",
    );
  });

  it("reports empty and failed states instead of retaining a stale ready status", async () => {
    const statuses: PreviewSurfaceStatus[] = [];
    const current = setup({
      onStatusChange: (status) => statuses.push(status),
    });
    await act(async () => {});
    expect(statuses.at(-1)).toBe("ready");

    act(() => current.session.schedule(request(""), true));
    expect(statuses.at(-1)).toBe("empty");

    act(() => current.session.schedule(request("# Failure"), true));
    expect(statuses.at(-1)).toBe("loading");
    await act(async () => {
      current.responses[0]?.reject(new Error("private response detail"));
      await Promise.resolve();
    });
    expect(statuses.at(-1)).toBe("error");
  });

  it("does not let stale enhancement completion mark a newer response ready", async () => {
    const firstEnhancement = deferred<void>();
    const enhance = vi
      .fn<PreviewEnhancementPort["enhance"]>()
      .mockImplementationOnce(() => firstEnhancement.promise)
      .mockResolvedValueOnce(undefined);
    const current = setup({ enhance, initialHtml: "" });

    act(() => {
      current.session.schedule(request("# First", "first"), true);
    });
    await act(async () => {
      current.responses[0]?.resolve({
        html: safeHtml('<span class="easymde-math">$first$</span>'),
        features: { math: true },
      });
      await Promise.resolve();
    });
    expect(visualSourceMarkerCount(current.surface)).toBe(0);
    const firstIsCurrent = enhance.mock.calls[0]?.[2];
    expect(firstIsCurrent?.()).toBe(true);
    act(() => {
      current.session.schedule(request("# Second", "second"), true);
    });
    expect(firstIsCurrent?.()).toBe(false);
    expect(visualSourceMarkerCount(current.surface)).toBe(0);
    await act(async () => {
      current.responses[1]?.resolve({
        html: safeHtml("<p>Second</p>"),
        features: {},
      });
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      firstEnhancement.resolve();
      await firstEnhancement.promise;
    });

    expect(current.surface.textContent).toBe("Second");
    expect(current.surface.easymdePreviewSignature).toBe("second");
    expect(
      current.canvas.querySelectorAll("[data-easymde-preview-staging]"),
    ).toHaveLength(0);
  });

  it("captures and restores the canvas scroll position after replacing HTML", async () => {
    const capture = vi.fn<PreviewScrollPort["capture"]>((surface) => ({
      left: surface.scrollLeft,
      ratio: 0,
      top: surface.scrollTop,
    }));
    const restore = vi.fn<PreviewScrollPort["restore"]>((surface, snapshot) => {
      surface.scrollLeft = snapshot.left;
      surface.scrollTop = snapshot.top;
    });
    const current = setup({ scrollPort: { capture, restore } });
    current.canvas.scrollLeft = 9;
    current.canvas.scrollTop = 42;

    act(() => {
      current.session.schedule(request("# Updated", "updated"), true);
    });
    current.canvas.scrollLeft = 12;
    current.canvas.scrollTop = 78;
    await act(async () => {
      current.responses[0]?.resolve({
        html: safeHtml("<p>Updated</p>"),
        features: {},
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(capture).toHaveBeenCalledWith(current.canvas);
    expect(restore).toHaveBeenCalledWith(current.canvas, {
      left: 12,
      ratio: 0,
      top: 78,
    });
    expect(current.canvas.scrollLeft).toBe(12);
    expect(current.canvas.scrollTop).toBe(78);
    expect(current.surface.textContent).toBe("Updated");
  });

  it("restores the latest scroll ratio only after a windowed HTML commit is ready", async () => {
    const fixture = windowedFixture(320, "windowed-scroll");
    const enhancement = deferred<void>();
    const statuses: PreviewSurfaceStatus[] = [];
    let current!: ReturnType<typeof setup>;
    let restoreMetrics: Readonly<{
      busy: string | null;
      hasWindowContent: boolean;
      scrollHeight: number;
      snapshotRatio: number;
    }> | null = null;
    const scrollPort: PreviewScrollPort = {
      capture: (canvas) => {
        const maxScroll = Math.max(
          0,
          canvas.scrollHeight - canvas.clientHeight,
        );
        return {
          left: canvas.scrollLeft,
          ratio: maxScroll ? canvas.scrollTop / maxScroll : 0,
          top: canvas.scrollTop,
        };
      },
      restore: (canvas, snapshot) => {
        const maxScroll = Math.max(
          0,
          canvas.scrollHeight - canvas.clientHeight,
        );
        restoreMetrics = {
          busy: current.surface.getAttribute("aria-busy"),
          hasWindowContent: Boolean(
            current.surface.querySelector(
              "[data-easymde-visual-block-id], [data-easymde-preview-window-spacer]",
            ),
          ),
          scrollHeight: canvas.scrollHeight,
          snapshotRatio: snapshot.ratio,
        };
        canvas.scrollLeft = snapshot.left;
        canvas.scrollTop = maxScroll
          ? snapshot.ratio * maxScroll
          : snapshot.top;
      },
    };
    const enhance = vi.fn<PreviewEnhancementPort["enhance"]>(
      () => enhancement.promise,
    );
    current = setup({
      enhance,
      initialHtml: "",
      onStatusChange: (status) => statuses.push(status),
      scrollPort,
      stagingScheduler: { now: () => 0, yield: () => Promise.resolve() },
      windowed: true,
    });
    Object.defineProperty(current.canvas, "clientHeight", {
      configurable: true,
      value: 100,
    });
    Object.defineProperty(current.canvas, "scrollHeight", {
      configurable: true,
      get: () =>
        current.surface.querySelector(
          "[data-easymde-visual-block-id], [data-easymde-preview-window-spacer]",
        )
          ? 2000
          : 1000,
    });
    current.canvas.scrollTop = 450;

    act(() => {
      current.session.schedule(request("# Windowed", "windowed-scroll"), true);
    });
    expect(statuses.at(-1)).toBe("loading");
    expect(restoreMetrics).toBeNull();

    await act(async () => {
      current.responses[0]?.resolve({
        editMap: fixture.editMap,
        features: {},
        html: fixture.html,
      });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(enhance).toHaveBeenCalledOnce();
    expect(statuses.at(-1)).toBe("loading");
    expect(restoreMetrics).toBeNull();

    current.canvas.scrollTop = 600;
    await act(async () => {
      enhancement.resolve();
      await enhancement.promise;
    });
    expect(
      current.surface.querySelector(
        "[data-easymde-visual-block-id], [data-easymde-preview-window-spacer]",
      ),
    ).not.toBeNull();
    expect(statuses.at(-1)).toBe("ready");
    expect(restoreMetrics).toEqual({
      busy: "false",
      hasWindowContent: true,
      scrollHeight: 2000,
      snapshotRatio: 600 / 900,
    });
    expect(current.canvas.scrollTop).toBeCloseTo((600 / 900) * 1900);
  });

  it("discards pending scroll restoration after empty, error, and failed requests", async () => {
    const restore = vi.fn<PreviewScrollPort["restore"]>();
    const current = setup({
      enhance: vi.fn().mockRejectedValue(new Error("enhancement failed")),
      initialHtml: "",
      scrollPort: {
        capture: (surface) => ({
          left: surface.scrollLeft,
          ratio: 0,
          top: surface.scrollTop,
        }),
        restore,
      },
    });

    act(() => current.session.schedule(request(""), true));
    expect(restore).not.toHaveBeenCalled();

    act(() => current.session.schedule(request("# Request error"), true));
    await act(async () => {
      current.responses[0]?.reject(new Error("private response detail"));
      await Promise.resolve();
    });
    expect(current.surface.textContent).toBe(messages.error);
    expect(restore).not.toHaveBeenCalled();

    act(() => current.session.schedule(request("# Enhancement error"), true));
    await act(async () => {
      current.responses[1]?.resolve({
        html: safeHtml("<p>Enhancement failure</p>"),
        features: {},
      });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(current.surface.getAttribute("data-easymde-preview-error")).toBe(
      "1",
    );
    expect(restore).not.toHaveBeenCalled();
  });

  it("ignores superseded enhancement completion and does not restore after teardown", async () => {
    const firstEnhancement = deferred<void>();
    const secondEnhancement = deferred<void>();
    const enhance = vi
      .fn<PreviewEnhancementPort["enhance"]>()
      .mockImplementationOnce(() => firstEnhancement.promise)
      .mockImplementationOnce(() => secondEnhancement.promise);
    const restore = vi.fn<PreviewScrollPort["restore"]>();
    const current = setup({
      enhance,
      initialHtml: "",
      scrollPort: {
        capture: (surface) => ({
          left: surface.scrollLeft,
          ratio: 0,
          top: surface.scrollTop,
        }),
        restore,
      },
    });

    act(() =>
      current.session.schedule(request("# First", "first-scroll"), true),
    );
    await act(async () => {
      current.responses[0]?.resolve({
        html: safeHtml("<p>First</p>"),
        features: {},
      });
      await Promise.resolve();
    });
    expect(enhance).toHaveBeenCalledTimes(1);

    act(() =>
      current.session.schedule(request("# Second", "second-scroll"), true),
    );
    await act(async () => {
      current.responses[1]?.resolve({
        html: safeHtml("<p>Second</p>"),
        features: {},
      });
      await Promise.resolve();
    });
    expect(enhance).toHaveBeenCalledTimes(2);
    expect(restore).not.toHaveBeenCalled();

    await act(async () => {
      secondEnhancement.resolve();
      await secondEnhancement.promise;
    });
    expect(current.surface.textContent).toBe("Second");
    expect(restore).toHaveBeenCalledOnce();

    current.unmount();
    await act(async () => {
      firstEnhancement.resolve();
      await firstEnhancement.promise;
    });
    expect(restore).toHaveBeenCalledOnce();

    const lateEnhancement = deferred<void>();
    const lateRestore = vi.fn<PreviewScrollPort["restore"]>();
    const lateEnhance = vi.fn<PreviewEnhancementPort["enhance"]>(
      () => lateEnhancement.promise,
    );
    const lateOwner = setup({
      enhance: lateEnhance,
      initialHtml: "",
      scrollPort: {
        capture: (surface) => ({
          left: surface.scrollLeft,
          ratio: 0,
          top: surface.scrollTop,
        }),
        restore: lateRestore,
      },
    });
    act(() => lateOwner.session.schedule(request("# Late owner"), true));
    await act(async () => {
      lateOwner.responses[0]?.resolve({
        html: safeHtml("<p>Late</p>"),
        features: {},
      });
      await Promise.resolve();
    });
    expect(lateEnhance).toHaveBeenCalledOnce();
    lateOwner.unmount();
    await act(async () => {
      lateEnhancement.resolve();
      await lateEnhancement.promise;
    });
    expect(lateRestore).not.toHaveBeenCalled();
  });

  it("keeps sanitized HTML but marks the surface unavailable when enhancement fails", async () => {
    const current = setup({
      enhance: vi.fn().mockRejectedValue(new Error("enhancement failed")),
      initialHtml: "",
    });

    act(() => {
      current.session.schedule(request("```mermaid", "diagram"), true);
    });
    await act(async () => {
      current.responses[0]?.resolve({
        html: safeHtml('<pre class="mermaid">graph TD; A--&gt;B;</pre>'),
        features: { mermaid: true },
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(current.surface.querySelector(".mermaid")).not.toBeNull();
    expect(current.surface.getAttribute("data-easymde-preview-error")).toBe(
      "1",
    );
    expect(current.surface.easymdePreviewSignature).toBe("");
    expect(current.onDiagnostic).toHaveBeenCalledWith(
      "preview-enhancement-failed",
    );
    expect(
      current.canvas.querySelectorAll("[data-easymde-preview-staging]"),
    ).toHaveLength(0);
  });

  it("reports only sanitized current enhancement failures", async () => {
    const firstEnhancement = deferred<void>();
    const secondEnhancement = deferred<void>();
    const enhance = vi
      .fn<PreviewEnhancementPort["enhance"]>()
      .mockImplementationOnce(() => firstEnhancement.promise)
      .mockImplementationOnce(() => secondEnhancement.promise);
    const current = setup({ enhance, initialHtml: "" });

    act(() => current.session.schedule(request("# First", "first"), true));
    await act(async () => {
      current.responses[0]?.resolve({
        html: safeHtml("<p>First</p>"),
        features: { math: true },
      });
      await Promise.resolve();
    });
    act(() => current.session.schedule(request("# Second", "second"), true));
    await act(async () => {
      current.responses[1]?.resolve({
        html: safeHtml("<p>Second</p>"),
        features: { mermaid: true },
      });
      await Promise.resolve();
      firstEnhancement.reject(new Error("preview-enhancement-resource-stale"));
      await Promise.resolve();
    });
    expect(current.onDiagnostic).not.toHaveBeenCalled();
    expect(
      current.canvas.querySelectorAll("[data-easymde-preview-staging]"),
    ).toHaveLength(1);

    await act(async () => {
      secondEnhancement.reject(
        new Error("preview-enhancement-runtime-unavailable"),
      );
      await Promise.resolve();
    });
    expect(current.onDiagnostic).toHaveBeenCalledWith(
      "preview-enhancement-runtime-unavailable",
    );
    expect(
      current.canvas.querySelectorAll("[data-easymde-preview-staging]"),
    ).toHaveLength(0);
  });

  it("does not report a late enhancement failure after teardown", async () => {
    const enhancement = deferred<void>();
    const current = setup({
      enhance: () => enhancement.promise,
      initialHtml: "",
    });
    act(() => current.session.schedule(request("# Pending"), true));
    await act(async () => {
      current.responses[0]?.resolve({
        html: safeHtml("<p>Pending</p>"),
        features: { math: true },
      });
      await Promise.resolve();
    });

    current.unmount();
    await act(async () => {
      enhancement.reject(new Error("preview-enhancement-resource-load-failed"));
      await Promise.resolve();
    });

    expect(current.onDiagnostic).not.toHaveBeenCalled();
  });
});

const gapLeaseBody =
  "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ\n";

function gapLeaseMarkdown(): string {
  return Array.from({ length: 320 }, (_, index) =>
    [1, 3].includes(index)
      ? `~~~js\n${gapLeaseBody}~~~`
      : [4, 60].includes(index)
        ? "$x$"
        : `Paragraph ${index}`,
  ).join("\n\n");
}

function gapLeasePreview(markdown: string, signature: string) {
  const sourceBlocks = Array.from(
    markdown.matchAll(/~~~[^\n]*\n[\s\S]*?^~~~$|[^\n]+/gm),
  );
  return {
    features: {},
    editMap: {
      version: 1 as const,
      coordinate: "line" as const,
      signature,
      blocks: sourceBlocks.map((match, index) => {
        const startLine = markdown.slice(0, match.index).split("\n").length - 1;
        return {
          id: `b${index}`,
          editable: true,
          startLine,
          endLine: startLine + match[0].split("\n").length,
        };
      }),
    },
    html: sourceBlocks
      .map(([raw], index) => {
        const source = raw.replace(/^\n/, "");
        const fence = source.match(/^~~~([^\n]*)\n([\s\S]*)~~~$/);
        if (fence) {
          const pre = document.createElement("pre");
          pre.setAttribute("data-easymde-visual-block-id", `b${index}`);
          const code = document.createElement("code");
          code.className = `language-${fence[1]}`;
          code.textContent = fence[2] ?? "";
          pre.append(code);
          return pre.outerHTML;
        }
        return source.startsWith("### ")
          ? `<h3 data-easymde-visual-block-id="b${index}">${source.slice(4)}</h3>`
          : `<p data-easymde-visual-block-id="b${index}">${source === "$x$" ? '<span class="easymde-math" data-easymde-rendered="1" data-easymde-visual-markdown-source="x"><span class="katex">x</span></span>' : source}</p>`;
      })
      .join("\n") as SafePreviewHtml,
  };
}

async function openWindowedOwner(
  options: Readonly<{
    materializeScheduler?: MaterializeScheduler;
    initialMarkdown?: string;
    flowGeometry?: boolean;
    initialScrollTop?: number;
  }> = {},
) {
  const initialMarkdown = options.initialMarkdown ?? gapLeaseMarkdown();
  const submissionField = document.createElement("textarea");
  submissionField.value = submissionField.defaultValue = initialMarkdown;
  const container = document.createElement("div");
  document.body.append(container, submissionField);
  const documentOwner = createCodeMirrorDocumentSession({
    container,
    label: "Markdown",
    submissionField,
  });
  const initialCaret = options.initialMarkdown
    ? 0
    : initialMarkdown.indexOf("~~~js\n") + 6 + 40;
  documentOwner.applyTextChange({
    value: documentOwner.getValue(),
    selection: { direction: "none", start: initialCaret, end: initialCaret },
  });
  const initial = gapLeasePreview(documentOwner.getValue(), "gap-lease");
  const getRevision = documentOwner.getRevision;
  if (!getRevision) throw new Error("gap-lease-revision-owner-missing");
  const documentSession = createEditorDocumentSession(
    documentOwner,
    createNativeTitleSession(null),
  );
  documentSession.registerSubmissionState({
    appleFont: "system",
    codeTheme: "github",
    codeThemeExplicit: false,
    customCssId: "",
    customFont: "none",
    markdownTheme: "default",
    serifFont: "off",
    windowsFont: "system",
  });
  let generation = 0;
  let snapshot: {
    editMap: PreviewEditMap;
    revision: number;
    signature: string;
  } = {
    editMap: initial.editMap,
    revision: 1,
    signature: initial.editMap.signature,
  };
  let status: PreviewSurfaceStatus = "ready";
  let updateVisual: (() => void) | null = null;
  const onFailure = vi.fn();
  const onDiagnostic = vi.fn();
  let scrollCanvas: HTMLElement | null = null;
  const sequenceGeometry = options.flowGeometry
    ? installSequenceGeometry()
    : null;
  const nativeRect = HTMLElement.prototype.getBoundingClientRect;
  const rectSpy = sequenceGeometry
    ? null
    : vi
        .spyOn(HTMLElement.prototype, "getBoundingClientRect")
        .mockImplementation(function (this: HTMLElement) {
          if (this.classList.contains("easymde-immersive-preview-canvas"))
            return previewRect(0, 240);
          if (this.tagName === "ARTICLE")
            return previewRect(-(scrollCanvas?.scrollTop ?? 0), 320 * 24);
          const id = this.getAttribute("data-easymde-visual-block-id");
          return id?.startsWith("b")
            ? previewRect(
                Number.parseInt(id.slice(1), 10) * 24 -
                  (scrollCanvas?.scrollTop ?? 0),
                24,
              )
            : nativeRect.call(this);
        });
  const current = setup({
    contentEditable: true,
    ...(options.flowGeometry
      ? { scrollPort: createBrowserPreviewScroll() }
      : {}),
    currentSourceSnapshot: () => ({
      revision: getRevision(),
      value: documentOwner.getValue(),
    }),
    initialEditMap: initial.editMap,
    initialHtml: initial.html,
    initialSignature: initial.editMap.signature,
    onDiagnostic,
    onWindowReady: () => {
      generation += 1;
      updateVisual?.();
    },
    onSnapshotReady: (_html, signature, editMap) => {
      if (!editMap) throw new Error("gap-lease-edit-map-missing");
      snapshot = { editMap, signature, revision: snapshot.revision + 1 };
      updateVisual?.();
    },
    onStatusChange: (next) => {
      status = next;
      updateVisual?.();
    },
    ...(options.materializeScheduler
      ? { materializeScheduler: options.materializeScheduler }
      : {}),
    stagingScheduler: { now: () => 0, yield: () => Promise.resolve() },
    windowed: true,
  });
  scrollCanvas = current.canvas;
  sequenceGeometry?.attach(current.canvas, current.surface);
  current.canvas.scrollTop = options.initialScrollTop ?? 0;
  Object.defineProperty(current.canvas, "clientHeight", {
    configurable: true,
    value: 240,
  });
  current.canvas.dispatchEvent(new Event("scroll"));
  const settle = async () => {
    await act(async () => {
      for (let index = 0; index < 16; index += 1) await Promise.resolve();
    });
    for (let frame = 0; frame < 8; frame += 1) {
      await act(async () => {
        await flushAnimationFrames(1);
      });
      if (status === "ready" && current.runtime.getAcceptedWindowSnapshot())
        return;
    }
    throw new Error("gap-lease-window-settle-timeout");
  };
  await settle();
  return {
    cleanup: () => {
      updateVisual = null;
      rectSpy?.mockRestore();
      sequenceGeometry?.restore();
      documentOwner.destroy();
      container.remove();
      submissionField.remove();
    },
    current,
    documentOwner,
    documentSession,
    getGeneration: () => generation,
    getRevision,
    getSnapshot: () => snapshot,
    getStatus: () => status,
    initial,
    onDiagnostic,
    onFailure,
    settle,
    setUpdateVisual: (next: (() => void) | null) => {
      updateVisual = next;
    },
  };
}

async function openGapComposition(
  options: Readonly<{
    initialMarkdown?: string;
    targetId?: string;
    flowGeometry?: boolean;
    initialScrollTop?: number;
    skipEnter?: boolean;
  }> = {},
) {
  const fixture = await openWindowedOwner(options);
  const {
    current,
    documentOwner,
    documentSession,
    getRevision,
    getSnapshot,
    getStatus,
  } = fixture;
  const surface = current.surface;
  const requests: Array<{ markdown: string; signature: string }> = [];
  const requestPreview = (markdown: string) => {
    const signature = `gap-lease-${requests.length + 1}`;
    requests.push({ markdown, signature });
    current.session.schedule(request(markdown, signature), true);
    return signature;
  };
  const requestPreviewAtDocumentEnd = (
    markdown: string,
    selection?: Readonly<{ end: number; start: number }>,
  ) => {
    const pin = current.runtime.prepareDocumentEndWindowPin(
      `gap-lease-${requests.length + 1}`,
      selection,
    );
    try {
      return { signature: requestPreview(markdown), release: pin.release };
    } catch (error) {
      pin.release();
      throw error;
    }
  };
  const onTransferFailure = vi.fn();
  const onCanonicalDocumentChange = vi.fn();
  const props = {
    documentSession,
    imagePasteUploadEnabled: false,
    imageUploadEnabled: false,
    onCanonicalDocumentChange,
    onDiagnostic: fixture.onDiagnostic,
    onDispose: vi.fn(),
    onFailure: fixture.onFailure,
    onMarkdownChange: vi.fn(),
    onPendingChange: vi.fn(),
    onReady: vi.fn(),
    onTransferFailure,
    pending: false,
    prepareWindowBlockAdoption: current.runtime.prepareWindowBlockAdoption,
    retainCompositionSurface: () => current.runtime.retainCompositionSurface(),
    requestPreview,
    requestPreviewAtDocumentEnd,
    getAcceptedWindowSnapshot: current.runtime.getAcceptedWindowSnapshot,
    surface,
  };
  const visual = () => {
    const snapshot = getSnapshot();
    return (
      <WindowedImmersiveVisualEditor
        referenceLabelCaseFoldProfile={14}
        {...props}
        acceptedWindowSnapshotGeneration={fixture.getGeneration()}
        editMap={snapshot.editMap}
        previewSnapshot={snapshot}
        previewStatus={getStatus()}
      />
    );
  };
  let view: RenderResult | null = render(visual());
  fixture.setUpdateVisual(() =>
    queueMicrotask(() => {
      if (view) view.rerender(visual());
    }),
  );
  const unmountVisual = () => {
    const activeView = view;
    view = null;
    fixture.setUpdateVisual(null);
    act(() => activeView?.unmount());
  };
  const dispose = () => {
    unmountVisual();
    current.unmount();
    fixture.cleanup();
  };
  surface.tabIndex = 0;
  surface.focus();
  const codeAt = (id: string) => {
    const code = surface.querySelector(
      `[data-easymde-visual-block-id="${id}"] > code`,
    );
    if (!(code instanceof HTMLElement))
      throw new Error("gap-lease-code-missing");
    return code;
  };
  const select = (code: HTMLElement, start: number, end = start) => {
    const text = code.firstChild;
    if (!(text instanceof Text)) throw new Error("gap-lease-text-missing");
    window.getSelection()?.setBaseAndExtent(text, start, text, end);
  };
  const remove = (code: HTMLElement, start: number, end: number) => {
    select(code, start, end);
    const range = window.getSelection()?.getRangeAt(0).cloneRange();
    if (!range) throw new Error("gap-lease-range-missing");
    const event = new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      inputType: "deleteContentBackward",
    });
    Object.defineProperty(event, "getTargetRanges", { value: () => [range] });
    surface.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    range.deleteContents();
    window.getSelection()?.collapse(range.startContainer, range.startOffset);
    surface.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        inputType: "deleteContentBackward",
      }),
    );
  };
  const code = codeAt(options.targetId ?? "b1");
  act(() => remove(code, 0, code.textContent?.length ?? 0));
  act(() =>
    surface.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Backspace",
      }),
    ),
  );
  const paragraph = surface.querySelector(
    `[data-easymde-visual-block-id="${options.targetId ?? "b1"}"]`,
  );
  if (
    !(paragraph instanceof HTMLParagraphElement) ||
    !(paragraph.firstChild instanceof HTMLBRElement)
  )
    throw new Error("gap-lease-placeholder-missing");
  const afterExit = documentOwner.getValue();
  const start = documentOwner.getSelection().start;
  if (!options.skipEnter)
    act(() => {
      surface.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "Enter",
        }),
      );
      surface.dispatchEvent(
        new InputEvent("beforeinput", {
          bubbles: true,
          cancelable: true,
          inputType: "insertParagraph",
        }),
      );
    });
  const afterEnter = options.skipEnter
    ? afterExit
    : `${afterExit.slice(0, start)}\n${afterExit.slice(start)}`;
  expect(documentOwner.getValue()).toBe(afterEnter);
  const resolvePendingFrom = async (startIndex: number) => {
    await act(async () => {
      for (
        let index = startIndex;
        index < current.responses.length;
        index += 1
      ) {
        const requested = requests[index];
        if (!requested) throw new Error("gap-lease-request-missing");
        current.responses[index]?.resolve(
          gapLeasePreview(requested.markdown, requested.signature),
        );
      }
    });
    await act(async () => {
      await flushAnimationFrames(6);
    });
  };
  const dispatchHistory = (redo: boolean, keyboard: boolean) =>
    act(() => {
      surface.dispatchEvent(
        keyboard
          ? new KeyboardEvent("keydown", {
              bubbles: true,
              cancelable: true,
              ctrlKey: true,
              key: "z",
              shiftKey: redo,
            })
          : new InputEvent("beforeinput", {
              bubbles: true,
              cancelable: true,
              inputType: redo ? "historyRedo" : "historyUndo",
            }),
      );
    });
  const resolvePending = async () => {
    await act(async () => {
      expect(current.responses).toHaveLength(requests.length);
      for (const [index, response] of current.responses.entries()) {
        const requested = requests[index];
        if (!requested) throw new Error("gap-lease-request-missing");
        response.resolve(
          gapLeasePreview(requested.markdown, requested.signature),
        );
      }
    });
    await act(async () => {
      await flushAnimationFrames(6);
    });
  };
  const startComposition = () => {
    const historyBefore = documentOwner.getHistoryState();
    act(() => {
      surface.dispatchEvent(
        new CompositionEvent("compositionstart", { bubbles: true }),
      );
      surface.dispatchEvent(
        new InputEvent("beforeinput", {
          bubbles: true,
          cancelable: false,
          data: "文",
          inputType: "insertCompositionText",
          isComposing: true,
        }),
      );
      const native = window.getSelection();
      const draft = native?.rangeCount
        ? native.getRangeAt(0).cloneRange()
        : null;
      if (!draft) throw new Error("gap-lease-ime-range-missing");
      const text = document.createTextNode("文");
      draft.insertNode(text);
      native?.collapse(text, 1);
      surface.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          data: "文",
          inputType: "insertCompositionText",
          isComposing: true,
        }),
      );
    });
    return historyBefore;
  };
  const endComposition = (data: string) =>
    act(() =>
      surface.dispatchEvent(
        new CompositionEvent("compositionend", { bubbles: true, data }),
      ),
    );
  return {
    ...fixture,
    afterEnter,
    afterExit,
    code,
    dispose,
    dispatchHistory,
    endComposition,
    getRevision,
    onCanonicalDocumentChange,
    onTransferFailure,
    paragraph,
    requests,
    resolvePending,
    resolvePendingFrom,
    start,
    startComposition,
    surface,
    rerenderVisual: () => view?.rerender(visual()),
    onDispose: props.onDispose,
    onReady: props.onReady,
    unmountVisual,
  };
}

describe("PreviewSurfaceOwner composition surface lease", () => {
  it("keeps the accepted frame uninstalled until both concurrent leases release exactly once", async () => {
    const current = setup({
      contentEditable: false,
      initialHtml: "<p>Initial preview</p>",
    });
    const surface = current.surface;
    expect(surface.innerHTML).toBe("<p>Initial preview</p>");
    const first = current.runtime.retainCompositionSurface();
    const second = current.runtime.retainCompositionSurface();
    act(() => current.session.schedule(request("# Next", "next"), true));
    await act(async () => {
      current.responses[0]?.resolve({
        features: {},
        html: safeHtml("<p>Next</p>"),
      });
      for (let index = 0; index < 24; index += 1) await Promise.resolve();
    });
    expect(surface.innerHTML).toBe("<p>Initial preview</p>");

    act(() => {
      first.release();
      first.release();
    });
    await act(async () => {
      for (let index = 0; index < 24; index += 1) await Promise.resolve();
    });
    expect(surface.innerHTML).toBe("<p>Initial preview</p>");

    act(() => second.release());
    await act(async () => {
      for (let index = 0; index < 24; index += 1) await Promise.resolve();
    });
    expect(surface.textContent).toBe("Next");
    expect(
      surface.querySelector('[data-easymde-visual-block-id="b0"]')?.textContent,
    ).toBe("Next");
    current.unmount();
  });

  it("rejects acquisition after owner disposal and never lets a stale release touch a new activation", async () => {
    const first = setup({
      contentEditable: false,
      initialHtml: "<p>Initial preview</p>",
    });
    const runtime = first.runtime;
    const stale = runtime.retainCompositionSurface();
    first.unmount();
    expect(() => runtime.retainCompositionSurface()).toThrow(
      "preview-composition-surface-inactive",
    );
    expect(() => {
      stale.release();
      stale.release();
    }).not.toThrow();

    const second = setup({
      contentEditable: false,
      initialHtml: "<p>Second preview</p>",
    });
    const lease = second.runtime.retainCompositionSurface();
    act(() => lease.release());
    await act(async () => {
      for (let index = 0; index < 8; index += 1) await Promise.resolve();
    });
    expect(second.surface.innerHTML).toBe("<p>Second preview</p>");
    second.unmount();
  });

  it("refuses a lease while a materialization is already running", async () => {
    const pending: Array<() => void> = [];
    const fixture = await openWindowedOwner({
      materializeScheduler: {
        pending: [],
        yield: vi.fn(
          () => new Promise<void>((resolve) => pending.push(resolve)),
        ),
      },
    });
    try {
      await act(async () => {
        void fixture.current.runtime.materialize();
        for (let index = 0; index < 8; index += 1) await Promise.resolve();
      });
      expect(pending.length).toBeGreaterThan(0);
      expect(() => fixture.current.runtime.retainCompositionSurface()).toThrow(
        "preview-composition-surface-busy",
      );
      // The refused admission never acquired, so a later release is not owed.
      expect(fixture.onFailure).not.toHaveBeenCalled();
    } finally {
      fixture.current.unmount();
      fixture.cleanup();
    }
  });
});

describe("Windowed composition surface retention", () => {
  it("continues editing and history while a real older Preview is superseded", async () => {
    const fixture = await openGapComposition();
    try {
      fixture.startComposition();
      const oldRequestCount = fixture.requests.length;
      expect(oldRequestCount).toBeGreaterThan(0);
      await fixture.resolvePending();
      expect(fixture.documentOwner.getValue()).toBe(fixture.afterEnter);
      fixture.endComposition("文");
      const composed = `${fixture.afterEnter.slice(0, fixture.start + 1)}文${fixture.afterEnter.slice(fixture.start + 1)}`;
      expect(fixture.documentOwner.getValue()).toBe(composed);
      expect(fixture.requests.length).toBeGreaterThan(oldRequestCount);
      const native = window.getSelection();
      const range = native?.rangeCount
        ? native.getRangeAt(0).cloneRange()
        : null;
      if (!range) throw new Error("window-supersession-range-missing");
      const next = new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        inputType: "insertText",
        data: "X",
      });
      Object.defineProperty(next, "getTargetRanges", { value: () => [range] });
      act(() => {
        fixture.surface.dispatchEvent(next);
        if (!next.defaultPrevented) {
          range.deleteContents();
          const text = document.createTextNode("X");
          range.insertNode(text);
          native?.collapse(text, 1);
          fixture.surface.dispatchEvent(
            new InputEvent("input", {
              bubbles: true,
              inputType: "insertText",
              data: "X",
            }),
          );
        }
      });
      const edited = `${composed.slice(0, fixture.start + 2)}X${composed.slice(fixture.start + 2)}`;
      expect(fixture.onFailure).not.toHaveBeenCalled();
      expect(fixture.documentOwner.getValue()).toBe(edited);
      expect(fixture.documentOwner.getSelection()).toEqual({
        direction: "none",
        start: fixture.start + 3,
        end: fixture.start + 3,
      });
      fixture.dispatchHistory(false, false);
      expect(fixture.documentOwner.getValue()).toBe(composed);
      fixture.dispatchHistory(true, false);
      expect(fixture.documentOwner.getValue()).toBe(edited);
      expect(fixture.onFailure).not.toHaveBeenCalled();
      expect(fixture.onTransferFailure).not.toHaveBeenCalled();
      await fixture.resolvePending();
      await fixture.settle();
      expect(fixture.getStatus()).toBe("ready");
      expect(fixture.current.surface.getAttribute("aria-busy")).toBe("false");
      const accepted = fixture.current.runtime.getAcceptedWindowSnapshot();
      expect(accepted?.signature).toBe(fixture.requests.at(-1)?.signature);
      expect(accepted?.sourceRevision).toBe(fixture.getRevision());
    } finally {
      fixture.dispose();
    }
  });

  interface HeldAcceptanceProbe {
    afterEnter: string;
    afterExit: string;
    current: Readonly<{
      runtime: Readonly<{ getAcceptedWindowSnapshot: () => unknown }>;
      responses: ReadonlyArray<
        Readonly<{ reject: (reason?: unknown) => void }>
      >;
    }>;
    dispatchHistory: (redo: boolean, keyboard: boolean) => void;
    documentOwner: Readonly<{ getValue: () => string }>;
    requests: ReadonlyArray<unknown>;
    resolvePending: () => Promise<void>;
    resolvePendingFrom: (startIndex: number) => Promise<void>;
    surface: HTMLElement;
  }

  const open = async () => {
    const fixture = await openGapComposition();
    const historyBefore = fixture.startComposition();
    return { ...fixture, historyBefore };
  };

  const expectHeldAcceptance = async (fixture: HeldAcceptanceProbe) => {
    const nodes = Array.from(fixture.surface.childNodes);
    const certificate = fixture.current.runtime.getAcceptedWindowSnapshot();
    await fixture.resolvePending();
    expect(fixture.documentOwner.getValue()).toBe(fixture.afterEnter);
    expect(Array.from(fixture.surface.childNodes)).toEqual(nodes);
    expect(fixture.current.runtime.getAcceptedWindowSnapshot()).toBe(
      certificate,
    );
  };

  // The outstanding Enter request is resolved by the caller, so a case can
  // prove the held surface stays uninstalled while the draft is live.
  const expectHeldAcceptanceWithoutResolving = async (
    fixture: HeldAcceptanceProbe,
  ) => {
    const nodes = Array.from(fixture.surface.childNodes);
    const certificate = fixture.current.runtime.getAcceptedWindowSnapshot();
    await act(async () => {
      await flushAnimationFrames(6);
    });
    expect(fixture.documentOwner.getValue()).toBe(fixture.afterEnter);
    expect(Array.from(fixture.surface.childNodes)).toEqual(nodes);
    expect(fixture.current.runtime.getAcceptedWindowSnapshot()).toBe(
      certificate,
    );
  };

  it("commits the composition exactly once and keeps the composed frame across acceptance", async () => {
    const fixture = await open();
    try {
      await expectHeldAcceptance(fixture);
      fixture.endComposition("文");
      const composed = `${fixture.afterEnter.slice(0, fixture.start + 1)}文${fixture.afterEnter.slice(fixture.start + 1)}`;
      expect(fixture.documentOwner.getValue()).toBe(composed);
      expect(fixture.documentOwner.getSelection()).toEqual({
        direction: "none",
        end: fixture.start + 2,
        start: fixture.start + 2,
      });
      expect(fixture.documentOwner.getHistoryState().undoDepth).toBe(
        fixture.historyBefore.undoDepth + 1,
      );
      await fixture.resolvePending();
      expect(fixture.documentOwner.getValue()).toBe(composed);
      expect(fixture.documentOwner.getValue().split("文")).toHaveLength(2);
      expect(fixture.documentOwner.getSelection()).toEqual({
        direction: "none",
        end: fixture.start + 2,
        start: fixture.start + 2,
      });
      expect(fixture.documentOwner.getHistoryState().undoDepth).toBe(
        fixture.historyBefore.undoDepth + 1,
      );
      expect(fixture.onFailure).not.toHaveBeenCalled();
      expect(fixture.onDiagnostic).not.toHaveBeenCalled();
      expect(fixture.onTransferFailure).not.toHaveBeenCalled();
    } finally {
      fixture.dispose();
    }
  });

  it("cancels without writing canonical or history and releases the surface", async () => {
    const fixture = await open();
    try {
      await expectHeldAcceptance(fixture);
      fixture.endComposition("");
      expect(fixture.documentOwner.getValue()).toBe(fixture.afterEnter);
      expect(fixture.documentOwner.getValue()).not.toContain("文");
      expect(fixture.documentOwner.getHistoryState().undoDepth).toBe(
        fixture.historyBefore.undoDepth,
      );
      await fixture.resolvePending();
      expect(fixture.documentOwner.getValue()).toBe(fixture.afterEnter);
      expect(fixture.surface.textContent).not.toContain("文");
      expect(
        fixture.current.runtime.getAcceptedWindowSnapshot(),
      ).not.toBeNull();
      expect(fixture.onFailure).not.toHaveBeenCalled();
    } finally {
      fixture.dispose();
    }
  });

  it("never writes a late draft over a source revision ABA", async () => {
    const fixture = await open();
    try {
      await expectHeldAcceptance(fixture);
      const beforeRevision = fixture.getRevision();
      const external = `${fixture.afterEnter}\n\nParagraph external`;
      act(() =>
        fixture.documentOwner.applyTextChange({
          selection: {
            direction: "none",
            end: external.length,
            start: external.length,
          },
          value: external,
        }),
      );
      act(() =>
        fixture.documentOwner.applyTextChange({
          selection: {
            direction: "none",
            end: fixture.start,
            start: fixture.start,
          },
          value: fixture.afterEnter,
        }),
      );
      expect(fixture.getRevision()).not.toBe(beforeRevision);
      expect(fixture.documentOwner.getValue()).toBe(fixture.afterEnter);
      const canonical = {
        history: fixture.documentOwner.getHistoryState(),
        revision: fixture.getRevision(),
        selection: fixture.documentOwner.getSelection(),
        value: fixture.documentOwner.getValue(),
      };
      fixture.endComposition("文");
      expect(fixture.documentOwner.getValue()).toBe(fixture.afterEnter);
      expect(fixture.documentOwner.getValue()).not.toContain("文");
      // The outstanding response was rendered from a source older than the
      // current one, so it must not install: the surface stays as it is and
      // no accepted window claims the refused frame.
      const nodes = Array.from(fixture.surface.childNodes);
      await fixture.resolvePending();
      expect(Array.from(fixture.surface.childNodes)).toEqual(nodes);
      expect({
        history: fixture.documentOwner.getHistoryState(),
        revision: fixture.getRevision(),
        selection: fixture.documentOwner.getSelection(),
        value: fixture.documentOwner.getValue(),
      }).toEqual(canonical);
      expect(fixture.current.runtime.getAcceptedWindowSnapshot()).toBeNull();
      expect(fixture.onFailure).not.toHaveBeenCalled();
    } finally {
      fixture.dispose();
    }
  });

  it("completes at the captured range with restoreFocus=false while another element keeps focus", async () => {
    const fixture = await open();
    const outside = document.createElement("button");
    document.body.append(outside);
    try {
      await expectHeldAcceptance(fixture);
      outside.focus();
      expect(document.activeElement).toBe(outside);
      fixture.endComposition("文");
      const composed = `${fixture.afterEnter.slice(0, fixture.start + 1)}文${fixture.afterEnter.slice(fixture.start + 1)}`;
      expect(fixture.documentOwner.getValue()).toBe(composed);
      expect(fixture.documentOwner.getSelection()).toEqual({
        direction: "none",
        end: fixture.start + 2,
        start: fixture.start + 2,
      });
      expect(document.activeElement).toBe(outside);
      expect(fixture.documentOwner.getHistoryState().undoDepth).toBe(
        fixture.historyBefore.undoDepth + 1,
      );
      // The current frame must still install: focus never became a lease
      // condition, so the released surface accepts the new response.
      await fixture.resolvePending();
      expect(document.activeElement).toBe(outside);
      expect(fixture.documentOwner.getValue()).toBe(composed);
      expect(fixture.documentOwner.getSelection()).toEqual({
        direction: "none",
        end: fixture.start + 2,
        start: fixture.start + 2,
      });
      expect(fixture.documentOwner.getHistoryState().undoDepth).toBe(
        fixture.historyBefore.undoDepth + 1,
      );
      expect(fixture.onFailure).not.toHaveBeenCalled();
    } finally {
      outside.remove();
      fixture.dispose();
    }
  });

  it("discards the owned draft without serializing it when the Windowed consumer unmounts", async () => {
    const fixture = await open();
    try {
      await expectHeldAcceptance(fixture);
      fixture.unmountVisual();
      expect(fixture.documentOwner.getValue()).toBe(fixture.afterEnter);
      await fixture.resolvePending();
      expect(fixture.documentOwner.getValue()).toBe(fixture.afterEnter);
      expect(fixture.documentOwner.getValue()).not.toContain("文");
      expect(
        fixture.current.runtime.getAcceptedWindowSnapshot(),
      ).not.toBeNull();
      expect(fixture.onFailure).not.toHaveBeenCalled();
    } finally {
      fixture.dispose();
    }
  });

  it("releases without touching canonical when the whole owner is torn down", async () => {
    const fixture = await open();
    try {
      await expectHeldAcceptance(fixture);
      fixture.current.unmount();
      fixture.unmountVisual();
      expect(fixture.documentOwner.getValue()).toBe(fixture.afterEnter);
      expect(fixture.documentOwner.getValue()).not.toContain("文");
      expect(fixture.onFailure).not.toHaveBeenCalled();
      expect(() => fixture.current.runtime.retainCompositionSurface()).toThrow(
        "preview-composition-surface-inactive",
      );
    } finally {
      fixture.cleanup();
    }
  });

  it("lets a keydown Undo supersede the composition and refuses the late draft", async () => {
    const fixture = await open();
    try {
      await expectHeldAcceptanceWithoutResolving(fixture);
      fixture.dispatchHistory(false, true);
      // The history owner superseded the composition: the Enter edit is
      // reverted canonically and a fresh Preview request was issued.
      expect(fixture.documentOwner.getValue()).toBe(fixture.afterExit);
      expect(fixture.requests).toHaveLength(2);
      fixture.endComposition("文");
      expect(fixture.documentOwner.getValue()).toBe(fixture.afterExit);
      expect(fixture.documentOwner.getValue()).not.toContain("文");
      await fixture.resolvePendingFrom(1);
      expect(fixture.documentOwner.getValue()).toBe(fixture.afterExit);
      expect(fixture.documentOwner.getValue()).not.toContain("文");
      expect(
        fixture.current.runtime.getAcceptedWindowSnapshot(),
      ).not.toBeNull();
      expect(fixture.onFailure).not.toHaveBeenCalled();
      expect(fixture.onTransferFailure).not.toHaveBeenCalled();
    } finally {
      fixture.dispose();
    }
  });

  it("lets a native historyUndo beforeinput supersede the composition and refuses the late draft", async () => {
    const fixture = await open();
    try {
      await expectHeldAcceptanceWithoutResolving(fixture);
      fixture.dispatchHistory(false, false);
      expect(fixture.documentOwner.getValue()).toBe(fixture.afterExit);
      expect(fixture.requests).toHaveLength(2);
      fixture.endComposition("文");
      expect(fixture.documentOwner.getValue()).toBe(fixture.afterExit);
      await fixture.resolvePendingFrom(1);
      expect(fixture.documentOwner.getValue()).toBe(fixture.afterExit);
      expect(fixture.documentOwner.getValue()).not.toContain("文");
      expect(
        fixture.current.runtime.getAcceptedWindowSnapshot(),
      ).not.toBeNull();
      expect(fixture.onFailure).not.toHaveBeenCalled();
    } finally {
      fixture.dispose();
    }
  });

  it("rejects a superseded response delivered after the composed source was accepted", async () => {
    const fixture = await open();
    try {
      // The Enter request stays outstanding while the composition settles.
      await expectHeldAcceptanceWithoutResolving(fixture);
      fixture.endComposition("文");
      const composed = `${fixture.afterEnter.slice(0, fixture.start + 1)}文${fixture.afterEnter.slice(fixture.start + 1)}`;
      expect(fixture.documentOwner.getValue()).toBe(composed);
      expect(fixture.requests).toHaveLength(2);
      await fixture.resolvePendingFrom(1);
      expect(fixture.documentOwner.getValue()).toBe(composed);
      expect(fixture.documentOwner.getValue().split("文")).toHaveLength(2);
      expect(
        fixture.current.runtime.getAcceptedWindowSnapshot(),
      ).not.toBeNull();
      await act(async () => {
        fixture.current.responses[0]?.reject(
          new Error("preview-request-superseded"),
        );
        for (let index = 0; index < 16; index += 1) await Promise.resolve();
      });
      expect(fixture.documentOwner.getValue()).toBe(composed);
      expect(fixture.documentOwner.getValue().split("文")).toHaveLength(2);
      expect(fixture.documentOwner.getHistoryState().undoDepth).toBe(
        fixture.historyBefore.undoDepth + 1,
      );
      expect(fixture.onFailure).not.toHaveBeenCalled();
    } finally {
      fixture.dispose();
    }
  });
});

declare global {
  interface HTMLElement {
    easymdePreviewSignature?: string;
  }
}

describe("test-first Windowed owned editing draft", () => {
  const cases = [
    { language: "bash", position: "first", index: 1 },
    { language: "python", position: "middle", index: 160 },
    { language: "typescript", position: "end", index: 316 },
  ] as const;
  const open = async (language: string, index: number, skipEnter = false) => {
    const initialMarkdown = Array.from({ length: 320 }, (_, ordinal) =>
      ordinal === index - 1
        ? "### Before"
        : ordinal === index
          ? `~~~${language}\nAB\n~~~`
          : ordinal === index + 1
            ? "### After"
            : ordinal === index + 2
              ? "~~~ruby\nNEIGHBOR\n~~~"
              : `Paragraph ${ordinal}`,
    ).join("\n\n");
    const fixture = await openGapComposition({
      initialMarkdown,
      targetId: `b${index}`,
      flowGeometry: true,
      initialScrollTop: Math.max(0, index * 24 - 48),
      skipEnter,
    });
    expect(
      fixture.onFailure.mock.calls,
      "valid real CM/map/HTML setup",
    ).toEqual([]);
    expect(
      fixture.onDiagnostic.mock.calls,
      "valid accepted-window setup",
    ).toEqual([]);
    expect(fixture.getStatus()).toBe(skipEnter ? "ready" : "loading");
    expect(fixture.requests).toHaveLength(skipEnter ? 0 : 1);
    expect(fixture.current.responses).toHaveLength(skipEnter ? 0 : 1);
    return fixture;
  };
  const expectCaret = (surface: HTMLElement, text: string, offset: number) => {
    const native = window.getSelection();
    expect.soft(native?.isCollapsed).toBe(true);
    expect.soft(native?.anchorNode?.isConnected).toBe(true);
    const draft = Array.from(surface.querySelectorAll("p")).find(
      (node) =>
        node.textContent === text &&
        native?.anchorNode &&
        node.contains(native.anchorNode),
    );
    expect
      .soft(
        draft,
        "caret remains in its independently owned editing paragraph, not the next heading",
      )
      .toBeDefined();
    if (draft && native?.anchorNode) {
      const prefix = document.createRange();
      prefix.selectNodeContents(draft);
      prefix.setEnd(native.anchorNode, native.anchorOffset);
      expect.soft(prefix.toString().length).toBe(offset);
    }
    expect.soft(document.activeElement).toBe(surface);
    expect.soft(surface.getAttribute("contenteditable")).toBe("true");
  };
  const type = (surface: HTMLElement, data: string) =>
    act(() => {
      const native = window.getSelection();
      const target = native?.rangeCount
        ? native.getRangeAt(0).cloneRange()
        : null;
      if (!target) throw new Error("test-first-draft-target-missing");
      const before = new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        inputType: "insertText",
        data,
      });
      Object.defineProperty(before, "getTargetRanges", {
        value: () => [target],
      });
      surface.dispatchEvent(before);
      if (!before.defaultPrevented) {
        const text = document.createTextNode(data);
        target.deleteContents();
        target.insertNode(text);
        native?.collapse(text, data.length);
      }
      // A browser trailing input must not serialize the already committed draft.
      surface.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          inputType: "insertText",
          data,
        }),
      );
    });
  it.each(cases)(
    "paints a then ab then abc before any response and rejects late acceptance ($language, $position)",
    async ({ language, index }) => {
      const fixture = await open(language, index);
      const values: string[] = [];
      const unsubscribe = fixture.documentOwner.subscribe(() =>
        values.push(fixture.documentOwner.getValue()),
      );
      try {
        const insertion = fixture.start + 1;
        const initialReadyCalls = fixture.onReady.mock.calls.length;
        const initialDisposeCalls = fixture.onDispose.mock.calls.length;
        for (const [ordinal, data] of ["a", "b", "c"].entries()) {
          const revision = fixture.getRevision();
          type(fixture.surface, data);
          const draft = "abc".slice(0, ordinal + 1);
          const expected =
            fixture.afterEnter.slice(0, insertion) +
            draft +
            fixture.afterEnter.slice(insertion);
          expect.soft(fixture.documentOwner.getValue()).toBe(expected);
          expect.soft(fixture.documentOwner.getSelection()).toEqual({
            direction: "none",
            start: insertion + draft.length,
            end: insertion + draft.length,
          });
          expect.soft(fixture.getRevision()).toBe(revision + 1);
          expectCaret(fixture.surface, draft, draft.length);
          act(() => fixture.rerenderVisual());
          expectCaret(fixture.surface, draft, draft.length);
          expect.soft(fixture.onReady).toHaveBeenCalledTimes(initialReadyCalls);
          expect
            .soft(fixture.onDispose)
            .toHaveBeenCalledTimes(initialDisposeCalls);
        }
        expect
          .soft(values)
          .toEqual(
            ["a", "ab", "abc"].map(
              (draft) =>
                fixture.afterEnter.slice(0, insertion) +
                draft +
                fixture.afterEnter.slice(insertion),
            ),
          );
        const revision = fixture.getRevision();
        const expected = fixture.documentOwner.getValue();
        // Accept the newest request first, then deliver the held Enter and all
        // obsolete character responses. None can overwrite newer DOM/caret.
        await fixture.resolvePendingFrom(fixture.requests.length - 1);
        expect.soft(fixture.getStatus()).toBe("ready");
        expectCaret(fixture.surface, "abc", 3);
        await fixture.resolvePending();
        expect.soft(fixture.documentOwner.getValue()).toBe(expected);
        expect.soft(fixture.getRevision()).toBe(revision);
        expectCaret(fixture.surface, "abc", 3);
        expect
          .soft(fixture.surface.textContent?.match(/NEIGHBOR/g))
          .toHaveLength(1);
        expect.soft(fixture.onFailure).not.toHaveBeenCalled();
        expect.soft(fixture.onDiagnostic).not.toHaveBeenCalled();
        expect.soft(fixture.onTransferFailure).not.toHaveBeenCalled();
      } finally {
        unsubscribe();
        fixture.dispose();
      }
    },
  );
  it("keeps the blank gap and caret in the formal commit with DOM flow and real ratio scrolling", async () => {
    const fixture = await open("typescript", 160);
    const samples: Array<{
      connected: boolean;
      caret: boolean;
      top: number;
      extent: number;
      scroll: number;
    }> = [];
    const sample = () => {
      const after = Array.from(fixture.surface.querySelectorAll("h3")).find(
        (node) => node.textContent === "After",
      );
      if (!(after instanceof HTMLElement))
        throw new Error("test-first-following-heading-missing");
      const native = window.getSelection();
      samples.push({
        connected: fixture.paragraph.isConnected,
        caret: Boolean(
          native?.anchorNode &&
          (native.anchorNode === fixture.paragraph ||
            fixture.paragraph.contains(native.anchorNode)),
        ),
        top: after.getBoundingClientRect().top,
        extent: fixture.current.canvas.scrollHeight,
        scroll: fixture.current.canvas.scrollTop,
      });
    };
    const observer = new MutationObserver(sample);
    try {
      sample();
      observer.observe(fixture.surface, { childList: true, subtree: true });
      const source = fixture.documentOwner.getValue();
      const revision = fixture.getRevision();
      await fixture.resolvePending();
      for (let frame = 0; frame < 3; frame += 1) {
        await act(async () => {
          await flushAnimationFrames(1);
        });
        sample();
      }
      expect.soft(fixture.getStatus()).toBe("ready");
      expect.soft(fixture.documentOwner.getValue()).toBe(source);
      expect.soft(fixture.getRevision()).toBe(revision);
      expect.soft(fixture.documentOwner.getSelection()).toEqual({
        direction: "none",
        start: fixture.start + 1,
        end: fixture.start + 1,
      });
      const first = samples[0];
      if (!first) throw new Error("test-first-geometry-sample-missing");
      for (const state of samples) {
        expect
          .soft(
            state.connected,
            "owned gap must not disappear even at committing",
          )
          .toBe(true);
        expect
          .soft(state.caret, "native caret must not degenerate to following H3")
          .toBe(true);
        expect.soft(state.extent).toBeCloseTo(first.extent, 6);
        expect.soft(state.top).toBeCloseTo(first.top, 6);
        expect.soft(state.scroll).toBeCloseTo(first.scroll, 6);
      }
      expectCaret(fixture.surface, "", 0);
      expect.soft(fixture.onFailure).not.toHaveBeenCalled();
      expect.soft(fixture.onDiagnostic).not.toHaveBeenCalled();
    } finally {
      observer.disconnect();
      fixture.dispose();
    }
  });
  it("retargets heading-tail Enter and typing after extra deletion while the structural response is held then released", async () => {
    const fixture = await open("python", 160, true);
    try {
      const heading = Array.from(fixture.surface.querySelectorAll("h3")).find(
        (node) => node.textContent === "Before",
      );
      const text = heading?.firstChild;
      if (!(heading instanceof HTMLElement) || !(text instanceof Text))
        throw new Error("test-first-retarget-heading-missing");
      const headingTail =
        fixture.afterExit.indexOf("### Before") + "### Before".length;
      act(() => {
        const key = new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "Backspace",
        });
        fixture.surface.dispatchEvent(key);
        if (key.defaultPrevented) return;
        const target = document.createRange();
        target.setStart(text, text.length);
        target.setEnd(fixture.paragraph, 0);
        const before = new InputEvent("beforeinput", {
          bubbles: true,
          cancelable: true,
          inputType: "deleteContentBackward",
        });
        Object.defineProperty(before, "getTargetRanges", {
          value: () => [target],
        });
        fixture.surface.dispatchEvent(before);
        if (!before.defaultPrevented) {
          fixture.paragraph.remove();
          window.getSelection()?.collapse(text, text.length);
          fixture.surface.dispatchEvent(
            new InputEvent("input", {
              bubbles: true,
              inputType: "deleteContentBackward",
            }),
          );
        }
      });
      expect(fixture.documentOwner.getValue()).toBe(fixture.afterExit);
      expect
        .soft(fixture.documentOwner.getSelection())
        .toEqual({ direction: "none", start: headingTail, end: headingTail });
      expect.soft(window.getSelection()?.anchorNode).toBe(text);
      expect.soft(window.getSelection()?.anchorOffset).toBe(text.length);
      expect(fixture.requests).toHaveLength(1);
      expect(fixture.getStatus()).toBe("loading");
      // No response is released before the actual user retarget/Enter/type.
      // The unchanged heading owns the same canonical extent; a pointer
      // gesture is not permission to replay a stale or foreign gap lease.
      act(() => {
        heading.dispatchEvent(new Event("pointerdown", { bubbles: true }));
        window.getSelection()?.collapse(text, text.length);
        const key = new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "Enter",
        });
        fixture.surface.dispatchEvent(key);
        if (key.defaultPrevented) return;
        const before = new InputEvent("beforeinput", {
          bubbles: true,
          cancelable: true,
          inputType: "insertParagraph",
        });
        fixture.surface.dispatchEvent(before);
        if (!before.defaultPrevented) {
          const paragraph = document.createElement("p");
          paragraph.append(document.createElement("br"));
          heading.after(paragraph);
          window.getSelection()?.collapse(paragraph, 0);
          fixture.surface.dispatchEvent(
            new InputEvent("input", {
              bubbles: true,
              inputType: "insertParagraph",
            }),
          );
        }
      });
      type(fixture.surface, "a");
      // The fixed fixture already contains the Markdown paragraph separator.
      // Its new paragraph consumes that owned blank point, never H3's text.
      const expected =
        fixture.afterExit.slice(0, headingTail + 2) +
        "a" +
        fixture.afterExit.slice(headingTail + 2);
      expect.soft(fixture.documentOwner.getValue()).toBe(expected);
      expect.soft(fixture.documentOwner.getSelection()).toEqual({
        direction: "none",
        start: headingTail + 3,
        end: headingTail + 3,
      });
      expectCaret(fixture.surface, "a", 1);
      await fixture.resolvePending();
      expect.soft(fixture.getStatus()).toBe("ready");
      expect.soft(fixture.documentOwner.getValue()).toBe(expected);
      expectCaret(fixture.surface, "a", 1);
      expect.soft(fixture.onFailure).not.toHaveBeenCalled();
      expect.soft(fixture.onDiagnostic).not.toHaveBeenCalled();
      expect.soft(fixture.onTransferFailure).not.toHaveBeenCalled();
    } finally {
      fixture.dispose();
    }
  });
  it.each(["Paste", "IME"] as const)(
    "shows pending native %s and commits its actual canonical result once across props rerender",
    async (kind) => {
      const fixture = await open("python", 160);
      try {
        const revision = fixture.getRevision();
        const history = fixture.documentOwner.getHistoryState();
        if (kind === "Paste") {
          act(() => {
            const paste = new Event("paste", {
              bubbles: true,
              cancelable: true,
            });
            Object.defineProperty(paste, "clipboardData", {
              value: {
                files: [],
                items: [],
                types: ["text/plain"],
                getData: (format: string) =>
                  format === "text/plain" ? "文" : "",
              },
            });
            fixture.surface.dispatchEvent(paste);
            expect(paste.defaultPrevented).toBe(true);
            fixture.rerenderVisual();
          });
          // Paste intentionally settles outside the native event task. A
          // microtask-only flush races the real transfer and is not a failure.
          await act(async () => {
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
          });
        } else {
          fixture.startComposition();
          expectCaret(fixture.surface, "文", 1);
          expect(fixture.documentOwner.getValue()).toBe(fixture.afterEnter);
          expect(fixture.getRevision()).toBe(revision);
          act(() => fixture.rerenderVisual());
          await fixture.resolvePending();
          expectCaret(fixture.surface, "文", 1);
          expect(fixture.documentOwner.getValue()).toBe(fixture.afterEnter);
          fixture.endComposition("文");
          act(() =>
            fixture.surface.dispatchEvent(
              new InputEvent("beforeinput", {
                bubbles: true,
                cancelable: true,
                inputType: "insertFromComposition",
                data: "文",
              }),
            ),
          );
        }
        const expected =
          fixture.afterEnter.slice(0, fixture.start + 1) +
          "文" +
          fixture.afterEnter.slice(fixture.start + 1);
        expect.soft(fixture.documentOwner.getValue()).toBe(expected);
        expect.soft(fixture.getRevision()).toBe(revision + 1);
        expect
          .soft(fixture.documentOwner.getHistoryState().undoDepth)
          .toBe(history.undoDepth + 1);
        expectCaret(fixture.surface, "文", 1);
        await fixture.resolvePending();
        expect.soft(fixture.getStatus()).toBe("ready");
        expect.soft(fixture.documentOwner.getValue()).toBe(expected);
        expect.soft(fixture.getRevision()).toBe(revision + 1);
        expectCaret(fixture.surface, "文", 1);
        expect.soft(fixture.onFailure).not.toHaveBeenCalled();
        expect.soft(fixture.onDiagnostic).not.toHaveBeenCalled();
        expect.soft(fixture.onTransferFailure).not.toHaveBeenCalled();
      } finally {
        fixture.dispose();
      }
    },
  );
});

it("admits heading-tail abc after the installed formal window becomes ready", async () => {
  const targetIndex = 160;
  const initialMarkdown = Array.from({ length: 320 }, (_, index) =>
    index === targetIndex - 1
      ? "### Before"
      : index === targetIndex
        ? "~~~bash\nAB\n~~~"
        : index === targetIndex + 1
          ? "### After"
          : index === targetIndex + 2
            ? "~~~python\nNEIGHBOR\n~~~"
            : `Paragraph ${index}`,
  ).join("\n\n");
  const initial = gapLeasePreview(initialMarkdown, "round56-initial");
  const source = markdownDocumentSource(initialMarkdown);
  const getRevision = source.owner.getRevision;
  if (!getRevision) throw new Error("round56-source-revision-unavailable");
  const geometry = installSequenceGeometry();
  let status: PreviewSurfaceStatus = "ready";
  let snapshot: Readonly<{
    editMap: PreviewEditMap;
    revision: number;
    signature: string;
  }> = {
    editMap: initial.editMap,
    revision: 1,
    signature: initial.editMap.signature,
  };
  let generation = 0;
  let pending = false;
  let deferVisualProps = false;
  let view: RenderResult | null = null;
  const onFailure = vi.fn();
  const onDiagnostic = vi.fn();
  const onTransferFailure = vi.fn();
  const onReady = vi.fn();
  const onDispose = vi.fn();
  const updateVisual = () => {
    if (!view || deferVisualProps) return;
    queueMicrotask(() => {
      if (view && !deferVisualProps) view.rerender(visual());
    });
  };
  const preview = setup({
    contentEditable: true,
    windowed: true,
    initialHtml: initial.html,
    initialEditMap: initial.editMap,
    initialSignature: initial.editMap.signature,
    currentSourceSnapshot: () => ({
      value: source.owner.getValue(),
      revision: getRevision(),
    }),
    scrollPort: createBrowserPreviewScroll(),
    onDiagnostic,
    onWindowReady: () => {
      generation += 1;
      updateVisual();
    },
    onSnapshotReady: (_html, signature, editMap) => {
      if (!editMap) throw new Error("round56-accepted-map-unavailable");
      snapshot = { editMap, signature, revision: snapshot.revision + 1 };
      updateVisual();
    },
    onStatusChange: (next) => {
      status = next;
      updateVisual();
    },
    stagingScheduler: { now: () => 0, yield: () => Promise.resolve() },
  });
  geometry.attach(preview.canvas, preview.surface);
  Object.defineProperty(preview.canvas, "clientHeight", {
    configurable: true,
    value: 240,
  });
  preview.canvas.scrollTop = targetIndex * 24 - 48;
  preview.canvas.dispatchEvent(new Event("scroll"));
  const requests: Array<{ markdown: string; signature: string }> = [];
  const requestPreview = (markdown: string) => {
    const signature = `round56-${requests.length + 1}`;
    requests.push({ markdown, signature });
    preview.session.schedule(request(markdown, signature), true);
    return signature;
  };
  const requestPreviewAtDocumentEnd = (
    markdown: string,
    selection?: Readonly<{ end: number; start: number }>,
  ) => {
    const pin = preview.runtime.prepareDocumentEndWindowPin(
      `round56-${requests.length + 1}`,
      selection,
    );
    try {
      return { signature: requestPreview(markdown), release: pin.release };
    } catch (error) {
      pin.release();
      throw error;
    }
  };
  const props = {
    documentSession: source.session,
    imagePasteUploadEnabled: false,
    imageUploadEnabled: false,
    onCanonicalDocumentChange: vi.fn(),
    onDiagnostic,
    onDispose,
    onFailure,
    onMarkdownChange: vi.fn(),
    onReady,
    onTransferFailure,
    onPendingChange: (next: boolean) => {
      pending = next;
      updateVisual();
    },
    prepareWindowBlockAdoption: preview.runtime.prepareWindowBlockAdoption,
    retainCompositionSurface: () => preview.runtime.retainCompositionSurface(),
    getAcceptedWindowSnapshot: preview.runtime.getAcceptedWindowSnapshot,
    requestPreview,
    requestPreviewAtDocumentEnd,
    surface: preview.surface,
  };
  const visual = () => (
    <WindowedImmersiveVisualEditor
      referenceLabelCaseFoldProfile={14}
      {...props}
      pending={pending}
      previewStatus={status}
      editMap={snapshot.editMap}
      previewSnapshot={snapshot}
      acceptedWindowSnapshotGeneration={generation}
    />
  );
  const settleReady = async () => {
    await act(async () => {
      for (let turn = 0; turn < 16; turn += 1) await Promise.resolve();
    });
    for (let frame = 0; frame < 8; frame += 1) {
      await act(async () => {
        await flushAnimationFrames(1);
      });
      if (status === "ready" && preview.runtime.getAcceptedWindowSnapshot())
        return;
    }
    expect(
      status,
      "real Preview owner must settle its formal certificate",
    ).toBe("ready");
    expect(preview.runtime.getAcceptedWindowSnapshot()).not.toBeNull();
  };
  const resolveResponse = async (index: number) => {
    const requested = requests[index];
    const response = preview.responses[index];
    if (!requested || !response)
      throw new Error("round56-response-prerequisite-missing");
    await act(async () => {
      response.resolve(
        gapLeasePreview(requested.markdown, requested.signature),
      );
      for (let turn = 0; turn < 16; turn += 1) await Promise.resolve();
    });
  };
  try {
    await settleReady();
    view = render(visual());
    preview.surface.tabIndex = 0;
    preview.surface.focus();
    const code = preview.surface.querySelector(
      `[data-easymde-visual-block-id="b${targetIndex}"] > code`,
    );
    if (!(code instanceof HTMLElement))
      throw new Error("round56-mounted-code-unavailable");
    act(() => {
      const target = document.createRange();
      target.selectNodeContents(code);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(target);
      const before = new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        inputType: "deleteContentBackward",
      });
      Object.defineProperty(before, "getTargetRanges", {
        value: () => [target.cloneRange()],
      });
      preview.surface.dispatchEvent(before);
      if (!before.defaultPrevented) {
        target.deleteContents();
        window.getSelection()?.collapse(code, 0);
        preview.surface.dispatchEvent(
          new InputEvent("input", {
            bubbles: true,
            inputType: "deleteContentBackward",
          }),
        );
      }
    });
    expect(source.owner.getValue()).toBe(
      initialMarkdown.replace("~~~bash\nAB\n~~~", "~~~bash\n\n~~~"),
    );
    act(() =>
      preview.surface.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "Backspace",
        }),
      ),
    );
    const exited = preview.surface.querySelector(
      `[data-easymde-visual-block-id="b${targetIndex}"]`,
    );
    if (!(exited instanceof HTMLParagraphElement))
      throw new Error("round56-owned-exit-paragraph-unavailable");
    const afterExit = initialMarkdown.replace("~~~bash\nAB\n~~~", "");
    expect(source.owner.getValue()).toBe(afterExit);
    act(() =>
      preview.surface.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "Backspace",
        }),
      ),
    );
    expect(source.owner.getValue()).toBe(afterExit);
    expect(requests).toHaveLength(1);
    await resolveResponse(0);
    await settleReady();
    expect(
      onFailure.mock.calls,
      "P0 retirement and formal-ready are valid setup",
    ).toEqual([]);
    expect(onDiagnostic.mock.calls).toEqual([]);
    const heading = Array.from(preview.surface.querySelectorAll("h3")).find(
      (node) => node.textContent === "Before",
    );
    const text = heading?.firstChild;
    if (!(heading instanceof HTMLElement) || !(text instanceof Text))
      throw new Error("round56-ready-heading-unavailable");
    const headingTail = afterExit.indexOf("### Before") + "### Before".length;
    expect(source.owner.getSelection()).toEqual({
      direction: "none",
      start: headingTail,
      end: headingTail,
    });
    expect(window.getSelection()?.anchorNode).toBe(text);
    expect(window.getSelection()?.anchorOffset).toBe(text.length);
    act(() => {
      heading.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      window.getSelection()?.collapse(text, text.length);
      preview.surface.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "Enter",
        }),
      );
    });
    const paragraph = window.getSelection()?.anchorNode;
    if (
      !(paragraph instanceof HTMLParagraphElement) ||
      !(paragraph.firstChild instanceof HTMLBRElement)
    )
      throw new Error("round56-heading-enter-owned-P0-unavailable");
    const insertion = headingTail + 2;
    expect(source.owner.getValue()).toBe(afterExit);
    expect(source.owner.getSelection()).toEqual({
      direction: "none",
      start: insertion,
      end: insertion,
    });
    expect(requests).toHaveLength(2);
    const oldPhysicalNodes = Array.from(preview.surface.childNodes);
    await resolveResponse(1);
    await settleReady();
    expect(preview.surface.getAttribute("data-easymde-preview-phase")).toBe(
      "ready",
    );
    expect(Array.from(preview.surface.childNodes)).not.toEqual(
      oldPhysicalNodes,
    );
    expect(paragraph.isConnected).toBe(true);
    expect(window.getSelection()?.anchorNode).toBe(paragraph);
    const committedValues: string[] = [];
    let lastValue = source.owner.getValue();
    const unsubscribe = source.owner.subscribe(() => {
      const value = source.owner.getValue();
      if (value !== lastValue) {
        committedValues.push(value);
        lastValue = value;
      }
    });
    try {
      for (const [index, data] of ["a", "b", "c"].entries()) {
        act(() => {
          const native = window.getSelection();
          const target = native?.rangeCount
            ? native.getRangeAt(0).cloneRange()
            : null;
          if (!target) throw new Error("round56-live-input-range-unavailable");
          const before = new InputEvent("beforeinput", {
            bubbles: true,
            cancelable: true,
            inputType: "insertText",
            data,
          });
          Object.defineProperty(before, "getTargetRanges", {
            value: () => [target],
          });
          preview.surface.dispatchEvent(before);
          if (!before.defaultPrevented) {
            const inserted = document.createTextNode(data);
            target.insertNode(inserted);
            native?.collapse(inserted, 1);
            preview.surface.dispatchEvent(
              new InputEvent("input", {
                bubbles: true,
                inputType: "insertText",
                data,
              }),
            );
          }
        });
        const draft = "abc".slice(0, index + 1);
        expect
          .soft(source.owner.getValue())
          .toBe(
            afterExit.slice(0, insertion) + draft + afterExit.slice(insertion),
          );
        expect.soft(source.owner.getSelection()).toEqual({
          direction: "none",
          start: insertion + draft.length,
          end: insertion + draft.length,
        });
        expect.soft(paragraph.textContent).toBe(draft);
        const native = window.getSelection();
        expect.soft(native?.anchorNode?.isConnected).toBe(true);
        expect
          .soft(native?.anchorNode && paragraph.contains(native.anchorNode))
          .toBe(true);
      }
      for (let index = 2; index < requests.length; index += 1)
        await resolveResponse(index);
      await settleReady();
      const expected =
        afterExit.slice(0, insertion) + "abc" + afterExit.slice(insertion);
      expect.soft(source.owner.getValue()).toBe(expected);
      expect
        .soft(committedValues)
        .toEqual(
          ["a", "ab", "abc"].map(
            (draft) =>
              afterExit.slice(0, insertion) +
              draft +
              afterExit.slice(insertion),
          ),
        );
      expect.soft(source.owner.getSelection()).toEqual({
        direction: "none",
        start: insertion + 3,
        end: insertion + 3,
      });
      expect
        .soft(preview.surface.textContent?.match(/NEIGHBOR/g))
        .toHaveLength(1);
      expect.soft(onFailure).not.toHaveBeenCalled();
      expect.soft(onDiagnostic).not.toHaveBeenCalled();
      expect.soft(onTransferFailure).not.toHaveBeenCalled();
      expect.soft(onReady).toHaveBeenCalledOnce();
      expect.soft(onDispose).not.toHaveBeenCalled();
      expect.soft(preview.surface.getAttribute("contenteditable")).toBe("true");
      expect.soft(document.activeElement).toBe(preview.surface);
    } finally {
      unsubscribe();
    }
  } finally {
    deferVisualProps = true;
    view?.unmount();
    preview.unmount();
    source.owner.destroy();
    source.container.remove();
    source.submissionField.remove();
    geometry.restore();
  }
});

it.each(["~~~", "```"])(
  "test-first v2 literal fence prefix %s stays paragraph source semantics before Enter (formal response unverified)",
  async (marker) => {
    const index = 160;
    const python = "~~~python\nNEIGHBOR\n~~~";
    const initialMarkdown = Array.from({ length: 320 }, (_, ordinal) =>
      ordinal === index - 1
        ? "### Before"
        : ordinal === index
          ? "~~~bash\nAB\n~~~"
          : ordinal === index + 1
            ? "### After"
            : ordinal === index + 2
              ? python
              : `Paragraph ${ordinal}`,
    ).join("\n\n");
    const fixture = await openGapComposition({
      initialMarkdown,
      targetId: `b${index}`,
      flowGeometry: true,
      initialScrollTop: index * 24 - 48,
    });
    try {
      const baseline = fixture.afterEnter;
      const insertion = fixture.start + 1;
      const beforeSource = baseline.slice(0, insertion);
      const afterSource = baseline.slice(insertion);
      const pythonStart = baseline.indexOf(python);
      expect(pythonStart).toBeGreaterThan(insertion);
      expect(
        fixture.onFailure.mock.calls,
        "valid owned blank paragraph setup",
      ).toEqual([]);
      for (let length = 1; length <= marker.length; length += 1) {
        const data = marker[length - 1] ?? "";
        act(() => {
          const native = window.getSelection();
          const range = native?.rangeCount
            ? native.getRangeAt(0).cloneRange()
            : null;
          if (!range)
            throw new Error("literal-prefix-native-range-unavailable");
          const before = new InputEvent("beforeinput", {
            bubbles: true,
            cancelable: true,
            inputType: "insertText",
            data,
          });
          Object.defineProperty(before, "getTargetRanges", {
            value: () => [range],
          });
          fixture.surface.dispatchEvent(before);
          if (!before.defaultPrevented) {
            const text = document.createTextNode(data);
            range.insertNode(text);
            native?.collapse(text, 1);
            fixture.surface.dispatchEvent(
              new InputEvent("input", {
                bubbles: true,
                inputType: "insertText",
                data,
              }),
            );
          }
        });
        const value = fixture.documentOwner.getValue();
        const delta = value.length - baseline.length;
        const literalSource = value.slice(insertion, insertion + delta);
        expect.soft(value.slice(0, insertion)).toBe(beforeSource);
        expect.soft(value.slice(insertion + delta)).toBe(afterSource);
        // Literal spelling may need escaping. Do not canonize an unescaped
        // opening fence as correct merely because its raw characters match.
        expect
          .soft(literalSource.replace(/\\([~`])/g, "$1"))
          .toBe(marker.slice(0, length));
        expect
          .soft(fixture.paragraph.textContent)
          .toBe(marker.slice(0, length));
        expect.soft(fixture.paragraph.tagName).toBe("P");
        const native = window.getSelection();
        expect.soft(native?.anchorNode?.isConnected).toBe(true);
        expect
          .soft(
            native?.anchorNode && fixture.paragraph.contains(native.anchorNode),
          )
          .toBe(true);
        const blocks = createEditorMarkdownBlockIndex(value).blocks;
        const pythonBlock = blocks.find(
          (block) =>
            block.kind === "code" &&
            value.slice(block.from, block.to).trimEnd() === python,
        );
        expect
          .soft(
            pythonBlock,
            "the following code remains its own logical source block, not swallowed by the literal prefix",
          )
          .toBeDefined();
        if (pythonBlock)
          expect.soft(pythonBlock.from).toBe(pythonStart + delta);
        expect
          .soft(
            Array.from(fixture.surface.querySelectorAll("pre > code")).filter(
              (node) => node.textContent === "NEIGHBOR\n",
            ),
          )
          .toHaveLength(1);
        expect.soft(fixture.onFailure).not.toHaveBeenCalled();
        expect.soft(fixture.onDiagnostic).not.toHaveBeenCalled();
        expect.soft(fixture.onTransferFailure).not.toHaveBeenCalled();
      }
      // No Enter was dispatched. These cases deliberately stop at the source
      // semantic boundary: no handwritten P+Python response is accepted as a
      // substitute for real CommonMark output. Formal renderer/HTML acceptance
      // remains unverified here and belongs to Main's real WordPress check.
    } finally {
      fixture.dispose();
    }
  },
);

it("test-first v2 Windowed CODE insert then real formal accept preserves its native caret for deleteContentBackward", async () => {
  // This case deliberately chooses Windowed, Ruby, Z and Backspace. Those
  // choices are controls, not claims about the user's unknown owner/key.
  const fence = "~~~ruby\nAC\n~~~";
  const initialMarkdown = Array.from({ length: 320 }, (_, index) =>
    index === 1 ? fence : `Paragraph ${index}`,
  ).join("\n\n");
  const fixture = await openWindowedOwner({
    initialMarkdown,
    flowGeometry: true,
  });
  const { current, documentOwner, documentSession } = fixture;
  const requests: Array<{ markdown: string; signature: string }> = [];
  const requestPreview = (markdown: string) => {
    const signature = `code-accept-delete-${requests.length + 1}`;
    requests.push({ markdown, signature });
    current.session.schedule(request(markdown, signature), true);
    return signature;
  };
  const requestPreviewAtDocumentEnd = (
    markdown: string,
    selection?: Readonly<{ end: number; start: number }>,
  ) => {
    const pin = current.runtime.prepareDocumentEndWindowPin(
      `code-accept-delete-${requests.length + 1}`,
      selection,
    );
    try {
      return { signature: requestPreview(markdown), release: pin.release };
    } catch (error) {
      pin.release();
      throw error;
    }
  };
  const onTransferFailure = vi.fn();
  const props = {
    documentSession,
    imagePasteUploadEnabled: false,
    imageUploadEnabled: false,
    onCanonicalDocumentChange: vi.fn(),
    onDiagnostic: fixture.onDiagnostic,
    onDispose: vi.fn(),
    onFailure: fixture.onFailure,
    onMarkdownChange: vi.fn(),
    onPendingChange: vi.fn(),
    onReady: vi.fn(),
    onTransferFailure,
    prepareWindowBlockAdoption: current.runtime.prepareWindowBlockAdoption,
    retainCompositionSurface: () => current.runtime.retainCompositionSurface(),
    getAcceptedWindowSnapshot: current.runtime.getAcceptedWindowSnapshot,
    requestPreview,
    requestPreviewAtDocumentEnd,
    surface: current.surface,
  };
  const visual = () => (
    <WindowedImmersiveVisualEditor
      referenceLabelCaseFoldProfile={14}
      {...props}
      editMap={fixture.getSnapshot().editMap}
      previewSnapshot={fixture.getSnapshot()}
      previewStatus={fixture.getStatus()}
      pending={fixture.getStatus() !== "ready"}
      acceptedWindowSnapshotGeneration={fixture.getGeneration()}
    />
  );
  let view: RenderResult | null = render(visual());
  fixture.setUpdateVisual(() =>
    queueMicrotask(() => {
      if (view) view.rerender(visual());
    }),
  );
  try {
    current.surface.tabIndex = 0;
    current.surface.focus();
    const code = current.surface.querySelector(
      '[data-easymde-visual-block-id="b1"] > code',
    );
    const text = code?.firstChild;
    if (!(code instanceof HTMLElement) || !(text instanceof Text))
      throw new Error("code-delete-initial-consumer-prerequisite-missing");
    window.getSelection()?.collapse(text, 1);
    act(() => {
      const before = new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        inputType: "insertText",
        data: "Z",
      });
      const target = document.createRange();
      target.setStart(text, 1);
      target.collapse(true);
      Object.defineProperty(before, "getTargetRanges", {
        value: () => [target],
      });
      current.surface.dispatchEvent(before);
      if (!before.defaultPrevented) {
        text.insertData(1, "Z");
        window.getSelection()?.collapse(text, 2);
        current.surface.dispatchEvent(
          new InputEvent("input", {
            bubbles: true,
            inputType: "insertText",
            data: "Z",
          }),
        );
      }
    });
    const typed = initialMarkdown.replace(fence, "~~~ruby\nAZC\n~~~");
    const bodyStart = initialMarkdown.indexOf(fence) + "~~~ruby\n".length;
    expect(documentOwner.getValue()).toBe(typed);
    expect(code.textContent).toBe("AZC\n");
    expect(documentOwner.getSelection()).toEqual({
      direction: "none",
      start: bodyStart + 2,
      end: bodyStart + 2,
    });
    expect(fixture.onFailure.mock.calls).toEqual([]);
    // Ordinary source/Preview cadence requests the actual committed source,
    // not a synthetic history transaction or a manually installed code node.
    act(() => requestPreview(documentOwner.getValue()));
    await act(async () => {
      for (const [index, response] of current.responses.entries()) {
        const requested = requests[index];
        if (!requested) throw new Error("code-delete-formal-request-missing");
        response.resolve(
          gapLeasePreview(requested.markdown, requested.signature),
        );
      }
    });
    await fixture.settle();
    expect(fixture.getStatus()).toBe("ready");
    expect(documentOwner.getValue()).toBe(typed);
    const acceptedCode = current.surface.querySelector(
      "pre > code.language-ruby",
    );
    const native = window.getSelection();
    expect(acceptedCode).toBeInstanceOf(HTMLElement);
    expect(native?.anchorNode?.isConnected).toBe(true);
    expect(
      Boolean(native?.anchorNode && acceptedCode?.contains(native.anchorNode)),
      "formal acceptance must preserve the real CODE caret before deletion; never reset it in the test",
    ).toBe(true);
    if (!(acceptedCode instanceof HTMLElement) || !native?.anchorNode)
      throw new Error("code-delete-accepted-caret-unavailable");
    const prefix = document.createRange();
    prefix.selectNodeContents(acceptedCode);
    prefix.setEnd(native.anchorNode, native.anchorOffset);
    expect(prefix.toString().length).toBe(2);
    act(() => {
      const key = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Backspace",
      });
      current.surface.dispatchEvent(key);
      if (key.defaultPrevented) return;
      const selected = window.getSelection();
      const target = selected?.rangeCount
        ? selected.getRangeAt(0).cloneRange()
        : null;
      if (
        !target ||
        !(target.startContainer instanceof Text) ||
        target.startOffset < 1
      )
        throw new Error("code-delete-native-backspace-range-unavailable");
      target.setStart(target.startContainer, target.startOffset - 1);
      const before = new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        inputType: "deleteContentBackward",
      });
      Object.defineProperty(before, "getTargetRanges", {
        value: () => [target.cloneRange()],
      });
      current.surface.dispatchEvent(before);
      if (!before.defaultPrevented) {
        target.deleteContents();
        selected?.collapse(target.startContainer, target.startOffset);
        current.surface.dispatchEvent(
          new InputEvent("input", {
            bubbles: true,
            inputType: "deleteContentBackward",
          }),
        );
      }
    });
    expect(documentOwner.getValue()).toBe(initialMarkdown);
    expect(acceptedCode.textContent).toBe("AC\n");
    expect(documentOwner.getSelection()).toEqual({
      direction: "none",
      start: bodyStart + 1,
      end: bodyStart + 1,
    });
    expect(window.getSelection()?.anchorNode?.isConnected).toBe(true);
    expect(
      Boolean(
        window.getSelection()?.anchorNode &&
        acceptedCode.contains(window.getSelection()?.anchorNode ?? null),
      ),
    ).toBe(true);
    const restoredNative = window.getSelection();
    if (!restoredNative?.anchorNode)
      throw new Error("code-delete-restored-native-caret-unavailable");
    const restoredPrefix = document.createRange();
    restoredPrefix.selectNodeContents(acceptedCode);
    restoredPrefix.setEnd(
      restoredNative.anchorNode,
      restoredNative.anchorOffset,
    );
    expect(
      restoredPrefix.toString().length,
      "deletion must preserve semantic CODE offset 1, not jump to the code-block start",
    ).toBe(1);
    expect(fixture.onFailure).not.toHaveBeenCalled();
    expect(fixture.onDiagnostic).not.toHaveBeenCalled();
    expect(onTransferFailure).not.toHaveBeenCalled();
  } finally {
    fixture.setUpdateVisual(null);
    view?.unmount();
    view = null;
    current.unmount();
    fixture.cleanup();
  }
});

it("test-first v3 local PRE to P keeps its source certificate and native heading-tail edits through real window redistribution", async () => {
  const targetIndex = 160;
  const fence = "~~~bash\nAB\n~~~";
  const initialMarkdown = Array.from({ length: 320 }, (_, index) =>
    index === targetIndex - 1
      ? "### Before"
      : index === targetIndex
        ? fence
        : index === targetIndex + 1
          ? "### After"
          : index === targetIndex + 2
            ? "~~~python\nNEIGHBOR\n~~~"
            : `Paragraph ${index}`,
  ).join("\n\n");
  const initial = gapLeasePreview(initialMarkdown, "v3-redistribution-initial");
  const source = markdownDocumentSource(initialMarkdown);
  const getRevision = source.owner.getRevision;
  if (!getRevision)
    throw new Error("v3-redistribution-source-revision-unavailable");
  const geometry = installSequenceGeometry();
  let view: RenderResult | null = null;
  let runtime: PreviewSurfaceRuntime | null = null;
  let status: PreviewSurfaceStatus = "ready";
  let pending = false;
  let generation = 0;
  let acceptedKey: number | null = null;
  let disposed = false;
  let snapshot: Readonly<{
    editMap: PreviewEditMap;
    revision: number;
    signature: string;
  }> = {
    editMap: initial.editMap,
    revision: 1,
    signature: initial.editMap.signature,
  };
  const onFailure = vi.fn();
  const onDiagnostic = vi.fn();
  const onTransferFailure = vi.fn();
  const adoptionReads: Array<{
    node: HTMLElement;
    value: string;
    revision: number;
    accepted: boolean;
  }> = [];
  const rootRerender = () => {
    if (!view || disposed) return;
    queueMicrotask(() => {
      if (view && !disposed) {
        current.rerender();
        view.rerender(visual());
      }
    });
  };
  // setup rereads this same options object's sourceRevision on rerender.
  // This is the real CM revision delivered as Root delivers that prop, not
  // a fabricated Preview generation or an accepted DOM echo.
  const options = {
    contentEditable: true,
    windowed: true,
    sourceRevision: getRevision(),
    initialHtml: initial.html,
    initialEditMap: initial.editMap,
    initialSignature: initial.editMap.signature,
    currentSourceSnapshot: () => ({
      value: source.owner.getValue(),
      revision: getRevision(),
    }),
    scrollPort: createBrowserPreviewScroll(),
    onDiagnostic,
    onWindowReady: () => {
      const accepted = runtime?.getAcceptedWindowSnapshot();
      // Root publishes a generation only when its genuine certificate can
      // be read. Incrementing unconditionally would hide this regression.
      if (accepted && accepted.key !== acceptedKey) {
        acceptedKey = accepted.key;
        generation += 1;
        rootRerender();
      }
    },
    onSnapshotReady: (
      _html: SafePreviewHtml,
      signature: string,
      editMap: PreviewEditMap | null,
    ) => {
      if (!editMap) throw new Error("v3-redistribution-formal-map-missing");
      snapshot = { editMap, signature, revision: snapshot.revision + 1 };
      rootRerender();
    },
    onStatusChange: (next: PreviewSurfaceStatus) => {
      status = next;
      rootRerender();
    },
    stagingScheduler: { now: () => 0, yield: () => Promise.resolve() },
  };
  const current = setup(options);
  runtime = current.runtime;
  geometry.attach(current.canvas, current.surface);
  Object.defineProperty(current.canvas, "clientHeight", {
    configurable: true,
    value: 240,
  });
  current.canvas.scrollTop = targetIndex * 24 - 48;
  current.canvas.dispatchEvent(new Event("scroll"));
  const requests: Array<{ markdown: string; signature: string }> = [];
  let resolvedResponses = 0;
  const requestPreview = (markdown: string) => {
    const signature = `v3-redistribution-${requests.length + 1}`;
    requests.push({ markdown, signature });
    current.session.schedule(request(markdown, signature), true);
    return signature;
  };
  const requestPreviewAtDocumentEnd = (
    markdown: string,
    selection?: Readonly<{ end: number; start: number }>,
  ) => {
    const pin = current.runtime.prepareDocumentEndWindowPin(
      `v3-redistribution-${requests.length + 1}`,
      selection,
    );
    try {
      return { signature: requestPreview(markdown), release: pin.release };
    } catch (error) {
      pin.release();
      throw error;
    }
  };
  const props = {
    documentSession: source.session,
    imagePasteUploadEnabled: false,
    imageUploadEnabled: false,
    onCanonicalDocumentChange: vi.fn(),
    onDiagnostic,
    onDispose: vi.fn(),
    onFailure,
    onMarkdownChange: rootRerender,
    onPendingChange: (next: boolean) => {
      pending = next;
      rootRerender();
    },
    onReady: vi.fn(),
    onTransferFailure,
    prepareWindowBlockAdoption: (node: HTMLElement) => {
      const finalize = current.runtime.prepareWindowBlockAdoption(node);
      if (!finalize) return null;
      return () => {
        const value = source.owner.getValue();
        const revision = getRevision();
        const accepted = finalize();
        adoptionReads.push({ node, value, revision, accepted });
        return accepted;
      };
    },
    retainCompositionSurface: () => current.runtime.retainCompositionSurface(),
    getAcceptedWindowSnapshot: current.runtime.getAcceptedWindowSnapshot,
    requestPreview,
    requestPreviewAtDocumentEnd,
    surface: current.surface,
  };
  const visual = () => (
    <WindowedImmersiveVisualEditor
      referenceLabelCaseFoldProfile={14}
      {...props}
      pending={pending}
      previewStatus={status}
      editMap={snapshot.editMap}
      previewSnapshot={snapshot}
      acceptedWindowSnapshotGeneration={generation}
    />
  );
  let deliveredRevision = getRevision();
  const unsubscribe = source.owner.subscribe(() => {
    const revision = getRevision();
    if (revision === deliveredRevision) return;
    deliveredRevision = revision;
    options.sourceRevision = revision;
    rootRerender();
  });
  const frames = async (count = 8) => {
    await act(async () => {
      for (let turn = 0; turn < 16; turn += 1) await Promise.resolve();
      await flushAnimationFrames(count);
    });
  };
  const acceptActualRequests = async () => {
    await act(async () => {
      while (resolvedResponses < current.responses.length) {
        const index = resolvedResponses++;
        const requested = requests[index];
        const response = current.responses[index];
        if (!requested || !response)
          throw new Error("v3-redistribution-request-response-mismatch");
        response.resolve(
          gapLeasePreview(requested.markdown, requested.signature),
        );
      }
    });
    await frames();
  };
  try {
    await frames();
    expect(
      current.runtime.getAcceptedWindowSnapshot(),
      "valid initial formal content prerequisite",
    ).not.toBeNull();
    view = render(visual());
    current.surface.tabIndex = 0;
    current.surface.focus();
    const code = current.surface.querySelector(
      `[data-easymde-visual-block-id="b${targetIndex}"] > code`,
    );
    if (!(code instanceof HTMLElement))
      throw new Error("v3-redistribution-mounted-code-missing");
    act(() => {
      const range = document.createRange();
      range.selectNodeContents(code);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
      const before = new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        inputType: "deleteContentBackward",
      });
      Object.defineProperty(before, "getTargetRanges", {
        value: () => [range.cloneRange()],
      });
      current.surface.dispatchEvent(before);
      if (!before.defaultPrevented) {
        range.deleteContents();
        window.getSelection()?.collapse(code, 0);
        current.surface.dispatchEvent(
          new InputEvent("input", {
            bubbles: true,
            inputType: "deleteContentBackward",
          }),
        );
      }
    });
    expect(source.owner.getValue()).toBe(
      initialMarkdown.replace(fence, "~~~bash\n\n~~~"),
    );
    act(() =>
      current.surface.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "Backspace",
        }),
      ),
    );
    const gap = current.surface.querySelector(
      `[data-easymde-visual-block-id="b${targetIndex}"]`,
    );
    if (!(gap instanceof HTMLParagraphElement))
      throw new Error("v3-redistribution-real-local-exit-missing");
    expect(gap.firstChild).toBeInstanceOf(HTMLBRElement);
    const exited = initialMarkdown.replace(fence, "");
    expect(source.owner.getValue()).toBe(exited);
    expect(onFailure.mock.calls).toEqual([]);
    const localExitRead = adoptionReads.find((entry) => entry.node === gap);
    expect(localExitRead?.accepted).toBe(true);
    const canonicalBeforeRedistribution = {
      value: source.owner.getValue(),
      revision: getRevision(),
      history: source.owner.getHistoryState(),
    };
    const nodesBeforeRedistribution = Array.from(current.surface.childNodes);
    // Real viewport demand plus the PRE72 -> P24 geometry change lets the
    // actual owner redistribute rows/spacers. Never edit children ourselves,
    // and do not request/accept a formal response to repair the baseline.
    act(() => {
      current.canvas.scrollTop += 1;
      current.canvas.dispatchEvent(new Event("scroll"));
    });
    await frames(12);
    expect(
      Array.from(current.surface.childNodes),
      "real Owner must have committed a different bounded window",
    ).not.toEqual(nodesBeforeRedistribution);
    expect(gap.isConnected).toBe(true);
    expect(window.getSelection()?.anchorNode).toBe(gap);
    expect({
      value: source.owner.getValue(),
      revision: getRevision(),
      history: source.owner.getHistoryState(),
    }).toEqual(canonicalBeforeRedistribution);
    expect(status).toBe("ready");
    expect(options.sourceRevision).toBe(getRevision());
    const installed = current.runtime.getAcceptedWindowSnapshot();
    expect
      .soft(
        installed,
        "local canonical exit and actual redistributed nodes must share a readable genuine source certificate before extra Backspace",
      )
      .not.toBeNull();
    expect.soft(installed?.sourceRevision).toBe(getRevision());
    expect
      .soft(installed?.nodes)
      .toEqual(Array.from(current.surface.childNodes));
    act(() =>
      current.surface.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "Backspace",
        }),
      ),
    );
    const heading = Array.from(current.surface.querySelectorAll("h3")).find(
      (node) => node.textContent === "Before",
    );
    const headingText = heading?.firstChild;
    if (!(heading instanceof HTMLElement) || !(headingText instanceof Text))
      throw new Error("v3-redistribution-surviving-heading-missing");
    const headingTail = exited.indexOf("### Before") + "### Before".length;
    expect.soft(source.owner.getValue()).toBe(exited);
    expect
      .soft(source.owner.getSelection())
      .toEqual({ direction: "none", start: headingTail, end: headingTail });
    expect.soft(window.getSelection()?.anchorNode).toBe(headingText);
    expect.soft(window.getSelection()?.anchorOffset).toBe(headingText.length);
    await acceptActualRequests();
    // The user's separate manual heading-tail action must remain testable
    // even when the preceding extra-deletion assertions have already failed.
    act(() => {
      heading.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      window.getSelection()?.collapse(headingText, headingText.length);
      current.surface.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "Enter",
        }),
      );
    });
    for (const [index, data] of ["a", "b", "c"].entries()) {
      act(() => {
        const native = window.getSelection();
        const range = native?.rangeCount
          ? native.getRangeAt(0).cloneRange()
          : null;
        if (!range)
          throw new Error("v3-redistribution-native-insertion-range-missing");
        const before = new InputEvent("beforeinput", {
          bubbles: true,
          cancelable: true,
          inputType: "insertText",
          data,
        });
        Object.defineProperty(before, "getTargetRanges", {
          value: () => [range.cloneRange()],
        });
        current.surface.dispatchEvent(before);
        if (!before.defaultPrevented) {
          const text = document.createTextNode(data);
          range.insertNode(text);
          native?.collapse(text, text.length);
          current.surface.dispatchEvent(
            new InputEvent("input", {
              bubbles: true,
              inputType: "insertText",
              data,
            }),
          );
        }
      });
      const draft = "abc".slice(0, index + 1);
      const insertion = headingTail + 2;
      expect
        .soft(source.owner.getValue())
        .toBe(exited.slice(0, insertion) + draft + exited.slice(insertion));
      expect.soft(source.owner.getSelection()).toEqual({
        direction: "none",
        start: insertion + draft.length,
        end: insertion + draft.length,
      });
    }
    await acceptActualRequests();
    expect.soft(onFailure).not.toHaveBeenCalled();
    expect.soft(onDiagnostic).not.toHaveBeenCalled();
    expect.soft(onTransferFailure).not.toHaveBeenCalled();
    expect.soft(current.surface.getAttribute("contenteditable")).toBe("true");
  } finally {
    disposed = true;
    unsubscribe();
    view?.unmount();
    current.unmount();
    source.owner.destroy();
    source.container.remove();
    source.submissionField.remove();
    geometry.restore();
  }
});

it("test-first v4 advanced but unapplied Windowed candidate cannot raw-replay over the live enhanced draft when superseded", async () => {
  // Observe the real Owner -> Sink boundary without replacing any commit,
  // callback, gate or supplied revision. The original Sink still owns its DOM.
  const sinkModule = await import("./SafePreviewHtmlSink");
  const OriginalSink = sinkModule.SafePreviewHtmlSink;
  const sinkInputs: Array<{
    phase: string | undefined;
    html: SafePreviewHtml | null;
    revision: number | undefined;
    commit: boolean;
    held: boolean;
  }> = [];
  const sinkObserver = vi
    .spyOn(sinkModule, "SafePreviewHtmlSink")
    .mockImplementation((props) => {
      sinkInputs.push({
        phase: props.phase,
        html: props.html,
        revision: props.htmlRevision,
        commit: Boolean(
          props.stagedCommit || props.windowedCommit || props.materializeCommit,
        ),
        held: props.compositionGate?.isHeld() ?? false,
      });
      return createElement(OriginalSink, props);
    });
  const initialMarkdown = Array.from({ length: 320 }, (_, index) =>
    index === 0
      ? "Draft AC"
      : index === 1
        ? "~~~python\nprint(1)\n~~~"
        : `Paragraph ${index}`,
  ).join("\n\n");
  const initial = gapLeasePreview(initialMarkdown, "v4-applied-A");
  const source = markdownDocumentSource(initialMarkdown);
  const getRevision = source.owner.getRevision;
  if (!getRevision) throw new Error("v4-SETUP-canonical-revision-unavailable");
  const geometry = installSequenceGeometry();
  const bEnhancement = deferred<void>();
  const enhancedTokens: HTMLElement[] = [];
  const onFailure = vi.fn();
  const onDiagnostic = vi.fn();
  const onTransferFailure = vi.fn();
  const readySignatures: string[] = [];
  let view: RenderResult | null = null;
  let disposed = false;
  let status: PreviewSurfaceStatus = "ready";
  let pending = false;
  let generation = 0;
  let acceptedKey: number | null = null;
  let snapshot: Readonly<{
    editMap: PreviewEditMap;
    revision: number;
    signature: string;
  }> = {
    editMap: initial.editMap,
    revision: 1,
    signature: initial.editMap.signature,
  };
  const rootRerender = () => {
    if (!view || disposed) return;
    queueMicrotask(() => {
      if (view && !disposed) {
        current.rerender();
        view.rerender(visual());
      }
    });
  };
  const options = {
    contentEditable: true,
    windowed: true,
    sourceRevision: getRevision(),
    initialHtml: initial.html,
    initialEditMap: initial.editMap,
    initialSignature: initial.editMap.signature,
    currentSourceSnapshot: () => ({
      value: source.owner.getValue(),
      revision: getRevision(),
    }),
    scrollPort: createBrowserPreviewScroll(),
    onDiagnostic,
    // This port performs a real detached-DOM enhancement. Raw server HTML
    // has neither this token subtree nor the enhanced frame background.
    enhance: async (candidate: HTMLElement) => {
      const code = candidate.querySelector("pre > code.language-python");
      if (
        !(code instanceof HTMLElement) ||
        !(code.parentElement instanceof HTMLElement)
      )
        throw new Error("v4-SETUP-enhancement-code-missing");
      const token = document.createElement("span");
      token.className = "hljs-built_in";
      token.textContent = code.textContent;
      code.classList.add("hljs");
      code.replaceChildren(token);
      code.parentElement.style.setProperty(
        "--easymde-code-block-bg",
        "#282c34",
      );
      enhancedTokens.push(token);
      if (enhancedTokens.length === 2) await bEnhancement.promise;
    },
    onWindowReady: () => {
      const accepted = current.runtime.getAcceptedWindowSnapshot();
      if (accepted && accepted.key !== acceptedKey) {
        acceptedKey = accepted.key;
        generation += 1;
        rootRerender();
      }
    },
    onSnapshotReady: (
      _html: SafePreviewHtml,
      signature: string,
      editMap: PreviewEditMap | null,
    ) => {
      if (!editMap) throw new Error("v4-SETUP-formal-map-missing");
      readySignatures.push(signature);
      snapshot = { editMap, signature, revision: snapshot.revision + 1 };
      rootRerender();
    },
    onStatusChange: (next: PreviewSurfaceStatus) => {
      status = next;
      rootRerender();
    },
    stagingScheduler: { now: () => 0, yield: () => Promise.resolve() },
  };
  const current = setup(options);
  geometry.attach(current.canvas, current.surface);
  Object.defineProperty(current.canvas, "clientHeight", {
    configurable: true,
    value: 240,
  });
  const requests: Array<{ markdown: string; signature: string }> = [];
  const requestPreview = (markdown: string) => {
    const signature = `v4-refresh-${requests.length + 1}`;
    requests.push({ markdown, signature });
    current.session.schedule(request(markdown, signature), true);
    return signature;
  };
  const requestPreviewAtDocumentEnd = (
    markdown: string,
    selection?: Readonly<{ end: number; start: number }>,
  ) => {
    const pin = current.runtime.prepareDocumentEndWindowPin(
      `v4-refresh-${requests.length + 1}`,
      selection,
    );
    try {
      return { signature: requestPreview(markdown), release: pin.release };
    } catch (error) {
      pin.release();
      throw error;
    }
  };
  const props = {
    documentSession: source.session,
    imagePasteUploadEnabled: false,
    imageUploadEnabled: false,
    onCanonicalDocumentChange: vi.fn(),
    onDiagnostic,
    onDispose: vi.fn(),
    onFailure,
    onMarkdownChange: rootRerender,
    onPendingChange: (next: boolean) => {
      pending = next;
      rootRerender();
    },
    onReady: vi.fn(),
    onTransferFailure,
    prepareWindowBlockAdoption: current.runtime.prepareWindowBlockAdoption,
    retainCompositionSurface: () => current.runtime.retainCompositionSurface(),
    getAcceptedWindowSnapshot: current.runtime.getAcceptedWindowSnapshot,
    requestPreview,
    requestPreviewAtDocumentEnd,
    surface: current.surface,
  };
  const visual = () => (
    <WindowedImmersiveVisualEditor
      referenceLabelCaseFoldProfile={14}
      {...props}
      pending={pending}
      previewStatus={status}
      editMap={snapshot.editMap}
      previewSnapshot={snapshot}
      acceptedWindowSnapshotGeneration={generation}
    />
  );
  let deliveredRevision = getRevision();
  const unsubscribe = source.owner.subscribe(() => {
    const revision = getRevision();
    if (revision === deliveredRevision) return;
    deliveredRevision = revision;
    options.sourceRevision = revision;
    rootRerender();
  });
  const frames = async (count = 4) => {
    await act(async () => {
      await flushAnimationFrames(count);
    });
  };
  const canonical = () => ({
    value: source.owner.getValue(),
    revision: getRevision(),
    selection: source.owner.getSelection(),
    history: source.owner.getHistoryState(),
  });
  let mutationObserver: MutationObserver | null = null;
  let restoreInnerHtml: (() => void) | null = null;
  try {
    await frames();
    const applied = current.runtime.getAcceptedWindowSnapshot();
    expect(
      applied,
      "v4 SETUP: A must be a genuinely installed, source-certified window",
    ).not.toBeNull();
    expect(applied?.sourceRevision).toBe(getRevision());
    expect(applied?.nodes).toEqual(Array.from(current.surface.childNodes));
    const aInput = sinkInputs
      .slice()
      .reverse()
      .find((input) => input.phase === "ready" && input.commit);
    if (!aInput || undefined === aInput.revision)
      throw new Error("v4-SETUP-installed-A-sink-revision-missing");
    view = render(visual());
    current.surface.tabIndex = 0;
    current.surface.focus();
    const draft = current.surface.querySelector(
      '[data-easymde-visual-block-id="b0"]',
    );
    const draftText = draft?.firstChild;
    const aToken = enhancedTokens[0];
    const aCode = aToken?.parentElement;
    const aFrame = aCode?.parentElement;
    if (
      !(draft instanceof HTMLParagraphElement) ||
      !(draftText instanceof Text) ||
      !aToken ||
      !aCode ||
      !aFrame
    )
      throw new Error("v4-SETUP-live-A-nodes-missing");
    expect(current.surface.contains(aToken)).toBe(true);
    window.getSelection()?.collapse(draftText, "Draft A".length);
    for (const [index, data] of ["a", "b", "c"].entries()) {
      act(() => {
        const native = window.getSelection();
        const range = native?.rangeCount
          ? native.getRangeAt(0).cloneRange()
          : null;
        if (!range) throw new Error("v4-SETUP-native-draft-range-missing");
        const before = new InputEvent("beforeinput", {
          bubbles: true,
          cancelable: true,
          inputType: "insertText",
          data,
        });
        Object.defineProperty(before, "getTargetRanges", {
          value: () => [range.cloneRange()],
        });
        current.surface.dispatchEvent(before);
        if (!before.defaultPrevented) {
          if (!(range.startContainer instanceof Text))
            throw new Error("v4-SETUP-native-text-insertion-missing");
          range.startContainer.insertData(range.startOffset, data);
          native?.collapse(range.startContainer, range.startOffset + 1);
          current.surface.dispatchEvent(
            new InputEvent("input", {
              bubbles: true,
              inputType: "insertText",
              data,
            }),
          );
        }
      });
      expect(source.owner.getValue()).toBe(
        initialMarkdown.replace(
          "Draft AC",
          `Draft A${"abc".slice(0, index + 1)}C`,
        ),
      );
      expect(draft.textContent).toBe(`Draft A${"abc".slice(0, index + 1)}C`);
      expect(window.getSelection()?.anchorNode).toBe(draftText);
      expect(window.getSelection()?.anchorOffset).toBe(
        "Draft A".length + index + 1,
      );
    }
    await frames(1);
    expect(onFailure).not.toHaveBeenCalled();
    expect(onDiagnostic).not.toHaveBeenCalled();
    const beforeRequests = canonical();
    const aNodes = Array.from(current.surface.childNodes);
    const caretOffset = "Draft Aabc".length;
    const observations: Array<{
      phase: string | null;
      sameNodes: boolean;
      draft: boolean;
      highlighted: boolean;
      background: boolean;
      caret: boolean;
      canonical: boolean;
    }> = [];
    const observe = () => {
      const native = window.getSelection();
      const nodes = Array.from(current.surface.childNodes);
      observations.push({
        phase: current.surface.getAttribute("data-easymde-preview-phase"),
        sameNodes:
          nodes.length === aNodes.length &&
          nodes.every((node, index) => node === aNodes[index]),
        draft:
          current.surface.contains(draftText) &&
          draft.textContent === "Draft AabcC",
        highlighted:
          current.surface.contains(aToken) &&
          aToken.parentElement === aCode &&
          aCode.classList.contains("hljs"),
        background:
          current.surface.contains(aFrame) &&
          aFrame.style.getPropertyValue("--easymde-code-block-bg") ===
            "#282c34",
        caret:
          native?.anchorNode === draftText &&
          native.focusNode === draftText &&
          native.anchorOffset === caretOffset &&
          native.focusOffset === caretOffset,
        canonical:
          JSON.stringify(canonical()) === JSON.stringify(beforeRequests),
      });
    };
    mutationObserver = new MutationObserver(observe);
    mutationObserver.observe(current.surface, {
      attributes: true,
      childList: true,
      characterData: true,
      subtree: true,
    });
    observe();
    // Forward the browser's actual setter, recording only writes to the real
    // live surface. This proves a raw replay, rather than inferring one from
    // a final screenshot or replacing the Sink's commit implementation.
    const nativeSetter = Object.getOwnPropertyDescriptor(
      Element.prototype,
      "innerHTML",
    )?.set;
    if (!nativeSetter)
      throw new Error("v4-SETUP-native-innerHTML-setter-missing");
    const rawWrites: Array<{
      phase: string | null;
      incomingRevision: number | undefined;
      matchesB: boolean;
      stack: string | undefined;
    }> = [];
    let bHtml: SafePreviewHtml | null = null;
    const setterObserver = vi
      .spyOn(Element.prototype, "innerHTML", "set")
      .mockImplementation(function (this: Element, value: string) {
        if (this === current.surface)
          rawWrites.push({
            phase: this.getAttribute("data-easymde-preview-phase"),
            incomingRevision: sinkInputs.at(-1)?.revision,
            matchesB: value === bHtml,
            stack: new Error("v4-observed-native-raw-write").stack,
          });
        nativeSetter.call(this, value);
      });
    restoreInnerHtml = () => setterObserver.mockRestore();
    // A valid refresh of the actual canonical source; B's raw response
    // includes abc, so this is not an illegal stale-source HTML fixture.
    act(() => requestPreview(source.owner.getValue()));
    const bRequest = requests[0];
    const bResponse = current.responses[0];
    if (!bRequest || !bResponse) throw new Error("v4-SETUP-B-request-missing");
    const bFormal = gapLeasePreview(bRequest.markdown, bRequest.signature);
    bHtml = bFormal.html;
    await act(async () => {
      bResponse.resolve(bFormal);
    });
    expect(enhancedTokens).toHaveLength(2);
    expect(current.surface.contains(enhancedTokens[1]!)).toBe(false);
    let cSignature = "";
    await act(async () => {
      bEnhancement.resolve();
      // All remaining staging yields are resolved promises. One task
      // boundary drains that real finite microtask chain while async act
      // still batches React commits. Never flush/install B before C.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      expect(current.surface.contains(enhancedTokens[1]!)).toBe(false);
      expect(Array.from(current.surface.childNodes)).toEqual(aNodes);
      cSignature = requestPreview(source.owner.getValue());
    });
    const cLoading = sinkInputs
      .slice()
      .reverse()
      .find((input) => input.phase === "loading");
    // This setup witness must fail rather than claim coverage if timing
    // merely retained A's revision or installed B before supersession.
    expect(
      cLoading,
      "v4 SETUP: genuine C loading Sink input missing",
    ).toBeDefined();
    expect(
      cLoading?.revision,
      "v4 SETUP: candidate metadata must advance beyond physically applied A",
    ).toBeGreaterThan(aInput.revision);
    expect(
      cLoading?.html,
      "v4 SETUP: B's actual raw response must have reached Owner metadata",
    ).toBe(bFormal.html);
    expect(
      cLoading?.commit,
      "v4 SETUP: superseded B must have no installable Sink commit",
    ).toBe(false);
    expect(
      cLoading?.held,
      "v4 SETUP: no composition lease may mask this branch",
    ).toBe(false);
    console.info(
      "test-first-v4-advanced-unapplied",
      JSON.stringify({
        appliedRevision: aInput.revision,
        incomingRevision: cLoading?.revision,
        phase: cLoading?.phase,
        commit: cLoading?.commit,
        held: cLoading?.held,
        rawWrites: rawWrites.map(({ phase, incomingRevision, matchesB }) => ({
          phase,
          incomingRevision,
          matchesB,
        })),
      }),
    );
    observe();
    for (let frame = 0; frame < 2; frame += 1) {
      await frames(1);
      observe();
    }
    expect(current.responses).toHaveLength(2);
    expect(current.surface.getAttribute("data-easymde-preview-phase")).toBe(
      "loading",
    );
    expect(readySignatures).not.toContain(bRequest.signature);
    expect
      .soft(
        rawWrites,
        "C pending must not execute a raw HTML replay on the live enhanced draft",
      )
      .toEqual([]);
    expect
      .soft(
        observations.filter(
          (row) =>
            !row.sameNodes ||
            !row.draft ||
            !row.highlighted ||
            !row.background ||
            !row.caret ||
            !row.canonical,
        ),
        "every pending mutation/frame must preserve A's actual live nodes, enhancement, native caret and canonical history",
      )
      .toEqual([]);
    expect.soft(canonical()).toEqual(beforeRequests);
    mutationObserver.disconnect();
    mutationObserver = null;
    restoreInnerHtml();
    restoreInnerHtml = null;
    // Completion is real, not a permanently held request or an endpoint-only
    // oracle: C must subsequently install its own current certified frame.
    const cResponse = current.responses[1];
    const cRequest = requests[1];
    if (!cResponse || !cRequest || cRequest.signature !== cSignature)
      throw new Error("v4-SETUP-C-request-missing");
    await act(async () => {
      cResponse.resolve(gapLeasePreview(cRequest.markdown, cRequest.signature));
    });
    await frames();
    const acceptedC = current.runtime.getAcceptedWindowSnapshot();
    expect.soft(acceptedC?.signature).toBe(cSignature);
    expect.soft(acceptedC?.sourceRevision).toBe(getRevision());
    expect
      .soft(acceptedC?.nodes)
      .toEqual(Array.from(current.surface.childNodes));
    expect
      .soft(current.surface.getAttribute("data-easymde-preview-phase"))
      .toBe("ready");
    expect.soft(current.surface.getAttribute("contenteditable")).toBe("true");
    expect
      .soft(
        current.surface.querySelector('[data-easymde-visual-block-id="b0"]')
          ?.textContent,
      )
      .toBe("Draft AabcC");
    expect.soft(canonical()).toEqual(beforeRequests);
    expect
      .soft(readySignatures.filter((signature) => signature === cSignature))
      .toHaveLength(1);
    expect.soft(readySignatures).not.toContain(bRequest.signature);
    expect.soft(onFailure).not.toHaveBeenCalled();
    expect.soft(onDiagnostic).not.toHaveBeenCalled();
    expect.soft(onTransferFailure).not.toHaveBeenCalled();
  } finally {
    disposed = true;
    mutationObserver?.disconnect();
    restoreInnerHtml?.();
    unsubscribe();
    view?.unmount();
    current.unmount();
    source.owner.destroy();
    source.container.remove();
    source.submissionField.remove();
    geometry.restore();
    sinkObserver.mockRestore();
  }
});

it.each([
  { lead: "heading", following: "code", enterCount: 1, adjacency: "blank" },
  {
    lead: "heading",
    following: "paragraph",
    enterCount: 1,
    adjacency: "blank",
  },
  { lead: "heading", following: "code", enterCount: 4, adjacency: "blank" },
  {
    lead: "heading",
    following: "paragraph",
    enterCount: 4,
    adjacency: "blank",
  },
  { lead: "paragraph", following: "code", enterCount: 1, adjacency: "blank" },
  {
    lead: "paragraph",
    following: "paragraph",
    enterCount: 1,
    adjacency: "blank",
  },
  { lead: "paragraph", following: "code", enterCount: 4, adjacency: "blank" },
  {
    lead: "paragraph",
    following: "paragraph",
    enterCount: 4,
    adjacency: "blank",
  },
  { lead: "heading", following: "code", enterCount: 1, adjacency: "tight" },
  {
    lead: "heading",
    following: "paragraph",
    enterCount: 1,
    adjacency: "tight",
  },
  { lead: "heading", following: "code", enterCount: 4, adjacency: "tight" },
  {
    lead: "heading",
    following: "paragraph",
    enterCount: 4,
    adjacency: "tight",
  },
  { lead: "paragraph", following: "code", enterCount: 1, adjacency: "tight" },
  { lead: "paragraph", following: "code", enterCount: 4, adjacency: "tight" },
] as const)(
  "retains a fresh text-tail input line through a formal Windowed rebuild before typing ($lead, $following, $enterCount Enter presses, $adjacency adjacency)",
  async ({ lead, following, enterCount, adjacency }) => {
    const targetIndex = 160;
    const nextSource =
      following === "code"
        ? "~~~typescript\nKEEP\n~~~"
        : "Keep this paragraph.";
    const sourceBlocks = Array.from({ length: 320 }, (_, index) =>
      index === targetIndex - 1
        ? lead === "heading"
          ? "### Topic"
          : "Topic"
        : index === targetIndex
          ? nextSource
          : `Paragraph ${index}`,
    );
    const markdown = sourceBlocks
      .map(
        (source, index) =>
          source +
          (index === sourceBlocks.length - 1
            ? ""
            : index === targetIndex - 1 && adjacency === "tight"
              ? "\n"
              : "\n\n"),
      )
      .join("");
    const fixture = await openWindowedOwner({
      initialMarkdown: markdown,
      flowGeometry: true,
      initialScrollTop: (targetIndex - 2) * 24,
    });
    const { current, documentOwner, documentSession } = fixture;
    const requests: Array<{ markdown: string; signature: string }> = [];
    const requestPreview = (value: string) => {
      const signature = `fresh-heading-${requests.length + 1}`;
      requests.push({ markdown: value, signature });
      current.session.schedule(request(value, signature), true);
      return signature;
    };
    const onTransferFailure = vi.fn();
    const props = {
      documentSession,
      imagePasteUploadEnabled: false,
      imageUploadEnabled: false,
      onCanonicalDocumentChange: vi.fn(),
      onDiagnostic: fixture.onDiagnostic,
      onDispose: vi.fn(),
      onFailure: fixture.onFailure,
      onMarkdownChange: vi.fn(),
      onPendingChange: vi.fn(),
      onReady: vi.fn(),
      onTransferFailure,
      pending: false,
      prepareWindowBlockAdoption: current.runtime.prepareWindowBlockAdoption,
      retainCompositionSurface: () =>
        current.runtime.retainCompositionSurface(),
      getAcceptedWindowSnapshot: current.runtime.getAcceptedWindowSnapshot,
      requestPreview,
      requestPreviewAtDocumentEnd: (
        value: string,
        selection?: Readonly<{ end: number; start: number }>,
      ) => {
        const pin = current.runtime.prepareDocumentEndWindowPin(
          `fresh-heading-${requests.length + 1}`,
          selection,
        );
        try {
          return { signature: requestPreview(value), release: pin.release };
        } catch (error) {
          pin.release();
          throw error;
        }
      },
      surface: current.surface,
    };
    const visual = () => (
      <WindowedImmersiveVisualEditor
        referenceLabelCaseFoldProfile={14}
        {...props}
        acceptedWindowSnapshotGeneration={fixture.getGeneration()}
        editMap={fixture.getSnapshot().editMap}
        previewSnapshot={fixture.getSnapshot()}
        previewStatus={fixture.getStatus()}
      />
    );
    let view: RenderResult | null = render(visual());
    fixture.setUpdateVisual(() =>
      queueMicrotask(() => {
        if (view) view.rerender(visual());
      }),
    );
    try {
      const heading = current.surface.querySelector(
        '[data-easymde-visual-block-id="b159"]',
      );
      const text = heading?.firstChild;
      if (!(heading instanceof HTMLElement) || !(text instanceof Text))
        throw new Error("fresh-heading-not-mounted");
      current.surface.tabIndex = 0;
      current.surface.focus();
      act(() => {
        window.getSelection()?.collapse(text, text.length);
        const key = new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "Enter",
        });
        current.surface.dispatchEvent(key);
        if (!key.defaultPrevented) {
          const target = window.getSelection()?.getRangeAt(0).cloneRange();
          if (!target) throw new Error("fresh-text-tail-enter-range-missing");
          const before = new InputEvent("beforeinput", {
            bubbles: true,
            cancelable: true,
            inputType: "insertParagraph",
          });
          Object.defineProperty(before, "getTargetRanges", {
            value: () => [target],
          });
          current.surface.dispatchEvent(before);
          if (!before.defaultPrevented) {
            const nextParagraph =
              lead === "paragraph"
                ? heading.cloneNode(false)
                : document.createElement("p");
            if (!(nextParagraph instanceof HTMLParagraphElement))
              throw new Error("fresh-native-paragraph-clone-missing");
            nextParagraph.append(document.createElement("br"));
            heading.after(nextParagraph);
            window.getSelection()?.collapse(nextParagraph, 0);
            current.surface.dispatchEvent(
              new InputEvent("input", {
                bubbles: true,
                inputType: "insertParagraph",
              }),
            );
          }
        }
      });
      const paragraph = heading.nextElementSibling;
      expect(paragraph).toBeInstanceOf(HTMLParagraphElement);
      if (!(paragraph instanceof HTMLParagraphElement))
        throw new Error("fresh-heading-input-line-missing");
      expect(paragraph.textContent).toBe("");
      expect(window.getSelection()?.anchorNode).toBe(paragraph);
      for (let count = 1; count < enterCount; count += 1) {
        const previousValue = documentOwner.getValue();
        const previousPoint = documentOwner.getSelection().start;
        await act(async () => {
          const key = new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            key: "Enter",
          });
          current.surface.dispatchEvent(key);
          if (!key.defaultPrevented) {
            const range = window.getSelection()?.getRangeAt(0).cloneRange();
            if (!range) throw new Error("fresh-gap-enter-range-missing");
            const before = new InputEvent("beforeinput", {
              bubbles: true,
              cancelable: true,
              inputType: "insertParagraph",
            });
            Object.defineProperty(before, "getTargetRanges", {
              value: () => [range],
            });
            current.surface.dispatchEvent(before);
            if (!before.defaultPrevented) {
              const native = window.getSelection();
              const anchor = native?.anchorNode;
              const parent =
                anchor instanceof Element ? anchor : anchor?.parentElement;
              const activeParagraph = parent?.closest("p");
              if (!activeParagraph)
                throw new Error("fresh-gap-enter-paragraph-missing");
              const nextParagraph = activeParagraph.cloneNode(false);
              if (!(nextParagraph instanceof HTMLParagraphElement))
                throw new Error("fresh-native-gap-clone-missing");
              nextParagraph.append(document.createElement("br"));
              activeParagraph.after(nextParagraph);
              native?.collapse(nextParagraph, 0);
              current.surface.dispatchEvent(
                new InputEvent("input", {
                  bubbles: true,
                  inputType: "insertParagraph",
                }),
              );
            }
          }
          for (let turn = 0; turn < 16; turn += 1) await Promise.resolve();
        });
        // A claimed Enter must advance the real source position, not merely
        // cancel a key or leave the next character at the following row.
        expect(documentOwner.getValue().replace(/\n/g, "")).toBe(
          previousValue.replace(/\n/g, ""),
        );
        expect(documentOwner.getValue().length).toBeGreaterThan(
          previousValue.length,
        );
        expect(documentOwner.getSelection().start).toBeGreaterThan(
          previousPoint,
        );
        const native = window.getSelection();
        const anchor = native?.anchorNode;
        const parent =
          anchor instanceof Element ? anchor : anchor?.parentElement;
        const activeParagraph = parent?.closest("p");
        if (!activeParagraph || !anchor)
          throw new Error("fresh-gap-native-line-missing");
        expect(activeParagraph.textContent?.trim()).toBe("");
        let precedingLines = 0;
        for (
          let node = heading.nextElementSibling;
          node && node !== activeParagraph;
          node = node.nextElementSibling
        ) {
          if (
            !(node instanceof HTMLParagraphElement) ||
            node.textContent?.trim()
          )
            throw new Error("fresh-gap-caret-crossed-next-block");
          precedingLines += 1;
        }
        const prefix = document.createRange();
        prefix.selectNodeContents(activeParagraph);
        prefix.setEnd(anchor, native?.anchorOffset ?? 0);
        const fragment = prefix.cloneContents();
        const inlineLines =
          (fragment.textContent?.match(/\n/g) ?? []).length +
          fragment.querySelectorAll("br").length;
        expect(
          precedingLines + inlineLines,
          "each Enter advances the native caret to a newly created input line",
        ).toBeGreaterThanOrEqual(count);
        expect(fixture.onFailure).not.toHaveBeenCalled();
      }
      const requested = requests.at(-1);
      const response = current.responses.at(-1);
      if (!requested || !response)
        throw new Error("fresh-heading-formal-request-missing");
      // Do not type before accepting the response: typing would make the gap
      // a regular rendered paragraph and bypass the disappearing-empty-line bug.
      await act(async () => {
        response.resolve(
          gapLeasePreview(requested.markdown, requested.signature),
        );
      });
      await fixture.settle();
      const restoredHeading = current.surface.querySelector(
        '[data-easymde-visual-block-id="b159"]',
      );
      const restoredParagraph = restoredHeading?.nextElementSibling;
      expect(restoredParagraph).toBeInstanceOf(HTMLParagraphElement);
      if (!(restoredParagraph instanceof HTMLParagraphElement))
        throw new Error("fresh-heading-input-line-lost");
      expect(restoredParagraph.textContent?.trim()).toBe("");
      const native = window.getSelection();
      expect(
        native?.anchorNode &&
          (native.anchorNode === restoredParagraph ||
            restoredParagraph.contains(native.anchorNode)),
      ).toBe(true);
      const nextRoot = restoredParagraph.nextElementSibling;
      expect(nextRoot?.getAttribute("data-easymde-visual-block-id")).toBe(
        "b160",
      );
      const beforeTyping = documentOwner.getValue();
      const insertion = beforeTyping.indexOf(nextSource);
      expect(insertion).toBeGreaterThan(0);
      expect(documentOwner.getSelection().start).toBe(insertion);
      act(() => {
        const range = window.getSelection()?.getRangeAt(0).cloneRange();
        if (!range) throw new Error("fresh-heading-typing-range-missing");
        const before = new InputEvent("beforeinput", {
          bubbles: true,
          cancelable: true,
          inputType: "insertText",
          data: "Z",
        });
        Object.defineProperty(before, "getTargetRanges", {
          value: () => [range],
        });
        current.surface.dispatchEvent(before);
        if (!before.defaultPrevented) {
          const inserted = document.createTextNode("Z");
          range.insertNode(inserted);
          window.getSelection()?.collapse(inserted, 1);
          current.surface.dispatchEvent(
            new InputEvent("input", {
              bubbles: true,
              inputType: "insertText",
              data: "Z",
            }),
          );
        }
      });
      const leading =
        lead === "paragraph" &&
        !beforeTyping.slice(0, insertion).endsWith("\n\n")
          ? "\n"
          : "";
      expect(documentOwner.getValue()).toBe(
        beforeTyping.slice(0, insertion) +
          leading +
          "Z\n\n" +
          beforeTyping.slice(insertion),
      );
      expect(documentOwner.getSelection()).toEqual({
        direction: "none",
        start: insertion + leading.length + 1,
        end: insertion + leading.length + 1,
      });
      expect(restoredParagraph.textContent?.trim()).toBe("Z");
      expect(restoredParagraph.nextElementSibling).toBe(nextRoot);
      expect(nextRoot?.textContent).toBe(
        following === "code" ? "KEEP\n" : nextSource,
      );
      expect(fixture.onFailure).not.toHaveBeenCalled();
      expect(fixture.onDiagnostic).not.toHaveBeenCalled();
      expect(onTransferFailure).not.toHaveBeenCalled();
    } finally {
      fixture.setUpdateVisual(null);
      view?.unmount();
      view = null;
      current.unmount();
      fixture.cleanup();
    }
  },
);

it.each([
  { input: "~~~", shortcut: true, neighbor: "heading" },
  { input: "```", shortcut: true, neighbor: "heading" },
  { input: "~~~bash", shortcut: false, neighbor: "heading" },
  { input: "```bash", shortcut: false, neighbor: "heading" },
  { input: "~~~", shortcut: true, neighbor: "paragraph" },
  { input: "```", shortcut: true, neighbor: "paragraph" },
  { input: "~~~bash", shortcut: false, neighbor: "paragraph" },
  { input: "```bash", shortcut: false, neighbor: "paragraph" },
  {
    input: "~~~bash",
    shortcut: false,
    neighbor: "paragraph",
    acceptAfter: "each",
  },
  { input: "~~~bash", shortcut: false, neighbor: "paragraph", acceptAfter: 3 },
  { input: "~~~bash", shortcut: false, neighbor: "paragraph", acceptAfter: 6 },
  {
    input: "~~~bash",
    shortcut: false,
    neighbor: "heading",
    acceptAfter: "each",
  },
  {
    input: "~~~bash",
    shortcut: false,
    neighbor: "bare-code",
    acceptAfter: "each",
  },
] as const)(
  "keeps fresh-gap native typing and its fence command local while formal Preview is outstanding ($input, following $neighbor, accept $acceptAfter)",
  async (spec) => {
    const { input, shortcut, neighbor } = spec;
    const acceptAfter = "acceptAfter" in spec ? spec.acceptAfter : null;
    const targetIndex = 159;
    const bareNeighbor = neighbor === "bare-code";
    const protectedHeadingText =
      neighbor === "heading" ? "Following" : "Boundary";
    const followingSource = bareNeighbor
      ? "~~~\nKEEP\n~~~"
      : neighbor === "paragraph"
        ? "Protected following."
        : "### Following";
    const protectedTail =
      neighbor === "heading"
        ? [followingSource, "~~~ruby\nfin\n~~~"]
        : [followingSource, "### Boundary", "~~~ruby\nfin\n~~~"];
    const blocks = Array.from(
      { length: 320 },
      (_, index) => `Paragraph ${index}`,
    );
    blocks.splice(
      targetIndex,
      protectedTail.length + 1,
      "Origin text.",
      ...protectedTail,
    );
    const markdown = blocks.join("\n\n");
    const fixture = await openWindowedOwner({
      initialMarkdown: markdown,
      flowGeometry: true,
      initialScrollTop: (targetIndex - 1) * 24,
    });
    const { current, documentOwner, documentSession } = fixture;
    const requests: Array<{ markdown: string; signature: string }> = [];
    const requestPreview = (value: string) => {
      const signature = `pending-fence-${requests.length + 1}`;
      requests.push({ markdown: value, signature });
      current.session.schedule(request(value, signature), true);
      return signature;
    };
    const onTransferFailure = vi.fn();
    const props = {
      documentSession,
      imagePasteUploadEnabled: false,
      imageUploadEnabled: false,
      onCanonicalDocumentChange: vi.fn(),
      onDiagnostic: fixture.onDiagnostic,
      onDispose: vi.fn(),
      onFailure: fixture.onFailure,
      onMarkdownChange: vi.fn(),
      onPendingChange: vi.fn(),
      onReady: vi.fn(),
      onTransferFailure,
      pending: false,
      prepareWindowBlockAdoption: current.runtime.prepareWindowBlockAdoption,
      retainCompositionSurface: () =>
        current.runtime.retainCompositionSurface(),
      getAcceptedWindowSnapshot: current.runtime.getAcceptedWindowSnapshot,
      requestPreview,
      requestPreviewAtDocumentEnd: (
        value: string,
        selection?: Readonly<{ end: number; start: number }>,
      ) => {
        const pin = current.runtime.prepareDocumentEndWindowPin(
          `pending-fence-${requests.length + 1}`,
          selection,
        );
        try {
          return { signature: requestPreview(value), release: pin.release };
        } catch (error) {
          pin.release();
          throw error;
        }
      },
      surface: current.surface,
    };
    const visual = () => (
      <WindowedImmersiveVisualEditor
        referenceLabelCaseFoldProfile={14}
        {...props}
        acceptedWindowSnapshotGeneration={fixture.getGeneration()}
        editMap={fixture.getSnapshot().editMap}
        previewSnapshot={fixture.getSnapshot()}
        previewStatus={fixture.getStatus()}
      />
    );
    let view: RenderResult | null = render(visual());
    fixture.setUpdateVisual(() =>
      queueMicrotask(() => {
        if (view) view.rerender(visual());
      }),
    );
    try {
      const lead = current.surface.querySelector(
        '[data-easymde-visual-block-id="b159"]',
      );
      const text = lead?.firstChild;
      let followingId = "b160";
      let following = current.surface.querySelector(
        `[data-easymde-visual-block-id="${followingId}"]`,
      );
      let headingId = neighbor === "heading" ? "b160" : "b161";
      let codeId = neighbor === "heading" ? "b161" : "b162";
      let protectedHeading = current.surface.querySelector(
        `[data-easymde-visual-block-id="${headingId}"]`,
      );
      let followingCode = current.surface.querySelector(
        `[data-easymde-visual-block-id="${codeId}"] > code`,
      );
      if (
        !(lead instanceof HTMLParagraphElement) ||
        !(text instanceof Text) ||
        !(following instanceof HTMLElement) ||
        !(protectedHeading instanceof HTMLHeadingElement) ||
        !(followingCode instanceof HTMLElement)
      )
        throw new Error("pending-fence-neighbors-missing");
      expect(following.tagName).toBe(
        bareNeighbor ? "PRE" : neighbor === "paragraph" ? "P" : "H3",
      );
      current.surface.tabIndex = 0;
      current.surface.focus();
      act(() => {
        window.getSelection()?.collapse(text, text.length);
        const key = new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "Enter",
        });
        current.surface.dispatchEvent(key);
        if (!key.defaultPrevented) {
          const target = window.getSelection()?.getRangeAt(0).cloneRange();
          if (!target) throw new Error("pending-fence-tail-range-missing");
          const before = new InputEvent("beforeinput", {
            bubbles: true,
            cancelable: true,
            inputType: "insertParagraph",
          });
          Object.defineProperty(before, "getTargetRanges", {
            value: () => [target],
          });
          current.surface.dispatchEvent(before);
          if (!before.defaultPrevented) {
            const paragraph = lead.cloneNode(false);
            if (!(paragraph instanceof HTMLParagraphElement))
              throw new Error("pending-fence-native-clone-missing");
            paragraph.append(document.createElement("br"));
            lead.after(paragraph);
            window.getSelection()?.collapse(paragraph, 0);
            current.surface.dispatchEvent(
              new InputEvent("input", {
                bubbles: true,
                inputType: "insertParagraph",
              }),
            );
          }
        }
      });
      // The original rows hold the response through the whole input. Manual
      // typing also accepts actual formal replies between individual keys.
      for (let count = 1; count <= input.length; count += 1) {
        const character = input.charAt(count - 1);
        await act(async () => {
          const range = window.getSelection()?.getRangeAt(0).cloneRange();
          if (!range) throw new Error("pending-fence-input-range-missing");
          const before = new InputEvent("beforeinput", {
            bubbles: true,
            cancelable: true,
            inputType: "insertText",
            data: character,
          });
          Object.defineProperty(before, "getTargetRanges", {
            value: () => [range],
          });
          current.surface.dispatchEvent(before);
          if (!before.defaultPrevented) {
            if (range.collapsed && range.startContainer instanceof Text) {
              const node = range.startContainer,
                offset = range.startOffset;
              node.insertData(offset, character);
              window.getSelection()?.collapse(node, offset + 1);
            } else {
              range.deleteContents();
              const node = document.createTextNode(character);
              range.insertNode(node);
              window.getSelection()?.collapse(node, 1);
            }
            current.surface.dispatchEvent(
              new InputEvent("input", {
                bubbles: true,
                inputType: "insertText",
                data: character,
              }),
            );
          }
          await Promise.resolve();
        });
        const native = window.getSelection(),
          anchor = native?.anchorNode;
        const element =
          anchor instanceof Element ? anchor : anchor?.parentElement;
        const paragraph = element?.closest("p");
        if (!paragraph || !anchor)
          throw new Error("pending-fence-typing-left-paragraph");
        expect(
          paragraph.textContent?.trim(),
          "each real input must reach the fresh line",
        ).toBe(input.slice(0, count));
        const prefix = document.createRange();
        prefix.selectNodeContents(paragraph);
        prefix.setEnd(anchor, native?.anchorOffset ?? 0);
        expect(
          prefix.toString().length,
          "native caret stays after the newly typed character",
        ).toBe(paragraph.textContent?.length);
        expect(
          current.surface.querySelector(
            `[data-easymde-visual-block-id="${followingId}"]`,
          ),
        ).toBe(following);
        expect(
          current.surface.querySelector(
            `[data-easymde-visual-block-id="${headingId}"]`,
          ),
        ).toBe(protectedHeading);
        expect(
          current.surface.querySelector(
            `[data-easymde-visual-block-id="${codeId}"] > code`,
          ),
        ).toBe(followingCode);
        expect(followingCode.textContent).toBe("fin\n");
        expect(fixture.onFailure).not.toHaveBeenCalled();
        expect(fixture.onDiagnostic).not.toHaveBeenCalled();
        if (!shortcut) {
          await waitFor(() => {
            const value = documentOwner.getValue();
            const start = value.indexOf("Origin text.") + "Origin text.".length;
            const end = value.indexOf(followingSource, start);
            const literal = value.slice(start, end).trim();
            expect(literal.replace(/\\([~`])/g, "$1")).toBe(
              input.slice(0, count),
            );
          });
          const value = documentOwner.getValue();
          const start = value.indexOf("Origin text.") + "Origin text.".length;
          const end = value.indexOf(followingSource, start);
          const region = value.slice(start, end);
          const markerAt = start + region.search(/\S/u);
          const blocks = createEditorMarkdownBlockIndex(value).blocks;
          expect(
            blocks.find(
              (block) => block.from <= markerAt && markerAt < block.to,
            )?.kind,
            "manual typing without Enter remains a Markdown paragraph, not an opening fence",
          ).toBe("paragraph");
          expect(
            blocks.some(
              (block) =>
                block.kind === "code" &&
                value.slice(block.from, block.to).trimEnd() ===
                  "~~~ruby\nfin\n~~~",
            ),
            "literal input cannot consume the existing following code",
          ).toBe(true);
          if (bareNeighbor)
            expect(
              blocks.some(
                (block) =>
                  block.kind === "code" &&
                  value.slice(block.from, block.to).trimEnd() ===
                    followingSource,
              ),
              "an accepted bare PRE opener is not this paragraph's closing delimiter",
            ).toBe(true);
        }
        if (
          count < input.length &&
          ("each" === acceptAfter || count === acceptAfter)
        ) {
          await act(async () => {
            await Promise.resolve();
          });
          const requested = requests.at(-1),
            response = current.responses.at(-1);
          if (!requested || !response)
            throw new Error("manual-info-formal-response-missing");
          const canonical = documentOwner.getValue();
          const formal = gapLeasePreview(
            requested.markdown,
            requested.signature,
          );
          await act(async () =>
            response.resolve({
              ...formal,
              html: safeHtml(formal.html.replace(/\\([~`])/g, "$1")),
            }),
          );
          await fixture.settle();
          expect(documentOwner.getValue()).toBe(canonical);
          const selection = window.getSelection(),
            node = selection?.anchorNode;
          const element = node instanceof Element ? node : node?.parentElement;
          const paragraph = element?.closest("p");
          if (!paragraph || !node)
            throw new Error("manual-info-accepted-caret-left-paragraph");
          expect(paragraph.textContent?.trim()).toBe(input.slice(0, count));
          const prefix = document.createRange();
          prefix.selectNodeContents(paragraph);
          prefix.setEnd(node, selection?.anchorOffset ?? 0);
          expect(
            prefix.toString().length,
            "formal acceptance between manual keys keeps the caret at the typed prefix end",
          ).toBe(paragraph.textContent?.length);
          // Formal reindexing may assign new IDs; compare the actual protected
          // neighbors during the next keystroke, not obsolete pre-accept nodes.
          protectedHeading =
            Array.from(current.surface.querySelectorAll("h3")).find(
              (node) => node.textContent === protectedHeadingText,
            ) ?? null;
          following = bareNeighbor
            ? (Array.from(current.surface.querySelectorAll("pre")).find(
                (node) => node.querySelector("code")?.textContent === "KEEP\n",
              ) ?? null)
            : neighbor === "paragraph"
              ? (Array.from(current.surface.querySelectorAll("p")).find(
                  (node) => node.textContent === followingSource,
                ) ?? null)
              : protectedHeading;
          followingCode = current.surface.querySelector("code.language-ruby");
          if (!following || !protectedHeading || !followingCode)
            throw new Error("manual-info-protected-neighbors-lost");
          followingId =
            following.getAttribute("data-easymde-visual-block-id") ?? "";
          headingId =
            protectedHeading.getAttribute("data-easymde-visual-block-id") ?? "";
          codeId =
            followingCode.parentElement?.getAttribute(
              "data-easymde-visual-block-id",
            ) ?? "";
        }
      }
      if (shortcut) {
        act(() =>
          current.surface.dispatchEvent(
            new KeyboardEvent("keydown", {
              bubbles: true,
              cancelable: true,
              key: "Enter",
            }),
          ),
        );
        const insertion = markdown.indexOf(followingSource);
        expect(documentOwner.getValue()).toBe(
          markdown.slice(0, insertion) +
            `${input}\n\n${input}\n\n` +
            markdown.slice(insertion),
        );
        const native = window.getSelection(),
          anchor = native?.anchorNode;
        const element =
          anchor instanceof Element ? anchor : anchor?.parentElement;
        const code = element?.closest("pre > code");
        expect(code).toBeInstanceOf(HTMLElement);
        expect(code?.textContent?.replace(/\u200b/g, "").trim()).toBe("");
        expect(code).not.toBe(followingCode);
        expect(documentOwner.getSelection().start).toBe(insertion + 4);
        expect(documentOwner.getSelection().end).toBe(insertion + 4);
      } else {
        const end = documentOwner.getValue().lastIndexOf("bash") + 4;
        expect(documentOwner.getSelection().start).toBe(end);
        expect(documentOwner.getSelection().end).toBe(end);
      }
      expect(
        current.surface.querySelector(
          `[data-easymde-visual-block-id="${followingId}"]`,
        ),
      ).toBe(following);
      expect(
        current.surface.querySelector(
          `[data-easymde-visual-block-id="${headingId}"]`,
        ),
      ).toBe(protectedHeading);
      expect(
        current.surface.querySelector(
          `[data-easymde-visual-block-id="${codeId}"] > code`,
        ),
      ).toBe(followingCode);
      expect(followingCode.textContent).toBe("fin\n");
      expect(fixture.onFailure).not.toHaveBeenCalled();
      expect(fixture.onDiagnostic).not.toHaveBeenCalled();
      expect(onTransferFailure).not.toHaveBeenCalled();
      await act(async () => {
        await Promise.resolve();
      });
      const requested = requests.at(-1),
        response = current.responses.at(-1);
      if (!requested || !response)
        throw new Error("pending-fence-formal-response-missing");
      const beforeAccept = documentOwner.getValue();
      // Equal-width fence families produce identical code HTML and line maps.
      // Decode only these synthetic paragraphs' escaped markers, as the PHP
      // renderer does; never change the request or the canonical document.
      const formal = gapLeasePreview(
        requested.markdown.replaceAll("```", "~~~"),
        requested.signature,
      );
      await act(async () =>
        response.resolve({
          ...formal,
          html: safeHtml(formal.html.replace(/\\([~`])/g, "$1")),
        }),
      );
      await fixture.settle();
      expect(documentOwner.getValue()).toBe(beforeAccept);
      const native = window.getSelection(),
        anchor = native?.anchorNode;
      const element =
        anchor instanceof Element ? anchor : anchor?.parentElement;
      const activeBlock = shortcut
        ? element?.closest("pre > code")
        : element?.closest("p");
      if (!(activeBlock instanceof HTMLElement) || !anchor)
        throw new Error("pending-fence-formal-caret-lost");
      expect(activeBlock.textContent?.replace(/\u200b/g, "").trim()).toBe(
        shortcut ? "" : input,
      );
      if (!shortcut) {
        const prefix = document.createRange();
        prefix.selectNodeContents(activeBlock);
        prefix.setEnd(anchor, native?.anchorOffset ?? 0);
        expect(
          prefix.toString().length,
          "formal acceptance preserves the caret after the final info character",
        ).toBe(activeBlock.textContent?.length);
      }
      const insertion = documentOwner.getSelection().start;
      expect(documentOwner.getSelection().end).toBe(insertion);
      await act(async () => {
        const range = window.getSelection()?.getRangeAt(0).cloneRange();
        if (!range) throw new Error("pending-fence-continuation-range-missing");
        const before = new InputEvent("beforeinput", {
          bubbles: true,
          cancelable: true,
          inputType: "insertText",
          data: "X",
        });
        Object.defineProperty(before, "getTargetRanges", {
          value: () => [range],
        });
        current.surface.dispatchEvent(before);
        if (!before.defaultPrevented) {
          if (range.collapsed && range.startContainer instanceof Text) {
            const node = range.startContainer,
              offset = range.startOffset;
            node.insertData(offset, "X");
            window.getSelection()?.collapse(node, offset + 1);
          } else {
            const node = document.createTextNode("X");
            range.deleteContents();
            range.insertNode(node);
            window.getSelection()?.collapse(node, 1);
          }
          current.surface.dispatchEvent(
            new InputEvent("input", {
              bubbles: true,
              inputType: "insertText",
              data: "X",
            }),
          );
        }
        await Promise.resolve();
      });
      expect(documentOwner.getValue()).toBe(
        beforeAccept.slice(0, insertion) + "X" + beforeAccept.slice(insertion),
      );
      expect(activeBlock.textContent?.replace(/\u200b/g, "").trim()).toBe(
        shortcut ? "X" : `${input}X`,
      );
      expect(documentOwner.getSelection().start).toBe(insertion + 1);
      expect(documentOwner.getSelection().end).toBe(insertion + 1);
      expect(
        Array.from(current.surface.querySelectorAll("h3")).some(
          (node) => node.textContent === protectedHeadingText,
        ),
      ).toBe(true);
      expect(
        Array.from(current.surface.querySelectorAll("code.language-ruby")).some(
          (node) => node.textContent === "fin\n",
        ),
      ).toBe(true);
      if (neighbor === "paragraph")
        expect(
          Array.from(current.surface.querySelectorAll("p")).some(
            (node) => node.textContent === "Protected following.",
          ),
        ).toBe(true);
      if (bareNeighbor)
        expect(
          Array.from(current.surface.querySelectorAll("pre > code")).some(
            (node) => node.textContent === "KEEP\n",
          ),
        ).toBe(true);
      expect(fixture.onFailure).not.toHaveBeenCalled();
      expect(fixture.onDiagnostic).not.toHaveBeenCalled();
      expect(onTransferFailure).not.toHaveBeenCalled();
    } finally {
      fixture.setUpdateVisual(null);
      view?.unmount();
      view = null;
      current.unmount();
      fixture.cleanup();
    }
  },
);

it.each([
  { key: "Enter", code: "Enter", keyCode: 13 },
  { key: "2", code: "Digit2", keyCode: 50 },
])(
  "keeps composition-confirmed insertion end through formal Preview acceptance ($key)",
  async ({ key, code, keyCode }) => {
    const paragraph = "左侧右侧";
    const committed = "新🌱文";
    const markdown = Array.from({ length: 320 }, (_, index) =>
      index === 1 ? paragraph : `Paragraph ${index}`,
    ).join("\n\n");
    const fixture = await openWindowedOwner({
      initialMarkdown: markdown,
      flowGeometry: true,
    });
    const { current, documentOwner, documentSession } = fixture;
    const requests: PreviewRequest[] = [];
    const requestPreview = (value: string) => {
      const next = request(value, `composition-confirm-${requests.length + 1}`);
      requests.push(next);
      current.session.schedule(next, true);
      return next.signature;
    };
    const onTransferFailure = vi.fn();
    const props = {
      documentSession,
      imagePasteUploadEnabled: false,
      imageUploadEnabled: false,
      onCanonicalDocumentChange: vi.fn(),
      onDiagnostic: fixture.onDiagnostic,
      onDispose: vi.fn(),
      onFailure: fixture.onFailure,
      onMarkdownChange: vi.fn(),
      onPendingChange: vi.fn(),
      onReady: vi.fn(),
      onTransferFailure,
      prepareWindowBlockAdoption: current.runtime.prepareWindowBlockAdoption,
      retainCompositionSurface: () =>
        current.runtime.retainCompositionSurface(),
      getAcceptedWindowSnapshot: current.runtime.getAcceptedWindowSnapshot,
      requestPreview,
      requestPreviewAtDocumentEnd: (
        value: string,
        selection?: Readonly<{ end: number; start: number }>,
      ) => {
        const pin = current.runtime.prepareDocumentEndWindowPin(
          `composition-confirm-${requests.length + 1}`,
          selection,
        );
        try {
          return { signature: requestPreview(value), release: pin.release };
        } catch (error) {
          pin.release();
          throw error;
        }
      },
      surface: current.surface,
    };
    const visual = () => (
      <WindowedImmersiveVisualEditor
        referenceLabelCaseFoldProfile={14}
        {...props}
        pending={fixture.getStatus() !== "ready"}
        acceptedWindowSnapshotGeneration={fixture.getGeneration()}
        editMap={fixture.getSnapshot().editMap}
        previewSnapshot={fixture.getSnapshot()}
        previewStatus={fixture.getStatus()}
      />
    );
    let view: RenderResult | null = render(visual());
    fixture.setUpdateVisual(() =>
      queueMicrotask(() => {
        if (view) view.rerender(visual());
      }),
    );
    try {
      const block = current.surface.querySelector(
        '[data-easymde-visual-block-id="b1"]',
      );
      const text = block?.firstChild;
      if (!(block instanceof HTMLParagraphElement) || !(text instanceof Text))
        throw new Error("composition-confirm-paragraph-missing");
      current.surface.tabIndex = 0;
      current.surface.focus();
      window.getSelection()?.collapse(text, 2);
      const sourceStart = markdown.indexOf(paragraph);
      const insertionEnd = sourceStart + 2 + committed.length;
      const expected =
        markdown.slice(0, sourceStart + 2) +
        committed +
        markdown.slice(sourceStart + 2);
      // Collect caret failures on both sides of acceptance so an early drift cannot hide a later overwrite.
      const assertInsertionEnd = () => {
        expect(documentOwner.getValue()).toBe(expected);
        expect.soft(documentOwner.getSelection()).toEqual({
          direction: "none",
          start: insertionEnd,
          end: insertionEnd,
        });
        const acceptedBlock = current.surface.querySelector(
          '[data-easymde-visual-block-id="b1"]',
        );
        const native = window.getSelection();
        expect(acceptedBlock?.textContent).toBe(`左侧${committed}右侧`);
        expect(native?.isCollapsed).toBe(true);
        expect(native?.anchorNode?.isConnected).toBe(true);
        if (!(acceptedBlock instanceof HTMLElement) || !native?.anchorNode)
          throw new Error("composition-confirm-native-selection-missing");
        expect(acceptedBlock.contains(native.anchorNode)).toBe(true);
        const prefix = document.createRange();
        prefix.selectNodeContents(acceptedBlock);
        prefix.setEnd(native.anchorNode, native.anchorOffset);
        expect.soft(prefix.toString()).toBe(`左侧${committed}`);
        expect(
          current.surface.querySelector('[data-easymde-visual-block-id="b0"]')
            ?.textContent,
        ).toBe("Paragraph 0");
        expect(
          current.surface.querySelector('[data-easymde-visual-block-id="b2"]')
            ?.textContent,
        ).toBe("Paragraph 2");
        expect(current.surface.querySelector("pre")).toBeNull();
      };
      await act(async () => {
        current.surface.dispatchEvent(
          new CompositionEvent("compositionstart", { bubbles: true, data: "" }),
        );
        let previous = "";
        for (const data of ["a", "ab", "a b c d", committed]) {
          if (data === committed) {
            // Confirmation precedes the final composing input; its native caret is one UTF16 unit short.
            current.surface.dispatchEvent(
              new KeyboardEvent("keydown", {
                bubbles: true,
                cancelable: true,
                key,
                code,
                keyCode: 229,
                isComposing: true,
              }),
            );
          }
          current.surface.dispatchEvent(
            new CompositionEvent("compositionupdate", { bubbles: true, data }),
          );
          current.surface.dispatchEvent(
            new InputEvent("beforeinput", {
              bubbles: true,
              cancelable: false,
              data,
              inputType: "insertCompositionText",
              isComposing: true,
            }),
          );
          text.replaceData(2, previous.length, data);
          window
            .getSelection()
            ?.collapse(text, 2 + data.length - (data === committed ? 1 : 0));
          current.surface.dispatchEvent(
            new InputEvent("input", {
              bubbles: true,
              data,
              inputType: "insertCompositionText",
              isComposing: true,
            }),
          );
          previous = data;
        }
        current.surface.dispatchEvent(
          new CompositionEvent("compositionend", {
            bubbles: true,
            data: committed,
          }),
        );
        await Promise.resolve();
      });
      assertInsertionEnd();
      current.surface.dispatchEvent(
        new KeyboardEvent("keyup", {
          bubbles: true,
          key,
          code,
          keyCode,
          isComposing: false,
        }),
      );
      assertInsertionEnd();
      const generation = fixture.getGeneration();
      // Drive the ordinary source-to-Preview cadence through the real request session and sink.
      act(() => requestPreview(documentOwner.getValue()));
      await act(async () => {
        expect(current.responses).toHaveLength(requests.length);
        for (const [index, response] of current.responses.entries()) {
          const requested = requests[index];
          if (!requested)
            throw new Error("composition-confirm-preview-request-missing");
          response.resolve(
            gapLeasePreview(requested.markdown, requested.signature),
          );
        }
      });
      await fixture.settle();
      expect(fixture.getStatus()).toBe("ready");
      expect(fixture.getGeneration()).toBeGreaterThan(generation);
      expect(fixture.getSnapshot().signature).toBe(requests.at(-1)?.signature);
      assertInsertionEnd();
      expect(fixture.onFailure).not.toHaveBeenCalled();
      expect(fixture.onDiagnostic).not.toHaveBeenCalled();
      expect(onTransferFailure).not.toHaveBeenCalled();
    } finally {
      fixture.setUpdateVisual(null);
      const activeView = view;
      view = null;
      activeView?.unmount();
      current.unmount();
      fixture.cleanup();
    }
  },
);

it.each(["Control", "Meta"] as const)(
  "preserves a witnessed %s+A range when the matching composition formal response is accepted",
  async (modifier) => {
    const current = await openGapComposition();
    const surface = current.surface;
    const committed = "word";
    try {
      surface.focus();
      let draft: Text | null = null;
      let previousLength = 0;
      act(() => {
        surface.dispatchEvent(
          new CompositionEvent("compositionstart", { bubbles: true, data: "" }),
        );
        for (const data of ["w", "w o r d", committed]) {
          if (data === committed)
            surface.dispatchEvent(
              new KeyboardEvent("keydown", {
                bubbles: true,
                cancelable: true,
                key: "Enter",
                keyCode: 229,
                isComposing: true,
              }),
            );
          surface.dispatchEvent(
            new CompositionEvent("compositionupdate", { bubbles: true, data }),
          );
          const before = new InputEvent("beforeinput", {
            bubbles: true,
            cancelable: false,
            data,
            inputType: "insertCompositionText",
            isComposing: true,
          });
          surface.dispatchEvent(before);
          expect(before.defaultPrevented).toBe(false);
          if (!draft) {
            const native = window.getSelection();
            if (!native?.rangeCount)
              throw new Error("formal-selection-draft-range-missing");
            draft = document.createTextNode("");
            native.getRangeAt(0).insertNode(draft);
          }
          draft.replaceData(0, previousLength, data);
          window
            .getSelection()
            ?.collapse(draft, data.length - (data === committed ? 1 : 0));
          surface.dispatchEvent(
            new InputEvent("input", {
              bubbles: true,
              data,
              inputType: "insertCompositionText",
              isComposing: true,
            }),
          );
          previousLength = data.length;
        }
      });
      expect(current.documentOwner.getValue()).toBe(current.afterEnter);
      // Accept the preceding Enter frame while the composition surface is retained.
      await current.resolvePending();
      const requestCount = current.requests.length;
      await act(async () => {
        surface.dispatchEvent(
          new CompositionEvent("compositionend", {
            bubbles: true,
            data: committed,
          }),
        );
        await Promise.resolve();
      });
      const expected =
        current.afterEnter.slice(0, current.start + 1) +
        committed +
        current.afterEnter.slice(current.start + 1);
      expect(current.documentOwner.getValue()).toBe(expected);
      expect(current.requests.length).toBeGreaterThan(requestCount);
      expect(current.requests.at(-1)?.markdown).toBe(expected);
      const history = current.documentOwner.getHistoryState();
      const revision = current.getRevision();
      const generation = current.getGeneration();
      const key = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "a",
        code: "KeyA",
        ctrlKey: modifier === "Control",
        metaKey: modifier === "Meta",
      });
      act(() => {
        surface.dispatchEvent(key);
        if (!key.defaultPrevented) {
          // Browser default Select All, after the real shortcut reached the pending owner.
          const range = document.createRange();
          range.selectNodeContents(surface);
          window.getSelection()?.removeAllRanges();
          window.getSelection()?.addRange(range);
        }
        document.dispatchEvent(new Event("selectionchange"));
      });
      const newer = window.getSelection();
      expect(newer?.isCollapsed).toBe(false);
      const selectedText = newer?.toString();
      expect(selectedText?.length).toBeGreaterThan(committed.length);
      expect(current.documentOwner.getValue()).toBe(expected);
      expect(current.documentOwner.getHistoryState()).toEqual(history);
      // Resolve the actual matching signature through PreviewRequestSession and the sink.
      await current.resolvePendingFrom(requestCount);
      expect(current.getStatus()).toBe("ready");
      expect(current.getGeneration()).toBeGreaterThan(generation);
      expect(current.getSnapshot().signature).toBe(
        current.requests.at(-1)?.signature,
      );
      expect(current.documentOwner.getValue()).toBe(expected);
      expect(current.getRevision()).toBe(revision);
      expect(current.documentOwner.getHistoryState()).toEqual(history);
      const accepted = window.getSelection();
      expect(accepted?.isCollapsed).toBe(false);
      expect(accepted?.toString()).toBe(selectedText);
      expect(accepted?.anchorNode?.isConnected).toBe(true);
      expect(accepted?.focusNode?.isConnected).toBe(true);
      expect(current.onFailure).not.toHaveBeenCalled();
      expect(current.onDiagnostic).not.toHaveBeenCalled();
      expect(current.onTransferFailure).not.toHaveBeenCalled();
    } finally {
      current.dispose();
    }
  },
);

it.each(["same-epoch layout", "retained native edit"] as const)(
  "keeps terminal flow geometry usable through a real Windowed suffix (%s)",
  async (transition) => {
    const blocks = Array.from({ length: 320 }, (_, index) =>
      index === 319 ? "Tail" : `Paragraph ${index}`,
    );
    const initialMarkdown = blocks.join("\n\n");
    const fixture = await openWindowedOwner({
      initialMarkdown,
      flowGeometry: true,
    });
    const { current, documentOwner, documentSession } = fixture;
    const restores: Array<() => void> = [];
    const outside = document.createElement("button");
    document.body.append(outside);
    let view: RenderResult | null = null;
    let visualRuntime: ImmersiveVisualEditorRuntime | null = null;
    const activeVisual = () => {
      if (!visualRuntime)
        throw new Error("terminal-flow-visual-runtime-missing");
      return visualRuntime;
    };
    const onTransferFailure = vi.fn();
    const requests: Array<{ markdown: string; signature: string }> = [];
    const requestPreview = (markdown: string) => {
      const signature = `terminal-flow-${requests.length + 1}`;
      requests.push({ markdown, signature });
      current.session.schedule(request(markdown, signature), true);
      return signature;
    };
    try {
      current.setWindowed(false);
      await waitFor(() => {
        expect(current.surface.children).toHaveLength(blocks.length);
        expect(
          current.surface.querySelector("[data-easymde-preview-window-spacer]"),
        ).toBeNull();
        expect(current.surface.getAttribute("data-easymde-preview-phase")).toBe(
          "ready",
        );
      });
      const roots = Array.from(current.surface.children);
      const tail = roots.at(-1);
      if (!(tail instanceof HTMLParagraphElement))
        throw new Error("terminal-flow-tail-missing");
      const sequenceRect = vi
        .mocked(HTMLElement.prototype.getBoundingClientRect)
        .getMockImplementation();
      if (!sequenceRect)
        throw new Error("terminal-flow-sequence-geometry-missing");
      let tailHeight = 24;
      const height = (node: Element): number =>
        node.hasAttribute("data-easymde-preview-window-spacer")
          ? Number.parseFloat((node as HTMLElement).style.blockSize)
          : node === tail
            ? tailHeight
            : 24;
      const extent = () =>
        Array.from(current.surface.children).reduce(
          (sum, node) => sum + height(node),
          0,
        );
      for (const [element, property, descriptor] of [
        [
          current.surface,
          "getBoundingClientRect",
          {
            configurable: true,
            value: () => previewRect(-current.canvas.scrollTop, extent()),
          },
        ],
        [current.canvas, "scrollHeight", { configurable: true, get: extent }],
        [tail, "offsetHeight", { configurable: true, get: () => tailHeight }],
        [
          tail,
          "getBoundingClientRect",
          {
            configurable: true,
            value: () => previewRect(sequenceRect.call(tail).top, tailHeight),
          },
        ],
      ] as const) {
        const previous = Object.getOwnPropertyDescriptor(element, property);
        restores.push(() => {
          if (previous) Object.defineProperty(element, property, previous);
          else Reflect.deleteProperty(element, property);
        });
        Object.defineProperty(element, property, descriptor);
      }
      // Enter from the complete live surface so its real first/last boundary
      // is captured before any spacer replaces accepted roots.
      current.setWindowed(true);
      await waitFor(() => {
        expect(
          current.runtime.getAcceptedWindowSnapshot()?.blocks[0]?.node,
        ).toBe(roots[0]);
        expect(current.surface.contains(tail)).toBe(false);
      });
      const props = {
        documentSession,
        imagePasteUploadEnabled: false,
        imageUploadEnabled: false,
        onCanonicalDocumentChange: vi.fn(),
        onDiagnostic: fixture.onDiagnostic,
        onDispose: vi.fn(),
        onFailure: fixture.onFailure,
        onMarkdownChange: vi.fn(),
        onPendingChange: vi.fn(),
        onReady: (runtime: ImmersiveVisualEditorRuntime) => {
          visualRuntime = runtime;
        },
        onTransferFailure,
        pending: false,
        prepareWindowBlockAdoption: current.runtime.prepareWindowBlockAdoption,
        retainCompositionSurface: () =>
          current.runtime.retainCompositionSurface(),
        getAcceptedWindowSnapshot: current.runtime.getAcceptedWindowSnapshot,
        requestPreview,
        requestPreviewAtDocumentEnd: (
          markdown: string,
          selection?: Readonly<{ end: number; start: number }>,
        ) => {
          const pin = current.runtime.prepareDocumentEndWindowPin(
            `terminal-flow-${requests.length + 1}`,
            selection,
          );
          try {
            return {
              signature: requestPreview(markdown),
              release: pin.release,
            };
          } catch (error) {
            pin.release();
            throw error;
          }
        },
        surface: current.surface,
      };
      const visual = () => (
        <WindowedImmersiveVisualEditor
          referenceLabelCaseFoldProfile={14}
          {...props}
          acceptedWindowSnapshotGeneration={fixture.getGeneration()}
          editMap={fixture.getSnapshot().editMap}
          previewSnapshot={fixture.getSnapshot()}
          previewStatus={fixture.getStatus()}
        />
      );
      view = render(visual());
      fixture.setUpdateVisual(() =>
        queueMicrotask(() => {
          if (view) view.rerender(visual());
        }),
      );
      await waitFor(() => expect(activeVisual().isEditable()).toBe(true));
      act(() => {
        current.canvas.scrollTop =
          current.canvas.scrollHeight - current.canvas.clientHeight;
        current.canvas.dispatchEvent(new Event("scroll"));
      });
      await waitFor(() =>
        expect(
          current.runtime
            .getAcceptedWindowSnapshot()
            ?.blocks.some((block) => block.node === tail),
        ).toBe(true),
      );
      const tailText = tail.firstChild;
      if (!(tailText instanceof Text))
        throw new Error("terminal-flow-tail-text-missing");
      current.surface.tabIndex = 0;
      current.surface.focus();
      act(() => {
        tail.dispatchEvent(new Event("pointerdown", { bubbles: true }));
        window.getSelection()?.collapse(tailText, tailText.length);
      });
      const before = {
        value: documentOwner.getValue(),
        revision: fixture.getRevision(),
        history: documentOwner.getHistoryState(),
        selection: documentOwner.getSelection(),
      };
      const generationBeforeDelta = fixture.getGeneration();
      tailHeight = 48;
      if (transition === "retained native edit") {
        act(() => {
          const range = window.getSelection()?.getRangeAt(0).cloneRange();
          if (!range) throw new Error("terminal-flow-input-range-missing");
          const beforeInput = new InputEvent("beforeinput", {
            bubbles: true,
            cancelable: true,
            inputType: "insertText",
            data: "!",
          });
          Object.defineProperty(beforeInput, "getTargetRanges", {
            value: () => [range],
          });
          tail.dispatchEvent(beforeInput);
          if (!beforeInput.defaultPrevented) {
            tailText.appendData("!");
            window.getSelection()?.collapse(tailText, tailText.length);
            tail.dispatchEvent(
              new InputEvent("input", {
                bubbles: true,
                inputType: "insertText",
                data: "!",
              }),
            );
          }
        });
      }
      const expectedMarkdown =
        transition === "retained native edit"
          ? `${initialMarkdown}!`
          : initialMarkdown;
      expect(documentOwner.getValue()).toBe(expectedMarkdown);
      if (transition === "same-epoch layout") {
        expect({
          value: documentOwner.getValue(),
          revision: fixture.getRevision(),
          history: documentOwner.getHistoryState(),
          selection: documentOwner.getSelection(),
        }).toEqual(before);
      } else {
        expect(documentOwner.getSelection()).toEqual({
          direction: "none",
          start: expectedMarkdown.length,
          end: expectedMarkdown.length,
        });
        expect(window.getSelection()?.anchorNode).toBe(tailText);
        expect(window.getSelection()?.anchorOffset).toBe(tailText.length);
      }
      act(() => window.dispatchEvent(new Event("resize")));
      await waitFor(() => {
        expect(fixture.getGeneration()).toBeGreaterThan(generationBeforeDelta);
        expect(
          current.runtime
            .getAcceptedWindowSnapshot()
            ?.blocks.some((block) => block.node === tail),
        ).toBe(true);
      });
      const afterDelta = {
        value: documentOwner.getValue(),
        revision: fixture.getRevision(),
        history: documentOwner.getHistoryState(),
        selection: documentOwner.getSelection(),
      };
      act(() => {
        outside.focus();
        window.getSelection()?.removeAllRanges();
        document.dispatchEvent(new Event("selectionchange"));
        current.canvas.scrollTop = 0;
        current.canvas.dispatchEvent(new Event("scroll"));
      });
      await waitFor(() =>
        expect({
          phase: current.surface.getAttribute("data-easymde-preview-phase"),
          first: current.runtime.getAcceptedWindowSnapshot()?.blocks[0]?.node,
          diagnostics: fixture.onDiagnostic.mock.calls,
        }).toEqual({ phase: "ready", first: roots[0], diagnostics: [] }),
      );
      expect(current.surface.contains(tail)).toBe(false);
      const suffix = current.surface.lastElementChild;
      if (
        !(suffix instanceof HTMLElement) ||
        !suffix.hasAttribute("data-easymde-preview-window-spacer")
      )
        throw new Error("terminal-flow-suffix-missing");
      const start = Number(
        suffix.getAttribute("data-easymde-preview-window-start"),
      );
      expect(suffix.getAttribute("data-easymde-preview-window-end")).toBe(
        String(blocks.length),
      );
      expect(Number.parseFloat(suffix.style.blockSize)).toBe(
        roots.slice(start).reduce((sum, node) => sum + height(node), 0),
      );
      expect(
        suffix.getBoundingClientRect().bottom + current.canvas.scrollTop,
      ).toBe(current.canvas.scrollHeight);
      expect(current.runtime.getAcceptedWindowSnapshot()?.sourceRevision).toBe(
        fixture.getRevision(),
      );
      expect(activeVisual().isEditable()).toBe(true);
      const firstText = roots[0]?.firstChild;
      if (!(firstText instanceof Text))
        throw new Error("terminal-flow-top-text-missing");
      act(() => {
        current.surface.focus();
        window.getSelection()?.collapse(firstText, 2);
      });
      expect(activeVisual().prepareContextMenuDemand()).toBe(true);
      expect({
        value: documentOwner.getValue(),
        revision: fixture.getRevision(),
        history: documentOwner.getHistoryState(),
        selection: documentOwner.getSelection(),
      }).toEqual(afterDelta);
      expect(fixture.onFailure).not.toHaveBeenCalled();
      expect(onTransferFailure).not.toHaveBeenCalled();
      expect(current.surface.getAttribute("aria-busy")).toBe("false");
      fixture.setUpdateVisual(null);
      view.unmount();
      view = null;
      let materialized: boolean | undefined;
      act(() => {
        void current.runtime.materialize().then((value) => {
          materialized = value;
        });
      });
      await waitFor(() => expect(materialized).toBe(true));
      expect(Array.from(current.surface.children)).toEqual(roots);
      expect(roots.map((node) => node.textContent)).toEqual(
        blocks.map((text, index) =>
          index === 319 && transition === "retained native edit"
            ? `${text}!`
            : text,
        ),
      );
      const fullHeight = roots.reduce(
        (sum, node) => sum + node.getBoundingClientRect().height,
        0,
      );
      expect(current.surface.getBoundingClientRect().height).toBe(fullHeight);
      expect(current.canvas.scrollHeight).toBe(fullHeight);
      expect(
        tail.getBoundingClientRect().bottom + current.canvas.scrollTop,
      ).toBe(fullHeight);
      expect(tail.getBoundingClientRect().height).toBe(48);
      expect(documentOwner.getValue()).toBe(expectedMarkdown);
      expect(current.onDiagnostic).not.toHaveBeenCalled();
    } finally {
      fixture.setUpdateVisual(null);
      view?.unmount();
      current.unmount();
      for (const restore of restores) restore();
      outside.remove();
      fixture.cleanup();
    }
  },
);

it("keeps an adopted heading source witness usable for a later paragraph input", async () => {
  const blocks = Array.from({ length: 320 }, (_, index) =>
    index === 0 ? "Alpha" : index === 1 ? "Beta" : `Paragraph ${index}`,
  );
  const initialMarkdown = blocks.join("\n\n");
  const fixture = await openWindowedOwner({
    initialMarkdown,
    flowGeometry: true,
  });
  const { current, documentOwner, documentSession } = fixture;
  let visualRuntime: ImmersiveVisualEditorRuntime | null = null;
  const activeVisual = () => {
    if (!visualRuntime)
      throw new Error("adopted-heading-visual-runtime-missing");
    return visualRuntime;
  };
  const requests: Array<{ markdown: string; signature: string }> = [];
  const requestPreview = (markdown: string) => {
    const signature = `adopted-heading-${requests.length + 1}`;
    requests.push({ markdown, signature });
    current.session.schedule(request(markdown, signature), true);
    return signature;
  };
  const onTransferFailure = vi.fn();
  const props = {
    documentSession,
    imagePasteUploadEnabled: false,
    imageUploadEnabled: false,
    onCanonicalDocumentChange: vi.fn(),
    onDiagnostic: fixture.onDiagnostic,
    onDispose: vi.fn(),
    onFailure: fixture.onFailure,
    onMarkdownChange: vi.fn(),
    onPendingChange: vi.fn(),
    onReady: (runtime: ImmersiveVisualEditorRuntime) => {
      visualRuntime = runtime;
    },
    onTransferFailure,
    pending: false,
    prepareWindowBlockAdoption: current.runtime.prepareWindowBlockAdoption,
    retainCompositionSurface: () => current.runtime.retainCompositionSurface(),
    getAcceptedWindowSnapshot: current.runtime.getAcceptedWindowSnapshot,
    requestPreview,
    requestPreviewAtDocumentEnd: (
      markdown: string,
      selection?: Readonly<{ end: number; start: number }>,
    ) => {
      const pin = current.runtime.prepareDocumentEndWindowPin(
        `adopted-heading-${requests.length + 1}`,
        selection,
      );
      try {
        return { signature: requestPreview(markdown), release: pin.release };
      } catch (error) {
        pin.release();
        throw error;
      }
    },
    surface: current.surface,
  };
  const visual = () => (
    <WindowedImmersiveVisualEditor
      referenceLabelCaseFoldProfile={14}
      {...props}
      acceptedWindowSnapshotGeneration={fixture.getGeneration()}
      editMap={fixture.getSnapshot().editMap}
      previewSnapshot={fixture.getSnapshot()}
      previewStatus={fixture.getStatus()}
    />
  );
  let view: RenderResult | null = render(visual());
  fixture.setUpdateVisual(() =>
    queueMicrotask(() => {
      if (view) view.rerender(visual());
    }),
  );
  try {
    await waitFor(() => expect(activeVisual().isEditable()).toBe(true));
    const first = current.surface.querySelector(
      '[data-easymde-visual-block-id="b0"]',
    );
    const second = current.surface.querySelector(
      '[data-easymde-visual-block-id="b1"]',
    );
    const firstText = first?.firstChild;
    const secondText = second?.firstChild;
    if (
      !(first instanceof HTMLParagraphElement) ||
      !(second instanceof HTMLParagraphElement) ||
      !(firstText instanceof Text) ||
      !(secondText instanceof Text)
    )
      throw new Error("adopted-heading-initial-paragraphs-missing");
    current.surface.tabIndex = 0;
    current.surface.focus();
    const afterHeading = `## ${initialMarkdown}`;
    const afterInput = afterHeading.replace("\n\nBeta\n\n", "\n\nBeta!\n\n");
    let commandResult: string | null = null;
    act(() => {
      window.getSelection()?.collapse(firstText, firstText.length);
      commandResult = activeVisual().executeCommand({
        action: "heading",
        group: "heading",
        icon: "heading",
        id: "heading2",
        label: "Heading 2",
        level: 2,
        surface: "heading-menu",
      });
      expect(commandResult).toBe("handled");
      expect(documentOwner.getValue()).toBe(afterHeading);
      const heading = current.surface.querySelector(
        '[data-easymde-visual-block-id="b0"]',
      );
      if (
        !(heading instanceof HTMLHeadingElement) ||
        !(heading.firstChild instanceof Text)
      )
        throw new Error("adopted-heading-command-root-missing");
      expect(heading.tagName).toBe("H2");
      expect(window.getSelection()?.anchorNode).toBe(heading.firstChild);
      expect(window.getSelection()?.anchorOffset).toBe(5);
      expect(documentOwner.getSelection()).toEqual({
        direction: "none",
        start: 8,
        end: 8,
      });
      second.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      window.getSelection()?.collapse(secondText, secondText.length);
      const range = window.getSelection()?.getRangeAt(0).cloneRange();
      if (!range) throw new Error("adopted-heading-later-input-range-missing");
      const before = new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        inputType: "insertText",
        data: "!",
      });
      Object.defineProperty(before, "getTargetRanges", {
        value: () => [range],
      });
      second.dispatchEvent(before);
      if (!before.defaultPrevented) {
        secondText.appendData("!");
        window.getSelection()?.collapse(secondText, secondText.length);
        second.dispatchEvent(
          new InputEvent("input", {
            bubbles: true,
            inputType: "insertText",
            data: "!",
          }),
        );
      }
    });
    expect(fixture.onFailure).not.toHaveBeenCalled();
    expect(fixture.onDiagnostic).not.toHaveBeenCalled();
    expect(onTransferFailure).not.toHaveBeenCalled();
    expect(documentOwner.getValue()).toBe(afterInput);
    const caret = afterInput.indexOf("Beta!") + "Beta!".length;
    expect(documentOwner.getSelection()).toEqual({
      direction: "none",
      start: caret,
      end: caret,
    });
    expect(window.getSelection()?.anchorNode).toBe(secondText);
    expect(window.getSelection()?.anchorOffset).toBe(5);
    expect(secondText.isConnected).toBe(true);
    const committedHistory = documentOwner.getHistoryState();
    const committedRevision = fixture.getRevision();
    act(() => document.dispatchEvent(new Event("selectionchange")));
    await waitFor(() => {
      const accepted = current.runtime.getAcceptedWindowSnapshot();
      expect(accepted?.sourceRevision).toBe(committedRevision);
      expect(
        accepted?.blocks.find((block) => block.id === "b0")?.node.tagName,
      ).toBe("H2");
      expect(
        accepted?.blocks.find((block) => block.id === "b0")?.innerHTML,
      ).toBe("Alpha");
      expect(accepted?.blocks.find((block) => block.id === "b1")?.node).toBe(
        second,
      );
      expect(
        accepted?.blocks.find((block) => block.id === "b1")?.innerHTML,
      ).toBe("Beta!");
    });
    expect(activeVisual().isEditable()).toBe(true);
    expect(activeVisual().isTransferPending()).toBe(false);
    expect(activeVisual().prepareContextMenuDemand()).toBe(true);
    expect(current.surface.getAttribute("aria-busy")).toBe("false");
    expect(documentOwner.getValue()).toBe(afterInput);
    expect(fixture.getRevision()).toBe(committedRevision);
    expect(documentOwner.getHistoryState()).toEqual(committedHistory);
    fixture.setUpdateVisual(null);
    view.unmount();
    view = null;
    expect(documentOwner.undo()).toBe(true);
    expect(documentOwner.getValue()).toBe(afterHeading);
    expect(documentOwner.undo()).toBe(true);
    expect(documentOwner.getValue()).toBe(initialMarkdown);
    expect(documentOwner.redo()).toBe(true);
    expect(documentOwner.getValue()).toBe(afterHeading);
    expect(documentOwner.redo()).toBe(true);
    expect(documentOwner.getValue()).toBe(afterInput);
    expect(documentOwner.getSelection()).toEqual({
      direction: "none",
      start: caret,
      end: caret,
    });
    expect(documentOwner.getHistoryState()).toEqual(committedHistory);
  } finally {
    fixture.setUpdateVisual(null);
    view?.unmount();
    current.unmount();
    fixture.cleanup();
  }
});

it.each([
  { name: "no terminal EOL", suffix: "" },
  { name: "one LF", suffix: "\n" },
  { name: "one CRLF normalized by CodeMirror", suffix: "\r\n" },
  { name: "two terminal EOLs", suffix: "\n\n" },
  { name: "three terminal EOLs", suffix: "\n\n\n" },
])(
  "preserves the EOF gap through real formal acceptance and Undo with $name",
  async ({ suffix }) => {
    const prefix =
      Array.from({ length: 160 }, (_, index) => `Paragraph ${index}`).join(
        "\n\n",
      ) + "\n\nTopic";
    const fixture = await openWindowedOwner({
      initialMarkdown: prefix + suffix,
      initialScrollTop: 160 * 24,
    });
    const { current, documentOwner, documentSession } = fixture;
    const requests: Array<{ markdown: string; signature: string }> = [];
    const onTransferFailure = vi.fn();
    const requestPreview = (markdown: string): string => {
      const signature = `eof-transaction-${requests.length + 1}`;
      requests.push({ markdown, signature });
      current.session.schedule(request(markdown, signature), true);
      return signature;
    };
    const props = {
      documentSession,
      imagePasteUploadEnabled: false,
      imageUploadEnabled: false,
      onCanonicalDocumentChange: vi.fn(),
      onDiagnostic: fixture.onDiagnostic,
      onDispose: vi.fn(),
      onFailure: fixture.onFailure,
      onMarkdownChange: vi.fn(),
      onPendingChange: vi.fn(),
      onReady: vi.fn(),
      onTransferFailure,
      pending: false,
      prepareWindowBlockAdoption: current.runtime.prepareWindowBlockAdoption,
      retainCompositionSurface: () =>
        current.runtime.retainCompositionSurface(),
      getAcceptedWindowSnapshot: current.runtime.getAcceptedWindowSnapshot,
      requestPreview,
      requestPreviewAtDocumentEnd: (
        markdown: string,
        selection?: Readonly<{ end: number; start: number }>,
      ) => {
        if (selection) {
          expect(selection.start).toBeGreaterThanOrEqual(0);
          expect(selection.end).toBeLessThanOrEqual(markdown.length);
        }
        const pin = current.runtime.prepareDocumentEndWindowPin(
          `eof-transaction-${requests.length + 1}`,
          selection,
        );
        try {
          return { signature: requestPreview(markdown), release: pin.release };
        } catch (error) {
          pin.release();
          throw error;
        }
      },
      surface: current.surface,
    };
    const visual = () => (
      <WindowedImmersiveVisualEditor
        referenceLabelCaseFoldProfile={14}
        {...props}
        acceptedWindowSnapshotGeneration={fixture.getGeneration()}
        editMap={fixture.getSnapshot().editMap}
        previewSnapshot={fixture.getSnapshot()}
        previewStatus={fixture.getStatus()}
      />
    );
    let view: RenderResult | null = render(visual());
    fixture.setUpdateVisual(() =>
      queueMicrotask(() => view?.rerender(visual())),
    );
    let delivered = 0;
    const accept = async (): Promise<void> => {
      await act(async () => {
        expect(current.responses).toHaveLength(requests.length);
        for (; delivered < requests.length; delivered += 1) {
          const pending = requests[delivered];
          if (!pending) throw new Error("eof-transaction-request-missing");
          // The formal renderer returns no mapped row for a terminal blank line.
          current.responses[delivered]?.resolve(
            gapLeasePreview(pending.markdown, pending.signature),
          );
        }
      });
      await fixture.settle();
      expect(fixture.getStatus()).toBe("ready");
      expect(fixture.getSnapshot().signature).toBe(requests.at(-1)?.signature);
    };
    const assertGapCaret = (): void => {
      const native = window.getSelection();
      const node = native?.anchorNode;
      const paragraph = node instanceof Element ? node : node?.parentElement;
      expect(paragraph?.tagName).toBe("P");
      expect(paragraph?.textContent).toBe("");
      expect(paragraph?.parentNode).toBe(current.surface);
      expect(paragraph?.previousElementSibling?.textContent).toBe("Topic");
      expect(current.runtime.getAcceptedWindowSnapshot()?.ownedGap).toBe(
        paragraph,
      );
    };
    const typeAtNativeCaret = (data: string): void =>
      act(() => {
        const native = window.getSelection();
        const range = native?.rangeCount
          ? native.getRangeAt(0).cloneRange()
          : null;
        if (!range) throw new Error("eof-transaction-native-range-missing");
        const before = new InputEvent("beforeinput", {
          bubbles: true,
          cancelable: true,
          inputType: "insertText",
          data,
        });
        Object.defineProperty(before, "getTargetRanges", {
          value: () => [range],
        });
        current.surface.dispatchEvent(before);
        if (!before.defaultPrevented) {
          const text = document.createTextNode(data);
          range.deleteContents();
          range.insertNode(text);
          native?.collapse(text, text.length);
          current.surface.dispatchEvent(
            new InputEvent("input", {
              bubbles: true,
              inputType: "insertText",
              data,
            }),
          );
        }
      });
    try {
      current.surface.tabIndex = 0;
      current.surface.focus();
      const tail = current.surface.querySelector(
        '[data-easymde-visual-block-id="b160"]',
      );
      if (!(tail?.firstChild instanceof Text))
        throw new Error("eof-transaction-tail-missing");
      window.getSelection()?.collapse(tail.firstChild, tail.firstChild.length);
      const canonical = documentOwner.getValue();
      expect(canonical).toBe(prefix + suffix.replace(/\r\n/g, "\n"));
      act(() =>
        current.surface.dispatchEvent(
          new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            key: "Enter",
          }),
        ),
      );
      const entered =
        prefix +
        (suffix.replace(/\r\n/g, "\n").length >= 2
          ? suffix.replace(/\r\n/g, "\n")
          : "\n\n");
      expect(documentOwner.getValue()).toBe(entered);
      await accept();
      assertGapCaret();
      const gapPoint = documentOwner.getSelection().start;
      const withZ = entered.slice(0, gapPoint) + "Z" + entered.slice(gapPoint);
      typeAtNativeCaret("Z");
      expect(documentOwner.getValue()).toBe(withZ);
      await accept();
      act(() =>
        current.surface.dispatchEvent(
          new InputEvent("beforeinput", {
            bubbles: true,
            cancelable: true,
            inputType: "historyUndo",
          }),
        ),
      );
      expect(documentOwner.getValue()).toBe(entered);
      await accept();
      assertGapCaret();
      act(() =>
        current.surface.dispatchEvent(
          new InputEvent("beforeinput", {
            bubbles: true,
            cancelable: true,
            inputType: "historyRedo",
          }),
        ),
      );
      expect(documentOwner.getValue()).toBe(withZ);
      await accept();
      act(() =>
        current.surface.dispatchEvent(
          new InputEvent("beforeinput", {
            bubbles: true,
            cancelable: true,
            inputType: "historyUndo",
          }),
        ),
      );
      expect(documentOwner.getValue()).toBe(entered);
      await accept();
      assertGapCaret();
      typeAtNativeCaret("Q");
      expect(fixture.onFailure).not.toHaveBeenCalled();
      expect(fixture.onDiagnostic).not.toHaveBeenCalled();
      expect(onTransferFailure).not.toHaveBeenCalled();
      expect(documentOwner.getValue()).toBe(
        entered.slice(0, gapPoint) + "Q" + entered.slice(gapPoint),
      );
      await accept();
      expect(fixture.onFailure).not.toHaveBeenCalled();
      expect(fixture.onDiagnostic).not.toHaveBeenCalled();
      expect(onTransferFailure).not.toHaveBeenCalled();
    } finally {
      fixture.setUpdateVisual(null);
      view.unmount();
      view = null;
      current.unmount();
      fixture.cleanup();
    }
  },
);

function createEditorMarkdownBlockIndex(
  source: string,
  options: Parameters<typeof createProfiledMarkdownBlockIndex>[1] = {
    referenceLabelCaseFoldProfile: 14,
  },
) {
  return createProfiledMarkdownBlockIndex(source, options);
}

it("preserves an ordinary text caret through a windowed preview replacement", async () => {
  const markdown = Array.from({ length: 320 }, (_, index) =>
    index === 5 ? "### Heading" : `Paragraph ${index}`,
  ).join("\n\n");
  const fixture = await openWindowedOwner({ initialMarkdown: markdown });
  try {
    const root = fixture.current.surface.querySelector(
      '[data-easymde-visual-block-id="b5"]',
    );
    const text = root?.firstChild;
    if (!(root instanceof HTMLHeadingElement) || !(text instanceof Text)) {
      throw new Error("ordinary-handoff-heading-missing");
    }
    fixture.current.surface.tabIndex = 0;
    fixture.current.surface.focus();
    window.getSelection()?.collapse(text, 2);
    const signature = "ordinary-handoff-next";
    fixture.current.session.schedule(request(markdown, signature), true);
    const response = fixture.current.responses.at(-1);
    if (!response) throw new Error("ordinary-handoff-response-missing");
    const next = gapLeasePreview(markdown, signature);
    const template = document.createElement("template");
    template.innerHTML = next.html;
    const candidate = template.content.querySelector(
      '[data-easymde-visual-block-id="b5"]',
    );
    if (!(candidate instanceof HTMLHeadingElement)) {
      throw new Error("ordinary-handoff-candidate-missing");
    }
    candidate.innerHTML = `<span>${candidate.textContent ?? ""}</span>`;
    await act(async () => {
      response.resolve({
        html: template.innerHTML as SafePreviewHtml,
        features: {},
        editMap: next.editMap,
      });
    });
    await fixture.settle();
    const replaced = fixture.current.surface.querySelector(
      '[data-easymde-visual-block-id="b5"]',
    );
    const replacedText = replaced?.querySelector("span")?.firstChild;
    const native = window.getSelection();
    expect(replaced).toBeInstanceOf(HTMLHeadingElement);
    expect(replacedText).toBeInstanceOf(Text);
    expect(native?.isCollapsed).toBe(true);
    expect(native?.anchorNode).toBe(replacedText);
    expect(native?.anchorOffset).toBe(2);
    expect(fixture.onFailure).not.toHaveBeenCalled();
    expect(fixture.onDiagnostic).not.toHaveBeenCalled();
  } finally {
    fixture.cleanup();
  }
});

/**
 * The handoff an installed empty (paper) presentation shares with a non-empty
 * history request.
 *
 * The owner keeps `state.html` empty while its surface already holds the
 * accepted empty presentation, so `stageCandidate` hands the sink a
 * pre-acceptance "first paint" commit built from the server nodes alongside
 * `phase: "enhancing"` (the pre-acceptance branch, `PreviewSurfaceOwner.tsx`
 * `stagedCommit: !hasCurrentHtml && !windowedFirstPaint ? ...`). That frame is
 * not an accepted render: it must not replace the presentation the editor's
 * `assertPendingInputDom` still certifies, and the history operation that is
 * pending over it must still reach the canonical writer.
 *
 * The chain only uses the product's own paths: the empty-source request is the
 * real `kind: "empty"` branch, the non-empty request is issued by
 * `runHistory`'s own `requestPreview`, and the write is the editor's own
 * `historyUndo`. The transfer reaches the retained sub-branch of
 * `assertPendingInputDom` because `runHistory` published it with
 * `retainedHistoryPresentation` (the empty ledger) before its undo/redo write.
 */
describe("PreviewSurfaceOwner installed empty presentation across a first-paint history render", () => {
  it.each(["historyUndo", "insertText"] as const)(
    "keeps the accepted empty presentation while the non-empty history render is staging and lets the next %s write",
    async (nextInput) => {
      // The empty document carries no history. The chain's single undo entry is
      // created by the document session's own writer, the same call the editor
      // uses, so the premise is a real write and is asserted rather than
      // assumed from the fixture's initial value.
      const document = markdownDocumentSource("");
      document.owner.applyTextChange({
        changes: { from: 0, insert: "Z", to: 0 },
        selection: { direction: "none", end: 1, start: 1 },
        value: "Z",
      });
      expect(document.owner.getHistoryState()).toEqual({
        redoDepth: 0,
        undoDepth: 1,
      });
      const acceptedEditMap: PreviewEditMap = {
        blocks: [{ editable: true, endLine: 1, id: "b0", startLine: 0 }],
        coordinate: "line",
        signature: "initial",
        version: 1,
      };
      // The three channels EditorRoot publishes. Their callback identities must be
      // stable: the Full owner's mount effect depends on them and its cleanup
      // calls onPendingChange(false) unconditionally, so a fresh callback per
      // render would tear the effect down and feed another render back in.
      // EditorRoot replaces this state object on every publication; a
      // status/pending-only update keeps reusing it.
      let snapshot: VisualPreviewSnapshot = {
        editMap: acceptedEditMap,
        revision: 0,
        signature: "",
      };
      let status: PreviewSurfaceStatus = "loading";
      let pending = false;
      let editorRuntime: ImmersiveVisualEditorRuntime | null = null;
      let editorView: RenderResult | null = null;
      let disposed = false;
      let visualUpdateQueued = false;
      let requestVisualUpdate: (() => void) | null = null;
      const diagnostics: string[] = [];
      const failure = vi.fn();
      const transferFailure = vi.fn();
      const onDispose = vi.fn();
      const onMarkdownChange = vi.fn();
      const onCanonicalDocumentChange = vi.fn();
      const onEditorDiagnostic = vi.fn();
      // A re-armable suspension of the real enhancement: every superseding
      // candidate must be observed while its pre-acceptance frame exists, so the
      // hold is armed per candidate instead of once.
      let activeHold: Promise<void> | null = null;
      let releaseHold: (() => void) | null = null;
      const enhance = vi.fn(() => activeHold ?? Promise.resolve());
      const armEnhancementHold = (): void => {
        const hold = deferred<void>();
        activeHold = hold.promise;
        releaseHold = () => hold.resolve();
      };
      const releaseEnhancementHold = (): void => {
        releaseHold?.();
        activeHold = null;
        releaseHold = null;
      };
      // Re-render only when a channel value actually changes, and never after
      // teardown: an unchanged publication or a cleanup-time pending(false) must
      // not loop back through the owner.
      const publishSnapshot = (
        _html: SafePreviewHtml,
        signature: string,
        editMap: PreviewEditMap | null,
      ): void => {
        snapshot = { editMap, revision: snapshot.revision + 1, signature };
        requestVisualUpdate?.();
      };
      const publishStatus = (next: PreviewSurfaceStatus): void => {
        if (next === status) return;
        status = next;
        requestVisualUpdate?.();
      };
      const changePending = (next: boolean): void => {
        if (next === pending) return;
        pending = next;
        requestVisualUpdate?.();
      };
      const onEditorReady = (runtime: ImmersiveVisualEditorRuntime): void => {
        editorRuntime = runtime;
      };
      const current = setup({
        contentEditable: true,
        emptyMode: "paper",
        currentSourceSnapshot: () => ({
          revision: document.owner.getRevision?.() ?? 0,
          value: document.owner.getValue(),
        }),
        enhance,
        initialEditMap: acceptedEditMap,
        initialHtml: '<p data-easymde-visual-block-id="b0">Z</p>',
        initialSignature: "initial",
        onDiagnostic: (code: string) => diagnostics.push(code),
        onSnapshotReady: publishSnapshot,
        onStatusChange: publishStatus,
        sourceRevision: document.owner.getRevision?.() ?? 0,
      });
      const requestPreview = (markdown: string) => {
        const signature = `accepted-history:${markdown}`;
        current.session.schedule(request(markdown, signature), true);
        return signature;
      };
      const retainCompositionSurface = () =>
        current.runtime.retainCompositionSurface();
      // `isTransferPending` belongs to the Full owner's runtime, not the Preview
      // owner's runtime; it is captured from the editor's own onReady.
      const isTransferPending = (): boolean =>
        editorRuntime?.isTransferPending() ?? false;
      try {
        await waitFor(() => expect(status).toBe("ready"));
        expect(snapshot.signature).toBe("initial");
        const editor = () => (
          <ImmersiveVisualEditor
            documentSession={document.session}
            imagePasteUploadEnabled={false}
            imageUploadEnabled={false}
            onCanonicalDocumentChange={onCanonicalDocumentChange}
            onDiagnostic={onEditorDiagnostic}
            onDispose={onDispose}
            onFailure={failure}
            onMarkdownChange={onMarkdownChange}
            onPendingChange={changePending}
            onReady={onEditorReady}
            onTransferFailure={transferFailure}
            pending={pending}
            previewSnapshot={snapshot}
            previewStatus={status}
            referenceLabelCaseFoldProfile={14}
            requestPreview={requestPreview}
            retainCompositionSurface={retainCompositionSurface}
            surface={current.surface}
          />
        );
        editorView = render(editor());
        requestVisualUpdate = () => {
          if (disposed || visualUpdateQueued || !editorView) return;
          visualUpdateQueued = true;
          queueMicrotask(() => {
            visualUpdateQueued = false;
            if (!disposed && editorView) editorView.rerender(editor());
          });
        };
        await act(async () => {
          for (let index = 0; index < 8; index += 1) {
            await Promise.resolve();
          }
        });
        expect(document.owner.getValue()).toBe("Z");
        expect(current.surface.textContent).toBe("Z");

        // 1. Undo to the empty source. The real empty-source request is the
        //    paper placeholder, so it accepts without a port render.
        await act(async () => {
          current.surface.dispatchEvent(
            new InputEvent("beforeinput", {
              bubbles: true,
              cancelable: true,
              inputType: "historyUndo",
            }),
          );
          for (let index = 0; index < 16; index += 1) {
            await Promise.resolve();
          }
        });
        expect(document.owner.getValue()).toBe("");
        expect(current.renderPreview).not.toHaveBeenCalled();
        // The empty paper render must now be installed: this is the paper
        // placeholder the editor can edit, with no edit map and no port render.
        expect(status).toBe("ready");
        expect(snapshot.signature).toBe("accepted-history:");
        expect(snapshot.editMap).toBeNull();
        expect(isTransferPending()).toBe(false);
        expect(current.surface.childNodes).toHaveLength(1);
        expect(current.surface.textContent).toBe("");
        const acceptedEmptyParagraph = current.surface.firstChild;
        if (!(acceptedEmptyParagraph instanceof HTMLParagraphElement)) {
          throw new Error("accepted-empty-presentation-missing");
        }

        // 2. Redo to the non-empty history target. The owner still holds the
        //    empty placeholder, so this render is the pre-acceptance frame.
        armEnhancementHold();
        await act(async () => {
          current.surface.dispatchEvent(
            new InputEvent("beforeinput", {
              bubbles: true,
              cancelable: true,
              inputType: "historyRedo",
            }),
          );
          for (let index = 0; index < 16; index += 1) {
            await Promise.resolve();
          }
        });
        expect(document.owner.getValue()).toBe("Z");
        await waitFor(() =>
          expect(current.renderPreview).toHaveBeenCalledTimes(1),
        );
        expect(current.renderPreview.mock.calls[0]?.[0]?.markdown).toBe("Z");
        const signatureBeforeStaging = snapshot.signature;
        await act(async () => {
          current.responses[0]?.resolve({
            editMap: {
              ...acceptedEditMap,
              signature: "accepted-history:Z",
            },
            features: {},
            html: '<p data-easymde-visual-block-id="b0">Z</p>' as SafePreviewHtml,
          });
          for (let index = 0; index < 20; index += 1) {
            await Promise.resolve();
          }
        });
        // The frame the history render has not accepted must not replace the
        // presentation the editor still certifies.
        expect(current.surface.childNodes).toHaveLength(1);
        expect(current.surface.firstChild).toBe(acceptedEmptyParagraph);
        expect(current.surface.textContent).toBe("");
        expect(current.surface.dataset.easymdePreviewPhase).not.toBe("ready");
        // v6 recorded the editor's memoized `previewStatus` as "loading" while
        // the un-accepted frame owned the surface; the synced channel must say
        // the same here.
        expect(status).toBe("loading");
        expect(isTransferPending()).toBe(true);
        // The unaccepted staging frame must not publish over the paper's
        // installed state.
        expect(snapshot.signature).toBe(signatureBeforeStaging);
        expect(failure).not.toHaveBeenCalled();
        expect(transferFailure).not.toHaveBeenCalled();

        // 3. The pending history lease is proved against the retained ledger
        //    and the next operation reaches the canonical writer. The
        //    insertText case arrives on the same retained sole-BR paragraph,
        //    with the browser's own caret after the BR.
        if ("insertText" === nextInput) {
          const targetRange = current.surface.ownerDocument.createRange();
          targetRange.setStart(acceptedEmptyParagraph, 0);
          targetRange.setEnd(acceptedEmptyParagraph, 0);
          const insert = new InputEvent("beforeinput", {
            bubbles: true,
            cancelable: true,
            data: "B",
            inputType: "insertText",
          });
          Object.defineProperty(insert, "getTargetRanges", {
            value: () => [targetRange],
          });
          expect(current.surface.firstElementChild).toBe(
            acceptedEmptyParagraph,
          );
          expect(acceptedEmptyParagraph.firstChild).toBeInstanceOf(
            HTMLBRElement,
          );
          await act(async () => {
            window.getSelection()?.collapse(acceptedEmptyParagraph, 1);
            current.surface.dispatchEvent(insert);
            for (let index = 0; index < 16; index += 1) {
              await Promise.resolve();
            }
          });
          expect(insert.defaultPrevented).toBe(true);
          expect(document.owner.getValue()).toBe("ZB");
          expect(document.owner.getSelection()).toEqual({
            direction: "none",
            end: 2,
            start: 2,
          });
          expect(failure).not.toHaveBeenCalled();
          expect(transferFailure).not.toHaveBeenCalled();
          expect(current.surface.firstElementChild).toBe(
            acceptedEmptyParagraph,
          );
          expect(snapshot.signature).toBe(signatureBeforeStaging);
        } else {
          await act(async () => {
            current.surface.dispatchEvent(
              new InputEvent("beforeinput", {
                bubbles: true,
                cancelable: true,
                inputType: "historyUndo",
              }),
            );
            for (let index = 0; index < 16; index += 1) {
              await Promise.resolve();
            }
          });
          expect(document.owner.getValue()).toBe("");
          expect(failure).not.toHaveBeenCalled();
          expect(transferFailure).not.toHaveBeenCalled();
          expect(snapshot.signature).toBe("accepted-history:");
          expect(isTransferPending()).toBe(false);
          expect(current.surface.childNodes).toHaveLength(1);
        }

        // 4. The first candidate is now stale; releasing it must not install,
        //    publish or fail. The accepted empty presentation stands.
        const acceptedEmptyParagraphAfterUndo = current.surface.firstChild;
        await act(async () => {
          releaseEnhancementHold();
          for (let index = 0; index < 20; index += 1) {
            await Promise.resolve();
          }
        });
        // A released, superseded candidate must not install anything.
        expect(snapshot.signature).toBe(
          "insertText" === nextInput
            ? signatureBeforeStaging
            : "accepted-history:",
        );
        expect(current.surface.childNodes).toHaveLength(1);
        expect(current.surface.textContent).toBe("");
        expect(failure).not.toHaveBeenCalled();
        expect(transferFailure).not.toHaveBeenCalled();

        // 5. A second, superseding history request must be qualified the same
        //    way: its pre-acceptance frame must not replace the accepted
        //    presentation either, and then the real committing frame takes it.
        armEnhancementHold();
        await act(async () => {
          current.surface.dispatchEvent(
            new InputEvent("beforeinput", {
              bubbles: true,
              cancelable: true,
              inputType: "historyRedo",
            }),
          );
          for (let index = 0; index < 16; index += 1) {
            await Promise.resolve();
          }
        });
        if ("insertText" === nextInput) {
          expect(document.owner.getValue()).toBe("ZB");
          expect(current.renderPreview).toHaveBeenCalledTimes(2);
        } else {
          expect(document.owner.getValue()).toBe("Z");
          await waitFor(() =>
            expect(current.renderPreview).toHaveBeenCalledTimes(2),
          );
        }
        const signatureBeforeSecondStaging = snapshot.signature;
        await act(async () => {
          current.responses[1]?.resolve(
            "insertText" === nextInput
              ? {
                  editMap: {
                    ...acceptedEditMap,
                    signature: "accepted-history:ZB",
                  },
                  features: {},
                  html: '<p data-easymde-visual-block-id="b0">ZB</p>' as SafePreviewHtml,
                }
              : {
                  editMap: {
                    ...acceptedEditMap,
                    signature: "accepted-history:Z",
                  },
                  features: {},
                  html: '<p data-easymde-visual-block-id="b0">Z</p>' as SafePreviewHtml,
                },
          );
          for (let index = 0; index < 20; index += 1) {
            await Promise.resolve();
          }
        });
        expect(current.surface.childNodes).toHaveLength(1);
        expect(current.surface.firstChild).toBe(
          acceptedEmptyParagraphAfterUndo,
        );
        expect(status).toBe("loading");
        expect(isTransferPending()).toBe(true);
        //             The unaccepted staging frame must not publish over the paper's
        //             installed state.
        expect(snapshot.signature).toBe(signatureBeforeSecondStaging);
        await act(async () => {
          releaseEnhancementHold();
          for (let index = 0; index < 20; index += 1) {
            await Promise.resolve();
          }
        });
        await waitFor(() =>
          expect(snapshot.signature).toBe(
            "insertText" === nextInput
              ? "accepted-history:ZB"
              : "accepted-history:Z",
          ),
        );
        expect(isTransferPending()).toBe(false);
        expect(pending).toBe(false);
        expect(status).toBe("ready");
        expect(
          current.surface.querySelector('[data-easymde-visual-block-id="b0"]'),
        ).not.toBeNull();
        expect(current.surface.textContent).toBe(
          "insertText" === nextInput ? "ZB" : "Z",
        );
        expect(failure).not.toHaveBeenCalled();
        expect(transferFailure).not.toHaveBeenCalled();
        expect(
          diagnostics.filter((code) => code.includes("dom-stale")),
        ).toEqual([]);
      } finally {
        disposed = true;
        releaseEnhancementHold();
        editorView?.unmount();
        editorView = null;
        current.unmount();
        document.session.destroy();
        document.container.remove();
        document.submissionField.remove();
      }
    },
  );
});

describe("PreviewSurfaceOwner steady-state windowed adoption invariants", () => {
  it("tracks exact shifted source ranges across consecutive and cross-block adoptions and rejects stale source witnesses", async () => {
    const geometry = installSequenceGeometry();
    const fixture = windowedFixture(320, "delta-shift-witness");
    const initialBlocks = Array.from({ length: 320 }, (_, index) => `b${index}`);
    let currentSource = initialBlocks.join("\n\n");
    let currentRevision = 0;
    const current = setup({
      contentEditable: true,
      currentSourceSnapshot: () => ({
        revision: currentRevision,
        value: currentSource,
      }),
      initialEditMap: fixture.editMap,
      initialHtml: fixture.html,
      initialSignature: fixture.editMap.signature,
      sourceRevision: 0,
      stagingScheduler: { yield: () => Promise.resolve() },
      windowed: true,
    });
    geometry.attach(current.canvas, current.surface);
    try {
      await act(async () => {
        for (let index = 0; index < 16; index += 1) await Promise.resolve();
        await flushAnimationFrames(12);
      });
      const b0 = current.surface.querySelector<HTMLElement>(
        '[data-easymde-visual-block-id="b0"]',
      );
      const b1 = current.surface.querySelector<HTMLElement>(
        '[data-easymde-visual-block-id="b1"]',
      );
      const b2 = current.surface.querySelector<HTMLElement>(
        '[data-easymde-visual-block-id="b2"]',
      );
      if (!b0 || !b1 || !b2) throw new Error("delta-shift-blocks-missing");

      const adoptLocalEdit = (
        target: HTMLElement,
        blockIndex: number,
        nextText: string,
      ): void => {
        const blocks = [...initialBlocks];
        blocks[blockIndex] = nextText;
        initialBlocks[blockIndex] = nextText;
        target.textContent = nextText;
        currentSource = blocks.join("\n\n");
        currentRevision += 1;
        const finalize = current.runtime.prepareWindowBlockAdoption(target);
        expect(finalize).not.toBeNull();
        expect(finalize?.()).toBe(true);
      };

      // Consecutive growing and shrinking edits on b0 (shift coalescing)
      adoptLocalEdit(b0, 0, "b0-extended-1");
      adoptLocalEdit(b0, 0, "b0-extended-12345");
      adoptLocalEdit(b0, 0, "b0-short");

      // Cross-block edit on b1 (must see exact coalesced shift from b0)
      adoptLocalEdit(b1, 1, "b1-after-b0-edits");

      // Return to b0 after cross-block edit (non-coalesced stacked shift)
      adoptLocalEdit(b0, 0, "b0-final-length-update");

      // Edit b2 (must see combined shifts from both b0 edits and b1 edit)
      adoptLocalEdit(b2, 2, "b2-shifted-exact");

      // Stale witness mutating outside b1's shifted range must fail closed
      const tamperedSource = currentSource.replace(
        "b2-shifted-exact",
        "b2-TAMPERED",
      );
      const previousSource = currentSource;
      const previousRevision = currentRevision;
      currentSource = tamperedSource;
      currentRevision += 1;
      const staleFinalize = current.runtime.prepareWindowBlockAdoption(b1);
      expect(staleFinalize).not.toBeNull();
      expect(() => staleFinalize?.()).toThrow(
        "preview-window-local-source-witness-stale",
      );
      currentSource = previousSource;
      currentRevision = previousRevision;

      // Formal preview matching final source with caret inside b1 must reuse
      // the surviving b1 root cleanly using its exact shifted source range.
      current.surface.tabIndex = 0;
      current.surface.focus();
      const b1Text = b1.firstChild;
      if (!(b1Text instanceof Text)) throw new Error("delta-shift-b1-text");
      window.getSelection()?.collapse(b1Text, b1Text.length);
      const nextSignature = "delta-shift-formal";
      const nextPreview = gapLeasePreview(currentSource, nextSignature);
      act(() =>
        current.session.schedule(request(currentSource, nextSignature), true),
      );
      await act(async () => {
        current.responses[0]?.resolve({ ...nextPreview, features: {} });
        for (let index = 0; index < 32; index += 1) await Promise.resolve();
        await flushAnimationFrames(12);
      });
      const accepted = current.runtime.getAcceptedWindowSnapshot();
      expect(accepted?.signature).toBe(nextSignature);
      expect(accepted?.blocks.find((block) => block.id === "b1")?.node).toBe(b1);
      expect(
        accepted?.blocks.find((block) => block.id === "b1")?.innerHTML,
      ).toBe("b1-after-b0-edits");
      expect(current.onDiagnostic).not.toHaveBeenCalled();
    } finally {
      current.unmount();
      geometry.restore();
    }
  });

  it("defers adopted block layout measurement off the synchronous keystroke path while still failing closed on mounted tampering", async () => {
    const geometry = installSequenceGeometry();
    const fixture = windowedFixture(320, "deferred-adoption-measure");
    const markdown = Array.from(
      { length: 320 },
      (_, index) => `b${index}`,
    ).join("\n\n");
    let currentSource = markdown;
    let currentRevision = 0;
    const current = setup({
      contentEditable: true,
      currentSourceSnapshot: () => ({
        revision: currentRevision,
        value: currentSource,
      }),
      initialEditMap: fixture.editMap,
      initialHtml: fixture.html,
      initialSignature: fixture.editMap.signature,
      sourceRevision: 0,
      stagingScheduler: { yield: () => Promise.resolve() },
      windowed: true,
    });
    geometry.attach(current.canvas, current.surface);
    try {
      await act(async () => {
        for (let index = 0; index < 16; index += 1) await Promise.resolve();
        await flushAnimationFrames(12);
      });
      const b0 = current.surface.querySelector<HTMLElement>(
        '[data-easymde-visual-block-id="b0"]',
      );
      const b1 = current.surface.querySelector<HTMLElement>(
        '[data-easymde-visual-block-id="b1"]',
      );
      if (!b0 || !b1) throw new Error("deferred-measure-blocks-missing");

      // Count getBoundingClientRect calls on b0 during synchronous keystroke adoption.
      const protoRectSpy = vi.mocked(HTMLElement.prototype.getBoundingClientRect);
      const callsBefore = protoRectSpy.mock.calls.length;
      b0.textContent = "b0 edited";
      currentSource = currentSource.replace("b0", "b0 edited");
      currentRevision += 1;
      const finalize = current.runtime.prepareWindowBlockAdoption(b0);
      expect(finalize).not.toBeNull();
      expect(finalize?.()).toBe(true);
      // Zero forced synchronous layout reads during prepare/finalize!
      expect(protoRectSpy.mock.calls.length).toBe(callsBefore);

      // Flushing animation frames performs the deferred measurement cleanly.
      await act(async () => {
        await flushAnimationFrames(4);
      });
      expect(protoRectSpy.mock.calls.length).toBeGreaterThan(callsBefore);
      expect(current.onDiagnostic).not.toHaveBeenCalled();

      // Tampering with a mounted sibling's block id still fails closed.
      b1.setAttribute("data-easymde-visual-block-id", "tampered-id");
      expect(current.runtime.prepareWindowBlockAdoption(b0)).toBeNull();
      b1.setAttribute("data-easymde-visual-block-id", "b1");
      expect(current.runtime.prepareWindowBlockAdoption(b0)).not.toBeNull();
    } finally {
      current.unmount();
      geometry.restore();
    }
  });

  it("clears stale windowed blocks and spacers synchronously when an editable paper surface becomes empty", async () => {
    const geometry = installSequenceGeometry();
    const fixture = windowedFixture(320, "editable-windowed-to-empty");
    const snapshots: Array<
      Readonly<{
        editMap: PreviewEditMap | null;
        html: SafePreviewHtml;
        signature: string;
      }>
    > = [];
    const current = setup({
      contentEditable: true,
      emptyMode: "paper",
      initialEditMap: fixture.editMap,
      initialHtml: fixture.html,
      initialSignature: fixture.editMap.signature,
      onSnapshotReady: (html, signature, editMap) => {
        snapshots.push({ editMap, html, signature });
      },
      stagingScheduler: { now: () => 0, yield: () => Promise.resolve() },
      windowed: true,
    });
    geometry.attach(current.canvas, current.surface);
    try {
      await act(async () => {
        for (let index = 0; index < 16; index += 1) await Promise.resolve();
        await flushAnimationFrames(12);
      });
      expect(
        current.surface.querySelector("[data-easymde-preview-window-spacer]"),
      ).not.toBeNull();
      expect(
        current.surface.querySelectorAll("[data-easymde-visual-block-id]")
          .length,
      ).toBeGreaterThan(0);

      act(() => {
        current.session.schedule(request("", "accepted-empty-after-window"), true);
      });

      expect(current.surface.childNodes).toHaveLength(0);
      expect(current.surface.innerHTML).toBe("");
      expect(
        current.surface.querySelector("[data-easymde-preview-window-spacer]"),
      ).toBeNull();
      expect(current.surface.getAttribute("data-easymde-preview-phase")).toBe(
        "ready",
      );
      expect(snapshots.at(-1)).toEqual({
        editMap: null,
        html: safeHtml(""),
        signature: "accepted-empty-after-window",
      });
      expect(current.onDiagnostic).not.toHaveBeenCalled();
    } finally {
      current.unmount();
      geometry.restore();
    }
  });

  it("keeps large non-windowed preview candidates detached during enhancement and skips candidate innerHTML serialization", async () => {
    const fixture = windowedFixture(200, "large-non-windowed-preview");
    const enhancement = deferred<void>();
    const enhancementStarted = deferred<HTMLElement>();
    const htmlChanges: SafePreviewHtml[] = [];
    const enhance = vi.fn<PreviewEnhancementPort["enhance"]>((candidate) => {
      candidate
        .querySelector('[data-easymde-visual-block-id="b199"]')
        ?.setAttribute("data-enhanced", "1");
      enhancementStarted.resolve(candidate);
      return enhancement.promise;
    });
    const current = setup({
      enhance,
      initialHtml: "",
      onHtmlChange: (html) => htmlChanges.push(html),
      stagingScheduler: { now: () => 0, yield: () => Promise.resolve() },
      windowed: false,
    });
    try {
      act(() => {
        current.session.schedule(
          request("# Large Preview", fixture.editMap.signature),
          true,
        );
      });
      let candidate!: HTMLElement;
      await act(async () => {
        current.responses[0]?.resolve({
          editMap: fixture.editMap,
          features: {},
          html: fixture.html,
        });
        await Promise.resolve();
      });
      await act(async () => {
        candidate = await enhancementStarted.promise;
      });

      expect(candidate.isConnected).toBe(false);
      expect(candidate.style.display).toBe("none");
      expect(
        current.canvas.querySelectorAll("[data-easymde-preview-staging]"),
      ).toHaveLength(0);
      expect(
        current.surface.querySelectorAll("[data-easymde-visual-block-id]"),
      ).toHaveLength(0);

      const innerHtmlGetter = vi.spyOn(candidate, "innerHTML", "get");
      await act(async () => {
        enhancement.resolve();
        await enhancement.promise;
        for (let index = 0; index < 8; index += 1) await Promise.resolve();
      });

      expect(innerHtmlGetter).not.toHaveBeenCalled();
      expect(
        current.surface.querySelectorAll("[data-easymde-visual-block-id]"),
      ).toHaveLength(200);
      expect(
        current.surface
          .querySelector('[data-easymde-visual-block-id="b199"]')
          ?.getAttribute("data-enhanced"),
      ).toBe("1");
      expect(htmlChanges).toEqual([fixture.html]);
      expect(current.surface.easymdePreviewSignature).toBe(
        fixture.editMap.signature,
      );
      innerHtmlGetter.mockRestore();
    } finally {
      current.unmount();
    }
  });

  it("retains the accepted bounded window and stays contentEditable when a superseding candidate fails enhancement in windowed paper mode", async () => {
    const geometry = installSequenceGeometry();
    const initial = windowedFixture(320, "paper-window-initial");
    const broken = windowedFixture(320, "paper-window-broken-mermaid");
    const statuses: PreviewSurfaceStatus[] = [];
    let failNextEnhancement = false;
    const enhance = vi.fn<PreviewEnhancementPort["enhance"]>(async () => {
      if (failNextEnhancement) {
        throw new Error("preview-enhancement-render-failed");
      }
    });
    const current = setup({
      contentEditable: true,
      emptyMode: "paper",
      enhance,
      initialEditMap: initial.editMap,
      initialHtml: initial.html,
      initialSignature: initial.editMap.signature,
      onStatusChange: (status) => statuses.push(status),
      stagingScheduler: { now: () => 0, yield: () => Promise.resolve() },
      windowed: true,
    });
    try {
      geometry.attach(current.canvas, current.surface);
      await act(async () => {
        for (let index = 0; index < 32; index += 1) await Promise.resolve();
        await flushAnimationFrames();
      });
      expect(current.surface.getAttribute("contenteditable")).toBe("true");
      expect(
        current.surface.querySelector("[data-easymde-preview-window-spacer]"),
      ).not.toBeNull();
      const mountedBefore = current.surface.querySelectorAll(
        "[data-easymde-visual-block-id]",
      ).length;
      expect(mountedBefore).toBeGreaterThan(0);
      expect(mountedBefore).toBeLessThanOrEqual(160);

      failNextEnhancement = true;
      act(() => {
        current.session.schedule(
          request("```mermaid\ngraph LR\n  A -->", broken.editMap.signature),
          true,
        );
      });
      await act(async () => {
        current.responses[0]?.resolve({
          editMap: broken.editMap,
          features: { mermaid: true },
          html: broken.html,
        });
        for (let index = 0; index < 32; index += 1) await Promise.resolve();
        await flushAnimationFrames();
      });

      expect(current.onDiagnostic).toHaveBeenCalledWith(
        "preview-enhancement-render-failed",
      );
      expect(statuses.at(-1)).toBe("error");
      expect(current.surface.getAttribute("contenteditable")).toBe("true");
      expect(
        current.surface.querySelector("[data-easymde-preview-window-spacer]"),
      ).not.toBeNull();
      expect(
        current.surface.querySelectorAll("[data-easymde-visual-block-id]")
          .length,
      ).toBe(mountedBefore);

      // A subsequent loading transition clears any prior failure state cleanly.
      failNextEnhancement = false;
      act(() => {
        current.session.schedule(
          request("```mermaid\ngraph LR\n  A --> B\n```", "paper-window-recovered"),
          true,
        );
      });
      expect(statuses.at(-1)).toBe("loading");
      expect(current.surface.getAttribute("contenteditable")).toBe("true");
      expect(
        current.surface.querySelector("[data-easymde-preview-window-spacer]"),
      ).not.toBeNull();
    } finally {
      current.unmount();
      geometry.restore();
    }
  });
});
