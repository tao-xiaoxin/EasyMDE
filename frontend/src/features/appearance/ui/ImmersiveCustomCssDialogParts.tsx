import { createElement } from '@wordpress/element';
import type { CSSProperties } from 'react';

import type { CustomCssDialogStrings } from '../../../contracts/bootstrap/appearance-bootstrap';
import { Link2 } from '../../../generated/lucide-icons';

export function ThemeSparkIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 28 28" width="23" height="23">
      <path
        d="M13.1 1.8c.9 5.8 4.3 9.2 10.1 10.1-5.8.9-9.2 4.3-10.1 10.1C12.2 16.2 8.8 12.8 3 11.9c5.8-.9 9.2-4.3 10.1-10.1Z"
        fill="#5674F7"
      />
      <path
        d="M22.5 18.4c.35 2.25 1.7 3.6 3.95 3.95-2.25.35-3.6 1.7-3.95 3.95-.35-2.25-1.7-3.6-3.95-3.95 2.25-.35 3.6-1.7 3.95-3.95Z"
        fill="#8A67F7"
      />
    </svg>
  );
}

export function PreviewContent({
  strings,
  style
}: Readonly<{
  strings: CustomCssDialogStrings;
  style: CSSProperties;
}>) {
  return (
    <div
      className="easymde-custom-theme-preview easymde-immersive-workspace__custom-css-preview-content"
      style={style}
    >
      <h1>{strings.previewHeadingOne}</h1>
      <h2>{strings.previewHeadingTwo}</h2>
      <p>{strings.previewBodyText}</p>
      <p>
        {strings.previewParagraph} <strong>{strings.previewBoldText}</strong>
        {strings.previewInlineSeparator}
        <em>{strings.previewItalicText}</em>
        {strings.previewInlineSeparator}
        <del>{strings.previewDeletedText}</del>
        {strings.previewInlineSeparator}
        <mark>{strings.previewHighlight}</mark>
        {strings.previewInlineSeparator}
        <code>{strings.previewInlineCode}</code>{' '}
        {strings.previewInlineConjunction}<kbd>Ctrl K</kbd>
        {strings.previewSentenceEnd}
      </p>
      <pre>
        <code className="code-block hljs">
          <span className="code-preview-line">
            <span>
              <span className="hljs-keyword">const</span> message ={' '}
              <span className="hljs-string">&quot;Hello, EasyMDE!&quot;</span>
              {';'}
            </span>
          </span>
          <span className="code-preview-line">
            <span className="hljs-comment">
              {'// '}
              {strings.previewCodeComment}
            </span>
          </span>
          <span className="code-preview-line">
            <span>
              <span className="hljs-title function_">renderTheme</span>(message);
            </span>
          </span>
        </code>
      </pre>
      <blockquote>{strings.previewBlockquote}</blockquote>
      <div className="preview-list-grid">
        <ul>
          <li>{strings.previewUnorderedItem}</li>
          <li className="task-item">
            <input
              type="checkbox"
              checked
              readOnly
              aria-label={strings.previewCompletedTask}
            />
            {strings.previewCompletedTask}
          </li>
        </ul>
        <ol>
          <li>{strings.previewOrderedItem}</li>
          <li>{strings.previewSecondStep}</li>
        </ol>
      </div>
      <table>
        <thead>
          <tr>
            {[1, 2, 3].map((number) => (
              <th key={number}>{strings.previewTableHeader} {number}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            {[1, 2, 3].map((number) => (
              <td key={number}>{strings.previewTableContent} {number}</td>
            ))}
          </tr>
          <tr>
            {[4, 5, 6].map((number) => (
              <td key={number}>{strings.previewTableContent} {number}</td>
            ))}
          </tr>
        </tbody>
      </table>
      <a id="preview-link" href="#preview-link">
        <Link2 aria-hidden="true" size={15} />
        {strings.previewLink}
      </a>
      <div className="preview-alert-grid">
        <aside className="markdown-alert-note">
          <strong>{strings.previewNoteLabel}</strong>
          <span>{strings.previewInformation}</span>
        </aside>
        <aside className="markdown-alert-tip">
          <strong>{strings.previewTipLabel}</strong>
          <span>{strings.previewSuccess}</span>
        </aside>
        <aside className="markdown-alert-warning">
          <strong>{strings.previewWarningLabel}</strong>
          <span>{strings.previewWarning}</span>
        </aside>
        <aside className="markdown-alert-caution">
          <strong>{strings.previewCautionLabel}</strong>
          <span>{strings.previewDanger}</span>
        </aside>
      </div>
      <details open>
        <summary>{strings.previewDetails}</summary>
        <p>{strings.previewDetailsContent}</p>
      </details>
      <dl>
        <dt>{strings.previewDefinitionTerm}</dt>
        <dd>{strings.previewDefinitionDescription}</dd>
      </dl>
      <hr />
      <h3>{strings.previewSupplementalHeading}</h3>
      <p>
        {strings.previewSupplementalText}
        <sup>
          <a href="#preview-footnote">
            [1]
          </a>
        </sup>
      </p>
      <div id="preview-footnote" className="footnotes">
        {strings.previewFootnote}
      </div>
    </div>
  );
}

export function CodeEditor({
  disabled,
  label,
  onChange,
  placeholder,
  value
}: Readonly<{
  disabled: boolean;
  label: string;
  onChange: (value: string) => void;
  placeholder: string;
  value: string;
}>) {
  const displayValue = value || placeholder;
  const lineCount = displayValue.split('\n').length;

  return (
    <div className="easymde-custom-css-code-editor">
      <div aria-hidden="true" className="easymde-custom-css-code-lines">
        {Array.from({ length: lineCount }, (_, index) => index + 1).map(
          (lineNumber) => (
            <span key={lineNumber}>{lineNumber}</span>
          )
        )}
      </div>
      <textarea
        aria-label={label}
        disabled={disabled}
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </div>
  );
}
