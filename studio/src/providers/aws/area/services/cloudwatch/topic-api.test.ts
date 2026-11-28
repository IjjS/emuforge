// @vitest-environment node
import { ListTopicsCommand, SNSClient } from '@aws-sdk/client-sns';
import { expect, it, vi } from 'vitest';

import { listTopics } from './topic-api';

it('requests the supplied SNS token and returns the topics by ARN with the next token', async () => {
  const send = vi.spyOn(SNSClient.prototype, 'send').mockImplementation(async () => ({
    $metadata: {},
    Topics: [{ TopicArn: 'arn:aws:sns:us-east-1:000000000000:topic' }, {}],
    NextToken: 'next',
  }));
  const signal = new AbortController().signal;
  try {
    await expect(listTopics('http://127.0.0.1:9682', 'current', signal)).resolves.toEqual({
      items: ['arn:aws:sns:us-east-1:000000000000:topic'],
      next: 'next',
    });
    expect(send).toHaveBeenCalledExactlyOnceWith(expect.any(ListTopicsCommand), { abortSignal: signal });
    expect((send.mock.calls[0]?.[0] as ListTopicsCommand).input).toEqual({ NextToken: 'current' });
  } finally {
    send.mockRestore();
  }
});
