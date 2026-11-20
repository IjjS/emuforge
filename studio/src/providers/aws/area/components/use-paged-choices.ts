import { useInfiniteQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';

import type { RequestFailure } from '../../../../lib/aws/request';
import { failureOf, noEndpoint, type TokenPage } from './use-token-listing';

// The choices of a form's field read a page at a time by the API's own token and added up (issue 553, design "What
// is shared"): nothing is read before the field first opens; "more" reads the next page on the last page's token;
// a further page that comes back empty adds nothing and ends the list; a changed text, once it has settled, starts
// again from the first page, and an answer for an earlier text is never shown; a failed page is kept apart from the
// choices read, which stay. Lifted into the area from SNS's choices when EC2 became a further service to need them
// (`aws-area.md`, point 9). It names no service: a service hands it a source, its key, its operation and its reader.

/** A typed text is sent once it has not changed for this long. */
export const FILTER_DELAY_MS = 300;

/** A choice as the field shows it: the value it is matched by, its label and its further values. */
export interface ChoiceOption {
  value: string;
  label: string;
  description?: string;
  tags?: string[];
}

/**
 * What the field does with a typed text: `sent` sends it to the reader as the API's filter, `local` narrows the
 * choices read, `none` takes no typed text.
 */
export type ChoiceFiltering = 'sent' | 'local' | 'none';

/** Where a field's choices come from. */
export interface ChoiceSource<T> {
  /** The service's key of these choices, every filter of the source in it; another key is another list. */
  key: readonly unknown[];
  /** The engine's address; nothing is read before it is known. */
  endpoint: string | undefined;
  /** The operation a failure is named by. */
  operation: string;
  /** What a typed text does; `none` when not given. */
  filtering?: ChoiceFiltering | undefined;
  /** `false` while the source cannot read yet (what it filters by is still read): shown loading, nothing asked. */
  ready?: boolean | undefined;
  /** One page: the answer for `text` (`''` for none) and `token` (none for the first page). */
  read: (endpoint: string, text: string, token: string | undefined, signal: AbortSignal) => Promise<TokenPage<T>>;
  /** Each choice as the field shows it. */
  optionOf: (choice: T) => ChoiceOption;
}

/** A field's choices, as many pages as read so far. */
export interface PagedChoices<T> {
  /** Every page read so far in the API's order; `undefined` until the first arrives. */
  choices: T[] | undefined;
  /** Why the last page's read failed; the choices read before it are kept. */
  failure: RequestFailure | undefined;
  /** A page is in flight, or the source waits to read (the engine's address, what it filters by). */
  loading: boolean;
  /** The last page read carried a token and was not an empty further page: more follow. */
  more: boolean;
  /** The text the choices shown were read for (`''` for none, and always for a source that sends none). */
  text: string;
  /** Reads the next page on the last page's token. */
  loadMore: () => void;
  /** After a failure: the page that failed, again, the first or a further one. */
  retry: () => void;
}

/** A number per mount, so a read of an earlier mount is never shown. */
let mounts = 0;

/** `value`, once it has not changed for `delay` ms. */
function useSettled(value: string, delay: number): string {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    if (value === settled) {
      return undefined;
    }
    const timer = setTimeout(() => {
      setSettled(value);
    }, delay);
    return () => {
      clearTimeout(timer);
    };
  }, [value, settled, delay]);
  return settled;
}

/**
 * The choices of `source` for a field that has `opened` at least once, with `text` typed in it. The first page is
 * read when the field is first opened, never before.
 */
export function usePagedChoices<T>(source: ChoiceSource<T>, opened: boolean, text: string): PagedChoices<T> {
  const { key, endpoint, operation, read, filtering = 'none', ready = true } = source;
  const [mount] = useState(() => (mounts += 1));
  const [generation, setGeneration] = useState(0);
  const settled = useSettled(filtering === 'sent' ? text : '', FILTER_DELAY_MS);
  const enabled = opened && ready && endpoint !== undefined;

  const query = useInfiniteQuery({
    queryKey: [...key, settled, endpoint, mount, generation],
    queryFn: ({ signal, pageParam }) =>
      endpoint === undefined ? noEndpoint() : read(endpoint, settled, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    // A further page that came back empty is the list's end, whatever token it carried.
    getNextPageParam: (last, pages) => (pages.length > 1 && last.items.length === 0 ? undefined : last.next),
    enabled,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    structuralSharing: false,
  });
  const { hasNextPage, isFetching, fetchNextPage, data } = query;

  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetching) {
      void fetchNextPage();
    }
  }, [hasNextPage, isFetching, fetchNextPage]);
  const retry = useCallback(() => {
    if (data === undefined) {
      setGeneration((current) => current + 1);
    } else if (!isFetching) {
      void fetchNextPage();
    }
  }, [data, isFetching, fetchNextPage]);

  const waiting = opened && (!ready || endpoint === undefined);
  return {
    choices: data?.pages.flatMap((page) => page.items),
    failure: query.isError && !isFetching ? failureOf(query.error, operation) : undefined,
    loading: isFetching || waiting,
    more: hasNextPage,
    text: settled,
    loadMore,
    retry,
  };
}
