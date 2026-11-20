import { useState } from 'react';

import type { RequestFailure } from '../../../../../../lib/aws/request';
import { ConfirmDialog } from '../../../components/confirm-dialog';
import type { AreaConnection } from '../../../components/emulator-line';
import { failureOf, usePageSignal } from '../../../components/use-token-listing';
import { SERVICE_CHANGE_OPERATIONS } from '../service-change-api';
import { useDeleteService } from '../service-change-queries';

// "Delete service {name}?" of S4 (issue 575, R4 and design task 6): the area's dialog confirmed by typing the
// service's name, which sends `DeleteService` with `force` itself and says so. It closes on the answer, success or
// failure, and tells its opener once; the result is the opener's flash, which the area's layout holds.

export interface DeleteServiceDialogProps {
  /** The service's name; none while the dialog is closed. */
  service: string | undefined;
  cluster: string;
  connection: AreaConnection;
  /** The emulator answered 200 for the service `name`. */
  onDeleted: (name: string) => void;
  /** The emulator refused, or the request failed. */
  onFailed: (name: string, failure: RequestFailure) => void;
  onDismiss: () => void;
}

const BODY =
  'The service is deleted in the local emulator: it is no longer listed in its cluster, and its tasks are stopped.';

function Dialog({
  service,
  cluster,
  connection,
  onDeleted,
  onFailed,
  onDismiss,
}: Omit<DeleteServiceDialogProps, 'service'> & { service: string }) {
  const remove = useDeleteService(connection.engineOrigin, cluster);
  const pageSignal = usePageSignal();
  const [pending, setPending] = useState(false);
  const [answered, setAnswered] = useState(false);

  const handleConfirm = () => {
    if (pending || answered) {
      return;
    }
    const signal = pageSignal();
    setPending(true);
    remove(service, signal).then(
      () => {
        if (signal.aborted) return;
        setPending(false);
        setAnswered(true);
        onDeleted(service);
      },
      (error: unknown) => {
        if (signal.aborted) return;
        setPending(false);
        setAnswered(true);
        onFailed(service, failureOf(error, SERVICE_CHANGE_OPERATIONS.deleteService));
      },
    );
  };

  return (
    <ConfirmDialog
      visible={!answered}
      header={`Delete service ${service}?`}
      body={BODY}
      word={service}
      action="Delete"
      pending={pending}
      onConfirm={handleConfirm}
      onDismiss={onDismiss}
    />
  );
}

/** The dialog, mounted only while a service is given, so each opening starts with an empty field. */
export function DeleteServiceDialog({ service, ...props }: DeleteServiceDialogProps) {
  return service === undefined ? null : <Dialog key={service} service={service} {...props} />;
}
