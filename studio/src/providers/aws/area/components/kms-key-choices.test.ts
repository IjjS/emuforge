import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { engineEndpoint } from '../../../../lib/aws/client-factory';
import { kmsKeyChoices } from './kms-key-choices';

const arn = (id: string) => `arn:aws:kms:us-east-1:000000000000:key/${id}`;
const alias = (id: string, name: string) => ({ TargetKeyId: id, AliasName: `alias/${name}` });
const key = (KeyId: string) => ({ KeyId, KeyArn: arn(KeyId) });

interface Sent {
  operation: string;
  body: { Marker?: string; KeyId?: string };
}

type Answer = (body: Sent['body']) => object | Response;
let sent: Sent[];
let handlers: Record<string, Answer>;
let endpoint: string;
let port = 9940;

beforeEach(() => {
  sent = [];
  endpoint = engineEndpoint(++port);
  handlers = {
    ListKeys: () => ({ Keys: [key('key-1')] }),
    ListAliases: () => ({ Aliases: [] }),
    DescribeKey: ({ KeyId = 'key-1' }) => ({ KeyMetadata: { KeyId, Arn: arn(KeyId), KeyState: 'Enabled' } }),
  };
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    if (new URL(request.url).pathname === '/__emuforge/session') {
      return Response.json({ token: 'emuforge-test-token-kms-651' });
    }

    const body = (await request.json()) as Sent['body'];
    const operation = request.headers.get('x-amz-target')?.split('.').at(-1) ?? '';
    sent.push({ operation, body });
    const answer = handlers[operation]?.(body);
    return answer instanceof Response ? answer : Response.json(answer ?? {});
  });
});

afterEach(() => vi.unstubAllGlobals());

const read = () => kmsKeyChoices(endpoint).read(endpoint, '', undefined, new AbortController().signal);

it('offers only Enabled keys and carries their ARN', async () => {
  handlers.ListKeys = () => ({ Keys: [key('enabled'), key('disabled'), key('pending')] });
  handlers.DescribeKey = ({ KeyId = '' }) => ({
    KeyMetadata: {
      Arn: arn(KeyId),
      KeyState: { enabled: 'Enabled', disabled: 'Disabled', pending: 'PendingDeletion' }[KeyId],
    },
  });

  expect((await read()).items).toEqual([{ id: 'enabled', arn: arn('enabled'), aliases: [] }]);
  expect(kmsKeyChoices(endpoint).readAgainOnOpen).toBe(true);
});

it('skips a page with only disabled keys, keeps the next marker and reuses the alias table', async () => {
  handlers.ListKeys = ({ Marker }) => {
    if (Marker === 'third') return { Keys: [key('key-3')] };
    if (Marker === 'second') return { Keys: [key('key-2')], Truncated: true, NextMarker: 'third' };
    return { Keys: [key('disabled')], Truncated: true, NextMarker: 'second' };
  };
  handlers.DescribeKey = ({ KeyId = '' }) => ({
    KeyMetadata: { Arn: arn(KeyId), KeyState: KeyId === 'disabled' ? 'Disabled' : 'Enabled' },
  });
  handlers.ListAliases = () => ({ Aliases: [alias('key-3', 'third-key')] });

  const page = await read();
  expect(page.items.map(({ id }) => id)).toEqual(['key-2']);
  expect(page.next).toBe('third');
  expect(sent.filter(({ operation }) => operation === 'ListKeys').map(({ body }) => body)).toEqual([
    {},
    { Marker: 'second' },
  ]);

  const next = await page.readNext?.(new AbortController().signal);
  expect(next).toEqual({ items: [{ id: 'key-3', arn: arn('key-3'), aliases: ['alias/third-key'] }] });
  expect(sent.filter(({ operation }) => operation === 'ListAliases')).toEqual([{ operation: 'ListAliases', body: {} }]);
});

it('returns an empty page with no marker when the last page has no enabled key', async () => {
  handlers.DescribeKey = () => ({ KeyMetadata: { Arn: arn('key-1'), KeyState: 'Disabled' } });
  expect(await read()).toEqual({ items: [] });
});

it('describes each enabled key with its aliases, usage, spec, description and id', async () => {
  handlers.ListKeys = () => ({ Keys: [key('key-1'), key('key-2')] });
  handlers.ListAliases = ({ Marker }) =>
    Marker === undefined
      ? { Aliases: [alias('key-1', 'a')], Truncated: true, NextMarker: 'alias-next' }
      : { Aliases: [alias('key-1', 'b')] };
  handlers.DescribeKey = ({ KeyId = '' }) => ({
    KeyMetadata: {
      Arn: arn(KeyId),
      KeyState: 'Enabled',
      ...(KeyId === 'key-1'
        ? { KeyUsage: 'ENCRYPT_DECRYPT', KeySpec: 'SYMMETRIC_DEFAULT', Description: 'For volumes' }
        : {}),
    },
  });

  const { optionOf } = kmsKeyChoices(endpoint);
  expect((await read()).items.map(optionOf)).toEqual([
    {
      value: arn('key-1'),
      label: 'alias/a',
      description: 'alias/a · alias/b · ENCRYPT_DECRYPT · SYMMETRIC_DEFAULT · For volumes',
      tags: ['key-1'],
    },
    { value: arn('key-2'), label: 'key-2', tags: ['key-2'] },
  ]);
  expect(sent.filter(({ operation }) => operation === 'ListAliases').map(({ body }) => body)).toEqual([
    {},
    { Marker: 'alias-next' },
  ]);
});

it('fails the page with DescribeKey when the key read is refused', async () => {
  handlers.DescribeKey = () => Response.json({ __type: 'AccessDeniedException', message: 'denied' }, { status: 400 });
  await expect(read()).rejects.toMatchObject({ failure: { kind: 'access-denied', operation: 'DescribeKey' } });
});

it.each(['ListKeys', 'DescribeKey', 'ListAliases'])('names %s when the read answers 501', async (operation) => {
  handlers[operation] = () => new Response(null, { status: 501 });
  await expect(read()).rejects.toMatchObject({ failure: { kind: 'not-implemented', operation } });
});
