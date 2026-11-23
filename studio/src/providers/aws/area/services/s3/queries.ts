import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { RequestError, type RequestFailure } from '../../../../../lib/aws/request';
import {
  abortMultipartUpload,
  completeMultipartUpload,
  copyObject,
  createMultipartUpload,
  holdsAnyUnder,
  putObject,
  uploadPart,
  deleteBucket,
  deleteKeys,
  deleteObject,
  deleteObjects,
  findBucket,
  getObject,
  getObjectTagging,
  headObject,
  listKeys,
  NO_SUCH_KEY,
  NOT_FOUND,
  getBucketEncryption,
  getBucketNotificationConfiguration,
  getBucketTagging,
  getBucketVersioning,
  getBucketWebsite,
  isBucketEmpty,
  LIST_BUCKETS,
  listBuckets,
  listObjects,
  listObjectHistory,
  listObjectVersions,
  NO_SUCH_BUCKET,
  OPERATIONS,
  readBucketVersioning,
  type Bucket,
  type BucketPage,
  type DeleteBucketResult,
  type NoSuchBucket,
  type NoSuchKey,
  type ObjectBody,
  type ObjectCopyOptions,
  type ObjectHead,
  type ObjectLocation,
  type ObjectPage,
  type ObjectVersion,
  type ObjectVersionPage,
  type ObjectVersionPageRequest,
  type Tag,
} from './api';
import { createOperations, submitBucketForm, type BucketForm, type CreateOutcome } from './bucket-form';
import type { EmptyingOperations } from './empty-bucket';
import { loadPreview, type Preview } from './preview';
import type { DeletionOperations } from './components/object-deletion';
import type { UploadOperations } from './upload';

// The bucket list's listing (issue 56, requirement R4.1, R4.4, R4.5, R4.7, R4.9): pages that follow the API's
// tokens, a filter sent as `prefix`, and a new listing at page 1 on every refresh, filter and page size. Nothing is
// kept for a later mount and nothing is shown from an earlier listing: every read is a request of its own.

/** The filter's text is sent once it has not changed for this long (R4.7). */
export const FILTER_DELAY_MS = 300;

/** What the listing is asked for. */
export interface BucketListingOptions {
  /** The engine's address, `http://127.0.0.1:<port>`; nothing is asked while it is not known. */
  endpoint: string | undefined;
  /** `max-buckets` of every page. */
  pageSize: number;
  /** The filter's text as typed; sent as `prefix` `FILTER_DELAY_MS` after its last change. */
  filter: string;
}

/** The counter after the title (R4.5): the buckets of the pages read, with "+" while more remain. */
export interface BucketCount {
  total: number;
  more: boolean;
}

export interface BucketListing {
  /** The prefix of this listing, the filter's text as last sent; `''` for none. */
  prefix: string;
  /** The shown page's buckets, in the answer's order; `undefined` until its answer arrives or when it failed. */
  buckets: Bucket[] | undefined;
  /** Why the shown page could not be read; `undefined` while it is read or once it is. */
  failure: RequestFailure | undefined;
  /** A read of the shown page is in flight. */
  loading: boolean;
  /** `undefined` while no page of this listing has been read. */
  count: BucketCount | undefined;
  /** The shown page, from 1. */
  currentPage: number;
  /** The pages this listing knows of: those read, and the shown one while it is read. */
  pagesCount: number;
  /** The last page read carried a token: more pages may follow. */
  openEnd: boolean;
  /** Shows page `page` (from 1) of this listing, read again; a page this listing has no token for is ignored. */
  goToPage: (page: number) => void;
  /** Starts a new listing at page 1, dropping every token. */
  refresh: () => void;
}

/** What a listing learnt from one page's last answer. */
interface PageRead {
  count: number;
  next: string | undefined;
}

/** Where the user is in one listing. */
interface Position {
  listing: string;
  /** The shown page, from 0. */
  page: number;
  /** One more on every move, so a page shown again is read again. */
  visit: number;
  /** The last read of each page of this listing, from page 0, up to the last page read. */
  reads: readonly PageRead[];
}

/** Page 1 of `listing`, nothing read yet. */
function fresh(listing: string): Position {
  return { listing, page: 0, visit: 0, reads: [] };
}

/** A number per mount, so a page of an earlier mount is never shown. */
let mounts = 0;

/** `value`, once it has not changed for `delay` ms. */
function useSettled(value: string, delay: number): string {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => {
      setSettled(value);
    }, delay);
    return () => {
      clearTimeout(timer);
    };
  }, [value, delay]);
  return settled;
}

/** `reads` with page `page`'s answer as its last read; the later pages stay only while its token is the same. */
function withRead(reads: readonly PageRead[], page: number, read: PageRead): readonly PageRead[] {
  const before = reads[page];
  const later =
    before !== undefined && before.next === read.next && read.next !== undefined ? reads.slice(page + 1) : [];
  return [...reads.slice(0, page), read, ...later];
}

function failureOf(error: unknown, operation: string = LIST_BUCKETS): RequestFailure {
  return error instanceof RequestError ? error.failure : { kind: 'other', operation, code: String(error) };
}

/** A listing that follows the API's tokens one page at a time, as a screen shows it. */
interface TokenListing<Answer> {
  /** The shown page's answer; `undefined` until it arrives or when it failed. */
  answer: Answer | undefined;
  failure: RequestFailure | undefined;
  loading: boolean;
  /** `undefined` while no page of this listing has been read. */
  count: BucketCount | undefined;
  /** The shown page, from 1. */
  currentPage: number;
  pagesCount: number;
  openEnd: boolean;
  /** One text per listing and page shown: it changes on every new listing and every move to a page. */
  view: string;
  goToPage: (page: number) => void;
}

/** What a token listing reads, given by the hook that uses it. */
interface TokenListingOptions<Answer> {
  /** The start of every query key; the listing's own parts and the page's token follow it. */
  key: readonly unknown[];
  /** Every value the listing is asked with: a change starts a new listing at page 1 with no token. */
  parts: readonly unknown[];
  endpoint: string | undefined;
  operation: string;
  read: (endpoint: string, token: string | undefined, signal: AbortSignal) => Promise<Answer>;
  /** What one answer learnt: its count and its token; `undefined` for an answer that is no page (no such bucket). */
  pageRead: (answer: Answer) => PageRead | undefined;
  enabled?: boolean;
}

/**
 * The pages of a listing, one at a time, read by `read` with the token of the page before. A request no longer
 * wanted (another page, a new listing, an unmount) is aborted, and its late answer never replaces a newer one.
 */
function useTokenListing<Answer>({
  key,
  parts,
  endpoint,
  operation,
  read,
  pageRead,
  enabled = true,
}: TokenListingOptions<Answer>): TokenListing<Answer> {
  const [mount] = useState(() => (mounts += 1));
  const listing = JSON.stringify([endpoint ?? null, mount, ...parts]);

  const [stored, setPosition] = useState<Position>(fresh(listing));
  // A change of listing starts at page 1 with no token.
  const position: Position = stored.listing === listing ? stored : fresh(listing);
  const token = position.page === 0 ? undefined : position.reads[position.page - 1]?.next;

  const query = useQuery({
    queryKey: [...key, endpoint, mount, ...parts, position.page, token, position.visit],
    queryFn: async ({ signal }) => {
      if (endpoint === undefined) {
        throw new Error('The engine endpoint is not known yet.');
      }
      const page = position.page;
      const answer = await read(endpoint, token, signal);
      const learnt = pageRead(answer);
      // Kept as this page's last read only while the user is still on it in the same listing.
      if (learnt !== undefined) {
        setPosition((current) => {
          if (signal.aborted) return current;
          const at = current.listing === listing ? current : fresh(listing);
          return at.page === page ? { ...at, reads: withRead(at.reads, page, learnt) } : current;
        });
      }
      return answer;
    },
    enabled: enabled && endpoint !== undefined,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    structuralSharing: false,
  });
  const answer = query.data;
  const learnt = answer === undefined ? undefined : pageRead(answer);

  const reads = learnt === undefined ? position.reads : withRead(position.reads, position.page, learnt);
  const last = reads[reads.length - 1];
  const openEnd = last?.next !== undefined;

  const goToPage = useCallback(
    (page: number) => {
      setPosition((current) => {
        const at = current.listing === listing ? current : fresh(listing);
        const index = page - 1;
        const known = index === 0 || at.reads[index - 1]?.next !== undefined;
        return Number.isInteger(index) && index >= 0 && known ? { ...at, page: index, visit: at.visit + 1 } : current;
      });
    },
    [listing, setPosition],
  );

  return {
    answer,
    failure: query.isError ? failureOf(query.error, operation) : undefined,
    loading: query.isFetching || (enabled && endpoint === undefined && answer === undefined),
    count: last === undefined ? undefined : { total: reads.reduce((sum, page) => sum + page.count, 0), more: openEnd },
    currentPage: position.page + 1,
    pagesCount: Math.max(reads.length, position.page + 1),
    openEnd,
    view: `${listing}#${String(position.page)}#${String(position.visit)}`,
    goToPage,
  };
}

/**
 * The bucket list of the emulator behind the engine at `endpoint`, one page at a time. A request no longer wanted
 * (another page, a new listing, an unmount) is aborted, and its late answer never replaces a newer one.
 */
export function useBucketListing({ endpoint, pageSize, filter }: BucketListingOptions): BucketListing {
  const [generation, setGeneration] = useState(0);
  const prefix = useSettled(filter, FILTER_DELAY_MS);
  const listing = useTokenListing<BucketPage>({
    key: ['aws', 's3', 'list-buckets'],
    parts: [generation, pageSize, prefix],
    endpoint,
    operation: LIST_BUCKETS,
    read: (at, token, signal) =>
      listBuckets(
        at,
        { pageSize, ...(prefix === '' ? {} : { prefix }), ...(token === undefined ? {} : { token }) },
        signal,
      ),
    pageRead: (answer) => ({ count: answer.buckets.length, next: answer.nextToken }),
  });

  const refresh = useCallback(() => {
    setGeneration((current) => current + 1);
  }, []);

  return {
    prefix,
    buckets: listing.answer?.buckets,
    failure: listing.failure,
    loading: listing.loading,
    count: listing.count,
    currentPage: listing.currentPage,
    pagesCount: listing.pagesCount,
    openEnd: listing.openEnd,
    goToPage: listing.goToPage,
    refresh,
  };
}

/** What the tab "Objects" lists (issue 480, task 1). */
export interface ObjectListingOptions {
  endpoint: string | undefined;
  bucket: string;
  /** The folder shown, the address's `?prefix=`; `''` at the root. */
  prefix: string;
  /** "Find objects by prefix" as typed; sent after the folder's prefix `FILTER_DELAY_MS` after its last change. */
  filter: string;
  /** `MaxKeys` of every page. */
  pageSize: number;
  enabled?: boolean;
  /** Starts again at page one after a change in version history. */
  revision?: number;
}

/** The tab "Objects"' listing, as the tab shows it. */
export interface ObjectListing {
  /** The filter's text as last sent; `''` for none. */
  text: string;
  /** The shown page; `NO_SUCH_BUCKET` when the emulator holds no such bucket; `undefined` while read or failed. */
  page: ObjectPage | NoSuchBucket | undefined;
  failure: RequestFailure | undefined;
  loading: boolean;
  /** The rows of the shown page (folders and objects), with "+" while more remain. */
  count: BucketCount | undefined;
  currentPage: number;
  pagesCount: number;
  openEnd: boolean;
  /** Changes with every new listing and every page shown: what the selection is kept for. */
  view: string;
  goToPage: (page: number) => void;
  /** Starts a new listing at page 1, dropping every token ("Refresh"). */
  refresh: () => void;
}

/**
 * The folders and objects of bucket `bucket` under `prefix` plus the filter's text, one page at a time, following
 * `ListObjectsV2`'s tokens; never every key. A new prefix, text, page size or "Refresh" asks page 1 again; a late
 * answer for an older listing never replaces a newer one.
 */
export function useObjectListing({
  endpoint,
  bucket,
  prefix,
  filter,
  pageSize,
  enabled = true,
  revision = 0,
}: ObjectListingOptions): ObjectListing {
  const [generation, setGeneration] = useState(0);
  // The tab is mounted anew for each folder, so a text typed in one folder is never sent in another.
  const text = useSettled(filter, FILTER_DELAY_MS);
  const listing = useTokenListing<ObjectPage | NoSuchBucket>({
    key: [...S3_KEY, 'objects', bucket],
    parts: [bucket, generation, revision, pageSize, prefix, text],
    endpoint,
    operation: OPERATIONS.listObjectsV2,
    read: (at, token, signal) =>
      listObjects(
        at,
        bucket,
        { prefix: `${prefix}${text}`, pageSize, ...(token === undefined ? {} : { token }) },
        signal,
      ),
    pageRead: (answer) =>
      answer === NO_SUCH_BUCKET
        ? undefined
        : { count: answer.folders.length + answer.objects.length, next: answer.nextToken },
    enabled,
  });

  const refresh = useCallback(() => {
    setGeneration((current) => current + 1);
  }, []);

  const shown = listing.answer;
  return {
    text,
    page: shown,
    failure: listing.failure,
    loading: listing.loading,
    // The counter of the page shown (the design: "the page's count with + while truncated").
    count:
      shown === undefined || shown === NO_SUCH_BUCKET
        ? undefined
        : { total: shown.folders.length + shown.objects.length, more: shown.nextToken !== undefined },
    currentPage: listing.currentPage,
    pagesCount: listing.pagesCount,
    openEnd: listing.openEnd,
    view: listing.view,
    goToPage: listing.goToPage,
    refresh,
  };
}

/** The history of a prefix, using the key and version ID markers together as one cursor. */
export function useObjectHistory(endpoint: string | undefined, bucket: string, prefix: string) {
  const [generation, setGeneration] = useState(0);
  const listing = useTokenListing<ObjectVersionPage<ObjectVersion>>({
    key: [...S3_KEY, 'object-history', bucket],
    parts: [generation, prefix],
    endpoint,
    operation: OPERATIONS.listObjectVersions,
    read: (at, token, signal) => {
      const cursor = token === undefined ? {} : (JSON.parse(token) as Partial<ObjectVersionPageRequest>);
      return listObjectHistory(at, bucket, { ...cursor, prefix, maxKeys: 100 }, signal);
    },
    pageRead: (page) => ({
      count: page.items.length,
      next:
        page.truncated && page.nextKeyMarker !== undefined
          ? JSON.stringify({ keyMarker: page.nextKeyMarker, versionIdMarker: page.nextVersionIdMarker })
          : undefined,
    }),
  });
  const refresh = useCallback(() => setGeneration((current) => current + 1), []);
  return { ...listing, refresh };
}

/** Read on opening Restore, retaining the response when the bucket has disappeared. */
export function useRestoreVersioning(endpoint: string | undefined, bucket: string, enabled: boolean) {
  return useFreshRead(
    endpoint,
    bucket,
    'versioning',
    OPERATIONS.getBucketVersioning,
    0,
    (at, signal) => readBucketVersioning(at, bucket, signal),
    enabled,
  );
}

// Issue 256 (requirement R5.1, R6.8, R7.1, R8.1, R11): the reads of a bucket's page, of its sections and of the
// empty and delete pages, and the actions that make S3's reads stale. Each read is a request of its own on every
// mount, "Refresh" and "Retry", under a key that holds the bucket's name; a read no longer wanted is aborted, and
// its late answer, under a key nobody shows any more, changes nothing shown.

/** The start of every key of S3's reads. */
const S3_KEY = ['aws', 's3'] as const;

/** One read of a bucket's screens as a screen shows it. */
export interface BucketRead<T> {
  /** The answer of the current read; `undefined` while it is in flight or when it failed. */
  value: T | undefined;
  /** Why the current read failed; `undefined` while it is in flight or once it answered. */
  failure: RequestFailure | undefined;
  /** The current read is in flight, or waits for the engine's address. */
  loading: boolean;
  /** Reads again ("Retry"). */
  again: () => void;
}

/** A read of `operation` on bucket `name`, part `part`, read again on every mount, `generation` and `again`. */
function useFreshRead<T>(
  endpoint: string | undefined,
  name: string,
  part: string | readonly string[],
  operation: string,
  generation: number,
  read: (endpoint: string, signal: AbortSignal) => Promise<T>,
  enabled = true,
): BucketRead<T> {
  const [mount] = useState(() => (mounts += 1));
  const [attempt, setAttempt] = useState(0);
  const query = useQuery({
    queryKey: [
      ...S3_KEY,
      'bucket',
      name,
      ...(typeof part === 'string' ? [part] : part),
      endpoint,
      mount,
      generation,
      attempt,
    ],
    queryFn: ({ signal }) => {
      if (endpoint === undefined) {
        throw new Error('The engine endpoint is not known yet.');
      }
      return read(endpoint, signal);
    },
    enabled: enabled && endpoint !== undefined,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    structuralSharing: false,
  });
  const again = useCallback(() => {
    setAttempt((current) => current + 1);
  }, []);
  return {
    value: query.data,
    failure: query.isError ? failureOf(query.error, operation) : undefined,
    loading: query.isFetching || (enabled && endpoint === undefined),
    again,
  };
}

/** The read of a page on opening, read again by "Refresh". */
export interface ScreenRead<T> extends BucketRead<T> {
  /** One more on every "Refresh"; a section's read is read again with it. */
  generation: number;
  /** Reads the page again, and with it every section ("Refresh", R5.6). */
  refresh: () => void;
}

/** What the page's read found: the bucket, or none of that name (R5.5). */
export type BucketLookup = ScreenRead<Bucket | NoSuchBucket>;

/** The read of S1, S3 and S4 on opening: `ListBuckets` with the name as prefix (R5.1, R7.1, R8.1). */
export function useBucketLookup(endpoint: string | undefined, name: string): BucketLookup {
  const [generation, setGeneration] = useState(0);
  const read = useFreshRead(endpoint, name, 'find', LIST_BUCKETS, generation, (at, signal) =>
    findBucket(at, name, signal),
  );
  const refresh = useCallback(() => {
    setGeneration((current) => current + 1);
  }, []);
  return { ...read, generation, refresh };
}

/** Each section's read of a bucket's page (R5.3), by the part it reads. */
const PROPERTY_READS = {
  versioning: getBucketVersioning,
  tags: getBucketTagging,
  encryption: getBucketEncryption,
  notifications: getBucketNotificationConfiguration,
  website: getBucketWebsite,
} as const;

/** The operation each section's read sends. */
export const PROPERTY_OPERATIONS: Readonly<Record<BucketProperty, string>> = {
  versioning: OPERATIONS.getBucketVersioning,
  tags: OPERATIONS.getBucketTagging,
  encryption: OPERATIONS.getBucketEncryption,
  notifications: OPERATIONS.getBucketNotificationConfiguration,
  website: OPERATIONS.getBucketWebsite,
};

/** A part of a bucket's configuration that one section reads. */
export type BucketProperty = keyof typeof PROPERTY_READS;

/** What the read of `P` answers: its setting, or `NO_SUCH_BUCKET`. */
export type BucketPropertyValue<P extends BucketProperty> = Awaited<ReturnType<(typeof PROPERTY_READS)[P]>>;

/**
 * The read of one section of a bucket's page, sent at once once `enabled` (when the page found the bucket), and again
 * with every new `generation` of the page and on its own "Retry".
 */
export function useBucketProperty<P extends BucketProperty>(
  endpoint: string | undefined,
  name: string,
  property: P,
  { generation, enabled }: { generation: number; enabled: boolean },
): BucketRead<BucketPropertyValue<P>> {
  return useFreshRead(
    endpoint,
    name,
    property,
    PROPERTY_OPERATIONS[property],
    generation,
    (at, signal) => PROPERTY_READS[property](at, name, signal) as Promise<BucketPropertyValue<P>>,
    enabled,
  );
}

/** Read versioning for the editor, retaining the details of any refusal. */
export function useVersioningEditorStatus(endpoint: string | undefined, name: string) {
  return useFreshRead(endpoint, name, 'versioning', OPERATIONS.getBucketVersioning, 0, (at, signal) =>
    readBucketVersioning(at, name, signal),
  );
}

/** What the delete page reads on opening: the bucket, and whether it is empty. */
export interface BucketToDelete {
  bucket: Bucket;
  empty: boolean;
}

/** The read of S4 on opening (R7.1): `ListBuckets`, then `ListObjectVersions` with one key at most. */
export function useBucketToDelete(
  endpoint: string | undefined,
  name: string,
): ScreenRead<BucketToDelete | NoSuchBucket> {
  const [generation, setGeneration] = useState(0);
  const read = useFreshRead<BucketToDelete | NoSuchBucket>(
    endpoint,
    name,
    'delete',
    LIST_BUCKETS,
    generation,
    async (at, signal) => {
      const bucket = await findBucket(at, name, signal);
      if (bucket === NO_SUCH_BUCKET) {
        return bucket;
      }
      const empty = await isBucketEmpty(at, name, signal);
      return empty === NO_SUCH_BUCKET ? empty : { bucket, empty };
    },
  );
  const refresh = useCallback(() => {
    setGeneration((current) => current + 1);
  }, []);
  return { ...read, generation, refresh };
}

/**
 * Drops every read of S3 Studio holds (R6.8): a read no screen shows is removed, and one still shown is marked
 * stale, so each is read from the emulator again when it is next shown.
 */
function useDropS3Reads(): () => void {
  const client = useQueryClient();
  return useCallback(() => {
    void client.invalidateQueries({ queryKey: S3_KEY, refetchType: 'none' });
    client.removeQueries({ queryKey: S3_KEY, type: 'inactive' });
  }, [client]);
}

/** "Create bucket" of S2 (R6.4): S3's reads are dropped once it has ended, whatever it answered. */
export function useCreateBucket(
  endpoint: string | undefined,
): (form: BucketForm, signal: AbortSignal) => Promise<CreateOutcome> {
  const drop = useDropS3Reads();
  return useCallback(
    async (form, signal) => {
      if (endpoint === undefined) {
        throw new Error('The engine endpoint is not known yet.');
      }
      try {
        return await submitBucketForm(form, createOperations(endpoint), signal);
      } finally {
        drop();
      }
    },
    [endpoint, drop],
  );
}

/** "Delete bucket" of S4 (R7.4): S3's reads are dropped once `DeleteBucket` has ended, whatever it answered. */
export function useDeleteBucket(
  endpoint: string | undefined,
): (name: string, signal: AbortSignal) => Promise<DeleteBucketResult | NoSuchBucket> {
  const drop = useDropS3Reads();
  return useCallback(
    async (name, signal) => {
      if (endpoint === undefined) {
        throw new Error('The engine endpoint is not known yet.');
      }
      try {
        return await deleteBucket(endpoint, name, signal);
      } finally {
        drop();
      }
    },
    [endpoint, drop],
  );
}

/**
 * The two operations of S3's emptying on bucket `name` (R8.3); S3's reads are dropped once each `DeleteObjects`
 * has ended, whatever it answered. `undefined` while the engine's address is not known.
 */
export function useEmptyingOperations(endpoint: string | undefined, name: string): EmptyingOperations | undefined {
  const drop = useDropS3Reads();
  return useMemo(() => {
    if (endpoint === undefined) {
      return undefined;
    }
    return {
      listVersions: (request, signal) => listObjectVersions(endpoint, name, request, signal),
      deleteVersions: async (items, signal) => {
        try {
          return await deleteObjects(endpoint, name, items, signal);
        } finally {
          drop();
        }
      },
    };
  }, [endpoint, name, drop]);
}

// Issue 480, task 2: the reads of an object's page, each a request of its own on every mount, "Refresh" and "Retry",
// under a key that holds the bucket and the key; and task 4: the operations of the delete dialog.

/** What the object page's read found: the object, no such key, or no such bucket. */
export type ObjectLookup = ScreenRead<ObjectHead | NoSuchKey | NoSuchBucket>;

/**
 * The read of the object page on opening: `HeadObject`. Its 404 says neither which is gone, so `ListBuckets` (main's
 * `findBucket`) is asked then: the bucket not listed is `NO_SUCH_BUCKET`, else `NO_SUCH_KEY`.
 */
export function useObjectHead(endpoint: string | undefined, bucket: string, key: string): ObjectLookup {
  const [generation, setGeneration] = useState(0);
  const read = useFreshRead<ObjectHead | NoSuchKey | NoSuchBucket>(
    endpoint,
    bucket,
    ['object', key, 'head'],
    OPERATIONS.headObject,
    generation,
    async (at, signal) => {
      const head = key === '' ? NOT_FOUND : await headObject(at, bucket, key, signal);
      if (head !== NOT_FOUND) {
        return head;
      }
      const found = await findBucket(at, bucket, signal);
      return found === NO_SUCH_BUCKET ? found : NO_SUCH_KEY;
    },
  );
  const refresh = useCallback(() => {
    setGeneration((current) => current + 1);
  }, []);
  return { ...read, generation, refresh };
}

/** The object's tags (`GetObjectTagging`), read once the page found the object, again with each `generation`. */
export function useObjectTags(
  endpoint: string | undefined,
  bucket: string,
  key: string,
  { generation, enabled }: { generation: number; enabled: boolean },
): BucketRead<Tag[] | NoSuchKey | NoSuchBucket> {
  return useFreshRead(
    endpoint,
    bucket,
    ['object', key, 'tags'],
    OPERATIONS.getObjectTagging,
    generation,
    (at, signal) => getObjectTagging(at, bucket, key, signal),
    enabled,
  );
}

/**
 * The preview of the object `head` describes: `GetObject` of its first 64 KiB, asked only for a type shown as text
 * and a size above 0 (`preview.ts`), once the page found the object and again with each `generation`.
 */
export function useObjectPreview(
  endpoint: string | undefined,
  bucket: string,
  head: ObjectHead | undefined,
  { generation }: { generation: number },
): BucketRead<Preview> {
  const key = head?.key ?? '';
  return useFreshRead(
    endpoint,
    bucket,
    ['object', key, 'preview', head?.contentType ?? '', String(head?.size ?? '')],
    OPERATIONS.getObject,
    generation,
    (at, signal) =>
      loadPreview(
        {
          ...(head?.contentType === undefined ? {} : { contentType: head.contentType }),
          ...(head?.size === undefined ? {} : { size: head.size }),
        },
        async (range) => (await getObject(at, bucket, key, signal, range)).bytes,
      ),
    head !== undefined,
  );
}

/** The writes of the object detail, with their affected reads marked stale after each successful write. */
export function useObjectChanges(endpoint: string | undefined) {
  const client = useQueryClient();

  return useMemo(() => {
    if (endpoint === undefined) return undefined;

    return {
      destinationExists: async ({ bucket, key }: ObjectLocation, signal: AbortSignal) =>
        (await headObject(endpoint, bucket, key, signal)) !== NOT_FOUND,
      copy: async (
        source: ObjectLocation,
        destination: ObjectLocation,
        signal: AbortSignal,
        options?: ObjectCopyOptions,
      ) => {
        await copyObject(endpoint, source, destination, signal, options);
        if (!signal.aborted) invalidateObjectReads(client, endpoint, destination);
      },
      removeSource: async (source: ObjectLocation, signal: AbortSignal) => {
        await deleteObject(endpoint, source, signal);
        if (signal.aborted) return;
        invalidateObjectReads(client, endpoint, source);
        void client.invalidateQueries({
          queryKey: [...S3_KEY, 'bucket', source.bucket, 'object', source.key, 'head', endpoint],
        });
      },
    };
  }, [client, endpoint]);
}

function invalidateObjectReads(client: QueryClient, endpoint: string, { bucket, key }: ObjectLocation) {
  void client.invalidateQueries({
    queryKey: [...S3_KEY, 'objects', bucket, endpoint],
    refetchType: 'none',
  });
  void client.invalidateQueries({
    queryKey: [...S3_KEY, 'bucket', bucket, 'object', key],
    refetchType: 'none',
  });
}

/** Write to the current key by copying a version or by removing one specific delete marker. */
export function useChangeObjectVersion(endpoint: string | undefined, bucket: string) {
  const client = useQueryClient();
  return useCallback(
    async ({ kind, key, versionId, etag }: ObjectVersion & { versionId: string }, signal: AbortSignal) => {
      if (endpoint === undefined) throw new Error('The engine endpoint is not known yet.');
      const object = { bucket, key };
      if (kind === 'version') {
        await copyObject(endpoint, object, object, signal, {
          sourceVersionId: versionId,
          ...(etag !== undefined && { sourceETag: etag }),
        });
      } else {
        await deleteObject(endpoint, object, signal, versionId);
      }
      if (!signal.aborted) invalidateObjectReads(client, endpoint, object);
    },
    [bucket, client, endpoint],
  );
}

/** "Download" of the object page: `GetObject` of the whole body. */
export function useDownloadObject(
  endpoint: string | undefined,
  bucket: string,
): (key: string, signal: AbortSignal, versionId?: string, etag?: string) => Promise<ObjectBody> {
  return useCallback(
    (key, signal, versionId, etag) => {
      if (endpoint === undefined) {
        return Promise.reject(new Error('The engine endpoint is not known yet.'));
      }
      return getObject(endpoint, bucket, key, signal, undefined, versionId, etag);
    },
    [endpoint, bucket],
  );
}

/** The bucket's versioning status for the delete dialog, read while `enabled` (the dialog is open). */
export function useDeleteVersioning(
  endpoint: string | undefined,
  bucket: string,
  enabled: boolean,
): BucketRead<BucketPropertyValue<'versioning'>> {
  return useBucketProperty(endpoint, bucket, 'versioning', { generation: 0, enabled });
}

/**
 * The operations of the delete dialog on bucket `bucket` (task 4): a folder's keys page by page, and `DeleteObjects`
 * of keys; S3's reads are dropped once each `DeleteObjects` has ended, whatever it answered. `undefined` while the
 * engine's address is not known.
 */
export function useDeletionOperations(endpoint: string | undefined, bucket: string): DeletionOperations | undefined {
  const drop = useDropS3Reads();
  return useMemo(() => {
    if (endpoint === undefined) {
      return undefined;
    }
    return {
      listKeys: (prefix, token, signal) => listKeys(endpoint, bucket, prefix, token, signal),
      deleteKeys: async (keys, signal) => {
        try {
          return await deleteKeys(endpoint, bucket, keys, signal);
        } finally {
          drop();
        }
      },
    };
  }, [endpoint, bucket, drop]);
}

// Issue 480, task 3: the calls of the Upload page and of "Create folder". S3's reads are dropped once each put has
// ended, whatever it answered, so the Objects tab lists what the emulator now holds.

/** The Upload page's calls on bucket `bucket`; `undefined` while the engine's address is not known. */
export function useUploadOperations(endpoint: string | undefined, bucket: string): UploadOperations | undefined {
  const drop = useDropS3Reads();
  return useMemo(() => {
    if (endpoint === undefined) {
      return undefined;
    }
    const dropping =
      <A extends unknown[], R>(call: (...args: A) => Promise<R>) =>
      async (...args: A): Promise<R> => {
        try {
          return await call(...args);
        } finally {
          drop();
        }
      };
    return {
      putObject: dropping((key: string, body: Uint8Array, contentType: string, signal: AbortSignal) =>
        putObject(endpoint, bucket, key, body, contentType, signal),
      ),
      createMultipartUpload: (key, contentType, signal) =>
        createMultipartUpload(endpoint, bucket, key, contentType, signal),
      uploadPart: (key, uploadId, partNumber, body, signal) =>
        uploadPart(endpoint, bucket, key, uploadId, partNumber, body, signal),
      completeMultipartUpload: dropping(
        (key: string, uploadId: string, parts: Parameters<UploadOperations['completeMultipartUpload']>[2], signal) =>
          completeMultipartUpload(endpoint, bucket, key, uploadId, parts, signal),
      ),
      abortMultipartUpload: (key, uploadId, signal) => abortMultipartUpload(endpoint, bucket, key, uploadId, signal),
    };
  }, [endpoint, bucket, drop]);
}

/**
 * Whether bucket `bucket` holds an object of `key` (`HeadObject`), so the Upload page can say a file replaces it;
 * `undefined` while the engine's address is not known. A failure rejects as it came.
 */
export function useObjectExists(
  endpoint: string | undefined,
  bucket: string,
): ((key: string, signal: AbortSignal) => Promise<boolean>) | undefined {
  return useMemo(
    () =>
      endpoint === undefined
        ? undefined
        : async (key: string, signal: AbortSignal) => (await headObject(endpoint, bucket, key, signal)) !== NOT_FOUND,
    [endpoint, bucket],
  );
}

/** What "Create folder" did: put the folder's empty object, or found the folder there already and put nothing. */
export type CreateFolderOutcome = 'created' | 'exists';

/**
 * "Create folder" `name` under `prefix` of bucket `bucket`: `ListObjectsV2` of `prefix+name+/` with max-keys 1, then,
 * unless it found a key or a common prefix, `PutObject` of the empty object `prefix+name+/`. A failure rejects as it
 * came; S3's reads are dropped once a put has ended.
 */
export function useCreateFolder(
  endpoint: string | undefined,
  bucket: string,
): ((prefix: string, name: string, signal: AbortSignal) => Promise<CreateFolderOutcome>) | undefined {
  const drop = useDropS3Reads();
  return useMemo(() => {
    if (endpoint === undefined) {
      return undefined;
    }
    return async (prefix, name, signal) => {
      const key = `${prefix}${name}/`;
      if (await holdsAnyUnder(endpoint, bucket, key, signal)) {
        return 'exists';
      }
      try {
        await putObject(endpoint, bucket, key, new Uint8Array(), undefined, signal);
      } finally {
        drop();
      }
      return 'created';
    };
  }, [endpoint, bucket, drop]);
}
