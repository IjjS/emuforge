import { describe, expect, it } from 'vitest';

import { clusterDeleteAvailability, type ClusterDeleteSubject } from './cluster-delete';

const FREE: ClusterDeleteSubject = { status: 'available', memberCount: 0, deletionProtection: false };

function reason(changes: Partial<ClusterDeleteSubject>): string | undefined {
  const state = clusterDeleteAvailability({ ...FREE, ...changes });
  return state.available ? undefined : state.reason;
}

describe("a DB cluster's Delete", () => {
  it('a cluster with no member, protection off, available → available', () => {
    expect(clusterDeleteAvailability(FREE)).toEqual({ available: true });
  });

  it('each reason, and with several the first of members, protection, status', () => {
    expect(reason({ memberCount: 1 })).toBe("Delete the cluster's DB instances first, each from its own page.");
    expect(reason({ deletionProtection: true })).toBe('Deletion protection is on.');
    expect(reason({ status: 'deleting' })).toBe('This DB cluster is already being deleted.');
    expect(reason({ memberCount: 2, deletionProtection: true })).toBe(
      "Delete the cluster's DB instances first, each from its own page.",
    );
    expect(reason({ deletionProtection: true, status: 'deleting' })).toBe('Deletion protection is on.');
  });

  it('none selected → "Select one DB cluster."', () => {
    expect(clusterDeleteAvailability(undefined)).toEqual({ available: false, reason: 'Select one DB cluster.' });
  });
});
