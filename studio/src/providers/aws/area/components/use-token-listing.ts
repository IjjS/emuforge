import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

import { RequestError, type RequestFailure } from '../../../../lib/aws/request';

// A list read one page at a time by the API's own token, as a table shows it (issue 553, design "What is shared"):
// its pages, the open end, "next" and "previous", refresh, a further page that comes back empty as the list's end,
// and a late answer dropped. Lifted into the area from SNS's listing when EC2 became a further service to need it
// (`aws-area.md`, point 9). It names no service: a service hands it its key, its operation and its page reader.

/** The failure of a rejected read or action of `operation`, in the kinds the area's states are shown from. */
export function failureOf(error: unknown, operation: string): RequestFailure {
  return error instanceof RequestError ? error.failure : { kind: 'other', operation, code: String(error) };
}

/** What a read asked before the engine's address is known throws; such a read is never enabled. */
export function noEndpoint(): never {
  throw new Error('The engine endpoint is not known yet.');
}

/**
 * A signal for an action of a page: aborted once the page is left, so an action's answer changes nothing shown after
 * it.
 */
export function usePageSignal(): () => AbortSignal {
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    controller.current = new AbortController();
    return () => {
      controller.current?.abort();
      controller.current = null;
    };
  }, []);
  return useCallback(() => {
    if (controller.current === null) {
      controller.current = new AbortController();
    }
    return controller.current.signal;
  }, []);
}

/** One page as the API answered it: its items in the API's order, and its token when the API gave one. */
export interface TokenPage<T> {
  items: T[];
  next?: string;
}

/** One listing of pages by token, as a table shows it. */
export interface TokenListing<T> {
  /** The shown page's items, in the API's order; `undefined` until its answer arrives or when it failed. */
  items: T[] | undefined;
  /** Why the shown page's read failed. */
  failure: RequestFailure | undefined;
  /** The shown page is read with nothing of it shown yet, or waits for the engine's address. */
  loading: boolean;
  /** The shown page, from 1. */
  currentPage: number;
  /** The pages this listing knows of: those read, and the shown one while it is read. */
  pagesCount: number;
  /** The last page read carried a token: a next page follows. */
  openEnd: boolean;
  /** The shown page is a further page that came back empty: the list's end, not an empty list. */
  pastEnd: boolean;
  /** Shows page `page` (from 1), read again; a page this listing has no token for is ignored. */
  goToPage: (page: number) => void;
  /** Reads the shown page again with the token it was reached by, keeping the page and the tokens ("Refresh"). */
  refresh: () => void;
}

export interface TokenListingOptions<T> {
  /**
   * The listing's key: the service's key, what it lists and every filter. A changed key is another listing, which
   * starts from its first page.
   */
  key: readonly unknown[];
  /** The engine's address; nothing is read until it is known. */
  endpoint: string | undefined;
  /** Whether the listing reads at all. */
  enabled?: boolean;
  /** The operation a failure is named by. */
  operation: string;
  /** One page: the API's answer for `token`, none for the first page. */
  read: (endpoint: string, token: string | undefined, signal: AbortSignal) => Promise<TokenPage<T>>;
  /**
   * After a page is read, how long until the same page is read again with the same token, or `false` for not
   * again: a page whose items still change by themselves is read again in place, its page and tokens kept.
   */
  readAgainAfter?: (items: readonly T[]) => number | false;
}

/** Where the user is in one listing: the shown page, and the token each page read gave, from page 0. */
interface Position {
  listing: string;
  page: number;
  /** One more on every move, so a page shown again is read again. */
  visit: number;
  tokens: readonly (string | undefined)[];
}

/** A number per mount, so a read of an earlier mount is never shown. */
let mounts = 0;

function fresh(listing: string): Position {
  return { listing, page: 0, visit: 0, tokens: [] };
}

/** `tokens` with page `page`'s answer; the later pages are kept only while its token is the same. */
function withToken(tokens: readonly (string | undefined)[], page: number, next: string | undefined) {
  const later = tokens[page] === next && next !== undefined ? tokens.slice(page + 1) : [];
  return [...tokens.slice(0, page), next, ...later];
}

/** The listing of `key`, a page of `read` at a time on the API's own tokens. */
export function useTokenListing<T>({
  key,
  endpoint,
  enabled = true,
  operation,
  read,
  readAgainAfter,
}: TokenListingOptions<T>): TokenListing<T> {
  const [mount] = useState(() => (mounts += 1));
  const listing = JSON.stringify([...key, endpoint ?? null]);
  const [stored, setPosition] = useState<Position>(fresh(listing));
  const position = stored.listing === listing ? stored : fresh(listing);
  const token = position.page === 0 ? undefined : position.tokens[position.page - 1];
  const active = enabled && endpoint !== undefined;

  const query = useQuery({
    queryKey: [...key, endpoint, mount, position.page, token, position.visit],
    queryFn: async ({ signal }) => {
      if (endpoint === undefined) {
        noEndpoint();
      }
      const page = position.page;
      const answer = await read(endpoint, token, signal);
      // Kept as this page's token only while the user is still on it in the same listing.
      setPosition((current) => {
        const at = current.listing === listing ? current : fresh(listing);
        return at.page === page ? { ...at, tokens: withToken(at.tokens, page, answer.next) } : current;
      });
      return answer;
    },
    enabled: active,
    refetchInterval: (current) => {
      const items = current.state.data?.items;
      return readAgainAfter === undefined || items === undefined || current.state.status === 'error'
        ? false
        : readAgainAfter(items);
    },
    refetchIntervalInBackground: true,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    structuralSharing: false,
  });
  const answer = query.isError ? undefined : query.data;
  const tokens = answer === undefined ? position.tokens : withToken(position.tokens, position.page, answer.next);
  const openEnd = tokens.length > 0 && tokens[tokens.length - 1] !== undefined;

  const goToPage = useCallback(
    (page: number) => {
      setPosition((current) => {
        const at = current.listing === listing ? current : fresh(listing);
        const index = page - 1;
        const known = index === 0 || at.tokens[index - 1] !== undefined;
        return Number.isInteger(index) && index >= 0 && known ? { ...at, page: index, visit: at.visit + 1 } : current;
      });
    },
    [listing, setPosition],
  );
  const refresh = useCallback(() => {
    setPosition((current) => {
      const at = current.listing === listing ? current : fresh(listing);
      return { ...at, visit: at.visit + 1 };
    });
  }, [listing, setPosition]);

  return {
    items: answer?.items,
    failure: query.isError ? failureOf(query.error, operation) : undefined,
    loading: (active && answer === undefined && !query.isError) || (enabled && endpoint === undefined),
    currentPage: position.page + 1,
    pagesCount: Math.max(tokens.length, position.page + 1),
    openEnd,
    pastEnd: position.page > 0 && answer !== undefined && answer.items.length === 0,
    goToPage,
    refresh,
  };
}
