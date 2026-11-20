import Box from '@cloudscape-design/components/box';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import { useState } from 'react';

import type { RequestFailure } from '../../../../../../lib/aws/request';
import { ConfirmDialog } from '../../../components/confirm-dialog';
import type { AreaConnection } from '../../../components/emulator-line';
import { actionFailureItem, CodeAndMessage } from '../../../components/failure-states';
import { failureOf, usePageSignal } from '../../../components/use-token-listing';
import { OPERATIONS } from '../api';
import { useDeleteCluster } from '../queries';

// "Delete cluster {name}?" (issue 575, design task 5), from S1 and S3: the area's dialog confirmed by typing the
// cluster's name, which sends `DeleteCluster` itself. A refusal (a cluster that still holds a service or a task) is
// one a developer acts on and tries again, so it is shown in the dialog, which stays open and starts no read. Its
// success closes it and tells its opener once.

export interface DeleteClusterDialogProps {
  /** The cluster's name; none while the dialog is closed. */
  cluster: string | undefined;
  connection: AreaConnection;
  /** The emulator answered 200 for the cluster `name`. */
  onDeleted: (name: string) => void;
  onDismiss: () => void;
}

const SENTENCE =
  'The cluster is removed from the local emulator. The emulator refuses while the cluster has an active service or a task that is not stopped.';

/** The failure in the dialog: inline elements only, since the dialog's body is a paragraph. */
function Failure({
  failure,
  cluster,
  engineOrigin,
}: {
  failure: RequestFailure;
  cluster: string;
  engineOrigin?: string;
}) {
  const item =
    failure.kind === 'other'
      ? {
          type: 'error' as const,
          header: 'The emulator did not delete the cluster.',
          content: <CodeAndMessage code={failure.code} message={failure.message} />,
        }
      : actionFailureItem(failure, `Deleting cluster ${cluster}`, engineOrigin);
  return (
    <Box variant="span" display="block" margin={{ top: 's' }}>
      <span role="alert">
        <StatusIndicator type={item.type === 'info' ? 'info' : 'error'}>{item.header}</StatusIndicator>
        {item.content !== undefined && <> {item.content}</>}
      </span>
    </Box>
  );
}

function Dialog({
  cluster,
  connection,
  onDeleted,
  onDismiss,
}: Omit<DeleteClusterDialogProps, 'cluster'> & { cluster: string }) {
  const remove = useDeleteCluster(connection.engineOrigin);
  const pageSignal = usePageSignal();
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<RequestFailure>();
  const [deleted, setDeleted] = useState(false);

  const handleConfirm = () => {
    if (pending) {
      return;
    }
    const signal = pageSignal();
    setPending(true);
    setFailure(undefined);
    remove(cluster, signal).then(
      () => {
        if (signal.aborted) return;
        setPending(false);
        setDeleted(true);
        onDeleted(cluster);
      },
      (error: unknown) => {
        if (signal.aborted) return;
        setPending(false);
        setFailure(failureOf(error, OPERATIONS.deleteCluster));
      },
    );
  };

  return (
    <ConfirmDialog
      visible={!deleted}
      header={`Delete cluster ${cluster}?`}
      body={
        <>
          {SENTENCE}
          {failure !== undefined && (
            <Failure
              failure={failure}
              cluster={cluster}
              {...(connection.engineOrigin === undefined ? {} : { engineOrigin: connection.engineOrigin })}
            />
          )}
        </>
      }
      word={cluster}
      action="Delete"
      pending={pending}
      onConfirm={handleConfirm}
      onDismiss={onDismiss}
    />
  );
}

/** The dialog, mounted only while a cluster is given, so each opening starts with an empty field and no failure. */
export function DeleteClusterDialog({ cluster, ...props }: DeleteClusterDialogProps) {
  return cluster === undefined ? null : <Dialog key={cluster} cluster={cluster} {...props} />;
}
