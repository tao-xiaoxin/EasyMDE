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
});
