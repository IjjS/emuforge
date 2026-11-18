import type { RequestFailure } from '../../../../../../lib/aws/request';
import type { AreaConnection } from '../../../components/emulator-line';
import { creationDateText } from '../../../components/format-date';
import type { ObjectPage } from '../api';
import { FOLDER_TYPE, formatSize, keyType, NO_VALUE } from '../format';
import { pageFailure, type FailureView } from './bucket-read';

// The rows of the tab "Objects" (issue 480, task 1) as data: a page of `ListObjectsV2` as the folders, then the
// objects, each with the values its columns show; and the view of a failed listing. The table renders them.

/** A folder row: a common prefix of the answer. */
export interface FolderRow {
  kind: 'folder';
  /** The whole prefix: what the row is selected by, and its S3 URI's key. */
  id: string;
  /** Key: the part after the folder shown, ending in `/`. */
  name: string;
}

/** An object row. */
export interface ObjectRow {
  kind: 'object';
  /** The whole key. */
  id: string;
  /** Key: the part after the folder shown. */
  name: string;
  type: string;
  lastModified: string;
  size: string;
  storageClass: string;
}

export type Row = FolderRow | ObjectRow;

/**
 * The rows of `page` under `prefix`: the folders first, then the objects, each in the answer's order. The empty
 * object a folder is made of (its key the prefix itself) is the folder shown, not a row of it.
 */
export function objectRows(page: ObjectPage, prefix: string): Row[] {
  // A key is shown after the folder, not after what was asked: a filter asks the folder plus its text.
  const shown = (id: string) => id.slice(prefix.length);
  const folders: Row[] = page.folders.map(({ prefix: id }) => ({ kind: 'folder', id, name: shown(id) }));
  const objects: Row[] = page.objects
    .filter(({ key }) => prefix === '' || key !== prefix)
    .map(({ key, size, lastModified, storageClass }) => ({
      kind: 'object',
      id: key,
      name: shown(key),
      type: keyType(key),
      lastModified: creationDateText(lastModified),
      size: size === undefined ? NO_VALUE : formatSize(size),
      storageClass: storageClass ?? NO_VALUE,
    }));
  return [...folders, ...objects];
}

/** A row's Type: "Folder", or the key's extension. */
export function rowType(row: Row): string {
  return row.kind === 'folder' ? FOLDER_TYPE : row.type;
}

const COULD_NOT_READ = 'The objects could not be read';

/**
 * The view of a failed listing: a 501 "Not implemented by the emulator: ListObjectsV2", else the rows of a bucket's
 * page read, the connection's status first while it is not connected.
 */
export function listingFailure(failure: RequestFailure, connection: AreaConnection): FailureView {
  if (failure.kind === 'not-implemented') {
    return {
      type: 'info',
      first: { before: 'Not implemented by the emulator: ', code: failure.operation },
      detail: {
        before: 'The emulator answered 501 Not Implemented, so Studio cannot list the objects of this bucket.',
      },
      recovery: false,
    };
  }
  return pageFailure(failure, connection, COULD_NOT_READ);
}
