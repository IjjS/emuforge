import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import Link from '@cloudscape-design/components/link';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Tabs from '@cloudscape-design/components/tabs';
import { useCallback, useState } from 'react';

import type { AreaConnection } from '../../../components/emulator-line';
import { readFailureState, ReadFailure, useAnnouncer } from '../../../components/failure-states';
import { usePageFlash, type FlashResult } from '../../../components/page-flash';
import { useShowsResources } from '../../../components/page-resources';
import { useFollow } from '../../../components/use-follow';
import { ValueText } from '../../../components/value-text';
import type { ScreenPageProps } from '../../../screens';
import type { Table, TimeToLiveRead } from '../api';
import { DeleteTableDialog, type TableToDelete } from '../components/delete-table-dialog';
import { useItemsExplorer } from '../components/items-explorer';
import { ItemsTab } from '../components/items-tab';
import { TableDetails } from '../components/table-details';
import { TABLES_PATH } from '../format';
import { useTableReading } from '../queries';
import { TABLES_TITLE } from './table-list-page';

// A table's page, S2 (issue 496, design.md tasks 1, 2 and 5): its name, "Refresh" and "Delete table" in the header,
// then the tabs "Items" (a scan or a query of the table or an index, page by page) and "Details" (what the table is).
// The selected tab is the page's own state, not the address's. Every value from the emulator is rendered as text;
// every action's result is the area's Flashbar's.

const REFRESHED = 'Table refreshed';
const READING = 'Reading the table';

type TabId = 'items' | 'details';

/** "No table named {name}", with Cloudscape's empty-state pattern, in the place of the tabs. */
function NotFound({ name }: { name: string }) {
  const handleFollow = useFollow();
  return (
    <Container>
      <Box textAlign="center" color="inherit">
        <SpaceBetween size="xxs">
          <Box variant="strong" color="inherit">
            <ValueText kind="text" value="No table named " />
            <ValueText kind="name" value={name} />
          </Box>
          <Box variant="p" color="inherit">
            <ValueText kind="text" value="The emulator holds no table named " />
            <ValueText kind="name" value={name} />
            <ValueText kind="text" value=". It may have been deleted, or the emulator restarted." />
          </Box>
          <Link href={TABLES_PATH} onFollow={handleFollow}>
            {TABLES_TITLE}
          </Link>
        </SpaceBetween>
      </Box>
    </Container>
  );
}

interface TableViewProps {
  table: Table;
  timeToLive: TimeToLiveRead;
  connection: AreaConnection;
  /** One more on each "Refresh" of the header and each return of the connection: the shown page of items is read again. */
  readings: number;
}

/** The tabs of a table that has been read; their state stays while the page shows the table. */
function TableView({ table, timeToLive, connection, readings }: TableViewProps) {
  const [tab, setTab] = useState<TabId>('items');
  const explorer = useItemsExplorer(table, connection);
  // Kept from the previous render, as React's own pattern for it, so each reading is acted on once.
  const [seenReadings, setSeenReadings] = useState(readings);
  if (readings !== seenReadings) {
    setSeenReadings(readings);
    explorer.exploration.refresh();
  }
  return (
    <Tabs
      activeTabId={tab}
      onChange={({ detail }) => {
        setTab(detail.activeTabId === 'details' ? 'details' : 'items');
      }}
      ariaLabel="Table tabs"
      tabs={[
        {
          id: 'items',
          label: 'Items',
          content: <ItemsTab table={table} explorer={explorer} connection={connection} />,
        },
        { id: 'details', label: 'Details', content: <TableDetails table={table} timeToLive={timeToLive} /> },
      ]}
    />
  );
}

/**
 * `/aws/dynamodb/tables/table/{name}`: the table `name`, read through the engine with `DescribeTable` and
 * `DescribeTimeToLive` on every opening and refresh, and again by itself while it is being created, updated or deleted.
 * A name no table can have is not sent and shows "No table named …". A failed read, or one shown while the connection
 * was not connected, is read again by itself once the connection is connected again (requirement, "States": after an
 * emulator restart, "No table named …").
 */
export function TablePage({ connection, params }: ScreenPageProps) {
  useShowsResources('tables');
  const name = params['name'] ?? '';
  const flash = usePageFlash();
  const [announcement, announce] = useAnnouncer();
  const connected = connection.result?.kind === 'connected';
  const reading = useTableReading({ endpoint: connection.engineOrigin, name, connected });
  const { failure, refresh } = reading;
  // While the table is read again ("Refresh", the connection's return) the last answer stays shown, so the tabs keep
  // their state and the page of items is read again with its start key.
  const [last, setLast] = useState(reading.read);
  if (reading.read !== undefined && reading.read !== last) {
    setLast(reading.read);
  }
  const read = reading.read ?? (failure === undefined ? last : undefined);
  const found = read?.kind === 'found' ? read : undefined;
  const failureState = failure === undefined ? undefined : readFailureState(failure, connection, 'table');
  const [readings, setReadings] = useState(0);
  const [deleting, setDeleting] = useState<TableToDelete>();

  const readAgain = useCallback(() => {
    refresh();
    setReadings((current) => current + 1);
  }, [refresh]);

  // Kept from the previous render, as React's own pattern for it, so each change is acted on once.
  const [refreshing, setRefreshing] = useState(false);
  if (refreshing && read !== undefined && !reading.loading) {
    setRefreshing(false);
    announce(REFRESHED);
  } else if (refreshing && failure !== undefined) {
    setRefreshing(false);
  }
  const failureLine = failureState?.firstText;
  const [seenFailureLine, setSeenFailureLine] = useState<string>();
  if (failureLine !== seenFailureLine) {
    setSeenFailureLine(failureLine);
    if (failureLine !== undefined) {
      announce(failureLine);
    }
  }
  // A page shown while the connection went down is read again once it is connected again (a failed read is read
  // again by the reading itself).
  const down = connection.result !== undefined && !connected;
  const [wasDown, setWasDown] = useState(down);
  if (down && !wasDown) {
    setWasDown(true);
  }
  const [seenConnected, setSeenConnected] = useState(connected);
  if (connected !== seenConnected) {
    setSeenConnected(connected);
    if (connected && wasDown) {
      setWasDown(false);
      if (failure === undefined) {
        readAgain();
      }
    }
  }

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    readAgain();
  }, [readAgain]);

  const handleDeleted = useCallback(
    (result: FlashResult) => {
      flash.handOver(TABLES_PATH, result);
    },
    [flash],
  );

  let content;
  if (failureState !== undefined) {
    content = (
      <Container>
        <ReadFailure state={failureState} onRetry={readAgain} />
      </Container>
    );
  } else if (read === undefined) {
    content = (
      <Container>
        <Box textAlign="center" color="inherit">
          <StatusIndicator type="loading">Loading table</StatusIndicator>
        </Box>
      </Container>
    );
  } else if (found === undefined) {
    content = <NotFound name={name} />;
  } else {
    content = (
      <TableView table={found.table} timeToLive={found.timeToLive} connection={connection} readings={readings} />
    );
  }

  return (
    <>
      <ContentLayout
        header={
          <Header
            variant="h1"
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button
                  iconName="refresh"
                  ariaLabel="Refresh"
                  disabled={reading.loading}
                  disabledReason={READING}
                  onClick={handleRefresh}
                />
                {read?.kind !== 'not-found' && (
                  <Button
                    disabled={found === undefined}
                    disabledReason={reading.loading ? READING : 'There is no table to delete'}
                    onClick={() => {
                      if (found !== undefined) {
                        const { deletionProtection } = found.table;
                        setDeleting({
                          name: found.table.name,
                          ...(deletionProtection === undefined ? {} : { deletionProtection }),
                        });
                      }
                    }}
                  >
                    Delete table
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
      <DeleteTableDialog
        table={deleting}
        engineOrigin={connection.engineOrigin}
        onDeleted={handleDeleted}
        onClose={() => {
          setDeleting(undefined);
        }}
      />
      {announcement}
    </>
  );
}
