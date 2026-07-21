import type { MediaPickerFramePort } from '../../../contracts/ports/media-picker-port';

type WordPressMediaFrame = Readonly<{
  on: (name: string, callback: () => void) => void;
  open: () => void;
  state: () => unknown;
}>;

type WordPressMediaFactory = (options: Readonly<{
  multiple: false;
  title: string;
}>) => unknown;

function frameValue(value: unknown): WordPressMediaFrame {
  if (!value || 'object' !== typeof value) {
    throw new Error('wordpress-media-frame-invalid');
  }
  const frame = value as Partial<WordPressMediaFrame>;
  if (
    'function' !== typeof frame.on
    || 'function' !== typeof frame.open
    || 'function' !== typeof frame.state
  ) {
    throw new Error('wordpress-media-frame-invalid');
  }

  return frame as WordPressMediaFrame;
}

function selectedAttachment(frame: WordPressMediaFrame): unknown {
  const state = frame.state();
  if (!state || 'object' !== typeof state) {
    throw new Error('wordpress-media-selection-invalid');
  }
  const get = (state as { get?: unknown }).get;
  if ('function' !== typeof get) {
    throw new Error('wordpress-media-selection-invalid');
  }
  const selection = get.call(state, 'selection') as { first?: unknown } | null;
  if (!selection || 'function' !== typeof selection.first) {
    throw new Error('wordpress-media-selection-invalid');
  }
  const attachment = selection.first.call(selection) as { toJSON?: unknown } | null;
  if (!attachment || 'function' !== typeof attachment.toJSON) {
    throw new Error('wordpress-media-selection-invalid');
  }

  return attachment.toJSON.call(attachment);
}

export function createWordPressMediaFramePort(value: unknown): MediaPickerFramePort | null {
  if ('function' !== typeof value) {
    return null;
  }
  const media = value as WordPressMediaFactory;

  return {
    open({ onClose, onError, onSelect, title }) {
      const frame = frameValue(media({ multiple: false, title }));
      frame.on('select', () => {
        try {
          onSelect(selectedAttachment(frame));
        } catch (error) {
          onError(error);
        }
      });
      frame.on('close', onClose);
      frame.open();
    }
  };
}
