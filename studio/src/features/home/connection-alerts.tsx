import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import ExpandableSection from '@cloudscape-design/components/expandable-section';
import SpaceBetween from '@cloudscape-design/components/space-between';
import type { ReactNode } from 'react';
import type { CheckResult } from '../../lib/engine/engine-client';
import { CommandBlock } from './command-block';
import { BUILD_IMAGE_COMMAND, startEmulatorCommand, startEngineCommand, stopEmulatorCommand } from './commands';

export const RECHECK_LINE = 'Studio checks again every 5 seconds; this page updates on its own.';

/** The emulator reasons that have a recovery step (requirement 3.3): what happened, and how step 1 is worded. */
interface Recovery {
  explanation: (port: number) => string;
  stopLabel: (port: number) => string;
}

const RECOVERIES: Readonly<Record<string, Recovery>> = {
  connection_refused: {
    explanation: () => 'The emulator stopped without cleaning up (killed).',
    stopLabel: () => 'Stop what is left of the emulator',
  },
  tls_untrusted: {
    explanation: () => 'The files on disk belong to another emulator run.',
    stopLabel: (port) => `Stop the emulator on port ${String(port)}`,
  },
  files_unreadable: {
    explanation: (port) => `The engine cannot read the emulator's files for port ${String(port)}.`,
    stopLabel: (port) => `Stop the emulator on port ${String(port)}`,
  },
  timeout: {
    explanation: () => 'The emulator accepts connections but does not answer.',
    stopLabel: () => 'Stop the emulator',
  },
};

function recoveryFor(reason: string): Recovery | undefined {
  return Object.hasOwn(RECOVERIES, reason) ? RECOVERIES[reason] : undefined;
}

export interface ConnectionAlertProps {
  result: CheckResult | undefined;
  /** `http://127.0.0.1:<engine port>`. */
  engineOrigin: string;
  enginePort: number;
  studioPort: number;
  /** A check is in flight; every "Refresh" shows it. */
  refreshing: boolean;
  onRefresh: () => void;
}

function StatusAlert(props: {
  type: 'error' | 'info';
  header: string;
  refresh?: { refreshing: boolean; onRefresh: () => void } | undefined;
  children: ReactNode;
}) {
  const action = props.refresh && (
    <Button ariaLabel="Refresh connection status" loading={props.refresh.refreshing} onClick={props.refresh.onRefresh}>
      Refresh
    </Button>
  );
  return (
    <Alert type={props.type} header={props.header} action={action}>
      <SpaceBetween size="l">
        {props.children}
        <Box variant="p" color="text-body-secondary">
          {RECHECK_LINE}
        </Box>
      </SpaceBetween>
    </Alert>
  );
}

/** Text the engine sent, after its label; always rendered as text. */
function EngineSaid({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Box variant="p">
      <Box variant="span" fontWeight="bold">
        {label}
      </Box>{' '}
      <span style={{ overflowWrap: 'anywhere' }}>{children}</span>
    </Box>
  );
}

function BuildOnce() {
  return (
    <ExpandableSection
      variant="footer"
      headerText="First run? Build the image once, from the root of your EmuForge checkout"
    >
      <CommandBlock label="Build the aws-emulator image" name="build image" command={BUILD_IMAGE_COMMAND} />
    </ExpandableSection>
  );
}

/** The build note, then step 1 to stop (when the reason needs one), then the start command. */
function EmulatorSteps({ port, stopLabel }: { port: number; stopLabel?: string | undefined }) {
  return (
    <SpaceBetween size="l">
      <BuildOnce />
      {stopLabel !== undefined && (
        <CommandBlock
          label={`1. ${stopLabel} (a container started with the command below)`}
          name="stop emulator"
          command={stopEmulatorCommand(port)}
        />
      )}
      <CommandBlock
        label={`${stopLabel !== undefined ? '2. ' : ''}Start the emulator on port ${String(port)}`}
        name="start emulator"
        command={startEmulatorCommand(port)}
      />
    </SpaceBetween>
  );
}

function EngineUnreachableAlert(props: {
  engineOrigin: string;
  enginePort: number;
  studioPort: number;
  emulatorPort: number | undefined;
}) {
  const { engineOrigin, enginePort, studioPort, emulatorPort } = props;
  return (
    <StatusAlert type="error" header="Studio cannot reach the engine">
      <Box variant="p">
        Studio gets no answer it can read from the engine at{' '}
        <span style={{ whiteSpace: 'nowrap' }}>{engineOrigin}</span>. Either the engine is not running on that port, or
        it was started for another Studio origin.
      </Box>
      <SpaceBetween size="xs">
        <CommandBlock
          label={
            <>
              One command covers both, run in <Box variant="code">engine/</Box> of the EmuForge checkout
            </>
          }
          name="start engine"
          command={startEngineCommand({ enginePort, studioPort, emulatorPort })}
        />
        <Box variant="small" color="text-body-secondary">
          {emulatorPort !== undefined ? (
            <>
              <Box variant="code" fontSize="body-s">{`--emulator-port ${String(emulatorPort)}`}</Box> is the emulator
              port the engine last reported.
            </>
          ) : (
            <>
              Add{' '}
              <Box variant="code" fontSize="body-s">
                {'--emulator-port <port>'}
              </Box>{' '}
              if your emulator is not on 9297.
            </>
          )}
        </Box>
      </SpaceBetween>
    </StatusAlert>
  );
}

/** The alert of the latest check's state (requirement 3.2, 3.3), or nothing for Checking and Connected. */
export function ConnectionAlert({
  result,
  engineOrigin,
  enginePort,
  studioPort,
  refreshing,
  onRefresh,
}: ConnectionAlertProps) {
  if (result === undefined) {
    return null;
  }
  const refresh = { refreshing, onRefresh };
  switch (result.kind) {
    case 'connected':
      return null;
    case 'emulator-unreachable': {
      const { port, endpoint } = result.emulator;
      if (result.reason === 'not_started') {
        return (
          <StatusAlert type="info" header={`No emulator is running on port ${String(port)}`}>
            <EmulatorSteps port={port} />
          </StatusAlert>
        );
      }
      const recovery = recoveryFor(result.reason);
      const message = result.message !== '' ? result.message : `The engine gave no message for ${endpoint}.`;
      if (recovery === undefined) {
        return (
          <StatusAlert type="error" header="The engine reports a problem with the emulator" refresh={refresh}>
            <EngineSaid label="Engine message:">{message}</EngineSaid>
          </StatusAlert>
        );
      }
      return (
        <StatusAlert type="error" header="The engine cannot reach the emulator">
          <SpaceBetween size="xs">
            <EngineSaid label="Engine message:">{message}</EngineSaid>
            <Box variant="p">{recovery.explanation(port)}</Box>
          </SpaceBetween>
          <EmulatorSteps port={port} stopLabel={recovery.stopLabel(port)} />
        </StatusAlert>
      );
    }
    case 'engine-unreachable':
      return (
        <EngineUnreachableAlert
          engineOrigin={engineOrigin}
          enginePort={enginePort}
          studioPort={studioPort}
          emulatorPort={result.lastEmulatorPort}
        />
      );
    case 'engine-error':
      return (
        <StatusAlert type="error" header="The engine answered with an error" refresh={refresh}>
          {result.code !== undefined ? (
            <EngineSaid label="Engine error:">
              <Box variant="code" fontSize="body-m">
                {result.code}
              </Box>
              {result.message !== undefined ? `: ${result.message}` : ''}
            </EngineSaid>
          ) : (
            <SpaceBetween size="xs">
              <Box variant="p">
                {result.status >= 200 && result.status < 300
                  ? `The engine answered with HTTP status ${String(result.status)}, not in the form Studio expects.`
                  : `The engine answered with HTTP status ${String(result.status)} and no error code.`}
              </Box>
              {result.message !== undefined && <EngineSaid label="Engine message:">{result.message}</EngineSaid>}
            </SpaceBetween>
          )}
        </StatusAlert>
      );
  }
}
