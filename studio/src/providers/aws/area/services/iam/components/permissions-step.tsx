import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Header from '@cloudscape-design/components/header';
import Pagination from '@cloudscape-design/components/pagination';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Table, { type TableProps } from '@cloudscape-design/components/table';
import TextFilter, { type TextFilterProps } from '@cloudscape-design/components/text-filter';
import { useCallback, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

import type { AreaConnection } from '../../../components/emulator-line';
import type { Policy } from '../api';
import { POLICY_PAGE_SIZE, usePolicyListing, type Listing, type ListingCount } from '../queries';
import { readFailureState, type ReadFailureState } from './failures';
import { useAnnouncer } from './page-parts';
import { ReadFailure } from './states';

// Step 2 of "Create role", "Add permissions" (issue 82, requirement R6.4, R9.4, R10): the table "Permissions
// policies" of the emulator's managed policies, one page of `ListPolicies` at a time, read when the step opens; the
// choice is the wizard's and outlives pages, filters and steps. The section "Set permissions boundary" is not built
// (R3).

export const POLICIES_TITLE = 'Permissions policies';
const POLICIES_HELP = 'Policies the emulator holds. The emulator attaches at most 10 managed policies to a role.';
/** What a failed read names (R10.1). */
const THING = 'policy list';

type BodyState =
  | { kind: 'loading' }
  | { kind: 'rows' }
  | { kind: 'empty' }
  | { kind: 'no-match'; text: string }
  | ({ kind: 'failure' } & ReadFailureState);

function bodyState(listing: Listing<Policy>, connection: AreaConnection): BodyState {
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

function matchesText(count: ListingCount): string {
  const total = `${String(count.total)}${count.more ? '+' : ''}`;
  return count.total === 1 && !count.more ? '1 match' : `${total} matches`;
}

/** The control whose use started the reading shown: it stays enabled, so it keeps focus (R10.1). */
type Starter = 'filter' | 'pagination' | null;

/**
 * The choice after a change of the shown page's check boxes: the chosen policies of other pages and those still
 * checked here keep their place, and the newly checked ones follow in the page's order.
 */
function chosenAfter(chosen: readonly Policy[], page: readonly Policy[], checked: readonly Policy[]): Policy[] {
  const onPage = new Set(page.map((policy) => policy.arn));
  const checkedArns = new Set(checked.map((policy) => policy.arn));
  const kept = chosen.filter((policy) => !onPage.has(policy.arn) || checkedArns.has(policy.arn));
  const keptArns = new Set(kept.map((policy) => policy.arn));
  const added = page.filter((policy) => checkedArns.has(policy.arn) && !keptArns.has(policy.arn));
  return [...kept, ...added];
}

export interface PolicyChoiceTableProps {
  connection: AreaConnection;
  /** The chosen policies, in the order they were chosen. */
  chosen: readonly Policy[];
  onChoose: (chosen: Policy[]) => void;
  /** The table's header; it is given the count of the chosen policies. */
  header: (chosenCount: number) => ReactNode;
  /** The table's name for assistive technology. */
  label: string;
  /** The ARNs of policies that are marked "Attached" and cannot be chosen (issue 535, task 3). */
  attached?: ReadonlySet<string>;
  variant?: TableProps.Variant;
}

/**
 * The emulator's managed policies, one page of `ListPolicies` at a time, read when the table mounts, with the filter
 * and the pages; the choice is the caller's and outlives pages and filters. Lifted from step 2 of "Create role" for
 * "Attach policies" of a role's page (issue 535, task 3).
 */
export function PolicyChoiceTable({
  connection,
  chosen,
  onChoose,
  header,
  label,
  attached,
  variant = 'container',
}: PolicyChoiceTableProps) {
  const [filter, setFilter] = useState('');
  const [starter, setStarter] = useState<Starter>(null);
  const filterRef = useRef<TextFilterProps.Ref>(null);
  const [announcement, announce] = useAnnouncer();
  const listing = usePolicyListing({ endpoint: connection.engineOrigin, pageSize: POLICY_PAGE_SIZE, filter });
  const { items: policies, refresh, applyFilter } = listing;
  const loaded = policies !== undefined;
  const state = bodyState(listing, connection);

  const startReading = useCallback(() => {
    setStarter(null);
    refresh();
  }, [refresh]);

  // A failure state is announced once, with its first line; once the connection is connected again after a failed
  // read, the table reads again by itself (R10.2).
  const failureLine = state.kind === 'failure' ? state.firstText : undefined;
  const [seenFailureLine, setSeenFailureLine] = useState<string>();
  if (failureLine !== seenFailureLine) {
    setSeenFailureLine(failureLine);
    if (failureLine !== undefined) {
      announce(failureLine);
    }
  }
  const connected = connection.result?.kind === 'connected';
  const [seenConnected, setSeenConnected] = useState(connected);
  if (connected !== seenConnected) {
    setSeenConnected(connected);
    if (connected && listing.failure !== undefined) {
      startReading();
    }
  }

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

  const chosenArns = new Set(chosen.map((policy) => policy.arn));
  const selected = (policies ?? []).filter((policy) => chosenArns.has(policy.arn));

  const handleSelection = ({ detail }: { detail: TableProps.SelectionChangeDetail<Policy> }) => {
    onChoose(chosenAfter(chosen, policies ?? [], detail.selectedItems));
  };

  const columns: TableProps.ColumnDefinition<Policy>[] = [
    { id: 'name', header: 'Policy name', isRowHeader: true, cell: (policy) => policy.name },
    { id: 'type', header: 'Type', cell: (policy) => policy.type },
    ...(attached === undefined
      ? []
      : [
          {
            id: 'attached',
            header: 'Attached',
            cell: (policy: Policy) => (attached.has(policy.arn) ? 'Attached' : '-'),
          },
        ]),
  ];

  const count = loaded ? listing.count : undefined;

  return (
    <>
      <Table<Policy>
        variant={variant}
        items={policies ?? []}
        trackBy="arn"
        columnDefinitions={columns}
        selectionType="multi"
        selectedItems={selected}
        onSelectionChange={handleSelection}
        {...(attached !== undefined && { isItemDisabled: (policy: Policy) => attached.has(policy.arn) })}
        ariaLabels={{
          tableLabel: label,
          selectionGroupLabel: 'Policy selection',
          allItemsSelectionLabel: () => 'All items',
          itemSelectionLabel: (_, policy) => policy.name,
        }}
        loading={state.kind === 'loading'}
        loadingText="Loading policies"
        empty={<PoliciesBody state={state} onClearFilter={handleClearFilter} onRetry={startReading} />}
        header={header(chosen.length)}
        filter={
          <div onKeyDown={handleFilterKey}>
            <TextFilter
              ref={filterRef}
              filteringText={filter}
              filteringPlaceholder="Search"
              filteringAriaLabel="Search items"
              disabled={!loaded && starter !== 'filter'}
              {...(listing.filter !== '' && count !== undefined && { countText: matchesText(count) })}
              onChange={({ detail }) => {
                setStarter('filter');
                setFilter(detail.filteringText);
              }}
            />
          </div>
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
            onChange={({ detail }) => {
              setStarter('pagination');
              listing.goToPage(detail.currentPageIndex);
            }}
          />
        }
      />
      {announcement}
    </>
  );
}

export interface PermissionsStepProps {
  connection: AreaConnection;
  /** The chosen policies, in step 3's order. */
  chosen: readonly Policy[];
  onChoose: (chosen: Policy[]) => void;
  /** "A role can have at most 10 managed policies in the emulator.", when shown. */
  message: string | undefined;
}

/** Step 2's content: the rule's message above the table, then the table with its filter and pagination. */
export function PermissionsStep({ connection, chosen, onChoose, message }: PermissionsStepProps) {
  return (
    <SpaceBetween size="l">
      {message !== undefined && <Alert type="error">{message}</Alert>}
      <PolicyChoiceTable
        connection={connection}
        chosen={chosen}
        onChoose={onChoose}
        label={POLICIES_TITLE}
        header={(count) => (
          <Header variant="h2" counter={`(${String(count)} selected)`} description={POLICIES_HELP}>
            {POLICIES_TITLE}
          </Header>
        )}
      />
    </SpaceBetween>
  );
}

interface PoliciesBodyProps {
  state: BodyState;
  onClearFilter: () => void;
  onRetry: () => void;
}

/** The table's empty slot: no policy, no match and the failure states (R10.1). */
function PoliciesBody({ state, onClearFilter, onRetry }: PoliciesBodyProps) {
  switch (state.kind) {
    case 'loading':
    case 'rows':
      return null;
    case 'empty':
      return (
        <Box textAlign="center" color="inherit">
          <Box variant="strong" color="inherit">
            No policies
          </Box>
          <Box variant="p" color="inherit">
            The emulator holds no managed policies.
          </Box>
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
