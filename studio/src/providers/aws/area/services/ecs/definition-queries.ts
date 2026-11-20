import { useQuery } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

import { failureOf, noEndpoint, useTokenListing, type TokenListing } from '../../components/use-token-listing';
import {
  DEFINITION_OPERATIONS,
  getRevision,
  listFamilies,
  listRevisions,
  type RevisionRead,
  type RevisionRow,
  type RevisionStatus,
} from './definition-api';
import { ECS_KEYS, type EcsRead } from './queries';

// The TanStack Query hooks of S7 to S9 (issue 575, design task 4), under s1's roots of `queries.ts`, so a register
// reads them again by those roots. Every read is a request of its own on every mount, "Refresh" and "Retry", under a
// key that holds every filter and token; a read no longer wanted is aborted, and its late answer changes nothing shown.

/** S7: the active families, a page at a time on the API's tokens; a changed prefix starts from page 1. */
export function useFamilyListing(endpoint: string | undefined, prefix: string): TokenListing<string> {
  return useTokenListing({
    key: ECS_KEYS.families(prefix),
    endpoint,
    operation: DEFINITION_OPERATIONS.listTaskDefinitionFamilies,
    read: async (at, token, signal) => {
      const page = await listFamilies(at, prefix, token, signal);
      return page.nextToken === undefined ? { items: page.items } : { items: page.items, next: page.nextToken };
    },
  });
}

/** S8: the revisions of `family` of `status`, the newest first, a page at a time; a changed status starts from page 1. */
export function useRevisionListing(
  endpoint: string | undefined,
  family: string,
  status: RevisionStatus,
): TokenListing<RevisionRow> {
  return useTokenListing({
    key: ECS_KEYS.familyRevisions(family, status),
    endpoint,
    operation: DEFINITION_OPERATIONS.listTaskDefinitions,
    read: async (at, token, signal) => {
      const page = await listRevisions(at, family, status, token, signal);
      return page.nextToken === undefined ? { items: page.items } : { items: page.items, next: page.nextToken };
    },
  });
}

/** A number per mount, so a read of an earlier mount is never shown. */
let mounts = 0;

/** What a read of the newest revision of a status answered: that revision, or `null` when there is none. */
export type NewestRevision = RevisionRow | null;

/**
 * S8's read of the newest revision of `family` of `status` by itself (`maxResults` 1): the newest active one
 * "Register new revision" leads from, and whether the status not shown holds any. Reads only while `enabled`.
 */
export function useNewestRevision(
  endpoint: string | undefined,
  family: string,
  status: RevisionStatus,
  enabled: boolean,
): EcsRead<NewestRevision> {
  const [mount] = useState(() => (mounts += 1));
  const [generation, setGeneration] = useState(0);
  const query = useQuery({
    queryKey: [...ECS_KEYS.familyRevisions(family, 'newest', status), endpoint, mount, generation],
    queryFn: async ({ signal }) => {
      if (endpoint === undefined) {
        noEndpoint();
      }
      const page = await listRevisions(endpoint, family, status, undefined, signal, 1);
      return page.items[0] ?? null;
    },
    enabled: enabled && endpoint !== undefined,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    structuralSharing: false,
  });
  const refresh = useCallback(() => {
    setGeneration((current) => current + 1);
  }, []);
  const value = query.isError ? undefined : query.data;
  return {
    value,
    failure: query.isError ? failureOf(query.error, DEFINITION_OPERATIONS.listTaskDefinitions) : undefined,
    loading: enabled && (endpoint === undefined || (value === undefined && !query.isError)),
    refresh,
  };
}

/**
 * S9's read of the revision `revision` of `family`: the revision, or "not found". A number that is no revision's (not
 * a whole number from 1) is "not found" without a request.
 */
export function useRevision(endpoint: string | undefined, family: string, revision: number): EcsRead<RevisionRead> {
  const valid = Number.isInteger(revision) && revision > 0;
  const [mount] = useState(() => (mounts += 1));
  const [generation, setGeneration] = useState(0);
  const query = useQuery({
    queryKey: [...ECS_KEYS.revision(family, revision), endpoint, mount, generation],
    queryFn: ({ signal }) => (endpoint === undefined ? noEndpoint() : getRevision(endpoint, family, revision, signal)),
    enabled: valid && endpoint !== undefined,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    structuralSharing: false,
  });
  const refresh = useCallback(() => {
    setGeneration((current) => current + 1);
  }, []);
  if (!valid) {
    return { value: { found: false }, failure: undefined, loading: false, refresh };
  }
  const value = query.isError ? undefined : query.data;
  return {
    value,
    failure: query.isError ? failureOf(query.error, DEFINITION_OPERATIONS.describeTaskDefinition) : undefined,
    loading: endpoint === undefined || (value === undefined && !query.isError),
    refresh,
  };
}
