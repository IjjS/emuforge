import { CreateRouteTableCommand, DeleteRouteTableCommand } from '@aws-sdk/client-ec2';

import { sendEc2, text } from '../../lib/ec2-client';
import type { TagRow } from '../../lib/tag-rows';
import { tagSpecifications } from './form';

// The changes of a route table (issue 574, design task 3): `CreateRouteTable` from S8 and `DeleteRouteTable` from S7
// and S9, each through the area's `sendEc2` with its operation's name, so a refusal (`DependencyViolation` for a table
// a subnet is associated with) rejects with its `RequestError` as the emulator gave it.

/** The operations of a route table's changes, as a failure names them. */
export const ROUTE_TABLE_CHANGE_OPERATIONS = {
  createRouteTable: 'CreateRouteTable',
  deleteRouteTable: 'DeleteRouteTable',
} as const;

/** What S8 sends: the VPC and optional tags. */
export interface NewRouteTable {
  vpcId: string;
  name?: string;
  tags?: readonly TagRow[];
}

/** `CreateRouteTable` with `VpcId` and optional tags; the new table's ID. */
export async function createRouteTable(endpoint: string, table: NewRouteTable, signal: AbortSignal): Promise<string> {
  const output = await sendEc2(
    endpoint,
    ROUTE_TABLE_CHANGE_OPERATIONS.createRouteTable,
    (client, abortSignal) =>
      client.send(
        new CreateRouteTableCommand({
          VpcId: table.vpcId,
          ...tagSpecifications('route-table', table.name, table.tags),
        }),
        { abortSignal },
      ),
    signal,
  );
  return text(output.RouteTable?.RouteTableId) ?? '';
}

/** `DeleteRouteTable` of the route table `id`. */
export async function deleteRouteTable(endpoint: string, id: string, signal: AbortSignal): Promise<void> {
  await sendEc2(
    endpoint,
    ROUTE_TABLE_CHANGE_OPERATIONS.deleteRouteTable,
    (client, abortSignal) => client.send(new DeleteRouteTableCommand({ RouteTableId: id }), { abortSignal }),
    signal,
  );
}
