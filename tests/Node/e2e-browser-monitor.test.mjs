import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import {
  attachPrivacySafeBrowserMonitor,
  classifyBrowserUrlCategory,
  classifyReadonlyPostRequest
} from '../e2e/helpers/privacy-safe-browser-monitor.mjs';

const BASE_URL = 'http://127.0.0.1:8089';
const SUBDIR_BASE_URL = 'http://127.0.0.1:8089/subdir';

function createStubPage() {
  const emitter = new EventEmitter();
  let currentMainFrameUrl = `${BASE_URL}/wp-admin/post-new.php`;
  const mainFrame = {
    url: () => currentMainFrameUrl
  };
  return {
    on: (event, listener) => emitter.on(event, listener),
    off: (event, listener) => emitter.off(event, listener),
    emit: (event, ...args) => emitter.emit(event, ...args),
    listenerCount: (event) => emitter.listenerCount(event),
    mainFrame: () => mainFrame,
    navigateMainFrame(url) {
      currentMainFrameUrl = url;
      emitter.emit('framenavigated', mainFrame);
    },
    navigateSubFrame(url) {
      emitter.emit('framenavigated', { url: () => url });
    }
  };
}

function stubRequest({
  url,
  method = 'POST',
  headers = { 'content-type': 'application/json' },
  postData = '',
  resourceType = 'fetch',
  errorText = null
}) {
  return {
    url: () => url,
    method: () => method,
    headers: () => headers,
    postData: () => postData,
    resourceType: () => resourceType,
    failure: () => (null === errorText ? null : { errorText })
  };
}

test('classifyBrowserUrlCategory classifies cross-origin WordPress-shaped URLs as external first', () => {
  const externalUrls = [
    'https://external.example/wp-content/plugins/easymde/a.js',
    'https://external.example/wp-json/easymde/v1/preview',
    'https://external.example/wp-json/easymde/v1/settings',
    'https://external.example/wp-json/wp/v2/posts',
    'https://external.example/?rest_route=/easymde/v1/preview',
    'https://external.example/wp-admin/post-new.php',
    'https://external.example/wp-admin/admin-ajax.php',
    'https://external.example/wp-login.php'
  ];

  for (const url of externalUrls) {
    assert.equal(classifyBrowserUrlCategory(url, BASE_URL), 'external', url);
  }
});

test('classifyBrowserUrlCategory classifies same-origin WordPress routes and special schemes accurately', () => {
  assert.equal(
    classifyBrowserUrlCategory(`${BASE_URL}/wp-json/easymde/v1/preview`, BASE_URL),
    'preview-rest'
  );
  assert.equal(
    classifyBrowserUrlCategory(`${BASE_URL}/wp-json/easymde/v1/preview/`, BASE_URL),
    'preview-rest'
  );
  assert.equal(
    classifyBrowserUrlCategory(`${BASE_URL}/?rest_route=/easymde/v1/preview`, BASE_URL),
    'preview-rest'
  );
  assert.equal(
    classifyBrowserUrlCategory(`${BASE_URL}/index.php?rest_route=/easymde/v1/preview`, BASE_URL),
    'preview-rest'
  );
  assert.equal(
    classifyBrowserUrlCategory(`${SUBDIR_BASE_URL}/wp-json/easymde/v1/preview`, SUBDIR_BASE_URL),
    'preview-rest'
  );
  assert.equal(
    classifyBrowserUrlCategory(`${SUBDIR_BASE_URL}/index.php?rest_route=/easymde/v1/preview`, SUBDIR_BASE_URL),
    'preview-rest'
  );
  assert.equal(
    classifyBrowserUrlCategory(`${BASE_URL}/wp-login.php?rest_route=/easymde/v1/preview`, BASE_URL),
    'wp-login'
  );
  assert.equal(
    classifyBrowserUrlCategory(`${BASE_URL}/wp-json/easymde/v1/settings`, BASE_URL),
    'easymde-api'
  );
  assert.equal(
    classifyBrowserUrlCategory(`${BASE_URL}/wp-content/plugins/easymde/assets/build/editor.js`, BASE_URL),
    'plugin-asset'
  );
  assert.equal(
    classifyBrowserUrlCategory(`${BASE_URL}/wp-admin/admin-ajax.php`, BASE_URL),
    'admin-ajax'
  );
  assert.equal(
    classifyBrowserUrlCategory(`${BASE_URL}/wp-login.php`, BASE_URL),
    'wp-login'
  );
  assert.equal(
    classifyBrowserUrlCategory(`${BASE_URL}/wp-admin/post-new.php`, BASE_URL),
    'wp-admin'
  );
  assert.equal(
    classifyBrowserUrlCategory(`${BASE_URL}/wp-json/wp/v2/posts`, BASE_URL),
    'wp-rest'
  );
  assert.equal(
    classifyBrowserUrlCategory(`${BASE_URL}/2026/11/24/published-post/`, BASE_URL),
    'same-origin'
  );
  assert.equal(classifyBrowserUrlCategory('about:blank', BASE_URL), 'about-blank');
  assert.equal(classifyBrowserUrlCategory('about:srcdoc', BASE_URL), 'non-http');
  assert.equal(classifyBrowserUrlCategory('data:text/html,hi', BASE_URL), 'non-http');
  assert.equal(classifyBrowserUrlCategory(`blob:${BASE_URL}/1234`, BASE_URL), 'non-http');
  assert.equal(classifyBrowserUrlCategory('not-a-valid-url', BASE_URL), 'invalid');
  assert.equal(classifyBrowserUrlCategory('', BASE_URL), 'unknown');
  assert.equal(
    classifyBrowserUrlCategory(`${BASE_URL}/wp-admin/post-new.php`, 'not-a-valid-base'),
    'external'
  );
});

test('classifyReadonlyPostRequest accepts same-origin preview routes across pretty, plain, and subdirectory layouts', () => {
  const rootPreviewUrls = [
    `${BASE_URL}/wp-json/easymde/v1/preview`,
    `${BASE_URL}/wp-json/easymde/v1/preview/`,
    `${BASE_URL}/?rest_route=/easymde/v1/preview`,
    `${BASE_URL}/index.php?rest_route=/easymde/v1/preview`,
    `${BASE_URL}/index.php?rest_route=%20%2Feasymde%2Fv1%2Fpreview%2F%20`
  ];
  for (const url of rootPreviewUrls) {
    assert.deepEqual(
      classifyReadonlyPostRequest(
        stubRequest({ url, postData: '{"markdown":"alpha"}' }),
        { baseURL: BASE_URL }
      ),
      { category: 'preview-rest', classification: 'preview-readonly' },
      url
    );
  }

  const subdirPreviewUrls = [
    `${SUBDIR_BASE_URL}/wp-json/easymde/v1/preview`,
    `${SUBDIR_BASE_URL}/wp-json/easymde/v1/preview/`,
    `${SUBDIR_BASE_URL}?rest_route=/easymde/v1/preview`,
    `${SUBDIR_BASE_URL}/?rest_route=/easymde/v1/preview`,
    `${SUBDIR_BASE_URL}/index.php?rest_route=/easymde/v1/preview`
  ];
  for (const url of subdirPreviewUrls) {
    assert.deepEqual(
      classifyReadonlyPostRequest(
        stubRequest({ url, postData: '{"markdown":"alpha"}' }),
        { baseURL: `${SUBDIR_BASE_URL}/` }
      ),
      { category: 'preview-rest', classification: 'preview-readonly' },
      url
    );
  }
});

test('classifyReadonlyPostRequest rejects non-root plain-permalink paths, duplicate rest_route, and cross-origin POSTs', () => {
  const rejectedSameOriginUrls = [
    `${BASE_URL}/wp-login.php?rest_route=/easymde/v1/preview`,
    `${BASE_URL}/wp-admin/post.php?rest_route=/easymde/v1/preview`,
    `${BASE_URL}/wp-admin/index.php?rest_route=/easymde/v1/preview`,
    `${BASE_URL}/wp-comments-post.php?rest_route=/easymde/v1/preview`,
    `${BASE_URL}/other/wp-json/easymde/v1/preview`,
    `${BASE_URL}/other/index.php?rest_route=/easymde/v1/preview`
  ];
  for (const url of rejectedSameOriginUrls) {
    assert.deepEqual(
      classifyReadonlyPostRequest(
        stubRequest({ url, postData: '{"markdown":"alpha"}' }),
        { baseURL: BASE_URL }
      ),
      { category: 'other-post', classification: 'unexpected-write' },
      url
    );
  }

  assert.deepEqual(
    classifyReadonlyPostRequest(
      stubRequest({
        url: `${BASE_URL}/?rest_route=/easymde/v1/preview&rest_route=/wp/v2/posts`,
        postData: '{"markdown":"alpha"}'
      }),
      { baseURL: BASE_URL }
    ),
    { category: 'other-rest', classification: 'unexpected-write' }
  );

  assert.deepEqual(
    classifyReadonlyPostRequest(
      stubRequest({
        url: `${SUBDIR_BASE_URL}/wp-login.php?rest_route=/easymde/v1/preview`,
        postData: 'log=user&pwd=secret'
      }),
      { baseURL: SUBDIR_BASE_URL }
    ),
    { category: 'other-post', classification: 'unexpected-write' }
  );

  assert.deepEqual(
    classifyReadonlyPostRequest(
      stubRequest({
        url: `${BASE_URL}/?rest_route=/easymde/v1/preview`,
        postData: '{"markdown":"alpha"}'
      }),
      { baseURL: SUBDIR_BASE_URL }
    ),
    { category: 'other-post', classification: 'unexpected-write' }
  );

  const rejectedCrossOriginUrls = [
    'https://evil.example/wp-json/easymde/v1/preview',
    'https://evil.example/?rest_route=/easymde/v1/preview',
    'https://evil.example/index.php?rest_route=/easymde/v1/preview',
    'https://evil.example/wp-admin/admin-ajax.php'
  ];
  for (const url of rejectedCrossOriginUrls) {
    assert.deepEqual(
      classifyReadonlyPostRequest(
        stubRequest({
          url,
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          postData: 'action=heartbeat'
        }),
        { baseURL: BASE_URL }
      ),
      { category: 'external-post', classification: 'unexpected-write' },
      url
    );
  }
});

test('classifyReadonlyPostRequest preserves strict admin-ajax heartbeat and community-events checks', () => {
  assert.deepEqual(
    classifyReadonlyPostRequest(
      stubRequest({
        url: `${BASE_URL}/wp-admin/admin-ajax.php`,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        postData: 'action=heartbeat'
      }),
      { baseURL: BASE_URL }
    ),
    { category: 'heartbeat', classification: 'heartbeat-readonly' }
  );
  assert.deepEqual(
    classifyReadonlyPostRequest(
      stubRequest({
        url: `${BASE_URL}/wp-admin/admin-ajax.php`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        postData: 'action=get-community-events'
      }),
      { baseURL: BASE_URL }
    ),
    { category: 'community-events', classification: 'community-events-readonly' }
  );
  assert.deepEqual(
    classifyReadonlyPostRequest(
      stubRequest({
        url: `${BASE_URL}/wp-admin/admin-ajax.php`,
        headers: { 'content-type': 'application/json' },
        postData: '{"action":"heartbeat","data":{"wp_autosave":{}}}'
      }),
      { baseURL: BASE_URL }
    ),
    { category: 'other-admin-ajax', classification: 'unexpected-write' }
  );
  assert.deepEqual(
    classifyReadonlyPostRequest(
      stubRequest({ url: 'not-a-url' }),
      { baseURL: BASE_URL }
    ),
    { category: 'invalid-url', classification: 'unexpected-write' }
  );
});

test('attachPrivacySafeBrowserMonitor stays clean on allowed WordPress navigations and benign browser events', () => {
  const page = createStubPage();
  const monitor = attachPrivacySafeBrowserMonitor(page, { baseURL: BASE_URL });

  page.navigateMainFrame(`${BASE_URL}/wp-login.php`);
  page.navigateMainFrame(`${BASE_URL}/wp-admin/`);
  page.navigateMainFrame(`${BASE_URL}/wp-admin/post-new.php`);
  page.navigateMainFrame(`${BASE_URL}/wp-admin/post.php?post=42&action=edit`);
  page.navigateMainFrame(`${BASE_URL}/wp-admin/edit.php`);
  page.navigateSubFrame('about:blank');
  page.navigateSubFrame('https://external.example/embed');

  page.emit('console', {
    type: () => 'log',
    text: () => 'benign log',
    location: () => ({ url: `${BASE_URL}/wp-admin/post-new.php` })
  });
  page.emit('requestfailed', stubRequest({
    url: `${BASE_URL}/wp-json/easymde/v1/preview`,
    method: 'POST',
    resourceType: 'fetch',
    errorText: 'net::ERR_ABORTED'
  }));
  page.emit('requestfailed', stubRequest({
    url: `${BASE_URL}/wp-admin/admin-ajax.php`,
    method: 'POST',
    resourceType: 'xhr',
    errorText: 'net::ERR_ABORTED'
  }));
  page.emit('requestfailed', stubRequest({
    url: 'https://external.example/wp-content/plugins/easymde/a.js',
    method: 'GET',
    resourceType: 'script',
    errorText: 'net::ERR_CONNECTION_REFUSED'
  }));
  page.emit('response', {
    status: () => 404,
    url: () => 'https://external.example/wp-json/easymde/v1/preview',
    request: () => stubRequest({
      url: 'https://external.example/wp-json/easymde/v1/preview',
      resourceType: 'fetch'
    })
  });

  monitor.assertClean();
  assert.equal(monitor.counts.cancelledPreview, 1);
  assert.equal(monitor.counts.abortedAdminAjax, 1);
  assert.equal(monitor.counts.unexpectedNavigations, 0);
  monitor.dispose();
});

test('attachPrivacySafeBrowserMonitor allows published post navigations when configured and rejects unexpected ones', () => {
  const publishedPage = createStubPage();
  const publishedMonitor = attachPrivacySafeBrowserMonitor(publishedPage, {
    baseURL: BASE_URL,
    allowedNavigationCategories: ['wp-login', 'wp-admin', 'same-origin']
  });

  publishedPage.navigateMainFrame(`${BASE_URL}/wp-login.php`);
  publishedPage.navigateMainFrame(`${BASE_URL}/wp-admin/post-new.php`);
  publishedPage.navigateMainFrame(`${BASE_URL}/2026/11/24/published-gantt/`);
  publishedPage.navigateMainFrame(`${BASE_URL}/?p=123`);
  publishedMonitor.assertClean();

  publishedPage.navigateMainFrame('https://evil.example/wp-admin/post-new.php');
  publishedPage.navigateMainFrame('about:blank');
  assert.deepEqual(publishedMonitor.failures, [
    'navigation:external',
    'navigation:about-blank'
  ]);
  assert.equal(publishedMonitor.counts.unexpectedNavigations, 2);
  publishedMonitor.dispose();

  const defaultPage = createStubPage();
  const defaultMonitor = attachPrivacySafeBrowserMonitor(defaultPage, {
    baseURL: BASE_URL
  });
  defaultPage.navigateMainFrame(`${BASE_URL}/unexpected-public-page/`);
  assert.deepEqual(defaultMonitor.failures, ['navigation:same-origin']);
  defaultMonitor.dispose();
});

test('attachPrivacySafeBrowserMonitor catches warnings, redacts console text, dismisses dialogs, closes popups, and cleans up on dispose', async () => {
  const page = createStubPage();
  const monitor = attachPrivacySafeBrowserMonitor(page, { baseURL: BASE_URL });

  let dialogDismissed = false;
  let popupClosed = false;

  page.emit('console', {
    type: () => 'warning',
    text: () => '[EasyMDE] secret-warning-token-999 sensitive details',
    location: () => ({ url: `${BASE_URL}/wp-content/plugins/easymde/assets/build/editor.js` })
  });
  page.emit('console', {
    type: () => 'error',
    text: () => '[EasyMDE] secret-token-123 failed with bearer=xyz',
    location: () => ({ url: `${BASE_URL}/wp-content/plugins/easymde/assets/build/editor.js` })
  });
  page.emit('pageerror', Object.assign(new Error('secret-pageerror-payload'), {
    name: 'TypeError'
  }));
  page.emit('pageerror', { name: 'SecretCustomError' });
  page.emit('dialog', {
    type: () => 'confirm',
    dismiss: async () => {
      dialogDismissed = true;
    }
  });
  page.emit('popup', {
    url: () => 'https://evil.example/wp-admin/post.php?secret=1',
    close: async () => {
      popupClosed = true;
    }
  });
  page.navigateMainFrame('https://evil.example/wp-admin/post-new.php');
  page.navigateMainFrame('about:blank');
  page.emit('requestfailed', stubRequest({
    url: `${BASE_URL}/wp-content/plugins/easymde/assets/build/editor.js`,
    method: 'GET',
    resourceType: 'script',
    errorText: 'net::ERR_FAILED'
  }));
  page.emit('response', {
    status: () => 500,
    url: () => `${BASE_URL}/wp-json/easymde/v1/preview`,
    request: () => stubRequest({
      url: `${BASE_URL}/wp-json/easymde/v1/preview`,
      resourceType: 'fetch'
    })
  });

  await Promise.resolve();

  assert.equal(dialogDismissed, true);
  assert.equal(popupClosed, true);
  assert.deepEqual(monitor.failures, [
    'console-warning:plugin-asset',
    'console-error:plugin-asset',
    'pageerror:TypeError',
    'pageerror:Error',
    'dialog:confirm',
    'popup:external',
    'navigation:external',
    'navigation:about-blank',
    'request-failed:failed:plugin-asset:script',
    'http-500:preview-rest:fetch'
  ]);
  assert.deepEqual(monitor.counts, {
    abortedAdminAjax: 0,
    cancelledPreview: 0,
    consoleErrors: 1,
    consoleWarnings: 1,
    dialogs: 1,
    httpErrors: 1,
    pageErrors: 2,
    popups: 1,
    requestFailures: 1,
    unexpectedNavigations: 2
  });

  let thrownError = null;
  try {
    monitor.assertClean();
  } catch (error) {
    thrownError = error;
  }
  assert.ok(thrownError instanceof Error);
  assert.doesNotMatch(thrownError.message, /secret-token-123/u);
  assert.doesNotMatch(thrownError.message, /secret-warning-token-999/u);
  assert.doesNotMatch(thrownError.message, /secret-pageerror-payload/u);
  assert.doesNotMatch(thrownError.message, /SecretCustomError/u);
  assert.doesNotMatch(thrownError.message, /evil\.example/u);
  assert.match(thrownError.message, /consoleWarnings=1/u);
  assert.match(thrownError.message, /dialogs=1/u);
  assert.match(thrownError.message, /popups=1/u);
  assert.match(thrownError.message, /unexpectedNavigations=2/u);
  assert.match(thrownError.message, /console-error:plugin-asset/u);

  monitor.dispose();
  monitor.dispose();
  for (const event of [
    'pageerror',
    'console',
    'dialog',
    'popup',
    'framenavigated',
    'requestfailed',
    'response'
  ]) {
    assert.equal(page.listenerCount(event), 0, `listener leaked for ${event}`);
  }
});

test('attachPrivacySafeBrowserMonitor records dialog dismiss and popup close failures without unhandled rejections', async () => {
  const page = createStubPage();
  const monitor = attachPrivacySafeBrowserMonitor(page, { baseURL: BASE_URL });

  page.emit('dialog', {
    type: () => 'alert',
    dismiss: async () => {
      throw new Error('dismiss-denied');
    }
  });
  page.emit('popup', {
    url: () => 'about:blank',
    close: async () => {
      throw new Error('close-denied');
    }
  });

  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(monitor.failures, [
    'dialog:alert',
    'popup:about-blank',
    'dialog-dismiss-failed:alert',
    'popup-close-failed:about-blank'
  ]);
  monitor.dispose();
});
