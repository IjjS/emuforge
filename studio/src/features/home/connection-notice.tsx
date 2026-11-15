import type { ReactNode } from 'react';

import type { CheckResult } from '../../lib/engine/engine-client';
import { Button } from '../../ui/button';
import { InlineCode, Steps } from '../../ui/command';
import { Disclosure } from '../../ui/disclosure';
import { RefreshIcon } from '../../ui/icons';
import { Notice } from '../../ui/notice';
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

export interface ConnectionNoticeProps {
  result: CheckResult | undefined;
  /** `http://127.0.0.1:<engine port>`. */
  engineOrigin: string;
  enginePort: number;
  studioPort: number;
  /** A check is in flight; every "Refresh" shows it. */
  refreshing: boolean;
  onRefresh: () => void;
}

/** A notice of the connection: its heading (and "Refresh", where it has one), the re-check line, then its content. */
function StatusNotice(props: {
  kind: 'err' | 'info';
  title: string;
  refresh?: { refreshing: boolean; onRefresh: () => void } | undefined;
  children: ReactNode;
}) {
  const action = props.refresh && (
    <Button
      small
      icon={<RefreshIcon />}
      busy={props.refresh.refreshing}
      ariaLabel="Refresh connection status"
      onClick={props.refresh.onRefresh}
    >
      Refresh
    </Button>
  );
  return (
    <Notice kind={props.kind} title={props.title} action={action}>
      <p className="st-recheck">{RECHECK_LINE}</p>
      {props.children}
    </Notice>
  );
}

/** Text the engine sent, after its label; always rendered as text. */
function EngineSaid({ label, children }: { label: string; children: ReactNode }) {
  return (
    <p className="st-said">
      <span className="st-said-label">{label}</span> <span className="st-said-text">{children}</span>
    </p>
  );
}

/** The engine's message about the emulator; Studio's own words, unlabelled, when the engine sent none. */
function EmulatorMessage({ message, endpoint }: { message: string; endpoint: string }) {
  if (message === '') {
    return <p>{`The engine gave no message for ${endpoint}.`}</p>;
  }
  return <EngineSaid label="Engine message:">{message}</EngineSaid>;
}

function BuildOnce() {
  return (
    <Disclosure summary="First run? Build the image once, from the root of your EmuForge checkout">
      <CommandBlock label="Build the aws-emulator image" name="build image" command={BUILD_IMAGE_COMMAND} />
    </Disclosure>
  );
}

/** The build note, then step 1 to stop (when the reason needs one), then the start command. */
function EmulatorSteps({ port, stopLabel }: { port: number; stopLabel?: string | undefined }) {
  return (
    <Steps>
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
    </Steps>
  );
}

function EngineUnreachableNotice(props: {
  engineOrigin: string;
  enginePort: number;
  studioPort: number;
  emulatorPort: number | undefined;
}) {
  const { engineOrigin, enginePort, studioPort, emulatorPort } = props;
  return (
    <StatusNotice kind="err" title="Studio cannot reach the engine">
      <p>
        Studio gets no answer it can read from the engine at <span className="st-nowrap">{engineOrigin}</span>. Either
        the engine is not running on that port, or it was started for another Studio origin.
      </p>
      <Steps>
        <CommandBlock
          label={
            <>
              One command covers both, run in <InlineCode>engine/</InlineCode> of the EmuForge checkout
            </>
          }
          name="start engine"
          command={startEngineCommand({ enginePort, studioPort, emulatorPort })}
        />
      </Steps>
      <p className="st-note">
        {emulatorPort !== undefined ? (
          <>
            <InlineCode>{`--emulator-port ${String(emulatorPort)}`}</InlineCode> is the emulator port the engine last
            reported.
          </>
        ) : (
          <>
            Add <InlineCode>{'--emulator-port <port>'}</InlineCode> if your emulator is not on 9297.
          </>
        )}
      </p>
    </StatusNotice>
  );
}

/** The notice of the latest check's state (requirement 3.2, 3.3), or nothing for Checking and Connected. */
export function ConnectionNotice({
  result,
  engineOrigin,
  enginePort,
  studioPort,
  refreshing,
  onRefresh,
}: ConnectionNoticeProps) {
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
          <StatusNotice kind="info" title={`No emulator is running on port ${String(port)}`}>
            <EmulatorSteps port={port} />
          </StatusNotice>
        );
      }
      const recovery = recoveryFor(result.reason);
      if (recovery === undefined) {
        return (
          <StatusNotice kind="err" title="The engine reports a problem with the emulator" refresh={refresh}>
            <EmulatorMessage message={result.message} endpoint={endpoint} />
          </StatusNotice>
        );
      }
      return (
        <StatusNotice kind="err" title="The engine cannot reach the emulator">
          <EmulatorMessage message={result.message} endpoint={endpoint} />
          <p>{recovery.explanation(port)}</p>
          <EmulatorSteps port={port} stopLabel={recovery.stopLabel(port)} />
        </StatusNotice>
      );
    }
    case 'engine-unreachable':
      return (
        <EngineUnreachableNotice
          engineOrigin={engineOrigin}
          enginePort={enginePort}
          studioPort={studioPort}
          emulatorPort={result.lastEmulatorPort}
        />
      );
    case 'engine-error':
      return (
        <StatusNotice kind="err" title="The engine answered with an error" refresh={refresh}>
          {result.code !== undefined ? (
            <EngineSaid label="Engine error:">
              <InlineCode>{result.code}</InlineCode>
              {result.message !== undefined ? `: ${result.message}` : ''}
            </EngineSaid>
          ) : (
            <>
              <p>
                {result.status >= 200 && result.status < 300
                  ? `The engine answered with HTTP status ${String(result.status)}, not in the form Studio expects.`
                  : `The engine answered with HTTP status ${String(result.status)} and no error code.`}
              </p>
              {result.message !== undefined && <EngineSaid label="Engine message:">{result.message}</EngineSaid>}
            </>
          )}
        </StatusNotice>
      );
  }
}
