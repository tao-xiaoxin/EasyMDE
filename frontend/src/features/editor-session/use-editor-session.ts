import { useSyncExternalStore } from '@wordpress/element';

import type {
  EditorSessionPort,
  EditorSessionSnapshot
} from '../../contracts/ports/editor-session-port';

export function useEditorSession(port: EditorSessionPort): EditorSessionSnapshot {
  return useSyncExternalStore(port.subscribe, port.getSnapshot);
}
