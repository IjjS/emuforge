import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../lib/aws/request';
import { sendEc2 } from '../lib/ec2-client';
import { useAvailabilityZones } from './use-availability-zones';

vi.mock('../lib/ec2-client', async (original) => ({
  ...(await original<typeof import('../lib/ec2-client')>()),
  sendEc2: vi.fn(),
}));

const ENDPOINT = 'http://127.0.0.1:8398';
const answer = {
  AvailabilityZones: [
    { ZoneName: 'us-east-1b', ZoneId: 'use1-az2' },
    { ZoneName: 'us-east-1a', ZoneId: 'use1-az1' },
  ],
};

beforeEach(() => vi.mocked(sendEc2).mockReset());

function readZones() {
  const client = new QueryClient();
  return renderHook(() => useAvailabilityZones(ENDPOINT), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
}

it('returns the names in response order and the corresponding zone ids', async () => {
  vi.mocked(sendEc2).mockResolvedValue(answer);
  const { result } = readZones();
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.zones).toEqual(['us-east-1b', 'us-east-1a']);
  expect(result.current.zoneDetails).toEqual([
    { name: 'us-east-1b', id: 'use1-az2' },
    { name: 'us-east-1a', id: 'use1-az1' },
  ]);
  expect(sendEc2).toHaveBeenCalledTimes(1);
});

it('reports a failed read without zones and can retry', async () => {
  const failure = { kind: 'engine-did-not-answer', operation: 'DescribeAvailabilityZones' } as const;
  vi.mocked(sendEc2).mockRejectedValueOnce(new RequestError(failure)).mockResolvedValueOnce(answer);
  const { result } = readZones();
  await waitFor(() => expect(result.current.failure).toEqual(failure));
  expect(result.current.zones).toBeUndefined();
  expect(result.current.zoneDetails).toBeUndefined();

  act(() => result.current.retry());
  await waitFor(() => expect(result.current.zones).toEqual(['us-east-1b', 'us-east-1a']));
  expect(result.current.failure).toBeUndefined();
  expect(sendEc2).toHaveBeenCalledTimes(2);
});
