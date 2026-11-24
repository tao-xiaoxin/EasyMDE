// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMermaidContentBoxLease } from './wechat-mermaid-content-box';

describe('Mermaid content-box observation', () => {
  let deliver: ResizeObserverCallback;
  let observed: Element[];
  let disconnect: ReturnType<typeof vi.fn>;

  function installObserver(): void {
    observed = [];
    disconnect = vi.fn();
    class Observer {
      constructor(callback: ResizeObserverCallback) { deliver = callback; }
      observe(element: Element): void { observed.push(element); }
      disconnect = disconnect;
      unobserve(): void { }
    }
    vi.stubGlobal('ResizeObserver', Observer);
  }

  function entry(target: Element, width: number, height: number): ResizeObserverEntry {
    return { target, contentRect: { width, height } } as ResizeObserverEntry;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('binds fractional content boxes to their exact owner and invalidates on a later change', async () => {
    installObserver();
    const root = document.createElement('article');
    root.innerHTML = '<div class="easymde-mermaid" data-easymde-mermaid-layout="timeline"></div>';
    const owner = root.firstElementChild as Element;
    const lease = createMermaidContentBoxLease(root);
    expect(observed).toEqual([owner]);
    expect(lease.isCurrent()).toBe(false);
    deliver([entry(owner, 481.5, 510.71875)], {} as ResizeObserver);
    await lease.ready;
    expect(lease.get(owner)).toEqual({ width: 481.5, height: 510.71875 });
    expect(lease.get(owner.cloneNode() as Element)).toBeNull();
    deliver([entry(owner, 481.5, 510.734375)], {} as ResizeObserver);
    expect(lease.isCurrent()).toBe(false);
    expect(lease.get(owner)).toBeNull();
    lease.cleanup();
    lease.cleanup();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('fails invalid observations and ignores callbacks after cancellation', async () => {
    installObserver();
    const root = document.createElement('article');
    root.innerHTML = '<div class="easymde-mermaid" data-easymde-mermaid-layout="sequence"></div>';
    const owner = root.firstElementChild as Element;
    const invalid = createMermaidContentBoxLease(root);
    deliver([entry(owner, 100, Number.NaN)], {} as ResizeObserver);
    await expect(invalid.ready).rejects.toThrow('wechat-mermaid-content-box-unavailable');
    invalid.cleanup();
    const controller = new AbortController();
    const cancelled = createMermaidContentBoxLease(root, controller.signal);
    controller.abort();
    await expect(cancelled.ready).rejects.toThrow('wechat-background-preparation-cancelled');
    deliver([entry(owner, 100, 100)], {} as ResizeObserver);
    expect(cancelled.isCurrent()).toBe(false);
  });

  it('waits for every owner and retains the completed lease until explicitly released', async () => {
    installObserver();
    const root = document.createElement('article');
    root.innerHTML = '<div class="easymde-mermaid" data-easymde-mermaid-layout="sequence"></div>' +
      '<div class="easymde-mermaid" data-easymde-mermaid-layout="timeline"></div>';
    const first = root.children[0] as Element;
    const second = root.children[1] as Element;
    const controller = new AbortController();
    const lease = createMermaidContentBoxLease(root, controller.signal);
    let ready = false;
    void lease.ready.then(() => { ready = true; });
    expect(observed).toEqual([first, second]);
    deliver([entry(first, 481.5, 475)], {} as ResizeObserver);
    await Promise.resolve();
    expect(ready).toBe(false);
    deliver([entry(second, 481.5, 510.71875)], {} as ResizeObserver);
    await lease.ready;
    lease.retain();
    controller.abort();
    expect(lease.isCurrent()).toBe(true);
    expect(lease.get(second)).toEqual({ width: 481.5, height: 510.71875 });
    second.remove();
    expect(lease.isCurrent()).toBe(false);
    lease.cleanup();
    deliver([entry(second, 481.5, 510.71875)], {} as ResizeObserver);
    expect(lease.isCurrent()).toBe(false);
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it('fails when observation is unavailable or does not arrive', async () => {
    const root = document.createElement('article');
    root.innerHTML = '<div class="easymde-mermaid" data-easymde-mermaid-layout="gantt"></div>';
    vi.stubGlobal('ResizeObserver', undefined);
    const unavailable = createMermaidContentBoxLease(root);
    await expect(unavailable.ready).rejects.toThrow('wechat-mermaid-content-box-unavailable');
    unavailable.cleanup();
    installObserver();
    vi.useFakeTimers();
    const timedOut = createMermaidContentBoxLease(root);
    const result = expect(timedOut.ready).rejects.toThrow('wechat-preview-measurement-resource-timeout');
    await vi.runAllTimersAsync();
    await result;
    timedOut.cleanup();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
