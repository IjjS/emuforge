import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { engineEndpoint } from '../../../../../lib/aws/client-factory';
import { listEventSources } from './event-source-api';

const path = '/2015-03-31/event-source-mappings';
const sourceArn = 'arn:aws:sqs:us-east-1:000000000000:orders';
const streamArn = 'arn:aws:kinesis:us-east-1:000000000000:stream/orders';
const calls: URL[] = [];
let answer: (url: URL) => Response;

beforeEach(() => {
  calls.length = 0;
  answer = (url) =>
    url.searchParams.has('Marker')
      ? Response.json({
          EventSourceMappings: [
            {
              UUID: 'second',
              EventSourceArn: streamArn,
              State: 'Enabled',
              LastProcessingResult: 'No records processed',
            },
          ],
        })
      : Response.json({
          EventSourceMappings: [{ UUID: 'first', EventSourceArn: sourceArn, State: 'Disabled' }],
          NextMarker: 'next/page+2',
        });
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    if (url.pathname === '/__emuforge/session') {
      return Response.json({ token: 'test-session' });
    }
    expect(request.method).toBe('GET');
    expect(url.pathname).toBe(path);
    calls.push(url);
    return answer(url);
  });
});

afterEach(() => vi.unstubAllGlobals());

it('A1: reads each marker with the same function filter and preserves the mapping fields', async () => {
  const items = await listEventSources(engineEndpoint(9560), 'orders', new AbortController().signal);
  expect(calls.map(({ searchParams }) => [searchParams.get('FunctionName'), searchParams.get('Marker')])).toEqual([
    ['orders', null],
    ['orders', 'next/page+2'],
  ]);
  expect(items).toEqual([
    { uuid: 'first', sourceArn, state: 'Disabled', lastProcessingResult: undefined },
    { uuid: 'second', sourceArn: streamArn, state: 'Enabled', lastProcessingResult: 'No records processed' },
  ]);
});

it('A2: rejects the whole list with the refusal from a later page', async () => {
  const firstPage = answer;
  answer = (url) =>
    url.searchParams.has('Marker')
      ? Response.json(
          { message: 'The next page was refused.' },
          { status: 400, headers: { 'x-amzn-errortype': 'InvalidParameterValueException' } },
        )
      : firstPage(url);
  await expect(listEventSources(engineEndpoint(9561), 'orders', new AbortController().signal)).rejects.toMatchObject({
    failure: {
      kind: 'other',
      operation: 'ListEventSourceMappings',
      code: 'InvalidParameterValueException',
      message: 'The next page was refused.',
    },
  });
  expect(calls).toHaveLength(2);
});
