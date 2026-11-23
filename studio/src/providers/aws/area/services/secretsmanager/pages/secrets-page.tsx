import type { SecretListEntry } from '@aws-sdk/client-secrets-manager';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Checkbox from '@cloudscape-design/components/checkbox';
import Header from '@cloudscape-design/components/header';
import Link from '@cloudscape-design/components/link';
import Pagination from '@cloudscape-design/components/pagination';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Table, { type TableProps } from '@cloudscape-design/components/table';
import { useState } from 'react';

import type { AreaConnection } from '../../../components/emulator-line';
import { ReadFailure, readFailureState, type ReadFailureState } from '../../../components/failure-states';
import { creationDateText } from '../../../components/format-date';
import { useShowsResources } from '../../../components/page-resources';
import { useFollow } from '../../../components/use-follow';
import { ValueText } from '../../../components/value-text';
import { secretPath } from '../paths';
import { useSecretListing } from '../queries';

function EmptySecrets({
  state,
  unavailable,
  pastEnd,
  onRetry,
}: {
  state: ReadFailureState | undefined;
  unavailable: boolean;
  pastEnd: boolean;
  onRetry: () => void;
}) {
  if (state !== undefined && !unavailable) {
    return <ReadFailure state={state} onRetry={onRetry} />;
  }

  return (
    <Box textAlign="center">
      <SpaceBetween size="xs">
        {state === undefined ? (
          <>
            <Box variant="strong">{pastEnd ? 'No secrets on this page' : 'No secrets'}</Box>
            {!pastEnd && <Box variant="p">Secrets stored in this emulator will appear here.</Box>}
          </>
        ) : (
          <>
            <StatusIndicator type={state.type}>{state.first}</StatusIndicator>
            <Box variant="p">{state.detail}</Box>
            <Button disabled>Retry</Button>
          </>
        )}
      </SpaceBetween>
    </Box>
  );
}

export function SecretsPage({ connection }: { connection: AreaConnection }) {
  useShowsResources('secrets');
  const handleFollow = useFollow();
  const [includePlannedDeletion, setIncludePlannedDeletion] = useState(false);
  const listing = useSecretListing(connection, includePlannedDeletion);
  const failure = listing.connectionFailure ?? listing.failure;
  const unavailable = failure?.kind === 'not-implemented';
  const readState = failure === undefined ? undefined : readFailureState(failure, connection, 'secrets list');
  const recoveryHint =
    failure?.kind === 'engine-did-not-answer'
      ? 'Check that the EmuForge engine is running, then retry.'
      : failure?.kind === 'emulator-did-not-answer'
        ? 'Check that the local emulator is running on the configured port, then retry.'
        : undefined;
  const state =
    readState !== undefined && recoveryHint !== undefined
      ? {
          ...readState,
          detail: (
            <>
              {readState.detail} {recoveryHint}
            </>
          ),
        }
      : readState;

  const columns: TableProps.ColumnDefinition<SecretListEntry>[] = [
    {
      id: 'name',
      header: 'Name',
      isRowHeader: true,
      minWidth: '24ch',
      cell: ({ Name }) =>
        Name ? (
          <Link href={secretPath(Name)} onFollow={handleFollow}>
            <ValueText kind="name" value={Name} />
          </Link>
        ) : (
          '-'
        ),
    },
    {
      id: 'description',
      header: 'Description',
      minWidth: '20ch',
      cell: ({ Description }) => <ValueText kind="text" value={Description} none="-" />,
    },
    {
      id: 'changed',
      header: 'Last changed',
      minWidth: '16ch',
      cell: ({ LastChangedDate }) => <ValueText kind="fixed" value={creationDateText(LastChangedDate)} />,
    },
    ...(includePlannedDeletion
      ? [
          {
            id: 'deletion',
            header: 'Scheduled deletion',
            minWidth: '16ch',
            cell: ({ DeletedDate }: SecretListEntry) => (
              <ValueText kind="fixed" value={creationDateText(DeletedDate)} />
            ),
          },
        ]
      : []),
  ];

  return (
    <Table<SecretListEntry>
      variant="full-page"
      columnDefinitions={columns}
      items={failure === undefined ? (listing.items ?? []) : []}
      trackBy={(secret) => secret.ARN ?? secret.Name ?? ''}
      wrapLines
      loading={listing.loading}
      loadingText="Loading secrets"
      empty={
        <EmptySecrets state={state} unavailable={unavailable} pastEnd={listing.pastEnd} onRetry={listing.refresh} />
      }
      header={
        <Header
          variant="awsui-h1-sticky"
          actions={<Button iconName="refresh" ariaLabel="Refresh" disabled={unavailable} onClick={listing.refresh} />}
        >
          Secrets
        </Header>
      }
      filter={
        <Checkbox
          checked={includePlannedDeletion}
          disabled={unavailable}
          onChange={({ detail }) => setIncludePlannedDeletion(detail.checked)}
        >
          Include secrets scheduled for deletion
        </Checkbox>
      }
      pagination={
        (listing.openEnd || listing.pagesCount > 1) && (
          <Pagination
            currentPageIndex={listing.currentPage}
            pagesCount={listing.pagesCount}
            openEnd={listing.openEnd}
            disabled={unavailable || listing.loading}
            ariaLabels={{
              nextPageLabel: 'Next page',
              previousPageLabel: 'Previous page',
              pageLabel: (page) => `Page ${String(page)}`,
            }}
            onChange={({ detail }) => listing.goToPage(detail.currentPageIndex)}
          />
        )
      }
    />
  );
}
