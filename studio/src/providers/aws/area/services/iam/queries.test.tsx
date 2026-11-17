import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { engineEndpoint } from '../../../../../lib/aws/client-factory';
import {
  FILTER_DELAY_MS,
  useDeleteRoles,
  useRole,
  useRoleListing,
  useUpdateRole,
  type ListingOptions,
} from './queries';

// Test criteria, "Unit — providers/aws/area/services/iam/queries.test.tsx" (issue 82, requirement R4.1, R4.4, R4.5,
// R4.7, R4.9, R5.5). The test plays the engine behind the page's `fetch`. Each `ListRoles` waits until the case
// answers it, so a case decides the order in which answers arrive; every other operation is answered at once.

interface SentRequest {
  action: string;
  params: URLSearchParams;
  signal: AbortSignal;
  answer: (names: string[], marker?: string) => void;
}

function ok(action: string, result: string): string {
  return `<${action}Response><${action}Result>${result}</${action}Result></${action}Response>`;
}

function roleXml(name: string): string {
  return `<Path>/</Path><RoleName>${name}</RoleName><RoleId>AROA1</RoleId><Arn>arn:aws:iam::000000000000:role/${name}</Arn><CreateDate>2026-11-17T09:05:03Z</CreateDate>`;
}

function listAnswer(names: string[], marker?: string): string {
  const members = names.map((name) => `<member>${roleXml(name)}</member>`).join('');
  const truncation =
    marker === undefined
      ? '<IsTruncated>false</IsTruncated>'
      : `<IsTruncated>true</IsTruncated><Marker>${marker}</Marker>`;
  return ok('ListRoles', `<Roles>${members}</Roles>${truncation}`);
}

/** The answers of every operation but `ListRoles`. */
function autoAnswer(action: string, params: URLSearchParams): string {
  switch (action) {
    case 'GetRole':
      return ok('GetRole', `<Role>${roleXml(params.get('RoleName') ?? '')}<RoleLastUsed/></Role>`);
    case 'ListAttachedRolePolicies':
      return ok(action, '<AttachedPolicies/><IsTruncated>false</IsTruncated>');
    case 'ListRolePolicies':
      return ok(action, '<PolicyNames/><IsTruncated>false</IsTruncated>');
    default:
      return ok(action, '');
  }
}

class FakeEngine {
  readonly sent: SentRequest[] = [];

  readonly fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    if (url.pathname === '/__emuforge/session') {
      return new Response(JSON.stringify({ token: 'emuforge-test-token-82' }), { status: 200 });
    }
    const params = new URLSearchParams(await request.text());
    const action = params.get('Action') ?? '';
    return new Promise((resolve) => {
      const sent: SentRequest = {
        action,
        params,
        signal: request.signal,
        answer: (names, marker) => {
          resolve(new Response(listAnswer(names, marker), { status: 200 }));
        },
      };
      this.sent.push(sent);
      if (action !== 'ListRoles') {
        resolve(new Response(autoAnswer(action, params), { status: 200 }));
      }
    });
  };

  of(action: string): SentRequest[] {
    return this.sent.filter((request) => request.action === action);
  }

  /** The n-th `ListRoles` (from 0), once it has been sent. */
  async list(n: number): Promise<SentRequest> {
    await waitFor(() => {
      expect(this.of('ListRoles').length).toBeGreaterThan(n);
    });
    return this.of('ListRoles')[n] as SentRequest;
  }
}

function names(count: number, from: string): string[] {
  return Array.from({ length: count }, (_, index) => `${from}-${String(index + 1)}`);
}

let nextPort = 8860;
let engine: FakeEngine;
let endpoint: string;
let client: QueryClient;

beforeEach(() => {
  engine = new FakeEngine();
  vi.stubGlobal('fetch', engine.fetch);
  nextPort += 1;
  endpoint = engineEndpoint(nextPort);
  // As Studio's query client: nothing retried or refetched behind the screen's back.
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false } },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  client.clear();
});

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function renderListing(options: Partial<ListingOptions> = {}) {
  return renderHook(
    (props: ListingOptions) => ({ listing: useRoleListing(props), remove: useDeleteRoles(props.endpoint) }),
    { initialProps: { endpoint, pageSize: 2, filter: '', ...options }, wrapper },
  );
}

type Rendered = ReturnType<typeof renderListing>['result'];

function shown(result: Rendered): string[] | undefined {
  return result.current.listing.items?.map((role) => role.name);
}

/** Answers page 1 and goes to page 2, answered too; leaves the listing on page 2. */
async function onPageTwo(result: Rendered) {
  (await engine.list(0)).answer(names(2, 'p1'), 'marker-1');
  await waitFor(() => {
    expect(shown(result)).toEqual(['p1-1', 'p1-2']);
  });
  act(() => {
    result.current.listing.goToPage(2);
  });
  const second = await engine.list(1);
  expect(second.params.get('Marker')).toBe('marker-1');
  second.answer(names(2, 'p2'), 'marker-2');
  await waitFor(() => {
    expect(shown(result)).toEqual(['p2-1', 'p2-2']);
  });
  expect(result.current.listing.currentPage).toBe(2);
}

describe('a listing', () => {
  it('asks for page 1 and gives nothing of an earlier listing while it is in flight', async () => {
    const { result } = renderListing();

    const first = await engine.list(0);
    expect(first.params.get('MaxItems')).toBe('2');
    expect(first.params.has('Marker')).toBe(false);
    expect(result.current.listing.loading).toBe(true);
    expect(result.current.listing.items).toBeUndefined();
    expect(result.current.listing.count).toBeUndefined();

    first.answer(['earlier-1', 'earlier-2']);
    await waitFor(() => {
      expect(shown(result)).toEqual(['earlier-1', 'earlier-2']);
    });

    act(() => {
      result.current.listing.refresh();
    });
    const second = await engine.list(1);
    expect(second.params.has('Marker')).toBe(false);
    expect(result.current.listing.loading).toBe(true);
    expect(result.current.listing.items).toBeUndefined();
    expect(result.current.listing.count).toBeUndefined();

    second.answer(['later-1']);
    await waitFor(() => {
      expect(shown(result)).toEqual(['later-1']);
    });
    expect(result.current.listing.count).toEqual({ total: 1, more: false });
  });

  it('asks the next page with the marker of the page shown and counts both pages, "+" until the last', async () => {
    const { result } = renderListing();
    (await engine.list(0)).answer(names(2, 'p1'), 'marker-1');
    await waitFor(() => {
      expect(result.current.listing.count).toEqual({ total: 2, more: true });
    });
    expect(result.current.listing.openEnd).toBe(true);

    act(() => {
      result.current.listing.goToPage(2);
    });
    const second = await engine.list(1);
    expect(second.params.get('Marker')).toBe('marker-1');
    second.answer(['p2-1']);

    await waitFor(() => {
      expect(result.current.listing.count).toEqual({ total: 3, more: false });
    });
    expect(result.current.listing.openEnd).toBe(false);
    expect(result.current.listing.pagesCount).toBe(2);
  });

  it('asks for page 1 again on the way back and counts it as last read', async () => {
    const { result } = renderListing();
    await onPageTwo(result);
    expect(result.current.listing.count).toEqual({ total: 4, more: true });

    act(() => {
      result.current.listing.goToPage(1);
    });
    const again = await engine.list(2);
    expect(again.params.has('Marker')).toBe(false);
    again.answer(['p1-1'], 'marker-1');

    await waitFor(() => {
      expect(shown(result)).toEqual(['p1-1']);
    });
    expect(result.current.listing.count).toEqual({ total: 3, more: true });
  });
});

describe('a new listing at page 1, markers dropped', () => {
  it('starts on refresh', async () => {
    const { result } = renderListing();
    await onPageTwo(result);

    act(() => {
      result.current.listing.refresh();
    });

    const next = await engine.list(2);
    expect(next.params.has('Marker')).toBe(false);
    expect(result.current.listing.currentPage).toBe(1);
    expect(result.current.listing.count).toBeUndefined();
  });

  it('starts when a filter is applied, and when it is removed', async () => {
    const { result, rerender } = renderListing();
    await onPageTwo(result);

    rerender({ endpoint, pageSize: 2, filter: 'p' });
    act(() => {
      result.current.listing.applyFilter();
    });
    const filtered = await engine.list(2);
    expect(filtered.params.has('Marker')).toBe(false);
    expect(result.current.listing.currentPage).toBe(1);
    expect(result.current.listing.filter).toBe('p');
    filtered.answer(['p-1']);
    await waitFor(() => {
      expect(shown(result)).toEqual(['p-1']);
    });

    rerender({ endpoint, pageSize: 2, filter: '' });
    act(() => {
      result.current.listing.applyFilter();
    });
    const cleared = await engine.list(3);
    expect(cleared.params.has('Marker')).toBe(false);
    expect(result.current.listing.filter).toBe('');
  });

  it('starts with a new page size', async () => {
    const { result, rerender } = renderListing();
    await onPageTwo(result);

    rerender({ endpoint, pageSize: 10, filter: '' });

    const next = await engine.list(2);
    expect(next.params.has('Marker')).toBe(false);
    expect(next.params.get('MaxItems')).toBe('10');
    expect(result.current.listing.currentPage).toBe(1);
  });

  it('starts after a finished delete', async () => {
    const { result } = renderListing();
    await onPageTwo(result);

    await act(async () => {
      await result.current.remove.mutateAsync([{ name: 'AWSServiceRoleForX', path: '/aws-service-role/x/' }]);
    });

    const next = await engine.list(2);
    expect(engine.of('DeleteServiceLinkedRole')).toHaveLength(1);
    expect(next.params.has('Marker')).toBe(false);
    expect(result.current.listing.currentPage).toBe(1);
  });
});

describe('a filter', () => {
  it('applies the text 300 ms after the last change, as one listing', async () => {
    const { result, rerender } = renderListing();
    (await engine.list(0)).answer(['ab-1']);
    await waitFor(() => {
      expect(shown(result)).toEqual(['ab-1']);
    });

    rerender({ endpoint, pageSize: 2, filter: 'a' });
    rerender({ endpoint, pageSize: 2, filter: 'ab' });
    expect(result.current.listing.filter).toBe('');
    await new Promise((resolve) => setTimeout(resolve, FILTER_DELAY_MS / 2));
    expect(engine.of('ListRoles')).toHaveLength(1);

    await waitFor(() => {
      expect(result.current.listing.filter).toBe('ab');
    });
    await engine.list(1);
    await new Promise((resolve) => setTimeout(resolve, FILTER_DELAY_MS));
    expect(engine.of('ListRoles')).toHaveLength(2);
  });

  it('asks page 1 with the text, and the next page from where the page shown ended, with the same text', async () => {
    const { result, rerender } = renderListing();
    (await engine.list(0)).answer([]);
    rerender({ endpoint, pageSize: 2, filter: 'ab' });
    act(() => {
      result.current.listing.applyFilter();
    });

    // Page 1 fills inside the emulator's second page, which has one more match.
    const first = await engine.list(1);
    expect(first.params.has('Marker')).toBe(false);
    first.answer(['ab-1', 'cd'], 'marker-1');
    const second = await engine.list(2);
    expect(second.params.get('Marker')).toBe('marker-1');
    second.answer(['xab-2', 'zz', 'AB-3']);
    await waitFor(() => {
      expect(shown(result)).toEqual(['ab-1', 'xab-2']);
    });
    expect(result.current.listing.count).toEqual({ total: 2, more: true });

    act(() => {
      result.current.listing.goToPage(2);
    });
    const next = await engine.list(3);
    expect(next.params.get('Marker')).toBe('marker-1');
    next.answer(['xab-2', 'zz', 'AB-3']);
    await waitFor(() => {
      expect(shown(result)).toEqual(['AB-3']);
    });
    expect(result.current.listing.filter).toBe('ab');
    expect(result.current.listing.count).toEqual({ total: 3, more: false });
  });
});

describe('late and unwanted answers', () => {
  it('keeps the later listing when the earlier one answers after it, and aborts the earlier request', async () => {
    const { result } = renderListing();
    const earlier = await engine.list(0);

    act(() => {
      result.current.listing.refresh();
    });
    const later = await engine.list(1);
    await waitFor(() => {
      expect(earlier.signal.aborted).toBe(true);
    });

    later.answer(['later-1']);
    await waitFor(() => {
      expect(shown(result)).toEqual(['later-1']);
    });
    earlier.answer(['earlier-1']);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(shown(result)).toEqual(['later-1']);
    expect(result.current.listing.count).toEqual({ total: 1, more: false });
  });

  it('asks for page 1 again after leaving and coming back, and shows nothing from before until it answers', async () => {
    const first = renderListing();
    (await engine.list(0)).answer(['before-1']);
    await waitFor(() => {
      expect(shown(first.result)).toEqual(['before-1']);
    });
    first.unmount();

    const { result } = renderListing();

    const again = await engine.list(1);
    expect(again.params.has('Marker')).toBe(false);
    expect(result.current.listing.items).toBeUndefined();
    expect(result.current.listing.count).toBeUndefined();
    expect(result.current.listing.loading).toBe(true);
    again.answer(['after-1']);
    await waitFor(() => {
      expect(shown(result)).toEqual(['after-1']);
    });
  });
});

describe('a finished update of a role', () => {
  it('reads the role again, and a listing started afterwards asks the engine again', async () => {
    const page = renderHook(() => ({ role: useRole({ endpoint, name: 'r' }), update: useUpdateRole(endpoint) }), {
      wrapper,
    });
    await waitFor(() => {
      expect(page.result.current.role.read?.kind).toBe('found');
    });
    expect(engine.of('GetRole')).toHaveLength(1);

    await act(async () => {
      await page.result.current.update.mutateAsync({
        name: 'r',
        description: 'new',
        maxSessionDuration: 3600,
        readMaxSessionDuration: 3600,
      });
    });

    expect(engine.of('UpdateRole')).toHaveLength(1);
    await waitFor(() => {
      expect(engine.of('GetRole')).toHaveLength(2);
    });

    const listing = renderListing();
    const list = await engine.list(0);
    list.answer(['r']);
    await waitFor(() => {
      expect(shown(listing.result)).toEqual(['r']);
    });
    expect(engine.of('ListRoles')).toHaveLength(1);
    expect(engine.of('GetRole')).toHaveLength(3);
  });
});
