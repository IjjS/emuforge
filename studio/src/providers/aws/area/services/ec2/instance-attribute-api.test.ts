import { expect, it, vi } from 'vitest';

import { engineEndpoint } from '../../../../../lib/aws/client-factory';
import { modifyInstanceAttribute, type InstanceAttributeChange } from './instance-attribute-api';

it.each<{ change: InstanceAttributeChange; fields: Record<string, string> }>([
  { change: { kind: 'type', type: 't3.small' }, fields: { 'InstanceType.Value': 't3.small' } },
  { change: { kind: 'groups', groupIds: ['sg-1', 'sg-2'] }, fields: { 'GroupId.1': 'sg-1', 'GroupId.2': 'sg-2' } },
  { change: { kind: 'protection', enabled: false }, fields: { 'DisableApiTermination.Value': 'false' } },
])('sends just the requested $change.kind attribute for the instance', async ({ change, fields }) => {
  const sent: Record<string, string>[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    if (new URL(request.url).pathname === '/__emuforge/session') {
      return Response.json({ token: 'emuforge-test-token-561' });
    }
    sent.push(Object.fromEntries(new URLSearchParams(await request.text())));
    return new Response(
      '<ModifyInstanceAttributeResponse xmlns="http://ec2.amazonaws.com/doc/2016-11-15/"><return>true</return></ModifyInstanceAttributeResponse>',
      { headers: { 'content-type': 'text/xml' } },
    );
  });
  try {
    await modifyInstanceAttribute(engineEndpoint(9761), 'i-external', change, new AbortController().signal);
    expect(sent).toEqual([
      { Action: 'ModifyInstanceAttribute', Version: '2016-11-15', InstanceId: 'i-external', ...fields },
    ]);
  } finally {
    vi.unstubAllGlobals();
  }
});
