// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { engineEndpoint } from '../../../../../lib/aws/client-factory';
import { DEFINITION_CHOICE_KEYS, familyChoices, revisionChoices } from './definition-choices';

// The sources' readers against the engine behind `fetch`, ECS's JSON 1.1 as the emulator answers it.

interface Sent {
  operation: string;
  body: Record<string, unknown>;
}

let sent: Sent[];
let answer: (operation: string) => unknown;
let endpoint: string;
let nextPort = 9780;

beforeEach(() => {
  sent = [];
  answer = () => ({});
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    if (new URL(request.url).pathname === '/__emuforge/session') {
      return new Response(JSON.stringify({ token: 'emuforge-test-token-575' }), { status: 200 });
    }
    const target = request.headers.get('x-amz-target') ?? '';
    const operation = target.slice(target.indexOf('.') + 1);
    sent.push({ operation, body: JSON.parse(await request.text()) as Record<string, unknown> });
    return new Response(JSON.stringify(answer(operation)), {
      status: 200,
      headers: { 'content-type': 'application/x-amz-json-1.1' },
    });
  });
  nextPort += 1;
  endpoint = engineEndpoint(nextPort);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const signal = () => new AbortController().signal;
const DEF = (value: string) => `arn:aws:ecs:us-east-1:000000000000:task-definition/${value}`;

describe('family choices', () => {
  it('ListTaskDefinitionFamilies with status ACTIVE, maxResults 50 and the token; each option the name', async () => {
    answer = () => ({ families: ['api', 'web'], nextToken: 'tok-2' });
    const source = familyChoices(endpoint);
    const page = await source.read(endpoint, '', 'tok-1', signal());
    expect(sent).toEqual([
      { operation: 'ListTaskDefinitionFamilies', body: { status: 'ACTIVE', maxResults: 50, nextToken: 'tok-1' } },
    ]);
    expect(page).toEqual({ items: ['api', 'web'], next: 'tok-2' });
    expect(page.items.map(source.optionOf)).toEqual([
      { value: 'api', label: 'api' },
      { value: 'web', label: 'web' },
    ]);
  });
});

describe('revision choices', () => {
  it('ListTaskDefinitions with familyPrefix, ACTIVE, DESC; each value family:revision of the ARN, the newest first', async () => {
    answer = () => ({ taskDefinitionArns: [DEF('web:3'), DEF('web:1'), DEF('web-two:4')] });
    const source = revisionChoices(endpoint, 'web');
    expect(source.ready).toBe(true);
    const page = await source.read(endpoint, '', undefined, signal());
    expect(sent).toEqual([
      {
        operation: 'ListTaskDefinitions',
        body: { familyPrefix: 'web', status: 'ACTIVE', sort: 'DESC', maxResults: 50 },
      },
    ]);
    expect(page.items.map(source.optionOf)).toEqual([
      { value: 'web:3', label: 'web:3' },
      { value: 'web:1', label: 'web:1' },
    ]);
  });

  it('no family given → the source is not ready and nothing is asked', () => {
    expect(revisionChoices(endpoint, undefined).ready).toBe(false);
    expect(revisionChoices(endpoint, '').ready).toBe(false);
    expect(sent).toEqual([]);
  });
});

describe('the key roots', () => {
  it('one for the family choices, one for the revision choices, which every key of those reads starts with', () => {
    const starts = (key: readonly unknown[], root: readonly unknown[]) =>
      root.every((part, index) => key[index] === part);
    expect(starts(familyChoices(endpoint).key, DEFINITION_CHOICE_KEYS.families)).toBe(true);
    expect(starts(revisionChoices(endpoint, 'web').key, DEFINITION_CHOICE_KEYS.revisions)).toBe(true);
    expect(starts(revisionChoices(endpoint, undefined).key, DEFINITION_CHOICE_KEYS.revisions)).toBe(true);
    expect(revisionChoices(endpoint, 'web').key).not.toEqual(revisionChoices(endpoint, 'api').key);
    expect(starts(DEFINITION_CHOICE_KEYS.revisions, DEFINITION_CHOICE_KEYS.families)).toBe(false);
    expect(starts(DEFINITION_CHOICE_KEYS.families, DEFINITION_CHOICE_KEYS.revisions)).toBe(false);
  });
});
