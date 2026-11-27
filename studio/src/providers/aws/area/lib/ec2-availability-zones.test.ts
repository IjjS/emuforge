import { expect, it, vi } from 'vitest';

import { listAvailabilityZoneDetails, listAvailabilityZones } from './ec2-availability-zones';
import { sendEc2 } from './ec2-client';

vi.mock('./ec2-client', async (original) => ({
  ...(await original<typeof import('./ec2-client')>()),
  sendEc2: vi.fn(),
}));

it('returns named availability zones in response order for the subnet and volume forms', async () => {
  vi.mocked(sendEc2).mockResolvedValue({
    AvailabilityZones: [
      { ZoneName: 'us-east-1b', ZoneId: 'use1-az2' },
      {},
      { ZoneName: '' },
      { ZoneName: 'us-east-1a', ZoneId: 'use1-az1' },
    ],
  });

  const endpoint = 'http://127.0.0.1:8311';
  const { signal } = new AbortController();
  expect(await listAvailabilityZones(endpoint, signal)).toEqual(['us-east-1b', 'us-east-1a']);
  expect(sendEc2).toHaveBeenCalledExactlyOnceWith(endpoint, 'DescribeAvailabilityZones', expect.any(Function), signal);
  expect(await listAvailabilityZoneDetails(endpoint, signal)).toEqual([
    { name: 'us-east-1b', id: 'use1-az2' },
    { name: 'us-east-1a', id: 'use1-az1' },
  ]);
});
