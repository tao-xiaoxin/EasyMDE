import { describe, expect, it } from 'vitest';

import {
  declaration,
  installClipboardTestEnvironment
} from './wechat-clipboard-test-fixtures';
import { keepStyle, portableStyleValue } from './wechat-style-policy';
import { expectTaskStaticAllocation } from './wechat-task-static-flow-test-fixtures';

describe('task checkbox style policy', () => {
  it('leaves an ordinary zero line-height font shorthand unchanged', () => {
    const ordinary = document.createElement('span');
    const font = '16px / 0px Arial';
    expect(portableStyleValue('font', font, ordinary, declaration({}))).toBe(font);
    expect(keepStyle('font', font, ordinary)).toBe(true);
  });
});

describe('createBrowserWechatClipboard', () => {
  installClipboardTestEnvironment();

  it.each([335, 677] as const)(
    'derives the static task allocation from the measured formatting context at %ipx',
    async (width) => {
      await expectTaskStaticAllocation({ width });
    }
  );

  it('keeps the untransformed static allocation while the owner paints through a transform', async () => {
    await expectTaskStaticAllocation({
      assertSourceUnaffected: true,
      ownerTransform: 'matrix(1.05, 0, 0, 1.05, 0, 0)',
      width: 335
    });
  });

  it('derives an absolute pseudo allocation from the origin at its sibling slot', async () => {
    await expectTaskStaticAllocation({ beforePosition: 'static', width: 335 });
  });

  it.each([false, true] as const)('omits task zero line-height from static paint and keeps direct caption text in flow (%s path)', async (synchronousCopy) => {
    await expectTaskStaticAllocation({
      assertInlineCaption: true,
      assertSourceUnaffected: true,
      beforeContent: '"✓"',
      expectedBeforeText: '✓',
      synchronousCopy,
      taskFont: '16px / 0px Arial',
      taskLineHeight: '0px',
      width: 335
    });
  });

  it('keeps the 335px task paint allocation independent from its in-span U+2060 transport', async () => {
    await expectTaskStaticAllocation({
      assertPaintOnlyTransport: true,
      width: 335
    });
  });

  it.each([false, true] as const)('preserves non-zero task line-height for text pseudo paint (%s path)', async (synchronousCopy) => {
    await expectTaskStaticAllocation({
      beforeContent: '"✓"',
      expectedBeforeText: '✓',
      synchronousCopy,
      taskFont: '16px / 18px Arial',
      taskLineHeight: '18px',
      width: 335
    });
  });

  it('derives the task owner allocation from its containing block padding box', async () => {
    await expectTaskStaticAllocation({ sectionPaddingTop: '4px', width: 335 });
  });

  it('copies a mixed task list with one geometry owner and one ordinary static owner', async () => {
    await expectTaskStaticAllocation({
      assertSourceUnaffected: true,
      ownerTransform: 'matrix(1.05, 0, 0, 1.05, 0, 0)',
      secondOwnerStatic: true,
      width: 335
    });
  });


  it('fails explicitly when a painted task pseudo has no measurable allocation', async () => {
    await expectTaskStaticAllocation({
      expectedError: 'wechat-task-checkbox-static-flow-dimensions-unavailable',
      pseudoWidth: 'auto',
      width: 335
    });
  });

  it('fails explicitly when a flex owner cannot host the static task allocation', async () => {
    await expectTaskStaticAllocation({
      expectedError: 'wechat-task-checkbox-static-flow-container-unavailable',
      ownerDisplay: 'flex',
      width: 335
    });
  });

  it('fails explicitly when the normalized allocation is corrupted before the final assertion', async () => {
    await expectTaskStaticAllocation({
      corruptAllocation: true,
      expectedError: 'wechat-task-checkbox-static-flow-allocation-mismatch',
      width: 335
    });
  });

  it('ignores a CSS hidden source sibling before the owner', async () => {
    // The computed layout style decides flow participation, not the projected
    // attribute of a source sibling.
    await expectTaskStaticAllocation({ precedingSibling: 'hidden', width: 335 });
  });

  it('ignores an out of flow source sibling before the owner', async () => {
    await expectTaskStaticAllocation({ precedingSibling: 'absolute', width: 335 });
  });

  it('fails explicitly when a floated source sibling constrains the static task allocation', async () => {
    // A prior float in the same formatting context can displace the normalized
    // float, and the captured projection does not prove that offset.
    await expectTaskStaticAllocation({
      expectedError: 'wechat-task-checkbox-static-flow-origin-unavailable',
      precedingSibling: 'float',
      width: 335
    });
  });

  it('fails explicitly when a logical floated source sibling constrains the static task allocation', async () => {
    await expectTaskStaticAllocation({
      expectedError: 'wechat-task-checkbox-static-flow-origin-unavailable',
      precedingSibling: 'logical-float',
      width: 335
    });
  });

  it('ignores an absolutely positioned floated source sibling before the owner', async () => {
    // Float is inert on an absolutely positioned box, so the prior sibling stays
    // out of flow and the prospective origin remains provable.
    await expectTaskStaticAllocation({ precedingSibling: 'absolute-float', width: 335 });
  });

  it('fails explicitly when a floated sibling of a consumed chain box constrains the static task allocation', async () => {
    // The float can displace the chain box that owns the layout slot, so the
    // consumed containing block offset is no longer provable.
    await expectTaskStaticAllocation({
      chainSibling: 'float',
      expectedError: 'wechat-task-checkbox-static-flow-origin-unavailable',
      width: 335
    });
  });

  it('ignores an absolutely positioned sibling of a consumed chain box', async () => {
    // Float is inert on an absolutely positioned box, so the chain offset stays
    // provable and the sibling stays out of flow.
    await expectTaskStaticAllocation({ chainSibling: 'absolute', width: 335 });
  });

  it('keeps the physical task allocation across source widths', async () => {
    // The captured source width must not leak into the emitted allocation.
    await expectTaskStaticAllocation({ secondWidth: 677, width: 335 });
  });

  it('fails explicitly when an emitted in flow pseudo keeps active offsets', async () => {
    await expectTaskStaticAllocation({
      beforePosition: 'relative',
      expectedError: 'wechat-task-checkbox-static-flow-position-unavailable',
      width: 335
    });
  });

  it('keeps inert source clear on the converted static task layers', async () => {
    await expectTaskStaticAllocation({ sourceClear: 'both', width: 335 });
  });

  it('fails explicitly when the projected clear value is tampered with', async () => {
    await expectTaskStaticAllocation({
      corruptClear: true,
      expectedError: 'wechat-task-checkbox-static-flow-allocation-mismatch',
      width: 335
    });
  });

  it('fails explicitly when a normal flow pseudo produces line boxes', async () => {
    await expectTaskStaticAllocation({
      beforeContent: '"★"',
      beforePosition: 'static',
      expectedError: 'wechat-task-checkbox-static-flow-origin-unavailable',
      width: 335
    });
  });

  it('keeps the containing block plane when an intermediate box only contains size', async () => {
    await expectTaskStaticAllocation({
      liPaddingTop: '4px',
      sectionMarginTop: '8px',
      sectionNonContainingBlock: 'contain-size',
      width: 335
    });
  });

  it('keeps the containing block plane when an intermediate box only will changes opacity', async () => {
    await expectTaskStaticAllocation({
      liPaddingTop: '4px',
      sectionMarginTop: '8px',
      sectionNonContainingBlock: 'will-change-opacity',
      width: 335
    });
  });

  it('keeps the margin collapse context when an intermediate box clips overflow', async () => {
    // Clipping overflow is not a block formatting context, so the section's
    // first-child margin collapses through the list item and still moves the
    // layout-parent content plane by the collapsed margin.
    await expectTaskStaticAllocation({ liOverflow: 'clip', sectionMarginTop: '8px', width: 335 });
  });

  it('preserves a 20px first-child margin collapse in the static allocation', async () => {
    await expectTaskStaticAllocation({ liOverflow: 'clip', sectionMarginTop: '20px', width: 335 });
  });

  it('uses the settled layout position when outer margin collapse differs from the owner slot', async () => {
    await expectTaskStaticAllocation({
      expectedOwnerOriginTop: 0,
      liOverflow: 'clip',
      sectionMarginTop: '20px',
      width: 335
    });
  });

  it('ignores an absent pseudo that authors a non portable effect', async () => {
    // The tick is not emitted, so its authored rotate must not fail the copy.
    await expectTaskStaticAllocation({ afterContent: 'none', afterRotate: '90deg', width: 335 });
  });

  it('fails explicitly when a consumed ancestor paints through a non portable rotate', async () => {
    await expectTaskStaticAllocation({
      expectedError: 'wechat-task-checkbox-static-flow-transform-unavailable',
      liRotate: '90deg',
      width: 335
    });
  });

  it('fails explicitly when the owner paints through a non portable rotate', async () => {
    await expectTaskStaticAllocation({
      expectedError: 'wechat-task-checkbox-static-flow-transform-unavailable',
      ownerRotate: '90deg',
      width: 335
    });
  });

  it('keeps the physical task allocation for a right to left owner', async () => {
    // The physical anchor keeps the allocation direction independent, so an
    // RTL owner inside an LTR section keeps the same left anchored margins.
    await expectTaskStaticAllocation({ ownerDirection: 'rtl', width: 335 });
  });

  it('keeps the physical task allocation for a right to left formatting context', async () => {
    await expectTaskStaticAllocation({ direction: 'rtl', width: 335 });
  });
});
