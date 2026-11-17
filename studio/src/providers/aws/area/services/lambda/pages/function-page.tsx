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
import { useNavigate } from 'react-router';

import { useShowsResources } from '../../../components/page-resources';
import { useFollow } from '../../../components/use-follow';
import type { ScreenPageProps } from '../../../screens';
import type { LambdaFunction } from '../api';
import { readFailureState, useAnnouncer } from '../components/failure-states';
import { ReadFailure } from '../components/failures';
import { FunctionOverview, FunctionStatusLine, RuntimeSettings } from '../components/function-sections';
import { functionStatus } from '../components/function-status';
import { FUNCTIONS_PATH, functionPath, functionTabPath, type FunctionTab } from '../format';
import { useFunctionReading } from '../queries';

// A Lambda function's own page with its tab "Code" (issue 84, requirement R5, R6.1, R8, R10): the console's parts in
// the console's words (`studio/references/console/lambda/function-detail.yaml`); its description, status and states
// in EmuForge's own. Every value from the engine or the emulator is rendered as text. "Code source" is not built
// (R13 item 1).

const DESCRIPTION = 'This function is in your local emulator, not in an AWS account.';
const REFRESHED = 'Function refreshed';
const READY = 'Function ready';

/** The tabs after "Code", in order, each a route of its own (R5.4, R8). */
const OTHER_TABS: readonly { id: FunctionTab; label: string }[] = [
  { id: 'test', label: 'Test' },
  { id: 'monitor', label: 'Monitor' },
  { id: 'configuration', label: 'Configuration' },
  { id: 'aliases', label: 'Aliases' },
  { id: 'versions', label: 'Versions' },
];

/** The tab "Code" is the page itself; the others lead to their routes, which have no screen yet (R8). */
function FunctionTabs({ name, fn }: { name: string; fn: LambdaFunction }) {
  const navigate = useNavigate();
  const handleChange = useCallback(
    ({ detail }: { detail: TabsProps.ChangeDetail }) => {
      if (detail.activeTabHref !== undefined) {
        void navigate(detail.activeTabHref);
      }
    },
    [navigate],
  );
  const tabs: TabsProps.Tab[] = [
    { id: 'code', label: 'Code', href: functionPath(name), content: <RuntimeSettings fn={fn} /> },
    ...OTHER_TABS.map(({ id, label }) => ({ id, label, href: functionTabPath(name, id) })),
  ];
  return (
    <Tabs
      tabs={tabs}
      activeTabId="code"
      onChange={handleChange}
      // An arrow key moves between the tabs; only Enter or a click leaves the page.
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
            <span className="aws-lambda-value">
              {`The emulator holds no function named “${name}”. It may have been deleted, or the emulator restarted.`}
            </span>
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
 * `GetFunctionUrlConfig` on every opening and refresh (R5.1). While it is being created or updated it is read again by
 * itself (R5.2, in the reading's hook); a failed read is read again once the connection is connected again (R10.2).
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
  const status = fn === undefined ? undefined : functionStatus(fn);
  const failureState = failure === undefined ? undefined : readFailureState(failure, connection, 'function');

  // Kept from the previous render, as React's own pattern for it, so each change is announced once, in the render
  // that first shows it.
  const [refreshing, setRefreshing] = useState(false);
  const [seenStatus, setSeenStatus] = useState<{ text: string | undefined } | undefined>(undefined);
  const [seenFailureLine, setSeenFailureLine] = useState<string>();
  const failureLine = failureState?.firstText;
  // A change of the status, once (R5.2): its new text, or "Function ready" when it clears.
  if (fn !== undefined && seenStatus?.text !== status?.text) {
    setSeenStatus({ text: status?.text });
    if (seenStatus !== undefined) {
      announce(status?.text ?? READY);
    }
  } else if (fn !== undefined && seenStatus === undefined) {
    setSeenStatus({ text: undefined });
  }
  // "Function refreshed", once the refreshed reading is shown (R8).
  if (refreshing && read !== undefined) {
    setRefreshing(false);
    announce(REFRESHED);
  } else if (refreshing && failure !== undefined) {
    setRefreshing(false);
  }
  // A failure state is announced once, with its first line (R10.2).
  if (failureLine !== seenFailureLine) {
    setSeenFailureLine(failureLine);
    if (failureLine !== undefined) {
      announce(failureLine);
    }
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
        <FunctionTabs name={name} fn={fn} />
      </SpaceBetween>
    );
  }

  return (
    <>
      <ContentLayout
        header={
          <Header
            variant="h1"
            description={
              <>
                {DESCRIPTION}
                {status !== undefined && (
                  // The header's description is a paragraph: the status is a line of it.
                  <Box variant="span" display="block" margin={{ top: 'xxs' }}>
                    <FunctionStatusLine status={status} />
                  </Box>
                )}
              </>
            }
            actions={<Button iconName="refresh" ariaLabel="Refresh" onClick={handleRefresh} />}
          >
            {name}
          </Header>
        }
      >
        {content}
      </ContentLayout>
      {announcement}
    </>
  );
}
