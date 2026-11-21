import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Table, { type TableProps } from '@cloudscape-design/components/table';
import { useState, type ReactNode } from 'react';

import { CopyValue } from '../../../components/copy-value';
import type { AreaConnection } from '../../../components/emulator-line';
import { creationDateText } from '../../../components/format-date';
import { useFollow } from '../../../components/use-follow';
import { ValueText, type ValueKind } from '../../../components/value-text';
import { NO_SUCH_BUCKET, type Bucket, type NoSuchBucket, type Tag } from '../api';
import { editPropertyPath, encryptionTypeLabel, type EditableProperty } from '../format';
import type { BucketRead } from '../queries';
import type { EditableNotification } from '../notifications';
import { NotificationLoadUnavailable } from './notification-read-state';
import { NotificationSection, type DeleteConsentRecovery } from './notification-section';
import { regionText } from '../regions';
import { sectionFailure } from './bucket-read';
import { StateLineText } from './bucket-read-state';
import { NAME_COLUMN_MIN_WIDTH } from './name-column';
import type { BucketSectionReads } from './use-bucket-sections';

// The sections of a bucket's tab "Properties" (issue 256, requirement R5.3, R5.4, R9.2, R10, R11.3), in the spec's
// order, each a container with its heading (level 2) and key-value pairs or a table, in the console's words. Each
// shows its own read's state in place of its values, its heading and button staying. A value the answer lacks is "-";
// every value from the emulator is text, each shown as the kind of value it is, and the bucket's ARN and its KMS key
// with their copy controls (issue 467, requirement R5, R6). "AWS CloudTrail data events" is not built (R14 item 6).

/** A value the answer lacks (R5.3). */
const NONE = '-';

/**
 * The narrowest column of a section that holds an address, in pixels: as many columns as the page has room for where
 * it is wide, one at 390 wide, so the ARN has the section's width to break in at its `:` and `/` (issue 467, R6)
 * rather than a part of it.
 */
const ADDRESS_COLUMN_MIN_WIDTH = 240;

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
function SectionFailure({
  read,
  connection,
  onRetry = read.again,
}: {
  read: BucketRead<unknown>;
  connection: AreaConnection;
  onRetry?: () => void;
}) {
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
            <StateLineText line={view.detail} />
          </Box>
        )}
      </SpaceBetween>
      <Box>
        <Button onClick={onRetry}>Retry</Button>
      </Box>
    </SpaceBetween>
  );
}

/** One label and its value as text, of the kind it is; "-" where the answer lacks it. */
interface Field {
  label: string;
  kind: ValueKind;
  value: string | undefined;
  /** The value is taken to another tool: it has its copy control, "Copy {label}" (R5). */
  copy?: boolean;
}

function FieldValue({ label, kind, value, copy = false }: Field) {
  return copy ? (
    <CopyValue label={label} value={value} kind={kind} none={NONE} />
  ) : (
    <ValueText kind={kind} value={value} none={NONE} />
  );
}

function Fields({ fields }: { fields: readonly Field[] }) {
  const holdsAddress = fields.some(({ kind }) => kind === 'address');
  return (
    <KeyValuePairs
      columns={Math.min(fields.length, 4) as 1 | 2 | 3 | 4}
      {...(holdsAddress && { minColumnWidth: ADDRESS_COLUMN_MIN_WIDTH })}
      items={fields.map((field) => ({ label: field.label, value: <FieldValue {...field} /> }))}
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

/** A column of a section's table: its heading and each row's value as text, of the kind it is; "-" where it lacks. */
interface Column<Row> {
  id: string;
  header: string;
  kind: ValueKind;
  cell: (row: Row) => string | undefined;
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
}

/** A section that is a table, read by its own operation; its states in the table's body. */
function TableSection<T, Row>({ title, action, read, connection, rows, columns, empty }: TableSectionProps<T, Row>) {
  const value = answered(read);
  // A name's column keeps room for a name of 24 characters on one line (R6).
  const columnDefinitions: TableProps.ColumnDefinition<Row>[] = columns.map(({ id, header, kind, cell }) => ({
    id,
    header,
    ...(kind === 'name' && { minWidth: NAME_COLUMN_MIN_WIDTH }),
    cell: (row) => <ValueText kind={kind} value={cell(row)} none={NONE} />,
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
    />
  );
}

const TAG_COLUMNS: readonly Column<Tag>[] = [
  { id: 'key', header: 'Key', kind: 'name', cell: (tag) => tag.key },
  { id: 'value', header: 'Value', kind: 'text', cell: (tag) => tag.value },
];

interface BucketSectionsProps {
  /** The bucket as the page's `ListBuckets` found it. */
  bucket: Bucket;
  reads: BucketSectionReads;
  connection: AreaConnection;
  deleteNotificationDisabled: boolean;
  notificationComparisonOnly: boolean;
  notificationActionsHidden: boolean;
  deleteNotificationFeedback: ReactNode;
  deleteConsentRecovery: DeleteConsentRecovery | undefined;
  onDeleteNotification: (target: EditableNotification) => void;
}

/**
 * The six sections of a bucket's "Properties" (R5.3; issue 480: the overview, versioning, tags, encryption, event
 * notifications and website, what the tasks a developer does locally read), in the spec's order.
 */
export function BucketSections({
  bucket,
  reads,
  connection,
  deleteNotificationDisabled,
  notificationComparisonOnly,
  notificationActionsHidden,
  deleteNotificationFeedback,
  deleteConsentRecovery,
  onDeleteNotification,
}: BucketSectionsProps) {
  const { name } = bucket;
  const notificationRead = reads.notifications;
  const [notificationRetryRequested, setNotificationRetryRequested] = useState(false);
  function retryNotifications() {
    setNotificationRetryRequested(true);
    notificationRead.again();
  }
  const notificationsUnavailable = notificationRead.failure?.kind === 'not-implemented';
  return (
    <SpaceBetween size="l">
      <Container header={<SectionHeader title="Bucket overview" />}>
        <Fields
          fields={[
            { label: 'AWS Region', kind: 'fixed', value: regionText(bucket.region) },
            { label: 'Bucket ARN', kind: 'address', value: bucket.arn, copy: true },
            { label: 'Creation date', kind: 'fixed', value: creationDateText(bucket.creationDate) },
          ]}
        />
      </Container>
      <FieldsSection
        title="Bucket Versioning"
        action={edit(name, 'versioning')}
        read={reads.versioning}
        connection={connection}
        fields={({ status }) => [{ label: 'Bucket Versioning', kind: 'fixed', value: status }]}
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
          {
            label: 'Encryption type',
            kind: 'fixed',
            value: algorithm === undefined ? undefined : encryptionTypeLabel(algorithm),
          },
          { label: 'AWS KMS key', kind: 'address', value: kmsKey, copy: true },
          { label: 'Bucket Key', kind: 'fixed', value: bucketKey },
        ]}
      />
      {notificationComparisonOnly ? (
        deleteNotificationFeedback
      ) : (
        <NotificationSection
          bucket={name}
          configuration={notificationRead.failure === undefined ? answered(notificationRead) : undefined}
          loading={notificationRead.loading}
          failure={
            notificationsUnavailable ? (
              <NotificationLoadUnavailable focus={notificationRetryRequested} />
            ) : notificationRead.failure === undefined ? undefined : (
              <SectionFailure read={notificationRead} connection={connection} onRetry={retryNotifications} />
            )
          }
          unsupported={notificationsUnavailable}
          feedback={deleteNotificationFeedback}
          consentRecovery={deleteConsentRecovery}
          deleteDisabled={deleteNotificationDisabled}
          hideRuleActions={notificationActionsHidden}
          onDelete={onDeleteNotification}
        />
      )}
      <FieldsSection
        title="Static website hosting"
        action={edit(name, 'website')}
        read={reads.website}
        connection={connection}
        fields={({ status, indexDocument, errorDocument }) => [
          { label: 'Static website hosting', kind: 'fixed', value: status },
          { label: 'Index document', kind: 'name', value: indexDocument },
          { label: 'Error document', kind: 'name', value: errorDocument },
        ]}
      />
    </SpaceBetween>
  );
}
