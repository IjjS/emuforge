import {
  AttachVolumeCommand,
  CreateVolumeCommand,
  DeleteVolumeCommand,
  DescribeVolumesCommand,
  DescribeSnapshotsCommand,
  DescribeInstancesCommand,
  type CreateVolumeCommandInput,
  DetachVolumeCommand,
  type Volume as SdkVolume,
} from '@aws-sdk/client-ec2';

import type { TokenPage } from '../../components/use-token-listing';
import { nameOf, sendEc2, tagsOf, text, withValues } from '../../lib/ec2-client';
import type { TagRow } from '../../lib/tag-rows';
import { INSTANCES_PAGE_SIZE, OPERATIONS } from './api';
import type { VolumeType } from './volume-form';

export const VOLUME_OPERATIONS = {
  describeVolumes: 'DescribeVolumes',
  describeSnapshots: 'DescribeSnapshots',
  createVolume: 'CreateVolume',
  attachVolume: 'AttachVolume',
  detachVolume: 'DetachVolume',
  deleteVolume: 'DeleteVolume',
} as const;

export const VOLUMES_PAGE_SIZE = 25;

export interface VolumeAttachment {
  instanceId?: string;
  device?: string;
  state?: string;
}

export interface AttachmentTarget {
  instanceId: string;
  device: string;
}

export interface Volume {
  id: string;
  size?: number;
  type?: string;
  zone?: string;
  state?: string;
  attachments: VolumeAttachment[];
}

export interface NewVolume {
  zone: string;
  size?: number | undefined;
  type?: VolumeType;
  iops?: number | undefined;
  throughput?: number | undefined;
  snapshotId?: string | undefined;
  encrypted?: boolean;
  kmsKeyId?: string | undefined;
  tags?: readonly TagRow[];
}

export interface VolumeSnapshot {
  id: string;
  size?: number;
  state?: string;
  volumeId?: string;
  description?: string;
}

export interface VolumeInstance {
  id: string;
  name?: string;
  state?: string;
  type?: string;
  devices: string[];
}

function volumesOf(volumes: SdkVolume[] | undefined): Volume[] {
  return (volumes ?? []).flatMap((raw) => {
    const id = text(raw.VolumeId);
    if (id === undefined) return [];
    const attachments = (raw.Attachments ?? []).map((attachment) =>
      withValues<VolumeAttachment>(
        {},
        {
          instanceId: text(attachment.InstanceId),
          device: text(attachment.Device),
          state: text(attachment.State),
        },
      ),
    );
    return [
      withValues<Volume>(
        { id, attachments },
        {
          size: raw.Size,
          type: text(raw.VolumeType),
          zone: text(raw.AvailabilityZone),
          state: text(raw.State),
        },
      ),
    ];
  });
}

export async function listVolumes(
  endpoint: string,
  token: string | undefined,
  signal: AbortSignal,
): Promise<TokenPage<Volume>> {
  const output = await sendEc2(
    endpoint,
    VOLUME_OPERATIONS.describeVolumes,
    (client, abortSignal) =>
      client.send(
        new DescribeVolumesCommand({
          MaxResults: VOLUMES_PAGE_SIZE,
          ...(token === undefined ? {} : { NextToken: token }),
        }),
        { abortSignal },
      ),
    signal,
  );
  return withValues<TokenPage<Volume>>({ items: volumesOf(output.Volumes) }, { next: text(output.NextToken) });
}

export type VolumeRead = { found: true; volume: Volume } | { found: false };

export async function getVolume(endpoint: string, id: string, signal: AbortSignal): Promise<VolumeRead> {
  const output = await sendEc2(
    endpoint,
    VOLUME_OPERATIONS.describeVolumes,
    (client, abortSignal) =>
      client.send(new DescribeVolumesCommand({ Filters: [{ Name: 'volume-id', Values: [id] }] }), { abortSignal }),
    signal,
  );
  const volume = volumesOf(output.Volumes).find((candidate) => candidate.id === id);
  return volume === undefined ? { found: false } : { found: true, volume };
}

export async function listVolumeSnapshots(
  endpoint: string,
  token: string | undefined,
  signal: AbortSignal,
): Promise<TokenPage<VolumeSnapshot>> {
  const output = await sendEc2(
    endpoint,
    VOLUME_OPERATIONS.describeSnapshots,
    (client, abortSignal) =>
      client.send(
        new DescribeSnapshotsCommand({
          OwnerIds: ['self'],
          MaxResults: VOLUMES_PAGE_SIZE,
          ...(token === undefined ? {} : { NextToken: token }),
        }),
        { abortSignal },
      ),
    signal,
  );
  const items = (output.Snapshots ?? []).flatMap((snapshot) => {
    const id = text(snapshot.SnapshotId);
    return id === undefined
      ? []
      : [
          withValues<VolumeSnapshot>(
            { id },
            {
              size: snapshot.VolumeSize,
              state: text(snapshot.State),
              volumeId: text(snapshot.VolumeId),
              description: text(snapshot.Description),
            },
          ),
        ];
  });
  return withValues<TokenPage<VolumeSnapshot>>({ items }, { next: text(output.NextToken) });
}

export async function listVolumeInstances(
  endpoint: string,
  zone: string,
  token: string | undefined,
  signal: AbortSignal,
): Promise<TokenPage<VolumeInstance>> {
  const output = await sendEc2(
    endpoint,
    OPERATIONS.describeInstances,
    (client, abortSignal) =>
      client.send(
        new DescribeInstancesCommand({
          Filters: [
            { Name: 'availability-zone', Values: [zone] },
            { Name: 'instance-state-name', Values: ['running', 'stopped'] },
          ],
          MaxResults: INSTANCES_PAGE_SIZE,
          ...(token === undefined ? {} : { NextToken: token }),
        }),
        { abortSignal },
      ),
    signal,
  );
  const items = (output.Reservations ?? []).flatMap((reservation) =>
    (reservation.Instances ?? []).flatMap((instance) => {
      const id = text(instance.InstanceId);
      if (id === undefined) return [];
      const devices = (instance.BlockDeviceMappings ?? []).flatMap(({ DeviceName }) => {
        const device = text(DeviceName);
        return device === undefined ? [] : [device];
      });
      return [
        withValues<VolumeInstance>(
          { id, devices },
          {
            name: nameOf(tagsOf(instance.Tags)),
            state: text(instance.State?.Name),
            type: text(instance.InstanceType),
          },
        ),
      ];
    }),
  );
  return withValues<TokenPage<VolumeInstance>>({ items }, { next: text(output.NextToken) });
}

export async function createVolume(endpoint: string, volume: NewVolume, signal: AbortSignal): Promise<string> {
  const output = await sendEc2(
    endpoint,
    VOLUME_OPERATIONS.createVolume,
    (client, abortSignal) =>
      client.send(
        new CreateVolumeCommand(
          withValues<CreateVolumeCommandInput>(
            { AvailabilityZone: volume.zone },
            {
              VolumeType: volume.type,
              Size: volume.size,
              SnapshotId: volume.snapshotId,
              Iops: volume.iops,
              Throughput: volume.throughput,
              Encrypted: volume.encrypted ? true : undefined,
              KmsKeyId: volume.encrypted ? volume.kmsKeyId : undefined,
              TagSpecifications: volume.tags?.length
                ? [
                    {
                      ResourceType: 'volume',
                      Tags: volume.tags.map(({ key, value }) => ({ Key: key, Value: value })),
                    },
                  ]
                : undefined,
            },
          ),
        ),
        { abortSignal },
      ),
    signal,
  );
  const id = text(output.VolumeId);
  if (id === undefined) throw new Error('CreateVolume returned no volume ID.');
  return id;
}

export async function attachVolume(
  endpoint: string,
  id: string,
  { instanceId, device }: AttachmentTarget,
  signal: AbortSignal,
): Promise<void> {
  await sendEc2(
    endpoint,
    VOLUME_OPERATIONS.attachVolume,
    (client, abortSignal) =>
      client.send(new AttachVolumeCommand({ VolumeId: id, InstanceId: instanceId, Device: device }), { abortSignal }),
    signal,
  );
}

export async function detachVolume(
  endpoint: string,
  id: string,
  { instanceId, device }: AttachmentTarget,
  signal: AbortSignal,
): Promise<void> {
  await sendEc2(
    endpoint,
    VOLUME_OPERATIONS.detachVolume,
    (client, abortSignal) =>
      client.send(new DetachVolumeCommand({ VolumeId: id, InstanceId: instanceId, Device: device }), { abortSignal }),
    signal,
  );
}

export async function deleteVolume(endpoint: string, id: string, signal: AbortSignal): Promise<void> {
  await sendEc2(
    endpoint,
    VOLUME_OPERATIONS.deleteVolume,
    (client, abortSignal) => client.send(new DeleteVolumeCommand({ VolumeId: id }), { abortSignal }),
    signal,
  );
}
