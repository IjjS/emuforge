import type { ReactNode } from 'react';

import type { MessageKey } from '../../i18n/catalogue';
import { useLanguage } from '../../i18n/language-context';
import type { CheckResult } from '../../lib/engine/engine-client';
import { Button } from '../../ui/button';
import { InlineCode, Steps } from '../../ui/command';
import { Disclosure } from '../../ui/disclosure';
import { RefreshIcon } from '../../ui/icons';
import { Notice } from '../../ui/notice';
import { CommandBlock } from './command-block';
import { BUILD_IMAGE_COMMAND, startEmulatorCommand, startEngineCommand, stopEmulatorCommand } from './commands';
import { RECHECK_MS } from './use-connection-check';

/** The image the build-once command builds and every start command runs. */
const IMAGE = 'aws-emulator';

/** The engine's default emulator port, as its start command names it without `--emulator-port`. */
const DEFAULT_EMULATOR_PORT = 9297;

/**
 * The emulator reasons that have a recovery step (requirement 3.3): what happened, and step 1's label. Each is one
 * message, with the port and the container as placeholders (requirement R4.4).
 */
interface Recovery {
  explanation: MessageKey;
  stopStep: MessageKey;
}

const RECOVERIES: Readonly<Record<string, Recovery>> = {
  connection_refused: { explanation: 'notice.killed', stopStep: 'notice.stopLeftover' },
  tls_untrusted: { explanation: 'notice.tlsUntrusted', stopStep: 'notice.stopOnPort' },
  files_unreadable: { explanation: 'notice.filesUnreadable', stopStep: 'notice.stopOnPort' },
  timeout: { explanation: 'notice.timeout', stopStep: 'notice.stop' },
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
  const { t, plural } = useLanguage();
  const action = props.refresh && (
    <Button
      small
      icon={<RefreshIcon />}
      busy={props.refresh.refreshing}
      ariaLabel={t('notice.refreshName')}
      onClick={props.refresh.onRefresh}
    >
      {t('notice.refresh')}
    </Button>
  );
  return (
    <Notice kind={props.kind} title={props.title} action={action}>
      <p className="st-recheck">{plural('notice.recheck', RECHECK_MS / 1000)}</p>
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

/** The engine's `message`, as it was sent: English text, in every language, and its element says so (R4.3). */
function EngineText({ children }: { children: string }) {
  return <span lang="en">{children}</span>;
}

/** The engine's message about the emulator; Studio's own words, unlabelled, when the engine sent none. */
function EmulatorMessage({ message, endpoint }: { message: string; endpoint: string }) {
  const { t } = useLanguage();
  if (message === '') {
    return <p>{t('notice.noEngineMessage', { endpoint })}</p>;
  }
  return (
    <EngineSaid label={t('notice.engineMessage')}>
      <EngineText>{message}</EngineText>
    </EngineSaid>
  );
}

function BuildOnce() {
  const { t } = useLanguage();
  return (
    <Disclosure summary={t('notice.buildOnce')}>
      <CommandBlock
        label={t('notice.buildImage', { image: IMAGE })}
        name={t('command.build')}
        command={BUILD_IMAGE_COMMAND}
      />
    </Disclosure>
  );
}

/** The build note, then step 1 to stop (when the reason needs one), then the start command. */
function EmulatorSteps({ port, stopStep }: { port: number; stopStep?: MessageKey | undefined }) {
  const { t } = useLanguage();
  const portText = String(port);
  return (
    <Steps>
      <BuildOnce />
      {stopStep !== undefined && (
        <CommandBlock
          // Step 1 names the container the stop command removes and step 2 starts; the name is never broken across
          // lines (issue 18).
          label={t(stopStep, {
            port: portText,
            container: <span className="st-nowrap">{`emuforge-emulator-${portText}`}</span>,
          })}
          name={t('command.stop')}
          command={stopEmulatorCommand(port)}
        />
      )}
      <CommandBlock
        label={t(stopStep !== undefined ? 'notice.startStep' : 'notice.start', { port: portText })}
        name={t('command.start')}
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
  const { t } = useLanguage();
  return (
    <StatusNotice kind="err" title={t('notice.engineUnreachable')}>
      <p>{t('notice.noEngineAnswer', { origin: <span className="st-nowrap">{engineOrigin}</span> })}</p>
      <Steps>
        <CommandBlock
          label={t('notice.startEngine', { folder: <InlineCode>engine/</InlineCode> })}
          name={t('command.startEngine')}
          command={startEngineCommand({ enginePort, studioPort, emulatorPort })}
        />
      </Steps>
      <p className="st-note">
        {emulatorPort !== undefined
          ? t('notice.lastEmulatorPort', {
              option: <InlineCode>{`--emulator-port ${String(emulatorPort)}`}</InlineCode>,
            })
          : t('notice.addEmulatorPort', {
              option: <InlineCode>{'--emulator-port <port>'}</InlineCode>,
              port: String(DEFAULT_EMULATOR_PORT),
            })}
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
  const { t } = useLanguage();
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
          <StatusNotice kind="info" title={t('notice.notStarted', { port: String(port) })}>
            <EmulatorSteps port={port} />
          </StatusNotice>
        );
      }
      const recovery = recoveryFor(result.reason);
      if (recovery === undefined) {
        return (
          <StatusNotice kind="err" title={t('notice.unknownReason')} refresh={refresh}>
            <EmulatorMessage message={result.message} endpoint={endpoint} />
          </StatusNotice>
        );
      }
      return (
        <StatusNotice kind="err" title={t('notice.emulatorUnreachable')}>
          <EmulatorMessage message={result.message} endpoint={endpoint} />
          <p>{t(recovery.explanation, { port: String(port) })}</p>
          <EmulatorSteps port={port} stopStep={recovery.stopStep} />
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
        <StatusNotice kind="err" title={t('notice.engineError')} refresh={refresh}>
          {result.code !== undefined ? (
            <EngineSaid label={t('notice.engineErrorLabel')}>
              {result.message !== undefined ? (
                // One message, so each language writes the separator between the code and the message its own way.
                t('notice.codeAndMessage', {
                  code: <InlineCode>{result.code}</InlineCode>,
                  message: <EngineText>{result.message}</EngineText>,
                })
              ) : (
                <InlineCode>{result.code}</InlineCode>
              )}
            </EngineSaid>
          ) : (
            <>
              <p>
                {t(result.status >= 200 && result.status < 300 ? 'notice.unexpectedAnswer' : 'notice.noErrorCode', {
                  status: String(result.status),
                })}
              </p>
              {result.message !== undefined && (
                <EngineSaid label={t('notice.engineMessage')}>
                  <EngineText>{result.message}</EngineText>
                </EngineSaid>
              )}
            </>
          )}
        </StatusNotice>
      );
  }
}
