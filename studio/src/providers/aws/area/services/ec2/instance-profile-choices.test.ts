import { afterEach, expect, it, vi } from 'vitest';

import { engineEndpoint } from '../../../../../lib/aws/client-factory';
import { instanceProfileChoices } from './instance-profile-choices';

afterEach(() => vi.unstubAllGlobals());

it('reads instance profiles a page at a time by marker and describes their role counts', async () => {
  const endpoint = engineEndpoint(9830);
  const sent: URLSearchParams[] = [];
  const profile = (name: string, roles: string) => `
    <member><InstanceProfileName>${name}</InstanceProfileName><Arn>arn:aws:iam::123456789012:instance-profile/${name}</Arn>
    <Roles>${roles}</Roles></member>`;
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    if (new URL(request.url).pathname === '/__emuforge/session') {
      return Response.json({ token: 'test-token' });
    }
    const params = new URLSearchParams(await request.text());
    sent.push(params);
    const second = params.has('Marker');
    return new Response(
      `<ListInstanceProfilesResponse xmlns="https://iam.amazonaws.com/doc/2010-05-08/">
        <ListInstanceProfilesResult><InstanceProfiles>
        ${second ? profile('idle', '') : profile('web', '<member><RoleName>app</RoleName></member><member><RoleName>log</RoleName></member>')}
        </InstanceProfiles>${second ? '<IsTruncated>false</IsTruncated>' : '<IsTruncated>true</IsTruncated><Marker>page-2</Marker>'}
        </ListInstanceProfilesResult></ListInstanceProfilesResponse>`,
      { headers: { 'content-type': 'text/xml' } },
    );
  });
  const source = instanceProfileChoices(endpoint);
  const { signal } = new AbortController();
  const first = await source.read(endpoint, '', undefined, signal);
  expect(first).toEqual({
    items: [{ name: 'web', arn: 'arn:aws:iam::123456789012:instance-profile/web', roleCount: 2 }],
    next: 'page-2',
  });
  expect(await source.read(endpoint, '', first.next, signal)).toEqual({
    items: [{ name: 'idle', arn: 'arn:aws:iam::123456789012:instance-profile/idle', roleCount: 0 }],
  });
  expect(sent.map((params) => [params.get('Action'), params.get('Marker')])).toEqual([
    ['ListInstanceProfiles', null],
    ['ListInstanceProfiles', 'page-2'],
  ]);
  expect(first.items.map(source.optionOf)).toEqual([{ value: 'web', label: 'web', description: '2 roles' }]);
  expect(source.readAgainOnOpen).toBe(true);
});
