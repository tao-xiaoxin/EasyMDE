import { VISUAL_MARKDOWN_READ_ONLY_SELECTOR } from '../../contracts/visual-markdown-read-only';

export type PreparedVisualProtectedNodeAdoption = Readonly<{
  nodes: ReadonlyArray<Node>;
  rollback: () => void;
}>;

export type VisualProtectedNodeMatching = 'path' | 'protected-order';

export type VisualProtectedNodeAttribute = Readonly<{
  name: string;
  value: string;
}>;

export function visualProtectedNodeAttributes(
  node: HTMLElement
): ReadonlyArray<VisualProtectedNodeAttribute> {
  return Array.from(node.attributes)
    .filter(({ name, value }) => 'style' !== name || '' !== value.trim())
    .map(({ name, value }) => ({ name, value }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function visualProtectedNodeAttributesEqual(
  current: ReadonlyArray<VisualProtectedNodeAttribute>,
  expected: ReadonlyArray<VisualProtectedNodeAttribute>
): boolean {
  return current.length === expected.length
    && current.every((attribute, index) => {
      const expectedAttribute = expected[index];
      return expectedAttribute?.name === attribute.name
        && expectedAttribute.value === attribute.value;
    });
}

type ProtectedNodePath = Readonly<{
  node: HTMLElement;
  path: ReadonlyArray<number>;
}>;

type NestedProtectedNodeAdoption = Readonly<{
  freshNode: HTMLElement;
  freshParent: Node;
  oldNextSibling: Node | null;
  oldNode: HTMLElement;
  oldParent: Node;
}>;

function protectedNodePaths(roots: ReadonlyArray<Node>): ProtectedNodePath[] {
  const result: ProtectedNodePath[] = [];
  const visit = (node: Node, path: ReadonlyArray<number>): void => {
    if (
      node instanceof HTMLElement
      && node.matches(VISUAL_MARKDOWN_READ_ONLY_SELECTOR)
    ) {
      result.push({ node, path });
    }
    Array.from(node.childNodes).forEach((child, index) => {
      visit(child, [...path, index]);
    });
  };
  roots.forEach((root, index) => {
    visit(root, [index]);
  });
  return result;
}

function protectedPathKey(path: ReadonlyArray<number>): string {
  return path.join('.');
}

function protectedPathIsAncestor(
  ancestor: ReadonlyArray<number>,
  descendant: ReadonlyArray<number>
): boolean {
  return ancestor.length < descendant.length
    && ancestor.every((index, depth) => index === descendant[depth]);
}

function protectedNodesAreEquivalent(
  previous: ProtectedNodePath,
  fresh: ProtectedNodePath
): boolean {
  return previous.node.getAttribute('contenteditable') === 'false'
    && previous.node.localName === fresh.node.localName
    && previous.node.namespaceURI === fresh.node.namespaceURI
    && previous.node.innerHTML === fresh.node.innerHTML
    && visualProtectedNodeAttributesEqual(
      visualProtectedNodeAttributes(previous.node),
      visualProtectedNodeAttributes(fresh.node)
    );
}

export function prepareVisualProtectedNodeAdoption(
  currentRoots: ReadonlyArray<Node>,
  candidateRoots: ReadonlyArray<Node>,
  enabled = true,
  matching: VisualProtectedNodeMatching = 'path'
): PreparedVisualProtectedNodeAdoption {
  const nextNodes = [...candidateRoots];
  const noopRollback = (): void => undefined;
  if (!enabled) return { nodes: nextNodes, rollback: noopRollback };

  const previousProtectedNodes = protectedNodePaths(currentRoots);
  const freshProtectedNodes = protectedNodePaths(candidateRoots);
  for (const fresh of freshProtectedNodes) {
    if (!fresh.node.hasAttribute('contenteditable')) {
      fresh.node.setAttribute('contenteditable', 'false');
    }
  }

  const freshByPath = new Map(
    freshProtectedNodes.map((entry) => [protectedPathKey(entry.path), entry])
  );
  const equivalentPairs = 'path' === matching
    ? previousProtectedNodes.flatMap((previous) => {
        const fresh = freshByPath.get(protectedPathKey(previous.path));
        return fresh && protectedNodesAreEquivalent(previous, fresh)
          ? [{ fresh, previous }]
          : [];
      })
    : previousProtectedNodes.length === freshProtectedNodes.length
      ? previousProtectedNodes.flatMap((previous, index) => {
          const fresh = freshProtectedNodes[index];
          return fresh && protectedNodesAreEquivalent(previous, fresh)
            ? [{ fresh, previous }]
            : [];
        })
      : [];
  const maximalPairs = equivalentPairs.filter(({ fresh }) =>
    !equivalentPairs.some((candidate) =>
      candidate.fresh !== fresh
      && protectedPathIsAncestor(candidate.fresh.path, fresh.path)
    )
  );
  const nestedAdoptions: NestedProtectedNodeAdoption[] = [];

  try {
    for (const { fresh, previous } of maximalPairs) {
      const [rootIndex, ...childPath] = fresh.path;
      if (undefined === rootIndex) continue;
      if (0 === childPath.length) {
        if (nextNodes[rootIndex] !== fresh.node) {
          throw new Error('preview-protected-node-root-path-stale');
        }
        nextNodes[rootIndex] = previous.node;
        continue;
      }
      const freshParent = fresh.node.parentNode;
      const oldParent = previous.node.parentNode;
      if (!freshParent || !oldParent) {
        throw new Error('preview-protected-node-parent-missing');
      }
      const oldNextSibling = previous.node.nextSibling;
      freshParent.replaceChild(previous.node, fresh.node);
      nestedAdoptions.push({
        freshNode: fresh.node,
        freshParent,
        oldNextSibling,
        oldNode: previous.node,
        oldParent
      });
    }
  } catch (error) {
    for (const adoption of nestedAdoptions.reverse()) {
      if (adoption.oldNode.parentNode === adoption.freshParent) {
        adoption.freshParent.replaceChild(
          adoption.freshNode,
          adoption.oldNode
        );
      }
      if (adoption.oldNode.parentNode !== adoption.oldParent) {
        adoption.oldParent.insertBefore(
          adoption.oldNode,
          adoption.oldNextSibling?.parentNode === adoption.oldParent
            ? adoption.oldNextSibling
            : null
        );
      }
    }
    throw error;
  }

  return {
    nodes: nextNodes,
    rollback: () => {
      for (const adoption of nestedAdoptions.reverse()) {
        if (adoption.oldNode.parentNode === adoption.freshParent) {
          adoption.freshParent.replaceChild(
            adoption.freshNode,
            adoption.oldNode
          );
        }
        if (adoption.oldNode.parentNode !== adoption.oldParent) {
          adoption.oldParent.insertBefore(
            adoption.oldNode,
            adoption.oldNextSibling?.parentNode === adoption.oldParent
              ? adoption.oldNextSibling
              : null
          );
        }
      }
    }
  };
}
