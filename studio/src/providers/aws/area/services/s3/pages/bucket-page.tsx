import Button from '@cloudscape-design/components/button';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Tabs, { type TabsProps } from '@cloudscape-design/components/tabs';
import { useCallback, useState, type MouseEvent } from 'react';
import { useLocation, useNavigate } from 'react-router';

import { useShowsResources } from '../../../components/page-resources';
import type { ScreenPageProps } from '../../../screens';
import { BreakAnywhere } from '../components/break-anywhere';
import { lineText, pageState } from '../components/bucket-read';
import { BucketLoading, BucketNotFound, BucketReadFailure } from '../components/bucket-read-state';
import { useAnnouncer } from '../components/use-announcer';
import { bucketPropertiesPath, bucketTabPath, type BucketTab } from '../format';
import { useBucketLookup } from '../queries';

// S1, a general purpose bucket's own page with its tab "Properties" (issue 256, requirement R4, R5, R9.1, R10, R11):
// the console's tabs, in the console's words; its description and states in EmuForge's own. Every value from the
// engine or the emulator is rendered as text.

const DESCRIPTION = 'This bucket is in your local emulator, not in an AWS account.';
const REFRESHED = 'Bucket refreshed';

/** The tabs in the spec's order (R5.2); every one but "Properties" leads to its own route (R10). */
const OTHER_TABS: readonly { id: BucketTab; label: string }[] = [
  { id: 'objects', label: 'Objects' },
  { id: 'metadata', label: 'Metadata' },
  { id: 'permissions', label: 'Permissions' },
  { id: 'metrics', label: 'Metrics' },
  { id: 'management', label: 'Management' },
];
const PROPERTIES_TAB = 'properties';

/** A click of the main button with no modifier key: one the router follows (a modified click opens a new tab). */
function isPlainClick(event: MouseEvent): boolean {
  return event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey;
}

/**
 * `/aws/s3/buckets/{name}` and `/aws/s3/buckets/{name}/properties`: the bucket of that name as the emulator holds it,
 * found with `ListBuckets` on every opening and "Refresh" (R5.1). Until it is found the page shows the read's state in
 * place of its tabs (R11.1); a bucket the emulator does not hold is "Bucket not found" (R5.5). A failed read while the
 * connection is not connected repeats the emulator line's status; once the connection is connected again the page is
 * read again by itself (R11.2).
 */
export function BucketPage({ connection, params }: ScreenPageProps) {
  const name = params.name ?? '';
  useShowsResources('buckets');
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [announcement, announce] = useAnnouncer();

  const lookup = useBucketLookup(connection.engineOrigin, name);
  const { refresh } = lookup;
  const state = pageState(lookup, connection);

  // Kept from the previous render, as React's own pattern for it: what was last seen of the read and the connection,
  // so each change is acted on once, in the render that first shows it.
  const failureLine = state.kind === 'failure' ? lineText(state.view.first) : undefined;
  const [seenFailureLine, setSeenFailureLine] = useState<string>();
  const [refreshing, setRefreshing] = useState(false);
  const connected = connection.result?.kind === 'connected';
  const [seenConnected, setSeenConnected] = useState(connected);
  // Whether the connection was not connected (a state other than "Checking") since the page last read: the emulator
  // may have restarted then, so the bucket shown may be gone.
  const down = connection.result !== undefined && !connected;
  const [wasDown, setWasDown] = useState(down);
  if (down && !wasDown) {
    setWasDown(true);
  }
  // "Bucket refreshed", once the refreshed read has answered (R5.6).
  if (refreshing && state.kind !== 'loading') {
    setRefreshing(false);
    if (state.kind !== 'failure') {
      announce(REFRESHED);
    }
  }
  // A failure state is announced once, with its first line (R11.2).
  if (failureLine !== seenFailureLine) {
    setSeenFailureLine(failureLine);
    if (failureLine !== undefined) {
      announce(failureLine);
    }
  }
  // Once the connection becomes connected again, a failed read, or a page shown while the connection was not
  // connected, is read again by itself (R11.2): after an emulator restart the page says "Bucket not found".
  if (connected !== seenConnected) {
    setSeenConnected(connected);
    if (connected && (lookup.failure !== undefined || wasDown)) {
      setWasDown(false);
      refresh();
    }
  }

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    setWasDown(false);
    refresh();
  }, [refresh]);

  const handleRetry = useCallback(() => {
    setWasDown(false);
    refresh();
  }, [refresh]);

  const propertiesPath = bucketPropertiesPath(name);

  const handleTabChange = useCallback(
    ({ detail }: { detail: TabsProps.ChangeDetail }) => {
      if (detail.activeTabHref !== undefined) {
        void navigate(detail.activeTabHref);
      }
    },
    [navigate],
  );

  // On the bare route "Properties" is the tab shown, so Cloudscape reports no change for it; the router still follows
  // it to the tab's own route (R10). Enter on a tab is a click of its link.
  const handleTabsClick = useCallback(
    (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest('[role="tab"]') : null;
      if (target?.getAttribute('href') === propertiesPath && pathname !== propertiesPath && isPlainClick(event)) {
        void navigate(propertiesPath);
      }
    },
    [navigate, pathname, propertiesPath],
  );

  const tabs: TabsProps.Tab[] = [
    ...OTHER_TABS.slice(0, 2).map(({ id, label }) => ({ id, label, href: bucketTabPath(name, id) })),
    { id: PROPERTIES_TAB, label: 'Properties', href: propertiesPath, content: null },
    ...OTHER_TABS.slice(2).map(({ id, label }) => ({ id, label, href: bucketTabPath(name, id) })),
  ];

  return (
    <SpaceBetween size="l">
      <Header
        variant="h1"
        {...(state.kind === 'loaded' && { description: DESCRIPTION })}
        actions={
          <Button iconName="refresh" onClick={handleRefresh}>
            Refresh
          </Button>
        }
      >
        <BreakAnywhere>{name}</BreakAnywhere>
      </Header>
      <div>
        {state.kind === 'loading' && <BucketLoading />}
        {state.kind === 'failure' && <BucketReadFailure view={state.view} onRetry={handleRetry} />}
        {state.kind === 'not-found' && <BucketNotFound name={name} />}
        {state.kind === 'loaded' && (
          // A click of a tab reaches its link first; this only adds what Cloudscape leaves out.
          <div onClick={handleTabsClick}>
            <Tabs tabs={tabs} activeTabId={PROPERTIES_TAB} keyboardActivationMode="manual" onChange={handleTabChange} />
          </div>
        )}
        {announcement}
      </div>
    </SpaceBetween>
  );
}
