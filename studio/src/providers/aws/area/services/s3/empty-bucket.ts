import { RequestError, type RequestFailure } from '../../../../../lib/aws/request';
import {
  NO_SUCH_BUCKET,
  type DeleteFailure,
  type DeleteObjectsResult,
  type NoSuchBucket,
  type ObjectVersionId,
  type ObjectVersionPage,
  type ObjectVersionPageRequest,
} from './api';

// The emptying of a bucket (issue 256, requirement R8.3 to R8.6): one request at a time, a listing of what is left
// from the bucket's start, then one quiet delete of it, until nothing is left. No marker is followed after a delete
// (the emulator's markers skip versions once a page was deleted, R2); a page that holds only items that failed is
// left by its markers, which are safe because nothing of it was deleted. An item that failed is not sent again in the
// same run, so every round deletes at least one item or reaches the end.

/** The most items one listing gives and one delete sends: the API's limit, and all a bucket of the emulator holds. */
export const EMPTYING_PAGE_SIZE = 1000;

/** The two operations of the emptying, on one bucket. */
export interface EmptyingOperations {
  listVersions: (request: ObjectVersionPageRequest, signal: AbortSignal) => Promise<ObjectVersionPage | NoSuchBucket>;
  deleteVersions: (
    items: readonly ObjectVersionId[],
    signal: AbortSignal,
  ) => Promise<DeleteObjectsResult | NoSuchBucket>;
}

/** What a run has done so far: the items deleted, and the ones that failed in the order they were met. */
export interface EmptyingCounts {
  deleted: number;
  failures: readonly DeleteFailure[];
}

/** How a run ended, with its counts. */
export type EmptyingResult = EmptyingCounts &
  (
    | { outcome: 'finished' }
    /** A listing or a delete failed as a whole. */
    | { outcome: 'failed'; failure: RequestFailure }
    /** The signal aborted: neither finished nor failed. */
    | { outcome: 'stopped' }
    /** The emulator holds no bucket of that name. */
    | { outcome: 'no-such-bucket' }
  );

export interface EmptyingOptions {
  /** The counts of an earlier run to go on from ("Retry"): kept, and its failures not sent again. */
  from?: EmptyingCounts;
  /** Told the counts after each delete. */
  onProgress?: (counts: EmptyingCounts) => void;
}

function idOf({ key, versionId }: ObjectVersionId): string {
  return JSON.stringify([key, versionId ?? null]);
}

/**
 * Deletes every object version and delete marker of a bucket through `operations`. Ends at once, sending nothing
 * more, when `signal` aborts.
 */
export async function emptyBucket(
  operations: EmptyingOperations,
  signal: AbortSignal,
  { from, onProgress }: EmptyingOptions = {},
): Promise<EmptyingResult> {
  let deleted = from?.deleted ?? 0;
  const failures: DeleteFailure[] = [...(from?.failures ?? [])];
  const failed = new Set(failures.map(idOf));
  const counts = (): EmptyingCounts => ({ deleted, failures: [...failures] });

  let markers: Pick<ObjectVersionPageRequest, 'keyMarker' | 'versionIdMarker'> = {};
  try {
    for (;;) {
      if (signal.aborted) {
        return { outcome: 'stopped', ...counts() };
      }
      const page = await operations.listVersions({ maxKeys: EMPTYING_PAGE_SIZE, ...markers }, signal);
      if (page === NO_SUCH_BUCKET) {
        return { outcome: 'no-such-bucket', ...counts() };
      }
      const left = page.items.filter((item) => !failed.has(idOf(item))).slice(0, EMPTYING_PAGE_SIZE);
      if (left.length > 0) {
        if (signal.aborted) {
          return { outcome: 'stopped', ...counts() };
        }
        const answer = await operations.deleteVersions(left, signal);
        if (answer === NO_SUCH_BUCKET) {
          return { outcome: 'no-such-bucket', ...counts() };
        }
        const sent = new Set(left.map(idOf));
        let notDeleted = 0;
        for (const error of answer.errors) {
          const id = idOf(error);
          if (sent.has(id) && !failed.has(id)) {
            failed.add(id);
            failures.push(error);
            notDeleted += 1;
          }
        }
        deleted += left.length - notDeleted;
        onProgress?.(counts());
        // From the start again: a marker is not safe after a delete.
        markers = {};
        continue;
      }
      if (page.truncated && page.nextKeyMarker !== undefined) {
        markers = {
          keyMarker: page.nextKeyMarker,
          ...(page.nextVersionIdMarker === undefined ? {} : { versionIdMarker: page.nextVersionIdMarker }),
        };
        continue;
      }
      return { outcome: 'finished', ...counts() };
    }
  } catch (error) {
    if (signal.aborted) {
      return { outcome: 'stopped', ...counts() };
    }
    if (error instanceof RequestError) {
      return { outcome: 'failed', failure: error.failure, ...counts() };
    }
    throw error;
  }
}
