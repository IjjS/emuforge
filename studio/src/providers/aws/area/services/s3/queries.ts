import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';

import { RequestError, type RequestFailure } from '../../../../../lib/aws/request';
import { LIST_BUCKETS, listBuckets, type Bucket, type BucketPage } from './api';

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

function failureOf(error: unknown): RequestFailure {
  return error instanceof RequestError
    ? error.failure
    : { kind: 'other', operation: LIST_BUCKETS, code: String(error) };
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
