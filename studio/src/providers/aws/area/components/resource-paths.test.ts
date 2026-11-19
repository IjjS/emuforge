import { describe, expect, it } from 'vitest';

import { CREATE_FUNCTION_PATH, CREATE_QUEUE_PATH, functionPath, queuePath } from './resource-paths';

describe('resource paths', () => {
  it("builds a queue's and a function's page from its name, percent-encoded once", () => {
    expect(queuePath('orders')).toBe('/aws/sqs/queues/queue/orders');
    expect(functionPath('printer')).toBe('/aws/lambda/functions/function/printer');
    expect(queuePath('a b%')).toBe('/aws/sqs/queues/queue/a%20b%25');
    expect(functionPath('x/y')).toBe('/aws/lambda/functions/function/x%2Fy');
  });

  it('holds the two create forms', () => {
    expect(CREATE_QUEUE_PATH).toBe('/aws/sqs/queues/create');
    expect(CREATE_FUNCTION_PATH).toBe('/aws/lambda/functions/create');
  });
});
