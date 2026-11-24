import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import Input from '@cloudscape-design/components/input';
import Pagination from '@cloudscape-design/components/pagination';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Table, { type TableProps } from '@cloudscape-design/components/table';
import { useQueryClient } from '@tanstack/react-query';
import { type RefObject, useEffect, useState } from 'react';

import { ReadFailure } from '../../../../components/failure-states';
import { useTokenListing } from '../../../../components/use-token-listing';
import { ValueText } from '../../../../components/value-text';
import { ACCESS_OPERATIONS, createGrant, listGrants, revokeGrant, type KeyGrant } from '../../access-api';
import { KMS_KEYS, connectionFailure, readFailureState } from '../../queries';
import { AccessDialog } from './access-dialog';
import type { AccessProps } from './access';
import { ActionNotice } from './action-notice';
import { GrantFields, type GrantDraft } from './grant-fields';
import { useAccessAction } from './use-access-action';

const operations = ACCESS_OPERATIONS;
const COMPACT_BELOW = 720;
const REVOKE_WORD = 'revoke';

function GrantOperations({ values }: { values: KeyGrant['operations'] }) {
  if (values.length === 0) return '–';
  return values.map((operation, index) => (
    <div key={index}>
      <ValueText kind="name" value={operation} />
    </div>
  ));
}

export function Grants({
  connection,
  keyId,
  writesEnabled = true,
  sectionRef,
}: AccessProps & { sectionRef: RefObject<HTMLDivElement | null> }) {
  const action = useAccessAction(connection, writesEnabled);
  const client = useQueryClient();
  const [compact, setCompact] = useState(false);
  const [attemptedRetry, setAttemptedRetry] = useState(false);
  const [draft, setDraft] = useState<GrantDraft>();
  const [revoking, setRevoking] = useState<{ grant: KeyGrant; confirmation: string }>();
  const offline = connectionFailure(connection, operations.listGrants);
  if (offline === undefined && attemptedRetry) setAttemptedRetry(false);
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

  useEffect(() => {
    const section = sectionRef.current;
    if (section === null || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined && entry.contentRect.width > 0) {
        setCompact(entry.contentRect.width < COMPACT_BELOW);
      }
    });
    observer.observe(section);
    return () => observer.disconnect();
  }, [sectionRef]);

  function handleRetry() {
    if (offline !== undefined) setAttemptedRetry(true);
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
    if (revoking?.confirmation !== REVOKE_WORD) return;
    void action.run(
      operations.revokeGrant,
      (endpoint, signal) => revokeGrant(endpoint, keyId, revoking.grant.id, signal),
      'Grant revoked.',
      () => {
        setRevoking(undefined);
        listing.refresh();
        refreshDetail();
      },
      () => setRevoking(undefined),
    );
  }

  function revokeButton(grant: KeyGrant) {
    return (
      <Button
        ariaLabel={`Revoke grant ${grant.id}`}
        wrapText={false}
        disabled={action.disabled(operations.revokeGrant)}
        onClick={() => setRevoking({ grant, confirmation: '' })}
      >
        Revoke
      </Button>
    );
  }

  const columns: TableProps.ColumnDefinition<KeyGrant>[] = compact
    ? [
        {
          id: 'grant',
          header: 'Grant',
          cell: (grant) => (
            <SpaceBetween size="xs">
              <div>
                <Box variant="awsui-key-label">Grantee principal</Box>
                <ValueText kind="address" value={grant.grantee} none="–" />
              </div>
              {revokeButton(grant)}
              <div>
                <Box variant="awsui-key-label">Allowed operations</Box>
                <GrantOperations values={grant.operations} />
              </div>
              <div>
                <Box variant="awsui-key-label">Grant ID</Box>
                <ValueText kind="name" value={grant.id} />
              </div>
            </SpaceBetween>
          ),
        },
      ]
    : [
        {
          id: 'grantee',
          header: 'Grantee principal',
          minWidth: 180,
          cell: (grant) => <ValueText kind="address" value={grant.grantee} none="–" />,
        },
        {
          id: 'operations',
          header: 'Allowed operations',
          cell: (grant) => <GrantOperations values={grant.operations} />,
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
          minWidth: 110,
          cell: revokeButton,
        },
      ];

  return (
    <div ref={sectionRef} id="kms-grants" tabIndex={-1} role="region" aria-label="Grants">
      <Table
        trackBy="id"
        wrapLines
        ariaLabels={{ tableLabel: 'Grants' }}
        items={failure === undefined ? (listing.items ?? []) : []}
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
        columnDefinitions={columns}
        empty={
          failure === undefined ? (
            <Box textAlign="center" variant="strong">
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
          (listing.openEnd || listing.pagesCount > 1) && (
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
          )
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
          {action.failure !== undefined && (
            <ActionNotice failure={action.failure} endpoint={connection.engineOrigin} focusOnFailure />
          )}
        </AccessDialog>
      )}
      {revoking !== undefined && (
        <AccessDialog
          title="Revoke grant"
          submitLabel="Revoke grant"
          pending={action.pending === operations.revokeGrant}
          disabled={action.disabled(operations.revokeGrant) || revoking.confirmation !== REVOKE_WORD}
          onSubmit={handleRevoke}
          onDismiss={() => setRevoking(undefined)}
        >
          <Box variant="p">
            Revoke grant <ValueText kind="name" value={revoking.grant.id} /> on key{' '}
            <ValueText kind="name" value={keyId} />? The grantee will lose the permissions provided by this grant.
          </Box>
          <FormField label={`To confirm, type “${REVOKE_WORD}” in the field.`}>
            <Input
              value={revoking.confirmation}
              placeholder={REVOKE_WORD}
              readOnly={action.pending === operations.revokeGrant}
              onChange={({ detail }) => setRevoking({ ...revoking, confirmation: detail.value })}
              onKeyDown={({ detail }) => {
                if (detail.key === 'Enter') handleRevoke();
              }}
            />
          </FormField>
        </AccessDialog>
      )}
    </div>
  );
}
