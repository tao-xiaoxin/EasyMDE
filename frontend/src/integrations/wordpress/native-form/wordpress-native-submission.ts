import type { NativeSubmissionPort } from '../../../contracts/ports/native-submission-port';

export function createWordPressNativeSubmissionPort(
  form: HTMLFormElement
): NativeSubmissionPort {
  if (!(form instanceof HTMLFormElement)) {
    throw new Error('native-submission-form-invalid');
  }

  return {
    subscribeBeforeSubmit(listener) {
      let active = true;
      const beforeSubmit = (event: SubmitEvent) => {
        if ('blocked' === listener()) event.preventDefault();
      };
      form.addEventListener('submit', beforeSubmit, { capture: true });

      return () => {
        if (!active) {
          return;
        }
        active = false;
        form.removeEventListener('submit', beforeSubmit, { capture: true });
      };
    }
  };
}
