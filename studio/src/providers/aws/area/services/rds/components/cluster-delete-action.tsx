import Button from '@cloudscape-design/components/button';
import { useState } from 'react';

import { clusterDeleteAvailability, type ClusterDeleteTarget } from '../cluster-delete';
import { DeleteClusterDialog } from './delete-cluster-dialog';

// A DB cluster's "Delete" (issue 573, design task 4), on S4 for the one selected row and in S6's header. It sends
// nothing: it shows the control, available by the cluster as last read and otherwise unavailable with its reason,
// opens the dialog, and calls `onDelete` once the word is typed. The page holds the request and its answer.

export interface ClusterDeleteActionProps {
  /** The one DB cluster; none on S4 while no row is selected. */
  cluster: ClusterDeleteTarget | undefined;
  /** The page's request is in flight: the control does not act. */
  pending: boolean;
  onDelete: (id: string) => void;
}

export function ClusterDeleteAction({ cluster, pending, onDelete }: ClusterDeleteActionProps) {
  const [deleteFor, setDeleteFor] = useState<string>();
  // Kept from the previous render, as React's own pattern for it: once the request ends, the dialog closes.
  const [wasPending, setWasPending] = useState(pending);
  if (pending !== wasPending) {
    setWasPending(pending);
    if (!pending) {
      setDeleteFor(undefined);
    }
  }
  const state = clusterDeleteAvailability(cluster);
  return (
    <>
      <Button
        disabled={pending || !state.available}
        {...(state.available ? {} : { disabledReason: state.reason })}
        onClick={() => {
          if (cluster !== undefined && !pending && state.available) {
            setDeleteFor(cluster.id);
          }
        }}
      >
        Delete
      </Button>
      <DeleteClusterDialog
        visible={deleteFor !== undefined}
        id={deleteFor ?? ''}
        pending={pending}
        onConfirm={() => {
          if (deleteFor !== undefined && !pending) {
            onDelete(deleteFor);
          }
        }}
        onDismiss={() => {
          setDeleteFor(undefined);
        }}
      />
    </>
  );
}
