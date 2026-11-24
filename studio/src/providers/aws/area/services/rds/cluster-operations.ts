import type { DbCluster } from './cluster-api';

export interface ClusterChanges {
  deletionProtection?: boolean;
  backupRetentionPeriod?: number;
}

export type ClusterOperation =
  { kind: 'stop' | 'start' } | { kind: 'modify'; changes: ClusterChanges } | { kind: 'failover'; target: string };

export type ClusterAction = ClusterOperation['kind'];

export const CLUSTER_ACTIONS = {
  stop: { label: 'Stop', operation: 'StopDBCluster' },
  start: { label: 'Start', operation: 'StartDBCluster' },
  modify: { label: 'Modify', operation: 'ModifyDBCluster' },
  failover: { label: 'Fail over', operation: 'FailoverDBCluster' },
} as const;

export function clusterActionResult(action: ClusterAction, id: string): string {
  switch (action) {
    case 'stop':
      return `Stopping DB cluster ${id}`;
    case 'start':
      return `Starting DB cluster ${id}`;
    case 'modify':
      return `DB cluster ${id} updated`;
    case 'failover':
      return `Failing over DB cluster ${id}`;
  }
}

export function clusterReaders(cluster: DbCluster): string[] {
  return cluster.members.filter((member) => !member.writer).map((member) => member.id);
}

export function clusterActionReason(action: ClusterAction, cluster: DbCluster): string | undefined {
  switch (action) {
    case 'stop':
      return cluster.status === 'available' ? undefined : 'Only an available DB cluster can be stopped.';
    case 'start':
      return cluster.status === 'stopped' ? undefined : 'Only a stopped DB cluster can be started.';
    case 'modify':
      return undefined;
    case 'failover':
      if (clusterReaders(cluster).length === 0) {
        return 'Failover requires a reader DB instance in this cluster.';
      }
      return cluster.status === 'available' ? undefined : 'Only an available DB cluster can fail over.';
  }
}

export function retentionDays(value: string): number | undefined {
  const days = Number(value);
  return /^\d+$/.test(value.trim()) && days >= 1 && days <= 35 ? days : undefined;
}
