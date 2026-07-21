import type { NativeSubmissionPort } from '../../../contracts/ports/native-submission-port';

export function createWordPressNativeSubmissionPort(
  form: HTMLFormElement
): NativeSubmissionPort {
  if (!(form instanceof HTMLFormElement)) {
    throw new Error('native-submission-form-invalid');
  }

  return {
    subscribeBeforeSubmit(listener: () => void) {
      let active = true;
      form.addEventListener('submit', listener);

      return () => {
        if (!active) {
          return;
        }
        active = false;
        form.removeEventListener('submit', listener);
      };
    }
  };
}
