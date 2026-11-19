import { ListRolesCommand } from '@aws-sdk/client-iam';
import { ListFunctionsCommand } from '@aws-sdk/client-lambda';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EndpointRefusedError, engineEndpoint } from '../../../../../lib/aws/client-factory';
import { RequestError, type RequestFailure } from '../../../../../lib/aws/request';
import {
  BASIC_EXECUTION_POLICY,
  createFunction,
  CreateFunctionError,
  deleteFunctions,
  iamClient,
  invoke,
  isFunctionNotFound,
  isTooLarge,
  lambdaClient,
  LambdaRequestError,
  listFunctions,
  listRoles,
  readFunction,
  updateFunctionCode,
  updateFunctionConfiguration,
  type ConfigurationChange,
  type CreatedRole,
  type LambdaFailure,
} from './api';
import { starterCode } from './starter-code';
import { storedZip } from './zip';

// The test plays the engine behind the page's `fetch`: its session route, and every AWS request as it leaves the
// browser. Lambda answers in its REST JSON protocol, IAM in the query protocol's XML, as the emulator and the engine
// answer them (issue 84, requirement R2, "The client's protocol and the engine").

interface SentRequest {
  method: string;
  url: URL;
  headers: Headers;
  body: string;
  /** The IAM query's `Action`, or the Lambda operation by method and path. */
  operation: string;
}

type Answer = Response | Promise<Response> | 'network-error' | 'hold';

const TOKENS = ['emuforge-test-token-84-1', 'emuforge-test-token-84-2', 'emuforge-test-token-84-3'];

function lambdaOperation(method: string, path: string): string {
  if (path === '/2015-03-31/functions' || path === '/2015-03-31/functions/') {
    return method === 'GET' ? 'ListFunctions' : 'CreateFunction';
  }
  if (/^\/2021-10-31\/functions\/[^/]+\/url$/.test(path)) {
    return 'GetFunctionUrlConfig';
  }
  if (/^\/2015-03-31\/functions\/[^/]+$/.test(path)) {
    return method === 'DELETE' ? 'DeleteFunction' : 'GetFunction';
  }
  if (/^\/2015-03-31\/functions\/[^/]+\/invocations$/.test(path)) {
    return 'Invoke';
  }
  if (/^\/2015-03-31\/functions\/[^/]+\/code$/.test(path)) {
    return 'UpdateFunctionCode';
  }
  if (/^\/2015-03-31\/functions\/[^/]+\/configuration$/.test(path)) {
    return 'UpdateFunctionConfiguration';
  }
  return `${method} ${path}`;
}

class FakeEngine {
  readonly sent: SentRequest[] = [];
  sessionRequests = 0;
  session: () => Response | 'network-error' = () =>
    new Response(JSON.stringify({ token: TOKENS[Math.min(this.sessionRequests - 1, TOKENS.length - 1)] }), {
      status: 200,
    });
  answer: (request: SentRequest) => Answer = (request) => defaultAnswer(request);

  readonly fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    if (url.pathname === '/__emuforge/session') {
      this.sessionRequests += 1;
      const answer = this.session();
      if (answer === 'network-error') {
        throw new TypeError('Failed to fetch');
      }
      return answer;
    }
    const body = request.method === 'GET' || request.method === 'HEAD' ? '' : await request.text();
    const action = new URLSearchParams(body).get('Action');
    const sent: SentRequest = {
      method: request.method,
      url,
      headers: request.headers,
      body,
      operation: url.pathname === '/' && action !== null ? action : lambdaOperation(request.method, url.pathname),
    };
    this.sent.push(sent);
    const answer = this.answer(sent);
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
    return answer;
  };

  operations(): string[] {
    return this.sent.map(({ operation }) => operation);
  }
}

const JSON_HEADERS = { 'content-type': 'application/json' };
const XML_HEADERS = { 'content-type': 'text/xml' };

function json(status: number, body: unknown): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: JSON_HEADERS });
}

/** A refusal of the Lambda protocol, as the emulator and the engine answer one. */
function lambdaError(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ __type: code, Message: message }), {
    status,
    headers: { ...JSON_HEADERS, 'x-amzn-errortype': code },
  });
}

/** A refusal of the query protocol, as the emulator and the engine answer one. */
function iamError(status: number, code: string, message: string): Response {
  return new Response(
    `<?xml version="1.0"?><ErrorResponse><Error><Type>Sender</Type><Code>${code}</Code><Message>${message}</Message></Error><RequestId>r</RequestId></ErrorResponse>`,
    { status, headers: XML_HEADERS },
  );
}

function functionItem(name: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    FunctionName: name,
    FunctionArn: `arn:aws:lambda:us-east-1:000000000000:function:${name}`,
    Runtime: 'nodejs24.x',
    Role: 'arn:aws:iam::000000000000:role/r',
    Handler: 'index.handler',
    CodeSize: 300,
    Description: '',
    Timeout: 3,
    MemorySize: 128,
    LastModified: '2026-11-17T02:22:16.474+0000',
    Version: '$LATEST',
    PackageType: 'Zip',
    Architectures: ['x86_64'],
    ...extra,
  };
}

function functionList(names: string[], nextMarker?: string): Response {
  return json(200, {
    Functions: names.map((name) => functionItem(name)),
    ...(nextMarker === undefined ? {} : { NextMarker: nextMarker }),
  });
}

function roleXml(name: string, path = '/service-role/'): string {
  return `<member><Path>${path}</Path><RoleName>${name}</RoleName><RoleId>AROA${name.length}</RoleId><Arn>arn:aws:iam::000000000000:role${path}${name}</Arn><CreateDate>2026-11-17T02:22:16Z</CreateDate></member>`;
}

function createRoleAnswer(request: SentRequest): Response {
  const params = new URLSearchParams(request.body);
  const name = params.get('RoleName') ?? '';
  const path = params.get('Path') ?? '/';
  return new Response(
    `<CreateRoleResponse><CreateRoleResult><Role><Path>${path}</Path><RoleName>${name}</RoleName><RoleId>AROAX</RoleId><Arn>arn:aws:iam::000000000000:role${path}${name}</Arn><CreateDate>2026-11-17T02:22:16Z</CreateDate></Role></CreateRoleResult></CreateRoleResponse>`,
    { status: 200, headers: XML_HEADERS },
  );
}

function defaultAnswer(request: SentRequest): Response {
  switch (request.operation) {
    case 'ListFunctions':
      return functionList([]);
    case 'GetFunction':
      return json(200, {
        Configuration: functionItem('f', { State: 'Active', LastUpdateStatus: 'Successful' }),
        Code: { RepositoryType: 'S3', Location: 'https://127.0.0.1:9310/code/f.zip?signature=x' },
      });
    case 'GetFunctionUrlConfig':
      return lambdaError(404, 'ResourceNotFoundException', 'The resource you requested does not exist.');
    case 'CreateFunction': {
      const input = JSON.parse(request.body) as { FunctionName: string };
      return json(201, functionItem(input.FunctionName, { State: 'Pending', StateReasonCode: 'Creating' }));
    }
    case 'DeleteFunction':
      return json(204, undefined);
    case 'ListRoles':
      return new Response(
        '<ListRolesResponse><ListRolesResult><IsTruncated>false</IsTruncated><Roles></Roles></ListRolesResult></ListRolesResponse>',
        { status: 200, headers: XML_HEADERS },
      );
    case 'CreateRole':
      return createRoleAnswer(request);
    case 'AttachRolePolicy':
      return new Response(
        '<AttachRolePolicyResponse><ResponseMetadata><RequestId>r</RequestId></ResponseMetadata></AttachRolePolicyResponse>',
        { status: 200, headers: XML_HEADERS },
      );
    default:
      return json(400, {});
  }
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('the call resolved');
}

async function failure(promise: Promise<unknown>): Promise<LambdaFailure> {
  const error = await rejection(promise);
  expect(error).toBeInstanceOf(LambdaRequestError);
  return (error as LambdaRequestError).failure;
}

// Sessions and clients are held per engine endpoint for the life of the page, so each case has a port of its own.
let nextPort = 8840;
let engine: FakeEngine;
let endpoint: string;
const signal = () => new AbortController().signal;

beforeEach(() => {
  engine = new FakeEngine();
  vi.stubGlobal('fetch', engine.fetch);
  nextPort += 1;
  endpoint = engineEndpoint(nextPort);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the clients', () => {
  it('sends ListFunctions with MaxItems 25 and Marker abb~ once to the engine, as GET /2015-03-31/functions with the session and the Studio credential', async () => {
    await lambdaClient(endpoint).send(new ListFunctionsCommand({ MaxItems: 25, Marker: 'abb~' }));

    expect(engine.sent).toHaveLength(1);
    const [sent] = engine.sent;
    expect(sent?.method).toBe('GET');
    expect(sent?.url.origin).toBe(endpoint);
    expect(sent?.url.pathname).toBe('/2015-03-31/functions');
    expect(sent?.url.searchParams.get('MaxItems')).toBe('25');
    expect(sent?.url.searchParams.get('Marker')).toBe('abb~');
    expect(sent?.headers.get('x-emuforge-session')).toBe(TOKENS[0]);
    expect(sent?.headers.get('authorization')).toMatch(/^AWS4-HMAC-SHA256 Credential=emuforge-studio\//);
  });

  it('sends ListRoles once to the engine, as POST / with a form body holding Action=ListRoles, with the session', async () => {
    await iamClient(endpoint).send(new ListRolesCommand({}));

    expect(engine.sent).toHaveLength(1);
    const [sent] = engine.sent;
    expect(sent?.method).toBe('POST');
    expect(sent?.url.origin).toBe(endpoint);
    expect(sent?.url.pathname).toBe('/');
    expect(sent?.headers.get('content-type')).toContain('application/x-www-form-urlencoded');
    expect(new URLSearchParams(sent?.body).get('Action')).toBe('ListRoles');
    expect(sent?.headers.get('x-emuforge-session')).toBe(TOKENS[0]);
  });

  it.each(['http://localhost:8840', 'https://127.0.0.1:8840', 'https://lambda.us-east-1.amazonaws.com'])(
    'refuses to make the Lambda client and the IAM client for %s, and sends nothing',
    async (refused) => {
      expect(() => lambdaClient(refused)).toThrow(EndpointRefusedError);
      expect(() => iamClient(refused)).toThrow(EndpointRefusedError);
      await expect(listFunctions(refused, { pageSize: 25 }, signal())).rejects.toBeInstanceOf(EndpointRefusedError);
      await expect(listRoles(refused, undefined, signal())).rejects.toBeInstanceOf(EndpointRefusedError);
      expect(engine.sent).toHaveLength(0);
      expect(engine.sessionRequests).toBe(0);
    },
  );

  it('sends the Lambda command again with a new token after the engine refuses the session once, and resolves', async () => {
    engine.answer = (request) =>
      request.headers.get('x-emuforge-session') === TOKENS[0]
        ? new Response(JSON.stringify({ __type: 'SessionInvalid', message: 'refused' }), {
            status: 401,
            headers: { ...JSON_HEADERS, 'x-amzn-errortype': 'SessionInvalid', 'www-authenticate': 'EmuForge-Session' },
          })
        : functionList(['after-renewal']);

    const output = await lambdaClient(endpoint).send(new ListFunctionsCommand({ MaxItems: 25 }));

    expect(output.Functions?.map((item) => item.FunctionName)).toEqual(['after-renewal']);
    expect(engine.sessionRequests).toBe(2);
    expect(engine.sent.map((request) => request.headers.get('x-emuforge-session'))).toEqual([TOKENS[0], TOKENS[1]]);
  });

  it('rejects a command with the name ResourceNotFoundException and the message of a refusal in the emulator’s shape', async () => {
    const message = 'Function not found: arn:aws:lambda:us-east-1:000000000000:function:x';
    engine.answer = () =>
      new Response(JSON.stringify({ Type: 'User', Message: message }), {
        status: 404,
        headers: { ...JSON_HEADERS, 'x-amzn-errortype': 'ResourceNotFoundException' },
      });

    const error = await rejection(lambdaClient(endpoint).send(new ListFunctionsCommand({})));

    expect((error as Error).name).toBe('ResourceNotFoundException');
    expect((error as Error).message).toBe(message);
  });

  it.each([
    [503, 'EmulatorUnavailable', 'the emulator at https://127.0.0.1:9310 is not reachable (not_started)'],
    [504, 'EmulatorTimeout', 'the emulator at https://127.0.0.1:9310 did not answer within 30 seconds'],
  ])('rejects a Lambda and an IAM command with the engine’s %i %s and its message', async (status, code, message) => {
    engine.answer = (request) =>
      request.url.pathname === '/'
        ? iamError(status, code, message)
        : new Response(JSON.stringify({ __type: code, message }), {
            status,
            headers: { ...JSON_HEADERS, 'x-amzn-errortype': code },
          });

    const lambda = (await rejection(lambdaClient(endpoint).send(new ListFunctionsCommand({})))) as Error;
    const iam = (await rejection(iamClient(endpoint).send(new ListRolesCommand({})))) as Error;

    expect([lambda.name, lambda.message]).toEqual([code, message]);
    expect([iam.name, iam.message]).toEqual([code, message]);
    expect(await failure(listFunctions(endpoint, { pageSize: 25 }, signal()))).toEqual({
      kind: 'emulator-did-not-answer',
      operation: 'ListFunctions',
      message,
    });
    expect(await failure(listRoles(endpoint, undefined, signal()))).toEqual({
      kind: 'emulator-did-not-answer',
      operation: 'ListRoles',
      message,
    });
  });
});

describe('the function list', () => {
  it('asks ListFunctions with MaxItems 25 and no Marker for page size 25 alone, and gives the answer’s order and NextMarker', async () => {
    engine.answer = () => functionList(['zeta', 'alpha', 'mid'], 'mid');

    const page = await listFunctions(endpoint, { pageSize: 25 }, signal());

    expect(engine.operations()).toEqual(['ListFunctions']);
    expect(engine.sent[0]?.url.searchParams.get('MaxItems')).toBe('25');
    expect(engine.sent[0]?.url.searchParams.has('Marker')).toBe(false);
    expect(page.functions.map(({ name }) => name)).toEqual(['zeta', 'alpha', 'mid']);
    expect(page.nextMarker).toBe('mid');
  });

  it('carries a marker as Marker', async () => {
    await listFunctions(endpoint, { pageSize: 10, marker: 'p84-0007' }, signal());

    expect(engine.sent[0]?.url.searchParams.get('Marker')).toBe('p84-0007');
    expect(engine.sent[0]?.url.searchParams.get('MaxItems')).toBe('10');
  });

  it('gives an empty page without a next marker for an answer without functions', async () => {
    const page = await listFunctions(endpoint, { pageSize: 25 }, signal());

    expect(page).toEqual({ functions: [] });
  });

  it('asks a first page filtered by ab with Marker aa~, keeps ab- and abb, and drops the next marker at the cut', async () => {
    engine.answer = () => functionList(['ab-', 'abb', 'ac'], 'ac');

    const page = await listFunctions(endpoint, { pageSize: 3, filter: 'ab' }, signal());

    expect(engine.sent[0]?.url.searchParams.get('Marker')).toBe('aa~');
    expect(page.functions.map(({ name }) => name)).toEqual(['ab-', 'abb']);
    expect(page).not.toHaveProperty('nextMarker');
  });

  it('keeps every name and the next marker when every name of a filtered answer starts with the text', async () => {
    engine.answer = () => functionList(['ab-', 'abb', 'abc'], 'abc');

    const page = await listFunctions(endpoint, { pageSize: 3, filter: 'ab' }, signal());

    expect(page.functions.map(({ name }) => name)).toEqual(['ab-', 'abb', 'abc']);
    expect(page.nextMarker).toBe('abc');
  });

  it('asks a later filtered page with the marker given, not the text’s', async () => {
    await listFunctions(endpoint, { pageSize: 3, filter: 'ab', marker: 'abc' }, signal());

    expect(engine.sent[0]?.url.searchParams.get('Marker')).toBe('abc');
  });

  it.each(['a b', 'x'.repeat(65), 'é'])('gives an empty page and sends nothing for the filter %s', async (filter) => {
    const page = await listFunctions(endpoint, { pageSize: 25, filter }, signal());

    expect(page).toEqual({ functions: [] });
    expect(engine.sent).toHaveLength(0);
    expect(engine.sessionRequests).toBe(0);
  });

  it('gives an item’s name, description, package type, runtime, time and durable', async () => {
    engine.answer = () =>
      json(200, {
        Functions: [
          functionItem('orders', {
            Description: 'Takes orders',
            DurableConfig: { RetentionPeriodInDays: 1, ExecutionTimeout: 60 },
          }),
        ],
      });

    const { functions } = await listFunctions(endpoint, { pageSize: 25 }, signal());

    expect(functions).toEqual([
      {
        name: 'orders',
        description: 'Takes orders',
        packageType: 'Zip',
        runtime: 'nodejs24.x',
        lastModified: new Date('2026-11-17T02:22:16.474Z'),
        durable: true,
      },
    ]);
  });

  it('leaves out an empty description and a missing runtime, package type and time, and keeps a time that is not one as text', async () => {
    engine.answer = () =>
      json(200, {
        Functions: [
          { FunctionName: 'image-fn', Description: '' },
          { FunctionName: 'odd-time', LastModified: 'not a time' },
        ],
      });

    const { functions } = await listFunctions(endpoint, { pageSize: 25 }, signal());

    expect(functions[0]).toEqual({ name: 'image-fn', durable: false });
    for (const key of ['description', 'runtime', 'packageType', 'lastModified']) {
      expect(functions[0]).not.toHaveProperty(key);
    }
    expect(functions[1]).toEqual({ name: 'odd-time', lastModified: 'not a time', durable: false });
  });
});

describe('a function’s page', () => {
  it('reads GetFunction and GetFunctionUrlConfig for the name, and gives the function with its settings and URL', async () => {
    engine.answer = (request) => {
      if (request.operation === 'GetFunctionUrlConfig') {
        return json(200, { FunctionUrl: 'https://abc.lambda-url.us-east-1.on.aws/', AuthType: 'NONE' });
      }
      if (request.operation === 'GetFunction') {
        return json(200, {
          Configuration: functionItem('orders', {
            Architectures: ['arm64'],
            Handler: 'lambda_function.lambda_handler',
            State: 'Failed',
            StateReason: 'It broke',
            LastUpdateStatus: 'Failed',
            LastUpdateStatusReason: 'It broke again',
            Environment: { Variables: { SECRET: 'not-shown' } },
          }),
          Code: { RepositoryType: 'S3', Location: 'https://127.0.0.1:9310/code?sig=1' },
        });
      }
      return defaultAnswer(request);
    };

    const read = await readFunction(endpoint, 'orders', signal());

    expect(engine.operations().sort()).toEqual(['GetFunction', 'GetFunctionUrlConfig']);
    expect(engine.sent.every(({ url }) => url.pathname.includes('/functions/orders'))).toBe(true);
    expect(read).toEqual({
      found: true,
      function: {
        name: 'orders',
        packageType: 'Zip',
        runtime: 'nodejs24.x',
        lastModified: new Date('2026-11-17T02:22:16.474Z'),
        durable: false,
        arn: 'arn:aws:lambda:us-east-1:000000000000:function:orders',
        handler: 'lambda_function.lambda_handler',
        architectures: ['arm64'],
        state: 'Failed',
        stateReason: 'It broke',
        lastUpdateStatus: 'Failed',
        lastUpdateStatusReason: 'It broke again',
        memorySize: 128,
        timeout: 3,
        role: 'arn:aws:iam::000000000000:role/r',
        codeSize: 300,
        environment: [{ key: 'SECRET', value: 'not-shown' }],
        url: { kind: 'url', url: 'https://abc.lambda-url.us-east-1.on.aws/' },
      },
    });
  });

  it.each([
    ['ResourceNotFoundException', lambdaError(404, 'ResourceNotFoundException', 'none'), { kind: 'none' }],
    ['501', lambdaError(501, 'NotImplemented', 'not implemented'), { kind: 'not-implemented' }],
    ['another failure', lambdaError(500, 'ServiceException', 'boom'), { kind: 'not-read' }],
    ['no answer', 'network-error' as const, { kind: 'not-read' }],
  ])('gives the function with the URL marked when GetFunctionUrlConfig answers %s', async (_, answer, url) => {
    engine.answer = (request) =>
      request.operation === 'GetFunctionUrlConfig'
        ? answer instanceof Response
          ? answer.clone()
          : answer
        : defaultAnswer(request);

    const read = await readFunction(endpoint, 'f', signal());

    expect(read.found).toBe(true);
    expect(read.found && read.function.url).toEqual(url);
  });

  it.each([
    ['a URL', json(200, { FunctionUrl: 'https://u/' })],
    ['a failure', lambdaError(500, 'ServiceException', 'boom')],
  ])(
    'is "not found" when GetFunction answers ResourceNotFoundException, whatever GetFunctionUrlConfig answered (%s)',
    async (_, urlAnswer) => {
      engine.answer = (request) =>
        request.operation === 'GetFunction'
          ? lambdaError(
              404,
              'ResourceNotFoundException',
              'Function not found: arn:aws:lambda:us-east-1:000000000000:function:f',
            )
          : urlAnswer.clone();

      expect(await readFunction(endpoint, 'f', signal())).toEqual({ found: false });
    },
  );

  it('gives memory, timeout, role, code size, SHA-256, package type, variables in the answer’s order and the last update with its reason', async () => {
    engine.answer = (request) =>
      request.operation === 'GetFunction'
        ? json(200, {
            Configuration: functionItem('f', {
              MemorySize: 512,
              Timeout: 30,
              Role: 'arn:aws:iam::000000000000:role/service-role/f-role',
              CodeSize: 1234,
              CodeSha256: 'q1w2e3r4t5y6u7i8o9p0+/=',
              PackageType: 'Zip',
              Environment: { Variables: { ZETA: 'last', ALPHA: '', '1-dash': 'x' } },
              LastUpdateStatus: 'InProgress',
              LastUpdateStatusReason: 'The function is being updated.',
            }),
            Code: { RepositoryType: 'S3', Location: 'https://127.0.0.1:9310/code-location-516' },
          })
        : defaultAnswer(request);

    const read = await readFunction(endpoint, 'f', signal());

    expect(read.found).toBe(true);
    const fn = read.found ? read.function : undefined;
    expect(fn).toMatchObject({
      memorySize: 512,
      timeout: 30,
      role: 'arn:aws:iam::000000000000:role/service-role/f-role',
      codeSize: 1234,
      codeSha256: 'q1w2e3r4t5y6u7i8o9p0+/=',
      packageType: 'Zip',
      lastUpdateStatus: 'InProgress',
      lastUpdateStatusReason: 'The function is being updated.',
    });
    // The order the answer wrote them in (an integer-like key would be reordered by any object; none is one here).
    expect(fn?.environment).toEqual([
      { key: 'ZETA', value: 'last' },
      { key: 'ALPHA', value: '' },
      { key: '1-dash', value: 'x' },
    ]);
  });

  it('gives no variables for an answer without Environment, and holds Code.Location nowhere', async () => {
    engine.answer = (request) =>
      request.operation === 'GetFunction'
        ? json(200, {
            Configuration: functionItem('f'),
            Code: { RepositoryType: 'S3', Location: 'https://127.0.0.1:9310/code-location-84' },
          })
        : defaultAnswer(request);

    const read = await readFunction(endpoint, 'f', signal());

    expect(read.found && read.function.environment).toEqual([]);
    expect(JSON.stringify(read)).not.toContain('code-location-84');
  });
});

describe('the roles', () => {
  it('reads a page with one ListRoles, MaxItems 50 and the marker given, and keeps the Marker only when IsTruncated', async () => {
    engine.answer = () =>
      new Response(
        `<ListRolesResponse><ListRolesResult><IsTruncated>true</IsTruncated><Marker>m-2</Marker><Roles>${roleXml('a-role')}${roleXml('top', '/')}</Roles></ListRolesResult></ListRolesResponse>`,
        { status: 200, headers: XML_HEADERS },
      );

    const page = await listRoles(endpoint, 'm-1', signal());

    expect(engine.operations()).toEqual(['ListRoles']);
    const params = new URLSearchParams(engine.sent[0]?.body);
    expect(params.get('MaxItems')).toBe('50');
    expect(params.get('Marker')).toBe('m-1');
    expect(page).toEqual({
      roles: [
        { name: 'a-role', arn: 'arn:aws:iam::000000000000:role/service-role/a-role', path: '/service-role/' },
        { name: 'top', arn: 'arn:aws:iam::000000000000:role/top', path: '/' },
      ],
      nextMarker: 'm-2',
    });

    engine.answer = () =>
      new Response(
        `<ListRolesResponse><ListRolesResult><IsTruncated>false</IsTruncated><Marker>m-3</Marker><Roles>${roleXml('b')}</Roles></ListRolesResult></ListRolesResponse>`,
        { status: 200, headers: XML_HEADERS },
      );
    const last = await listRoles(endpoint, undefined, signal());

    expect(new URLSearchParams(engine.sent[1]?.body).has('Marker')).toBe(false);
    expect(last).not.toHaveProperty('nextMarker');
  });
});

describe('creating a function', () => {
  const ROLE_NAME = /^orders-role-[a-z0-9]{8}$/;

  it('with "Create default role" sends CreateRole, AttachRolePolicy, then CreateFunction with the new role, each after the previous answer', async () => {
    const answered: string[] = [];
    engine.answer = (request) => {
      // Each request is sent only after the one before it was answered.
      expect(answered).toEqual(engine.operations().slice(0, -1));
      answered.push(request.operation);
      return defaultAnswer(request);
    };

    const created = await createFunction(
      endpoint,
      { name: 'orders', runtime: 'nodejs24.x', architecture: 'x86_64', role: { kind: 'default' }, code: { kind: 'starter' } },
      signal(),
    );

    expect(engine.operations()).toEqual(['CreateRole', 'AttachRolePolicy', 'CreateFunction']);
    const createRole = new URLSearchParams(engine.sent[0]?.body);
    const roleName = createRole.get('RoleName') ?? '';
    expect(roleName).toMatch(ROLE_NAME);
    expect(createRole.get('Path')).toBe('/service-role/');
    const trust = JSON.parse(createRole.get('AssumeRolePolicyDocument') ?? '{}') as {
      Statement: { Effect: string; Principal: { Service: string }; Action: string }[];
    };
    expect(trust.Statement).toEqual([
      { Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' },
    ]);
    const attach = new URLSearchParams(engine.sent[1]?.body);
    expect(attach.get('RoleName')).toBe(roleName);
    expect(attach.get('PolicyArn')).toBe(BASIC_EXECUTION_POLICY);
    expect(BASIC_EXECUTION_POLICY).toBe('arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole');
    const input = JSON.parse(engine.sent[2]?.body ?? '{}') as { Role: string };
    expect(input.Role).toBe(`arn:aws:iam::000000000000:role/service-role/${roleName}`);
    expect(created).toEqual({ name: 'orders', roleName });
  });

  it('cuts a function name of 64 characters to its first 50 in the default role’s name, of 64 characters', async () => {
    const name = `${'n'.repeat(50)}${'m'.repeat(14)}`;

    await createFunction(
      endpoint,
      { name, runtime: 'nodejs24.x', architecture: 'x86_64', role: { kind: 'default' }, code: { kind: 'starter' } },
      signal(),
    );

    const roleName = new URLSearchParams(engine.sent[0]?.body).get('RoleName') ?? '';
    expect(roleName).toHaveLength(64);
    expect(roleName).toMatch(new RegExp(`^${'n'.repeat(50)}-role-[a-z0-9]{8}$`));
  });

  it('with an existing role sends one CreateFunction with the name, runtime, architecture, role, handler and archive, and nothing else', async () => {
    const arn = 'arn:aws:iam::000000000000:role/shared';

    const created = await createFunction(
      endpoint,
      { name: 'reports', runtime: 'python3.13', architecture: 'arm64', role: { kind: 'existing', arn }, code: { kind: 'starter' } },
      signal(),
    );

    expect(engine.operations()).toEqual(['CreateFunction']);
    const code = starterCode('python3.13');
    const expectedZip = btoa(String.fromCharCode(...storedZip(code?.fileName ?? '', code?.text ?? '')));
    expect(JSON.parse(engine.sent[0]?.body ?? '{}')).toEqual({
      FunctionName: 'reports',
      Runtime: 'python3.13',
      Architectures: ['arm64'],
      Role: arn,
      Handler: 'lambda_function.lambda_handler',
      Code: { ZipFile: expectedZip },
    });
    expect(code?.fileName).toBe('lambda_function.py');
    expect(created).toEqual({ name: 'reports' });
  });

  it('names "Creating the role" when CreateRole fails, sends nothing after it and reports no role', async () => {
    engine.answer = (request) =>
      request.operation === 'CreateRole' ? iamError(409, 'EntityAlreadyExists', 'Role exists') : defaultAnswer(request);

    const error = await rejection(
      createFunction(
        endpoint,
        { name: 'orders', runtime: 'nodejs24.x', architecture: 'x86_64', role: { kind: 'default' }, code: { kind: 'starter' } },
        signal(),
      ),
    );

    expect(error).toBeInstanceOf(CreateFunctionError);
    const failed = error as CreateFunctionError;
    expect(failed.step).toBe('Creating the role');
    expect(failed.failure).toEqual({
      kind: 'other',
      operation: 'CreateRole',
      code: 'EntityAlreadyExists',
      message: 'Role exists',
    });
    expect(failed.createdRole).toBeUndefined();
    expect(engine.operations()).toEqual(['CreateRole']);
  });

  it('names "Creating the role" and reports the role when AttachRolePolicy fails; again for the same name: AttachRolePolicy for it, then CreateFunction', async () => {
    let attachFails = true;
    engine.answer = (request) =>
      request.operation === 'AttachRolePolicy' && attachFails
        ? iamError(404, 'NoSuchEntity', 'Policy missing')
        : defaultAnswer(request);
    const request = { name: 'orders', runtime: 'nodejs24.x', architecture: 'x86_64', code: { kind: 'starter' as const } };

    const first = (await rejection(
      createFunction(endpoint, { ...request, role: { kind: 'default' } }, signal()),
    )) as CreateFunctionError;

    expect(first.step).toBe('Creating the role');
    expect(first.failure).toMatchObject({ operation: 'AttachRolePolicy', code: 'NoSuchEntity' });
    const role = first.createdRole as CreatedRole;
    expect(role.name).toMatch(ROLE_NAME);
    expect(role.policyAttached).toBe(false);
    expect(engine.operations()).toEqual(['CreateRole', 'AttachRolePolicy']);

    attachFails = false;
    const created = await createFunction(endpoint, { ...request, role: { kind: 'default', created: role } }, signal());

    expect(engine.operations().slice(2)).toEqual(['AttachRolePolicy', 'CreateFunction']);
    expect(new URLSearchParams(engine.sent[2]?.body).get('RoleName')).toBe(role.name);
    expect((JSON.parse(engine.sent[3]?.body ?? '{}') as { Role: string }).Role).toBe(role.arn);
    expect(created).toEqual({ name: 'orders', roleName: role.name });
  });

  it('names "Creating the function" and reports the role when CreateFunction fails; again for the same name: CreateFunction only, with that role', async () => {
    let createFails = true;
    engine.answer = (request) =>
      request.operation === 'CreateFunction' && createFails
        ? lambdaError(409, 'ResourceConflictException', 'Function already exist: orders')
        : defaultAnswer(request);
    const request = { name: 'orders', runtime: 'nodejs24.x', architecture: 'x86_64', code: { kind: 'starter' as const } };

    const first = (await rejection(
      createFunction(endpoint, { ...request, role: { kind: 'default' } }, signal()),
    )) as CreateFunctionError;

    expect(first.step).toBe('Creating the function');
    expect(first.failure).toEqual({
      kind: 'other',
      operation: 'CreateFunction',
      code: 'ResourceConflictException',
      message: 'Function already exist: orders',
    });
    const role = first.createdRole as CreatedRole;
    expect(role.policyAttached).toBe(true);

    createFails = false;
    await createFunction(endpoint, { ...request, role: { kind: 'default', created: role } }, signal());

    expect(engine.operations().slice(3)).toEqual(['CreateFunction']);
    expect((JSON.parse(engine.sent[3]?.body ?? '{}') as { Role: string }).Role).toBe(role.arn);
  });

  it('creates a new role for another function name after such a failure', async () => {
    const role: CreatedRole = {
      functionName: 'orders',
      name: 'orders-role-abcd1234',
      arn: 'arn:aws:iam::000000000000:role/service-role/orders-role-abcd1234',
      policyAttached: true,
    };

    await createFunction(
      endpoint,
      { name: 'invoices', runtime: 'nodejs22.x', architecture: 'x86_64', role: { kind: 'default', created: role }, code: { kind: 'starter' } },
      signal(),
    );

    expect(engine.operations()).toEqual(['CreateRole', 'AttachRolePolicy', 'CreateFunction']);
    expect(new URLSearchParams(engine.sent[0]?.body).get('RoleName')).toMatch(/^invoices-role-[a-z0-9]{8}$/);
  });
});

describe('deleting functions', () => {
  it('sends one DeleteFunction per name in order, each after the previous answer, and names two deleted and one failed', async () => {
    let inFlight = 0;
    engine.answer = async (request) => {
      // No request is sent while another is unanswered.
      expect(inFlight).toBe(0);
      inFlight += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return request.url.pathname.endsWith('/second')
        ? lambdaError(404, 'ResourceNotFoundException', 'Function not found: second')
        : defaultAnswer(request);
    };

    const result = await deleteFunctions(endpoint, ['first', 'second', 'third'], signal());

    expect(engine.sent.map(({ method, url }) => `${method} ${url.pathname}`)).toEqual([
      'DELETE /2015-03-31/functions/first',
      'DELETE /2015-03-31/functions/second',
      'DELETE /2015-03-31/functions/third',
    ]);
    expect(result).toEqual({
      deleted: ['first', 'third'],
      failed: [
        {
          name: 'second',
          failure: {
            kind: 'other',
            operation: 'DeleteFunction',
            code: 'ResourceNotFoundException',
            message: 'Function not found: second',
          },
        },
      ],
    });
  });
});

describe('a failure', () => {
  const cases: [string, () => Answer, LambdaFailure][] = [
    [
      '501',
      () => lambdaError(501, 'NotImplemented', 'not here'),
      { kind: 'not-implemented', operation: 'ListFunctions' },
    ],
    [
      'AccessDenied',
      () => lambdaError(403, 'AccessDenied', 'User may not list functions'),
      { kind: 'access-denied', operation: 'ListFunctions', message: 'User may not list functions' },
    ],
    [
      'EmulatorUnavailable',
      () => lambdaError(503, 'EmulatorUnavailable', 'not reachable'),
      { kind: 'emulator-did-not-answer', operation: 'ListFunctions', message: 'not reachable' },
    ],
    [
      'EmulatorTimeout',
      () => lambdaError(504, 'EmulatorTimeout', 'no answer within 30 seconds'),
      { kind: 'emulator-did-not-answer', operation: 'ListFunctions', message: 'no answer within 30 seconds' },
    ],
    ['no answer', () => 'network-error', { kind: 'engine-did-not-answer', operation: 'ListFunctions' }],
    [
      'another code',
      () => lambdaError(400, 'InvalidParameterValueException', 'MaxItems is too large'),
      {
        kind: 'other',
        operation: 'ListFunctions',
        code: 'InvalidParameterValueException',
        message: 'MaxItems is too large',
      },
    ],
    [
      'a status without a code',
      () => new Response('', { status: 418, statusText: "I'm a teapot" }),
      { kind: 'other', operation: 'ListFunctions', code: "HTTP 418 I'm a teapot" },
    ],
  ];

  it.each(cases)(
    'of ListFunctions answering %s is of its kind with the operation, code and message',
    async (_, answer, expected) => {
      engine.answer = answer;

      expect(await failure(listFunctions(endpoint, { pageSize: 25 }, signal()))).toEqual(expected);
    },
  );

  it('of the session request at the network level is "engine did not answer", and nothing is sent', async () => {
    engine.session = () => 'network-error';

    expect(await failure(listFunctions(endpoint, { pageSize: 25 }, signal()))).toEqual({
      kind: 'engine-did-not-answer',
      operation: 'ListFunctions',
    });
    expect(engine.sent).toHaveLength(0);
  });

  it.each([
    ['GetFunction', () => readFunction(endpoint, 'f', signal())],
    ['ListRoles', () => listRoles(endpoint, undefined, signal())],
  ])('of %s names that operation', async (operation, call) => {
    engine.answer = (request) =>
      request.url.pathname === '/'
        ? iamError(403, 'AccessDenied', 'refused')
        : request.operation === 'GetFunction'
          ? lambdaError(403, 'AccessDeniedException', 'refused')
          : defaultAnswer(request);

    expect(await failure(call())).toEqual({ kind: 'access-denied', operation, message: 'refused' });
  });

  it.each([
    ['501', () => iamError(501, 'NotImplemented', 'no'), { kind: 'not-implemented', operation: 'CreateRole' }],
    ['no answer', () => 'network-error' as const, { kind: 'engine-did-not-answer', operation: 'CreateRole' }],
  ])('of CreateRole answering %s is of its kind under "Creating the role"', async (_, answer, expected) => {
    engine.answer = answer;

    const error = (await rejection(
      createFunction(
        endpoint,
        { name: 'f', runtime: 'nodejs24.x', architecture: 'x86_64', role: { kind: 'default' }, code: { kind: 'starter' } },
        signal(),
      ),
    )) as CreateFunctionError;

    expect(error.step).toBe('Creating the role');
    expect(error.failure).toEqual(expected);
  });
});

describe('an aborted request', () => {
  it('gives no result and no failure: each call rejects with the signal’s reason alone', async () => {
    engine.answer = () => 'hold';
    const calls: ((s: AbortSignal) => Promise<unknown>)[] = [
      (s) => listFunctions(endpoint, { pageSize: 25 }, s),
      (s) => readFunction(endpoint, 'f', s),
      (s) => listRoles(endpoint, undefined, s),
      (s) =>
        createFunction(
          endpoint,
          { name: 'f', runtime: 'nodejs24.x', architecture: 'x86_64', role: { kind: 'default' }, code: { kind: 'starter' } },
          s,
        ),
      (s) => deleteFunctions(endpoint, ['a', 'b'], s),
    ];

    for (const call of calls) {
      const controller = new AbortController();
      const reason = new Error('not wanted any more');
      const before = engine.sent.length;
      const settled = call(controller.signal).then(
        (value) => ({ resolved: value }),
        (error: unknown) => ({ rejected: error }),
      );
      await vi.waitFor(() => {
        expect(engine.sent.length).toBeGreaterThan(before);
      });
      controller.abort(reason);

      const outcome = await settled;
      expect(outcome).toEqual({ rejected: reason });
      expect((outcome as { rejected: unknown }).rejected).toBe(reason);
    }
    // Nothing more was sent after the aborts: no step of a create or a delete went on.
    const sent = engine.sent.length;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(engine.sent).toHaveLength(sent);
  });

  it('sends nothing for a signal aborted before the call', async () => {
    const controller = new AbortController();
    const reason = new Error('aborted before');
    controller.abort(reason);

    await expect(listFunctions(endpoint, { pageSize: 25 }, controller.signal)).rejects.toBe(reason);
    await expect(deleteFunctions(endpoint, ['a'], controller.signal)).rejects.toBe(reason);
    expect(engine.sent).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Invoke, change the code, change the configuration (issue 516, test criteria "Unit s1 — api.test.ts").

/** An `Invoke` answer as the emulator gives it: the payload as the body, the error and the log in headers. */
function invokeAnswer(payload: string, headers: Record<string, string> = {}): Response {
  return new Response(payload, {
    status: 200,
    headers: { 'content-type': 'application/json', 'x-amz-executed-version': '$LATEST', ...headers },
  });
}

/** Base64 of `text`'s UTF-8 bytes, as `LogResult` carries the log. */
function base64(text: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(text)));
}

describe('invoking a function', () => {
  it('sends one Invoke to the function with RequestResponse, LogType Tail and the event text’s bytes unchanged', async () => {
    engine.answer = () => invokeAnswer('{}');
    const event = '{ "z": 1,\n\t"a" : [ 2 , "é" ] }  ';

    await invoke(endpoint, 'orders', event, signal());

    expect(engine.operations()).toEqual(['Invoke']);
    const [sent] = engine.sent;
    expect(sent?.method).toBe('POST');
    expect(sent?.url.pathname).toBe('/2015-03-31/functions/orders/invocations');
    expect(sent?.headers.get('x-amz-invocation-type')).toBe('RequestResponse');
    expect(sent?.headers.get('x-amz-log-type')).toBe('Tail');
    expect(sent?.url.searchParams.has('Qualifier')).toBe(false);
    expect(sent?.body).toBe(event);
  });

  it('gives the payload as text and the log decoded from base64 as UTF-8, a multi-byte character kept', async () => {
    const log = 'START RequestId: 1\necho-line ünïcødé ✓ 🐍\nEND RequestId: 1\nREPORT RequestId: 1\n';
    engine.answer = () => invokeAnswer('{"got":  {"k": "v"}, "version":"v1"}', { 'x-amz-log-result': base64(log) });

    expect(await invoke(endpoint, 'orders', '{}', signal())).toEqual({
      payload: '{"got":  {"k": "v"}, "version":"v1"}',
      log,
    });
  });

  it('gives FunctionError’s value beside the payload and the log', async () => {
    engine.answer = () =>
      invokeAnswer('{"errorMessage":"boom","errorType":"Exception"}', {
        'x-amz-function-error': 'Unhandled',
        'x-amz-log-result': base64('Traceback: boom\n'),
      });

    expect(await invoke(endpoint, 'orders', '{}', signal())).toEqual({
      payload: '{"errorMessage":"boom","errorType":"Exception"}',
      log: 'Traceback: boom\n',
      functionError: 'Unhandled',
    });
  });

  it('gives both empty for an answer with neither payload nor log', async () => {
    engine.answer = () => invokeAnswer('');

    expect(await invoke(endpoint, 'orders', '{}', signal())).toEqual({ payload: '', log: '' });
  });
});

describe('changing a function’s code', () => {
  it('sends one UpdateFunctionCode with the name and the bytes as ZipFile', async () => {
    engine.answer = () => json(200, functionItem('orders', { LastUpdateStatus: 'InProgress' }));
    const bytes = storedZip('lambda_function.py', 'def lambda_handler(event, context):\n    return 2\n');

    await updateFunctionCode(endpoint, 'orders', bytes, signal());

    expect(engine.operations()).toEqual(['UpdateFunctionCode']);
    expect(engine.sent[0]?.method).toBe('PUT');
    expect(engine.sent[0]?.url.pathname).toBe('/2015-03-31/functions/orders/code');
    expect(JSON.parse(engine.sent[0]?.body ?? '{}')).toEqual({ ZipFile: btoa(String.fromCharCode(...bytes)) });
  });
});

describe('changing a function’s configuration', () => {
  it.each<[string, ConfigurationChange, Record<string, unknown>]>([
    [
      'runtime and handler',
      { runtime: 'python3.12', handler: 'pkg/mod.handler' },
      { Runtime: 'python3.12', Handler: 'pkg/mod.handler' },
    ],
    [
      'description, memory and timeout',
      { description: 'second', memorySize: 256, timeout: 1 },
      { Description: 'second', MemorySize: 256, Timeout: 1 },
    ],
    [
      'variables',
      {
        variables: [
          { key: 'GREETING', value: 'hello-2' },
          { key: 'EXTRA', value: '' },
        ],
      },
      { Environment: { Variables: { GREETING: 'hello-2', EXTRA: '' } } },
    ],
    ['an empty list of variables', { variables: [] }, { Environment: { Variables: {} } }],
    ['an empty description', { description: '' }, { Description: '' }],
  ])('sends one request holding exactly the fields of %s', async (_, change, body) => {
    engine.answer = () => json(200, functionItem('orders', { LastUpdateStatus: 'InProgress' }));

    await updateFunctionConfiguration(endpoint, 'orders', change, signal());

    expect(engine.operations()).toEqual(['UpdateFunctionConfiguration']);
    expect(engine.sent[0]?.method).toBe('PUT');
    expect(engine.sent[0]?.url.pathname).toBe('/2015-03-31/functions/orders/configuration');
    expect(JSON.parse(engine.sent[0]?.body ?? '{}')).toEqual(body);
  });

  it('keeps the variables in the order of the list', async () => {
    engine.answer = () => json(200, functionItem('orders'));

    await updateFunctionConfiguration(
      endpoint,
      'orders',
      {
        variables: [
          { key: 'Z', value: '1' },
          { key: 'A', value: '2' },
          { key: 'M', value: '3' },
        ],
      },
      signal(),
    );

    const sent = JSON.parse(engine.sent[0]?.body ?? '{}') as { Environment: { Variables: Record<string, string> } };
    expect(Object.keys(sent.Environment.Variables)).toEqual(['Z', 'A', 'M']);
  });
});

describe('creating a function from a .zip file', () => {
  it('sends CreateFunction with the file’s bytes and the handler typed, and no starter archive', async () => {
    const arn = 'arn:aws:iam::000000000000:role/shared';
    const bytes = storedZip('pkg/mod.py', 'def other(event, context):\n    return "other"\n');

    await createFunction(
      endpoint,
      {
        name: 'zipped',
        runtime: 'python3.13',
        architecture: 'x86_64',
        role: { kind: 'existing', arn },
        code: { kind: 'zip', bytes, handler: 'pkg/mod.other' },
      },
      signal(),
    );

    expect(engine.operations()).toEqual(['CreateFunction']);
    const starter = starterCode('python3.13');
    const sent = JSON.parse(engine.sent[0]?.body ?? '{}') as { Handler: string; Code: { ZipFile: string } };
    expect(sent.Handler).toBe('pkg/mod.other');
    expect(sent.Code.ZipFile).toBe(btoa(String.fromCharCode(...bytes)));
    expect(sent.Code.ZipFile).not.toBe(
      btoa(String.fromCharCode(...storedZip(starter?.fileName ?? '', starter?.text ?? ''))),
    );
  });

  it('creates from a .zip file with a runtime Studio has no starter code for', async () => {
    const bytes = storedZip('a.txt', 'x');

    await createFunction(
      endpoint,
      {
        name: 'java',
        runtime: 'java21',
        architecture: 'x86_64',
        role: { kind: 'existing', arn: 'arn:aws:iam::000000000000:role/r' },
        code: { kind: 'zip', bytes, handler: 'example.Handler' },
      },
      signal(),
    );

    expect(engine.operations()).toEqual(['CreateFunction']);
  });
});

describe('a failure of the three new operations', () => {
  const calls: [string, (s: AbortSignal) => Promise<unknown>][] = [
    ['Invoke', (s) => invoke(endpoint, 'orders', '{}', s)],
    ['UpdateFunctionCode', (s) => updateFunctionCode(endpoint, 'orders', storedZip('a', 'b'), s)],
    ['UpdateFunctionConfiguration', (s) => updateFunctionConfiguration(endpoint, 'orders', { timeout: 3 }, s)],
  ];

  async function requestFailureOf(promise: Promise<unknown>): Promise<RequestFailure> {
    const error = await rejection(promise);
    expect(error).toBeInstanceOf(RequestError);
    return (error as RequestError).failure;
  }

  const cases: [string, () => Answer, (operation: string) => RequestFailure][] = [
    [
      'a code and message',
      () => lambdaError(409, 'ResourceConflictException', 'An update is in progress for resource: f'),
      (operation) => ({
        kind: 'other',
        operation,
        code: 'ResourceConflictException',
        message: 'An update is in progress for resource: f',
      }),
    ],
    ['501', () => lambdaError(501, 'NotImplemented', 'no'), (operation) => ({ kind: 'not-implemented', operation })],
    [
      '403',
      () => lambdaError(403, 'AccessDeniedException', 'may not'),
      (operation) => ({ kind: 'access-denied', operation, message: 'may not' }),
    ],
    ['the engine not answering', () => 'network-error', (operation) => ({ kind: 'engine-did-not-answer', operation })],
    [
      'the emulator not answering',
      () => lambdaError(504, 'EmulatorTimeout', 'no answer within 60 seconds'),
      (operation) => ({ kind: 'emulator-did-not-answer', operation, message: 'no answer within 60 seconds' }),
    ],
  ];

  for (const [operation, call] of calls) {
    it.each(cases)(`of ${operation} with %s is the area’s failure of that kind`, async (_, answer, expected) => {
      engine.answer = answer;

      expect(await requestFailureOf(call(signal()))).toEqual(expected(operation));
    });

    it(`of ${operation} answered 413 without a body carries the status 413`, async () => {
      engine.answer = () => new Response(null, { status: 413, statusText: 'Payload Too Large' });

      const failed = await requestFailureOf(call(signal()));

      expect(failed.operation).toBe(operation);
      expect(isTooLarge(failed)).toBe(true);
    });

    it(`of ${operation} aborted rejects with the signal’s reason alone`, async () => {
      engine.answer = () => 'hold';
      const controller = new AbortController();
      const reason = new Error('left the page');
      const settled = call(controller.signal).then(
        () => 'resolved',
        (error: unknown) => error,
      );
      await vi.waitFor(() => {
        expect(engine.sent).toHaveLength(1);
      });
      controller.abort(reason);

      expect(await settled).toBe(reason);
    });
  }

  it('is "not found" for ResourceNotFoundException, and "too large" for no other code', async () => {
    engine.answer = () => lambdaError(404, 'ResourceNotFoundException', 'Function not found: f');

    const failed = await requestFailureOf(invoke(endpoint, 'f', '{}', signal()));

    expect(isFunctionNotFound(failed)).toBe(true);
    expect(isTooLarge(failed)).toBe(false);
    expect(
      isTooLarge({ kind: 'other', operation: 'Invoke', code: 'RequestEntityTooLargeException', message: 'big' }),
    ).toBe(false);
  });
});
