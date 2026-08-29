# UI Fidelity And Accessibility

## Contents

- [Design contract](#design-contract)
- [Controlled baseline](#controlled-baseline)
- [Scoped implementation](#scoped-implementation)
- [Interaction and accessibility](#interaction-and-accessibility)
- [Comparison and completion](#comparison-and-completion)

## Design contract

Use a real approved design source or a reproducible rendered reference. It is
reference evidence, not permission to alter protected surfaces. Before editing,
identify the reference revision/state, target surface, affected owners, and
protected neighbors. Separate visual, behavioral, responsive, accessibility,
data/integration, and compatibility invariants. Declare the comparison matrix
and tolerances before seeing a failure; include breakpoints, zoom/text scale,
locale/direction, input modes, and supported UI states.

Build a source-to-render map for every visible region, control, icon, label,
divider, overlay, and distinct interaction state:

```text
Reference item and stable locator:
Reference source owner and state:
Target owner and state:
Authored tokens and effective computed values:
Geometry and accessibility state:
Compatibility constraint and protected neighbors:
Parity: exact, intentional deviation, mismatch, or unverified
```

Reconcile reference and target inventories in both directions. A missing
reference item or unexpected target-only item is a mismatch unless an explicit
current requirement, WordPress compatibility rule, or accessibility need
justifies it.

## Controlled baseline

Capture the target and every protected surface that could regress before a
material change. Use identical deterministic content, browser, viewport, zoom,
fonts, assets, animation state, and UI state. Wait for a readiness barrier:
fonts loaded, images decoded, Preview and async data settled, and caret,
animation, transition, and clock state deterministic. A failed readiness
condition is a test failure.

Inspect relevant source ownership, imports, tokens, assets, fonts, breakpoints,
event handlers, DOM order, accessibility tree, computed styles, overflow,
stacking, Focus, Selection, Scroll, and geometry. A matching filename or child
declaration is not source evidence. Use an isolated browser profile and the
minimum authorized page/account scope. Keep captures local, temporary,
synthetic, and privacy-safe; remove metadata before authorized publication.

## Scoped implementation

Map each visual region to its narrowest stable code owner. Scope CSS and DOM
under that Root; do not use global element selectors, broad WordPress overrides,
arbitrary offsets, duplicate icons, or broad `!important` to compensate for an
incorrect parent. Preserve DOM order when it carries editing, reading, or
keyboard meaning. Never restyle a protected template just because it is easier
to share.

Implement from outer geometry to inner detail:

1. workspace bounds and stacking;
2. grid, flex, pane, and overflow geometry;
3. dimensions, spacing, borders, backgrounds, and shadows;
4. typography, icons, assets, and wrapping;
5. interactive/async states; and
6. responsive and accessibility behavior.

Connect every visible control to its production capability unless a contract
explicitly permits a local simulation. Keep fixed-format controls stable under
loading, translation, long labels, and dynamic data.

## Interaction and accessibility

Exercise pointer, keyboard, touch where supported, Focus entry/return, Escape,
Tab order, Dialogs, overlays, Scroll, drag boundaries, disabled/pending/
success/error states, reduced motion, forced colors, and text scaling. Exercise
duplicate activation, pointer cancellation/lost capture, resize during drag,
rejection after close, late async completion, and repeated enter/exit.

Inspect the accessibility tree for role, name, description, value, state,
relationships, logical order, Dialog containment/return, disabled semantics,
contrast, and visible Focus. ARIA attributes alone are not proof. Preserve
Selection, IME, Undo, Scroll, Focus, and native form behavior across overlays
and modes. Verify Storage-disabled, corrupt, quota, and access-exception paths;
storage failure may use a documented preference default but never article
persistence fallback.

## Comparison and completion

Compare source ownership and interaction semantics, then effective DOM,
geometry, computed styles, pixels, accessibility, and behavior. Test just below,
at, and above each breakpoint; include orientation, zoom, text scale, scrollbar,
safe area, and open keyboard where relevant. Compare default, hover,
focus-visible, active, selected, disabled, pending, error, and expanded states.

On mismatch, locate the first divergent ancestor or owner, fix the root cause,
and rerender. Tolerate only understood rasterization/subpixel variance. A
Chromium result does not prove other engines. A target path or reference
revision change invalidates earlier mapping and target evidence; rebuild it.

Completion evidence reports reference conditions, changed owners, measurements,
interaction/accessibility results, protected-surface checks, commands actually
run, privacy cleanup, and remaining mismatches or unverified scope. Remove
temporary screenshots, overlays, diffs, traces, videos, network captures, and
browser reports unless explicitly requested as a reviewed deliverable.
