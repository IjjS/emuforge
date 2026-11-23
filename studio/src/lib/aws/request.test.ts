// @vitest-environment node
/// <reference types="node" />
import { getEventListeners } from 'node:events';
import process from 'node:process';
import { DescribeTableCommand, DynamoDBClient, DynamoDBServiceException } from '@aws-sdk/client-dynamodb';
import { DescribeVpcsCommand, EC2Client } from '@aws-sdk/client-ec2';
import { GetRoleCommand, IAMClient, ListRolesCommand } from '@aws-sdk/client-iam';
import {
  GetFunctionCommand,
  LambdaClient,
  ListFunctionsCommand,
  PublishLayerVersionCommand,
} from '@aws-sdk/client-lambda';
import { ListHostedZonesCommand, Route53Client } from '@aws-sdk/client-route-53';
import { ListBucketsCommand, S3ServiceException } from '@aws-sdk/client-s3';
import { GetQueueUrlCommand, SQSClient } from '@aws-sdk/client-sqs';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import { createAwsClient, createS3Client, engineEndpoint } from './client-factory';
import {
  reportedNotImplementedMessage,
  reportedServiceCode,
  refusalMessage,
  requestFailure,
  RequestError,
  sendRequest,
  UNREADABLE_ANSWER,
  untilAborted,
  type RequestFailure,
} from './request';

// The shared mapping of a failed request and the wait on its signal (issue 445, requirement R4 to R6). The test plays
// the engine behind the page's `fetch`: its session route, and every AWS request, answered in the shape the emulator
// and the engine write for the client's protocol. Clients are made by Studio's factory from the SDK's classes. The
// file runs in Node so that `getEventListeners` can see the listeners on a signal.

interface Answer {
  status: number;
  statusText?: string;
  body?: string;
  headers?: Record<string, string>;
}

type EngineAnswer = Answer | 'network-error';

const TOKEN = 'emuforge-test-token-445';

class FakeEngine {
  /** The URL of every AWS request, as it was sent. */
  readonly awsRequests: string[] = [];
  session: () => EngineAnswer = () => ({ status: 200, body: JSON.stringify({ token: TOKEN }) });
  aws: () => EngineAnswer = () => ({ status: 500, body: '' });

  readonly fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    let answer: EngineAnswer;
    if (url.pathname === '/__emuforge/session') {
      answer = this.session();
    } else {
      this.awsRequests.push(request.url);
      answer = this.aws();
    }
    if (answer === 'network-error') {
      throw new TypeError('Failed to fetch');
    }
    return new Response(answer.body ?? '', {
      status: answer.status,
      ...(answer.statusText === undefined ? {} : { statusText: answer.statusText }),
      headers: answer.headers ?? {},
    });
  };
}

function messageXml(message: string | undefined): string {
  return message === undefined ? '' : `<Message>${message}</Message>`;
}

/** S3 and Route 53: `<Error>` with its `<Code>`. */
function restXml(status: number, code: string, message?: string, statusText?: string): Answer {
  return {
    status,
    ...(statusText === undefined ? {} : { statusText }),
    body: `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code>${messageXml(message)}</Error>`,
    headers: { 'content-type': 'application/xml' },
  };
}

/** IAM, SNS, CloudFormation: `<ErrorResponse>` with the error's type and `<Code>`. */
function query(status: number, code: string, message?: string, statusText?: string): Answer {
  const type = status >= 500 ? 'Receiver' : 'Sender';
  return {
    status,
    ...(statusText === undefined ? {} : { statusText }),
    body: `<?xml version="1.0"?><ErrorResponse><Error><Type>${type}</Type><Code>${code}</Code>${messageXml(
      message,
    )}</Error><RequestId>r-445</RequestId></ErrorResponse>`,
    headers: { 'content-type': 'text/xml' },
  };
}

/** EC2: `<Response><Errors><Error>` with its `<Code>`. */
function ec2(status: number, code: string, message?: string): Answer {
  return {
    status,
    body: `<?xml version="1.0" encoding="UTF-8"?><Response><Errors><Error><Code>${code}</Code>${messageXml(
      message,
    )}</Error></Errors><RequestID>r-445</RequestID></Response>`,
    headers: { 'content-type': 'text/xml' },
  };
}

/** A JSON protocol's error, as the engine writes its own: `__type`, `message` and the header `x-amzn-errortype`. */
function json(contentType: string, status: number, code: string, message?: string, statusText?: string): Answer {
  return {
    status,
    ...(statusText === undefined ? {} : { statusText }),
    body: JSON.stringify({ __type: code, ...(message === undefined ? {} : { message }) }),
    headers: { 'content-type': contentType, 'x-amzn-errortype': code },
  };
}

const JSON_1_0 = 'application/x-amz-json-1.0';
const REST_JSON = 'application/json';

// Sessions and clients are held per engine endpoint for the life of the page, so each case has a port of its own.
let nextPort = 8700;
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

type Send = (signal: AbortSignal) => Promise<unknown>;

/** One request of each operation the cases name, by a client of the factory for this case's engine. */
const REQUESTS = {
  ListBuckets: (signal) => createS3Client({ endpoint }).send(new ListBucketsCommand({}), { abortSignal: signal }),
  DescribeVpcs: (signal) =>
    createAwsClient(EC2Client, { endpoint }).send(new DescribeVpcsCommand({ VpcIds: ['vpc-0445'] }), {
      abortSignal: signal,
    }),
  ListFunctions: (signal) =>
    createAwsClient(LambdaClient, { endpoint }).send(new ListFunctionsCommand({}), { abortSignal: signal }),
  GetFunction: (signal) =>
    createAwsClient(LambdaClient, { endpoint }).send(new GetFunctionCommand({ FunctionName: 'p445-missing' }), {
      abortSignal: signal,
    }),
  PublishLayerVersion: (signal) =>
    createAwsClient(LambdaClient, { endpoint }).send(
      new PublishLayerVersionCommand({ LayerName: 'tools', Content: { ZipFile: new Uint8Array([80, 75]) } }),
      { abortSignal: signal },
    ),
  ListRoles: (signal) =>
    createAwsClient(IAMClient, { endpoint }).send(new ListRolesCommand({}), { abortSignal: signal }),
  GetRole: (signal) =>
    createAwsClient(IAMClient, { endpoint }).send(new GetRoleCommand({ RoleName: 'p445-missing' }), {
      abortSignal: signal,
    }),
  DescribeTable: (signal) =>
    createAwsClient(DynamoDBClient, { endpoint }).send(new DescribeTableCommand({ TableName: 'p445-missing' }), {
      abortSignal: signal,
    }),
  GetQueueUrl: (signal) =>
    createAwsClient(SQSClient, { endpoint }, { useQueueUrlAsEndpoint: false }).send(
      new GetQueueUrlCommand({ QueueName: 'p445-missing' }),
      { abortSignal: signal },
    ),
  ListHostedZones: (signal) =>
    createAwsClient(Route53Client, { endpoint }).send(new ListHostedZonesCommand({}), { abortSignal: signal }),
} satisfies Record<string, Send>;

type Operation = keyof typeof REQUESTS;

/** The failure of the `RequestError` that `sendRequest` rejects with. */
async function failure(promise: Promise<unknown>): Promise<RequestFailure> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(RequestError);
    return (error as RequestError).failure;
  }
  throw new Error('the request resolved');
}

/** The failure of one request of `operation`, sent through `sendRequest` with that operation's name. */
function failureOf(operation: Operation): Promise<RequestFailure> {
  return failure(sendRequest(operation, REQUESTS[operation], new AbortController().signal));
}

const NEVER_ABORTS = (): AbortSignal => new AbortController().signal;

const EMULATOR_UNAVAILABLE =
  'the emulator at https://127.0.0.1:9545 is not reachable (not_started): start the emulator on port 9545';
const EMULATOR_TIMEOUT = 'the emulator at https://127.0.0.1:9545 did not answer within 30 seconds';

describe('the mapping', () => {
  it('retains classified service codes through a wrapped request without changing its failure', async () => {
    engine.aws = () => json(REST_JSON, 403, 'AccessDeniedException', 'policy refused');
    const failed = await failureOf('ListFunctions');
    expect(failed).toEqual({ kind: 'access-denied', operation: 'ListFunctions', message: 'policy refused' });
    expect(reportedServiceCode(requestFailure('ListFunctions', new RequestError(failed)))).toBe(
      'AccessDeniedException',
    );

    engine.aws = () => json(REST_JSON, 503, 'EmulatorUnavailable', EMULATOR_UNAVAILABLE);
    expect(reportedServiceCode(await failureOf('ListFunctions'))).toBe('EmulatorUnavailable');
  });

  it('retains a body Code before the SDK exception name without changing classification', () => {
    const failed = requestFailure('ListFunctions', {
      Code: 'AccessDenied',
      name: 'EmulatorTimeout',
      $fault: 'client',
      $metadata: { httpStatusCode: 403 },
      message: 'policy refused',
    });
    expect(failed).toEqual({ kind: 'access-denied', operation: 'ListFunctions', message: 'policy refused' });
    expect(reportedServiceCode(failed)).toBe('AccessDenied');
  });

  it('retains only a reported code, excluding synthetic SDK and HTTP fallbacks', async () => {
    engine.aws = () => ({ status: 404, body: '' });
    const failed = await failureOf('ListBuckets');
    expect(failed).toEqual({ kind: 'other', operation: 'ListBuckets', code: 'HTTP 404' });
    expect(reportedServiceCode(failed)).toBeUndefined();

    engine.aws = () => json(REST_JSON, 404, 'NotFound', 'no such thing');
    expect(reportedServiceCode(await failureOf('ListFunctions'))).toBe('NotFound');
  });

  it('keeps 501 as its own state even when the service reports a code', async () => {
    engine.aws = () => json(REST_JSON, 501, 'NotImplementedException');
    const failed = await failureOf('ListFunctions');
    expect(failed).toEqual({ kind: 'not-implemented', operation: 'ListFunctions' });
    expect(reportedServiceCode(failed)).toBe('NotImplementedException');
    expect(reportedNotImplementedMessage(failed)).toBeUndefined();
  });

  it('retains the returned 501 message alongside the code without changing the mapped failure', async () => {
    const message = 'operation ListBuckets is scaffolded but not implemented in this emulator';
    engine.aws = () => restXml(501, 'NotImplemented', message);
    const failed = await failureOf('ListBuckets');
    expect(failed).toEqual({ kind: 'not-implemented', operation: 'ListBuckets' });
    const wrapped = requestFailure('ListBuckets', new RequestError(failed));
    expect(reportedServiceCode(wrapped)).toBe('NotImplemented');
    expect(reportedNotImplementedMessage(wrapped)).toBe(message);
  });

  it('is "not implemented", naming DescribeVpcs, for EC2 answered 501 NotImplemented in its own shape', async () => {
    engine.aws = () =>
      ec2(501, 'NotImplemented', 'operation DescribeVpcs is scaffolded but not implemented in this emulator');

    expect(await failureOf('DescribeVpcs')).toEqual({ kind: 'not-implemented', operation: 'DescribeVpcs' });
  });

  it('is "not implemented", naming ListFunctions, for Lambda answered 501 with a body that is not JSON', async () => {
    engine.aws = () => ({ status: 501, statusText: 'Not Implemented', body: 'not json' });

    const failed = await failureOf('ListFunctions');
    expect(failed).toEqual({ kind: 'not-implemented', operation: 'ListFunctions' });
    expect(reportedNotImplementedMessage(failed)).toBeUndefined();
  });

  it('is "access denied" with the operation and the message for S3 answered 403 AccessDenied', async () => {
    engine.aws = () => restXml(403, 'AccessDenied', 'not allowed');

    expect(await failureOf('ListBuckets')).toEqual({
      kind: 'access-denied',
      operation: 'ListBuckets',
      message: 'not allowed',
    });
  });

  it('is "access denied" with the operation and the message for Lambda answered 403 AccessDeniedException', async () => {
    engine.aws = () => json(REST_JSON, 403, 'AccessDeniedException', 'not allowed');

    expect(await failureOf('ListFunctions')).toEqual({
      kind: 'access-denied',
      operation: 'ListFunctions',
      message: 'not allowed',
    });
  });

  it('is "access denied" with the SDK’s placeholder as it came for IAM answered 403 AccessDenied without a message', async () => {
    engine.aws = () => query(403, 'AccessDenied');

    expect(await failureOf('ListRoles')).toEqual({ kind: 'access-denied', operation: 'ListRoles', message: 'Unknown' });
  });

  describe.each([
    [503, 'Service Unavailable', 'EmulatorUnavailable', EMULATOR_UNAVAILABLE],
    [504, 'Gateway Timeout', 'EmulatorTimeout', EMULATOR_TIMEOUT],
  ])('answered %i %s %s with the engine’s message', (status, statusText, code, message) => {
    it.each<[Operation, () => Answer]>([
      ['ListBuckets', () => restXml(status, code, message, statusText)],
      ['ListRoles', () => query(status, code, message, statusText)],
      ['DescribeTable', () => json(JSON_1_0, status, code, message, statusText)],
      ['ListFunctions', () => json(REST_JSON, status, code, message, statusText)],
    ])('%s is "emulator did not answer" with its operation and that message', async (operation, answer) => {
      engine.aws = answer;

      expect(await failureOf(operation)).toEqual({ kind: 'emulator-did-not-answer', operation, message });
    });
  });

  it('is "engine did not answer", with no code or message, when the request fails at the network level', async () => {
    engine.aws = () => 'network-error';

    expect(await failureOf('ListBuckets')).toEqual({ kind: 'engine-did-not-answer', operation: 'ListBuckets' });
    expect(engine.awsRequests.length).toBeGreaterThan(0);
  });

  it('is "engine did not answer", and no AWS request is sent, when the session request fails at the network level', async () => {
    engine.session = () => 'network-error';

    expect(await failureOf('ListBuckets')).toEqual({ kind: 'engine-did-not-answer', operation: 'ListBuckets' });
    expect(engine.awsRequests).toHaveLength(0);
  });

  it('is "other" with the engine’s code and no message when the engine refuses the session with 403 and a code', async () => {
    engine.session = () => ({
      status: 403,
      body: JSON.stringify({ error: { code: 'OriginNotAllowed', message: 'the origin is not Studio’s' } }),
    });

    expect(await failureOf('ListBuckets')).toEqual({
      kind: 'other',
      operation: 'ListBuckets',
      code: 'OriginNotAllowed',
    });
    expect(engine.awsRequests).toHaveLength(0);
  });

  it('is "other" with the code HTTP 500 and no message when the engine refuses the session with 500 and no code', async () => {
    engine.session = () => ({ status: 500, body: '' });

    expect(await failureOf('ListBuckets')).toEqual({ kind: 'other', operation: 'ListBuckets', code: 'HTTP 500' });
  });

  it.each([['a text'], [undefined]])(
    'is "engine did not answer" for a send that rejects with a value that is not an answer (%s)',
    async (value) => {
      const send = () => Promise.reject(value as unknown as Error);

      expect(await failure(sendRequest('ListBuckets', send, NEVER_ABORTS()))).toEqual({
        kind: 'engine-did-not-answer',
        operation: 'ListBuckets',
      });
    },
  );

  it('is "access denied" with the message \'\' for the SDK’s service exception for AccessDenied without a message', async () => {
    const rejection = new S3ServiceException({
      name: 'AccessDenied',
      $fault: 'client',
      $metadata: { httpStatusCode: 403 },
    });

    expect(await failure(sendRequest('ListBuckets', () => Promise.reject(rejection), NEVER_ABORTS()))).toEqual({
      kind: 'access-denied',
      operation: 'ListBuckets',
      message: '',
    });
  });

  it('is "emulator did not answer" with the message \'\' for the SDK’s service exception for EmulatorUnavailable without a message', async () => {
    const rejection = new DynamoDBServiceException({
      name: 'EmulatorUnavailable',
      $fault: 'server',
      $metadata: { httpStatusCode: 503 },
    });

    expect(await failure(sendRequest('DescribeTable', () => Promise.reject(rejection), NEVER_ABORTS()))).toEqual({
      kind: 'emulator-did-not-answer',
      operation: 'DescribeTable',
      message: '',
    });
  });

  it('keeps the failure of a RequestError of another operation unchanged, still naming that operation', async () => {
    const earlier: RequestFailure = { kind: 'other', operation: 'GetRole', code: 'NoSuchEntity', message: 'no role' };
    const rejection = new RequestError(earlier);

    expect(await failure(sendRequest('ListRoles', () => Promise.reject(rejection), NEVER_ABORTS()))).toEqual({
      kind: 'other',
      operation: 'GetRole',
      code: 'NoSuchEntity',
      message: 'no role',
    });
  });
});

describe('the code and the message', () => {
  it('takes NoSuchEntity from <Code>, not the SDK’s class NoSuchEntityException, for IAM GetRole answered 404', async () => {
    engine.aws = () => query(404, 'NoSuchEntity', 'The role with name p445-missing cannot be found.');

    expect(await failureOf('GetRole')).toEqual({
      kind: 'other',
      operation: 'GetRole',
      code: 'NoSuchEntity',
      message: 'The role with name p445-missing cannot be found.',
    });
  });

  it('takes the query code of x-amzn-query-error for SQS GetQueueUrl answered 400', async () => {
    engine.aws = () => ({
      status: 400,
      body: JSON.stringify({
        __type: 'com.amazonaws.sqs#QueueDoesNotExist',
        message: 'The specified queue does not exist.',
      }),
      headers: {
        'content-type': JSON_1_0,
        'x-amzn-query-error': 'AWS.SimpleQueueService.NonExistentQueue;Sender',
      },
    });

    expect(await failureOf('GetQueueUrl')).toEqual({
      kind: 'other',
      operation: 'GetQueueUrl',
      code: 'AWS.SimpleQueueService.NonExistentQueue',
      message: 'The specified queue does not exist.',
    });
  });

  it('keeps InvalidVpcID.NotFound whole, with the message, for EC2 DescribeVpcs answered 400', async () => {
    engine.aws = () => ec2(400, 'InvalidVpcID.NotFound', "The vpc ID 'vpc-0445' does not exist");

    expect(await failureOf('DescribeVpcs')).toEqual({
      kind: 'other',
      operation: 'DescribeVpcs',
      code: 'InvalidVpcID.NotFound',
      message: "The vpc ID 'vpc-0445' does not exist",
    });
  });

  it('keeps ResourceNotFoundException with its suffix, and the message, for Lambda GetFunction answered 404', async () => {
    engine.aws = () => ({
      status: 404,
      statusText: 'Not Found',
      body: JSON.stringify({
        __type: 'ResourceNotFoundException',
        Message: 'Function not found: arn:aws:lambda:us-east-1:000000000000:function:p445-missing',
        Type: 'User',
      }),
      headers: { 'content-type': REST_JSON, 'x-amzn-errortype': 'ResourceNotFoundException' },
    });

    expect(await failureOf('GetFunction')).toEqual({
      kind: 'other',
      operation: 'GetFunction',
      code: 'ResourceNotFoundException',
      message: 'Function not found: arn:aws:lambda:us-east-1:000000000000:function:p445-missing',
    });
  });

  it('takes ResourceNotFoundException without its namespace for DynamoDB DescribeTable answered 400', async () => {
    engine.aws = () => ({
      status: 400,
      body: JSON.stringify({
        __type: 'com.amazonaws.dynamodb.v20120810#ResourceNotFoundException',
        message: 'Requested resource not found',
      }),
      headers: { 'content-type': JSON_1_0 },
    });

    expect(await failureOf('DescribeTable')).toEqual({
      kind: 'other',
      operation: 'DescribeTable',
      code: 'ResourceNotFoundException',
      message: 'Requested resource not found',
    });
  });

  it('gives the code and the message for S3 ListBuckets answered 400 InvalidArgument', async () => {
    engine.aws = () => restXml(400, 'InvalidArgument', 'The continuation token provided is incorrect');

    expect(await failureOf('ListBuckets')).toEqual({
      kind: 'other',
      operation: 'ListBuckets',
      code: 'InvalidArgument',
      message: 'The continuation token provided is incorrect',
    });
  });

  it('keeps a <Code> with a namespace as written for S3 ListBuckets answered 400', async () => {
    engine.aws = () => restXml(400, 'com.example.ns#NamespacedCode', 'a namespaced code');

    expect(await failureOf('ListBuckets')).toEqual({
      kind: 'other',
      operation: 'ListBuckets',
      code: 'com.example.ns#NamespacedCode',
      message: 'a namespaced code',
    });
  });

  it('gives the code SomeCode and the message UnknownError for S3 ListBuckets answered 400 with no message', async () => {
    engine.aws = () => restXml(400, 'SomeCode');

    expect(await failureOf('ListBuckets')).toEqual({
      kind: 'other',
      operation: 'ListBuckets',
      code: 'SomeCode',
      message: 'UnknownError',
    });
  });

  it('gives the status line and no message for S3 ListBuckets answered 418 with an empty body', async () => {
    engine.aws = () => ({ status: 418, statusText: "I'm a teapot", body: '' });

    expect(await failureOf('ListBuckets')).toEqual({
      kind: 'other',
      operation: 'ListBuckets',
      code: "HTTP 418 I'm a teapot",
    });
  });

  it('gives HTTP 409 and no message, and nothing of the SDK’s parse error, for S3 ListBuckets answered 409 not xml', async () => {
    engine.aws = () => ({ status: 409, body: 'not xml' });

    const result = await failureOf('ListBuckets');

    expect(result).toEqual({ kind: 'other', operation: 'ListBuckets', code: 'HTTP 409' });
    expect(JSON.stringify(result)).not.toMatch(/Error|parse/i);
  });

  it('gives HTTP 409 and no message, and nothing of the SDK’s parse error, for Lambda ListFunctions answered 409 not json', async () => {
    engine.aws = () => ({ status: 409, body: 'not json' });

    const result = await failureOf('ListFunctions');

    expect(result).toEqual({ kind: 'other', operation: 'ListFunctions', code: 'HTTP 409' });
    expect(JSON.stringify(result)).not.toMatch(/SyntaxError|parse/i);
  });

  it('gives HTTP 404 and no message for Lambda ListFunctions answered 404 with an empty body', async () => {
    engine.aws = () => ({ status: 404, body: '' });

    expect(await failureOf('ListFunctions')).toEqual({ kind: 'other', operation: 'ListFunctions', code: 'HTTP 404' });
  });

  it.each([
    { headers: { 'X-Amzn-ErrorType': 'NotFound' }, body: '', code: 'NotFound' },
    { headers: {}, body: '', code: 'HTTP 404' },
    { headers: {}, body: '{"__type":"NotFound"}', code: 'NotFound' },
  ])('distinguishes an explicit Lambda 404 code from an empty 404: $code', async ({ headers, body, code }) => {
    engine.aws = () => ({ status: 404, body, headers: { 'content-type': REST_JSON, ...headers } });

    const failure = await failureOf('PublishLayerVersion');
    expect(failure).toEqual({ kind: 'other', operation: 'PublishLayerVersion', code });
    expect(reportedServiceCode(failure)).toBe(code === 'HTTP 404' ? undefined : code);
  });

  it('keeps the Lambda error header when the SDK cannot parse the body', async () => {
    engine.aws = () => ({
      status: 400,
      body: 'invalid JSON',
      headers: { 'content-type': REST_JSON, 'X-Amzn-ErrorType': 'LayerError' },
    });

    const failure = await failureOf('PublishLayerVersion');
    expect(failure).toEqual({ kind: 'other', operation: 'PublishLayerVersion', code: 'LayerError' });
    expect(reportedServiceCode(failure)).toBe('LayerError');
  });

  it.each([
    { body: '', message: undefined },
    { body: '{"message":"Layer publication was refused"}', message: 'Layer publication was refused' },
  ])('exposes only the service message for a Lambda header-code rejection ($body)', async ({ body, message }) => {
    engine.aws = () => ({
      status: 400,
      body,
      headers: { 'content-type': REST_JSON, 'x-amzn-errortype': 'LayerError' },
    });

    const failure = await failureOf('PublishLayerVersion');
    expect(failure).toEqual({
      kind: 'other',
      operation: 'PublishLayerVersion',
      code: 'LayerError',
      message: message ?? 'UnknownError',
    });
    expect(reportedServiceCode(failure)).toBe('LayerError');
    expect(refusalMessage(failure)).toBe(message);
  });

  it('keeps HTTP 413 for a layer publication refusal with no body or error code', async () => {
    engine.aws = () => ({ status: 413 });

    const failure = await failureOf('PublishLayerVersion');
    expect(failure).toEqual({ kind: 'other', operation: 'PublishLayerVersion', code: 'HTTP 413' });
    expect(reportedServiceCode(failure)).toBeUndefined();
  });

  it('keeps the service message with HTTP 413 when Lambda supplies no service code', async () => {
    engine.aws = () => ({
      status: 413,
      body: '{"message":"ZIP request is too large"}',
      headers: { 'content-type': REST_JSON },
    });

    const failure = await failureOf('PublishLayerVersion');
    expect(failure).toEqual({
      kind: 'other',
      operation: 'PublishLayerVersion',
      code: 'HTTP 413',
      message: 'ZIP request is too large',
    });
    expect(reportedServiceCode(failure)).toBeUndefined();
  });

  it.each<Operation>(['ListBuckets', 'ListRoles'])(
    'gives HTTP 404, not NotFound, and no message for %s answered 404 with an empty body',
    async (operation) => {
      engine.aws = () => ({ status: 404, body: '' });

      expect(await failureOf(operation)).toEqual({ kind: 'other', operation, code: 'HTTP 404' });
    },
  );

  it('gives the code NotFound and the message for Lambda ListFunctions answered 404 x-amzn-errortype NotFound', async () => {
    engine.aws = () => json(REST_JSON, 404, 'NotFound', 'no such thing');

    expect(await failureOf('ListFunctions')).toEqual({
      kind: 'other',
      operation: 'ListFunctions',
      code: 'NotFound',
      message: 'no such thing',
    });
  });

  it('gives the status line for Route 53 ListHostedZones answered as the engine answers today, 503 in JSON', async () => {
    engine.aws = () => json(REST_JSON, 503, 'EmulatorUnavailable', EMULATOR_UNAVAILABLE, 'Service Unavailable');

    expect(await failureOf('ListHostedZones')).toEqual({
      kind: 'other',
      operation: 'ListHostedZones',
      code: 'HTTP 503 Service Unavailable',
    });
  });

  it('names an answer it could not read, with the SDK’s message and no status, for Lambda ListFunctions answered 200 OK not json', async () => {
    engine.aws = () => ({
      status: 200,
      statusText: 'OK',
      body: '{"Functions": [',
      headers: { 'content-type': REST_JSON },
    });

    const result = await failureOf('ListFunctions');

    expect(result).toMatchObject({ kind: 'other', operation: 'ListFunctions', code: UNREADABLE_ANSWER });
    expect(result.kind === 'other' ? result.message : undefined).toMatch(/\S/);
    expect(JSON.stringify(result)).not.toMatch(/HTTP 200|"OK"/);
  });
});

type State<T> = { state: 'pending' } | { state: 'resolved'; value: T } | { state: 'rejected'; reason: unknown };

/** What `promise` has done once every task queued before this call has run. */
async function stateOf<T>(promise: Promise<T>): Promise<State<T>> {
  let state: State<T> = { state: 'pending' };
  promise.then(
    (value) => {
      state = { state: 'resolved', value };
    },
    (reason: unknown) => {
      state = { state: 'rejected', reason };
    },
  );
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
  return state;
}

interface Held<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

/** A request held until the case settles it. */
function held<T>(): Held<T> {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Every unhandled rejection reported while the case runs. */
function unhandledRejections(): unknown[] {
  const reported: unknown[] = [];
  const record = (reason: unknown) => {
    reported.push(reason);
  };
  process.on('unhandledRejection', record);
  onTestFinished(() => {
    process.off('unhandledRejection', record);
  });
  return reported;
}

describe('the wait', () => {
  it('resolves with the value of a send that resolves, having called send once with the signal given', async () => {
    const value = { answer: 445 };
    const signal = NEVER_ABORTS();
    const send = vi.fn<(signal: AbortSignal) => Promise<typeof value>>(() => Promise.resolve(value));

    await expect(sendRequest('ListBuckets', send, signal)).resolves.toBe(value);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toBe(signal);
  });

  it('rejects with the reason of a signal aborted before the call, and does not call send', async () => {
    const controller = new AbortController();
    const reason = new Error('aborted before');
    controller.abort(reason);
    const send = vi.fn<(signal: AbortSignal) => Promise<string>>(() => Promise.resolve('sent'));

    await expect(sendRequest('ListBuckets', send, controller.signal)).rejects.toBe(reason);
    expect(send).not.toHaveBeenCalled();
  });

  it('rejects with the signal’s reason, before the held request settles, when the signal aborts', async () => {
    const controller = new AbortController();
    const reason = new Error('not wanted any more');
    const request = held<string>();

    const sent = sendRequest('ListBuckets', () => request.promise, controller.signal);
    expect(await stateOf(sent)).toEqual({ state: 'pending' });
    controller.abort(reason);

    const state = await stateOf(sent);
    expect(state).toEqual({ state: 'rejected', reason });
    expect((state as { reason: unknown }).reason).toBe(reason);
  });

  it('lets nothing more reach the caller, and reports no unhandled rejection, when the held request rejects after the abort', async () => {
    const reported = unhandledRejections();
    const controller = new AbortController();
    const reason = new Error('not wanted any more');
    const request = held<string>();

    const sent = sendRequest('ListBuckets', () => request.promise, controller.signal);
    controller.abort(reason);
    expect(await stateOf(sent)).toEqual({ state: 'rejected', reason });
    request.reject(new TypeError('Failed to fetch'));

    const state = await stateOf(sent);
    expect((state as { reason: unknown }).reason).toBe(reason);
    await stateOf(Promise.resolve());
    expect(reported).toEqual([]);
  });

  it('leaves the caller with the reason alone when the held request resolves after the abort', async () => {
    const controller = new AbortController();
    const reason = new Error('not wanted any more');
    const request = held<string>();

    const sent = sendRequest('ListBuckets', () => request.promise, controller.signal);
    controller.abort(reason);
    expect(await stateOf(sent)).toEqual({ state: 'rejected', reason });
    request.resolve('late answer');

    const state = await stateOf(sent);
    expect(state).toEqual({ state: 'rejected', reason });
    expect((state as { reason: unknown }).reason).toBe(reason);
  });

  it('rejects with a RequestError for the value a send throws, as for one that rejects with it', async () => {
    const thrown = new S3ServiceException({
      name: 'InvalidArgument',
      $fault: 'client',
      $metadata: { httpStatusCode: 400 },
      message: 'The continuation token provided is incorrect',
    });
    const throwing = (): Promise<unknown> => {
      throw thrown;
    };

    const fromThrow = await failure(sendRequest('ListBuckets', throwing, NEVER_ABORTS()));
    const fromReject = await failure(sendRequest('ListBuckets', () => Promise.reject(thrown), NEVER_ABORTS()));

    expect(fromThrow).toEqual(fromReject);
    expect(fromThrow).toEqual({
      kind: 'other',
      operation: 'ListBuckets',
      code: 'InvalidArgument',
      message: 'The continuation token provided is incorrect',
    });
  });

  it('untilAborted settles as the promise does, with the same value, for a signal that never aborts', async () => {
    const value = { answer: 445 };
    const error = new Error('refused');

    await expect(untilAborted(Promise.resolve(value), NEVER_ABORTS())).resolves.toBe(value);
    await expect(untilAborted(Promise.reject(error), NEVER_ABORTS())).rejects.toBe(error);
  });

  it('untilAborted rejects with the reason at once when the signal aborts and the promise never settles', async () => {
    const controller = new AbortController();
    const reason = new Error('not wanted any more');

    const waiting = untilAborted(held<string>().promise, controller.signal);
    controller.abort(reason);

    const state = await stateOf(waiting);
    expect(state).toEqual({ state: 'rejected', reason });
    expect((state as { reason: unknown }).reason).toBe(reason);
  });

  it('untilAborted rejects with the reason of a signal that has already aborted, although the promise never settles', async () => {
    const controller = new AbortController();
    const reason = new Error('aborted before');
    controller.abort(reason);

    const state = await stateOf(untilAborted(held<string>().promise, controller.signal));
    expect(state).toEqual({ state: 'rejected', reason });
    expect((state as { reason: unknown }).reason).toBe(reason);
  });

  it.each<[string, (request: Held<string>, controller: AbortController) => void]>([
    ['resolved', (request) => request.resolve('answer')],
    ['rejected', (request) => request.reject(new Error('refused'))],
    ['aborted', (_request, controller) => controller.abort(new Error('not wanted any more'))],
  ])('untilAborted leaves no listener on the signal once it has %s', async (_way, settle) => {
    const controller = new AbortController();
    const request = held<string>();

    const waiting = untilAborted(request.promise, controller.signal);
    settle(request, controller);

    expect((await stateOf(waiting)).state).not.toBe('pending');
    expect(getEventListeners(controller.signal, 'abort')).toEqual([]);
  });
});

describe('a RequestError', () => {
  it.each<RequestFailure>([
    { kind: 'not-implemented', operation: 'ListBuckets' },
    { kind: 'access-denied', operation: 'GetRole', message: 'not allowed' },
  ])('is an Error named RequestError, with the message "<operation> failed: <kind>." ($kind)', (given) => {
    const error = new RequestError(given);

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('RequestError');
    expect(error.message).toBe(`${given.operation} failed: ${given.kind}.`);
    expect(error.failure).toEqual(given);
  });
});
