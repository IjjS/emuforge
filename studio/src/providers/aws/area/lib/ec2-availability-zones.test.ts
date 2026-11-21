import { expect, it, vi } from 'vitest';

import { listAvailabilityZones } from './ec2-availability-zones';
import { sendEc2 } from './ec2-client';

vi.mock('./ec2-client', async (original) => ({
  ...(await original<typeof import('./ec2-client')>()),
  sendEc2: vi.fn(),
}));

it('returns named availability zones in response order for the subnet and volume forms', async () => {
  vi.mocked(sendEc2).mockResolvedValue({
    AvailabilityZones: [{ ZoneName: 'us-east-1b' }, {}, { ZoneName: '' }, { ZoneName: 'us-east-1a' }],
  });

  const endpoint = 'http://127.0.0.1:8311';
  const { signal } = new AbortController();
  expect(await listAvailabilityZones(endpoint, signal)).toEqual(['us-east-1b', 'us-east-1a']);
  expect(sendEc2).toHaveBeenCalledExactlyOnceWith(endpoint, 'DescribeAvailabilityZones', expect.any(Function), signal);
});
