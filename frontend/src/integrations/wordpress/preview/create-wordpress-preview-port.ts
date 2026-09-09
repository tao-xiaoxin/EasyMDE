import type {
  PreviewEditMap,
  PreviewEditMapBlock,
  PreviewRequest,
  PreviewRequestPort,
  PreviewResponse,
  SafePreviewHtml
} from '../../../contracts/ports/preview-request';
import { MAX_PREVIEW_EDIT_MAP_BLOCKS as MAX_EDIT_MAP_BLOCKS } from '../../../contracts/ports/preview-request';
import { isPreviewFeatureKey } from '../../../contracts/ports/preview-request';
import { wordpressEndpoint } from '../shared/wordpress-endpoint';

export type WordPressApiFetch = (options: Readonly<Record<string, unknown>>) => Promise<unknown>;

export class PreviewResponseError extends Error {
  public constructor() {
    super('preview-response-invalid');
    this.name = 'PreviewResponseError';
  }
}

const VISUAL_BLOCK_ATTRIBUTE = 'data-easymde-visual-block-id';
const PROTOTYPE_RESERVED_KEYS = new Set([
  '__proto__',
  'constructor',
  'prototype'
]);

type UnknownRecord = Record<string, unknown>;

function invalidResponse(): never {
  throw new PreviewResponseError();
}

function isSafeRecord(value: unknown): value is UnknownRecord {
  if (!value || 'object' !== typeof value || Array.isArray(value)) {
    return false;
  }

  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return false;
    }
    return Object.keys(value).every((key) => !PROTOTYPE_RESERVED_KEYS.has(key));
  } catch {
    return false;
  }
}

function hasOwn(record: UnknownRecord, key: string): boolean {
  return undefined !== Object.getOwnPropertyDescriptor(record, key);
}

function lineCount(markdown: string): number {
  let count = 1;
  for (let index = 0; index < markdown.length; index += 1) {
    const character = markdown[index];
    if ('\r' === character) {
      count += 1;
      if ('\n' === markdown[index + 1]) index += 1;
    } else if ('\n' === character) {
      count += 1;
    }
  }
  return count;
}

function parseFeatures(value: unknown): Record<string, boolean> {
  if (!isSafeRecord(value)) invalidResponse();

  const features: Record<string, boolean> = {};
  for (const [key, enabled] of Object.entries(value)) {
    if (!isPreviewFeatureKey(key) || 'boolean' !== typeof enabled) {
      invalidResponse();
    }
    features[key] = enabled;
  }
  return features;
}

function validateTopLevelBlockMarkers(
  html: string,
  blocks: ReadonlyArray<PreviewEditMapBlock>
): void {
  const Parser = globalThis.DOMParser;
  if ('function' !== typeof Parser) invalidResponse();

  let parsed: Document;
  try {
    parsed = new Parser().parseFromString(html, 'text/html');
  } catch {
    invalidResponse();
  }

  const topLevelElements = Array.from(parsed.body.children);
  if (topLevelElements.length !== blocks.length) invalidResponse();

  for (let index = 0; index < topLevelElements.length; index += 1) {
    const element = topLevelElements[index];
    const block = blocks[index];
    if (!element || !block || element.getAttribute(VISUAL_BLOCK_ATTRIBUTE) !== block.id) {
      invalidResponse();
    }
  }

  for (const child of Array.from(parsed.body.childNodes)) {
    if (3 === child.nodeType && (child.textContent ?? '').trim()) {
      invalidResponse();
    }
  }
}

function parseEditMap(
  value: unknown,
  markdown: string,
  html: string,
  signature: string
): PreviewEditMap {
  if (!isSafeRecord(value)) invalidResponse();

  if (
    value.version !== 1
    || value.coordinate !== 'line'
    || hasOwn(value, 'signature')
    || !Array.isArray(value.blocks)
    || value.blocks.length > MAX_EDIT_MAP_BLOCKS
  ) {
    invalidResponse();
  }

  const maximumLine = lineCount(markdown);
  const blocks: PreviewEditMapBlock[] = [];
  const ids = new Set<string>();
  let previous: PreviewEditMapBlock | undefined;

  for (let index = 0; index < value.blocks.length; index += 1) {
    const rawBlock = value.blocks[index];
    if (!isSafeRecord(rawBlock)) invalidResponse();

    const id = rawBlock.id;
    const startLine = rawBlock.startLine;
    const endLine = rawBlock.endLine;
    const editable = rawBlock.editable;
    if (
      'string' !== typeof id
      || !/^b\d+$/.test(id)
      || ids.has(id)
      || 'number' !== typeof startLine
      || 'number' !== typeof endLine
      || !Number.isSafeInteger(startLine)
      || !Number.isSafeInteger(endLine)
      || startLine < 0
      || endLine < startLine
      || endLine > maximumLine
      || startLine > maximumLine
      || 'boolean' !== typeof editable
      || (editable && endLine <= startLine)
    ) {
      invalidResponse();
    }

    const block: PreviewEditMapBlock = {
      id,
      startLine,
      endLine,
      editable
    };
    if (previous && block.startLine < previous.startLine) invalidResponse();
    if (previous && block.startLine < previous.endLine) invalidResponse();
    ids.add(id);
    blocks.push(block);
    previous = block;
  }

  validateTopLevelBlockMarkers(html, blocks);
  return {
    version: 1,
    coordinate: 'line',
    signature,
    blocks
  };
}

function parseResponse(value: unknown, request: PreviewRequest): PreviewResponse {
  try {
    if (!isSafeRecord(value)) invalidResponse();

    if (
      !hasOwn(value, 'html')
      || !hasOwn(value, 'features')
      || !hasOwn(value, 'editMap')
      || 'string' !== typeof value.html
      || 'string' !== typeof request.signature
      || 'string' !== typeof request.markdown
    ) {
      invalidResponse();
    }

    const features = parseFeatures(value.features);
    const editMap = parseEditMap(
      value.editMap,
      request.markdown,
      value.html,
      request.signature
    );

    // The protected Preview route returns only PHP-rendered, server-sanitized HTML.
    return { html: value.html as SafePreviewHtml, features, editMap };
  } catch (error) {
    if (error instanceof PreviewResponseError) throw error;
    throw new PreviewResponseError();
  }
}

export function createWordPressPreviewPort(
  apiFetch: WordPressApiFetch,
  restUrl: string,
  nonce: string,
  siteUrl: string
): PreviewRequestPort {
  if ('function' !== typeof apiFetch || !restUrl || !nonce) {
    throw new Error('preview-transport-unavailable');
  }
  const endpoint = wordpressEndpoint(restUrl, siteUrl, 'preview-url-invalid').toString();

  return {
    async render(request: PreviewRequest, signal: AbortSignal): Promise<PreviewResponse> {
      const response = await apiFetch({
        url: endpoint,
        method: 'POST',
        headers: { 'X-WP-Nonce': nonce },
        data: {
          markdown: request.markdown,
          post_id: request.postId,
          markdown_theme: request.markdownTheme,
          code_theme: request.codeTheme,
          custom_css_id: request.customCssId
        },
        signal
      });

      return parseResponse(response, request);
    }
  };
}
