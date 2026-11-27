import {
  DescribeInstancesCommand,
  DescribeInternetGatewaysCommand,
  DescribeNatGatewaysCommand,
  DescribeNetworkInterfacesCommand,
  EC2Client,
} from '@aws-sdk/client-ec2';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../lib/aws/request';
import { type RouteTargetKind, routeTargetChoices } from './route-targets';

const endpoint = 'http://127.0.0.1:9966';
const vpcId = 'vpc-a';
const token = 'page-2';
const commands = {
  GatewayId: DescribeInternetGatewaysCommand,
  NatGatewayId: DescribeNatGatewaysCommand,
  InstanceId: DescribeInstancesCommand,
  NetworkInterfaceId: DescribeNetworkInterfacesCommand,
};

interface Scenario {
  kind: RouteTargetKind;
  operation: string;
  output: object;
  id: string;
  description: string;
  filter: string;
  filterMember?: string;
}

const cases: Scenario[] = [
  {
    kind: 'GatewayId',
    operation: 'DescribeInternetGateways',
    output: { InternetGateways: [{ InternetGatewayId: 'igw-1', Attachments: [{ VpcId: vpcId, State: 'available' }] }] },
    id: 'igw-1',
    description: 'available',
    filter: 'attachment.vpc-id',
  },
  {
    kind: 'NatGatewayId',
    operation: 'DescribeNatGateways',
    output: { NatGateways: [{ NatGatewayId: 'nat-1', State: 'available', SubnetId: 'subnet-1' }] },
    id: 'nat-1',
    description: 'available · subnet-1',
    filter: 'vpc-id',
    filterMember: 'Filter',
  },
  {
    kind: 'InstanceId',
    operation: 'DescribeInstances',
    output: {
      Reservations: [{ Instances: [{ InstanceId: 'i-1', State: { Name: 'running' }, PrivateIpAddress: '10.0.0.4' }] }],
    },
    id: 'i-1',
    description: 'running · 10.0.0.4',
    filter: 'vpc-id',
  },
  {
    kind: 'NetworkInterfaceId',
    operation: 'DescribeNetworkInterfaces',
    output: {
      NetworkInterfaces: [
        { NetworkInterfaceId: 'eni-1', Status: 'in-use', PrivateIpAddress: '10.0.0.5', SubnetId: 'subnet-1' },
      ],
    },
    id: 'eni-1',
    description: 'in-use · 10.0.0.5 · subnet-1',
    filter: 'vpc-id',
  },
];

afterEach(() => vi.restoreAllMocks());

describe.each(cases)(
  '$operation as a route target source',
  ({ kind, operation, output, id, description, filter, filterMember = 'Filters' }) => {
    it("reads one page with the route table's VPC and describes the returned option", async () => {
      const send = vi
        .spyOn(EC2Client.prototype, 'send')
        .mockResolvedValueOnce({ ...output, NextToken: token } as never)
        .mockResolvedValueOnce({} as never);
      const source = routeTargetChoices(endpoint, vpcId, kind);
      const signal = new AbortController().signal;

      expect(source.readAgainOnOpen).toBe(true);
      expect(source.operation).toBe(operation);
      const first = await source.read(endpoint, '', undefined, signal);
      expect(send).toHaveBeenCalledTimes(1);
      expect(send.mock.calls[0]?.[0]).toBeInstanceOf(commands[kind]);
      expect(send.mock.calls[0]?.[0]).toMatchObject({
        input: { MaxResults: 50, [filterMember]: [{ Name: filter, Values: [vpcId] }] },
      });
      expect(first).toEqual({ items: [{ id, description }], next: token });
      expect(first.items.map(source.optionOf)).toEqual([{ value: id, label: id, description }]);

      expect(await source.read(endpoint, '', first.next, signal)).toEqual({ items: [] });
      expect(send.mock.calls[1]?.[0]).toMatchObject({
        input: { MaxResults: 50, [filterMember]: [{ Name: filter, Values: [vpcId] }], NextToken: token },
      });
    });

    it('names the operation in a 501 failure', async () => {
      vi.spyOn(EC2Client.prototype, 'send').mockRejectedValue({ $metadata: { httpStatusCode: 501 } });
      const source = routeTargetChoices(endpoint, vpcId, kind);
      const read = source.read(endpoint, '', undefined, new AbortController().signal);
      await expect(read).rejects.toBeInstanceOf(RequestError);
      await expect(read).rejects.toMatchObject({ failure: { kind: 'not-implemented', operation } });
    });
  },
);
