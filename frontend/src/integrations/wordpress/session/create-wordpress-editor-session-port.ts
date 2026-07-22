import type {
  EditorSessionPort,
  EditorSessionSnapshot,
  EditorSessionStatus
} from '../../../contracts/ports/editor-session-port';

type HookCallback = (...args: ReadonlyArray<unknown>) => void;

type WordPressHooks = Readonly<{
  addAction: (hook: string, namespace: string, callback: HookCallback) => void;
  removeAction: (hook: string, namespace: string) => void;
}>;

type ApiFetchRuntime = Readonly<{
  nonceMiddleware?: { nonce?: unknown };
}>;

type CreateWordPressEditorSessionPortOptions = Readonly<{
  apiFetch: ApiFetchRuntime;
  document: Document;
  hooks: WordPressHooks;
  namespace: string;
}>;

const SNAPSHOTS: Readonly<Record<EditorSessionStatus, EditorSessionSnapshot>> = {
  'authentication-required': { status: 'authentication-required' },
  'capability-lost': { status: 'capability-lost' },
  'connection-lost': { status: 'connection-lost' },
  locked: { status: 'locked' },
  'nonce-expired': { status: 'nonce-expired' },
  ready: { status: 'ready' }
};

const HOOKS = [
  'heartbeat.send',
  'heartbeat.tick',
  'heartbeat.nonces-expired',
  'heartbeat.connection-lost',
  'heartbeat.connection-restored'
] as const;

function record(value: unknown): Record<string, unknown> | null {
  return value && 'object' === typeof value && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function createWordPressEditorSessionPort({
  apiFetch,
  document,
  hooks,
  namespace
}: CreateWordPressEditorSessionPortOptions): EditorSessionPort {
  const nonceMiddleware = apiFetch.nonceMiddleware;
  if (
    !nonceMiddleware
    || 'string' !== typeof nonceMiddleware.nonce
    || !nonceMiddleware.nonce
    || 'function' !== typeof hooks.addAction
    || 'function' !== typeof hooks.removeAction
    || !namespace
  ) {
    throw new Error('editor-session-wordpress-runtime-unavailable');
  }

  const postIdField = document.querySelector<HTMLInputElement>('#post_ID');
  const lockField = document.querySelector<HTMLInputElement>('#active_post_lock');
  const monitorsLock = Boolean(
    postIdField?.value
    && document.querySelector('#post-lock-dialog')
  );
  const listeners = new Set<() => void>();
  let authenticated = true;
  let capable = true;
  let connected = true;
  let locked = false;
  let nonceFresh = true;
  let sentLockRequest = false;
  let snapshot = SNAPSHOTS.ready;
  let attached = false;

  const nextStatus = (): EditorSessionStatus => {
    if (!connected) return 'connection-lost';
    if (!authenticated) return 'authentication-required';
    if (!nonceFresh) return 'nonce-expired';
    if (!capable) return 'capability-lost';
    if (locked) return 'locked';
    return 'ready';
  };
  const publish = () => {
    const next = SNAPSHOTS[nextStatus()];
    if (next === snapshot) return;
    snapshot = next;
    for (const listener of listeners) listener();
  };
  const send = (value: unknown) => {
    const data = record(value);
    if (!data || !monitorsLock || !postIdField?.value) return;
    const request: Record<string, string> = { post_id: postIdField.value };
    if (lockField?.value) request.lock = lockField.value;
    data['wp-refresh-post-lock'] = request;
    sentLockRequest = true;
  };
  const tick = (value: unknown) => {
    const data = record(value);
    if (!data) return;
    connected = true;
    if ('boolean' === typeof data['wp-auth-check']) {
      authenticated = data['wp-auth-check'];
    }
    if ('string' === typeof data.rest_nonce && data.rest_nonce) {
      nonceMiddleware.nonce = data.rest_nonce;
      nonceFresh = true;
    } else if (true === data.nonces_expired) {
      nonceFresh = false;
    }

    if (Object.getOwnPropertyDescriptor(data, 'wp-refresh-post-lock')) {
      capable = true;
      const lock = record(data['wp-refresh-post-lock']);
      locked = Boolean(lock?.lock_error);
      if ('string' === typeof lock?.new_lock && lock.new_lock && lockField) {
        lockField.value = lock.new_lock;
      }
      sentLockRequest = false;
    } else if (sentLockRequest && authenticated && !data.nonces_expired) {
      capable = false;
      sentLockRequest = false;
    }
    publish();
  };
  const noncesExpired = () => {
    nonceFresh = false;
    publish();
  };
  const connectionLost = () => {
    connected = false;
    publish();
  };
  const connectionRestored = () => {
    connected = true;
    publish();
  };
  const callbacks: Readonly<Record<typeof HOOKS[number], HookCallback>> = {
    'heartbeat.send': send,
    'heartbeat.tick': tick,
    'heartbeat.nonces-expired': noncesExpired,
    'heartbeat.connection-lost': connectionLost,
    'heartbeat.connection-restored': connectionRestored
  };
  const attach = () => {
    if (attached) return;
    attached = true;
    for (const hook of HOOKS) hooks.addAction(hook, namespace, callbacks[hook]);
  };
  const detach = () => {
    if (!attached) return;
    attached = false;
    sentLockRequest = false;
    for (const hook of HOOKS) hooks.removeAction(hook, namespace);
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      attach();
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        listeners.delete(listener);
        if (!listeners.size) detach();
      };
    }
  };
}
