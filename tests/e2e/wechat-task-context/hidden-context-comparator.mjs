// Node-side comparator for hidden WeChat task-context evidence.
// The function source is serialized into the page by the evidence installation
// and executed by the CPU contract spec through vm, so the body must stay
// self-contained: it may not close over module scope or import bindings.

export function createHiddenContextComparator(geometryQuantum, hiddenCurrentSignatureLayoutProperties) {
  const vectorEqual = (left, right) => (
    Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => (
      value?.unit === right[index]?.unit
      && Math.abs(value?.value - right[index]?.value) <= geometryQuantum
    ))
  );
  const matrixEqual = (left, right) => (
    Array.isArray(left)
    && Array.isArray(right)
    && left.length === 16
    && right.length === 16
    && left.every((value, index) => Math.abs(value - right[index]) <= geometryQuantum)
  );
  const valuesEqual = (sourceEntry, measurementEntry) => (
    sourceEntry.raw === measurementEntry.raw
  );
  const compareEntry = (sourceEntry, measurementEntry, ownerKind, index) => {
    if (!measurementEntry) {
      return {
        enumEqual: null,
        measurementCategory: 'missing',
        measurementFiniteNumeric: false,
        numericDelta: null,
        ownerKind,
        index,
        propertyName: sourceEntry.propertyName,
        sourceCategory: sourceEntry.category,
        sourceFiniteNumeric: Number.isFinite(sourceEntry.numeric),
        transformMatrixEqual: null,
        transformOriginEqual: null,
        valuesEqual: false
      };
    }
    return {
      enumEqual: sourceEntry.category === 'enum' && measurementEntry.category === 'enum'
        ? sourceEntry.enumValue === measurementEntry.enumValue
        : null,
      measurementCategory: measurementEntry.category,
      measurementFiniteNumeric: Number.isFinite(measurementEntry.numeric),
      numericDelta: Number.isFinite(sourceEntry.numeric)
        && Number.isFinite(measurementEntry.numeric)
        ? Math.abs(sourceEntry.numeric - measurementEntry.numeric)
        : null,
      ownerKind,
      index,
      propertyName: sourceEntry.propertyName,
      sourceCategory: sourceEntry.category,
      sourceFiniteNumeric: Number.isFinite(sourceEntry.numeric),
      transformMatrixEqual: sourceEntry.category === 'transform'
        && measurementEntry.category === 'transform'
        ? matrixEqual(sourceEntry.transformMatrix, measurementEntry.transformMatrix)
        : null,
      transformOriginEqual: sourceEntry.category === 'transform-origin'
        && measurementEntry.category === 'transform-origin'
        ? vectorEqual(sourceEntry.transformOrigin, measurementEntry.transformOrigin)
        : null,
      valuesEqual: valuesEqual(sourceEntry, measurementEntry),
      ...(sourceEntry.transformMatrix && measurementEntry.transformMatrix
        ? {
            transformMatrix: measurementEntry.transformMatrix.filter(Number.isFinite)
          }
        : {}),
      ...(sourceEntry.transformOrigin && measurementEntry.transformOrigin
        ? {
            transformOrigin: measurementEntry.transformOrigin.map(({ unit, value }) => ({
              unit,
              value
            }))
          }
        : {})
    };
  };
  const styleEntryEqual = (sourceEntry, measurementEntry) => (
    Boolean(measurementEntry) && valuesEqual(sourceEntry, measurementEntry)
  );
  const currentSignatureLayoutProperties = new Map(
    Object.entries(hiddenCurrentSignatureLayoutProperties).map(([ownerKind, properties]) => (
      [ownerKind, new Set(properties)]
    ))
  );
  const currentGuardStyleEntryEqual = (sourceEntry, measurementEntry, ownerKind) => (
    currentSignatureLayoutProperties.get(ownerKind)?.has(sourceEntry.propertyName)
      ? Boolean(measurementEntry)
      : styleEntryEqual(sourceEntry, measurementEntry)
  );
  const firstStyleDifference = (
    sourceShape,
    measurementShape,
    ownerKind,
    index,
    currentGuard = false
  ) => {
    const measurementByProperty = new Map(
      (measurementShape || []).map((entry) => [entry.propertyName, entry])
    );
    for (const sourceEntry of sourceShape || []) {
      const measurementEntry = measurementByProperty.get(sourceEntry.propertyName);
      const equal = currentGuard
        ? currentGuardStyleEntryEqual(sourceEntry, measurementEntry, ownerKind)
        : styleEntryEqual(sourceEntry, measurementEntry);
      if (!equal) return compareEntry(sourceEntry, measurementEntry, ownerKind, index);
    }
    return null;
  };
  const firstGeometryDifference = (sourceValue, measurementValue, ownerKind, index, propertyName) => {
    if (!sourceValue || !measurementValue) {
      return {
        measurementCategory: measurementValue ? 'number' : 'missing',
        ownerKind,
        index,
        propertyName,
        sourceCategory: sourceValue ? 'number' : 'missing',
        valuesEqual: false
      };
    }
    for (const property of ['bottom', 'height', 'left', 'right', 'top', 'width']) {
      const delta = Math.abs(sourceValue[property] - measurementValue[property]);
      if (!Number.isFinite(delta) || delta > geometryQuantum) {
        return {
          measurementCategory: 'number',
          numericDelta: Number.isFinite(delta) ? delta : null,
          ownerKind,
          index,
          propertyName: `${propertyName}.${property}`,
          sourceCategory: 'number',
          valuesEqual: false
        };
      }
    }
    return null;
  };
  const firstStyleDifferenceForSurfaces = (
    sourceSurface,
    measurementSurface,
    currentGuard = false
  ) => {
    const root = firstStyleDifference(
      sourceSurface?.root.style,
      measurementSurface?.root.style,
      'root',
      -1,
      currentGuard
    );
    if (root) return root;
    for (const sourceInput of sourceSurface?.inputs || []) {
      const measurementInput = measurementSurface?.inputs?.[sourceInput.index];
      const input = firstStyleDifference(
        sourceInput.style,
        measurementInput?.style,
        'input',
        sourceInput.index,
        currentGuard
      );
      if (input) return input;
      const li = firstStyleDifference(
        sourceInput.liStyle,
        measurementInput?.liStyle,
        'li',
        sourceInput.index,
        currentGuard
      );
      if (li) return li;
      const before = firstStyleDifference(
        sourceInput.pseudo.before,
        measurementInput?.pseudo.before,
        'pseudo-before',
        sourceInput.index,
        currentGuard
      );
      if (before) return before;
      const after = firstStyleDifference(
        sourceInput.pseudo.after,
        measurementInput?.pseudo.after,
        'pseudo-after',
        sourceInput.index,
        currentGuard
      );
      if (after) return after;
    }
    return null;
  };
  const firstGeometryDifferenceForSurfaces = (sourceSurface, measurementSurface) => {
    const root = firstGeometryDifference(
      { width: sourceSurface?.root.contentWidth, height: 0, left: 0, right: 0, top: 0, bottom: 0 },
      { width: measurementSurface?.root.contentWidth, height: 0, left: 0, right: 0, top: 0, bottom: 0 },
      'root',
      -1,
      'contentWidth'
    );
    if (root) return root;
    for (const sourceInput of sourceSurface?.inputs || []) {
      const measurementInput = measurementSurface?.inputs?.[sourceInput.index];
      const input = firstGeometryDifference(
        sourceInput.rect,
        measurementInput?.rect,
        'input',
        sourceInput.index,
        'rect'
      );
      if (input) return input;
      const li = firstGeometryDifference(
        sourceInput.li,
        measurementInput?.li,
        'li',
        sourceInput.index,
        'rect'
      );
      if (li) return li;
      if (sourceInput.textAnchor || measurementInput?.textAnchor) {
        const text = firstGeometryDifference(
          sourceInput.textAnchor,
          measurementInput?.textAnchor,
          'text-anchor',
          sourceInput.index,
          'rect'
        );
        if (text) return text;
      }
    }
    return null;
  };
  return { firstGeometryDifferenceForSurfaces, firstStyleDifferenceForSurfaces };
}
