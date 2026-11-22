import { expect } from '@playwright/test';
import { openVisual } from './visual-editing-helpers.mjs';

export function windowedMarkdown(tail) {
  const filler = Array.from(
    { length: 170 },
    (_, index) => `Filler ${index + 1}.`
  ).join('\n\n');
  return `Head.\n\n${filler}\n\n${tail}`;
}

export function createRichFixtureBuilder() {
  const parts = [];
  let sourceLength = 0, domIndex = 0;
  const add = (kind, text, metadata = {}) => {
    const part = { kind, text, sourceStart: sourceLength, sourceEnd: sourceLength + text.length, ...metadata };
    sourceLength = part.sourceEnd;
    parts.push(part);
    return part;
  };
  const separator = (text = '\n\n') => add('separator', text, { dom: null, deletion: 'held-policy' });
  const block = (kind, text, tag, metadata = {}) => add(kind, text, {
    contentStart: sourceLength,
    contentEnd: sourceLength + text.length,
    dom: { blockId: `b${domIndex++}`, tag },
    ...metadata
  });
  return {
    add,
    separator,
    block,
    build: (metadata = {}) => ({ initial: parts.map((part) => part.text).join(''), parts, ...metadata })
  };
}

export function richWindowedFixture(imageKind = 'inline') {
  const inlineImage = '![dot](/wp-content/plugins/easymde/assets/images/easymde-editor-icon.png)';
  const image = imageKind === 'linked' ? `[${inlineImage}](https://example.com)`
    : imageKind === 'reference' ? '![dot][pic]' : inlineImage;
  const { add, separator, block, build } = createRichFixtureBuilder();
  if (imageKind === 'reference') {
    const definition = add('definition', '[pic]: /wp-content/plugins/easymde/assets/images/easymde-editor-icon.png', {
      dom: null, deletion: 'held-policy'
    });
    definition.contentStart = definition.sourceStart;
    definition.contentEnd = definition.sourceEnd;
    separator();
  }
  block('heading', '# Head', 'H1', { deletion: 'known-heading', headingPrefix: '# ' });
  separator();
  for (let index = 0; index < 12; index += 1) {
    block('paragraph', 'Repeated paragraph.', 'P', { deletion: 'ascii-grapheme', plainText: true });
    separator();
  }
  for (let index = 0; index < 154; index += 1) {
    block('paragraph', `Paragraph ${index + 1}.`, 'P', { deletion: 'ascii-grapheme', plainText: true });
    separator();
  }
  block('heading', '## Tail heading', 'H2', { deletion: 'known-heading', headingPrefix: '## ' });
  separator();
  block('list', '- outer\n  - inner\n  - inner two', 'UL', { deletion: 'known-list' });
  separator();
  block('quote', '> quoted tail line', 'BLOCKQUOTE', { deletion: 'known-quote', quotePrefix: '> ' });
  separator();
  block('code', '```python\nvalue = 1\n```', 'PRE', { deletion: 'known-code-fence' });
  separator();
  block('code', '~~~bash\necho one\n~~~', 'PRE', { deletion: 'known-code-fence' });
  separator();
  block('table', '| left | right |\n| --- | --- |\n| a | b |', 'TABLE', { deletion: 'known-table-menu' });
  separator();
  block('mixed-paragraph', 'Math $x^2$ and [link](https://example.com).', 'P', { deletion: 'known-mixed-paragraph' });
  separator();
  block('atom', image, 'P', { deletion: 'known-whole-atom', atom: 'image' });
  separator();
  block('atom', '```mermaid\ngraph TD\n  A --> B\n```', 'DIV', { deletion: 'known-whole-atom', atom: 'mermaid' });
  separator('\n');
  return build({ image });
}

function richPartDeletionStates(part) {
  if (part.deletion === 'known-whole-atom') {
    return [[part.text]];
  }
  if (part.deletion === 'ascii-grapheme' && part.plainText === true) {
    const states = [];
    for (let length = part.text.length; length >= 1; length -= 1) {
      states.push([part.text.slice(0, length)]);
    }
    return states;
  }
  if (part.deletion === 'known-heading') {
    const prefix = part.headingPrefix ?? part.text.match(/^#{1,6}\s+/u)?.[0] ?? '';
    const body = part.text.slice(prefix.length);
    const states = [];
    for (let length = body.length; length >= 1; length -= 1) {
      states.push([prefix + body.slice(0, length)]);
    }
    states.push([prefix, prefix.trimEnd()]);
    return states;
  }
  if (part.deletion === 'known-quote') {
    const prefix = part.quotePrefix ?? '> ';
    const body = part.text.slice(prefix.length);
    const states = [];
    for (let length = body.length; length >= 1; length -= 1) {
      states.push([prefix + body.slice(0, length)]);
    }
    states.push([prefix, prefix.trimEnd()]);
    return states;
  }
  if (part.deletion === 'known-code-fence') {
    const firstNewline = part.text.indexOf('\n');
    const lastNewline = part.text.lastIndexOf('\n');
    if (firstNewline < 0 || lastNewline <= firstNewline) {
      throw new Error('rich-deletion-oracle-uncovered:invalid-code-fence');
    }
    const opening = part.text.slice(0, firstNewline + 1);
    const body = part.text.slice(firstNewline + 1, lastNewline);
    const closing = part.text.slice(lastNewline + 1);
    const states = [];
    for (let length = body.length; length >= 1; length -= 1) {
      states.push([`${opening}${body.slice(0, length)}\n${closing}`]);
    }
    states.push([`${opening}\n${closing}`, `${opening}${closing}`]);
    return states;
  }
  if (part.deletion === 'known-list') {
    const lines = part.text.split('\n');
    const states = [];
    for (let lineIndex = lines.length - 1; lineIndex >= 0; lineIndex -= 1) {
      const match = lines[lineIndex].match(/^(\s*[-*+]\s+)(.*)$/u);
      if (!match) throw new Error('rich-deletion-oracle-uncovered:invalid-list-line');
      const [, marker, body] = match;
      const linePrefix = lines.slice(0, lineIndex).join('\n') + (lineIndex > 0 ? '\n' : '');
      for (let length = body.length; length >= 1; length -= 1) {
        states.push([`${linePrefix}${marker}${body.slice(0, length)}`]);
      }
      states.push([`${linePrefix}${marker}`, `${linePrefix}${marker.trimEnd()}`]);
    }
    return states;
  }
  if (part.deletion === 'known-mixed-paragraph') {
    const text = part.text;
    const tokens = [];
    let index = 0;
    while (index < text.length) {
      const rest = text.slice(index);
      const imageMatch = rest.match(/^!\[[^\]]*\]\([^)]*\)/u);
      if (imageMatch) {
        tokens.push({ kind: 'atom', text: imageMatch[0] });
        index += imageMatch[0].length;
        continue;
      }
      const mathMatch = rest.match(/^\$[^$]+\$/u);
      if (mathMatch) {
        tokens.push({ kind: 'atom', text: mathMatch[0] });
        index += mathMatch[0].length;
        continue;
      }
      const linkMatch = rest.match(/^\[([^\]]+)\]\(([^)]+)\)/u);
      if (linkMatch) {
        tokens.push({ kind: 'link', label: linkMatch[1], url: linkMatch[2], text: linkMatch[0] });
        index += linkMatch[0].length;
        continue;
      }
      tokens.push({ kind: 'char', text: text[index] });
      index += 1;
    }
    const states = [];
    for (let tokenIndex = tokens.length - 1; tokenIndex >= 0; tokenIndex -= 1) {
      const prefix = tokens.slice(0, tokenIndex).map((token) => token.text).join('');
      const token = tokens[tokenIndex];
      if (token.kind === 'link') {
        for (let length = token.label.length; length >= 1; length -= 1) {
          states.push([`${prefix}[${token.label.slice(0, length)}](${token.url})`]);
        }
      } else {
        states.push([prefix + token.text]);
      }
    }
    return states;
  }
  if (part.deletion === 'known-table-menu') {
    const lines = part.text.split('\n');
    if (lines.length !== 3) throw new Error('rich-deletion-oracle-uncovered:invalid-table');
    const parseRow = (line) => line.trim().slice(1, -1).split('|').map((cell) => cell.trim());
    const [h0, h1] = parseRow(lines[0]);
    const divider = lines[1];
    const [b0, b1] = parseRow(lines[2]);
    const cellVariants = (value) => (value === '' ? ['  ', ' ', ''] : [` ${value} `]);
    const rowVariants = (left, right) => {
      const rows = [];
      for (const l of cellVariants(left)) {
        for (const r of cellVariants(right)) rows.push(`|${l}|${r}|`);
      }
      return rows;
    };
    const tableVariants = (ch0, ch1, cb0, cb1) => {
      const variants = [];
      for (const head of rowVariants(ch0, ch1)) {
        for (const body of rowVariants(cb0, cb1)) variants.push(`${head}\n${divider}\n${body}`);
      }
      return variants;
    };
    const states = [tableVariants(h0, h1, b0, b1)];
    for (let length = b1.length - 1; length >= 0; length -= 1) {
      states.push(tableVariants(h0, h1, b0, b1.slice(0, length)));
    }
    for (let length = b0.length - 1; length >= 0; length -= 1) {
      states.push(tableVariants(h0, h1, b0.slice(0, length), ''));
    }
    for (let length = h1.length - 1; length >= 0; length -= 1) {
      states.push(tableVariants(h0, h1.slice(0, length), '', ''));
    }
    for (let length = h0.length - 1; length >= 0; length -= 1) {
      states.push(tableVariants(h0.slice(0, length), '', '', ''));
    }
    return states;
  }
  throw new Error(`rich-deletion-oracle-uncovered:${part.deletion ?? part.kind}`);
}

const RICH_STRUCTURED_DELETION_POLICIES = new Set([
  'known-whole-atom',
  'known-mixed-paragraph',
  'known-table-menu',
  'known-code-fence',
  'known-quote',
  'known-list',
  'known-heading'
]);

export const RICH_TRAILING_ENDINGS = ['', '\n', '\n\n', '\n\n\n', '\n\n\n\n'];

export const RICH_EMPTY_ROWS = ['', ' ', '  ', '\n', '\n\n'];

function richPreviousBlockPartIndex(parts, partIndex) {
  for (let index = partIndex - 1; index >= 0; index -= 1) {
    if (parts[index]?.dom) return index;
  }
  return -1;
}

function richFixturePrefix(parts, partIndex) {
  return parts.slice(0, partIndex).map((part) => part.text).join('');
}

export function richWindowedForwardGroups(fixture) {
  const groups = [];
  const blockIndexes = fixture.parts
    .map((part, index) => (part.dom ? index : -1))
    .filter((index) => index >= 0);
  for (let position = blockIndexes.length - 1; position >= 0; position -= 1) {
    const partIndex = blockIndexes[position];
    const part = fixture.parts[partIndex];
    const prefix = fixture.initial.slice(0, part.sourceStart);
    for (const variants of richPartDeletionStates(part)) {
      const group = [];
      for (const variant of variants) {
        for (const ending of RICH_TRAILING_ENDINGS) group.push(prefix + variant + ending);
      }
      groups.push(group);
    }
    groups.push(RICH_EMPTY_ROWS.map((empty) => prefix + empty));
  }
  groups.push([...RICH_EMPTY_ROWS]);
  return groups;
}

export function createRichDeletionModel(fixture) {
  const cursorPartIndex = fixture.parts.findLastIndex((part) => part.dom
    || part.deletion === 'known-empty-structure' || part.deletion === 'known-whole-unit');
  const part = fixture.parts[cursorPartIndex];
  if (!part) throw new Error('rich-deletion-oracle-uncovered:empty-fixture');
  return {
    source: fixture.initial,
    parts: fixture.parts,
    cursor: { partIndex: cursorPartIndex,
      offset: part.dom ? part.contentEnd - part.contentStart : 0 }
  };
}

// The selected fixture unit, never the observed diff, owns the exact removal range.
// Ambiguous, distant-atom, and unresolved special-character cases remain uncovered.
function richCaretDescriptorMatches(actual, expected) {
  if (!actual || !expected) return false;
  if (expected.liveOnly === true) {
    return actual.connected === true && actual.collapsed === true
      && actual.focused === true && actual.editable === true;
  }
  return actual.connected === true && actual.collapsed === true && actual.focused === true
    && actual?.editable === true && actual?.blockId === expected.blockId
    && actual?.blockTag === expected.blockTag && actual?.textOffset === expected.textOffset
    && actual?.blockLength === expected.blockLength;
}

export function richDeletionObservationMatches(step, observation, phase) {
  const before = phase === 'before';
  if (typeof step?.matchesSource === 'function') {
    return {
      sourceExact: !!observation && step.matchesSource(observation.source, phase),
      caretExact: richCaretDescriptorMatches(observation?.caret, before ? step?.beforeCaret : step?.afterCaret)
    };
  }
  return {
    sourceExact: !!observation && observation.source === (before ? step?.beforeSource : step?.afterSource),
    caretExact: richCaretDescriptorMatches(observation?.caret, before ? step?.beforeCaret : step?.afterCaret)
  };
}

function buildRichStructuredStep(model, part) {
  const partIndex = model.cursor.partIndex;
  const prefix = richFixturePrefix(model.parts, partIndex);
  const prevBlockIndex = richPreviousBlockPartIndex(model.parts, partIndex);
  const prevEndPrefix = prevBlockIndex >= 0 ? richFixturePrefix(model.parts, prevBlockIndex + 1) : '';
  const ranked = new Map();
  const addRank = (source, rank) => ranked.set(source, Math.max(ranked.get(source) ?? -1, rank));
  const states = richPartDeletionStates(part);
  for (let stateIndex = 0; stateIndex < states.length; stateIndex += 1) {
    const rank = (states.length - stateIndex) * 10 + 10;
    for (const variant of states[stateIndex]) {
      for (const ending of RICH_TRAILING_ENDINGS) addRank(prefix + variant + ending, rank);
    }
  }
  for (const empty of RICH_EMPTY_ROWS) addRank(prefix + empty, 5);
  const retiredSources = new Set();
  for (const ending of RICH_TRAILING_ENDINGS) {
    const retired = prevEndPrefix + ending;
    retiredSources.add(retired);
    addRank(retired, 1);
  }
  if (prevBlockIndex >= 0) {
    const prevPart = model.parts[prevBlockIndex];
    const prevPrefix = richFixturePrefix(model.parts, prevBlockIndex);
    const prevStates = richPartDeletionStates(prevPart);
    if (prevStates.length > 1) {
      for (const variant of prevStates[1]) {
        for (const ending of RICH_TRAILING_ENDINGS) {
          const nextInPrev = prevPrefix + variant + ending;
          retiredSources.add(nextInPrev);
          addRank(nextInPrev, 0);
        }
      }
    }
  }
  const beforeRank = ranked.get(model.source) ?? -1;
  return {
    policy: part.deletion,
    removeStart: part.sourceStart,
    removeEnd: part.sourceEnd,
    beforeSource: model.source,
    afterSource: prevEndPrefix,
    beforeCaret: { liveOnly: true },
    afterCaret: { liveOnly: true },
    nextCursor: prevBlockIndex >= 0
      ? { partIndex: prevBlockIndex, offset: model.parts[prevBlockIndex].contentEnd - model.parts[prevBlockIndex].contentStart }
      : { partIndex: 0, offset: 0 },
    matchesSource: (observed, phase) => {
      if (typeof observed !== 'string') return false;
      if (phase === 'before') return observed === model.source && beforeRank >= 0;
      const afterRank = ranked.get(observed);
      return afterRank !== undefined && afterRank <= beforeRank;
    },
    resolveNextCursor: (observedAfterSource) => {
      if (prevBlockIndex >= 0 && retiredSources.has(observedAfterSource)) {
        const prevPart = model.parts[prevBlockIndex];
        const prevPrefix = richFixturePrefix(model.parts, prevBlockIndex);
        if (prevPart.deletion === 'ascii-grapheme' && prevPart.plainText === true) {
          const remainder = observedAfterSource.startsWith(prevPrefix)
            ? observedAfterSource.slice(prevPrefix.length).replace(/\n+$/u, '')
            : prevPart.text;
          return { partIndex: prevBlockIndex, offset: Math.min(remainder.length, prevPart.text.length) };
        }
        return { partIndex: prevBlockIndex, offset: prevPart.contentEnd - prevPart.contentStart };
      }
      return { partIndex, offset: model.cursor.offset };
    }
  };
}

export function expectedRichDeletionStep(model) {
  const part = model.parts[model.cursor.partIndex];
  if (!part || part.sourceStart === undefined || part.sourceEnd === undefined) {
    throw new Error('rich-deletion-oracle-uncovered:missing-unit');
  }
  const beforeCaret = {
    blockId: part.dom?.blockId ?? null,
    blockTag: part.dom?.tag ?? null,
    textOffset: model.cursor.offset,
    blockLength: part.plainText ? model.cursor.offset : part.dom ? part.contentEnd - part.contentStart : null
  };
  if (part.deletion === 'ascii-grapheme' && part.plainText === true) {
    const prefix = richFixturePrefix(model.parts, model.cursor.partIndex);
    const exactNoTrailing = model.source === prefix + part.text.slice(0, model.cursor.offset);
    if (model.cursor.offset > 0 && exactNoTrailing && (model.cursor.offset > 1 || model.parts.length === 1)) {
      // The construction cursor fixes the removable byte range. For "aba" at
      // offset 3 it removes [2,3), producing "ab"; an observed "ba" cannot pass.
      const content = model.source.slice(part.contentStart, part.contentEnd);
      const textPrefix = content.slice(0, model.cursor.offset);
      const last = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(textPrefix)].at(-1)?.segment;
      if (!last || last.length !== 1 || last.codePointAt(0) > 0x7f) {
        throw new Error('rich-deletion-oracle-uncovered:special-character-policy');
      }
      const removeStart = part.contentStart + model.cursor.offset - last.length;
      const nextOffset = model.cursor.offset - last.length;
      return {
        removeStart,
        removeEnd: part.contentStart + model.cursor.offset,
        beforeSource: model.source,
        afterSource: model.source.slice(0, removeStart) + model.source.slice(part.contentStart + model.cursor.offset),
        beforeCaret,
        afterCaret: { ...beforeCaret, textOffset: nextOffset, blockLength: nextOffset },
        nextCursor: { partIndex: model.cursor.partIndex, offset: nextOffset }
      };
    }
    const structured = buildRichStructuredStep(model, part);
    return {
      ...structured,
      resolveNextCursor: (observedAfterSource) => {
        const next = structured.resolveNextCursor(observedAfterSource);
        if (next.partIndex !== model.cursor.partIndex) return next;
        if (observedAfterSource.startsWith(prefix)) {
          const tail = observedAfterSource.slice(prefix.length).replace(/\n+$/u, '');
          if (part.text.startsWith(tail)) return { partIndex: model.cursor.partIndex, offset: tail.length };
          return { partIndex: model.cursor.partIndex, offset: 0 };
        }
        return next;
      }
    };
  }
  if (part.deletion === 'known-whole-unit' || part.deletion === 'known-empty-structure') {
    return {
      removeStart: part.sourceStart,
      removeEnd: part.sourceEnd,
      beforeSource: model.source,
      afterSource: model.source.slice(0, part.sourceStart) + model.source.slice(part.sourceEnd),
      beforeCaret,
      afterCaret: part.afterCaret ?? null,
      nextCursor: part.nextCursor ?? null
    };
  }
  if (RICH_STRUCTURED_DELETION_POLICIES.has(part.deletion)) {
    return buildRichStructuredStep(model, part);
  }
  throw new Error(`rich-deletion-oracle-uncovered:${part.deletion ?? part.kind}`);
}

export function commitRichDeletion(model, step, observedSource = null) {
  const nextSource = typeof observedSource === 'string' ? observedSource : step.afterSource;
  model.source = nextSource;
  const nextCursor = typeof step.resolveNextCursor === 'function'
    ? step.resolveNextCursor(nextSource)
    : step.nextCursor;
  if (!nextCursor) throw new Error('rich-deletion-oracle-uncovered:missing-next-caret');
  model.cursor = nextCursor;
}

export function commitRichTableDeletion(model, afterTableSource) {
  const prevBlockIndex = richPreviousBlockPartIndex(model.parts, model.cursor.partIndex);
  model.source = afterTableSource;
  if (prevBlockIndex >= 0) {
    const prevPart = model.parts[prevBlockIndex];
    model.cursor = {
      partIndex: prevBlockIndex,
      offset: prevPart.contentEnd - prevPart.contentStart
    };
  }
}

export function richCaretContractObservation(part, offset, blockLength = offset, overrides = {}) {
  return { connected: true, collapsed: true, focused: true, editable: true,
    blockId: part.dom.blockId, blockTag: part.dom.tag, textOffset: offset,
    blockLength, ...overrides };
}

export async function openWindowedVisual(page, tail, beforeFixture) {
  const opened = await openVisual(page, windowedMarkdown(tail), undefined, beforeFixture);
  // More than 160 blocks: the editor mounts a windowed surface with spacers.
  await expect(opened.visual.locator('[data-easymde-preview-window-spacer]').first()).toBeAttached();
  return opened;
}
