import { markdownLanguage } from '@codemirror/lang-markdown';
import { describe, expect, it } from 'vitest';

import { markdownReferenceContextQuery, markdownReferenceDefinitionQuery, type MarkdownSyntaxNode } from './editor-markdown-link-preparation';

function definitions(source: string, profile: 11 | 13 | 14 | 16 | 17 | 'unsupported' = 14) {
  const nodes: MarkdownSyntaxNode[] = [];
  markdownLanguage.parser.parse(source).iterate({ enter(node) {
    nodes.push({ from: node.from, name: node.name, to: node.to });
  } });
  return markdownReferenceDefinitionQuery(source, nodes, profile);
}

function context(current: string, formal: string) {
  const syntax = (source: string): MarkdownSyntaxNode[] => {
    const nodes: MarkdownSyntaxNode[] = [];
    markdownLanguage.parser.parse(source).iterate({ enter(node) {
      nodes.push({ from: node.from, name: node.name, to: node.to });
    } });
    return nodes;
  };
  return markdownReferenceContextQuery(current, syntax(current), formal, syntax(formal), 14);
}

describe('reference definition provenance', () => {
  it('selects the first definition and keeps raw destination and title bytes', () => {
    const query = definitions('[LABEL]: <a&amp;b> "first"\n\n[label]: /second "other"');
    expect(query('label')).toEqual({ destination: '<a&amp;b>', title: '"first"' });
    expect(query('missing')).toBeNull();
  });

  it('compares raw first-definition tokens independently of unrelated text and shadowed definitions', () => {
    const original = definitions('[x]: /same "title"\n\n[x]: /shadow');
    const moved = definitions('Text\n\n[x]: /same "title"\n\n[x]: /changed');
    const destinationChanged = definitions('[x]: /different "title"');
    const titleChanged = definitions('[x]: /same "changed"');
    expect(original('x')).toEqual(moved('x'));
    expect(original('x')).not.toEqual(destinationChanged('x'));
    expect(original('x')).not.toEqual(titleChanged('x'));
    expect(original('x')).not.toEqual(definitions('Text')('x'));
  });

  it('uses PHP whitespace and Unicode folding while excluding fenced definitions', () => {
    const query = definitions('[a\u00a0b]: /one\n\n[STRASSE]: /two\n\n```\n[hidden]: /three\n```');
    expect(query('a b')).toBeNull();
    expect(query('a\u00a0b')).toEqual({ destination: '/one', title: null });
    expect(query('Stra\u00dfe')).toEqual({ destination: '/two', title: null });
    expect(query('hidden')).toBeNull();
  });

  it('does not request an unsupported Unicode proof until a lookup is made', () => {
    const query = definitions('[\u00df]: /image', 'unsupported');
    expect(() => query('\u00df')).toThrow('visual-editor-reference-label-fold-profile-unavailable');
  });

  it('accepts unchanged active definitions and explicitly rejects a changed formal context', () => {
    const formal = '[id]: /one "title"\n\n[id]: /shadow';
    expect(context(`Text\n\n${formal.replace('/shadow', '/other')}`, formal)('id')).toBe(true);
    expect(context('Text', formal)('missing')).toBe(false);
    for (const current of ['[id]: /two "title"', '[id]: /one "new"', 'Text']) {
      expect(() => context(current, formal)('id')).toThrow('visual-editor-reference-context-stale');
    }
    expect(() => context(formal, 'Text')('id')).toThrow('visual-editor-reference-context-stale');
  });
});
