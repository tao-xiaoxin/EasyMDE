import { readFileSync } from 'node:fs';

export const fullCapabilityMarkdown = readFileSync(
  new URL('../../../docs/examples/markdown-full-capability-test.md', import.meta.url),
  'utf8'
);
export const fullCapabilityImage = readFileSync(
  new URL('../../../docs/assets/easymde-logo-rounded.png', import.meta.url)
);
export const fullCapabilityImageSource =
  'https://raw.githubusercontent.com/tao-xiaoxin/EasyMDE/main/docs/assets/easymde-logo-rounded.png';
export const fullCapabilityTaskStates = [
  ...Array(3).fill(true),
  ...Array(3).fill(false),
  ...Array(13).fill(true)
];
export const canonicalMermaidRoles = [
  'flowchart-v2',
  'sequence',
  'pie',
  'gantt',
  'classDiagram',
  'stateDiagram',
  'er',
  'mindmap',
  'timeline',
  'xychart'
];
export const mdmdtCss = readFileSync(
  new URL('../../../assets/themes/article/mdmdt.css', import.meta.url),
  'utf8'
);
export const mdmdtLinkIconDataUrls = [...mdmdtCss.matchAll(/data:image\/png;base64,[^"')]+/gu)]
  .map(([value]) => value);
if (mdmdtLinkIconDataUrls.length !== 2) {
  throw new Error('wechat-mdmdt-link-icon-assets-unavailable');
}
export const [mdmdtNormalLinkIconDataUrl] = mdmdtLinkIconDataUrls;
export const mediumMarkdown = [
  '# Medium WeChat copy fixture',
  '',
  'This synthetic document checks **rich text**, `inline code`, and a stable table.',
  '',
  '| Column | Value |',
  '| --- | --- |',
  '| medium | ready |',
  '',
  '```js',
  'const copied = true;',
  '```',
  '',
  '- [x] copied from the rendered Preview'
].join('\n');
export const codeThemeAuthoredFef = '\uFEFF';
export const codeThemeFidelityMarkdown = [
  '# Code theme Clipboard fidelity',
  '',
  'This fixture keeps token roles and the final line stable while the code palette changes.',
  '',
  `Body authored FEFF ${codeThemeAuthoredFef} remains in body text, with \`inline${codeThemeAuthoredFef}FEFF\`.`,
  '',
  '```js',
  '// Stable comment token.',
  'const answer = 42;',
  'function greet(name) {',
  '  const message = `Hello ${name}`;',
  '  if (answer > 0) return message;',
  '  return null;',
  '}',
  `const longLastLine = "${'x'.repeat(220)}";`,
  '```',
  '',
  '```css',
  '.sample { color: #336699; margin: 0 auto; }',
  '```',
  '',
  '```html',
  '<section data-state="ready">Rendered code</section>',
  '```'
].join('\n');
export const articleThemeFidelityMarkdown = [
  '# Article theme Clipboard fidelity',
  '',
  'A paragraph with **strong**, *emphasis*, ~~deletion~~, `inline code`, and [a link](https://example.test/article).',
  '',
  '> A quote remains part of the same rendered article.',
  '',
  '- first item',
  '- [x] completed item',
  '',
  '| Column | Value |',
  '| --- | --- |',
  '| article | stable |',
  '',
  'Inline math: $x^2 + y^2$.',
  '',
  '```js',
  'const articleThemeCode = true;',
  '```',
  '',
  '```mermaid',
  'graph LR',
  '  A[Start] --> B[Finish]',
  '```'
].join('\n');
// Keep this original H1/math/Mermaid profile for the immediate Blue -> Animal
// transition regression. The ordinary article matrix uses the structural style
// profile below so a changed markup shape cannot hide that race.
export const articleStyleMatrixMarkdown = [
  '# STYLE-H1 Article style matrix',
  '',
  'STYLE-BODY body text keeps **strong text**, *emphasis*, ~~deletion~~, `STYLE-INLINE-CODE`, and [STYLE-LINK](https://example.test/article-style).',
  '',
  '## STYLE-H2 A long bilingual heading for typography coverage 中文双语标题需要在窄宽度中保持稳定换行',
  '',
  '### STYLE-H3 Heading level three keeps a distinct article scale.',
  '',
  '> STYLE-QUOTE outer quote text remains stable across themes.',
  '>',
  '> > STYLE-NESTED-QUOTE nested quote text remains part of the same article.',
  '',
  '#### STYLE-H4 Heading level four follows the nested quote.',
  '',
  '- STYLE-LIST-OUTER outer list item',
  '  - STYLE-LIST-NESTED nested list item',
  '- [x] STYLE-TASK-DONE completed task item',
  '- [ ] STYLE-TASK-TODO pending task item',
  '',
  '##### STYLE-H5 Heading level five precedes the table.',
  '',
  '| STYLE-TABLE-A | STYLE-TABLE-B | STYLE-TABLE-C | STYLE-TABLE-D | STYLE-TABLE-E | STYLE-TABLE-F |',
  '| --- | --- | --- | --- | --- | --- |',
  '| alpha | beta | gamma | delta | epsilon | zeta |',
  '| one | two | three | four | five | six |',
  '',
  '###### STYLE-H6 Heading level six closes the article structure.',
  '',
  '```js',
  '// STYLE-FENCED-CODE',
  'const articleStyleMatrix = true;',
  '```'
].join('\n');
export const articleStyleMatrixSentinels = [
  { id: 'h1', kind: 'heading', text: 'STYLE-H1' },
  { id: 'h2', kind: 'heading', text: 'STYLE-H2' },
  { id: 'h3', kind: 'heading', text: 'STYLE-H3' },
  { id: 'h4', kind: 'heading', text: 'STYLE-H4' },
  { id: 'h5', kind: 'heading', text: 'STYLE-H5' },
  { id: 'h6', kind: 'heading', text: 'STYLE-H6' },
  { id: 'body', kind: 'body', text: 'STYLE-BODY' },
  { id: 'quote', kind: 'quote', text: 'STYLE-QUOTE' },
  { id: 'nestedQuote', kind: 'quote', text: 'STYLE-NESTED-QUOTE' },
  { id: 'table', kind: 'table', text: 'STYLE-TABLE-A' },
  { id: 'link', kind: 'link', text: 'STYLE-LINK' }
];
export const widthRegressionMarkdown = [
  '# Width regression fixture',
  '',
  'WIDTH-FLUID alpha keeps a long paragraph inside its own content box while the destination changes width. This sentence deliberately wraps several times to exercise automatic height growth without overlapping the next paragraph.',
  '',
  'WIDTH-FLUID beta follows the first paragraph and keeps authored margins and padding independent from the outer destination width. The text remains readable at narrow and wide destinations.',
  '',
  '![Width regression image](https://raw.githubusercontent.com/tao-xiaoxin/EasyMDE/main/docs/assets/easymde-logo-rounded.png)',
  '',
  '| Column | Value |',
  '| --- | --- |',
  '| width-local-scroll-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx | local scroll |',
  '| destination-independent-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx | independent |',
  '',
  '```js',
  `const widthRegressionLongLine = "${'x'.repeat(240)}";`,
  '```'
].join('\n');
export const readonlyProjectionMarkdown = [
  'Inline math: $x$ and $y$.',
  '',
  'Display math: \\[\\frac{1}{n}\\].',
  '',
  'Ordinary editable paragraph.'
].join('\n');
export const readonlyProjectionUpdatedMarkdown = [
  'Inline math: $x$ and $y$.',
  '',
  'Display math: \\[\\frac{1}{n}\\].',
  '',
  'Updated ordinary editable paragraph.'
].join('\n');
export const pngHiddenPreviewMarkdown = [
  '# Hidden Preview PNG fixture',
  '',
  '## Stable geometry',
  '',
  '> A quote keeps the hidden measurement tree in flow.',
  '',
  '| Column | Value |',
  '| --- | --- |',
  '| table | stable |',
  '',
  '```js',
  'const hiddenPreview = true;',
  '```',
  '',
  'Inline parent **before** $x^2$ **after**.',
  '',
  '```mermaid',
  'graph LR',
  '  A[Start] --> B[Finish]',
  '```'
].join('\n');
export const pngHiddenPreviewUpdatedMarkdown = [
  '# Hidden Preview PNG fixture',
  '',
  'Updated after the hidden Preview refresh.',
  '',
  '## Stable geometry',
  '',
  '> The updated quote remains in the hidden measurement tree.',
  '',
  '| Column | Value |',
  '| --- | --- |',
  '| table | refreshed |',
  '',
  '```js',
  'const hiddenPreview = false;',
  '```',
  '',
  'Inline parent **before** $x^2$ **after**.',
  '',
  '```mermaid',
  'graph LR',
  '  A[Start] --> B[Updated finish]',
  '```'
].join('\n');
