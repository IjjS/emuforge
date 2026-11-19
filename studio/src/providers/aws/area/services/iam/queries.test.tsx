import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { engineEndpoint } from '../../../../../lib/aws/client-factory';
import { RequestError } from '../../../../../lib/aws/request';
import {
  failureOf,
  FILTER_DELAY_MS,
  useAttachRolePolicies,
  useCreatePolicyVersion,
  useDeletePolicy,
  useDeletePolicyVersion,
  useDeleteRoles,
  useDeleteRolePolicy,
  useDetachRolePolicy,
  useInlinePolicyDocument,
  useManagedPolicyDocument,
  usePolicy,
  usePolicyListing,
  usePutRolePolicy,
  useSetDefaultPolicyVersion,
  useUpdateTrustPolicy,
  type PolicyListingOptions,
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
  it('reads again a page opened with the name in another case than the RoleName the update gives', async () => {
    const page = renderHook(() => ({ role: useRole({ endpoint, name: 'R' }), update: useUpdateRole(endpoint) }), {
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

    await waitFor(() => {
      expect(engine.of('GetRole')).toHaveLength(2);
    });
    expect(engine.of('GetRole')[1]?.params.get('RoleName')).toBe('R');
  });

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

// Test criteria, "Unit s1 — providers/aws/area/services/iam/queries.test.tsx" (issue 535). The engine below answers
// every operation at once from `answers`, but `ListPolicies` while `holdPolicies` is set: then each waits until the
// case answers it, so a case decides the order in which the answers of two scopes arrive.

const POLICY_ARN = 'arn:aws:iam::000000000000:policy/mine';
const DOC = '{\n  "Version":  "2012-10-17"\n}';

interface HeldList {
  params: URLSearchParams;
  answer: (names: string[]) => void;
}

function policyEngineAnswer(action: string, params: URLSearchParams): string {
  switch (action) {
    case 'GetRole':
      return ok('GetRole', `<Role>${roleXml(params.get('RoleName') ?? '')}<RoleLastUsed/></Role>`);
    case 'ListAttachedRolePolicies':
      return ok(action, '<AttachedPolicies/><IsTruncated>false</IsTruncated>');
    case 'ListRolePolicies':
      return ok(action, '<PolicyNames/><IsTruncated>false</IsTruncated>');
    case 'GetRolePolicy':
      return ok(
        action,
        `<RoleName>r</RoleName><PolicyName>${params.get('PolicyName') ?? ''}</PolicyName><PolicyDocument>${encodeURIComponent(DOC)}</PolicyDocument>`,
      );
    case 'GetPolicy':
      return ok(
        action,
        `<Policy><PolicyName>mine</PolicyName><Arn>${POLICY_ARN}</Arn><DefaultVersionId>v1</DefaultVersionId></Policy>`,
      );
    case 'GetPolicyVersion':
      return ok(
        action,
        `<PolicyVersion><Document>${encodeURIComponent(DOC)}</Document><VersionId>${params.get('VersionId') ?? ''}</VersionId><IsDefaultVersion>true</IsDefaultVersion></PolicyVersion>`,
      );
    case 'ListPolicyVersions':
      return ok(
        action,
        '<Versions><member><VersionId>v1</VersionId><IsDefaultVersion>true</IsDefaultVersion></member></Versions><IsTruncated>false</IsTruncated>',
      );
    case 'ListEntitiesForPolicy':
      return ok(
        action,
        '<PolicyGroups/><PolicyUsers/><PolicyRoles><member><RoleName>role-a</RoleName></member></PolicyRoles><IsTruncated>false</IsTruncated>',
      );
    case 'ListPolicies':
      return policyList(['mine']);
    case 'CreatePolicyVersion':
      return ok(action, '<PolicyVersion><VersionId>v2</VersionId></PolicyVersion>');
    default:
      return ok(action, '');
  }
}

function policyList(names: string[]): string {
  const members = names
    .map((name) => `<member><PolicyName>${name}</PolicyName><Arn>arn:aws:iam::aws:policy/${name}</Arn></member>`)
    .join('');
  return ok('ListPolicies', `<Policies>${members}</Policies><IsTruncated>false</IsTruncated>`);
}

class PolicyEngine {
  readonly sent: { action: string; params: URLSearchParams }[] = [];
  readonly held: HeldList[] = [];
  holdPolicies = false;
  refusals: Record<string, string> = {};

  readonly fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    if (new URL(request.url).pathname === '/__emuforge/session') {
      return new Response(JSON.stringify({ token: 'emuforge-test-token-535' }), { status: 200 });
    }
    const params = new URLSearchParams(await request.text());
    const action = params.get('Action') ?? '';
    this.sent.push({ action, params });
    const refusal = this.refusals[action];
    if (refusal !== undefined) {
      return new Response(
        `<ErrorResponse><Error><Type>Sender</Type><Code>${refusal}</Code><Message>refused ${action}</Message></Error></ErrorResponse>`,
        { status: refusal === 'AccessDenied' ? 403 : 400 },
      );
    }
    if (action === 'ListPolicies' && this.holdPolicies) {
      return new Promise((resolve) => {
        this.held.push({
          params,
          answer: (names) => {
            resolve(new Response(policyList(names), { status: 200 }));
          },
        });
      });
    }
    return new Response(policyEngineAnswer(action, params), { status: 200 });
  };

  count(action: string): number {
    return this.sent.filter((request) => request.action === action).length;
  }
}

describe('the reads and actions of issue 535', () => {
  let policies: PolicyEngine;

  beforeEach(() => {
    policies = new PolicyEngine();
    vi.stubGlobal('fetch', policies.fetch);
  });

  it('asks for no document until its hook is enabled, and reads it again after its policy is changed', async () => {
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => ({
        inline: useInlinePolicyDocument({ endpoint, role: 'Role-A', policy: 'inline-a', enabled }),
        managed: useManagedPolicyDocument({ endpoint, arn: POLICY_ARN, enabled }),
        put: usePutRolePolicy(endpoint),
        edit: useCreatePolicyVersion(endpoint),
      }),
      { initialProps: { enabled: false }, wrapper },
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(policies.sent).toEqual([]);
    expect(result.current.inline.loading).toBe(false);

    rerender({ enabled: true });
    await waitFor(() => {
      expect(result.current.inline.read).toEqual({ kind: 'found', text: DOC });
      expect(result.current.managed.read).toEqual({ kind: 'found', text: DOC, versionId: 'v1', isDefault: true });
    });
    expect(policies.count('GetRolePolicy')).toBe(1);
    expect(policies.count('GetPolicyVersion')).toBe(1);

    // The role's name in another case is the same role (the emulator matches names ignoring case).
    await act(() => result.current.put.mutateAsync({ role: 'role-a', name: 'inline-a', document: DOC }));
    await waitFor(() => {
      expect(policies.count('GetRolePolicy')).toBe(2);
    });
    expect(policies.count('GetPolicyVersion')).toBe(1);

    await act(() => result.current.edit.mutateAsync({ arn: POLICY_ARN, document: DOC }));
    await waitFor(() => {
      expect(policies.count('GetPolicyVersion')).toBe(2);
    });
    expect(policies.count('GetRolePolicy')).toBe(2);
  });

  function renderReads() {
    return renderHook(
      () => ({
        role: useRole({ endpoint, name: 'role-a' }),
        list: usePolicyListing({ endpoint, pageSize: 20, filter: '', scope: 'Local' }),
        policy: usePolicy({ endpoint, arn: POLICY_ARN }),
        document: useManagedPolicyDocument({ endpoint, arn: POLICY_ARN, enabled: true }),
        attach: useAttachRolePolicies(endpoint),
        detach: useDetachRolePolicy(endpoint),
        put: usePutRolePolicy(endpoint),
        deleteInline: useDeleteRolePolicy(endpoint),
        trust: useUpdateTrustPolicy(endpoint),
        edit: useCreatePolicyVersion(endpoint),
        setDefault: useSetDefaultPolicyVersion(endpoint),
        deleteVersion: useDeletePolicyVersion(endpoint),
        deletePolicy: useDeletePolicy(endpoint),
      }),
      { wrapper },
    );
  }

  type Reads = ReturnType<typeof renderReads>['result'];

  /** How many times each read was sent so far. */
  function counts() {
    return {
      role: policies.count('GetRole'),
      lists: policies.count('ListPolicies'),
      policy: policies.count('ListPolicyVersions'),
      document: policies.count('GetPolicyVersion'),
    };
  }

  async function settled(result: Reads) {
    await waitFor(() => {
      expect(result.current.role.loading).toBe(false);
      expect(result.current.list.loading).toBe(false);
      expect(result.current.policy.loading).toBe(false);
      expect(result.current.document.loading).toBe(false);
    });
  }

  const roleActions: [string, (result: Reads) => Promise<unknown>][] = [
    [
      'attach',
      (result) => result.current.attach.mutateAsync({ role: 'role-a', policies: [{ name: 'x', arn: 'arn:x' }] }),
    ],
    ['detach', (result) => result.current.detach.mutateAsync({ role: 'role-a', arn: 'arn:x' })],
    [
      'add or edit an inline policy',
      (result) => result.current.put.mutateAsync({ role: 'role-a', name: 'p', document: DOC }),
    ],
    ['delete an inline policy', (result) => result.current.deleteInline.mutateAsync({ role: 'role-a', name: 'p' })],
    ['edit the trust policy', (result) => result.current.trust.mutateAsync({ role: 'role-a', document: DOC })],
  ];

  it.each(roleActions)('reads the role and the policy lists again after "%s"', async (_, action) => {
    const { result } = renderReads();
    await settled(result);
    const before = counts();

    await act(() => action(result));
    await waitFor(() => {
      expect(counts().role).toBe(before.role + 1);
      expect(counts().lists).toBe(before.lists + 1);
    });
  });

  it.each(roleActions)('reads the role and the lists again after a refused "%s" too', async (_, action) => {
    const { result } = renderReads();
    await settled(result);
    const before = counts();
    for (const operation of [
      'AttachRolePolicy',
      'DetachRolePolicy',
      'PutRolePolicy',
      'DeleteRolePolicy',
      'UpdateAssumeRolePolicy',
    ]) {
      policies.refusals[operation] = 'UnmodifiableEntity';
    }

    await act(() => action(result).catch(() => undefined));
    await waitFor(() => {
      expect(counts().role).toBe(before.role + 1);
      expect(counts().lists).toBe(before.lists + 1);
    });
  });

  const policyActions: [string, (result: Reads) => Promise<unknown>][] = [
    ['save a new version', (result) => result.current.edit.mutateAsync({ arn: POLICY_ARN, document: DOC })],
    ['set the default', (result) => result.current.setDefault.mutateAsync({ arn: POLICY_ARN, versionId: 'v1' })],
    ['delete a version', (result) => result.current.deleteVersion.mutateAsync({ arn: POLICY_ARN, versionId: 'v2' })],
  ];

  it.each(policyActions)('reads the policy, its documents and the lists again after "%s"', async (_, action) => {
    const { result } = renderReads();
    await settled(result);
    const before = counts();

    await act(() => action(result));
    await waitFor(() => {
      expect(counts().policy).toBe(before.policy + 1);
      expect(counts().document).toBe(before.document + 1);
      expect(counts().lists).toBe(before.lists + 1);
    });
    expect(counts().role).toBe(before.role);
  });

  it('reads the lists and the roles a deleted policy was detached from again', async () => {
    const { result } = renderReads();
    await settled(result);
    const before = counts();

    const outcome = await act(() => result.current.deletePolicy.mutateAsync(POLICY_ARN));
    expect(outcome).toEqual({ kind: 'deleted', detachedRoles: ['role-a'] });
    await waitFor(() => {
      expect(counts().lists).toBe(before.lists + 1);
      expect(counts().role).toBe(before.role + 1);
    });
  });

  function renderPolicyListing(scope: 'Local' | 'AWS' | 'All') {
    return renderHook((props: PolicyListingOptions) => usePolicyListing(props), {
      initialProps: { endpoint, pageSize: 2, filter: '', scope },
      wrapper,
    });
  }

  async function held(n: number): Promise<HeldList> {
    await waitFor(() => {
      expect(policies.held.length).toBeGreaterThan(n);
    });
    return policies.held[n] as HeldList;
  }

  it('sends its scope, and starts again at page 1 when the scope changes', async () => {
    policies.holdPolicies = true;
    const { result, rerender } = renderPolicyListing('Local');
    const first = await held(0);
    expect(first.params.get('Scope')).toBe('Local');
    first.answer(['mine']);
    await waitFor(() => {
      expect(result.current.items?.map((policy) => policy.name)).toEqual(['mine']);
    });

    rerender({ endpoint, pageSize: 2, filter: '', scope: 'AWS' });
    const second = await held(1);
    expect(second.params.get('Scope')).toBe('AWS');
    expect(second.params.has('Marker')).toBe(false);
    expect(result.current.items).toBeUndefined();
    expect(result.current.currentPage).toBe(1);
    second.answer(['ReadOnlyAccess']);
    await waitFor(() => {
      expect(result.current.items?.map((policy) => policy.name)).toEqual(['ReadOnlyAccess']);
    });
  });

  it('never lets a late answer of the scope before replace the newer one', async () => {
    policies.holdPolicies = true;
    const { result, rerender } = renderPolicyListing('Local');
    const local = await held(0);

    rerender({ endpoint, pageSize: 2, filter: '', scope: 'AWS' });
    const aws = await held(1);
    aws.answer(['ReadOnlyAccess']);
    await waitFor(() => {
      expect(result.current.items?.map((policy) => policy.name)).toEqual(['ReadOnlyAccess']);
    });

    local.answer(['mine']);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result.current.items?.map((policy) => policy.name)).toEqual(['ReadOnlyAccess']);
    expect(result.current.count).toEqual({ total: 1, more: false });
  });

  it('gives a failure of a new call to a screen as a failure of main’s calls is given', async () => {
    policies.refusals.GetPolicy = 'AccessDenied';
    const { result } = renderHook(() => usePolicy({ endpoint, arn: POLICY_ARN }), { wrapper });

    await waitFor(() => {
      expect(result.current.failure).toEqual({
        kind: 'access-denied',
        operation: 'GetPolicy',
        message: 'refused GetPolicy',
      });
    });
    expect(result.current.read).toBeUndefined();
    expect(result.current.loading).toBe(false);

    const failure = { kind: 'not-implemented', operation: 'GetPolicyVersion' } as const;
    expect(failureOf(new RequestError(failure))).toEqual(failure);
  });
});
