import { createElement } from '@wordpress/element';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  EditorContextMenuFeature,
  type EditorContextMenuTargetLease
} from './EditorContextMenuFeature';
import {
  acceptedSelectionFixture,
  clipboard,
  labels,
  layoutSurface,
  retainedPendingMenu
} from './editor-context-menu-feature.test-harness';

describe('EditorContextMenuFeature', () => {
  it('prepares the source selection from the pointer before a pending demand is captured', async () => {
    const source = document.createElement('div');
    source.contentEditable = 'true';
    layoutSurface(source);
    document.body.append(source);
    const readinessListeners = new Set<() => void>();
    const order: string[] = [];
    const pointerPositions: Array<Readonly<{ x: number; y: number }>> = [];
    let ready = false;
    let selection = { direction: 'none' as const, end: 0, start: 0 };
    const onAction = vi.fn();
    render(
      <EditorContextMenuFeature
        clipboard={clipboard()}
        direction="ltr"
        labels={labels}
        onAction={onAction}
        onFailure={vi.fn()}
        source={{
          boundaryElement: source,
          element: source,
          getContextReadiness: () =>
            ready ? { status: 'ready' as const } : { status: 'pending' as const },
          getSnapshot: () => {
            order.push('snapshot');
            return { selection, value: 'alpha beta' };
          },
          isEditable: () => true,
          kind: 'source',
          preparePointerSelection: (position) => {
            order.push('pointer');
            pointerPositions.push(position);
            // The preparation owns the canonical selection: it republishes the
            // selection the pointer describes.
            selection = { direction: 'none', end: 5, start: 5 };
            return true;
          },
          subscribeReadiness: (listener) => {
            readinessListeners.add(listener);
            return () => readinessListeners.delete(listener);
          }
        }}
        visual={null}
      />
    );

    fireEvent.mouseDown(source, { button: 2, clientX: 20, clientY: 30 });
    fireEvent.contextMenu(source, { clientX: 20, clientY: 30 });
    // The pointer ran before the first snapshot read, so the demand that still
    // has to wait for readiness already describes the pointed position.
    expect(order[0]).toBe('pointer');
    expect(screen.queryByRole('menu')).toBeNull();

    ready = true;
    for (const listener of readinessListeners) listener();
    expect(await screen.findByRole('menu')).toBeTruthy();
    // Replaying the pending demand must not reinterpret the gesture's old
    // screen coordinates: the pointer runs exactly once, for the original
    // gesture.
    expect(pointerPositions).toEqual([{ x: 20, y: 30 }]);

    fireEvent.click(screen.getByRole('menuitem', { name: 'Paste' }));
    expect(onAction).toHaveBeenCalledWith(
      'paste',
      expect.objectContaining({
        selection: { direction: 'none', end: 5, start: 5 }
      })
    );
  });

  it.each(['pointer', 'keyboard'] as const)(
    'runs the %s demand preflight exactly once, before capture and snapshot, across every notification',
    async (activation) => {
      // The preflight is the owner's own pending-input settlement. It must run
      // once per gesture, before the target is captured and before any document
      // is read, and a readiness, index, or snapshot notification must not run
      // it (or a second capture) again: those notifications belong to the
      // demand that already ran it.
      const source = document.createElement('div');
      source.contentEditable = 'true';
      layoutSurface(source);
      const target = document.createElement('p');
      target.textContent = 'alpha';
      source.append(target);
      document.body.append(source);
      const readinessListeners = new Set<() => void>();
      const indexListeners = new Set<() => void>();
      const snapshotListeners = new Set<() => void>();
      const log: string[] = [];
      const capturedTargets: Array<Element | null> = [];
      const released = vi.fn();
      let value = 'alpha';
      let ready = true;
      const onFailure = vi.fn();
      const view = render(
        <EditorContextMenuFeature
          clipboard={clipboard()}
          direction="ltr"
          labels={labels}
          onAction={vi.fn()}
          onFailure={onFailure}
          source={{
            boundaryElement: source,
            element: source,
            captureTarget: (element: Element | null) => {
              log.push('capture');
              capturedTargets.push(element);
              return {
                release: released,
                resolve: () => {
                  log.push('resolve');
                  return target;
                }
              };
            },
            getActionContext: () => null,
            getBlockIndex: () => null,
            getContextReadiness: () => {
              log.push('readiness');
              return ready
                ? { status: 'ready' as const }
                : { status: 'pending' as const };
            },
            getSnapshot: () => {
              log.push('snapshot');
              return {
                selection: { direction: 'none' as const, end: value.length, start: value.length },
                value
              };
            },
            isEditable: () => true,
            kind: 'source',
            prepare: () => {
              log.push('prepare');
              return true;
            },
            // The owner's existing pending-input flush. Each call is a real
            // settlement, so a second call is observable in the document.
            prepareDemand: () => {
              log.push('preflight');
              value = 'alpha z';
              return true;
            },
            subscribeBlockIndex: (listener: () => void) => {
              indexListeners.add(listener);
              return () => indexListeners.delete(listener);
            },
            subscribeReadiness: (listener: () => void) => {
              readinessListeners.add(listener);
              return () => readinessListeners.delete(listener);
            },
            subscribeSnapshot: (listener: () => void) => {
              snapshotListeners.add(listener);
              return () => snapshotListeners.delete(listener);
            }
          }}
          visual={null}
        />
      );

      if ('pointer' === activation) {
        fireEvent.pointerDown(target, { button: 2, clientX: 20, clientY: 30 });
        fireEvent.contextMenu(target, { clientX: 20, clientY: 30 });
      } else {
        fireEvent.keyDown(source, { key: 'F10', shiftKey: true });
      }
      await screen.findByRole('menu');

      // Order: the preflight settles the input, then the gesture is captured,
      // and only then is any document read.
      expect(log.filter((entry) => entry === 'preflight')).toHaveLength(1);
      expect(log.filter((entry) => entry === 'capture')).toHaveLength(1);
      expect(log.indexOf('preflight')).toBeLessThan(log.indexOf('capture'));
      expect(log.indexOf('capture')).toBeLessThan(log.indexOf('snapshot'));
      // The captured demand carries the settled document, so the menu already
      // describes the typed bytes rather than the pre-input source.
      // A pointer activation captures the pointed element; a keyboard
      // activation captures the surface itself, because the user selected no
      // node with the menu key.
      expect(capturedTargets).toEqual([
        'pointer' === activation ? target : source
      ]);
      expect(value).toBe('alpha z');
      expect(onFailure).not.toHaveBeenCalled();

      // Owner notifications are not new gestures: readiness, index, and
      // snapshot publications rebuild the same demand without settling input
      // or capturing a second witness.
      ready = false;
      for (const listener of [...readinessListeners]) listener();
      ready = true;
      for (const listener of [...indexListeners]) listener();
      for (const listener of [...snapshotListeners]) listener();
      await act(async () => {
        await Promise.resolve();
      });
      expect(log.filter((entry) => entry === 'preflight')).toHaveLength(1);
      expect(log.filter((entry) => entry === 'capture')).toHaveLength(1);
      expect(capturedTargets).toHaveLength(1);
      expect(screen.getByRole('menu')).toBeTruthy();
      view.unmount();
      expect(released).toHaveBeenCalledOnce();
    }
  );

  it.each(['pointer', 'keyboard'] as const)(
    'ends the %s gesture at a refused preflight without capturing a target or adding an error',
    async (activation) => {
      // A visual owner may refuse its own pending-input settlement (it is busy,
      // its selection is unusable, or the surface already failed closed). The
      // gesture then ends before any target is captured: no lease is created,
      // no document is read, and no second failure is reported on top of the one
      // the owner already raised through its own failure port.
      const surfaceElement = document.createElement('div');
      surfaceElement.contentEditable = 'true';
      layoutSurface(surfaceElement);
      const target = document.createElement('p');
      target.textContent = 'alpha';
      surfaceElement.append(target);
      document.body.append(surfaceElement);
      const captured = vi.fn();
      const reads: string[] = [];
      const onFailure = vi.fn();
      const view = render(
        <EditorContextMenuFeature
          clipboard={clipboard()}
          direction="ltr"
          labels={labels}
          onAction={vi.fn()}
          onFailure={onFailure}
          source={null}
          visual={{
            boundaryElement: surfaceElement,
            captureTarget: (element: Element | null) => {
              captured(element);
              return { release: vi.fn(), resolve: () => target };
            },
            element: surfaceElement,
            getContextReadiness: () => {
              reads.push('readiness');
              return { status: 'ready' as const };
            },
            getSnapshot: () => {
              reads.push('snapshot');
              return {
                selection: { direction: 'none' as const, end: 5, start: 5 },
                value: 'alpha'
              };
            },
            isEditable: () => true,
            kind: 'visual',
            prepare: () => {
              reads.push('prepare');
              return true;
            },
            prepareDemand: () => false
          }}
        />
      );
      try {
        if ('pointer' === activation) {
          fireEvent.pointerDown(target, { button: 2, clientX: 20, clientY: 30 });
          fireEvent.contextMenu(target, { clientX: 20, clientY: 30 });
        } else {
          fireEvent.keyDown(surfaceElement, { key: 'F10', shiftKey: true });
        }
        await act(async () => {
          await Promise.resolve();
        });
        expect(screen.queryByRole('menu')).toBeNull();
        expect(captured).not.toHaveBeenCalled();
        // The demand never read the document: no snapshot, no preparation.
        expect(reads).toEqual([]);
        expect(onFailure).not.toHaveBeenCalled();
      } finally {
        view.unmount();
      }
    }
  );

  it('keeps the first pending gesture when the owner publishes its accepted selection', async () => {
    // The owner normalizes its own presentation caret inside its accepted
    // write: value and revision stay identical and only the selection moves.
    // Without the receipt the ordinary matcher retires the demand the user is
    // still making.
    const fixture = acceptedSelectionFixture({ revision: 4 });
    try {
      fixture.open();
      expect(screen.queryByRole('menu')).toBeNull();
      expect(fixture.preflights()).toBe(1);
      expect(fixture.captures()).toBe(1);

      // Accepted publication: same value, same revision, caret 9 -> 0.
      fixture.setSelection({ direction: 'none', end: 0, start: 0 });
      act(() => {
        fixture.fire('selection');
      });

      // Exactly one consumption, with the demand's own capture as `before`.
      expect(fixture.consumes).toHaveLength(1);
      expect(fixture.consumes[0]?.before).toEqual({
        revision: 4,
        selection: { direction: 'none', end: 9, start: 9 },
        value: 'a | b\n--- | ---'
      });
      expect(fixture.consumes[0]?.after.selection).toEqual({
        direction: 'none',
        end: 0,
        start: 0
      });
      // The demand survived: still no menu, still no resolve/prepare/action.
      expect(screen.queryByRole('menu')).toBeNull();
      expect(fixture.resolves()).toBe(0);
      expect(fixture.prepares).toHaveLength(0);
      expect(fixture.actionContexts).toHaveLength(0);
      expect(fixture.onFailure).not.toHaveBeenCalled();

      // The same gesture then completes once readiness allows the read.
      fixture.setReady(true);
      act(() => {
        fixture.fire('readiness');
      });
      await screen.findByRole('menu');
      expect(fixture.preflights()).toBe(1);
      expect(fixture.captures()).toBe(1);
      expect(fixture.resolves()).toBe(1);
      expect(fixture.prepares).toHaveLength(1);
    } finally {
      fixture.unmount();
    }
    expect(fixture.releases).toHaveBeenCalledOnce();
  });

  it('retires the pending gesture when no receipt is available for the moved selection', async () => {
    // The same publication without a usable receipt is an ordinary user
    // selection change: the demand must be canceled, and a later equal-looking
    // readiness cannot revive it.
    const fixture = acceptedSelectionFixture({ armed: false, revision: 4 });
    try {
      fixture.open();
      expect(fixture.preflights()).toBe(1);
      fixture.setSelection({ direction: 'none', end: 0, start: 0 });
      act(() => {
        fixture.fire('selection');
      });
      expect(fixture.consumes).toHaveLength(1);
      expect(screen.queryByRole('menu')).toBeNull();

      fixture.setReady(true);
      act(() => {
        fixture.fire('readiness');
      });
      await act(async () => {
        await Promise.resolve();
      });
      expect(screen.queryByRole('menu')).toBeNull();
      expect(fixture.preflights()).toBe(1);
      expect(fixture.captures()).toBe(1);
      expect(fixture.resolves()).toBe(0);
      expect(fixture.releases).toHaveBeenCalledOnce();
    } finally {
      fixture.unmount();
    }
  });

  it('does not consume a receipt whose before or after side does not match the demand', async () => {
    // Each wrong pair is an ordinary miss, and a miss preserves nothing: the
    // demand retires through the unchanged matcher.
    const cases: ReadonlyArray<
      readonly [string, {
        armBefore?: { direction: 'backward' | 'forward' | 'none'; end: number; start: number };
        armAfter: { direction: 'backward' | 'forward' | 'none'; end: number; start: number };
        publish: { direction: 'backward' | 'forward' | 'none'; end: number; start: number };
      }]
    > = [
      // The lease staged a different caret than the user actually had: the
      // publication is real but not this gesture's, so it must not be consumed.
      [
        'staged before does not match the demand',
        {
          armBefore: { direction: 'none', end: 3, start: 3 },
          armAfter: { direction: 'none', end: 0, start: 0 },
          publish: { direction: 'none', end: 0, start: 0 }
        }
      ],
      // The surface published a different caret than the armed publication
      // staged, so the pair is not the owner's staged transition.
      [
        'published after does not match the staged transition',
        {
          armAfter: { direction: 'none', end: 0, start: 0 },
          publish: { direction: 'none', end: 1, start: 1 }
        }
      ],
      // Direction-only: the SAME endpoints and the SAME bounds, only the
      // direction differs, so this isolates direction matching rather than
      // conflating it with a different or reversed range.
      [
        'published direction does not match the staged transition',
        {
          armAfter: { direction: 'none', end: 4, start: 0 },
          publish: { direction: 'forward', end: 4, start: 0 }
        }
      ]
    ];
    for (const [label, expectation] of cases) {
      const fixture = acceptedSelectionFixture({ revision: 4 });
      try {
        if (expectation.armBefore) fixture.armAcceptedBefore(expectation.armBefore);
        fixture.armAcceptedAfter(expectation.armAfter);
        fixture.open();
        fixture.setSelection(expectation.publish);
        act(() => {
          fixture.fire('selection');
        });
        expect(fixture.consumes, label).toHaveLength(1);
        fixture.setReady(true);
        act(() => {
          fixture.fire('readiness');
        });
        await act(async () => {
          await Promise.resolve();
        });
        expect(screen.queryByRole('menu'), label).toBeNull();
        expect(fixture.resolves(), label).toBe(0);
        expect(fixture.onFailure, label).not.toHaveBeenCalled();
      } finally {
        fixture.unmount();
      }
    }
  });

  it('consumes the receipt when the owner publishes it from inside a running refresh', async () => {
    // The demand first parks on readiness, so pendingOpenRef is installed. A
    // later readiness notification re-runs the evaluation, and the owner
    // publishes its accepted selection from inside that run's preparation,
    // where the Feature's refresh guard is already active. Consuming before the
    // guard is what preserves the gesture; a guard-first implementation drops
    // the receipt and the demand dies at the next comparison.
    const surfaceElement = document.createElement('div');
    surfaceElement.contentEditable = 'true';
    layoutSurface(surfaceElement);
    const target = document.createElement('p');
    target.textContent = 'a | b';
    surfaceElement.append(target);
    document.body.append(surfaceElement);
    const readinessListeners = new Set<() => void>();
    const selectionListeners = new Set<() => void>();
    const state = {
      ready: false,
      selection: { direction: 'none' as const, end: 9, start: 9 },
      value: 'a | b\n--- | ---'
    };
    let preflights = 0;
    let captures = 0;
    let prepares = 0;
    let consumes = 0;
    const onFailure = vi.fn();
    const surface = () => ({
      boundaryElement: surfaceElement,
      element: surfaceElement,
      captureTarget: (): EditorContextMenuTargetLease => {
        captures += 1;
        return {
          release: vi.fn(),
          resolve: () => target,
          consumeAcceptedSelectionTransition: (before, after) => {
            consumes += 1;
            return before.revision === after.revision
              && before.value === after.value
              && 9 === before.selection.start
              && 0 === after.selection.start;
          }
        };
      },
      getContextReadiness: () => state.ready
        ? { status: 'ready' as const }
        : { status: 'pending' as const },
      getSnapshot: () => ({
        revision: 4,
        selection: state.selection,
        value: state.value
      }),
      isEditable: () => true,
      kind: 'visual' as const,
      prepare: () => {
        prepares += 1;
        // The parked demand had no preparation yet, so this first one IS the
        // evaluation the readiness notification started. The owner publishes
        // from inside it, while refresh's guard is active.
        if (1 === prepares) {
          state.selection = { direction: 'none', end: 0, start: 0 };
          for (const listener of [...selectionListeners]) listener();
        }
        return true;
      },
      prepareDemand: () => {
        preflights += 1;
        return true;
      },
      subscribeReadiness: (listener: () => void) => {
        readinessListeners.add(listener);
        return () => readinessListeners.delete(listener);
      },
      subscribeSelection: (listener: () => void) => {
        selectionListeners.add(listener);
        return () => selectionListeners.delete(listener);
      }
    });
    const view = render(
      <EditorContextMenuFeature
        clipboard={clipboard()}
        direction="ltr"
        labels={labels}
        onAction={vi.fn()}
        onFailure={onFailure}
        source={null}
        visual={surface()}
      />
    );
    try {
      fireEvent.pointerDown(target, { button: 2, clientX: 20, clientY: 30 });
      fireEvent.contextMenu(target, { clientX: 20, clientY: 30 });
      // Parked: the pending ref exists, nothing consumed yet.
      expect(screen.queryByRole('menu')).toBeNull();
      expect(preflights).toBe(1);
      expect(captures).toBe(1);
      expect(consumes).toBe(0);
      expect(prepares).toBe(0);

      // The owner becomes ready; its preparation publishes the accepted
      // selection mid-evaluation.
      state.ready = true;
      act(() => {
        for (const listener of [...readinessListeners]) listener();
      });
      await screen.findByRole('menu');
      // Exactly one consumption, no recursive preparation, one menu.
      expect(consumes).toBe(1);
      expect(prepares).toBe(1);
      expect(preflights).toBe(1);
      expect(captures).toBe(1);
      expect(within(document.body).queryAllByRole('menu')).toHaveLength(1);
      expect(onFailure).not.toHaveBeenCalled();
    } finally {
      view.unmount();
    }
  });

  it('does not resurrect the demand when a replacement gesture starts during the receipt call', async () => {
    // A listener runs during the synchronous receipt and begins a NEW gesture at
    // a different anchor. If the old pending object were written back, the menu
    // it eventually opens would sit at the ORIGINAL anchor and would reuse the
    // first lease - so both are asserted, not just "one menu appeared".
    const surfaceElement = document.createElement('div');
    surfaceElement.contentEditable = 'true';
    layoutSurface(surfaceElement);
    const target = document.createElement('p');
    target.textContent = 'a | b';
    surfaceElement.append(target);
    document.body.append(surfaceElement);
    const selectionListeners = new Set<() => void>();
    const readinessListeners = new Set<() => void>();
    const state = {
      ready: false,
      selection: { direction: 'none' as const, end: 9, start: 9 },
      value: 'a | b\n--- | ---'
    };
    const leaseReleases: Array<ReturnType<typeof vi.fn>> = [];
    const preparedPositions: number[] = [];
    let replacing = true;
    const onFailure = vi.fn();
    const view = render(
      <EditorContextMenuFeature
        clipboard={clipboard()}
        direction="ltr"
        labels={labels}
        onAction={vi.fn()}
        onFailure={onFailure}
        source={null}
        visual={{
          boundaryElement: surfaceElement,
          element: surfaceElement,
          captureTarget: (): EditorContextMenuTargetLease => {
            const release = vi.fn();
            leaseReleases.push(release);
            return {
              release,
              resolve: () => target,
              consumeAcceptedSelectionTransition: (before, after) => {
                if (replacing) {
                  replacing = false;
                  // A different anchor means the replacement demand is
                  // distinguishable from the one being consumed.
                  const caret = document.createRange();
                  caret.selectNodeContents(target);
                  const native = window.getSelection();
                  native?.removeAllRanges();
                  native?.addRange(caret);
                  fireEvent.pointerDown(target, {
                    button: 2,
                    clientX: 30,
                    clientY: 30
                  });
                  fireEvent.contextMenu(target, { clientX: 30, clientY: 30 });
                }
                return 9 === before.selection.start && 0 === after.selection.start;
              }
            };
          },
          getContextReadiness: () => state.ready
            ? { status: 'ready' as const }
            : { status: 'pending' as const },
          getSnapshot: () => ({
            revision: 4,
            selection: state.selection,
            value: state.value
          }),
          isEditable: () => true,
          kind: 'visual' as const,
          prepare: (_element, _block, position) => {
            preparedPositions.push(position?.x ?? -1);
            return true;
          },
          subscribeReadiness: (listener: () => void) => {
            readinessListeners.add(listener);
            return () => readinessListeners.delete(listener);
          },
          subscribeSelection: (listener: () => void) => {
            selectionListeners.add(listener);
            return () => selectionListeners.delete(listener);
          }
        }}
      />
    );
    try {
      fireEvent.pointerDown(target, { button: 2, clientX: 20, clientY: 30 });
      fireEvent.contextMenu(target, { clientX: 20, clientY: 30 });
      expect(screen.queryByRole('menu')).toBeNull();
      expect(leaseReleases).toHaveLength(1);

      state.selection = { direction: 'none', end: 0, start: 0 };
      act(() => {
        for (const listener of [...selectionListeners]) listener();
      });
      // The replacement captured its OWN lease, so the first one was retired.
      expect(leaseReleases).toHaveLength(2);
      expect(leaseReleases[0]).toHaveBeenCalled();
      expect(leaseReleases[1]).not.toHaveBeenCalled();

      state.ready = true;
      act(() => {
        for (const listener of [...readinessListeners]) listener();
      });
      const menu = await screen.findByRole('menu');
      // The surviving demand is the replacement: its own anchor, its own lease,
      // and it was prepared from the replacement anchor only.
      expect(leaseReleases[1]).not.toHaveBeenCalled();
      expect(menu).toBeTruthy();
      // The replacement anchor is the one the menu was positioned from: the
      // original x=20 position never reaches preparation.
      expect(preparedPositions).toEqual([30]);
      expect(within(document.body).queryAllByRole('menu')).toHaveLength(1);
      expect(onFailure).not.toHaveBeenCalled();
    } finally {
      view.unmount();
    }
  });

  it('requires the surface to still report the exact snapshot the receipt authenticated', async () => {
    // The receipt authenticates one specific after snapshot. If the surface has
    // moved again by the time the Feature re-reads it - another listener wrote
    // inside the same synchronous publication - the authenticated pair no
    // longer describes the surface and nothing may be copied.
    const surfaceElement = document.createElement('div');
    surfaceElement.contentEditable = 'true';
    layoutSurface(surfaceElement);
    const target = document.createElement('p');
    target.textContent = 'a | b';
    surfaceElement.append(target);
    document.body.append(surfaceElement);
    const selectionListeners = new Set<() => void>();
    const readinessListeners = new Set<() => void>();
    const state = {
      ready: false,
      selection: { direction: 'none' as const, end: 9, start: 9 },
      value: 'a | b\n--- | ---'
    };
    let consumes = 0;
    let resolves = 0;
    const onFailure = vi.fn();
    const view = render(
      <EditorContextMenuFeature
        clipboard={clipboard()}
        direction="ltr"
        labels={labels}
        onAction={vi.fn()}
        onFailure={onFailure}
        source={null}
        visual={{
          boundaryElement: surfaceElement,
          element: surfaceElement,
          captureTarget: (): EditorContextMenuTargetLease => ({
            release: vi.fn(),
            resolve: () => {
              resolves += 1;
              return target;
            },
            consumeAcceptedSelectionTransition: (before, after) => {
              consumes += 1;
              if (9 !== before.selection.start || 0 !== after.selection.start) {
                return false;
              }
              // Successfully authenticated - and then another listener writes
              // a different selection before the Feature re-reads the surface.
              state.selection = { direction: 'none', end: 2, start: 2 };
              return true;
            }
          }),
          getContextReadiness: () => state.ready
            ? { status: 'ready' as const }
            : { status: 'pending' as const },
          getSnapshot: () => ({
            revision: 4,
            selection: state.selection,
            value: state.value
          }),
          isEditable: () => true,
          kind: 'visual' as const,
          subscribeReadiness: (listener: () => void) => {
            readinessListeners.add(listener);
            return () => readinessListeners.delete(listener);
          },
          subscribeSelection: (listener: () => void) => {
            selectionListeners.add(listener);
            return () => selectionListeners.delete(listener);
          }
        }}
      />
    );
    try {
      fireEvent.pointerDown(target, { button: 2, clientX: 20, clientY: 30 });
      fireEvent.contextMenu(target, { clientX: 20, clientY: 30 });
      state.selection = { direction: 'none', end: 0, start: 0 };
      act(() => {
        for (const listener of [...selectionListeners]) listener();
      });
      // The receipt reported success, so it was called; but the surface no
      // longer reports the authenticated selection, so the demand was not
      // rewritten and must not complete on it.
      expect(consumes).toBe(1);
      state.ready = true;
      act(() => {
        for (const listener of [...readinessListeners]) listener();
      });
      await act(async () => {
        await Promise.resolve();
      });
      expect(screen.queryByRole('menu')).toBeNull();
      expect(resolves).toBe(0);
      expect(onFailure).not.toHaveBeenCalled();
    } finally {
      view.unmount();
    }
  });

  it('does not consume a second or late accepted transition for the same demand', async () => {
    // One-shot evidence: after the receipt was used, a repeated publication,
    // an A -> B -> A return, and a post-ready notification are all ordinary
    // changes and cannot be preserved by the same capability.
    const fixture = acceptedSelectionFixture({ revision: 4 });
    try {
      fixture.open();
      fixture.setSelection({ direction: 'none', end: 0, start: 0 });
      act(() => {
        fixture.fire('selection');
      });
      expect(fixture.consumes).toHaveLength(1);
      expect(fixture.resolves()).toBe(0);

      // A second identical publication is not a receipt.
      act(() => {
        fixture.fire('selection');
      });
      expect(fixture.consumes).toHaveLength(2);
      expect(screen.queryByRole('menu')).toBeNull();

      // A real user change after that is still a user change.
      fixture.setSelection({ direction: 'none', end: 5, start: 2 });
      act(() => {
        fixture.fire('selection');
      });
      expect(screen.queryByRole('menu')).toBeNull();
      fixture.setReady(true);
      act(() => {
        fixture.fire('readiness');
      });
      await act(async () => {
        await Promise.resolve();
      });
      expect(screen.queryByRole('menu')).toBeNull();
      expect(fixture.resolves()).toBe(0);
      expect(fixture.onFailure).not.toHaveBeenCalled();
    } finally {
      fixture.unmount();
    }
  });

  it('does not consume a receipt when the demand has no known revision to compare', async () => {
    // `revision` is optional on the surface snapshot, but a receipt needs the
    // known canonical revision it published against. An absent revision must
    // not be treated as undefined === undefined.
    const fixture = acceptedSelectionFixture({ revision: undefined });
    try {
      fixture.open();
      fixture.setSelection({ direction: 'none', end: 0, start: 0 });
      act(() => {
        fixture.fire('selection');
      });
      expect(fixture.consumes).toHaveLength(0);
      fixture.setReady(true);
      act(() => {
        fixture.fire('readiness');
      });
      await act(async () => {
        await Promise.resolve();
      });
      expect(screen.queryByRole('menu')).toBeNull();
      expect(fixture.resolves()).toBe(0);
    } finally {
      fixture.unmount();
    }
  });

  it('never consumes a receipt for a visible menu or an in-flight action', async () => {
    // The receipt is evidence for one *pending* demand. A visible menu is
    // already authenticated, and a demand that arrives while an earlier action
    // still owns its resources must not be preserved by it either.
    const fixture = acceptedSelectionFixture({ revision: 4 });
    const actionSurface = document.createElement('div');
    actionSurface.contentEditable = 'true';
    layoutSurface(actionSurface);
    const actionTarget = document.createElement('p');
    actionTarget.textContent = 'selected';
    actionSurface.append(actionTarget);
    document.body.append(actionSurface);
    const actionSelectionListeners = new Set<() => void>();
    const actionConsumes: unknown[] = [];
    const actionState = {
      ready: true,
      selection: { direction: 'none' as const, end: 8, start: 0 },
      value: 'selected'
    };
    const actionView = render(
      <EditorContextMenuFeature
        clipboard={clipboard()}
        direction="ltr"
        labels={labels}
        // Never settles: the action keeps owning its resources.
        onAction={() => new Promise<void>(() => undefined)}
        onFailure={vi.fn()}
        source={null}
        visual={{
          boundaryElement: actionSurface,
          element: actionSurface,
          captureTarget: (): EditorContextMenuTargetLease => ({
            release: vi.fn(),
            resolve: () => actionTarget,
            consumeAcceptedSelectionTransition: (before, after) => {
              actionConsumes.push({ before, after });
              return true;
            }
          }),
          getContextReadiness: () => actionState.ready
            ? { status: 'ready' as const }
            : { status: 'pending' as const },
          getSnapshot: () => ({
            revision: 4,
            selection: actionState.selection,
            value: actionState.value
          }),
          isEditable: () => true,
          kind: 'visual' as const,
          subscribeSelection: (listener: () => void) => {
            actionSelectionListeners.add(listener);
            return () => actionSelectionListeners.delete(listener);
          }
        }}
      />
    );
    try {
      fixture.open();
      fixture.setReady(true);
      act(() => {
        fixture.fire('readiness');
      });
      await screen.findByRole('menu');
      // The menu is now VISIBLE: the demand is no longer pending.
      fixture.setSelection({ direction: 'none', end: 0, start: 0 });
      act(() => {
        fixture.fire('selection');
      });
      expect(fixture.consumes).toHaveLength(0);
      fixture.unmount();

      // Start a real action, then open a NEW gesture that parks on readiness
      // while that action is still in flight. A publication at that point must
      // not be consumed for the new demand.
      fireEvent.pointerDown(actionTarget, { button: 2, clientX: 20, clientY: 30 });
      fireEvent.contextMenu(actionTarget, { clientX: 20, clientY: 30 });
      const actionMenu = await screen.findByRole('menu');
      fireEvent.click(
        within(actionMenu).getByRole('menuitem', { name: labels.paste })
      );
      expect(actionConsumes).toHaveLength(0);

      actionState.ready = false;
      fireEvent.pointerDown(actionTarget, { button: 2, clientX: 20, clientY: 30 });
      fireEvent.contextMenu(actionTarget, { clientX: 20, clientY: 30 });
      expect(screen.queryByRole('menu')).toBeNull();

      // The publication arrives while the earlier action still owns its
      // resources: the new pending demand is not preserved.
      actionState.selection = { direction: 'none', end: 0, start: 0 };
      act(() => {
        for (const listener of [...actionSelectionListeners]) listener();
      });
      expect(actionConsumes).toHaveLength(0);

      // Even once readiness allows a read, the demand was retired: it must not
      // open a menu for a selection it never captured.
      actionState.ready = true;
      act(() => {
        for (const listener of [...actionSelectionListeners]) listener();
      });
      await act(async () => {
        await Promise.resolve();
      });
      expect(screen.queryByRole('menu')).toBeNull();
    } finally {
      actionView.unmount();
    }
  });

  it('does not restore a canceled demand when the receipt arrives during the publication', async () => {
    // The owner's synchronous publication runs a listener that cancels the
    // demand. The receipt reports success, but the demand it belonged to is
    // already gone, so it must not be written back.
    const surfaceElement = document.createElement('div');
    surfaceElement.contentEditable = 'true';
    layoutSurface(surfaceElement);
    const target = document.createElement('p');
    target.textContent = 'a | b';
    surfaceElement.append(target);
    document.body.append(surfaceElement);
    const selectionListeners = new Set<() => void>();
    const state = {
      selection: { direction: 'none' as const, end: 9, start: 9 },
      value: 'a | b\n--- | ---'
    };
    let consumedDuringCall = false;
    const onFailure = vi.fn();
    const view = render(
      <EditorContextMenuFeature
        clipboard={clipboard()}
        direction="ltr"
        labels={labels}
        onAction={vi.fn()}
        onFailure={onFailure}
        source={null}
        visual={{
          boundaryElement: surfaceElement,
          element: surfaceElement,
          captureTarget: (): EditorContextMenuTargetLease => ({
            release: vi.fn(),
            resolve: () => target,
            consumeAcceptedSelectionTransition: (before, after) => {
              fireEvent.keyDown(document, { key: 'Escape' });
              consumedDuringCall = true;
              return 9 === before.selection.start && 0 === after.selection.start;
            }
          }),
          getContextReadiness: () => ({ status: 'pending' as const }),
          getSnapshot: () => ({
            revision: 4,
            selection: state.selection,
            value: state.value
          }),
          isEditable: () => true,
          kind: 'visual' as const,
          subscribeSelection: (listener: () => void) => {
            selectionListeners.add(listener);
            return () => selectionListeners.delete(listener);
          }
        }}
      />
    );
    try {
      fireEvent.pointerDown(target, { button: 2, clientX: 20, clientY: 30 });
      fireEvent.contextMenu(target, { clientX: 20, clientY: 30 });
      state.selection = { direction: 'none', end: 0, start: 0 };
      act(() => {
        for (const listener of [...selectionListeners]) listener();
      });
      expect(consumedDuringCall).toBe(true);
      await act(async () => {
        await Promise.resolve();
      });
      expect(screen.queryByRole('menu')).toBeNull();
      expect(onFailure).not.toHaveBeenCalled();
    } finally {
      view.unmount();
    }
  });

  it('rebuilds a parked demand when readiness is notified after the transfer settles', async () => {
    const source = document.createElement('div');
    source.contentEditable = 'true';
    layoutSurface(source);
    document.body.append(source);
    const readinessListeners = new Set<() => void>();
    let ready = false;
    const onFailure = vi.fn();
    render(
      <EditorContextMenuFeature
        clipboard={clipboard()}
        direction="ltr"
        labels={labels}
        onAction={vi.fn()}
        onFailure={onFailure}
        source={{
          boundaryElement: source,
          element: source,
          getContextReadiness: () =>
            ready ? { status: 'ready' as const } : { status: 'pending' as const },
          getSnapshot: () => ({
            selection: { direction: 'none', end: 0, start: 0 },
            value: 'alpha beta'
          }),
          isEditable: () => true,
          kind: 'source',
          subscribeReadiness: (listener) => {
            readinessListeners.add(listener);
            return () => readinessListeners.delete(listener);
          }
        }}
        visual={null}
      />
    );

    fireEvent.contextMenu(source, { clientX: 20, clientY: 30 });
    // The demand parks because the surface is not ready yet.
    expect(screen.queryByRole('menu')).toBeNull();

    // A settle notification alone must not open the menu while still pending.
    for (const listener of readinessListeners) listener();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(onFailure).not.toHaveBeenCalled();

    // The transfer settles, the owner becomes ready and notifies: the parked
    // demand is rebuilt against the newly accepted state.
    ready = true;
    for (const listener of readinessListeners) listener();
    expect(await screen.findByRole('menu')).toBeTruthy();
    expect(onFailure).not.toHaveBeenCalled();
  });

  it('retires a parked demand whose lease cannot authenticate the block, without borrowing the old element', async () => {
    const source = document.createElement('div');
    source.contentEditable = 'true';
    layoutSurface(source);
    document.body.append(source);
    const target = document.createElement('p');
    target.textContent = 'target';
    source.append(target);
    const readinessListeners = new Set<() => void>();
    let ready = false;
    const onFailure = vi.fn();
    const releasePending = vi.fn();
    const targetRelease = vi.fn();
    const prepared = vi.fn(() => true);
    const contextTargets: Array<Element | null> = [];
    render(
      <EditorContextMenuFeature
        clipboard={clipboard()}
        direction="ltr"
        labels={labels}
        onAction={vi.fn()}
        onFailure={onFailure}
        source={{
          boundaryElement: source,
          element: source,
          // The owner accepted the gesture, but its accepted source no longer
          // contains that block: resolution is a real null, not an old-element
          // fallback.
          captureTarget: () => ({ release: targetRelease, resolve: () => null }),
          getActionContext: (contextTarget) => {
            contextTargets.push(contextTarget);
            return null;
          },
          getContextReadiness: () =>
            ready ? { status: 'ready' as const } : { status: 'pending' as const },
          getSnapshot: () => ({
            selection: { direction: 'none', end: 0, start: 0 },
            value: 'alpha beta'
          }),
          isEditable: () => true,
          kind: 'source',
          prepare: prepared,
          releasePending,
          subscribeReadiness: (listener) => {
            readinessListeners.add(listener);
            return () => readinessListeners.delete(listener);
          }
        }}
        visual={null}
      />
    );

    fireEvent.contextMenu(target, { clientX: 20, clientY: 30 });
    expect(screen.queryByRole('menu')).toBeNull();
    // The accepted commit retires the element the demand was anchored to.
    target.remove();
    ready = true;
    for (const listener of readinessListeners) listener();
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByRole('menu')).toBeNull();
    // Nothing was prepared or contextualized against the retired element, and
    // a rejection the user cannot act on is not a failure worth reporting.
    expect(prepared).not.toHaveBeenCalled();
    expect(contextTargets).toHaveLength(0);
    expect(onFailure).not.toHaveBeenCalled();
    expect(releasePending).toHaveBeenCalledWith('cancelled');
    expect(targetRelease).toHaveBeenCalledOnce();
    // A late notification cannot revive the retired witness.
    for (const listener of readinessListeners) listener();
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(prepared).not.toHaveBeenCalled();
  });

  it('rebuilds a visible ready menu only from the element the lease authenticates', async () => {
    // An accepted render can replace the block DOM while an already-open menu
    // is on screen, and neither the canonical value, the selection, the
    // revision, the surface generation, nor the provider identity changes. The
    // rebuild must therefore re-ask the owner through this demand's own lease:
    // the element the user opened the menu on is retired, and reading it again
    // would describe a block the owner no longer stands behind.
    const surface = document.createElement('div');
    surface.contentEditable = 'true';
    layoutSurface(surface);
    const oldTarget = document.createElement('p');
    oldTarget.textContent = 'alpha';
    surface.append(oldTarget);
    document.body.append(surface);
    const identity = {};
    const readinessListeners = new Set<() => void>();
    let live: Element | null = oldTarget;
    let preflights = 0;
    let captures = 0;
    const released = vi.fn();
    const preparedTargets: Array<Element | null | undefined> = [];
    const contextTargets: Array<Element | null> = [];
    const buildSurface = () => ({
      boundaryElement: surface,
      element: surface,
      captureTarget: (_target: Element | null) => {
        captures += 1;
        return { release: released, resolve: () => live };
      },
      getActionContext: (target: Element | null) => {
        contextTargets.push(target);
        return null;
      },
      getBlockIndex: () => null,
      getContextReadiness: () => ({ status: 'ready' as const }),
      getSnapshot: () => ({
        revision: 1,
        selection: { direction: 'none' as const, end: 0, start: 0 },
        value: 'alpha'
      }),
      identity,
      isEditable: () => true,
      kind: 'visual' as const,
      prepare: (target?: Element | null) => {
        preparedTargets.push(target);
        return true;
      },
      prepareDemand: () => {
        preflights += 1;
        return true;
      },
      subscribeReadiness: (listener: () => void) => {
        readinessListeners.add(listener);
        return () => readinessListeners.delete(listener);
      }
    });
    const view = render(
      <EditorContextMenuFeature
        clipboard={clipboard()}
        direction="ltr"
        labels={labels}
        onAction={vi.fn()}
        onFailure={vi.fn()}
        source={null}
        visual={buildSurface()}
      />
    );
    fireEvent.contextMenu(oldTarget, { clientX: 20, clientY: 30 });
    const firstMenu = await screen.findByRole('menu');
    const anchorLeft = firstMenu
      .closest<HTMLElement>('[data-easymde-context-menu="true"]')
      ?.style.left;
    expect(preflights).toBe(1);
    expect(captures).toBe(1);
    expect(preparedTargets).toEqual([oldTarget]);
    expect(contextTargets).toEqual([oldTarget]);
    const preparesBefore = preparedTargets.length;
    const contextsBefore = contextTargets.length;

    // The accepted render replaces the pointed block. Every canonical field
    // the demand captured is unchanged, so nothing but the lease can tell the
    // retired element from the live one.
    oldTarget.remove();
    const accepted = document.createElement('p');
    accepted.textContent = 'alpha';
    surface.append(accepted);
    live = accepted;
    act(() => {
      for (const listener of [...readinessListeners]) listener();
    });

    await waitFor(() =>
      expect(contextTargets[contextTargets.length - 1]).toBe(accepted)
    );
    // The rebuild describes ONLY the authenticated element: the retired node
    // is never handed to the context builder again.
    expect(contextTargets.slice(contextsBefore)).toEqual([accepted]);
    expect(preparedTargets.slice(preparesBefore)).toEqual([accepted]);
    // One gesture: no second preflight, no second capture, no early release.
    expect(preflights).toBe(1);
    expect(captures).toBe(1);
    expect(released).not.toHaveBeenCalled();
    expect(screen.getByRole('menu')).toBeTruthy();
    expect(
      screen
        .getByRole('menu')
        .closest<HTMLElement>('[data-easymde-context-menu="true"]')
        ?.style.left
    ).toBe(anchorLeft);

    // Dismissal retires the same witness exactly once.
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(released).toHaveBeenCalledOnce();
    view.unmount();
  });

  it('keeps a visible ready menu off the retired context while readiness is pending again', async () => {
    // The same ready menu can be told that the owner is re-materializing its
    // inventory. While that answer is pending the demand must not resolve the
    // lease, prepare a selection, or rebuild a link/image/generated context
    // from the previous inventory; it keeps the menu the user already has.
    const surface = document.createElement('div');
    surface.contentEditable = 'true';
    layoutSurface(surface);
    const target = document.createElement('p');
    target.textContent = 'alpha';
    surface.append(target);
    document.body.append(surface);
    const identity = {};
    const readinessListeners = new Set<() => void>();
    let ready = true;
    let live: Element | null = target;
    const preparedTargets: Array<Element | null | undefined> = [];
    const contextTargets: Array<Element | null> = [];
    const buildSurface = () => ({
      boundaryElement: surface,
      element: surface,
      captureTarget: (_target: Element | null) => ({
        release: vi.fn(),
        resolve: () => live
      }),
      getActionContext: (element: Element | null) => {
        contextTargets.push(element);
        return { link: { href: 'https://example.test/docs' } };
      },
      getBlockIndex: () => null,
      getContextReadiness: () =>
        ready ? { status: 'ready' as const } : { status: 'pending' as const },
      getSnapshot: () => ({
        revision: 1,
        selection: { direction: 'none' as const, end: 0, start: 0 },
        value: 'alpha'
      }),
      identity,
      isEditable: () => true,
      kind: 'visual' as const,
      prepare: (element?: Element | null) => {
        preparedTargets.push(element);
        return true;
      },
      subscribeReadiness: (listener: () => void) => {
        readinessListeners.add(listener);
        return () => readinessListeners.delete(listener);
      }
    });
    const view = render(
      <EditorContextMenuFeature
        clipboard={clipboard()}
        direction="ltr"
        labels={labels}
        onAction={vi.fn()}
        onFailure={vi.fn()}
        source={null}
        visual={buildSurface()}
      />
    );
    fireEvent.contextMenu(target, { clientX: 20, clientY: 30 });
    const firstMenu = await screen.findByRole('menu');
    expect(screen.getByRole('menuitem', { name: labels.copyLinkAddress })).toBeTruthy();
    const anchorLeft = firstMenu
      .closest<HTMLElement>('[data-easymde-context-menu="true"]')
      ?.style.left;
    const preparesBefore = preparedTargets.length;
    const contextsBefore = contextTargets.length;

    ready = false;
    act(() => {
      for (const listener of [...readinessListeners]) listener();
    });
    expect(screen.getByRole('menu')).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: labels.copyLinkAddress })).toBeNull();
    expect(preparedTargets).toHaveLength(preparesBefore);
    expect(contextTargets).toHaveLength(contextsBefore);
    expect(
      screen
        .getByRole('menu')
        .closest<HTMLElement>('[data-easymde-context-menu="true"]')
        ?.style.left
    ).toBe(anchorLeft);

    // The accepted inventory then arrives with a live element: the retained
    // menu rebuilds from it, still the same demand and anchor.
    const accepted = document.createElement('p');
    accepted.textContent = 'alpha';
    target.remove();
    surface.append(accepted);
    live = accepted;
    ready = true;
    act(() => {
      for (const listener of [...readinessListeners]) listener();
    });
    await waitFor(() =>
      expect(screen.getByRole('menuitem', { name: labels.copyLinkAddress })).toBeTruthy()
    );
    expect(contextTargets[contextTargets.length - 1]).toBe(accepted);
    expect(preparedTargets[preparedTargets.length - 1]).toBe(accepted);
    expect(
      screen
        .getByRole('menu')
        .closest<HTMLElement>('[data-easymde-context-menu="true"]')
        ?.style.left
    ).toBe(anchorLeft);
    view.unmount();
  });

  it('retires a visible ready menu when the lease can no longer authenticate the block', async () => {
    // A null resolution is the owner saying the demanded block is gone. The
    // demand ends silently: no menu for a different block, no action against
    // the retired element, and no failure the user could act on.
    const surface = document.createElement('div');
    surface.contentEditable = 'true';
    layoutSurface(surface);
    const target = document.createElement('p');
    target.textContent = 'alpha';
    surface.append(target);
    document.body.append(surface);
    const identity = {};
    const readinessListeners = new Set<() => void>();
    let live: Element | null = target;
    const released = vi.fn();
    const contextTargets: Array<Element | null> = [];
    const onAction = vi.fn();
    const onFailure = vi.fn();
    const buildSurface = () => ({
      boundaryElement: surface,
      element: surface,
      captureTarget: (_target: Element | null) => ({
        release: released,
        resolve: () => live
      }),
      getActionContext: (element: Element | null) => {
        contextTargets.push(element);
        return null;
      },
      getBlockIndex: () => null,
      getContextReadiness: () => ({ status: 'ready' as const }),
      getSnapshot: () => ({
        revision: 1,
        selection: { direction: 'none' as const, end: 0, start: 0 },
        value: 'alpha'
      }),
      identity,
      isEditable: () => true,
      kind: 'visual' as const,
      subscribeReadiness: (listener: () => void) => {
        readinessListeners.add(listener);
        return () => readinessListeners.delete(listener);
      }
    });
    const view = render(
      <EditorContextMenuFeature
        clipboard={clipboard()}
        direction="ltr"
        labels={labels}
        onAction={onAction}
        onFailure={onFailure}
        source={null}
        visual={buildSurface()}
      />
    );
    fireEvent.contextMenu(target, { clientX: 20, clientY: 30 });
    await screen.findByRole('menu');
    expect(contextTargets).toEqual([target]);

    live = null;
    act(() => {
      for (const listener of [...readinessListeners]) listener();
    });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(released).toHaveBeenCalledOnce();
    // The retired element is never handed to the context builder again.
    expect(contextTargets).toEqual([target]);
    expect(onAction).not.toHaveBeenCalled();
    expect(onFailure).not.toHaveBeenCalled();

    // A later notification cannot resolve the released demand or reopen it.
    act(() => {
      for (const listener of [...readinessListeners]) listener();
    });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(released).toHaveBeenCalledOnce();
    view.unmount();
  });

  it('retires a visible demand and its target capability when the owner removes the surface', async () => {
    const surface = document.createElement('div');
    surface.contentEditable = 'true';
    layoutSurface(surface);
    const target = document.createElement('p');
    target.textContent = 'alpha';
    surface.append(target);
    document.body.append(surface);
    const released = vi.fn();
    const buildSurface = () => ({
      boundaryElement: surface,
      element: surface,
      captureTarget: (_target: Element | null) => ({
        release: released,
        resolve: () => target
      }),
      getBlockIndex: () => null,
      getContextReadiness: () => ({ status: 'ready' as const }),
      getSnapshot: () => ({
        revision: 1,
        selection: { direction: 'none' as const, end: 0, start: 0 },
        value: 'alpha'
      }),
      isEditable: () => true,
      kind: 'visual' as const
    });
    const onFailure = vi.fn();
    const view = render(
      <EditorContextMenuFeature
        clipboard={clipboard()}
        direction="ltr"
        labels={labels}
        onAction={vi.fn()}
        onFailure={onFailure}
        source={null}
        visual={buildSurface()}
      />
    );
    fireEvent.contextMenu(target, { clientX: 20, clientY: 30 });
    await screen.findByRole('menu');

    // The owner leaves the editing mode: the surface this demand was opened on
    // is gone, so the visible demand and its witness retire once.
    view.rerender(
      <EditorContextMenuFeature
        clipboard={clipboard()}
        direction="ltr"
        labels={labels}
        onAction={vi.fn()}
        onFailure={onFailure}
        source={null}
        visual={null}
      />
    );
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(released).toHaveBeenCalledOnce();
    expect(onFailure).not.toHaveBeenCalled();

    // Unmounting afterwards must not release the same capability again.
    view.unmount();
    expect(released).toHaveBeenCalledOnce();
  });

  it('keeps a visible menu while a refreshed inventory is still pending', async () => {
    const source = document.createElement('div');
    source.contentEditable = 'true';
    layoutSurface(source);
    document.body.append(source);
    const port = clipboard();
    const readinessListeners = new Set<() => void>();
    let ready = true;
    const link = { href: 'https://example.test/' };
    const buildSource = () => ({
      boundaryElement: source,
      element: source,
      getActionContext: () => ({ link }),
      getBlockIndex: () => null,
      getContextReadiness: () =>
        ready ? { status: 'ready' as const } : { status: 'pending' as const },
      getSnapshot: () => ({
        selection: { direction: 'none' as const, end: 0, start: 0 },
        value: 'alpha'
      }),
      isEditable: () => true,
      kind: 'source' as const,
      subscribeReadiness: (listener: () => void) => {
        readinessListeners.add(listener);
        return () => readinessListeners.delete(listener);
      }
    });
    const view = render(
      <EditorContextMenuFeature
        clipboard={port}
        direction="ltr"
        labels={labels}
        onAction={vi.fn()}
        onFailure={vi.fn()}
        source={buildSource()}
        visual={null}
      />
    );

    fireEvent.contextMenu(source, { clientX: 20, clientY: 30 });
    const firstMenu = await screen.findByRole('menu');
    expect(screen.getByRole('menuitem', { name: 'Copy link address' })).toBeTruthy();
    const anchor = firstMenu
      .closest<HTMLElement>('[data-easymde-context-menu="true"]')
      ?.style.left;

    // A benign owner replacement rebuilds the same demand while the refreshed
    // inventory is not ready yet: the visible menu must survive that
    // transition instead of dismissing itself.
    ready = false;
    view.rerender(
      <EditorContextMenuFeature
        clipboard={port}
        direction="ltr"
        labels={labels}
        onAction={vi.fn()}
        onFailure={vi.fn()}
        source={buildSource()}
        visual={null}
      />
    );
    const retainedMenu = screen.getByRole('menu');
    expect(retainedMenu).toBeTruthy();
    expect(
      retainedMenu.closest<HTMLElement>('[data-easymde-context-menu="true"]')
        ?.style.left
    ).toBe(anchor);
    // The retired inventory's own context is not presented while the new one
    // is still building.
    expect(screen.queryByRole('menuitem', { name: 'Copy link address' })).toBeNull();

    // The refreshed inventory completes: the menu replaces its context and
    // stays anchored where the user opened it.
    ready = true;
    for (const listener of readinessListeners) listener();
    expect(await screen.findByRole('menuitem', { name: 'Copy link address' })).toBeTruthy();
    expect(screen.getByRole('menu')).toBeTruthy();
  });

  it('dismisses a retained menu once the document no longer matches the demand', async () => {
    const retained = retainedPendingMenu();
    await retained.retain();

    // A real document change is not a benign refresh: the retained menu no
    // longer describes what the user pointed at and must dismiss.
    retained.state.value = 'beta';
    retained.fire('snapshot');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });

  it('dismisses a retained menu on a selection-only change', async () => {
    const retained = retainedPendingMenu();
    await retained.retain();

    // A selection-only change publishes through the selection subscription,
    // never through the text snapshot: the retained menu must still be
    // validated against it instead of keeping a selection the user no longer
    // has.
    retained.state.selection = { direction: 'none', end: 5, start: 2 };
    retained.fire('selection');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });

  it('does not resurrect a retained menu when a selection change returns to the captured one', async () => {
    const retained = retainedPendingMenu();
    await retained.retain();

    retained.state.selection = { direction: 'none', end: 5, start: 2 };
    retained.fire('selection');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());

    // Back at the captured selection before the refreshed inventory resolves:
    // the retired demand must not match again and reopen.
    act(() => {
      retained.state.selection = { direction: 'none', end: 0, start: 0 };
      retained.state.ready = true;
      retained.fire('selection');
      retained.fire('readiness');
    });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('does not resurrect a retained menu when the selection returns in the same batch', async () => {
    const retained = retainedPendingMenu();
    retained.state.link = { href: 'https://example.test/' };
    await retained.retain();

    // Away and back inside one batch, with no render between the two
    // notifications: retiring the demand has to take effect synchronously, or
    // the second notification re-reads the retired state, re-matches its
    // captured snapshot and brings the menu back.
    act(() => {
      retained.state.selection = { direction: 'none', end: 5, start: 2 };
      retained.fire('selection');
      retained.state.selection = { direction: 'none', end: 0, start: 0 };
      retained.fire('selection');
    });
    expect(screen.queryByRole('menu')).toBeNull();

    // The refreshed inventory resolving later must not present the retired
    // context either.
    act(() => {
      retained.state.ready = true;
      retained.fire('readiness');
      retained.fire('selection');
    });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(
      screen.queryByRole('menuitem', { name: 'Copy link address' })
    ).toBeNull();
  });

  it('closes a menu when the same visual element receives a new runtime generation', async () => {
    const visual = document.createElement('div');
    visual.contentEditable = 'true';
    layoutSurface(visual);
    document.body.append(visual);
    layoutSurface(visual);
    const restoreFocus = vi.fn();
    const firstIdentity = {};
    const secondIdentity = {};
    const props = {
      clipboard: clipboard(),
      direction: 'ltr' as const,
      labels,
      onAction: vi.fn(),
      onFailure: vi.fn(),
      source: null,
      visual: {
          boundaryElement: visual,
        element: visual,
        generation: 1,
        getSnapshot: () => ({
          selection: { direction: 'none' as const, end: 0, start: 0 },
          value: 'alpha'
        }),
        identity: firstIdentity,
        isEditable: () => true,
        kind: 'visual' as const,
        restoreFocus
      }
    };
    const view = render(<EditorContextMenuFeature {...props} />);
    fireEvent.contextMenu(visual, { clientX: 4, clientY: 5 });
    expect(await screen.findByRole('menu')).toBeTruthy();
    view.rerender(
      <EditorContextMenuFeature
        {...props}
        visual={{ ...props.visual, generation: 2, identity: secondIdentity }}
      />
    );
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(restoreFocus).toHaveBeenCalledOnce();
  });
});
