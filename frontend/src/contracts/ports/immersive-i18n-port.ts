export interface ImmersiveI18nPort {
  characters(count: number): string;
  readingTime(minutes: number): string;
  revisions(count: number): string;
  words(count: number): string;
}
