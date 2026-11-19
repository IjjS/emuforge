import './object-preview.css';

import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Table, { type TableProps } from '@cloudscape-design/components/table';
import type { ReactNode } from 'react';

import { CopyValue } from '../../../components/copy-value';
import type { AreaConnection } from '../../../components/emulator-line';
import { creationDateText } from '../../../components/format-date';
import { ValueText, type ValueKind } from '../../../components/value-text';
import { NO_SUCH_BUCKET, NO_SUCH_KEY, type MetadataEntry, type ObjectHead, type Tag } from '../api';
import { formatSize, objectArn, s3Uri } from '../format';
import type { Preview } from '../preview';
import type { BucketRead } from '../queries';
import { sectionFailure } from './bucket-read';
import { StateLineText } from './bucket-read-state';
import { NAME_COLUMN_MIN_WIDTH } from './name-column';

// The sections of an object's page (issue 480, task 2): "Object overview" and "Metadata" from `HeadObject`, "Tags"
// from `GetObjectTagging`, "Preview" from the first 64 KiB of `GetObject`. Each read's failure is shown in its own
// section, the others standing. Every value from the emulator is text, each as the kind of value it is; the object's
// body is shown as text only.

const NONE = '-';

/** The narrowest column of the overview, so the S3 URI and the ARN have room to break at their `:` and `/`. */
const ADDRESS_COLUMN_MIN_WIDTH = 240;

/**
 * The storage class an answer without `x-amz-storage-class` stands for: S3 sends the header for every class but
 * S3 Standard.
 */
const STANDARD = 'STANDARD';

/** "204,800 bytes (200.0 KiB)"; under 1024 bytes the exact count alone. */
function sizeText(size: number | undefined): string | undefined {
  if (size === undefined) {
    return undefined;
  }
  const exact = `${size.toLocaleString('en-US')} ${size === 1 ? 'byte' : 'bytes'}`;
  return size < 1024 ? exact : `${exact} (${formatSize(size)})`;
}

/** A read's failure in its section, with "Retry" for it alone. */
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
            <StateLineText line={view.detail} />
          </Box>
        )}
      </SpaceBetween>
      <Box>
        <Button onClick={read.again}>Retry</Button>
      </Box>
    </SpaceBetween>
  );
}

interface Field {
  label: string;
  kind: ValueKind;
  value: string | undefined;
  copy?: boolean;
}

function Fields({ fields }: { fields: readonly Field[] }) {
  return (
    <KeyValuePairs
      columns={3}
      minColumnWidth={ADDRESS_COLUMN_MIN_WIDTH}
      items={fields.map(({ label, kind, value, copy = false }) => ({
        label,
        value: copy ? (
          <CopyValue label={label} value={value} kind={kind} none={NONE} />
        ) : (
          <ValueText kind={kind} value={value} none={NONE} />
        ),
      }))}
    />
  );
}

/** "Object overview": what `HeadObject` reports, the key, S3 URI and ARN with their copy controls. */
export function ObjectOverview({ bucket, head }: { bucket: string; head: ObjectHead }) {
  const fields: Field[] = [
    { label: 'Key', kind: 'name', value: head.key, copy: true },
    { label: 'S3 URI', kind: 'address', value: s3Uri(bucket, head.key), copy: true },
    { label: 'ARN', kind: 'address', value: objectArn(bucket, head.key), copy: true },
    { label: 'Size', kind: 'fixed', value: sizeText(head.size) },
    { label: 'Content type', kind: 'name', value: head.contentType },
    { label: 'Last modified', kind: 'fixed', value: creationDateText(head.lastModified) },
    { label: 'ETag', kind: 'name', value: head.etag },
    { label: 'Storage class', kind: 'fixed', value: head.storageClass ?? STANDARD },
    ...(head.versionId === undefined
      ? []
      : [{ label: 'Version ID', kind: 'name' as const, value: head.versionId, copy: true }]),
  ];
  return (
    <Container header={<Header variant="h2">Object overview</Header>}>
      <Fields fields={fields} />
    </Container>
  );
}

const ENTRY_COLUMNS: TableProps.ColumnDefinition<MetadataEntry>[] = [
  {
    id: 'key',
    header: 'Key',
    isRowHeader: true,
    minWidth: NAME_COLUMN_MIN_WIDTH,
    cell: (entry) => <ValueText kind="name" value={entry.key} />,
  },
  { id: 'value', header: 'Value', cell: (entry) => <ValueText kind="text" value={entry.value} none={NONE} /> },
];

function Empty({ title, text }: { title: string; text: string }) {
  return (
    <Box textAlign="center" color="inherit">
      <SpaceBetween size="xxs">
        <Box variant="strong" color="inherit">
          {title}
        </Box>
        <Box variant="p" color="inherit">
          {text}
        </Box>
      </SpaceBetween>
    </Box>
  );
}

function EntryTable({
  title,
  entries,
  empty,
  body,
  loading = false,
}: {
  title: string;
  entries: readonly MetadataEntry[];
  empty: { title: string; text: string };
  body?: ReactNode;
  loading?: boolean;
}) {
  return (
    <Table<MetadataEntry>
      variant="container"
      header={
        <Header variant="h2" counter={loading || body !== undefined ? undefined : `(${String(entries.length)})`}>
          {title}
        </Header>
      }
      items={[...entries]}
      columnDefinitions={ENTRY_COLUMNS}
      wrapLines
      loading={loading}
      loadingText="Loading"
      empty={body ?? <Empty {...empty} />}
    />
  );
}

const NO_METADATA = { title: 'No metadata', text: 'No metadata of this kind.' };

/** "Metadata": the system metadata, then the user metadata (`x-amz-meta-*`), as `HeadObject` gave them. */
export function ObjectMetadata({ head }: { head: ObjectHead }) {
  return (
    <SpaceBetween size="l">
      <EntryTable title="System-defined metadata" entries={head.system} empty={NO_METADATA} />
      <EntryTable title="User-defined metadata" entries={head.user} empty={NO_METADATA} />
    </SpaceBetween>
  );
}

/** "Tags": `GetObjectTagging`'s answer, or its failure. */
export function ObjectTags({
  read,
  connection,
}: {
  read: BucketRead<Tag[] | typeof NO_SUCH_KEY | typeof NO_SUCH_BUCKET>;
  connection: AreaConnection;
}) {
  const tags = Array.isArray(read.value) ? read.value : undefined;
  return (
    <EntryTable
      title="Tags"
      entries={tags ?? []}
      empty={{ title: 'No tags', text: 'This object has no tags.' }}
      loading={read.failure === undefined && tags === undefined && read.loading}
      {...(read.failure !== undefined && { body: <SectionFailure read={read} connection={connection} /> })}
    />
  );
}

/** "Preview": the first 64 KiB as text, or why there is none. */
export function ObjectPreview({ read, connection }: { read: BucketRead<Preview>; connection: AreaConnection }) {
  const preview = read.value;
  let body: ReactNode;
  if (read.failure !== undefined) {
    body = <SectionFailure read={read} connection={connection} />;
  } else if (preview === undefined) {
    body = read.loading ? <StatusIndicator type="loading">Loading preview</StatusIndicator> : null;
  } else if (preview.kind === 'not-previewed') {
    body = <Box variant="p">No preview for this type. Download the object to open it.</Box>;
  } else if (preview.kind === 'empty') {
    body = <Box variant="p">This object is empty.</Box>;
  } else {
    body = (
      <SpaceBetween size="xs">
        {preview.truncated && (
          <Box variant="p" color="text-body-secondary">
            {`Showing the first 64 KiB of ${preview.size === undefined ? 'the object' : formatSize(preview.size)}.`}
          </Box>
        )}
        {preview.text === '' ? (
          <Box variant="p">This object is empty.</Box>
        ) : (
          <Box variant="code">
            <span className="aws-area-object-preview" tabIndex={0} role="region" aria-label="Object preview">
              {preview.text}
            </span>
          </Box>
        )}
      </SpaceBetween>
    );
  }
  return <Container header={<Header variant="h2">Preview</Header>}>{body}</Container>;
}
