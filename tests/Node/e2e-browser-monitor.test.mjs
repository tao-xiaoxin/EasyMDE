import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import {
  attachPrivacySafeBrowserMonitor,
  classifyBrowserUrlCategory,
  classifyReadonlyPostRequest,
  safeBrowserFailureClass
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
  assert.deepEqual(
    classifyReadonlyPostRequest(
      stubRequest({
        url: `${BASE_URL}/wp-admin/admin-ajax.php`,
        headers: { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8' },
        postData: 'action=heartbeat&data%5Bwp-refresh-post-lock%5D%5Bpost_id%5D=42'
      }),
      { baseURL: BASE_URL }
    ),
    { category: 'heartbeat', classification: 'heartbeat-readonly' }
  );
});

test('classifyReadonlyPostRequest rejects conflicting, duplicate, or non-urlencoded admin-ajax actions', () => {
  const unexpectedAdminAjaxCases = [
    {
      label: 'conflicting query heartbeat and POST body save-post',
      request: stubRequest({
        url: `${BASE_URL}/wp-admin/admin-ajax.php?action=heartbeat`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        postData: 'action=save-post'
      })
    },
    {
      label: 'conflicting query get-community-events and POST body save-post',
      request: stubRequest({
        url: `${BASE_URL}/wp-admin/admin-ajax.php?action=get-community-events`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        postData: 'action=save-post'
      })
    },
    {
      label: 'duplicate identical action across query and body',
      request: stubRequest({
        url: `${BASE_URL}/wp-admin/admin-ajax.php?action=heartbeat`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        postData: 'action=heartbeat'
      })
    },
    {
      label: 'duplicate identical action in query',
      request: stubRequest({
        url: `${BASE_URL}/wp-admin/admin-ajax.php?action=heartbeat&action=heartbeat`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        postData: ''
      })
    },
    {
      label: 'duplicate conflicting action in query',
      request: stubRequest({
        url: `${BASE_URL}/wp-admin/admin-ajax.php?action=heartbeat&action=delete`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        postData: ''
      })
    },
    {
      label: 'duplicate identical action in body',
      request: stubRequest({
        url: `${BASE_URL}/wp-admin/admin-ajax.php`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        postData: 'action=heartbeat&action=heartbeat'
      })
    },
    {
      label: 'duplicate conflicting action in body',
      request: stubRequest({
        url: `${BASE_URL}/wp-admin/admin-ajax.php`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        postData: 'action=heartbeat&action=delete'
      })
    },
    {
      label: 'duplicate identical get-community-events in body',
      request: stubRequest({
        url: `${BASE_URL}/wp-admin/admin-ajax.php`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        postData: 'action=get-community-events&action=get-community-events'
      })
    },
    {
      label: 'ambiguous leading-space PHP action key in body',
      request: stubRequest({
        url: `${BASE_URL}/wp-admin/admin-ajax.php?action=heartbeat`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        postData: '%20action=save-post'
      })
    },
    {
      label: 'ambiguous array action key in body',
      request: stubRequest({
        url: `${BASE_URL}/wp-admin/admin-ajax.php?action=heartbeat`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        postData: 'action%5B%5D=save-post'
      })
    },
    {
      label: 'multipart/form-data POST with query heartbeat and body save-post',
      request: stubRequest({
        url: `${BASE_URL}/wp-admin/admin-ajax.php?action=heartbeat`,
        headers: { 'content-type': 'multipart/form-data; boundary=----easymde' },
        postData: '------easymde\r\nContent-Disposition: form-data; name="action"\r\n\r\nsave-post\r\n------easymde--'
      })
    },
    {
      label: 'multipart/form-data POST with boundary spoofing urlencoded media type',
      request: stubRequest({
        url: `${BASE_URL}/wp-admin/admin-ajax.php?action=get-community-events`,
        headers: { 'content-type': 'multipart/form-data; boundary=application/x-www-form-urlencoded' },
        postData: '--application/x-www-form-urlencoded\r\nContent-Disposition: form-data; name="action"\r\n\r\nsave-post'
      })
    },
    {
      label: 'application/json POST with query heartbeat',
      request: stubRequest({
        url: `${BASE_URL}/wp-admin/admin-ajax.php?action=heartbeat`,
        headers: { 'content-type': 'application/json' },
        postData: '{"action":"save-post"}'
      })
    },
    {
      label: 'text/plain POST with query heartbeat',
      request: stubRequest({
        url: `${BASE_URL}/wp-admin/admin-ajax.php?action=heartbeat`,
        headers: { 'content-type': 'text/plain' },
        postData: 'action=save-post'
      })
    },
    {
      label: 'missing content-type with POST body',
      request: stubRequest({
        url: `${BASE_URL}/wp-admin/admin-ajax.php?action=heartbeat`,
        headers: {},
        postData: 'action=save-post'
      })
    },
    {
      label: 'ambiguous urlencoded body without key-value pairs',
      request: stubRequest({
        url: `${BASE_URL}/wp-admin/admin-ajax.php?action=heartbeat`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        postData: 'raw-unparsed-body'
      })
    },
    {
      label: 'duplicate data parameters hiding wp_autosave in heartbeat body',
      request: stubRequest({
        url: `${BASE_URL}/wp-admin/admin-ajax.php`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        postData: 'action=heartbeat&data=%7B%22rest_nonce%22%3A%22ok%22%7D&data=%7B%22wp_autosave%22%3A%7B%7D%7D'
      })
    },
    {
      label: 'unreadable binary POST body with urlencoded header and query heartbeat',
      request: {
        ...stubRequest({
          url: `${BASE_URL}/wp-admin/admin-ajax.php?action=heartbeat`,
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          postData: null
        }),
        postDataBuffer: () => Buffer.from([0xff, 0xfe])
      }
    }
  ];

  for (const { label, request } of unexpectedAdminAjaxCases) {
    assert.deepEqual(
      classifyReadonlyPostRequest(request, { baseURL: BASE_URL }),
      { category: 'other-admin-ajax', classification: 'unexpected-write' },
      label
    );
  }
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
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    postData: 'action=heartbeat',
    resourceType: 'xhr',
    errorText: 'net::ERR_ABORTED'
  }));
  page.emit('response', {
    status: () => 200,
    url: () => 'https://external.example/ok-asset.png',
    request: () => stubRequest({
      url: 'https://external.example/ok-asset.png',
      method: 'GET',
      resourceType: 'image'
    })
  });

  monitor.assertClean();
  assert.equal(monitor.counts.cancelledPreview, 1);
  assert.equal(monitor.counts.abortedAdminAjax, 1);
  assert.equal(monitor.counts.unexpectedNavigations, 0);
  assert.deepEqual(monitor.snapshot(), {
    counts: {
      abortedAdminAjax: 1,
      cancelledPreview: 1,
      consoleErrors: 0,
      consoleWarnings: 0,
      dialogs: 0,
      httpErrors: 0,
      pageErrors: 0,
      popups: 0,
      requestFailures: 0,
      unexpectedNavigations: 0
    },
    failures: [],
    httpErrors: [],
    requestFailures: []
  });
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

test('attachPrivacySafeBrowserMonitor fails closed when baseURL is invalid', () => {
  assert.equal(
    classifyBrowserUrlCategory('https://evil.example/wp-admin/post-new.php', {
      baseOrigin: null,
      basePath: '',
      invalidBase: true
    }),
    'external'
  );
  assert.equal(
    classifyBrowserUrlCategory('https://evil.example/wp-json/easymde/v1/preview', {
      baseOrigin: null,
      basePath: '',
      invalidBase: true
    }),
    'external'
  );
  assert.deepEqual(
    classifyReadonlyPostRequest(
      stubRequest({
        url: 'https://evil.example/wp-json/easymde/v1/preview',
        postData: '{"markdown":"alpha"}'
      }),
      { invalidBase: true }
    ),
    { category: 'external-post', classification: 'unexpected-write' }
  );

  const page = createStubPage();
  const monitor = attachPrivacySafeBrowserMonitor(page, {
    baseURL: 'not-a-valid-base'
  });

  page.navigateMainFrame('https://evil.example/wp-admin/post-new.php');
  page.emit('requestfailed', stubRequest({
    url: 'https://evil.example/wp-json/easymde/v1/preview',
    method: 'POST',
    resourceType: 'fetch',
    errorText: 'net::ERR_ABORTED'
  }));
  page.emit('response', {
    status: () => 500,
    url: () => 'https://evil.example/wp-json/easymde/v1/preview',
    request: () => stubRequest({
      url: 'https://evil.example/wp-json/easymde/v1/preview',
      method: 'POST',
      resourceType: 'fetch'
    })
  });
  page.emit('console', {
    type: () => 'error',
    text: () => 'sensitive-console-secret',
    location: () => ({ url: 'https://evil.example/wp-json/easymde/v1/preview' })
  });

  const snap = monitor.snapshot();
  assert.equal(snap.counts.unexpectedNavigations, 1);
  assert.equal(snap.counts.cancelledPreview, 0);
  assert.equal(snap.counts.requestFailures, 1);
  assert.equal(snap.counts.httpErrors, 1);
  assert.equal(snap.counts.consoleErrors, 1);
  assert.deepEqual(snap.requestFailures, [
    { category: 'external', resourceType: 'fetch', failureClass: 'aborted' }
  ]);
  assert.deepEqual(snap.httpErrors, [
    { category: 'external', resourceType: 'fetch', status: 500 }
  ]);
  assert.deepEqual(snap.failures, [
    'navigation:external',
    'request-failed:aborted:external:fetch',
    'http-500:external:fetch',
    'console-error:external'
  ]);
  assert.doesNotMatch(JSON.stringify(snap), /evil\.example|wp-admin|wp-json|sensitive-console-secret/u);

  assert.throws(
    () => monitor.assertClean(),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /navigation:external/u);
      assert.match(error.message, /request-failed:aborted:external:fetch/u);
      assert.match(error.message, /http-500:external:fetch/u);
      assert.doesNotMatch(error.message, /evil\.example|wp-admin|preview-rest/u);
      return true;
    }
  );
  monitor.dispose();
});

test('attachPrivacySafeBrowserMonitor records cross-origin requestfailed and HTTP 4xx/5xx responses in snapshot and fails assertClean', () => {
  const page = createStubPage();
  const monitor = attachPrivacySafeBrowserMonitor(page, { baseURL: BASE_URL });

  page.emit('requestfailed', stubRequest({
    url: 'https://external.example/img.png?token=secret-query',
    method: 'GET',
    resourceType: 'image',
    errorText: 'net::ERR_NAME_NOT_RESOLVED'
  }));
  page.emit('response', {
    status: () => 503,
    url: () => 'https://external.example/upload/endpoint?auth=secret-token',
    request: () => stubRequest({
      url: 'https://external.example/upload/endpoint?auth=secret-token',
      method: 'POST',
      resourceType: 'fetch'
    })
  });

  const snap = monitor.snapshot();
  assert.equal(snap.counts.requestFailures, 1);
  assert.equal(snap.counts.httpErrors, 1);
  assert.deepEqual(snap.requestFailures, [
    { category: 'external', resourceType: 'image', failureClass: 'dns' }
  ]);
  assert.deepEqual(snap.httpErrors, [
    { category: 'external', resourceType: 'fetch', status: 503 }
  ]);
  assert.deepEqual(snap.failures, [
    'request-failed:dns:external:image',
    'http-503:external:fetch'
  ]);
  assert.doesNotMatch(
    JSON.stringify(snap),
    /external\.example|img\.png|secret-query|upload|secret-token/u
  );

  // Mutating the snapshot copy must not alter internal monitor state.
  snap.failures.push('mutated');
  snap.requestFailures[0].category = 'mutated';
  snap.httpErrors[0].status = 999;
  assert.deepEqual(monitor.snapshot().requestFailures, [
    { category: 'external', resourceType: 'image', failureClass: 'dns' }
  ]);
  assert.deepEqual(monitor.snapshot().httpErrors, [
    { category: 'external', resourceType: 'fetch', status: 503 }
  ]);

  assert.throws(
    () => monitor.assertClean(),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /requestFailures=1/u);
      assert.match(error.message, /httpErrors=1/u);
      assert.match(error.message, /request-failed:dns:external:image/u);
      assert.match(error.message, /http-503:external:fetch/u);
      assert.doesNotMatch(
        error.message,
        /external\.example|img\.png|secret-query|upload|secret-token/u
      );
      return true;
    }
  );
  monitor.dispose();
});

test('attachPrivacySafeBrowserMonitor supports narrow opt-in allowExpectedFailure for external failures only', () => {
  const seenEntries = [];
  const page = createStubPage();
  const monitor = attachPrivacySafeBrowserMonitor(page, {
    baseURL: BASE_URL,
    allowExpectedFailure(entry) {
      seenEntries.push(entry);
      return (
        'requestfailed' === entry.type
        && 'external' === entry.category
        && 'image' === entry.resourceType
        && 'dns' === entry.failureClass
      ) || (
        'response' === entry.type
        && 'external' === entry.category
        && 'image' === entry.resourceType
        && 503 === entry.status
      );
    }
  });

  page.emit('requestfailed', stubRequest({
    url: 'https://external.example/expected-missing.png?k=v',
    method: 'GET',
    resourceType: 'image',
    errorText: 'net::ERR_NAME_NOT_RESOLVED'
  }));
  page.emit('response', {
    status: () => 503,
    url: () => 'https://external.example/expected-unavailable.png?k=v',
    request: () => stubRequest({
      url: 'https://external.example/expected-unavailable.png?k=v',
      method: 'GET',
      resourceType: 'image'
    })
  });
  monitor.assertClean();
  assert.deepEqual(seenEntries, [
    { type: 'requestfailed', category: 'external', resourceType: 'image', failureClass: 'dns' },
    { type: 'response', category: 'external', resourceType: 'image', status: 503 }
  ]);

  // Unmatched external failure and same-origin failures must still fail.
  page.emit('response', {
    status: () => 503,
    url: () => 'https://external.example/unexpected-api',
    request: () => stubRequest({
      url: 'https://external.example/unexpected-api',
      method: 'GET',
      resourceType: 'fetch'
    })
  });
  assert.deepEqual(monitor.snapshot().httpErrors, [
    { category: 'external', resourceType: 'fetch', status: 503 }
  ]);
  assert.throws(() => monitor.assertClean());
  monitor.dispose();

  // allowExpectedFailure cannot silence same-origin failures and fails closed on thrown errors.
  const sameOriginPage = createStubPage();
  const permissiveMonitor = attachPrivacySafeBrowserMonitor(sameOriginPage, {
    baseURL: BASE_URL,
    allowExpectedFailure: () => true
  });
  sameOriginPage.emit('response', {
    status: () => 503,
    url: () => `${BASE_URL}/wp-json/easymde/v1/preview`,
    request: () => stubRequest({
      url: `${BASE_URL}/wp-json/easymde/v1/preview`,
      method: 'POST',
      resourceType: 'fetch'
    })
  });
  assert.deepEqual(permissiveMonitor.snapshot().httpErrors, [
    { category: 'preview-rest', resourceType: 'fetch', status: 503 }
  ]);
  assert.throws(() => permissiveMonitor.assertClean());
  permissiveMonitor.dispose();

  const throwingPage = createStubPage();
  const throwingMonitor = attachPrivacySafeBrowserMonitor(throwingPage, {
    baseURL: BASE_URL,
    allowExpectedFailure() {
      throw new Error('predicate-error');
    }
  });
  throwingPage.emit('requestfailed', stubRequest({
    url: 'https://external.example/img.png',
    method: 'GET',
    resourceType: 'image',
    errorText: 'net::ERR_NAME_NOT_RESOLVED'
  }));
  assert.deepEqual(throwingMonitor.snapshot().requestFailures, [
    { category: 'external', resourceType: 'image', failureClass: 'dns' }
  ]);
  assert.throws(() => throwingMonitor.assertClean());
  throwingMonitor.dispose();
});

test('attachPrivacySafeBrowserMonitor ignores allowExpectedFailure when baseURL is invalid', () => {
  let predicateCalls = 0;
  const page = createStubPage();
  const monitor = attachPrivacySafeBrowserMonitor(page, {
    baseURL: 'not-a-valid-base',
    allowExpectedFailure() {
      predicateCalls += 1;
      return true;
    }
  });

  page.emit('requestfailed', stubRequest({
    url: `${BASE_URL}/wp-content/plugins/easymde/assets/build/editor.js`,
    method: 'GET',
    resourceType: 'script',
    errorText: 'net::ERR_FAILED'
  }));
  page.emit('response', {
    status: () => 503,
    url: () => `${BASE_URL}/wp-json/easymde/v1/preview`,
    request: () => stubRequest({
      url: `${BASE_URL}/wp-json/easymde/v1/preview`,
      method: 'POST',
      resourceType: 'fetch'
    })
  });

  const snap = monitor.snapshot();
  assert.equal(predicateCalls, 0);
  assert.equal(snap.counts.requestFailures, 1);
  assert.equal(snap.counts.httpErrors, 1);
  assert.deepEqual(snap.requestFailures, [
    { category: 'external', resourceType: 'script', failureClass: 'failed' }
  ]);
  assert.deepEqual(snap.httpErrors, [
    { category: 'external', resourceType: 'fetch', status: 503 }
  ]);
  assert.deepEqual(snap.failures, [
    'request-failed:failed:external:script',
    'http-503:external:fetch'
  ]);
  assert.throws(
    () => monitor.assertClean(),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /request-failed:failed:external:script/u);
      assert.match(error.message, /http-503:external:fetch/u);
      return true;
    }
  );
  monitor.dispose();
});

test('classifyReadonlyPostRequest rejects NUL-truncated and control-character admin-ajax keys in query and body', () => {
  const controlCharCases = [
    {
      label: 'NUL-suffixed duplicate action in POST body',
      request: stubRequest({
        url: `${BASE_URL}/wp-admin/admin-ajax.php`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        postData: 'action=heartbeat&action%00x=autosave'
      })
    },
    {
      label: 'NUL-suffixed action in query with readonly heartbeat POST body',
      request: stubRequest({
        url: `${BASE_URL}/wp-admin/admin-ajax.php?action%00x=autosave`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        postData: 'action=heartbeat'
      })
    },
    {
      label: 'NUL-suffixed action alongside get-community-events in POST body',
      request: stubRequest({
        url: `${BASE_URL}/wp-admin/admin-ajax.php`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        postData: 'action=get-community-events&action%00x=autosave'
      })
    },
    {
      label: 'NUL-suffixed data bracket key carrying wp_autosave',
      request: stubRequest({
        url: `${BASE_URL}/wp-admin/admin-ajax.php`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        postData: 'action=heartbeat&data%00x[wp_autosave][post_id]=42'
      })
    },
    {
      label: 'NUL-suffixed scalar data key carrying JSON wp_autosave',
      request: stubRequest({
        url: `${BASE_URL}/wp-admin/admin-ajax.php`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        postData: 'action=heartbeat&data%00x=%7B%22wp_autosave%22%3A%7B%7D%7D'
      })
    },
    {
      label: 'trailing NUL after known heartbeat data bracket key',
      request: stubRequest({
        url: `${BASE_URL}/wp-admin/admin-ajax.php`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        postData: 'action=heartbeat&data%5Bwp-auth-check%5D%00=1'
      })
    },
    {
      label: 'ASCII BEL control character in body parameter key',
      request: stubRequest({
        url: `${BASE_URL}/wp-admin/admin-ajax.php`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        postData: 'action=heartbeat&foo%07bar=1'
      })
    },
    {
      label: 'ASCII control character in query parameter key',
      request: stubRequest({
        url: `${BASE_URL}/wp-admin/admin-ajax.php?foo%1fbar=1`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        postData: 'action=heartbeat'
      })
    },
    {
      label: 'ASCII DEL control character in body parameter key',
      request: stubRequest({
        url: `${BASE_URL}/wp-admin/admin-ajax.php`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        postData: 'action=heartbeat&foo%7fbar=1'
      })
    },
    {
      label: 'ASCII tab control character prefixing action key',
      request: stubRequest({
        url: `${BASE_URL}/wp-admin/admin-ajax.php`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        postData: 'action=heartbeat&%09action=autosave'
      })
    }
  ];

  for (const { label, request } of controlCharCases) {
    assert.deepEqual(
      classifyReadonlyPostRequest(request, { baseURL: BASE_URL }),
      { category: 'other-admin-ajax', classification: 'unexpected-write' },
      label
    );
  }

  // Legitimate readonly heartbeat with normal control-free keys remains accepted.
  assert.deepEqual(
    classifyReadonlyPostRequest(
      stubRequest({
        url: `${BASE_URL}/wp-admin/admin-ajax.php`,
        headers: { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8' },
        postData: 'interval=60&_nonce=abc123&action=heartbeat&screen_id=post&has_focus=true&data%5Bwp-auth-check%5D=1'
      }),
      { baseURL: BASE_URL }
    ),
    { category: 'heartbeat', classification: 'heartbeat-readonly' }
  );
});

test('safeBrowserFailureClass classifies Chromium ERR_ABORTED and Firefox NS_BINDING_ABORTED as aborted', () => {
  assert.equal(safeBrowserFailureClass('net::ERR_ABORTED'), 'aborted');
  assert.equal(safeBrowserFailureClass('ERR_ABORTED'), 'aborted');
  assert.equal(safeBrowserFailureClass('NS_BINDING_ABORTED'), 'aborted');
  assert.equal(safeBrowserFailureClass('secret NS_BINDING_ABORTED'), 'other');
});

test('attachPrivacySafeBrowserMonitor only exempts positively-identified readonly aborted admin-ajax requests', () => {
  const readonlyPage = createStubPage();
  const readonlyMonitor = attachPrivacySafeBrowserMonitor(readonlyPage, { baseURL: BASE_URL });

  readonlyPage.emit('requestfailed', stubRequest({
    url: `${BASE_URL}/wp-admin/admin-ajax.php`,
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8' },
    postData: 'action=heartbeat&data%5Bwp-refresh-post-lock%5D%5Bpost_id%5D=42',
    resourceType: 'xhr',
    errorText: 'net::ERR_ABORTED'
  }));
  readonlyPage.emit('requestfailed', stubRequest({
    url: `${BASE_URL}/wp-admin/admin-ajax.php`,
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    postData: 'action=heartbeat',
    resourceType: 'fetch',
    errorText: 'NS_BINDING_ABORTED'
  }));
  readonlyPage.emit('requestfailed', stubRequest({
    url: `${BASE_URL}/wp-admin/admin-ajax.php`,
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    postData: 'action=get-community-events',
    resourceType: 'xhr',
    errorText: 'net::ERR_ABORTED'
  }));
  readonlyPage.emit('requestfailed', stubRequest({
    url: `${BASE_URL}/wp-admin/admin-ajax.php?action=dashboard-widgets&widget=dashboard_primary&pagenow=dashboard`,
    method: 'GET',
    headers: {},
    postData: '',
    resourceType: 'xhr',
    errorText: 'net::ERR_ABORTED'
  }));
  readonlyPage.emit('requestfailed', stubRequest({
    url: `${BASE_URL}/wp-admin/admin-ajax.php?action=rest-nonce`,
    method: 'GET',
    headers: {},
    postData: '',
    resourceType: 'fetch',
    errorText: 'NS_BINDING_ABORTED'
  }));

  readonlyMonitor.assertClean();
  assert.equal(readonlyMonitor.counts.abortedAdminAjax, 5);
  assert.equal(readonlyMonitor.counts.requestFailures, 0);
  readonlyMonitor.dispose();

  const rejectedAbortedAdminAjaxCases = [
    {
      label: 'aborted (ERR_ABORTED) heartbeat autosave POST',
      request: stubRequest({
        url: `${BASE_URL}/wp-admin/admin-ajax.php`,
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8' },
        postData: 'action=heartbeat&data%5Bwp_autosave%5D%5Bpost_id%5D=42&data%5Bwp_autosave%5D%5Bcontent%5D=secret-draft-body',
        resourceType: 'xhr',
        errorText: 'net::ERR_ABORTED'
      }),
      expectedCode: 'request-failed:aborted:admin-ajax:xhr',
      expectedResourceType: 'xhr'
    },
    {
      label: 'aborted (NS_BINDING_ABORTED) heartbeat autosave POST',
      request: stubRequest({
        url: `${BASE_URL}/wp-admin/admin-ajax.php`,
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        postData: 'action=heartbeat&data%5Bwp_autosave%5D%5Bpost_id%5D=42',
        resourceType: 'xhr',
        errorText: 'NS_BINDING_ABORTED'
      }),
      expectedCode: 'request-failed:aborted:admin-ajax:xhr',
      expectedResourceType: 'xhr'
    },
    {
      label: 'aborted unclassified edit-post admin-ajax POST',
      request: stubRequest({
        url: `${BASE_URL}/wp-admin/admin-ajax.php`,
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        postData: 'action=edit-post&post_id=42',
        resourceType: 'fetch',
        errorText: 'net::ERR_ABORTED'
      }),
      expectedCode: 'request-failed:aborted:admin-ajax:fetch',
      expectedResourceType: 'fetch'
    },
    {
      label: 'aborted admin-ajax POST missing action',
      request: stubRequest({
        url: `${BASE_URL}/wp-admin/admin-ajax.php`,
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        postData: '',
        resourceType: 'xhr',
        errorText: 'net::ERR_ABORTED'
      }),
      expectedCode: 'request-failed:aborted:admin-ajax:xhr',
      expectedResourceType: 'xhr'
    },
    {
      label: 'aborted multipart admin-ajax POST',
      request: stubRequest({
        url: `${BASE_URL}/wp-admin/admin-ajax.php?action=heartbeat`,
        method: 'POST',
        headers: { 'content-type': 'multipart/form-data; boundary=----easymde' },
        postData: '------easymde\r\nContent-Disposition: form-data; name="action"\r\n\r\nsave-post\r\n------easymde--',
        resourceType: 'fetch',
        errorText: 'net::ERR_ABORTED'
      }),
      expectedCode: 'request-failed:aborted:admin-ajax:fetch',
      expectedResourceType: 'fetch'
    },
    {
      label: 'aborted NUL-spoofed admin-ajax POST',
      request: stubRequest({
        url: `${BASE_URL}/wp-admin/admin-ajax.php`,
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        postData: 'action=heartbeat&action%00x=autosave',
        resourceType: 'xhr',
        errorText: 'net::ERR_ABORTED'
      }),
      expectedCode: 'request-failed:aborted:admin-ajax:xhr',
      expectedResourceType: 'xhr'
    },
    {
      label: 'aborted unclassified GET admin-ajax action',
      request: stubRequest({
        url: `${BASE_URL}/wp-admin/admin-ajax.php?action=wp-remove-post-lock`,
        method: 'GET',
        headers: {},
        postData: '',
        resourceType: 'xhr',
        errorText: 'net::ERR_ABORTED'
      }),
      expectedCode: 'request-failed:aborted:admin-ajax:xhr',
      expectedResourceType: 'xhr'
    },
    {
      label: 'aborted GET admin-ajax with NUL-spoofed action key',
      request: stubRequest({
        url: `${BASE_URL}/wp-admin/admin-ajax.php?action=dashboard-widgets&action%00x=delete`,
        method: 'GET',
        headers: {},
        postData: '',
        resourceType: 'xhr',
        errorText: 'net::ERR_ABORTED'
      }),
      expectedCode: 'request-failed:aborted:admin-ajax:xhr',
      expectedResourceType: 'xhr'
    }
  ];

  for (const { label, request, expectedCode, expectedResourceType } of rejectedAbortedAdminAjaxCases) {
    const page = createStubPage();
    const monitor = attachPrivacySafeBrowserMonitor(page, { baseURL: BASE_URL });

    page.emit('requestfailed', request);

    const snap = monitor.snapshot();
    assert.equal(snap.counts.abortedAdminAjax, 0, label);
    assert.equal(snap.counts.requestFailures, 1, label);
    assert.deepEqual(
      snap.requestFailures,
      [{ category: 'admin-ajax', resourceType: expectedResourceType, failureClass: 'aborted' }],
      label
    );
    assert.deepEqual(snap.failures, [expectedCode], label);
    assert.doesNotMatch(
      JSON.stringify(snap),
      /secret-draft-body|wp_autosave|edit-post|save-post|wp-remove-post-lock/u,
      label
    );
    assert.throws(
      () => monitor.assertClean(),
      (error) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, new RegExp(expectedCode, 'u'));
        assert.doesNotMatch(error.message, /secret-draft-body|wp_autosave|edit-post|save-post/u);
        return true;
      },
      label
    );
    monitor.dispose();
  }
});
