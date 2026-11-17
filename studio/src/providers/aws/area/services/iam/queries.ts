import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';

import {
  createRole,
  deleteRoles,
  getCallerAccount,
  getRole,
  IamError,
  listPolicies,
  listRoles,
  updateRole,
  type CreatedRole,
  type DeleteResult,
  type IamFailure,
  type NewRole,
  type PageCursor,
  type PageRequest,
  type Policy,
  type Role,
  type RoleRead,
  type RoleToDelete,
  type RoleUpdate,
} from './api';

// The role screens' reads and actions (issue 82, requirement R4.1, R4.4, R4.5, R4.7, R4.9, R5.1, R5.5, R6.3, R6.4,
// R6.7, R7): lists in pages that follow the emulator's marker, a filter that reads on, a new listing at page 1 on
// every refresh, filter, page size and finished delete. Nothing is kept for a later mount and nothing is shown from
// an earlier listing: every read is a request of its own.

/** The filter's text is applied once it has not changed for this long, or at once with Enter (R4.7). */
export const FILTER_DELAY_MS = 300;

/** The policy table's page size in "Create role" (R6.4). */
export const POLICY_PAGE_SIZE = 20;

/** What a listing is asked for. */
export interface ListingOptions {
  /** The engine's address, `http://127.0.0.1:<port>`; nothing is asked while it is not known. */
  endpoint: string | undefined;
  /** The page size, `MaxItems` of every read. */
  pageSize: number;
  /** The filter's text as typed; applied `FILTER_DELAY_MS` after its last change, or by `applyFilter`. */
  filter: string;
  /** Nothing is asked while `false` (the wizard reads its policies when step 2 opens). */
  enabled?: boolean;
}

/** The counter after the title (R4.5): the entries of the pages read, with "+" while more remain. */
export interface ListingCount {
  total: number;
  more: boolean;
}

export interface Listing<T> {
  /** The filter of this listing, its text as last applied; `''` for none. */
  filter: string;
  /** The shown page's entries, in the emulator's order; `undefined` until its answer arrives or when it failed. */
  items: T[] | undefined;
  /** Why the shown page could not be read; `undefined` while it is read or once it is. */
  failure: IamFailure | undefined;
  /** A read of the shown page is in flight. */
  loading: boolean;
  /** `undefined` while no page of this listing has been read. */
  count: ListingCount | undefined;
  /** The shown page, from 1. */
  currentPage: number;
  /** The pages this listing knows of: those read, and the shown one while it is read. */
  pagesCount: number;
  /** The last page read said that more remain. */
  openEnd: boolean;
  /** Shows page `page` (from 1) of this listing, read again; a page this listing cannot reach yet is ignored. */
  goToPage: (page: number) => void;
  /** Starts a new listing at page 1, dropping every marker. */
  refresh: () => void;
  /** Applies the filter's text as typed at once (Enter), without waiting for `FILTER_DELAY_MS`. */
  applyFilter: () => void;
}

/** What the listing learnt from one page's last answer. */
interface PageRead {
  count: number;
  next: PageCursor | undefined;
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

/** A number per mount, so nothing of an earlier mount is ever shown. */
let mounts = 0;

function useMount(): number {
  const [mount] = useState(() => (mounts += 1));
  return mount;
}

/** `value` once it has not changed for `delay` ms, or at once on the returned call. */
function useApplied(value: string, delay: number): [string, () => void] {
  const [applied, setApplied] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => {
      setApplied(value);
    }, delay);
    return () => {
      clearTimeout(timer);
    };
  }, [value, delay]);
  const applyNow = useCallback(() => {
    setApplied(value);
  }, [value]);
  return [applied, applyNow];
}

function sameCursor(a: PageCursor | undefined, b: PageCursor | undefined): boolean {
  return a?.marker === b?.marker && a?.skip === b?.skip;
}

/** `reads` with page `page`'s answer as its last read; the later pages stay only while its cursor is the same. */
function withRead(reads: readonly PageRead[], page: number, read: PageRead): readonly PageRead[] {
  const before = reads[page];
  const later =
    before !== undefined && read.next !== undefined && sameCursor(before.next, read.next) ? reads.slice(page + 1) : [];
  return [...reads.slice(0, page), read, ...later];
}

/** The failure a read rejected with. */
export function failureOf(error: unknown): IamFailure {
  return error instanceof IamError ? error.failure : { kind: 'other', operation: '', code: String(error) };
}

/** The query keys of the IAM screens; every key of an endpoint starts with `iamKey(endpoint)`. */
function iamKey(endpoint: string | undefined) {
  return ['aws', 'iam', endpoint ?? null] as const;
}

/** The role list's generation: one more after each finished delete, so the list starts a new listing (R7). */
function roleListGenerationKey(endpoint: string | undefined) {
  return ['aws', 'iam-role-list-generation', endpoint ?? null] as const;
}

function startNewRoleListing(client: QueryClient, endpoint: string): void {
  client.setQueryData<number>(roleListGenerationKey(endpoint), (current) => (current ?? 0) + 1);
}

function useRoleListGeneration(endpoint: string | undefined): number {
  const client = useQueryClient();
  const key = roleListGenerationKey(endpoint);
  const { data } = useQuery({
    queryKey: key,
    queryFn: () => client.getQueryData<number>(key) ?? 0,
    initialData: 0,
    staleTime: Infinity,
    gcTime: Infinity,
  });
  return data;
}

interface PageAnswer<T> {
  items: T[];
  next?: PageCursor;
}

type ReadPage<T> = (endpoint: string, page: PageRequest, signal: AbortSignal) => Promise<PageAnswer<T>>;

/**
 * A list of the emulator behind the engine at `endpoint`, one page at a time. A request no longer wanted (another
 * page, a new listing, an unmount) is aborted, and its late answer never replaces a newer one.
 */
function usePagedListing<T>(
  name: string,
  read: ReadPage<T>,
  { endpoint, pageSize, filter, enabled = true }: ListingOptions,
  outer: number,
): Listing<T> {
  const mount = useMount();
  const [generation, setGeneration] = useState(0);
  const [applied, applyFilter] = useApplied(filter, FILTER_DELAY_MS);
  const listing = JSON.stringify([endpoint ?? null, outer, generation, pageSize, applied]);

  const [stored, setPosition] = useState<Position>(fresh(listing));
  // A change of listing starts at page 1 with no marker.
  const position: Position = stored.listing === listing ? stored : fresh(listing);
  const from = position.page === 0 ? undefined : position.reads[position.page - 1]?.next;

  const query = useQuery({
    queryKey: [
      ...iamKey(endpoint),
      name,
      mount,
      outer,
      generation,
      pageSize,
      applied,
      position.page,
      from?.marker ?? null,
      from?.skip ?? 0,
      position.visit,
    ],
    queryFn: async ({ signal }) => {
      if (endpoint === undefined) {
        throw new Error('The engine endpoint is not known yet.');
      }
      const page = position.page;
      const answer = await read(
        endpoint,
        { pageSize, ...(applied === '' ? {} : { filter: applied }), ...(from === undefined ? {} : { from }) },
        signal,
      );
      // Kept as this page's last read only while the user is still on it in the same listing.
      setPosition((current) => {
        const at = current.listing === listing ? current : fresh(listing);
        return at.page === page
          ? { ...at, reads: withRead(at.reads, page, { count: answer.items.length, next: answer.next }) }
          : current;
      });
      return answer;
    },
    enabled: enabled && endpoint !== undefined,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    structuralSharing: false,
  });
  const answer = query.data;

  const reads =
    answer === undefined
      ? position.reads
      : withRead(position.reads, position.page, { count: answer.items.length, next: answer.next });
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
    filter: applied,
    items: answer?.items,
    failure: query.isError ? failureOf(query.error) : undefined,
    loading: query.isFetching || (enabled && endpoint === undefined && answer === undefined),
    count: last === undefined ? undefined : { total: reads.reduce((sum, page) => sum + page.count, 0), more: openEnd },
    currentPage: position.page + 1,
    pagesCount: Math.max(reads.length, position.page + 1),
    openEnd,
    goToPage,
    refresh,
    applyFilter,
  };
}

const readRoles: ReadPage<Role> = async (endpoint, page, signal) => {
  const { roles, next } = await listRoles(endpoint, page, signal);
  return next === undefined ? { items: roles } : { items: roles, next };
};

const readPolicies: ReadPage<Policy> = async (endpoint, page, signal) => {
  const { policies, next } = await listPolicies(endpoint, page, signal);
  return next === undefined ? { items: policies } : { items: policies, next };
};

/** The role list (R4): pages of `ListRoles`, each role with its last use; a new listing after a finished delete. */
export function useRoleListing(options: ListingOptions): Listing<Role> {
  const generation = useRoleListGeneration(options.endpoint);
  return usePagedListing('roles', readRoles, options, generation);
}

/** The policy table of "Create role" (R6.4): pages of `ListPolicies` with `Scope` `All`. */
export function usePolicyListing(options: ListingOptions): Listing<Policy> {
  return usePagedListing('policies', readPolicies, options, 0);
}

export interface RoleQuery {
  /** The last answer; `undefined` until it arrives or when the read failed. */
  read: RoleRead | undefined;
  failure: IamFailure | undefined;
  /** A read is in flight. */
  loading: boolean;
  /** Reads the role again (R5.1, "Refresh role"). */
  refresh: () => void;
}

/** A role's page (R5.1): read on opening, on `refresh`, and again after a finished update of the role. */
export function useRole({ endpoint, name }: { endpoint: string | undefined; name: string }): RoleQuery {
  const mount = useMount();
  const query = useQuery({
    queryKey: [...iamKey(endpoint), 'role', name, mount],
    queryFn: ({ signal }) => {
      if (endpoint === undefined) {
        throw new Error('The engine endpoint is not known yet.');
      }
      return getRole(endpoint, name, signal);
    },
    enabled: endpoint !== undefined,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    structuralSharing: false,
  });
  const { refetch } = query;
  const refresh = useCallback(() => {
    void refetch({ cancelRefetch: true });
  }, [refetch]);
  return {
    read: query.data,
    failure: query.isError ? failureOf(query.error) : undefined,
    loading: query.isFetching || (endpoint === undefined && query.data === undefined),
    refresh,
  };
}

export interface CallerAccountQuery {
  /** The caller's account; `undefined` while it is read, when it failed, or when the ARN held none. */
  account: string | undefined;
  failure: IamFailure | undefined;
  loading: boolean;
}

/** "This account" of "Create role" (R6.3): read when `enabled` turns true (the type "AWS account" is chosen). */
export function useCallerAccount({
  endpoint,
  enabled,
}: {
  endpoint: string | undefined;
  enabled: boolean;
}): CallerAccountQuery {
  const mount = useMount();
  const query = useQuery({
    queryKey: [...iamKey(endpoint), 'caller-account', mount],
    queryFn: ({ signal }) => {
      if (endpoint === undefined) {
        throw new Error('The engine endpoint is not known yet.');
      }
      return getCallerAccount(endpoint, signal);
    },
    enabled: enabled && endpoint !== undefined,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
  });
  return {
    account: query.data ?? undefined,
    failure: query.isError ? failureOf(query.error) : undefined,
    loading: query.isFetching || (enabled && endpoint === undefined),
  };
}

function knownEndpoint(endpoint: string | undefined): string {
  if (endpoint === undefined) {
    throw new Error('The engine endpoint is not known yet.');
  }
  return endpoint;
}

/** What "Save changes" sends: the change, and the maximum session duration the page read. */
export interface RoleUpdateRequest extends RoleUpdate {
  readMaxSessionDuration: number | undefined;
}

/**
 * Reads again every open page of the role `name`, whatever the case of the name it was opened with: a page's address
 * may differ in case from the emulator's `RoleName`, and the emulator matches names ignoring case (R2, R5.1).
 */
function invalidateRole(client: QueryClient, endpoint: string | undefined, name: string): Promise<void> {
  const wanted = name.toLowerCase();
  return client.invalidateQueries({
    queryKey: [...iamKey(endpoint), 'role'],
    predicate: ({ queryKey }) => typeof queryKey[4] === 'string' && queryKey[4].toLowerCase() === wanted,
  });
}

/**
 * "Save changes" of "Edit summary" (R5.5). Once it is finished the role is read again; a listing started afterwards
 * asks the engine again, as every listing does. Rejects with `IamError`.
 */
export function useUpdateRole(endpoint: string | undefined) {
  const client = useQueryClient();
  return useMutation<undefined, unknown, RoleUpdateRequest>({
    mutationFn: async ({ readMaxSessionDuration, ...update }) => {
      await updateRole(knownEndpoint(endpoint), update, readMaxSessionDuration, new AbortController().signal);
      return undefined;
    },
    onSettled: (_data, _error, { name }) => invalidateRole(client, endpoint, name),
  });
}

/**
 * "Create role" (R6.7); resolves with what was created and which attachments failed, rejects with `IamError`. A page
 * of the role open for that name, in any case, reads it again.
 */
export function useCreateRole(endpoint: string | undefined) {
  const client = useQueryClient();
  return useMutation<CreatedRole, unknown, NewRole>({
    mutationFn: (role) => createRole(knownEndpoint(endpoint), role, new AbortController().signal),
    onSettled: (_data, _error, { name }) => invalidateRole(client, endpoint, name),
  });
}

/** "Delete" of the role list (R7); once it is finished, the role list starts a new listing at page 1. */
export function useDeleteRoles(endpoint: string | undefined) {
  const client = useQueryClient();
  return useMutation<DeleteResult, unknown, readonly RoleToDelete[]>({
    mutationFn: (roles) => deleteRoles(knownEndpoint(endpoint), roles, new AbortController().signal),
    onSettled: () => {
      if (endpoint !== undefined) {
        startNewRoleListing(client, endpoint);
      }
    },
  });
}
