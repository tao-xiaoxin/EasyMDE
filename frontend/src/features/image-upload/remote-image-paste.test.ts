import { describe, expect, it } from 'vitest';

import { remoteImagePasteCandidate } from './remote-image-paste';

function transfer(values: Readonly<Record<string, string>>): DataTransfer {
  return {
    files: [],
    getData: (type: string) => values[type] ?? '',
    items: [],
  } as unknown as DataTransfer;
}

describe('remoteImagePasteCandidate', () => {
  it('recognizes one absolute HTTP image from otherwise empty HTML', () => {
    expect(
      remoteImagePasteCandidate(
        transfer({
          'text/html': ' \n<!-- source --><img alt="Remote cover" src="https://images.example.test/cover.png"> ',
          'text/plain': 'https://images.example.test/cover.png',
        }),
        document,
        'visual',
      ),
    ).toEqual({
      altText: 'Remote cover',
      fallbackText: 'https://images.example.test/cover.png',
      sourceText: '<img alt="Remote cover" src="https://images.example.test/cover.png">',
      url: 'https://images.example.test/cover.png',
    });
  });

  it('uses a Markdown image fallback when HTML has no plain-text representation', () => {
    expect(
      remoteImagePasteCandidate(
        transfer({ 'text/html': '<img alt="Remote [cover]" src="http://images.example.test/cover.png">' }),
        document,
        'visual',
      ),
    ).toMatchObject({
      altText: 'Remote [cover]',
      fallbackText: '![Remote cover](http://images.example.test/cover.png)',
      url: 'http://images.example.test/cover.png',
    });
  });

  it('preserves a short plain-text representation for one HTML image', () => {
    expect(
      remoteImagePasteCandidate(
        transfer({
          'text/html': '<img alt="Remote cover" src="https://images.example.test/cover.png">',
          'text/plain': 'Remote cover caption',
        }),
        document,
        'visual',
      ),
    ).toMatchObject({
      fallbackText: 'Remote cover caption',
    });
  });

  it('preserves plain text at the single-image fallback limit', () => {
    const plainText = 'x'.repeat(4096);
    const candidate = remoteImagePasteCandidate(
      transfer({
        'text/html': '<img alt="Remote cover" src="https://images.example.test/cover.png">',
        'text/plain': plainText,
      }),
      document,
      'visual',
    );

    expect(candidate?.fallbackText).toBe(plainText);
  });

  it('uses the Markdown fallback when one HTML image has oversized plain text', () => {
    const candidate = remoteImagePasteCandidate(
      transfer({
        'text/html': '<img alt="Remote cover" src="https://images.example.test/cover.png">',
        'text/plain': 'x'.repeat(4097),
      }),
      document,
      'visual',
    );

    expect(candidate?.fallbackText).toBe(
      '![Remote cover](https://images.example.test/cover.png)',
    );
  });

  it('rejects raw URL whitespace while preserving a percent-encoded space', () => {
    expect(
      remoteImagePasteCandidate(
        transfer({
          'text/html': '<img alt="Remote cover" src=" https://images.example.test/cover.png ">',
        }),
        document,
        'visual',
      ),
    ).toBeNull();

    expect(
      remoteImagePasteCandidate(
        transfer({
          'text/html': '<img alt="Remote cover" src="https://images.example.test/remote%20cover.png">',
        }),
        document,
        'visual',
      ),
    ).toMatchObject({
      fallbackText: '![Remote cover](https://images.example.test/remote%20cover.png)',
      url: 'https://images.example.test/remote%20cover.png',
    });
  });

  it.each(['(', ')'])('rejects a raw %s in an HTML image URL', (parenthesis) => {
    expect(
      remoteImagePasteCandidate(
        transfer({
          'text/html': `<img alt="Remote cover" src="https://images.example.test/remote${parenthesis}cover.png">`,
        }),
        document,
        'visual',
      ),
    ).toBeNull();
  });

  it('preserves percent-encoded parentheses in the HTML image fallback', () => {
    expect(
      remoteImagePasteCandidate(
        transfer({
          'text/html': '<img alt="Remote cover" src="https://images.example.test/remote%28cover%29.png">',
        }),
        document,
        'visual',
      ),
    ).toMatchObject({
      fallbackText: '![Remote cover](https://images.example.test/remote%28cover%29.png)',
      url: 'https://images.example.test/remote%28cover%29.png',
    });
  });

  it('recognizes exactly one inline Markdown image only on source surfaces', () => {
    const clipboard = transfer({
      'text/plain': '  ![Remote cover](https://images.example.test/cover.png)  ',
    });

    expect(remoteImagePasteCandidate(clipboard, document, 'source')).toEqual({
      altText: 'Remote cover',
      fallbackText: '![Remote cover](https://images.example.test/cover.png)',
      sourceText: '![Remote cover](https://images.example.test/cover.png)',
      url: 'https://images.example.test/cover.png',
    });
    expect(remoteImagePasteCandidate(clipboard, document, 'visual')).toBeNull();
  });

  it('bounds imported Alt text to the WordPress request contract', () => {
    const candidate = remoteImagePasteCandidate(
      transfer({
        'text/html': `<img alt="${'a'.repeat(4096)}" src="https://images.example.test/cover.png">`,
      }),
      document,
      'visual',
    );

    expect(candidate?.altText).toHaveLength(2048);
  });

  it.each([
    ['plain URL', { 'text/plain': 'https://images.example.test/cover.png' }],
    ['ordinary link', { 'text/html': '<a href="https://images.example.test/cover.png">cover</a>' }],
    ['rich text with image', { 'text/html': '<p>Caption</p><img src="https://images.example.test/cover.png">' }],
    ['relative image', { 'text/html': '<img src="/cover.png">' }],
    ['data image', { 'text/html': '<img src="data:image/png;base64,AAAA">' }],
    ['reference image', { 'text/plain': '![cover][remote]\n\n[remote]: https://images.example.test/cover.png' }],
  ])('does not claim %s', (_label, values) => {
    expect(remoteImagePasteCandidate(transfer(values), document, 'source')).toBeNull();
  });
});
