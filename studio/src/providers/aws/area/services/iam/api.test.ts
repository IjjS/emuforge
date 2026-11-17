import { ListRolesCommand } from '@aws-sdk/client-iam';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EndpointRefusedError, engineEndpoint } from '../../../../../lib/aws/client-factory';
import {
  createRole,
  deleteRoles,
  getCallerAccount,
  getRole,
  iamClient,
  IamError,
  listPolicies,
  listRoles,
  updateRole,
  type IamFailure,
} from './api';

// Test criteria, "Unit — providers/aws/area/services/iam/api.test.ts", and the five IAM cases of "Unit —
// lib/aws/client-factory.test.ts", proven here (issue 386, R10: the client is made in the service's `api.ts`).
//
// The test plays the engine behind the page's `fetch`: its session route, and every IAM request as it leaves the
// browser, answered in the Query protocol's XML as the emulator answers and as the engine relays it. Every answer
// waits a macrotask, so a request sent before the previous one's answer shows in the log.

interface Answer {
  status: number;
  statusText?: string;
  body?: string;
}

type EngineAnswer = Answer | 'network-error' | 'hold';

interface Sent {
  method: string;
  url: string;
  contentType: string | null;
  body: string;
  params: URLSearchParams;
  action: string;
  session: string | null;
  authorization: string | null;
}

type Handler = (request: Sent) => EngineAnswer;

class FakeEngine {
  readonly sent: Sent[] = [];
  /** "sent <Action>" when a request arrives, "answered <Action>" when its answer leaves. */
  readonly log: string[] = [];
  sessions = 0;
  session: () => EngineAnswer = () => {
    this.sessions += 1;
    return { status: 200, body: JSON.stringify({ token: `token-${String(this.sessions)}` }) };
  };
  handlers: Record<string, Handler> = {};
  fallback: Handler = (request) => ok(request.action, '');

  readonly fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    let answer: EngineAnswer;
    let action = '';
    if (url.pathname === '/__emuforge/session') {
      answer = this.session();
    } else {
      const body = await request.text();
      const params = new URLSearchParams(body);
      action = params.get('Action') ?? '';
      const sent: Sent = {
        method: request.method,
        url: request.url,
        contentType: request.headers.get('content-type'),
        body,
        params,
        action,
        session: request.headers.get('x-emuforge-session'),
        authorization: request.headers.get('authorization'),
      };
      this.sent.push(sent);
      this.log.push(`sent ${action}`);
      answer = (this.handlers[action] ?? this.fallback)(sent);
    }
    if (answer === 'network-error') {
      throw new TypeError('Failed to fetch');
    }
    if (answer === 'hold') {
      return new Promise((_, reject) => {
        request.signal.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 2));
    if (action !== '') {
      this.log.push(`answered ${action}`);
    }
    return new Response(answer.body ?? '', {
      status: answer.status,
      headers: { 'content-type': 'text/xml' },
      ...(answer.statusText === undefined ? {} : { statusText: answer.statusText }),
    });
  };

  /** The actions sent, in order. */
  actions(): string[] {
    return this.sent.map((request) => request.action);
  }

  /** The sent requests of `action`. */
  of(action: string): Sent[] {
    return this.sent.filter((request) => request.action === action);
  }
}

function esc(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function ok(action: string, result: string): Answer {
  return {
    status: 200,
    body: `<${action}Response xmlns="https://iam.amazonaws.com/doc/2010-05-08/"><${action}Result>${result}</${action}Result><ResponseMetadata><RequestId>r</RequestId></ResponseMetadata></${action}Response>`,
  };
}

function errorAnswer(status: number, code: string, message: string): Answer {
  return {
    status,
    body: `<ErrorResponse xmlns="https://iam.amazonaws.com/doc/2010-05-08/"><Error><Type>Sender</Type><Code>${code}</Code><Message>${esc(message)}</Message></Error><RequestId>r</RequestId></ErrorResponse>`,
  };
}

const LAMBDA_TRUST = encodeURIComponent(
  JSON.stringify({
    Version: '2012-10-17',
    Statement: [{ Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }],
  }),
);

interface XmlRole {
  name: string;
  path?: string;
  lastUsed?: string;
  description?: string;
  maxSessionDuration?: number;
  boundary?: string;
  tags?: [string, string][];
}

function roleXml({ name, path = '/', lastUsed, description, maxSessionDuration, boundary, tags }: XmlRole): string {
  return [
    `<Path>${esc(path)}</Path>`,
    `<RoleName>${esc(name)}</RoleName>`,
    `<RoleId>AROA${esc(name.toUpperCase())}</RoleId>`,
    `<Arn>arn:aws:iam::000000000000:role${esc(path)}${esc(name)}</Arn>`,
    `<CreateDate>2026-11-17T09:05:03.500Z</CreateDate>`,
    `<AssumeRolePolicyDocument>${LAMBDA_TRUST}</AssumeRolePolicyDocument>`,
    description === undefined ? '' : `<Description>${esc(description)}</Description>`,
    maxSessionDuration === undefined ? '' : `<MaxSessionDuration>${String(maxSessionDuration)}</MaxSessionDuration>`,
    boundary === undefined
      ? ''
      : `<PermissionsBoundary><PermissionsBoundaryType>Policy</PermissionsBoundaryType><PermissionsBoundaryArn>${esc(boundary)}</PermissionsBoundaryArn></PermissionsBoundary>`,
    tags === undefined
      ? ''
      : `<Tags>${tags.map(([key, value]) => `<member><Key>${esc(key)}</Key><Value>${esc(value)}</Value></member>`).join('')}</Tags>`,
    lastUsed === undefined
      ? '<RoleLastUsed/>'
      : `<RoleLastUsed><LastUsedDate>${lastUsed}</LastUsedDate></RoleLastUsed>`,
  ].join('');
}

function truncation(marker?: string): string {
  return marker === undefined
    ? '<IsTruncated>false</IsTruncated>'
    : `<IsTruncated>true</IsTruncated><Marker>${marker}</Marker>`;
}

function listRolesAnswer(names: string[], marker?: string): Answer {
  const members = names.map((name) => `<member>${roleXml({ name })}</member>`).join('');
  return ok('ListRoles', `<Roles>${members}</Roles>${truncation(marker)}`);
}

function getRoleAnswer(role: XmlRole): Answer {
  return ok('GetRole', `<Role>${roleXml(role)}</Role>`);
}

function attachedAnswer(policies: [string, string][], marker?: string): Answer {
  const members = policies
    .map(([name, arn]) => `<member><PolicyName>${esc(name)}</PolicyName><PolicyArn>${esc(arn)}</PolicyArn></member>`)
    .join('');
  return ok('ListAttachedRolePolicies', `<AttachedPolicies>${members}</AttachedPolicies>${truncation(marker)}`);
}

function inlineAnswer(names: string[], marker?: string): Answer {
  const members = names.map((name) => `<member>${esc(name)}</member>`).join('');
  return ok('ListRolePolicies', `<PolicyNames>${members}</PolicyNames>${truncation(marker)}`);
}

function profilesAnswer(names: string[], marker?: string): Answer {
  const members = names
    .map(
      (name) =>
        `<member><Path>/</Path><InstanceProfileName>${esc(name)}</InstanceProfileName><InstanceProfileId>AIPA${esc(name)}</InstanceProfileId><Arn>arn:aws:iam::000000000000:instance-profile/${esc(name)}</Arn><CreateDate>2026-11-17T09:05:03Z</CreateDate><Roles/></member>`,
    )
    .join('');
  return ok('ListInstanceProfilesForRole', `<InstanceProfiles>${members}</InstanceProfiles>${truncation(marker)}`);
}

function policiesAnswer(policies: [string, string][], marker?: string): Answer {
  const members = policies
    .map(
      ([name, arn]) =>
        `<member><PolicyName>${esc(name)}</PolicyName><Arn>${esc(arn)}</Arn><Path>/</Path><AttachmentCount>0</AttachmentCount><IsAttachable>true</IsAttachable></member>`,
    )
    .join('');
  return ok('ListPolicies', `<Policies>${members}</Policies>${truncation(marker)}`);
}

/** Answers each `ListRoles` request in turn with the next of `answers`. */
function listRolesInTurn(answers: Answer[]): Handler {
  let next = 0;
  return () => {
    const answer = answers[next] ?? listRolesAnswer([]);
    next += 1;
    return answer;
  };
}

/** `GetRole` answers the role it is asked for. */
const getRoleEcho: Handler = (request) => getRoleAnswer({ name: request.params.get('RoleName') ?? '' });

async function failure(promise: Promise<unknown>): Promise<IamFailure> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(IamError);
    return (error as IamError).failure;
  }
  throw new Error('the call resolved');
}

// Sessions and clients are held per engine endpoint for the life of the page, so each case has a port of its own.
let nextPort = 8820;
let engine: FakeEngine;
let endpoint: string;

beforeEach(() => {
  engine = new FakeEngine();
  vi.stubGlobal('fetch', engine.fetch);
  nextPort += 1;
  endpoint = engineEndpoint(nextPort);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const signal = () => new AbortController().signal;

describe('the IAM client (test criteria: Unit — lib/aws/client-factory.test.ts)', () => {
  it('sends ListRoles to the engine as POST / in the Query protocol, with the session and the Studio credential', async () => {
    engine.handlers.ListRoles = () => listRolesAnswer([]);

    await iamClient(endpoint).send(new ListRolesCommand({}));

    expect(engine.sent).toHaveLength(1);
    const [request] = engine.sent;
    expect(request?.method).toBe('POST');
    expect(request?.url).toBe(`${endpoint}/`);
    expect(request?.contentType).toMatch(/^application\/x-www-form-urlencoded/);
    expect(request?.params.get('Action')).toBe('ListRoles');
    expect(request?.params.get('Version')).toBe('2010-05-08');
    expect(request?.session).toBe('token-1');
    expect(request?.authorization?.startsWith('AWS4-HMAC-SHA256 Credential=emuforge-studio/')).toBe(true);
  });

  it('is refused for an endpoint that is not http://127.0.0.1:<port>, and sends nothing', () => {
    for (const refused of ['http://localhost:8820', 'https://127.0.0.1:8820', 'https://iam.amazonaws.com']) {
      expect(() => iamClient(refused)).toThrow(EndpointRefusedError);
    }
    expect(engine.sent).toHaveLength(0);
    expect(engine.sessions).toBe(0);
  });

  it('sends the command again with a new token when the engine refuses the session once, and resolves', async () => {
    let refused = false;
    engine.handlers.ListRoles = (request) => {
      if (!refused && request.session === 'token-1') {
        refused = true;
        return errorAnswer(401, 'SessionInvalid', 'The session is not valid.');
      }
      return listRolesAnswer(['after-renewal']);
    };

    const output = await iamClient(endpoint).send(new ListRolesCommand({}));

    expect(output.Roles?.map((role) => role.RoleName)).toEqual(['after-renewal']);
    expect(engine.of('ListRoles').map((request) => request.session)).toEqual(['token-1', 'token-2']);
  });

  it('rejects with NoSuchEntityException and the message for the emulator’s 404 NoSuchEntity', async () => {
    engine.handlers.GetRole = () => errorAnswer(404, 'NoSuchEntity', 'The role with name x cannot be found.');

    const { GetRoleCommand } = await import('@aws-sdk/client-iam');
    await expect(iamClient(endpoint).send(new GetRoleCommand({ RoleName: 'x' }))).rejects.toMatchObject({
      name: 'NoSuchEntityException',
      message: 'The role with name x cannot be found.',
    });
  });

  it.each([
    [503, 'EmulatorUnavailable', 'The emulator at https://127.0.0.1:9411 could not be reached: connection refused'],
    [504, 'EmulatorTimeout', 'The emulator at https://127.0.0.1:9411 did not answer within 30 seconds'],
  ])('rejects with the name and message of the engine’s own %i %s', async (status, code, message) => {
    engine.handlers.ListRoles = () => errorAnswer(status, code, message);

    await expect(iamClient(endpoint).send(new ListRolesCommand({}))).rejects.toMatchObject({ name: code, message });
  });
});

describe('the role list', () => {
  it('sends one ListRoles with MaxItems 20 and no Marker, then one GetRole per role, in the answer’s order', async () => {
    engine.handlers.ListRoles = () => listRolesAnswer(['zeta', 'alpha'], 'marker-1');
    engine.handlers.GetRole = (request) =>
      request.params.get('RoleName') === 'zeta'
        ? getRoleAnswer({ name: 'zeta', lastUsed: '2026-11-16T01:02:03Z' })
        : getRoleAnswer({ name: 'alpha' });

    const page = await listRoles(endpoint, { pageSize: 20 }, signal());

    const [list] = engine.of('ListRoles');
    expect(engine.of('ListRoles')).toHaveLength(1);
    expect(list?.params.get('MaxItems')).toBe('20');
    expect(list?.params.has('Marker')).toBe(false);
    expect(
      engine
        .of('GetRole')
        .map((request) => request.params.get('RoleName'))
        .sort(),
    ).toEqual(['alpha', 'zeta']);
    expect(engine.actions().slice(0, 1)).toEqual(['ListRoles']);
    expect(page.roles.map((role) => role.name)).toEqual(['zeta', 'alpha']);
    expect(page.roles[0]?.lastUsed).toEqual(new Date('2026-11-16T01:02:03Z'));
    expect(page.roles[1]).not.toHaveProperty('lastUsed');
    expect(page.roles[0]).toMatchObject({
      path: '/',
      arn: 'arn:aws:iam::000000000000:role/zeta',
      createDate: new Date('2026-11-17T09:05:03.500Z'),
      trustPolicy: LAMBDA_TRUST,
    });
    expect(page.next?.marker).toBe('marker-1');
  });

  it('carries a marker as Marker', async () => {
    engine.handlers.ListRoles = () => listRolesAnswer([]);

    await listRoles(endpoint, { pageSize: 20, from: { marker: 'marker-7', skip: 0 } }, signal());

    expect(engine.of('ListRoles')[0]?.params.get('Marker')).toBe('marker-7');
  });

  it('leaves out a role whose GetRole answers NoSuchEntity and keeps the others in order, without a failure', async () => {
    engine.handlers.ListRoles = () => listRolesAnswer(['a', 'gone', 'c']);
    engine.handlers.GetRole = (request) =>
      request.params.get('RoleName') === 'gone'
        ? errorAnswer(404, 'NoSuchEntity', 'The role with name gone cannot be found.')
        : getRoleEcho(request);

    const page = await listRoles(endpoint, { pageSize: 20 }, signal());

    expect(page.roles.map((role) => role.name)).toEqual(['a', 'c']);
  });

  it('fails with the failure of a GetRole that fails in any other way', async () => {
    engine.handlers.ListRoles = () => listRolesAnswer(['a', 'b']);
    engine.handlers.GetRole = (request) =>
      request.params.get('RoleName') === 'b' ? errorAnswer(400, 'ValidationError', 'bad name') : getRoleEcho(request);

    expect(await failure(listRoles(endpoint, { pageSize: 20 }, signal()))).toEqual({
      kind: 'other',
      operation: 'GetRole',
      code: 'ValidationError',
      message: 'bad name',
    });
  });

  it('gives an empty page without a marker, and sends no GetRole, for an answer without roles', async () => {
    engine.handlers.ListRoles = () => listRolesAnswer([]);

    const page = await listRoles(endpoint, { pageSize: 20 }, signal());

    expect(page).toEqual({ roles: [] });
    expect(engine.of('GetRole')).toHaveLength(0);
  });
});

describe('the role list with a filter', () => {
  it('stops at a full page inside a truncated answer and sends GetRole for the roles shown only', async () => {
    engine.handlers.ListRoles = listRolesInTurn([listRolesAnswer(['xAB1', 'cd', 'ab2'], 'marker-1')]);
    engine.handlers.GetRole = getRoleEcho;

    const page = await listRoles(endpoint, { pageSize: 2, filter: 'ab' }, signal());

    expect(engine.of('ListRoles')).toHaveLength(1);
    expect(
      engine
        .of('GetRole')
        .map((request) => request.params.get('RoleName'))
        .sort(),
    ).toEqual(['ab2', 'xAB1']);
    expect(page.roles.map((role) => role.name)).toEqual(['xAB1', 'ab2']);
    expect(page.next).toBeDefined();
  });

  it('reads on with the marker of a short answer and says no more remain after the last', async () => {
    engine.handlers.ListRoles = listRolesInTurn([
      listRolesAnswer(['ab1', 'cd'], 'marker-1'),
      listRolesAnswer(['ef', 'xab']),
    ]);
    engine.handlers.GetRole = getRoleEcho;

    const page = await listRoles(endpoint, { pageSize: 2, filter: 'ab' }, signal());

    const lists = engine.of('ListRoles');
    expect(lists).toHaveLength(2);
    expect(lists[0]?.params.has('Marker')).toBe(false);
    expect(lists[1]?.params.get('Marker')).toBe('marker-1');
    expect(page.roles.map((role) => role.name)).toEqual(['ab1', 'xab']);
    expect(page.next).toBeUndefined();
  });

  it('says more remain when the page fills before an answer’s end, and the next page goes on without a role shown', async () => {
    engine.handlers.ListRoles = () => listRolesAnswer(['ab1', 'ab2', 'ab3']);
    engine.handlers.GetRole = getRoleEcho;

    const first = await listRoles(endpoint, { pageSize: 2, filter: 'ab' }, signal());

    expect(first.roles.map((role) => role.name)).toEqual(['ab1', 'ab2']);
    expect(first.next).toBeDefined();

    const second = await listRoles(
      endpoint,
      { pageSize: 2, filter: 'ab', ...(first.next ? { from: first.next } : {}) },
      signal(),
    );

    expect(second.roles.map((role) => role.name)).toEqual(['ab3']);
    expect(second.next).toBeUndefined();
    expect(engine.of('GetRole').map((request) => request.params.get('RoleName'))).toEqual(
      expect.arrayContaining(['ab1', 'ab2', 'ab3']),
    );
    expect(engine.of('GetRole')).toHaveLength(3);
  });

  it('reads every page once for a text no name contains, and gives an empty page with no GetRole', async () => {
    engine.handlers.ListRoles = listRolesInTurn([
      listRolesAnswer(['a1', 'a2'], 'marker-1'),
      listRolesAnswer(['b1', 'b2'], 'marker-2'),
      listRolesAnswer(['c1', 'c2']),
    ]);

    const page = await listRoles(endpoint, { pageSize: 2, filter: 'zz' }, signal());

    expect(engine.of('ListRoles').map((request) => request.params.get('Marker'))).toEqual([
      null,
      'marker-1',
      'marker-2',
    ]);
    expect(page).toEqual({ roles: [] });
    expect(engine.of('GetRole')).toHaveLength(0);
  });
});

describe('a role', () => {
  it('reads GetRole and both policy lists with MaxItems 100, and gives the role and its policies in order', async () => {
    engine.handlers.GetRole = () =>
      getRoleAnswer({
        name: 'Worker',
        path: '/team/',
        description: 'runs <jobs>',
        maxSessionDuration: 7200,
        lastUsed: '2026-11-15T00:00:00Z',
        boundary: 'arn:aws:iam::aws:policy/PowerUserAccess',
        tags: [
          ['team', 'a'],
          ['env', 'dev'],
        ],
      });
    engine.handlers.ListAttachedRolePolicies = () =>
      attachedAnswer([
        ['ReadOnlyAccess', 'arn:aws:iam::aws:policy/ReadOnlyAccess'],
        ['mine', 'arn:aws:iam::000000000000:policy/mine'],
      ]);
    engine.handlers.ListRolePolicies = () => inlineAnswer(['inline-1'], 'more');

    const read = await getRole(endpoint, 'worker', signal());

    expect(engine.actions().sort()).toEqual(['GetRole', 'ListAttachedRolePolicies', 'ListRolePolicies']);
    for (const request of engine.sent) {
      expect(request.params.get('RoleName')).toBe('worker');
    }
    expect(engine.of('ListAttachedRolePolicies')[0]?.params.get('MaxItems')).toBe('100');
    expect(engine.of('ListRolePolicies')[0]?.params.get('MaxItems')).toBe('100');
    expect(read).toEqual({
      kind: 'found',
      role: {
        name: 'Worker',
        id: 'AROAWORKER',
        path: '/team/',
        arn: 'arn:aws:iam::000000000000:role/team/Worker',
        createDate: new Date('2026-11-17T09:05:03.500Z'),
        trustPolicy: LAMBDA_TRUST,
        description: 'runs <jobs>',
        maxSessionDuration: 7200,
        lastUsed: new Date('2026-11-15T00:00:00Z'),
        permissionsBoundary: 'arn:aws:iam::aws:policy/PowerUserAccess',
        tags: [
          { key: 'team', value: 'a' },
          { key: 'env', value: 'dev' },
        ],
      },
      policies: {
        kind: 'read',
        items: [
          { kind: 'managed', name: 'ReadOnlyAccess', arn: 'arn:aws:iam::aws:policy/ReadOnlyAccess' },
          { kind: 'managed', name: 'mine', arn: 'arn:aws:iam::000000000000:policy/mine' },
          { kind: 'inline', name: 'inline-1' },
        ],
        truncated: true,
      },
    });
  });

  it('is "not found", not a failure, when GetRole answers NoSuchEntity', async () => {
    const missing: Handler = () => errorAnswer(404, 'NoSuchEntity', 'The role with name x cannot be found.');
    engine.fallback = missing;

    expect(await getRole(endpoint, 'x', signal())).toEqual({ kind: 'not-found' });
  });

  it('gives the role with the policies’ failure beside it when ListAttachedRolePolicies fails and GetRole does not', async () => {
    engine.handlers.GetRole = () => getRoleAnswer({ name: 'r' });
    engine.handlers.ListAttachedRolePolicies = () => errorAnswer(500, 'ServiceFailure', 'broken');
    engine.handlers.ListRolePolicies = () => inlineAnswer([]);

    const read = await getRole(endpoint, 'r', signal());

    expect(read.kind).toBe('found');
    expect(read.kind === 'found' && read.role.name).toBe('r');
    expect(read.kind === 'found' && read.policies).toEqual({
      kind: 'failed',
      failure: { kind: 'other', operation: 'ListAttachedRolePolicies', code: 'ServiceFailure', message: 'broken' },
    });
  });
});

describe('the caller’s account', () => {
  it('sends one GetUser without a user name and gives the account of the answer’s ARN', async () => {
    engine.handlers.GetUser = () =>
      ok(
        'GetUser',
        '<User><Path>/</Path><UserName>emulator</UserName><UserId>AIDA1</UserId><Arn>arn:aws:iam::000000000000:user/emulator</Arn><CreateDate>2026-11-17T09:05:03Z</CreateDate></User>',
      );

    expect(await getCallerAccount(endpoint, signal())).toBe('000000000000');
    expect(engine.actions()).toEqual(['GetUser']);
    expect(engine.sent[0]?.params.has('UserName')).toBe(false);
  });
});

describe('the policy list', () => {
  it('sends one ListPolicies with Scope All, MaxItems 20 and the marker given; each policy with name, ARN and type', async () => {
    engine.handlers.ListPolicies = () =>
      policiesAnswer(
        [
          ['mine', 'arn:aws:iam::000000000000:policy/mine'],
          ['ReadOnlyAccess', 'arn:aws:iam::aws:policy/ReadOnlyAccess'],
        ],
        'marker-2',
      );

    const page = await listPolicies(endpoint, { pageSize: 20, from: { marker: 'marker-1', skip: 0 } }, signal());

    expect(engine.actions()).toEqual(['ListPolicies']);
    const params = engine.sent[0]?.params;
    expect(params?.get('Scope')).toBe('All');
    expect(params?.get('MaxItems')).toBe('20');
    expect(params?.get('Marker')).toBe('marker-1');
    expect(page).toEqual({
      policies: [
        { name: 'mine', arn: 'arn:aws:iam::000000000000:policy/mine', type: 'Customer managed' },
        { name: 'ReadOnlyAccess', arn: 'arn:aws:iam::aws:policy/ReadOnlyAccess', type: 'AWS managed' },
      ],
      next: { marker: 'marker-2', skip: 0 },
    });
  });

  it('reads on with a filter text as the role list does', async () => {
    let call = 0;
    engine.handlers.ListPolicies = () => {
      call += 1;
      return call === 1
        ? policiesAnswer([['ReadOnlyAccess', 'arn:aws:iam::aws:policy/ReadOnlyAccess']], 'marker-1')
        : policiesAnswer([
            ['AdministratorAccess', 'arn:aws:iam::aws:policy/AdministratorAccess'],
            ['S3ReadOnly', 'arn:aws:iam::aws:policy/S3ReadOnly'],
          ]);
    };

    const page = await listPolicies(endpoint, { pageSize: 2, filter: 'readonly' }, signal());

    expect(engine.of('ListPolicies').map((request) => request.params.get('Marker'))).toEqual([null, 'marker-1']);
    expect(page.policies.map((policy) => policy.name)).toEqual(['ReadOnlyAccess', 'S3ReadOnly']);
    expect(page.next).toBeUndefined();
  });
});

describe('updating a role', () => {
  it('sends Description without MaxSessionDuration when the duration is the one read', async () => {
    await updateRole(endpoint, { name: 'r', description: 'new', maxSessionDuration: 3600 }, 3600, signal());

    expect(engine.actions()).toEqual(['UpdateRole']);
    const params = engine.sent[0]?.params;
    expect(params?.get('RoleName')).toBe('r');
    expect(params?.get('Description')).toBe('new');
    expect(params?.has('MaxSessionDuration')).toBe(false);
  });

  it('sends both with a new duration', async () => {
    await updateRole(endpoint, { name: 'r', description: 'new', maxSessionDuration: 7200 }, 3600, signal());

    expect(engine.sent[0]?.params.get('MaxSessionDuration')).toBe('7200');
    expect(engine.sent[0]?.params.get('Description')).toBe('new');
  });

  it('sends RoleName and Description with nothing changed, and an emptied description as empty', async () => {
    await updateRole(endpoint, { name: 'r', description: 'same', maxSessionDuration: 3600 }, 3600, signal());
    await updateRole(endpoint, { name: 'r', description: '', maxSessionDuration: 3600 }, 3600, signal());

    const [unchanged, emptied] = engine.sent;
    expect([...(unchanged?.params.keys() ?? [])].sort()).toEqual(['Action', 'Description', 'RoleName', 'Version']);
    expect(emptied?.params.has('Description')).toBe(true);
    expect(emptied?.params.get('Description')).toBe('');
    expect(emptied?.params.has('MaxSessionDuration')).toBe(false);
  });
});

describe('creating a role', () => {
  const created: Handler = (request) =>
    ok('CreateRole', `<Role>${roleXml({ name: request.params.get('RoleName') ?? '' })}</Role>`);

  it('sends one CreateRole with RoleName and AssumeRolePolicyDocument and no other member', async () => {
    engine.handlers.CreateRole = created;

    await createRole(endpoint, { name: 'new-role', trustPolicy: '{"Version":"2012-10-17","Statement":[]}' }, signal());

    expect(engine.actions()).toEqual(['CreateRole']);
    const params = engine.sent[0]?.params;
    expect([...(params?.keys() ?? [])].sort()).toEqual(['Action', 'AssumeRolePolicyDocument', 'RoleName', 'Version']);
    expect(params?.get('AssumeRolePolicyDocument')).toBe('{"Version":"2012-10-17","Statement":[]}');
  });

  it('adds Description and Tags in the editor’s order, and never Path, MaxSessionDuration or PermissionsBoundary', async () => {
    engine.handlers.CreateRole = created;

    await createRole(
      endpoint,
      {
        name: 'new-role',
        trustPolicy: '{}',
        description: 'a role',
        tags: [
          { key: 'z', value: '1' },
          { key: 'a', value: '2' },
        ],
      },
      signal(),
    );

    const params = engine.sent[0]?.params;
    expect(params?.get('Description')).toBe('a role');
    expect(params?.get('Tags.member.1.Key')).toBe('z');
    expect(params?.get('Tags.member.1.Value')).toBe('1');
    expect(params?.get('Tags.member.2.Key')).toBe('a');
    expect(params?.get('Tags.member.2.Value')).toBe('2');
    for (const name of params?.keys() ?? []) {
      expect(name).not.toMatch(/^(Path|MaxSessionDuration|PermissionsBoundary)/);
    }
  });

  it('attaches three policies after the answer of CreateRole, in the order given, each after the previous answer', async () => {
    engine.handlers.CreateRole = created;
    const policies = ['p1', 'p2', 'p3'].map((name) => ({ name, arn: `arn:aws:iam::aws:policy/${name}` }));

    const result = await createRole(endpoint, { name: 'new-role', trustPolicy: '{}', policies }, signal());

    expect(engine.log).toEqual([
      'sent CreateRole',
      'answered CreateRole',
      'sent AttachRolePolicy',
      'answered AttachRolePolicy',
      'sent AttachRolePolicy',
      'answered AttachRolePolicy',
      'sent AttachRolePolicy',
      'answered AttachRolePolicy',
    ]);
    expect(engine.of('AttachRolePolicy').map((request) => request.params.get('PolicyArn'))).toEqual(
      policies.map((policy) => policy.arn),
    );
    expect(engine.of('AttachRolePolicy').every((request) => request.params.get('RoleName') === 'new-role')).toBe(true);
    expect(result).toEqual({ name: 'new-role', attachFailures: [] });
  });

  it('sends no AttachRolePolicy when CreateRole is refused, and the result is that refusal', async () => {
    engine.handlers.CreateRole = () =>
      errorAnswer(409, 'EntityAlreadyExists', 'Role with name new-role already exists.');

    expect(
      await failure(
        createRole(
          endpoint,
          { name: 'new-role', trustPolicy: '{}', policies: [{ name: 'p', arn: 'arn:aws:iam::aws:policy/p' }] },
          signal(),
        ),
      ),
    ).toEqual({
      kind: 'other',
      operation: 'CreateRole',
      code: 'EntityAlreadyExists',
      message: 'Role with name new-role already exists.',
    });
    expect(engine.actions()).toEqual(['CreateRole']);
  });

  it('still sends the third AttachRolePolicy when the second is refused, and names the policy that failed', async () => {
    engine.handlers.CreateRole = created;
    engine.handlers.AttachRolePolicy = (request) =>
      request.params.get('PolicyArn')?.endsWith('/p2') === true
        ? errorAnswer(404, 'NoSuchEntity', 'Policy arn:aws:iam::aws:policy/p2 does not exist or is not attachable.')
        : ok('AttachRolePolicy', '');
    const policies = ['p1', 'p2', 'p3'].map((name) => ({ name, arn: `arn:aws:iam::aws:policy/${name}` }));

    const result = await createRole(endpoint, { name: 'new-role', trustPolicy: '{}', policies }, signal());

    expect(engine.of('AttachRolePolicy')).toHaveLength(3);
    expect(result).toEqual({
      name: 'new-role',
      attachFailures: [
        {
          policy: policies[1],
          failure: {
            kind: 'other',
            operation: 'AttachRolePolicy',
            code: 'NoSuchEntity',
            message: 'Policy arn:aws:iam::aws:policy/p2 does not exist or is not attachable.',
          },
        },
      ],
    });
  });
});

describe('deleting roles', () => {
  function holdingEverything() {
    engine.handlers.ListInstanceProfilesForRole = () => profilesAnswer(['prof-1', 'prof-2']);
    engine.handlers.ListAttachedRolePolicies = () =>
      attachedAnswer([
        ['a1', 'arn:aws:iam::aws:policy/a1'],
        ['a2', 'arn:aws:iam::000000000000:policy/a2'],
      ]);
    engine.handlers.ListRolePolicies = () => inlineAnswer(['i1', 'i2']);
  }

  const steps = [
    'ListInstanceProfilesForRole',
    'RemoveRoleFromInstanceProfile',
    'RemoveRoleFromInstanceProfile',
    'ListAttachedRolePolicies',
    'DetachRolePolicy',
    'DetachRolePolicy',
    'ListRolePolicies',
    'DeleteRolePolicy',
    'DeleteRolePolicy',
    'DeleteRole',
  ];

  it('removes the role from its profiles, detaches and deletes its policies, then deletes it, in that order', async () => {
    holdingEverything();

    const result = await deleteRoles(endpoint, [{ name: 'r', path: '/' }], signal());

    expect(engine.actions()).toEqual(steps);
    expect(
      engine.of('RemoveRoleFromInstanceProfile').map((request) => request.params.get('InstanceProfileName')),
    ).toEqual(['prof-1', 'prof-2']);
    expect(engine.of('DetachRolePolicy').map((request) => request.params.get('PolicyArn'))).toEqual([
      'arn:aws:iam::aws:policy/a1',
      'arn:aws:iam::000000000000:policy/a2',
    ]);
    expect(engine.of('DeleteRolePolicy').map((request) => request.params.get('PolicyName'))).toEqual(['i1', 'i2']);
    expect(engine.sent.every((request) => request.params.get('RoleName') === 'r')).toBe(true);
    expect(engine.actions().some((action) => action.startsWith('DeleteInstanceProfile'))).toBe(false);
    expect(result).toEqual({ deleted: ['r'], failed: [] });
  });

  it('reads a truncated list on with its marker to its end before the next step', async () => {
    holdingEverything();
    engine.handlers.ListInstanceProfilesForRole = (request) =>
      request.params.get('Marker') === 'm-1' ? profilesAnswer(['prof-2']) : profilesAnswer(['prof-1'], 'm-1');
    engine.handlers.ListAttachedRolePolicies = (request) =>
      request.params.get('Marker') === 'm-2'
        ? attachedAnswer([['a2', 'arn:aws:iam::aws:policy/a2']])
        : attachedAnswer([['a1', 'arn:aws:iam::aws:policy/a1']], 'm-2');
    engine.handlers.ListRolePolicies = (request) =>
      request.params.get('Marker') === 'm-3' ? inlineAnswer(['i2']) : inlineAnswer(['i1'], 'm-3');

    await deleteRoles(endpoint, [{ name: 'r', path: '/' }], signal());

    expect(engine.actions()).toEqual([
      'ListInstanceProfilesForRole',
      'ListInstanceProfilesForRole',
      'RemoveRoleFromInstanceProfile',
      'RemoveRoleFromInstanceProfile',
      'ListAttachedRolePolicies',
      'ListAttachedRolePolicies',
      'DetachRolePolicy',
      'DetachRolePolicy',
      'ListRolePolicies',
      'ListRolePolicies',
      'DeleteRolePolicy',
      'DeleteRolePolicy',
      'DeleteRole',
    ]);
    expect(engine.of('ListInstanceProfilesForRole')[1]?.params.get('Marker')).toBe('m-1');
    expect(engine.of('ListAttachedRolePolicies')[1]?.params.get('Marker')).toBe('m-2');
    expect(engine.of('ListRolePolicies')[1]?.params.get('Marker')).toBe('m-3');
  });

  it('sends one DeleteServiceLinkedRole and nothing else for a role under /aws-service-role/', async () => {
    engine.handlers.DeleteServiceLinkedRole = () =>
      ok('DeleteServiceLinkedRole', '<DeletionTaskId>task/aws-service-role/x/1</DeletionTaskId>');

    const result = await deleteRoles(
      endpoint,
      [{ name: 'AWSServiceRoleForX', path: '/aws-service-role/x/' }],
      signal(),
    );

    expect(engine.actions()).toEqual(['DeleteServiceLinkedRole']);
    expect(engine.sent[0]?.params.get('RoleName')).toBe('AWSServiceRoleForX');
    expect(result).toEqual({ deleted: ['AWSServiceRoleForX'], failed: [] });
  });

  it('handles three roles in the order given, each after the previous one is finished', async () => {
    engine.handlers.ListInstanceProfilesForRole = () => profilesAnswer([]);
    engine.handlers.ListAttachedRolePolicies = () => attachedAnswer([]);
    engine.handlers.ListRolePolicies = () => inlineAnswer([]);

    await deleteRoles(
      endpoint,
      ['r1', 'r2', 'r3'].map((name) => ({ name, path: '/' })),
      signal(),
    );

    const byRole = engine.sent.map((request) => `${request.params.get('RoleName') ?? ''} ${request.action}`);
    expect(byRole).toEqual(
      ['r1', 'r2', 'r3'].flatMap((name) =>
        ['ListInstanceProfilesForRole', 'ListAttachedRolePolicies', 'ListRolePolicies', 'DeleteRole'].map(
          (action) => `${name} ${action}`,
        ),
      ),
    );
    for (let index = 1; index < engine.log.length; index += 2) {
      expect(engine.log[index]?.startsWith('answered')).toBe(true);
    }
  });

  it('ends a role at its refused DetachRolePolicy, still handles the next, and names which were deleted and which failed', async () => {
    holdingEverything();
    engine.handlers.DetachRolePolicy = (request) =>
      request.params.get('RoleName') === 'r2'
        ? errorAnswer(404, 'NoSuchEntity', 'Policy arn:aws:iam::aws:policy/a1 was not found.')
        : ok('DetachRolePolicy', '');

    const result = await deleteRoles(
      endpoint,
      ['r1', 'r2', 'r3'].map((name) => ({ name, path: '/' })),
      signal(),
    );

    const r2 = engine.sent
      .filter((request) => request.params.get('RoleName') === 'r2')
      .map((request) => request.action);
    expect(r2).toEqual([
      'ListInstanceProfilesForRole',
      'RemoveRoleFromInstanceProfile',
      'RemoveRoleFromInstanceProfile',
      'ListAttachedRolePolicies',
      'DetachRolePolicy',
    ]);
    expect(
      engine.sent.filter((request) => request.params.get('RoleName') === 'r3').map((request) => request.action),
    ).toEqual(steps);
    expect(result).toEqual({
      deleted: ['r1', 'r3'],
      failed: [
        {
          name: 'r2',
          failure: {
            kind: 'other',
            operation: 'DetachRolePolicy',
            code: 'NoSuchEntity',
            message: 'Policy arn:aws:iam::aws:policy/a1 was not found.',
          },
        },
      ],
    });
  });
});

describe('a failed request', () => {
  const calls: [string, () => Promise<unknown>][] = [
    ['ListRoles', () => listRoles(endpoint, { pageSize: 20 }, signal())],
    ['GetRole', () => getRole(endpoint, 'r', signal())],
    ['GetUser', () => getCallerAccount(endpoint, signal())],
    ['ListPolicies', () => listPolicies(endpoint, { pageSize: 20 }, signal())],
    [
      'UpdateRole',
      () => updateRole(endpoint, { name: 'r', description: '', maxSessionDuration: 3600 }, 3600, signal()),
    ],
    ['CreateRole', () => createRole(endpoint, { name: 'r', trustPolicy: '{}' }, signal())],
  ];

  it.each(calls)('is "not implemented", naming %s, when the operation answers 501', async (operation, call) => {
    engine.fallback = () => errorAnswer(501, 'NotImplemented', `operation ${operation} is not implemented`);

    expect(await failure(call())).toEqual({ kind: 'not-implemented', operation });
  });

  it('is "not implemented", naming the operation, for a delete step that answers 501', async () => {
    engine.handlers.ListInstanceProfilesForRole = () => profilesAnswer([]);
    engine.handlers.ListAttachedRolePolicies = () => errorAnswer(501, 'NotImplemented', 'not implemented');

    const result = await deleteRoles(endpoint, [{ name: 'r', path: '/' }], signal());

    expect(result.failed).toEqual([
      { name: 'r', failure: { kind: 'not-implemented', operation: 'ListAttachedRolePolicies' } },
    ]);
  });

  it('is "access denied" with the message returned for AccessDenied', async () => {
    engine.fallback = () =>
      errorAnswer(403, 'AccessDenied', 'User emulator is not authorized to perform iam:ListRoles');

    expect(await failure(listRoles(endpoint, { pageSize: 20 }, signal()))).toEqual({
      kind: 'access-denied',
      operation: 'ListRoles',
      message: 'User emulator is not authorized to perform iam:ListRoles',
    });
  });

  it.each([
    [503, 'EmulatorUnavailable', 'The emulator at https://127.0.0.1:9411 could not be reached: connection refused'],
    [504, 'EmulatorTimeout', 'The emulator at https://127.0.0.1:9411 did not answer within 30 seconds'],
  ])('is "emulator did not answer" with the engine’s message for %i %s', async (status, code, message) => {
    engine.fallback = () => errorAnswer(status, code, message);

    expect(
      await failure(updateRole(endpoint, { name: 'r', description: '', maxSessionDuration: 1 }, 1, signal())),
    ).toEqual({
      kind: 'emulator-did-not-answer',
      operation: 'UpdateRole',
      message,
    });
  });

  it('is "engine did not answer" when the request fails at the network level', async () => {
    engine.fallback = () => 'network-error';

    expect(await failure(listRoles(endpoint, { pageSize: 20 }, signal()))).toEqual({
      kind: 'engine-did-not-answer',
      operation: 'ListRoles',
    });
  });

  it('is "engine did not answer" when the session request fails at the network level', async () => {
    engine.session = () => 'network-error';

    expect(await failure(getCallerAccount(endpoint, signal()))).toEqual({
      kind: 'engine-did-not-answer',
      operation: 'GetUser',
    });
    expect(engine.sent).toHaveLength(0);
  });

  it('gives any other answer’s code without the suffix Exception, and its message', async () => {
    engine.handlers.CreateRole = () => errorAnswer(409, 'EntityAlreadyExists', 'Role with name r already exists.');
    engine.handlers.UpdateRole = () =>
      errorAnswer(400, 'ValidationError', 'Member must have value less than or equal to 43200');

    expect(await failure(createRole(endpoint, { name: 'r', trustPolicy: '{}' }, signal()))).toEqual({
      kind: 'other',
      operation: 'CreateRole',
      code: 'EntityAlreadyExists',
      message: 'Role with name r already exists.',
    });
    expect(
      await failure(updateRole(endpoint, { name: 'r', description: '', maxSessionDuration: 43201 }, 3600, signal())),
    ).toEqual({
      kind: 'other',
      operation: 'UpdateRole',
      code: 'ValidationError',
      message: 'Member must have value less than or equal to 43200',
    });
  });

  it('gives the answer’s status line in the code’s place for an error answer without a code', async () => {
    engine.fallback = () => ({ status: 418, statusText: "I'm a teapot", body: '' });

    expect(await failure(listRoles(endpoint, { pageSize: 20 }, signal()))).toEqual({
      kind: 'other',
      operation: 'ListRoles',
      code: "HTTP 418 I'm a teapot",
    });
  });
});

describe('an aborted call', () => {
  it('rejects with the signal’s reason, and nothing else, once the signal aborts', async () => {
    engine.fallback = () => 'hold';
    const controller = new AbortController();
    const reason = new Error('not wanted any more');

    const settled = listRoles(endpoint, { pageSize: 20 }, controller.signal).then(
      (page) => ({ resolved: page as unknown }),
      (error: unknown) => ({ rejected: error }),
    );
    await vi.waitFor(() => {
      expect(engine.sent).toHaveLength(1);
    });
    controller.abort(reason);

    const outcome = await settled;
    expect(outcome).toEqual({ rejected: reason });
    expect((outcome as { rejected: unknown }).rejected).toBe(reason);
  });

  it('rejects a delete with the signal’s reason and sends nothing more after the abort', async () => {
    engine.fallback = () => 'hold';
    const controller = new AbortController();
    const reason = new Error('left the page');

    const settled = deleteRoles(endpoint, [{ name: 'r1' }, { name: 'r2' }], controller.signal).then(
      (result) => ({ resolved: result as unknown }),
      (error: unknown) => ({ rejected: error }),
    );
    await vi.waitFor(() => {
      expect(engine.sent).toHaveLength(1);
    });
    controller.abort(reason);

    expect(await settled).toEqual({ rejected: reason });
    expect(engine.sent).toHaveLength(1);
  });

  it('rejects with the reason of a signal aborted before the call, and sends nothing', async () => {
    const controller = new AbortController();
    const reason = new Error('aborted before');
    controller.abort(reason);

    await expect(getRole(endpoint, 'r', controller.signal)).rejects.toBe(reason);
    await expect(createRole(endpoint, { name: 'r', trustPolicy: '{}' }, controller.signal)).rejects.toBe(reason);
    expect(engine.sent).toHaveLength(0);
  });
});
