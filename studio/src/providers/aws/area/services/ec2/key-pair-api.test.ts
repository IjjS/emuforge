import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { engineEndpoint } from '../../../../../lib/aws/client-factory';
import { RequestError } from '../../../../../lib/aws/request';
import { createKeyPair, deleteKeyPair, importKeyPair, listKeyPairs } from './key-pair-api';

// The test plays the engine behind the page's `fetch`: its session route, and each request as it leaves the browser,
// answered in EC2's query protocol (form in, XML out) as the emulator answers.

const XMLNS = 'http://ec2.amazonaws.com/doc/2016-11-15/';

interface Answer {
  status: number;
  body: string;
}

interface Sent {
  action: string;
  params: URLSearchParams;
}

type Handler = (sent: Sent) => Answer | 'hold';

class FakeEngine {
  readonly sent: Sent[] = [];
  readonly handlers = new Map<string, Handler>();

  readonly fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const url = new URL(request.url);
    if (url.pathname === '/__emuforge/session') {
      return new Response(JSON.stringify({ token: 'emuforge-test-token-553' }), { status: 200 });
    }
    const params = new URLSearchParams(await request.text());
    const sent = { action: params.get('Action') ?? '', params };
    this.sent.push(sent);
    const answer = this.handlers.get(sent.action)?.(sent) ?? ok(sent.action, '');
    if (answer === 'hold') {
      return new Promise((_, reject) => {
        request.signal.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      });
    }
    return new Response(answer.body, { status: answer.status, headers: { 'content-type': 'text/xml' } });
  };

  on(action: string, handler: Handler) {
    this.handlers.set(action, handler);
  }

  of(action: string): Sent[] {
    return this.sent.filter((sent) => sent.action === action);
  }
}

function ok(action: string, body: string): Answer {
  return {
    status: 200,
    body: `<${action}Response xmlns="${XMLNS}"><requestId>r</requestId>${body}</${action}Response>`,
  };
}

function refused(code: string, message: string): Answer {
  return {
    status: 400,
    body: `<Response><Errors><Error><Code>${code}</Code><Message>${message}</Message></Error></Errors><RequestID>r</RequestID></Response>`,
  };
}

const notImplemented: Answer = { status: 501, body: '' };

let engine: FakeEngine;
let endpoint: string;
let nextPort = 9800;

beforeEach(() => {
  engine = new FakeEngine();
  vi.stubGlobal('fetch', engine.fetch);
  nextPort += 1;
  endpoint = engineEndpoint(nextPort);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const signal = () => new AbortController().signal;

async function failureOf(pending: Promise<unknown>) {
  const error: unknown = await pending.then(
    () => undefined,
    (rejection: unknown) => rejection,
  );
  expect(error).toBeInstanceOf(RequestError);
  return (error as RequestError).failure;
}

const FINGERPRINT = '1f:51:ae:28:bf:89:e9:d8:1f:25:5d:37:2d:7d:b8:ca:9f:f5:f1:6f';
const PRIVATE_KEY = '-----BEGIN RSA PRIVATE KEY-----\nMIIEow<b>x</b>\n-----END RSA PRIVATE KEY-----';
const PUBLIC_KEY = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOm4 dev@example';

describe('the key pairs', () => {
  it("one DescribeKeyPairs with no page; each one's name, ID, type, fingerprint and creation time, in order", async () => {
    engine.on('DescribeKeyPairs', () =>
      ok(
        'DescribeKeyPairs',
        `<keySet>
          <item><keyPairId>key-0a</keyPairId><keyType>rsa</keyType><tagSet/><keyName>dev key</keyName>
            <keyFingerprint>${FINGERPRINT}</keyFingerprint><createTime>2026-11-20T01:02:03.000Z</createTime></item>
          <item><keyPairId>key-0b</keyPairId><keyType>ed25519</keyType><keyName>b</keyName></item>
          <item><keyPairId>key-0c</keyPairId></item>
        </keySet>`,
      ),
    );
    expect(await listKeyPairs(endpoint, signal())).toEqual([
      {
        name: 'dev key',
        id: 'key-0a',
        type: 'rsa',
        fingerprint: FINGERPRINT,
        createdAt: new Date('2026-11-20T01:02:03.000Z'),
      },
      { name: 'b', id: 'key-0b', type: 'ed25519' },
    ]);
    const sent = engine.of('DescribeKeyPairs');
    expect(sent).toHaveLength(1);
    expect([...(sent[0]?.params.keys() ?? [])].sort()).toEqual(['Action', 'Version']);
  });

  it('an empty answer → none', async () => {
    engine.on('DescribeKeyPairs', () => ok('DescribeKeyPairs', '<keySet/>'));
    expect(await listKeyPairs(endpoint, signal())).toEqual([]);
  });
});

describe('create, import, delete', () => {
  it("create → KeyName, KeyType and KeyFormat; the answer's private key, fingerprint and ID", async () => {
    engine.on('CreateKeyPair', (sent) =>
      ok(
        'CreateKeyPair',
        `<keyName>${sent.params.get('KeyName') ?? ''}</keyName><keyFingerprint>${FINGERPRINT}</keyFingerprint>
         <keyMaterial>${PRIVATE_KEY.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</keyMaterial><keyPairId>key-0new</keyPairId>`,
      ),
    );
    expect(await createKeyPair(endpoint, { name: 'dev', type: 'rsa', format: 'pem' }, signal())).toEqual({
      name: 'dev',
      privateKey: PRIVATE_KEY,
      fingerprint: FINGERPRINT,
      id: 'key-0new',
    });
    await createKeyPair(endpoint, { name: 'ed', type: 'ed25519', format: 'ppk' }, signal());
    expect(
      engine
        .of('CreateKeyPair')
        .map((sent) => [sent.params.get('KeyName'), sent.params.get('KeyType'), sent.params.get('KeyFormat')]),
    ).toEqual([
      ['dev', 'rsa', 'pem'],
      ['ed', 'ed25519', 'ppk'],
    ]);
  });

  it('an answer without a private key → none, rather than an empty one', async () => {
    engine.on('CreateKeyPair', () =>
      ok('CreateKeyPair', `<keyName>dev</keyName><keyFingerprint>${FINGERPRINT}</keyFingerprint>`),
    );
    const created = await createKeyPair(endpoint, { name: 'dev', type: 'rsa', format: 'pem' }, signal());
    expect(created).toEqual({ name: 'dev', fingerprint: FINGERPRINT });
    expect('privateKey' in created).toBe(false);
  });

  it('import → KeyName and PublicKeyMaterial as the bytes of the text', async () => {
    engine.on('ImportKeyPair', () => ok('ImportKeyPair', '<keyName>imp</keyName><keyPairId>key-0imp</keyPairId>'));
    await importKeyPair(endpoint, 'imp', PUBLIC_KEY, signal());
    const sent = engine.of('ImportKeyPair')[0];
    expect(sent?.params.get('KeyName')).toBe('imp');
    const material = sent?.params.get('PublicKeyMaterial') ?? '';
    expect(new TextDecoder().decode(Uint8Array.from(atob(material), (c) => c.charCodeAt(0)))).toBe(PUBLIC_KEY);
  });

  it('delete → DeleteKeyPair with the name', async () => {
    engine.on('DeleteKeyPair', () => ok('DeleteKeyPair', '<return>true</return>'));
    await deleteKeyPair(endpoint, 'dev key', signal());
    expect(engine.of('DeleteKeyPair').map((sent) => sent.params.get('KeyName'))).toEqual(['dev key']);
  });

  it('InvalidKeyPair.Duplicate and InvalidKeyPair.Format → a failure with the code and message', async () => {
    engine.on('CreateKeyPair', () => refused('InvalidKeyPair.Duplicate', 'The keypair already exists'));
    expect(await failureOf(createKeyPair(endpoint, { name: 'dev', type: 'rsa', format: 'pem' }, signal()))).toEqual({
      kind: 'other',
      operation: 'CreateKeyPair',
      code: 'InvalidKeyPair.Duplicate',
      message: 'The keypair already exists',
    });
    engine.on('ImportKeyPair', () => refused('InvalidKeyPair.Format', 'Key is not in valid OpenSSH public key format'));
    expect(await failureOf(importKeyPair(endpoint, 'bad', 'not a key', signal()))).toEqual({
      kind: 'other',
      operation: 'ImportKeyPair',
      code: 'InvalidKeyPair.Format',
      message: 'Key is not in valid OpenSSH public key format',
    });
  });
});

describe('every call', () => {
  const calls: [string, (signal: AbortSignal) => Promise<unknown>][] = [
    ['DescribeKeyPairs', (at) => listKeyPairs(endpoint, at)],
    ['CreateKeyPair', (at) => createKeyPair(endpoint, { name: 'a', type: 'rsa', format: 'pem' }, at)],
    ['ImportKeyPair', (at) => importKeyPair(endpoint, 'a', PUBLIC_KEY, at)],
    ['DeleteKeyPair', (at) => deleteKeyPair(endpoint, 'a', at)],
  ];
  for (const [operation, call] of calls) {
    it(`${operation}: a 501 → "not implemented" with the operation's name`, async () => {
      engine.on(operation, () => notImplemented);
      expect(await failureOf(call(signal()))).toEqual({ kind: 'not-implemented', operation });
    });

    it(`${operation}: an aborted signal ends the request`, async () => {
      engine.on(operation, () => 'hold');
      const controller = new AbortController();
      const pending = call(controller.signal);
      await vi.waitFor(() => {
        expect(engine.of(operation)).toHaveLength(1);
      });
      const reason = new Error('left the page');
      controller.abort(reason);
      await expect(pending).rejects.toBe(reason);
    });
  }
});
