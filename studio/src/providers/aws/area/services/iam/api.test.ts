import { ListRolesCommand } from '@aws-sdk/client-iam';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EndpointRefusedError, engineEndpoint } from '../../../../../lib/aws/client-factory';
import { RequestError } from '../../../../../lib/aws/request';
import {
  attachRolePolicies,
  createPolicy,
  createPolicyVersion,
  createRole,
  deletePolicy,
  deletePolicyVersion,
  deleteRolePolicy,
  deleteRoles,
  detachRolePolicy,
  getPolicy,
  getPolicyDocument,
  getRolePolicyDocument,
  putRolePolicy,
  setDefaultPolicyVersion,
  updateTrustPolicy,
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
  /** Headers of the answer; `Content-Type: text/xml` when none is given. */
  headers?: Record<string, string>;
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
  signal: AbortSignal;
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
        signal: request.signal,
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
      headers: answer.headers ?? { 'content-type': 'text/xml' },
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

/**
 * A refusal of the engine's own, in the shape the engine writes for the Query protocol
 * (`engine/crates/emuforge-server/src/aws_error.rs`, `render`): `text/xml`, an XML declaration, no namespace and no
 * `RequestId`, the type `Receiver` for a 5xx status and `Sender` otherwise.
 */
function engineRefusal(status: number, code: string, message: string, headers: Record<string, string> = {}): Answer {
  return {
    status,
    headers: { 'content-type': 'text/xml', ...headers },
    body: `<?xml version="1.0"?><ErrorResponse><Error><Type>${status >= 500 ? 'Receiver' : 'Sender'}</Type><Code>${code}</Code><Message>${esc(message)}</Message></Error></ErrorResponse>`,
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
        return engineRefusal(401, 'SessionInvalid', 'The session is not valid.', {
          'www-authenticate': 'EmuForge-Session',
        });
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
    engine.handlers.ListRoles = () => engineRefusal(status, code, message);

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

  it('aborts the page’s other GetRole requests once one fails other than with NoSuchEntity', async () => {
    engine.handlers.ListRoles = () => listRolesAnswer(['held', 'broken']);
    engine.handlers.GetRole = (request) =>
      request.params.get('RoleName') === 'broken' ? errorAnswer(400, 'ValidationError', 'bad name') : 'hold';

    expect(await failure(listRoles(endpoint, { pageSize: 20 }, signal()))).toMatchObject({
      operation: 'GetRole',
      code: 'ValidationError',
    });
    const held = engine.of('GetRole').find((request) => request.params.get('RoleName') === 'held');
    expect(held?.signal.aborted).toBe(true);
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
        { name: 'mine', arn: 'arn:aws:iam::000000000000:policy/mine', type: 'Customer managed', attachmentCount: 0 },
        {
          name: 'ReadOnlyAccess',
          arn: 'arn:aws:iam::aws:policy/ReadOnlyAccess',
          type: 'AWS managed',
          attachmentCount: 0,
        },
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
    engine.fallback = () => engineRefusal(status, code, message);

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

// Test criteria, "Unit s1 — providers/aws/area/services/iam/api.test.ts" (issue 535, design "The calls").

/** A document written over several lines with two spaces between two tokens, so a rewritten text is told apart. */
const DOC_A = '{\n  "Version": "2012-10-17",\n  "Statement": [{"Effect": "Allow",  "Action": "s3:GetObject", "Resource": "*"}]\n}';
const POLICY_ARN = 'arn:aws:iam::000000000000:policy/team/mine';

function getRolePolicyAnswer(role: string, name: string, document: string): Answer {
  return ok(
    'GetRolePolicy',
    `<RoleName>${esc(role)}</RoleName><PolicyName>${esc(name)}</PolicyName><PolicyDocument>${encodeURIComponent(document)}</PolicyDocument>`,
  );
}

function getPolicyAnswer(arn: string, defaultVersion = 'v2'): Answer {
  return ok(
    'GetPolicy',
    `<Policy><PolicyName>${esc(arn.slice(arn.lastIndexOf('/') + 1))}</PolicyName><PolicyId>ANPA1</PolicyId><Arn>${esc(arn)}</Arn><Path>/team/</Path><DefaultVersionId>${defaultVersion}</DefaultVersionId><AttachmentCount>2</AttachmentCount><IsAttachable>true</IsAttachable><Description>Read &lt;b&gt;</Description><CreateDate>2026-11-17T09:05:03Z</CreateDate><UpdateDate>2026-11-18T10:00:00Z</UpdateDate></Policy>`,
  );
}

function getPolicyVersionAnswer(version: string, document: string, isDefault: boolean): Answer {
  return ok(
    'GetPolicyVersion',
    `<PolicyVersion><Document>${encodeURIComponent(document)}</Document><VersionId>${version}</VersionId><IsDefaultVersion>${String(isDefault)}</IsDefaultVersion><CreateDate>2026-11-17T09:05:03Z</CreateDate></PolicyVersion>`,
  );
}

function versionsAnswer(versions: [string, boolean][], marker?: string): Answer {
  const members = versions
    .map(
      ([id, isDefault]) =>
        `<member><VersionId>${id}</VersionId><IsDefaultVersion>${String(isDefault)}</IsDefaultVersion><CreateDate>2026-11-17T09:05:03Z</CreateDate></member>`,
    )
    .join('');
  return ok('ListPolicyVersions', `<Versions>${members}</Versions>${truncation(marker)}`);
}

function entitiesAnswer(
  { roles = [], users = [], groups = [] }: { roles?: string[]; users?: string[]; groups?: string[] },
  marker?: string,
): Answer {
  const member = (tag: string) => (name: string) => `<member><${tag}>${esc(name)}</${tag}></member>`;
  return ok(
    'ListEntitiesForPolicy',
    `<PolicyGroups>${groups.map(member('GroupName')).join('')}</PolicyGroups><PolicyUsers>${users.map(member('UserName')).join('')}</PolicyUsers><PolicyRoles>${roles.map(member('RoleName')).join('')}</PolicyRoles>${truncation(marker)}`,
  );
}

/** Answers each request of an action in turn with the next of `answers`. */
function inTurn(answers: Answer[]): Handler {
  let next = 0;
  return () => {
    const answer = answers[next] ?? answers[answers.length - 1] ?? { status: 500 };
    next += 1;
    return answer;
  };
}

/** The failure a call of issue 535 rejected with. */
async function requestFailure(promise: Promise<unknown>): Promise<IamFailure> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(RequestError);
    return (error as RequestError).failure;
  }
  throw new Error('the call resolved');
}

/** Every request was sent after the previous one's answer. */
function oneAfterAnother(log: string[]): void {
  for (let index = 0; index < log.length; index += 2) {
    expect(log[index]?.startsWith('sent ')).toBe(true);
    expect(log[index + 1]).toBe(`answered ${(log[index] ?? '').slice('sent '.length)}`);
  }
}

describe('the calls of a role’s documents and permissions', () => {
  it('reads an inline policy with GetRolePolicy and gives its text percent-decoded once', async () => {
    engine.handlers.GetRolePolicy = (request) =>
      getRolePolicyAnswer(request.params.get('RoleName') ?? '', request.params.get('PolicyName') ?? '', DOC_A);

    expect(await getRolePolicyDocument(endpoint, 'role-a', 'inline-a', signal())).toEqual({
      kind: 'found',
      text: DOC_A,
    });
    expect(engine.actions()).toEqual(['GetRolePolicy']);
    expect(engine.sent[0]?.params.get('RoleName')).toBe('role-a');
    expect(engine.sent[0]?.params.get('PolicyName')).toBe('inline-a');
  });

  it('is "not found" for an inline policy the emulator does not hold', async () => {
    engine.handlers.GetRolePolicy = () => errorAnswer(404, 'NoSuchEntity', 'The role policy cannot be found.');

    expect(await getRolePolicyDocument(endpoint, 'r', 'p', signal())).toEqual({ kind: 'not-found' });
  });

  it('reads a managed policy without a version: GetPolicy for its default, then GetPolicyVersion of it', async () => {
    engine.handlers.GetPolicy = () => getPolicyAnswer(POLICY_ARN, 'v3');
    engine.handlers.GetPolicyVersion = () => getPolicyVersionAnswer('v3', DOC_A, true);

    expect(await getPolicyDocument(endpoint, POLICY_ARN, undefined, signal())).toEqual({
      kind: 'found',
      text: DOC_A,
      versionId: 'v3',
      isDefault: true,
    });
    expect(engine.actions()).toEqual(['GetPolicy', 'GetPolicyVersion']);
    oneAfterAnother(engine.log);
    expect(engine.of('GetPolicy')[0]?.params.get('PolicyArn')).toBe(POLICY_ARN);
    expect(engine.of('GetPolicyVersion')[0]?.params.get('PolicyArn')).toBe(POLICY_ARN);
    expect(engine.of('GetPolicyVersion')[0]?.params.get('VersionId')).toBe('v3');
  });

  it('reads a named version of a managed policy with GetPolicyVersion alone', async () => {
    engine.handlers.GetPolicyVersion = () => getPolicyVersionAnswer('v1', DOC_A, false);

    expect(await getPolicyDocument(endpoint, POLICY_ARN, 'v1', signal())).toEqual({
      kind: 'found',
      text: DOC_A,
      versionId: 'v1',
      isDefault: false,
    });
    expect(engine.actions()).toEqual(['GetPolicyVersion']);
  });

  it('is "not found" when GetPolicy or GetPolicyVersion answers NoSuchEntity', async () => {
    engine.handlers.GetPolicy = () => errorAnswer(404, 'NoSuchEntity', 'Policy absent was not found.');
    expect(await getPolicyDocument(endpoint, POLICY_ARN, undefined, signal())).toEqual({ kind: 'not-found' });
    expect(engine.actions()).toEqual(['GetPolicy']);

    engine.handlers.GetPolicy = () => getPolicyAnswer(POLICY_ARN);
    engine.handlers.GetPolicyVersion = () => errorAnswer(404, 'NoSuchEntity', 'Version v2 was not found.');
    expect(await getPolicyDocument(endpoint, POLICY_ARN, undefined, signal())).toEqual({ kind: 'not-found' });
  });

  it('attaches policies one after another, in the order given', async () => {
    const policies = [
      { name: 'a', arn: 'arn:aws:iam::aws:policy/a' },
      { name: 'b', arn: 'arn:aws:iam::000000000000:policy/b' },
    ];

    expect(await attachRolePolicies(endpoint, 'role-a', policies, signal())).toEqual({ attached: policies });
    expect(engine.actions()).toEqual(['AttachRolePolicy', 'AttachRolePolicy']);
    expect(engine.sent.map((request) => request.params.get('PolicyArn'))).toEqual(policies.map(({ arn }) => arn));
    expect(engine.sent.every((request) => request.params.get('RoleName') === 'role-a')).toBe(true);
    oneAfterAnother(engine.log);
  });

  it('stops attaching at the first refusal: the first attached, the second with its failure, the third never sent', async () => {
    const policies = [
      { name: 'a', arn: 'arn:aws:iam::aws:policy/a' },
      { name: 'b', arn: 'arn:aws:iam::aws:policy/b' },
      { name: 'c', arn: 'arn:aws:iam::aws:policy/c' },
    ];
    engine.handlers.AttachRolePolicy = (request) =>
      request.params.get('PolicyArn') === policies[1]?.arn
        ? errorAnswer(404, 'NoSuchEntity', 'Policy b does not exist.')
        : ok('AttachRolePolicy', '');

    expect(await attachRolePolicies(endpoint, 'r', policies, signal())).toEqual({
      attached: [policies[0]],
      failed: {
        policy: policies[1],
        failure: {
          kind: 'other',
          operation: 'AttachRolePolicy',
          code: 'NoSuchEntity',
          message: 'Policy b does not exist.',
        },
      },
    });
    expect(engine.sent.map((request) => request.params.get('PolicyArn'))).toEqual([policies[0]?.arn, policies[1]?.arn]);
  });

  it('sends DetachRolePolicy, PutRolePolicy, DeleteRolePolicy and UpdateAssumeRolePolicy with their inputs, texts as given', async () => {
    await detachRolePolicy(endpoint, 'r', POLICY_ARN, signal());
    await putRolePolicy(endpoint, 'r', 'inline-a', DOC_A, signal());
    await deleteRolePolicy(endpoint, 'r', 'inline-a', signal());
    await updateTrustPolicy(endpoint, 'r', DOC_A, signal());

    expect(engine.actions()).toEqual(['DetachRolePolicy', 'PutRolePolicy', 'DeleteRolePolicy', 'UpdateAssumeRolePolicy']);
    const [detach, put, remove, trust] = engine.sent;
    expect(Object.fromEntries(detach?.params ?? [])).toMatchObject({ RoleName: 'r', PolicyArn: POLICY_ARN });
    expect(Object.fromEntries(put?.params ?? [])).toMatchObject({
      RoleName: 'r',
      PolicyName: 'inline-a',
      PolicyDocument: DOC_A,
    });
    expect(Object.fromEntries(remove?.params ?? [])).toMatchObject({ RoleName: 'r', PolicyName: 'inline-a' });
    expect(Object.fromEntries(trust?.params ?? [])).toMatchObject({ RoleName: 'r', PolicyDocument: DOC_A });
  });
});

describe('the calls of customer managed policies', () => {
  it('sends the scope given with ListPolicies, and gives each entry its attachment count and last change', async () => {
    engine.handlers.ListPolicies = () =>
      ok(
        'ListPolicies',
        `<Policies><member><PolicyName>mine</PolicyName><Arn>${POLICY_ARN}</Arn><Path>/team/</Path><AttachmentCount>3</AttachmentCount><UpdateDate>2026-11-18T10:00:00Z</UpdateDate></member></Policies>${truncation()}`,
      );

    for (const scope of ['Local', 'AWS', 'All'] as const) {
      const page = await listPolicies(endpoint, { pageSize: 2 }, signal(), scope);
      expect(page.policies).toEqual([
        {
          name: 'mine',
          arn: POLICY_ARN,
          type: 'Customer managed',
          attachmentCount: 3,
          updateDate: new Date('2026-11-18T10:00:00Z'),
        },
      ]);
    }
    expect(engine.of('ListPolicies').map((request) => request.params.get('Scope'))).toEqual(['Local', 'AWS', 'All']);
    expect(engine.of('ListPolicies').map((request) => request.params.get('MaxItems'))).toEqual(['2', '2', '2']);
  });

  it('reads a policy, then its versions and its entities, each to its end by Marker, one after another', async () => {
    engine.handlers.GetPolicy = () => getPolicyAnswer(POLICY_ARN);
    engine.handlers.ListPolicyVersions = inTurn([versionsAnswer([['v2', true]], 'mv'), versionsAnswer([['v1', false]])]);
    engine.handlers.ListEntitiesForPolicy = inTurn([
      entitiesAnswer({ roles: ['role-a'], users: ['user-a'] }, 'me'),
      entitiesAnswer({ groups: ['group-a'] }),
    ]);

    const read = await getPolicy(endpoint, POLICY_ARN, signal());

    expect(engine.actions()).toEqual([
      'GetPolicy',
      'ListPolicyVersions',
      'ListPolicyVersions',
      'ListEntitiesForPolicy',
      'ListEntitiesForPolicy',
    ]);
    oneAfterAnother(engine.log);
    expect(engine.of('ListPolicyVersions').map((request) => request.params.get('Marker'))).toEqual([null, 'mv']);
    expect(engine.of('ListEntitiesForPolicy').map((request) => request.params.get('Marker'))).toEqual([null, 'me']);
    expect(engine.sent.every((request) => request.params.get('PolicyArn') === POLICY_ARN)).toBe(true);
    expect(read).toEqual({
      kind: 'found',
      policy: {
        name: 'mine',
        arn: POLICY_ARN,
        type: 'Customer managed',
        id: 'ANPA1',
        path: '/team/',
        description: 'Read <b>',
        createDate: new Date('2026-11-17T09:05:03Z'),
        updateDate: new Date('2026-11-18T10:00:00Z'),
        defaultVersionId: 'v2',
        attachmentCount: 2,
      },
      versions: {
        kind: 'read',
        items: [
          { id: 'v2', isDefault: true, createDate: new Date('2026-11-17T09:05:03Z') },
          { id: 'v1', isDefault: false, createDate: new Date('2026-11-17T09:05:03Z') },
        ],
      },
      entities: {
        kind: 'read',
        items: [
          { kind: 'role', name: 'role-a' },
          { kind: 'user', name: 'user-a' },
          { kind: 'group', name: 'group-a' },
        ],
      },
    });
  });

  it('is "not found" when GetPolicy answers NoSuchEntity, and reads nothing more', async () => {
    engine.handlers.GetPolicy = () => errorAnswer(404, 'NoSuchEntity', 'Policy was not found.');

    expect(await getPolicy(endpoint, POLICY_ARN, signal())).toEqual({ kind: 'not-found' });
    expect(engine.actions()).toEqual(['GetPolicy']);
  });

  it('gives a refused versions or entities list as that part’s failure, and the policy still', async () => {
    engine.handlers.GetPolicy = () => getPolicyAnswer(POLICY_ARN);
    engine.handlers.ListPolicyVersions = () => errorAnswer(403, 'AccessDenied', 'no versions for you');
    engine.handlers.ListEntitiesForPolicy = () => entitiesAnswer({});

    const read = await getPolicy(endpoint, POLICY_ARN, signal());
    expect(read.kind === 'found' && read.versions).toEqual({
      kind: 'failed',
      failure: { kind: 'access-denied', operation: 'ListPolicyVersions', message: 'no versions for you' },
    });
    expect(read.kind === 'found' && read.entities).toEqual({ kind: 'read', items: [] });
    expect(read.kind === 'found' && read.policy.name).toBe('mine');

    engine.handlers.ListPolicyVersions = () => versionsAnswer([['v1', true]]);
    engine.handlers.ListEntitiesForPolicy = () => errorAnswer(501, 'NotImplemented', 'not implemented');
    const again = await getPolicy(endpoint, POLICY_ARN, signal());
    expect(again.kind === 'found' && again.entities).toEqual({
      kind: 'failed',
      failure: { kind: 'not-implemented', operation: 'ListEntitiesForPolicy' },
    });
    expect(again.kind === 'found' && again.versions).toEqual({ kind: 'read', items: [expect.objectContaining({ id: 'v1' })] });
  });

  it('sends CreatePolicy with the name, the description when not empty and the text as given', async () => {
    engine.handlers.CreatePolicy = (request) =>
      ok(
        'CreatePolicy',
        `<Policy><PolicyName>${esc(request.params.get('PolicyName') ?? '')}</PolicyName><Arn>arn:aws:iam::000000000000:policy/${esc(request.params.get('PolicyName') ?? '')}</Arn></Policy>`,
      );

    expect(await createPolicy(endpoint, { name: 'p1', description: 'Reads', document: DOC_A }, signal())).toBe(
      'arn:aws:iam::000000000000:policy/p1',
    );
    expect(await createPolicy(endpoint, { name: 'p2', description: '', document: DOC_A }, signal())).toBe(
      'arn:aws:iam::000000000000:policy/p2',
    );
    const [first, second] = engine.of('CreatePolicy');
    expect(Object.fromEntries(first?.params ?? [])).toMatchObject({
      PolicyName: 'p1',
      Description: 'Reads',
      PolicyDocument: DOC_A,
    });
    expect(second?.params.get('PolicyName')).toBe('p2');
    expect(second?.params.has('Description')).toBe(false);
    expect(second?.params.get('PolicyDocument')).toBe(DOC_A);
  });

  it('sends CreatePolicyVersion with SetAsDefault true, SetDefaultPolicyVersion and DeletePolicyVersion with their inputs', async () => {
    engine.handlers.CreatePolicyVersion = () =>
      ok('CreatePolicyVersion', '<PolicyVersion><VersionId>v3</VersionId><IsDefaultVersion>true</IsDefaultVersion></PolicyVersion>');

    expect(await createPolicyVersion(endpoint, POLICY_ARN, DOC_A, signal())).toBe('v3');
    await setDefaultPolicyVersion(endpoint, POLICY_ARN, 'v1', signal());
    await deletePolicyVersion(endpoint, POLICY_ARN, 'v2', signal());

    expect(engine.actions()).toEqual(['CreatePolicyVersion', 'SetDefaultPolicyVersion', 'DeletePolicyVersion']);
    const [create, setDefault, remove] = engine.sent;
    expect(Object.fromEntries(create?.params ?? [])).toMatchObject({
      PolicyArn: POLICY_ARN,
      PolicyDocument: DOC_A,
      SetAsDefault: 'true',
    });
    expect(Object.fromEntries(setDefault?.params ?? [])).toMatchObject({ PolicyArn: POLICY_ARN, VersionId: 'v1' });
    expect(Object.fromEntries(remove?.params ?? [])).toMatchObject({ PolicyArn: POLICY_ARN, VersionId: 'v2' });
  });
});

describe('deleting a policy', () => {
  function answerEverything(): void {
    engine.handlers.ListEntitiesForPolicy = inTurn([
      entitiesAnswer({ roles: ['role-a'] }, 'me'),
      entitiesAnswer({ users: ['user-a'], groups: ['group-a'] }),
    ]);
    engine.handlers.ListPolicyVersions = () =>
      versionsAnswer([
        ['v3', false],
        ['v2', true],
        ['v1', false],
      ]);
  }

  it('detaches from each role, user and group, deletes each version but the default, then the policy, one after another', async () => {
    answerEverything();

    expect(await deletePolicy(endpoint, POLICY_ARN, signal())).toEqual({ kind: 'deleted', detachedRoles: ['role-a'] });
    expect(engine.actions()).toEqual([
      'ListEntitiesForPolicy',
      'ListEntitiesForPolicy',
      'DetachRolePolicy',
      'DetachUserPolicy',
      'DetachGroupPolicy',
      'ListPolicyVersions',
      'DeletePolicyVersion',
      'DeletePolicyVersion',
      'DeletePolicy',
    ]);
    oneAfterAnother(engine.log);
    expect(engine.of('ListEntitiesForPolicy')[1]?.params.get('Marker')).toBe('me');
    expect(engine.of('DetachRolePolicy')[0]?.params.get('RoleName')).toBe('role-a');
    expect(engine.of('DetachUserPolicy')[0]?.params.get('UserName')).toBe('user-a');
    expect(engine.of('DetachGroupPolicy')[0]?.params.get('GroupName')).toBe('group-a');
    expect(engine.of('DeletePolicyVersion').map((request) => request.params.get('VersionId'))).toEqual(['v3', 'v1']);
    expect(engine.sent.every((request) => request.params.get('PolicyArn') === POLICY_ARN)).toBe(true);
  });

  const refused = errorAnswer(409, 'DeleteConflict', 'Cannot delete.');
  const steps: [string, string, unknown, string[]][] = [
    ['reading what it is attached to', 'ListEntitiesForPolicy', { kind: 'read-entities' }, []],
    ['detaching from a role', 'DetachRolePolicy', { kind: 'detach', entity: { kind: 'role', name: 'role-a' } }, []],
    ['detaching from a user', 'DetachUserPolicy', { kind: 'detach', entity: { kind: 'user', name: 'user-a' } }, ['role-a']],
    ['detaching from a group', 'DetachGroupPolicy', { kind: 'detach', entity: { kind: 'group', name: 'group-a' } }, ['role-a']],
    ['reading its versions', 'ListPolicyVersions', { kind: 'read-versions' }, ['role-a']],
    ['deleting a version', 'DeletePolicyVersion', { kind: 'delete-version', versionId: 'v3' }, ['role-a']],
    ['deleting the policy', 'DeletePolicy', { kind: 'delete-policy' }, ['role-a']],
  ];

  it.each(steps)('names the step refused when %s, with its failure, and sends nothing after it', async (_, action, step, detached) => {
    answerEverything();
    engine.handlers[action] = () => refused;

    expect(await deletePolicy(endpoint, POLICY_ARN, signal())).toEqual({
      kind: 'failed',
      step,
      failure: { kind: 'other', operation: action, code: 'DeleteConflict', message: 'Cannot delete.' },
      detachedRoles: detached,
    });
    expect(engine.actions().at(-1)).toBe(action);
    expect(engine.actions().filter((sent) => sent === action)).toHaveLength(1);
  });
});

describe('a failed request of the calls of issue 535', () => {
  const docA = DOC_A;
  /** Each new function, with the failure its first operation's refusal gives. */
  const calls: [string, string, () => Promise<IamFailure>][] = [
    ['getRolePolicyDocument', 'GetRolePolicy', () => requestFailure(getRolePolicyDocument(endpoint, 'r', 'p', signal()))],
    ['getPolicyDocument', 'GetPolicy', () => requestFailure(getPolicyDocument(endpoint, POLICY_ARN, undefined, signal()))],
    [
      'attachRolePolicies',
      'AttachRolePolicy',
      async () => {
        const result = await attachRolePolicies(endpoint, 'r', [{ name: 'a', arn: POLICY_ARN }], signal());
        if (result.failed === undefined) throw new Error('nothing failed');
        return result.failed.failure;
      },
    ],
    ['detachRolePolicy', 'DetachRolePolicy', () => requestFailure(detachRolePolicy(endpoint, 'r', POLICY_ARN, signal()))],
    ['putRolePolicy', 'PutRolePolicy', () => requestFailure(putRolePolicy(endpoint, 'r', 'p', docA, signal()))],
    ['deleteRolePolicy', 'DeleteRolePolicy', () => requestFailure(deleteRolePolicy(endpoint, 'r', 'p', signal()))],
    ['updateTrustPolicy', 'UpdateAssumeRolePolicy', () => requestFailure(updateTrustPolicy(endpoint, 'r', docA, signal()))],
    ['getPolicy', 'GetPolicy', () => requestFailure(getPolicy(endpoint, POLICY_ARN, signal()))],
    ['createPolicy', 'CreatePolicy', () => requestFailure(createPolicy(endpoint, { name: 'p', document: docA }, signal()))],
    [
      'createPolicyVersion',
      'CreatePolicyVersion',
      () => requestFailure(createPolicyVersion(endpoint, POLICY_ARN, docA, signal())),
    ],
    [
      'setDefaultPolicyVersion',
      'SetDefaultPolicyVersion',
      () => requestFailure(setDefaultPolicyVersion(endpoint, POLICY_ARN, 'v1', signal())),
    ],
    [
      'deletePolicyVersion',
      'DeletePolicyVersion',
      () => requestFailure(deletePolicyVersion(endpoint, POLICY_ARN, 'v1', signal())),
    ],
    [
      'deletePolicy',
      'ListEntitiesForPolicy',
      async () => {
        const result = await deletePolicy(endpoint, POLICY_ARN, signal());
        if (result.kind !== 'failed') throw new Error('nothing failed');
        return result.failure;
      },
    ],
  ];

  it.each(calls)('%s: 501 is "not implemented" with %s', async (_, operation, call) => {
    engine.fallback = () => errorAnswer(501, 'NotImplemented', 'not implemented');
    expect(await call()).toEqual({ kind: 'not-implemented', operation });
  });

  it.each(calls)('%s: AccessDenied is "access denied" with the message (%s)', async (_, operation, call) => {
    engine.fallback = () => errorAnswer(403, 'AccessDenied', `not authorized to perform iam:${operation}`);
    expect(await call()).toEqual({
      kind: 'access-denied',
      operation,
      message: `not authorized to perform iam:${operation}`,
    });
  });

  it.each(calls)('%s: the engine’s codes for a silent emulator are "emulator did not answer" (%s)', async (_, operation, call) => {
    engine.fallback = () => engineRefusal(503, 'EmulatorUnavailable', 'connection refused');
    expect(await call()).toEqual({ kind: 'emulator-did-not-answer', operation, message: 'connection refused' });
    engine.fallback = () => engineRefusal(504, 'EmulatorTimeout', 'no answer in 30 seconds');
    expect(await call()).toEqual({ kind: 'emulator-did-not-answer', operation, message: 'no answer in 30 seconds' });
  });

  it.each(calls)('%s: no answer at all is "engine did not answer" (%s)', async (_, operation, call) => {
    engine.fallback = () => 'network-error';
    expect(await call()).toEqual({ kind: 'engine-did-not-answer', operation });
  });

  it.each(calls)('%s: another code is that code with its message (%s)', async (_, operation, call) => {
    engine.fallback = () => errorAnswer(400, 'MalformedPolicyDocument', 'Syntax errors in policy.');
    expect(await call()).toEqual({
      kind: 'other',
      operation,
      code: 'MalformedPolicyDocument',
      message: 'Syntax errors in policy.',
    });
    engine.fallback = () => ({ status: 418, statusText: "I'm a teapot", body: '' });
    expect(await call()).toEqual({ kind: 'other', operation, code: "HTTP 418 I'm a teapot" });
  });
});

describe('an aborted call of issue 535', () => {
  const calls: [string, (abort: AbortSignal) => Promise<unknown>][] = [
    ['getRolePolicyDocument', (s) => getRolePolicyDocument(endpoint, 'r', 'p', s)],
    ['getPolicyDocument', (s) => getPolicyDocument(endpoint, POLICY_ARN, undefined, s)],
    ['attachRolePolicies', (s) => attachRolePolicies(endpoint, 'r', [{ name: 'a', arn: POLICY_ARN }], s)],
    ['detachRolePolicy', (s) => detachRolePolicy(endpoint, 'r', POLICY_ARN, s)],
    ['putRolePolicy', (s) => putRolePolicy(endpoint, 'r', 'p', DOC_A, s)],
    ['deleteRolePolicy', (s) => deleteRolePolicy(endpoint, 'r', 'p', s)],
    ['updateTrustPolicy', (s) => updateTrustPolicy(endpoint, 'r', DOC_A, s)],
    ['getPolicy', (s) => getPolicy(endpoint, POLICY_ARN, s)],
    ['createPolicy', (s) => createPolicy(endpoint, { name: 'p', document: DOC_A }, s)],
    ['createPolicyVersion', (s) => createPolicyVersion(endpoint, POLICY_ARN, DOC_A, s)],
    ['setDefaultPolicyVersion', (s) => setDefaultPolicyVersion(endpoint, POLICY_ARN, 'v1', s)],
    ['deletePolicyVersion', (s) => deletePolicyVersion(endpoint, POLICY_ARN, 'v1', s)],
    ['deletePolicy', (s) => deletePolicy(endpoint, POLICY_ARN, s)],
  ];

  it.each(calls)('%s ends at once with the signal’s reason, and reports no failure', async (_, call) => {
    engine.fallback = () => 'hold';
    const controller = new AbortController();
    const reason = new Error('left the page');

    const settled = call(controller.signal).then(
      (result) => ({ resolved: result }),
      (error: unknown) => ({ rejected: error }),
    );
    await vi.waitFor(() => {
      expect(engine.sent).toHaveLength(1);
    });
    controller.abort(reason);

    const outcome = await settled;
    expect(outcome).toEqual({ rejected: reason });
    expect((outcome as { rejected: unknown }).rejected).toBe(reason);
    expect(engine.sent).toHaveLength(1);
  });

  it('a policy’s read ends with the reason when its versions list is aborted, not with that part’s failure', async () => {
    engine.handlers.GetPolicy = () => getPolicyAnswer(POLICY_ARN);
    engine.handlers.ListPolicyVersions = () => 'hold';
    const controller = new AbortController();
    const reason = new Error('left the page');

    const settled = getPolicy(endpoint, POLICY_ARN, controller.signal).then(
      (result) => ({ resolved: result as unknown }),
      (error: unknown) => ({ rejected: error }),
    );
    await vi.waitFor(() => {
      expect(engine.of('ListPolicyVersions')).toHaveLength(1);
    });
    controller.abort(reason);

    expect(await settled).toEqual({ rejected: reason });
    expect(engine.of('ListEntitiesForPolicy')).toHaveLength(0);
  });
});
