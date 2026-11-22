import { writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { expect, test } from '@playwright/test';
import { openVisual } from './visual-editing-helpers.mjs';

export const shortStageBlocks = [
  { kind: 'paragraph', source: '中文 abc aaa \\*文字\\*', body: [...'中文 abc aaa ', '\\*', '文', '字', '\\*'] },
  { kind: 'heading', source: '# Heading', body: [...'Heading'] },
  { kind: 'paragraph', source: 'Target paragraph here.', body: [...'Target paragraph here.'] },
  { kind: 'code', source: '~~~bash\necho hi\n~~~', body: [...'echo hi'] },
  { kind: 'paragraph', source: 'End.', body: [...'End.'] }
];

export const shortStageInitial = shortStageBlocks.map((block) => block.source).join('\n\n');

export function shortStageUniqueCodeDeclarations(declarations) {
  const grouped = new Map();
  for (const declaration of declarations) {
    if (!declaration || typeof declaration.source !== 'string'
      || !declaration.descriptor || typeof declaration.descriptor !== 'object') continue;
    if (!grouped.has(declaration.source)) grouped.set(declaration.source, []);
    grouped.get(declaration.source).push(declaration.descriptor);
  }
  const unique = new Map();
  for (const [source, descriptors] of grouped) {
    const distinct = new Map(descriptors.map((descriptor) => [JSON.stringify(descriptor), descriptor]));
    if (distinct.size === 1) unique.set(source, distinct.values().next().value);
  }
  return unique;
}

export function shortStageBuildCodeDescriptors(blocks) {
  const declarations = [];
  let codeOrdinal = 0;
  for (let codeBlockOrdinal = 0; codeBlockOrdinal < blocks.length; codeBlockOrdinal += 1) {
    const codeBlock = blocks[codeBlockOrdinal];
    if (codeBlock.kind !== 'code') continue;
    const openingEnd = codeBlock.source.indexOf('\n');
    const closingStart = codeBlock.source.lastIndexOf('\n');
    if (openingEnd < 0 || closingStart <= openingEnd) {
      throw new Error('short-stage-code-declaration-invalid');
    }
    const opening = codeBlock.source.slice(0, openingEnd + 1);
    const closing = codeBlock.source.slice(closingStart + 1);
    const codePrefix = blocks.slice(0, codeBlockOrdinal).map((item) => item.source).join('\n\n')
      + (codeBlockOrdinal ? '\n\n' : '');
    const descriptorForBody = (body) => {
      const bodyStart = codePrefix.length + opening.length;
      const bodyEnd = bodyStart + body.length;
      const sourceBlockEnd = bodyEnd + 1 + closing.length;
      return Object.freeze({
        blockOrdinal: codeBlockOrdinal, codeOrdinal, body, bodyStart, bodyEnd,
        closingFenceLfStart: bodyEnd, closingFenceLfEnd: bodyEnd + 1,
        sourceBlockStart: codePrefix.length, sourceBlockEnd
      });
    };
    const fullDescriptor = descriptorForBody(codeBlock.body.join(''));
    for (let cursorOrdinal = codeBlockOrdinal; cursorOrdinal < blocks.length; cursorOrdinal += 1) {
      const cursorBlock = blocks[cursorOrdinal];
      const cursorPrefix = blocks.slice(0, cursorOrdinal).map((item) => item.source).join('\n\n')
        + (cursorOrdinal ? '\n\n' : '');
      const cursorOpeningEnd = cursorBlock.source.indexOf('\n');
      const cursorClosingStart = cursorBlock.source.lastIndexOf('\n');
      const cursorOpening = cursorOpeningEnd < 0 ? null : cursorBlock.source.slice(0, cursorOpeningEnd + 1);
      const cursorClosing = cursorClosingStart < 0 ? null : cursorBlock.source.slice(cursorClosingStart + 1);
      for (let remaining = cursorBlock.body.length; remaining >= 0; remaining -= 1) {
        const body = cursorBlock.body.slice(0, remaining).join('');
        const sourceBlock = cursorBlock.kind === 'code' ? `${cursorOpening}${body}\n${cursorClosing}`
          : cursorBlock.kind === 'heading' ? `# ${body}` : body;
        const descriptor = cursorOrdinal === codeBlockOrdinal ? descriptorForBody(body) : fullDescriptor;
        for (const ending of ['', '\n', '\n\n']) {
          declarations.push({ source: cursorPrefix + sourceBlock + ending, descriptor });
        }
      }
      const descriptor = cursorOrdinal === codeBlockOrdinal ? descriptorForBody('') : fullDescriptor;
      for (const empty of ['', ' ', '  ', '\n', '\n\n']) {
        declarations.push({ source: cursorPrefix + empty, descriptor });
      }
    }
    codeOrdinal += 1;
  }
  return shortStageUniqueCodeDeclarations(declarations);
}

export const shortStageDeclaredCodeDescriptors = shortStageBuildCodeDescriptors(shortStageBlocks);

export function createShortStageCodeCertifier() {
  return function certifyShortStageCode(evidence) {
    if (evidence?.codeCandidate !== true) return null;
    const safeInt = (value) => Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000
      ? value : null;
    const hashText = (value) => {
      let hash = 2166136261;
      for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
      }
      return hash >>> 0;
    };
    const source = typeof evidence.source === 'string' ? evidence.source : null;
    const descriptor = evidence.descriptor && typeof evidence.descriptor === 'object'
      && typeof evidence.descriptor.body === 'string' ? evidence.descriptor : null;
    const body = descriptor?.body ?? null;
    const bodyStart = safeInt(descriptor?.bodyStart);
    const bodyEnd = safeInt(descriptor?.bodyEnd);
    const blockOrdinal = safeInt(descriptor?.blockOrdinal);
    const codeOrdinal = safeInt(descriptor?.codeOrdinal);
    const sourceBlockStart = safeInt(descriptor?.sourceBlockStart);
    const sourceBlockEnd = safeInt(descriptor?.sourceBlockEnd);
    const descriptorAvailable = evidence.sourceDeclared === true && !!descriptor && body !== null
      && bodyStart !== null && bodyEnd !== null && blockOrdinal !== null && codeOrdinal !== null
      && sourceBlockStart !== null && sourceBlockEnd !== null;
    const sourceBodyExact = descriptorAvailable && source !== null
      && bodyEnd === bodyStart + body.length && sourceBlockStart <= bodyStart
      && bodyEnd <= sourceBlockEnd && sourceBlockEnd <= source.length
      && source.slice(bodyStart, bodyEnd) === body;
    const domText = typeof evidence.domText === 'string' ? evidence.domText : null;
    const domBodyVariant = sourceBodyExact && domText === body ? 'literal'
      : sourceBodyExact && domText === `${body}\n` ? 'literal+closing-lf' : null;
    const observedBlockOrdinal = safeInt(evidence.observedBlockOrdinal);
    const observedCodeOrdinal = safeInt(evidence.observedCodeOrdinal);
    const prePresent = evidence.prePresent === true;
    const preChildCount = safeInt(evidence.preChildCount);
    const preOnlyCode = preChildCount === 1 && evidence.preDirectCode === true;
    const correctBlock = descriptorAvailable && observedBlockOrdinal === blockOrdinal;
    const correctCode = descriptorAvailable && observedCodeOrdinal === codeOrdinal;
    const blockConnected = evidence.blockConnected === true;
    const preConnected = evidence.preConnected === true;
    const codeConnected = evidence.codeConnected === true;
    const blockOwnsPre = evidence.blockOwnsPre === true;
    const preInsideSurface = evidence.preInsideSurface === true;
    const codeInsidePre = evidence.codeInsidePre === true;
    const anchorPrefix = typeof evidence.anchorPrefix === 'string' ? evidence.anchorPrefix : null;
    const focusPrefix = typeof evidence.focusPrefix === 'string' ? evidence.focusPrefix : null;
    const prefixValid = (prefix) => sourceBodyExact && prefix !== null
      && prefix.length <= body.length && prefix === body.slice(0, prefix.length);
    const anchorPrefixMatch = prefixValid(anchorPrefix);
    const focusPrefixMatch = prefixValid(focusPrefix);
    const anchorCumulative = anchorPrefix === null ? null : anchorPrefix.length;
    const focusCumulative = focusPrefix === null ? null : focusPrefix.length;
    const anchorInBody = anchorPrefixMatch;
    const focusInBody = focusPrefixMatch;
    const anchorSourceOffset = anchorPrefixMatch ? bodyStart + anchorCumulative : null;
    const focusSourceOffset = focusPrefixMatch ? bodyStart + focusCumulative : null;
    const nativeCollapsed = typeof evidence.nativeCollapsed === 'boolean'
      ? evidence.nativeCollapsed : null;
    const nativeDirection = ['none', 'forward', 'backward'].includes(evidence.nativeDirection)
      ? evidence.nativeDirection : null;
    const anchorLocal = safeInt(evidence.anchorLocal);
    const focusLocal = safeInt(evidence.focusLocal);
    const structuralValid = descriptorAvailable && sourceBodyExact && domBodyVariant !== null
      && prePresent && preOnlyCode && correctBlock && correctCode && blockConnected && preConnected
      && codeConnected && blockOwnsPre && preInsideSurface && codeInsidePre;
    const selectionOrderValid = anchorPrefixMatch && focusPrefixMatch && (
      nativeCollapsed === true
        ? nativeDirection === 'none'
          && anchorCumulative === focusCumulative && anchorSourceOffset === focusSourceOffset
        : nativeCollapsed === false && (
          (nativeDirection === 'forward'
            && anchorCumulative < focusCumulative && anchorSourceOffset < focusSourceOffset)
          || (nativeDirection === 'backward'
            && anchorCumulative > focusCumulative && anchorSourceOffset > focusSourceOffset)
        )
    );
    const nativeValid = anchorLocal !== null && focusLocal !== null && selectionOrderValid;
    return {
      codeCandidate: true,
      valid: structuralValid && nativeValid,
      descriptorAvailable,
      sourceBodyExact,
      bodyHash: body === null ? null : hashText(body),
      blockOrdinal,
      codeOrdinal,
      bodyStart,
      bodyEnd,
      bodyLength: body?.length ?? null,
      domTextLength: safeInt(domText?.length),
      domBodyVariant,
      prePresent,
      preOrdinal: safeInt(evidence.preOrdinal),
      observedBlockOrdinal,
      observedCodeOrdinal,
      preOnlyCode,
      correctBlock,
      correctCode,
      blockConnected,
      preConnected,
      codeConnected,
      blockOwnsPre,
      preInsideSurface,
      codeInsidePre,
      nativeCollapsed,
      nativeDirection,
      anchorLocal,
      focusLocal,
      anchorCumulative,
      focusCumulative,
      anchorPrefixMatch,
      focusPrefixMatch,
      anchorInBody,
      focusInBody,
      anchorSourceOffset,
      focusSourceOffset
    };
  };
}

function shortStageDeletionOracle(mode) {
  const values = new Map();
  const add = (value, rank) => values.set(value, Math.max(values.get(value) ?? -1, rank));
  if (mode !== 'full') {
    for (let end = shortStageInitial.length; end >= 0; end -= 1) add(shortStageInitial.slice(0, end), end);
  } else {
    // Independently declared EOF states: preceding blocks stay byte-for-byte
    // untouched. Only the current body's literal units and its empty-row
    // representation may disappear; arbitrary subsequences are not accepted.
    for (let index = shortStageBlocks.length - 1; index >= 0; index -= 1) {
      const block = shortStageBlocks[index];
      const prefix = shortStageBlocks.slice(0, index).map((item) => item.source).join('\n\n')
        + (index ? '\n\n' : '');
      for (let remaining = block.body.length; remaining >= 0; remaining -= 1) {
        const body = block.body.slice(0, remaining).join('');
        const source = block.kind === 'code' ? `~~~bash\n${body}\n~~~`
          : block.kind === 'heading' ? `# ${body}` : body;
        for (const ending of ['', '\n', '\n\n']) add(prefix + source + ending, index * 100 + remaining);
      }
      for (const empty of ['', ' ', '  ', '\n', '\n\n']) add(prefix + empty, index * 100);
    }
  }
  add('', 0);
  return values;
}

export function shortStagePhaseModel(mode) {
  const initial = shortStageInitial;
  const positions = [
    { selector: 'p', index: 0, needle: shortStageBlocks[0].source, offset: 1 },
    { selector: 'h1', index: 0, needle: 'Heading', offset: 2 },
    { selector: 'p', index: 1, needle: 'Target paragraph here.', offset: 7 },
    { selector: 'pre code', index: 0, needle: 'echo hi', offset: 2 },
    { selector: 'p', index: 2, needle: 'End.', offset: 1 }
  ].map((position, phaseIndex) => {
    const sourceOffset = initial.indexOf(position.needle) + position.offset;
    return {
      ...position,
      phaseIndex,
      sourceOffset,
      insertedSource: initial.slice(0, sourceOffset) + 'V' + initial.slice(sourceOffset)
    };
  });
  const oracle = shortStageDeletionOracle(mode);
  const sourcesByRank = new Map();
  for (const [source, rank] of oracle) {
    if (!sourcesByRank.has(rank)) sourcesByRank.set(rank, []);
    sourcesByRank.get(rank).push(source);
  }
  const descendingRanks = [...sourcesByRank.keys()].sort((left, right) => right - left);
  const ascendingRanks = [...descendingRanks].reverse();
  const deletionForwardGroups = descendingRanks.map((rank) => [...sourcesByRank.get(rank)]);
  const deletionReverseGroups = ascendingRanks.map((rank) => [...sourcesByRank.get(rank)]);
  const entered = mode === 'full' ? 'Z\n\n  ' : 'Z\n';
  const continued = mode === 'full' ? 'Z\n\nXY' : 'Z\nXY';
  const shortened = mode === 'full' ? 'Z\n\nX' : 'Z\nX';
  const branchBase = 'Z';
  const branch = 'ZB';
  const reentrySources = ['', branchBase, entered, shortened, continued, shortened];
  const positionForwardGroups = positions.flatMap((position) => [
    [position.insertedSource],
    [initial]
  ]);
  const positionReverseGroups = positions.slice().reverse().flatMap((position) => [
    [initial],
    [position.insertedSource]
  ]);
  const forwardGraphGroups = [
    [initial],
    ...positionForwardGroups,
    ...deletionForwardGroups,
    ...reentrySources.slice(1).map((source) => [source])
  ];
  const fullUndoGroups = forwardGraphGroups.slice().reverse().map((group) => [...group]);
  const fullRedoGroups = forwardGraphGroups.map((group) => [...group]);
  const branchToZGroups = [shortened, continued, shortened, entered, branchBase].map((source) => [source]);
  const restoreInitialGroups = [
    [branchBase],
    ...deletionReverseGroups,
    ...positionReverseGroups,
    [initial]
  ];
  const middleOffset = initial.indexOf('Target paragraph here.') + 1;
  const middleQSource = initial.slice(0, middleOffset) + 'Q' + initial.slice(middleOffset);
  const phaseIds = {
    fixture: 'fixture',
    positions: positions.map((position) => `position-${position.phaseIndex}`),
    deletion: 'deletion',
    emptyExtraBackspace: 'empty-extra-backspace',
    reentry: 'empty-reentry',
    fullUndo: 'full-undo',
    fullRedo: 'full-redo',
    branchToZ: 'branch-to-z',
    branchInput: 'branch-input-b',
    invalidRedo: 'invalid-redo-at-zb',
    undoBranch: 'undo-b-to-z',
    redoBranch: 'redo-b-to-zb',
    undoBranchAgain: 'undo-b-again',
    restoreInitial: 'restore-initial',
    middleQ: 'middle-q',
    middleQUndo: 'middle-q-undo'
  };
  const phases = [
    { id: phaseIds.fixture, groups: [[''], [initial]] },
    ...positions.map((position) => ({
      id: phaseIds.positions[position.phaseIndex],
      groups: [[initial], [position.insertedSource], [initial]]
    })),
    { id: phaseIds.deletion, groups: deletionForwardGroups },
    { id: phaseIds.emptyExtraBackspace, groups: [['']] },
    { id: phaseIds.reentry, groups: reentrySources.map((source) => [source]) },
    { id: phaseIds.fullUndo, groups: fullUndoGroups },
    { id: phaseIds.fullRedo, groups: fullRedoGroups },
    { id: phaseIds.branchToZ, groups: branchToZGroups },
    { id: phaseIds.branchInput, groups: [[branchBase], [branch]] },
    { id: phaseIds.invalidRedo, groups: [[branch]] },
    { id: phaseIds.undoBranch, groups: [[branch], [branchBase]] },
    { id: phaseIds.redoBranch, groups: [[branchBase], [branch]] },
    { id: phaseIds.undoBranchAgain, groups: [[branch], [branchBase]] },
    { id: phaseIds.restoreInitial, groups: restoreInitialGroups },
    { id: phaseIds.middleQ, groups: [[initial], [middleQSource]] },
    { id: phaseIds.middleQUndo, groups: [[middleQSource], [initial]] }
  ];
  const allowed = new Set(phases.flatMap((item) => item.groups.flat()));
  return {
    allowed,
    branch,
    branchBase,
    continued,
    deletionForwardGroups,
    entered,
    initial,
    middleOffset,
    middleQSource,
    oracle,
    phaseIds,
    phases,
    positions,
    reentrySources,
    shortened
  };
}

export async function openShortStage(page, mode, initial, beforeFixture) {
  const opened = await openVisual(page, initial, undefined, beforeFixture);
  const strings = await page.evaluate(() => window.EasyMDEEditorRootBootstrap.strings.immersive);
  if (mode === 'split') await page.getByRole('button', { name: strings.split, exact: true }).last().click();
  if (mode === 'ordinary') await page.getByRole('button', { name: strings.exit, exact: true }).click();
  const surface = mode === 'full' ? opened.visual : page.locator('.easymde-source-react .cm-content');
  await expect(surface).toBeVisible();
  await expect(surface).toHaveAttribute('contenteditable', 'true');
  if (mode === 'full') await expect(opened.visual.locator('[data-easymde-preview-window-spacer]')).toHaveCount(0);
  if (mode !== 'full') await surface.click();
  return { ...opened, surface, mode };
}

export async function installBackgroundProbe(page) {
  const readCapabilities = () => page.evaluate(() => ({
    hooks: typeof window.wp?.hooks?.addAction === 'function'
      && typeof window.wp.hooks.removeAction === 'function'
      && typeof window.wp.hooks.doAction === 'function',
    jquery: typeof window.jQuery === 'function',
    heartbeatInterval: typeof window.wp?.heartbeat?.interval === 'function',
    postChanged: typeof window.wp?.autosave?.server?.postChanged === 'function',
    autosaveInterval: Number(window.autosaveL10n?.autosaveInterval) > 0
  }));
  let capabilities = await readCapabilities();
  const deadline = Date.now() + 15_000;
  while (Object.values(capabilities).some((value) => !value) && Date.now() < deadline) {
    await page.waitForTimeout(100);
    capabilities = await readCapabilities();
  }
  const missing = Object.entries(capabilities)
    .filter(([, value]) => !value)
    .map(([key]) => key);
  if (missing.length) throw new Error(`background-core-api-missing:${missing.join(',')}`);
  return page.evaluate(() => {
    const readInterval = () => {
      const heartbeat = window.wp?.heartbeat;
      if (!heartbeat || 'function' !== typeof heartbeat.interval) return null;
      try {
        const value = heartbeat.interval();
        return Number.isFinite(value) && value > 0 ? value : null;
      } catch {
        return null;
      }
    };
    const readMinimalInterval = () => {
      const value = Number(window.heartbeatSettings?.minimalInterval);
      return Number.isFinite(value) && value > 0 && value <= 600 ? value : 0;
    };
    const readHeartbeat = () => {
      const heartbeat = window.wp?.heartbeat;
      let coreHasFocus = null, connectionError = null;
      try {
        if (heartbeat && 'function' === typeof heartbeat.hasFocus) {
          coreHasFocus = Boolean(heartbeat.hasFocus());
        }
      } catch { /* read-only observation */ }
      try {
        if (heartbeat && 'function' === typeof heartbeat.hasConnectionError) {
          connectionError = Boolean(heartbeat.hasConnectionError());
        }
      } catch { /* read-only observation */ }
      return {
        interval: readInterval(),
        minimalInterval: readMinimalInterval(),
        visibility: document.visibilityState,
        documentHasFocus: document.hasFocus(),
        coreHasFocus,
        connectionError
      };
    };
    const hooks = window.wp?.hooks;
    if (!hooks || 'function' !== typeof hooks.addAction
      || 'function' !== typeof hooks.removeAction) {
      throw new Error('background-hook-api-unavailable');
    }
    if (!window.jQuery) throw new Error('background-jquery-unavailable');
    const send = [], tick = [], autosave = [], autosaveAttempts = [], visibility = [], focus = [];
    let pendingSend = null, pendingAutosaveAttempt = null;
    const onSend = () => {
      const heartbeat = readHeartbeat();
      const entry = { ordinal: send.length + 1, at: performance.now(),
        visibility: heartbeat.visibility, documentHasFocus: heartbeat.documentHasFocus,
        coreHasFocus: heartbeat.coreHasFocus };
      send.push(entry);
      pendingSend = entry;
    };
    const onTick = () => {
      const at = performance.now();
      const matched = pendingSend;
      tick.push({ ordinal: tick.length + 1, at,
        durationMs: matched === null ? null : Math.max(0, at - matched.at),
        sendOrdinal: matched?.ordinal ?? null,
        sendVisibility: matched?.visibility ?? null,
        sendDocumentHasFocus: matched?.documentHasFocus ?? null,
        sendCoreHasFocus: matched?.coreHasFocus ?? null,
        visibility: document.visibilityState,
        documentHasFocus: document.hasFocus() });
      pendingSend = null;
    };
    const onBeforeAutosave = (_event, data) => {
      const heartbeat = readHeartbeat();
      let postChanged = null, contentMatchesCurrent = null;
      try { postChanged = Boolean(window.wp?.autosave?.server?.postChanged?.()); }
      catch { /* read-only observation */ }
      try {
        const source = document.querySelector('#easymde-source')?.value ?? '';
        contentMatchesCurrent = typeof data?.content === 'string'
          && data.content === source;
      } catch { /* read-only observation */ }
      const entry = { ordinal: autosaveAttempts.length + 1, at: performance.now(),
        visibility: heartbeat.visibility, documentHasFocus: heartbeat.documentHasFocus,
        coreHasFocus: heartbeat.coreHasFocus, postChanged, contentMatchesCurrent };
      autosaveAttempts.push(entry);
      pendingAutosaveAttempt = entry;
    };
    const onAfterAutosave = (_event, data) => {
      const matched = pendingAutosaveAttempt;
      autosave.push({ ordinal: autosave.length + 1, at: performance.now(),
        success: data?.success === true,
        status: document.visibilityState,
        attemptOrdinal: matched?.ordinal ?? null,
        visibility: document.visibilityState,
        documentHasFocus: document.hasFocus() });
      pendingAutosaveAttempt = null;
    };
    const onVisibility = () => {
      const heartbeat = readHeartbeat();
      visibility.push({ ordinal: visibility.length + 1, at: performance.now(),
        state: document.visibilityState, documentHasFocus: heartbeat.documentHasFocus,
        coreHasFocus: heartbeat.coreHasFocus });
    };
    const onFocus = () => {
      const heartbeat = readHeartbeat();
      focus.push({ ordinal: focus.length + 1, at: performance.now(), type: 'focus',
        documentHasFocus: heartbeat.documentHasFocus,
        coreHasFocus: heartbeat.coreHasFocus });
    };
    const onBlur = () => {
      const heartbeat = readHeartbeat();
      focus.push({ ordinal: focus.length + 1, at: performance.now(), type: 'blur',
        documentHasFocus: heartbeat.documentHasFocus,
        coreHasFocus: heartbeat.coreHasFocus });
    };
    hooks.addAction('heartbeat.send', 'easymde-background-probe', onSend);
    hooks.addAction('heartbeat.tick', 'easymde-background-probe', onTick);
    window.jQuery(document).on('before-autosave.easymdeBackgroundProbe', onBeforeAutosave);
    window.jQuery(document).on('after-autosave.easymdeBackgroundProbe', onAfterAutosave);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);
    const localDraftPolicy = () => {
      const bootstrap = window.EasyMDEEditorRootBootstrap;
      const general = bootstrap?.settings?.general;
      const drafts = bootstrap?.localDrafts;
      const interval = Number(general?.autoSaveInterval);
      const exposed = Number.isFinite(interval) && interval > 0;
      return { applicable: Boolean(general?.autoSave && drafts?.enabled && exposed),
        exposed, intervalSeconds: exposed ? interval : null };
    };
    const localDraftObservation = () => {
      const policy = localDraftPolicy();
      if (!policy.applicable) return { ...policy, storage: null };
      const bootstrap = window.EasyMDEEditorRootBootstrap;
      const drafts = bootstrap?.localDrafts;
      const field = Number(document.querySelector('#post_ID')?.value);
      const postId = Number.isSafeInteger(field) && field >= 0 ? field : Number(drafts?.postId);
      const identity = `${drafts?.siteKey}:${drafts?.userId}:${postId || 'new'}`;
      const key = `easymde:draft:v${drafts?.schemaVersion}:${identity}`;
      const source = document.querySelector('#easymde-source')?.value ?? '';
      try {
        const raw = window.localStorage.getItem(key);
        if (raw === null) {
          return { ...policy, storage: { present: false, updatedAt: null,
            contentMatchesCurrent: false, invalid: false } };
        }
        const parsed = JSON.parse(raw);
        const content = typeof parsed?.content === 'string' ? parsed.content : null;
        const updatedAt = Number(parsed?.updatedAt);
        return { ...policy, storage: {
          present: true,
          updatedAt: Number.isInteger(updatedAt) && updatedAt > 0 ? updatedAt : null,
          contentMatchesCurrent: content !== null && content === source,
          invalid: content === null
        } };
      } catch {
        return { ...policy, storage: { present: false, updatedAt: null,
          contentMatchesCurrent: false, invalid: true } };
      }
    };
    window.__easymdeBackgroundProbe = {
      read: () => {
        const surface = document.querySelector('[data-easymde-preview-html-sink]');
        return {
          intervals: { heartbeat: readInterval(),
            autosave: Number(window.autosaveL10n?.autosaveInterval) || null,
            localDraft: localDraftPolicy() },
          heartbeat: readHeartbeat(),
          localDraft: localDraftObservation(),
          send: [...send], tick: [...tick], autosave: [...autosave],
          autosaveAttempts: [...autosaveAttempts], visibility: [...visibility],
          focus: [...focus],
          visibilityState: document.visibilityState,
          documentHasFocus: document.hasFocus(),
          postChanged: Boolean(window.wp?.autosave?.server?.postChanged?.()),
          sessionStatus: document.querySelector('[data-easymde-session-status]')
            ?.getAttribute('data-easymde-session-status') ?? null,
          surfaceEditable: Boolean(surface?.isContentEditable),
          lockPressed: document.querySelector('.easymde-immersive-preview-lock')
            ?.getAttribute('aria-pressed') ?? null
        };
      },
      cleanup: () => {
        hooks.removeAction('heartbeat.send', 'easymde-background-probe');
        hooks.removeAction('heartbeat.tick', 'easymde-background-probe');
        window.jQuery(document).off('before-autosave.easymdeBackgroundProbe');
        window.jQuery(document).off('after-autosave.easymdeBackgroundProbe');
        document.removeEventListener('visibilitychange', onVisibility);
        window.removeEventListener('focus', onFocus);
        window.removeEventListener('blur', onBlur);
        delete window.__easymdeBackgroundProbe;
      }
    };
    return { heartbeat: readHeartbeat(),
      autosave: Number(window.autosaveL10n?.autosaveInterval) || null,
      localDraft: localDraftObservation() };
  });
}

export async function startShortStageProbe(page, stage, allowedValues, {
  backgroundObservation = false,
  allowLocked = false,
  frames = null,
  codeDescriptorsBySource = null
} = {}) {
  const healthFailures = [];
  let emptySeen = false;
  const allowedList = Array.from(allowedValues);
  const certifyCodeEnabled = stage.mode === 'full' && codeDescriptorsBySource instanceof Map;
  const codeDescriptors = certifyCodeEnabled
    ? allowedList.map((source) => codeDescriptorsBySource.get(source) ?? null)
    : [];
  let codeCertifierHandle = null;
  if (certifyCodeEnabled) {
    codeCertifierHandle = await page.evaluateHandle(createShortStageCodeCertifier);
    await page.evaluate((certifier) => { window.__shortStageCertifyCode = certifier; }, codeCertifierHandle);
    await codeCertifierHandle.dispose();
    codeCertifierHandle = null;
  }
  await page.exposeFunction('__shortStageSignal', (event) => {
    if (event.kind === 'empty') emptySeen = true;
    else if (event.kind === 'shortcut') console.log(JSON.stringify({ phase: 'short-stage-first-Redo-shortcut', ...event.shortcut }));
    else if (event.kind === 'visual-deviation') frames?.preserveFirstAnomaly(event.code);
    else { frames?.preserveFirstAnomaly(event.code); healthFailures.push(event.code); }
  });
  await page.evaluate(({ mode, allowed, backgroundObservation, allowLocked, certifyCodeEnabled, codeDescriptors }) => {
    const legal = new Set(allowed), rows = [], health = [];
    const codeDescriptorBySource = new Map();
    const certifyCode = certifyCodeEnabled ? window.__shortStageCertifyCode : null;
    if (certifyCodeEnabled && typeof certifyCode !== 'function') {
      throw new Error('short-stage-code-certifier-missing');
    }
    for (let index = 0; index < allowed.length; index += 1) {
      const descriptor = codeDescriptors[index];
      if (descriptor && typeof descriptor === 'object') codeDescriptorBySource.set(allowed[index], descriptor);
    }
    let recording = true, active = true, failure = null, ranks = null, previousRank = Infinity;
    const surfaceNow = () => mode === 'full'
      ? document.querySelector(allowLocked ? '[data-easymde-preview-html-sink]' : '[data-easymde-preview-html-sink][role="textbox"]')
      : document.querySelector('.easymde-source-react .cm-content');
    const sourceNow = () => document.querySelector('#easymde-source')?.value ?? '';
    const rect = node => {
      const box = node?.getBoundingClientRect();
      return box ? { x: box.x, y: box.y, width: box.width, height: box.height } : null;
    };
    const nativeSnapshot = () => {
      const native = getSelection();
      const point = (node, offset) => ({
        connected: !!node?.isConnected, nodeType: node?.nodeType ?? null,
        parentTag: node?.parentElement?.tagName ?? null, offset,
        textLength: node instanceof Text ? node.length : null
      });
      return { anchor: point(native?.anchorNode, native?.anchorOffset ?? null),
        focus: point(native?.focusNode, native?.focusOffset ?? null), collapsed: native?.isCollapsed ?? null };
    };
    const nativeWitness = () => {
      const surface = surfaceNow(), native = getSelection();
      const range = native?.rangeCount === 1 ? native.getRangeAt(0) : null;
      const sourceSurface = document.querySelector('.easymde-source-react .cm-content');
      const witnessSurface = mode === 'full' ? surface : sourceSurface;
      const point = (node, offset) => {
        if (!witnessSurface || !node?.isConnected || !witnessSurface.contains(node)) {
          return { kind: 'outside', connected: false, inside: false, blockOrdinal: null,
            lineIndex: null, column: null, blockLength: null, surfaceOffset: null };
        }
        if (node === witnessSurface) {
          return { kind: 'surface', connected: true, inside: true,
            blockOrdinal: null, lineIndex: null, column: null, blockLength: null, surfaceOffset: offset };
        }
        if (mode !== 'full') {
          const line = (node instanceof Element ? node : node.parentElement)?.closest('.cm-line');
          if (!line || !sourceSurface?.contains(line)) {
            return { kind: 'outside', connected: false, inside: true, blockOrdinal: null,
              lineIndex: null, column: null, blockLength: null, surfaceOffset: null };
          }
          const lines = [...sourceSurface.querySelectorAll('.cm-line')];
          const prefix = line.ownerDocument.createRange();
          prefix.selectNodeContents(line);
          prefix.setEnd(node, offset);
          return { kind: 'source', connected: line.isConnected, inside: true,
            blockOrdinal: null, lineIndex: lines.indexOf(line), column: prefix.toString().length,
            blockLength: line.textContent.length, surfaceOffset: null };
        }
        let block = node;
        while (block && block.parentNode !== witnessSurface) block = block.parentNode;
        if (!block || block.parentNode !== witnessSurface) {
          return { kind: 'outside', connected: false, inside: true, blockOrdinal: null,
            lineIndex: null, column: null, blockLength: null, surfaceOffset: null };
        }
        const blocks = [...witnessSurface.children].filter((child) => !child.hasAttribute('data-easymde-preview-window-spacer'));
        const prefix = block.ownerDocument.createRange();
        prefix.selectNodeContents(block);
        prefix.setEnd(node, offset);
        return { kind: 'visual', connected: block.isConnected, inside: true,
          blockOrdinal: blocks.indexOf(block), lineIndex: null, column: prefix.toString().length,
          blockLength: block.textContent.length, surfaceOffset: null };
      };
      const backward = !!native && !native.isCollapsed && !!range
        && !(range.startContainer === native.anchorNode && range.startOffset === native.anchorOffset);
      return { collapsed: native?.isCollapsed ?? null,
        direction: native?.isCollapsed ? 'none' : backward ? 'backward' : 'forward',
        anchor: point(native?.anchorNode, native?.anchorOffset ?? 0),
        focus: point(native?.focusNode, native?.focusOffset ?? 0) };
    };
    const codeCertificateFor = (source) => {
      if (!certifyCodeEnabled) return null;
      const surface = surfaceNow(), native = getSelection();
      const preList = surface ? [...surface.querySelectorAll('pre')] : [];
      const codePreList = preList.filter((pre) => pre.querySelector(':scope > code') instanceof HTMLElement);
      const preForNode = (node) => {
        const element = node instanceof Element ? node : node?.parentElement ?? null;
        const pre = element?.closest?.('pre') ?? null;
        return pre && surface?.contains(pre) ? pre : null;
      };
      const anchorPre = preForNode(native?.anchorNode);
      const focusPre = preForNode(native?.focusNode);
      const selectedPre = anchorPre && anchorPre === focusPre ? anchorPre : null;
      const descriptor = codeDescriptorBySource.get(source) ?? null;
      const codeCandidate = !!anchorPre || !!focusPre;
      if (!codeCandidate) return null;
      const code = selectedPre?.querySelector(':scope > code') ?? null;
      let block = selectedPre;
      while (block && block.parentNode !== surface) block = block.parentNode;
      if (block?.parentNode !== surface) block = null;
      const blockChildren = surface ? [...surface.children]
        .filter((child) => !child.hasAttribute('data-easymde-preview-window-spacer')) : [];
      const prefixText = (node, offset) => {
        if (!(code instanceof HTMLElement) || !node || !Number.isSafeInteger(offset)
          || !(node === code || code.contains(node))) return null;
        try {
          const prefix = code.ownerDocument.createRange();
          prefix.selectNodeContents(code);
          prefix.setEnd(node, offset);
          return prefix.toString();
        } catch { return null; }
      };
      const anchorPrefix = prefixText(native?.anchorNode, native?.anchorOffset);
      const focusPrefix = prefixText(native?.focusNode, native?.focusOffset);
      const range = native?.rangeCount === 1 ? native.getRangeAt(0) : null;
      const backward = !!native && !native.isCollapsed && !!range
        && !(range.startContainer === native.anchorNode && range.startOffset === native.anchorOffset);
      return certifyCode({
        source,
        descriptor,
        sourceDeclared: !!descriptor,
        codeCandidate: true,
        domText: code instanceof HTMLElement && typeof code.textContent === 'string'
          ? code.textContent : null,
        prePresent: !!selectedPre,
        preOrdinal: selectedPre ? preList.indexOf(selectedPre) : null,
        observedBlockOrdinal: block ? blockChildren.indexOf(block) : null,
        observedCodeOrdinal: selectedPre ? codePreList.indexOf(selectedPre) : null,
        preChildCount: selectedPre?.childNodes.length ?? 0,
        preDirectCode: !!selectedPre && selectedPre.childNodes.length === 1
          && selectedPre.firstChild === code,
        codeInsidePre: !!(code instanceof HTMLElement && selectedPre
          && code.parentElement === selectedPre),
        blockConnected: !!block?.isConnected,
        preConnected: !!selectedPre?.isConnected,
        codeConnected: !!(code instanceof HTMLElement && code.isConnected),
        blockOwnsPre: !!(block && selectedPre && (block === selectedPre || block.contains(selectedPre))),
        preInsideSurface: !!(surface && selectedPre && surface.contains(selectedPre)),
        nativeCollapsed: native?.isCollapsed ?? null,
        nativeDirection: native?.isCollapsed ? 'none' : backward ? 'backward' : 'forward',
        anchorLocal: native?.anchorNode instanceof Text ? native.anchorOffset
          : native?.anchorNode === code ? native.anchorOffset : null,
        focusLocal: native?.focusNode instanceof Text ? native.focusOffset
          : native?.focusNode === code ? native.focusOffset : null,
        anchorPrefix,
        focusPrefix
      });
    };
    const refuse = (code) => {
      if (failure) return;
      failure = { code, sourceLength: sourceNow().length, native: nativeSnapshot(),
        surfaceConnected: !!surfaceNow()?.isConnected, editable: surfaceNow()?.isContentEditable === true,
        lock: document.querySelector('.easymde-immersive-preview-lock')?.getAttribute('aria-pressed') ?? null,
        failure: document.querySelector('[data-easymde-visual-failure]')?.getAttribute('data-easymde-visual-failure') ?? null };
      void window.__shortStageSignal({ kind: 'failure', code });
    };
    let quiet = null, pauseBaseline = null, layoutObserver = null, firstDeviation = null;
    const periods = [];
    const keep = (first, last, value) => {
      if (first.length < 2) first.push(value);
      else { last.push(value); if (last.length > 30) last.shift(); }
    };
    const deviation = (code, sample) => {
      if (firstDeviation) return;
      firstDeviation = { code, period: quiet?.report.label ?? null, sample };
      void window.__shortStageSignal({ kind: 'visual-deviation', code });
    };
    const sampleQuiet = kind => {
      if (!quiet) {
        if (pauseBaseline && sourceNow() !== pauseBaseline.value) refuse('short-stage-quiet-document-mutated');
        return;
      }
      const { baseline, report } = quiet, surface = surfaceNow(), value = sourceNow();
      const sample = { kind, at: performance.now(), sourceLength: value.length,
        sourceUnchanged: value === baseline.value,
        surfaceSame: surface === baseline.surface, phase: surface?.getAttribute('data-easymde-preview-phase') ?? null,
        busy: surface?.getAttribute('aria-busy') ?? null, focused: document.hasFocus(),
        visible: document.visibilityState === 'visible', editable: surface?.isContentEditable === true,
        lock: document.querySelector('.easymde-immersive-preview-lock')?.getAttribute('aria-pressed') ?? null,
        nodes: baseline.nodes.map(({ selector, node, box }) => {
          const live = surface?.querySelector(selector), current = rect(live);
          return { same: live === node, connected: node.isConnected, visible: Boolean(current && current.width > 0 && current.height > 0
            && current.y < innerHeight && current.y + current.height > 0), box: current,
            delta: box && current ? Math.max(...Object.keys(box).map(key => Math.abs(current[key] - box[key]))) : null };
        }),
        windowScroll: { x: window.scrollX, y: window.scrollY },
        ancestorScroll: baseline.scroll.map(item => ({ top: item.node.scrollTop, left: item.node.scrollLeft })),
        scrollSame: window.scrollX === baseline.windowX && window.scrollY === baseline.windowY
          && baseline.scroll.every(item => item.node.scrollTop === item.top && item.node.scrollLeft === item.left) };
      report.samples++; if (kind === 'raf') report.rafSamples++;
      report.sourceUnchanged &&= sample.sourceUnchanged;
      if (!sample.surfaceSame || sample.nodes.some(node => !node.same || !node.connected)) report.identityChangeSamples++;
      if (sample.nodes.some(node => node.delta === null || node.delta > 0)) report.geometryChangeSamples++;
      if (!sample.scrollSame) report.scrollChangeSamples++;
      report.maxGeometryDelta = Math.max(report.maxGeometryDelta, ...sample.nodes.map(node => node.delta ?? 0));
      keep(report.first, report.last, sample);
      if (!sample.sourceUnchanged) refuse('short-stage-quiet-document-mutated');
      if (!sample.surfaceSame || sample.nodes.some(node => !node.same || !node.connected || node.delta === null || node.delta > 0) || !sample.scrollSame) {
        deviation('short-stage-quiet-visual-change', sample);
      }
    };
    const observeLayout = entries => {
      if (!quiet) return;
      for (const entry of entries) {
        if (entry.startTime < quiet.report.startedAt) continue;
        const sample = { at: entry.startTime, value: entry.value, recentInput: entry.hadRecentInput,
          editorSourceCount: (entry.sources ?? []).filter(source => source.node && (surfaceNow()?.contains(source.node) ?? false)).length };
        quiet.report.layoutShiftCount++; quiet.report.layoutShiftValue += entry.value;
        keep(quiet.report.layoutFirst, quiet.report.layoutLast, sample);
        if (sample.editorSourceCount) deviation('short-stage-editor-layout-shift', sample);
      }
    };
    const layoutShiftSupported = backgroundObservation && Boolean(window.PerformanceObserver?.supportedEntryTypes?.includes('layout-shift'));
    if (layoutShiftSupported) {
      layoutObserver = new PerformanceObserver(list => observeLayout(list.getEntries()));
      layoutObserver.observe({ type: 'layout-shift', buffered: false });
    }
    const endQuiet = () => {
      observeLayout(layoutObserver?.takeRecords() ?? []); sampleQuiet('end');
      if (quiet) { quiet.report.endedAt = performance.now(); quiet = null; }
      return { failure, firstDeviation, layoutShiftSupported, periods };
    };
    const beginQuiet = label => {
      endQuiet();
      if (periods.length >= 16) return refuse('short-stage-quiet-period-bound');
      const surface = surfaceNow(), value = sourceNow();
      pauseBaseline ??= { value };
      const nodes = ['h1', 'p'].map(selector => ({ selector, node: surface?.querySelector(selector) }))
        .filter(item => item.node && (() => { const box = rect(item.node); return box && box.width > 0 && box.height > 0
          && box.y < innerHeight && box.y + box.height > 0; })())
        .map(item => ({ ...item, box: rect(item.node) }));
      const scroll = [];
      let ancestor = surface;
      for (; ancestor && scroll.length < 16; ancestor = ancestor.parentElement) scroll.push({ node: ancestor, top: ancestor.scrollTop, left: ancestor.scrollLeft });
      const report = { label, startedAt: performance.now(), endedAt: null, samples: 0, rafSamples: 0,
        visibleUntouchedNodeCount: nodes.length, sourceUnchanged: true,
        baseline: { sourceLength: value.length }, scrollAncestorSamplingComplete: ancestor === null,
        identityChangeSamples: 0, geometryChangeSamples: 0, scrollChangeSamples: 0, maxGeometryDelta: 0,
        layoutShiftCount: 0, layoutShiftValue: 0, first: [], last: [], layoutFirst: [], layoutLast: [] };
      quiet = { baseline: { ...pauseBaseline, surface, nodes, scroll, windowX: window.scrollX, windowY: window.scrollY }, report };
      periods.push(report); sampleQuiet('begin');
    };
    let lastWitnessKeys = new Set();
    const witnessConnectedInside = (witness) => witness?.anchor?.connected === true
      && witness.anchor.inside === true
      && witness?.focus?.connected === true
      && witness.focus.inside === true;
    const observe = () => {
      if (!recording || failure) return;
      sampleQuiet('document');
      const value = sourceNow();
      if (!legal.has(value)) return refuse('short-stage-independent-source-oracle');
      if (ranks) {
        const rank = ranks.get(value);
        if (rank > previousRank) return refuse('short-stage-independent-deletion-order');
        previousRank = rank;
      }
      const witness = nativeWitness();
      const codeCertificate = codeCertificateFor(value);
      const entry = { witness, codeCertificate };
      const key = JSON.stringify(entry);
      const lastRow = rows.at(-1);
      if (lastRow?.value !== value) {
        if (rows.length === 1024) return refuse('short-stage-canonical-observation-bound');
        lastWitnessKeys = new Set([key]);
        rows.push({ value, witness, codeCertificate, witnesses: [entry] });
      } else if (witnessConnectedInside(witness) && !lastWitnessKeys.has(key) && lastRow.witnesses.length < 256) {
        lastWitnessKeys.add(key);
        lastRow.witnesses.push(entry);
      }
      if (value === '') void window.__shortStageSignal({ kind: 'empty' });
    };
    document.addEventListener('beforeinput', observe, true);
    document.addEventListener('input', observe, true);
    document.addEventListener('selectionchange', observe, true);
    observe();
    const sample = () => {
      if (!active) return;
      const surface = surfaceNow();
      const native = getSelection();
      const repairAttribute = document.querySelector('[data-easymde-visual-deletion-repair]')
        ?.getAttribute('data-easymde-visual-deletion-repair') ?? null;
      const repairCount = repairAttribute === null ? 0 : Number(repairAttribute);
      if (repairAttribute !== null && !/^(?:0|[1-9][0-9]*)$/u.test(repairAttribute)) {
        refuse('short-stage-visual-deletion-repair-count');
      }
      if (!Number.isInteger(repairCount) || repairCount !== 0) {
        refuse('short-stage-visual-deletion-repair-count');
      }
      const state = { editable: surface?.isContentEditable === true,
        lock: mode === 'full' ? document.querySelector('.easymde-immersive-preview-lock')?.getAttribute('aria-pressed') : null,
        nativeConnected: !!native?.anchorNode?.isConnected && !!native?.focusNode?.isConnected,
        nativeInside: !!surface && !!native?.anchorNode && !!native?.focusNode
          && surface.contains(native.anchorNode) && surface.contains(native.focusNode),
        failure: !!document.querySelector('[data-easymde-visual-failure]'), repairCount };
      const userLocked = allowLocked && state.lock === 'true';
      if ((!state.editable && !userLocked) || state.failure || mode === 'full' && state.lock !== 'false' && !userLocked) refuse('short-stage-lock-or-editability');
      if (!userLocked && (!state.nativeConnected || !state.nativeInside)) refuse('short-stage-native-selection-outside-owner');
      observe();
      sampleQuiet('raf');
      if (health.length < 128 && JSON.stringify(health.at(-1)) !== JSON.stringify(state)) health.push(state);
      requestAnimationFrame(sample);
    };
    sample();
    let firstRedo = null;
    const onShortcut = (event) => {
      if (firstRedo || !(event.ctrlKey || event.metaKey) || event.code !== 'KeyZ' || !event.shiftKey) return;
      const target = event.target instanceof Element ? event.target : null;
      firstRedo = { key: event.key, code: event.code, ctrl: event.ctrlKey, meta: event.metaKey,
        shift: event.shiftKey, alt: event.altKey, trusted: event.isTrusted,
        surface: target?.closest('.easymde-source-react .cm-content') ? 'Source'
          : target?.closest('[data-easymde-preview-html-sink][role="textbox"]') ? 'Visual' : 'outside' };
      void window.__shortStageSignal({ kind: 'shortcut', shortcut: firstRedo });
    };
    document.addEventListener('keydown', onShortcut, true);
    // Preview-commit epoch. Every keydown opens an operation; when a formal
    // Preview cycle (non-ready phase, busy, or refreshing) is observed after
    // it, that operation stays pending until the surface commits a new ready
    // Preview signature. This closes the window in which Undo/Redo has changed
    // the source but React has not yet flipped the surface to loading.
    const previewSignatureNow = () => {
      const signature = surfaceNow()?.easymdePreviewSignature;
      return typeof signature === 'string' ? signature : '';
    };
    const previewCycleActive = () => {
      const surface = surfaceNow();
      return !!surface && (surface.getAttribute('data-easymde-preview-phase') !== 'ready'
        || surface.getAttribute('aria-busy') === 'true'
        || surface.getAttribute('data-easymde-preview-refreshing') === '1');
    };
    let previewEpoch = { startSignature: previewSignatureNow(), cycleObserved: previewCycleActive() };
    const notePreviewCycle = () => { if (previewCycleActive()) previewEpoch.cycleObserved = true; };
    const onOperationKeydown = () => {
      previewEpoch = { startSignature: previewSignatureNow(), cycleObserved: previewCycleActive() };
    };
    document.addEventListener('keydown', onOperationKeydown, true);
    const previewCycleObserver = new MutationObserver(notePreviewCycle);
    previewCycleObserver.observe(document, { subtree: true, childList: true, attributes: true,
      attributeFilter: ['data-easymde-preview-phase', 'aria-busy', 'data-easymde-preview-refreshing'] });
    const previewCommitPending = () => {
      const signature = previewSignatureNow();
      return previewEpoch.cycleObserved && (signature === '' || signature === previewEpoch.startSignature);
    };
    const settledSample = () => {
      const surface = surfaceNow();
      const native = getSelection();
      const source = sourceNow();
      const repairAttribute = document.querySelector('[data-easymde-visual-deletion-repair]')
        ?.getAttribute('data-easymde-visual-deletion-repair') ?? null;
      const repairCount = repairAttribute === null
        ? 0
        : /^(?:0|[1-9][0-9]*)$/u.test(repairAttribute) ? Number(repairAttribute) : null;
      return {
        source,
        witness: nativeWitness(),
        codeCertificate: codeCertificateFor(source),
        phase: surface?.getAttribute('data-easymde-preview-phase') ?? null,
        accepted: surface?.getAttribute('data-easymde-preview-accepted') ?? null,
        busy: surface?.getAttribute('aria-busy') ?? null,
        session: document.querySelector('[data-easymde-session-status]')
          ?.getAttribute('data-easymde-session-status') ?? null,
        lock: document.querySelector('.easymde-immersive-preview-lock')
          ?.getAttribute('aria-pressed') ?? null,
        editable: surface?.isContentEditable === true,
        nativeConnected: !!surface && !!native?.anchorNode?.isConnected && !!native?.focusNode?.isConnected
          && surface.contains(native.anchorNode) && surface.contains(native.focusNode),
        failureAbsent: !document.querySelector('[data-easymde-visual-failure]')
          && !surface?.hasAttribute('data-easymde-preview-error'),
        repairCount,
        stickyFailure: !!failure,
        previewSignature: previewSignatureNow(),
        previewCommitPending: previewCommitPending()
      };
    };
    // A settled read is two complete samples separated by two animation frames;
    // any source, caret, Preview phase, or signature movement marks it unstable.
    const settledState = async () => {
      notePreviewCycle();
      const first = settledSample();
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      notePreviewCycle();
      const second = settledSample();
      return { ...second, stable: JSON.stringify(first) === JSON.stringify(second) };
    };
    window.__shortStageProbe = {
      snapshot: () => ({
        rows: rows.map((row) => ({ ...row, witnesses: [...row.witnesses] })),
        health: [...health],
        failure,
        firstRedo
      }),
      witness: () => nativeWitness(),
      settledState,
      beginQuiet, endQuiet,
      resumeEditing: () => { const observation = endQuiet(); pauseBaseline = null; return observation; },
      beginDeletion: (entries) => {
        ranks = new Map(entries); previousRank = Infinity;
        legal.clear(); for (const value of ranks.keys()) legal.add(value);
        rows.length = 0; lastWitnessKeys = new Set(); observe();
      },
      allow: (values) => { ranks = null; legal.clear(); for (const value of values) legal.add(value); },
      stopRecording: () => { recording = false; },
      stop: () => {
        endQuiet(); layoutObserver?.disconnect(); active = false; recording = false;
        previewCycleObserver.disconnect();
        document.removeEventListener('beforeinput', observe, true);
        document.removeEventListener('input', observe, true);
        document.removeEventListener('selectionchange', observe, true);
        document.removeEventListener('keydown', onShortcut, true);
        document.removeEventListener('keydown', onOperationKeydown, true);
        delete window.__shortStageCertifyCode;
      }
    };
  }, { mode: stage.mode, allowed: allowedList, backgroundObservation, allowLocked, certifyCodeEnabled, codeDescriptors });
  const onPopup = () => healthFailures.push('short-stage-popup');
  page.on('popup', onPopup);
  const guard = () => {
    frames?.guard();
    expect(stage.failures, 'short-stage continuous editor errors').toEqual([]);
    expect(healthFailures, 'short-stage continuous health monitor').toEqual([]);
  };
  return {
    guard,
    async beginQuiet(label) {
      guard(); frames?.stage(label);
      await page.evaluate(label => window.__shortStageProbe.beginQuiet(label), label);
      guard();
    },
    async endQuiet() {
      const observation = await page.evaluate(() => window.__shortStageProbe.endQuiet());
      expect(observation.failure, 'quiet period preserves source and DOM invariants').toBeNull();
      guard();
    },
    async resumeEditing() {
      const observation = await page.evaluate(() => window.__shortStageProbe.resumeEditing());
      expect(observation.failure, 'quiet periods preserve document before resumed editing').toBeNull();
      guard();
    },
    empty: () => emptySeen,
    press: async (key) => {
      guard();
      await page.keyboard.press(key);
      if (key === 'Backspace' || key === 'Delete') await page.waitForTimeout(100);
      guard();
    },
    type: async (text) => {
      for (const character of text) {
        guard();
        await page.keyboard.type(character);
        await page.waitForTimeout(50);
        guard();
      }
    },
    snapshot: () => page.evaluate(() => window.__shortStageProbe.snapshot()),
    witness: () => page.evaluate(() => window.__shortStageProbe.witness()),
    settledState: () => page.evaluate(() => window.__shortStageProbe.settledState()),
    freeze: () => page.evaluate(() => window.__shortStageProbe.stopRecording()),
    beginDeletion: (oracle) => page.evaluate((entries) => window.__shortStageProbe.beginDeletion(entries), [...oracle]),
    allow: (values) => page.evaluate((allowed) => window.__shortStageProbe.allow(allowed), [...values]),
    async stop() {
      page.off('popup', onPopup);
      let observation = null;
      try {
        if (backgroundObservation) {
          observation = await page.evaluate(() => window.__shortStageProbe.endQuiet());
          console.log(JSON.stringify({ phase: 'short-stage-background-scalar-evidence',
            sampling: 'every-rAF-and-document-notification; max-16-periods; first-2-last-30-per-period', ...observation }));
        }
      } finally { await page.evaluate(() => window.__shortStageProbe?.stop()); }
      if (backgroundObservation) {
        expect(observation.failure, 'quiet period document invariants survive cleanup').toBeNull();
        guard();
      }
    }
  };
}

export async function startShortStageFrames(page, surface, { retainStages = false } = {}) {
  const require = createRequire(import.meta.url);
  const { PNG } = require(join(dirname(require.resolve('playwright-core/package.json')), 'lib/utilsBundle.js'));
  const box = await surface.boundingBox(), viewport = page.viewportSize();
  if (!box || !viewport) throw new Error('short-stage-private-frame-region-unavailable');
  const clip = { x: Math.max(0, Math.ceil(box.x)), y: Math.max(0, Math.ceil(box.y)),
    right: Math.min(viewport.width, Math.floor(box.x + box.width)),
    bottom: Math.min(viewport.height, Math.floor(box.y + box.height)) };
  if (clip.right <= clip.x || clip.bottom <= clip.y) throw new Error('short-stage-private-frame-region-empty');
  if (retainStages) {
    const configured = test.info().project.use;
    const assets = await page.evaluate(() => [...new Set(performance.getEntriesByType('resource')
      .map(entry => new URL(entry.name).pathname.split('/').at(-1))
      .filter(name => /^admin-editor-[A-Za-z0-9_-]+\.js$/u.test(name ?? '') && !name.includes('loader-')))]);
    console.log(JSON.stringify({ phase: 'short-stage-background-runtime', browserVersion: page.context().browser()?.version() ?? null,
      headless: configured.headless ?? true, channel: configured.channel ?? null,
      configuredBinary: configured.launchOptions?.executablePath?.split(/[\\/]/u).at(-1) ?? null,
      expectedAsset: process.env.EASYMDE_E2E_EXPECT_EDITOR_BUILD ?? null, assets }));
  }
  const cdp = await page.context().newCDPSession(page), first = [], tail = [], pendingAcks = new Set(), failures = [];
  let operation = 'before-actions', lifecycle = 'running', acceptingFrames = true, ackTotal = 0, ackSucceeded = 0;
  const stages = new Map();
  let anomaly = null;
  const stage = label => {
    operation = label;
    if (!retainStages || stages.has(label)) return;
    if (stages.size === 16) { recordFailure('stage-bound', new Error('stage-bound')); return; }
    stages.set(label, { received: 0, first: [], last: [] });
  };
  const recordFailure = (stage, error, ackOrdinal = null) => {
    const message = typeof error?.message === 'string' ? error.message : '';
    const code = message.includes('Target page, context or browser has been closed') ? 'cdp-target-closed'
      : /session closed/iu.test(message) ? 'cdp-session-closed' : 'frame-operation-rejected';
    const failure = { stage, lifecycle, operation, ackOrdinal, code,
      errorClass: typeof error?.name === 'string' && /^[A-Za-z]*Error$/u.test(error.name) ? error.name : 'UnknownError' };
    failures.push(failure);
    console.log(JSON.stringify({ phase: 'short-stage-frame-capture-failure', ...failure }));
  };
  stage(operation);
  const onFrame = (event) => {
    if (acceptingFrames) {
      const frame = { data: event.data, operation, timestamp: event.metadata.timestamp, ordinal: ackTotal + 1 };
      if (first.length < 2) first.push(frame);
      else { tail.push(frame); if (tail.length > 30) tail.shift(); }
      const period = stages.get(operation);
      if (period) {
        period.received++;
        if (!period.first.length) period.first.push(frame);
        else { period.last.push(frame); if (period.last.length > 2) period.last.shift(); }
      }
      if (anomaly?.awaitingAfter) { anomaly.after = frame; anomaly.awaitingAfter = false; }
    }
    const ordinal = ++ackTotal;
    let sending;
    try { sending = cdp.send('Page.screencastFrameAck', { sessionId: event.sessionId }); }
    catch (error) { recordFailure('ack', error, ordinal); return; }
    const ack = sending.then(() => { ackSucceeded += 1; }, (error) => { recordFailure('ack', error, ordinal); });
    pendingAcks.add(ack);
    void ack.then(() => { pendingAcks.delete(ack); }, () => { pendingAcks.delete(ack); });
  };
  cdp.on('Page.screencastFrame', onFrame);
  try { await cdp.send('Page.startScreencast', { format: 'png', maxWidth: viewport.width, maxHeight: viewport.height, everyNthFrame: 1 }); }
  catch (error) {
    lifecycle = 'setup-failed'; recordFailure('start-screencast', error);
    acceptingFrames = false; cdp.off('Page.screencastFrame', onFrame);
    await Promise.allSettled([...pendingAcks]);
    try { await cdp.detach(); } catch (detachError) { recordFailure('detach', detachError); }
    throw new Error('short-stage-compositor-start-failed');
  }
  return {
    stage,
    guard() { if (failures.length) throw new Error('short-stage-compositor-capture-failed'); },
    preserveFirstAnomaly(code) {
      if (!anomaly) anomaly = { code, operation, before: tail.at(-1) ?? first.at(-1) ?? null,
        after: null, awaitingAfter: true };
    },
    async stop(label) {
      lifecycle = 'stopping';
      const pendingAtStop = pendingAcks.size;
      try { await cdp.send('Page.stopScreencast'); }
      catch (error) { recordFailure('stop-screencast', error); }
      finally { acceptingFrames = false; cdp.off('Page.screencastFrame', onFrame); }
      await Promise.allSettled([...pendingAcks]);
      const pendingAtDetach = pendingAcks.size;
      try { await cdp.detach(); } catch (error) { recordFailure('detach', error); }
      lifecycle = 'stopped';
      const frames = [...new Set([...first, ...tail, ...[...stages.values()].flatMap(period => [...period.first, ...period.last]),
        ...[anomaly?.before, anomaly?.after].filter(Boolean)])].sort((left, right) => left.ordinal - right.ordinal), evidence = [];
      try {
        for (const [index, frame] of frames.entries()) {
          // Decode/crop only after actions and transport shutdown. Raw viewport frames never leave memory.
          const image = PNG.sync.read(Buffer.from(frame.data, 'base64'));
          const sx = image.width / viewport.width, sy = image.height / viewport.height;
          const x = Math.ceil(clip.x * sx), y = Math.ceil(clip.y * sy);
          const width = Math.floor(clip.right * sx) - x, height = Math.floor(clip.bottom * sy) - y;
          const cropped = new PNG({ width, height });
          PNG.bitblt(image, cropped, x, y, width, height, 0, 0);
          const path = test.info().outputPath(`${label}-article-frame-${index}.png`);
          await writeFile(path, PNG.sync.write(cropped));
          await test.info().attach(`${label}-article-frame-${index}`, { path, contentType: 'image/png' });
          evidence.push({ operation: frame.operation, ordinal: frame.ordinal, timestamp: frame.timestamp, width, height });
        }
      } catch (error) { recordFailure('crop-save-attach', error); }
      console.log(JSON.stringify({ phase: 'short-stage-private-compositor-evidence', label,
        sampling: retainStages ? 'continuous-ACK; first-2-last-30-global; max-16-stages-first-1-last-2; max-2-anomaly-neighbors; max-82-retained-frames'
          : 'first-2-last-30-limited-coverage', frameCount: frames.length, savedFrameCount: evidence.length,
        captureClip: clip,
        periods: [...stages].map(([label, period]) => ({ label, received: period.received,
          retained: period.first.length + period.last.length })),
        anomaly: anomaly ? { code: anomaly.code, operation: anomaly.operation, beforeOrdinal: anomaly.before?.ordinal ?? null,
          afterOrdinal: anomaly.after?.ordinal ?? null, capture: 'last-received-before-and-first-after-signal-not-onset-proof' } : null,
        ackAudit: { total: ackTotal, succeeded: ackSucceeded, rejected: failures.filter((failure) => failure.stage === 'ack').length,
          pendingAtStop, pendingAtDetach, pendingAfterCleanup: pendingAcks.size }, failures, frames: evidence }));
      if (failures.length) throw new Error('short-stage-compositor-capture-failed');
      expect(frames.length, 'bounded compositor evidence requires more than one real frame').toBeGreaterThan(1);
    }
  };
}

export function shortStageHistoryLedger(rows, initial, allowed) {
  const states = [];
  for (const row of rows) {
    expect(allowed.has(row.value), 'each historical source was independently declared and verified').toBe(true);
    expect(!!row.witness, 'each historical operation retained a public native caret witness').toBe(true);
    const witnesses = Array.isArray(row.witnesses) && row.witnesses.length > 0
      ? row.witnesses.map((entry) => ({
        witness: entry.witness,
        codeCertificate: entry.codeCertificate ?? null
      }))
      : [{ witness: row.witness, codeCertificate: row.codeCertificate ?? null }];
    expect(witnesses.every((entry) => !!entry.witness),
      'each historical operation retained a public native caret witness').toBe(true);
    states.push({
      value: row.value,
      witness: row.witness,
      codeCertificate: row.codeCertificate ?? null,
      witnesses
    });
  }
  expect(states[0]?.value === initial, 'the first observed source is the declared initial document').toBe(true);
  expect(states.length, 'natural editing produced at least one observable history state').toBeGreaterThan(0);
  return { states, initial, latest: states.at(-1),
    cursor: { undo: new Set([states.length - 1]), redo: null } };
}

function shortStageWitnessMatchesCodeCertificate(witness, certificate) {
  if (!witness || !certificate?.valid || certificate.codeCandidate !== true) return false;
  if (typeof certificate.nativeCollapsed !== 'boolean'
    || !['none', 'forward', 'backward'].includes(certificate.nativeDirection)) return false;
  const pointMatches = (point, cumulative) => point?.kind === 'visual'
    && point.connected === true && point.inside === true
    && point.blockOrdinal === certificate.blockOrdinal
    && point.column === cumulative
    && point.blockLength === certificate.domTextLength;
  return pointMatches(witness.anchor, certificate.anchorCumulative)
    && pointMatches(witness.focus, certificate.focusCumulative)
    && witness.collapsed === certificate.nativeCollapsed
    && witness.direction === certificate.nativeDirection;
}

function shortStageCodeCertificateCoreMatches(left, right) {
  const integerKeys = [
    'blockOrdinal', 'codeOrdinal', 'bodyStart', 'bodyEnd', 'bodyLength', 'bodyHash',
    'preOrdinal', 'observedBlockOrdinal', 'observedCodeOrdinal',
    'anchorCumulative', 'focusCumulative', 'anchorSourceOffset', 'focusSourceOffset'
  ];
  const booleanKeys = [
    'valid', 'descriptorAvailable', 'sourceBodyExact', 'prePresent', 'preOnlyCode',
    'correctBlock', 'correctCode', 'blockConnected', 'preConnected', 'codeConnected',
    'blockOwnsPre', 'preInsideSurface', 'codeInsidePre',
    'anchorPrefixMatch', 'focusPrefixMatch', 'anchorInBody', 'focusInBody'
  ];
  if (left?.codeCandidate !== true || right?.codeCandidate !== true) return false;
  if (typeof left.nativeCollapsed !== 'boolean' || left.nativeCollapsed !== right.nativeCollapsed) return false;
  if (!['none', 'forward', 'backward'].includes(left.nativeDirection)
    || left.nativeDirection !== right.nativeDirection) return false;
  if (!booleanKeys.every((key) => left[key] === true && right[key] === true)) return false;
  if (!integerKeys.every((key) => Number.isSafeInteger(left[key]) && left[key] === right[key])) return false;
  return left.nativeCollapsed
    ? left.nativeDirection === 'none'
      && left.anchorCumulative === left.focusCumulative && left.anchorSourceOffset === left.focusSourceOffset
    : (left.nativeDirection === 'forward'
        && left.anchorCumulative < left.focusCumulative && left.anchorSourceOffset < left.focusSourceOffset)
      || (left.nativeDirection === 'backward'
        && left.anchorCumulative > left.focusCumulative && left.anchorSourceOffset > left.focusSourceOffset);
}

function shortStageWitnessMatches(left, right) {
  if (!left?.witness || !right?.witness) return false;
  const leftCertificate = left.codeCertificate;
  const rightCertificate = right.codeCertificate;
  if (leftCertificate?.codeCandidate !== true && rightCertificate?.codeCandidate !== true) {
    return JSON.stringify(left.witness) === JSON.stringify(right.witness);
  }
  if (!shortStageCodeCertificateCoreMatches(leftCertificate, rightCertificate)
    || !shortStageWitnessMatchesCodeCertificate(left.witness, leftCertificate)
    || !shortStageWitnessMatchesCodeCertificate(right.witness, rightCertificate)) return false;
  const variants = [leftCertificate.domBodyVariant, rightCertificate.domBodyVariant];
  if (variants[0] === variants[1]) {
    return JSON.stringify(left.witness) === JSON.stringify(right.witness);
  }
  if (!((variants[0] === 'literal' && variants[1] === 'literal+closing-lf')
    || (variants[0] === 'literal+closing-lf' && variants[1] === 'literal'))) return false;
  const literal = leftCertificate.domBodyVariant === 'literal' ? leftCertificate : rightCertificate;
  const withClosingLf = leftCertificate.domBodyVariant === 'literal+closing-lf'
    ? leftCertificate : rightCertificate;
  if (literal.domTextLength !== literal.bodyLength
    || withClosingLf.domTextLength !== withClosingLf.bodyLength + 1) return false;
  const withoutBlockLength = (witness) => ({
    ...witness,
    anchor: Object.fromEntries(Object.entries(witness.anchor)
      .filter(([key]) => key !== 'blockLength')),
    focus: Object.fromEntries(Object.entries(witness.focus)
      .filter(([key]) => key !== 'blockLength'))
  });
  return JSON.stringify(withoutBlockLength(left.witness))
    === JSON.stringify(withoutBlockLength(right.witness));
}

function shortStageWitnessEntries(state) {
  if (!state) return [];
  if (Array.isArray(state.witnesses)) return state.witnesses;
  return state.witness ? [{ witness: state.witness, codeCertificate: state.codeCertificate ?? null }] : [];
}

export function shortStageStateMatches(left, right) {
  if (!left || !right || left.value !== right.value) return false;
  const leftEntries = shortStageWitnessEntries(left);
  const rightEntries = shortStageWitnessEntries(right);
  return leftEntries.some((leftEntry) => rightEntries.some((rightEntry) =>
    shortStageWitnessMatches(leftEntry, rightEntry)));
}

export function shortStageObservedStateChanged(before, after) {
  return after?.source !== before?.value || !shortStageWitnessMatches(before, {
    value: after?.source, witness: after?.witness, codeCertificate: after?.codeCertificate
  });
}

function shortStageFullOperationReady(state) {
  return state?.phase === 'ready'
    && (state.accepted === '1' || state.source === '')
    && state.busy === 'false'
    && state.session === 'ready'
    && state.lock === 'false'
    && state.editable === true
    && state.nativeConnected === true
    && state.failureAbsent === true
    && state.stickyFailure === false
    && state.repairCount === 0
    && state.stable === true
    && state.previewCommitPending === false;
}

function shortStageFullOperationUnsafe(state) {
  return !state
    || state.failureAbsent !== true
    || state.stickyFailure !== false
    || !Number.isInteger(state.repairCount)
    || state.repairCount !== 0
    || state.lock !== 'false'
    || state.editable !== true
    || state.nativeConnected !== true;
}

function shortStageTargetMatches(state, target) {
  return !!state && !!target && state.value === target.value
    && (target.witness === null || target.witness === undefined || shortStageStateMatches(state, target));
}

export function shortStageHistoryCursorSnapshot(history) {
  const cursor = history.cursor.redo ?? history.cursor.undo;
  if (!cursor?.size) throw new Error('short-stage-history-known-cursor-missing');
  return new Set(cursor);
}

export function shortStageRestoreHistoryCursor(history, cursor) {
  history.cursor.undo = new Set(cursor);
  history.cursor.redo = null;
}

export function shortStageNextHistoryCursor(states, cursor, after, direction) {
  const nextCursor = new Set();
  states.forEach((state, stateIndex) => {
    if (!shortStageStateMatches(state, after)) return;
    for (const cursorIndex of cursor) {
      if (direction === 'undo' ? stateIndex < cursorIndex : stateIndex > cursorIndex) {
        nextCursor.add(stateIndex); break;
      }
    }
  });
  return nextCursor;
}

export function shortStageHistoryExit(states, cursor, target, direction, requireBoundary) {
  const matchesTarget = !!target && cursor?.size > 0
    && [...cursor].every((index) => shortStageTargetMatches(states[index], target));
  if (!matchesTarget) return { exit: false, uncovered: false };
  if (!requireBoundary) return { exit: true, uncovered: false };
  const boundary = direction === 'undo' ? 0 : states.length - 1;
  const targetHasWitness = !!target.witness && typeof target.witness === 'object'
    && Object.keys(target.witness).length > 0;
  const proven = targetHasWitness && cursor.has(boundary)
    && shortStageTargetMatches(states[boundary], target);
  return proven ? { exit: true, uncovered: false } : { exit: false, uncovered: true };
}

export async function shortStageReplayHistory(page, stage, probe, history, direction, target = null, requireBoundary = target === null) {
  const key = direction === 'undo' ? 'Control+z' : 'Control+Shift+Z';
  const expectedTarget = target ?? (direction === 'undo' ? history.states[0] : history.latest);
  const bound = history.states.length * 3 + 16;
  let current;
  if (stage.mode === 'full') {
    const entry = await probe.settledState();
    if (shortStageFullOperationUnsafe(entry)) throw new Error('short-stage-history-full-operation-unsafe');
    current = { value: entry.source, witness: entry.witness,
      codeCertificate: entry.codeCertificate ?? null };
  } else {
    current = { value: await stage.source.inputValue(), witness: await probe.witness() };
  }
  let cursor = direction === 'undo' ? history.cursor.undo : history.cursor.redo;
  if (!cursor?.size) throw new Error('short-stage-history-known-cursor-missing');
  const currentAtKnownCursor = [...cursor].some((index) => shortStageStateMatches(history.states[index], current));
  if (!currentAtKnownCursor) throw new Error('short-stage-history-current-state-not-at-known-cursor');
  const initialExit = shortStageHistoryExit(history.states, cursor, expectedTarget, direction, requireBoundary);
  if (initialExit.uncovered) throw new Error('short-stage-history-target-occurrence-unproven');
  if (initialExit.exit) {
    if (direction === 'undo') history.cursor.redo = new Set(cursor);
    else history.cursor.undo = new Set(cursor);
    return new Set(cursor);
  }
  for (let step = 0; step < bound; step += 1) {
    const before = current;
    await probe.press(key);
    let after;
    if (stage.mode === 'full') {
      let unsafeSnapshot = null;
      let settledSnapshot = null;
      let lastSnapshot = null;
      let predicateError = null;
      const changed = snapshot => shortStageObservedStateChanged(before, snapshot);
      try {
        await expect.poll(async () => {
          let snapshot;
          try {
            snapshot = await probe.settledState();
          } catch (error) {
            predicateError = error;
            throw error;
          }
          lastSnapshot = snapshot;
          if (shortStageFullOperationUnsafe(snapshot)) {
            unsafeSnapshot = snapshot;
            return true;
          }
          if (!shortStageFullOperationReady(snapshot) || !changed(snapshot)) return false;
          settledSnapshot = snapshot;
          return true;
        }, { message: 'short-stage-history-full-operation-wait' }).toBe(true);
      } catch (error) {
        if (predicateError) throw predicateError;
        if (typeof error?.message !== 'string' || !error.message.includes('short-stage-history-full-operation-wait')) {
          throw error;
        }
        if (unsafeSnapshot) throw new Error('short-stage-history-full-operation-unsafe');
        if (lastSnapshot && shortStageFullOperationReady(lastSnapshot) && !changed(lastSnapshot)) {
          throw new Error('short-stage-history-full-operation-nochange');
        }
        throw new Error('short-stage-history-full-operation-pending');
      }
      if (unsafeSnapshot) throw new Error('short-stage-history-full-operation-unsafe');
      if (!settledSnapshot) throw new Error('short-stage-history-full-operation-pending');
      probe.guard();
      after = { value: settledSnapshot.source, witness: settledSnapshot.witness,
        codeCertificate: settledSnapshot.codeCertificate ?? null };
    } else {
      await expect.poll(async () => {
        const value = await stage.source.inputValue();
        const witness = await probe.witness();
        return value !== before.value || JSON.stringify(witness) !== JSON.stringify(before.witness);
      }, { message: `${direction} must produce a distinct observed native state` }).toBe(true);
      after = { value: await stage.source.inputValue(), witness: await probe.witness() };
    }
    // A real Undo may group several forward observations. Keep every duplicate
    // occurrence still reachable from the known cursor set; never infer depth.
    const nextCursor = shortStageNextHistoryCursor(history.states, cursor, after, direction);
    if (nextCursor.size === 0) throw new Error('short-stage-history-next-state-unobserved-under-cursor');
    cursor = nextCursor;
    current = after;
    history.cursor[direction] = new Set(cursor);
    const exit = shortStageHistoryExit(history.states, cursor, expectedTarget, direction, requireBoundary);
    if (exit.uncovered) throw new Error('short-stage-history-target-occurrence-unproven');
    if (exit.exit) {
      if (direction === 'undo') history.cursor.redo = new Set(cursor);
      else history.cursor.undo = new Set(cursor);
      return new Set(cursor);
    }
  }
  throw new Error('short-stage-natural-history-progress-bound');
}

export async function finishShortStageObservation(probe, frames, label, failed) {
  let firstCleanupError = null;
  for (const cleanup of [() => probe.stop(), () => frames.stop(label)]) {
    try { await cleanup(); }
    catch (error) {
      firstCleanupError ??= error;
      console.log(JSON.stringify({ phase: 'short-stage-evidence-cleanup-failure', label, errorClass: error.name,
        code: /^short-stage-[a-z-]+$/u.test(error.message ?? '') ? error.message : 'cleanup-operation-rejected' }));
    }
  }
  if (!failed && firstCleanupError) throw firstCleanupError;
}
