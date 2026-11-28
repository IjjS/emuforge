import type { Target } from '@aws-sdk/client-eventbridge';
import { expect, it } from 'vitest';

import { targetView } from './target-view';

const target: Target = { Id: 'deliver', Arn: 'arn:aws:sqs:us-east-1:000000000000:orders' };
const paths = { order: '$.detail.order' };
const template = '{"order": <order>}';

it.each([
  [{}, { label: 'Matched event' }],
  [{ Input: '{"fixed": true}' }, { label: 'Constant', text: '{"fixed": true}' }],
  [{ InputPath: '$.detail' }, { label: 'Part of the event', path: '$.detail' }],
  [{ InputTransformer: { InputPathsMap: paths, InputTemplate: template } }, { label: 'Transformed', paths, template }],
] satisfies [Partial<Target>, unknown][])('describes the input for %j', (input, expected) => {
  expect(targetView({ ...target, ...input }).input).toEqual(expected);
});

it('reads optional delivery details from the target when present', () => {
  const deadLetterArn = 'arn:aws:sqs:us-east-1:000000000000:orders-failed';
  const retryPolicy = { MaximumEventAgeInSeconds: 60, MaximumRetryAttempts: 0 };
  const roleArn = 'arn:aws:iam::000000000000:role/delivery';
  const messageGroupId = 'orders';
  expect(
    targetView({
      ...target,
      DeadLetterConfig: { Arn: deadLetterArn },
      RetryPolicy: retryPolicy,
      RoleArn: roleArn,
      SqsParameters: { MessageGroupId: messageGroupId },
    }),
  ).toMatchObject({ deadLetterArn, retryPolicy, roleArn, messageGroupId });
  expect(targetView(target)).toEqual({ input: { label: 'Matched event' } });
});
