import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalMarkdownFixture } from '../wechat-canonical-fixture.mjs';

export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const adapterSource = resolve(
  repositoryRoot,
  'frontend/src/integrations/browser/wechat/create-browser-wechat-clipboard.ts'
);
export const previewSelector = '.easymde-pane-preview [data-easymde-preview-html-sink="1"]';
export const {
  length: canonicalMarkdownLength,
  markdown: canonicalMarkdown,
  sha256: canonicalMarkdownSha256
} = canonicalMarkdownFixture(
  repositoryRoot,
  'wechat-task-context-canonical-markdown-mismatch'
);
export const geometryQuantum = 1 / 64;
export const sourceOnlyImageReadinessCodes = new Set([
  'wechat-task-context-source-only-image-readiness-cleanup-failed',
  'wechat-task-context-source-only-image-readiness-decode-failed',
  'wechat-task-context-source-only-image-readiness-error',
  'wechat-task-context-source-only-image-readiness-image-set-changed',
  'wechat-task-context-source-only-image-readiness-intrinsic-unavailable',
  'wechat-task-context-source-only-image-readiness-listener-failed',
  'wechat-task-context-source-only-image-readiness-root-changed',
  'wechat-task-context-source-only-image-readiness-timeout'
]);
export const taskStates = [
  ...Array(3).fill(true),
  ...Array(3).fill(false),
  ...Array(13).fill(true)
];
export const immersivePreviewSelector =
  '.easymde-immersive-preview-canvas [data-easymde-preview-html-sink="1"]';
