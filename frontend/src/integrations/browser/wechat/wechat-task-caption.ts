import {
  GENERATED_PSEUDO_CLONE_OWNERS,
  TASK_LIST_CHECKBOX_CLONES,
  THEME_IMAGE_CLONE_OWNERS,
  THEME_IMAGE_CLONES,
  type WechatThemeImageClone
} from './wechat-clone-metadata';
import type { BrowserWechatClipboardRuntime } from './wechat-clipboard-runtime';
import { isPreviewHidden } from './wechat-preview-measurement';

export type TaskCheckboxCaptionTextBinding = {
  cloneAncestors: readonly Element[];
  cloneParent: Element;
  cloneText: Text;
  encoded: string;
  glyph: boolean;
  layoutText: Text;
  original: string;
  prefixLength: number;
  sourceText: Text | null;
  glyphOffset: number;
};

export type TaskCheckboxCaptionSequenceEntry = Readonly<{
  element: Element | null;
  glyph: boolean;
  glyphOffset: number;
  kind: 'enter' | 'exit' | 'text';
  path: readonly number[];
  prefixLength: number;
  text: Text | null;
  value: string;
}>;

export type TaskCheckboxCaptionSequence = Readonly<{
  captionParent: Element;
  entries: readonly TaskCheckboxCaptionSequenceEntry[];
  glyphEntry: TaskCheckboxCaptionSequenceEntry;
  prefixEntries: readonly TaskCheckboxCaptionSequenceEntry[];
  taskItem: Element;
}>;

export type TaskCheckboxCaptionRunEvent =
  | Readonly<{ cloneElement: Element; kind: 'enter' | 'exit'; path: readonly number[] }>
  | Readonly<{ binding: TaskCheckboxCaptionTextBinding; kind: 'text'; path: readonly number[] }>;

export type TaskCheckboxCaptionRun = {
  cloneCaptionParent: Element;
  cloneEvents: readonly TaskCheckboxCaptionRunEvent[];
  cloneOwner: Element;
  cloneTaskItem: Element;
  layoutCaptionParent: Element;
  layoutOwner: HTMLInputElement;
  layoutTaskItem: Element;
  sourceCaptionParent: Element;
  sourceOwner: HTMLInputElement;
  sourceTaskItem: Element;
  bindings: readonly TaskCheckboxCaptionTextBinding[];
};

export type TaskCheckboxCaptionTextBindingRef = Readonly<{
  binding: TaskCheckboxCaptionTextBinding;
  run: TaskCheckboxCaptionRun;
}>;

export type TaskCheckboxCaptionOwnerIdentity = Readonly<{
  cloneOwner: Element;
  clonePath: readonly number[];
  layoutInput: HTMLInputElement;
  layoutPath: readonly number[];
  sourceInput: HTMLInputElement;
  sourcePath: readonly number[];
}>;

export const TASK_LIST_CHECKBOX_CAPTION_RUNS = new WeakMap<Element, TaskCheckboxCaptionRun>();
export const TASK_LIST_CHECKBOX_CAPTION_RUN_BY_TEXT = new WeakMap<Text, TaskCheckboxCaptionTextBindingRef>();
export const TASK_LIST_CHECKBOX_CAPTION_TEXT_OWNERS = new WeakSet<Text>();
export const TASK_LIST_CHECKBOX_CAPTION_LEAF_WRAPPERS = new WeakSet<Element>();
export const TASK_LIST_CHECKBOX_CAPTION_MIGRATION_CANDIDATES = new WeakSet<Element>();
export const TASK_LIST_CHECKBOX_CAPTION_STRUCTURE_REPLACEMENTS = new WeakMap<Element, Element>();
export const TASK_LIST_CHECKBOX_CAPTION_OWNER_SEQUENCES = new WeakMap<
  Element,
  readonly TaskCheckboxCaptionOwnerIdentity[]
>();
export const TASK_CHECKBOX_CAPTION_ATOMIC_TAGS = new Set([
  'BR',
  'CANVAS',
  'EMBED',
  'IMG',
  'INPUT',
  'OBJECT',
  'SELECT',
  'SVG',
  'TEXTAREA',
  'VIDEO'
]);
export const TASK_CHECKBOX_CAPTION_BOUNDARY_TAGS = new Set(['LI', 'OL', 'UL']);
export const TASK_CHECKBOX_CAPTION_BOUNDARY_DISPLAYS = new Set([
  'block',
  'contents',
  'flow-root',
  'flex',
  'grid',
  'inline-flex',
  'list-item',
  'table',
  'table-cell',
  'table-row'
]);

export function taskCheckboxCaptionNodePath(ancestor: Node, target: Node): number[] | null {
  const path: number[] = [];
  let current: Node | null = target;
  while (current && current !== ancestor) {
    const parent: Node | null = current.parentNode;
    if (!parent) return null;
    const index = Array.from(parent.childNodes).indexOf(current as ChildNode);
    if (index < 0) return null;
    path.unshift(index);
    current = parent;
  }
  return current === ancestor ? path : null;
}

export function taskCheckboxCaptionNodeAtPath(ancestor: Node, path: readonly number[]): Node | null {
  let current: Node | null = ancestor;
  for (const index of path) {
    current = current?.childNodes.item(index) ?? null;
  }
  return current;
}

export function taskCheckboxCaptionWhitespaceSupported(
  element: Element,
  boundary: Element,
  runtime: BrowserWechatClipboardRuntime
): boolean {
  let current: Element | null = element;
  while (current) {
    const whitespace = runtime.getComputedStyle(current).getPropertyValue('white-space').trim().toLowerCase();
    if (whitespace && !['normal', 'nowrap'].includes(whitespace)) return false;
    if (current === boundary) break;
    current = current.parentElement;
  }
  return true;
}

export function taskCheckboxCaptionBoundary(
  element: Element,
  boundary: Element,
  runtime: BrowserWechatClipboardRuntime
): boolean {
  if (element !== boundary && TASK_CHECKBOX_CAPTION_BOUNDARY_TAGS.has(element.tagName)) return true;
  if (TASK_CHECKBOX_CAPTION_ATOMIC_TAGS.has(element.tagName)) return true;
  const display = runtime.getComputedStyle(element).getPropertyValue('display').trim().toLowerCase();
  return 'none' === display || TASK_CHECKBOX_CAPTION_BOUNDARY_DISPLAYS.has(display);
}

export function taskCheckboxCaptionAsciiPrefixLength(value: string): number {
  let length = 0;
  while (length < value.length && [' ', '\t', '\r', '\n', '\f'].includes(value[length] ?? '')) length += 1;
  return length;
}

export function taskCheckboxCaptionSequence(
  start: Element,
  runtime: BrowserWechatClipboardRuntime
): TaskCheckboxCaptionSequence | null {
  const parent = start.parentElement;
  if (!parent) return null;
  const startIndex = Array.from(parent.childNodes).indexOf(start);
  if (startIndex < 0) return null;
  const entries: TaskCheckboxCaptionSequenceEntry[] = [];
  const prefixEntries: TaskCheckboxCaptionSequenceEntry[] = [];
  let glyphEntry: TaskCheckboxCaptionSequenceEntry | null = null;

  const visit = (node: Node): 'continue' | 'found' | 'blocked' => {
    if (node.nodeType === 3) {
      const text = node as Text;
      if (text.parentElement && !taskCheckboxCaptionWhitespaceSupported(text.parentElement, parent, runtime)) {
        return 'blocked';
      }
      const value = text.nodeValue ?? '';
      if (!value) {
        const path = taskCheckboxCaptionNodePath(parent, text);
        if (!path) throw new Error('wechat-task-checkbox-caption-text-alignment-failed');
        entries.push({
          element: null,
          glyph: false,
          glyphOffset: 0,
          kind: 'text',
          path,
          prefixLength: 0,
          text,
          value
        });
        return 'continue';
      }
      const prefixLength = taskCheckboxCaptionAsciiPrefixLength(value);
      if (prefixLength === value.length) {
        if (!prefixLength) return 'continue';
        const path = taskCheckboxCaptionNodePath(parent, text);
        if (!path) throw new Error('wechat-task-checkbox-caption-text-alignment-failed');
        const entry: TaskCheckboxCaptionSequenceEntry = {
          element: null,
          glyph: false,
          glyphOffset: 0,
          kind: 'text',
          path,
          prefixLength,
          text,
          value
        };
        entries.push(entry);
        prefixEntries.push(entry);
        return 'continue';
      }
      const firstGlyph = value[prefixLength] ?? '';
      if (/\s/u.test(firstGlyph)) {
        return 'blocked';
      }
      const path = taskCheckboxCaptionNodePath(parent, text);
      if (!path) throw new Error('wechat-task-checkbox-caption-text-alignment-failed');
      const entry: TaskCheckboxCaptionSequenceEntry = {
        element: null,
        glyph: true,
        glyphOffset: prefixLength,
        kind: 'text',
        path,
        prefixLength,
        text,
        value
      };
      entries.push(entry);
      if (prefixLength) prefixEntries.push(entry);
      glyphEntry = entry;
      return 'found';
    }
    if (!(node instanceof Element)) return 'continue';
    if (taskCheckboxCaptionBoundary(node, parent, runtime)) {
      return 'blocked';
    }
    if (!taskCheckboxCaptionWhitespaceSupported(node, parent, runtime)) {
      return 'blocked';
    }
    const path = taskCheckboxCaptionNodePath(parent, node);
    if (!path) throw new Error('wechat-task-checkbox-caption-text-alignment-failed');
    const entryStart = entries.length;
    entries.push({
      element: node,
      glyph: false,
      glyphOffset: 0,
      kind: 'enter',
      path,
      prefixLength: 0,
      text: null,
      value: ''
    });
    let result: 'continue' | 'found' | 'blocked' = 'continue';
    for (const child of Array.from(node.childNodes)) {
      result = visit(child);
      if (result !== 'continue') break;
    }
    if ('blocked' === result) {
      entries.splice(entryStart);
      while (prefixEntries.length && !entries.includes(prefixEntries[prefixEntries.length - 1] as never)) {
        prefixEntries.pop();
      }
      return 'blocked';
    }
    entries.push({
      element: node,
      glyph: false,
      glyphOffset: 0,
      kind: 'exit',
      path,
      prefixLength: 0,
      text: null,
      value: ''
    });
    return result;
  };

  Array.from(parent.childNodes)
    .slice(startIndex + 1)
    .some((sibling) => {
      const result = visit(sibling);
      return 'found' === result || 'blocked' === result;
    });
  if (!glyphEntry) return null;
  const taskItem = start.closest('li.task-list-item, li') ?? parent;
  return { captionParent: parent, entries, glyphEntry, prefixEntries, taskItem };
}

export function taskCheckboxCaptionOwnedTextNodes(start: Element, runtime: BrowserWechatClipboardRuntime): Text[] {
  const parent = start.parentElement;
  if (!parent) return [];
  const startIndex = Array.from(parent.childNodes).indexOf(start);
  if (startIndex < 0) return [];
  const textNodes: Text[] = [];
  let stopped = false;
  const visit = (node: Node): void => {
    if (stopped) return;
    if (node.nodeType === 3) {
      const text = node as Text;
      textNodes.push(text);
      return;
    }
    if (!(node instanceof Element)) return;
    if (taskCheckboxCaptionBoundary(node, parent, runtime)) {
      stopped = true;
      return;
    }
    Array.from(node.childNodes).forEach(visit);
  };
  Array.from(parent.childNodes)
    .slice(startIndex + 1)
    .forEach((sibling) => {
      if (!stopped) visit(sibling);
    });
  return textNodes;
}

export function taskCheckboxCaptionSourceHidden(
  source: Element,
  sourceRoot: HTMLElement,
  runtime: BrowserWechatClipboardRuntime
): boolean {
  let current: Element | null = source;
  while (current) {
    const computed = runtime.getComputedStyle(current);
    if (
      ['none'].includes(computed.getPropertyValue('display').trim().toLowerCase()) ||
      ['hidden'].includes(computed.getPropertyValue('content-visibility').trim().toLowerCase()) ||
      ['hidden', 'collapse'].includes(computed.getPropertyValue('visibility').trim().toLowerCase())
    ) {
      return true;
    }
    if (current === sourceRoot) break;
    current = current.parentElement;
  }
  return false;
}

export function taskCheckboxCaptionRangeRects(text: Text, start: number, end: number): DOMRect[] {
  const range = text.ownerDocument.createRange();
  try {
    range.setStart(text, start);
    range.setEnd(text, end);
  } catch {
    throw new Error('wechat-task-checkbox-caption-range-unavailable');
  }
  const getClientRects = (range as unknown as { getClientRects?: () => DOMRectList }).getClientRects;
  if ('function' !== typeof getClientRects) throw new Error('wechat-task-checkbox-caption-range-unavailable');
  let rects: DOMRect[];
  try {
    rects = Array.from(getClientRects.call(range));
  } catch {
    throw new Error('wechat-task-checkbox-caption-range-unavailable');
  }
  if (
    !rects.length ||
    !rects.every((rect) =>
      [rect.left, rect.right, rect.top, rect.bottom, rect.width, rect.height].every(Number.isFinite)
    )
  ) {
    throw new Error('wechat-task-checkbox-caption-range-unavailable');
  }
  return rects;
}

export function taskCheckboxCaptionValidateGeometry(sequence: TaskCheckboxCaptionSequence): boolean {
  let hasPositivePrefixAdvance = false;
  sequence.prefixEntries.forEach(({ prefixLength, text }) => {
    if (!(text instanceof Text)) throw new Error('wechat-task-checkbox-caption-range-unavailable');
    const rects = taskCheckboxCaptionRangeRects(text, 0, prefixLength);
    if (rects.some((rect) => rect.width > 0)) hasPositivePrefixAdvance = true;
  });
  if (hasPositivePrefixAdvance) return false;
  const glyph = sequence.glyphEntry.text;
  if (!(glyph instanceof Text)) throw new Error('wechat-task-checkbox-caption-glyph-geometry-unavailable');
  const codePointLength = String.fromCodePoint(glyph.nodeValue?.codePointAt(sequence.glyphEntry.glyphOffset) ?? 0).length;
  const rects = taskCheckboxCaptionRangeRects(
    glyph,
    sequence.glyphEntry.glyphOffset,
    sequence.glyphEntry.glyphOffset + codePointLength
  );
  if (rects.every((rect) => rect.width <= 0 || rect.height <= 0)) {
    throw new Error('wechat-task-checkbox-caption-glyph-geometry-unavailable');
  }
  return true;
}

export function taskCheckboxCaptionSequencePath(root: Node, element: Node): readonly number[] {
  const path = taskCheckboxCaptionNodePath(root, element);
  if (!path) throw new Error('wechat-task-checkbox-caption-text-alignment-failed');
  return path;
}

export function taskCheckboxCaptionSequenceMatches(
  expected: TaskCheckboxCaptionSequence,
  actual: TaskCheckboxCaptionSequence,
  expectedRoot: Node,
  actualRoot: Node
): void {
  if (
    taskCheckboxCaptionSequencePath(expectedRoot, expected.captionParent).join('.') !==
      taskCheckboxCaptionSequencePath(actualRoot, actual.captionParent).join('.') ||
    taskCheckboxCaptionSequencePath(expectedRoot, expected.taskItem).join('.') !==
      taskCheckboxCaptionSequencePath(actualRoot, actual.taskItem).join('.') ||
    expected.entries.length !== actual.entries.length
  ) {
    throw new Error('wechat-task-checkbox-caption-text-alignment-failed');
  }
  expected.entries.forEach((entry, index) => {
    const other = actual.entries[index];
    if (
      !other ||
      entry.kind !== other.kind ||
      entry.glyph !== other.glyph ||
      entry.glyphOffset !== other.glyphOffset ||
      entry.prefixLength !== other.prefixLength ||
      entry.path.join('.') !== other.path.join('.') ||
      entry.value !== other.value ||
      (entry.element?.tagName ?? '') !== (other.element?.tagName ?? '')
    ) {
      throw new Error('wechat-task-checkbox-caption-text-alignment-failed');
    }
  });
}

export function taskCheckboxCaptionElementChain(start: Element | null, boundary: Element): readonly Element[] | null {
  const chain: Element[] = [];
  let current = start;
  while (current) {
    chain.push(current);
    if (current === boundary) return chain;
    current = current.parentElement;
  }
  return null;
}

export function captureTaskCheckboxCaptionRun(
  sourceInput: HTMLInputElement,
  layoutInput: HTMLInputElement,
  cloneOwner: Element,
  sourceRoot: HTMLElement,
  layoutRoot: HTMLElement,
  cloneRoot: HTMLElement,
  runtime: BrowserWechatClipboardRuntime
): void {
  const sourceParent = sourceInput.parentElement;
  const layoutParent = layoutInput.parentElement;
  const cloneParent = cloneOwner.parentElement;
  if (!sourceParent || !layoutParent || !cloneParent) {
    throw new Error('wechat-task-checkbox-caption-owner-missing');
  }
  const sourcePath = taskCheckboxCaptionNodePath(sourceRoot, sourceInput);
  const layoutPath = taskCheckboxCaptionNodePath(layoutRoot, layoutInput);
  const clonePath = taskCheckboxCaptionNodePath(cloneRoot, cloneOwner);
  if (
    !sourcePath ||
    !layoutPath ||
    !clonePath ||
    sourcePath.join('.') !== layoutPath.join('.') ||
    sourcePath.join('.') !== clonePath.join('.')
  ) {
    throw new Error('wechat-task-checkbox-caption-text-alignment-failed');
  }
  taskCheckboxCaptionOwnedTextNodes(layoutInput, runtime).forEach((layoutText) => {
    const path = taskCheckboxCaptionNodePath(layoutParent, layoutText);
    const cloneText = path ? taskCheckboxCaptionNodeAtPath(cloneParent, path) : null;
    if (!(cloneText instanceof Text) || cloneText.nodeValue !== layoutText.nodeValue) {
      throw new Error('wechat-task-checkbox-caption-text-alignment-failed');
    }
    TASK_LIST_CHECKBOX_CAPTION_TEXT_OWNERS.add(cloneText);
  });
  const sourcePosition = runtime.getComputedStyle(sourceInput).getPropertyValue('position').trim().toLowerCase();
  const layoutPosition = runtime.getComputedStyle(layoutInput).getPropertyValue('position').trim().toLowerCase();
  if ('absolute' !== sourcePosition || 'absolute' !== layoutPosition) return;
  const sourceSequence = taskCheckboxCaptionSequence(sourceInput, runtime);
  const layoutSequence = taskCheckboxCaptionSequence(layoutInput, runtime);
  if (!sourceSequence && !layoutSequence) {
    return;
  }
  if (!sourceSequence || !layoutSequence) {
    throw new Error('wechat-task-checkbox-caption-text-alignment-failed');
  }
  taskCheckboxCaptionSequenceMatches(sourceSequence, layoutSequence, sourceRoot, layoutRoot);
  const cloneTaskItem = cloneOwner.closest('li.task-list-item, li') ?? cloneParent;
  if (
    taskCheckboxCaptionSequencePath(cloneRoot, cloneParent).join('.') !==
      taskCheckboxCaptionSequencePath(layoutRoot, layoutParent).join('.') ||
    taskCheckboxCaptionSequencePath(cloneRoot, cloneTaskItem).join('.') !==
      taskCheckboxCaptionSequencePath(layoutRoot, layoutSequence.taskItem).join('.')
  ) {
    throw new Error('wechat-task-checkbox-caption-text-alignment-failed');
  }
  layoutSequence.entries.forEach((entry) => {
    const cloneNode = taskCheckboxCaptionNodeAtPath(cloneParent, entry.path);
    if (
      (entry.kind === 'text' && (!(cloneNode instanceof Text) || cloneNode.nodeValue !== entry.value)) ||
      (entry.kind !== 'text' &&
        (!(cloneNode instanceof Element) || cloneNode.tagName !== entry.element?.tagName))
    ) {
      throw new Error('wechat-task-checkbox-caption-text-alignment-failed');
    }
  });
  const sourceHidden = isPreviewHidden(sourceRoot, runtime) || taskCheckboxCaptionSourceHidden(sourceInput, sourceRoot, runtime);
  if (!layoutSequence.prefixEntries.length) return;
  if (!taskCheckboxCaptionValidateGeometry(layoutSequence)) return;
  if (!sourceHidden && !taskCheckboxCaptionValidateGeometry(sourceSequence)) return;
  const bindings: TaskCheckboxCaptionTextBinding[] = [];
  const cloneEvents: TaskCheckboxCaptionRunEvent[] = [];
  layoutSequence.entries.forEach((entry, index) => {
    const sourceEntry = sourceSequence.entries[index];
    const cloneNode = taskCheckboxCaptionNodeAtPath(cloneParent, entry.path);
    if (entry.kind !== 'text') {
      if (!(cloneNode instanceof Element) || cloneNode.tagName !== entry.element?.tagName) {
        throw new Error('wechat-task-checkbox-caption-text-alignment-failed');
      }
      cloneEvents.push({ cloneElement: cloneNode, kind: entry.kind, path: entry.path });
      return;
    }
    const layoutText = entry.text;
    const sourceText = sourceEntry?.text;
    if (
      !(cloneNode instanceof Text) ||
      !(layoutText instanceof Text) ||
      !(sourceText instanceof Text) ||
      !cloneNode.parentElement
    ) {
      if (entry.kind === 'text') throw new Error('wechat-task-checkbox-caption-text-alignment-failed');
      return;
    }
    const cloneParentElement = cloneNode.parentElement;
    const cloneAncestors = taskCheckboxCaptionElementChain(cloneParentElement, cloneParent);
    if (!cloneAncestors) throw new Error('wechat-task-checkbox-caption-text-alignment-failed');
    const original = cloneNode.nodeValue ?? '';
    const encoded = entry.prefixLength ? original.slice(entry.prefixLength) : original;
    if (encoded !== original) cloneNode.nodeValue = encoded;
    const binding: TaskCheckboxCaptionTextBinding = {
      cloneAncestors,
      cloneParent: cloneParentElement,
      cloneText: cloneNode,
      encoded,
      glyph: entry.glyph,
      layoutText,
      original,
      prefixLength: entry.prefixLength,
      sourceText,
      glyphOffset: entry.glyphOffset
    };
    bindings.push(binding);
    TASK_LIST_CHECKBOX_CAPTION_TEXT_OWNERS.add(cloneNode);
    cloneEvents.push({ binding, kind: 'text', path: entry.path });
  });
  const run: TaskCheckboxCaptionRun = {
    cloneCaptionParent: cloneParent,
    cloneEvents,
    cloneOwner,
    cloneTaskItem,
    layoutCaptionParent: layoutParent,
    layoutOwner: layoutInput,
    layoutTaskItem: layoutSequence.taskItem,
    sourceCaptionParent: sourceParent,
    sourceOwner: sourceInput,
    sourceTaskItem: sourceSequence.taskItem,
    bindings
  };
  TASK_LIST_CHECKBOX_CAPTION_MIGRATION_CANDIDATES.add(cloneParent);
  cloneEvents.forEach((event) => {
    if (event.kind === 'enter' || event.kind === 'exit') {
      TASK_LIST_CHECKBOX_CAPTION_MIGRATION_CANDIDATES.add(event.cloneElement);
    }
  });
  cloneEvents.forEach((event) => {
    if (event.kind !== 'text') return;
    TASK_LIST_CHECKBOX_CAPTION_RUN_BY_TEXT.set(event.binding.cloneText, { binding: event.binding, run });
  });
  TASK_LIST_CHECKBOX_CAPTION_RUNS.set(cloneOwner, run);
}

export function registerTaskCheckboxCaptionNormalizations(
  root: HTMLElement,
  normalizations: Map<Text, Readonly<{ original: string; encoded: string }>>
): void {
  root.querySelectorAll('*').forEach((element) => {
    const run = TASK_LIST_CHECKBOX_CAPTION_RUNS.get(element);
    if (!run) return;
    run.bindings.forEach((binding) => {
      if (!binding.prefixLength) return;
      if (!root.contains(binding.cloneText) || binding.layoutText.nodeValue !== binding.original) {
        throw new Error('wechat-task-checkbox-caption-record-missing');
      }
      if (binding.sourceText && binding.sourceText.nodeValue !== binding.original) {
        throw new Error('wechat-task-checkbox-caption-text-alignment-failed');
      }
      normalizations.set(binding.cloneText, { encoded: binding.encoded, original: binding.original });
    });
  });
}

export function taskCheckboxCaptionResolvedStructure(element: Element): Element {
  let current = element;
  const visited = new Set<Element>();
  while (true) {
    if (visited.has(current)) throw new Error('wechat-task-checkbox-caption-record-missing');
    visited.add(current);
    const replacement = TASK_LIST_CHECKBOX_CAPTION_STRUCTURE_REPLACEMENTS.get(current);
    if (!replacement) return current;
    current = replacement;
  }
}

export function taskCheckboxCaptionLogicalTextParent(text: Text): Element | null {
  const parent = text.parentElement;
  if (!parent) return null;
  if (!TASK_LIST_CHECKBOX_CAPTION_LEAF_WRAPPERS.has(parent)) return parent;
  if ('inline' !== (parent as HTMLElement).style.getPropertyValue('display').trim().toLowerCase()) {
    return null;
  }
  if (1 !== parent.childNodes.length || parent.firstChild !== text) return null;
  return parent.parentElement;
}

export function taskCheckboxCaptionRegisteredOwner(run: TaskCheckboxCaptionRun, owner: Element | null): boolean {
  if (!owner) return false;
  const resolvedOwner = taskCheckboxCaptionResolvedStructure(owner);
  if (resolvedOwner === taskCheckboxCaptionResolvedStructure(run.cloneOwner)) return true;
  return run.cloneEvents.some(
    (event) =>
      event.kind === 'enter' && taskCheckboxCaptionResolvedStructure(event.cloneElement) === resolvedOwner
  );
}

export function taskCheckboxCaptionGeneratedOwnerBelongs(
  run: TaskCheckboxCaptionRun,
  owner: Element,
  visited = new Set<Element>()
): boolean {
  if (taskCheckboxCaptionRegisteredOwner(run, owner)) return true;
  if (visited.has(owner)) return false;
  visited.add(owner);
  const pseudo = GENERATED_PSEUDO_CLONE_OWNERS.get(owner);
  return Boolean(pseudo && taskCheckboxCaptionGeneratedOwnerBelongs(run, pseudo.owner, visited));
}

export function taskCheckboxCaptionGeneratedProjection(node: Node): boolean {
  return node instanceof Element && (THEME_IMAGE_CLONES.has(node) || GENERATED_PSEUDO_CLONE_OWNERS.has(node));
}

export function taskCheckboxCaptionPseudoSlotMatches(
  element: Element,
  pseudo: '::before' | '::after',
  owner: Element
): boolean {
  const index = Array.from(owner.childNodes).indexOf(element);
  if (index < 0) return false;
  const significant = (node: Node): boolean => !taskCheckboxCaptionGeneratedProjection(node);
  const before = Array.from(owner.childNodes).slice(0, index).some(significant);
  const after = Array.from(owner.childNodes).slice(index + 1).some(significant);
  return '::before' === pseudo ? !before : !after;
}

export function taskCheckboxCaptionThemeImageSlotMatches(element: Element, metadata: WechatThemeImageClone): boolean {
  const parent = element.parentElement;
  if (!parent || taskCheckboxCaptionResolvedStructure(parent) !== taskCheckboxCaptionResolvedStructure(metadata.owner)) {
    return false;
  }
  const images = Array.from(parent.children).filter((child) => THEME_IMAGE_CLONES.has(child));
  const records = images.map((image) => THEME_IMAGE_CLONE_OWNERS.get(image));
  if (records.some((record) => !record || record.owner !== metadata.owner || record.slot !== metadata.slot)) return false;
  const expectedOrder = [...images].sort((left, right) => {
    const leftRecord = THEME_IMAGE_CLONE_OWNERS.get(left);
    const rightRecord = THEME_IMAGE_CLONE_OWNERS.get(right);
    if (!leftRecord || !rightRecord) return 0;
    return 'leading' === metadata.slot
      ? rightRecord.layerIndex - leftRecord.layerIndex
      : leftRecord.layerIndex - rightRecord.layerIndex;
  });
  if (expectedOrder.some((image, index) => image !== images[index])) return false;
  const imageIndex = Array.from(parent.childNodes).indexOf(element);
  if (imageIndex < 0) return false;
  const significant = (node: Node): boolean => !THEME_IMAGE_CLONES.has(node as Element);
  return 'leading' === metadata.slot
    ? !Array.from(parent.childNodes).slice(0, imageIndex).some(significant)
    : !Array.from(parent.childNodes).slice(imageIndex + 1).some(significant);
}

export function taskCheckboxCaptionRegisteredGenerated(
  run: TaskCheckboxCaptionRun,
  element: Element
): boolean {
  const pseudo = GENERATED_PSEUDO_CLONE_OWNERS.get(element);
  if (pseudo) {
    const parent = element.parentElement;
    if (
      !parent ||
      taskCheckboxCaptionResolvedStructure(parent) !== taskCheckboxCaptionResolvedStructure(pseudo.owner) ||
      !taskCheckboxCaptionGeneratedOwnerBelongs(run, pseudo.owner) ||
      !taskCheckboxCaptionPseudoSlotMatches(element, pseudo.pseudo, parent)
    ) {
      return false;
    }
    return Array.from(element.querySelectorAll('*')).every((child) => {
      if (THEME_IMAGE_CLONES.has(child)) return taskCheckboxCaptionRegisteredGenerated(run, child);
      const childPseudo = GENERATED_PSEUDO_CLONE_OWNERS.get(child);
      return !childPseudo || taskCheckboxCaptionRegisteredGenerated(run, child);
    });
  }
  const metadata = THEME_IMAGE_CLONE_OWNERS.get(element);
  if (!metadata || !THEME_IMAGE_CLONES.has(element)) return false;
  return (
    taskCheckboxCaptionGeneratedOwnerBelongs(run, metadata.owner) &&
    taskCheckboxCaptionThemeImageSlotMatches(element, metadata)
  );
}

export type TaskCheckboxCaptionObservedEvent =
  | TaskCheckboxCaptionRunEvent
  | Readonly<{ kind: 'unknown' }>;
export type TaskCheckboxCaptionTextPhase = 'encoded' | 'original';

export function taskCheckboxCaptionObservedEvents(run: TaskCheckboxCaptionRun): TaskCheckboxCaptionObservedEvent[] {
  const parent = taskCheckboxCaptionResolvedStructure(run.cloneCaptionParent);
  if (run.cloneOwner.parentElement !== parent) return [{ kind: 'unknown' }];
  const ownerIndex = Array.from(parent.childNodes).indexOf(run.cloneOwner);
  if (ownerIndex < 0) return [{ kind: 'unknown' }];
  const events: TaskCheckboxCaptionObservedEvent[] = [];
  let glyphReached = false;
  const visit = (node: Node): void => {
    if (glyphReached) return;
    if (node.nodeType === 3) {
      const reference = TASK_LIST_CHECKBOX_CAPTION_RUN_BY_TEXT.get(node as Text);
      if (!reference || reference.run !== run) {
        events.push({ kind: 'unknown' });
        return;
      }
      events.push({ binding: reference.binding, kind: 'text', path: [] });
      if (reference.binding.glyph) glyphReached = true;
      return;
    }
    if (!(node instanceof Element)) return;
    if (taskCheckboxCaptionGeneratedProjection(node)) {
      if (taskCheckboxCaptionRegisteredGenerated(run, node)) return;
      events.push({ kind: 'unknown' });
      return;
    }
    if (TASK_LIST_CHECKBOX_CAPTION_LEAF_WRAPPERS.has(node)) {
      if (
        'inline' !== (node as HTMLElement).style.getPropertyValue('display').trim().toLowerCase() ||
        1 !== node.childNodes.length
      ) {
        events.push({ kind: 'unknown' });
        return;
      }
      visit(node.firstChild as Node);
      return;
    }
    events.push({ cloneElement: node, kind: 'enter', path: [] });
    Array.from(node.childNodes).forEach(visit);
    events.push({ cloneElement: node, kind: 'exit', path: [] });
  };
  Array.from(parent.childNodes)
    .slice(ownerIndex + 1)
    .forEach(visit);
  return events;
}

export function taskCheckboxCaptionAncestryMatches(
  run: TaskCheckboxCaptionRun,
  binding: TaskCheckboxCaptionTextBinding,
  root: HTMLElement
): boolean {
  const logicalParent = taskCheckboxCaptionLogicalTextParent(binding.cloneText);
  const captionParent = taskCheckboxCaptionResolvedStructure(run.cloneCaptionParent);
  if (!logicalParent || taskCheckboxCaptionResolvedStructure(binding.cloneParent) !== logicalParent) return false;
  const actualChain = taskCheckboxCaptionElementChain(logicalParent, captionParent);
  if (!actualChain || actualChain.length !== binding.cloneAncestors.length) return false;
  if (
    actualChain.some(
      (element, index) => element !== taskCheckboxCaptionResolvedStructure(binding.cloneAncestors[index] as Element)
    )
  ) {
    return false;
  }
  return actualChain.every((element) => root.contains(element));
}

export function assertTaskCheckboxCaptionRun(
  root: HTMLElement,
  run: TaskCheckboxCaptionRun,
  normalizations: Map<Text, Readonly<{ original: string; encoded: string }>>,
  phase: TaskCheckboxCaptionTextPhase
): void {
  const captionParent = taskCheckboxCaptionResolvedStructure(run.cloneCaptionParent);
  const taskItem = taskCheckboxCaptionResolvedStructure(run.cloneTaskItem);
  if (
    !root.contains(run.cloneOwner) ||
    !root.contains(captionParent) ||
    !root.contains(taskItem) ||
    run.cloneOwner.parentElement !== captionParent ||
    !taskItem.contains(run.cloneOwner) ||
    !taskItem.contains(captionParent)
  ) {
    throw new Error('wechat-task-checkbox-caption-record-missing');
  }
  const firstBinding = run.bindings[0];
  if (!firstBinding || !root.contains(firstBinding.cloneText)) {
    throw new Error('wechat-task-checkbox-caption-record-missing');
  }
  if (
    !(run.cloneOwner.compareDocumentPosition(firstBinding.cloneText) & Node.DOCUMENT_POSITION_FOLLOWING)
  ) {
    throw new Error('wechat-task-checkbox-caption-record-missing');
  }
  run.bindings.forEach((binding) => {
    if (!root.contains(binding.cloneText)) {
      throw new Error('wechat-task-checkbox-caption-record-missing');
    }
    if (binding.layoutText.nodeValue !== binding.original) {
      throw new Error('wechat-task-checkbox-caption-record-missing');
    }
    if (binding.sourceText && binding.sourceText.nodeValue !== binding.original) {
      throw new Error('wechat-task-checkbox-caption-text-alignment-failed');
    }
    if (!taskCheckboxCaptionAncestryMatches(run, binding, root)) {
      throw new Error('wechat-task-checkbox-caption-record-missing');
    }
    const expectedText = 'original' === phase ? binding.original : binding.encoded;
    if (binding.cloneText.nodeValue !== expectedText) {
      throw new Error(
        'encoded' === phase && binding.prefixLength
          ? 'wechat-task-checkbox-caption-prefix-reinserted'
          : 'original' === phase
            ? 'wechat-task-checkbox-caption-plain-text-restore-failed'
          : 'wechat-task-checkbox-caption-record-missing'
      );
    }
    if (binding.prefixLength) {
      const normalization = normalizations.get(binding.cloneText);
      if (
        !normalization ||
        normalization.original !== binding.original ||
        normalization.encoded !== binding.encoded
      ) {
        throw new Error('wechat-task-checkbox-caption-record-missing');
      }
    }
  });
  const expectedEvents = run.cloneEvents;
  const actualEvents = taskCheckboxCaptionObservedEvents(run);
  if (
    expectedEvents.length !== actualEvents.length ||
    expectedEvents.some((expected, index) => {
      const actual = actualEvents[index];
      if (!actual || actual.kind !== expected.kind) return true;
      if (expected.kind === 'text') {
        return actual.kind !== 'text' || actual.binding !== expected.binding;
      }
      return (
        actual.kind !== expected.kind ||
        taskCheckboxCaptionResolvedStructure(actual.cloneElement) !==
          taskCheckboxCaptionResolvedStructure(expected.cloneElement)
      );
    })
  ) {
    throw new Error('wechat-task-checkbox-caption-record-missing');
  }
}

export function assertTaskCheckboxCaptionOwnerSequence(root: HTMLElement): void {
  const expectedOwners = TASK_LIST_CHECKBOX_CAPTION_OWNER_SEQUENCES.get(root);
  if (!expectedOwners) return;
  const actualOwners = Array.from(root.querySelectorAll('*')).filter((element) =>
    TASK_LIST_CHECKBOX_CLONES.has(element)
  );
  if (actualOwners.length !== expectedOwners.length) {
    throw new Error('wechat-task-checkbox-static-owner-count-mismatch');
  }
  if (expectedOwners.some((expected, index) => actualOwners[index] !== expected.cloneOwner)) {
    throw new Error('wechat-task-checkbox-caption-owner-order-mismatch');
  }
}

export function assertTaskCheckboxCaptionRuns(
  root: HTMLElement,
  normalizations: Map<Text, Readonly<{ original: string; encoded: string }>>,
  phase: TaskCheckboxCaptionTextPhase = 'encoded'
): void {
  assertTaskCheckboxCaptionOwnerSequence(root);
  root.querySelectorAll('*').forEach((element) => {
    const run = TASK_LIST_CHECKBOX_CAPTION_RUNS.get(element);
    if (run) assertTaskCheckboxCaptionRun(root, run, normalizations, phase);
  });
}
