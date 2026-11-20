import {
  AssociateRouteTableCommand,
  CreateRouteCommand,
  DeleteRouteCommand,
  DisassociateRouteTableCommand,
} from '@aws-sdk/client-ec2';

import { sendEc2, text } from '../../lib/ec2-client';

// The changes of a route table's routes and associations (issue 574, design task 3): `CreateRoute` from S10,
// `DeleteRoute` and `DisassociateRouteTable` from S9, `AssociateRouteTable` from S11, each through the area's `sendEc2`
// with its operation's name, so a refusal (`RouteAlreadyExists`, `Resource.AlreadyAssociated`, …) rejects with its
// `RequestError` as the emulator gave it.

/** The operations of a route's and an association's changes, as a failure names them. */
export const ROUTE_CHANGE_OPERATIONS = {
  createRoute: 'CreateRoute',
  deleteRoute: 'DeleteRoute',
  associateRouteTable: 'AssociateRouteTable',
  disassociateRouteTable: 'DisassociateRouteTable',
} as const;

/** What S10 sends: the table, the destination as typed, and the internet gateway it leads to. */
export interface NewRoute {
  routeTableId: string;
  destination: string;
  gatewayId: string;
}

/** `CreateRoute` with `RouteTableId`, `DestinationCidrBlock` as typed and `GatewayId`. */
export async function createRoute(endpoint: string, route: NewRoute, signal: AbortSignal): Promise<void> {
  await sendEc2(
    endpoint,
    ROUTE_CHANGE_OPERATIONS.createRoute,
    (client, abortSignal) =>
      client.send(
        new CreateRouteCommand({
          RouteTableId: route.routeTableId,
          DestinationCidrBlock: route.destination,
          GatewayId: route.gatewayId,
        }),
        { abortSignal },
      ),
    signal,
  );
}

/** `DeleteRoute` of the IPv4 destination `destination` of the table `routeTableId`. */
export async function deleteRoute(
  endpoint: string,
  routeTableId: string,
  destination: string,
  signal: AbortSignal,
): Promise<void> {
  await sendEc2(
    endpoint,
    ROUTE_CHANGE_OPERATIONS.deleteRoute,
    (client, abortSignal) =>
      client.send(new DeleteRouteCommand({ RouteTableId: routeTableId, DestinationCidrBlock: destination }), {
        abortSignal,
      }),
    signal,
  );
}

/** `AssociateRouteTable` of the subnet `subnetId` with the table `routeTableId`; the association's ID. */
export async function associateSubnet(
  endpoint: string,
  routeTableId: string,
  subnetId: string,
  signal: AbortSignal,
): Promise<string> {
  const output = await sendEc2(
    endpoint,
    ROUTE_CHANGE_OPERATIONS.associateRouteTable,
    (client, abortSignal) =>
      client.send(new AssociateRouteTableCommand({ RouteTableId: routeTableId, SubnetId: subnetId }), {
        abortSignal,
      }),
    signal,
  );
  return text(output.AssociationId) ?? '';
}

/** `DisassociateRouteTable` of the association `associationId`. */
export async function disassociateSubnet(endpoint: string, associationId: string, signal: AbortSignal): Promise<void> {
  await sendEc2(
    endpoint,
    ROUTE_CHANGE_OPERATIONS.disassociateRouteTable,
    (client, abortSignal) =>
      client.send(new DisassociateRouteTableCommand({ AssociationId: associationId }), { abortSignal }),
    signal,
  );
}
