import Box from '@cloudscape-design/components/box';
import Link from '@cloudscape-design/components/link';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Table, { type TableProps } from '@cloudscape-design/components/table';
import type { ReactNode } from 'react';

import { CopyValue } from '../../../components/copy-value';
import { useFollow } from '../../../components/use-follow';
import { ValueText } from '../../../components/value-text';
import type { NotificationConfiguration } from '../api';
import { notificationDestinationPath } from '../format';
import { filterValue, notificationRules, type NotificationRule } from '../notifications';
import { NAME_COLUMN_MIN_WIDTH } from './name-column';

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
  { id: 'destination-type', header: 'Destination type', cell: ({ type }) => <ValueText kind="fixed" value={type} /> },
  { id: 'destination', header: 'Destination', cell: (rule) => <Destination rule={rule} /> },
];

export function NotificationTable({
  configuration,
  header,
  loading,
  failure,
  actions,
}: {
  configuration: NotificationConfiguration | undefined;
  header: ReactNode;
  loading?: boolean;
  failure?: ReactNode;
  actions?: (rule: NotificationRule) => ReactNode;
}) {
  return (
    <Table<NotificationRule>
      variant="container"
      header={header}
      items={configuration === undefined ? [] : notificationRules(configuration)}
      columnDefinitions={
        actions === undefined ? COLUMNS : [...COLUMNS, { id: 'actions', header: 'Actions', cell: actions }]
      }
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
  );
}
