import type { Availability } from './status';

// Whether a DB cluster's "Delete" is available, and when it is not, why (issue 573, requirement "Delete a cluster"):
// by the cluster as last read, its members first, then its deletion protection, then its status (plan decision of
// 2026-11-20: the order of the requirement's list).

/** What the rule reads of a DB cluster, as it was last read. */
export interface ClusterDeleteSubject {
  status: string;
  /** How many DB instances the cluster names as its members. */
  memberCount: number;
  deletionProtection: boolean;
}

export const CLUSTER_REASONS = {
  selectOne: 'Select one DB cluster.',
  members: "Delete the cluster's DB instances first.",
  protected: 'Deletion protection is on.',
  deleting: 'This DB cluster is already being deleted.',
} as const;

/** Whether "Delete" is available on `cluster`; none given (no row selected) → "Select one DB cluster." */
export function clusterDeleteAvailability(cluster: ClusterDeleteSubject | undefined): Availability {
  if (cluster === undefined) {
    return { available: false, reason: CLUSTER_REASONS.selectOne };
  }
  if (cluster.memberCount > 0) {
    return { available: false, reason: CLUSTER_REASONS.members };
  }
  if (cluster.deletionProtection) {
    return { available: false, reason: CLUSTER_REASONS.protected };
  }
  if (cluster.status === 'deleting') {
    return { available: false, reason: CLUSTER_REASONS.deleting };
  }
  return { available: true };
}

/** The DB cluster a "Delete" is for, as last read. */
export interface ClusterDeleteTarget extends ClusterDeleteSubject {
  id: string;
}

/** The rule's subject from a DB cluster as last read. */
export function deleteTarget(cluster: {
  id: string;
  status: string;
  members: readonly unknown[];
  deletionProtection: boolean;
}): ClusterDeleteTarget {
  return {
    id: cluster.id,
    status: cluster.status,
    memberCount: cluster.members.length,
    deletionProtection: cluster.deletionProtection,
  };
}
