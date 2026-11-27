import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { engineEndpoint } from '../../../../lib/aws/client-factory';
import { RequestError } from '../../../../lib/aws/request';
import { ChoiceMultiselect } from './choice-multiselect';
import type { AreaConnection } from './emulator-line';
import {
  listSecurityGroupChoices,
  readSecurityGroupsById,
  securityGroupChoices,
  securityGroupChoicesKey,
  type SecurityGroupChoice,
} from './security-group-choices';
import { usePagedChoices } from './use-paged-choices';

// The test plays the engine behind the page's `fetch`: its session route, and each request as it leaves the browser,
// answered in EC2's query protocol (form in, XML out) as the emulator answers. The source is read through the area's
// paged choices, and through its multiple field, as a form reads it.

const XMLNS = 'http://ec2.amazonaws.com/doc/2016-11-15/';

interface Answer {
  status: number;
  body: string;
}

interface Sent {
  action: string;
  params: URLSearchParams;
}

type Handler = (sent: Sent) => Answer | 'hold';

class FakeEngine {
  readonly sent: Sent[] = [];
  handler: Handler = () => groups([]);

  readonly fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    if (url.pathname === '/__emuforge/session') {
      return new Response(JSON.stringify({ token: 'emuforge-test-token-573' }), { status: 200 });
    }
    const params = new URLSearchParams(await request.text());
    const sent = { action: params.get('Action') ?? '', params };
    this.sent.push(sent);
    const answer = this.handler(sent);
    if (answer === 'hold') {
      return new Promise((_, reject) => {
        request.signal.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      });
    }
    return new Response(answer.body, { status: answer.status, headers: { 'content-type': 'text/xml' } });
  };
}

function groups(items: string[], next?: string): Answer {
  return {
    status: 200,
    body: `<DescribeSecurityGroupsResponse xmlns="${XMLNS}"><requestId>r</requestId><securityGroupInfo>${items.join('')}</securityGroupInfo>${next === undefined ? '' : `<nextToken>${next}</nextToken>`}</DescribeSecurityGroupsResponse>`,
  };
}

const item = (id: string, name?: string, vpc?: string, description?: string) =>
  `<item><groupId>${id}</groupId>${name === undefined ? '' : `<groupName>${name}</groupName>`}${vpc === undefined ? '' : `<vpcId>${vpc}</vpcId>`}${description === undefined ? '' : `<groupDescription>${description}</groupDescription>`}</item>`;

/** The filters a request sent, by name. */
function filters(params: URLSearchParams | undefined): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (let n = 1; params?.has(`Filter.${String(n)}.Name`) === true; n += 1) {
    const values: string[] = [];
    for (let v = 1; params.has(`Filter.${String(n)}.Value.${String(v)}`); v += 1) {
      values.push(params.get(`Filter.${String(n)}.Value.${String(v)}`) ?? '');
    }
    result[params.get(`Filter.${String(n)}.Name`) ?? ''] = values;
  }
  return result;
}

let engine: FakeEngine;
let endpoint: string;
let nextPort = 9840;
let client: QueryClient;

beforeEach(() => {
  engine = new FakeEngine();
  vi.stubGlobal('fetch', engine.fetch);
  nextPort += 1;
  endpoint = engineEndpoint(nextPort);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  client.clear();
  vi.unstubAllGlobals();
});

const signal = () => new AbortController().signal;

function wrapper({ children }: { children: ReactNode }) {
  return createElement(QueryClientProvider, { client }, children);
}

describe('a page of security groups', () => {
  it('MaxResults 50, the token, vpc-id only with a VPC, group-name with * around a text only with one; each choice; the next token', async () => {
    engine.handler = () =>
      groups([item('sg-1', 'default', 'vpc-d'), item('sg-2', undefined, 'vpc-x'), item('sg-3')], 't-2');
    expect(await listSecurityGroupChoices(endpoint, {}, undefined, signal())).toEqual({
      choices: [{ id: 'sg-1', name: 'default', vpcId: 'vpc-d' }, { id: 'sg-2', vpcId: 'vpc-x' }, { id: 'sg-3' }],
      nextToken: 't-2',
    });
    const first = engine.sent[0]?.params;
    expect(engine.sent[0]?.action).toBe('DescribeSecurityGroups');
    expect(first?.get('MaxResults')).toBe('50');
    expect(first?.has('NextToken')).toBe(false);
    expect(filters(first)).toEqual({});

    engine.handler = () => groups([item('sg-4', 'web', 'vpc-d')]);
    expect(await listSecurityGroupChoices(endpoint, { vpcId: 'vpc-d', name: 'we' }, 't-2', signal())).toEqual({
      choices: [{ id: 'sg-4', name: 'web', vpcId: 'vpc-d' }],
    });
    const second = engine.sent[1]?.params;
    expect(second?.get('NextToken')).toBe('t-2');
    expect(filters(second)).toEqual({ 'vpc-id': ['vpc-d'], 'group-name': ['*we*'] });

    await listSecurityGroupChoices(endpoint, { vpcId: 'vpc-d' }, undefined, signal());
    expect(filters(engine.sent[2]?.params)).toEqual({ 'vpc-id': ['vpc-d'] });
    await listSecurityGroupChoices(endpoint, { name: 'db' }, undefined, signal());
    expect(filters(engine.sent[3]?.params)).toEqual({ 'group-name': ['*db*'] });
  });

  it('reads two groups by the group-id filter and includes their descriptions and VPCs', async () => {
    engine.handler = () =>
      groups([item('sg-1', 'default', 'vpc-d', 'Default group'), item('sg-2', 'web', 'vpc-x', 'Public web')]);
    expect(await readSecurityGroupsById(endpoint, ['sg-1', 'sg-2'], signal())).toEqual([
      { id: 'sg-1', name: 'default', vpcId: 'vpc-d', description: 'Default group' },
      { id: 'sg-2', name: 'web', vpcId: 'vpc-x', description: 'Public web' },
    ]);
    expect(engine.sent).toHaveLength(1);
    const request = engine.sent[0];
    expect(request?.action).toBe('DescribeSecurityGroups');
    expect(filters(request?.params)).toEqual({ 'group-id': ['sg-1', 'sg-2'] });
    expect(request?.params.has('GroupId.1')).toBe(false);
  });

  it('returns just the groups the emulator has and leaves unknown ids out', async () => {
    engine.handler = () => groups([item('sg-1', 'default', 'vpc-d')]);
    expect(await readSecurityGroupsById(endpoint, ['sg-1', 'sg-missing'], signal())).toEqual([
      { id: 'sg-1', name: 'default', vpcId: 'vpc-d' },
    ]);
    expect(filters(engine.sent[0]?.params)).toEqual({ 'group-id': ['sg-1', 'sg-missing'] });
  });

  it('a 501 → the "not implemented" kind with DescribeSecurityGroups', async () => {
    engine.handler = () => ({ status: 501, body: '' });
    const error: unknown = await listSecurityGroupChoices(endpoint, {}, undefined, signal()).then(
      () => undefined,
      (rejection: unknown) => rejection,
    );
    expect(error).toBeInstanceOf(RequestError);
    expect((error as RequestError).failure).toEqual({ kind: 'not-implemented', operation: 'DescribeSecurityGroups' });
  });

  it('an aborted signal ends the request', async () => {
    engine.handler = () => 'hold';
    const controller = new AbortController();
    const pending = listSecurityGroupChoices(endpoint, {}, undefined, controller.signal);
    await vi.waitFor(() => {
      expect(engine.sent).toHaveLength(1);
    });
    const reason = new Error('left the page');
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
  });
});

describe('the source', () => {
  it('a typed text is sent as the filter; another VPC is another list', async () => {
    engine.handler = (sent) =>
      groups(
        filters(sent.params)['vpc-id'] === undefined
          ? [item('sg-any', 'app', 'vpc-x')]
          : [item('sg-d', 'app', 'vpc-d')],
      );
    const every = securityGroupChoices(endpoint);
    expect(every.filtering).toBe('sent');
    expect(every.key).toEqual(['aws', 'area', 'security-group-choices', null]);
    const { result } = renderHook(() => usePagedChoices(every, true, 'ap'), { wrapper });
    await waitFor(() => {
      expect(result.current.choices).toEqual([{ id: 'sg-any', name: 'app', vpcId: 'vpc-x' }]);
    });
    expect(filters(engine.sent[0]?.params)).toEqual({ 'group-name': ['*ap*'] });

    const one = securityGroupChoices(endpoint, 'vpc-d');
    expect(one.key).toEqual(securityGroupChoicesKey('vpc-d'));
    expect(one.key).not.toEqual(every.key);
    const other = renderHook(() => usePagedChoices(one, true, ''), { wrapper });
    await waitFor(() => {
      expect(other.result.current.choices).toEqual([{ id: 'sg-d', name: 'app', vpcId: 'vpc-d' }]);
    });
    expect(filters(engine.sent[1]?.params)).toEqual({ 'vpc-id': ['vpc-d'] });
  });

  it('an option describes the group by id and description, or just its id', () => {
    const { optionOf } = securityGroupChoices(endpoint);
    expect(optionOf({ id: 'sg-1', name: 'default', vpcId: 'vpc-d', description: 'Default group' })).toEqual({
      value: 'sg-1',
      label: 'default',
      description: 'sg-1 · Default group',
      tags: ['sg-1', 'vpc-d'],
    });
    expect(optionOf({ id: 'sg-2', vpcId: 'vpc-x' })).toEqual({
      value: 'sg-2',
      label: 'sg-2',
      description: 'sg-2',
      tags: ['sg-2', 'vpc-x'],
    });
  });

  it('the groups are read again when the field is opened again, so a group made meanwhile is offered', async () => {
    engine.handler = () => groups([item('sg-1', 'default', 'vpc-d')]);
    const connection: AreaConnection = {
      result: { kind: 'connected', checkedAt: 0, emulator: { port: 9841, endpoint: 'https://127.0.0.1:9841' } },
      engineOrigin: endpoint,
    };
    render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(ChoiceMultiselect<SecurityGroupChoice>, {
          source: securityGroupChoices(endpoint),
          connection,
          things: 'security groups',
          value: [],
          onChange: () => undefined,
        }),
      ),
    );
    const field = createWrapper(document.body).findMultiselect();
    if (field === null) {
      throw new Error('no multiselect');
    }
    field.openDropdown();
    await waitFor(() => {
      expect(field.findDropdown().findOptionByValue('sg-1')).not.toBeNull();
    });
    field.closeDropdown();
    engine.handler = () => groups([item('sg-1', 'default', 'vpc-d'), item('sg-new', 'made-elsewhere', 'vpc-d')]);
    (document.activeElement as HTMLElement | null)?.blur();
    field.findTrigger().focus();
    field.openDropdown();
    await waitFor(() => {
      expect(field.findDropdown().findOptionByValue('sg-new')).not.toBeNull();
    });
    expect(engine.sent.length).toBeGreaterThanOrEqual(2);
  });
});
