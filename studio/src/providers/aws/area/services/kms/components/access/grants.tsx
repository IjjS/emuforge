import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Header from '@cloudscape-design/components/header';
import Pagination from '@cloudscape-design/components/pagination';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Table from '@cloudscape-design/components/table';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { ConfirmDialog } from '../../../../components/confirm-dialog';
import { ReadFailure, readFailureState } from '../../../../components/failure-states';
import { useTokenListing } from '../../../../components/use-token-listing';
import { ValueText } from '../../../../components/value-text';
import { ACCESS_OPERATIONS, createGrant, listGrants, revokeGrant, type KeyGrant } from '../../access-api';
import { KMS_KEYS, connectionFailure } from '../../queries';
import { AccessDialog } from './access-dialog';
import type { AccessProps } from './access';
import { ActionNotice } from './action-notice';
import { GrantFields, type GrantDraft } from './grant-fields';
import { useAccessAction } from './use-access-action';

const operations = ACCESS_OPERATIONS;

export function Grants({ connection, keyId }: AccessProps) {
  const action = useAccessAction(connection);
  const client = useQueryClient();
  const [attemptedRetry, setAttemptedRetry] = useState(false);
  const [draft, setDraft] = useState<GrantDraft>();
  const [revoking, setRevoking] = useState<KeyGrant>();
  const offline = connectionFailure(connection, operations.listGrants);
  const listing = useTokenListing({
    key: ['kms', 'grants', keyId],
    endpoint: connection.engineOrigin,
    enabled: offline === undefined || attemptedRetry,
    operation: operations.listGrants,
    read: (endpoint, marker, signal) => listGrants(endpoint, keyId, marker, signal),
  });
  const failure = listing.failure ?? (attemptedRetry ? undefined : offline);
  const unavailable = [...action.unavailable].filter(
    (operation) => operation !== operations.createGrant || draft === undefined,
  );

  function handleRetry() {
    setAttemptedRetry(true);
    listing.refresh();
  }

  function refreshDetail() {
    void client.invalidateQueries({ queryKey: [...KMS_KEYS.detail(keyId), connection.engineOrigin] });
  }

  function handleCreate() {
    const grantee = draft?.grantee.trim();
    if (!draft || !grantee || draft.operations.length === 0) return;
    void action.run(
      operations.createGrant,
      (endpoint, signal) => createGrant(endpoint, keyId, grantee, draft.operations, signal),
      'Grant created.',
      () => {
        setDraft(undefined);
        listing.goToPage(1);
        refreshDetail();
      },
    );
  }

  function handleRevoke() {
    if (revoking === undefined) return;
    void action.run(
      operations.revokeGrant,
      (endpoint, signal) => revokeGrant(endpoint, keyId, revoking.id, signal),
      'Grant revoked.',
      () => {
        setRevoking(undefined);
        listing.refresh();
        refreshDetail();
      },
      () => setRevoking(undefined),
    );
  }

  return (
    <>
      <Table
        trackBy="id"
        ariaLabels={{ tableLabel: 'Grants' }}
        items={listing.items ?? []}
        loading={listing.loading}
        loadingText="Loading grants…"
        header={
          <Header
            variant="h2"
            actions={
              <Button
                disabled={action.disabled(operations.createGrant)}
                onClick={() => {
                  action.clearFailure();
                  setDraft({ grantee: '', operations: [] });
                }}
              >
                Create grant
              </Button>
            }
          >
            Grants
          </Header>
        }
        columnDefinitions={[
          {
            id: 'grantee',
            header: 'Grantee principal',
            cell: (grant) => <ValueText kind="address" value={grant.grantee} none="–" />,
          },
          {
            id: 'operations',
            header: 'Allowed operations',
            cell: (grant) =>
              grant.operations.length > 0
                ? grant.operations.map((operation, index) => (
                    <div key={index}>
                      <ValueText kind="fixed" value={operation} />
                    </div>
                  ))
                : '–',
          },
          {
            id: 'id',
            header: 'Grant ID',
            minWidth: 220,
            cell: (grant) => <ValueText kind="name" value={grant.id} />,
          },
          {
            id: 'actions',
            header: 'Actions',
            cell: (grant) => (
              <Button
                ariaLabel={`Revoke grant ${grant.id}`}
                disabled={action.disabled(operations.revokeGrant)}
                onClick={() => setRevoking(grant)}
              >
                Revoke
              </Button>
            ),
          },
        ]}
        empty={
          failure === undefined ? (
            <Box textAlign="center" color="inherit">
              {listing.pastEnd ? 'No more grants' : 'No grants'}
            </Box>
          ) : (
            <ReadFailure
              state={readFailureState(failure, connection, `grants (${failure.operation})`)}
              onRetry={handleRetry}
            />
          )
        }
        pagination={
          <Pagination
            currentPageIndex={listing.currentPage}
            pagesCount={listing.pagesCount}
            openEnd={listing.openEnd}
            onChange={({ detail }) => listing.goToPage(detail.currentPageIndex)}
            ariaLabels={{
              paginationLabel: 'Grant pages',
              previousPageLabel: 'Previous page',
              nextPageLabel: 'Next page',
              pageLabel: (page) => `Page ${String(page)}`,
            }}
          />
        }
        footer={
          unavailable.length > 0 && (
            <SpaceBetween size="s">
              {unavailable.map((operation) => (
                <ActionNotice
                  key={operation}
                  failure={{ kind: 'not-implemented', operation }}
                  endpoint={connection.engineOrigin}
                />
              ))}
            </SpaceBetween>
          )
        }
      />
      {draft !== undefined && (
        <AccessDialog
          title="Create grant"
          submitLabel="Create grant"
          pending={action.pending === operations.createGrant}
          disabled={
            action.disabled(operations.createGrant) || draft.grantee.trim() === '' || draft.operations.length === 0
          }
          onDismiss={() => setDraft(undefined)}
          onSubmit={handleCreate}
        >
          <GrantFields draft={draft} disabled={action.pending === operations.createGrant} onChange={setDraft} />
          {action.failure !== undefined && <ActionNotice failure={action.failure} endpoint={connection.engineOrigin} />}
        </AccessDialog>
      )}
      {revoking !== undefined && (
        <ConfirmDialog
          visible
          header="Revoke grant"
          body={
            <>
              Revoke grant <ValueText kind="name" value={revoking.id} /> on key <ValueText kind="name" value={keyId} />?
              The grantee will lose the permissions provided by this grant.
            </>
          }
          word="revoke"
          action="Revoke grant"
          pending={action.pending === operations.revokeGrant}
          onConfirm={handleRevoke}
          onDismiss={() => setRevoking(undefined)}
        />
      )}
    </>
  );
}
