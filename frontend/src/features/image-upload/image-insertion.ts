import type { ImageUploadInsertion } from '../../contracts/bootstrap/image-upload-bootstrap';

export function defaultImageAlt(fileName: string, fallback: string): string {
  if (!fileName) return fallback;
  return fileName.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
}

function escapeAltText(value: string): string {
  return value
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/[[\]]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeTitle(value: string): string {
  return value
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\s+/g, ' ')
    .trim();
}

export function imageInsertionText({
  defaultAlt,
  fileName,
  insertion,
  url,
}: Readonly<{
  defaultAlt: string;
  fileName: string;
  insertion: ImageUploadInsertion;
  url: string;
}>): string {
  const alt = defaultImageAlt(fileName, defaultAlt);
  const title = 'filename' === insertion.titleDisplay ? fileName : '';
  const escapedTitle = escapeTitle(title);
  const titleSuffix = escapedTitle ? ` "${escapedTitle}"` : '';
  return `![${escapeAltText(alt)}](${url.replace(/\)/g, '%29')}${titleSuffix})`;
}
