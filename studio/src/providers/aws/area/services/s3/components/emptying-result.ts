import type { EmptyingCounts } from '../empty-bucket';
import type { ActionFailure } from './action-failure';

// The words of an emptying's status and result (issue 256, requirement R8.4 to R8.6): EmuForge's own, the counted
// word "item" in every text. `emptying-status.tsx` shows them; the empty page shows the result in the area's flash.

/** "1 item", "{n} items": the counted word of every text of the emptying (R8.5). */
export function itemCount(n: number): string {
  return n === 1 ? '1 item' : `${String(n)} items`;
}

/** "{n} items deleted" (R8.4). */
export function deletedText(n: number): string {
  return `${itemCount(n)} deleted`;
}

/** The result of a finished emptying as shown: its type, and its sentence as the words before and after the name. */
export interface EmptyingResultText {
  type: 'success' | 'error';
  before: string;
  name: string;
  after: string;
}

/**
 * The result of a finished emptying (R8.5): its type and its sentence, as the status and the flash show it; the name it
 * quotes apart from the words around it, so it is shown as a name (issue 467, requirement R6).
 */
export function emptyingResult(name: string, counts: EmptyingCounts): EmptyingResultText {
  const failed = counts.failures.length;
  if (failed > 0) {
    return {
      type: 'error',
      before: `${itemCount(failed)} could not be deleted from bucket “`,
      name,
      after: `”. ${deletedText(counts.deleted)}.`,
    };
  }
  return {
    type: 'success',
    before: 'Bucket “',
    name,
    after:
      counts.deleted === 0
        ? '” was already empty.'
        : `” is empty. ${itemCount(counts.deleted)} deleted from the local emulator.`,
  };
}

/** The result's sentence as one text, as it is announced. */
export function emptyingResultLine({ before, name, after }: EmptyingResultText): string {
  return `${before}${name}${after}`;
}

/** What the status shows: the emptying running, finished, or stopped by a request that failed as a whole. */
export type EmptyingState =
  | { kind: 'running'; counts: EmptyingCounts }
  | { kind: 'finished'; counts: EmptyingCounts }
  | { kind: 'failed'; counts: EmptyingCounts; failure: ActionFailure };
