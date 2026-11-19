import Box from '@cloudscape-design/components/box';
import Button, { type ButtonProps } from '@cloudscape-design/components/button';
import CollectionPreferences, {
  type CollectionPreferencesProps,
} from '@cloudscape-design/components/collection-preferences';
import Header from '@cloudscape-design/components/header';
import Link from '@cloudscape-design/components/link';
import Pagination from '@cloudscape-design/components/pagination';
import Select, { type SelectProps } from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Table, { type TableProps } from '@cloudscape-design/components/table';
import TextFilter, { type TextFilterProps } from '@cloudscape-design/components/text-filter';
import { useCallback, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router';

import { useAreaModalRoot } from '../../../components/area-modal';
import { useShowsResources } from '../../../components/page-resources';
import { useFollow } from '../../../components/use-follow';
import { ValueText } from '../../../components/value-text';
import type { ScreenPageProps } from '../../../screens';
import type { Policy, PolicyScope } from '../api';
import { CREATE_POLICY_PATH, NO_VALUE, policyPath, utcDateText } from '../format';
import { usePolicyListing, type Listing, type ListingCount } from '../queries';
import { DeletePolicyDialog } from '../components/delete-policy-dialog';
import { readFailureState, type ReadFailureState } from '../components/failures';
import { NAME_COLUMN_MIN_WIDTH, useAnnouncer } from '../components/page-parts';
import { ReadFailure } from '../components/states';

// IAM's policy list (issue 535, S4): the policies of one type at a time, read with `ListPolicies` of its scope, in
// pages by `Marker`, with the role list's filter, pages and states. "Delete" acts on the one chosen customer managed
// policy. Every value from the emulator is rendered as text, each cell as the kind of value it is.

/** The page's title, its `h1` without the counter. */
export const POLICIES_TITLE = 'Policies';

const DESCRIPTION = "Your own policies and the AWS managed ones the emulator's catalog holds.";

const SELECT_FIRST = 'Select a policy first';
const AWS_MANAGED_REASON = 'An AWS managed policy cannot be deleted.';
const REFRESHED = 'Policies refreshed';
/** What a failed read names (R10.1). */
const THING = 'policy list';

/** The choice "Policy type", in order; "Customer managed" at start. */
const SCOPES: readonly { value: PolicyScope; label: string }[] = [
  { value: 'Local', label: 'Customer managed' },
  { value: 'AWS', label: 'AWS managed' },
  { value: 'All', label: 'All types' },
];

const START_PREFERENCES = { pageSize: 20, wrapLines: true };

const PAGE_SIZES = [10, 20, 50] as const;

type BodyState =
  | { kind: 'loading' }
  | { kind: 'rows' }
  | { kind: 'empty' }
  | { kind: 'no-match'; text: string }
  | ({ kind: 'failure' } & ReadFailureState);

function bodyState(listing: Listing<Policy>, connection: ScreenPageProps['connection']): BodyState {
  if (listing.failure !== undefined) {
    return { kind: 'failure', ...readFailureState(listing.failure, connection, THING) };
  }
  if (listing.items === undefined) {
    return { kind: 'loading' };
  }
  if (listing.items.length > 0) {
    return { kind: 'rows' };
  }
  return listing.filter === '' ? { kind: 'empty' } : { kind: 'no-match', text: listing.filter };
}

function countText(count: ListingCount): string {
  return `${String(count.total)}${count.more ? '+' : ''}`;
}

function matchesText(count: ListingCount): string {
  return count.total === 1 && !count.more ? '1 match' : `${countText(count)} matches`;
}

type Starter = 'filter' | 'pagination' | 'preferences' | 'scope' | null;

interface TableBodyProps {
  state: BodyState;
  scope: PolicyScope;
  onCreate: () => void;
  onClearFilter: () => void;
  onRetry: () => void;
}

function TableBody({ state, scope, onCreate, onClearFilter, onRetry }: TableBodyProps) {
  switch (state.kind) {
    case 'loading':
    case 'rows':
      return null;
    case 'empty':
      return scope === 'Local' ? (
        <Box textAlign="center" color="inherit">
          <SpaceBetween size="xxs">
            <Box variant="strong" color="inherit">
              No customer managed policies
            </Box>
            <Box variant="p" color="inherit">
              This emulator holds no customer managed policies. It starts without any each time it restarts. Create one
              here, or with any tool pointed at the emulator.
            </Box>
          </SpaceBetween>
          <Box margin={{ top: 's' }}>
            <Button onClick={onCreate}>Create policy</Button>
          </Box>
        </Box>
      ) : (
        <Box textAlign="center" color="inherit">
          <SpaceBetween size="xxs">
            <Box variant="strong" color="inherit">
              No policies
            </Box>
            <Box variant="p" color="inherit">
              The emulator holds no policies of this type.
            </Box>
          </SpaceBetween>
        </Box>
      );
    case 'no-match':
      return (
        <Box textAlign="center" color="inherit">
          <SpaceBetween size="xxs">
            <Box variant="strong" color="inherit">
              No matches
            </Box>
            <Box variant="p" color="inherit">
              {`No policy name contains “${state.text}”.`}
            </Box>
          </SpaceBetween>
          <Box margin={{ top: 's' }}>
            <Button onClick={onClearFilter}>Clear filter</Button>
          </Box>
        </Box>
      );
    case 'failure':
      return <ReadFailure state={state} onRetry={onRetry} />;
  }
}

/**
 * `/aws/iam/policies`: the emulator's policies of the type chosen, read through the engine with `ListPolicies` on every
 * opening, choice and refresh, one page at a time. The choice, the filter and the page are the page's own state, not
 * the address's. Once the connection is connected again after a failure, the list is read again by itself.
 */
export function PoliciesPage({ connection }: ScreenPageProps) {
  useShowsResources('policies');
  const handleFollow = useFollow();
  const navigate = useNavigate();
  const modalRoot = useAreaModalRoot();
  const [announcement, announce] = useAnnouncer();
  const filterRef = useRef<TextFilterProps.Ref>(null);
  const deleteRef = useRef<ButtonProps.Ref>(null);

  const [scope, setScope] = useState<PolicyScope>('Local');
  const [filter, setFilter] = useState('');
  const [preferences, setPreferences] = useState(START_PREFERENCES);
  const [starter, setStarter] = useState<Starter>(null);
  const listing = usePolicyListing({
    endpoint: connection.engineOrigin,
    pageSize: preferences.pageSize,
    filter,
    scope,
  });
  const { items: policies, refresh, applyFilter } = listing;
  const loaded = policies !== undefined;
  const state = bodyState(listing, connection);

  // One row, by ARN, while it is on the page shown.
  const [selectedArn, setSelectedArn] = useState<string>();
  if (policies !== undefined && selectedArn !== undefined && !policies.some((policy) => policy.arn === selectedArn)) {
    setSelectedArn(undefined);
  }
  const selected = (policies ?? []).find((policy) => policy.arn === selectedArn);
  const [deleting, setDeleting] = useState<Policy>();

  const startListing = useCallback(() => {
    setStarter(null);
    refresh();
  }, [refresh]);

  // Kept from the previous render, as the role list does.
  const [refreshing, setRefreshing] = useState(false);
  const failureLine = state.kind === 'failure' ? state.firstText : undefined;
  const [seenFailureLine, setSeenFailureLine] = useState<string>();
  const connected = connection.result?.kind === 'connected';
  const [seenConnected, setSeenConnected] = useState(connected);
  const down = connection.result !== undefined && !connected;
  const [wasDown, setWasDown] = useState(down);
  if (down && !wasDown) {
    setWasDown(true);
  }
  if (refreshing && policies !== undefined) {
    setRefreshing(false);
    announce(REFRESHED);
  } else if (refreshing && listing.failure !== undefined) {
    setRefreshing(false);
  }
  if (failureLine !== seenFailureLine) {
    setSeenFailureLine(failureLine);
    if (failureLine !== undefined) {
      announce(failureLine);
    }
  }
  if (connected !== seenConnected) {
    setSeenConnected(connected);
    if (connected && (listing.failure !== undefined || wasDown)) {
      setWasDown(false);
      startListing();
    }
  }

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    startListing();
  }, [startListing]);

  const handleScope = useCallback(({ detail }: { detail: SelectProps.ChangeDetail }) => {
    const chosen = SCOPES.find((option) => option.value === detail.selectedOption.value);
    if (chosen !== undefined) {
      setStarter('scope');
      setScope(chosen.value);
    }
  }, []);

  const handleFilterChange = useCallback(({ detail }: { detail: TextFilterProps.ChangeDetail }) => {
    setStarter('filter');
    setFilter(detail.filteringText);
  }, []);

  const handleFilterKey = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Enter' && event.target instanceof HTMLInputElement) {
        setStarter('filter');
        applyFilter();
      }
    },
    [applyFilter],
  );

  const handleClearFilter = useCallback(() => {
    setStarter('filter');
    setFilter('');
    filterRef.current?.focus();
  }, []);

  const handlePageChange = useCallback(
    ({ detail }: { detail: { currentPageIndex: number } }) => {
      setStarter('pagination');
      listing.goToPage(detail.currentPageIndex);
    },
    [listing],
  );

  const handlePreferences = useCallback(
    ({ detail }: { detail: CollectionPreferencesProps.Preferences }) => {
      const pageSize = detail.pageSize ?? preferences.pageSize;
      if (pageSize !== preferences.pageSize) {
        setStarter('preferences');
      }
      setPreferences({ pageSize, wrapLines: detail.wrapLines ?? preferences.wrapLines });
    },
    [preferences],
  );

  const handleCloseDialog = useCallback(() => {
    setStarter(null);
    setDeleting(undefined);
    deleteRef.current?.focus();
  }, []);

  const columns: TableProps.ColumnDefinition<Policy>[] = [
    {
      id: 'name',
      header: 'Policy name',
      isRowHeader: true,
      minWidth: NAME_COLUMN_MIN_WIDTH,
      cell: (policy) => (
        <Link href={policyPath(policy.arn)} onFollow={handleFollow}>
          <ValueText kind="name" value={policy.name} />
        </Link>
      ),
    },
    { id: 'type', header: 'Type', cell: (policy) => <ValueText kind="fixed" value={policy.type} /> },
    {
      id: 'attached',
      header: 'Attached entities',
      cell: (policy) => (
        <ValueText
          kind="fixed"
          value={policy.attachmentCount === undefined ? undefined : String(policy.attachmentCount)}
          none={NO_VALUE}
        />
      ),
    },
    {
      id: 'lastChanged',
      header: 'Last changed',
      cell: (policy) => <ValueText kind="fixed" value={utcDateText(policy.updateDate)} />,
    },
  ];

  const count = loaded ? listing.count : undefined;
  const createPolicy = () => void navigate(CREATE_POLICY_PATH);
  const awsManaged = selected?.type === 'AWS managed';
  const deleteReason = selected === undefined ? SELECT_FIRST : awsManaged ? AWS_MANAGED_REASON : undefined;
  const scopeOption = SCOPES.find((option) => option.value === scope) ?? SCOPES[0];

  return (
    <>
      <Table<Policy>
        variant="full-page"
        items={policies ?? []}
        trackBy="arn"
        columnDefinitions={columns}
        selectionType="single"
        selectedItems={selected === undefined ? [] : [selected]}
        onSelectionChange={({ detail }) => {
          setSelectedArn(detail.selectedItems[0]?.arn);
        }}
        ariaLabels={{
          tableLabel: POLICIES_TITLE,
          selectionGroupLabel: 'Policy selection',
          itemSelectionLabel: (_, policy) => policy.name,
        }}
        wrapLines={preferences.wrapLines}
        loading={state.kind === 'loading'}
        loadingText="Loading policies"
        empty={
          <TableBody
            state={state}
            scope={scope}
            onCreate={createPolicy}
            onClearFilter={handleClearFilter}
            onRetry={startListing}
          />
        }
        header={
          <Header
            variant="awsui-h1-sticky"
            counter={count === undefined ? undefined : `(${countText(count)})`}
            description={DESCRIPTION}
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button iconName="refresh" ariaLabel="Refresh policies" onClick={handleRefresh} />
                <Button
                  ref={deleteRef}
                  disabled={deleteReason !== undefined}
                  {...(deleteReason === undefined ? {} : { disabledReason: deleteReason })}
                  onClick={() => {
                    if (selected !== undefined && !awsManaged) {
                      setDeleting(selected);
                    }
                  }}
                >
                  Delete
                </Button>
                <Button variant="primary" onClick={createPolicy}>
                  Create policy
                </Button>
              </SpaceBetween>
            }
          >
            {POLICIES_TITLE}
          </Header>
        }
        filter={
          <SpaceBetween direction="horizontal" size="xs">
            <Select
              selectedOption={scopeOption ?? null}
              options={SCOPES.map((option) => ({ value: option.value, label: option.label }))}
              inlineLabelText="Policy type"
              ariaLabel="Policy type"
              onChange={handleScope}
            />
            <div onKeyDown={handleFilterKey}>
              <TextFilter
                ref={filterRef}
                filteringText={filter}
                filteringPlaceholder="Search"
                filteringAriaLabel="Search items"
                disabled={!loaded && starter !== 'filter'}
                {...(listing.filter !== '' && count !== undefined && { countText: matchesText(count) })}
                onChange={handleFilterChange}
              />
            </div>
          </SpaceBetween>
        }
        pagination={
          <Pagination
            currentPageIndex={listing.currentPage}
            pagesCount={listing.pagesCount}
            openEnd={listing.openEnd}
            disabled={!loaded && starter !== 'pagination'}
            ariaLabels={{
              nextPageLabel: 'Next page',
              previousPageLabel: 'Previous page',
              pageLabel: (page) => `Page ${String(page)}`,
            }}
            onChange={handlePageChange}
          />
        }
        preferences={
          <CollectionPreferences
            {...modalRoot}
            title="Preferences"
            confirmLabel="Confirm"
            cancelLabel="Cancel"
            closeAriaLabel="Close modal"
            disabled={!loaded && starter !== 'preferences'}
            preferences={preferences}
            pageSizePreference={{
              title: 'Page size',
              options: PAGE_SIZES.map((size) => ({ value: size, label: `${String(size)} policies` })),
            }}
            wrapLinesPreference={{ label: 'Wrap lines', description: 'Show all of a long name' }}
            onConfirm={handlePreferences}
          />
        }
      />
      {announcement}
      {deleting !== undefined && (
        <DeletePolicyDialog
          policy={{ arn: deleting.arn, name: deleting.name }}
          from="list"
          connection={connection}
          onClose={handleCloseDialog}
        />
      )}
    </>
  );
}
