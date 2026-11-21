import Button from '@cloudscape-design/components/button';
import ButtonDropdown from '@cloudscape-design/components/button-dropdown';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useState } from 'react';

import {
  ACTION_LABELS,
  availability,
  INSTANCE_ACTIONS,
  type ActionTarget,
  type Availability,
  type InstanceAction,
} from '../status';
import { DeleteInstanceDialog } from './delete-instance-dialog';

// A DB instance's four actions (issue 573, design task 3), one part on S1, for the one selected row, and in S3's
// header. It sends nothing: it shows "Start", "Stop", "Reboot" and "Delete", each available by the instance as last
// read and otherwise unavailable with its reason, opens the delete's dialog, and calls `onAction` with the action
// chosen. The page that gives it the instance holds the request, its in-flight state and its answer.

export interface InstanceActionsProps {
  /** The one DB instance; none on S1 while no row is selected. */
  instance: ActionTarget | undefined;
  /** The page's request of an action is in flight: no control acts. */
  pending: boolean;
  /** Group the detail header's lifecycle actions when the viewport is narrow. */
  compact?: boolean;
  /** An action chosen, and for "Delete" confirmed, for `target`. */
  onAction: (action: InstanceAction, target: ActionTarget) => void;
}

const SELECT_ONE = 'Select one DB instance.';

export function InstanceActions({ instance, pending, compact = false, onAction }: InstanceActionsProps) {
  const [deleteFor, setDeleteFor] = useState<ActionTarget>();
  // Kept from the previous render, as React's own pattern for it: once the request ends, the dialog closes.
  const [wasPending, setWasPending] = useState(pending);
  if (pending !== wasPending) {
    setWasPending(pending);
    if (!pending) {
      setDeleteFor(undefined);
    }
  }

  const allowed = (action: InstanceAction): Availability =>
    instance === undefined ? { available: false, reason: SELECT_ONE } : availability(action, instance);

  const handlePress = (action: InstanceAction) => {
    if (instance === undefined || pending || !allowed(action).available) {
      return;
    }
    if (action === 'delete') {
      setDeleteFor(instance);
    } else {
      onAction(action, instance);
    }
  };

  return (
    <>
      {compact ? (
        <ButtonDropdown
          disabled={pending}
          items={INSTANCE_ACTIONS.map((action) => {
            const state = allowed(action);
            return {
              id: action,
              text: ACTION_LABELS[action],
              ...(state.available ? {} : { disabled: true, disabledReason: state.reason }),
            };
          })}
          onItemClick={({ detail }) => {
            const action = INSTANCE_ACTIONS.find((candidate) => candidate === detail.id);
            if (action !== undefined) handlePress(action);
          }}
        >
          Actions
        </ButtonDropdown>
      ) : (
        <SpaceBetween direction="horizontal" size="xs">
          {INSTANCE_ACTIONS.map((action) => {
            const state = allowed(action);
            return (
              <Button
                key={action}
                disabled={pending || !state.available}
                {...(state.available ? {} : { disabledReason: state.reason })}
                onClick={() => {
                  handlePress(action);
                }}
              >
                {ACTION_LABELS[action]}
              </Button>
            );
          })}
        </SpaceBetween>
      )}
      <DeleteInstanceDialog
        visible={deleteFor !== undefined}
        id={deleteFor?.id ?? ''}
        pending={pending}
        onConfirm={() => {
          if (deleteFor !== undefined && !pending) {
            onAction('delete', deleteFor);
          }
        }}
        onDismiss={() => {
          setDeleteFor(undefined);
        }}
      />
    </>
  );
}
