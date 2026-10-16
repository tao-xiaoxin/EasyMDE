// Browser-side evidence installation for hidden WeChat task-context geometry
// and visibility. The evaluated callback runs inside the page with the
// comparator source serialized from hidden-context-comparator.mjs.

import { geometryQuantum } from "./environment.mjs";
import { createHiddenContextComparator } from "./hidden-context-comparator.mjs";
import { HIDDEN_CURRENT_SIGNATURE_LAYOUT_PROPERTIES } from "./hidden-context-properties.mjs";
import { HIDDEN_INPUT_STYLE_PROPERTIES } from "./hidden-context-properties.mjs";
import { HIDDEN_LI_STYLE_PROPERTIES } from "./hidden-context-properties.mjs";
import { HIDDEN_PSEUDO_STYLE_PROPERTIES } from "./hidden-context-properties.mjs";
import { HIDDEN_ROOT_STYLE_PROPERTIES } from "./hidden-context-properties.mjs";
import { HIDDEN_SEMANTIC_STYLE_PROPERTIES } from "./hidden-context-properties.mjs";

export async function installHiddenContextEvidence(page, selector) {
  await page.evaluate(({
    comparatorSource,
    geometryQuantum,
    hiddenCurrentSignatureLayoutProperties,
    inputProperties,
    liProperties,
    pseudoProperties,
    rootProperties,
    selector,
    semanticProperties
  }) => {
    const preview = document.querySelector(selector);
    if (!(preview instanceof HTMLElement)) {
      throw new Error('wechat-task-context-hidden-preview-missing');
    }
    const nativeGetComputedStyle = window.getComputedStyle.bind(window);
    const comparatorFactory = (new Function(`return (${comparatorSource})`))();
    const comparator = comparatorFactory(
      geometryQuantum,
      hiddenCurrentSignatureLayoutProperties
    );
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
        throw new Error('wechat-task-context-hidden-geometry-invalid');
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
    const identity = (element) => ({
      attributes: [...element.attributes].map(({ name }) => name).sort(),
      classTokens: [...element.classList].sort(),
      localName: element.localName,
      namespaceURI: element.namespaceURI,
      type: element.getAttribute('type')
    });
    const path = (element, root) => {
      const result = [];
      let current = element;
      while (current && current !== root) {
        const parent = current.parentElement;
        if (!parent) return null;
        result.unshift([...parent.children].indexOf(current));
        current = parent;
      }
      return current === root ? result : null;
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
    const transformOrigin = (rawValue) => {
      const parts = rawValue.split(/\s+/u).filter(Boolean);
      if (![2, 3].includes(parts.length)) return null;
      const values = parts.map((part) => {
        const match = part.match(/^(-?(?:\d+(?:\.\d+)?|\.\d+))(px|%)?$/u);
        if (!match) return null;
        const value = Number(match[1]);
        const unit = match[2] || 'number';
        if (!Number.isFinite(value) || (unit === 'number' && value !== 0)) return null;
        return { unit, value };
      });
      return values.every(Boolean) ? values : null;
    };
    const transformMatrix = (rawValue) => {
      if (typeof DOMMatrixReadOnly !== 'function') return null;
      try {
        const matrix = new DOMMatrixReadOnly(rawValue);
        const values = [...matrix.toFloat64Array()];
        return values.length === 16 && values.every(Number.isFinite) ? values : null;
      } catch {
        return null;
      }
    };
    const knownEnumValues = new Set([
      'auto',
      'baseline',
      'block',
      'border-box',
      'center',
      'collapse',
      'content-box',
      'contents',
      'dashed',
      'dotted',
      'double',
      'end',
      'flex',
      'fit-content',
      'fixed',
      'grid',
      'hidden',
      'inherit',
      'initial',
      'inline',
      'inline-block',
      'inline-flex',
      'inline-grid',
      'left',
      'max-content',
      'middle',
      'min-content',
      'none',
      'normal',
      'nowrap',
      'pre',
      'pre-line',
      'pre-wrap',
      'relative',
      'revert',
      'revert-layer',
      'right',
      'solid',
      'start',
      'static',
      'sticky',
      'top',
      'unset',
      'visible'
    ]);
    const publicEnumCode = (value) => (
      knownEnumValues.has(value) ? `enum-${value}` : 'enum-opaque'
    );
    const transformCode = (matrix) => {
      if (!matrix) return 'unresolved';
      const identity = [
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1
      ];
      return matrix.every((value, index) => value === identity[index])
        ? 'identity-matrix'
        : 'active-matrix';
    };
    const token = (raw, propertyName) => {
      const rawValue = String(raw).trim();
      const value = rawValue.toLowerCase();
      if (propertyName === 'transform-origin') {
        const parsed = transformOrigin(rawValue);
        return parsed
          ? {
              category: 'transform-origin',
              enumValue: null,
              numeric: null,
              raw: rawValue,
              transformOrigin: parsed
            }
          : {
              category: rawValue ? 'unresolved-transform-origin' : 'empty',
              enumValue: null,
              numeric: null,
              raw: rawValue,
              transformOrigin: null
            };
      }
      if (propertyName === 'transform') {
        if (value === 'none') {
          return {
            category: 'transform',
            enumValue: null,
            numeric: null,
            raw: rawValue,
            transformCode: 'literal-none',
            transformMatrix: [
              1, 0, 0, 0,
              0, 1, 0, 0,
              0, 0, 1, 0,
              0, 0, 0, 1
            ]
          };
        }
        const parsed = transformMatrix(rawValue);
        return parsed
          ? {
              category: 'transform',
              enumValue: null,
              numeric: null,
              raw: rawValue,
              transformCode: transformCode(parsed),
              transformMatrix: parsed
            }
          : {
              category: rawValue ? 'unresolved-transform' : 'empty',
              enumValue: null,
              numeric: null,
              raw: rawValue,
              transformCode: 'unresolved',
              transformMatrix: null
            };
      }
      const pixels = value.match(/^(-?(?:\d+(?:\.\d+)?|\.\d+))px$/u);
      if (pixels) {
        return { category: 'px', enumValue: null, numeric: Number(pixels[1]), raw: rawValue };
      }
      const percentages = value.match(/^(-?(?:\d+(?:\.\d+)?|\.\d+))%$/u);
      if (percentages) {
        return { category: '%', enumValue: null, numeric: Number(percentages[1]), raw: rawValue };
      }
      const unitless = value.match(/^(-?(?:\d+(?:\.\d+)?|\.\d+))$/u);
      if (unitless) {
        return { category: 'number', enumValue: null, numeric: Number(unitless[1]), raw: rawValue };
      }
      if (/^[a-z][a-z0-9-]*$/u.test(value) && value.length <= 32) {
        return {
          category: 'enum',
          enumCode: publicEnumCode(value),
          enumValue: value,
          numeric: null,
          raw: rawValue
        };
      }
      return {
        category: value ? 'other' : 'empty',
        enumValue: null,
        numeric: null,
        raw: rawValue
      };
    };
    const styleShape = (computed, properties) => properties.map((propertyName) => ({
      ...token(computed.getPropertyValue(propertyName), propertyName),
      propertyName
    }));
    const semanticShape = (element) => styleShape(
      nativeGetComputedStyle(element),
      semanticProperties
    );
    const publicToken = (entry) => ({
      category: entry.category,
      finiteNumeric: Number.isFinite(entry.numeric),
      numeric: Number.isFinite(entry.numeric) ? entry.numeric : null,
      propertyName: entry.propertyName,
      ...(entry.enumCode ? { enumCode: entry.enumCode } : {}),
      ...(entry.transformCode ? { transformCode: entry.transformCode } : {}),
      ...(entry.transformMatrix
        ? { transformMatrix: entry.transformMatrix.filter(Number.isFinite) }
        : {}),
      ...(entry.transformOrigin
        ? {
            transformOrigin: entry.transformOrigin.map(({ unit, value }) => ({ unit, value }))
          }
        : {})
    });
    const publicStyle = (shape) => shape.map(publicToken);
    const sourceRootIdentity = identity(preview);
    const isSourceRootClone = (element) => (
      element !== preview
      && element.localName === preview.localName
      && JSON.stringify([...element.classList].sort()) === JSON.stringify(sourceRootIdentity.classTokens)
    );
    const inputIndex = (root, element) => (
      [...root.querySelectorAll('input[type="checkbox"]')].indexOf(element)
    );
    const captureAncestors = (root) => {
      const result = [];
      let current = root;
      while (current instanceof HTMLElement) {
        result.push({
          identity: identity(current),
          semantic: semanticShape(current)
        });
        if (current.classList.contains('easymde-editor')) break;
        current = current.parentElement;
      }
      return result;
    };
    const captureSurface = (root, getter = nativeGetComputedStyle) => {
      const inputs = [...root.querySelectorAll('input[type="checkbox"]')];
      if (inputs.length !== 19) {
        throw new Error('wechat-task-context-hidden-input-count-invalid');
      }
      const rootComputed = getter(root);
      return {
        ancestors: captureAncestors(root),
        inputs: inputs.map((input, index) => {
          const item = input.closest('li.task-list-item, li');
          const parent = input.parentElement;
          const listParent = item?.parentElement;
          if (!item || !parent || !listParent) {
            throw new Error('wechat-task-context-hidden-owner-missing');
          }
          return {
            checked: input.checked,
            disabled: input.disabled,
            identity: identity(input),
            index,
            li: relativeRect(item, rect(listParent)),
            liStyle: styleShape(getter(item), liProperties),
            path: path(input, root),
            pseudo: {
              after: styleShape(getter(input, '::after'), pseudoProperties),
              before: styleShape(getter(input, '::before'), pseudoProperties)
            },
            rect: relativeRect(input, rect(parent)),
            style: styleShape(getter(input), inputProperties),
            textAnchor: textAnchor(parent)
          };
        }),
        root: {
          contentWidth: contentWidth(root, rootComputed),
          identity: identity(root),
          rect: rect(root),
          style: styleShape(rootComputed, rootProperties),
          semantic: semanticShape(root)
        }
      };
    };
    const publicSurface = (snapshot) => ({
      inputs: snapshot.inputs.map((input) => ({
        checked: input.checked,
        disabled: input.disabled,
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
        rect: snapshot.root.rect,
        semantic: publicStyle(snapshot.root.semantic),
        style: publicStyle(snapshot.root.style)
      }
    });
    const semanticEqual = (left, right) => (
      Boolean(left)
      && Boolean(right)
      && left.length === right.length
      && left.every((entry, index) => (
        entry.propertyName === right[index]?.propertyName
        && entry.category === right[index]?.category
        && entry.raw === right[index]?.raw
        && (entry.transformMatrix
          ? matrixEqual(entry.transformMatrix, right[index]?.transformMatrix)
          : true)
        && (entry.transformOrigin
          ? vectorEqual(entry.transformOrigin, right[index]?.transformOrigin)
          : true)
      ))
    );
    const ancestorSemanticEqual = (left, right) => (
      Boolean(left)
      && Boolean(right)
      && left.length === right.length
      && left.every((entry, index) => (
        JSON.stringify(entry.identity) === JSON.stringify(right[index]?.identity)
        && semanticEqual(entry.semantic, right[index]?.semantic)
      ))
    );
    const zeroRect = (value) => (
      Boolean(value)
      && ['bottom', 'height', 'left', 'right', 'top', 'width']
        .every((property) => Math.abs(value[property]) <= geometryQuantum)
    );
    const emptyMutationState = () => ({
      attributeNames: new Set(),
      attributes: 0,
      characterData: 0,
      childList: 0,
      records: 0
    });
    const mutationSnapshot = (value) => ({
      attributeNames: [...value.attributeNames].sort(),
      attributes: value.attributes,
      characterData: value.characterData,
      childList: value.childList,
      records: value.records
    });
    const state = {
      factoryReadInputs: new Set(),
      factoryReadElements: new Set(),
      factoryReadCount: 0,
      factoryReadElementCount: 0,
      factoryReadRecords: [],
      hiddenMarked: false,
      measurementSamples: [],
      sourceAfterHide: null,
      sourceAfterHideAncestors: null,
      sourceFinal: null,
      sourceFinalAncestors: null,
      sourceMutations: emptyMutationState(),
      preHideSourceMutations: null,
      sourceVisibleReference: captureSurface(preview),
      sourceConnectionRect: null,
      sourceStyleReadRect: null,
      visibilityMutations: emptyMutationState(),
      preHideVisibilityMutations: null,
      hosts: new Map(),
      styleReadCount: 0,
      sampledHosts: new WeakSet(),
      firstMeasurement: null,
      firstMeasurementRoot: null,
      referenceCompatibility: null,
      terminalMeasurementStage: 'missing'
    };
    const editor = preview.closest('.easymde-editor');
    const sourceVisibleMeta = {
      accepted: preview.getAttribute('data-easymde-preview-accepted'),
      editorPresentation: editor?.getAttribute('data-easymde-preview-presentation') ?? null,
      signature: typeof preview.easymdePreviewSignature === 'string'
        ? preview.easymdePreviewSignature
        : null
    };
    const visibilityNodes = [];
    let visibilityNode = preview;
    while (visibilityNode instanceof HTMLElement) {
      visibilityNodes.push(visibilityNode);
      if (visibilityNode.classList.contains('easymde-editor')) break;
      visibilityNode = visibilityNode.parentElement;
    }
    const hostRoot = (host) => (
      [...host.querySelectorAll('*')].find(isSourceRootClone) ?? null
    );
    const recordHost = (host) => {
      if (!(host instanceof HTMLElement)) return;
      if (state.hiddenMarked && !state.sourceConnectionRect) {
        state.sourceConnectionRect = rect(preview);
      }
      if (state.hosts.has(host)) return;
      state.hosts.set(host, {
        connectedAt: host.isConnected,
        classTokens: [...host.classList].sort()
      });
    };
    const sampleMeasurement = (host, getter, stage) => {
      if (!(host instanceof HTMLElement) || !host.isConnected) return;
      const root = hostRoot(host);
      if (!(root instanceof HTMLElement)) return;
      if (state.sampledHosts.has(host)) return;
      state.sampledHosts.add(host);
      const snapshot = captureSurface(root, getter);
      if (!state.firstMeasurement) {
        state.firstMeasurement = snapshot;
        state.firstMeasurementRoot = root;
      }
      state.measurementSamples.push({
        hostConnected: host.isConnected,
        hostClassTokens: [...host.classList].sort(),
        inputCount: snapshot.inputs.length,
        snapshot,
        stage,
        totalElementCount: [root, ...root.querySelectorAll('*')].length
      });
    };
    const factoryOwner = (element, pseudo) => {
      const host = element.closest?.(
        '.easymde-wechat-task-checkbox-measurement, .easymde-wechat-preview-measurement'
      );
      if (host instanceof HTMLElement) {
        const root = hostRoot(host);
        if (root instanceof HTMLElement) {
          const index = inputIndex(root, element);
          if (root === element) return { host, index: -1, ownerKind: 'root', root };
          if (index >= 0) {
            return {
              host,
              index,
              ownerKind: pseudo === '::before'
                ? 'pseudo-before'
                : pseudo === '::after'
                  ? 'pseudo-after'
                  : 'input',
              root
            };
          }
          const listItem = element.closest?.('li.task-list-item, li');
          const listIndex = listItem
            ? inputIndex(root, listItem.querySelector('input[type="checkbox"]'))
            : -1;
          if (listIndex >= 0) return { host, index: listIndex, ownerKind: 'li', root };
          return { host, index: -1, ownerKind: 'other', root };
        }
      }
      if (preview === element) return { host: null, index: -1, ownerKind: 'source-root', root: preview };
      const index = inputIndex(preview, element);
      if (index >= 0) {
        return {
          host: null,
          index,
          ownerKind: pseudo === '::before'
            ? 'source-pseudo-before'
            : pseudo === '::after'
              ? 'source-pseudo-after'
              : 'source-input',
          root: preview
        };
      }
      const listItem = element.closest?.('li.task-list-item, li');
      const listIndex = listItem
        ? inputIndex(preview, listItem.querySelector('input[type="checkbox"]'))
        : -1;
      return listIndex >= 0
        ? { host: null, index: listIndex, ownerKind: 'source-li', root: preview }
        : { host: null, index: -1, ownerKind: 'source-other', root: preview };
    };
    const recordStyleRead = (element, pseudo, computed, nativeGetter) => {
      state.styleReadCount += 1;
      const owner = factoryOwner(element, pseudo);
      if (state.hiddenMarked && owner.ownerKind.startsWith('source-') && !state.sourceStyleReadRect) {
        state.sourceStyleReadRect = rect(preview);
      }
      if (owner.host) {
        recordHost(owner.host);
        if (typeof nativeGetter === 'function') {
          sampleMeasurement(owner.host, nativeGetter, 'first-connected-style-read');
        }
        state.factoryReadCount += 1;
        state.factoryReadRecords.push({
          index: owner.index,
          ownerKind: owner.ownerKind,
          propertyCount: computed.length,
          stage: 'style-read'
        });
        if (owner.index >= 0) state.factoryReadInputs.add(owner.index);
        if (owner.root) {
          const elementPath = path(element, owner.root);
          if (elementPath) state.factoryReadElements.add(elementPath.join('.'));
        }
        return;
      }
      if (owner.ownerKind.startsWith('source-')) {
        state.factoryReadRecords.push({
          index: owner.index,
          ownerKind: owner.ownerKind,
          propertyCount: computed.length,
          stage: 'style-read'
        });
      }
    };
    const observeMutation = (target, callback, options) => {
      const observer = new MutationObserver(callback);
      observer.observe(target, options);
      return observer;
    };
    const sourceObserverOptions = {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true
    };
    const visibilityObserverOptions = {
      attributeFilter: ['aria-hidden', 'class', 'hidden', 'inert', 'style'],
      attributes: true
    };
    const sourceObserver = observeMutation(preview, (records) => {
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
    }, sourceObserverOptions);
    const visibilityObserver = new MutationObserver((records) => {
      records.forEach((record) => {
        state.visibilityMutations.records += 1;
        if (record.type === 'attributes') {
          state.visibilityMutations.attributes += 1;
          if (record.attributeName) state.visibilityMutations.attributeNames.add(record.attributeName);
        }
      });
    });
    visibilityNodes.forEach((node) => visibilityObserver.observe(node, visibilityObserverOptions));
    const contextObserver = observeMutation(document.body, (records) => {
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
    }, { childList: true, subtree: true });
    const drain = () => {
      for (const [observer, target] of [
        [sourceObserver, state.sourceMutations],
        [visibilityObserver, state.visibilityMutations]
      ]) {
        observer.takeRecords().forEach((record) => {
          if (target === state.sourceMutations) {
            state.sourceMutations.records += 1;
            if (record.type === 'attributes') {
              state.sourceMutations.attributes += 1;
              if (record.attributeName) state.sourceMutations.attributeNames.add(record.attributeName);
            } else if (record.type === 'characterData') {
              state.sourceMutations.characterData += 1;
            } else if (record.type === 'childList') {
              state.sourceMutations.childList += 1;
            }
          } else {
            state.visibilityMutations.records += 1;
            if (record.type === 'attributes') {
              state.visibilityMutations.attributes += 1;
              if (record.attributeName) state.visibilityMutations.attributeNames.add(record.attributeName);
            }
          }
        });
      }
    };
    const publicDifference = (value) => value ? {
      ...value,
      ...(value.transformMatrix
        ? { transformMatrix: value.transformMatrix.filter(Number.isFinite) }
        : {}),
      ...(value.transformOrigin
        ? { transformOrigin: value.transformOrigin.map(({ unit, value: number }) => ({ unit, value: number })) }
        : {})
    } : null;
    const publicSample = (sample) => ({
      hostClassTokens: sample.hostClassTokens,
      hostConnected: sample.hostConnected,
      inputCount: sample.inputCount,
      root: {
        contentWidth: sample.snapshot.root.contentWidth,
        rect: sample.snapshot.root.rect,
        style: publicStyle(sample.snapshot.root.style)
      },
      stage: sample.stage,
      totalElementCount: sample.totalElementCount
    });
    globalThis.__wechatTaskContextHiddenEvidence = {
      beginHidden() {
        drain();
        state.preHideSourceMutations = mutationSnapshot(state.sourceMutations);
        state.preHideVisibilityMutations = mutationSnapshot(state.visibilityMutations);
        sourceObserver.disconnect();
        visibilityObserver.disconnect();
        state.sourceMutations = emptyMutationState();
        state.visibilityMutations = emptyMutationState();
        sourceObserver.observe(preview, sourceObserverOptions);
        visibilityNodes.forEach((node) => visibilityObserver.observe(node, visibilityObserverOptions));
        const current = document.querySelector(selector);
        if (!(current instanceof HTMLElement)) {
          throw new Error('wechat-task-context-hidden-source-missing');
        }
        const currentEditor = current.closest('.easymde-editor');
        state.referenceCompatibility = {
          acceptedSame: current.getAttribute('data-easymde-preview-accepted') === sourceVisibleMeta.accepted,
          editorPresentationSame: currentEditor?.getAttribute('data-easymde-preview-presentation')
            === sourceVisibleMeta.editorPresentation,
          signatureSame: typeof current.easymdePreviewSignature === 'string'
            && current.easymdePreviewSignature === sourceVisibleMeta.signature,
          sameSink: current === preview
        };
        state.sourceAfterHide = captureSurface(current);
        state.sourceAfterHideAncestors = captureAncestors(current);
        state.hiddenMarked = true;
        return state.referenceCompatibility;
      },
      hasHost: () => state.hosts.size > 0,
      finish() {
        contextObserver.disconnect();
        sourceObserver.disconnect();
        visibilityObserver.disconnect();
      },
      recordStyleRead,
      readState() {
        drain();
        if (!state.hiddenMarked || !state.sourceAfterHide) {
          throw new Error('wechat-task-context-hidden-state-not-started');
        }
        state.sourceFinal = captureSurface(preview);
        state.sourceFinalAncestors = captureAncestors(preview);
        const measurement = state.firstMeasurement;
        const rawStyleFirstDiff = comparator.firstStyleDifferenceForSurfaces(
          state.sourceAfterHide,
          measurement
        );
        const currentGuardStyleFirstDiff = comparator.firstStyleDifferenceForSurfaces(
          state.sourceAfterHide,
          measurement,
          true
        );
        const visiblePaintFirstDiff = comparator.firstStyleDifferenceForSurfaces(
          state.sourceVisibleReference,
          measurement
        );
        const geometryFirstDiff = comparator.firstGeometryDifferenceForSurfaces(
          state.sourceVisibleReference,
          measurement
        );
        state.terminalMeasurementStage = measurement
          ? 'captured-connected-style-read'
          : 'missing';
        const root = measurement?.root ?? null;
        const totalElementCount = root
          ? [
              ...(() => {
                const rootElement = state.firstMeasurementRoot;
                return rootElement ? [rootElement, ...rootElement.querySelectorAll('*')] : [];
              })()
            ].length
          : 0;
        return {
          preparedLayoutSignature: {
            allElementsRead: totalElementCount > 0
              && state.factoryReadElements.size >= totalElementCount,
            allInputsRead: state.factoryReadInputs.size === 19,
            measurementInputCount: measurement?.inputs.length ?? 0,
            readElementCount: state.factoryReadElements.size,
            totalElementCount
          },
          factoryReadCount: state.factoryReadCount,
          factoryReadInputs: [...state.factoryReadInputs].sort((left, right) => left - right),
          currentGuardStyleFirstDiff: publicDifference(currentGuardStyleFirstDiff),
          firstDiff: publicDifference(
            currentGuardStyleFirstDiff ?? visiblePaintFirstDiff ?? geometryFirstDiff
          ),
          geometryFirstDiff: publicDifference(geometryFirstDiff),
          hosts: [...state.hosts.entries()].map(([host, value]) => ({
            classTokens: value.classTokens,
            connectedAt: value.connectedAt,
            connectedFinal: host.isConnected
          })),
          measurementSamples: state.measurementSamples.map(publicSample),
          phaseEvidence: {
            connectionObserved: state.hosts.size > 0,
            styleReadObserved: state.styleReadCount > 0,
            terminalStage: state.terminalMeasurementStage
          },
          readinessStatus: 'unverified',
          referenceCompatibility: state.referenceCompatibility,
          serializerCloneMapping: 'unobservable-detached',
          sourceAfterHide: publicSurface(state.sourceAfterHide),
          sourceAfterHideAncestors: state.sourceAfterHideAncestors.map((entry) => ({
            identity: entry.identity,
            semantic: publicStyle(entry.semantic)
          })),
          sourceFinal: publicSurface(state.sourceFinal),
          sourceFinalAncestors: state.sourceFinalAncestors.map((entry) => ({
            identity: entry.identity,
            semantic: publicStyle(entry.semantic)
          })),
          sourceFinalSemanticMatches: semanticEqual(
            state.sourceAfterHide.root.semantic,
            state.sourceFinal.root.semantic
          ) && ancestorSemanticEqual(
            state.sourceAfterHideAncestors,
            state.sourceFinalAncestors
          ),
          sourceFinalZeroRect: zeroRect(state.sourceFinal.root.rect),
          sourceRectPhases: {
            connection: state.sourceConnectionRect,
            final: state.sourceFinal.root.rect,
            styleRead: state.sourceStyleReadRect
          },
          preHideSourceMutations: state.preHideSourceMutations,
          preHideVisibilityMutations: state.preHideVisibilityMutations,
          sourceMutations: {
            ...mutationSnapshot(state.sourceMutations)
          },
          sourceVisibleReference: publicSurface(state.sourceVisibleReference),
          rawStyleFirstDiff: publicDifference(rawStyleFirstDiff),
          styleReadCount: state.styleReadCount,
          terminalMeasurementStage: state.terminalMeasurementStage,
          visibilityMutations: {
            ...mutationSnapshot(state.visibilityMutations)
          },
          visibilityFinalRootZeroRect: zeroRect(state.sourceFinal.root.rect),
          visiblePaintFirstDiff: publicDifference(visiblePaintFirstDiff)
        };
      }
    };
  }, {
    comparatorSource: createHiddenContextComparator.toString(),
    geometryQuantum,
    hiddenCurrentSignatureLayoutProperties: HIDDEN_CURRENT_SIGNATURE_LAYOUT_PROPERTIES,
    inputProperties: HIDDEN_INPUT_STYLE_PROPERTIES,
    liProperties: HIDDEN_LI_STYLE_PROPERTIES,
    pseudoProperties: HIDDEN_PSEUDO_STYLE_PROPERTIES,
    rootProperties: HIDDEN_ROOT_STYLE_PROPERTIES,
    selector,
    semanticProperties: HIDDEN_SEMANTIC_STYLE_PROPERTIES
  });
}
