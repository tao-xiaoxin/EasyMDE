import {
  flushSync,
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition
} from '@wordpress/element';
import {
  createDocumentDerivationScanner,
  deriveDocumentDerivations,
  type ImmersiveOutlineItem
} from '../immersive-editor';

const IMMERSIVE_DOCUMENT_DERIVATION_DEBOUNCE_MS = 180;
const IMMERSIVE_DOCUMENT_DERIVATION_SLICE_CHARACTERS = 4 * 1024;
const IMMERSIVE_DOCUMENT_DERIVATION_INITIAL_SYNC_LIMIT = 16 * 1024;
const IMMERSIVE_DOCUMENT_OUTLINE_FRAME_SIZE = 16;
const IMMERSIVE_DOCUMENT_OUTLINE_FRAME_DELAY_MS = 4;

type DerivationScheduler = (
  callback: () => void,
  delay: number
) => () => void;

function sameStats(
  left: ReturnType<typeof deriveDocumentDerivations>['stats'],
  right: ReturnType<typeof deriveDocumentDerivations>['stats']
): boolean {
  return left.characters === right.characters
    && left.minutes === right.minutes
    && left.words === right.words;
}

function sameOutlinePresentation(
  left: ReadonlyArray<ImmersiveOutlineItem>,
  right: ReadonlyArray<ImmersiveOutlineItem>
): boolean {
  return left.length === right.length
    && left.every((item, index) => {
      const candidate = right[index];
      return candidate?.index === item.index
        && candidate.level === item.level
        && candidate.text === item.text;
    });
}

function outlinePresentationDifference(
  left: ReadonlyArray<ImmersiveOutlineItem>,
  right: ReadonlyArray<ImmersiveOutlineItem>
): number {
  const length = Math.max(left.length, right.length);
  let difference = 0;
  for (let index = 0; index < length; index += 1) {
    const leftItem = left[index];
    const rightItem = right[index];
    if (
      !leftItem
      || !rightItem
      || leftItem.index !== rightItem.index
      || leftItem.level !== rightItem.level
      || leftItem.text !== rightItem.text
    ) {
      difference += 1;
    }
  }
  return difference;
}

function createInitialDocumentDerivations(
  markdown: string
): ReturnType<typeof deriveDocumentDerivations> {
  if (markdown.length <= IMMERSIVE_DOCUMENT_DERIVATION_INITIAL_SYNC_LIMIT) {
    return deriveDocumentDerivations(markdown);
  }
  return {
    outline: [],
    stats: { characters: 0, minutes: 1, words: 0 }
  };
}

export function useImmersiveDocumentDerivations(
  markdown: string,
  schedule: DerivationScheduler
) {
  const [derivations, setDerivations] = useState(() =>
    createInitialDocumentDerivations(markdown)
  );
  const [, startTransition] = useTransition();
  const previousMarkdownRef = useRef<string | null>(null);
  const initialLongDerivationPendingRef = useRef(
    markdown.length > IMMERSIVE_DOCUMENT_DERIVATION_INITIAL_SYNC_LIMIT
  );
  const derivationGenerationRef = useRef(0);
  const mountedRef = useRef(true);
  const latestOutlineRef = useRef(derivations.outline);
  const latestDerivationsRef = useRef(derivations);
  latestDerivationsRef.current = derivations;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      derivationGenerationRef.current += 1;
    };
  }, []);

  useEffect(() => {
    const previousMarkdown = previousMarkdownRef.current;
    const markdownChanged = previousMarkdown !== markdown;
    if (
      !markdownChanged
      && !initialLongDerivationPendingRef.current
    ) return undefined;
    previousMarkdownRef.current = markdown;
    if (markdownChanged) {
      initialLongDerivationPendingRef.current =
        markdown.length > IMMERSIVE_DOCUMENT_DERIVATION_INITIAL_SYNC_LIMIT;
    }
    if (
      null === previousMarkdown
      && markdown.length <= IMMERSIVE_DOCUMENT_DERIVATION_INITIAL_SYNC_LIMIT
    ) {
      return undefined;
    }
    const generation = ++derivationGenerationRef.current;
    let cancelFrame: (() => void) | null = null;
    const isCurrent = () =>
      mountedRef.current && generation === derivationGenerationRef.current;
    const publish = (
      nextDerivations: ReturnType<typeof deriveDocumentDerivations>,
      outline: ImmersiveOutlineItem[],
      final: boolean,
      progressive = false
    ) => {
      if (!isCurrent()) return;
      const commit = () => {
        if (!isCurrent()) return;
        setDerivations((current) => {
          if (!isCurrent()) return current;
          latestOutlineRef.current = final
            ? nextDerivations.outline
            : outline;
          const nextOutline = final
            ? sameOutlinePresentation(
                current.outline,
                nextDerivations.outline
              )
              ? current.outline
              : nextDerivations.outline
            : outline;
          const stats = sameStats(current.stats, nextDerivations.stats)
            ? current.stats
            : nextDerivations.stats;
          return nextOutline === current.outline && stats === current.stats
            ? current
            : { outline: nextOutline, stats };
        });
      };
      if (progressive) flushSync(commit);
      else startTransition(commit);
    };
    const scheduleOutlineFrame = (
      nextDerivations: ReturnType<typeof deriveDocumentDerivations>,
      start: number
    ) => {
      if (!isCurrent() || start >= nextDerivations.outline.length) return;
      cancelFrame = schedule(() => {
        cancelFrame = null;
        if (!isCurrent()) return;
        const end = Math.min(
          start + IMMERSIVE_DOCUMENT_OUTLINE_FRAME_SIZE,
          nextDerivations.outline.length
        );
        publish(
          nextDerivations,
          nextDerivations.outline.slice(0, end),
          end === nextDerivations.outline.length,
          true
        );
        scheduleOutlineFrame(nextDerivations, end);
      }, IMMERSIVE_DOCUMENT_OUTLINE_FRAME_DELAY_MS);
    };
    const completeDerivation = (
      nextDerivations: ReturnType<typeof deriveDocumentDerivations>
    ) => {
      if (!isCurrent()) return;
      initialLongDerivationPendingRef.current = false;
      const current = latestDerivationsRef.current;
      const difference = outlinePresentationDifference(
        current.outline,
        nextDerivations.outline
      );
      const progressive =
        nextDerivations.outline.length > IMMERSIVE_DOCUMENT_OUTLINE_FRAME_SIZE
        && difference > IMMERSIVE_DOCUMENT_OUTLINE_FRAME_SIZE;
      if (progressive) {
        const firstEnd = Math.min(
          IMMERSIVE_DOCUMENT_OUTLINE_FRAME_SIZE,
          nextDerivations.outline.length
        );
        publish(
          nextDerivations,
          nextDerivations.outline.slice(0, firstEnd),
          firstEnd === nextDerivations.outline.length,
          true
        );
        scheduleOutlineFrame(nextDerivations, firstEnd);
        return;
      }
      publish(
        nextDerivations,
        nextDerivations.outline,
        true
      );
    };
    const scanner = createDocumentDerivationScanner(markdown);
    const scanNextSlice = () => {
      cancelFrame = null;
      if (!isCurrent()) return;
      if (!scanner.advance(IMMERSIVE_DOCUMENT_DERIVATION_SLICE_CHARACTERS)) {
        cancelFrame = schedule(scanNextSlice, 0);
        return;
      }
      if (!isCurrent()) return;
      completeDerivation(scanner.result());
    };
    const cancel = schedule(
      scanNextSlice,
      IMMERSIVE_DOCUMENT_DERIVATION_DEBOUNCE_MS
    );

    return () => {
      cancel();
      cancelFrame?.();
      if (generation === derivationGenerationRef.current) {
        derivationGenerationRef.current += 1;
      }
      latestOutlineRef.current = latestDerivationsRef.current.outline;
    };
  }, [markdown, schedule, startTransition]);

  const resolveOutlineItem = useCallback((item: ImmersiveOutlineItem) => {
    const current = latestOutlineRef.current[item.index];
    if (
      !current
      || current.index !== item.index
      || current.level !== item.level
      || current.text !== item.text
    ) {
      throw new Error('immersive-outline-item-stale');
    }
    return current;
  }, []);

  return { ...derivations, resolveOutlineItem };
}
