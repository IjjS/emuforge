import { SNSClient } from '@aws-sdk/client-sns';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openPageAt } from '../test/home-test-kit';

// `loadConfig` reads `/config.json` once per page; each case loads a fresh module, so each is a fresh page.
async function load(answer: () => Promise<Response>) {
  const fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    void input;
    void init;
    return answer();
  });
  vi.stubGlobal('fetch', fetch);
  const config = await import('./config');
  return { config: await config.loadConfig(), fetch, module: config };
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('loadConfig: the answer of /config.json', () => {
  it('{"enginePort":8400,"enginePath":"/__engine"}: enginePort 8400 and enginePath /__engine', async () => {
    const { config, fetch } = await load(() =>
      Promise.resolve(Response.json({ enginePort: 8400, enginePath: '/__engine' })),
    );

    expect(config).toEqual({ enginePort: 8400, enginePath: '/__engine' });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0]?.[0])).toBe('/config.json');
  });

  it('{"enginePort":8400}: enginePath is undefined', async () => {
    const { config } = await load(() => Promise.resolve(Response.json({ enginePort: 8400 })));

    expect(config).toEqual({ enginePort: 8400, enginePath: undefined });
  });

  it.each([
    ['a number', 7],
    ['empty', ''],
    ['without a leading slash', '__engine'],
    ['the root', '/'],
    ['a network path', '//evil.test'],
    ['a dot segment', '/a/../b'],
    ['a query', '/a?b'],
    ['a fragment', '/a#b'],
    ['a URL', 'http://evil.test/x'],
    ['a space', '/a b'],
  ])('an enginePath that is %s (%j): enginePath is undefined, the port kept', async (_what, enginePath) => {
    const { config } = await load(() => Promise.resolve(Response.json({ enginePort: 8400, enginePath })));

    expect(config).toEqual({ enginePort: 8400, enginePath: undefined });
  });

  it.each([
    ['a 404', () => Promise.resolve(new Response('not found', { status: 404 }))],
    ['not JSON', () => Promise.resolve(new Response('<!doctype html><html></html>', { status: 200 }))],
    ['a failed request', () => Promise.reject(new TypeError('Failed to fetch'))],
  ])('%s: the default engine port and no enginePath', async (_what, answer) => {
    const { config, module } = await load(answer);

    expect(config).toEqual({ enginePort: module.DEFAULT_ENGINE_PORT, enginePath: undefined });
    expect(module.DEFAULT_ENGINE_PORT).toBe(8297);
  });
});

describe('engineBase', () => {
  it('with an enginePath, on the page origin https://name.test:8296: https://name.test:8296/__engine', async () => {
    const { engineBase } = await import('./config');

    expect(engineBase({ enginePort: 8400, enginePath: '/__engine' }, 'https://name.test:8296')).toBe(
      'https://name.test:8296/__engine',
    );
  });

  it('with none: http://127.0.0.1:<enginePort>, whatever the page origin', async () => {
    const { engineBase } = await import('./config');

    expect(engineBase({ enginePort: 8400, enginePath: undefined }, 'https://name.test:8296')).toBe(
      'http://127.0.0.1:8400',
    );
  });
});

describe('loadConfig and the AWS client factory', () => {
  let restore: () => void;

  beforeEach(() => {
    restore = openPageAt('https://name.test:8296/aws');
  });

  afterEach(() => {
    restore();
  });

  it('with enginePath /__engine, the factory takes <page origin>/__engine as the endpoint', async () => {
    const { config, module } = await load(() =>
      Promise.resolve(Response.json({ enginePort: 8400, enginePath: '/__engine' })),
    );
    const factory = await import('../lib/aws/client-factory');
    const endpoint = module.engineBase(config, window.location.origin);

    expect(endpoint).toBe('https://name.test:8296/__engine');
    expect(factory.createAwsClient(SNSClient, { endpoint })).toBeInstanceOf(SNSClient);
  });

  it('without enginePath, the factory refuses <page origin>/__engine', async () => {
    await load(() => Promise.resolve(Response.json({ enginePort: 8400 })));
    const factory = await import('../lib/aws/client-factory');

    expect(() => factory.createAwsClient(SNSClient, { endpoint: 'https://name.test:8296/__engine' })).toThrow(
      factory.EndpointRefusedError,
    );
  });
});
