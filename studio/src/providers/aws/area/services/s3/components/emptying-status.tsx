import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import Link from '@cloudscape-design/components/link';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Table, { type TableProps } from '@cloudscape-design/components/table';

import { useFollow } from '../../../components/use-follow';
import type { DeleteFailure } from '../api';
import { BUCKETS_PATH, deleteBucketPath } from '../format';
import { BreakAnywhere } from './break-anywhere';
import { deletedText, emptyingResult, type EmptyingState } from './emptying-result';

// "Empty bucket: Status" (issue 256, requirement R8.4 to R8.6, R9.4): the state of the empty page from the press of
// "Empty" on, at the same address. Its content is in no source, so every word of it is EmuForge's own; the counts,
// keys, version ids, codes and messages are text as they came, and a long one breaks inside its box.

/** The most failures the table shows (R8.5). */
const FAILURES_SHOWN = 100;

const EMPTYING = 'Emptying the bucket';
const ITEM_MEANS = 'An item is an object version or a delete marker.';

const FAILURE_COLUMNS: TableProps.ColumnDefinition<DeleteFailure>[] = [
  { id: 'key', header: 'Key', cell: ({ key }) => <BreakAnywhere>{key}</BreakAnywhere> },
  { id: 'version', header: 'Version ID', cell: ({ versionId }) => <BreakAnywhere>{versionId ?? '-'}</BreakAnywhere> },
  {
    id: 'error',
    header: 'Error',
    cell: ({ code, message }) => (
      <BreakAnywhere>
        <Box variant="code" display="inline">
          {code}
        </Box>
        {`: ${message}`}
      </BreakAnywhere>
    ),
  },
];

/** "Could not be deleted": the first 100 failures in the order they were met, and how many there are (R8.5). */
function FailureTable({ failures }: { failures: readonly DeleteFailure[] }) {
  const more = failures.length > FAILURES_SHOWN;
  return (
    <Table<DeleteFailure>
      variant="embedded"
      header={
        <Header variant="h2" counter={`(${String(failures.length)})`}>
          Could not be deleted
        </Header>
      }
      items={failures.slice(0, FAILURES_SHOWN)}
      columnDefinitions={FAILURE_COLUMNS}
      wrapLines
      {...(more && {
        footer: <Box variant="p">{`Showing ${String(FAILURES_SHOWN)} of ${String(failures.length)}`}</Box>,
      })}
    />
  );
}

export interface EmptyingStatusProps {
  name: string;
  state: EmptyingState;
  /** "Retry" of a failed emptying (R8.6): it goes on with the counts and the failures recorded. */
  onRetry: () => void;
}

/**
 * The status of an emptying: while it runs "Emptying the bucket" with the count so far (R8.4); once finished its
 * result, with the table of what could not be deleted (R8.5); stopped by a failed request, the failure with the count
 * so far and "Retry" (R8.6). Once it no longer runs, the links "Delete bucket" and "General purpose buckets".
 */
export function EmptyingStatus({ name, state, onRetry }: EmptyingStatusProps) {
  const handleFollow = useFollow();
  const { counts } = state;
  const result = state.kind === 'finished' ? emptyingResult(name, counts) : undefined;
  return (
    <Container>
      <SpaceBetween size="l">
        <SpaceBetween size="xs">
          {state.kind === 'running' && <StatusIndicator type="in-progress">{EMPTYING}</StatusIndicator>}
          {result !== undefined && (
            <StatusIndicator type={result.type}>
              <BreakAnywhere>{result.text}</BreakAnywhere>
            </StatusIndicator>
          )}
          {state.kind === 'failed' && (
            <Alert type={state.failure.type} header={state.failure.header}>
              {state.failure.detail}
            </Alert>
          )}
          <Box variant="p">{deletedText(counts.deleted)}</Box>
          <Box variant="p" color="text-body-secondary">
            {ITEM_MEANS}
          </Box>
          {state.kind === 'failed' && (
            <Box>
              <Button onClick={onRetry}>Retry</Button>
            </Box>
          )}
        </SpaceBetween>
        {counts.failures.length > 0 && <FailureTable failures={counts.failures} />}
        {state.kind !== 'running' && (
          <SpaceBetween direction="horizontal" size="l">
            <Link href={deleteBucketPath(name)} onFollow={handleFollow}>
              Delete bucket
            </Link>
            <Link href={BUCKETS_PATH} onFollow={handleFollow}>
              General purpose buckets
            </Link>
          </SpaceBetween>
        )}
      </SpaceBetween>
    </Container>
  );
}
