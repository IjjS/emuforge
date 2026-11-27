import { useQuery } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

import type { RequestFailure } from '../../../../lib/aws/request';
import {
  DESCRIBE_AVAILABILITY_ZONES,
  listAvailabilityZones,
  type AvailabilityZone,
} from '../lib/ec2-availability-zones';
import { failureOf, noEndpoint } from './use-token-listing';

/** The form's zone names, read state and retry. */
export interface ZonesRead {
  zones: string[] | undefined;
  zoneDetails: AvailabilityZone[] | undefined;
  failure: RequestFailure | undefined;
  loading: boolean;
  retry: () => void;
}

/** A number per mount, so a read of an earlier opening is never shown. */
let mounts = 0;

/** One `DescribeAvailabilityZones` on each opening of the form and each "Retry"; a failure never fails the form. */
export function useAvailabilityZones(endpoint: string | undefined): ZonesRead {
  const [generation, setGeneration] = useState(0);
  const [mount] = useState(() => (mounts += 1));
  const query = useQuery({
    queryKey: ['ec2-availability-zones', endpoint, mount, generation],
    queryFn: async ({ signal }) => {
      if (endpoint === undefined) return noEndpoint();

      let zoneDetails: AvailabilityZone[] | undefined;
      const zones = await listAvailabilityZones(endpoint, signal, (details) => {
        zoneDetails = details;
      });
      return { zones, zoneDetails };
    },
    enabled: endpoint !== undefined,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
  const retry = useCallback(() => {
    setGeneration((current) => current + 1);
  }, []);
  const data = query.isError ? undefined : query.data;
  return {
    zones: data?.zones,
    zoneDetails: data?.zoneDetails,
    failure: query.isError ? failureOf(query.error, DESCRIBE_AVAILABILITY_ZONES) : undefined,
    loading: !query.isError && query.data === undefined,
    retry,
  };
}
