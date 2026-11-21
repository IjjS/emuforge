import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import Link from '@cloudscape-design/components/link';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Tabs, { type TabsProps } from '@cloudscape-design/components/tabs';
import { useCallback, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';

import { actionFailureItem, Code } from '../../../components/failure-states';
import { useShowsResources } from '../../../components/page-resources';
import { useFollow } from '../../../components/use-follow';
import { ValueText } from '../../../components/value-text';
import type { AreaConnection } from '../../../components/emulator-line';
import { usePageFlash, type FlashResult } from '../../../components/page-flash';
import type { ScreenPageProps } from '../../../screens';
import type { LambdaFunction } from '../api';
import { CodeTab } from '../components/code-tab';
import { ConfigurationTab } from '../components/configuration-tab';
import { DeleteFunctionsDialog } from '../components/delete-functions-dialog';
import { readFailureState, useAnnouncer } from '../components/failure-states';
import { ReadFailure } from '../components/failures';
import { FunctionOverview, FunctionStatusLine } from '../components/function-sections';
import { functionStatus } from '../components/function-status';
import { MonitorTab } from '../components/monitor-tab';
import { quoting } from '../components/quoting';
import { InvocationResult, TestTab, type TestTabProps } from '../components/test-tab';
import { VersionsTab, type VersionsTabProps } from '../components/versions-tab';
import { FUNCTIONS_PATH, functionTabHref, releaseSuccessText, TAB_PARAMETER, tabOf } from '../format';
import { isChanging, useFunctionReading, useInvoke, useReadAgain } from '../queries';
import { useReleaseMutation, useReleaseReadings } from '../version-queries';

// A Lambda function's own page (issue 84, requirement R5, R10; issue 516, design "The function's page"): its header
// with "Refresh" and "Delete", "Function overview", then the tabs, each addressed
// by the query of the function's one address (`?tab=`), so the page stays mounted across them. Every value from the
// engine or the emulator is rendered as text, each as the kind of value it is (issue 467, requirement R6). The `h1`
// has no description but the status line (issue 467, R3): the area's frame says where the function is.

const REFRESHED = 'Function refreshed';
/** The dialog's names while it is closed; one array, so the dialog does not take a new render for a new one. */
const NO_NAMES: readonly string[] = [];
const READY = 'Function ready';

/** The event text "Test" holds when the page opens. */
export const INITIAL_EVENT = '{}';

interface FunctionTabsProps {
  name: string;
  fn: LambdaFunction;
  connection: AreaConnection;
  ready: boolean;
  test: Omit<TestTabProps, 'functionName' | 'connection' | 'versions' | 'aliases'>;
  releases: Pick<VersionsTabProps, 'versions' | 'aliases' | 'mutation'>;
  active: ReturnType<typeof tabOf>;
  onMonitorRefreshSettled: ((message: string) => void) | undefined;
}

/**
 * The active tab is read from `?tab=`, and choosing one changes the query alone, as
 * a new entry of the history. Cloudscape renders only the active tab's content, so what "Test" keeps lives here.
 */
function FunctionTabs({
  name,
  fn,
  connection,
  ready,
  test,
  releases,
  active,
  onMonitorRefreshSettled,
}: FunctionTabsProps) {
  const navigate = useNavigate();
  const endpoint = connection.engineOrigin;
  const handleChange = useCallback(
    ({ detail }: { detail: TabsProps.ChangeDetail }) => {
      if (detail.activeTabHref !== undefined) {
        void navigate(detail.activeTabHref);
      }
    },
    [navigate],
  );
  const tabs: TabsProps.Tab[] = [
    {
      id: 'test',
      label: 'Test',
      href: functionTabHref(name, 'test'),
      content: (
        <TestTab
          {...test}
          functionName={name}
          connection={connection}
          versions={releases.versions}
          aliases={releases.aliases}
        />
      ),
    },
    {
      id: 'code',
      label: 'Code',
      href: functionTabHref(name, 'code'),
      content: <CodeTab fn={fn} name={name} connection={connection} ready={ready} />,
    },
    {
      id: 'monitor',
      label: 'Monitor',
      href: functionTabHref(name, 'monitor'),
      content:
        endpoint !== undefined && connection.result?.kind === 'connected' ? (
          <MonitorTab
            endpoint={endpoint}
            name={name}
            logGroup={fn.logGroup}
            onRefreshSettled={onMonitorRefreshSettled}
          />
        ) : (
          <Container>
            <Box textAlign="center">Monitoring data is available when the emulator is connected.</Box>
          </Container>
        ),
    },
    {
      id: 'configuration',
      label: 'Configuration',
      href: functionTabHref(name, 'configuration'),
      content: <ConfigurationTab fn={fn} name={name} connection={connection} ready={ready} />,
    },
    {
      id: 'versions',
      label: 'Versions and aliases',
      href: functionTabHref(name, 'versions'),
      content:
        endpoint !== undefined && connection.result?.kind === 'connected' ? (
          <VersionsTab {...releases} connection={connection} ready={ready} />
        ) : (
          <Container>
            <Box textAlign="center">Versions and aliases are available when the emulator is connected.</Box>
          </Container>
        ),
    },
  ];
  return (
    <Tabs
      tabs={tabs}
      activeTabId={active}
      onChange={handleChange}
      // An arrow key moves between the tabs; Enter or a click chooses one, so the history holds only tabs chosen.
      keyboardActivationMode="manual"
      ariaLabel="Function tabs"
    />
  );
}

/** "Function not found" (R5.6), with Cloudscape's empty-state pattern, in the place of the tabs and sections. */
function NotFound({ name }: { name: string }) {
  const handleFollow = useFollow();
  return (
    <Container>
      <Box textAlign="center" color="inherit">
        <SpaceBetween size="xxs">
          <Box variant="strong" color="inherit">
            Function not found
          </Box>
          <Box variant="p" color="inherit">
            {quoting(
              'The emulator holds no function named “',
              name,
              '”. It may have been deleted, or the emulator restarted.',
            )}
          </Box>
          <Link href={FUNCTIONS_PATH} onFollow={handleFollow}>
            Event Functions
          </Link>
        </SpaceBetween>
      </Box>
    </Container>
  );
}

/**
 * `/aws/lambda/functions/function/{name}`: the function `name`, read through the engine with `GetFunction` and
 * `GetFunctionUrlConfig` on every opening and refresh (R5.1), and after each invoke and change. While it is being
 * created or updated it is read again by itself (R5.2, in the reading's hook), and its tabs are told it is not ready; a
 * failed read is read again once the connection is connected again (R10.2). The event text, the invoke in flight and
 * its last result are kept here while the page is mounted, so across its tabs, and nowhere else.
 */
export function FunctionPage({ connection, params }: ScreenPageProps) {
  useShowsResources('functions');
  const name = params['name'] ?? '';
  const [searchParams] = useSearchParams();
  const active = tabOf(searchParams.get(TAB_PARAMETER));
  const [announcement, announce] = useAnnouncer();
  const result = connection.result;
  const connected = result?.kind === 'connected';
  const reading = useFunctionReading({
    endpoint: connection.engineOrigin,
    name,
    connected,
    disconnected: connection.result !== undefined && connection.result.kind !== 'connected',
    emulatorIdentity: connected ? JSON.stringify([result.emulator.endpoint, result.target]) : undefined,
    revalidateOnReconnect: active === 'monitor' || active === 'versions' || active === 'test',
  });
  const { read, failure, refresh } = reading;
  const fn = read?.found === true ? read.function : undefined;
  const ready = !isChanging(read);
  const flash = usePageFlash();
  const reread = useReadAgain(connection.engineOrigin, name);
  const releaseScope = JSON.stringify([connection.engineOrigin, name, reading.session]);
  const invoke = useInvoke(connection.engineOrigin, name, reading.session);
  const [test, setTest] = useState({
    scope: releaseScope,
    eventText: INITIAL_EVENT,
    qualifier: undefined as string | undefined,
    targetUnavailable: false,
  });
  if (test.scope !== releaseScope) {
    setTest({ scope: releaseScope, eventText: INITIAL_EVENT, qualifier: undefined, targetUnavailable: false });
  }
  const [verification, setVerification] = useState({ scope: releaseScope, found: false });
  // A refresh can read releases in parallel once this connection has verified the function.
  const verified =
    connected &&
    reading.sessionVerified &&
    (read?.found ?? (failure === undefined && verification.scope === releaseScope && verification.found));
  if (verification.scope !== releaseScope || verification.found !== verified) {
    setVerification({ scope: releaseScope, found: verified });
  }
  const releases = useReleaseReadings({
    endpoint: connection.engineOrigin,
    name,
    session: reading.session,
    view: active === 'versions' || active === 'test' ? active : undefined,
    verified,
  });
  const { qualifier } = test;
  const currentTargets = /^\d+$/.test(qualifier ?? '')
    ? releases.versions.items?.map(({ version }) => version)
    : releases.aliases.items?.map(({ name }) => name);
  if (qualifier !== undefined && !test.targetUnavailable && currentTargets?.includes(qualifier) === false) {
    setTest({ ...test, targetUnavailable: true });
  }
  const releaseMutation = useReleaseMutation({
    endpoint: connection.engineOrigin,
    name,
    scope: releaseScope,
    onSuccess: (result) => {
      flash.show([{ type: 'success', content: releaseSuccessText(result) }]);
      void reread();
      (result.operation === 'PublishVersion' ? releases.versions : releases.aliases).refresh();
    },
    onFailure: (failure) => {
      const item = actionFailureItem(failure, failure.operation, connection.engineOrigin);
      const operationInContent = failure.kind === 'engine-did-not-answer' || failure.kind === 'emulator-did-not-answer';
      flash.show([
        {
          ...item,
          content: (
            <>
              {operationInContent && (
                <>
                  <Code>{failure.operation}</Code> failed.{' '}
                </>
              )}
              {failure.reportedCode !== undefined && (
                <>
                  <Code>{failure.reportedCode}</Code>.{' '}
                </>
              )}
              {item.content}
            </>
          ),
        },
      ]);
    },
  });
  const [deleting, setDeleting] = useState(false);
  const handleDeleteClose = useCallback(() => {
    setDeleting(false);
  }, []);
  // Deleted: the list opens with the result. A failed delete stays here, its result in the Flashbar, and the delete
  // reads the function again, so one already gone shows "Function not found".
  const handleDeleted = useCallback(
    (result: FlashResult) => {
      flash.handOver(FUNCTIONS_PATH, result);
    },
    [flash],
  );
  const status = fn === undefined ? undefined : functionStatus(fn);
  const failureState = failure === undefined ? undefined : readFailureState(failure, connection, 'function');

  // Kept from the previous render, as React's own pattern for it, so each change is announced once, in the render
  // that first shows it. What one render has to say is said as one announcement, since a newer one replaces it.
  const [refreshing, setRefreshing] = useState<'function' | 'monitor'>();
  const handleMonitorRefreshSettled = useCallback(
    (message: string) => {
      setRefreshing(undefined);
      announce(message);
    },
    [announce],
  );
  const [seenStatus, setSeenStatus] = useState<{ text: string | undefined } | undefined>(undefined);
  const [seenFailureLine, setSeenFailureLine] = useState<string>();
  const failureLine = failureState?.firstText;
  const toSay: string[] = [];
  if (refreshing === 'function' && (read !== undefined || failure !== undefined)) {
    setRefreshing(undefined);
    if (read !== undefined) {
      toSay.push(REFRESHED);
    }
  } else if (refreshing === 'monitor') {
    if (active !== 'monitor') {
      setRefreshing(undefined);
    } else if (!connected || failure !== undefined || read?.found === false) {
      setRefreshing(undefined);
      toSay.push('Monitor could not be refreshed');
    }
  }
  // A change of the status, once (R5.2): its new text, or "Function ready" when it clears; the first status read is
  // shown, not announced.
  if (fn !== undefined && (seenStatus === undefined || seenStatus.text !== status?.text)) {
    setSeenStatus({ text: status?.text });
    if (seenStatus !== undefined) {
      toSay.push(status?.text ?? READY);
    }
  }
  // A failure state is announced once, with its first line (R10.2).
  if (failureLine !== seenFailureLine) {
    setSeenFailureLine(failureLine);
    if (failureLine !== undefined) {
      toSay.push(failureLine);
    }
  }
  if (toSay.length > 0) {
    announce(toSay.join('. '));
  }

  const handleRefresh = () => {
    setRefreshing(active === 'monitor' ? 'monitor' : 'function');
    refresh();
    if (active === 'versions' || active === 'test') {
      releases.versions.refresh();
      releases.aliases.refresh();
    }
  };

  let content;
  if (failureState !== undefined) {
    content = (
      <Container>
        <ReadFailure state={failureState} onRetry={refresh} />
      </Container>
    );
  } else if (read === undefined) {
    content = (
      <Container>
        <Box textAlign="center" color="inherit">
          <StatusIndicator type="loading">Loading function</StatusIndicator>
        </Box>
      </Container>
    );
  } else if (fn === undefined) {
    content = <NotFound name={name} />;
  } else {
    content = (
      <SpaceBetween size="l">
        <FunctionOverview fn={fn} />
        <FunctionTabs
          name={name}
          fn={fn}
          connection={connection}
          ready={ready}
          test={{
            invoke,
            eventText: test.eventText,
            onEventTextChange: (eventText) => setTest((current) => ({ ...current, eventText })),
            qualifier,
            targetUnavailable: test.targetUnavailable,
            onTargetChange: (qualifier) => setTest((current) => ({ ...current, qualifier, targetUnavailable: false })),
          }}
          releases={{ ...releases, mutation: releaseMutation }}
          active={active}
          onMonitorRefreshSettled={refreshing === 'monitor' ? handleMonitorRefreshSettled : undefined}
        />
      </SpaceBetween>
    );
  }

  return (
    <>
      <ContentLayout
        header={
          <Header
            variant="h1"
            // The status line alone; nothing while there is no status (issue 467, R3).
            description={status === undefined ? undefined : <FunctionStatusLine status={status} />}
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button iconName="refresh" ariaLabel="Refresh" onClick={handleRefresh} />
                {fn !== undefined && (
                  <Button
                    onClick={() => {
                      setDeleting(true);
                    }}
                  >
                    Delete
                  </Button>
                )}
              </SpaceBetween>
            }
          >
            <ValueText kind="name" value={name} />
          </Header>
        }
      >
        <SpaceBetween size="l">
          {content}
          {fn === undefined && invoke.answers > 0 && <InvocationResult invoke={invoke} />}
        </SpaceBetween>
      </ContentLayout>
      <DeleteFunctionsDialog
        names={deleting ? [name] : NO_NAMES}
        connection={connection}
        onClose={handleDeleteClose}
        onDeleted={handleDeleted}
      />
      {announcement}
    </>
  );
}
