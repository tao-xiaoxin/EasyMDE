import { describe, expect, it } from 'vitest';

import {
  IMAGE_SCALE_PERCENTAGES,
  createMarkdownImageDestinationReplacement,
  createImageScaleReplacement,
  findMarkdownImageAt,
  imageScaleFromAttribute,
  parseMarkdownImageScale,
  serializeLegacyMarkdownImageWidth,
  serializeMarkdownImage
} from './image-scale-contract';
import { getCachedMarkdownBlockScan } from './image-scale-markdown-scan';

describe('image scale contract', () => {
  it('accepts only the seven measured percentages, including explicit 100%', () => {
    expect(IMAGE_SCALE_PERCENTAGES).toEqual([25, 33, 50, 67, 100, 150, 200]);
    for (const percentage of IMAGE_SCALE_PERCENTAGES) {
      const source = `![Alt](https://example.test/image.png "{width=${percentage}%}")`;
      expect(parseMarkdownImageScale(source)).toMatchObject({
        alt: 'Alt',
        destination: 'https://example.test/image.png',
        scale: percentage,
        title: null
      });
      expect(imageScaleFromAttribute(`${percentage}%`)).toBe(percentage);
    }
    expect(parseMarkdownImageScale('![Alt](https://example.test/image.png)')?.scale).toBeNull();
    expect(imageScaleFromAttribute(null)).toBeNull();
    expect(imageScaleFromAttribute('')).toBeNull();
  });

  it('preserves escaped alt text, title, and an angle-bracket destination', () => {
    const source = String.raw`![A \]lt](<https://example.test/a (copy).png> "Ti\"tle {width=67%}")`;
    expect(parseMarkdownImageScale(source)).toMatchObject({
      alt: String.raw`A \]lt`,
      destination: 'https://example.test/a (copy).png',
      scale: 67,
      title: String.raw`Ti\"tle`
    });
  });

  it('rejects unsupported or ambiguous scale markers instead of normalizing them', () => {
    for (const source of [
      '![Alt](https://example.test/image.png "{width=50.0%}")',
      '![Alt](https://example.test/image.png "{width=51%}")',
      '![Alt](https://example.test/image.png "{width=0%}")',
      '![Alt](https://example.test/image.png "{width=50}")',
      '![Alt](https://example.test/image.png "{width=50%}{width=67%}")',
      '![Alt](https://example.test/image.png "{width=50%foo}")',
      '![Alt](https://example.test/image.png "Title{width=50%}")',
      '![Alt](https://example.test/image.png "{width=50%} {width=67%}")',
      '![Alt](https://example.test/image.png "Title {width=50%} {width=67%}")',
      '![Alt](https://example.test/image.png "Title {width=50%}   {width=67%}")'
    ]) {
      expect(() => parseMarkdownImageScale(source)).toThrow('image-scale-syntax-invalid');
    }
    expect(() => imageScaleFromAttribute('51%')).toThrow('image-scale-invalid-width');
  });

  it('preserves nonterminal width text literally and appends or updates only a terminal marker', () => {
    const literalSource = '![Alt](https://example.test/image.png "Syntax {width=50%} example")';
    const literalImage = parseMarkdownImageScale(literalSource);
    expect(literalImage).toMatchObject({
      scale: null,
      title: 'Syntax {width=50%} example',
      titleMarkerEnd: null,
      titleMarkerStart: null
    });
    if (!literalImage) throw new Error('image-scale-test-image-missing');

    const appendReplacement = createImageScaleReplacement(literalSource, literalImage, 67);
    const scaledSource =
      literalSource.slice(0, appendReplacement.from)
      + appendReplacement.insert
      + literalSource.slice(appendReplacement.to);
    expect(scaledSource).toBe(
      '![Alt](https://example.test/image.png "Syntax {width=50%} example {width=67%}")'
    );

    const scaledImage = parseMarkdownImageScale(scaledSource);
    expect(scaledImage).toMatchObject({
      scale: 67,
      title: 'Syntax {width=50%} example'
    });
    if (!scaledImage) throw new Error('image-scale-test-image-missing');

    const updateReplacement = createImageScaleReplacement(scaledSource, scaledImage, 100);
    const updatedSource =
      scaledSource.slice(0, updateReplacement.from)
      + updateReplacement.insert
      + scaledSource.slice(updateReplacement.to);
    expect(updatedSource).toBe(
      '![Alt](https://example.test/image.png "Syntax {width=50%} example {width=100%}")'
    );
  });

  it('returns one pure replacement while preserving the original image fields', () => {
    const source = 'before  ![Alt](<https://example.test/image (copy).png>  \'Title\') after';
    const image = parseMarkdownImageScale(source, 8);
    if (!image) throw new Error('image-scale-test-image-missing');

    const replacement = createImageScaleReplacement(source, image, 150);
    expect(replacement).toEqual({
      from: image.titleEnd ?? -1,
      insert: ' {width=150%}',
      to: image.titleEnd ?? -1
    });
    expect(
      source.slice(0, replacement.from)
      + replacement.insert
      + source.slice(replacement.to)
    ).toBe(
      'before  ![Alt](<https://example.test/image (copy).png>  \'Title {width=150%}\') after'
    );
    expect(createImageScaleReplacement(source, image, 100)).toEqual({
      from: image.titleEnd ?? -1,
      insert: ' {width=100%}',
      to: image.titleEnd ?? -1
    });
  });

  it('replaces only a changed bare destination and validates captured identity', () => {
    const source = 'before ![Alt](https://example.test/old.png "Title") after';
    const start = source.indexOf('![');
    const captured = parseMarkdownImageScale(source, start);
    if (!captured) throw new Error('image-scale-test-image-missing');

    const replacement = createMarkdownImageDestinationReplacement(
      source,
      captured,
      'https://example.test/new.png'
    );
    if (!replacement) throw new Error('image-scale-test-replacement-missing');
    expect(source.slice(0, replacement.from) + replacement.insert + source.slice(replacement.to))
      .toBe('before ![Alt](https://example.test/new.png "Title") after');
    expect(() => createMarkdownImageDestinationReplacement(
      source.replace('old.png', 'changed.png'),
      captured,
      'https://example.test/new.png'
    )).toThrow('image-scale-image-stale');
  });

  it('preserves CRLF, spacing, and alternate title quote bytes', () => {
    const source = "before ![Alt](https://example.test/old.png   'Title')\r\nnext";
    const captured = parseMarkdownImageScale(source, source.indexOf('!['));
    if (!captured) throw new Error('image-scale-test-image-missing');
    const replacement = createMarkdownImageDestinationReplacement(
      source,
      captured,
      'https://example.test/new.png'
    );
    if (!replacement) throw new Error('image-scale-test-replacement-missing');
    expect(source.slice(0, replacement.from) + replacement.insert + source.slice(replacement.to))
      .toBe("before ![Alt](https://example.test/new.png   'Title')\r\nnext");
  });

  it('preserves angle style while escaping a changed destination exactly once', () => {
    const source = '![Alt](<https://example.test/old path.png> "Title")';
    const captured = parseMarkdownImageScale(source);
    if (!captured) throw new Error('image-scale-test-image-missing');
    const nextDestination = 'https://example.test/new)b.png';
    const replacement = createMarkdownImageDestinationReplacement(
      source,
      captured,
      nextDestination
    );
    if (!replacement) throw new Error('image-scale-test-replacement-missing');
    expect(replacement.insert).toBe(nextDestination);
    expect(source.slice(0, replacement.from) + replacement.insert + source.slice(replacement.to))
      .toBe('![Alt](<https://example.test/new)b.png> "Title")');
  });

  it('does not turn three destination backslashes into nine', () => {
    const source = '![Alt](https://example.test/old.png)';
    const captured = parseMarkdownImageScale(source);
    if (!captured) throw new Error('image-scale-test-image-missing');
    const nextDestination = String.raw`https://example.test/new\\\path.png`;
    expect(nextDestination.match(/\\/gu)).toHaveLength(3);
    const replacement = createMarkdownImageDestinationReplacement(
      source,
      captured,
      nextDestination
    );
    if (!replacement) throw new Error('image-scale-test-replacement-missing');
    expect(replacement.insert.match(/\\/gu)).toHaveLength(6);
    expect(replacement.insert.match(/\\/gu)).not.toHaveLength(9);
  });

  it('preserves escaped destination parity for adversarial backslash runs', () => {
    for (const count of [0, 1, 2, 3, 4, 5, 8, 16]) {
      const source = `![Alt](${''.padStart(count, '\\')}a.png)`;
      const image = parseMarkdownImageScale(source);
      expect(image?.destination, `backslash-count-${count}`).toBe(
        `${''.padStart(Math.ceil(count / 2), '\\')}a.png`
      );
      expect(image?.raw).toBe(source);
    }
  });

  it('keeps long bare-destination slash runs linear without changing grammar', () => {
    const measure = (count: number, samples = 3): number => {
      const source = `![Alt](${''.padStart(count, '\\')}a.png)`;
      const timings: number[] = [];
      for (let sample = 0; sample < samples; sample += 1) {
        const started = performance.now();
        const image = parseMarkdownImageScale(source);
        timings.push(performance.now() - started);
        expect(image?.destination).toBe(
          `${''.padStart(Math.ceil(count / 2), '\\')}a.png`
        );
        expect(image?.raw).toBe(source);
      }
      timings.sort((left, right) => left - right);
      return timings[Math.floor(timings.length / 2)] ?? 0;
    };
    measure(1_024, 1);
    const medium = measure(8_192);
    const large = measure(65_536, 2);
    expect(large).toBeLessThan(2_000);
    expect(large).toBeLessThan(medium * 32 + 250);
  });

  it('returns null and preserves source bytes when the destination is unchanged', () => {
    const source = "![Alt](<https://example.test/a)b.png>  'Title')";
    const captured = parseMarkdownImageScale(source);
    if (!captured) throw new Error('image-scale-test-image-missing');
    expect(createMarkdownImageDestinationReplacement(source, captured, captured.destination)).toBeNull();
    expect(source).toBe("![Alt](<https://example.test/a)b.png>  'Title')");
  });

  it('replaces only an existing marker when changing an already scaled image', () => {
    const source = 'prefix ![Alt](url "Title {width=50%}") suffix';
    const image = parseMarkdownImageScale(source, 7);
    if (!image || null === image.titleMarkerStart || null === image.titleMarkerEnd) {
      throw new Error('image-scale-test-marker-missing');
    }
    const replacement = createImageScaleReplacement(source, image, 100);
    expect(source.slice(0, replacement.from)).toBe('prefix ![Alt](url "Title ');
    expect(replacement.insert).toBe('{width=100%}');
    expect(source.slice(replacement.to)).toBe('") suffix');
  });

  it('hits only an image fully containing the current source selection', () => {
    const source = '![Alt](https://example.test/image.png "{width=50%}")\n\nText';
    const image = parseMarkdownImageScale(source);
    if (!image) throw new Error('image-scale-test-image-missing');
    expect(findMarkdownImageAt(source, image.start + 3, image.start + 5)).toEqual(image);
    expect(findMarkdownImageAt(source, image.end, image.end)).toBeNull();
    expect(() => findMarkdownImageAt(source, image.start - 1, image.start + 5)).toThrow(
      'image-scale-range-invalid'
    );
  });

  it('does not hit images inside fenced or inline code', () => {
    const source = [
      '`![inline](https://example.test/inline.png "{width=50%}")`',
      '',
      '```markdown',
      '![fenced](https://example.test/fenced.png "{width=67%}")',
      '```',
      '',
      '![real](https://example.test/real.png "{width=100%}")'
    ].join('\n');
    expect(findMarkdownImageAt(source, source.indexOf('inline') + 1)).toBeNull();
    expect(findMarkdownImageAt(source, source.indexOf('fenced') + 1)).toBeNull();
    expect(findMarkdownImageAt(source, source.indexOf('real') + 1)?.scale).toBe(100);
  });

  it('serializes a visual image to canonical syntax that parses back', () => {
    const source = serializeMarkdownImage({
      alt: 'A ]lt',
      destination: 'https://example.test/image.png',
      scale: 200,
      title: 'A "title"'
    });
    expect(source).toBe('![A \\]lt](https://example.test/image.png "A \\"title\\" {width=200%}")');
    expect(parseMarkdownImageScale(source)).toMatchObject({
      alt: 'A \\]lt',
      destination: 'https://example.test/image.png',
      scale: 200,
      title: 'A \\"title\\"'
    });
  });

  it('keeps spaces inside an angle destination instead of escaping them', () => {
    const source = serializeMarkdownImage({
      alt: 'Alt',
      destination: 'https://example.test/a b.png',
      scale: null,
      title: null
    });
    expect(source).toBe('![Alt](<https://example.test/a b.png>)');
    expect(parseMarkdownImageScale(source)).toMatchObject({
      destination: 'https://example.test/a b.png',
      scale: null
    });
  });

  it('uses an angle destination when a right parenthesis would truncate a URL', () => {
    const source = serializeMarkdownImage({
      alt: 'Alt',
      destination: 'https://example.test/a)b.png',
      scale: null,
      title: null
    });
    expect(source).toBe('![Alt](<https://example.test/a)b.png>)');
    expect(parseMarkdownImageScale(source)).toMatchObject({
      destination: 'https://example.test/a)b.png',
      scale: null
    });
  });

  it('retains a historical simple width syntax for the existing theme owner', () => {
    expect(serializeLegacyMarkdownImageWidth({
      alt: 'Alt',
      destination: 'https://example.test/a.png',
      title: null
    }, '68%')).toBe('![Alt](https://example.test/a.png =68%x)');
  });

  it('rejects an ambiguous bare destination that would truncate at a right parenthesis', () => {
    const source = '![Alt](https://example.test/a).png';
    expect(parseMarkdownImageScale(source)).toBeNull();
    expect(findMarkdownImageAt(source, 4)).toBeNull();
  });

  it('does not hit escaped or four-space indented-code images', () => {
    const source = [
      '\\![escaped](https://example.test/escaped.png "{width=50%}")',
      '',
      '    ![indented](https://example.test/indented.png "{width=67%}")',
      '',
      '![real](https://example.test/real.png "{width=100%}")'
    ].join('\n');
    expect(findMarkdownImageAt(source, source.indexOf('escaped') + 1)).toBeNull();
    expect(findMarkdownImageAt(source, source.indexOf('indented') + 1)).toBeNull();
    expect(findMarkdownImageAt(source, source.indexOf('real') + 1)?.scale).toBe(100);
  });

  it('skips an invalid non-target marker but reports it when it is selected', () => {
    const source = [
      '![Bad](https://example.test/bad.png "{width=51%}")',
      '',
      '![Good](https://example.test/good.png "{width=50%}")'
    ].join('\n');
    const target = source.indexOf('![Good]');
    expect(findMarkdownImageAt(source, target + 3)?.destination).toBe(
      'https://example.test/good.png'
    );
    expect(() => findMarkdownImageAt(source, 4)).toThrow(
      'image-scale-syntax-invalid'
    );
  });

  it('keeps malformed opening candidates near-linear', () => {
    const measure = (count: number): number => {
      const source = '!['.repeat(count);
      const started = performance.now();
      expect(findMarkdownImageAt(source, source.length - 1)).toBeNull();
      return performance.now() - started;
    };
    const medium = measure(2_000);
    const large = measure(16_000);
    expect(large).toBeLessThan(1_500);
    expect(large).toBeLessThan(medium * 20 + 200);
  });

  it('rejects scaling titles whose trailing whitespace, entities, or newlines would create PHP-invalid repeated markers', () => {
    for (const rawTitle of [
      'Caption {width=33%} ',
      'Caption {width=33%}\t',
      'Caption {width=33%}&#32;',
      String.raw`Caption {width=33%}\&#32;`,
      'Caption {width=33%}&Tab;',
      'Caption {width=33%}\n',
      'Caption {width=bad} '
    ]) {
      const source = `![Alt](https://example.test/image.png "${rawTitle}")`;
      const parsed = parseMarkdownImageScale(source);
      expect(parsed, rawTitle).toMatchObject({
        scale: null,
        title: rawTitle,
        titleMarkerEnd: null,
        titleMarkerStart: null
      });
      if (!parsed) throw new Error('image-scale-test-image-missing');
      expect(() => createImageScaleReplacement(source, parsed, 100), rawTitle).toThrow(
        'image-scale-syntax-invalid'
      );
    }
  });

  it('preserves entity-newline and multiline titles with exact PHP parity', () => {
    const entityNewlineRepeated =
      '![Alt](https://example.test/image.png "Caption {width=33%}&NewLine; {width=67%}")';
    const parsedEntityNewline = parseMarkdownImageScale(entityNewlineRepeated);
    expect(parsedEntityNewline).toMatchObject({
      scale: 67,
      title: 'Caption {width=33%}&NewLine;'
    });
    if (!parsedEntityNewline) throw new Error('image-scale-test-image-missing');
    const replacement = createImageScaleReplacement(
      entityNewlineRepeated,
      parsedEntityNewline,
      100
    );
    const updated =
      entityNewlineRepeated.slice(0, replacement.from)
      + replacement.insert
      + entityNewlineRepeated.slice(replacement.to);
    expect(updated).toBe(
      '![Alt](https://example.test/image.png "Caption {width=33%}&NewLine; {width=100%}")'
    );

    expect(
      parseMarkdownImageScale('![Alt](https://example.test/image.png "Caption&#10; {width=50%}")')
    ).toMatchObject({
      scale: 50,
      title: 'Caption&#10;'
    });
    expect(
      parseMarkdownImageScale(
        '![Alt](https://example.test/image.png "Caption\n  Line2 {width=50%}")'
      )
    ).toMatchObject({
      scale: 50,
      title: 'Caption\n  Line2'
    });

    for (const source of [
      '![Alt](https://example.test/image.png "Caption&#10;{width=50%}")',
      '![Alt](https://example.test/image.png "Caption&NewLine;{width=50%}")',
      '![Alt](https://example.test/image.png "Caption&#13;{width=50%}")',
      '![Alt](https://example.test/image.png "Caption\n {width=50%}")',
      '![Alt](https://example.test/image.png "Caption\r\n {width=50%}")'
    ]) {
      expect(() => parseMarkdownImageScale(source), source).toThrow(
        'image-scale-syntax-invalid'
      );
    }

    expect(
      parseMarkdownImageScale('![Alt](https://example.test/image.png "Line1\n\nLine2 {width=50%}")')
    ).toBeNull();
  });

  it('parses bare destinations ending with backslash-escaped punctuation', () => {
    expect(parseMarkdownImageScale(String.raw`![alt](https://example.com/a\))`)).toMatchObject({
      alt: 'alt',
      destination: 'https://example.com/a)',
      scale: null,
      title: null
    });
    expect(
      parseMarkdownImageScale(String.raw`![alt](https://example.com/a\) "Title {width=50%}")`)
    ).toMatchObject({
      alt: 'alt',
      destination: 'https://example.com/a)',
      scale: 50,
      title: 'Title'
    });
    expect(parseMarkdownImageScale(String.raw`![alt](https://example.com/a\_)`)).toMatchObject({
      destination: 'https://example.com/a_',
      scale: null,
      title: null
    });
    expect(parseMarkdownImageScale(String.raw`![alt](https://example.com/a\\)`)).toMatchObject({
      destination: 'https://example.com/a\\',
      scale: null,
      title: null
    });
    expect(
      parseMarkdownImageScale(String.raw`![alt](https://example.com/a\ "Title")`)
    ).toMatchObject({
      destination: 'https://example.com/a\\',
      scale: null,
      title: 'Title'
    });
  });

  it('reports PHP scale for escaped or entity-encoded markers while rejecting edits and invalid decoded markers', () => {
    for (const rawTitle of [
      String.raw`Caption \{width=33%\}`,
      'Caption &#123;width=33%&#125;'
    ]) {
      const source = `![Alt](https://example.test/image.png "${rawTitle}")`;
      const parsed = parseMarkdownImageScale(source);
      expect(parsed, rawTitle).toMatchObject({
        scale: 33,
        title: 'Caption',
        titleMarkerEnd: null,
        titleMarkerStart: null
      });
      if (!parsed) throw new Error('image-scale-test-image-missing');
      expect(() => createImageScaleReplacement(source, parsed, 50), rawTitle).toThrow(
        'image-scale-syntax-invalid'
      );
    }

    for (const source of [
      String.raw`![Alt](https://example.test/image.png "Caption \{width=51%\}")`,
      '![Alt](https://example.test/image.png "Caption &#123;width=51%&#125;")',
      String.raw`![Alt](https://example.test/image.png "Caption \{width=33%\} {width=50%}")`,
      '![Alt](https://example.test/image.png "Caption {width=33%}&#32; {width=50%}")',
      '![Alt](https://example.test/image.png "Caption {width=33%}&Tab; {width=50%}")',
      '![Alt](https://example.test/image.png "Caption {width=33%}\n {width=50%}")'
    ]) {
      expect(() => parseMarkdownImageScale(source), source).toThrow(
        'image-scale-syntax-invalid'
      );
    }
  });

  it('scales an empty quoted title without inserting a leading space', () => {
    const source = '![alt](https://example.test/image.png "")';
    const image = parseMarkdownImageScale(source);
    expect(image).toMatchObject({
      scale: null,
      title: '',
      titleMarkerEnd: null,
      titleMarkerStart: null
    });
    if (!image) throw new Error('image-scale-test-image-missing');

    const replacement = createImageScaleReplacement(source, image, 67);
    const updated =
      source.slice(0, replacement.from)
      + replacement.insert
      + source.slice(replacement.to);
    expect(updated).toBe('![alt](https://example.test/image.png "{width=67%}")');
    expect(parseMarkdownImageScale(updated)).toMatchObject({
      scale: 67,
      title: null
    });
  });

  it('rejects serializeMarkdownImage titles that would emit PHP-invalid scale syntax, blank lines, or unscaled markers', () => {
    for (const title of [
      'Caption {width=33%} ',
      'Caption {width=33%}\t',
      'Caption {width=33%}&#32;',
      'Caption {width=33%}&Tab;',
      'Caption {width=33%}\n',
      'Caption {width=33%}',
      'Caption {width=bad} ',
      'Caption\n',
      'Line1\n\nLine2',
      'Line1\r\n \r\nLine2'
    ]) {
      expect(
        () =>
          serializeMarkdownImage({
            alt: 'Alt',
            destination: 'https://example.test/image.png',
            scale: 50,
            title
          }),
        `scaled:${title}`
      ).toThrow('image-scale-syntax-invalid');
    }

    for (const title of [
      'Caption {width=51%}',
      'Caption {width=50%}',
      'Caption &#123;width=51%&#125;',
      'Caption &#123;width=50%&#125;',
      'Line1\n\nLine2',
      'Line1\r\n\t\r\nLine2'
    ]) {
      expect(
        () =>
          serializeMarkdownImage({
            alt: 'Alt',
            destination: 'https://example.test/image.png',
            scale: null,
            title
          }),
        `unscaled:${title}`
      ).toThrow('image-scale-syntax-invalid');
    }

    expect(
      serializeMarkdownImage({
        alt: 'Alt',
        destination: 'https://example.test/image.png',
        scale: null,
        title: 'Caption {width=33%} '
      })
    ).toBe('![Alt](https://example.test/image.png "Caption {width=33%} ")');

    const literal = serializeMarkdownImage({
      alt: 'Alt',
      destination: 'https://example.test/image.png',
      scale: 50,
      title: 'Syntax {width=33%} example'
    });
    expect(literal).toBe(
      '![Alt](https://example.test/image.png "Syntax {width=33%} example {width=50%}")'
    );
    expect(parseMarkdownImageScale(literal)).toMatchObject({
      scale: 50,
      title: 'Syntax {width=33%} example'
    });
  });

  it('matches CommonMark §6.1 / §6.3 punctuation, destination, parenthesized title, and code-span rules', () => {
    // Full 32-char CommonMark ASCII punctuation unescaping in destinations.
    expect(parseMarkdownImageScale(String.raw`![A](/foo\/bar.png)`)).toMatchObject({
      destination: '/foo/bar.png',
      scale: null,
      title: null
    });
    expect(
      parseMarkdownImageScale(String.raw`![A](/foo\?a\=1\&b\=2.png)`)
    ).toMatchObject({
      destination: '/foo?a=1&b=2.png',
      scale: null
    });

    // Reject ASCII whitespace and control chars even inside balanced parentheses.
    for (const invalidBare of [
      '![A](foo(bar baz))',
      '![A](foo(bar\tbaz))',
      '![A](foo(bar\nbaz))',
      '![A](foo\x01bar)',
      '![A](foo\x7fbar)',
      '![A](foo(bar\x07baz))'
    ]) {
      expect(parseMarkdownImageScale(invalidBare), JSON.stringify(invalidBare)).toBeNull();
    }

    // Reject CR, LF, NUL, and unescaped `<` inside `<...>` destinations.
    for (const invalidAngle of [
      '![A](<foo\nbar>)',
      '![A](<foo\rbar>)',
      '![A](<foo<bar>)',
      '![A](<foo\\<bar>'.replace('\\<', '\\\\<')
    ]) {
      expect(parseMarkdownImageScale(invalidAngle), JSON.stringify(invalidAngle)).toBeNull();
    }
    expect(parseMarkdownImageScale(String.raw`![A](<foo\<bar>)`)).toMatchObject({
      destination: 'foo<bar',
      destinationAngle: true
    });

    // Reject unescaped `(` inside `(...)` titles; allow escaped `\(` / `\)`.
    expect(parseMarkdownImageScale('![A](/x.png (a (b) c))')).toBeNull();
    expect(
      parseMarkdownImageScale(String.raw`![A](/x.png (a \(b\) c {width=50%}))`)
    ).toMatchObject({
      scale: 50,
      title: String.raw`a \(b\) c`
    });

    // CommonMark §6.1: backslashes inside code spans are literal, never escapes.
    const backslashCodeSource = '`a\\` ![Good](/x.png "{width=50%}") `b`';
    const goodStart = backslashCodeSource.indexOf('![Good]');
    expect(findMarkdownImageAt(backslashCodeSource, goodStart + 3)).toMatchObject({
      alt: 'Good',
      destination: '/x.png',
      scale: 50,
      title: null
    });
    const escapedBacktickSource = '\\` ![Good](/x.png "{width=67%}") \\`';
    expect(
      findMarkdownImageAt(escapedBacktickSource, escapedBacktickSource.indexOf('![Good]') + 3)
    ).toMatchObject({
      destination: '/x.png',
      scale: 67
    });
  });

  it('matches PHP CommonMark blockquote continuation rules for multiline image titles', () => {
    for (const invalidBlockquote of [
      '> ![A](/x.png "Caption\n> {width=50%}")',
      '> ![A](/x.png "Caption\n>  {width=50%}")',
      '> ![A](/x.png "Caption\n>   {width=50%}")',
      '> ![A](/x.png "Caption\n>{width=50%}")',
      '> ![A](/x.png "Caption\n>\t{width=50%}")',
      '> > ![A](/x.png "Caption\n> > {width=50%}")'
    ]) {
      const start = invalidBlockquote.indexOf('![');
      expect(() => parseMarkdownImageScale(invalidBlockquote, start), invalidBlockquote).toThrow(
        'image-scale-syntax-invalid'
      );
      expect(() => findMarkdownImageAt(invalidBlockquote, start + 3), invalidBlockquote).toThrow(
        'image-scale-syntax-invalid'
      );
    }

    // Valid scaled blockquote multiline title reports PHP scale but disallows raw mutation across `>`.
    const validScaledBq = '> ![A](/x.png "Caption\n> Line2 {width=50%}")';
    const parsedScaledBq = findMarkdownImageAt(validScaledBq, validScaledBq.indexOf('![') + 3);
    expect(parsedScaledBq).toMatchObject({
      scale: 50,
      title: 'Caption\nLine2',
      titleMarkerEnd: null,
      titleMarkerStart: null
    });
    if (!parsedScaledBq) throw new Error('image-scale-test-image-missing');
    expect(() => createImageScaleReplacement(validScaledBq, parsedScaledBq, 67)).toThrow(
      'image-scale-syntax-invalid'
    );

    // Valid unscaled blockquote multiline title also disallows mutating across `>`.
    const validUnscaledBq = '> ![A](/x.png "Caption\n> Line2")';
    const parsedUnscaledBq = findMarkdownImageAt(
      validUnscaledBq,
      validUnscaledBq.indexOf('![') + 3
    );
    expect(parsedUnscaledBq).toMatchObject({
      scale: null
    });
    if (!parsedUnscaledBq) throw new Error('image-scale-test-image-missing');
    expect(() => createImageScaleReplacement(validUnscaledBq, parsedUnscaledBq, 50)).toThrow(
      'image-scale-syntax-invalid'
    );

    // Blank blockquote line or unquoted `>` continuation breaks the paragraph (not an image).
    expect(
      parseMarkdownImageScale('> ![A](/x.png "Line1\n>\n> Line2 {width=50%}")', 2)
    ).toBeNull();
    expect(parseMarkdownImageScale('![A](/x.png "Caption\n> {width=50%}")')).toBeNull();

    // 4-space continuation indent before `>` stays literal paragraph text (matching PHP).
    expect(
      parseMarkdownImageScale('![A](/x.png "Caption\n    > {width=50%}")')
    ).toMatchObject({
      scale: 50,
      title: 'Caption\n    >'
    });
  });

  it('handles nested fenced+indented code, paragraph-bounded backtick spans, and CommonMark §6.3 whitespace', () => {
    // Indented lines inside a fenced code block must never break binary search in `inCodeRange()`.
    const nestedFenceSource = [
      '```markdown',
      '    indented line 1',
      '    indented line 2',
      '![inside-fence](/fence.png "{width=50%}")',
      '```',
      '',
      '![outside-fence](/real.png "{width=67%}")'
    ].join('\n');
    expect(
      findMarkdownImageAt(nestedFenceSource, nestedFenceSource.indexOf('inside-fence') + 1)
    ).toBeNull();
    expect(
      findMarkdownImageAt(nestedFenceSource, nestedFenceSource.indexOf('outside-fence') + 1)
    ).toMatchObject({
      destination: '/real.png',
      scale: 67
    });

    const nestedFenceCrlf = [
      '~~~',
      '\tindented tab',
      '![inside-crlf](/fence.png "{width=50%}")',
      '~~~',
      '',
      '![after-crlf](/after.png "{width=100%}")'
    ].join('\r\n');
    expect(
      findMarkdownImageAt(nestedFenceCrlf, nestedFenceCrlf.indexOf('inside-crlf') + 1)
    ).toBeNull();
    expect(
      findMarkdownImageAt(nestedFenceCrlf, nestedFenceCrlf.indexOf('after-crlf') + 1)
    ).toMatchObject({
      destination: '/after.png',
      scale: 100
    });

    // CommonMark §6.1: inline code spans must NOT cross blank lines.
    const blankSeparatedTicks = [
      '`unclosed',
      '',
      '![between](/a.png "{width=50%}")',
      '',
      '`'
    ].join('\n');
    expect(
      findMarkdownImageAt(blankSeparatedTicks, blankSeparatedTicks.indexOf('between') + 1)
    ).toMatchObject({
      destination: '/a.png',
      scale: 50
    });

    const crlfBlankTicks = '`unclosed\r\n \t \r\n![crlf-between](/a.png "{width=33%}")\r\n\r\n`';
    expect(
      findMarkdownImageAt(crlfBlankTicks, crlfBlankTicks.indexOf('crlf-between') + 1)
    ).toMatchObject({
      destination: '/a.png',
      scale: 33
    });

    const bqBlankTicks = '> `unclosed\n>\n> ![bq-between](/a.png "{width=50%}")\n>\n> `';
    expect(
      findMarkdownImageAt(bqBlankTicks, bqBlankTicks.indexOf('bq-between') + 1)
    ).toMatchObject({
      destination: '/a.png',
      scale: 50
    });

    // An unclosed backtick in paragraph 1 must not hide a real code span in paragraph 2.
    const nextParaCodeSpan = [
      '`unclosed',
      '',
      '`![in-code](/code.png "{width=50%}")`',
      '',
      '![real](/real.png "{width=67%}")'
    ].join('\n');
    expect(
      findMarkdownImageAt(nextParaCodeSpan, nextParaCodeSpan.indexOf('in-code') + 1)
    ).toBeNull();
    expect(
      findMarkdownImageAt(nextParaCodeSpan, nextParaCodeSpan.indexOf('real') + 1)
    ).toMatchObject({
      destination: '/real.png',
      scale: 67
    });

    // Backtick span within the same paragraph still protects the image.
    const sameParaTicks = '`opened\n![same-para](/a.png "{width=50%}")\n`';
    expect(
      findMarkdownImageAt(sameParaTicks, sameParaTicks.indexOf('same-para') + 1)
    ).toBeNull();

    // CommonMark §6.3: optional whitespace (up to one line break) after `(`,
    // between destination and title, and before `)`, rejecting blank lines.
    const spaceAfterParen = '![alt]( https://example.com/a.png "{width=50%}")';
    const parsedSpaceParen = parseMarkdownImageScale(spaceAfterParen);
    expect(parsedSpaceParen).toMatchObject({
      alt: 'alt',
      destination: 'https://example.com/a.png',
      destinationAngle: false,
      scale: 50,
      title: null
    });
    if (!parsedSpaceParen) throw new Error('image-scale-test-image-missing');
    const destRepl = createMarkdownImageDestinationReplacement(
      spaceAfterParen,
      parsedSpaceParen,
      'https://example.com/b.png'
    );
    if (!destRepl) throw new Error('image-scale-test-replacement-missing');
    expect(
      spaceAfterParen.slice(0, destRepl.from)
      + destRepl.insert
      + spaceAfterParen.slice(destRepl.to)
    ).toBe('![alt]( https://example.com/b.png "{width=50%}")');

    expect(
      parseMarkdownImageScale('![alt]( <https://example.com/a.png> "{width=50%}")')
    ).toMatchObject({
      destination: 'https://example.com/a.png',
      destinationAngle: true,
      scale: 50,
      title: null
    });
    expect(
      parseMarkdownImageScale('![alt](\nhttps://example.com/a.png "{width=50%}")')
    ).toMatchObject({
      destination: 'https://example.com/a.png',
      scale: 50
    });
    expect(
      parseMarkdownImageScale('![alt](https://example.com/a.png\n"{width=50%}")')
    ).toMatchObject({
      destination: 'https://example.com/a.png',
      scale: 50
    });
    expect(
      parseMarkdownImageScale('![alt](https://example.com/a.png "{width=50%}"\n)')
    ).toMatchObject({
      destination: 'https://example.com/a.png',
      scale: 50
    });

    for (const blankLineImage of [
      '![alt](\n\nhttps://example.com/a.png "{width=50%}")',
      '![alt](https://example.com/a.png\n\n"{width=50%}")',
      '![alt](https://example.com/a.png "{width=50%}"\n\n)',
      '![alt](https://example.com/a.png\n\n)'
    ]) {
      expect(parseMarkdownImageScale(blankLineImage), blankLineImage).toBeNull();
    }
  });

  it('supports list-nested blockquote multiline titles while rejecting cross-container prefixes', () => {
    const listBqUnscaled = '- > ![demo](/img "Caption\n  > continued")';
    const parsedListBqUnscaled = findMarkdownImageAt(
      listBqUnscaled,
      listBqUnscaled.indexOf('![') + 3
    );
    expect(parsedListBqUnscaled).toMatchObject({
      alt: 'demo',
      destination: '/img',
      scale: null,
      title: 'Caption\n  > continued'
    });
    if (!parsedListBqUnscaled) throw new Error('image-scale-test-image-missing');
    expect(() => createImageScaleReplacement(listBqUnscaled, parsedListBqUnscaled, 50)).toThrow(
      'image-scale-syntax-invalid'
    );

    const listBqScaled = '- > ![demo](/img "Caption\n  > continued {width=50%}")';
    const parsedListBqScaled = findMarkdownImageAt(
      listBqScaled,
      listBqScaled.indexOf('![') + 3
    );
    expect(parsedListBqScaled).toMatchObject({
      scale: 50,
      title: 'Caption\ncontinued',
      titleMarkerEnd: null,
      titleMarkerStart: null
    });
    if (!parsedListBqScaled) throw new Error('image-scale-test-image-missing');
    expect(() => createImageScaleReplacement(listBqScaled, parsedListBqScaled, 67)).toThrow(
      'image-scale-syntax-invalid'
    );

    // Ordered list, nested blockquote-list-blockquote, and tab-indented continuations.
    for (const nestedValid of [
      '10. > ![demo](/img "Caption\n    > continued {width=50%}")',
      '> - > ![demo](/img "Caption\n>   > continued {width=50%}")',
      '- - > ![demo](/img "Caption\n    > continued {width=50%}")',
      '- > ![demo](/img "Caption\n\t> continued {width=50%}")'
    ]) {
      const parsed = findMarkdownImageAt(nestedValid, nestedValid.indexOf('![') + 3);
      expect(parsed, nestedValid).toMatchObject({
        scale: 50,
        title: 'Caption\ncontinued',
        titleMarkerEnd: null,
        titleMarkerStart: null
      });
    }

    // 10. > unscaled also blocks raw mutation across container `>`.
    const orderedBqUnscaled = '10. > ![demo](/img "Caption\n    > continued")';
    const parsedOrderedUnscaled = findMarkdownImageAt(
      orderedBqUnscaled,
      orderedBqUnscaled.indexOf('![') + 3
    );
    expect(parsedOrderedUnscaled).toMatchObject({ scale: null });
    if (!parsedOrderedUnscaled) throw new Error('image-scale-test-image-missing');
    expect(() => createImageScaleReplacement(orderedBqUnscaled, parsedOrderedUnscaled, 50)).toThrow(
      'image-scale-syntax-invalid'
    );

    // Invalid scale marker inside list-nested blockquote throws matching PHP.
    const listBqInvalidScale = '- > ![demo](/img "Caption\n  > {width=50%}")';
    expect(() =>
      findMarkdownImageAt(listBqInvalidScale, listBqInvalidScale.indexOf('![') + 3)
    ).toThrow('image-scale-syntax-invalid');

    // Cross-container or blank-line continuations are rejected (return null).
    for (const crossContainer of [
      '- > ![demo](/img "Caption\n> continued")',
      '- > ![demo](/img "Caption\n > continued")',
      '- > ![demo](/img "Caption\n  > > continued")',
      '- > ![demo](/img "Caption\n  >\n  > continued")',
      '- ![demo](/img "Caption\n  > not-valid")'
    ]) {
      expect(
        parseMarkdownImageScale(crossContainer, crossContainer.indexOf('![')),
        crossContainer
      ).toBeNull();
    }
  });

  it('recovers active 4+ column list+blockquote container stacks for multiline images', () => {
    const invalidNested =
      '10. > First line\n    > ![alt](https://example.com/a.png "line 1\n    > {width=50%}")';
    const invalidStart = invalidNested.indexOf('![');
    expect(() => parseMarkdownImageScale(invalidNested, invalidStart)).toThrow(
      'image-scale-syntax-invalid'
    );
    expect(() => findMarkdownImageAt(invalidNested, invalidStart + 3)).toThrow(
      'image-scale-syntax-invalid'
    );

    const invalidAfterBlank =
      '10. > First line\n\n    > ![alt](https://example.com/a.png "line 1\n    > {width=50%}")';
    expect(() =>
      findMarkdownImageAt(invalidAfterBlank, invalidAfterBlank.indexOf('![') + 3)
    ).toThrow('image-scale-syntax-invalid');

    const validNested =
      '10. > First line\n    > ![alt](https://example.com/a.png "line 1\n    > line 2 {width=50%}")';
    const parsedValid = findMarkdownImageAt(validNested, validNested.indexOf('![') + 3);
    expect(parsedValid).toMatchObject({
      destination: 'https://example.com/a.png',
      scale: 50,
      title: 'line 1\nline 2',
      titleMarkerEnd: null,
      titleMarkerStart: null
    });
    if (!parsedValid) throw new Error('image-scale-test-image-missing');
    expect(() => createImageScaleReplacement(validNested, parsedValid, 67)).toThrow(
      'image-scale-syntax-invalid'
    );

    // Cross-container `>` under 10. > (fewer than 4 leading spaces) breaks out of list.
    for (const broken of [
      '10. > First line\n    > ![alt](https://example.com/a.png "line 1\n> line 2 {width=50%}")',
      '10. > First line\n    > ![alt](https://example.com/a.png "line 1\n   > line 2 {width=50%}")'
    ]) {
      expect(findMarkdownImageAt(broken, broken.indexOf('![') + 3), broken).toBeNull();
    }
  });

  it('rejects multiline titles crossing CommonMark paragraph-interrupting blocks while preserving non-interrupting lines', () => {
    for (const interrupted of [
      '![alt](https://example.com/a.png "line 1\n# heading {width=50%}")',
      '![alt](https://example.com/a.png "line 1\n- item {width=50%}")',
      '![alt](https://example.com/a.png "line 1\n1. item {width=50%}")',
      '![alt](https://example.com/a.png "line 1\n1) item {width=50%}")',
      '![alt](https://example.com/a.png "line 1\n***\nline 2 {width=50%}")',
      '![alt](https://example.com/a.png "line 1\n---\nline 2 {width=50%}")',
      '![alt](https://example.com/a.png "line 1\n===\nline 2 {width=50%}")',
      '![alt](https://example.com/a.png "line 1\n-\nline 2 {width=50%}")',
      '![alt](https://example.com/a.png "line 1\n```js\nline 2 {width=50%}")',
      '![alt](https://example.com/a.png "line 1\n~~~txt\nline 2 {width=50%}")',
      '![alt](https://example.com/a.png "line 1\n> quote {width=50%}")',
      '![alt](https://example.com/a.png "line 1\n<pre>\nline 2 {width=50%}")',
      '![alt](https://example.com/a.png "line 1\n<!-- comment\nline 2 {width=50%}")',
      '![alt](https://example.com/a.png "line 1\n<div>\nline 2 {width=50%}")',
      '![alt](https://example.com/a.png "a | b\n--- | ---\nline 2 {width=50%}")',
      '![alt\n# heading](https://example.com/a.png "Caption {width=50%}")'
    ]) {
      expect(parseMarkdownImageScale(interrupted), interrupted).toBeNull();
      expect(findMarkdownImageAt(interrupted, 3), interrupted).toBeNull();
    }

    // Non-interrupting lines per CommonMark §4.6 / §5.2 remain valid multiline titles:
    // HTML Type 7 (`<span>`), ordered list starting != 1 (`2.`), empty `1.` / `*` / `+`,
    // and backtick fence with backtick in info string.
    for (const [source, expectedTitle] of [
      ['![alt](https://example.com/a.png "line 1\n<span>\nline 2 {width=50%}")', 'line 1\n<span>\nline 2'],
      ['![alt](https://example.com/a.png "line 1\n2. item {width=50%}")', 'line 1\n2. item'],
      ['![alt](https://example.com/a.png "line 1\n1.\nline 2 {width=50%}")', 'line 1\n1.\nline 2'],
      ['![alt](https://example.com/a.png "line 1\n*\nline 2 {width=50%}")', 'line 1\n*\nline 2'],
      ['![alt](https://example.com/a.png "line 1\n```a`b\nline 2 {width=50%}")', 'line 1\n```a`b\nline 2']
    ] as const) {
      expect(findMarkdownImageAt(source, 3), source).toMatchObject({
        destination: 'https://example.com/a.png',
        scale: 50,
        title: expectedTitle
      });
    }
  });

  it('supports container continuations between (, destination, title, and ) while rejecting blank or cross-container breaks', () => {
    for (const validSource of [
      '> ![alt](https://example.com/a.png\n> "Caption {width=50%}")',
      '> ![alt](https://example.com/a.png "Caption {width=50%}"\n> )',
      '> ![alt](\n> https://example.com/a.png\n> "Caption {width=50%}"\n> )',
      '- > ![alt](https://example.com/a.png\n  > "Caption {width=50%}")',
      '> ![alt](https://example.com/a.png\n"Caption {width=50%}")',
      '10. > First line\n    > ![alt](https://example.com/a.png\n    > "Caption {width=50%}"\n    > )'
    ]) {
      const start = validSource.indexOf('![');
      expect(parseMarkdownImageScale(validSource, start), validSource).toMatchObject({
        destination: 'https://example.com/a.png',
        scale: 50,
        title: 'Caption'
      });
      expect(findMarkdownImageAt(validSource, start + 3), validSource).toMatchObject({
        destination: 'https://example.com/a.png',
        scale: 50,
        title: 'Caption'
      });
    }

    for (const invalidSource of [
      '> ![alt](https://example.com/a.png\n>\n> "Caption {width=50%}")',
      '> ![alt](https://example.com/a.png\n> > "Caption {width=50%}")',
      '![alt](https://example.com/a.png\n> "Caption {width=50%}")',
      '> ![alt](https://example.com/a.png\n> # "Caption {width=50%}")',
      '- > ![alt](https://example.com/a.png\n> "Caption {width=50%}")'
    ]) {
      const start = invalidSource.indexOf('![');
      expect(parseMarkdownImageScale(invalidSource, start), invalidSource).toBeNull();
      expect(findMarkdownImageAt(invalidSource, start + 3), invalidSource).toBeNull();
    }
  });

  it('matches CommonMark/PHP code-block, tab-indent, Setext, paragraph-bounded backtick, and list-indent rules', () => {
    // Fenced code inside blockquote / list, indented code inside blockquote,
    // tab-expanded 4-col indent, Setext heading resetting indented code,
    // 6-space indented code inside `- item`, and 4-space code after empty `-`.
    for (const protectedSource of [
      '> ~~~\n> ![alt](https://example.com/a.png "a")\n> ~~~',
      '> ```\n> ![alt](https://example.com/a.png "a")\n> ```',
      '- ~~~\n  ![alt](https://example.com/a.png "a")\n  ~~~',
      '>     ![alt](https://example.com/a.png "a")',
      '  \t![alt](https://example.com/a.png "a")',
      'Heading\n===\n    ![alt](https://example.com/a.png "a")',
      'Heading\n---\n    ![alt](https://example.com/a.png "a")',
      '> Heading\n> ===\n>     ![alt](https://example.com/a.png "a")',
      '- item\n\n      ![x](demo)',
      '-\n\n    ![x](demo)',
      '10. item\n\n        ![x](demo)',
      '| a | b |\n| - | - |\n| 1 | 2 |\n    ![alt](https://example.com/a.png "a")',
      'a `code\n<span>\n![alt](https://example.com/a.png "a") `',
      '<div>\n![alt](https://example.com/a.png "a")\n</div>'
    ]) {
      const start = protectedSource.indexOf('![');
      expect(findMarkdownImageAt(protectedSource, start + 3), protectedSource).toBeNull();
    }

    // Live images that MUST still be found:
    // - unclosed backtick terminated by paragraph-interrupting blocks
    // - 4-space indented paragraph inside open list items (`- item`, `10. item`)
    // - unclosed fenced code inside blockquote/list closed when container ends
    for (const liveSource of [
      'a `code\n# Heading\n![alt](https://example.com/a.png "a") `',
      'a `code\n- item\n![alt](https://example.com/a.png "a") `',
      'a `code\n===\n![alt](https://example.com/a.png "a") `',
      'a `code\n***\n![alt](https://example.com/a.png "a") `',
      'a `code\n> quote\n![alt](https://example.com/a.png "a") `',
      'a `code\n<div>\n\n![alt](https://example.com/a.png "a") `',
      '- item\n\n    ![x](demo)',
      '-\titem\n\n    ![x](demo)',
      '-     code\n\n    ![x](demo)',
      '10. item\n\n    ![x](demo)',
      '10. item\n\n       ![x](demo)',
      '> ```\n> inside\n![alt](https://example.com/a.png "a")',
      '- ```\n  inside\n![alt](https://example.com/a.png "a")'
    ]) {
      const start = liveSource.indexOf('![');
      const found = findMarkdownImageAt(liveSource, start + 3);
      expect(found, liveSource).not.toBeNull();
      expect(found?.start, liveSource).toBe(start);
    }

    // Zero-padded decimal zero entities in image titles match PHP + WP KSES parity.
    expect(parseMarkdownImageScale('![x](demo "&#00;{width=50%}")')).toMatchObject({
      destination: 'demo',
      scale: 50,
      title: null,
      titleMarkerEnd: null,
      titleMarkerStart: null
    });
    expect(parseMarkdownImageScale('![x](demo "&#000;{width=50%}")')).toMatchObject({
      destination: 'demo',
      scale: 50,
      title: null
    });
    const zeroPaddedWithSpace = '![x](demo "Caption &#000; {width=50%}")';
    const parsedZeroPaddedWithSpace = parseMarkdownImageScale(zeroPaddedWithSpace);
    expect(parsedZeroPaddedWithSpace).toMatchObject({
      destination: 'demo',
      scale: 50,
      title: 'Caption &#000;'
    });
    if (!parsedZeroPaddedWithSpace) throw new Error('image-scale-test-image-missing');
    const updatedZeroPadded = createImageScaleReplacement(
      zeroPaddedWithSpace,
      parsedZeroPaddedWithSpace,
      67
    );
    expect(
      zeroPaddedWithSpace.slice(0, updatedZeroPadded.from)
      + updatedZeroPadded.insert
      + zeroPaddedWithSpace.slice(updatedZeroPadded.to)
    ).toBe('![x](demo "Caption &#000; {width=67%}")');
    expect(parseMarkdownImageScale('![x](demo "a&#000;b")')).toMatchObject({
      destination: 'demo',
      scale: null,
      title: 'a&#000;b'
    });
    for (const invalidZero of [
      '![x](demo "&#0;{width=50%}")',
      '![x](demo "&#x00;{width=50%}")',
      '![x](demo "Caption&#000;{width=50%}")'
    ]) {
      expect(() => parseMarkdownImageScale(invalidZero), invalidZero).toThrow(
        'image-scale-syntax-invalid'
      );
    }
  });

  it('excludes CommonMark §4.7 link reference definition titles while preserving trailing paragraph images', () => {
    for (const refDefSource of [
      '[ref]: https://example.test/a.png "![alt](https://example.test/b.png) "',
      "[ref]: https://example.test/a.png '![alt](https://example.test/b.png) '",
      '[ref]: https://example.test/a.png (![alt](https://example.test/b.png)',
      String.raw`[ref]: https://example.test/a.png (![alt]\(https://example.test/b.png\))`,
      '[ref]:\nhttps://example.test/a.png\n"![alt](https://example.test/b.png) "',
      '[foo\nbar]: https://example.test/a.png "![alt](https://example.test/b.png)"',
      '[ref]: https://example.test/a.png\n"line1\n![alt](https://example.test/b.png)"',
      '[ref]: <> "![alt](https://example.test/b.png)"',
      '> [ref]: https://example.test/a.png\n> "![alt](https://example.test/b.png) "',
      '- [ref]: https://example.test/a.png\n  "![alt](https://example.test/b.png) "',
      '[a]: /a\n    [b]: /b "![alt](https://example.test/b.png)"',
      '[a]: /url [b]: /url2 "![alt](https://example.test/b.png)"'
    ]) {
      const start = refDefSource.indexOf('![');
      expect(findMarkdownImageAt(refDefSource, start + 3), refDefSource).toBeNull();
    }

    // Positive controls: live images immediately after valid refdefs or inside failed refdefs.
    for (const [label, source, expectedDest, expectedScale] of [
      [
        'real image on paragraph line after destination-only refdef',
        '[ref]: https://example.test/a.png\n![real](https://example.test/b.png "{width=50%}")',
        'https://example.test/b.png',
        50
      ],
      [
        'real image after titled refdef',
        '[ref]: https://example.test/a.png "title"\n![real](https://example.test/b.png "{width=67%}")',
        'https://example.test/b.png',
        67
      ],
      [
        'real image after blockquote refdef',
        '> [ref]: https://example.test/a.png\n> ![real](https://example.test/b.png "{width=50%}")',
        'https://example.test/b.png',
        50
      ],
      [
        'backtracked next-line title with trailing text stays live paragraph',
        '[ref]: https://example.test/a.png\n"![alt](https://example.test/b.png) " trailing',
        'https://example.test/b.png',
        null
      ],
      [
        'backtracked next-line title with angle destination stays live paragraph',
        '[ref]: https://example.test/a.png\n"![alt](<https://example.test/b.png>)" trailing',
        'https://example.test/b.png',
        null
      ],
      [
        'backtracked multiline title with trailing text stays live paragraph',
        '[ref]: https://example.test/a.png\n"line1\n![alt](https://example.test/b.png) " trailing',
        'https://example.test/b.png',
        null
      ],
      [
        'same-line title with trailing text fails refdef and stays live',
        '[ref]: https://example.test/a.png "![alt](https://example.test/b.png) " trailing',
        'https://example.test/b.png',
        null
      ],
      [
        'parenthesized refdef with trailing paren fails refdef and stays live (PHP parity)',
        '[ref]: https://example.test/a.png (![alt](https://example.test/b.png) )',
        'https://example.test/b.png',
        null
      ],
      [
        'refdef cannot interrupt open paragraph',
        'intro\n[ref]: https://example.test/a.png "![live](https://example.test/b.png) "',
        'https://example.test/b.png',
        null
      ],
      [
        'refdef followed by real table keeps table cell image live',
        '[ref]: https://example.test/a.png\na | b\n--- | ---\n![cell](https://example.test/b.png "{width=33%}") | 2',
        'https://example.test/b.png',
        33
      ]
    ] as const) {
      const start = source.indexOf('![');
      const found = findMarkdownImageAt(source, start + 3);
      expect(found, label).toMatchObject({
        destination: expectedDest,
        scale: expectedScale,
        start
      });
    }

    // Completed refdef with pipe in title does not start a GFM table on the next line.
    const refDefPipeThenNonTable =
      '[ref]: https://example.test/a.png "a | b"\n--- | ---\n![live](https://example.test/b.png "{width=50%}")';
    expect(
      findMarkdownImageAt(refDefPipeThenNonTable, refDefPipeThenNonTable.indexOf('![live]') + 3)
    ).toMatchObject({
      destination: 'https://example.test/b.png',
      scale: 50
    });
  });

  it('splits paragraph-preceding GFM table headers across inline blocks matching PHP TableStartParser', () => {
    for (const splitTableSource of [
      '![alt](https://example.test/a.png\n"caption | col2")\n| --- | --- |\n| c1 | c2 |',
      '![a | b](https://example.test/a.png\n"caption")\n--- | ---\n1 | 2',
      '> ![alt](https://example.test/a.png\n> "caption | col2")\n> | --- | --- |\n> | c1 | c2 |',
      'a | b\n![x](https://example.test/a.png\n"z")\n--- | ---\n1 | 2',
      'a \\| b\n![x](https://example.test/a.png\n"z")\n--- | ---\n1 | 2'
    ]) {
      const start = splitTableSource.indexOf('![');
      expect(parseMarkdownImageScale(splitTableSource, start), splitTableSource).toBeNull();
      expect(findMarkdownImageAt(splitTableSource, start + 3), splitTableSource).toBeNull();
    }

    // Complete image on paragraph line before split table header stays live.
    const liveBeforeHeader =
      '![live](https://example.test/a.png "{width=50%}")\nheader | col2\n--- | ---\n1 | 2';
    expect(findMarkdownImageAt(liveBeforeHeader, 3)).toMatchObject({
      destination: 'https://example.test/a.png',
      scale: 50
    });

    // Complete image inside split table header cell stays live.
    const liveInHeader =
      'para line\n![hdr](https://example.test/a.png "{width=67%}") | col2\n--- | ---\n1 | 2';
    const hdrStart = liveInHeader.indexOf('![hdr]');
    expect(findMarkdownImageAt(liveInHeader, hdrStart + 3)).toMatchObject({
      destination: 'https://example.test/a.png',
      scale: 67,
      start: hdrStart
    });

    // When header row has more cells than separator columns, no table starts and multiline image stays live.
    const tooManyHeaderCols =
      '![alt](https://example.test/a.png\n"a | b | c {width=50%}")\n--- | ---\n1 | 2';
    expect(parseMarkdownImageScale(tooManyHeaderCols, 0)).toMatchObject({
      destination: 'https://example.test/a.png',
      scale: 50,
      title: 'a | b | c'
    });
    expect(findMarkdownImageAt(tooManyHeaderCols, 3)).toMatchObject({
      destination: 'https://example.test/a.png',
      scale: 50,
      title: 'a | b | c'
    });
  });

  it('supports balanced brackets, inline backtick code spans in alt text, and outermost image selection', () => {
    for (const [label, source, expectedAlt, expectedDest, expectedScale, expectedTitle] of [
      [
        'balanced brackets in alt text',
        '![a [b] c](https://example.test/a.png "t {width=50%}")',
        'a [b] c',
        'https://example.test/a.png',
        50,
        't'
      ],
      [
        'inline backtick code span containing ] in alt text',
        '![a `]` c](https://example.test/a.png "t {width=50%}")',
        'a `]` c',
        'https://example.test/a.png',
        50,
        't'
      ],
      [
        'inline backtick code span containing [ in alt text',
        '![a `[` c](https://example.test/a.png "t {width=50%}")',
        'a `[` c',
        'https://example.test/a.png',
        50,
        't'
      ],
      [
        'double-backtick code span in alt text',
        '![a `` `]` `` c](https://example.test/a.png "t {width=50%}")',
        'a `` `]` `` c',
        'https://example.test/a.png',
        50,
        't'
      ],
      [
        'deeply nested balanced brackets in alt text',
        '![a [b [c] d] e](https://example.test/e.png "t {width=50%}")',
        'a [b [c] d] e',
        'https://example.test/e.png',
        50,
        't'
      ],
      [
        'nested link whose title contains ] in alt text',
        '![a [b](/x "has ] bracket") c](https://example.test/y.png "t {width=50%}")',
        'a [b](/x "has ] bracket") c',
        'https://example.test/y.png',
        50,
        't'
      ],
      [
        'multiline balanced brackets in blockquote alt text',
        '> ![a [b\n> c] d](https://example.test/i.png "t {width=50%}")',
        'a [b\n> c] d',
        'https://example.test/i.png',
        50,
        't'
      ],
      [
        'multiline code span containing ] in blockquote alt text',
        '> ![a `\n> ]` d](https://example.test/i.png "t {width=50%}")',
        'a `\n> ]` d',
        'https://example.test/i.png',
        50,
        't'
      ],
      [
        'unclosed backtick in alt text does not cross blank line',
        '![a `b](https://example.test/x.png "t {width=50%}")\n\n`',
        'a `b',
        'https://example.test/x.png',
        50,
        't'
      ],
      [
        'code span bridging two image-like fragments matches PHP outer image',
        '![a `b](/x.png) ![c`](https://example.test/y.png "t {width=50%}")',
        'a `b](/x.png) ![c`',
        'https://example.test/y.png',
        50,
        't'
      ],
      [
        'backtick code span inside image title stays live',
        '![alt](https://example.test/x.png "see `code` here {width=50%}")',
        'alt',
        'https://example.test/x.png',
        50,
        'see `code` here'
      ]
    ] as const) {
      const start = source.indexOf('![');
      const parsed = parseMarkdownImageScale(source, start);
      expect(parsed, `parse:${label}`).toMatchObject({
        alt: expectedAlt,
        destination: expectedDest,
        scale: expectedScale,
        start,
        title: expectedTitle
      });
      const found = findMarkdownImageAt(source, start + 5);
      expect(found, `find:${label}`).toMatchObject({
        alt: expectedAlt,
        destination: expectedDest,
        scale: expectedScale,
        start,
        title: expectedTitle
      });
    }

    // Caret directly inside `` `]` `` in alt text or `` `code` `` in title still hits the image.
    const tickAlt = '![a `]` c](https://example.test/a.png "t {width=50%}")';
    const tickAltMatch = findMarkdownImageAt(tickAlt, tickAlt.indexOf(']') + 1);
    expect(tickAltMatch).toMatchObject({
      alt: 'a `]` c',
      scale: 50
    });
    if (!tickAltMatch) throw new Error('tick-alt-match-missing');
    const tickAltRepl = createImageScaleReplacement(tickAlt, tickAltMatch, 100);
    expect(
      tickAlt.slice(0, tickAltRepl.from) + tickAltRepl.insert + tickAlt.slice(tickAltRepl.to)
    ).toBe('![a `]` c](https://example.test/a.png "t {width=100%}")');

    const bracketAlt = '![a [b] c](https://example.test/a.png "t {width=50%}")';
    const bracketAltMatch = findMarkdownImageAt(bracketAlt, bracketAlt.indexOf('b'));
    expect(bracketAltMatch).toMatchObject({
      alt: 'a [b] c',
      scale: 50
    });
    if (!bracketAltMatch) throw new Error('bracket-alt-match-missing');
    const bracketAltRepl = createImageScaleReplacement(bracketAlt, bracketAltMatch, 67);
    expect(
      bracketAlt.slice(0, bracketAltRepl.from)
      + bracketAltRepl.insert
      + bracketAlt.slice(bracketAltRepl.to)
    ).toBe('![a [b] c](https://example.test/a.png "t {width=67%}")');

    const tickTitle = '![alt](https://example.test/x.png "see `code` here {width=50%}")';
    expect(findMarkdownImageAt(tickTitle, tickTitle.indexOf('code') + 2)).toMatchObject({
      destination: 'https://example.test/x.png',
      scale: 50
    });

    // Reject unbalanced brackets and code spans swallowing closing `]`.
    for (const rejected of [
      '![a [b c](https://example.test/a.png "t {width=50%}")',
      '![a `b](/x.png) `',
      '![a `b](/x.png)\n`',
      '![a \\`]` c](/x.png)',
      '![a `\\`]` c](/x.png)'
    ]) {
      expect(parseMarkdownImageScale(rejected, 0), `parse-reject:${rejected}`).toBeNull();
      expect(findMarkdownImageAt(rejected, 3), `find-reject:${rejected}`).toBeNull();
    }

    // Outermost enclosing image wins over nested `![inner]` in alt text or title.
    const nestedInAlt =
      '![outer ![inner](https://example.test/a.png) tail](https://example.test/b.png "t {width=50%}")';
    for (const probe of ['outer', 'inner', 'a.png', 'tail']) {
      expect(
        findMarkdownImageAt(nestedInAlt, nestedInAlt.indexOf(probe) + 1),
        `nestedInAlt:${probe}`
      ).toMatchObject({
        destination: 'https://example.test/b.png',
        end: nestedInAlt.length,
        scale: 50,
        start: 0
      });
    }

    // Invalid marker inside an enclosed inner alt image does not poison the valid outer image.
    const invalidInnerAlt =
      '![outer ![bad](/in.png "{width=51%}") tail](/out.png "t {width=50%}")';
    expect(
      findMarkdownImageAt(invalidInnerAlt, invalidInnerAlt.indexOf('bad') + 1)
    ).toMatchObject({
      destination: '/out.png',
      scale: 50,
      start: 0
    });

    // Literal `![inner](...)` inside an outer image's title resolves to the outer image.
    const nestedInTitle =
      '![outer](https://example.test/demo.png "contains ![inner](https://example.test/other.png) here")';
    for (const probe of ['outer', 'inner', 'other.png', 'here']) {
      expect(
        findMarkdownImageAt(nestedInTitle, nestedInTitle.indexOf(probe) + 1),
        `nestedInTitle:${probe}`
      ).toMatchObject({
        destination: 'https://example.test/demo.png',
        end: nestedInTitle.length,
        start: 0
      });
    }

    // Unclosed outer `![` falls through to a valid inner image, matching PHP.
    const unclosedOuter = '![unclosed ![inner](https://example.test/a.png "t {width=67%}")';
    const innerStart = unclosedOuter.indexOf('![inner]');
    expect(findMarkdownImageAt(unclosedOuter, innerStart + 3)).toMatchObject({
      destination: 'https://example.test/a.png',
      scale: 67,
      start: innerStart
    });

    // Literal `![fake]` inside a link title is never mistaken for a live image.
    const inLinkTitle = '[link](https://example.test/l "contains ![fake](https://example.test/f.png)")';
    expect(findMarkdownImageAt(inLinkTitle, inLinkTitle.indexOf('fake') + 1)).toBeNull();
  });

  it('fast-paths single-line images on huge documents and caches repeated block scans', () => {
    const hugeDoc = `![a](/x.png)\n${'plain paragraph line\n'.repeat(55_000)}`;
    const started = performance.now();
    const confirmed = parseMarkdownImageScale(hugeDoc, 0);
    expect(confirmed).toMatchObject({
      alt: 'a',
      destination: '/x.png',
      end: 12,
      scale: null,
      start: 0
    });
    if (!confirmed) throw new Error('huge-doc-image-missing');
    const replacement = createImageScaleReplacement(hugeDoc, confirmed, 67);
    const nextValue =
      hugeDoc.slice(0, replacement.from)
      + replacement.insert
      + hugeDoc.slice(replacement.to);
    const reparsed = parseMarkdownImageScale(nextValue, 0);
    const elapsedMs = performance.now() - started;
    expect(reparsed).toMatchObject({
      destination: '/x.png',
      scale: 67,
      start: 0
    });
    expect(elapsedMs).toBeLessThan(100);

    // Consecutive calls to getCachedMarkdownBlockScan on the same string reuse one scan object.
    const multiDoc = '> ![a](/x.png\n> "Caption {width=50%}")\n\nSecond paragraph';
    const firstScan = getCachedMarkdownBlockScan(multiDoc);
    const secondScan = getCachedMarkdownBlockScan(multiDoc);
    expect(secondScan).toBe(firstScan);
    const otherScan = getCachedMarkdownBlockScan(`${multiDoc}\n`);
    expect(otherScan).not.toBe(firstScan);

    // Pathological nested brackets and link deactivation stay linear.
    const deepLinks = `${'['.repeat(4_000)}${'[a](b)'.repeat(2_000)}`;
    const deepStart = performance.now();
    expect(findMarkdownImageAt(deepLinks, deepLinks.length - 2)).toBeNull();
    expect(performance.now() - deepStart).toBeLessThan(1_000);

    const deepImages = `${'![ '.repeat(2_000)}x${'](a)'.repeat(2_000)}`;
    const deepImgStart = performance.now();
    expect(findMarkdownImageAt(deepImages, deepImages.indexOf('x'))).toMatchObject({
      destination: 'a',
      end: deepImages.length,
      start: 0
    });
    expect(performance.now() - deepImgStart).toBeLessThan(1_000);
  });

  it('supports linked, emphasized, compact-table, and CJK-adjacent bare-destination images while still rejecting truncated URLs', () => {
    for (const [label, source, expectedDest, expectedRaw] of [
      [
        'linked image',
        '[![Alt](https://img.test/image.png)](https://site.test/page)',
        'https://img.test/image.png',
        '![Alt](https://img.test/image.png)'
      ],
      [
        'multiline linked image',
        '[![Alt\nline2](https://img.test/image.png)](https://site.test/page)',
        'https://img.test/image.png',
        '![Alt\nline2](https://img.test/image.png)'
      ],
      [
        'asterisk-emphasized image',
        '*![alt](https://example.com/a.png)*',
        'https://example.com/a.png',
        '![alt](https://example.com/a.png)'
      ],
      [
        'multiline asterisk-emphasized image',
        '*![alt\nline2](https://example.com/a.png)*',
        'https://example.com/a.png',
        '![alt\nline2](https://example.com/a.png)'
      ],
      [
        'underscore-emphasized image',
        '_![alt](https://example.com/a.png)_',
        'https://example.com/a.png',
        '![alt](https://example.com/a.png)'
      ],
      [
        'strikethrough image',
        '~~![alt](https://example.com/a.png)~~',
        'https://example.com/a.png',
        '![alt](https://example.com/a.png)'
      ],
      [
        'compact table cell image',
        '| Col |\n| --- |\n|![alt](https://example.com/a.png)|',
        'https://example.com/a.png',
        '![alt](https://example.com/a.png)'
      ],
      [
        'CJK-adjacent image',
        '![alt](https://example.com/a.png)中文',
        'https://example.com/a.png',
        '![alt](https://example.com/a.png)'
      ],
      [
        'multiline CJK-adjacent image',
        '![alt\nline2](https://example.com/a.png)中文',
        'https://example.com/a.png',
        '![alt\nline2](https://example.com/a.png)'
      ],
      [
        'adjacent images without whitespace',
        '![a](https://example.com/a.png)![b](https://example.com/b.png)',
        'https://example.com/a.png',
        '![a](https://example.com/a.png)'
      ],
      [
        'sentence period after image',
        '![alt](https://example.com/a.png). Next sentence',
        'https://example.com/a.png',
        '![alt](https://example.com/a.png)'
      ]
    ] as const) {
      const start = source.indexOf('![');
      const parsed = parseMarkdownImageScale(source, start);
      expect(parsed, `parse:${label}`).toMatchObject({
        destination: expectedDest,
        raw: expectedRaw,
        scale: null,
        start
      });
      const found = findMarkdownImageAt(source, start + 3);
      expect(found, `find:${label}`).toMatchObject({
        destination: expectedDest,
        raw: expectedRaw,
        scale: null,
        start
      });
      if (!found) throw new Error(`missing-match:${label}`);
      const scaleRepl = createImageScaleReplacement(source, found, 50);
      const scaled =
        source.slice(0, scaleRepl.from) + scaleRepl.insert + source.slice(scaleRepl.to);
      expect(parseMarkdownImageScale(scaled, start), `scaled:${label}`).toMatchObject({
        destination: expectedDest,
        scale: 50,
        start
      });
      const destRepl = createMarkdownImageDestinationReplacement(
        source,
        found,
        'https://example.com/updated.png'
      );
      if (!destRepl) throw new Error(`missing-dest-repl:${label}`);
      const rewritten =
        source.slice(0, destRepl.from) + destRepl.insert + source.slice(destRepl.to);
      expect(parseMarkdownImageScale(rewritten, start), `rewritten:${label}`).toMatchObject({
        destination: 'https://example.com/updated.png',
        start
      });
    }

    // Truncated bare URLs immediately after `)` remain rejected.
    for (const ambiguous of [
      '![Alt](https://example.test/a).png',
      '![Alt](https://example.test/a)b.png',
      '![Alt](https://example.test/a)/b',
      '![Alt](https://example.test/a)?q=1',
      '![Alt](https://example.test/a)#frag',
      '![Alt](https://example.test/a)_v2.png',
      '![Alt](https://example.test/a)-v2.png'
    ]) {
      expect(parseMarkdownImageScale(ambiguous, 0), `reject-parse:${ambiguous}`).toBeNull();
      expect(findMarkdownImageAt(ambiguous, 3), `reject-find:${ambiguous}`).toBeNull();
    }
  });

  it('skips CommonMark §6.5 autolinks and §6.6 inline raw HTML in image alt text and excludes images inside HTML comments or attributes', () => {
    for (const [label, source, expectedAlt, expectedDest, expectedScale] of [
      [
        'URI autolink containing [ in alt text',
        '![Alt <https://example.test/a[b>](/image.png)',
        'Alt <https://example.test/a[b>',
        '/image.png',
        null
      ],
      [
        'HTML comment containing [ in alt text',
        '![Alt <!-- [ -->](/image.png)',
        'Alt <!-- [ -->',
        '/image.png',
        null
      ],
      [
        'HTML comment containing ] in alt text',
        '![Alt <!-- ] -->](/image.png)',
        'Alt <!-- ] -->',
        '/image.png',
        null
      ],
      [
        'HTML open tag attribute containing ]( in alt text',
        '![<span title="](">](https://example.com/a.png "{width=50%}")',
        '<span title="](">',
        'https://example.com/a.png',
        50
      ],
      [
        'URI autolink containing ] in alt text',
        '![<https://example.com/?a=]>](https://example.com/a.png "{width=50%}")',
        '<https://example.com/?a=]>',
        'https://example.com/a.png',
        50
      ],
      [
        'multiline HTML comment containing ] inside blockquote alt text',
        '> ![Alt <!--\n> ] -->](/image.png "{width=67%}")',
        'Alt <!--\n> ] -->',
        '/image.png',
        67
      ],
      [
        'multiline HTML open tag attribute containing ]( inside blockquote alt text',
        '> ![<span\n> title="](">](/image.png "{width=33%}")',
        '<span\n> title="](">',
        '/image.png',
        33
      ],
      [
        'HTML PI, declaration, and CDATA containing ] in alt text',
        '![<? ] ?> <!DOCTYPE ] > <![CDATA[ ] ]]>](/image.png)',
        '<? ] ?> <!DOCTYPE ] > <![CDATA[ ] ]]>',
        '/image.png',
        null
      ]
    ] as const) {
      const start = source.indexOf('![');
      expect(parseMarkdownImageScale(source, start), `parse:${label}`).toMatchObject({
        alt: expectedAlt,
        destination: expectedDest,
        scale: expectedScale,
        start
      });
      expect(findMarkdownImageAt(source, start + 3), `find:${label}`).toMatchObject({
        alt: expectedAlt,
        destination: expectedDest,
        scale: expectedScale,
        start
      });
    }

    // Non-images inside inline HTML comments and tag attributes MUST NOT match.
    for (const hidden of [
      'hi <!-- ![a](https://example.com/a.png) -->',
      '<span title="![a](https://example.com/a.png) ">hi</span>',
      '<span title="![a](<https://example.com/a.png>)">hi</span>',
      `<span title="![a](https://example.com/a.png 't')">hi</span>`,
      'hi <!--\n![a](https://example.com/a.png)\n-->',
      'hi <span\ntitle="![a](https://example.com/a.png)">x</span>',
      '> hi <!--\n> ![a](https://example.com/a.png)\n> -->',
      'hi <?php ![a](https://example.com/a.png) ?>',
      'hi <![CDATA[![a](https://example.com/a.png)]]>',
      'hi <!DOCTYPE ![a](https://example.com/a.png)>'
    ]) {
      const fakeStart = hidden.indexOf('![');
      expect(findMarkdownImageAt(hidden, fakeStart + 3), `hidden:${hidden}`).toBeNull();
    }

    // Pathological repeated unclosed inline HTML comments/tags stay linear.
    const adversarialComments = `hi ${'<!-- '.repeat(8_000)}![ok](/ok.png)`;
    const advStart = performance.now();
    expect(
      findMarkdownImageAt(adversarialComments, adversarialComments.indexOf('![ok]') + 3)
    ).toMatchObject({
      destination: '/ok.png'
    });
    expect(performance.now() - advStart).toBeLessThan(1_000);

    const adversarialTags = `hi ${'<span title="'.repeat(8_000)}![ok](/ok.png)`;
    const advTagStart = performance.now();
    expect(
      findMarkdownImageAt(adversarialTags, adversarialTags.indexOf('![ok]') + 3)
    ).toMatchObject({
      destination: '/ok.png'
    });
    expect(performance.now() - advTagStart).toBeLessThan(1_000);
  });

  it('prevents unclosed HTML open tags with quoted `>` attributes from poisoning later autolink/HTML scans', () => {
    // Unclosed `<b q="...">` holds a valid URI autolink containing `](wrong)>`:
    // both `findMarkdownImageAt` and `parseMarkdownImageScale` must agree on the outer image.
    const quotedAutolinkInAlt = '![a <b q="<https://example.com/](wrong)>](right)"';
    const expectedRaw = '![a <b q="<https://example.com/](wrong)>](right)';
    const found = findMarkdownImageAt(quotedAutolinkInAlt, 3);
    const parsed = parseMarkdownImageScale(quotedAutolinkInAlt, 0);
    expect(found).toMatchObject({
      alt: 'a <b q="<https://example.com/](wrong)>',
      destination: 'right',
      end: expectedRaw.length,
      raw: expectedRaw,
      start: 0
    });
    expect(parsed).toEqual(found);
    if (!found) throw new Error('quoted-autolink-alt-missing');
    const destRepl = createMarkdownImageDestinationReplacement(
      quotedAutolinkInAlt,
      found,
      'updated.png'
    );
    expect(destRepl).not.toBeNull();
    const scaleRepl = createImageScaleReplacement(quotedAutolinkInAlt, found, 50);
    expect(
      quotedAutolinkInAlt.slice(0, scaleRepl.from)
      + scaleRepl.insert
      + quotedAutolinkInAlt.slice(scaleRepl.to)
    ).toBe('![a <b q="<https://example.com/](wrong)>](right "{width=50%}")"');

    // Unclosed `<a b="...">` wrapping a valid inline HTML tag or URI autolink containing `![a](u)`
    // must still skip the nested HTML/autolink so `![a](u)` never matches as a live image.
    for (const hidden of [
      `<a b="<span title='![a](u)'>" c`,
      '<a b="<https://example.com/![a](u)>" c',
      `<a b="<span\ntitle='![a](u)'>" c`
    ]) {
      const fakeStart = hidden.indexOf('![');
      expect(findMarkdownImageAt(hidden, fakeStart + 3), hidden).toBeNull();
    }
  });

  it('keeps single-line and block scanning linear on 16,300 repeated `<` and repeated tag prefixes', () => {
    for (const [label, source] of [
      ['16,300 bare <', `![A ${'<'.repeat(16_300)}](/x.png)`],
      ['4,000 unclosed <a ', `![A ${'<a '.repeat(4_000)}](/x.png)`],
      ['4,000 unclosed <!--', `![A ${'<!--'.repeat(4_000)}](/x.png)`],
      ['4,000 unclosed <?', `![A ${'<?'.repeat(4_000)}](/x.png)`]
    ] as const) {
      const parseStart = performance.now();
      expect(parseMarkdownImageScale(source, 0), `parse:${label}`).toMatchObject({
        destination: '/x.png',
        end: source.length,
        start: 0
      });
      expect(performance.now() - parseStart, `parse-time:${label}`).toBeLessThan(250);

      const findStart = performance.now();
      expect(findMarkdownImageAt(source, 3), `find:${label}`).toMatchObject({
        destination: '/x.png',
        end: source.length,
        start: 0
      });
      expect(performance.now() - findStart, `find-time:${label}`).toBeLessThan(250);
    }
  });

  it('isolates GFM table-row inline parsing per cell matching PHP TableParser::split()', () => {
    // Backticks, inline HTML, and brackets in adjacent cells must not swallow or merge images.
    for (const [label, source, expectedAlt, expectedDest, expectedScale, expectedTitle] of [
      [
        'header cells with backticks in sibling cells',
        '| ` | ![alt](https://example.com/a.png) | ` |\n| --- | --- | --- |',
        'alt',
        'https://example.com/a.png',
        null,
        null
      ],
      [
        'body cells with backticks in sibling cells',
        '| c1 | c2 | c3 |\n| --- | --- | --- |\n| ` | ![alt](https://example.com/a.png) | ` |',
        'alt',
        'https://example.com/a.png',
        null,
        null
      ],
      [
        'header cells with unclosed HTML quote in sibling cells',
        '| <a title=" | ![alt](https://example.com/a.png) | "> |\n| --- | --- | --- |',
        'alt',
        'https://example.com/a.png',
        null,
        null
      ],
      [
        'header cells with outer image opener/closer split across sibling cells',
        '| ![outer | ![inner](https://example.com/a.png) | ](https://example.com/b.png) |\n| --- | --- | --- |',
        'inner',
        'https://example.com/a.png',
        null,
        null
      ],
      [
        'header cell with unclosed backtick and closing backtick in next cell',
        '| ![a `b](https://example.com/a.png) | ` |\n| --- | --- |',
        'a `b',
        'https://example.com/a.png',
        null,
        null
      ],
      [
        'header cell with unclosed HTML tag and closer in next cell',
        '| ![a <b q="](https://example.com/a.png) | "> |\n| --- | --- |',
        'a <b q="',
        'https://example.com/a.png',
        null,
        null
      ],
      [
        'blockquote-nested table row isolates backticks per cell',
        '> | ` | ![alt](https://example.com/a.png) | ` |\n> | --- | --- | --- |',
        'alt',
        'https://example.com/a.png',
        null,
        null
      ],
      [
        'escaped pipes inside alt text and scaled title stay in one cell',
        '| ![a\\|b](https://example.com/a.png "t\\|u {width=50%}") |\n| --- |',
        'a\\|b',
        'https://example.com/a.png',
        50,
        't\\|u'
      ]
    ] as const) {
      const start = source.indexOf(`![${expectedAlt}]`);
      const parsed = parseMarkdownImageScale(source, start);
      expect(parsed, `parse:${label}`).toMatchObject({
        alt: expectedAlt,
        destination: expectedDest,
        scale: expectedScale,
        start,
        title: expectedTitle
      });
      const found = findMarkdownImageAt(source, start + 3);
      expect(found, `find:${label}`).toMatchObject({
        alt: expectedAlt,
        destination: expectedDest,
        scale: expectedScale,
        start,
        title: expectedTitle
      });
    }

    // Outer split-cell bracket syntax must never match as a cross-cell image.
    const splitBracketRow =
      '| ![outer | ![inner](https://example.com/a.png) | ](https://example.com/b.png) |\n| --- | --- | --- |';
    expect(parseMarkdownImageScale(splitBracketRow, splitBracketRow.indexOf('![outer'))).toBeNull();
    expect(findMarkdownImageAt(splitBracketRow, splitBracketRow.indexOf('outer'))).toBeNull();
    expect(findMarkdownImageAt(splitBracketRow, splitBracketRow.indexOf('b.png'))).toBeNull();
    // Cross-cell selection spanning from cell 0 into cell 1 returns null.
    expect(
      findMarkdownImageAt(
        splitBracketRow,
        splitBracketRow.indexOf('outer'),
        splitBracketRow.indexOf('inner') + 3
      )
    ).toBeNull();
  });

  it('rejects images in GFM table body cells beyond PHP headerColumnCount', () => {
    for (const [label, source, marker] of [
      [
        '2-col table with 3rd extra body cell',
        '| H | B |\n| --- | --- |\n| a | b | ![extra](https://example.org/i.png) |',
        '![extra]'
      ],
      [
        '1-col table extra body cell before valid next row',
        '| A |\n| --- |\n| 1 | ![dropped](https://example.com/dropped.png) |\n| ![real](https://example.com/real.png) |',
        '![dropped]'
      ],
      [
        'asymmetric 1-header / 2-separator table drops 2nd body cell',
        '| A |\n| --- | --- |\n| 1 | ![dropped](https://example.com/dropped.png) |',
        '![dropped]'
      ],
      [
        '0-col header table drops piped body cell',
        '|\n| --- |\n| ![dropped](https://example.com/dropped.png) |',
        '![dropped]'
      ],
      [
        '0-col header table drops lazy-continuation body row without pipe',
        '|\n| --- |\n![dropped](https://example.com/dropped.png)',
        '![dropped]'
      ],
      [
        'blockquote-nested 1-col table drops 2nd body cell',
        '> | A |\n> | --- |\n> | 1 | ![dropped](https://example.com/dropped.png) |',
        '![dropped]'
      ],
      [
        'list-nested 1-col table drops 2nd body cell',
        '- | A |\n  | --- |\n  | 1 | ![dropped](https://example.com/dropped.png) |',
        '![dropped]'
      ]
    ] as const) {
      const start = source.indexOf(marker);
      expect(parseMarkdownImageScale(source, start), `parse:${label}`).toBeNull();
      expect(findMarkdownImageAt(source, start + 3), `find:${label}`).toBeNull();
    }

    const mixedTable =
      '| A |\n| --- |\n| 1 | ![dropped](https://example.com/dropped.png) |\n| ![real](https://example.com/real.png) |';
    const realStart = mixedTable.indexOf('![real]');
    expect(parseMarkdownImageScale(mixedTable, realStart)).toMatchObject({
      alt: 'real',
      destination: 'https://example.com/real.png',
      start: realStart
    });
    expect(findMarkdownImageAt(mixedTable, realStart + 3)).toMatchObject({
      alt: 'real',
      destination: 'https://example.com/real.png',
      start: realStart
    });
  });

  it('decodes PHP TableParser pipe escapes on read and escapes pipes on table destination writes', () => {
    for (const [label, source, expectedDest] of [
      [
        'single-escaped pipe in bare table destination',
        '| A |\n| --- |\n| ![alt](https://example.com/a\\|b.png) |',
        'https://example.com/a|b.png'
      ],
      [
        'double-backslash pipe in bare table destination decodes to single pipe',
        '| A |\n| --- |\n| ![alt](https://example.com/a\\\\|b.png) |',
        'https://example.com/a|b.png'
      ],
      [
        'triple-backslash pipe in bare table destination decodes to backslash plus pipe',
        '| A |\n| --- |\n| ![alt](https://example.com/a\\\\\\|b.png) |',
        'https://example.com/a\\|b.png'
      ],
      [
        'quad-backslash pipe in bare table destination decodes to backslash plus pipe',
        '| A |\n| --- |\n| ![alt](https://example.com/a\\\\\\\\|b.png) |',
        'https://example.com/a\\|b.png'
      ],
      [
        'double-backslash pipe in angle-bracket table destination decodes to single pipe',
        '| A |\n| --- |\n| ![alt](<https://example.com/a\\\\|b.png>) |',
        'https://example.com/a|b.png'
      ]
    ] as const) {
      const start = source.indexOf('![alt]');
      expect(parseMarkdownImageScale(source, start), `parse:${label}`).toMatchObject({
        destination: expectedDest
      });
      expect(findMarkdownImageAt(source, start + 3), `find:${label}`).toMatchObject({
        destination: expectedDest
      });
    }

    // Effective title in a table cell also applies PHP TableParser `\|` -> `|` before inline unescaping.
    const titlePipeSource =
      '| A |\n| --- |\n| ![alt](https://example.com/a.png "a\\\\|b \\{width=50%}") |';
    const titleStart = titlePipeSource.indexOf('![alt]');
    expect(findMarkdownImageAt(titlePipeSource, titleStart + 3)).toMatchObject({
      scale: 50,
      title: 'a|b',
      titleMarkerEnd: null,
      titleMarkerStart: null
    });

    // Destination replacement inside a table row escapes `|` so the table cell is never split.
    const bareTable = '| A |\n| --- |\n| ![alt](https://example.com/old.png) |';
    const bareMatch = findMarkdownImageAt(bareTable, bareTable.indexOf('![alt]') + 3);
    if (!bareMatch) throw new Error('bare-table-match-missing');
    const pipeRepl = createMarkdownImageDestinationReplacement(
      bareTable,
      bareMatch,
      'https://example.com/a|b.png'
    );
    expect(pipeRepl).not.toBeNull();
    if (!pipeRepl) return;
    const writtenBare =
      bareTable.slice(0, pipeRepl.from) + pipeRepl.insert + bareTable.slice(pipeRepl.to);
    expect(writtenBare).toBe('| A |\n| --- |\n| ![alt](https://example.com/a\\|b.png) |');
    expect(
      findMarkdownImageAt(writtenBare, writtenBare.indexOf('![alt]') + 3)?.destination
    ).toBe('https://example.com/a|b.png');

    // Literal `\|` inside a table destination round-trips as `\\\|` matching PHP TableParser::split().
    const slashPipeRepl = createMarkdownImageDestinationReplacement(
      bareTable,
      bareMatch,
      'https://example.com/a\\|b.png'
    );
    expect(slashPipeRepl).not.toBeNull();
    if (!slashPipeRepl) return;
    const writtenSlashPipe =
      bareTable.slice(0, slashPipeRepl.from)
      + slashPipeRepl.insert
      + bareTable.slice(slashPipeRepl.to);
    expect(writtenSlashPipe).toBe('| A |\n| --- |\n| ![alt](https://example.com/a\\\\\\|b.png) |');
    expect(
      findMarkdownImageAt(writtenSlashPipe, writtenSlashPipe.indexOf('![alt]') + 3)?.destination
    ).toBe('https://example.com/a\\|b.png');

    // Pipe plus spaces in a table row serializes as angle-bracketed with escaped pipe.
    const spacePipeRepl = createMarkdownImageDestinationReplacement(
      bareTable,
      bareMatch,
      'https://example.com/a | b.png'
    );
    expect(spacePipeRepl).not.toBeNull();
    if (!spacePipeRepl) return;
    const writtenSpacePipe =
      bareTable.slice(0, spacePipeRepl.from)
      + spacePipeRepl.insert
      + bareTable.slice(spacePipeRepl.to);
    expect(writtenSpacePipe).toBe('| A |\n| --- |\n| ![alt](<https://example.com/a \\| b.png>) |');
    expect(
      findMarkdownImageAt(writtenSpacePipe, writtenSpacePipe.indexOf('![alt]') + 3)?.destination
    ).toBe('https://example.com/a | b.png');

    // Angle-bracketed table image keeps angle brackets and escapes `|`.
    const angleTable = '| A |\n| --- |\n| ![alt](<https://example.com/old.png>) |';
    const angleMatch = findMarkdownImageAt(angleTable, angleTable.indexOf('![alt]') + 3);
    if (!angleMatch) throw new Error('angle-table-match-missing');
    const angleRepl = createMarkdownImageDestinationReplacement(
      angleTable,
      angleMatch,
      'https://example.com/a|b.png'
    );
    expect(angleRepl).not.toBeNull();
    if (!angleRepl) return;
    expect(
      angleTable.slice(0, angleRepl.from) + angleRepl.insert + angleTable.slice(angleRepl.to)
    ).toBe('| A |\n| --- |\n| ![alt](<https://example.com/a\\|b.png>) |');

    // Non-table image destination with `|` remains unescaped.
    const plainSource = '![alt](https://example.com/old.png)';
    const plainMatch = findMarkdownImageAt(plainSource, 3);
    if (!plainMatch) throw new Error('plain-match-missing');
    const plainRepl = createMarkdownImageDestinationReplacement(
      plainSource,
      plainMatch,
      'https://example.com/a|b.png'
    );
    expect(plainRepl).not.toBeNull();
    if (!plainRepl) return;
    expect(
      plainSource.slice(0, plainRepl.from) + plainRepl.insert + plainSource.slice(plainRepl.to)
    ).toBe('![alt](https://example.com/a|b.png)');
  });
});
