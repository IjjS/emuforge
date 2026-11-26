import type { Integration } from '@aws-sdk/client-api-gateway';
import { expect, it } from 'vitest';

import { testUnavailableReason } from './test-availability';

const lambda = 'arn:aws:lambda:us-east-1:000000000000:function:orders';
const lambdaUri = `arn:aws:apigateway:us-east-1:lambda:path/2015-03-31/functions/${lambda}/invocations`;
const awsUri = 'arn:aws:apigateway:us-east-1:s3:path/bucket/key';
const supported: Integration[] = [
  { type: 'MOCK' },
  { type: 'AWS', uri: lambdaUri },
  { type: 'AWS_PROXY', uri: lambdaUri },
  { type: 'HTTP', uri: 'http://127.0.0.1/orders' },
  { type: 'HTTP_PROXY', uri: 'http://127.0.0.1/orders' },
];

it('offers Test for no integration and the supported Internet or unspecified connections', () => {
  expect(testUnavailableReason(undefined)).toBeUndefined();
  for (const integration of supported) {
    expect(testUnavailableReason(integration)).toBeUndefined();
    expect(testUnavailableReason({ ...integration, connectionType: 'INTERNET' })).toBeUndefined();
  }
});

it.each(supported)('applies the VPC link restriction before the type for $type', (integration) => {
  expect(testUnavailableReason({ ...integration, connectionType: 'VPC_LINK' })).toBe(
    'Test is not offered for an integration through a VPC link: where the emulator sends it has not been verified.',
  );
});

it.each(['AWS', 'AWS_PROXY'] as const)('explains why a non-Lambda %s integration is unavailable', (type) => {
  expect(testUnavailableReason({ type, uri: awsUri })).toBe(
    'Test is not offered for an AWS service integration other than Lambda: where the emulator sends it has not been verified.',
  );
});

it('names the unsupported integration type', () => {
  const integration = { type: 'OTHER' } as unknown as Integration;
  expect(testUnavailableReason(integration)).toBe(
    "Test is offered for mock, Lambda and HTTP integrations. This method's integration is of type OTHER.",
  );
});
