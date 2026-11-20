import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useState } from 'react';

import type { RequestFailure } from '../../../../../../lib/aws/request';
import { AreaModal } from '../../../components/area-modal';
import type { AreaConnection } from '../../../components/emulator-line';
import { failureOf, usePageSignal } from '../../../components/use-token-listing';
import { TASK_OPERATIONS } from '../task-api';
import { useStopTask } from '../task-queries';

// "Stop task {task}?" (issue 575, R4, S5): the area's modal with no word to type, since nothing is removed, which
// sends `StopTask` itself. It closes on the answer, success or failure, before any read the stop started answers, and
// tells its opener once; the result is the opener's flash, which the area's layout holds.

export interface StopTaskDialogProps {
  /** The task's id; none while the dialog is closed. */
  task: string | undefined;
  cluster: string;
  connection: AreaConnection;
  /** The emulator answered 200: the task is stopping. */
  onStopped: (task: string) => void;
  /** The emulator refused, or the request failed. */
  onFailed: (task: string, failure: RequestFailure) => void;
  onDismiss: () => void;
}

const BODY = 'The task is stopped in the local emulator.';

function Dialog({
  task,
  cluster,
  connection,
  onStopped,
  onFailed,
  onDismiss,
}: Omit<StopTaskDialogProps, 'task'> & { task: string }) {
  const stop = useStopTask(connection.engineOrigin, cluster);
  const pageSignal = usePageSignal();
  const [pending, setPending] = useState(false);
  const [answered, setAnswered] = useState(false);

  const handleConfirm = () => {
    if (pending || answered) {
      return;
    }
    const signal = pageSignal();
    setPending(true);
    stop(task, signal).then(
      () => {
        if (signal.aborted) return;
        setPending(false);
        setAnswered(true);
        onStopped(task);
      },
      (error: unknown) => {
        if (signal.aborted) return;
        setPending(false);
        setAnswered(true);
        onFailed(task, failureOf(error, TASK_OPERATIONS.stopTask));
      },
    );
  };
  const handleDismiss = () => {
    if (!pending) {
      onDismiss();
    }
  };

  return (
    <AreaModal
      visible={!answered}
      header={`Stop task ${task}?`}
      closeAriaLabel="Close dialog"
      onDismiss={handleDismiss}
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" disabled={pending} onClick={handleDismiss}>
              Cancel
            </Button>
            <Button variant="primary" disabled={pending} loading={pending} onClick={handleConfirm}>
              Stop task
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <Box variant="p">{BODY}</Box>
    </AreaModal>
  );
}

/** The dialog, mounted only while a task is given, so each opening starts afresh. */
export function StopTaskDialog({ task, ...props }: StopTaskDialogProps) {
  return task === undefined ? null : <Dialog key={task} task={task} {...props} />;
}
