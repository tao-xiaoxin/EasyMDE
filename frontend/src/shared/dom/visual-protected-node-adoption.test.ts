import { describe, expect, it } from 'vitest';

import { VISUAL_MARKDOWN_READ_ONLY_SELECTOR } from '../../contracts/visual-markdown-read-only';
import {
  prepareVisualProtectedNodeAdoption,
  type VisualProtectedNodeMatching
} from './visual-protected-node-adoption';

function protectedNodes(root: ParentNode): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(VISUAL_MARKDOWN_READ_ONLY_SELECTOR)
  );
}

function parseRoots(markup: string): Node[] {
  const container = document.createElement('div');
  container.innerHTML = markup;
  return Array.from(container.childNodes);
}

function createToc(attributes: Readonly<Record<string, string>>): HTMLElement {
  const node = document.createElement('div');
  node.className = 'easymde-toc';
  node.innerHTML = '<ul><li>Same</li></ul>';
  for (const [name, value] of Object.entries(attributes)) {
    node.setAttribute(name, value);
  }
  return node;
}

function reusesToc(
  previousAttributes: Readonly<Record<string, string>>,
  candidateAttributes: Readonly<Record<string, string>>,
  matching: VisualProtectedNodeMatching
): boolean {
  const surface = document.createElement('div');
  const previous = createToc(previousAttributes);
  previous.setAttribute('contenteditable', 'false');
  surface.append(previous);
  const candidate = createToc(candidateAttributes);
  const prepared = prepareVisualProtectedNodeAdoption(
    Array.from(surface.childNodes),
    [candidate],
    true,
    matching
  );
  return prepared.nodes[0] === previous;
}

describe('visual protected node adoption', () => {
  for (const matching of ['path', 'protected-order'] as const) {
    it(`normalizes blank style and missing contenteditable in ${matching} mode`, () => {
      expect(reusesToc({}, { style: '' }, matching)).toBe(true);
      expect(reusesToc({}, { style: ' \t\n  ' }, matching)).toBe(true);
      expect(reusesToc({ style: '' }, {}, matching)).toBe(true);
      expect(reusesToc({ style: ' \t\n  ' }, {}, matching)).toBe(true);
      expect(reusesToc({}, { style: 'color: red' }, matching)).toBe(false);
      expect(reusesToc({ 'aria-label': 'old' }, { 'aria-label': 'new' }, matching))
        .toBe(false);
    });
  }

  it('matches duplicate protected roots by order when editable siblings shift paths', () => {
    const currentSurface = document.createElement('div');
    currentSurface.innerHTML = '<p>Before</p>'
      + '<div class="easymde-toc"><ul><li>Same</li></ul></div>'
      + '<p>Between</p>'
      + '<div class="easymde-toc"><ul><li>Same</li></ul></div>';
    const previous = protectedNodes(currentSurface);
    expect(previous).toHaveLength(2);
    for (const node of previous) node.setAttribute('contenteditable', 'false');

    const candidateRoots = parseRoots(
      '<p>Inserted</p><p>Before</p>'
        + '<div class="easymde-toc"><ul><li>Same</li></ul></div>'
        + '<p>Between</p>'
        + '<div class="easymde-toc"><ul><li>Same</li></ul></div>'
    );
    const currentRoots = Array.from(currentSurface.childNodes);
    const pathMatched = prepareVisualProtectedNodeAdoption(
      currentRoots,
      candidateRoots
    );
    expect(pathMatched.nodes[2]).not.toBe(previous[0]);
    expect(pathMatched.nodes[4]).not.toBe(previous[1]);

    const ordered = prepareVisualProtectedNodeAdoption(
      currentRoots,
      candidateRoots,
      true,
      'protected-order'
    );
    expect(ordered.nodes[2]).toBe(previous[0]);
    expect(ordered.nodes[4]).toBe(previous[1]);

    currentSurface.replaceChildren(...ordered.nodes);
    expect(protectedNodes(currentSurface)).toEqual(previous);
  });

  it('keeps individual attribute and HTML mismatches fresh without shifting pairs', () => {
    const currentSurface = document.createElement('div');
    currentSurface.innerHTML = '<div class="easymde-toc" data-id="one">One</div>'
      + '<div class="easymde-toc" data-id="two">Two</div>'
      + '<div class="easymde-toc" data-id="three">Three</div>';
    const previous = protectedNodes(currentSurface);
    expect(previous).toHaveLength(3);
    for (const node of previous) node.setAttribute('contenteditable', 'false');

    const candidateRoots = parseRoots(
      '<div class="easymde-toc" data-id="changed">One</div>'
        + '<div class="easymde-toc" data-id="two">Changed HTML</div>'
        + '<div class="easymde-toc" data-id="three">Three</div>'
    );
    const ordered = prepareVisualProtectedNodeAdoption(
      Array.from(currentSurface.childNodes),
      candidateRoots,
      true,
      'protected-order'
    );

    expect(ordered.nodes[0]).not.toBe(previous[0]);
    expect(ordered.nodes[1]).not.toBe(previous[1]);
    expect(ordered.nodes[2]).toBe(previous[2]);
    expect((ordered.nodes[0] as HTMLElement).getAttribute('contenteditable'))
      .toBe('false');
    expect((ordered.nodes[1] as HTMLElement).getAttribute('contenteditable'))
      .toBe('false');
  });

  it('adopts none when protected-node counts differ', () => {
    const currentSurface = document.createElement('div');
    currentSurface.innerHTML = '<div class="easymde-toc">One</div>'
      + '<div class="footnotes">Two</div>';
    const previous = protectedNodes(currentSurface);
    expect(previous).toHaveLength(2);
    for (const node of previous) node.setAttribute('contenteditable', 'false');

    const candidateRoots = parseRoots('<div class="easymde-toc">One</div>');
    const ordered = prepareVisualProtectedNodeAdoption(
      Array.from(currentSurface.childNodes),
      candidateRoots,
      true,
      'protected-order'
    );

    expect(ordered.nodes[0]).not.toBe(previous[0]);
    expect(ordered.nodes).not.toContain(previous[1]);
    expect((ordered.nodes[0] as HTMLElement).matches('.easymde-toc')).toBe(true);
    expect((ordered.nodes[0] as HTMLElement).getAttribute('contenteditable'))
      .toBe('false');
  });

  it('adopts a nested maximal root once and rolls back its candidate move', () => {
    const currentSurface = document.createElement('div');
    const markup = '<section><div class="footnotes"><ol><li>'
      + '<span class="easymde-math" data-easymde-rendered="1">2</span>'
      + '</li></ol></div></section>';
    currentSurface.innerHTML = markup;
    const previous = protectedNodes(currentSurface);
    const previousFootnotes = currentSurface.querySelector('.footnotes');
    const previousMath = currentSurface.querySelector('.easymde-math');
    expect(previous).toEqual([previousFootnotes, previousMath]);
    if (!previousFootnotes || !previousMath) {
      throw new Error('test-protected-node-missing');
    }
    for (const node of previous) node.setAttribute('contenteditable', 'false');

    const candidateRoots = parseRoots(markup);
    const ordered = prepareVisualProtectedNodeAdoption(
      Array.from(currentSurface.childNodes),
      candidateRoots,
      true,
      'protected-order'
    );
    const candidateSection = ordered.nodes[0] as HTMLElement;
    expect(candidateSection.querySelector('.footnotes')).toBe(previousFootnotes);
    expect(candidateSection.querySelector('.easymde-math')).toBe(previousMath);

    ordered.rollback();

    expect(currentSurface.querySelector('.footnotes')).toBe(previousFootnotes);
    expect(currentSurface.querySelector('.easymde-math')).toBe(previousMath);
    expect(candidateSection.querySelector('.footnotes')).not.toBe(previousFootnotes);
  });
});
