import assert from 'node:assert/strict';
import test from 'node:test';

import { JSDOM } from 'jsdom';

import { taskBlockRow } from '../e2e/wechat-copy/payload-evidence.mjs';

const TASK_ROW_STYLE =
  'display:block;list-style-type:none!important;list-style-image:none!important';

function documentFrom(markup) {
  return new JSDOM(`<!doctype html><body>${markup}</body>`).window.document;
}

test('recognizes a native live Preview task row', () => {
  const documentRef = documentFrom(
    '<article><ul class="task-list"><li class="task-list-item"><input type="checkbox" checked>Row</li></ul></article>'
  );
  const input = documentRef.querySelector('input[type="checkbox"]');
  const item = documentRef.querySelector('li.task-list-item');
  assert.equal(taskBlockRow(input), item);
});

test('recognizes a projected payload task row without matching the list container', () => {
  const documentRef = documentFrom(
    `<section><section style="${TASK_ROW_STYLE}"><section style="${TASK_ROW_STYLE}"><span role="checkbox"></span>Row</section></section></section>`
  );
  const owner = documentRef.querySelector('[role="checkbox"]');
  const list = documentRef.querySelector('body > section > section');
  const item = list?.firstElementChild;
  assert.ok(owner && list && item);
  assert.equal(taskBlockRow(owner), item);
  assert.notEqual(taskBlockRow(owner), list);
  assert.equal(taskBlockRow(owner)?.parentElement, list);
});

test('does not mistake an authored caption section for the task row', () => {
  const documentRef = documentFrom(
    `<section><section style="${TASK_ROW_STYLE}"><section style="${TASK_ROW_STYLE}"><section><p><span role="checkbox"></span> Caption</p></section></section></section></section>`
  );
  const owner = documentRef.querySelector('[role="checkbox"]');
  const item = documentRef.querySelector('body > section > section > section');
  const captionSection = item?.firstElementChild;
  assert.ok(owner && item && captionSection);
  assert.notEqual(captionSection, item);
  assert.equal(taskBlockRow(owner), item);
});

test('does not mistake a nested ordinary list item for the task row', () => {
  const documentRef = documentFrom(
    `<section><section style="${TASK_ROW_STYLE}"><section style="${TASK_ROW_STYLE}"><span role="checkbox"></span>Row<ul><li><span data-nested="1"></span></li></ul></section></section></section>`
  );
  const owner = documentRef.querySelector('[role="checkbox"]');
  const nested = documentRef.querySelector('[data-nested="1"]');
  const item = documentRef.querySelector('body > section > section > section');
  assert.ok(owner && nested && item);
  assert.equal(taskBlockRow(owner), item);
  assert.equal(taskBlockRow(nested), documentRef.querySelector('li'));
});

test('returns null when no task row ancestor exists', () => {
  const documentRef = documentFrom('<p><span role="checkbox"></span>Loose</p>');
  assert.equal(taskBlockRow(documentRef.querySelector('[role="checkbox"]')), null);
  assert.equal(taskBlockRow(null), null);
});
