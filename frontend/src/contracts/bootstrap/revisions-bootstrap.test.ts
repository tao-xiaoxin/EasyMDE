import { describe, expect, it } from 'vitest';

import { revisionsBootstrapFixture } from '../../test/revisions-bootstrap-fixture';
import { parseRevisionsBootstrap } from './revisions-bootstrap';

describe('parseRevisionsBootstrap', () => {
  it('accepts the bounded revision presentation contract', () => {
    expect(parseRevisionsBootstrap(revisionsBootstrapFixture)).toEqual(revisionsBootstrapFixture);
  });

  it.each([
    null,
    { ...revisionsBootstrapFixture, enabled: 'yes' },
    { ...revisionsBootstrapFixture, strings: { ...revisionsBootstrapFixture.strings, failed: '' } },
    { ...revisionsBootstrapFixture, strings: { ...revisionsBootstrapFixture.strings, count: 'x'.repeat(513) } }
  ])('rejects malformed revision bootstrap data', (value) => {
    expect(() => parseRevisionsBootstrap(value)).toThrow('revisions-bootstrap-invalid');
  });
});
