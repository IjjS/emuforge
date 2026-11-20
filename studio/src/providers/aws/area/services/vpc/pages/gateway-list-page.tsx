import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Header from '@cloudscape-design/components/header';
import Link from '@cloudscape-design/components/link';
import Pagination from '@cloudscape-design/components/pagination';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Table, { type TableProps } from '@cloudscape-design/components/table';
import TextFilter from '@cloudscape-design/components/text-filter';
import { useCallback, useState } from 'react';
import { useSearchParams } from 'react-router';

import type { AreaConnection } from '../../../components/emulator-line';
import {
  actionFailureItem,
  readFailureState,
  ReadFailure,
  useAnnouncer,
  type ReadFailureState,
} from '../../../components/failure-states';
import { usePageFlash } from '../../../components/page-flash';
import { useShowsResources } from '../../../components/page-resources';
import { useFollow } from '../../../components/use-follow';
import { failureOf, usePageSignal, type TokenListing } from '../../../components/use-token-listing';
import { ValueText } from '../../../components/value-text';
import type { InternetGateway } from '../api';
import { DeleteGatewayDialog, type GatewayTarget } from '../components/delete-gateway-dialog';
import { PartDialog } from '../components/part-dialog';
import {
  attachInternetGatewayHref,
  createInternetGatewayHref,
  CREATE_INTERNET_GATEWAY_TITLE,
  INTERNET_GATEWAYS_TITLE,
  INTERNET_GATEWAYS_WORD,
  NAME_FILTER_DESCRIPTION,
  nameOrId,
  NONE,
  resourceName,
  VPC_QUERY,
  vpcHref,
} from '../format';
import { GATEWAY_CHANGE_OPERATIONS } from '../gateway-changes-api';
import { useDetachGateway } from '../gateway-changes';
import { useGatewayListing } from '../queries';

// The internet gateways, S12 (issue 574, design task 1 and 3): every internet gateway of the emulator, a page of
// `DescribeInternetGateways` at a time on its own tokens, in the API's order. The name filter is the API's, `tag:Name`
// with `*` around it, sent once the text has settled, and part of the page's request. A further page that comes back
// empty is shown as the list's end. For the one selected gateway, "Attach" (to S14) while detached, "Detach" while
// attached and "Delete" while detached, each unavailable otherwise with its reason. A gateway has no page of its own:
// its row holds all the API gives of it.

const SELECT_ONE = 'Select one internet gateway.';
const ATTACHED = 'This gateway is already attached.';
const NOT_ATTACHED = 'This gateway is not attached.';
const DETACH_FIRST = 'Detach the gateway before deleting it.';

/** A gateway to detach: its ID, how the dialog names it, and the VPC of its attachment. */
interface DetachTarget {
  id: string;
  label: string;
  vpcId: string;
}

/** A name keeps room for 24 characters (`aws-area.md`, entry 4): 28ch is those 24 and the cell's padding on each side. */
const NAME_MIN_WIDTH = '28ch';
/** The least width of an ID column that is a row header, so a zero-padded ID keeps to one or two lines at 390. */
const ID_MIN_WIDTH = '22ch';

type BodyState =
  | { kind: 'loading' }
  | { kind: 'rows' }
  | { kind: 'empty' }
  | { kind: 'no-match' }
  | { kind: 'past-end' }
  | { kind: 'failure'; failure: ReadFailureState };

function bodyState(listing: TokenListing<InternetGateway>, connection: AreaConnection, filtered: boolean): BodyState {
  if (listing.failure !== undefined) {
    return { kind: 'failure', failure: readFailureState(listing.failure, connection, 'internet gateway list') };
  }
  if (listing.items === undefined) {
    return { kind: 'loading' };
  }
  if (listing.items.length > 0) {
    return { kind: 'rows' };
  }
  if (listing.pastEnd) {
    return { kind: 'past-end' };
  }
  return filtered ? { kind: 'no-match' } : { kind: 'empty' };
}

/** The header's counter: the page's rows, with a plus while a next page follows ("(50+)"). */
function counterText(rows: number, openEnd: boolean): string {
  return `(${String(rows)}${openEnd ? '+' : ''})`;
}

/**
 * `/aws/vpc/internet-gateways`. A failed read, or a list shown while the connection was not connected, is read again
 * by itself once the connection is connected again, so after an emulator restart it shows the default VPC's gateway.
 */
export function GatewayListPage({ connection }: { connection: AreaConnection }) {
  useShowsResources(INTERNET_GATEWAYS_WORD);
  // Opened from a VPC's way to its gateway (`?vpc={id}`): an attach is for that VPC, and S13 and S14 keep it.
  const [query] = useSearchParams();
  const vpcValue = query.get(VPC_QUERY);
  const forVpc = vpcValue === null || vpcValue === '' ? undefined : vpcValue;
  const handleFollow = useFollow();
  const flash = usePageFlash();
  const [announcement, announce] = useAnnouncer();
  const [nameText, setNameText] = useState('');
  const [name, setName] = useState('');
  const [selectedId, setSelectedId] = useState<string>();
  const [deleting, setDeleting] = useState<GatewayTarget>();
  const [detaching, setDetaching] = useState<DetachTarget>();
  const [detachPending, setDetachPending] = useState(false);
  const detach = useDetachGateway(connection.engineOrigin);
  const pageSignal = usePageSignal();

  const listing = useGatewayListing(connection.engineOrigin, { name });
  const { items, refresh, currentPage, goToPage } = listing;
  const state = bodyState(listing, connection, name !== '');
  const loaded = items !== undefined;

  const handleRetry = useCallback(() => {
    refresh();
  }, [refresh]);

  // Kept from the previous render, as React's own pattern for it, so each change is acted on once.
  const failureLine = state.kind === 'failure' ? state.failure.firstText : undefined;
  const [seenFailureLine, setSeenFailureLine] = useState<string>();
  const connected = connection.result?.kind === 'connected';
  const [seenConnected, setSeenConnected] = useState(connected);
  const down = connection.result !== undefined && !connected;
  const [wasDown, setWasDown] = useState(down);
  if (down && !wasDown) {
    setWasDown(true);
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
      refresh();
    }
  }

  const rows = items ?? [];
  const selected = rows.find((row) => row.id === selectedId);
  const attached = selected?.vpcId !== undefined;
  const attachReason = selected === undefined ? SELECT_ONE : attached ? ATTACHED : undefined;
  const detachReason = selected === undefined ? SELECT_ONE : attached ? undefined : NOT_ATTACHED;
  const deleteReason = selected === undefined ? SELECT_ONE : attached ? DETACH_FIRST : undefined;

  const changeName = (next: string) => {
    setSelectedId(undefined);
    setName(next);
  };

  const handleClearFilter = () => {
    setNameText('');
    changeName('');
  };

  const handlePageChange = ({ detail }: { detail: { currentPageIndex: number } }) => {
    setSelectedId(undefined);
    goToPage(detail.currentPageIndex);
  };

  const handleDeleted = (gateway: GatewayTarget) => {
    setDeleting(undefined);
    setSelectedId(undefined);
    flash.show([{ type: 'success', content: `Deleted internet gateway ${gateway.label}` }]);
  };

  // "Detach" confirmed: the result, or the failure, goes to the flash and the dialog closes either way.
  const handleDetach = () => {
    if (detaching === undefined || detachPending) {
      return;
    }
    const target = detaching;
    const signal = pageSignal();
    setDetachPending(true);
    detach(target.id, target.vpcId, signal).then(
      () => {
        if (signal.aborted) return;
        setDetachPending(false);
        setDetaching(undefined);
        flash.show([{ type: 'success', content: `Detached ${target.id} from ${target.vpcId}` }]);
      },
      (error: unknown) => {
        if (signal.aborted) return;
        setDetachPending(false);
        setDetaching(undefined);
        flash.show([
          actionFailureItem(
            failureOf(error, GATEWAY_CHANGE_OPERATIONS.detachInternetGateway),
            `Detaching internet gateway ${target.label}`,
            connection.engineOrigin,
          ),
        ]);
      },
    );
  };

  const columns: TableProps.ColumnDefinition<InternetGateway>[] = [
    {
      id: 'name',
      header: 'Name',
      minWidth: NAME_MIN_WIDTH,
      cell: (row) => <ValueText kind="name" value={resourceName(row.tags)} />,
    },
    {
      id: 'id',
      header: 'Internet gateway ID',
      isRowHeader: true,
      minWidth: ID_MIN_WIDTH,
      cell: (row) => <ValueText kind="name" value={row.id} />,
    },
    {
      id: 'state',
      header: 'State',
      cell: (row) => <ValueText kind="fixed" value={row.vpcId === undefined ? 'Detached' : 'Attached'} />,
    },
    {
      id: 'vpc',
      header: 'VPC ID',
      cell: (row) =>
        row.vpcId === undefined ? (
          <ValueText kind="name" value={undefined} none={NONE} />
        ) : (
          <Link href={vpcHref(row.vpcId)} onFollow={handleFollow}>
            <ValueText kind="name" value={row.vpcId} />
          </Link>
        ),
    },
  ];

  let empty = null;
  if (state.kind === 'empty') {
    empty = (
      <Box textAlign="center" color="inherit">
        <SpaceBetween size="xxs">
          <Box variant="strong" color="inherit">
            No internet gateways
          </Box>
          <Box variant="p" color="inherit">
            The emulator holds no internet gateway.
          </Box>
        </SpaceBetween>
        <Box margin={{ top: 's' }}>
          <Button href={createInternetGatewayHref(forVpc)} onFollow={handleFollow}>
            {CREATE_INTERNET_GATEWAY_TITLE}
          </Button>
        </Box>
      </Box>
    );
  } else if (state.kind === 'no-match') {
    empty = (
      <Box textAlign="center" color="inherit">
        <Box variant="strong" color="inherit">
          No internet gateways match
        </Box>
        <Box margin={{ top: 's' }}>
          <Button onClick={handleClearFilter}>Clear filter</Button>
        </Box>
      </Box>
    );
  } else if (state.kind === 'past-end') {
    empty = (
      <Box textAlign="center" color="inherit">
        <Box variant="strong" color="inherit">
          No more internet gateways
        </Box>
      </Box>
    );
  } else if (state.kind === 'failure') {
    empty = <ReadFailure state={state.failure} onRetry={handleRetry} />;
  }

  return (
    <>
      <Table<InternetGateway>
        variant="full-page"
        items={rows}
        trackBy="id"
        selectionType="single"
        selectedItems={selected === undefined ? [] : [selected]}
        onSelectionChange={({ detail }) => {
          setSelectedId(detail.selectedItems[0]?.id);
        }}
        ariaLabels={{
          selectionGroupLabel: 'Internet gateway selection',
          itemSelectionLabel: (_, row) => nameOrId(row.id, row.tags),
        }}
        columnDefinitions={columns}
        wrapLines
        loading={state.kind === 'loading'}
        loadingText="Loading internet gateways"
        empty={empty}
        filter={
          <TextFilter
            filteringText={nameText}
            filteringPlaceholder="Find by name"
            filteringAriaLabel="Name"
            filteringClearAriaLabel="Clear the name filter"
            onChange={({ detail }) => {
              setNameText(detail.filteringText);
            }}
            onDelayedChange={({ detail }) => {
              if (detail.filteringText !== name) {
                changeName(detail.filteringText);
              }
            }}
          />
        }
        header={
          <Header
            variant="awsui-h1-sticky"
            counter={items === undefined ? undefined : counterText(items.length, listing.openEnd)}
            description={
              forVpc === undefined ? (
                NAME_FILTER_DESCRIPTION
              ) : (
                <SpaceBetween size="xxxs">
                  <span>{NAME_FILTER_DESCRIPTION}</span>
                  <span>
                    <ValueText kind="text" value="Attach is for " />
                    <ValueText kind="name" value={forVpc} />
                    <ValueText kind="text" value="." />
                  </span>
                </SpaceBetween>
              )
            }
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button iconName="refresh" ariaLabel="Refresh" loading={listing.loading} onClick={refresh} />
                <Button
                  disabled={attachReason !== undefined}
                  disabledReason={attachReason}
                  {...(selected === undefined ? {} : { href: attachInternetGatewayHref(selected.id, forVpc) })}
                  onFollow={handleFollow}
                >
                  Attach
                </Button>
                <Button
                  disabled={detachReason !== undefined}
                  disabledReason={detachReason}
                  onClick={() => {
                    if (selected?.vpcId !== undefined) {
                      setDetaching({
                        id: selected.id,
                        label: nameOrId(selected.id, selected.tags),
                        vpcId: selected.vpcId,
                      });
                    }
                  }}
                >
                  Detach
                </Button>
                <Button
                  disabled={deleteReason !== undefined}
                  disabledReason={deleteReason}
                  onClick={() => {
                    if (selected !== undefined && deleteReason === undefined) {
                      setDeleting({ id: selected.id, label: nameOrId(selected.id, selected.tags) });
                    }
                  }}
                >
                  Delete
                </Button>
                <Button variant="primary" href={createInternetGatewayHref(forVpc)} onFollow={handleFollow}>
                  {CREATE_INTERNET_GATEWAY_TITLE}
                </Button>
              </SpaceBetween>
            }
          >
            {INTERNET_GATEWAYS_TITLE}
          </Header>
        }
        pagination={
          <Pagination
            currentPageIndex={currentPage}
            pagesCount={listing.pagesCount}
            openEnd={listing.openEnd}
            disabled={!loaded}
            ariaLabels={{
              nextPageLabel: 'Next page',
              previousPageLabel: 'Previous page',
              pageLabel: (page) => `Page ${String(page)}`,
            }}
            onChange={handlePageChange}
          />
        }
      />
      <PartDialog
        visible={detaching !== undefined}
        header="Detach internet gateway?"
        body={
          detaching === undefined ? null : (
            <>
              <ValueText kind="name" value={detaching.label} />
              <ValueText kind="text" value=" is detached from " />
              <ValueText kind="name" value={detaching.vpcId} />
              <ValueText
                kind="text"
                value=". Routes that lead to it stay in their route tables and turn to blackhole."
              />
            </>
          )
        }
        action="Detach"
        pending={detachPending}
        onConfirm={handleDetach}
        onDismiss={() => {
          setDetaching(undefined);
        }}
      />
      <DeleteGatewayDialog
        gateway={deleting}
        connection={connection}
        onDeleted={handleDeleted}
        onDismiss={() => {
          setDeleting(undefined);
        }}
      />
      {announcement}
    </>
  );
}
