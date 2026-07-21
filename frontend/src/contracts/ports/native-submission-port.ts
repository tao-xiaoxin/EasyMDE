export interface NativeSubmissionPort {
  subscribeBeforeSubmit(listener: () => void): () => void;
}
