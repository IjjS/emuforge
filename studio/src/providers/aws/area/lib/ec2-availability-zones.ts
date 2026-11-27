import { DescribeAvailabilityZonesCommand } from '@aws-sdk/client-ec2';

import { sendEc2, text } from './ec2-client';

export const DESCRIBE_AVAILABILITY_ZONES = 'DescribeAvailabilityZones';

export interface AvailabilityZone {
  name: string;
  id?: string;
}

/** Zone names and their IDs, in the answer's order. */
export async function listAvailabilityZoneDetails(endpoint: string, signal: AbortSignal): Promise<AvailabilityZone[]> {
  const output = await sendEc2(
    endpoint,
    DESCRIBE_AVAILABILITY_ZONES,
    (client, abortSignal) => client.send(new DescribeAvailabilityZonesCommand({}), { abortSignal }),
    signal,
  );
  return (output.AvailabilityZones ?? []).flatMap((zone) => {
    const name = text(zone.ZoneName);
    const id = text(zone.ZoneId);
    return name === undefined ? [] : [id === undefined ? { name } : { name, id }];
  });
}

/** The Availability Zones' names, in the answer's order: one `DescribeAvailabilityZones`. */
export async function listAvailabilityZones(
  endpoint: string,
  signal: AbortSignal,
  receiveDetails?: (zones: AvailabilityZone[]) => void,
): Promise<string[]> {
  const zones = await listAvailabilityZoneDetails(endpoint, signal);
  receiveDetails?.(zones);
  return zones.map(({ name }) => name);
}
