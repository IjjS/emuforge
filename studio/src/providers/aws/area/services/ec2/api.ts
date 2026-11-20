import {
  DescribeInstanceAttributeCommand,
  DescribeInstancesCommand,
  type DescribeInstancesCommandOutput,
  EC2Client,
  RebootInstancesCommand,
  StartInstancesCommand,
  StopInstancesCommand,
  TerminateInstancesCommand,
  type Filter,
  type Instance as SdkInstance,
  type Tag as SdkTag,
} from '@aws-sdk/client-ec2';

import { createAwsClient } from '../../../../../lib/aws/client-factory';
import { sendRequest } from '../../../../../lib/aws/request';
import type { Tag } from './format';
import type { InstanceAction } from './instance-state';

// The calls of EC2's instance screens (issue 553, design tasks 1 and 3), through the engine, mapped to plain typed
// results, and the one place EC2's client class meets the factory: every other API file of the folder sends its
// commands through `sendEc2`. Every command goes through the shared `sendRequest` with its operation's name, so a
// failed request rejects with its `RequestError` and an aborted one with the signal's reason. Every value is the
// emulator's, as it came.

/** The operations of the instance screens, as a failure names them. */
export const OPERATIONS = {
  describeInstances: 'DescribeInstances',
  describeInstanceAttribute: 'DescribeInstanceAttribute',
  startInstances: 'StartInstances',
  stopInstances: 'StopInstances',
  rebootInstances: 'RebootInstances',
  terminateInstances: 'TerminateInstances',
} as const;

/** How many instances one page of S1 asks for. */
export const INSTANCES_PAGE_SIZE = 50;

const clients = new Map<string, EC2Client>();

function ec2Client(endpoint: string): EC2Client {
  let client = clients.get(endpoint);
  if (client === undefined) {
    client = createAwsClient(EC2Client, { endpoint });
    clients.set(endpoint, client);
  }
  return client;
}

/**
 * One request of `operation` to EC2 at the engine `endpoint`: `send` is handed the client and the signal to send its
 * command with. What every API file of the folder sends through.
 */
export function sendEc2<T>(
  endpoint: string,
  operation: string,
  send: (client: EC2Client, abortSignal: AbortSignal) => Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  return sendRequest(operation, (abortSignal) => send(ec2Client(endpoint), abortSignal), signal);
}

/** `value` when it is a text that is not empty. */
export function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** The tags of an answer, in its order; a tag without a key is left out. */
export function tagsOf(tags: readonly SdkTag[] | undefined): Tag[] {
  return (tags ?? []).flatMap((tag) => {
    const key = text(tag.Key);
    return key === undefined ? [] : [{ key, value: tag.Value ?? '' }];
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Instances

/** A security group an instance has. */
export interface InstanceGroup {
  id: string;
  name?: string;
}

/** A block device of an instance, as the instance reports it. */
export interface BlockDevice {
  device?: string;
  volumeId?: string;
  deleteOnTermination?: boolean;
}

/** An instance as S1 and S3 show it. A value the answer lacks is absent. */
export interface Instance {
  id: string;
  /** `State.Name` as the API names it; empty when the answer gave none. */
  state: string;
  /** `StateReason.Message`. */
  stateReason?: string;
  type?: string;
  imageId?: string;
  launchTime?: Date;
  keyName?: string;
  zone?: string;
  subnetId?: string;
  vpcId?: string;
  privateIp?: string;
  publicIp?: string;
  privateDns?: string;
  publicDns?: string;
  architecture?: string;
  platform?: string;
  groups: InstanceGroup[];
  volumes: BlockDevice[];
  tags: Tag[];
}

/** Copies the values of `values` that are not `undefined` onto `target`. */
function withValues<T extends object>(target: T, values: { [K in keyof T]?: T[K] | undefined }): T {
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) {
      (target as Record<string, unknown>)[key] = value;
    }
  }
  return target;
}

function instanceOf(raw: SdkInstance): Instance | undefined {
  const id = text(raw.InstanceId);
  if (id === undefined) {
    return undefined;
  }
  const launchTime = raw.LaunchTime instanceof Date && !Number.isNaN(raw.LaunchTime.getTime()) ? raw.LaunchTime : undefined;
  return withValues<Instance>(
    {
      id,
      state: text(raw.State?.Name) ?? '',
      groups: (raw.SecurityGroups ?? []).flatMap((group) => {
        const groupId = text(group.GroupId);
        return groupId === undefined ? [] : [withValues<InstanceGroup>({ id: groupId }, { name: text(group.GroupName) })];
      }),
      volumes: (raw.BlockDeviceMappings ?? []).map((mapping) =>
        withValues<BlockDevice>(
          {},
          {
            device: text(mapping.DeviceName),
            volumeId: text(mapping.Ebs?.VolumeId),
            deleteOnTermination:
              typeof mapping.Ebs?.DeleteOnTermination === 'boolean' ? mapping.Ebs.DeleteOnTermination : undefined,
          },
        ),
      ),
      tags: tagsOf(raw.Tags),
    },
    {
      stateReason: text(raw.StateReason?.Message),
      type: text(raw.InstanceType),
      imageId: text(raw.ImageId),
      launchTime,
      keyName: text(raw.KeyName),
      zone: text(raw.Placement?.AvailabilityZone),
      subnetId: text(raw.SubnetId),
      vpcId: text(raw.VpcId),
      privateIp: text(raw.PrivateIpAddress),
      publicIp: text(raw.PublicIpAddress),
      privateDns: text(raw.PrivateDnsName),
      publicDns: text(raw.PublicDnsName),
      architecture: text(raw.Architecture),
      platform: text(raw.PlatformDetails),
    },
  );
}

/** What S1's filters ask: a state (none for "Any state") and a text of the name (none when empty). */
export interface InstanceFilters {
  state?: string;
  name?: string;
}

/** One page of `DescribeInstances`: every reservation's instances in the answer's order, and its token. */
export interface InstancePage {
  instances: Instance[];
  nextToken?: string;
}

function filtersOf({ state, name }: InstanceFilters): Filter[] {
  const filters: Filter[] = [];
  if (state !== undefined && state !== '') {
    filters.push({ Name: 'instance-state-name', Values: [state] });
  }
  if (name !== undefined && name !== '') {
    filters.push({ Name: 'tag:Name', Values: [`*${name}*`] });
  }
  return filters;
}

function instancesOf(output: Pick<DescribeInstancesCommandOutput, 'Reservations'>): Instance[] {
  return (output.Reservations ?? []).flatMap((reservation) =>
    (reservation.Instances ?? []).flatMap((raw) => {
      const instance = instanceOf(raw);
      return instance === undefined ? [] : [instance];
    }),
  );
}

/** S1's page: `DescribeInstances` with `MaxResults` 50, the filters, and the page's token when it has one. */
export async function listInstances(
  endpoint: string,
  filters: InstanceFilters,
  token: string | undefined,
  signal: AbortSignal,
): Promise<InstancePage> {
  const sent = filtersOf(filters);
  const output = await sendEc2(
    endpoint,
    OPERATIONS.describeInstances,
    (client, abortSignal) =>
      client.send(
        new DescribeInstancesCommand({
          MaxResults: INSTANCES_PAGE_SIZE,
          ...(sent.length === 0 ? {} : { Filters: sent }),
          ...(token === undefined ? {} : { NextToken: token }),
        }),
        { abortSignal },
      ),
    signal,
  );
  const page: InstancePage = { instances: instancesOf(output) };
  const next = text(output.NextToken);
  if (next !== undefined) {
    page.nextToken = next;
  }
  return page;
}

/** An instance read: the instance, or "not found" (an empty answer). */
export type InstanceRead = { found: true; instance: Instance } | { found: false };

/**
 * S3's read: `DescribeInstances` by the filter `instance-id`, never by `InstanceIds`, so an id the emulator does not
 * hold is an empty answer rather than a refusal.
 */
export async function getInstance(endpoint: string, id: string, signal: AbortSignal): Promise<InstanceRead> {
  const output = await sendEc2(
    endpoint,
    OPERATIONS.describeInstances,
    (client, abortSignal) =>
      client.send(new DescribeInstancesCommand({ Filters: [{ Name: 'instance-id', Values: [id] }] }), {
        abortSignal,
      }),
    signal,
  );
  const instance = instancesOf(output).find((candidate) => candidate.id === id);
  return instance === undefined ? { found: false } : { found: true, instance };
}

/** Termination protection: `DescribeInstanceAttribute` `disableApiTermination`, `true` for on. */
export async function getTerminationProtection(endpoint: string, id: string, signal: AbortSignal): Promise<boolean> {
  const output = await sendEc2(
    endpoint,
    OPERATIONS.describeInstanceAttribute,
    (client, abortSignal) =>
      client.send(new DescribeInstanceAttributeCommand({ InstanceId: id, Attribute: 'disableApiTermination' }), {
        abortSignal,
      }),
    signal,
  );
  return output.DisableApiTermination?.Value === true;
}

/** The operation each action sends. */
export const ACTION_OPERATIONS: Readonly<Record<InstanceAction, string>> = {
  start: OPERATIONS.startInstances,
  stop: OPERATIONS.stopInstances,
  reboot: OPERATIONS.rebootInstances,
  terminate: OPERATIONS.terminateInstances,
};

/** "Start", "Stop", "Reboot" or "Terminate" of the one instance `id`. */
export async function actOnInstance(
  endpoint: string,
  action: InstanceAction,
  id: string,
  signal: AbortSignal,
): Promise<void> {
  const input = { InstanceIds: [id] };
  await sendEc2(
    endpoint,
    ACTION_OPERATIONS[action],
    (client, abortSignal) => {
      switch (action) {
        case 'start':
          return client.send(new StartInstancesCommand(input), { abortSignal });
        case 'stop':
          return client.send(new StopInstancesCommand(input), { abortSignal });
        case 'reboot':
          return client.send(new RebootInstancesCommand(input), { abortSignal });
        case 'terminate':
          return client.send(new TerminateInstancesCommand(input), { abortSignal });
      }
    },
    signal,
  );
}
