// Mermaid source fingerprint oracle.
import { expect } from '@playwright/test';

export async function readMermaidSourceFingerprints(preview) {
  return preview.evaluate((root) => [...root.querySelectorAll('.easymde-mermaid')]
    .map((element, index) => {
      const svg = element.querySelector('svg');
      if (!(svg instanceof SVGSVGElement)) throw new Error('wechat-source-fingerprint-svg-unavailable');
      const role = svg.getAttribute('aria-roledescription')?.trim() ?? '';
      if (!role) throw new Error('wechat-source-fingerprint-role-unavailable');
      const viewBoxValues = svg.getAttribute('viewBox')?.trim().split(/[\s,]+/u).map(Number) ?? [];
      if (4 !== viewBoxValues.length || viewBoxValues.some((value) => !Number.isFinite(value))) {
        throw new Error('wechat-source-fingerprint-viewbox-unavailable');
      }
      const leaves = [...svg.querySelectorAll('text, tspan')]
        .filter((candidate) => !candidate.querySelector('text, tspan'));
      const labels = [
        ...leaves.map((candidate) => candidate.textContent ?? ''),
        ...[...svg.querySelectorAll('foreignObject')]
          .map((candidate) => candidate.textContent ?? '')
      ]
        .map((value) => value.replace(/\s+/gu, ' ').trim())
        .filter(Boolean)
        .sort((left, right) => left.localeCompare(right));
      const geometryAttributes = (candidate, names) => Object.fromEntries(names.map((name) => [
        name,
        candidate.getAttribute(name)
      ]));
      const markerNodes = [...svg.querySelectorAll('defs marker')];
      const markerOrdinals = new Map(markerNodes.map((marker, ordinal) => [marker.id, ordinal]));
      const markers = markerNodes.map((marker, ordinal) => ({
        ...geometryAttributes(marker, [
          'markerHeight', 'markerUnits', 'markerWidth', 'orient',
          'preserveAspectRatio', 'refX', 'refY', 'viewBox'
        ]),
        ordinal,
        paint: [...marker.querySelectorAll('path, rect, circle, ellipse, polygon, polyline, line')]
          .map((candidate) => {
            const style = getComputedStyle(candidate);
            return {
              ...geometryAttributes(candidate, [
                'cx', 'cy', 'd', 'height', 'points', 'r', 'rx', 'ry',
                'transform', 'width', 'x', 'x1', 'x2', 'y', 'y1', 'y2'
              ]),
              fill: style.fill,
              opacity: style.opacity,
              stroke: style.stroke,
              strokeWidth: style.strokeWidth,
              tag: candidate.tagName.toLowerCase()
            };
          })
      }));
      const normalizeMarker = (value) => {
        const marker = /^url\((?:[^#]*#)?([^)]*)\)$/u.exec(value.trim());
        if (!marker) return value;
        const markerId = marker[1] ?? '';
        const ordinal = markerOrdinals.get(markerId);
        return undefined === ordinal ? 'marker:unresolved' : `marker:${ordinal}`;
      };
      const paint = [...svg.querySelectorAll('path, rect, circle, ellipse, polygon, polyline, line')]
        .filter((candidate) => !candidate.closest('defs'))
        .map((candidate) => {
          const style = getComputedStyle(candidate);
          const ancestorTransforms = [];
          let ancestor = candidate.parentElement;
          while (ancestor && ancestor !== svg) {
            ancestorTransforms.push({
              tag: ancestor.tagName.toLowerCase(),
              transform: ancestor.getAttribute('transform')
            });
            ancestor = ancestor.parentElement;
          }
          return {
            ...geometryAttributes(candidate, [
              'cx', 'cy', 'd', 'height', 'pathLength', 'points', 'r', 'rx', 'ry',
              'transform', 'vector-effect', 'width', 'x', 'x1', 'x2', 'y', 'y1', 'y2'
            ]),
            ancestorTransforms,
            fill: style.fill,
            opacity: style.opacity,
            stroke: style.stroke,
            strokeWidth: style.strokeWidth,
            tag: candidate.tagName.toLowerCase(),
            vectorEffect: style.vectorEffect,
            markerEnd: normalizeMarker(candidate.getAttribute('marker-end') ?? ''),
            markerStart: normalizeMarker(candidate.getAttribute('marker-start') ?? '')
          };
        })
        .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
      const font = leaves
        .map((candidate) => {
          const style = getComputedStyle(candidate);
          return {
            family: style.fontFamily,
            fill: style.fill,
            letterSpacing: style.letterSpacing,
            size: style.fontSize,
            style: style.fontStyle,
            textAnchor: style.textAnchor,
            text: (candidate.textContent ?? '').replace(/\s+/gu, ' ').trim(),
            variation: style.fontVariationSettings,
            weight: style.fontWeight
          };
        })
        .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
      const viewBox = {
        height: viewBoxValues[3],
        width: viewBoxValues[2],
        x: viewBoxValues[0],
        y: viewBoxValues[1]
      };
      const computed = getComputedStyle(element);
      return {
        counts: {
          clipPaths: svg.querySelectorAll('clipPath').length,
          foreignObjects: svg.querySelectorAll('foreignObject').length,
          leaves: leaves.length,
          markerDefinitions: svg.querySelectorAll('marker').length,
          paint: paint.length,
          scripts: svg.querySelectorAll('script').length
        },
        font,
        labels,
        markers,
        paint,
        root: {
          height: computed.height,
          overflow: computed.overflow,
          transform: computed.transform,
          width: computed.width,
          zoom: computed.zoom
        },
        ordinal: index,
        role,
        viewBox
      };
    }));
}

export async function assertMermaidFingerprintSensitivity(preview) {
  const baseline = await readMermaidSourceFingerprints(preview);
  const pathMutation = await preview.evaluate((root) => {
    const diagrams = [...root.querySelectorAll('.easymde-mermaid')];
    for (const [diagramOrdinal, diagram] of diagrams.entries()) {
      const svg = diagram.querySelector('svg');
      if (!(svg instanceof SVGSVGElement)) continue;
      const paint = [...svg.querySelectorAll('path, rect, circle, ellipse, polygon, polyline, line')]
        .filter((candidate) => !candidate.closest('defs'));
      const paintOrdinal = paint.findIndex((candidate) => (
        candidate instanceof SVGPathElement && Boolean(candidate.getAttribute('d'))
      ));
      if (-1 === paintOrdinal) continue;
      const candidate = paint[paintOrdinal];
      const original = candidate.getAttribute('d');
      candidate.setAttribute('d', `${original} M 0 0 L 1 1`);
      return { diagramOrdinal, original, paintOrdinal };
    }
    throw new Error('wechat-source-fingerprint-path-sensitivity-unavailable');
  });
  try {
    expect(await readMermaidSourceFingerprints(preview), 'path geometry mutation must change fingerprint')
      .not.toEqual(baseline);
  } finally {
    await preview.evaluate((root, { diagramOrdinal, original, paintOrdinal }) => {
      const svg = root.querySelectorAll('.easymde-mermaid')[diagramOrdinal]?.querySelector('svg');
      const candidate = svg
        ? [...svg.querySelectorAll('path, rect, circle, ellipse, polygon, polyline, line')]
          .filter((element) => !element.closest('defs'))[paintOrdinal]
        : null;
      if (!(candidate instanceof SVGElement) || null === original) {
        throw new Error('wechat-source-fingerprint-path-restore-unavailable');
      }
      candidate.setAttribute('d', original);
    }, pathMutation);
  }
  expect(await readMermaidSourceFingerprints(preview), 'path geometry restore must recover fingerprint')
    .toEqual(baseline);

  const vectorEffectMutation = await preview.evaluate((root) => {
    const candidate = [...root.querySelectorAll('.easymde-mermaid svg path')]
      .find((element) => !element.closest('defs'));
    if (!(candidate instanceof SVGPathElement)) {
      throw new Error('wechat-source-fingerprint-vector-effect-sensitivity-unavailable');
    }
    const original = candidate.style.getPropertyValue('vector-effect');
    const priority = candidate.style.getPropertyPriority('vector-effect');
    const replacement = 'non-scaling-stroke' === getComputedStyle(candidate).vectorEffect
      ? 'none'
      : 'non-scaling-stroke';
    candidate.style.setProperty('vector-effect', replacement, 'important');
    return { original, priority };
  });
  try {
    expect(
      await readMermaidSourceFingerprints(preview),
      'vector effect mutation must change fingerprint'
    ).not.toEqual(baseline);
  } finally {
    await preview.evaluate((root, { original, priority }) => {
      const candidate = [...root.querySelectorAll('.easymde-mermaid svg path')]
        .find((element) => !element.closest('defs'));
      if (!(candidate instanceof SVGPathElement)) {
        throw new Error('wechat-source-fingerprint-vector-effect-restore-unavailable');
      }
      if (original) candidate.style.setProperty('vector-effect', original, priority);
      else candidate.style.removeProperty('vector-effect');
    }, vectorEffectMutation);
  }
  expect(
    await readMermaidSourceFingerprints(preview),
    'vector effect restore must recover fingerprint'
  ).toEqual(baseline);

  const markerMutation = await preview.evaluate((root) => {
    const diagrams = [...root.querySelectorAll('.easymde-mermaid')];
    for (const [diagramOrdinal, diagram] of diagrams.entries()) {
      const svg = diagram.querySelector('svg');
      if (!(svg instanceof SVGSVGElement)) continue;
      const markerIds = [...svg.querySelectorAll('defs marker[id]')]
        .map((marker) => marker.id)
        .filter(Boolean);
      if (markerIds.length < 2) continue;
      const paint = [...svg.querySelectorAll('path, rect, circle, ellipse, polygon, polyline, line')]
        .filter((candidate) => !candidate.closest('defs'));
      const paintOrdinal = paint.findIndex((candidate) => (
        /^url\((?:[^#]*#)?[^)]*\)$/u.test(candidate.getAttribute('marker-end') ?? '')
      ));
      if (-1 === paintOrdinal) continue;
      const candidate = paint[paintOrdinal];
      const original = candidate.getAttribute('marker-end');
      const referencedId = /^url\((?:[^#]*#)?([^)]*)\)$/u.exec(original ?? '')?.[1];
      const replacementId = markerIds.find((markerId) => markerId !== referencedId);
      if (!replacementId) continue;
      candidate.setAttribute('marker-end', `url(#${replacementId})`);
      return { diagramOrdinal, original, paintOrdinal };
    }
    throw new Error('wechat-source-fingerprint-marker-sensitivity-unavailable');
  });
  try {
    expect(await readMermaidSourceFingerprints(preview), 'marker reference mutation must change fingerprint')
      .not.toEqual(baseline);
  } finally {
    await preview.evaluate((root, { diagramOrdinal, original, paintOrdinal }) => {
      const svg = root.querySelectorAll('.easymde-mermaid')[diagramOrdinal]?.querySelector('svg');
      const candidate = svg
        ? [...svg.querySelectorAll('path, rect, circle, ellipse, polygon, polyline, line')]
          .filter((element) => !element.closest('defs'))[paintOrdinal]
        : null;
      if (!(candidate instanceof SVGElement) || null === original) {
        throw new Error('wechat-source-fingerprint-marker-restore-unavailable');
      }
      candidate.setAttribute('marker-end', original);
    }, markerMutation);
  }
  expect(await readMermaidSourceFingerprints(preview), 'marker reference restore must recover fingerprint')
    .toEqual(baseline);
}
