import { describe, expect, it } from 'vitest';

import { publishingBootstrapFixture } from '../../test/publishing-bootstrap-fixture';
import { parsePublishingBootstrap } from './publishing-bootstrap';

describe('parsePublishingBootstrap', () => {
  it('validates translated strings and PHP-owned category identities', () => {
    expect(parsePublishingBootstrap(publishingBootstrapFixture)).toEqual(publishingBootstrapFixture);
  });

  it.each([
    null,
    { ...publishingBootstrapFixture, strings: { ...publishingBootstrapFixture.strings, title: '' } },
    { ...publishingBootstrapFixture, categoryOptions: [{ id: 'not-an-id', label: 'Bad', parentId: '' }] },
    { ...publishingBootstrapFixture, categoryOptions: [
      { id: '7', label: 'First', parentId: '' }, { id: '7', label: 'Duplicate', parentId: '' }
    ] }
  ])('rejects invalid external publishing data', (value) => {
    expect(() => parsePublishingBootstrap(value)).toThrowError('publishing-bootstrap-invalid');
  });
});
