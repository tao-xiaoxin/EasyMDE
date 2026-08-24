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
  uploadedAlt,
  uploadedTitle,
  url,
}: Readonly<{
  defaultAlt: string;
  fileName: string;
  insertion: ImageUploadInsertion;
  uploadedAlt: string;
  uploadedTitle: string;
  url: string;
}>): string {
  if ('url' === insertion.format) return url;

  const fileNameAlt = defaultImageAlt(fileName, uploadedAlt || uploadedTitle || defaultAlt);
  const alt = 'empty' === insertion.altSource ? '' : 'upload' === insertion.altSource ? uploadedAlt : fileNameAlt;
  const title =
    'filename' === insertion.captionMode ? fileNameAlt : 'upload' === insertion.captionMode ? uploadedTitle : '';
  const escapedTitle = escapeTitle(title);
  const titleSuffix = escapedTitle ? ` "${escapedTitle}"` : '';
  return `![${escapeAltText(alt)}](${url.replace(/\)/g, '%29')}${titleSuffix})`;
}
