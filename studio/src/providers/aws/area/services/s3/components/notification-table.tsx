import Box from '@cloudscape-design/components/box';
import Link from '@cloudscape-design/components/link';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Table, { type TableProps } from '@cloudscape-design/components/table';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { CopyValue } from '../../../components/copy-value';
import { useFollow } from '../../../components/use-follow';
import { ValueText } from '../../../components/value-text';
import type { NotificationConfiguration } from '../api';
import { notificationDestinationPath } from '../format';
import { filterValue, notificationRules, type NotificationRule } from '../notifications';
import { NAME_COLUMN_MIN_WIDTH } from './name-column';

// When the available space cannot fit the table, keep each rule's controls and destination
// together in the first column. The other fields remain available by scrolling the table.
const COMPACT_BELOW = 1150;

function Destination({ rule }: { rule: NotificationRule }) {
  const follow = useFollow();
  const href = notificationDestinationPath(rule.type, rule.arn);
  return (
    <SpaceBetween size="xxs">
      <CopyValue label="Destination ARN" value={rule.arn} kind="address" none="-" />
      {href !== undefined && (
        <Link href={href} onFollow={follow}>
          {rule.type === 'SQS queue' ? 'Open queue' : 'Open function monitor'}
        </Link>
      )}
    </SpaceBetween>
  );
}

const COLUMNS: TableProps.ColumnDefinition<NotificationRule>[] = [
  {
    id: 'name',
    header: 'Event name',
    minWidth: NAME_COLUMN_MIN_WIDTH,
    cell: ({ data }) => <ValueText kind="name" value={data.Id} none="-" />,
  },
  {
    id: 'events',
    header: 'Event types',
    minWidth: 210,
    cell: ({ data }) => (
      <ValueText kind="fixed" value={data.Events?.filter(Boolean).join(', ') || undefined} none="-" />
    ),
  },
  {
    id: 'prefix',
    header: 'Prefix',
    cell: (rule) => <ValueText kind="text" value={filterValue(rule, 'prefix')} none="-" />,
  },
  {
    id: 'suffix',
    header: 'Suffix',
    cell: (rule) => <ValueText kind="text" value={filterValue(rule, 'suffix')} none="-" />,
  },
  {
    id: 'destination-type',
    header: 'Destination type',
    minWidth: 145,
    cell: ({ type }) => <ValueText kind="fixed" value={type} />,
  },
  { id: 'destination', header: 'Destination', minWidth: 220, cell: (rule) => <Destination rule={rule} /> },
];

export function NotificationTable({
  configuration,
  header,
  loading,
  failure,
  actions,
}: {
  configuration: NotificationConfiguration | undefined;
  header: (compact: boolean) => ReactNode;
  loading?: boolean;
  failure?: ReactNode;
  actions?: (rule: NotificationRule) => ReactNode;
}) {
  const table = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const element = table.current;
    if (element === null || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined && entry.contentRect.width > 0) {
        setCompact(entry.contentRect.width < COMPACT_BELOW);
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const columns: TableProps.ColumnDefinition<NotificationRule>[] = compact
    ? [
        {
          id: 'name',
          header: 'Event name and destination',
          width: 270,
          minWidth: NAME_COLUMN_MIN_WIDTH,
          cell: (rule) => (
            <SpaceBetween size="xs">
              <Box variant="strong">
                <ValueText kind="name" value={rule.data.Id} none="-" />
              </Box>
              {actions?.(rule)}
              <Destination rule={rule} />
            </SpaceBetween>
          ),
        },
        ...COLUMNS.filter(({ id }) => id !== 'name' && id !== 'destination'),
      ]
    : actions === undefined
      ? COLUMNS
      : [...COLUMNS, { id: 'actions', header: 'Actions', minWidth: 170, cell: actions }];
  const items = configuration === undefined ? [] : notificationRules(configuration);

  return (
    <div ref={table}>
      <Table<NotificationRule>
        variant="container"
        header={header(compact && items.length > 0)}
        items={items}
        columnDefinitions={columns}
        wrapLines
        loading={loading ?? false}
        loadingText="Loading event notifications"
        empty={
          failure ?? (
            <Box textAlign="center" color="inherit">
              <SpaceBetween size="xxs">
                <Box variant="strong" color="inherit">
                  No event notifications
                </Box>
                <Box variant="p" color="inherit">
                  This bucket sends no event notifications.
                </Box>
              </SpaceBetween>
            </Box>
          )
        }
      />
    </div>
  );
}
