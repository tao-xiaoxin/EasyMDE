export type EditorOutlineEntry = Readonly<{
  depth: number;
  key: string;
  level: number;
  offset: number;
  text: string;
}>;

export type WritingStatistics = Readonly<{
  characters: number;
  cjk: number;
  lines: number;
  readMinutes: number;
  words: number;
}>;

export type CursorPosition = Readonly<{
  column: number;
  line: number;
}>;

type Fence = Readonly<{
  length: number;
  marker: '`' | '~';
}>;

type HtmlBlock = Readonly<{
  closesWith: RegExp | null;
}>;

type ContainerLine = Readonly<{
  content: string;
  identity: string;
}>;

type Container =
  | Readonly<{ type: 'quote' }>
  | Readonly<{ id: number; indent: number; type: 'list' }>;

const HTML_BLOCK_TAG = '(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)';

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n?/g, '\n');
}

function containerIdentity(containers: ReadonlyArray<Container>): string {
  return containers.map((container) => (
    'quote' === container.type ? 'q' : `l${container.id}:${container.indent}`
  )).join('/');
}

function stripContainerLines(lines: ReadonlyArray<string>): ReadonlyArray<ContainerLine> {
  let activeContainers: Container[] = [];
  let nextListId = 1;

  return lines.map((sourceLine) => {
    if (!sourceLine.trim()) {
      const quoteIndex = activeContainers.findIndex(({ type }) => 'quote' === type);
      if (quoteIndex >= 0) activeContainers = activeContainers.slice(0, quoteIndex);
      return { content: '', identity: containerIdentity(activeContainers) };
    }

    let line = sourceLine;
    const containers: Container[] = [];

    for (const container of activeContainers) {
      if ('quote' === container.type) {
        const quote = line.match(/^ {0,3}>[ \t]?/);
        if (!quote?.[0]) break;
        line = line.slice(quote[0].length);
        containers.push(container);
        continue;
      }

      const indentation = line.match(/^ */)?.[0].length ?? 0;
      if (indentation < container.indent) break;
      line = line.slice(container.indent);
      containers.push(container);
    }

    while (true) {
      const quote = line.match(/^ {0,3}>[ \t]?/);
      if (quote?.[0]) {
        line = line.slice(quote[0].length);
        containers.push({ type: 'quote' });
        continue;
      }

      const marker = line.match(/^( {0,3})([-+*]|\d{1,9}[.)])([ \t]+)/);
      if (!marker?.[2] || !marker[3]) break;
      const padding = marker[3].length <= 4 ? marker[3].length : 1;
      const contentIndent = (marker[1]?.length ?? 0) + marker[2].length + padding;
      line = line.slice(contentIndent);
      containers.push({ id: nextListId, indent: contentIndent, type: 'list' });
      nextListId += 1;
    }

    activeContainers = containers;
    return { content: line, identity: containerIdentity(containers) };
  });
}

function advanceFence(line: string, fence: Fence | null): Readonly<{
  consumed: boolean;
  fence: Fence | null;
}> {
  const match = line.match(/^ {0,3}(`{3,}|~{3,})([^\r\n]*)$/);
  if (fence) {
    const marker = match?.[1] ?? '';
    if (
      marker.startsWith(fence.marker)
      && marker.length >= fence.length
      && !match?.[2]?.trim()
    ) {
      return { consumed: true, fence: null };
    }
    return { consumed: true, fence };
  }
  if (!match?.[1]) return { consumed: false, fence: null };
  if ('`' === match[1][0] && match[2]?.includes('`')) {
    return { consumed: false, fence: null };
  }
  return {
    consumed: true,
    fence: {
      length: match[1].length,
      marker: match[1][0] as '`' | '~'
    }
  };
}

function advanceHtmlBlock(line: string, block: HtmlBlock | null): Readonly<{
  block: HtmlBlock | null;
  consumed: boolean;
}> {
  if (block) {
    if (block.closesWith?.test(line) || (!block.closesWith && '' === line.trim())) {
      return { block: null, consumed: true };
    }
    return { block, consumed: true };
  }

  const starts = [
    { pattern: /^ {0,3}<(?:script|pre|style|textarea)(?:[ \t]|>|$)/i, closesWith: /<\/(?:script|pre|style|textarea)>/i },
    { pattern: /^ {0,3}<!--/, closesWith: /-->/ },
    { pattern: /^ {0,3}<\?/, closesWith: /\?>/ },
    { pattern: /^ {0,3}<![A-Z]/, closesWith: />/ },
    { pattern: /^ {0,3}<!\[CDATA\[/, closesWith: /\]\]>/ },
    { pattern: new RegExp(`^ {0,3}</?${HTML_BLOCK_TAG}(?:[ \\t]|/?>|$)`, 'i'), closesWith: null },
    { pattern: /^ {0,3}<\/?[A-Za-z][A-Za-z0-9-]*(?:[ \t]+[^<>]*)?\/?>[ \t]*$/, closesWith: null }
  ];
  const start = starts.find(({ pattern }) => pattern.test(line));
  if (!start) return { block: null, consumed: false };
  return {
    block: start.closesWith?.test(line) ? null : { closesWith: start.closesWith },
    consumed: true
  };
}

export function calculateWritingStatistics(markdown: string): WritingStatistics {
  const normalized = normalizeLineEndings(markdown);
  const western = normalized.match(/[\p{Script=Latin}\p{N}]+(?:['’-][\p{Script=Latin}\p{N}]+)*/gu) ?? [];
  const cjk = normalized.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu) ?? [];

  return {
    characters: Array.from(normalized.replace(/\n/g, '')).length,
    cjk: cjk.length,
    lines: normalized.split('\n').length,
    readMinutes: Math.max(1, Math.ceil((western.length + cjk.length) / 300)),
    words: western.length
  };
}

export function cursorPosition(markdown: string, offset: number): CursorPosition {
  const boundedOffset = Math.max(0, Math.min(markdown.length, offset));
  const lines = normalizeLineEndings(markdown.slice(0, boundedOffset)).split('\n');
  return {
    column: (lines[lines.length - 1]?.length ?? 0) + 1,
    line: lines.length
  };
}

export function parseEditorOutline(markdown: string): ReadonlyArray<EditorOutlineEntry> {
  const normalized = normalizeLineEndings(markdown);
  const lines = normalized.split('\n');
  const contentLines = stripContainerLines(lines);
  const entries: Array<Omit<EditorOutlineEntry, 'depth'>> = [];
  let fence: Fence | null = null;
  let htmlBlock: HtmlBlock | null = null;
  let containerIdentity: string | null = null;
  let offset = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const containerLine = contentLines[index] ?? { content: '', identity: '0:' };
    const contentLine = containerLine.content;
    if (null !== containerIdentity && containerIdentity !== containerLine.identity) {
      fence = null;
      htmlBlock = null;
    }
    containerIdentity = containerLine.identity;
    const fenceState = advanceFence(contentLine, fence);
    fence = fenceState.fence;
    if (fenceState.consumed || /^ {4}|^\t/.test(contentLine)) {
      offset += line.length + 1;
      continue;
    }

    const htmlState = advanceHtmlBlock(contentLine, htmlBlock);
    htmlBlock = htmlState.block;
    if (htmlState.consumed) {
      offset += line.length + 1;
      continue;
    }

    const atx = contentLine.match(/^\s{0,3}(#{1,6})[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/);
    if (atx?.[1] && atx[2] && !/^\s*\\#/.test(contentLine)) {
      const text = atx[2].trim();
      if (text) {
        entries.push({ key: `${offset}:${atx[1].length}`, level: atx[1].length, offset, text });
      }
      offset += line.length + 1;
      continue;
    }

    const nextContainerLine = contentLines[index + 1];
    const setext = index + 1 < lines.length && nextContainerLine?.identity === containerLine.identity
      ? nextContainerLine.content.match(/^\s{0,3}(=+|-+)\s*$/)
      : null;
    if (contentLine.trim() && !/^\s*\\/.test(contentLine) && setext?.[1]) {
      entries.push({
        key: `${offset}:setext`,
        level: '=' === setext[1][0] ? 1 : 2,
        offset,
        text: contentLine.trim()
      });
    }
    offset += line.length + 1;
  }

  let hierarchy: number[] = [];
  let sectionHierarchy: number[] | null = null;
  return entries.map((entry, index) => {
    const numberedSection = /^\d+\.\s*/.test(entry.text);
    if (0 === index || numberedSection) {
      hierarchy = [entry.level];
      sectionHierarchy = numberedSection ? [entry.level] : null;
      return { ...entry, depth: 0 };
    }
    if (sectionHierarchy) {
      while (
        sectionHierarchy.length > 1
        && (sectionHierarchy[sectionHierarchy.length - 1] ?? 0) >= entry.level
      ) {
        sectionHierarchy.pop();
      }
      const depth = sectionHierarchy.length;
      sectionHierarchy.push(entry.level);
      return { ...entry, depth };
    }
    while (hierarchy.length && (hierarchy[hierarchy.length - 1] ?? 0) >= entry.level) {
      hierarchy.pop();
    }
    const depth = hierarchy.length;
    hierarchy.push(entry.level);
    return { ...entry, depth };
  });
}
