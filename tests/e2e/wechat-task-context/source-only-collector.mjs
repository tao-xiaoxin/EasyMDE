// Source-only CDP evidence collection: node graph, potential box model, and
// the page-level collector that reports and then cleans up its CDP session.

import { cdpRuntimeEvaluation } from "./cdp-geometry.mjs";
import { finiteQuad } from "./geometry-measures.mjs";
import { completeSourceOnlyCdpEvidence } from "./source-only-contract.mjs";
import { freezeSourceOnlyPrimary } from "./source-only-contract.mjs";
import { runSourceOnlyCdpCleanup } from "./source-only-contract.mjs";

export function collectSourceOnlyNodeGraph(root) {
  const entries = [];
  const stack = root
    ? [{ edgeKind: 'root', localIndex: 0, node: root, parentIndex: null }]
    : [];
  let controlIndex = 0;
  while (stack.length) {
    const current = stack.pop();
    if (!current?.node) continue;
    const { node } = current;
    const index = entries.length;
    const nodeName = typeof node.nodeName === 'string' ? node.nodeName : null;
    const isInput = nodeName === 'INPUT';
    entries.push({
      backendNodeId: node.backendNodeId,
      controlIndex: isInput ? controlIndex++ : null,
      edgeKind: current.edgeKind,
      localIndex: current.localIndex,
      nodeName,
      nodeType: Number.isInteger(node.nodeType) ? node.nodeType : null,
      parentIndex: current.parentIndex,
      pseudoType: typeof node.pseudoType === 'string' ? node.pseudoType : null
    });
    const groups = [
      ['children', node.children ?? []],
      ['shadowRoots', node.shadowRoots ?? []],
      ['pseudoElements', node.pseudoElements ?? []]
    ];
    for (let groupIndex = groups.length - 1; groupIndex >= 0; groupIndex -= 1) {
      const [edgeKind, children] = groups[groupIndex];
      for (let localIndex = children.length - 1; localIndex >= 0; localIndex -= 1) {
        stack.push({
          edgeKind,
          localIndex,
          node: children[localIndex],
          parentIndex: index
        });
      }
    }
  }
  return entries;
}

export async function collectSourceOnlyPotentialBox(cdp, node) {
  const result = {
    boxModelStatus: 'empty',
    contentQuads: null,
    contentQuadsStatus: 'empty'
  };
  const backendNodeId = node?.backendNodeId;
  if (!Number.isInteger(backendNodeId) || backendNodeId < 1) return result;
  try {
    const box = await cdp.send('DOM.getBoxModel', { backendNodeId });
    result.boxModelStatus = box.model
      && finiteQuad(box.model.border)
      && finiteQuad(box.model.content)
      ? 'finite'
      : 'empty';
  } catch {
    result.boxModelStatus = 'rejected';
  }
  try {
    const quads = await cdp.send('DOM.getContentQuads', { backendNodeId });
    if (!Array.isArray(quads.quads) || !quads.quads.length) {
      result.contentQuadsStatus = 'empty';
    } else if (quads.quads.every(finiteQuad)) {
      result.contentQuadsStatus = 'finite';
      result.contentQuads = quads.quads;
    } else {
      result.contentQuadsStatus = 'empty';
    }
  } catch {
    result.contentQuadsStatus = 'rejected';
  }
  return result;
}

export async function collectSourceOnlyCdpEvidence(page, selector) {
  let cdp = null;
  let rootObjectId = null;
  let result = null;
  let runtime = { product: null, protocolVersion: null };
  try {
    cdp = await page.context().newCDPSession(page);
    await cdp.send('Runtime.enable');
    await cdp.send('DOM.enable');
    try {
      const version = await cdp.send('Browser.getVersion');
      runtime = {
        product: typeof version?.product === 'string' ? version.product : null,
        protocolVersion: typeof version?.protocolVersion === 'string'
          ? version.protocolVersion
          : null
      };
    } catch {
      result = {
        code: 'wechat-task-context-source-only-runtime-version-unavailable',
        runtime,
        status: 'unavailable'
      };
    }
    if (!result) {
      const root = await cdpRuntimeEvaluation(
        cdp,
        `document.querySelector(${JSON.stringify(selector)})`,
        { returnByValue: false }
      );
      if (!root.ok) {
        result = {
          code: 'wechat-task-context-source-only-root-missing',
          runtime,
          status: 'unavailable'
        };
      } else {
        rootObjectId = root.objectId;
        const described = await cdp.send('DOM.describeNode', {
          depth: -1,
          objectId: root.objectId,
          pierce: true
        });
        const graph = collectSourceOnlyNodeGraph(described.node);
        const nodes = await Promise.all(graph.map(async (entry) => ({
          controlIndex: entry.controlIndex,
          edgeKind: entry.edgeKind,
          localIndex: entry.localIndex,
          nodeName: entry.nodeName,
          nodeType: entry.nodeType,
          parentIndex: entry.parentIndex,
          potentialBox: await collectSourceOnlyPotentialBox(cdp, entry),
          pseudoType: entry.pseudoType
        })));
        const inputs = nodes.filter(({ nodeName }) => nodeName === 'INPUT');
        const complete = inputs.length === 19
          && inputs.every(({ potentialBox }) => (
            potentialBox.boxModelStatus === 'finite'
            && potentialBox.contentQuadsStatus === 'finite'
          ));
        result = {
          code: complete ? null : 'wechat-task-context-source-only-collector-incomplete',
          inputCount: inputs.length,
          nodeCount: nodes.length,
          nodes,
          pseudoCount: nodes.filter(({ nodeName }) => (
            typeof nodeName === 'string' && nodeName.startsWith('::')
          )).length,
          runtime,
          status: complete ? 'ready' : 'unavailable'
        };
      }
    }
  } catch {
    result = {
      code: 'wechat-task-context-source-only-collector-incomplete',
      runtime,
      status: 'unavailable'
    };
  } finally {
    const primaryResult = result ?? {
      code: 'wechat-task-context-source-only-collector-incomplete',
      runtime,
      status: 'unavailable'
    };
    const primary = freezeSourceOnlyPrimary(
      primaryResult.status === 'ready'
        ? 'available'
        : primaryResult.status === 'failed'
          ? 'failed'
          : 'unavailable',
      primaryResult.code ?? 'wechat-task-context-source-only-ready'
    );
    const contract = await runSourceOnlyCdpCleanup(primary, cdp, rootObjectId);
    result = completeSourceOnlyCdpEvidence(primaryResult, contract, runtime);
  }
  return result ?? {
    code: 'wechat-task-context-source-only-collector-incomplete',
    runtime,
    status: 'unavailable'
  };
}
