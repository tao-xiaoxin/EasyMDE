import { imageMarkdownText } from './image-insertion';

export type ImageUploadSurface = 'source' | 'visual';

export type RemoteImagePasteCandidate = Readonly<{
  altText: string;
  fallbackText: string;
  sourceText: string;
  url: string;
}>;

function absoluteHttpUrl(value: string): string | null {
  if (!value || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? value : null;
  } catch {
    return null;
  }
}

function singleHtmlImage(
  html: string,
  plainText: string,
  documentRef: Document,
): RemoteImagePasteCandidate | null {
  if (!html || html.length > 65_536) return null;
  const template = documentRef.createElement('template');
  template.innerHTML = html;
  const contentNodes = Array.from(template.content.childNodes).filter(
    (node) => Node.COMMENT_NODE !== node.nodeType && (Node.TEXT_NODE !== node.nodeType || '' !== node.textContent?.trim()),
  );
  if (1 !== contentNodes.length) return null;
  const node = contentNodes[0];
  if (Node.ELEMENT_NODE !== node?.nodeType || 'img' !== (node as Element).localName) return null;
  const image = node as HTMLImageElement;
  const url = absoluteHttpUrl(image.getAttribute('src') ?? '');
  if (!url) return null;
  const altText = (image.getAttribute('alt') ?? '').slice(0, 2048);
  return {
    altText,
    fallbackText: plainText.trim() || imageMarkdownText({ alt: altText, url }),
    sourceText: image.outerHTML,
    url,
  };
}

function closingAltBracket(value: string): number {
  let escaped = false;
  for (let index = 2; index < value.length; index += 1) {
    const character = value[index];
    if (escaped) {
      escaped = false;
    } else if ('\\' === character) {
      escaped = true;
    } else if (']' === character) {
      return index;
    }
  }
  return -1;
}

function markdownImage(value: string): RemoteImagePasteCandidate | null {
  const sourceText = value.trim();
  if (!sourceText.startsWith('![') || !sourceText.endsWith(')')) return null;
  const altEnd = closingAltBracket(sourceText);
  if (-1 === altEnd || '(' !== sourceText[altEnd + 1]) return null;
  const destination = sourceText.slice(altEnd + 2, -1).trim();
  if (!destination || /\s/.test(destination) || destination.includes('(') || destination.includes(')')) return null;
  const url = absoluteHttpUrl(destination.startsWith('<') && destination.endsWith('>')
    ? destination.slice(1, -1)
    : destination);
  if (!url) return null;
  const altText = sourceText.slice(2, altEnd).replace(/\\([\\[\]])/g, '$1').slice(0, 2048);
  return { altText, fallbackText: sourceText, sourceText, url };
}

export function remoteImagePasteCandidate(
  transfer: DataTransfer | null,
  documentRef: Document,
  surface: ImageUploadSurface,
): RemoteImagePasteCandidate | null {
  if (!transfer || 'function' !== typeof transfer.getData) return null;
  const htmlCandidate = singleHtmlImage(
    transfer.getData('text/html'),
    transfer.getData('text/plain'),
    documentRef,
  );
  if (htmlCandidate) return htmlCandidate;
  return 'source' === surface
    ? markdownImage(transfer.getData('text/plain'))
    : null;
}
