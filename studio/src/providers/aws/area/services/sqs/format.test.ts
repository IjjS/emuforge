import { describe, expect, it } from 'vitest';

import {
  base64ToBytes,
  bodyPreview,
  bytesToBase64,
  formattedJson,
  nameFromArn,
  queueNameFromUrl,
  queuePath,
  queueSettings,
  queueType,
} from './format';

describe('names', () => {
  it('takes a queue URL’s name after its last "/"', () => {
    expect(queueNameFromUrl('https://sqs.us-east-1.amazonaws.com/000000000000/orders')).toBe('orders');
    expect(queueNameFromUrl('https://sqs.us-east-1.amazonaws.com/000000000000/jobs.fifo')).toBe('jobs.fifo');
  });

  it('takes an ARN’s name after its last ":"', () => {
    expect(nameFromArn('arn:aws:sqs:us-east-1:000000000000:orders-dlq')).toBe('orders-dlq');
  });

  it('writes a queue’s route with its name as one segment', () => {
    expect(queuePath('jobs.fifo')).toBe('/aws/sqs/queues/queue/jobs.fifo');
    expect(queuePath('a/b')).toBe('/aws/sqs/queues/queue/a%2Fb');
  });
});

describe('attributes', () => {
  it('give the type, the three counts and the redrive policy', () => {
    const settings = queueSettings({
      FifoQueue: 'true',
      ContentBasedDeduplication: 'true',
      ApproximateNumberOfMessages: '3',
      ApproximateNumberOfMessagesNotVisible: '1',
      ApproximateNumberOfMessagesDelayed: '0',
      QueueArn: 'arn:aws:sqs:us-east-1:000000000000:jobs.fifo',
      MaximumMessageSize: '1024',
      RedrivePolicy: '{"deadLetterTargetArn":"arn:aws:sqs:us-east-1:000000000000:jobs-dlq.fifo","maxReceiveCount":2}',
    });
    expect(settings).toEqual({
      fifo: true,
      contentBasedDeduplication: true,
      available: 3,
      inFlight: 1,
      delayed: 0,
      arn: 'arn:aws:sqs:us-east-1:000000000000:jobs.fifo',
      maximumMessageSize: 1024,
      redrivePolicy: {
        deadLetterTargetArn: 'arn:aws:sqs:us-east-1:000000000000:jobs-dlq.fifo',
        deadLetterQueue: 'jobs-dlq.fifo',
        maxReceiveCount: 2,
      },
    });
    expect(queueType(settings)).toBe('FIFO');
  });

  it('give a standard queue without counts it lacks and without a policy', () => {
    const settings = queueSettings({ ApproximateNumberOfMessages: '12' });
    expect(settings).toEqual({ fifo: false, contentBasedDeduplication: false, available: 12 });
    expect(queueType(settings)).toBe('Standard');
  });

  it('read a maxReceiveCount written as text', () => {
    expect(
      queueSettings({ RedrivePolicy: '{"deadLetterTargetArn":"arn:aws:sqs:r:1:d","maxReceiveCount":"5"}' })
        .redrivePolicy,
    ).toEqual({ deadLetterTargetArn: 'arn:aws:sqs:r:1:d', deadLetterQueue: 'd', maxReceiveCount: 5 });
  });

  it.each(['not json', '', '[]', 'null', '{"maxReceiveCount":2}'])('give no policy for RedrivePolicy %j', (text) => {
    expect(queueSettings({ RedrivePolicy: text }).redrivePolicy).toBeUndefined();
  });
});

describe('a body', () => {
  it('of several lines gives its first line and that more follows', () => {
    expect(bodyPreview('first\nsecond\nthird')).toEqual({ first: 'first', more: true });
    expect(bodyPreview('first\r\nsecond')).toEqual({ first: 'first', more: true });
    expect(bodyPreview('one line')).toEqual({ first: 'one line', more: false });
  });

  it('that is JSON can be formatted; one that is not cannot', () => {
    expect(formattedJson('{"orderId":1}')).toBe('{\n  "orderId": 1\n}');
    expect(formattedJson('{"orderId":')).toBeUndefined();
    expect(formattedJson('hello')).toBeUndefined();
  });
});

describe('Base64', () => {
  it('writes bytes as Base64 text and reads it back', () => {
    const hi = new TextEncoder().encode('hi');
    expect(bytesToBase64(hi)).toBe('aGk=');
    expect([...(base64ToBytes('aGk=') ?? [])]).toEqual([...hi]);
    expect(bytesToBase64(new Uint8Array([0, 255, 128]))).toBe('AP+A');
    expect([...(base64ToBytes('AP+A') ?? [])]).toEqual([0, 255, 128]);
  });

  it.each(['aGk', 'a*k=', 'aGk=x', '====', ''])('refuses %j, which is not Base64', (text) => {
    expect(base64ToBytes(text)).toBeUndefined();
  });
});
