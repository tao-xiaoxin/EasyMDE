import { expect } from '@playwright/test';
import { chmod, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { CROSS_ROOT_STYLE_EXCLUDED_PROPERTIES } from "./hidden-context.mjs";
import { INPUT_STYLE_PROPERTIES } from "./hidden-context.mjs";
import { LI_STYLE_PROPERTIES } from "./hidden-context.mjs";
import { PSEUDO_STYLE_PROPERTIES } from "./hidden-context.mjs";
import { ROOT_STYLE_PROPERTIES } from "./hidden-context.mjs";
import { geometryQuantum } from "./environment.mjs";
import { numericDelta } from "./geometry-measures.mjs";
import { previewSelector } from "./environment.mjs";
import { taskStates } from "./environment.mjs";

export async function installContextEvidence(page) {
  await page.evaluate(({
    geometryQuantum,
    selector,
    inputProperties,
    pseudoProperties,
    liProperties,
    rootProperties,
    rootCrossSurfaceExcludedProperties
  }) => {
    const preview = document.querySelector(selector);
    if (!(preview instanceof HTMLElement)) {
      throw new Error('wechat-task-context-evidence-preview-missing');
    }
    const nativeGetComputedStyle = window.getComputedStyle.bind(window);
    const rect = (element) => {
      const value = element.getBoundingClientRect();
      const result = {
        bottom: value.bottom,
        height: value.height,
        left: value.left,
        right: value.right,
        top: value.top,
        width: value.width
      };
      if (Object.values(result).some((item) => !Number.isFinite(item))) {
        throw new Error('wechat-task-context-evidence-geometry-invalid');
      }
      return result;
    };
    const relativeRect = (element, origin) => {
      const value = rect(element);
      return {
        bottom: value.bottom - origin.top,
        height: value.height,
        left: value.left - origin.left,
        right: value.right - origin.left,
        top: value.top - origin.top,
        width: value.width
      };
    };
    const textAnchor = (element) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node) {
        if (node.nodeValue?.trim()) {
          const range = document.createRange();
          range.selectNodeContents(node);
          return relativeRect(
            { getBoundingClientRect: () => range.getBoundingClientRect() },
            rect(element)
          );
        }
        node = walker.nextNode();
      }
      return null;
    };
    const token = (raw) => {
      const rawValue = String(raw).trim();
      const value = rawValue.toLowerCase();
      const numeric = (match, category) => ({
        category,
        enumValue: null,
        numeric: Number(match[1]),
        raw: rawValue
      });
      const pixels = value.match(/^(-?(?:\d+(?:\.\d+)?|\.\d+))px$/u);
      if (pixels) return numeric(pixels, 'px');
      const percentages = value.match(/^(-?(?:\d+(?:\.\d+)?|\.\d+))%$/u);
      if (percentages) return numeric(percentages, '%');
      const unitless = value.match(/^(-?(?:\d+(?:\.\d+)?|\.\d+))$/u);
      if (unitless) return numeric(unitless, 'number');
      if (/^[a-z][a-z0-9-]*$/u.test(value) && value.length <= 32) {
        return { category: 'enum', enumValue: value, numeric: null, raw: rawValue };
      }
      return {
        category: value ? 'other' : 'empty',
        enumValue: null,
        numeric: null,
        raw: rawValue
      };
    };
    const styleShape = (computed, properties) => properties.map((propertyName) => {
      const value = token(computed.getPropertyValue(propertyName));
      return { ...value, propertyName };
    });
    const publicStyle = (shape) => shape.map(({ category, numeric, propertyName }) => ({
      finiteNumeric: Number.isFinite(numeric),
      numeric: Number.isFinite(numeric) ? numeric : null,
      propertyName,
      valueCategory: category
    }));
    const compareStyle = (source, measurement, excludedProperties = new Set()) => {
      if (!source || !measurement) return null;
      const byName = new Map(measurement.map((entry) => [entry.propertyName, entry]));
      return source.filter((entry) => !excludedProperties.has(entry.propertyName)).map((sourceEntry) => {
        const measurementEntry = byName.get(sourceEntry.propertyName);
        if (!measurementEntry) {
          return {
            enumEqual: null,
            measurementCategory: 'missing',
            measurementFiniteNumeric: false,
            numericDelta: null,
            propertyName: sourceEntry.propertyName,
            sourceCategory: sourceEntry.category,
            sourceFiniteNumeric: Number.isFinite(sourceEntry.numeric),
            valuesEqual: null
          };
        }
        return {
          enumEqual: sourceEntry.category === 'enum' && measurementEntry.category === 'enum'
            ? sourceEntry.enumValue === measurementEntry.enumValue
            : null,
          measurementCategory: measurementEntry.category,
          measurementFiniteNumeric: Number.isFinite(measurementEntry.numeric),
          numericDelta: Number.isFinite(sourceEntry.numeric) && Number.isFinite(measurementEntry.numeric)
            ? Math.abs(sourceEntry.numeric - measurementEntry.numeric)
            : null,
          propertyName: sourceEntry.propertyName,
          sourceCategory: sourceEntry.category,
          sourceFiniteNumeric: Number.isFinite(sourceEntry.numeric),
          valuesEqual: sourceEntry.raw === measurementEntry.raw
        };
      });
    };
    const identity = (element) => ({
      attributes: [...element.attributes].map(({ name }) => name).sort(),
      classTokens: [...element.classList].sort(),
      localName: element.localName,
      namespaceURI: element.namespaceURI,
      type: element.getAttribute('type')
    });
    const path = (element) => {
      const result = [];
      let current = element;
      while (current && current !== preview) {
        const parent = current.parentElement;
        if (!parent) return null;
        result.unshift([...parent.children].indexOf(current));
        current = parent;
      }
      return current === preview ? result : null;
    };
    const contentWidth = (element, computed = nativeGetComputedStyle(element)) => {
      const value = rect(element);
      const edges = [
        'padding-left', 'padding-right', 'border-left-width', 'border-right-width'
      ].reduce((total, property) => (
        total + (Number.parseFloat(computed.getPropertyValue(property)) || 0)
      ), 0);
      return value.width - edges;
    };
    const pseudoPaint = (element, pseudo) => {
      const value = nativeGetComputedStyle(element, pseudo).getPropertyValue('content')
        .trim()
        .toLowerCase();
      return Boolean(value) && !['none', 'normal', '""', "''"].includes(value);
    };
    const readSource = () => {
      const inputs = [...preview.querySelectorAll('input[type="checkbox"]')];
      if (inputs.length !== 19) throw new Error('wechat-task-context-source-input-count-invalid');
      const sourceRootComputed = nativeGetComputedStyle(preview);
      return {
        inputs: inputs.map((input, index) => {
          const item = input.closest('li.task-list-item, li');
          const parent = input.parentElement;
          const listParent = item?.parentElement;
          if (!item || !parent || !listParent) {
            throw new Error('wechat-task-context-source-owner-missing');
          }
          const inputComputed = nativeGetComputedStyle(input);
          return {
            checked: input.checked,
            disabled: input.disabled,
            geometryCandidate: ['absolute', 'relative'].includes(
              inputComputed.getPropertyValue('position').trim().toLowerCase()
            ) || pseudoPaint(input, '::before') || pseudoPaint(input, '::after'),
            identity: identity(input),
            index,
            li: relativeRect(item, rect(listParent)),
            liStyle: styleShape(nativeGetComputedStyle(item), liProperties),
            path: path(input),
            pseudo: {
              after: styleShape(nativeGetComputedStyle(input, '::after'), pseudoProperties),
              before: styleShape(nativeGetComputedStyle(input, '::before'), pseudoProperties)
            },
            rect: relativeRect(input, rect(parent)),
            style: styleShape(inputComputed, inputProperties),
            textAnchor: textAnchor(parent)
          };
        }),
        root: {
          contentWidth: contentWidth(preview, sourceRootComputed),
          identity: identity(preview),
          childCount: preview.childElementCount,
          rect: rect(preview),
          style: styleShape(sourceRootComputed, rootProperties)
        }
      };
    };
    const sourceReference = readSource();
    const state = {
      hosts: new Map(),
      measurementInputs: new Map(),
      measurementLis: new Map(),
      measurementRoot: null,
      observerBatchSamples: [],
      sampledHosts: new WeakSet(),
      factoryVisitedInputs: new Set(),
      sourceFinal: null,
      sourceMutations: {
        attributeNames: new Set(),
        attributes: 0,
        characterData: 0,
        childList: 0,
        records: 0
      },
      styleReadCount: 0
    };
    const sourceRootIdentity = identity(preview);
    const isSourceRootClone = (element) => (
      element !== preview
      && element.localName === preview.localName
      && JSON.stringify([...element.classList].sort()) === JSON.stringify(sourceRootIdentity.classTokens)
    );
    const inputIndex = (host, element) => (
      [...host.querySelectorAll('input[type="checkbox"]')].indexOf(element)
    );
    const inputForListItem = (host, item) => {
      const input = item?.querySelector('input[type="checkbox"]');
      return input ? inputIndex(host, input) : -1;
    };
    const recordHost = (host) => {
      if (!(host instanceof HTMLElement) || state.hosts.has(host)) return;
      state.hosts.set(host, {
        className: host.className,
        connectedAtCapture: host.isConnected
      });
    };
    const measurementRootForHost = (host) => (
      [...host.querySelectorAll('*')].find(isSourceRootClone) ?? null
    );
    const sampleConnectedHost = (host, getter) => {
      if (!(host instanceof HTMLElement) || !host.isConnected || state.sampledHosts.has(host)) return;
      const rootClone = measurementRootForHost(host);
      if (!(rootClone instanceof HTMLElement)) return;
      state.sampledHosts.add(host);
      const inputs = [...host.querySelectorAll('input[type="checkbox"]')];
      const rootComputed = getter(rootClone);
      const sample = {
        hostClass: host.className,
        inputCount: inputs.length,
        inputs: [],
        root: {
          contentWidth: contentWidth(rootClone, rootComputed),
          rect: rect(rootClone),
          style: styleShape(rootComputed, rootProperties)
        },
        samplingStage: 'connected-style-read'
      };
      inputs.forEach((input, index) => {
        const item = input.closest('li.task-list-item, li');
        const parent = input.parentElement;
        const listParent = item?.parentElement;
        if (!item || !parent || !listParent) {
          throw new Error('wechat-task-context-observer-owner-missing');
        }
        sample.inputs.push({
          checked: input.checked,
          disabled: input.disabled,
          identity: identity(input),
          index,
          li: relativeRect(item, rect(listParent)),
          liStyle: styleShape(getter(item), liProperties),
          pseudo: {
            after: styleShape(getter(input, '::after'), pseudoProperties),
            before: styleShape(getter(input, '::before'), pseudoProperties)
          },
          rect: relativeRect(input, rect(parent)),
          style: styleShape(getter(input), inputProperties),
          textAnchor: textAnchor(parent)
        });
      });
      state.observerBatchSamples.push(sample);
    };
    const recordStyleRead = (element, pseudo, computed, nativeGetter) => {
      const host = element.closest?.(
        '.easymde-wechat-task-checkbox-measurement, .easymde-wechat-preview-measurement'
      );
      if (!(host instanceof HTMLElement) || !host.isConnected) return;
      recordHost(host);
      if (typeof nativeGetter === 'function') sampleConnectedHost(host, nativeGetter);
      state.styleReadCount += 1;
      const index = inputIndex(host, element);
      if (index >= 0) state.factoryVisitedInputs.add(index);
      const listItem = element.closest?.('li.task-list-item, li');
      const listIndex = inputForListItem(host, listItem);
      const rootClone = isSourceRootClone(element);
      const readGeometry = () => {
        if (rootClone) {
          return {
            contentWidth: contentWidth(element, computed),
            rect: rect(element)
          };
        }
        if (index >= 0) {
          const parent = element.parentElement;
          const item = element.closest('li.task-list-item, li');
          const listParent = item?.parentElement;
          return {
            li: item && listParent ? relativeRect(item, rect(listParent)) : null,
            rect: parent ? relativeRect(element, rect(parent)) : null,
            textAnchor: parent ? textAnchor(parent) : null
          };
        }
        if (listIndex >= 0 && listItem?.parentElement) {
          return { rect: relativeRect(listItem, rect(listItem.parentElement)) };
        }
        return null;
      };
      if (rootClone) {
        state.measurementRoot = {
          contentWidth: contentWidth(element, computed),
          rect: rect(element),
          style: styleShape(computed, rootProperties)
        };
        return;
      }
      if (index >= 0) {
        const current = state.measurementInputs.get(index) ?? {
          checked: element.checked,
          disabled: element.disabled,
          geometry: readGeometry(),
          identity: identity(element),
          index,
          pseudo: {},
          style: null
        };
        current.checked = element.checked;
        current.disabled = element.disabled;
        if (pseudo === '::before' || pseudo === '::after') {
          current.pseudo[pseudo.slice(2)] = styleShape(computed, pseudoProperties);
        } else {
          current.geometry = readGeometry();
          current.style = styleShape(computed, inputProperties);
        }
        state.measurementInputs.set(index, current);
        return;
      }
      if (listIndex >= 0 && listItem) {
        state.measurementLis.set(listIndex, {
          geometry: readGeometry(),
          index: listIndex,
          style: styleShape(computed, liProperties)
        });
      }
    };
    const contextObserver = new MutationObserver((records) => {
      records.forEach((record) => {
        [...record.addedNodes].forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          if (node.matches('.easymde-wechat-task-checkbox-measurement, .easymde-wechat-preview-measurement')) {
            recordHost(node);
          }
          node.querySelectorAll(
            '.easymde-wechat-task-checkbox-measurement, .easymde-wechat-preview-measurement'
          ).forEach(recordHost);
        });
      });
    });
    contextObserver.observe(document.body, { childList: true, subtree: true });
    const sourceObserver = new MutationObserver((records) => {
      records.forEach((record) => {
        state.sourceMutations.records += 1;
        if (record.type === 'attributes') {
          state.sourceMutations.attributes += 1;
          if (record.attributeName) state.sourceMutations.attributeNames.add(record.attributeName);
        } else if (record.type === 'characterData') {
          state.sourceMutations.characterData += 1;
        } else if (record.type === 'childList') {
          state.sourceMutations.childList += 1;
        }
      });
    });
    sourceObserver.observe(preview, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true
    });
    const drainSourceRecords = () => {
      const records = sourceObserver.takeRecords();
      records.forEach((record) => {
        state.sourceMutations.records += 1;
        if (record.type === 'attributes') {
          state.sourceMutations.attributes += 1;
          if (record.attributeName) state.sourceMutations.attributeNames.add(record.attributeName);
        } else if (record.type === 'characterData') {
          state.sourceMutations.characterData += 1;
        } else if (record.type === 'childList') {
          state.sourceMutations.childList += 1;
        }
      });
    };
    const publicSnapshot = (snapshot) => ({
      inputs: snapshot.inputs.map((input) => ({
        checked: input.checked,
        disabled: input.disabled,
        geometryCandidate: input.geometryCandidate,
        identity: input.identity,
        index: input.index,
        li: input.li,
        liStyle: publicStyle(input.liStyle),
        path: input.path,
        pseudo: {
          after: publicStyle(input.pseudo.after),
          before: publicStyle(input.pseudo.before)
        },
        rect: input.rect,
        style: publicStyle(input.style),
        textAnchor: input.textAnchor
      })),
      root: {
        contentWidth: snapshot.root.contentWidth,
        identity: snapshot.root.identity,
        childCount: snapshot.root.childCount,
        rect: snapshot.root.rect,
        style: publicStyle(snapshot.root.style)
      }
    });
    const publicObserverBatchSample = (sample) => ({
      hostClass: sample.hostClass,
      inputCount: sample.inputCount,
      inputs: sample.inputs.map((input) => {
        const source = sourceReference.inputs[input.index];
        return {
          checked: input.checked,
          disabled: input.disabled,
          identity: input.identity,
          index: input.index,
          li: input.li,
          liStyle: compareStyle(source?.liStyle, input.liStyle),
          pseudo: {
            after: compareStyle(source?.pseudo.after, input.pseudo.after),
            before: compareStyle(source?.pseudo.before, input.pseudo.before)
          },
          rect: input.rect,
          style: compareStyle(source?.style, input.style),
          textAnchor: input.textAnchor
        };
      }),
      root: {
        contentWidth: sample.root.contentWidth,
        rect: {
          height: sample.root.rect.height,
          width: sample.root.rect.width
        },
          style: compareStyle(
            sourceReference.root.style,
            sample.root.style,
            new Set(rootCrossSurfaceExcludedProperties)
        )
      },
      samplingStage: sample.samplingStage
    });
    const rectsClose = (left, right) => (
      left
      && right
      && ['bottom', 'height', 'left', 'right', 'top', 'width']
        .every((property) => Math.abs(left[property] - right[property]) <= geometryQuantum)
    );
    const structuralEqual = (left, right) => (
      left.inputs.length === right.inputs.length
      && JSON.stringify(left.root.identity) === JSON.stringify(right.root.identity)
      && left.root.childCount === right.root.childCount
      && left.inputs.every((input, index) => (
        input.checked === right.inputs[index].checked
        && input.disabled === right.inputs[index].disabled
        && JSON.stringify(input.identity) === JSON.stringify(right.inputs[index].identity)
        && JSON.stringify(input.path) === JSON.stringify(right.inputs[index].path)
      ))
      && rectsClose(left.root.rect, right.root.rect)
      && Math.abs(left.root.contentWidth - right.root.contentWidth) <= geometryQuantum
    );
    globalThis.__wechatTaskContextEvidence = {
      finish() {
        contextObserver.disconnect();
        sourceObserver.disconnect();
      },
      readState() {
        drainSourceRecords();
        state.sourceFinal = readSource();
        const measurementInputs = [...state.measurementInputs.values()]
          .sort((left, right) => left.index - right.index)
          .map((input) => {
            const source = sourceReference.inputs[input.index];
            return {
              checked: input.checked,
              disabled: input.disabled,
              identity: input.identity,
              index: input.index,
              li: input.geometry?.li ?? null,
              liStyle: compareStyle(source?.liStyle, state.measurementLis.get(input.index)?.style),
              pseudo: {
                after: compareStyle(source?.pseudo.after, input.pseudo.after),
                before: compareStyle(source?.pseudo.before, input.pseudo.before)
              },
              rect: input.geometry?.rect ?? null,
              style: compareStyle(source?.style, input.style),
              textAnchor: input.geometry?.textAnchor ?? null
            };
          });
        const measurementRoot = state.measurementRoot && {
          contentWidth: state.measurementRoot.contentWidth,
          rect: state.measurementRoot.rect,
          style: compareStyle(
            sourceReference.root.style,
            state.measurementRoot.style,
            new Set(rootCrossSurfaceExcludedProperties)
          )
        };
        return {
          hosts: [...state.hosts.entries()].map(([host, value]) => ({
            className: value.className,
            connectedAtCapture: value.connectedAtCapture,
            hostConnected: host.isConnected
          })),
          factoryVisitedInputCount: state.factoryVisitedInputs.size,
          factoryVisitedInputIndexes: [...state.factoryVisitedInputs].sort((left, right) => left - right),
          measurementInputs,
          measurementRoot,
          observerBatchSamples: state.observerBatchSamples.map(publicObserverBatchSample),
          source: publicSnapshot(sourceReference),
          sourceFinal: publicSnapshot(state.sourceFinal),
          sourceFinalMatches: structuralEqual(sourceReference, state.sourceFinal),
          serializerCloneMapping: 'unobservable-detached',
          sourceMutations: {
            attributeNames: [...state.sourceMutations.attributeNames].sort(),
            attributes: state.sourceMutations.attributes,
            characterData: state.sourceMutations.characterData,
            childList: state.sourceMutations.childList,
            records: state.sourceMutations.records
          },
          styleReadCount: state.styleReadCount
        };
      },
      recordStyleRead,
      ready: true
    };
  }, {
    geometryQuantum,
    inputProperties: INPUT_STYLE_PROPERTIES,
    liProperties: LI_STYLE_PROPERTIES,
    pseudoProperties: PSEUDO_STYLE_PROPERTIES,
    rootCrossSurfaceExcludedProperties: CROSS_ROOT_STYLE_EXCLUDED_PROPERTIES,
    rootProperties: ROOT_STYLE_PROPERTIES,
    selector: previewSelector
  });
}

export function assertRectClose(actual, expected, label) {
  if (!actual || !expected) throw new Error(`wechat-task-context-${label}-geometry-missing`);
  for (const property of ['bottom', 'height', 'left', 'right', 'top', 'width']) {
    expect(Math.abs(actual[property] - expected[property]), `${label}-${property}`).toBeLessThanOrEqual(
      geometryQuantum
    );
  }
}

export function assertStyleClose(style, label) {
  if (!style) throw new Error(`wechat-task-context-${label}-style-read-missing`);
  style.forEach((entry) => {
    expect(entry.measurementCategory, `${label}-${entry.propertyName}-category`)
      .toBe(entry.sourceCategory);
    if (entry.sourceFiniteNumeric || entry.measurementFiniteNumeric) {
      expect(entry.sourceFiniteNumeric, `${label}-${entry.propertyName}-source-number`).toBe(true);
      expect(entry.measurementFiniteNumeric, `${label}-${entry.propertyName}-measurement-number`).toBe(true);
      expect(entry.numericDelta, `${label}-${entry.propertyName}-numeric-delta`)
        .toBeLessThanOrEqual(geometryQuantum);
    }
    if (entry.enumEqual !== null) {
      expect(entry.enumEqual, `${label}-${entry.propertyName}-enum-equality`).toBe(true);
    }
    if (
      entry.sourceCategory === 'other'
      || entry.sourceCategory === 'empty'
      || entry.measurementCategory === 'other'
      || entry.measurementCategory === 'empty'
    ) {
      expect(entry.valuesEqual, `${label}-${entry.propertyName}-value-equality`).toBe(true);
    }
  });
}

export function assertContextEvidence(evidence, calibratedContentWidth) {
  const sourceInputs = evidence.source.inputs;
  expect(sourceInputs).toHaveLength(19);
  expect(sourceInputs.map(({ checked }) => checked)).toEqual(taskStates);
  expect(sourceInputs.filter(({ checked }) => checked)).toHaveLength(16);
  expect(sourceInputs.filter(({ checked }) => !checked)).toHaveLength(3);
  expect(sourceInputs.every(({ geometryCandidate }) => geometryCandidate === true)).toBe(true);
  expect(sourceInputs.every(({ identity }) => identity.localName === 'input')).toBe(true);
  expect(evidence.sourceFinalMatches).toBe(true);
  expect(evidence.serializerCloneMapping).toBe('unobservable-detached');
  expect(evidence.sourceMutations.attributes).toBe(0);
  expect(evidence.sourceMutations.characterData).toBe(0);
  expect(evidence.sourceMutations.childList).toBe(0);
  expect(evidence.sourceMutations.records).toBe(0);
  expect(evidence.sourceMutations.attributeNames).toEqual([]);
  expect(evidence.hosts.length).toBeGreaterThan(0);
  expect(evidence.hosts.every(({ hostConnected }) => hostConnected === false)).toBe(true);
  expect(evidence.styleReadCount).toBeGreaterThan(0);
  expect(evidence.factoryVisitedInputCount).toBe(19);
  expect(evidence.factoryVisitedInputIndexes).toEqual([...Array(19).keys()]);
  expect(evidence.observerBatchSamples.length).toBeGreaterThan(0);
  const observerSample = evidence.observerBatchSamples.at(-1);
  expect(observerSample).toBeDefined();
  expect(observerSample.samplingStage).toBe('connected-style-read');
  expect(observerSample.inputCount).toBe(19);
  expect(observerSample.inputs).toHaveLength(19);
  expect(observerSample.inputs.map(({ checked }) => checked)).toEqual(taskStates);
  expect(observerSample.inputs.map(({ identity }) => identity)).toEqual(
    evidence.source.inputs.map(({ identity }) => identity)
  );
  expect(evidence.measurementInputs).toHaveLength(evidence.factoryVisitedInputCount);
  expect(Math.abs(evidence.source.root.contentWidth - calibratedContentWidth))
    .toBeLessThanOrEqual(geometryQuantum);
  expect(Math.abs(observerSample.root.contentWidth - calibratedContentWidth))
    .toBeLessThanOrEqual(geometryQuantum);
  assertStyleClose(observerSample.root.style, 'observer-root');
  observerSample.inputs.forEach((input) => {
    const source = evidence.source.inputs[input.index];
    assertRectClose(input.rect, source.rect, `observer-input-${input.index}`);
    assertRectClose(input.li, source.li, `observer-li-${input.index}`);
    if (input.textAnchor || source.textAnchor) {
      assertRectClose(input.textAnchor, source.textAnchor, `observer-text-${input.index}`);
    }
    assertStyleClose(input.style, `observer-input-style-${input.index}`);
    assertStyleClose(input.liStyle, `observer-li-style-${input.index}`);
    assertStyleClose(input.pseudo.before, `observer-pseudo-before-${input.index}`);
    assertStyleClose(input.pseudo.after, `observer-pseudo-after-${input.index}`);
  });
  evidence.measurementInputs.forEach((input) => {
    const source = evidence.source.inputs[input.index];
    assertRectClose(input.rect, source.rect, `factory-input-${input.index}`);
    assertRectClose(input.li, source.li, `factory-li-${input.index}`);
    if (input.textAnchor || source.textAnchor) {
      assertRectClose(input.textAnchor, source.textAnchor, `factory-text-${input.index}`);
    }
    assertStyleClose(input.style, `factory-input-style-${input.index}`);
    assertStyleClose(input.liStyle, `factory-li-style-${input.index}`);
    assertStyleClose(input.pseudo.before, `factory-pseudo-before-${input.index}`);
    assertStyleClose(input.pseudo.after, `factory-pseudo-after-${input.index}`);
  });
}

export function assertSuccessfulClipboardWrite(result, state) {
  expect(result).toEqual({ method: 'clipboard', status: 'copied' });
  expect(state.writeCount).toBe(1);
  expect(state.writeStarted).toBe(true);
  expect(state.htmlConsumed).toBe(true);
  expect(state.writeError).toBeNull();
  expect(state.writeHTMLSummary).toEqual(expect.objectContaining({
    inputCount: 0,
    ownerCheckedCount: 16,
    ownerCheckedVector: taskStates,
    ownerCount: 19,
    ownerInputDescendantCount: 0,
    ownerPaintCount: 19,
    ownerStyleCount: 19,
    ownerUncheckedCount: 3,
    ownerTagSpanCount: 19
  }));
}

export function stableCopyCode(value) {
  if (value === null) return null;
  return typeof value === 'string' && /^wechat-[a-z0-9-]+$/u.test(value)
    ? value
    : value === 'copied'
      ? value
      : 'unknown';
}

export async function writePrivateEvidence(testInfo, result, state, evidence) {
  const outputPath = testInfo.outputPath('wechat-task-context-evidence.json');
  const payload = {
    copyCode: result?.status === 'copied' ? 'copied' : stableCopyCode(result?.code),
    copyStatus: result?.status === 'failed' || result?.status === 'copied'
      ? result.status
      : 'unknown',
    factoryVisitedInputCount: evidence.factoryVisitedInputCount,
    factoryVisitedInputIndexes: evidence.factoryVisitedInputIndexes,
    measurementInputs: evidence.measurementInputs,
    measurementRoot: evidence.measurementRoot,
    observerBatchSamples: evidence.observerBatchSamples,
    serializerCloneMapping: evidence.serializerCloneMapping,
    source: evidence.source,
    sourceFinal: evidence.sourceFinal,
    sourceFinalMatches: evidence.sourceFinalMatches,
    sourceMutations: evidence.sourceMutations,
    styleReadCount: evidence.styleReadCount,
    writeHTMLSummary: state.writeHTMLSummary,
    writeError: stableCopyCode(state.writeError)
  };
  await chmod(dirname(outputPath), 0o700);
  await writeFile(outputPath, `${JSON.stringify(payload)}\n`, {
    encoding: 'utf8',
    mode: 0o600
  });
  await chmod(outputPath, 0o600);
}

export async function writePrivateHiddenEvidence(testInfo, result, state, evidence) {
  const outputPath = testInfo.outputPath('wechat-task-context-hidden-evidence.json');
  const payload = {
    copyCode: result?.status === 'copied' ? 'copied' : stableCopyCode(result?.code),
    copyStatus: result?.status === 'failed' || result?.status === 'copied'
      ? result.status
      : 'unknown',
    evidence,
    serializerCloneMapping: evidence.serializerCloneMapping,
    writeHTMLSummary: state.writeHTMLSummary,
    writeError: stableCopyCode(state.writeError)
  };
  await chmod(dirname(outputPath), 0o700);
  await writeFile(outputPath, `${JSON.stringify(payload)}\n`, {
    encoding: 'utf8',
    mode: 0o600
  });
  await chmod(outputPath, 0o600);
}
