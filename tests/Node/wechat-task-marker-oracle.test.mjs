// Task-marker oracle unit tests.
//
// The Playwright scenarios drive the oracles with captured Preview and payload
// evidence. These tests run the pure synthetic negative oracles without a
// browser so `npm test` pins the measured failure contract as well:
//
//   - the transport contract accepts an in-span U+2060 paint layer and rejects
//     the stale sibling carrier, an empty paint span, a glyph-less paint span,
//     and a missing, glyph-less, or misplaced owner carrier;
//   - the pixel contract rejects a center glyph that drifts or deforms
//     horizontally while every count-based tolerance still holds.
import assert from 'node:assert/strict';
import test from 'node:test';

import { assertTaskMarkerTransportNegativeCases } from '../e2e/wechat-copy/payload-task-oracle.mjs';
import { assertTaskMarkerPixelParityNegativeCases } from '../e2e/wechat-copy/payload-pixel-negative-cases.mjs';

test('task-marker transport negative oracle holds', () => {
  assert.doesNotThrow(() => assertTaskMarkerTransportNegativeCases('node/transport'));
});

test('task-marker pixel negative oracle holds', () => {
  assert.doesNotThrow(() => assertTaskMarkerPixelParityNegativeCases('node/pixel'));
});
