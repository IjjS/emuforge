import ButtonDropdown, { type ButtonDropdownProps } from '@cloudscape-design/components/button-dropdown';
import { useState } from 'react';

import type { AreaConnection } from '../../../components/emulator-line';
import { actionFailureItem } from '../../../components/failure-states';
import { usePageFlash } from '../../../components/page-flash';
import { failureOf, usePageSignal } from '../../../components/use-token-listing';
import { ACTION_OPERATIONS } from '../api';
import { availability, INSTANCE_ACTIONS, type InstanceAction } from '../instance-state';
import { useInstanceAction } from '../queries';
import { TerminateDialog } from './terminate-dialog';

// The instance's actions (issue 553, design task 3), one part on S1, for the one selected row, and in S3's header:
// "Start", "Stop", "Reboot" send their operation at once; "Terminate" opens the dialog. Each is available by the state
// last read and otherwise shown disabled with its reason, as items of one "Instance state" menu with "Terminate" last
// in a group of its own. While a request is in flight the menu is unavailable.
// The result goes to the area's flash: what was asked, never that it is done.

/** The instance the actions are for: its ID, its state last read, and its name when it has one. */
export interface ActionTarget {
  id: string;
  state: string;
  name?: string;
}

export interface InstanceActionsProps {
  /** The one instance; none on S1 while no row is selected. */
  instance: ActionTarget | undefined;
  connection: AreaConnection;
}

const SELECT_ONE = 'Select one instance.';

/** The menu's button (issue 553, critique final P2 4: one control for the four, "Terminate" last and set apart). */
const MENU = 'Instance state';

const LABELS: Readonly<Record<InstanceAction, string>> = {
  start: 'Start',
  stop: 'Stop',
  reboot: 'Reboot',
  terminate: 'Terminate',
};

const RESULTS: Readonly<Record<InstanceAction, string>> = {
  start: 'Starting',
  stop: 'Stopping',
  reboot: 'Rebooting',
  terminate: 'Terminating',
};

export function InstanceActions({ instance, connection }: InstanceActionsProps) {
  const flash = usePageFlash();
  const pageSignal = usePageSignal();
  const act = useInstanceAction(connection.engineOrigin);
  const [inFlight, setInFlight] = useState<InstanceAction>();
  const [terminateFor, setTerminateFor] = useState<ActionTarget>();

  const send = (action: InstanceAction, target: ActionTarget) => {
    if (inFlight !== undefined) {
      return;
    }
    const signal = pageSignal();
    setInFlight(action);
    act(action, target.id, signal).then(
      () => {
        if (signal.aborted) {
          return;
        }
        setInFlight(undefined);
        setTerminateFor(undefined);
        flash.show([{ type: 'success', content: `${RESULTS[action]} ${target.id}` }]);
      },
      (error: unknown) => {
        if (signal.aborted) {
          return;
        }
        setInFlight(undefined);
        setTerminateFor(undefined);
        flash.show([
          actionFailureItem(
            failureOf(error, ACTION_OPERATIONS[action]),
            `${LABELS[action]} instance ${target.id}`,
            connection.engineOrigin,
          ),
        ]);
      },
    );
  };

  const handlePress = (action: InstanceAction) => {
    if (instance === undefined || inFlight !== undefined) {
      return;
    }
    if (action === 'terminate') {
      setTerminateFor(instance);
    } else {
      send(action, instance);
    }
  };

  const allowed = (action: InstanceAction) =>
    instance === undefined ? ({ available: false, reason: SELECT_ONE } as const) : availability(action, instance.state);
  const item = (action: InstanceAction): ButtonDropdownProps.Item => {
    const state = allowed(action);
    return state.available
      ? { id: action, text: LABELS[action] }
      : { id: action, text: LABELS[action], disabled: true, disabledReason: state.reason };
  };

  return (
    <>
      <ButtonDropdown
        items={[
          { items: INSTANCE_ACTIONS.filter((action) => action !== 'terminate').map(item) },
          { items: [item('terminate')] },
        ]}
        loading={inFlight !== undefined}
        {...(inFlight === undefined || instance === undefined
          ? {}
          : { loadingText: `${RESULTS[inFlight]} ${instance.id}` })}
        onItemClick={({ detail }) => {
          const action = INSTANCE_ACTIONS.find((candidate) => candidate === detail.id);
          if (action !== undefined && allowed(action).available) {
            handlePress(action);
          }
        }}
      >
        {MENU}
      </ButtonDropdown>
      <TerminateDialog
        visible={terminateFor !== undefined}
        label={terminateFor?.name ?? terminateFor?.id ?? ''}
        pending={inFlight === 'terminate'}
        onConfirm={() => {
          if (terminateFor !== undefined) {
            send('terminate', terminateFor);
          }
        }}
        onDismiss={() => {
          setTerminateFor(undefined);
        }}
      />
    </>
  );
}
