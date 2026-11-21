import Button from '@cloudscape-design/components/button';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Tabs, { type TabsProps } from '@cloudscape-design/components/tabs';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';

import { usePageFlash } from '../../../components/page-flash';
import { useShowsResources } from '../../../components/page-resources';
import { ValueText } from '../../../components/value-text';
import type { ScreenPageProps } from '../../../screens';
import { lineText, pageState, type PageState } from '../components/bucket-read';
import { BucketLoading, BucketNotFound, BucketReadFailure } from '../components/bucket-read-state';
import { BucketSections } from '../components/bucket-sections';
import { NotificationChangeStatus } from '../components/notification-change-status';
import { DeleteNotificationDialog } from '../components/notification-section';
import { ObjectsBucketGone } from '../components/objects-states';
import { ObjectsTab } from '../components/objects-tab';
import { useAnnouncer } from '../components/use-announcer';
import { anySectionMissing, useBucketSections } from '../components/use-bucket-sections';
import { bucketPropertiesPath, objectsPath } from '../format';
import type { Bucket } from '../api';
import type { EditableNotification } from '../notifications';
import { useNotificationChange } from '../use-notification-change';
import { useBucketLookup } from '../queries';

// S1, a general purpose bucket's own page (issue 256, requirement R4, R5, R9.1, R10, R11; issue 480): two tabs,
// "Objects" (task 1) at the bucket's route and at `/objects`, and "Properties" at `/properties`, each a route of its
// own. Every value from the engine or the emulator is rendered as text, each as the kind of value it is (issue 467,
// requirement R6). The `h1` has no description: the area's frame says where the bucket is (issue 467, R3).

const REFRESHED = 'Bucket refreshed';

const OBJECTS_TAB = 'objects';
const PROPERTIES_TAB = 'properties';

/**
 * `/aws/s3/buckets/{name}`, `…/objects` and `…/properties`: the bucket of that name as the emulator holds it, found
 * with `ListBuckets` on every opening (R5.1). Until it is found the page shows the read's state in place of its tabs
 * (R11.1). Once found, the tab shown reads what it shows: "Objects" the folder of the address's `?prefix=`,
 * "Properties" each section's own operation, all in parallel, again with every "Refresh" (R5.1, R5.6). A bucket the
 * emulator does not hold, by the page's read or by a tab's, is said in the tab's own words (R5.5). A failed read
 * while the connection is not connected repeats the emulator line's status; once the connection is connected again
 * the page is read again by itself (R11.2).
 */
export function BucketPage({ connection, params }: ScreenPageProps) {
  const name = params.name ?? '';
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [search] = useSearchParams();
  const propertiesPath = bucketPropertiesPath(name);
  const tab = pathname.endsWith('/properties') ? PROPERTIES_TAB : OBJECTS_TAB;
  const prefix = tab === OBJECTS_TAB ? (search.get('prefix') ?? '') : '';
  useShowsResources(tab === OBJECTS_TAB ? 'objects' : 'buckets');
  const [announcement, announce] = useAnnouncer();

  const lookup = useBucketLookup(connection.engineOrigin, name);
  const { refresh } = lookup;
  const found = pageState(lookup, connection);
  const sections = useBucketSections(connection.engineOrigin, name, {
    generation: lookup.generation,
    enabled: found.kind === 'loaded' && tab === PROPERTIES_TAB,
  });
  const flash = usePageFlash();
  const [deleting, setDeleting] = useState<EditableNotification>();
  const connected = connection.result?.kind === 'connected';
  const down = connection.result !== undefined && !connected;
  const deletion = useNotificationChange(connection.engineOrigin, name, down, () => {
    sections.notifications.again();
    flash.show([{ type: 'success', content: 'Event notification deleted' }]);
  });
  const deleteDisabled =
    deletion.locked ||
    deletion.readFailed ||
    deletion.state.kind === 'changed' ||
    deletion.state.kind === 'missing' ||
    down;
  const state: PageState<Bucket> =
    found.kind === 'loaded' && tab === PROPERTIES_TAB && anySectionMissing(sections) ? { kind: 'not-found' } : found;

  const deleteFeedbackRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (deletion.state.kind !== 'unconfirmed') {
      deleteFeedbackRef.current?.scrollIntoView?.({ block: 'nearest' });
    }
  }, [deletion.state, state.kind]);

  const deleteFeedback = tab === PROPERTIES_TAB && deletion.state.kind !== 'idle' && (
    <div ref={deleteFeedbackRef} aria-live="polite">
      <NotificationChangeStatus
        change={deletion}
        connection={connection}
        action="Deleting"
        onRefresh={() => {
          deletion.clear();
          refresh();
        }}
      />
    </div>
  );

  // Kept from the previous render, as React's own pattern for it: what was last seen of the read and the connection,
  // so each change is acted on once, in the render that first shows it.
  const failureLine = state.kind === 'failure' ? lineText(state.view.first) : undefined;
  const [seenFailureLine, setSeenFailureLine] = useState<string>();
  const [refreshing, setRefreshing] = useState(false);
  const [seenConnected, setSeenConnected] = useState(connected);
  // Whether the connection was not connected (a state other than "Checking") since the page last read: the emulator
  // may have restarted then, so the bucket shown may be gone.
  const [wasDown, setWasDown] = useState(down);
  if (down && !wasDown) {
    setWasDown(true);
    setDeleting(undefined);
  }
  // "Bucket refreshed", once the page's read and, on a page shown, every section's read have answered again (R5.6).
  const sectionsReading = state.kind === 'loaded' && Object.values(sections).some((read) => read.loading);
  if (refreshing && state.kind !== 'loading' && !sectionsReading) {
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
  // connected, is read again by itself (R11.2): after an emulator restart the page says the bucket is gone.
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

  const handleTabChange = useCallback(
    ({ detail }: { detail: TabsProps.ChangeDetail }) => {
      if (detail.activeTabHref !== undefined) {
        void navigate(detail.activeTabHref);
      }
    },
    [navigate],
  );

  const tabs = (bucket: Bucket): TabsProps.Tab[] => [
    {
      id: OBJECTS_TAB,
      label: 'Objects',
      href: objectsPath(name),
      // A new tab for each folder, the lookup's generation included: its filter, pages and selection start afresh.
      content: (
        <ObjectsTab
          key={`${String(lookup.generation)}:${prefix}`}
          name={name}
          prefix={prefix}
          connection={connection}
          announce={announce}
        />
      ),
    },
    {
      id: PROPERTIES_TAB,
      label: 'Properties',
      href: propertiesPath,
      content: (
        <BucketSections
          bucket={bucket}
          reads={sections}
          connection={connection}
          deleteNotificationDisabled={deleteDisabled}
          deleteNotificationFeedback={deleteFeedback}
          onDeleteNotification={setDeleting}
        />
      ),
    },
  ];

  return (
    <SpaceBetween size="l">
      <Header
        variant="h1"
        // The tab "Objects" has its own "Refresh", for its listing.
        {...(tab === PROPERTIES_TAB && {
          actions: (
            <Button iconName="refresh" onClick={handleRefresh}>
              Refresh
            </Button>
          ),
        })}
      >
        <ValueText kind="name" value={name} />
      </Header>
      {state.kind !== 'loaded' && deleteFeedback}
      <div>
        {state.kind === 'loading' && <BucketLoading />}
        {state.kind === 'failure' && <BucketReadFailure view={state.view} onRetry={handleRetry} />}
        {state.kind === 'not-found' &&
          (tab === OBJECTS_TAB ? <ObjectsBucketGone name={name} /> : <BucketNotFound name={name} />)}
        {state.kind === 'loaded' && (
          <Tabs tabs={tabs(state.value)} activeTabId={tab} keyboardActivationMode="manual" onChange={handleTabChange} />
        )}
        {deleting !== undefined && state.kind === 'loaded' && !down && (
          <DeleteNotificationDialog
            target={deleting}
            onCancel={() => setDeleting(undefined)}
            onConfirm={() => {
              setDeleting(undefined);
              if (!deleteDisabled) deletion.submit({ kind: 'delete', target: deleting });
            }}
          />
        )}
        {announcement}
      </div>
    </SpaceBetween>
  );
}
