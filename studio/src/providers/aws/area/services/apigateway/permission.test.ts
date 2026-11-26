import { beforeEach, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../lib/aws/request';
import { addPermission, readPolicy } from './lambda-api';
import { allowApiInvocation, permissionInput } from './permission';

vi.mock('./lambda-api', { spy: true });

const endpoint = 'http://127.0.0.1:9682';
const arn = 'arn:aws:lambda:us-west-2:123456789012:function:orders';
const api = 'my-api';
const source = 'arn:aws:execute-api:us-west-2:123456789012:my-api/*/*/*';
const sid = 'emuforge-apigateway-my-api';
const statement = {
  Sid: sid,
  Effect: 'Allow',
  Principal: { Service: 'apigateway.amazonaws.com' },
  Action: 'lambda:InvokeFunction',
  Condition: { ArnLike: { 'AWS:SourceArn': source } },
};
const signal = new AbortController().signal;
const add = vi.mocked(addPermission);
const policy = vi.mocked(readPolicy);

beforeEach(() => vi.resetAllMocks());

function conflict() {
  add.mockRejectedValueOnce(
    new RequestError({
      kind: 'other',
      operation: 'AddPermission',
      code: 'ResourceConflictException',
    }),
  );
}

it('scopes the function permission to this API ID in the function ARN’s region and account', () => {
  expect(permissionInput(api, arn)).toEqual({
    FunctionName: arn,
    Action: 'lambda:InvokeFunction',
    Principal: 'apigateway.amazonaws.com',
    SourceArn: source,
    StatementId: sid,
  });
});

it('does not read a policy after a successful add', async () => {
  add.mockResolvedValueOnce(undefined);
  await expect(allowApiInvocation(endpoint, api, arn, signal)).resolves.toEqual({ kind: 'given' });
  expect(add).toHaveBeenCalledWith(endpoint, permissionInput(api, arn), signal);
  expect(policy).not.toHaveBeenCalled();
});

it('accepts a conflicting statement that allows this API', async () => {
  conflict();
  policy.mockResolvedValueOnce([statement]);
  await expect(allowApiInvocation(endpoint, api, arn, signal)).resolves.toEqual({ kind: 'given' });
  expect(policy).toHaveBeenCalledWith(endpoint, arn, signal);
});

it.each([
  { Condition: { ArnLike: { 'AWS:SourceArn': source.replace(api, 'another-api') } } },
  { Principal: { Service: 's3.amazonaws.com' } },
  { Action: 'lambda:GetFunction' },
  { Effect: 'Deny' },
])('rejects a conflicting statement with different fields (%j)', async (change) => {
  conflict();
  policy.mockResolvedValueOnce([{ ...statement, ...change }]);
  await expect(allowApiInvocation(endpoint, api, arn, signal)).resolves.toEqual({
    kind: 'not-given',
    reason: `a statement named ${sid} exists and does not allow this API`,
  });
});

it.each([
  [
    new RequestError({ kind: 'access-denied', operation: 'GetPolicy', message: 'Policy access refused.' }),
    'GetPolicy: Policy access refused.',
  ],
  [new SyntaxError('Invalid JSON'), "GetPolicy: the function's policy could not be parsed"],
])('explains a policy that could not be read or parsed', async (error, reason) => {
  conflict();
  policy.mockRejectedValueOnce(error);
  await expect(allowApiInvocation(endpoint, api, arn, signal)).resolves.toStrictEqual({
    kind: 'not-given',
    reason,
    ...(error instanceof RequestError ? { failure: error.failure } : {}),
  });
});

it('reports any other AddPermission refusal without reading the policy', async () => {
  const failure = {
    kind: 'other',
    operation: 'AddPermission',
    code: 'BadRequest',
    message: 'Permission refused.',
  } as const;
  add.mockRejectedValueOnce(new RequestError(failure));
  await expect(allowApiInvocation(endpoint, api, arn, signal)).resolves.toEqual({
    kind: 'not-given',
    reason: 'AddPermission: BadRequest: Permission refused.',
    failure,
  });
  expect(policy).not.toHaveBeenCalled();
});

it.each(['AddPermission', 'GetPolicy'])('preserves the unsupported failure from %s', async (operation) => {
  const failure = { kind: 'not-implemented', operation } as const;
  if (operation === 'GetPolicy') conflict();
  const call = operation === 'AddPermission' ? add : policy;
  call.mockRejectedValueOnce(new RequestError(failure));

  await expect(allowApiInvocation(endpoint, api, arn, signal)).resolves.toEqual({
    kind: 'not-given',
    reason: `${operation}: 501 Not Implemented`,
    failure,
  });
  if (operation === 'AddPermission') expect(policy).not.toHaveBeenCalled();
});
