import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Table, { type TableProps } from '@cloudscape-design/components/table';
import type { ReactNode } from 'react';

import type { AreaConnection } from '../../../components/emulator-line';
import { creationDateText } from '../../../components/format-date';
import { useFollow } from '../../../components/use-follow';
import {
  NO_SUCH_BUCKET,
  type Bucket,
  type EventNotification,
  type NoSuchBucket,
  type Tag,
  type TieringConfiguration,
} from '../api';
import {
  createEventNotificationPath,
  createIntelligentTieringPath,
  editPropertyPath,
  encryptionTypeLabel,
  formatDays,
  formatRetentionPeriod,
  type EditableProperty,
} from '../format';
import type { BucketRead } from '../queries';
import { regionText } from '../regions';
import { BreakAnywhere } from './break-anywhere';
import { sectionFailure } from './bucket-read';
import { StateLineText } from './bucket-read-state';
import type { BucketSectionReads } from './use-bucket-sections';

// The sections of a bucket's tab "Properties" (issue 256, requirement R5.3, R5.4, R9.2, R10, R11.3), in the spec's
// order, each a container with its heading (level 2) and key-value pairs or a table, in the console's words. Each
// shows its own read's state in place of its values, its heading and button staying. A value the answer lacks is "-";
// every value from the emulator is text that breaks inside its box. "AWS CloudTrail data events" is not built (R14
// item 6).

/** A value the answer lacks (R5.3). */
const NONE = '-';

const or = (value: string | undefined): string => value ?? NONE;

/** A section's button: a link to its route (R10). */
interface SectionAction {
  label: string;
  href: string;
}

function edit(name: string, property: EditableProperty): SectionAction {
  return { label: 'Edit', href: editPropertyPath(name, property) };
}

function SectionHeader({ title, action }: { title: string; action?: SectionAction }) {
  const handleFollow = useFollow();
  return (
    <Header
      variant="h2"
      {...(action !== undefined && {
        actions: (
          <Button href={action.href} onFollow={handleFollow}>
            {action.label}
          </Button>
        ),
      })}
    >
      {title}
    </Header>
  );
}

/** A section's read that failed (R11.3): its status and first line, the line after it, and "Retry" for it alone. */
function SectionFailure({ read, connection }: { read: BucketRead<unknown>; connection: AreaConnection }) {
  if (read.failure === undefined) {
    return null;
  }
  const view = sectionFailure(read.failure, connection);
  return (
    <SpaceBetween size="xs">
      <SpaceBetween size="xxs">
        <StatusIndicator type={view.type}>
          <StateLineText line={view.first} />
        </StatusIndicator>
        {view.detail !== undefined && (
          <Box variant="p">
            <BreakAnywhere>
              <StateLineText line={view.detail} />
            </BreakAnywhere>
          </Box>
        )}
      </SpaceBetween>
      <Box>
        <Button onClick={read.again}>Retry</Button>
      </Box>
    </SpaceBetween>
  );
}

/** One label and its value as text. */
interface Field {
  label: string;
  value: string;
}

function Fields({ fields }: { fields: readonly Field[] }) {
  return (
    <KeyValuePairs
      columns={Math.min(fields.length, 4) as 1 | 2 | 3 | 4}
      items={fields.map(({ label, value }) => ({ label, value: <BreakAnywhere>{value}</BreakAnywhere> }))}
    />
  );
}

/** What a section's read answered: its value, or `undefined` while there is none to show. */
function answered<T>(read: BucketRead<T | NoSuchBucket>): T | undefined {
  return read.value === undefined || read.value === NO_SUCH_BUCKET ? undefined : read.value;
}

interface FieldsSectionProps<T> {
  title: string;
  action?: SectionAction;
  read: BucketRead<T | NoSuchBucket>;
  connection: AreaConnection;
  fields: (value: T) => readonly Field[];
}

/** A section of key-value pairs, read by its own operation. */
function FieldsSection<T>({ title, action, read, connection, fields }: FieldsSectionProps<T>) {
  const value = answered(read);
  let body: ReactNode = null;
  if (read.failure !== undefined) {
    body = <SectionFailure read={read} connection={connection} />;
  } else if (value !== undefined) {
    body = <Fields fields={fields(value)} />;
  } else if (read.loading) {
    body = <StatusIndicator type="loading">Loading</StatusIndicator>;
  }
  return (
    <Container header={<SectionHeader title={title} {...(action !== undefined && { action })} />}>{body}</Container>
  );
}

/** A column of a section's table: its heading and each row's value as text. */
interface Column<Row> {
  id: string;
  header: string;
  cell: (row: Row) => string;
}

interface TableSectionProps<T, Row> {
  title: string;
  action: SectionAction;
  read: BucketRead<T | NoSuchBucket>;
  connection: AreaConnection;
  rows: (value: T) => readonly Row[];
  columns: readonly Column<Row>[];
  /** The empty state's title and sentence (R9.2). */
  empty: { title: string; text: string };
  /** A line under the table. */
  footer?: (value: T) => string | undefined;
}

/** A section that is a table, read by its own operation; its states in the table's body. */
function TableSection<T, Row>({
  title,
  action,
  read,
  connection,
  rows,
  columns,
  empty,
  footer,
}: TableSectionProps<T, Row>) {
  const value = answered(read);
  const footerText = value === undefined ? undefined : footer?.(value);
  const columnDefinitions: TableProps.ColumnDefinition<Row>[] = columns.map(({ id, header, cell }) => ({
    id,
    header,
    cell: (row) => <BreakAnywhere>{cell(row)}</BreakAnywhere>,
  }));
  return (
    <Table<Row>
      variant="container"
      header={<SectionHeader title={title} action={action} />}
      items={value === undefined ? [] : [...rows(value)]}
      columnDefinitions={columnDefinitions}
      wrapLines
      loading={read.failure === undefined && value === undefined && read.loading}
      loadingText="Loading"
      empty={
        read.failure !== undefined ? (
          <SectionFailure read={read} connection={connection} />
        ) : (
          <Box textAlign="center" color="inherit">
            <SpaceBetween size="xxs">
              <Box variant="strong" color="inherit">
                {empty.title}
              </Box>
              <Box variant="p" color="inherit">
                {empty.text}
              </Box>
            </SpaceBetween>
          </Box>
        )
      }
      {...(footerText !== undefined && { footer: <Box variant="p">{footerText}</Box> })}
    />
  );
}

const TAG_COLUMNS: readonly Column<Tag>[] = [
  { id: 'key', header: 'Key', cell: (tag) => tag.key },
  { id: 'value', header: 'Value', cell: (tag) => tag.value },
];

const days = (count: number | undefined): string => (count === undefined ? NONE : formatDays(count));

const TIERING_COLUMNS: readonly Column<TieringConfiguration>[] = [
  { id: 'name', header: 'Name', cell: (configuration) => or(configuration.name) },
  { id: 'status', header: 'Status', cell: (configuration) => or(configuration.status) },
  { id: 'prefix', header: 'Prefix', cell: (configuration) => or(configuration.prefix) },
  { id: 'archive', header: 'Archive Access tier', cell: (configuration) => days(configuration.archiveDays) },
  {
    id: 'deep-archive',
    header: 'Deep Archive Access tier',
    cell: (configuration) => days(configuration.deepArchiveDays),
  },
];

const NOTIFICATION_COLUMNS: readonly Column<EventNotification>[] = [
  { id: 'name', header: 'Event name', cell: (notification) => or(notification.name) },
  {
    id: 'events',
    header: 'Event types',
    cell: (notification) => (notification.events.length === 0 ? NONE : notification.events.join(', ')),
  },
  { id: 'prefix', header: 'Prefix', cell: (notification) => or(notification.prefix) },
  { id: 'suffix', header: 'Suffix', cell: (notification) => or(notification.suffix) },
  { id: 'destination-type', header: 'Destination type', cell: (notification) => notification.destinationType },
  { id: 'destination', header: 'Destination', cell: (notification) => or(notification.destination) },
];

interface BucketSectionsProps {
  /** The bucket as the page's `ListBuckets` found it. */
  bucket: Bucket;
  reads: BucketSectionReads;
  connection: AreaConnection;
}

/** The thirteen sections of a bucket's "Properties" (R5.3), in the spec's order. */
export function BucketSections({ bucket, reads, connection }: BucketSectionsProps) {
  const { name } = bucket;
  return (
    <SpaceBetween size="l">
      <Container header={<SectionHeader title="Bucket overview" />}>
        <Fields
          fields={[
            { label: 'AWS Region', value: regionText(bucket.region) },
            { label: 'Bucket ARN', value: or(bucket.arn) },
            { label: 'Creation date', value: creationDateText(bucket.creationDate) },
          ]}
        />
      </Container>
      <FieldsSection
        title="Bucket Versioning"
        action={edit(name, 'versioning')}
        read={reads.versioning}
        connection={connection}
        fields={({ status }) => [{ label: 'Bucket Versioning', value: status }]}
      />
      <FieldsSection
        title="Bucket ABAC"
        action={edit(name, 'abac')}
        read={reads.abac}
        connection={connection}
        fields={({ status }) => [{ label: 'Bucket ABAC', value: or(status) }]}
      />
      <TableSection
        title="Tags"
        action={edit(name, 'tags')}
        read={reads.tags}
        connection={connection}
        rows={(tags) => tags}
        columns={TAG_COLUMNS}
        empty={{ title: 'No tags', text: 'This bucket has no tags.' }}
      />
      <FieldsSection
        title="Default encryption"
        action={edit(name, 'encryption')}
        read={reads.encryption}
        connection={connection}
        fields={({ algorithm, kmsKey, bucketKey }) => [
          { label: 'Encryption type', value: algorithm === undefined ? NONE : encryptionTypeLabel(algorithm) },
          { label: 'AWS KMS key', value: or(kmsKey) },
          { label: 'Bucket Key', value: bucketKey },
        ]}
      />
      <TableSection
        title="S3 Intelligent-Tiering Archive configurations"
        action={{ label: 'Create configuration', href: createIntelligentTieringPath(name) }}
        read={reads['intelligent-tiering']}
        connection={connection}
        rows={({ configurations }) => configurations}
        columns={TIERING_COLUMNS}
        empty={{ title: 'No configurations', text: 'This bucket has no Intelligent-Tiering Archive configurations.' }}
        footer={({ more }) => (more ? 'More configurations exist than are shown here.' : undefined)}
      />
      <FieldsSection
        title="Server access logging"
        action={edit(name, 'logging')}
        read={reads.logging}
        connection={connection}
        fields={({ status, targetBucket, targetPrefix }) => [
          { label: 'Server access logging', value: status },
          {
            label: 'Destination bucket',
            value: targetPrefix === undefined ? or(targetBucket) : `${or(targetBucket)}/${targetPrefix}`,
          },
        ]}
      />
      <TableSection
        title="Event notifications"
        action={{ label: 'Create event notification', href: createEventNotificationPath(name) }}
        read={reads.notifications}
        connection={connection}
        rows={({ notifications }) => notifications}
        columns={NOTIFICATION_COLUMNS}
        empty={{ title: 'No event notifications', text: 'This bucket sends no event notifications.' }}
      />
      <FieldsSection
        title="Amazon EventBridge"
        action={edit(name, 'eventbridge')}
        read={reads.notifications}
        connection={connection}
        fields={({ eventBridge }) => [
          { label: 'Send notifications to Amazon EventBridge for all events in this bucket', value: eventBridge },
        ]}
      />
      <FieldsSection
        title="Transfer acceleration"
        action={edit(name, 'transfer-acceleration')}
        read={reads.acceleration}
        connection={connection}
        fields={({ status }) => [{ label: 'Transfer acceleration', value: status }]}
      />
      <FieldsSection
        title="Object Lock"
        action={edit(name, 'object-lock')}
        read={reads['object-lock']}
        connection={connection}
        fields={({ status, defaultRetention, mode, period }) => [
          { label: 'Object Lock', value: or(status) },
          { label: 'Default retention', value: defaultRetention },
          { label: 'Retention mode', value: or(mode) },
          { label: 'Default retention period', value: period === undefined ? NONE : formatRetentionPeriod(period) },
        ]}
      />
      <FieldsSection
        title="Requester pays"
        action={edit(name, 'requester-pays')}
        read={reads['request-payment']}
        connection={connection}
        fields={({ status }) => [{ label: 'Requester pays', value: or(status) }]}
      />
      <FieldsSection
        title="Static website hosting"
        action={edit(name, 'website')}
        read={reads.website}
        connection={connection}
        fields={({ status, indexDocument, errorDocument }) => [
          { label: 'Static website hosting', value: status },
          { label: 'Index document', value: or(indexDocument) },
          { label: 'Error document', value: or(errorDocument) },
        ]}
      />
    </SpaceBetween>
  );
}
