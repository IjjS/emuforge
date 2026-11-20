// @vitest-environment node
import { DescribeSecurityGroupsCommand, DescribeSubnetsCommand, type EC2Client } from '@aws-sdk/client-ec2';
import { describe, expect, it, vi } from 'vitest';

import { RequestError, sendRequest, type RequestFailure } from '../../../../lib/aws/request';
import { groupChoices, listGroups, listSubnets, subnetChoices, type Ec2Send } from './network-choices';

// The file is handed its `send`: here one that records each request and gives the command to a fake client, which
// answers what the case sets. So every read is proved to go through the sender handed in, with its operation's name.

interface Call {
  operation: string;
  command: unknown;
}

function fakeSend(answer: (command: unknown) => unknown) {
  const calls: Call[] = [];
  const send: Ec2Send = (_endpoint, operation, run, signal) =>
    sendRequest(
      operation,
      (abortSignal) =>
        run(
          {
            send: (command: unknown) => {
              calls.push({ operation, command });
              return Promise.resolve(answer(command));
            },
          } as unknown as EC2Client,
          abortSignal,
        ),
      signal,
    );
  const spy = vi.fn(send);
  return { send: spy as unknown as Ec2Send, spy, calls };
}

const ENDPOINT = 'http://127.0.0.1:9311';
const KEY = ['aws', 'test', 'choices'] as const;
const signal = () => new AbortController().signal;

function inputOf(call: Call | undefined): unknown {
  return (call?.command as { input?: unknown } | undefined)?.input;
}

describe('network choices', () => {
  it('every read → sent with the send handed in, with its operation name; the file makes no client', async () => {
    const { send, spy, calls } = fakeSend(() => ({}));
    await listSubnets(send, ENDPOINT, undefined, undefined, signal());
    await listGroups(send, ENDPOINT, 'vpc-1', undefined, signal());
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls.map((call) => [call[0], call[1]])).toEqual([
      [ENDPOINT, 'DescribeSubnets'],
      [ENDPOINT, 'DescribeSecurityGroups'],
    ]);
    expect(calls[0]?.command).toBeInstanceOf(DescribeSubnetsCommand);
    expect(calls[1]?.command).toBeInstanceOf(DescribeSecurityGroupsCommand);
  });

  it('subnet choices → DescribeSubnets with MaxResults 50 and the token, vpc-id when a VPC is given; id, VPC and zone; the token', async () => {
    const { send, calls } = fakeSend(() => ({
      Subnets: [
        { SubnetId: 'subnet-a', VpcId: 'vpc-1', AvailabilityZone: 'us-east-1a' },
        { SubnetId: 'subnet-b', VpcId: 'vpc-1', AvailabilityZone: 'us-east-1b' },
      ],
      NextToken: 'tok-2',
    }));
    const source = subnetChoices(send, KEY, ENDPOINT);
    const page = await source.read(ENDPOINT, '', 'tok-1', signal());
    expect(inputOf(calls[0])).toEqual({ MaxResults: 50, NextToken: 'tok-1' });
    expect(page.next).toBe('tok-2');
    expect(page.items.map(source.optionOf)).toEqual([
      { value: 'subnet-a', label: 'subnet-a', description: 'vpc-1, us-east-1a' },
      { value: 'subnet-b', label: 'subnet-b', description: 'vpc-1, us-east-1b' },
    ]);

    const ofVpc = subnetChoices(send, KEY, ENDPOINT, 'vpc-1');
    await ofVpc.read(ENDPOINT, '', undefined, signal());
    expect(inputOf(calls[1])).toEqual({ MaxResults: 50, Filters: [{ Name: 'vpc-id', Values: ['vpc-1'] }] });
    expect(ofVpc.key).not.toEqual(source.key);
  });

  it('security group choices of a VPC → DescribeSecurityGroups with vpc-id; value the id, label the id and name; no VPC → not ready', async () => {
    const { send, spy, calls } = fakeSend(() => ({
      SecurityGroups: [
        { GroupId: 'sg-1', GroupName: 'default' },
        { GroupId: 'sg-2', GroupName: 'web' },
      ],
    }));
    const source = groupChoices(send, KEY, ENDPOINT, 'vpc-1');
    expect(source.ready).toBe(true);
    const page = await source.read(ENDPOINT, '', undefined, signal());
    expect(inputOf(calls[0])).toEqual({ MaxResults: 50, Filters: [{ Name: 'vpc-id', Values: ['vpc-1'] }] });
    expect(page.next).toBeUndefined();
    expect(page.items.map(source.optionOf)).toEqual([
      { value: 'sg-1', label: 'sg-1 (default)' },
      { value: 'sg-2', label: 'sg-2 (web)' },
    ]);

    const none = groupChoices(send, KEY, ENDPOINT, undefined);
    expect(none.ready).toBe(false);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('a refused read → the failure under its operation name', async () => {
    const send: Ec2Send = (_endpoint, operation, _run, signal) =>
      sendRequest(
        operation,
        () =>
          Promise.reject(
            Object.assign(new Error('bad'), {
              name: 'InvalidParameterValue',
              $fault: 'client',
              message: 'bad filter',
              $metadata: { httpStatusCode: 400 },
            }),
          ),
        signal,
      );
    for (const [pending, operation] of [
      [listSubnets(send, ENDPOINT, undefined, undefined, signal()), 'DescribeSubnets'],
      [listGroups(send, ENDPOINT, 'vpc-1', undefined, signal()), 'DescribeSecurityGroups'],
    ] as const) {
      const error: unknown = await pending.then(
        () => undefined,
        (reason: unknown) => reason,
      );
      expect(error).toBeInstanceOf(RequestError);
      expect((error as RequestError).failure).toEqual<RequestFailure>({
        kind: 'other',
        operation,
        code: 'InvalidParameterValue',
        message: 'bad filter',
      });
    }
  });
});
