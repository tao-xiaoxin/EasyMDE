import { describe, expect, it, vi } from 'vitest';

import { createWordPressNativeSubmissionPort } from './wordpress-native-submission';

describe('createWordPressNativeSubmissionPort', () => {
  it('rejects a missing native WordPress form before registering listeners', () => {
    expect(() => createWordPressNativeSubmissionPort(
      document.createElement('div') as unknown as HTMLFormElement
    )).toThrowError('native-submission-form-invalid');
  });

  it('runs the bridge before native serialization without replacing form ownership', () => {
    const form = document.createElement('form');
    const extensionField = document.createElement('input');
    extensionField.name = 'extension_field';
    extensionField.value = 'preserved';
    form.append(extensionField);
    const requestSubmit = vi.spyOn(form, 'requestSubmit');
    const listener = vi.fn();
    const port = createWordPressNativeSubmissionPort(form);
    const unsubscribe = port.subscribeBeforeSubmit(listener);

    form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));

    expect(listener).toHaveBeenCalledTimes(1);
    expect(extensionField.value).toBe('preserved');
    expect(requestSubmit).not.toHaveBeenCalled();
    unsubscribe();
    form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('keeps independent subscribers and idempotent cleanup', () => {
    const form = document.createElement('form');
    const port = createWordPressNativeSubmissionPort(form);
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribeFirst = port.subscribeBeforeSubmit(first);
    const unsubscribeSecond = port.subscribeBeforeSubmit(second);

    unsubscribeFirst();
    unsubscribeFirst();
    form.dispatchEvent(new SubmitEvent('submit'));

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    unsubscribeSecond();
  });
});
