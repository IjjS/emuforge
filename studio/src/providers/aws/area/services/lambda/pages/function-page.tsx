import Alert, { type AlertProps } from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button, { type ButtonProps } from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import Link from '@cloudscape-design/components/link';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Tabs, { type TabsProps } from '@cloudscape-design/components/tabs';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type Ref } from 'react';
import { useNavigate, useSearchParams } from 'react-router';

import { startedAtOf } from '../../../../../../lib/engine/engine-client';
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
import { EventSourcesTab } from '../components/event-sources-tab';
import { readFailureState, useAnnouncer } from '../components/failure-states';
import { ReadFailure } from '../components/failures';
import { FunctionOverview, FunctionStatusLine } from '../components/function-sections';
import { functionStatus } from '../components/function-status';
import { MonitorTab } from '../components/monitor-tab';
import { quoting } from '../components/quoting';
import { INVOKE_TARGET_RESET, InvocationResult, TestTab, type TestTabProps } from '../components/test-tab';
import { VersionsTab, type VersionsTabProps } from '../components/versions-tab';
import { useEventSources } from '../event-source-queries';
import { FUNCTIONS_PATH, functionTabHref, releaseSuccessText, TAB_PARAMETER, tabOf } from '../format';
import { invokeOutcome } from '../invoke-result';
import { isChanging, useFunctionReading, useInvoke, useReadAgain } from '../queries';
import { useReleaseMutation, useReleaseReadings } from '../version-queries';

// A Lambda function's own page (issue 84, requirement R5, R10; issue 516, design "The function's page"): its header
// with "Refresh" and "Delete", "Function overview", then the tabs, each addressed
// by the query of the function's one address (`?tab=`), so the page stays mounted across them. Every value from the
// engine or the emulator is rendered as text, each as the kind of value it is (issue 467, requirement R6). The `h1`
// has no description but the status line (issue 467, R3): the area's frame says where the function is.

const REFRESHED = 'Function refreshed';
const READY = 'Function ready';
const NO_DELETE_TARGETS: readonly string[] = [];
const ALIAS_CONFIRMATION_INTERRUPTED =
  'The Delete alias confirmation closed. After verification, reopen it from the actions menu in the alias row.';

/** The event text "Test" holds when the page opens. */
export const INITIAL_EVENT = '{}';

interface FunctionTabsProps {
  name: string;
  fn: LambdaFunction;
  connection: AreaConnection;
  ready: boolean;
  testScope: string;
  test: Omit<TestTabProps, 'functionName' | 'connection' | 'versions' | 'aliases'>;
  releases: Pick<VersionsTabProps, 'versions' | 'aliases' | 'mutation' | 'onAliasConfirmationChange'>;
  releaseViewRef: Ref<HTMLDivElement>;
  waitingForVerification: boolean;
  eventSources: ReturnType<typeof useEventSources>;
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
  testScope,
  test,
  releases,
  releaseViewRef,
  waitingForVerification,
  eventSources,
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
          key={testScope}
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
      content: test.verified ? (
        <div ref={releaseViewRef}>
          <VersionsTab
            {...releases}
            connection={connection}
            ready={ready && !releases.versions.loading && !releases.aliases.loading}
          />
        </div>
      ) : (
        <Container>
          <Box textAlign="center">
            <StatusIndicator type={waitingForVerification ? 'loading' : 'stopped'}>
              {waitingForVerification
                ? 'Waiting for function verification'
                : 'Versions and aliases are unavailable until the emulator reconnects.'}
            </StatusIndicator>
          </Box>
        </Container>
      ),
    },
    {
      id: 'event-sources',
      label: 'Event sources',
      href: functionTabHref(name, 'event-sources'),
      content: test.verified ? (
        <EventSourcesTab key={testScope} name={name} sources={eventSources} connection={connection} ready={ready} />
      ) : (
        <Container>
          <Box textAlign="center">
            <StatusIndicator type={waitingForVerification ? 'loading' : 'stopped'}>
              {waitingForVerification
                ? 'Waiting for function verification'
                : 'Event sources are unavailable until the emulator reconnects.'}
            </StatusIndicator>
          </Box>
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
    revalidateOnReconnect: true,
  });
  const { read, failure, refresh } = reading;
  const [network, setNetwork] = useState(() => ({
    online: navigator.onLine,
    revision: 0,
    reconnect: undefined as { at: number; previous: typeof result } | undefined,
  }));
  useLayoutEffect(() => {
    const handleOffline = () => {
      setNetwork((current) => ({ ...current, online: false, revision: current.revision + 1 }));
    };
    const handleOnline = () => {
      const at = Date.now();
      setNetwork((current) => ({
        online: true,
        revision: current.revision + 1,
        reconnect: { at, previous: result },
      }));
    };
    window.addEventListener('offline', handleOffline, true);
    window.addEventListener('online', handleOnline, true);
    return () => {
      window.removeEventListener('offline', handleOffline, true);
      window.removeEventListener('online', handleOnline, true);
    };
  }, [result]);
  const reconnect = network.reconnect;
  const freshHealth =
    reconnect === undefined ||
    (result !== undefined && result !== reconnect.previous && startedAtOf(result) >= reconnect.at);
  const healthCheckedAfterReconnect = reconnect === undefined || (connected && freshHealth);
  const [readNetworkRevision, setReadNetworkRevision] = useState(0);
  if (network.online && healthCheckedAfterReconnect && readNetworkRevision !== network.revision) {
    setReadNetworkRevision(network.revision);
    refresh();
  }
  const fn = read?.found === true ? read.function : undefined;
  const ready = !isChanging(read);
  const flash = usePageFlash();
  const reread = useReadAgain(connection.engineOrigin, name);
  const functionScope = JSON.stringify([connection.engineOrigin, name]);
  const sessionScope = JSON.stringify([functionScope, reading.session]);
  const verificationScope = JSON.stringify([sessionScope, network.revision]);
  const invoke = useInvoke(connection.engineOrigin, name, reading.session, network.revision);
  const invocationPanel = useRef<HTMLDivElement>(null);
  const scroll = useRef({ scope: verificationScope, answers: 0, shown: false });
  const showInvocationFallback = fn === undefined && invoke.answers > 0;
  const invocationAnswers = invoke.answers;
  useEffect(() => {
    const completed = scroll.current.scope !== verificationScope || scroll.current.answers !== invocationAnswers;
    if (completed) {
      scroll.current = { scope: verificationScope, answers: invocationAnswers, shown: false };
    }
    // If the detail disappears after a completion off Test, its fallback is the first visible result panel.
    if (
      invocationAnswers > 0 &&
      (completed || showInvocationFallback) &&
      !scroll.current.shown &&
      invocationPanel.current !== null
    ) {
      invocationPanel.current.scrollIntoView({ block: 'nearest' });
      scroll.current.shown = true;
    }
  }, [verificationScope, invocationAnswers, showInvocationFallback]);
  const [savedTest, setTest] = useState({
    scope: verificationScope,
    functionScope,
    eventText: INITIAL_EVENT,
    qualifier: undefined as string | undefined,
    targetUnavailable: false,
    targetReset: false,
  });
  // Derive the reset in the same render as the network notice so both reach one live-region entry.
  const test =
    savedTest.scope === verificationScope
      ? savedTest
      : {
          scope: verificationScope,
          functionScope,
          eventText: savedTest.functionScope === functionScope ? savedTest.eventText : INITIAL_EVENT,
          qualifier: undefined,
          targetUnavailable: false,
          targetReset:
            savedTest.functionScope === functionScope && (savedTest.targetReset || savedTest.qualifier !== undefined),
        };
  if (test !== savedTest) {
    setTest(test);
  }
  const [verification, setVerification] = useState({ scope: verificationScope, found: false });
  // A refresh can read releases in parallel once this connection has verified the function.
  const verified =
    connected &&
    network.online &&
    healthCheckedAfterReconnect &&
    readNetworkRevision === network.revision &&
    reading.sessionVerified &&
    (read?.found ?? (failure === undefined && verification.scope === verificationScope && verification.found));
  if (verification.scope !== verificationScope || verification.found !== verified) {
    setVerification({ scope: verificationScope, found: verified });
  }
  const eventSources = useEventSources({
    endpoint: connection.engineOrigin,
    name,
    scope: verificationScope,
    active: active === 'event-sources' && verified,
  });
  const [savedAliasConfirmation, setAliasConfirmation] = useState<{ functionScope: string; open: boolean }>();
  let aliasConfirmation = savedAliasConfirmation;
  if (aliasConfirmation?.functionScope !== functionScope || active !== 'versions') {
    aliasConfirmation = undefined;
  } else if (aliasConfirmation.open && !verified) {
    // An ordinary dismissal reports false before the release view unmounts.
    aliasConfirmation = { functionScope, open: false };
  }
  if (aliasConfirmation !== savedAliasConfirmation) {
    setAliasConfirmation(aliasConfirmation);
  }
  const aliasInterrupted = aliasConfirmation?.open === false;
  const handleAliasConfirmationChange = useCallback(
    (open: boolean) => setAliasConfirmation(open ? { functionScope, open: true } : undefined),
    [functionScope],
  );
  const releases = useReleaseReadings({
    endpoint: connection.engineOrigin,
    name,
    session: reading.session,
    view: verified && (active === 'versions' || active === 'test') ? active : undefined,
    verified,
  });
  const { qualifier } = test;
  const refreshedTargetExists = /^\d+$/.test(qualifier ?? '')
    ? releases.versions.items?.some(({ version }) => version === qualifier)
    : releases.aliases.items?.some(({ name }) => name === qualifier);
  if (
    test.scope === verificationScope &&
    qualifier !== undefined &&
    !test.targetUnavailable &&
    refreshedTargetExists === false
  ) {
    setTest({ ...test, targetUnavailable: true });
  }
  const releaseMutation = useReleaseMutation({
    endpoint: connection.engineOrigin,
    name,
    scope: verificationScope,
    onSuccess: (result) => {
      flash.show([{ type: 'success', content: releaseSuccessText(result) }]);
      void reread();
      (result.operation === 'PublishVersion' ? releases.versions : releases.aliases).refresh();
    },
    onFailure: (failure, showInline) => {
      const summary = actionFailureItem(failure, failure.operation, connection.engineOrigin);
      const operationInContent = failure.kind === 'engine-did-not-answer' || failure.kind === 'emulator-did-not-answer';
      const item = {
        ...summary,
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
            {summary.content}
          </>
        ),
      };
      if (!showInline?.(item)) {
        flash.show([item]);
      }
    },
  });
  // A confirmation belongs to the function and connection that opened the dialog.
  const [deletion, setDeletion] = useState<{ scope: string; names: readonly [string] }>();
  const canDelete = connection.engineOrigin !== undefined && verified;
  const activeDeletion = canDelete && deletion?.scope === verificationScope ? deletion : undefined;
  const [closedConfirmationFor, setClosedConfirmationFor] = useState<string>();
  if (closedConfirmationFor !== undefined && closedConfirmationFor !== functionScope) {
    setClosedConfirmationFor(undefined);
  }
  if (activeDeletion !== deletion) {
    setDeletion(undefined);
    if (deletion?.names[0] === name && (!network.online || !healthCheckedAfterReconnect)) {
      setClosedConfirmationFor(functionScope);
    }
  }
  const reopeningRequired = closedConfirmationFor === functionScope;
  let networkNotice: { type: AlertProps.Type; header: string; detail: string } | undefined;
  if (!network.online) {
    networkNotice = {
      type: 'warning',
      header: 'Browser is offline',
      detail: 'Reconnect to verify this function.',
    };
  } else if (!freshHealth) {
    networkNotice = {
      type: 'info',
      header: 'Rechecking the emulator connection',
      detail: 'Wait for a new connection check.',
    };
  } else if (reconnect !== undefined && connected && !verified && read === undefined && failure === undefined) {
    networkNotice = {
      type: 'info',
      header: 'Verifying the function',
      detail: 'Wait for current function details.',
    };
  } else if (reopeningRequired && canDelete) {
    networkNotice = {
      type: 'info',
      header: 'Function verified',
      detail: 'Reopen Delete to confirm deletion again.',
    };
  }
  const confirmationHint =
    reopeningRequired && !canDelete ? 'The delete confirmation closed. Reopen Delete after verification.' : undefined;
  const noticeWords = networkNotice
    ? [`${networkNotice.header}.`, networkNotice.detail, confirmationHint].filter(Boolean).join(' ')
    : confirmationHint;
  const refreshButton = useRef<ButtonProps.Ref>(null);
  const dismissedWithFocus = useRef(false);
  const removedFocus = useRef<'alias' | 'test' | undefined>(undefined);
  const captureAliasFocus = useCallback((element: HTMLDivElement | null) => {
    if (element === null) return;
    return () => {
      // The alias dialog is portaled outside the release view.
      if (document.activeElement?.closest('[role="dialog"]')) {
        removedFocus.current = 'alias';
      }
    };
  }, []);
  const captureTestFocus = useCallback((element: HTMLDivElement | null) => {
    if (element === null) return;
    return () => {
      if (element.contains(document.activeElement)) {
        removedFocus.current = 'test';
      }
    };
  }, []);
  useLayoutEffect(() => {
    const removed = removedFocus.current;
    removedFocus.current = undefined;
    if (
      document.activeElement === document.body &&
      ((removed === 'alias' && aliasInterrupted) ||
        (removed === 'test' && active === 'test' && (!network.online || test.targetReset)))
    ) {
      refreshButton.current?.focus();
    }
  });
  const handleFocusedDismissal = useCallback(() => {
    dismissedWithFocus.current = true;
  }, []);
  useLayoutEffect(() => {
    if (!canDelete && dismissedWithFocus.current) {
      refreshButton.current?.focus();
    }
    dismissedWithFocus.current = false;
  }, [activeDeletion, canDelete]);
  const handleDeleteClose = useCallback(() => {
    setDeletion(undefined);
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
  const [seenRecovery, setSeenRecovery] = useState({
    notice: undefined as string | undefined,
    aliasInterrupted: false,
    targetReset: false,
  });
  if (
    seenRecovery.notice !== noticeWords ||
    seenRecovery.aliasInterrupted !== aliasInterrupted ||
    seenRecovery.targetReset !== test.targetReset
  ) {
    const recovery = [
      seenRecovery.notice !== noticeWords ? noticeWords : undefined,
      aliasInterrupted && !seenRecovery.aliasInterrupted ? ALIAS_CONFIRMATION_INTERRUPTED : undefined,
      test.targetReset && !seenRecovery.targetReset ? INVOKE_TARGET_RESET : undefined,
    ]
      .filter(Boolean)
      .join(' ');
    setSeenRecovery({ notice: noticeWords, aliasInterrupted, targetReset: test.targetReset });
    if (recovery !== '') toSay.push(recovery);
  }
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
  const [seenInvocation, setSeenInvocation] = useState({ scope: verificationScope, answers: 0 });
  const invocationScopeChanged = seenInvocation.scope !== verificationScope;
  if (invocationScopeChanged || seenInvocation.answers !== invocationAnswers) {
    setSeenInvocation({ scope: verificationScope, answers: invocationAnswers });
    if (invocationAnswers > 0) {
      const words =
        invoke.error?.kind === 'not-implemented' && invoke.qualifier !== undefined
          ? 'Not implemented by the emulator'
          : invokeOutcome(invoke.data, invoke.error)?.words;
      if (words !== undefined) {
        toSay.push(words);
      }
    }
  }
  if (toSay.length > 0 || invocationScopeChanged) {
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
          testScope={verificationScope}
          test={{
            invoke,
            verified,
            resultRef: invocationPanel,
            eventText: test.eventText,
            onEventTextChange: (eventText) => setTest((current) => ({ ...current, eventText })),
            qualifier,
            targetUnavailable: test.targetUnavailable,
            targetReset: test.targetReset,
            invokeInputRef: captureTestFocus,
            onTargetChange: (qualifier) =>
              setTest((current) => ({ ...current, qualifier, targetUnavailable: false, targetReset: false })),
          }}
          releases={{
            ...releases,
            mutation: releaseMutation,
            onAliasConfirmationChange: handleAliasConfirmationChange,
          }}
          releaseViewRef={captureAliasFocus}
          waitingForVerification={network.online && (result === undefined || connected)}
          eventSources={eventSources}
          active={active}
          onMonitorRefreshSettled={refreshing === 'monitor' ? handleMonitorRefreshSettled : undefined}
        />
      </SpaceBetween>
    );
  }

  return (
    <>
      <ContentLayout
        notifications={
          <>
            {networkNotice ? (
              <Alert type={networkNotice.type} header={networkNotice.header}>
                {networkNotice.detail} {confirmationHint}
              </Alert>
            ) : (
              confirmationHint && <Alert type="info">{confirmationHint}</Alert>
            )}
            {aliasInterrupted && <Alert type="info">{ALIAS_CONFIRMATION_INTERRUPTED}</Alert>}
          </>
        }
        header={
          <Header
            variant="h1"
            // The status line alone; nothing while there is no status (issue 467, R3).
            description={status === undefined ? undefined : <FunctionStatusLine status={status} />}
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button ref={refreshButton} iconName="refresh" ariaLabel="Refresh" onClick={handleRefresh} />
                {fn !== undefined && (
                  <Button
                    disabled={!canDelete}
                    onClick={() => {
                      if (canDelete) {
                        setClosedConfirmationFor(undefined);
                        setDeletion({ scope: verificationScope, names: [name] });
                      }
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
          {showInvocationFallback && <InvocationResult invoke={invoke} resultRef={invocationPanel} />}
        </SpaceBetween>
      </ContentLayout>
      {connected && connection.engineOrigin !== undefined && (
        // The session owns submitted deletes even when a detail read closes their confirmation.
        <DeleteFunctionsDialog
          key={sessionScope}
          names={activeDeletion?.names ?? NO_DELETE_TARGETS}
          connection={connection}
          onClose={handleDeleteClose}
          onDeleted={handleDeleted}
          onFocusedDismissal={handleFocusedDismissal}
        />
      )}
      {announcement}
    </>
  );
}
