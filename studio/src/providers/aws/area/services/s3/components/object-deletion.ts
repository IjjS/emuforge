import { RequestError, type RequestFailure } from '../../../../../../lib/aws/request';
import { KEYS_PER_CALL, OPERATIONS, type KeyPage, type KeyRefusal, type KeysDeleted } from '../api';

// The deletion of the delete dialog (issue 480, task 4), as logic apart from the dialog: each selected folder's keys
// listed page by page first, then every key in `DeleteObjects` batches of at most 1000. A failure of a call (not a
// key the emulator refused) stops it, and what was deleted before it is still counted.

/** The two calls the deletion makes, on one bucket. */
export interface DeletionOperations {
  /** One page of every key under `prefix`, after `token`. */
  listKeys: (prefix: string, token: string | undefined, signal: AbortSignal) => Promise<KeyPage>;
  /** One `DeleteObjects` of at most `KEYS_PER_CALL` keys. */
  deleteKeys: (keys: readonly string[], signal: AbortSignal) => Promise<KeysDeleted>;
}

/** What is to be deleted, as selected: objects by their keys, folders by their prefixes. */
export interface DeletionSelection {
  keys: readonly string[];
  folders: readonly string[];
}

/** What the deletion did. */
export interface DeletionResult {
  /** The keys deleted, a folder's keys included. */
  deleted: number;
  /** Each key the emulator refused, with its reason. */
  refused: KeyRefusal[];
  /** The failed call that stopped it, if one did. */
  failure?: RequestFailure;
}

function failureOf(error: unknown, operation: string): RequestFailure {
  return error instanceof RequestError ? error.failure : { kind: 'other', operation, code: String(error) };
}

/**
 * Deletes `selection`: the keys of each folder listed page by page, then every key, each once, in batches of at most
 * `KEYS_PER_CALL`. Rejects only with `signal`'s reason once it aborts; every failed call ends it with `failure`.
 */
export async function runDeletion(
  { keys, folders }: DeletionSelection,
  operations: DeletionOperations,
  signal: AbortSignal,
): Promise<DeletionResult> {
  const all = new Set(keys);
  const result: DeletionResult = { deleted: 0, refused: [] };
  try {
    for (const folder of folders) {
      let token: string | undefined;
      do {
        const page = await operations.listKeys(folder, token, signal);
        for (const key of page.keys) {
          all.add(key);
        }
        token = page.nextToken;
      } while (token !== undefined);
    }
  } catch (error) {
    signal.throwIfAborted();
    return { ...result, failure: failureOf(error, OPERATIONS.listObjectsV2) };
  }
  const list = [...all];
  for (let start = 0; start < list.length; start += KEYS_PER_CALL) {
    try {
      const batch = await operations.deleteKeys(list.slice(start, start + KEYS_PER_CALL), signal);
      result.deleted += batch.deleted;
      result.refused.push(...batch.refused);
    } catch (error) {
      signal.throwIfAborted();
      return { ...result, failure: failureOf(error, OPERATIONS.deleteObjects) };
    }
  }
  return result;
}

/** "1 object", "2 objects"; "1 folder", "2 folders". */
function counted(count: number, word: string): string {
  return `${String(count)} ${word}${count === 1 ? '' : 's'}`;
}

/**
 * The dialog's header for a selection: "Delete 1 object?", "Delete 2 objects and 1 folder?", "Delete 3 folders?",
 * each part left out when zero.
 */
export function deletionHeader(objects: number, folders: number): string {
  const parts = [
    ...(objects > 0 ? [counted(objects, 'object')] : []),
    ...(folders > 0 ? [counted(folders, 'folder')] : []),
  ];
  return `Delete ${parts.join(' and ')}?`;
}

/** "Deleted 1 object.", "Deleted 3 objects." */
export function deletedText(count: number): string {
  return `Deleted ${counted(count, 'object')}.`;
}

/** "Deleted 0 objects before the failure.": what a failed call stopped after. */
export function deletedBeforeText(count: number): string {
  return `Deleted ${counted(count, 'object')} before the failure.`;
}

/** "1 could not be deleted:", "2 could not be deleted:" */
export function refusedText(count: number): string {
  return `${String(count)} could not be deleted:`;
}
