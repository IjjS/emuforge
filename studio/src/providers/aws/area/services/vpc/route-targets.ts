import {
  DescribeInstancesCommand,
  DescribeInternetGatewaysCommand,
  DescribeNatGatewaysCommand,
  DescribeNetworkInterfacesCommand,
} from '@aws-sdk/client-ec2';

import type { ChoiceSource } from '../../components/use-paged-choices';
import { sendEc2, text } from '../../lib/ec2-client';
import { paged } from '../../lib/ec2-network-choices';
import { VPC_KEYS } from './queries';

export const ROUTE_TARGET_KINDS = {
  GatewayId: {
    label: 'Internet gateway',
    plural: 'internet gateways',
    description: "An internet gateway attached to this table's VPC.",
    operation: 'DescribeInternetGateways',
  },
  NatGatewayId: {
    label: 'NAT gateway',
    plural: 'NAT gateways',
    description: "A NAT gateway of this table's VPC.",
    operation: 'DescribeNatGateways',
  },
  InstanceId: {
    label: 'Instance',
    plural: 'instances',
    description: "An instance of this table's VPC.",
    operation: 'DescribeInstances',
  },
  NetworkInterfaceId: {
    label: 'Network interface',
    plural: 'network interfaces',
    description: "A network interface of this table's VPC.",
    operation: 'DescribeNetworkInterfaces',
  },
} as const;

export type RouteTargetKind = keyof typeof ROUTE_TARGET_KINDS;

export interface RouteTarget {
  id: string;
  description: string;
}

function target(id: string | undefined, ...details: (string | undefined)[]): RouteTarget[] {
  return id ? [{ id, description: details.filter(Boolean).join(' · ') }] : [];
}

function page(items: RouteTarget[], token: string | undefined) {
  const next = text(token);
  return next === undefined ? { items } : { items, next };
}

export function routeTargetChoices(
  endpoint: string | undefined,
  vpcId: string,
  kind: RouteTargetKind,
): ChoiceSource<RouteTarget> {
  const { operation } = ROUTE_TARGET_KINDS[kind];
  return {
    key: VPC_KEYS.choices('route-targets', vpcId, kind),
    endpoint,
    operation,
    filtering: 'local',
    readAgainOnOpen: true,
    read: (at, _text, token, signal) =>
      sendEc2(
        at,
        operation,
        async (client, abortSignal) => {
          const filter = kind === 'GatewayId' ? 'attachment.vpc-id' : 'vpc-id';
          const input = paged([{ Name: filter, Values: [vpcId] }], token);
          const options = { abortSignal };
          switch (kind) {
            case 'GatewayId': {
              const output = await client.send(new DescribeInternetGatewaysCommand(input), options);
              const items = (output.InternetGateways ?? []).flatMap((gateway) =>
                target(
                  gateway.InternetGatewayId,
                  gateway.Attachments?.find((attachment) => attachment.VpcId === vpcId)?.State,
                ),
              );
              return page(items, output.NextToken);
            }
            case 'NatGatewayId': {
              const { Filters, ...paging } = input;
              const output = await client.send(new DescribeNatGatewaysCommand({ ...paging, Filter: Filters }), options);
              const items = (output.NatGateways ?? []).flatMap((gateway) =>
                target(gateway.NatGatewayId, gateway.State, gateway.SubnetId),
              );
              return page(items, output.NextToken);
            }
            case 'InstanceId': {
              const output = await client.send(new DescribeInstancesCommand(input), options);
              const items = (output.Reservations ?? []).flatMap((reservation) =>
                (reservation.Instances ?? []).flatMap((instance) =>
                  target(instance.InstanceId, instance.State?.Name, instance.PrivateIpAddress),
                ),
              );
              return page(items, output.NextToken);
            }
            case 'NetworkInterfaceId': {
              const output = await client.send(new DescribeNetworkInterfacesCommand(input), options);
              const items = (output.NetworkInterfaces ?? []).flatMap((nic) =>
                target(nic.NetworkInterfaceId, nic.Status, nic.PrivateIpAddress, nic.SubnetId),
              );
              return page(items, output.NextToken);
            }
          }
        },
        signal,
      ),
    optionOf: ({ id, description }) => ({
      value: id,
      label: id,
      ...(description === '' ? {} : { description }),
    }),
  };
}
