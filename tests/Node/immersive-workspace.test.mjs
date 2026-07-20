import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

function loadWorkspaceModule() {
  const source = readFileSync(join(repoRoot, 'assets/js/admin/immersive-workspace.js'), 'utf8');
  const window = {};

  vm.runInNewContext(source, {
    window,
    document: {},
    console,
    URL,
    setTimeout,
    clearTimeout
  });

  return window.EasyMDEImmersiveWorkspace;
}

test('immersive workspace exposes isolated controller and pure document helpers', () => {
  const workspace = loadWorkspaceModule();

  assert.equal(typeof workspace.createController, 'function');
  assert.equal(typeof workspace.parseOutline, 'function');
  assert.equal(typeof workspace.calculateStats, 'function');
  assert.equal(typeof workspace.normalizeTitle, 'function');
  assert.equal(typeof workspace.createPublishDraft, 'function');
  assert.equal(typeof workspace.createPublishCategoryTree, 'function');
  assert.equal(typeof workspace.updatePublishCategorySelection, 'function');
  assert.equal(typeof workspace.findFirstLocalImageCandidate, 'function');
  assert.equal(typeof workspace.getOutlineIconName, 'function');
  assert.equal(typeof workspace.calculateSourceRatioFromPointer, 'function');
  assert.equal(typeof workspace.clampOutlineWidth, 'function');
  assert.equal(typeof workspace.createTableMarkdown, 'function');
  assert.equal(typeof workspace.normalizeTableDimensions, 'function');
  assert.equal(typeof workspace.hasUnsavedWorkspaceChanges, 'function');
  assert.equal(typeof workspace.filterImmersiveHeadingCommands, 'function');
});

test('immersive heading commands whitelist H1-H6 without changing the shared registry', () => {
  const workspace = loadWorkspaceModule();
  const commands = [
    { id: 'paragraph' },
    { id: 'heading1' },
    { id: 'heading2' },
    { id: 'extension-heading' },
    { id: 'heading3' },
    { id: 'heading4' },
    { id: 'heading5' },
    { id: 'heading6' }
  ];

  assert.deepEqual(
    JSON.parse(JSON.stringify(workspace.filterImmersiveHeadingCommands(commands))).map((command) => command.id),
    ['heading1', 'heading2', 'heading3', 'heading4', 'heading5', 'heading6']
  );
  assert.deepEqual(commands.map((command) => command.id), [
    'paragraph',
    'heading1',
    'heading2',
    'extension-heading',
    'heading3',
    'heading4',
    'heading5',
    'heading6'
  ]);
});

test('publish category selection preserves hidden descendants while updating one checkbox', () => {
  const workspace = loadWorkspaceModule();
  const source = readFileSync(join(repoRoot, 'assets/js/admin/immersive-workspace.js'), 'utf8');

  assert.deepEqual(
    JSON.parse(JSON.stringify(workspace.updatePublishCategorySelection(['12', '20'], '11', true))),
    ['12', '20', '11']
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(workspace.updatePublishCategorySelection(['12', '20'], '20', false))),
    ['12']
  );
  assert.match(source, /selectedCategories = publishDraft \? publishDraft\.categories\.length : 0/);
  assert.doesNotMatch(source, /querySelectorAll\('\[data-publish-category\]:checked'\)\.length/);
});

test('revision navigation asks the adapter for dirty state against the saved document baseline', () => {
  const source = readFileSync(join(repoRoot, 'assets/js/admin/immersive-workspace.js'), 'utf8');
  const bootstrap = readFileSync(join(repoRoot, 'assets/js/admin/bootstrap.js'), 'utf8');

  assert.match(source, /typeof adapter\.hasUnsavedChanges === 'function'/);
  assert.match(source, /adapter\.hasUnsavedChanges\(navigationState\)/);
  assert.match(bootstrap, /initialMarkdown:\s*context\.savedMarkdown/);
  assert.match(
    bootstrap,
    /initialTitle:\s*titleSnapshot \? titleSnapshot\.savedValue : context\.savedTitle/
  );
  assert.match(bootstrap, /savedMarkdown:\s*String\(\$source\[0\]\.defaultValue \|\| ''\)/);
  assert.match(bootstrap, /savedTitle:\s*String\(\(titleField \|\| \{\}\)\.defaultValue \|\| ''\)/);
});

test('immersive workspace reports deactivation only after its active state is cleared', () => {
  const source = readFileSync(join(repoRoot, 'assets/js/admin/immersive-workspace.js'), 'utf8');
  const deactivateStart = source.indexOf('        function deactivate() {');
  const deactivateEnd = source.indexOf('\n        return {', deactivateStart);
  const deactivateSource = source.slice(deactivateStart, deactivateEnd);
  const stateClearedAt = deactivateSource.indexOf('            root = null;');
  const activeClassesClearedAt = deactivateSource.indexOf("            doc.documentElement.classList.remove(ACTIVE_CLASS);");
  const callbackAt = deactivateSource.indexOf("            if (typeof adapter.onDeactivate === 'function') {");

  assert.ok(deactivateStart >= 0, 'deactivate implementation should exist');
  assert.ok(stateClearedAt >= 0, 'deactivate should clear the controller root');
  assert.ok(activeClassesClearedAt >= 0, 'deactivate should clear the document active class');
  assert.ok(callbackAt > stateClearedAt, 'onDeactivate must observe isActive() as false');
  assert.ok(callbackAt > activeClassesClearedAt, 'onDeactivate must observe inactive document classes');
});

test('immersive view transitions restore source selection before scroll offsets', () => {
  const source = readFileSync(join(repoRoot, 'assets/js/admin/immersive-workspace.js'), 'utf8');
  const captureStart = source.indexOf('        function captureSourceViewState() {');
  const restoreStart = source.indexOf('        function restoreSourceViewState() {');
  const scheduleStart = source.indexOf('        function scheduleSourceViewRestore(mode) {');
  const setViewStart = source.indexOf('        function setView(mode) {');
  const setViewEnd = source.indexOf('\n        function setSourceRatio', setViewStart);
  const restoreSource = source.slice(restoreStart, scheduleStart);
  const setViewSource = source.slice(setViewStart, setViewEnd);

  assert.ok(captureStart >= 0, 'source view capture should exist');
  assert.ok(restoreStart > captureStart, 'source view restore should follow capture');
  assert.ok(scheduleStart > restoreStart, 'source view restore should be scheduled after layout');
  assert.ok(setViewStart > scheduleStart, 'view switching should use the source state helpers');
  assert.match(
    restoreSource,
    /restoreSourceSelection\(sourceViewState, false\)/,
    'view restoration must reuse selection restoration, which applies bounds before scroll offsets'
  );
  assert.match(setViewSource, /viewMode !== 'preview' && sourceViewRestoreFrame === null[\s\S]*captureSourceViewState\(\)/);
  assert.match(setViewSource, /mode !== 'preview'[\s\S]*scheduleSourceViewRestore\(mode\)/);
  assert.match(source, /function deactivate\(\)[\s\S]*cancelDocumentDerivedState\(\);\s*cancelSourceViewRestore\(\);/);
});

test('immersive commands preserve selection direction across toolbar and shortcut paths', () => {
  const source = readFileSync(join(repoRoot, 'assets/js/admin/immersive-workspace.js'), 'utf8');
  const commitStart = source.indexOf('        function commitExecutedSourceChange(before, rollbackSelection) {');
  const commandStart = source.indexOf('        function executeSourceCommand(commandId, selection) {');
  const commandEnd = source.indexOf('\n        function updateTitleHeight', commandStart);
  const commitEnd = source.indexOf('\n        function sourceCommandUnavailable', commitStart);
  const commandSource = source.slice(commandStart, commandEnd);
  const commitSource = source.slice(commitStart, commitEnd);

  assert.ok(commitStart >= 0, 'executed source changes should have a shared commit path');
  assert.ok(commandStart >= 0, 'toolbar and shortcut commands should share the source command path');
  assert.match(commitSource, /source\.setSelectionRange\(\s*source\.selectionStart,\s*source\.selectionEnd,\s*rollbackSelection\.direction \|\| 'none'/);
  assert.match(commandSource, /commandSelection = selection \|\| sourceSelection \|\| captureSourceSelection\(\)/);
  assert.match(commandSource, /commitExecutedSourceChange\(before, commandSelection\)/);
  assert.match(source, /executeSourceCommand\(commandId, sourceSelection\)/);
  assert.match(source, /adapter\.handleShortcut\(event, source, function \(commandId\) \{\s*executeSourceCommand\(commandId, captureSourceSelection\(\)\);/);
});

test('publish categories build a stable tree from real WordPress parent ids', () => {
  const workspace = loadWorkspaceModule();
  const tree = workspace.createPublishCategoryTree([
    { id: '11', label: 'Parent', parentId: '', hasChildren: true },
    { id: '12', label: 'Child', parentId: '11', hasChildren: false },
    { id: '13', label: 'Second root', parentId: '', hasChildren: false }
  ]);

  assert.deepEqual(JSON.parse(JSON.stringify(tree)), [
    {
      id: '11',
      label: 'Parent',
      parentId: '',
      hasChildren: true,
      children: [
        {
          id: '12',
          label: 'Child',
          parentId: '11',
          hasChildren: false,
          children: []
        }
      ]
    },
    {
      id: '13',
      label: 'Second root',
      parentId: '',
      hasChildren: false,
      children: []
    }
  ]);
});

test('immersive workspace keeps the reference shell geometry instead of rounded approximations', () => {
  const css = readFileSync(join(repoRoot, 'assets/css/admin/immersive-workspace.css'), 'utf8');
  const source = readFileSync(join(repoRoot, 'assets/js/admin/immersive-workspace.js'), 'utf8');

  assert.match(css, /gap:\s*11\.25px;/);
  assert.match(css, /__header[^}]*min-height:\s*60px;/s);
  assert.match(css, /__header[^}]*padding:\s*9\.375px 22\.5px;/s);
  assert.match(css, /__toolbar[^}]*height:\s*52\.5px;/s);
  assert.match(css, /__toolbar[^}]*padding:\s*0 18\.75px;/s);
  assert.match(css, /__toolbar\[hidden\][^}]*display:\s*none;/s);
  assert.match(css, /height:\s*33\.75px;/);
  assert.match(css, /border-radius:\s*15px;/);
  assert.match(css, /--easymde-immersive-outline-width:\s*240px;/);
  assert.match(css, /grid-template-columns:[^;]*var\(--easymde-immersive-outline-width\)[^;]*14px/);
  assert.match(css, /var\(--easymde-immersive-outline-width\) 14px minmax\(360px, calc\(\(100% - var\(--easymde-immersive-outline-width\) - 28px\) \* var\(--easymde-immersive-source-ratio\)\)\) 14px minmax\(360px, 1fr\)/);
  assert.match(css, /var\(--easymde-immersive-outline-width\) 14px minmax\(0, calc\(\(100% - var\(--easymde-immersive-outline-width\) - 28px\) \* var\(--easymde-immersive-source-ratio\)\)\) 14px minmax\(0, 1fr\)/);
  assert.match(css, /45px minmax\(0, calc\(\(100% - 59px\) \* var\(--easymde-immersive-source-ratio\)\)\) 14px minmax\(0, 1fr\)/);
  assert.match(css, /__main\[data-view="edit"\],[\s\S]*__main\[data-view="preview"\]\s*\{[^}]*grid-template-columns:\s*var\(--easymde-immersive-outline-width\) 14px minmax\(0, 1fr\);/s);
  assert.match(css, /is-outline-hidden[^}]*__main\[data-view="edit"\],[\s\S]*is-outline-hidden[^}]*__main\[data-view="preview"\]\s*\{[^}]*grid-template-columns:\s*45px minmax\(0, 1fr\);/s);
  assert.match(css, /is-outline-disabled[^}]*__main\[data-view="edit"\],[\s\S]*is-outline-disabled[^}]*__main\[data-view="preview"\]\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/s);
  assert.match(css, /is-outline-hidden[^}]*__main\[data-view="edit"\][^}]*__outline-handle,[\s\S]*is-outline-hidden[^}]*__main\[data-view="preview"\][^}]*__outline-handle\s*\{[^}]*display:\s*flex;/s);
  assert.match(css, /is-outline-disabled[^}]*__outline-card,[\s\S]*is-outline-disabled[^}]*__outline-resizer,[\s\S]*is-outline-disabled[^}]*__outline-handle\s*\{[^}]*display:\s*none;/s);
  assert.doesNotMatch(css, /__main\[data-view="edit"\] \.easymde-immersive-workspace__outline-card/);
  assert.doesNotMatch(css, /__main\[data-view="preview"\] \.easymde-immersive-workspace__outline-card/);
  assert.match(css, /__main\s*\{[^}]*gap:\s*0;/s);
  assert.match(css, /__main\s*\{[^}]*overflow:\s*hidden;/s);
  assert.match(css, /__outline-card\s*\{[^}]*width:\s*var\(--easymde-immersive-outline-width\);/s);
  assert.match(css, /__outline-resizer\s*\{[^}]*display:\s*flex;[^}]*width:\s*14px;[^}]*cursor:\s*col-resize;/s);
  assert.match(css, /__outline-resizer::before\s*\{[^}]*width:\s*1px;[^}]*background:\s*transparent;/s);
  assert.match(css, /__outline-resizer:hover::before,[\s\S]*__outline-resizer\.is-dragging::before\s*\{[^}]*background:\s*#dde1e8;/s);
  assert.match(css, /__outline-handle\s*\{[^}]*width:\s*33\.75px;/s);
  assert.match(css, /__outline-handle\s*\{[^}]*border:\s*1px solid #e8ebef;/s);
  assert.match(css, /__outline-handle\s*\{[^}]*border-radius:\s*15px;/s);
  assert.match(css, /__outline-handle\s*\{[^}]*color:\s*#90a1b9;/s);
  assert.match(css, /__outline-handle > svg\s*\{[^}]*transform:\s*rotate\(180deg\);/s);
  assert.match(css, /__outline-handle\s*\{[^}]*font-weight:\s*500;/s);
  assert.match(css, /__outline-handle:hover\s*\{[^}]*background:\s*#f8fafc;[^}]*color:\s*#314158;/s);
  assert.match(
    css,
    /is-outline-hidden[^}]*__main\[data-view="split"\][^}]*grid-template-columns:\s*45px minmax\(360px, calc\(\(100% - 59px\) \* var\(--easymde-immersive-source-ratio\)\)\) 14px minmax\(360px, 1fr\);/s
  );
  assert.match(
    css,
    /is-outline-disabled[^}]*__main\[data-view="split"\][^}]*grid-template-columns:\s*minmax\(360px, calc\(\(100% - 14px\) \* var\(--easymde-immersive-source-ratio\)\)\) 14px minmax\(360px, 1fr\);/s
  );
  assert.doesNotMatch(
    css,
    /is-outline-hidden[^}]*__main\[data-view="split"\][^}]*grid-template-columns:[^;]*3\.75px/s
  );
  assert.match(css, /__outline-card\s*\{[^}]*background:\s*linear-gradient\(180deg, #fdfdff 0%, #fafbfe 100%\);/s);
  assert.doesNotMatch(css, /__outline-card\s*\{[^}]*background:\s*#ebecf3;/s);
  assert.match(css, /__outline-card > header strong\s*\{[^}]*font-weight:\s*500;/s);
  assert.match(css, /__outline-card > header button\s*\{[^}]*width:\s*22\.5px;[^}]*height:\s*22\.5px;[^}]*border-radius:\s*3\.625px;[^}]*color:\s*#90a1b9;/s);
  assert.match(css, /__outline-card > footer button\s*\{[^}]*color:\s*#62748e;[^}]*font-size:\s*12\.5px;[^}]*font-weight:\s*500;/s);
  assert.match(css, /__outline\s*\{[^}]*padding:\s*13\.125px 15px;/s);
  assert.match(css, /__outline-children\s*\{[^}]*border-left:\s*1\.5px solid #ecedf0;/s);
  assert.match(css, /__outline-entry\.is-top-level\s*\{[^}]*border-radius:\s*8\.4375px;/s);
  assert.match(css, /__outline-entry\.is-top-level\s*\{[^}]*padding:\s*8\.4375px 9\.375px;/s);
  assert.match(css, /__outline-entry\.is-active\s*\{[^}]*background:\s*#eef2ff;[^}]*color:\s*#4c6ef5;/s);
  assert.doesNotMatch(css, /__outline-entry\.is-active::after/);
  assert.match(css, /__divider\s*\{[^}]*display:\s*flex;[^}]*width:\s*14px;/s);
  assert.match(css, /__divider::before\s*\{[^}]*width:\s*1px;[^}]*background:\s*#e8ebef;/s);
  assert.match(css, /__editor-card > header\s*\{[^}]*height:\s*auto;[^}]*min-height:\s*0;[^}]*flex:\s*0 0 auto;[^}]*padding:\s*10px 15px;/s);
  assert.match(css, /__editor-card > header strong\s*\{[^}]*font-size:\s*13px;/s);
  assert.doesNotMatch(source, /easymde-immersive-workspace__panel-action/);
  assert.doesNotMatch(css, /easymde-immersive-workspace__panel-action/);
  assert.match(css, /__editor-body\s*\{[^}]*grid-template-columns:\s*36px minmax\(0, 1fr\);[^}]*background:\s*#f2f2f2;/s);
  assert.match(css, /__line-numbers\s*\{[^}]*padding:\s*14px 14px 14px 0;[^}]*background:\s*#f2f2f2;[^}]*color:\s*#c7cbd3;/s);
  assert.match(css, /__line-numbers\s*\{[^}]*font-family:\s*SFMono-Regular, Menlo, Consolas, monospace;[^}]*font-size:\s*13\.5px;[^}]*line-height:\s*28px;/s);
  assert.doesNotMatch(css, /__line-numbers\s*\{[^}]*border-right:/s);
  assert.match(css, /__line-number\s*\{[^}]*height:\s*28px;/s);
  assert.match(css, /__source,[\s\S]*__source-highlight\s*\{[^}]*padding:\s*14px 14px 14px 0;/s);
  assert.match(css, /__source,[\s\S]*__source-highlight\s*\{[^}]*font-family:\s*SFMono-Regular, Menlo, Consolas, monospace;[^}]*font-size:\s*14\.5px;[^}]*line-height:\s*28px;/s);
  assert.match(css, /__source-highlight\s*\{[^}]*background:\s*#f2f2f2;/s);
  assert.match(css, /\.easymde-immersive-workspace :where\(button, input, textarea, \[tabindex\]\):focus-visible\s*\{[^}]*outline:\s*2px solid #2563eb;[^}]*outline-offset:\s*2px;/s);
  assert.match(css, /__source\s*\{[^}]*overflow:\s*auto;[^}]*scrollbar-width:\s*none;/s);
  assert.doesNotMatch(css, /__source\s*\{[^}]*overflow:\s*hidden;/s);
  assert.match(css, /__source::-webkit-scrollbar\s*\{[^}]*display:\s*none;/s);
  assert.match(css, /__source:focus-visible\s*\{[^}]*outline:\s*none;/s);
  assert.doesNotMatch(css, /__source:focus-visible\s*\{[^}]*#2563eb/s);
  assert.equal((css.match(/\.easymde-immersive-workspace__source:focus-visible\s*\{/g) || []).length, 1);
  assert.match(css, /__editor-card > footer\s*\{[^}]*height:\s*34px;[^}]*min-height:\s*34px;[^}]*padding:\s*7\.5px 15px;[^}]*color:\s*#b0b4bc;/s);
  assert.match(css, /__preview-card > header\s*\{[^}]*background:\s*transparent;/s);
  assert.match(css, /__preview-card > header strong\s*\{[^}]*font-weight:\s*500;/s);
  assert.match(source, /data-command="heading"[^>]*aria-haspopup="menu"[^>]*aria-expanded="false"[^>]*aria-controls="easymde-immersive-heading-menu"/);
  assert.match(source, /id="easymde-immersive-heading-menu"[^>]*data-heading-menu role="menu"/);
  assert.match(css, /__heading-menu\s*\{[^}]*position:\s*fixed;[^}]*z-index:\s*150040;/s);
  assert.match(css, /__heading-menu\s*\{[^}]*width:\s*176px;[^}]*border:\s*1px solid #e7ebf3;[^}]*box-shadow:\s*0 8px 22px rgba\(38, 52, 85, 0\.1\);/s);
  assert.match(css, /__heading-menu\s*\{[^}]*overflow-y:\s*auto;/s);
  assert.match(css, /__heading-menu-item\s*\{[^}]*grid-template-columns:\s*42px minmax\(0, 1fr\) 16px;[^}]*height:\s*40px;/s);
  assert.match(css, /__heading-menu-key\s*\{[^}]*border:\s*1px solid #d5dcef;[^}]*background:\s*#fbfcff;[^}]*color:\s*#6576a2;/s);
  assert.match(css, /__heading-menu-item\.is-current[^}]*background:\s*#f2f4fd;[^}]*color:\s*#2f3850;/s);
  assert.match(css, /data-heading-command="heading1"[^}]*--easymde-heading-key-width:\s*32px;[^}]*--easymde-heading-label-size:\s*16px;/s);
  assert.match(css, /data-heading-command="heading6"[^}]*--easymde-heading-key-width:\s*27px;[^}]*--easymde-heading-label-size:\s*11px;/s);
  assert.match(css, /__format-actions button[^}]*border-radius:\s*5\.625px;/s);
  assert.match(css, /__format-actions button\s*\{[^}]*color:\s*#45556c;/s);
  assert.match(css, /__format-actions button[^}]*font-weight:\s*500;/s);
  assert.match(css, /__format-actions button[^}]*transition:\s*all 100ms cubic-bezier\(0\.4, 0, 0\.2, 1\);/s);
  assert.match(css, /__format-actions button:active[^}]*scale:\s*0\.95;/s);
  assert.match(css, /__format-actions button:hover\s*\{[^}]*background:\s*rgba\(0, 0, 0, 0\.045\);[^}]*color:\s*#0f172b;/s);
  assert.doesNotMatch(css, /__format-actions button:active[^}]*transform:\s*scale\(/s);
  assert.match(css, /__format-actions \[data-view\]:not\(\.is-active\)[^}]*color:\s*#64748b;/s);
  assert.match(css, /__format-actions \[data-view\]:hover:not\(\.is-active\)[^}]*color:\s*#1e293b;/s);
  assert.match(css, /__heading-separator[^}]*margin-inline:\s*5\.625px;/s);
  assert.match(css, /__secondary-actions\s*\{[^}]*gap:\s*9\.375px;[^}]*margin-left:\s*22\.5px;/s);
  assert.match(css, /__secondary-actions button\s*\{[^}]*height:\s*30px;[^}]*gap:\s*5\.625px;[^}]*padding:\s*0 9\.375px;/s);
  assert.match(css, /__secondary-actions button\s*\{[^}]*border:\s*1px solid #e2e8f0;[^}]*border-radius:\s*5\.625px;/s);
  assert.match(css, /__secondary-actions button\s*\{[^}]*color:\s*#45556c;/s);
  assert.match(css, /__secondary-actions button\s*\{[^}]*font-size:\s*12\.5px;[^}]*font-weight:\s*500;/s);
  assert.match(css, /__secondary-actions button\s*\{[^}]*transition:\s*all 100ms cubic-bezier\(0\.4, 0, 0\.2, 1\);/s);
  assert.doesNotMatch(css, /\[data-action="copy-markdown"\]/);
  assert.match(css, /__heading-button strong[^}]*letter-spacing:\s*0;/s);
  assert.match(css, /\[data-action="exit"\][^}]*margin-left:\s*1\.875px;/s);
  assert.match(css, /__secondary-actions \[data-action="settings"\][^}]*padding-inline:\s*7\.5px;/s);
  assert.match(css, /__secondary-actions \[data-action="settings"\][^}]*color:\s*#62748e;/s);
  assert.match(css, /__secondary-actions button:hover\s*\{[^}]*background:\s*rgba\(0, 0, 0, 0\.045\);[^}]*color:\s*#0f172b;/s);
  assert.match(css, /__wechat-button\s*\{[^}]*transition:\s*all 150ms cubic-bezier\(0\.4, 0, 0\.2, 1\);/s);
  assert.match(css, /__secondary-actions \.easymde-immersive-workspace__wechat-button:hover,[\s\S]*?__secondary-actions \.easymde-immersive-workspace__wechat-button:focus-visible\s*\{[^}]*border-color:\s*#07c060;[^}]*background:\s*linear-gradient\(180deg, #f2fff7 0%, #e5f8eb 100%\);[^}]*box-shadow:\s*0 8px 18px rgba\(7, 192, 96, 0\.16\);[^}]*color:\s*#075f2c;[^}]*transform:\s*translateY\(-1px\);/s);
  assert.match(css, /__secondary-actions \.easymde-immersive-workspace__wechat-button:active\s*\{[^}]*transform:\s*translateY\(0\);/s);
  assert.match(css, /__view-switch button[^}]*border-radius:\s*3\.625px;/s);
  assert.match(css, /__view-switch button[^}]*color:\s*#6b7280;/s);
  assert.match(css, /__view-switch button[^}]*transition:\s*all 150ms cubic-bezier\(0\.4, 0, 0\.2, 1\);/s);
  assert.match(css, /__primary-actions button[^}]*line-height:\s*15px;/s);
  assert.match(css, /__publish-button[^}]*line-height:\s*18\.75px;/s);
  assert.match(css, /\[data-action="font"\][^}]*gap:\s*3\.75px;/s);
  assert.match(css, /__theme-dot[^}]*width:\s*7\.5px;/s);
  assert.match(css, /max-width:\s*1535px[^}]*__publish-button kbd/s);
  assert.match(css, /__traffic i[^}]*width:\s*11\.25px;/s);
  assert.match(css, /__brand-name strong[^}]*letter-spacing:\s*-0\.025em;/s);
  assert.match(css, /__brand-divider[^}]*font-size:\s*16\.875px;/s);
  assert.match(css, /__header-stats[^}]*line-height:\s*15px;/s);
  assert.match(css, /\.easymde-immersive-workspace button\.easymde-immersive-workspace__header-stats\s*\{[^}]*cursor:\s*default;/s);
  assert.match(css, /__brand[^}]*font-size:\s*15px;/s);
  assert.match(css, /__title-wrap[^}]*max-width:\s*320px;/s);
  assert.match(css, /__title-grid[^}]*min-width:\s*72px;/s);
  assert.doesNotMatch(css, /__title-grid[^}]*overflow:\s*hidden;/s);
  assert.match(css, /__title:focus-visible\s*\{[^}]*outline:\s*2px solid #2563eb;[^}]*outline-offset:\s*2px;/s);
  assert.doesNotMatch(css, /__title,[\s\S]*__title-mirror[^}]*max-height:\s*60px;/s);
  assert.doesNotMatch(css, /@media \(max-width:\s*(?:900|680)px\)[\s\S]*?__title-wrap\s*\{/s);
  assert.match(css, /@media \(max-width:\s*767px\)[\s\S]*?__header-stats\s*\{[^}]*display:\s*none;/s);
  assert.match(css, /@media \(max-width:\s*1023px\)[\s\S]*?__action-separator\s*\{[^}]*display:\s*none;/s);
  assert.doesNotMatch(css, /@media \(max-width:\s*680px\)[\s\S]*?__brand-divider,[\s\S]*?__brand-name strong\s*\{[^}]*display:\s*none;/s);
  assert.doesNotMatch(css, /@media \(max-width:\s*680px\)[\s\S]*?__save-status > span,[\s\S]*?__view-switch button span,[\s\S]*?__primary-actions button:not\(\.easymde-immersive-workspace__publish-button\) > span,[\s\S]*?__publish-button \[data-publish-label\],[\s\S]*?__publish-button kbd\s*\{[^}]*display:\s*none;/s);
  assert.match(css, /@media \(max-width:\s*639px\)[\s\S]*?__brand-divider,[\s\S]*?__brand-name strong\s*\{[^}]*display:\s*none;/s);
  assert.match(css, /@media \(max-width:\s*639px\)[\s\S]*?__save-status > span,[\s\S]*?__view-switch button span,[\s\S]*?__primary-actions button:not\(\.easymde-immersive-workspace__publish-button\) > span,[\s\S]*?__publish-button \[data-publish-label\],[\s\S]*?__publish-button kbd\s*\{[^}]*display:\s*none;/s);
  assert.doesNotMatch(css, /__primary-actions button > span,[\s\S]*?__publish-button kbd\s*\{[^}]*display:\s*none;/s);
  assert.match(css, /__primary-actions button:not\(\.easymde-immersive-workspace__publish-button\) > span,[\s\S]*?__publish-button \[data-publish-label\],[\s\S]*?__publish-button kbd\s*\{[^}]*display:\s*none;/s);
  assert.doesNotMatch(css, /@media \(max-width:\s*680px\)[\s\S]*?__publish-button\s*\{[^}]*width:\s*35px;[^}]*min-width:\s*0;/s);
  assert.match(css, /@media \(max-width:\s*639px\)[\s\S]*?__publish-button\s*\{[^}]*width:\s*35px;[^}]*min-width:\s*0;/s);
  assert.doesNotMatch(css, /@media \(max-width:\s*680px\)[\s\S]*?__preview-scroll\s*\{[^}]*padding:\s*20px 16px;/s);
  assert.match(css, /@media \(max-width:\s*639px\)[\s\S]*?__preview-scroll\s*\{[^}]*padding:\s*15px;/s);
  assert.doesNotMatch(css, /@media \(max-width:\s*680px\)[\s\S]*?__outline-card\s*\{[^}]*position:\s*fixed;/s);
  assert.doesNotMatch(css, /@media \(max-width:\s*680px\)[\s\S]*?grid-template-columns:\s*(?:45px )?360px 14px 360px;/s);
  assert.match(css, /@media \(max-width:\s*639px\)[\s\S]*?__secondary-actions button:not\(\.easymde-immersive-workspace__wechat-button\) > span\s*\{[^}]*display:\s*none;/s);
  assert.doesNotMatch(css, /@media \(max-width:\s*680px\)[\s\S]*?__traffic\s*\{[^}]*display:\s*none;/s);
  assert.match(css, /font-family:\s*"EasyMDE UI Inter"/);
  assert.match(css, /vendor\/inter\/inter-latin-variable\.woff2/);
  assert.match(css, /font-family:\s*"EasyMDE UI JetBrains Mono"/);
  assert.match(css, /vendor\/jetbrains-mono\/jetbrains-mono-latin-variable\.woff2/);
  assert.match(css, /font-family:\s*"EasyMDE UI Lora"/);
  assert.match(css, /vendor\/lora\/lora-latin-variable\.woff2/);

  assert.match(source, /data-command="strike"[\s\S]*?<i aria-hidden="true"><\/i>' \+\n\s*'<i aria-hidden="true"><\/i>' \+[\s\S]*?data-command="heading"/);
  assert.match(source, /<header><strong>' \+ label\('outline', 'Outline'\) \+ '<\/strong><button type="button" data-action="toggle-outline" title="' \+ label\('closeOutline', 'Close outline'\) \+ '" aria-label="' \+ label\('closeOutline', 'Close outline'\)/);
  assert.match(source, /<footer><button type="button" data-action="toggle-outline" title="' \+ label\('closeOutline', 'Close outline'\) \+ '" aria-label="' \+ label\('closeOutline', 'Close outline'\) \+ '">' \+ iconMarkup\('chevrons-left'/);
  assert.match(source, /class="easymde-immersive-workspace__outline-handle"[^>]*data-action="toggle-outline"[^>]*title="' \+ label\('openOutline', 'Open outline'\) \+ '"[^>]*aria-label="' \+ label\('openOutline', 'Open outline'\)/);
  assert.match(source, /label\('openOutline', 'Open outline'\)/);
  assert.match(source, /data-command="bold" title="' \+ label\('boldShortcutTitle', 'Bold \(Ctrl\+B\)'\) \+ '" aria-label="' \+ label\('bold', 'Bold'\)/);
  assert.match(source, /data-command="italic" title="' \+ label\('italicShortcutTitle', 'Italic \(Ctrl\+I\)'\) \+ '" aria-label="' \+ label\('italic', 'Italic'\)/);
  assert.match(source, /data-command="quote" title="' \+ label\('quoteTitle', 'Blockquote'\) \+ '" aria-label="' \+ label\('quote', 'Quote'\)/);
  assert.match(source, /data-view="edit" aria-pressed="false" title="' \+ label\('editModeTitle', 'Edit mode'\) \+ '" aria-label="' \+ label\('editMode', 'Edit'\)/);
  assert.match(source, /data-view="split" class="is-active" aria-pressed="true" title="' \+ label\('splitModeTitle', 'Split mode'\) \+ '" aria-label="' \+ label\('splitMode', 'Split'\)/);
  assert.match(source, /data-view="preview" aria-pressed="false" title="' \+ label\('previewModeTitle', 'Preview mode'\) \+ '" aria-label="' \+ label\('previewMode', 'Preview'\)/);
  assert.match(source, /data-action="exit" title="' \+ label\('immersiveModeTitle', 'Immersive writing'\) \+ '" aria-label="' \+ label\('exitImmersive', 'Exit immersive writing'\)/);
  assert.match(source, /data-action="wechat"[^>]*title="' \+ label\('copyWechatImmersiveTitle', 'Copy current preview content to WeChat'\) \+ '" aria-label="' \+ label\('copyWechatTitle', 'Copy preview for WeChat'\)/);
  assert.match(source, /data-action="theme" title="' \+ label\('themeTitle', 'Switch theme'\) \+ '" aria-label="' \+ label\('theme', 'Theme'\)/);
  assert.match(source, /data-action="font" title="' \+ label\('fontTitle', 'Font settings'\) \+ '" aria-label="' \+ label\('font', 'Font'\)/);

  const zh = readFileSync(join(repoRoot, 'languages/easymde-zh_CN.po'), 'utf8');
  assert.match(zh, /msgid "Close outline"\nmsgstr "收起大纲"/);
  assert.match(zh, /msgid "Bold \(Ctrl\+B\)"\nmsgstr "粗体 \(Ctrl\+B\)"/);
  assert.match(zh, /msgid "Italic \(Ctrl\+I\)"\nmsgstr "斜体 \(Ctrl\+I\)"/);
  assert.match(zh, /msgid "Blockquote"\nmsgstr "引用块"/);
  assert.match(zh, /msgid "Edit mode"\nmsgstr "编辑模式"/);
  assert.match(zh, /msgid "Split mode"\nmsgstr "分屏模式"/);
  assert.match(zh, /msgid "Preview mode"\nmsgstr "预览模式"/);
  assert.match(zh, /msgid "Immersive writing"\nmsgstr "沉浸写作"/);
  assert.match(zh, /msgid "Copy current preview content to WeChat"\nmsgstr "复制当前预览内容到公众号"/);
  assert.match(zh, /msgid "Switch theme"\nmsgstr "切换主题"/);
  assert.match(zh, /msgid "Font settings"\nmsgstr "字体设置"/);
  assert.match(source, /measuredHeight <= Math\.ceil\(lineHeight\) \? lineHeight : measuredHeight/);
  assert.match(source, /listen\(win, 'resize', function \(\) \{\s*setSourceRatio\(sourceRatio\);\s*updateTitleHeight\(\);\s*\}\);/s);
  assert.match(source, /toolbar\.hidden = mode === 'preview';/);
  assert.match(source, /data-featured-candidate/);
  assert.match(source, /data-action="use-featured-candidate"/);
  assert.match(source, /featuredImageCandidate = image;/);
  assert.doesNotMatch(source, /publishDraft\.featuredImage = image;\s*renderPublishDialog\(false\);/);
});

test('revision navigation detects unsaved title or Markdown without treating normalization as a save', () => {
  const workspace = loadWorkspaceModule();

  assert.equal(workspace.hasUnsavedWorkspaceChanges({
    initialMarkdown: '# Saved',
    initialTitle: 'Saved title',
    markdown: '# Saved',
    title: 'Saved title'
  }), false);
  assert.equal(workspace.hasUnsavedWorkspaceChanges({
    initialMarkdown: '# Saved',
    initialTitle: 'Saved title',
    markdown: '# Edited',
    title: 'Saved title'
  }), true);
  assert.equal(workspace.hasUnsavedWorkspaceChanges({
    initialMarkdown: '# Saved',
    initialTitle: 'Saved title',
    markdown: '# Saved',
    title: 'Edited title'
  }), true);
});

test('default immersive preview uses the reference prose geometry without overriding real article themes', () => {
  const css = readFileSync(join(repoRoot, 'assets/css/admin/immersive-workspace.css'), 'utf8');

  const rule = (suffix = '') => new RegExp(`__preview\\.easymde-markdown-theme-default${suffix}\\s*\\{([^}]*)\\}`, 's').exec(css)?.[1] || '';
  const rootRule = rule();
  const h1Rule = rule(' h1');
  const h2Rule = rule(' h2');
  const paragraphRule = rule(' p');
  const blockquoteRule = rule(' blockquote');
  const hrRule = rule(' hr');

  assert.match(rootRule, /padding:\s*26\.25px 30px;/);
  assert.match(rootRule, /max-width:\s*680px;/);
  assert.match(rootRule, /font-size:\s*15px;/);
  assert.match(rootRule, /line-height:\s*1\.85;/);
  assert.match(h1Rule, /font-family:\s*"EasyMDE UI Lora", Georgia, serif !important;/);
  assert.match(h1Rule, /font-size:\s*30px;/);
  assert.match(h1Rule, /line-height:\s*36px;/);
  assert.match(h1Rule, /margin:\s*24px 0 12px;/);
  assert.match(h2Rule, /font-family:\s*"EasyMDE UI Inter", system-ui, sans-serif !important;/);
  assert.match(h2Rule, /font-size:\s*16\.875px;/);
  assert.match(h2Rule, /line-height:\s*21\.9375px;/);
  assert.match(h2Rule, /margin:\s*30px 0 9px;/);
  assert.match(h2Rule, /padding-bottom:\s*7\.5px;/);
  assert.match(h2Rule, /border-bottom:\s*2px solid #e74c3c;/);
  assert.match(h2Rule, /display:\s*inline-block;/);
  assert.match(blockquoteRule, /margin:\s*18\.75px 0;/);
  assert.match(blockquoteRule, /padding:\s*15px 18\.75px;/);
  assert.match(blockquoteRule, /border-left:\s*3px solid #e74c3c;/);
  assert.match(blockquoteRule, /background:\s*#fdedec;/);
  assert.match(blockquoteRule, /line-height:\s*inherit;/);
  assert.match(hrRule, /margin:\s*30px 0;/);
  assert.match(hrRule, /border:\s*0;/);
  assert.match(hrRule, /border-top:\s*1px solid rgba\(15, 23, 42, 0\.1\);/);
  assert.match(paragraphRule, /margin:\s*11\.25px 0;/);
  assert.match(paragraphRule, /font-size:\s*inherit;/);
  assert.match(paragraphRule, /line-height:\s*inherit;/);
  assert.doesNotMatch(css, /__preview:not\(\.easymde-markdown-theme-default\)/);
});

test('default immersive preview completes the reference prose grammar', () => {
  const css = readFileSync(join(repoRoot, 'assets/css/admin/immersive-workspace.css'), 'utf8');
  const scope = String.raw`\.easymde-immersive-workspace \.easymde-immersive-workspace__preview\.easymde-markdown-theme-default`;
  const rule = (selector) => new RegExp(`${scope}${selector}\\s*\\{([^}]*)\\}`, 's').exec(css)?.[1] || '';

  const h3Rule = rule(' h3');
  const h4Rule = rule(' h4');
  const h5H6Rule = rule(' :is\\(h5, h6\\)');
  const strongRule = rule(' strong');
  const deletedRule = rule(' del');
  const linkRule = rule(' a');
  const inlineCodeRule = rule(' :not\\(pre\\) > code');
  const unorderedListRule = rule(' ul');
  const unorderedMarkerRule = rule(' ul > li::before');
  const orderedListRule = rule(' ol');
  const listItemRule = rule(' li');
  const listParagraphRule = rule(' li > p');
  const taskListRule = rule(' \.task-list');
  const taskItemRule = rule(' \.task-item');
  const taskCheckboxRule = rule(' \.task-item input\\[type="checkbox"\\]');
  const tableRule = rule(' table');
  const tableHeadingRule = rule(' th');
  const tableCellRule = rule(' td');
  const imageRule = rule(' img');
  const preRule = rule(' pre');
  const codeBlockRule = rule(' pre code');

  assert.match(h3Rule, /font-family:\s*"EasyMDE UI Inter", system-ui, sans-serif !important;/);
  assert.match(h3Rule, /font-size:\s*15px;/);
  assert.match(h3Rule, /line-height:\s*22\.5px;/);
  assert.match(h3Rule, /margin:\s*22\.5px 0 6px;/);
  assert.match(h4Rule, /font-size:\s*13\.5px;/);
  assert.match(h4Rule, /line-height:\s*20\.25px;/);
  assert.match(h4Rule, /margin:\s*18px 0 4\.5px;/);
  assert.match(h5H6Rule, /font-size:\s*13\.5px;/);
  assert.match(h5H6Rule, /line-height:\s*24\.975px;/);
  assert.match(h5H6Rule, /margin:\s*18px 0 4\.5px;/);
  assert.match(strongRule, /font-weight:\s*600;/);
  assert.match(deletedRule, /color:\s*#94a3b8;/);
  assert.match(linkRule, /color:\s*#e74c3c;/);
  assert.match(linkRule, /border-bottom:\s*1px solid #f5a89e;/);
  assert.match(inlineCodeRule, /font-size:\s*12\.3px;/);
  assert.match(inlineCodeRule, /margin:\s*0;/);
  assert.match(inlineCodeRule, /padding:\s*1\.845px 4\.92px;/);
  assert.match(inlineCodeRule, /background:\s*#fdedec;/);
  assert.match(unorderedListRule, /margin:\s*11\.25px 0;/);
  assert.match(unorderedListRule, /padding-left:\s*22\.5px;/);
  assert.match(unorderedListRule, /list-style:\s*none;/);
  assert.match(unorderedMarkerRule, /content:\s*"—";/);
  assert.match(unorderedMarkerRule, /margin-right:\s*9px;/);
  assert.match(orderedListRule, /margin:\s*11\.25px 0;/);
  assert.match(orderedListRule, /padding-left:\s*22\.5px;/);
  assert.match(listItemRule, /margin:\s*3\.75px 0;/);
  assert.match(listParagraphRule, /margin:\s*0;/);
  assert.match(listParagraphRule, /display:\s*inline;/);
  assert.match(taskListRule, /padding-left:\s*3\.75px;/);
  assert.match(taskItemRule, /display:\s*flex;/);
  assert.match(taskCheckboxRule, /width:\s*13px;/);
  assert.match(taskCheckboxRule, /accent-color:\s*#e74c3c;/);
  assert.match(tableRule, /margin:\s*18\.75px 0;/);
  assert.match(tableRule, /font-size:\s*13\.125px;/);
  assert.match(tableHeadingRule, /padding:\s*9px 13\.125px;/);
  assert.match(tableHeadingRule, /font-family:\s*"EasyMDE UI Inter", sans-serif !important;/);
  assert.match(tableHeadingRule, /background:\s*#e74c3c;/);
  assert.match(tableHeadingRule, /font-size:\s*12px;/);
  assert.match(tableCellRule, /padding:\s*8\.25px 13\.125px;/);
  assert.match(tableCellRule, /font-family:\s*"EasyMDE UI Inter", sans-serif !important;/);
  assert.match(tableCellRule, /border-bottom:\s*1px solid rgba\(15, 23, 42, 0\.07\);/);
  assert.match(imageRule, /max-width:\s*100%;/);
  assert.match(imageRule, /margin:\s*11\.25px 0;/);
  assert.match(imageRule, /border-radius:\s*4px;/);
  assert.match(preRule, /margin:\s*18\.75px 0;/);
  assert.match(preRule, /border-radius:\s*6px;/);
  assert.match(codeBlockRule, /font-size:\s*12\.3px;/);
  assert.match(codeBlockRule, /margin:\s*0;/);
  assert.match(codeBlockRule, /line-height:\s*20\.91px;/);
  assert.match(codeBlockRule, /padding:\s*18\.75px 22\.5px;/);
  assert.match(codeBlockRule, /white-space:\s*pre;/);
});

test('divider pointer mapping uses the real resizable span and clamps its ratio', () => {
  const workspace = loadWorkspaceModule();

  assert.equal(workspace.calculateSourceRatioFromPointer(720, {
    dividerWidth: 14,
    gap: 0,
    pointerOffset: 7,
    previewRight: 1428.75,
    sourceLeft: 11.25
  }), 0.5);

  assert.equal(workspace.calculateSourceRatioFromPointer(845.625, {
    dividerWidth: 14,
    gap: 0,
    pointerOffset: 7,
    previewRight: 1428.75,
    sourceLeft: 262.5
  }), 0.5);

  assert.equal(workspace.calculateSourceRatioFromPointer(838.625, {
    dividerWidth: 14,
    gap: 0,
    pointerOffset: 0,
    previewRight: 1428.75,
    sourceLeft: 262.5
  }), 0.5);

  assert.equal(workspace.calculateSourceRatioFromPointer(-100, {
    dividerWidth: 14,
    gap: 0,
    pointerOffset: 7,
    previewRight: 1428.75,
    sourceLeft: 11.25
  }), 0.25);

  assert.equal(workspace.calculateSourceRatioFromPointer(2000, {
    dividerWidth: 14,
    gap: 0,
    pointerOffset: 7,
    previewRight: 1428.75,
    sourceLeft: 11.25
  }), 0.75);
});

test('outline width clamps invalid and out-of-range layout preferences', () => {
  const workspace = loadWorkspaceModule();

  assert.equal(workspace.clampOutlineWidth(189), 190);
  assert.equal(workspace.clampOutlineWidth(190), 190);
  assert.equal(workspace.clampOutlineWidth(240), 240);
  assert.equal(workspace.clampOutlineWidth(360), 360);
  assert.equal(workspace.clampOutlineWidth(361), 360);
  assert.equal(workspace.clampOutlineWidth('not-a-number'), 240);
  assert.equal(workspace.clampOutlineWidth(null), 240);
});

test('table dimensions validate explicit 1-20 integer bounds', () => {
  const workspace = loadWorkspaceModule();

  assert.deepEqual(
    JSON.parse(JSON.stringify(workspace.normalizeTableDimensions('3', 4))),
    { rows: 3, columns: 4 }
  );
  assert.throws(() => workspace.normalizeTableDimensions(0, 3), /between 1 and 20/);
  assert.throws(() => workspace.normalizeTableDimensions(3, 21), /between 1 and 20/);
  assert.throws(() => workspace.normalizeTableDimensions(2.5, 3), /whole numbers/);
  assert.throws(() => workspace.normalizeTableDimensions('', 3), /whole numbers/);
});

test('table markdown treats the selected row count as including the header row', () => {
  const workspace = loadWorkspaceModule();

  assert.equal(
    workspace.createTableMarkdown(3, 4, { column: '列', content: '内容' }),
    [
      '| 列1 | 列2 | 列3 | 列4 |',
      '| --- | --- | --- | --- |',
      '| 内容 | 内容 | 内容 | 内容 |',
      '| 内容 | 内容 | 内容 | 内容 |'
    ].join('\n')
  );
  assert.equal(
    workspace.createTableMarkdown(1, 1, { column: '列', content: '内容' }),
    ['| 列1 |', '| --- |'].join('\n')
  );
});

test('outline resizer and table dialog expose independent accessible controls', () => {
  const source = readFileSync(join(repoRoot, 'assets/js/admin/immersive-workspace.js'), 'utf8');

  assert.match(source, /class="easymde-immersive-workspace__outline-resizer"[^>]*role="separator"[^>]*tabindex="0"[^>]*aria-orientation="vertical"[^>]*aria-valuemin="190"[^>]*aria-valuemax="360"[^>]*aria-valuenow="240"/);
  assert.match(source, /function bindOutlineResizer\(\)/);
  assert.match(source, /event\.shiftKey \? 20 : 10/);
  assert.match(source, /layoutKey \+ ':outline-width'/);
  assert.match(source, /data-table-backdrop/);
  assert.match(source, /role="dialog" aria-modal="true" aria-labelledby="easymde-immersive-table-title"/);
  assert.match(source, /data-table-grid/);
  assert.match(source, /min="1" max="20"[^>]*data-table-rows/);
  assert.match(source, /min="1" max="20"[^>]*data-table-columns/);
  assert.match(source, /data-action="insert-table"/);
});

test('immersive WeChat action owns its asynchronous feedback state', () => {
  const source = readFileSync(join(repoRoot, 'assets/js/admin/immersive-workspace.js'), 'utf8');
  const css = readFileSync(join(repoRoot, 'assets/css/admin/immersive-workspace.css'), 'utf8');

  assert.match(source, /var wechatCopying = false;/);
  assert.match(source, /function runWechatCopy\(trigger\)/);
  assert.match(source, /wechatCopying = true;[\s\S]*Promise\.resolve\(result\)[\s\S]*renderWechatState\('success'/s);
  assert.match(source, /renderWechatState\('error'/);
  assert.match(source, /data-wechat-status[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(css, /__wechat-button\.is-copying\s*\{[^}]*cursor:\s*wait;/s);
  assert.match(css, /__wechat-button\.is-success\s*\{[^}]*border-color:\s*#07c060;/s);
  assert.match(css, /__wechat-button\.is-error\s*\{[^}]*border-color:\s*#dc2626;/s);
});

test('immersive WeChat action reuses the original toolbar glyph without redefining it', () => {
  const immersiveSource = readFileSync(join(repoRoot, 'assets/js/admin/immersive-workspace.js'), 'utf8');

  assert.match(immersiveSource, /data-wechat-icon aria-hidden="true"/);
  assert.match(immersiveSource, /typeof adapter\.decorateWechatIcon === 'function'/);
  assert.match(immersiveSource, /adapter\.decorateWechatIcon\(root\)/);
  assert.doesNotMatch(immersiveSource, /function wechatGlyphMarkup\(/);
  assert.doesNotMatch(immersiveSource, /<svg viewBox="0 0 40 40"/);
});

test('header and toolbar actions follow the current reference layout order', () => {
  const source = readFileSync(join(repoRoot, 'assets/js/admin/immersive-workspace.js'), 'utf8');
  const css = readFileSync(join(repoRoot, 'assets/css/admin/immersive-workspace.css'), 'utf8');
  const headerStart = source.indexOf('<header class="easymde-immersive-workspace__header">');
  const toolbarStart = source.indexOf('<div class="easymde-immersive-workspace__toolbar"', headerStart);
  const mainStart = source.indexOf('<main class="easymde-immersive-workspace__main"', toolbarStart);
  const headerMarkup = source.slice(headerStart, toolbarStart);
  const toolbarMarkup = source.slice(toolbarStart, mainStart);

  assert.match(headerMarkup, /easymde-immersive-workspace__save-status[\s\S]*?data-action="statistics"/);
  assert.match(headerMarkup, /data-action="ai"[\s\S]*?easymde-immersive-workspace__action-separator[\s\S]*?data-action="publish"/);
  assert.match(headerMarkup, /data-action="ai"[\s\S]*?iconMarkup\('sparkles', 13, 2\)/);
  assert.match(headerMarkup, /data-view="edit"[^>]*title="' \+ label\('editMode', 'Edit'\) \+ '"[^>]*aria-label="' \+ label\('editMode', 'Edit'\) \+ '"/);
  assert.match(headerMarkup, /data-view="split"[^>]*title="' \+ label\('splitMode', 'Split'\) \+ '"[^>]*aria-label="' \+ label\('splitMode', 'Split'\) \+ '"/);
  assert.match(headerMarkup, /data-view="preview"[^>]*title="' \+ label\('previewMode', 'Preview'\) \+ '"[^>]*aria-label="' \+ label\('previewMode', 'Preview'\) \+ '"/);
  assert.match(headerMarkup, /data-action="ai"[^>]*title="' \+ label\('aiAssistant', 'AI Assistant'\) \+ '"[^>]*aria-label="' \+ label\('aiAssistant', 'AI Assistant'\) \+ '"/);
  assert.match(source, /data-action="exit"[\s\S]*?iconMarkup\('maximize', 14, 2\)/);
  assert.match(source, /'sparkles':\s*'<path d="M9\.937 15\.5/);
  assert.match(source, /'maximize':\s*'<path d="M8 3H5a2 2 0 0 0-2 2v3/);
  assert.doesNotMatch(headerMarkup, /data-action="(?:theme|font|history|copy-markdown|wechat|settings|mobile-preview)"/);
  assert.match(
    toolbarMarkup,
    /data-action="wechat"[\s\S]*?data-action="history"[\s\S]*?data-action="theme"[\s\S]*?data-action="font"[\s\S]*?data-action="settings"/
  );
  assert.match(toolbarMarkup, /data-action="wechat"[\s\S]*?data-wechat-icon[\s\S]*?data-wechat-label/);
  assert.match(source, /adapter\.decorateWechatIcon\(root\)/);
  assert.doesNotMatch(source, /decorateWorkspace/);
  [
    ['bold', 'boldShortcutTitle', 'Bold (Ctrl+B)', 'bold', 'Bold'],
    ['italic', 'italicShortcutTitle', 'Italic (Ctrl+I)', 'italic', 'Italic'],
    ['strike', 'strikethrough', 'Strikethrough', 'strikethrough', 'Strikethrough'],
    ['heading', 'headings', 'Headings', 'headings', 'Headings'],
    ['quote', 'quoteTitle', 'Blockquote', 'quote', 'Quote'],
    ['unorderedlist', 'unorderedList', 'Unordered list', 'unorderedList', 'Unordered list'],
    ['orderedlist', 'orderedList', 'Ordered list', 'orderedList', 'Ordered list'],
    ['inlinecode', 'inlineCode', 'Inline code', 'inlineCode', 'Inline code'],
    ['codefence', 'codeFence', 'Code fence', 'codeFence', 'Code fence'],
    ['link', 'link', 'Link', 'link', 'Link'],
    ['image', 'image', 'Image', 'image', 'Image'],
    ['table', 'table', 'Table', 'table', 'Table']
  ].forEach(([command, titleKey, titleFallback, ariaKey, ariaFallback]) => {
    assert.match(
      toolbarMarkup,
      new RegExp(String.raw`data-command="${command}"[^>]*title="' \+ label\('${titleKey}', '${titleFallback.replace(/[()+]/g, '\\$&')}'\) \+ '"[^>]*aria-label="' \+ label\('${ariaKey}', '${ariaFallback}'\) \+ '"`)
    );
  });
  assert.match(toolbarMarkup, /data-action="wechat"[^>]*title="' \+ label\('copyWechatImmersiveTitle', 'Copy current preview content to WeChat'\) \+ '"/);
  assert.match(toolbarMarkup, /data-action="history"[^>]*title="' \+ label\('history', 'History'\) \+ '"/);
  assert.match(toolbarMarkup, /data-action="theme"[^>]*title="' \+ label\('themeTitle', 'Switch theme'\) \+ '"/);
  assert.match(toolbarMarkup, /data-action="font"[^>]*title="' \+ label\('fontTitle', 'Font settings'\) \+ '"/);
  assert.match(toolbarMarkup, /data-action="settings"[^>]*title="' \+ label\('editorSettings', 'Editor settings'\) \+ '"/);
  assert.match(toolbarMarkup, /data-action="wechat"[^>]*>[\s\S]*?<span data-wechat-icon aria-hidden="true"><\/span>[\s\S]*?<span data-wechat-label>' \+ label\('copyWechat', 'Copy to WeChat'\) \+ '<\/span>/);
  assert.doesNotMatch(toolbarMarkup, /data-action="(?:copy-markdown|ai)"/);
  assert.doesNotMatch(toolbarMarkup, /data-action="mobile-preview"/);
  assert.match(toolbarMarkup, /data-action="settings"[^>]*>[\s\S]*?iconMarkup\('settings', 14, 2\)[\s\S]*?iconMarkup\('chevron-down', 10, 2\.5\)/);
  assert.match(source, /'settings':\s*'<path d="M12\.22 2h-\.44/);
  assert.match(source, /'settings':\s*'[\s\S]*?\.22-\.39a2 2 0 0 0-\.73-2\.73l-\.15-\.08[\s\S]*?v-\.5a2 2 0 0 1 1-1\.74/);
  assert.doesNotMatch(toolbarMarkup, /iconMarkup\('sliders-horizontal'/);

  assert.match(css, /__save-status[^}]*height:\s*26\.25px;/s);
  assert.match(css, /__primary-actions[^}]*gap:\s*11\.25px;/s);
  assert.match(css, /__ai-button[^}]*height:\s*26\.25px;/s);
  assert.match(css, /__publish-button[^}]*background:\s*#2563eb;/s);
});

test('settings popover matches the reference checkbox list geometry', () => {
  const source = readFileSync(join(repoRoot, 'assets/js/admin/immersive-workspace.js'), 'utf8');
  const css = readFileSync(join(repoRoot, 'assets/css/admin/immersive-workspace.css'), 'utf8');
  const settingsMarkup = source.slice(
    source.indexOf('data-popover="settings"'),
    source.indexOf('data-popover="appearance"')
  );

  assert.match(source, /data-popover="settings"[^>]*role="dialog"/);
  assert.match(source, /data-setting="outline"[^>]*role="checkbox"[^>]*aria-checked="true"/);
  assert.match(source, /data-setting="word-count"[^>]*role="checkbox"/);
  assert.match(source, /data-setting="split"[^>]*role="checkbox"/);
  assert.match(source, /data-setting="auto-save"[^>]*role="checkbox"/);
  assert.match(source, /data-setting="sync"[^>]*role="checkbox"/);
  assert.match(source, /data-setting="ai-autocomplete"[^>]*role="checkbox"[^>]*aria-checked="false"[^>]*disabled/);
  assert.match(source, /data-setting="ai-autocomplete"[^>]*title="' \+ label\('settingsAiAutocompleteHelp', 'AI autocomplete is not available yet'\) \+ '"/);
  assert.match(source, /label\('settingsWordCount', 'Word count'\)/);
  assert.match(source, /label\('settingsWordCountHelp', 'Show words, characters, and reading time beside the article title'\)/);
  assert.match(source, /label\('autoSave', 'Auto save'\)/);
  assert.match(source, /label\('autoSaveHelp', 'Automatically save local drafts'\)/);
  assert.match(source, /label\('settingsAiAutocomplete', 'AI autocomplete'\)/);
  assert.match(source, /label\('settingsAiAutocompleteHelp', 'AI autocomplete is not available yet'\)/);
  assert.doesNotMatch(source, /setting === 'ai-autocomplete'/);
  assert.match(settingsMarkup, /easymde-immersive-workspace__settings-check/);
  assert.match(settingsMarkup, /iconMarkup\('check', 20, 2\.8\)/);
  assert.doesNotMatch(settingsMarkup, /type="checkbox"/);
  assert.doesNotMatch(settingsMarkup, /role="switch"/);
  assert.match(source, /var outlineEnabled = true;/);
  assert.match(source, /var outlineVisible = false;/);
  assert.match(source, /function renderOutlineState\(\)[\s\S]*is-outline-disabled[\s\S]*is-outline-hidden[\s\S]*setSettingSwitch\('outline', outlineEnabled\)/);
  assert.match(source, /function setOutlineVisible\(visible\)\s*\{\s*outlineVisible = !!visible;\s*renderOutlineState\(\);\s*\}/s);
  assert.match(source, /function setOutlineEnabled\(enabled\)\s*\{\s*outlineEnabled = !!enabled;\s*renderOutlineState\(\);\s*\}/s);
  assert.match(source, /setting === 'outline'[\s\S]*setOutlineEnabled\(enabled\)/);

  assert.match(css, /__settings-popover[^}]*width:\s*300px;/s);
  assert.match(css, /__settings-popover[^}]*border:\s*1px solid #ecedf0;/s);
  assert.match(css, /__settings-popover[^}]*box-shadow:\s*0 16px 40px rgba\(20, 20, 40, 0\.18\);/s);
  assert.match(css, /__settings-popover[^}]*-webkit-locale:\s*"en";/s);
  assert.match(css, /__settings-header[^}]*padding:\s*12px 14px 10px;/s);
  assert.match(css, /__settings-header strong[^}]*font-size:\s*15px;/s);
  assert.match(css, /__settings-header button[^}]*font-weight:\s*500;/s);
  assert.match(css, /__settings-body[^}]*padding:\s*4px 14px 10px;/s);
  assert.match(css, /__settings-row[^}]*gap:\s*8px;[^}]*padding:\s*10px 3px;/s);
  assert.match(css, /__settings-row:not\(:last-child\)[^}]*border-bottom:\s*1px solid #ecedf0;/s);
  assert.match(css, /__settings-row:hover[^}]*background:\s*#f8f9fb;/s);
  assert.match(css, /__settings-check[^}]*width:\s*22px;[^}]*height:\s*22px;/s);
  assert.match(css, /__settings-check \.easymde-immersive-icon[^}]*width:\s*20px;[^}]*height:\s*20px;[^}]*color:\s*#0b6cff;/s);
  assert.match(css, /__settings-copy strong[^}]*font-size:\s*13\.5px;[^}]*font-weight:\s*700;/s);
  assert.match(css, /__settings-copy small[^}]*font-size:\s*11\.5px;[^}]*line-height:\s*1\.4;/s);
});

test('theme picker uses the reference card and custom dropdown structure', () => {
  const source = readFileSync(join(repoRoot, 'assets/js/admin/immersive-workspace.js'), 'utf8');
  const css = readFileSync(join(repoRoot, 'assets/css/admin/immersive-workspace.css'), 'utf8');
  const appendThemeSelect = source.slice(
    source.indexOf('function appendThemeSelect'),
    source.indexOf('function renderThemeFields')
  );

  assert.match(source, /easymde-immersive-workspace__theme-field/);
  assert.match(source, /easymde-immersive-workspace__theme-select-trigger/);
  assert.match(source, /easymde-immersive-workspace__theme-select-backdrop/);
  assert.match(source, /easymde-immersive-workspace__theme-select-menu/);
  assert.match(source, /menu\.setAttribute\('role', 'listbox'\)/);
  assert.match(source, /button\.setAttribute\('role', 'option'\)/);
  assert.match(source, /button\.setAttribute\('aria-selected', active \? 'true' : 'false'\)/);
  assert.doesNotMatch(source, /codeMacStyle|easymde_immersive_code_mac_style|theme-mac/);
  assert.match(source, /strings\.customCssTheme \|\| 'Custom CSS theme'/);
  assert.match(source, /adapter\.updateAppearance\(changes/);

  assert.match(css, /__appearance\.is-theme[^}]*width:\s*280px;/s);
  assert.match(css, /__appearance\.is-theme[^}]*padding:\s*18\.75px;/s);
  assert.match(css, /__appearance\.is-theme[^}]*border-radius:\s*15px;/s);
  assert.match(css, /__appearance\s*\{[^}]*font-family:\s*ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji";/s);
  assert.match(css, /__theme-select-trigger[^}]*height:\s*36\.5px;/s);
  assert.match(css, /__theme-select-trigger[^}]*font-weight:\s*500;/s);
  assert.match(css, /__theme-select-trigger:hover[^}]*border-color:\s*#d1d5db;/s);
  assert.match(css, /__theme-select-menu[^}]*max-height:\s*260px;/s);
  assert.match(css, /__theme-select-menu[^}]*top:\s*100%;/s);
  assert.match(css, /__theme-select-menu[^}]*margin-top:\s*3\.75px;/s);
  assert.match(css, /__theme-select-menu[^}]*padding:\s*3\.75px 0;/s);
  assert.match(css, /__theme-select-menu[^}]*border:\s*1px solid #e3e7ee;/s);
  assert.match(css, /__theme-select-menu[^}]*border-radius:\s*5\.625px;/s);
  assert.match(css, /__theme-select-menu[^}]*background:\s*#fff;/s);
  assert.match(css, /__theme-select-menu[^}]*box-shadow:\s*0 10px 30px rgba\(50, 65, 90, 0\.14\);/s);
  assert.match(css, /__theme-option[^}]*padding:\s*9px 15px;/s);
  assert.match(css, /__theme-option[^}]*color:\s*#56637a;/s);
  assert.match(css, /__theme-option[^}]*font-weight:\s*500;/s);
  assert.match(css, /__theme-option\[aria-selected="true"\][^}]*background:\s*#f7f9fc;/s);
  assert.match(css, /__theme-option:hover,[\s\S]*__theme-option:focus-visible[^}]*background:\s*#f2f5f9;/s);
  assert.match(css, /__theme-check[^}]*color:\s*#56637a;/s);
  assert.match(css, /__theme-select-backdrop[^}]*position:\s*fixed;[^}]*z-index:\s*60;[^}]*inset:\s*0;/s);
  assert.doesNotMatch(css, /__theme-mac/);
  assert.match(
    appendThemeSelect,
    /listen\(button, 'click', function \(event\) \{\s*event\.stopPropagation\(\);/,
    'theme option clicks must not bubble after the option menu rerenders'
  );
  assert.match(source, /var activeThemeMenu = root\.querySelector\('\.easymde-immersive-workspace__theme-select-menu:not\(\[hidden\]\)'\);/);
  assert.match(
    source,
    /else if \(activeThemeMenu\) \{\s*closeThemeSelectMenu\(activeThemeMenu, true\);\s*\} else if \(activeFontMenu\)/s,
    'Escape should close a nested theme menu before closing its appearance popover'
  );
});

test('font picker uses the reference rows and custom dropdown geometry', () => {
  const source = readFileSync(join(repoRoot, 'assets/js/admin/immersive-workspace.js'), 'utf8');
  const css = readFileSync(join(repoRoot, 'assets/css/admin/immersive-workspace.css'), 'utf8');
  const appendAppearanceSelect = source.slice(
    source.indexOf('function appendAppearanceSelect'),
    source.indexOf('function appearanceSwatch')
  );

  assert.match(source, /easymde-immersive-workspace__font-row/);
  assert.match(source, /easymde-immersive-workspace__font-select-trigger/);
  assert.match(source, /easymde-immersive-workspace__font-select-menu/);
  assert.match(source, /easymde-immersive-workspace__font-option/);
  assert.match(source, /strings\.fontStackHelp \|\|/);
  assert.match(appendAppearanceSelect, /option\.fontFamily/);
  assert.match(appendAppearanceSelect, /option\.fontWeight/);
  assert.match(appendAppearanceSelect, /iconMarkup\('check', 11, 2\)/);
  assert.match(appendAppearanceSelect, /event\.stopPropagation\(\)/);
  assert.doesNotMatch(appendAppearanceSelect, /createElement\('select'\)/);
  assert.doesNotMatch(appendAppearanceSelect, /createElement\('option'\)/);

  assert.match(css, /__appearance\.is-font[^}]*width:\s*360px;/s);
  assert.match(css, /__appearance\.is-font[^}]*padding:\s*18\.75px;/s);
  assert.match(css, /__appearance\.is-font[^}]*border-radius:\s*15px;/s);
  assert.match(css, /__font-row[^}]*gap:\s*11\.25px;/s);
  assert.match(css, /__font-row[^}]*margin-bottom:\s*11\.25px;/s);
  assert.match(css, /__font-label[^}]*width:\s*80px;/s);
  assert.match(css, /__font-label[^}]*font-size:\s*13px;/s);
  assert.match(css, /__font-select-trigger[^}]*height:\s*35\.5px;/s);
  assert.match(css, /__font-select-trigger[^}]*padding:\s*7px 11\.25px;/s);
  assert.match(css, /__font-select-trigger[^}]*border:\s*1px solid #e3e7ee;/s);
  assert.match(css, /__font-select-trigger[^}]*background:\s*#fff;/s);
  assert.match(css, /__font-select-trigger[^}]*color:\s*#56637a;/s);
  assert.match(css, /__font-select-trigger:hover[^}]*border-color:\s*#e3e7ee;/s);
  assert.match(css, /__font-select-trigger\[aria-expanded="true"\][^}]*border-color:\s*#b8c2d3;/s);
  assert.match(css, /__font-select-trigger > svg[^}]*color:\s*#a9b5c8;/s);
  assert.match(css, /__font-select-backdrop[^}]*z-index:\s*60;/s);
  assert.match(css, /__font-select-menu[^}]*max-height:\s*280px;/s);
  assert.match(css, /__font-select-menu[^}]*z-index:\s*70;/s);
  assert.match(css, /__font-select-menu[^}]*padding:\s*3\.75px 0;/s);
  assert.match(css, /__font-select-menu[^}]*border:\s*1px solid #e3e7ee;/s);
  assert.match(css, /__font-select-menu[^}]*border-radius:\s*5\.625px;/s);
  assert.match(css, /__font-select-menu[^}]*background:\s*#fff;/s);
  assert.match(css, /__font-select-menu[^}]*box-shadow:\s*0 10px 30px rgba\(50, 65, 90, 0\.14\);/s);
  assert.match(css, /__font-option[^}]*padding:\s*9px 15px;/s);
  assert.match(css, /__font-option[^}]*color:\s*#56637a;/s);
  assert.match(css, /__font-option[^}]*font-size:\s*13px;/s);
  assert.match(css, /__font-option\[aria-selected="true"\][^}]*background:\s*#f7f9fc;[^}]*color:\s*#46546b;/s);
  assert.match(css, /__font-option:hover,[\s\S]*__font-option:focus-visible[^}]*background:\s*#f2f5f9;/s);
  assert.match(css, /__font-check[^}]*color:\s*inherit;/s);
  assert.match(css, /__font-help[^}]*font-size:\s*11\.5px;/s);
  assert.match(css, /__font-help[^}]*line-height:\s*18\.6875px;/s);
});

test('custom CSS modal matches the reference geometry and keeps preview separate from persistence', () => {
  const source = readFileSync(join(repoRoot, 'assets/js/admin/immersive-workspace.js'), 'utf8');
  const css = readFileSync(join(repoRoot, 'assets/css/admin/immersive-workspace.css'), 'utf8');

  assert.match(source, /easymde-immersive-workspace__custom-css-backdrop/);
  assert.match(source, /easymde-immersive-workspace__custom-css-modal/);
  assert.match(source, /data-custom-css-name/);
  assert.match(source, /label\('customCssNamePlaceholder', 'Enter theme name…'\)/);
  assert.match(source, /class="easymde-immersive-workspace__custom-css-code" data-custom-css-code/);
  assert.match(source, /data-custom-css-preview-style/);
  assert.match(source, /data-custom-css-preview-content/);
  assert.match(source, /adapter\.previewCustomCss\(css\)/);
  assert.match(source, /previewStyle\.textContent = String\(response\.scopedCss \|\| ''\)/);
  assert.doesNotMatch(source, /previewStyle\.innerHTML\s*=/);
  assert.match(source, /adapter\.saveCustomCss\(input, \{ preview: preview, markdown: source\.value \}\)/);
  assert.match(source, /sequence !== customCssPreviewSequence/);
  assert.match(source, /customCssDialog && customCssDialog\.contains\(event\.target\)/);
  assert.match(source, /customCssBackdrop && customCssBackdrop\.contains\(event\.target\)/);

  assert.match(css, /__custom-css-modal[^}]*width:\s*min\(1000px, 94vw\);/s);
  assert.match(css, /__custom-css-modal[^}]*height:\s*min\(680px, 92vh\);/s);
  assert.match(css, /__custom-css-modal[^}]*border-radius:\s*15px;/s);
  assert.match(css, /__custom-css-editor-pane[^}]*width:\s*42%;/s);
  assert.match(css, /__custom-css-modal > header[^}]*padding:\s*15px 22\.5px;/s);
  assert.match(css, /__custom-css-modal > header button[^}]*cursor:\s*default;/s);
  assert.match(css, /__custom-css-name-wrap[^}]*padding:\s*15px 18\.75px 11\.25px;/s);
  assert.match(css, /__custom-css-code[^}]*font-size:\s*12\.5px;/s);
  assert.match(css, /__custom-css-code:focus-visible\s*\{[^}]*outline:\s*2px solid #60a5fa;[^}]*outline-offset:\s*-2px;/s);
  assert.match(css, /__custom-css-preview-scroll[^}]*padding:\s*22\.5px;/s);
  assert.match(css, /__custom-css-modal > footer[^}]*padding:\s*15px 22\.5px;/s);
  assert.match(css, /__custom-css-modal > footer button[^}]*cursor:\s*default;/s);
});

test('history workspace matches the reference two-column revision browser', () => {
  const source = readFileSync(join(repoRoot, 'assets/js/admin/immersive-workspace.js'), 'utf8');
  const css = readFileSync(join(repoRoot, 'assets/css/admin/immersive-workspace.css'), 'utf8');

  assert.match(source, /easymde-immersive-workspace__history-backdrop/);
  assert.match(source, /easymde-immersive-workspace__history-sidebar/);
  assert.match(source, /easymde-immersive-workspace__history-filter-menu/);
  assert.match(source, /easymde-immersive-workspace__history-detail/);
  assert.match(source, /data-history-preview/);
  assert.match(source, /data-action="restore-history"/);
  assert.match(source, /adapter\.getRevision\(entry\.id\)/);
  assert.match(source, /adapter\.openRevision\(historySelectedId\)/);

  assert.match(css, /__history\s*\{[^}]*width:\s*min\(960px, calc\(100vw - 60px\)\);[^}]*height:\s*calc\(100vh - 60px\);/s);
  assert.match(css, /__history-backdrop\s*\{[^}]*background:\s*rgba\(17, 24, 39, 0\.35\);[^}]*backdrop-filter:\s*blur\(2px\);/s);
  assert.match(css, /__history\s*\{[^}]*border:\s*1px solid #e3e7ee;[^}]*border-radius:\s*9\.625px;[^}]*box-shadow:\s*0 24px 70px rgba\(31, 45, 70, 0\.24\);/s);
  assert.match(css, /__history-sidebar\s*\{[^}]*width:\s*240px;[^}]*border-right:\s*1px solid #e3e7ee;[^}]*background:\s*#f7f9fc;/s);
  assert.match(css, /__history-sidebar-header strong\s*\{[^}]*color:\s*#172033;/s);
  assert.match(css, /__history-sidebar-header > div > svg\s*\{[^}]*color:\s*#7d8aa4;/s);
  assert.match(css, /__history-sidebar-header > button\s*\{[^}]*color:\s*#7d8aa4;/s);
  assert.match(css, /__history-sidebar-header > button:hover\s*\{[^}]*background:\s*#edf1f6;[^}]*color:\s*#172033;/s);
  assert.match(css, /__history-summary > span\s*\{[^}]*color:\s*#7d8aa4;/s);
  assert.match(css, /__history-filter > button\s*\{[^}]*height:\s*26\.25px;[^}]*padding:\s*0 9\.375px;[^}]*border:\s*1px solid #e3e7ee;[^}]*border-radius:\s*3\.75px;[^}]*background:\s*#fff;[^}]*color:\s*#56637a;/s);
  assert.match(css, /__history-filter > button:hover\s*\{[^}]*border-color:\s*#cbd3df;[^}]*color:\s*#172033;/s);
  assert.match(css, /__history-filter-menu\s*\{[^}]*border:\s*1px solid #e3e7ee;[^}]*border-radius:\s*5\.625px;[^}]*box-shadow:\s*0 10px 28px rgba\(50, 65, 90, 0\.14\);/s);
  assert.match(css, /__history-filter-menu button\s*\{[^}]*color:\s*#56637a;/s);
  assert.match(css, /__history-filter-menu button:hover\s*\{[^}]*background:\s*#f2f5f9;/s);
  assert.match(css, /__history-filter-menu button\.is-active\s*\{[^}]*background:\s*#fdf1f0;[^}]*color:\s*#e11d2e;/s);
  assert.match(css, /__history-separator\s*\{[^}]*background:\s*#e7ebf1;/s);
  assert.match(css, /__history-list\.is-empty\s*\{[^}]*color:\s*#7d8aa4;/s);
  assert.match(css, /__history-group\s*\{[^}]*color:\s*#7d8aa4;/s);
  assert.match(css, /__history-entry\s*\{[^}]*border-bottom:\s*1px solid #e7ebf1;/s);
  assert.match(css, /__history-entry:hover\s*\{[^}]*background:\s*#f1f4f8;/s);
  assert.match(css, /__history-entry\.is-active\s*\{[^}]*border-left-color:\s*#e11d2e;[^}]*background:\s*#fdf1f0;/s);
  assert.match(css, /__history-entry-main > svg\s*\{[^}]*color:\s*#71809a;/s);
  assert.match(css, /__history-entry-main strong\s*\{[^}]*color:\s*#28364a;/s);
  assert.match(css, /__history-entry:not\(\[data-revision-type="auto"\]\)[^}]*\{[^}]*color:\s*#e11d2e;/s);
  assert.match(css, /__history-entry-main small\s*\{[^}]*color:\s*#7d8aa4;/s);
  assert.match(css, /__history-entry-date\s*\{[^}]*color:\s*#71809a;/s);
  assert.match(css, /__history-detail-header\s*\{[^}]*min-height:\s*70\.375px;[^}]*padding:\s*15px 26\.25px;[^}]*border-bottom:\s*1px solid #e3e7ee;/s);
  assert.match(css, /__history-detail-header strong\s*\{[^}]*color:\s*#172033;/s);
  assert.match(css, /__history-detail-header > div > span\s*\{[^}]*color:\s*#7d8aa4;/s);
  assert.match(css, /__history-restore\s*\{[^}]*height:\s*30px;[^}]*background:\s*#e11d2e;[^}]*box-shadow:\s*0 3px 10px rgba\(225, 29, 46, 0\.22\);/s);
  assert.match(css, /__history-restore:hover\s*\{[^}]*background:\s*#c91525;/s);
  assert.match(css, /__history-preview-scroll\s*\{[^}]*padding:\s*30px 37\.5px;/s);
  assert.match(css, /__history-preview\.is-status\s*\{[^}]*color:\s*#7d8aa4;[^}]*font-size:\s*12px;[^}]*line-height:\s*18px;/s);
  assert.match(css, /__history-preview h2\s*\{[^}]*border-bottom:\s*2px solid #e11d2e;/s);
  assert.match(css, /__history-preview blockquote\s*\{[^}]*border-left:\s*3px solid #e11d2e;[^}]*background:\s*#fdf1f0;/s);
  assert.match(css, /__history-preview ul li::before\s*\{[^}]*color:\s*#e11d2e;/s);
  assert.match(css, /__history-preview code\s*\{[^}]*color:\s*#e11d2e;/s);
  assert.match(css, /__history-preview a\s*\{\s*color:\s*#e11d2e;\s*\}/s);
  assert.doesNotMatch(css, /__history\s*\{[^}]*width:\s*min\(620px/);
});

test('AI assistant matches the reference local-only panel and interaction structure', () => {
  const source = readFileSync(join(repoRoot, 'assets/js/admin/immersive-workspace.js'), 'utf8');
  const css = readFileSync(join(repoRoot, 'assets/css/admin/immersive-workspace.css'), 'utf8');
  const aiStart = source.indexOf('<aside class="easymde-immersive-workspace__ai"');
  const aiEnd = source.indexOf('<div class="easymde-immersive-workspace__custom-css-backdrop"', aiStart);
  const aiMarkup = source.slice(aiStart, aiEnd);
  const sendStart = source.indexOf('function sendAiMessage');
  const sendEnd = source.indexOf('\n        function ', sendStart + 20);
  const sendImplementation = source.slice(sendStart, sendEnd);

  assert.match(source, /function aiLogoMarkup[\s\S]*easymde-immersive-workspace__ai-logo/);
  assert.match(source, /aiLogoSequence \+= 1;[\s\S]*gradientId = 'easymde-ai-grad-' \+ String\(aiLogoSequence\);/);
  assert.doesNotMatch(source, /id="easymde-ai-grad"/);
  assert.match(aiMarkup, /aiLogoMarkup\(40\)/);
  assert.match(aiMarkup, /data-action="ai-pin"[^>]*aria-pressed="false"/);
  assert.match(source, /pin\.setAttribute\(\s*'aria-label',\s*aiPinned\s*\? \(strings\.aiUnpin \|\| '取消固定 AI 助手'\)\s*:\s*\(strings\.aiPin \|\| '固定 AI 助手'\)\s*\);/s);
  assert.match(source, /pin_icon\.setAttribute\('fill', aiPinned \? 'currentColor' : 'none'\);/);
  assert.match(aiMarkup, /data-action="ai-settings"[^>]*title="' \+ label\('aiSettingsUnavailableTitle', '设置功能尚未接入'\) \+ '"[^>]*aria-label="' \+ label\('aiSettingsUnavailable', 'AI 设置（尚未接入）'\) \+ '"[^>]*disabled/);
  assert.match(aiMarkup, /data-action="close-ai"/);
  assert.match(aiMarkup, /easymde-immersive-workspace__ai-greeting[\s\S]*Hi！我是你的创作伙伴/);
  assert.match(aiMarkup, /id="easymde-ai-start-heading"[\s\S]*开始创作/);
  assert.match(aiMarkup, /data-ai-prompt="请为当前文章生成结构清晰的大纲和多个吸引人的标题"/);
  assert.match(aiMarkup, /data-ai-prompt="请根据当前文章内容撰写引言并补充必要的背景信息"/);
  assert.match(aiMarkup, /data-ai-prompt="请识别当前文章中的核心概念，并进行简明解释与扩展"/);
  assert.match(aiMarkup, /id="easymde-ai-quick-heading"[\s\S]*aiSmartLayout[\s\S]*aiOptimizeArticle[\s\S]*aiExtractSummary/);
  assert.match(aiMarkup, /iconMarkup\('wand-sparkles', 15, 2\.1, '', '#6848ff'\)/);
  assert.match(aiMarkup, /iconMarkup\('align-left', 15, 2\.1, '', '#08bf82'\)/);
  assert.match(aiMarkup, /iconMarkup\('file-text', 15, 2\.1, '', '#5a43f4'\)/);
  assert.match(aiMarkup, /<textarea id="easymde-immersive-ai-input"[\s\S]*rows="2"/);
  assert.match(aiMarkup, /data-action="ai-context"[^>]*aria-haspopup="menu"/);
  assert.match(aiMarkup, /data-ai-menu="context"[\s\S]*<div>' \+ label\('add', '添加'\) \+ '<\/div>[\s\S]*<div>' \+ label\('skills', '技能'\) \+ '<\/div>/);
  assert.doesNotMatch(aiMarkup, /data-ai-menu="context"[\s\S]*<span>' \+ label\('(?:add|skills)'/);
  assert.match(source, /'at-sign':\s*'<circle cx="12" cy="12" r="4"><\/circle><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"><\/path>'/);
  ['Documents', 'PDF', 'Spreadsheets', 'Presentations'].forEach((skill) => {
    assert.match(
      aiMarkup,
      new RegExp('data-ai-skill="' + skill + '">' + "' \\+ iconMarkup\\('at-sign', 16, 2, '', '#6848f5'\\) \\+ '" + skill)
    );
  });
  assert.doesNotMatch(aiMarkup, /data-ai-skill="(?:Documents|PDF|Spreadsheets|Presentations)">@ /);
  assert.match(aiMarkup, /data-action="ai-mode"[^>]*aria-haspopup="listbox"[^>]*>.*iconMarkup\('sparkles', 15, 2, 'easymde-immersive-workspace__ai-mode-icon', '#6848f5'\)/);
  assert.match(aiMarkup, /data-ai-mode="ask"[\s\S]*data-ai-mode="agent"/);
  assert.match(source, /mode_icon\.outerHTML = aiMode === 'ask'\s*\? iconMarkup\('sparkles', 15, 2, 'easymde-immersive-workspace__ai-mode-icon', '#6848f5'\)\s*:\s*iconMarkup\('bot', 15, 2, 'easymde-immersive-workspace__ai-mode-icon', '#50607d'\);/s);
  assert.match(aiMarkup, /data-action="ai-config"[^>]*aria-haspopup="menu"/);
  assert.match(aiMarkup, /data-action="ai-config"[^>]*>.*iconMarkup\('brain', 14, 2\.1, '', '#7355f5'\)/);
  assert.match(aiMarkup, /data-ai-config-menu[^>]*>[\s\S]*<div>' \+ label\('aiGenerationSettings', '生成设置'\) \+ '<\/div>/);
  assert.match(aiMarkup, /class="easymde-immersive-workspace__ai-config-menu-item"[^>]*data-action="ai-open-model"[\s\S]*iconMarkup\('chevron-right', 15, 2, '', '#99a3b6'\)/);
  assert.match(aiMarkup, /class="easymde-immersive-workspace__ai-config-menu-item"[^>]*data-action="ai-open-thinking"[\s\S]*iconMarkup\('chevron-right', 15, 2, '', '#99a3b6'\)/);
  assert.match(aiMarkup, /data-ai-config-menu[\s\S]*data-ai-model-menu[\s\S]*data-ai-thinking-menu/);
  assert.match(aiMarkup, /data-ai-send/);
  assert.match(aiMarkup, /DeepSeek-V3\.2[\s\S]*GPT-5\.6 Sol[\s\S]*GPT-5\.5[\s\S]*GPT-5\.4[\s\S]*GPT-5\.3[\s\S]*o3/);
  assert.match(aiMarkup, /data-ai-model="deepseek-v3"[^>]*>[\s\S]*<span class="easymde-immersive-workspace__ai-model-dot"><\/span>[\s\S]*<span class="easymde-immersive-workspace__ai-model-badge">推荐<\/span>[\s\S]*iconMarkup\('check', 14, 2, 'easymde-immersive-workspace__ai-model-check', '#6548f5'\)/);
  assert.match(aiMarkup, /data-ai-model="gpt-5-6-sol"[^>]*>[\s\S]*<span class="easymde-immersive-workspace__ai-model-badge">最新<\/span>/);
  assert.match(aiMarkup, /data-ai-model="gpt-5-4"[^>]*>[\s\S]*<span class="easymde-immersive-workspace__ai-model-note">将于 7 月 23 日下线<\/span>/);
  assert.match(source, /root\.querySelectorAll\('\.easymde-immersive-workspace__ai-model-check'\)\.forEach\(function \(check\) \{\s*check\.remove\(\);\s*\}\);[\s\S]*selected\.insertAdjacentHTML\('beforeend', iconMarkup\('check', 14, 2, 'easymde-immersive-workspace__ai-model-check', '#6548f5'\)\);/s);
  assert.match(source, /function sendAiMessage/);
  assert.match(source, /end\.setAttribute\('data-ai-messages-end', ''\);/);
  assert.match(css, /__ai-messages\[hidden\]\s*\{\s*display:\s*none;\s*\}/s);
  assert.doesNotMatch(sendImplementation, /source|adapter|fetch|apiFetch|XMLHttpRequest/);
  assert.match(sendImplementation, /Thank you for your input! This is a demo interface\. Once connected to an AI service, real writing suggestions will appear here\./);
  assert.match(source, /var activeAiMenu = root\.querySelector\('\[data-ai-menu\]:not\(\[hidden\]\)'\);/);
  assert.match(source, /if \(activeAiMenu && !aiMenuOrigin\) \{\s*closeAiMenus\(false\);\s*\}/s);

  assert.match(css, /__ai\s*\{[^}]*top:\s*52px;[^}]*right:\s*0;[^}]*bottom:\s*0;[^}]*width:\s*min\(440px, 100vw\);[^}]*overflow:\s*hidden;[^}]*border-left:\s*1px solid #dbe3f2;[^}]*box-shadow:\s*-10px 0 30px rgba\(45, 61, 97, 0\.1\);/s);
  assert.match(css, /__ai-header\s*\{[^}]*height:\s*72px;[^}]*flex:\s*0 0 72px;[^}]*padding:\s*0 18\.75px;[^}]*border-bottom:\s*1px solid #e8edf5;/s);
  assert.match(css, /__ai-heading\s*\{[^}]*gap:\s*11\.25px;/s);
  assert.match(css, /__ai-heading strong\s*\{[^}]*color:\s*#111a35;[^}]*font-size:\s*21px;[^}]*font-weight:\s*700;[^}]*line-height:\s*22\.5px;[^}]*letter-spacing:\s*-0\.42px;/s);
  assert.match(css, /button\.easymde-immersive-workspace__ai-header-button\s*\{[^}]*width:\s*33\.75px;[^}]*height:\s*33\.75px;[^}]*border-radius:\s*5\.625px;[^}]*color:\s*#273552;[^}]*cursor:\s*default;/s);
  assert.match(css, /button\.easymde-immersive-workspace__ai-header-button:hover:not\(:disabled\)\s*\{[^}]*background:\s*#f5f3ff;/s);
  assert.match(css, /button\.easymde-immersive-workspace__ai-header-button\.is-active\s*\{[^}]*color:\s*#6848f5;/s);
  assert.doesNotMatch(css, /button\.easymde-immersive-workspace__ai-header-button\.is-active\s*\{[^}]*background:/s);
  assert.match(css, /button\.easymde-immersive-workspace__ai-header-button:focus-visible\s*\{[^}]*outline:\s*0;[^}]*box-shadow:\s*0 0 0 2px #8067f8;/s);
  assert.match(css, /__ai-prompt-card\s*\{[^}]*min-height:\s*72px;[^}]*border-radius:\s*14px;[^}]*font-weight:\s*500;/s);
  assert.match(css, /__ai-prompt-card:hover\s*\{[^}]*transform:\s*translateY\(-1px\);[^}]*box-shadow:\s*0 1px 3px rgba\(0, 0, 0, 0\.1\), 0 1px 2px -1px rgba\(0, 0, 0, 0\.1\);/s);
  assert.match(css, /__ai-prompt-card:focus-visible\s*\{[^}]*outline:\s*0;[^}]*box-shadow:\s*0 0 0 2px #8067f8;/s);
  assert.match(css, /__ai-body\s*\{[^}]*padding:\s*18px;[^}]*scrollbar-width:\s*thin;/s);
  assert.match(css, /__ai-greeting h3\s*\{[^}]*font-size:\s*21px;[^}]*font-weight:\s*700;[^}]*line-height:\s*31\.5px;[^}]*letter-spacing:\s*-0\.42px;/s);
  assert.match(css, /__ai-prompt-card\s*\{[^}]*width:\s*calc\(100% - 20px\);[^}]*min-height:\s*72px;[^}]*gap:\s*13\.125px;[^}]*padding:\s*0 13\.125px;[^}]*border-radius:\s*14px;/s);
  assert.match(css, /__ai-prompt-card\.is-outline\s*\{[^}]*border-color:\s*#d9ccff;[^}]*background:\s*linear-gradient\(105deg, #fbf9ff 0%, #f7f3ff 100%\);/s);
  assert.match(css, /__ai-prompt-card\.is-introduction\s*\{[^}]*border-color:\s*#a9ead8;[^}]*background:\s*linear-gradient\(105deg, #f7fffc 0%, #effcf8 100%\);/s);
  assert.match(css, /__ai-prompt-card\.is-concepts\s*\{[^}]*border-color:\s*#f5d58e;[^}]*background:\s*linear-gradient\(105deg, #fffdf8 0%, #fff8e9 100%\);/s);
  assert.match(css, /__ai-quick-actions button\s*\{[^}]*height:\s*38px;[^}]*gap:\s*7\.5px;[^}]*border:\s*1px solid #dbe2ef;[^}]*border-radius:\s*9px;[^}]*cursor:\s*default;[^}]*font-size:\s*12\.5px;/s);
  assert.match(css, /__ai-quick-actions button:focus-visible\s*\{[^}]*outline:\s*0;[^}]*box-shadow:\s*0 0 0 2px #8067f8;/s);
  assert.match(css, /__ai-composer\s*\{[^}]*padding:\s*0 18px 11\.25px;/s);
  assert.match(css, /__ai-input-wrap\s*\{[^}]*box-sizing:\s*border-box;[^}]*height:\s*112px;[^}]*border:\s*1px solid #d9dfeb;[^}]*border-radius:\s*14px;[^}]*box-shadow:\s*0 5px 15px rgba\(47, 62, 94, 0\.06\);/s);
  assert.match(aiMarkup, /placeholder="' \+ label\('aiWritingPlaceholder', 'Describe what you want to create\.\.\.'\) \+ '"/);
  assert.match(css, /__ai-input-wrap textarea\s*\{[^}]*min-height:\s*67px;[^}]*padding:\s*11\.25px 15px 3\.75px 52px;[^}]*border-radius:\s*0;[^}]*font-size:\s*13\.5px;[^}]*line-height:\s*18\.75px;/s);
  assert.match(css, /__ai-input-wrap textarea:focus,[\s\S]*__ai-input-wrap textarea:focus-visible\s*\{[^}]*border:\s*0;[^}]*box-shadow:\s*none;[^}]*outline:\s*0;/s);
  assert.match(css, /__ai-input-wrap:focus-within\s*\{[^}]*border-color:\s*#8b72fa;[^}]*box-shadow:\s*0 7px 20px rgba\(104, 72, 245, 0\.14\);/s);
  assert.match(css, /__ai-composer-footer\s*\{[^}]*height:\s*41\.25px;[^}]*padding:\s*0 9\.375px 7\.5px;/s);
  assert.match(css, /button\.easymde-immersive-workspace__ai-context-button\s*\{[^}]*width:\s*30px;[^}]*height:\s*30px;[^}]*border-radius:\s*8px;[^}]*background:\s*#f3f4f7;[^}]*cursor:\s*default;/s);
  assert.match(css, /button\.easymde-immersive-workspace__ai-context-button:focus-visible\s*\{[^}]*outline:\s*0;[^}]*box-shadow:\s*0 0 0 2px #8067f8;/s);
  assert.match(css, /__ai-context-menu > div\s*\{[^}]*display:\s*block;[^}]*font-size:\s*11px;[^}]*font-weight:\s*500;/s);
  assert.match(css, /button\.easymde-immersive-workspace__ai-context-menu-item\s*\{[^}]*height:\s*33\.75px;[^}]*gap:\s*9\.375px;[^}]*padding:\s*0 7\.5px;[^}]*border-radius:\s*7px;[^}]*cursor:\s*default;[^}]*font-size:\s*12\.5px;[^}]*font-weight:\s*500;/s);
  assert.match(css, /__ai-context-menu button \+ div\s*\{[^}]*margin-top:\s*3\.75px;[^}]*padding-top:\s*7\.5px;[^}]*border-top:\s*1px solid #edf0f5;/s);
  assert.doesNotMatch(css, /__ai-context-menu \[data-ai-skill\] \.easymde-immersive-icon/);
  assert.match(css, /__ai-mode-menu\s*\{[^}]*bottom:\s*44px;[^}]*width:\s*126px;[^}]*padding:\s*5\.625px;[^}]*border:\s*1px solid #d7dce7;[^}]*border-radius:\s*9px;[^}]*box-shadow:\s*0 10px 24px rgba\(25, 35, 58, 0\.18\);/s);
  assert.match(css, /button\.easymde-immersive-workspace__ai-mode-trigger\s*\{[^}]*cursor:\s*default;/s);
  assert.match(css, /button\.easymde-immersive-workspace__ai-mode-trigger:focus-visible\s*\{[^}]*outline:\s*0;[^}]*box-shadow:\s*0 0 0 2px #8067f8,\s*0 1px 3px rgba\(0, 0, 0, 0\.1\),\s*0 1px 2px -1px rgba\(0, 0, 0, 0\.1\);/s);
  assert.match(css, /button\.easymde-immersive-workspace__ai-mode-option\s*\{[^}]*height:\s*33\.75px;[^}]*gap:\s*7\.5px;[^}]*padding:\s*0 9\.375px;[^}]*border-radius:\s*6px;[^}]*color:\s*#4b556b;[^}]*cursor:\s*default;[^}]*font-size:\s*13px;[^}]*font-weight:\s*500;/s);
  assert.match(css, /button\.easymde-immersive-workspace__ai-config-trigger\s*\{[^}]*cursor:\s*default;/s);
  assert.match(css, /button\.easymde-immersive-workspace__ai-config-trigger:focus-visible\s*\{[^}]*outline:\s*0;[^}]*box-shadow:\s*0 0 0 2px #8067f8;/s);
  assert.match(css, /__ai-config-menu > div\s*\{[^}]*padding:\s*0 7\.5px 5\.625px;[^}]*font-size:\s*11px;[^}]*font-weight:\s*500;/s);
  assert.match(css, /button\.easymde-immersive-workspace__ai-config-menu-item\s*\{[^}]*min-height:\s*48px;[^}]*gap:\s*9\.375px;[^}]*padding:\s*0 9\.375px;[^}]*border-radius:\s*8px;[^}]*cursor:\s*default;[^}]*font-weight:\s*500;/s);
  assert.match(css, /__ai-config-menu small\s*\{[^}]*color:\s*#929caf;[^}]*font-size:\s*11px;[^}]*font-weight:\s*500;[^}]*line-height:\s*16\.5px;/s);
  assert.match(css, /__ai-choice-menu \.easymde-immersive-workspace__ai-menu-back\s*\{[^}]*height:\s*30px;[^}]*gap:\s*5\.625px;[^}]*margin-bottom:\s*3\.75px;[^}]*padding:\s*0 5\.625px;[^}]*border-radius:\s*7px;[^}]*color:\s*#26334e;/s);
  assert.match(css, /button\.easymde-immersive-workspace__ai-menu-back\s*\{[^}]*cursor:\s*default;/s);
  assert.match(css, /button\.easymde-immersive-workspace__ai-model-option\s*\{[^}]*min-height:\s*33\.75px;[^}]*gap:\s*7\.5px;[^}]*padding:\s*0 7\.5px;[^}]*border-radius:\s*7px;[^}]*color:\s*#3f4b63;[^}]*cursor:\s*default;[^}]*font-size:\s*12\.5px;[^}]*font-weight:\s*500;/s);
  assert.match(css, /__ai-model-dot\s*\{[^}]*width:\s*7\.5px;[^}]*height:\s*7\.5px;[^}]*border-radius:\s*9999px;[^}]*background:\s*#0bce8a;/s);
  assert.match(css, /__ai-model-badge\s*\{[^}]*padding:\s*1\.875px 5\.625px;[^}]*border-radius:\s*3\.75px;[^}]*font-size:\s*9\.5px;[^}]*font-weight:\s*500;[^}]*line-height:\s*14\.25px;/s);
  assert.match(css, /__ai-model-note\s*\{[^}]*margin-left:\s*auto;[^}]*color:\s*#97a2b8;[^}]*font-size:\s*9\.5px;/s);
  assert.match(css, /__ai-model-check\s*\{[^}]*margin-left:\s*auto;[^}]*color:\s*#6548f5;/s);
  assert.match(aiMarkup, /__ai-thinking-options[^>]*>[\s\S]*data-ai-thinking="off"[\s\S]*data-ai-thinking="short"[\s\S]*data-ai-thinking="standard"[\s\S]*data-ai-thinking="long"/);
  assert.match(aiMarkup, /class="easymde-immersive-workspace__ai-thinking-option"[^>]*data-ai-thinking="off"[^>]*>[\s\S]*<span class="easymde-immersive-workspace__ai-thinking-title">关闭<\/span><span class="easymde-immersive-workspace__ai-thinking-note">不启用额外思考，直接生成回答<\/span>/);
  assert.match(aiMarkup, /data-ai-thinking="standard"[^>]*>[\s\S]*iconMarkup\('check', 15, 2, 'easymde-immersive-workspace__ai-thinking-check', '#6548f5'\)/);
  assert.match(source, /root\.querySelectorAll\('\.easymde-immersive-workspace__ai-thinking-check'\)\.forEach\(function \(check\) \{\s*check\.remove\(\);\s*\}\);[\s\S]*selected\.insertAdjacentHTML\('beforeend', iconMarkup\('check', 15, 2, 'easymde-immersive-workspace__ai-thinking-check', '#6548f5'\)\);/s);
  assert.match(css, /button\.easymde-immersive-workspace__ai-thinking-option\s*\{[^}]*min-height:\s*48px;[^}]*justify-content:\s*space-between;[^}]*padding:\s*0 9\.375px;[^}]*border-radius:\s*8px;[^}]*cursor:\s*default;[^}]*font-size:\s*15px;[^}]*line-height:\s*22\.5px;/s);
  assert.match(css, /__ai-thinking-options > button:not\(:last-child\)\s*\{[^}]*margin-bottom:\s*3\.75px;/s);
  assert.match(css, /__ai-thinking-title\s*\{[^}]*font-size:\s*12\.5px;[^}]*font-weight:\s*500;[^}]*line-height:\s*18\.75px;/s);
  assert.match(css, /__ai-thinking-note\s*\{[^}]*margin-top:\s*1\.875px;[^}]*font-size:\s*10px;[^}]*font-weight:\s*500;[^}]*line-height:\s*15px;/s);
  assert.match(css, /__ai-thinking-check\s*\{[^}]*margin-left:\s*auto;[^}]*color:\s*#6548f5;/s);
  assert.match(css, /button\.easymde-immersive-workspace__ai-attachment\[hidden\]\s*\{\s*display:\s*none;\s*\}/s);
  assert.match(aiMarkup, /data-ai-attachment title="' \+ label\('aiRemoveAttachment', 'Remove attachment'\) \+ '" hidden/);
  assert.match(source, /iconMarkup\('paperclip', 12, 2\)[\s\S]*attachment_name\.textContent = String\(name\);[\s\S]*iconMarkup\('x', 11, 2\)/);
  assert.match(source, /'paperclip': '<path d="M13\.234 20\.252 21 12\.3"><\/path><path d="m16 6-8\.414 8\.586/);
  assert.match(css, /button\.easymde-immersive-workspace__ai-attachment\s*\{[^}]*top:\s*37\.5px;[^}]*left:\s*52px;[^}]*display:\s*flex;[^}]*max-width:\s*210px;[^}]*gap:\s*5\.625px;[^}]*border-radius:\s*3\.625px;[^}]*cursor:\s*default;[^}]*font-weight:\s*500;[^}]*line-height:\s*15\.75px;/s);
  assert.match(css, /__ai-mode-trigger\s*\{[^}]*height:\s*33\.75px;[^}]*min-width:\s*96px;[^}]*padding:\s*0 9\.375px;[^}]*border:\s*1px solid #e1e5ee;[^}]*border-radius:\s*7px;/s);
  assert.match(css, /__ai-config-trigger\s*\{[^}]*height:\s*30px;[^}]*max-width:\s*196px;[^}]*font-size:\s*11\.5px;/s);
  assert.match(css, /button\.easymde-immersive-workspace__ai-send\s*\{[^}]*width:\s*30px;[^}]*height:\s*30px;[^}]*border-radius:\s*9px;[^}]*background:\s*linear-gradient\(135deg, #6848f5, #805df8\);[^}]*cursor:\s*default;[^}]*font-weight:\s*500;[^}]*transition:\s*all 150ms cubic-bezier\(0\.4, 0, 0\.2, 1\);/s);
  assert.match(css, /button\.easymde-immersive-workspace__ai-send:disabled\s*\{[^}]*cursor:\s*not-allowed;[^}]*opacity:\s*0\.35;/s);
  assert.match(css, /button\.easymde-immersive-workspace__ai-send:focus-visible\s*\{[^}]*outline:\s*0;[^}]*box-shadow:\s*0 0 0 2px #fff,\s*0 0 0 4px #8067f8;/s);
});

test('publish dialog uses the reference shell hierarchy while preserving native field hooks', () => {
  const source = readFileSync(join(repoRoot, 'assets/js/admin/immersive-workspace.js'), 'utf8');
  const css = readFileSync(join(repoRoot, 'assets/css/admin/immersive-workspace.css'), 'utf8');
  const publishStart = source.indexOf('<div class="easymde-immersive-workspace__modal-backdrop"');
  const publishEnd = source.indexOf('<div class="easymde-immersive-workspace__history-backdrop"', publishStart);
  const publishMarkup = source.slice(publishStart, publishEnd);

  assert.match(source, /function publishHeaderArtMarkup[\s\S]*easymde-immersive-workspace__publish-header-art/);
  assert.match(source, /viewBox="0 0 1120 82"[\s\S]*x1="410" y1="0" x2="1120" y2="0" gradientUnits="userSpaceOnUse"/);
  assert.match(source, /M390 82 C474 80 520 59 592 45 C665 31 718 53 778 55 C849 58 902 30 974 27 C1036 24 1081 38 1120 48 L1120 82Z/);
  assert.match(source, /easymde-immersive-workspace__publish-heading-sparkle[\s\S]*M12 1\.5c0 6\.351 4\.65 11\.5 11\.5 11\.5/);
  assert.match(publishMarkup, /easymde-immersive-workspace__publish-heading-icon/);
  assert.match(publishMarkup, /is-tags[^>]*>[\s\S]*?publish-section-title-row[^>]*>[\s\S]*?publish-section-title/);
  assert.match(publishMarkup, /is-featured[^>]*>[\s\S]*?publish-section-title-row[^>]*>[\s\S]*?publish-section-title/);
  assert.match(publishMarkup, /publish-section-title[^>]*>[\s\S]*?iconMarkup\('hash', 15, 2\.2\)/);
  assert.match(publishMarkup, /publish-section-title[^>]*>[\s\S]*?iconMarkup\('file-text', 15, 2\.2\)/);
  assert.match(publishMarkup, /publish-section-title[^>]*>[\s\S]*?iconMarkup\('list-checks', 15, 2\.2\)/);
  assert.match(publishMarkup, /data-action="ai-generate-summary" disabled[^>]*title="' \+ label\('publishAiSummaryUnavailable'/);
  assert.match(css, /button\.easymde-immersive-workspace__publish-ai-summary:disabled\s*\{[^}]*cursor:\s*not-allowed;[^}]*opacity:\s*0\.55;/s);
  assert.doesNotMatch(source, /action === 'ai-generate-summary'/);
  assert.doesNotMatch(publishMarkup, /is-featured[^>]*>[\s\S]*?publish-section-title[^>]*>[\s\S]*?iconMarkup\('image-plus'/);
  assert.match(source, /'hash':\s*'<line x1="4" x2="20" y1="9" y2="9">/);
  assert.match(source, /'list-checks':\s*'<path d="m3 17 2 2 4-4">/);
  assert.match(source, /'image-plus':\s*'<path d="M16 5h6">/);
  assert.match(source, /throw new Error\('Unknown immersive workspace icon: ' \+ name\)/);
  assert.match(publishMarkup, /data-publish-status/);
  assert.match(publishMarkup, /easymde-immersive-workspace__publish-divider/);
  assert.match(publishMarkup, /easymde-immersive-workspace__publish-left[\s\S]*easymde-immersive-workspace__publish-right/);
  assert.match(publishMarkup, /data-publish-tags/);
  assert.match(publishMarkup, /data-publish-excerpt/);
  assert.match(publishMarkup, /data-publish-categories/);
  assert.match(publishMarkup, /easymde-immersive-workspace__categories-scroll[^>]*data-publish-categories/);
  assert.match(publishMarkup, /data-featured-summary/);
  assert.match(publishMarkup, /easymde-immersive-workspace__publish-visibility/);
  assert.match(publishMarkup, /role="radiogroup"[^>]*aria-label=/);
  assert.match(publishMarkup, /data-publish-visibility="public"/);
  assert.match(publishMarkup, /data-publish-visibility="password"/);
  assert.match(publishMarkup, /data-publish-visibility="private"/);
  assert.match(publishMarkup, /data-publish-sticky[^>]*aria-label="' \+ label\('publishSticky', 'Stick to the top of the front page'\) \+ '"/);
  assert.match(publishMarkup, /data-publish-password/);
  assert.match(publishMarkup, /data-publish-password-error/);
  assert.doesNotMatch(publishMarkup, /data-publish-password[^>]*aria-describedby=/);
  assert.match(publishMarkup, /easymde-immersive-workspace__publish-preview-copy[^>]*>[\s\S]*?easymde-immersive-workspace__publish-preview-switch[^>]*>[\s\S]*?data-publish-preview[^>]*aria-label="' \+ label\('publishPreviewAfter', 'Open preview after publishing'\) \+ '"[^>]*>[\s\S]*?<i aria-hidden="true"><span data-publish-preview-thumb><\/span><\/i><\/span>/);
  assert.match(source, /previewInput\.setAttribute\('aria-label', previewLabel\.textContent\)/);
  assert.match(source, /function setPublishPasswordError\(message\)[\s\S]*input\.setAttribute\('aria-describedby', 'easymde-immersive-publish-password-error'\)[\s\S]*input\.removeAttribute\('aria-describedby'\)/);
  assert.match(source, /function renderPublishPreviewState\(\)[\s\S]*previewThumb\.innerHTML = publishDraft\.openPreview[\s\S]*\? iconMarkup\('check', 11, 3\.4\)[\s\S]*: '';/);
  assert.match(publishMarkup, /data-publish-confirm>['"]? \+ '<span data-publish-confirm-label><\/span>' \+ publishButtonSparklesMarkup\(\) \+ ['"]?<\/button>/);
  assert.match(source, /var confirmLabel = query\('\[data-publish-confirm-label\]'\)/);
  assert.match(source, /confirmLabel\.textContent = titleNode\.textContent/);
  assert.doesNotMatch(source, /confirm\.textContent = titleNode\.textContent/);
  assert.match(publishMarkup, /easymde-immersive-workspace__publish-safety/);
  assert.match(publishMarkup, /easymde-immersive-workspace__publish-progress[^>]*aria-live="polite"/);
  assert.match(publishMarkup, /easymde-immersive-workspace__publish-close[^>]*title="' \+ label\('close', 'Close'\) \+ '"[^>]*aria-label="' \+ label\('closePublishDialog', 'Close publish dialog'\)/);
  assert.match(source, /data-action="publish"[^>]*aria-label="' \+ label\('publishArticle', 'Publish article'\) \+ '"[^>]*title="' \+ label\('publishArticleShortcut', 'Publish article \(⌘↵\)'\)/);
  assert.match(source, /publishButton\.setAttribute\('aria-label', buttonLabel\)/);
  assert.match(source, /publishButton\.setAttribute\('title', shortcutLabel\)/);

  assert.match(css, /__modal-backdrop\s*\{[^}]*background:\s*rgba\(15, 23, 42, 0\.42\);[^}]*backdrop-filter:\s*blur\(4px\);/s);
  assert.match(css, /__publish\s*\{[^}]*width:\s*min\(1120px, calc\(100vw - 24px\)\);[^}]*max-height:\s*calc\(100vh - 32px\);/s);
  assert.match(css, /__publish\s*\{[^}]*border-radius:\s*20px;[^}]*box-shadow:\s*0 2px 6px rgba\(15, 23, 42, 0\.04\), 0 24px 60px -20px rgba\(15, 23, 42, 0\.18\);/s);
  assert.match(css, /__publish-heading-icon\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px;[^}]*border-radius:\s*14px;/s);
  assert.match(css, /__publish-header-art\s*\{[^}]*height:\s*82px;/s);
  assert.match(css, /__publish-heading-sparkle\s*\{[^}]*top:\s*-6px;[^}]*right:\s*-6px;[^}]*width:\s*13px;[^}]*height:\s*13px;[^}]*fill:\s*#ffb020;/s);
  assert.match(css, /__publish-close\s*\{[^}]*width:\s*30px;[^}]*height:\s*30px;[^}]*border-radius:\s*9px;/s);
  assert.match(css, /__publish-close\s*\{[^}]*font-weight:\s*500;/s);
  assert.match(css, /__publish-header\s*\{[^}]*min-height:\s*0;[^}]*padding:\s*22px 26\.25px 15px;/s);
  assert.match(css, /__publish-heading\s*\{[^}]*gap:\s*11\.25px;/s);
  assert.match(css, /__publish-heading-copy\s*\{[^}]*padding-right:\s*37\.5px;/s);
  assert.match(css, /__publish-heading-copy > div\s*\{[^}]*gap:\s*7\.5px;[^}]*margin-bottom:\s*3\.75px;/s);
  assert.match(css, /__publish-close\s*\{[^}]*top:\s*18\.75px;[^}]*right:\s*22\.5px;/s);
  assert.match(css, /__publish-body\s*\{[^}]*display:\s*grid;[^}]*flex:\s*1 1 auto;[^}]*grid-template-columns:\s*minmax\(0, 1\.62fr\) minmax\(320px, 1fr\);[^}]*gap:\s*26\.25px;[^}]*padding:\s*22px 26\.25px 7\.5px;/s);
  assert.match(css, /__publish-right\s*\{[^}]*min-width:\s*0;/s);
  assert.match(css, /__publish-section\.is-tags > p\s*\{[^}]*margin:\s*3\.75px 0 7\.5px;/s);
  assert.match(css, /__publish-tagbox\s*\{[^}]*gap:\s*7\.5px;[^}]*padding:\s*9\.375px 11\.25px;/s);
  assert.match(css, /__publish-tagbox:focus-within\s*\{[^}]*border-color:\s*#2563eb;[^}]*box-shadow:\s*none;/s);
  assert.match(css, /__publish-tag\s*\{[^}]*gap:\s*5\.625px;[^}]*padding:\s*3\.75px 5\.625px 3\.75px 11\.25px;/s);
  assert.match(css, /__publish-tagbox input\s*\{[^}]*height:\s*22\.5px;[^}]*border-radius:\s*0;[^}]*line-height:\s*18\.75px;/s);
  assert.match(css, /__publish-tagbox input:focus,[\s\S]*__publish-tagbox input:focus-visible\s*\{[^}]*border:\s*0;[^}]*box-shadow:\s*none;[^}]*outline:\s*0;/s);
  assert.match(css, /__publish-section\.is-excerpt \.easymde-immersive-workspace__publish-section-heading\s*\{[^}]*min-height:\s*25\.25px;[^}]*align-items:\s*center;[^}]*gap:\s*11\.25px;[^}]*margin-bottom:\s*5\.625px;/s);
  assert.match(css, /__publish-excerpt-meta\s*\{[^}]*display:\s*flex;[^}]*align-items:\s*center;[^}]*gap:\s*9\.375px;/s);
  assert.match(css, /button\.easymde-immersive-workspace__publish-ai-summary\s*\{[^}]*display:\s*inline-flex;[^}]*gap:\s*3\.75px;[^}]*padding:\s*3px 9\.375px;[^}]*border:\s*1px solid #e4dafb;[^}]*border-radius:\s*9999px;[^}]*background:\s*#f5f1fe;[^}]*color:\s*#6d28d9;[^}]*font-size:\s*11\.5px;[^}]*font-weight:\s*600;[^}]*line-height:\s*17\.25px;/s);
  assert.match(css, /__publish-section textarea\s*\{[^}]*display:\s*inline-block;[^}]*height:\s*92px;[^}]*min-height:\s*92px;[^}]*padding:\s*11\.25px 13\.125px;/s);
  assert.match(css, /__publish-section\.is-categories \.easymde-immersive-workspace__publish-section-heading\s*\{[^}]*align-items:\s*baseline;[^}]*margin-bottom:\s*1\.875px;/s);
  assert.match(css, /__publish-section\.is-categories \[data-publish-category-count\]\s*\{[^}]*padding:\s*2px 10px;[^}]*border:\s*1px solid #dbeafe;[^}]*border-radius:\s*9999px;[^}]*background:\s*#eff6ff;[^}]*color:\s*#2563eb;[^}]*font-size:\s*11\.5px;[^}]*line-height:\s*17\.25px;/s);
  assert.match(css, /__publish-section\.is-categories > p\s*\{[^}]*margin:\s*1\.875px 0 7\.5px;/s);
  assert.match(css, /__publish-section-title-row\s*\{[^}]*display:\s*flex;[^}]*min-height:\s*21\.75px;[^}]*align-items:\s*baseline;/s);
  assert.match(css, /__categories\s*\{[^}]*height:\s*212px;[^}]*padding:\s*0;[^}]*overflow:\s*hidden;/s);
  assert.match(css, /__categories-scroll\s*\{[^}]*display:\s*block;[^}]*height:\s*210px;[^}]*padding:\s*7\.5px 11\.25px;[^}]*overflow-y:\s*auto;/s);
  assert.match(css, /__publish-section \.easymde-immersive-workspace__publish-section-title\s*\{[^}]*display:\s*inline-flex;[^}]*gap:\s*7\.5px;[^}]*font-size:\s*14\.5px;[^}]*line-height:\s*21\.75px;/s);
  assert.match(css, /__category-row\s*\{[^}]*display:\s*flex;[^}]*align-items:\s*center;[^}]*padding:\s*5px 0;/s);
  assert.match(css, /__category-row label\s*\{[^}]*min-width:\s*0;[^}]*flex:\s*1 1 auto;[^}]*gap:\s*9\.375px;[^}]*color:\s*#0f172a;[^}]*font-size:\s*14\.5px;[^}]*font-weight:\s*500;/s);
  assert.match(css, /__category-root-spacer\s*\{[^}]*width:\s*19px;[^}]*flex:\s*0 0 19px;/s);
  assert.match(css, /__category-ancestor,[\s\S]*__category-connector\s*\{[^}]*width:\s*22px;[^}]*height:\s*24px;[^}]*flex:\s*0 0 22px;/s);
  assert.match(css, /__category-toggle\s*\{[^}]*top:\s*6px;[^}]*left:\s*4px;[^}]*width:\s*13px;[^}]*height:\s*13px;[^}]*border:\s*1px solid #d8dee8;[^}]*border-radius:\s*3px;/s);
  assert.match(css, /__category-checkbox\s*\{[^}]*width:\s*18px;[^}]*height:\s*18px;[^}]*border:\s*1\.5px solid #c7cedb;[^}]*border-radius:\s*4px;/s);
  assert.match(css, /__categories input:checked \+ \.easymde-immersive-workspace__category-checkbox,[\s\S]*input:indeterminate \+ \.easymde-immersive-workspace__category-checkbox\s*\{[^}]*border-color:\s*#2563eb;[^}]*background:\s*#2563eb;/s);
  assert.match(css, /__categories input\s*\{[^}]*width:\s*1px;[^}]*height:\s*1px;[^}]*min-width:\s*0;[^}]*min-height:\s*0;[^}]*border:\s*0;[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;/s);
  assert.match(source, /visual\.className = 'easymde-immersive-workspace__category-checkbox'/);
  assert.match(source, /input\.setAttribute\('aria-label', node\.label\)/);
  assert.match(source, /input\.indeterminate = indeterminate/);
  assert.match(source, /indeterminate[\s\S]*iconMarkup\('minus', 11, 3\.2\)[\s\S]*checked[\s\S]*iconMarkup\('check', 11, 3\.2\)/);
  assert.match(source, /easymde-immersive-workspace__category-toggle/);
  assert.match(source, /easymde-immersive-workspace__category-connector/);
  assert.match(source, /easymde-immersive-workspace__category-ancestor/);
  assert.match(css, /__featured-empty\s*\{[^}]*position:\s*relative;[^}]*margin-top:\s*11\.25px;[^}]*padding:\s*18px 15px 15px;[^}]*font-weight:\s*500;/s);
  assert.doesNotMatch(css, /__featured-empty\s*\{[^}]*min-height:/s);
  assert.match(css, /__featured-placeholder-art\s*\{[^}]*width:\s*200px;[^}]*height:\s*133px;[^}]*margin-bottom:\s*5\.625px;/s);
  assert.match(css, /__featured-empty b\s*\{[^}]*margin-bottom:\s*3\.75px;[^}]*font-weight:\s*700;/s);
  assert.match(css, /__featured-empty > span\s*\{[^}]*margin-bottom:\s*3\.75px;/s);
  assert.match(css, /__featured-empty small\s*\{[^}]*font-weight:\s*500;/s);
  assert.doesNotMatch(publishMarkup, /data-featured-alt/);
  assert.match(publishMarkup, /data-featured-selected hidden><div><img data-featured-image alt=""><\/div><footer>/);
  assert.match(publishMarkup, /data-action="remove-featured">['"]? \+ iconMarkup\('trash-2', 12, 2\) \+ ['"]?/);
  assert.match(source, /'trash-2':\s*'<path d="M3 6h18"><\/path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"><\/path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"><\/path><line x1="10" x2="10" y1="11" y2="17"><\/line><line x1="14" x2="14" y1="11" y2="17"><\/line>'/);
  assert.doesNotMatch(source, /var featuredAlt = query\('\[data-featured-alt\]'\)/);
  assert.match(css, /__featured-selected\s*\{[^}]*margin-top:\s*11\.25px;[^}]*border:\s*1px solid #e6e9ef;[^}]*border-radius:\s*14px;/s);
  assert.doesNotMatch(css, /__featured-selected > p\s*\{/s);
  assert.match(css, /__featured-selected footer\s*\{[^}]*gap:\s*7\.5px;[^}]*padding:\s*9\.375px 11\.25px;/s);
  assert.match(css, /__featured-selected button\s*\{[^}]*padding:\s*3\.75px 9\.375px;[^}]*border-radius:\s*5\.625px;[^}]*line-height:\s*18\.75px;/s);
  assert.match(css, /__featured-selected \[data-action="remove-featured"\]\s*\{[^}]*display:\s*inline-flex;[^}]*align-items:\s*center;[^}]*gap:\s*3\.75px;[^}]*color:\s*#e11d48;/s);
  assert.match(css, /__featured-selected \[data-action="select-featured"\]:hover\s*\{[^}]*background:\s*#f8fafc;[^}]*color:\s*#0f172a;/s);
  assert.match(css, /__featured-selected \[data-action="remove-featured"\]:hover\s*\{[^}]*background:\s*#fff1f2;/s);
  assert.match(css, /__featured-selected button:focus-visible\s*\{[^}]*box-shadow:\s*0 0 0 3px rgba\(37, 99, 235, 0\.18\);[^}]*outline:\s*0;/s);
  assert.match(css, /__category-toggle:focus-visible\s*\{[^}]*border-color:\s*#2563eb;[^}]*box-shadow:\s*0 0 0 2px #dbeafe;/s);
  assert.match(css, /__categories input:focus-visible \+ \.easymde-immersive-workspace__category-checkbox\s*\{[^}]*box-shadow:\s*0 0 0 3px rgba\(37, 99, 235, 0\.18\);/s);
  assert.match(css, /__publish-visibility\s*\{[^}]*margin-top:\s*14px;[^}]*padding:\s*13\.125px 15px;[^}]*border:\s*1px solid #e2e8f0;[^}]*border-radius:\s*14px;/s);
  assert.match(css, /__publish-visibility-title\s*\{[^}]*gap:\s*7\.5px;[^}]*margin-bottom:\s*11\.25px;[^}]*font-size:\s*13\.5px;[^}]*font-weight:\s*700;/s);
  assert.match(css, /__publish-visibility-options\s*\{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\);[^}]*gap:\s*7\.5px;/s);
  assert.match(css, /__publish-visibility-option\s*\{[^}]*height:\s*35\.75px;[^}]*gap:\s*5\.625px;[^}]*padding:\s*7\.5px;[^}]*border-radius:\s*9px;[^}]*font-size:\s*12\.5px;/s);
  assert.match(css, /__publish-radio\s*\{[^}]*width:\s*14px;[^}]*height:\s*14px;[^}]*border:\s*1px solid #cbd5e1;/s);
  assert.match(css, /__publish-visibility-option > input,[\s\S]*?__publish-sticky > input\s*\{[^}]*width:\s*1px;[^}]*height:\s*1px;[^}]*min-width:\s*0;[^}]*min-height:\s*0;[^}]*border:\s*0;[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;/s);
  assert.match(css, /__publish-visibility-option > input:focus,[\s\S]*?__publish-sticky > input:focus-visible\s*\{[^}]*box-shadow:\s*none;[^}]*outline:\s*0;/s);
  assert.match(css, /__publish-visibility-option > input:focus-visible \+ \.easymde-immersive-workspace__publish-radio,[\s\S]*?__publish-sticky > input:focus-visible \+ \.easymde-immersive-workspace__publish-sticky-box\s*\{[^}]*box-shadow:\s*0 0 0 3px rgba\(37, 99, 235, 0\.18\);/s);
  assert.match(css, /__publish-sticky\s*\{[^}]*gap:\s*9\.375px;[^}]*margin-top:\s*11\.25px;[^}]*font-size:\s*12\.5px;/s);
  assert.match(css, /__publish-sticky-box\s*\{[^}]*width:\s*17px;[^}]*height:\s*17px;[^}]*border:\s*1\.5px solid #c7cedb;[^}]*border-radius:\s*4px;/s);
  assert.match(css, /__publish-password input:focus\s*\{[^}]*border-color:\s*#e2e8f0;[^}]*box-shadow:\s*0 0 0 2px #dbeafe;[^}]*outline:\s*0;/s);
  assert.match(css, /__publish-private-help\s*\{[^}]*margin-top:\s*11\.25px;[^}]*color:\s*#64748b;[^}]*font-weight:\s*400;/s);
  assert.match(css, /__publish-options\s*\{[^}]*padding:\s*13\.125px 15px;/s);
  assert.match(css, /__publish-options-title\s*\{[^}]*gap:\s*7\.5px;[^}]*margin-bottom:\s*11\.25px;/s);
  assert.match(css, /__publish-options-title\s*\{[^}]*font-weight:\s*700;/s);
  assert.match(css, /__publish-preview\s*\{[^}]*gap:\s*11\.25px;/s);
  assert.match(css, /__publish-preview b\s*\{[^}]*margin-bottom:\s*1\.875px;/s);
  assert.match(css, /__publish-preview small\s*\{[^}]*font-weight:\s*500;/s);
  assert.match(css, /__publish-preview-switch\s*\{[^}]*position:\s*relative;[^}]*display:\s*inline-flex;[^}]*flex:\s*0 0 auto;/s);
  assert.match(css, /__publish-preview-switch > i > span\s*\{[^}]*display:\s*grid;[^}]*place-items:\s*center;/s);
  assert.match(css, /__publish-preview-switch > i > span\s*\{[^}]*right:\s*auto;[^}]*left:\s*2px;[^}]*transition:\s*right 150ms ease, left 150ms ease;/s);
  assert.match(css, /__publish-preview-switch input:checked \+ i > span\s*\{[^}]*right:\s*2px;[^}]*left:\s*auto;/s);
  assert.doesNotMatch(css, /__publish-preview-switch input:checked \+ i > span\s*\{[^}]*transform:/s);
  assert.match(css, /__publish-preview-switch input\s*\{[^}]*width:\s*1px;[^}]*height:\s*1px;[^}]*min-width:\s*0;[^}]*min-height:\s*0;[^}]*border:\s*0;[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;/s);
  assert.match(css, /__publish-preview-switch input:focus,[\s\S]*?__publish-preview-switch input:focus-visible\s*\{[^}]*box-shadow:\s*none;[^}]*outline:\s*0;/s);
  assert.match(css, /__publish-preview-switch input:focus-visible \+ i\s*\{[^}]*box-shadow:\s*0 0 0 3px rgba\(37, 99, 235, 0\.18\);/s);
  assert.match(css, /__publish > footer\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto minmax\(0, 1fr\);[^}]*gap:\s*9\.375px;[^}]*padding:\s*13\.125px 26\.25px 18\.75px;/s);
  assert.match(css, /__publish-safety\s*\{[^}]*gap:\s*7\.5px;/s);
  assert.match(css, /__publish-progress\s*\{[^}]*min-width:\s*150px;[^}]*min-height:\s*36px;[^}]*align-items:\s*center;[^}]*justify-content:\s*center;/s);
  assert.match(source, /var publishSubmitting = false;/);
  assert.match(source, /function renderPublishSubmittingState\(\)[\s\S]*dialog\.setAttribute\('aria-busy', publishSubmitting \? 'true' : 'false'\)[\s\S]*querySelectorAll\('button, input, textarea'\)[\s\S]*control\.disabled = publishSubmitting \|\| control\.getAttribute\('data-action'\) === 'ai-generate-summary';[\s\S]*publishLoadingPreview/);
  assert.match(source, /function closePublishDialog\(force\)[\s\S]*if \(publishSubmitting && !force\) \{\s*return false;\s*\}/s);
  assert.match(source, /action === 'confirm-publish'[\s\S]*if \(publishSubmitting\) \{\s*return;\s*\}[\s\S]*publishSubmitting = true;\s*renderPublishSubmittingState\(\);[\s\S]*publishResult = adapter\.publish\(createPublishDraft\(publishDraft\)\);[\s\S]*if \(publishResult === false\) \{\s*publishSubmitting = false;\s*renderPublishSubmittingState\(\);\s*return;\s*\}/s);
  assert.match(css, /__publish-progress > span\s*\{[^}]*display:\s*inline-flex;[^}]*gap:\s*7\.5px;[^}]*padding:\s*8px 15px;[^}]*border:\s*1px solid #d0ddf8;[^}]*border-radius:\s*9999px;[^}]*background:\s*linear-gradient\(180deg, #f0f5ff 0%, #e8efff 100%\);[^}]*color:\s*#2563eb;[^}]*font-size:\s*12\.5px;[^}]*font-weight:\s*600;/s);
  assert.match(css, /__publish-progress-spinner\s*\{[^}]*width:\s*14px;[^}]*height:\s*14px;[^}]*border:\s*2px solid #bfdbfe;[^}]*border-top-color:\s*#2563eb;[^}]*animation:\s*easymde-publish-dialog-spin 0\.9s linear infinite;/s);
  assert.match(css, /@keyframes easymde-publish-dialog-spin\s*\{[\s\S]*to\s*\{\s*transform:\s*rotate\(360deg\);\s*\}/s);
  assert.match(css, /__publish-footer-actions button:disabled\s*\{[^}]*cursor:\s*not-allowed;[^}]*opacity:\s*0\.55;/s);
  assert.match(css, /__publish-footer-actions button\.is-primary:disabled\s*\{[^}]*opacity:\s*0\.65;/s);
  assert.match(css, /__publish-footer-actions button:focus-visible\s*\{[^}]*outline:\s*1px auto rgba\(15, 23, 42, 0\.1\);[^}]*outline-offset:\s*0;/s);
  assert.match(css, /__publish-footer-actions button\.is-primary:hover\s*\{[^}]*transform:\s*translateY\(-1px\);/s);
  assert.match(css, /__publish-footer-actions\s*\{[^}]*gap:\s*7\.5px;/s);
  assert.match(css, /__publish-footer-actions button\s*\{[^}]*padding:\s*9px 15px;/s);
  assert.match(css, /__publish-footer-actions button\.is-primary\s*\{[^}]*position:\s*relative;[^}]*min-width:\s*120px;[^}]*gap:\s*5\.625px;[^}]*overflow:\s*hidden;[^}]*padding:\s*9px 15px;[^}]*border:\s*0;/s);
  assert.doesNotMatch(css, /__publish-footer-actions button\.is-primary\s*\{[^}]*padding-right:\s*42px;/s);
  assert.match(css, /__publish-button-sparkles\s*\{[^}]*position:\s*relative;[^}]*display:\s*inline-block;[^}]*width:\s*18px;[^}]*height:\s*16px;[^}]*flex:\s*0 0 18px;/s);
  assert.match(css, /@media \(max-width:\s*767px\)[\s\S]*?__publish-body\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/s);
  assert.match(css, /@media \(max-width:\s*639px\)[\s\S]*?__publish-header\s*\{[^}]*padding:\s*18\.75px 22\.5px 15px;/s);
  assert.match(css, /@media \(max-width:\s*639px\)[\s\S]*?__publish-header-art\s*\{[^}]*height:\s*82px;/s);
  assert.match(css, /@media \(max-width:\s*639px\)[\s\S]*?__publish-close\s*\{[^}]*top:\s*18\.75px;[^}]*right:\s*18\.75px;/s);
  assert.match(css, /@media \(max-width:\s*639px\)[\s\S]*?__publish-body\s*\{[^}]*gap:\s*18\.75px;[^}]*padding:\s*18\.75px;/s);
  assert.match(css, /@media \(max-width:\s*639px\)[\s\S]*?__publish > footer\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);[^}]*padding:\s*13\.125px 18\.75px;/s);
  assert.doesNotMatch(css, /__history-preview img\s*\{[^}]*\}\s*\}\s*\.easymde-immersive-workspace__publish-header/s);

  const zh = readFileSync(join(repoRoot, 'languages/easymde-zh_CN.po'), 'utf8');
  assert.match(zh, /msgid "Close publish dialog"\nmsgstr "关闭发布弹窗"/);
  assert.match(zh, /msgid "Publish article \(%s\)"\nmsgstr "发布文章（%s）"/);
  assert.match(zh, /msgid "Update article \(%s\)"\nmsgstr "更新文章（%s）"/);
});

test('immersive workspace uses Lucide X glyphs for every close control', () => {
  const source = readFileSync(join(repoRoot, 'assets/js/admin/immersive-workspace.js'), 'utf8');

  assert.doesNotMatch(source, /&times;/);
  assert.match(source, /iconMarkup\('x', 14, 2\)/);
});

test('publish draft normalizes real WordPress field values without mutating inputs', () => {
  const workspace = loadWorkspaceModule();
  const source = {
    categories: ['7', '7', '12'],
    excerpt: 'Summary',
    featuredImage: { id: 31, url: 'https://example.test/image.jpg', alt: 'Cover' },
    postStatus: 'publish',
    visibility: 'password',
    password: 'secret phrase',
    sticky: true,
    tags: ' Alpha, beta,alpha ',
    openPreview: true
  };
  const draft = workspace.createPublishDraft(source);

  assert.deepEqual(JSON.parse(JSON.stringify(draft.tags)), ['Alpha', 'beta']);
  assert.deepEqual(JSON.parse(JSON.stringify(draft.categories)), ['7', '12']);
  assert.equal(draft.mode, 'update');
  assert.equal(draft.excerpt, 'Summary');
  assert.equal(draft.featuredImage.id, 31);
  assert.equal(draft.openPreview, true);
  assert.equal(draft.visibility, 'password');
  assert.equal(draft.password, 'secret phrase');
  assert.equal(draft.sticky, false, 'password-protected posts cannot remain sticky');
  assert.equal(source.tags, ' Alpha, beta,alpha ');
  assert.equal(source.sticky, true, 'draft creation must not mutate native field state');
});

test('publish draft keeps visibility state internally consistent and validates passwords', () => {
  const workspace = loadWorkspaceModule();
  const publicDraft = workspace.createPublishDraft({
    visibility: 'public',
    password: 'must not leak into public state',
    sticky: true
  });
  const inferredPrivateDraft = workspace.createPublishDraft({
    postStatus: 'private',
    visibility: 'unsupported',
    password: 'must be cleared',
    sticky: true
  });
  const missingPasswordDraft = workspace.createPublishDraft({ visibility: 'password' });

  assert.equal(publicDraft.visibility, 'public');
  assert.equal(publicDraft.password, '');
  assert.equal(publicDraft.sticky, true);
  assert.equal(inferredPrivateDraft.visibility, 'private');
  assert.equal(inferredPrivateDraft.password, '');
  assert.equal(inferredPrivateDraft.sticky, false);
  assert.equal(workspace.validatePublishDraft(publicDraft), '');
  assert.equal(workspace.validatePublishDraft(missingPasswordDraft), 'password-required');
  assert.equal(workspace.validatePublishDraft({ visibility: 'password', password: '  valid  ' }), '');
});

test('publish draft preserves a normalized mode when it is copied for the adapter', () => {
  const workspace = loadWorkspaceModule();
  const draft = workspace.createPublishDraft({
    mode: 'update',
    visibility: 'public'
  });

  assert.equal(draft.mode, 'update');
});

test('immersive shortcuts open publishing without submitting and AI input respects composition', () => {
  const source = readFileSync(join(repoRoot, 'assets/js/admin/immersive-workspace.js'), 'utf8');

  assert.match(
    source,
    /event\.target === source[\s\S]*event\.key === 'Enter'[\s\S]*\(event\.metaKey \|\| event\.ctrlKey\)[\s\S]*openPublishDialog\(\)/
  );
  assert.match(
    source,
    /event\.key === 'Enter'[\s\S]*!event\.shiftKey[\s\S]*!event\.isComposing[\s\S]*event\.keyCode !== 229[\s\S]*sendAiMessage\(\)/
  );
});

test('outline parsing ignores code blocks and preserves duplicate heading offsets', () => {
  const workspace = loadWorkspaceModule();
  const markdown = [
    '# Intro',
    '',
    '````md',
    '# Hidden',
    '```',
    '## Still hidden after a shorter fence',
    '````',
    '',
    '- ````md',
    '  ## Hidden inside a list fence',
    '  ```',
    '  ### Still hidden inside the list fence',
    '  ````',
    '',
    'Repeat',
    '------',
    '',
    '## Repeat',
    '',
    '\\# Escaped'
  ].join('\n');
  const outline = workspace.parseOutline(markdown);

  assert.deepEqual(
    JSON.parse(JSON.stringify(outline.map(({ level, text }) => ({ level, text })))),
    [
      { level: 1, text: 'Intro' },
      { level: 2, text: 'Repeat' },
      { level: 2, text: 'Repeat' }
    ]
  );
  assert.notEqual(outline[1].offset, outline[2].offset);
  assert.ok(outline[1].offset < outline[2].offset);
});

test('outline depth follows document hierarchy instead of raw heading numbers', () => {
  const workspace = loadWorkspaceModule();
  const outline = workspace.parseOutline([
    '## Starts at level two',
    '#### Skips to level four',
    '### Returns to level three',
    '# New root',
    '### Child of new root'
  ].join('\n'));

  assert.deepEqual(
    JSON.parse(JSON.stringify(outline.map(({ level, depth }) => ({ level, depth })))),
    [
      { level: 2, depth: 0 },
      { level: 4, depth: 1 },
      { level: 3, depth: 1 },
      { level: 1, depth: 0 },
      { level: 3, depth: 1 }
    ]
  );
});

test('outline promotes the document heading and numbered sections like the reference design', () => {
  const workspace = loadWorkspaceModule();
  const outline = workspace.parseOutline([
    '# Document',
    '## 1. Section',
    '# Heading 1',
    '## Heading 2',
    '### Heading 3',
    '## 2. Next'
  ].join('\n'));

  assert.deepEqual(
    JSON.parse(JSON.stringify(outline.map(({ text, depth }) => ({ text, depth })))),
    [
      { text: 'Document', depth: 0 },
      { text: '1. Section', depth: 0 },
      { text: 'Heading 1', depth: 1 },
      { text: 'Heading 2', depth: 2 },
      { text: 'Heading 3', depth: 3 },
      { text: '2. Next', depth: 0 }
    ]
  );
});

test('outline renderer uses markdown headings without a synthetic WordPress title row', () => {
  const source = readFileSync(join(repoRoot, 'assets/js/admin/immersive-workspace.js'), 'utf8');

  assert.doesNotMatch(source, /outline-root/);
  assert.doesNotMatch(source, /rootText\.textContent\s*=\s*title/);
});

test('top-level outline icon inference matches the reference design rules', () => {
  const workspace = loadWorkspaceModule();

  assert.equal(workspace.getOutlineIconName('1. 标题层级'), 'file-text');
  assert.equal(workspace.getOutlineIconName('Mermaid 饼图'), 'pie-chart');
  assert.equal(workspace.getOutlineIconName('Mermaid ER 数据库关系图'), 'database');
  assert.equal(workspace.getOutlineIconName('引用式链接'), 'link');
  assert.equal(workspace.getOutlineIconName('链接与图片'), 'image');
  assert.equal(workspace.getOutlineIconName('引用块'), 'quote');
  assert.equal(workspace.getOutlineIconName('无序、有序与任务列表'), 'list-checks');
  assert.equal(workspace.getOutlineIconName('分隔线'), 'minus');
  assert.equal(workspace.getOutlineIconName('HTML 标签与代码块'), 'code');
  assert.equal(workspace.getOutlineIconName('数学公式'), 'sigma');
  assert.equal(workspace.getOutlineIconName('折叠内容'), 'list-collapse');
  assert.equal(workspace.getOutlineIconName('普通文本'), 'file-text');
});

test('statistics are deterministic for CJK, western words, emoji, and CRLF', () => {
  const workspace = loadWorkspaceModule();
  const stats = workspace.calculateStats('Hello world\r\n你好 👋\r\n');

  assert.equal(stats.lines, 3);
  assert.equal(stats.words, 2);
  assert.equal(stats.cjk, 2);
  assert.equal(stats.characters, 15);
  assert.equal(stats.readMinutes, 1);
});

test('title normalization keeps the native WordPress title single-line', () => {
  const workspace = loadWorkspaceModule();

  assert.equal(workspace.normalizeTitle('Line one\r\n  Line two'), 'Line one Line two');
});

test('featured image candidate uses the first eligible local upload outside code fences', () => {
  const workspace = loadWorkspaceModule();
  const markdown = [
    '````md',
    '![Hidden](/wp-content/uploads/2026/07/hidden.jpg)',
    '```',
    '![Still hidden](/wp-content/uploads/2026/07/still-hidden.jpg)',
    '````',
    '',
    '> ````md',
    '> ![Quoted hidden](/wp-content/uploads/2026/07/quoted-hidden.jpg)',
    '> ```',
    '> ![Quoted still hidden](/wp-content/uploads/2026/07/quoted-still-hidden.jpg)',
    '> ````',
    '',
    '![Remote](https://cdn.example.net/remote.jpg)',
    '',
    '![Data](data:image/png;base64,abc)',
    '',
    '![Local cover](/wp-content/uploads/2026/07/cover.jpg "Cover")',
    '',
    '![Later](/wp-content/uploads/2026/07/later.jpg)'
  ].join('\n');

  assert.deepEqual(
    JSON.parse(JSON.stringify(workspace.findFirstLocalImageCandidate(markdown, {
      siteUrl: 'https://example.test/wp-admin/post.php',
      uploadsPath: '/wp-content/uploads/'
    }))),
    {
      alt: 'Local cover',
      url: 'https://example.test/wp-content/uploads/2026/07/cover.jpg'
    }
  );
});

test('featured image candidate rejects lookalike paths and non-http sources', () => {
  const workspace = loadWorkspaceModule();
  const options = {
    siteUrl: 'https://example.test/wp-admin/post.php',
    uploadsPath: '/wp-content/uploads/'
  };

  assert.equal(
    workspace.findFirstLocalImageCandidate(
      '![Lookalike](https://example.test/wp-content/uploads-malicious/image.jpg)',
      options
    ),
    null
  );
  assert.equal(
    workspace.findFirstLocalImageCandidate('![Blob](blob:https://example.test/id)', options),
    null
  );
});
