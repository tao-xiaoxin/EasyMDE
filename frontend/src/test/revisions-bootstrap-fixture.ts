import type { RevisionsBootstrap } from '../contracts/bootstrap/revisions-bootstrap';

export const revisionsBootstrapFixture: RevisionsBootstrap = {
  enabled: true,
  strings: {
    autoSave: 'Auto save',
    close: 'Close',
    count: '%d revisions',
    failed: 'Revision history could not be loaded.',
    filterAll: 'All',
    help: 'WordPress revisions for this article',
    loading: 'Loading revisions...',
    loadingPreview: 'Loading revision preview...',
    manualSave: 'Manual save',
    noRevisions: 'No revisions are available yet.',
    open: 'History',
    previewFailed: 'Revision preview could not be loaded.',
    restore: 'Restore this version',
    title: 'Version history',
    untitled: 'Untitled revision'
  }
};
