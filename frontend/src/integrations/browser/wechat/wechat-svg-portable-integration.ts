import {
  isTaskListCheckbox,
  TASK_LIST_CHECKBOX_STATES,
  WECHAT_PNG_VISUAL_CLONES,
  WECHAT_STRUCTURE_REPLACEMENTS
} from './wechat-clone-metadata';
import type { BrowserWechatClipboardRuntime } from './wechat-clipboard-runtime';
import {
  assertPngConversionCurrent,
  type WechatPngConversionContext,
  WechatPngConversionError
} from './wechat-png-conversion-policy';
import {
  applySvgMarkerProjection,
  planSvgMarkerProjection,
  type WechatSvgCloneIdentity,
  type WechatSvgMarkerProjectionPlan
} from './wechat-svg-marker-projection';
import {
  mermaidCssPixelValue,
  mermaidDirectSvg,
  mermaidLayoutMagnification,
  mermaidResponsiveCssText
} from './wechat-mermaid-geometry';
import {
  mermaidIntrinsicScrollDimensions
} from './wechat-capture-plan';
import { replaceDeclarations } from './wechat-style-declarations';
import { markWechatOwnedScrollOwner } from './wechat-list-table-layout';

type WechatSvgIdentityWiring = {
  registrations: Map<Element, WechatSvgCloneIdentity>;
  runtime: BrowserWechatClipboardRuntime;
  sourceByClone: WeakMap<Element, Element>;
};

export type WechatSvgPortableIntegration = Readonly<{
  applyPlan: (finalizedRoot: HTMLElement) => void;
  freezePlan: (conversion: WechatPngConversionContext | null) => void;
  omitSubtree: (source: Element, clone: Element) => void;
  reconcileTaskCheckboxes: (layoutRoot: HTMLElement, cloneRoot: HTMLElement) => void;
  sourceForClone: (clone: Element) => Element;
}>;

function createWechatSvgIdentityWiring(
  sourceRoot: HTMLElement,
  cloneRoot: HTMLElement,
  runtime: BrowserWechatClipboardRuntime
): WechatSvgIdentityWiring {
  const registrations = new Map<Element, WechatSvgCloneIdentity>();
  const sourceByClone = new WeakMap<Element, Element>();
  const register = (source: Element, clone: Element): void => {
    if (source.namespaceURI !== clone.namespaceURI || source.localName !== clone.localName) {
      throw new Error('wechat-svg-identity-alignment-failed');
    }
    const previousSource = sourceByClone.get(clone);
    if (previousSource && previousSource !== source) {
      throw new Error('wechat-svg-identity-duplicate-owner');
    }
    const existing = registrations.get(source);
    if (existing && ('omitted' === existing.state || existing.clone !== clone)) {
      throw new Error('wechat-svg-identity-duplicate-source');
    }
    registrations.set(source, { clone, state: 'present' });
    sourceByClone.set(clone, source);
  };
  const walk = (source: Element, clone: Element): void => {
    register(source, clone);
    const sourceChildren = Array.from(source.children);
    const cloneChildren = Array.from(clone.children);
    if (sourceChildren.length !== cloneChildren.length) {
      throw new Error('wechat-svg-identity-alignment-failed');
    }
    sourceChildren.forEach((sourceChild, index) => {
      const cloneChild = cloneChildren[index];
      if (!cloneChild) throw new Error('wechat-svg-identity-alignment-failed');
      walk(sourceChild, cloneChild);
    });
  };
  walk(sourceRoot, cloneRoot);
  return { registrations, runtime, sourceByClone };
}

function sourceForWechatSvgClone(
  wiring: WechatSvgIdentityWiring,
  clone: Element
): Element {
  const source = wiring.sourceByClone.get(clone);
  if (!source) throw new Error('wechat-svg-identity-structure-mismatch');
  return source;
}

function reconcileWechatSvgTaskCheckboxReplacements(
  wiring: WechatSvgIdentityWiring,
  layoutRoot: HTMLElement,
  cloneRoot: HTMLElement
): void {
  const visit = (layout: Element, clone: Element): void => {
    const identity = wiring.registrations.get(layout);
    if ('present' !== identity?.state) {
      throw new Error('wechat-svg-identity-structure-mismatch');
    }
    if (identity.clone !== clone) {
      const replacedCheckbox =
        'input' === layout.localName.toLowerCase() &&
        isTaskListCheckbox(layout) &&
        'span' === clone.localName.toLowerCase() &&
        TASK_LIST_CHECKBOX_STATES.has(clone) &&
        !cloneRoot.contains(identity.clone);
      if (!replacedCheckbox) throw new Error('wechat-svg-identity-structure-mismatch');
      wiring.sourceByClone.delete(identity.clone);
      wiring.registrations.set(layout, { clone, state: 'present' });
      wiring.sourceByClone.set(clone, layout);
    }
    const layoutChildren = Array.from(layout.children);
    const cloneChildren = Array.from(clone.children);
    if (layoutChildren.length !== cloneChildren.length) {
      throw new Error('wechat-svg-identity-alignment-failed');
    }
    layoutChildren.forEach((layoutChild, index) => {
      const cloneChild = cloneChildren[index];
      if (!cloneChild) throw new Error('wechat-svg-identity-alignment-failed');
      visit(layoutChild, cloneChild);
    });
  };
  visit(layoutRoot, cloneRoot);
}

function omitWechatSvgIdentitySubtree(
  wiring: WechatSvgIdentityWiring,
  source: Element,
  clone: Element
): void {
  const registered = wiring.registrations.get(source);
  if (!registered || 'omitted' === registered.state || registered.clone !== clone) {
    throw new Error('wechat-svg-identity-omission-mismatch');
  }
  const visit = (sourceElement: Element): void => {
    const identity = wiring.registrations.get(sourceElement);
    if (!identity || 'omitted' === identity.state) return;
    wiring.sourceByClone.delete(identity.clone);
    wiring.registrations.set(sourceElement, { state: 'omitted' });
    for (const sourceChild of Array.from(sourceElement.children)) {
      visit(sourceChild);
    }
  };
  visit(source);
}

function planSvgMarkersBeforeFinalization(
  root: HTMLElement,
  wiring: WechatSvgIdentityWiring,
  runtime: BrowserWechatClipboardRuntime,
  conversion: WechatPngConversionContext | null
): Map<Element, WechatSvgMarkerProjectionPlan> {
  if (conversion) assertPngConversionCurrent(conversion);
  const staleError = () =>
    conversion
      ? new WechatPngConversionError('wechat-png-rasterization-cancelled')
      : new Error('wechat-copy-stale');
  const sourceRoot = sourceForWechatSvgClone(wiring, root);
  const excludedRoots = new Set<Element>();
  if (conversion) {
    for (const [source, identity] of wiring.registrations) {
      if ('present' !== identity.state || !WECHAT_PNG_VISUAL_CLONES.has(identity.clone)) continue;
      excludedRoots.add(source);
      excludedRoots.add(identity.clone);
    }
  }
  const plans = new Map<Element, WechatSvgMarkerProjectionPlan>();
  const collect = (source: Element, clone: Element): void => {
    if (conversion) assertPngConversionCurrent(conversion);
    const identity = wiring.registrations.get(source);
    if (!identity) throw staleError();
    if ('omitted' === identity.state) return;
    if (identity.clone !== clone) throw new Error('wechat-svg-identity-structure-mismatch');
    if ('svg' === source.localName.toLowerCase()) {
      try {
        const plan = planSvgMarkerProjection({
          cloneIdentityFor: (sourceElement) => wiring.registrations.get(sourceElement) ?? null,
          cloneSvg: clone as SVGSVGElement,
          excludedRoots,
          getComputedStyle: (element) => runtime.getComputedStyle(element),
          isCancelled: () => Boolean(conversion?.signal.aborted || (conversion?.isCurrent && !conversion.isCurrent())),
          sourceSvg: source as SVGSVGElement
        });
        plans.set(clone, plan);
      } catch (error: unknown) {
        if (error instanceof Error && 'wechat-svg-marker-projection-cancelled' === error.message) {
          throw staleError();
        }
        throw error;
      }
      return;
    }
    for (const sourceChild of Array.from(source.children)) {
      const childIdentity = wiring.registrations.get(sourceChild);
      if (!childIdentity) throw staleError();
      if ('omitted' === childIdentity.state) continue;
      collect(sourceChild, childIdentity.clone);
    }
  };
  collect(sourceRoot, root);
  return plans;
}

function verifyPlannedSvgMarkers(
  planBySvg: ReadonlyMap<Element, WechatSvgMarkerProjectionPlan>
): void {
  for (const plan of planBySvg.values()) {
    if (
      plan.cloneSvg.ownerDocument.body &&
      plan.cloneSvg.isConnected &&
      !plan.cloneSvg.ownerDocument.body.contains(plan.cloneSvg)
    ) {
      throw new Error('wechat-svg-marker-projection-root-detached');
    }
    for (const item of plan.items) {
      if (!plan.cloneSvg.contains(item.cloneElement)) {
        throw new Error('wechat-svg-marker-projection-clone-element-detached');
      }
    }
    for (const definition of plan.consumedMarkerDefinitions) {
      if (!plan.cloneSvg.contains(definition)) {
        throw new Error('wechat-svg-marker-projection-definition-detached');
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Frozen intrinsic Mermaid scroll plan for OFF (conversion === null)
// ---------------------------------------------------------------------------

type FrozenMermaidIntrinsicScrollEntry = Readonly<{
  cloneSvg: SVGSVGElement;
  frozenOwner: Element;
  maxWidthCss: string;
}>;

function freezeMermaidIntrinsicScrollPlans(
  wiring: WechatSvgIdentityWiring,
  runtime: BrowserWechatClipboardRuntime,
  sourceRoot: HTMLElement,
  cloneRoot: HTMLElement
): readonly FrozenMermaidIntrinsicScrollEntry[] {
  const entries: FrozenMermaidIntrinsicScrollEntry[] = [];
  for (const [source, identity] of wiring.registrations) {
    if ('present' !== identity.state) continue;
    if (!source.matches('.easymde-mermaid')) continue;
    // Unmarked roots stay on the existing responsive path.
    if (!source.hasAttribute('data-easymde-mermaid-layout')) continue;
    // Existing admission owns role/viewBox/paint/CTM/overflow/ancestor safety.
    const layoutMagnification = mermaidLayoutMagnification(source, runtime);
    const dimensions = mermaidIntrinsicScrollDimensions(source, runtime, layoutMagnification, sourceRoot);
    if ('intrinsic-viewport' !== dimensions?.capture) continue;
    // Freeze the Source cap now; applyPlan must not read Source again.
    const sourceSvg = mermaidDirectSvg(source);
    if (!sourceSvg) throw new WechatPngConversionError('wechat-png-rasterization-failed');
    const maxWidthText = mermaidResponsiveCssText(sourceSvg, runtime, 'max-width');
    const maxWidthPixels = mermaidCssPixelValue(maxWidthText);
    if (null === maxWidthPixels || maxWidthPixels <= 0 || !Number.isFinite(maxWidthPixels)) {
      throw new WechatPngConversionError('wechat-png-rasterization-failed');
    }
    // The direct clone SVG is the stable identity that survives normalization.
    const cloneOwner = identity.clone;
    if (cloneOwner === cloneRoot) throw new Error('wechat-mermaid-intrinsic-owner-root');
    const cloneSvg = mermaidDirectSvg(cloneOwner);
    if (!cloneSvg) throw new Error('wechat-mermaid-intrinsic-clone-svg-missing');
    entries.push({
      cloneSvg,
      frozenOwner: cloneOwner,
      maxWidthCss: `${maxWidthPixels}px`
    });
  }
  return entries;
}

function resolvedStructureOwner(frozenOwner: Element): Element {
  let current = frozenOwner;
  const visited = new Set<Element>();
  while (true) {
    if (visited.has(current)) throw new Error('wechat-mermaid-intrinsic-owner-cycle');
    visited.add(current);
    const replacement = WECHAT_STRUCTURE_REPLACEMENTS.get(current);
    if (!replacement) return current;
    current = replacement;
  }
}

function applyMermaidIntrinsicScrollPlans(
  entries: readonly FrozenMermaidIntrinsicScrollEntry[],
  finalizedRoot: HTMLElement
): void {
  for (const entry of entries) {
    const owner = resolvedStructureOwner(entry.frozenOwner);
    if (owner === finalizedRoot) throw new Error('wechat-mermaid-intrinsic-scroll-owner-root');
    if (!finalizedRoot.contains(owner)) {
      throw new Error('wechat-mermaid-intrinsic-scroll-owner-detached');
    }
    if (entry.cloneSvg.parentElement !== owner) {
      throw new Error('wechat-mermaid-intrinsic-scroll-owner-mismatch');
    }
    // Replace only the generic serializer rewrite; preserve the frozen Source
    // width/height declarations and cap.
    replaceDeclarations(entry.cloneSvg, [`max-width:${entry.maxWidthCss}`], true);
    markWechatOwnedScrollOwner(owner);
  }
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------

export function createWechatSvgPortableIntegration(
  sourceRoot: HTMLElement,
  cloneRoot: HTMLElement,
  runtime: BrowserWechatClipboardRuntime
): WechatSvgPortableIntegration {
  const wiring = createWechatSvgIdentityWiring(sourceRoot, cloneRoot, runtime);
  let frozenPlans: Map<Element, WechatSvgMarkerProjectionPlan> | null = null;
  let frozenIntrinsicScrollEntries: readonly FrozenMermaidIntrinsicScrollEntry[] = [];

  return {
    applyPlan(finalizedRoot: HTMLElement): void {
      if (frozenPlans) {
        verifyPlannedSvgMarkers(frozenPlans);
        for (const plan of frozenPlans.values()) {
          applySvgMarkerProjection(plan);
        }
      }
      if (frozenIntrinsicScrollEntries.length) {
        applyMermaidIntrinsicScrollPlans(frozenIntrinsicScrollEntries, finalizedRoot);
      }
    },
    freezePlan(conversion: WechatPngConversionContext | null): void {
      frozenPlans = planSvgMarkersBeforeFinalization(cloneRoot, wiring, runtime, conversion);
      // Only build the OFF intrinsic scroll plan when there is no PNG conversion.
      frozenIntrinsicScrollEntries = conversion
        ? []
        : freezeMermaidIntrinsicScrollPlans(wiring, runtime, sourceRoot, cloneRoot);
    },
    omitSubtree(source: Element, clone: Element): void {
      omitWechatSvgIdentitySubtree(wiring, source, clone);
    },
    reconcileTaskCheckboxes(layoutRoot: HTMLElement, cloneRootTarget: HTMLElement): void {
      reconcileWechatSvgTaskCheckboxReplacements(wiring, layoutRoot, cloneRootTarget);
    },
    sourceForClone(clone: Element): Element {
      return sourceForWechatSvgClone(wiring, clone);
    }
  };
}
