import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

import { failureOf, noEndpoint, useTokenListing, type TokenListing } from '../../components/use-token-listing';
import type { ChoiceSource } from '../../components/use-paged-choices';
import { OPERATIONS } from './api';
import { READ_AGAIN_MS } from './instance-state';
import { EC2_KEY, EC2_KEYS, type Ec2Read } from './queries';
import {
  createVolume,
  getVolume,
  listVolumes,
  listVolumeInstances,
  listVolumeSnapshots,
  VOLUME_OPERATIONS,
  type AttachmentTarget,
  type NewVolume,
  type Volume,
  type VolumeRead,
  type VolumeInstance,
  type VolumeSnapshot,
} from './volume-api';

export const VOLUME_KEYS = {
  list: [...EC2_KEY, 'volumes'],
  detail: (id: string) => [...EC2_KEY, 'volume', id],
};

export function useVolumeListing(endpoint: string | undefined, connectionGeneration = 0): TokenListing<Volume> {
  return useTokenListing({
    key: [...VOLUME_KEYS.list, connectionGeneration],
    endpoint,
    operation: VOLUME_OPERATIONS.describeVolumes,
    read: listVolumes,
  });
}

export function useCreateVolume(
  endpoint: string | undefined,
): (volume: NewVolume, signal: AbortSignal) => Promise<string> {
  return useCallback((volume, signal) => createVolume(endpoint ?? noEndpoint(), volume, signal), [endpoint]);
}

export interface AttachmentChange {
  action: 'attach' | 'detach';
  target: AttachmentTarget;
}

export const ATTACHMENT_CONFIRMATION_MS = 5 * READ_AGAIN_MS;

export function attachmentChangeConfirmed(volume: Volume, { action, target }: AttachmentChange): boolean {
  const attachment = volume.attachments.find(
    (item) => item.instanceId === target.instanceId && item.device === target.device,
  );
  return action === 'attach'
    ? volume.state === 'in-use' && attachment?.state === 'attached'
    : attachment === undefined && volume.state === (volume.attachments.length === 0 ? 'available' : 'in-use');
}

let visits = 0;

export function useVolume(
  endpoint: string | undefined,
  id: string,
  change: AttachmentChange | undefined,
): Ec2Read<VolumeRead> {
  const [visit] = useState(() => (visits += 1));
  const [generation, setGeneration] = useState(0);
  const query = useQuery({
    queryKey: [...VOLUME_KEYS.detail(id), endpoint, visit, generation],
    queryFn: ({ signal }) => getVolume(endpoint ?? noEndpoint(), id, signal),
    enabled: endpoint !== undefined,
    refetchInterval: ({ state }) => {
      const read = state.data;
      if (state.status === 'error' || !read?.found) return false;
      const { volume } = read;
      const moving =
        volume.state === 'creating' ||
        volume.state === 'deleting' ||
        volume.attachments.some(({ state }) => state === 'attaching' || state === 'detaching');
      return moving || (change !== undefined && !attachmentChangeConfirmed(volume, change)) ? READ_AGAIN_MS : false;
    },
    refetchIntervalInBackground: true,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
  const refresh = useCallback(() => {
    setGeneration((current) => current + 1);
  }, []);
  return {
    value: query.isError ? undefined : query.data,
    failure: query.isError ? failureOf(query.error, VOLUME_OPERATIONS.describeVolumes) : undefined,
    loading: endpoint === undefined || query.isPending,
    refresh,
  };
}

/** Call after handing over an accepted create or delete, or after showing an attachment acknowledgment. */
export function useRefreshVolumeData(): (id: string, instanceId?: string) => void {
  const client = useQueryClient();
  return useCallback(
    (id, instanceId) => {
      void client.invalidateQueries({ queryKey: VOLUME_KEYS.list });
      void client.invalidateQueries({ queryKey: VOLUME_KEYS.detail(id) });
      if (instanceId !== undefined) {
        void client.invalidateQueries({ queryKey: EC2_KEYS.instances() });
        void client.invalidateQueries({ queryKey: EC2_KEYS.instance(instanceId) });
        void client.invalidateQueries({ queryKey: EC2_KEYS.choices('volume-instances') });
      }
    },
    [client],
  );
}

export function volumeSnapshotChoices(endpoint: string | undefined): ChoiceSource<VolumeSnapshot> {
  return {
    key: EC2_KEYS.choices('volume-snapshots'),
    endpoint,
    operation: VOLUME_OPERATIONS.describeSnapshots,
    readAgainOnOpen: true,
    read: (at, _text, token, signal) => listVolumeSnapshots(at, token, signal),
    optionOf: ({ id, size, state, volumeId, description }) => ({
      value: id,
      label: id,
      description: [size === undefined ? undefined : `${size} GiB`, state, volumeId, description]
        .filter(Boolean)
        .join(' · '),
    }),
  };
}

export function volumeInstanceChoices(endpoint: string, zone: string | undefined): ChoiceSource<VolumeInstance> {
  return {
    key: [...EC2_KEYS.choices('volume-instances'), zone],
    endpoint: zone === undefined ? undefined : endpoint,
    operation: OPERATIONS.describeInstances,
    readAgainOnOpen: true,
    read: (at, _text, token, signal) =>
      zone === undefined ? noEndpoint() : listVolumeInstances(at, zone, token, signal),
    optionOf: ({ id, name, state, type }) => ({
      value: id,
      label: name ?? id,
      ...(name === undefined ? {} : { labelTag: id }),
      description: [state, type].filter(Boolean).join(' · '),
    }),
  };
}
