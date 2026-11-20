import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { engineEndpoint } from '../../../../../lib/aws/client-factory';
import { attachVolume, createVolume, deleteVolume, detachVolume, getVolume, listVolumes } from './volume-api';

const attachment =
  '<attachmentSet><item><instanceId>i-1</instanceId><device>/dev/sdf</device><status>attached</status></item></attachmentSet>';
const volume = (id: string, state: string, attachments = '') =>
  `<item><volumeId>${id}</volumeId><size>8</size><volumeType>gp2</volumeType><availabilityZone>us-east-1a</availabilityZone><status>${state}</status>${attachments}</item>`;
const volumes = (items: string) => `<volumeSet>${items}</volumeSet>`;
const target = { instanceId: 'i-1', device: '/dev/sdf' };

const sent: Record<string, string>[] = [];
const answers: { status: number; body: string }[] = [];
const signal = new AbortController().signal;
let port = 9750;
let endpoint: string;

function answer(action: string, body: string) {
  answers.push({
    status: 200,
    body: `<${action}Response xmlns="http://ec2.amazonaws.com/doc/2016-11-15/">${body}</${action}Response>`,
  });
}

beforeEach(() => {
  sent.length = 0;
  answers.length = 0;
  endpoint = engineEndpoint(++port);
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    if (new URL(request.url).pathname === '/__emuforge/session') {
      return Response.json({ token: 'test-token' });
    }
    sent.push(Object.fromEntries(new URLSearchParams(await request.text())));
    const reply = answers.shift();
    if (reply === undefined) throw new Error('Unexpected request');
    return new Response(reply.body, { status: reply.status, headers: { 'content-type': 'text/xml' } });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('volume requests', () => {
  it('uses the returned token with the page size and preserves volume fields on both pages', async () => {
    answer('DescribeVolumes', volumes(volume('vol-1', 'available')) + '<nextToken>page-two</nextToken>');
    answer('DescribeVolumes', volumes(volume('vol-2', 'creating')));
    const first = await listVolumes(endpoint, undefined, signal);
    const second = await listVolumes(endpoint, first.next, signal);
    expect(sent).toEqual([
      { Action: 'DescribeVolumes', Version: '2016-11-15', MaxResults: '25' },
      { Action: 'DescribeVolumes', Version: '2016-11-15', MaxResults: '25', NextToken: 'page-two' },
    ]);
    const shared = { size: 8, type: 'gp2', zone: 'us-east-1a', attachments: [] };
    expect(first).toEqual({ items: [{ ...shared, id: 'vol-1', state: 'available' }], next: 'page-two' });
    expect(second).toEqual({ items: [{ ...shared, id: 'vol-2', state: 'creating' }] });
  });

  it('filters by exactly one ID and distinguishes attached, unattached and missing volumes', async () => {
    answer('DescribeVolumes', volumes(volume('vol-1', 'in-use', attachment)));
    answer('DescribeVolumes', volumes(volume('vol-1', 'available')));
    answer('DescribeVolumes', volumes(''));
    await expect(getVolume(endpoint, 'vol-1', signal)).resolves.toMatchObject({
      found: true,
      volume: { id: 'vol-1', attachments: [{ ...target, state: 'attached' }] },
    });
    await expect(getVolume(endpoint, 'vol-1', signal)).resolves.toMatchObject({
      found: true,
      volume: { id: 'vol-1', attachments: [] },
    });
    await expect(getVolume(endpoint, 'vol-1', signal)).resolves.toEqual({ found: false });
    expect(sent).toEqual(
      Array.from({ length: 3 }, () => ({
        Action: 'DescribeVolumes',
        Version: '2016-11-15',
        'Filter.1.Name': 'volume-id',
        'Filter.1.Value.1': 'vol-1',
      })),
    );
  });

  it('creates with only size and zone, and returns the new ID', async () => {
    answer('CreateVolume', '<volumeId>vol-new</volumeId>');
    await expect(createVolume(endpoint, { zone: 'us-east-1a', size: 8 }, signal)).resolves.toBe('vol-new');
    expect(sent).toEqual([
      { Action: 'CreateVolume', Version: '2016-11-15', AvailabilityZone: 'us-east-1a', Size: '8' },
    ]);
  });

  it('attaches the chosen volume and instance at the named device', async () => {
    answer('AttachVolume', '');
    await attachVolume(endpoint, 'vol-1', target, signal);
    expect(sent).toEqual([
      {
        Action: 'AttachVolume',
        Version: '2016-11-15',
        VolumeId: 'vol-1',
        InstanceId: 'i-1',
        Device: '/dev/sdf',
      },
    ]);
  });

  it('detaches the chosen attachment without force', async () => {
    answer('DetachVolume', '');
    await detachVolume(endpoint, 'vol-1', target, signal);
    expect(sent).toEqual([
      {
        Action: 'DetachVolume',
        Version: '2016-11-15',
        VolumeId: 'vol-1',
        InstanceId: 'i-1',
        Device: '/dev/sdf',
      },
    ]);
  });

  it('deletes only the named volume', async () => {
    answer('DeleteVolume', '<return>true</return>');
    await deleteVolume(endpoint, 'vol-1', signal);
    expect(sent).toEqual([{ Action: 'DeleteVolume', Version: '2016-11-15', VolumeId: 'vol-1' }]);
  });

  it('preserves the refusal and the HTTP 501 classification', async () => {
    answers.push(
      {
        status: 400,
        body: '<Response><Errors><Error><Code>VolumeInUse</Code><Message>The volume is attached.</Message></Error></Errors></Response>',
      },
      { status: 501, body: '' },
    );
    await expect(deleteVolume(endpoint, 'vol-1', signal)).rejects.toMatchObject({
      failure: { kind: 'other', operation: 'DeleteVolume', code: 'VolumeInUse', message: 'The volume is attached.' },
    });
    await expect(attachVolume(endpoint, 'vol-1', target, signal)).rejects.toMatchObject({
      failure: { kind: 'not-implemented', operation: 'AttachVolume' },
    });
  });
});
