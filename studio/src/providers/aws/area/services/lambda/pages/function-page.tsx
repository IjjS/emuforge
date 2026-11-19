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
import { quoting } from '../components/quoting';
import { TestTab } from '../components/test-tab';
import { FUNCTIONS_PATH, functionTabHref, TAB_PARAMETER, tabOf } from '../format';
import { isChanging, useFunctionReading, useInvoke, type Invocation } from '../queries';

// A Lambda function's own page (issue 84, requirement R5, R10; issue 516, design "The function's page"): its header
// with "Refresh" and "Delete", "Function overview", then the tabs "Test", "Code" and "Configuration", each addressed
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
  eventText: string;
  onEventTextChange: (text: string) => void;
  invoke: Invocation;
}

/**
 * "Test", "Code", "Configuration": the active one is read from `?tab=`, and choosing one changes the query alone, as
 * a new entry of the history. Cloudscape renders only the active tab's content, so what "Test" keeps lives here.
 */
function FunctionTabs({ name, fn, connection, ready, eventText, onEventTextChange, invoke }: FunctionTabsProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const active = tabOf(searchParams.get(TAB_PARAMETER));
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
        <TestTab functionName={name} eventText={eventText} onEventTextChange={onEventTextChange} invoke={invoke} />
      ),
    },
    {
      id: 'code',
      label: 'Code',
      href: functionTabHref(name, 'code'),
      content: <CodeTab fn={fn} name={name} connection={connection} ready={ready} />,
    },
    {
      id: 'configuration',
      label: 'Configuration',
      href: functionTabHref(name, 'configuration'),
      content: <ConfigurationTab fn={fn} name={name} connection={connection} ready={ready} />,
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
  const [announcement, announce] = useAnnouncer();
  const reading = useFunctionReading({
    endpoint: connection.engineOrigin,
    name,
    connected: connection.result?.kind === 'connected',
  });
  const { read, failure, refresh } = reading;
  const fn = read?.found === true ? read.function : undefined;
  const ready = !isChanging(read);
  const [eventText, setEventText] = useState(INITIAL_EVENT);
  const invoke = useInvoke(connection.engineOrigin, name);
  const flash = usePageFlash();
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
  const [refreshing, setRefreshing] = useState(false);
  const [seenStatus, setSeenStatus] = useState<{ text: string | undefined } | undefined>(undefined);
  const [seenFailureLine, setSeenFailureLine] = useState<string>();
  const failureLine = failureState?.firstText;
  const toSay: string[] = [];
  // "Function refreshed", once the refreshed reading is shown (R8).
  if (refreshing && read !== undefined) {
    setRefreshing(false);
    toSay.push(REFRESHED);
  } else if (refreshing && failure !== undefined) {
    setRefreshing(false);
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
    setRefreshing(true);
    refresh();
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
          eventText={eventText}
          onEventTextChange={setEventText}
          invoke={invoke}
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
        {content}
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
