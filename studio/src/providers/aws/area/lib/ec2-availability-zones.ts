import { DescribeAvailabilityZonesCommand } from '@aws-sdk/client-ec2';

import { sendEc2, text } from './ec2-client';

export const DESCRIBE_AVAILABILITY_ZONES = 'DescribeAvailabilityZones';

/** The Availability Zones' names, in the answer's order: one `DescribeAvailabilityZones`. */
export async function listAvailabilityZones(endpoint: string, signal: AbortSignal): Promise<string[]> {
  const output = await sendEc2(
    endpoint,
    DESCRIBE_AVAILABILITY_ZONES,
    (client, abortSignal) => client.send(new DescribeAvailabilityZonesCommand({}), { abortSignal }),
    signal,
  );
  return (output.AvailabilityZones ?? []).flatMap((zone) => {
    const name = text(zone.ZoneName);
    return name === undefined ? [] : [name];
  });
}
