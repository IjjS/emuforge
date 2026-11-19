import Box from '@cloudscape-design/components/box';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Table, { type TableProps } from '@cloudscape-design/components/table';

import { CopyValue } from '../../../components/copy-value';
import { creationDateText } from '../../../components/format-date';
import { ValueText } from '../../../components/value-text';
import type { Index, Table as TableDescription, TimeToLiveRead } from '../api';
import {
  capacityText,
  deletionProtectionText,
  indexKindText,
  keyText,
  NO_VALUE,
  projectionText,
  statusText,
  streamText,
  timeToLiveText,
} from '../format';

// S2's "Details" tab (issue 496, design.md task 1): what a table is, from one `DescribeTable` and one
// `DescribeTimeToLive`. No item count and no size: the emulator keeps both at 0 whatever the table holds. Every value
// is the emulator's, rendered as text.

/** Two columns leave an ARN at least a line of its parts at 390 wide; one column below that. */
const MIN_COLUMN_WIDTH = 240;

/** An index's name keeps room for 24 characters (`aws-area.md`, entry 4). */
const NAME_MIN_WIDTH = '28ch';

export interface TableDetailsProps {
  table: TableDescription;
  timeToLive: TimeToLiveRead;
}

function Status({ status }: { status: string | undefined }) {
  const shown = statusText(status);
  return (
    <StatusIndicator type={shown.type}>
      <ValueText kind="fixed" value={shown.text} />
    </StatusIndicator>
  );
}

function TimeToLive({ timeToLive }: { timeToLive: TimeToLiveRead }) {
  const shown = timeToLiveText(timeToLive);
  const value = <ValueText kind="name" value={shown.text} />;
  return shown.type === undefined ? value : <StatusIndicator type={shown.type}>{value}</StatusIndicator>;
}

const INDEX_COLUMNS: TableProps.ColumnDefinition<Index>[] = [
  {
    id: 'name',
    header: 'Name',
    isRowHeader: true,
    minWidth: NAME_MIN_WIDTH,
    cell: (index) => <ValueText kind="name" value={index.name} />,
  },
  { id: 'type', header: 'Type', cell: (index) => <ValueText kind="fixed" value={indexKindText(index.kind)} /> },
  {
    id: 'partitionKey',
    header: 'Partition key',
    cell: (index) => <ValueText kind="name" value={keyText(index.partitionKey)} />,
  },
  { id: 'sortKey', header: 'Sort key', cell: (index) => <ValueText kind="name" value={keyText(index.sortKey)} /> },
  {
    id: 'projection',
    header: 'Projection',
    cell: (index) => <ValueText kind="text" value={projectionText(index.projection)} />,
  },
  {
    id: 'status',
    header: 'Status',
    cell: (index) => (index.kind === 'local' ? NO_VALUE : <Status status={index.status} />),
  },
];

/** "Table details" and "Indexes". */
export function TableDetails({ table, timeToLive }: TableDetailsProps) {
  return (
    <SpaceBetween size="l">
      <Container header={<Header variant="h2">Table details</Header>}>
        <KeyValuePairs
          columns={3}
          minColumnWidth={MIN_COLUMN_WIDTH}
          items={[
            { label: 'Status', value: <Status status={table.status} /> },
            { label: 'Partition key', value: <ValueText kind="name" value={keyText(table.partitionKey)} /> },
            { label: 'Sort key', value: <ValueText kind="name" value={keyText(table.sortKey)} /> },
            { label: 'Capacity mode', value: <ValueText kind="text" value={capacityText(table.capacity)} /> },
            {
              label: 'Deletion protection',
              value: <ValueText kind="fixed" value={deletionProtectionText(table.deletionProtection)} />,
            },
            { label: 'Time to live', value: <TimeToLive timeToLive={timeToLive} /> },
            { label: 'Stream', value: <ValueText kind="name" value={streamText(table.stream)} /> },
            {
              label: 'Creation date',
              value: <ValueText kind="fixed" value={creationDateText(table.creationTime)} />,
            },
            { label: 'ARN', value: <CopyValue label="ARN" value={table.arn} kind="address" none={NO_VALUE} /> },
          ]}
        />
      </Container>
      <Table<Index>
        variant="container"
        items={table.indexes}
        trackBy="name"
        columnDefinitions={INDEX_COLUMNS}
        wrapLines
        ariaLabels={{ tableLabel: 'Indexes' }}
        header={
          <Header variant="h2" counter={`(${String(table.indexes.length)})`}>
            Indexes
          </Header>
        }
        empty={
          <Box textAlign="center" color="inherit">
            <SpaceBetween size="xxs">
              <Box variant="strong" color="inherit">
                No indexes
              </Box>
              <Box variant="p" color="inherit">
                <ValueText kind="name" value={table.name} /> has no secondary indexes.
              </Box>
            </SpaceBetween>
          </Box>
        }
      />
    </SpaceBetween>
  );
}
