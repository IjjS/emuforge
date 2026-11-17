import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { RequestError, type RequestFailure } from '../../../../../lib/aws/request';
import {
  deleteBucket,
  deleteObjects,
  findBucket,
  getBucketAbac,
  getBucketAccelerateConfiguration,
  getBucketEncryption,
  getBucketLogging,
  getBucketNotificationConfiguration,
  getBucketRequestPayment,
  getBucketTagging,
  getBucketVersioning,
  getBucketWebsite,
  getObjectLockConfiguration,
  isBucketEmpty,
  LIST_BUCKETS,
  listBucketIntelligentTieringConfigurations,
  listBuckets,
  listObjectVersions,
  NO_SUCH_BUCKET,
  OPERATIONS,
  type Bucket,
  type BucketPage,
  type DeleteBucketResult,
  type NoSuchBucket,
} from './api';
import { createOperations, submitBucketForm, type BucketForm, type CreateOutcome } from './bucket-form';
import type { EmptyingOperations } from './empty-bucket';

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

/** What the listing learnt from one page's last answer. */
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
function withRead(reads: readonly PageRead[], page: number, answer: BucketPage): readonly PageRead[] {
  const read: PageRead = { count: answer.buckets.length, next: answer.nextToken };
  const before = reads[page];
  const later =
    before !== undefined && before.next === read.next && read.next !== undefined ? reads.slice(page + 1) : [];
  return [...reads.slice(0, page), read, ...later];
}

function failureOf(error: unknown, operation: string = LIST_BUCKETS): RequestFailure {
  return error instanceof RequestError ? error.failure : { kind: 'other', operation, code: String(error) };
}

/**
 * The bucket list of the emulator behind the engine at `endpoint`, one page at a time. A request no longer wanted
 * (another page, a new listing, an unmount) is aborted, and its late answer never replaces a newer one.
 */
export function useBucketListing({ endpoint, pageSize, filter }: BucketListingOptions): BucketListing {
  const [mount] = useState(() => (mounts += 1));
  const [generation, setGeneration] = useState(0);
  const prefix = useSettled(filter, FILTER_DELAY_MS);
  const listing = JSON.stringify([endpoint ?? null, generation, pageSize, prefix]);

  const [stored, setPosition] = useState<Position>(fresh(listing));
  // A change of listing starts at page 1 with no token.
  const position: Position = stored.listing === listing ? stored : fresh(listing);
  const token = position.page === 0 ? undefined : position.reads[position.page - 1]?.next;

  const query = useQuery({
    queryKey: [
      'aws',
      's3',
      'list-buckets',
      endpoint,
      mount,
      generation,
      pageSize,
      prefix,
      position.page,
      token,
      position.visit,
    ],
    queryFn: async ({ signal }) => {
      if (endpoint === undefined) {
        throw new Error('The engine endpoint is not known yet.');
      }
      const page = position.page;
      const answer = await listBuckets(
        endpoint,
        { pageSize, ...(prefix === '' ? {} : { prefix }), ...(token === undefined ? {} : { token }) },
        signal,
      );
      // Kept as this page's last read only while the user is still on it in the same listing.
      setPosition((current) => {
        const at = current.listing === listing ? current : fresh(listing);
        return at.page === page ? { ...at, reads: withRead(at.reads, page, answer) } : current;
      });
      return answer;
    },
    enabled: endpoint !== undefined,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    structuralSharing: false,
  });
  const answer = query.data;

  const reads = answer === undefined ? position.reads : withRead(position.reads, position.page, answer);
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

  const refresh = useCallback(() => {
    setGeneration((current) => current + 1);
  }, []);

  return {
    prefix,
    buckets: answer?.buckets,
    failure: query.isError ? failureOf(query.error) : undefined,
    loading: query.isFetching || (endpoint === undefined && answer === undefined),
    count: last === undefined ? undefined : { total: reads.reduce((sum, read) => sum + read.count, 0), more: openEnd },
    currentPage: position.page + 1,
    pagesCount: Math.max(reads.length, position.page + 1),
    openEnd,
    goToPage,
    refresh,
  };
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
  part: string,
  operation: string,
  generation: number,
  read: (endpoint: string, signal: AbortSignal) => Promise<T>,
  enabled = true,
): BucketRead<T> {
  const [mount] = useState(() => (mounts += 1));
  const [attempt, setAttempt] = useState(0);
  const query = useQuery({
    queryKey: [...S3_KEY, 'bucket', name, part, endpoint, mount, generation, attempt],
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
  abac: getBucketAbac,
  tags: getBucketTagging,
  encryption: getBucketEncryption,
  'intelligent-tiering': listBucketIntelligentTieringConfigurations,
  logging: getBucketLogging,
  notifications: getBucketNotificationConfiguration,
  acceleration: getBucketAccelerateConfiguration,
  'object-lock': getObjectLockConfiguration,
  'request-payment': getBucketRequestPayment,
  website: getBucketWebsite,
} as const;

/** The operation each section's read sends. */
export const PROPERTY_OPERATIONS: Readonly<Record<BucketProperty, string>> = {
  versioning: OPERATIONS.getBucketVersioning,
  abac: OPERATIONS.getBucketAbac,
  tags: OPERATIONS.getBucketTagging,
  encryption: OPERATIONS.getBucketEncryption,
  'intelligent-tiering': OPERATIONS.listBucketIntelligentTieringConfigurations,
  logging: OPERATIONS.getBucketLogging,
  notifications: OPERATIONS.getBucketNotificationConfiguration,
  acceleration: OPERATIONS.getBucketAccelerateConfiguration,
  'object-lock': OPERATIONS.getObjectLockConfiguration,
  'request-payment': OPERATIONS.getBucketRequestPayment,
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
