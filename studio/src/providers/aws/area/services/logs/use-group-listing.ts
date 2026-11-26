import type { LogGroup } from '@aws-sdk/client-cloudwatch-logs';
import { useEffect, useState } from 'react';

import { useTokenListing, type TokenListing } from '../../components/use-token-listing';
import { listLogGroups, OPERATIONS } from './api';
import { LOGS_KEYS } from './queries';

interface PopulatedPage {
  number: number;
  items: LogGroup[];
}

interface ListingState {
  key: string;
  filterVisit: number;
  kept?: PopulatedPage;
  endedAt?: number | undefined;
}

export interface GroupListing extends TokenListing<LogGroup> {
  endedHere: boolean;
}

export function useGroupListing(endpoint: string | undefined, pattern: string): GroupListing {
  const key = JSON.stringify([endpoint, pattern]);
  const [stored, setStored] = useState<ListingState>({ key, filterVisit: 0 });
  // A return to a recent filter starts fresh even if the intervening filter never answered.
  const state = stored.key === key ? stored : { key, filterVisit: stored.filterVisit + 1 };
  const listing = useTokenListing({
    key: [...LOGS_KEYS.groups(pattern), state.filterVisit],
    endpoint,
    operation: OPERATIONS.describeLogGroups,
    read: (at, token, signal) => listLogGroups(at, pattern, token, signal),
  });

  const { currentPage, goToPage, items, loading, pastEnd } = listing;
  const { kept, endedAt } = state;
  const furtherThanKept = kept !== undefined && currentPage > kept.number;
  const returnTo = furtherThanKept && pastEnd ? kept.number : undefined;

  if (returnTo !== undefined && endedAt !== returnTo) {
    setStored({ ...state, endedAt: returnTo });
  } else if (items !== undefined && items.length > 0 && (kept?.items !== items || kept.number !== currentPage)) {
    setStored({ ...state, kept: { number: currentPage, items } });
  } else if (stored.key !== key) {
    setStored(state);
  }

  useEffect(() => {
    if (returnTo !== undefined) goToPage(returnTo);
  }, [goToPage, returnTo]);

  const showKept =
    kept !== undefined && (returnTo !== undefined || (loading && (furtherThanKept || currentPage === endedAt)));
  const shownPage = showKept ? kept.number : currentPage;
  const endedHere = endedAt === shownPage;

  return {
    ...listing,
    items: showKept ? kept.items : items,
    loading: loading || returnTo !== undefined,
    currentPage: shownPage,
    pagesCount: endedAt === undefined ? listing.pagesCount : Math.min(listing.pagesCount, endedAt),
    openEnd: listing.openEnd && (endedAt === undefined || shownPage < endedAt),
    pastEnd: endedHere,
    endedHere,
    goToPage: (page) => {
      if (endedAt === undefined || page <= endedAt) goToPage(page);
    },
    refresh: () => {
      if (endedAt !== undefined) setStored({ ...state, endedAt: undefined });
      listing.refresh();
    },
  };
}
