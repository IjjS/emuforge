import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import Link from '@cloudscape-design/components/link';
import Pagination from '@cloudscape-design/components/pagination';
import Select, { type SelectProps } from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Table, { type TableProps } from '@cloudscape-design/components/table';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import type { AreaConnection } from '../../../components/emulator-line';
import { readFailureState, ReadFailure } from '../../../components/failure-states';
import { creationDateText } from '../../../components/format-date';
import { useFollow } from '../../../components/use-follow';
import { ValueText } from '../../../components/value-text';
import { NONE, RUN_TASK_TITLE, revisionHref, statusText, taskHref } from '../format';
import type { DesiredStatus, Task } from '../task-api';
import { definitionText } from '../task-format';
import { useTaskListing } from '../task-queries';

// The tasks table of S3 and S4 (issue 575, R4): a cluster's tasks, or a service's, 25 a page of `ListTasks` and one
// `DescribeTasks` at a time on the API's own tokens, by "Desired status". It holds its own listing and follows it
// while it shows "Running" and holds a task (`follow.ts`); after each read that following made in place it tells its
// page (`onFollowedRead`), so the page reads its summary with it. The first read, a page change, a change of status
// and "Refresh" start from nothing shown and are not told.

export interface TasksTableProps {
  connection: AreaConnection;
  cluster: string;
  /** A service's table: its tasks only, and no "Group" column. */
  service?: string;
  /** Where "Run task" leads from the empty "Running" table; none shows no such button. */
  runHref?: string;
  /** Called after each read of the shown page that following started. */
  onFollowedRead?: () => void;
  /** A change reads the shown page again from nothing shown (the page's "Refresh"). */
  refreshKey?: number;
}

const STATUS_OPTIONS: readonly SelectProps.Option[] = [
  { value: 'RUNNING', label: 'Running' },
  { value: 'STOPPED', label: 'Stopped' },
];

// The six columns fit at 1280 (949px) in the stopped list too, where a stop code such as `EssentialContainerExited`
// takes about 200px whole (critique final r3). Every cell has 20px of padding on each side (the first 2px and 20px).
/** A task id, 32 characters, on one line with its cell padding (critique final r2 and r3: 34ch missed by it). */
export const TASK_MIN_WIDTH = 'calc(32ch + 24px)';
/** A start date on at most three lines: its widest part ("September 30,") is under 12ch (critique final r3). */
export const STARTED_AT_MIN_WIDTH = 'calc(12ch + 40px)';
/**
 * A group (`service:<name>` or `family:<name>`) is shown as an address, breaking only after its `:`, so its column
 * gives the date its room without breaking a short name inside (critique final r3).
 */
export const GROUP_MIN_WIDTH = 'calc(10ch + 40px)';

function counterText(rows: number, openEnd: boolean): string {
  return `(${String(rows)}${openEnd ? '+' : ''})`;
}

function Empty({ heading, children }: { heading: string; children?: ReactNode }) {
  return (
    <Box textAlign="center" color="inherit">
      <Box variant="strong" color="inherit">
        {heading}
      </Box>
      {children !== undefined && <Box margin={{ top: 's' }}>{children}</Box>}
    </Box>
  );
}

export function TasksTable({ connection, cluster, service, runHref, onFollowedRead, refreshKey }: TasksTableProps) {
  const handleFollow = useFollow();
  const [desiredStatus, setDesiredStatus] = useState<DesiredStatus>('RUNNING');
  const listing = useTaskListing(connection.engineOrigin, cluster, {
    desiredStatus,
    ...(service === undefined ? {} : { service }),
  });
  const { items, refresh, goToPage } = listing;

  // A read in place, by following, replaces one answer by another with nothing in between; every other read starts
  // from nothing shown.
  const seen = useRef<Task[] | undefined>(undefined);
  const told = useRef(onFollowedRead);
  useEffect(() => {
    told.current = onFollowedRead;
  }, [onFollowedRead]);
  useEffect(() => {
    if (seen.current !== undefined && items !== undefined && items !== seen.current) {
      told.current?.();
    }
    seen.current = items;
  }, [items]);

  const [seenRefresh, setSeenRefresh] = useState(refreshKey);
  if (refreshKey !== seenRefresh) {
    setSeenRefresh(refreshKey);
    refresh();
  }

  const columns: TableProps.ColumnDefinition<Task>[] = [
    {
      id: 'task',
      header: 'Task',
      isRowHeader: true,
      minWidth: TASK_MIN_WIDTH,
      cell: (task) => (
        <Link href={taskHref(cluster, task.id)} onFollow={handleFollow}>
          <ValueText kind="name" value={task.id} />
        </Link>
      ),
    },
    {
      id: 'last-status',
      header: 'Last status',
      cell: (task) => <ValueText kind="fixed" value={statusText(task.lastStatus)} />,
    },
    {
      id: 'definition',
      header: 'Task definition',
      cell: (task) =>
        task.definition === undefined ? (
          NONE
        ) : (
          <Link href={revisionHref(task.definition.family, task.definition.revision)} onFollow={handleFollow}>
            <ValueText kind="name" value={definitionText(task.definition)} />
          </Link>
        ),
    },
    ...(service === undefined
      ? [
          {
            id: 'group',
            header: 'Group',
            minWidth: GROUP_MIN_WIDTH,
            cell: (task: Task) => <ValueText kind="address" value={task.group} none={NONE} />,
          },
        ]
      : []),
    {
      id: 'started-at',
      header: 'Started at',
      minWidth: STARTED_AT_MIN_WIDTH,
      cell: (task) => <ValueText kind="fixed" value={creationDateText(task.startedAt)} />,
    },
    {
      id: 'stop-code',
      header: 'Stop code',
      cell: (task) => <ValueText kind="fixed" value={task.stopCode} none={NONE} />,
    },
  ];

  let empty = null;
  if (listing.failure !== undefined) {
    empty = <ReadFailure state={readFailureState(listing.failure, connection, 'task list')} onRetry={refresh} />;
  } else if (items !== undefined && items.length === 0) {
    if (listing.pastEnd) {
      empty = <Empty heading="No more tasks" />;
    } else if (desiredStatus === 'RUNNING') {
      empty = (
        <Empty heading="No running tasks">
          {runHref === undefined ? undefined : (
            <Button href={runHref} onFollow={handleFollow}>
              {RUN_TASK_TITLE}
            </Button>
          )}
        </Empty>
      );
    } else {
      empty = <Empty heading="No stopped tasks" />;
    }
  }

  const selected = STATUS_OPTIONS.find((option) => option.value === desiredStatus) ?? null;

  return (
    <Table<Task>
      variant="container"
      items={items ?? []}
      trackBy="arn"
      columnDefinitions={columns}
      wrapLines
      loading={listing.failure === undefined && items === undefined}
      loadingText="Loading tasks"
      empty={empty}
      header={
        <Header variant="h2" counter={items === undefined ? undefined : counterText(items.length, listing.openEnd)}>
          Tasks
        </Header>
      }
      filter={
        <SpaceBetween direction="horizontal" size="xs">
          <FormField label="Desired status">
            <Select
              selectedOption={selected}
              options={STATUS_OPTIONS}
              onChange={({ detail }) => {
                const value = detail.selectedOption.value;
                if (value === 'RUNNING' || value === 'STOPPED') {
                  setDesiredStatus(value);
                }
              }}
            />
          </FormField>
        </SpaceBetween>
      }
      pagination={
        <Pagination
          currentPageIndex={listing.currentPage}
          pagesCount={listing.pagesCount}
          openEnd={listing.openEnd}
          disabled={items === undefined}
          ariaLabels={{
            nextPageLabel: 'Next page',
            previousPageLabel: 'Previous page',
            pageLabel: (page) => `Page ${String(page)}`,
          }}
          onChange={({ detail }) => {
            goToPage(detail.currentPageIndex);
          }}
        />
      }
    />
  );
}
