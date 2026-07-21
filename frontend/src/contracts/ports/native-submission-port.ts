export interface NativeSubmissionPort {
  subscribeBeforeSubmit(listener: () => 'blocked' | 'continue' | undefined): () => void;
}
