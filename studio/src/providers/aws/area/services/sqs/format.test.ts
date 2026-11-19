import { describe, expect, it } from 'vitest';

import {
  base64ToBytes,
  bodyPreview,
  bytesToBase64,
  formattedJson,
  maxReceivesMessage,
  nameFromArn,
  queueNameFromUrl,
  queueNameMessage,
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

describe('"Create queue": a name (issue 489)', () => {
  const chars = (count: number) => 'a'.repeat(count);

  it('orders, a-b_C9 and 80 characters as Standard: no message', () => {
    expect(queueNameMessage('orders', 'standard')).toBeUndefined();
    expect(queueNameMessage('a-b_C9', 'standard')).toBeUndefined();
    expect(queueNameMessage(chars(80), 'standard')).toBeUndefined();
  });

  it('empty: "Enter a name."', () => {
    expect(queueNameMessage('', 'standard')).toBe('Enter a name.');
    expect(queueNameMessage('', 'fifo')).toBe('Enter a name.');
  });

  it('"p bad!": only letters, numbers, hyphens and underscores', () => {
    expect(queueNameMessage('p bad!', 'standard')).toBe('Use only letters, numbers, hyphens (-) and underscores (_).');
    expect(queueNameMessage('p bad!', 'fifo')).toBe('Use only letters, numbers, hyphens (-) and underscores (_).');
  });

  it('81 characters, and 76 characters + .fifo as FIFO: "Use at most 80 characters."', () => {
    expect(queueNameMessage(chars(81), 'standard')).toBe('Use at most 80 characters.');
    expect(queueNameMessage(`${chars(76)}.fifo`, 'fifo')).toBe('Use at most 80 characters.');
  });

  it('75 characters + .fifo as FIFO: no message', () => {
    expect(queueNameMessage(`${chars(75)}.fifo`, 'fifo')).toBeUndefined();
  });

  it('orders as FIFO: it must end with .fifo', () => {
    expect(queueNameMessage('orders', 'fifo')).toBe("A FIFO queue's name must end with .fifo.");
  });

  it('orders.fifo as Standard: only a FIFO queue’s name ends with .fifo', () => {
    expect(queueNameMessage('orders.fifo', 'standard')).toBe(
      "Only a FIFO queue's name ends with .fifo. Choose FIFO or change the name.",
    );
  });
});

describe('"Create queue": maximum receives (issue 489)', () => {
  it('1 and 1000: no message', () => {
    expect(maxReceivesMessage('1')).toBeUndefined();
    expect(maxReceivesMessage('1000')).toBeUndefined();
  });

  it('0, 1001, 2.5, empty and abc: "Enter a whole number from 1 to 1000."', () => {
    for (const text of ['0', '1001', '2.5', '', 'abc']) {
      expect(maxReceivesMessage(text), text).toBe('Enter a whole number from 1 to 1000.');
    }
  });
});
