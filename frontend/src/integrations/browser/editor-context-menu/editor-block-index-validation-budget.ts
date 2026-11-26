/**
 * Cooperative time-slicing primitives shared by Editor block index request
 * validation and packed worker-result validation.
 */
export const VALIDATION_SLICE_MS = 4;
const VALIDATION_FIRST_BATCH_SIZE = 8;

export function record(value: unknown): Record<string, unknown> | null {
	return value && "object" === typeof value && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

export function safeInteger(value: unknown): value is number {
	return "number" === typeof value && Number.isSafeInteger(value) && value >= 0;
}

export function now(): number {
	return "function" === typeof globalThis.performance?.now
		? globalThis.performance.now()
		: Date.now();
}

export function yieldValidation(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

export type YieldBudget = Readonly<{
	itemYieldDue: () => boolean;
	resetBatch: () => void;
	sliceYieldDue: () => boolean;
	yieldItem: () => Promise<void>;
	yieldSlice: () => Promise<void>;
}>;

/**
 * Shared time-slice budget for packed validation. `itemYieldDue` counts one
 * item and is due once the slice exceeds `VALIDATION_SLICE_MS`, or once the
 * first `VALIDATION_FIRST_BATCH_SIZE` items complete before any item yield.
 * `resetBatch` restarts only the item count. `yieldItem` marks the first batch
 * as yielded; `yieldSlice` (used by inner block scans) does not.
 */
export function createYieldBudget(): YieldBudget {
	let sliceStarted = now();
	let processed = 0;
	let yielded = false;
	return {
		itemYieldDue() {
			processed += 1;
			return (
				now() - sliceStarted >= VALIDATION_SLICE_MS ||
				(!yielded && processed >= VALIDATION_FIRST_BATCH_SIZE)
			);
		},
		resetBatch() {
			processed = 0;
		},
		sliceYieldDue() {
			return now() - sliceStarted >= VALIDATION_SLICE_MS;
		},
		yieldItem() {
			return yieldValidation().then(() => {
				sliceStarted = now();
				yielded = true;
			});
		},
		yieldSlice() {
			return yieldValidation().then(() => {
				sliceStarted = now();
			});
		},
	};
}
