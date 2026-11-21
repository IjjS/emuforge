import {
  AttachVolumeCommand,
  CreateVolumeCommand,
  DeleteVolumeCommand,
  DescribeVolumesCommand,
  DetachVolumeCommand,
  type Volume as SdkVolume,
} from '@aws-sdk/client-ec2';

import type { TokenPage } from '../../components/use-token-listing';
import { sendEc2, text, withValues } from '../../lib/ec2-client';

export const VOLUME_OPERATIONS = {
  describeVolumes: 'DescribeVolumes',
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
  size: number;
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

export async function createVolume(endpoint: string, { zone, size }: NewVolume, signal: AbortSignal): Promise<string> {
  const output = await sendEc2(
    endpoint,
    VOLUME_OPERATIONS.createVolume,
    (client, abortSignal) =>
      client.send(new CreateVolumeCommand({ AvailabilityZone: zone, Size: size }), { abortSignal }),
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
