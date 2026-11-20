import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import Link from '@cloudscape-design/components/link';
import Pagination from '@cloudscape-design/components/pagination';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Table, { type TableProps } from '@cloudscape-design/components/table';
import { useState } from 'react';

import type { RequestFailure } from '../../../../../../lib/aws/request';

import { CopyValue } from '../../../components/copy-value';
import { actionFailureItem, readFailureState, ReadFailure, useAnnouncer } from '../../../components/failure-states';
import type { AreaConnection } from '../../../components/emulator-line';
import { usePageFlash } from '../../../components/page-flash';
import { useShowsResources } from '../../../components/page-resources';
import { failureOf, usePageSignal } from '../../../components/use-token-listing';
import { useFollow } from '../../../components/use-follow';
import { ValueText } from '../../../components/value-text';
import type { ScreenPageProps } from '../../../screens';
import type { Association, Route, RouteTable } from '../api';
import { DeleteRouteDialog, type RouteTarget } from '../components/delete-route-dialog';
import { DeleteRouteTableDialog, type RouteTableTarget } from '../components/delete-route-table-dialog';
import { PartDialog } from '../components/part-dialog';
import { RoutesTable } from '../components/routes-table';
import { TagsTable } from '../components/tags-table';
import {
  addRouteHref,
  associateSubnetHref,
  nameOrId,
  NONE,
  ROUTE_TABLES_PATH,
  ROUTE_TABLES_WORD,
  subnetHref,
  vpcHref,
} from '../format';
import { useRouteTable } from '../queries';
import { ROUTE_CHANGE_OPERATIONS } from '../route-changes-api';
import { useDisassociateSubnet } from '../route-changes';

// A route table, S9 (issue 574, design task 1 and 3): read by the filter `route-table-id`, so an id the emulator does
// not hold is "Route table not found". Its routes and its associations are in that one answer; each of the two tables
// pages what it holds, 25 a page, on this page. "Delete route table", unavailable for a VPC's main table, leads to S7
// with its result. "Add route" leads to S10 and "Associate subnet" to S11; "Delete route" (typed `delete`) and
// "Disassociate" (its button) act on the one selected row, report their result or failure in the area's flash and
// read the table again.

/** How many routes or associations a page of their table shows. */
const PART_PAGE_SIZE = 25;

const MAIN_REASON = "A VPC's main route table cannot be deleted.";

const SELECT_ROUTE = 'Select one route.';
const LOCAL_ROUTE = 'The local route cannot be deleted.';
const IPV4_ONLY = 'Studio deletes a route by its IPv4 destination only.';
const SELECT_ASSOCIATION = 'Select one association.';

/** Why "Delete route" is unavailable for `route`, `undefined` when it is available. */
function deleteRouteReason(route: Route | undefined): string | undefined {
  if (route === undefined) {
    return SELECT_ROUTE;
  }
  if (route.target === 'local') {
    return LOCAL_ROUTE;
  }
  return route.destination?.kind === 'ipv4' ? undefined : IPV4_ONLY;
}

/** A route's key, the one the routes table tracks it by: its destination. */
function routeKeyOf(route: Route): string {
  return route.destination === undefined ? `${route.target ?? ''}|${route.state ?? ''}` : route.destination.value;
}

/** The page of `items` at `page` (from 1), and how many pages they fill (at least one). */
function pageOf<T>(items: readonly T[], page: number): { rows: T[]; pages: number; current: number } {
  const pages = Math.max(1, Math.ceil(items.length / PART_PAGE_SIZE));
  const current = Math.min(Math.max(page, 1), pages);
  return { rows: items.slice((current - 1) * PART_PAGE_SIZE, current * PART_PAGE_SIZE), pages, current };
}

function PartPagination({
  current,
  pages,
  of,
  onChange,
}: {
  current: number;
  pages: number;
  of: string;
  onChange: (page: number) => void;
}) {
  return (
    <Pagination
      currentPageIndex={current}
      pagesCount={pages}
      ariaLabels={{
        nextPageLabel: `Next page of ${of}`,
        previousPageLabel: `Previous page of ${of}`,
        pageLabel: (page) => `Page ${String(page)} of ${of}`,
      }}
      onChange={({ detail }) => {
        onChange(detail.currentPageIndex);
      }}
    />
  );
}

function Details({ table }: { table: RouteTable }) {
  const handleFollow = useFollow();
  return (
    <Container header={<Header variant="h2">Route table details</Header>}>
      <KeyValuePairs
        columns={3}
        minColumnWidth={220}
        ariaLabel="Route table details"
        items={[
          {
            label: 'Route table ID',
            value: <CopyValue label="Route table ID" value={table.id} kind="name" none={NONE} />,
          },
          {
            label: 'VPC ID',
            value:
              table.vpcId === undefined ? (
                <ValueText kind="name" value={undefined} none={NONE} />
              ) : (
                <Link href={vpcHref(table.vpcId)} onFollow={handleFollow}>
                  <ValueText kind="name" value={table.vpcId} />
                </Link>
              ),
          },
          { label: 'Main', value: <ValueText kind="fixed" value={table.main ? 'Yes' : 'No'} /> },
        ]}
      />
    </Container>
  );
}

interface RoutesProps {
  table: RouteTable;
  /** The key of the selected route; a route no longer in the table is no selection. */
  selectedKey: string | undefined;
  onSelect: (key: string | undefined) => void;
  onDelete: (route: Route) => void;
}

function Routes({ table, selectedKey, onSelect, onDelete }: RoutesProps) {
  const handleFollow = useFollow();
  const [page, setPage] = useState(1);
  const { rows, pages, current } = pageOf(table.routes, page);
  const selected = table.routes.find((route) => routeKeyOf(route) === selectedKey);
  const reason = deleteRouteReason(selected);
  return (
    <RoutesTable
      routes={rows}
      selection={{
        selected,
        onChange: (route) => {
          onSelect(route === undefined ? undefined : routeKeyOf(route));
        },
      }}
      header={
        <Header
          variant="h2"
          counter={`(${String(table.routes.length)})`}
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button
                disabled={reason !== undefined}
                disabledReason={reason}
                onClick={() => {
                  if (selected !== undefined && reason === undefined) {
                    onDelete(selected);
                  }
                }}
              >
                Delete route
              </Button>
              <Button href={addRouteHref(table.id)} onFollow={handleFollow}>
                Add route
              </Button>
            </SpaceBetween>
          }
        >
          Routes
        </Header>
      }
      pagination={<PartPagination current={current} pages={pages} of="routes" onChange={setPage} />}
    />
  );
}

/** The associations that have a subnet, in the API's order; the main association is no subnet's. */
function subnetAssociations(table: RouteTable): Association[] {
  return table.associations.filter((association) => association.subnetId !== undefined);
}

interface AssociationsProps {
  table: RouteTable;
  /** The ID of the selected association; one no longer in the table is no selection. */
  selectedId: string | undefined;
  onSelect: (id: string | undefined) => void;
  onDisassociate: (association: Association) => void;
}

function Associations({ table, selectedId, onSelect, onDisassociate }: AssociationsProps) {
  const handleFollow = useFollow();
  const [page, setPage] = useState(1);
  const associations = subnetAssociations(table);
  const { rows, pages, current } = pageOf(associations, page);
  const selected = associations.find((association) => association.id === selectedId);
  const reason = selected === undefined ? SELECT_ASSOCIATION : undefined;
  const associate = (
    <Button href={associateSubnetHref(table.id)} onFollow={handleFollow}>
      Associate subnet
    </Button>
  );
  const columns: TableProps.ColumnDefinition<Association>[] = [
    {
      id: 'subnet',
      header: 'Subnet ID',
      isRowHeader: true,
      cell: (association) => (
        <Link href={subnetHref(association.subnetId ?? '')} onFollow={handleFollow}>
          <ValueText kind="name" value={association.subnetId} />
        </Link>
      ),
    },
    { id: 'id', header: 'Association ID', cell: (association) => <ValueText kind="name" value={association.id} /> },
  ];
  return (
    <Table<Association>
      variant="container"
      items={rows}
      trackBy="id"
      columnDefinitions={columns}
      wrapLines
      selectionType="single"
      selectedItems={selected === undefined ? [] : [selected]}
      onSelectionChange={({ detail }) => {
        onSelect(detail.selectedItems[0]?.id);
      }}
      ariaLabels={{
        tableLabel: 'Subnet associations',
        selectionGroupLabel: 'Association selection',
        itemSelectionLabel: (_, association) => association.subnetId ?? association.id,
      }}
      header={
        <Header
          variant="h2"
          counter={`(${String(associations.length)})`}
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button
                disabled={reason !== undefined}
                disabledReason={reason}
                onClick={() => {
                  if (selected !== undefined) {
                    onDisassociate(selected);
                  }
                }}
              >
                Disassociate
              </Button>
              {associate}
            </SpaceBetween>
          }
        >
          Subnet associations
        </Header>
      }
      empty={
        <Box textAlign="center" color="inherit">
          <SpaceBetween size="xxs">
            <Box variant="strong" color="inherit">
              No subnet associations
            </Box>
            <Box variant="p" color="inherit">
              No subnet is associated with this route table.
            </Box>
            {associate}
          </SpaceBetween>
        </Box>
      }
      pagination={<PartPagination current={current} pages={pages} of="subnet associations" onChange={setPage} />}
    />
  );
}

/** What "Disassociate" parts: the association, its subnet, and the table as the dialog names it. */
interface PartingTarget {
  routeTableId: string;
  tableLabel: string;
  associationId: string;
  subnetId: string;
}

/**
 * "Disassociate subnet?", confirmed with its button alone: it sends `DisassociateRouteTable` by the association's ID;
 * its answer, a success or a failure, goes to the page, which closes it and shows it in the area's flash.
 */
function DisassociateDialog({
  parting,
  connection,
  onDone,
  onDismiss,
}: {
  parting: PartingTarget | undefined;
  connection: AreaConnection;
  onDone: (parting: PartingTarget, failure: RequestFailure | undefined) => void;
  onDismiss: () => void;
}) {
  const disassociate = useDisassociateSubnet(connection.engineOrigin);
  const pageSignal = usePageSignal();
  const [pending, setPending] = useState(false);
  if (parting === undefined) {
    return null;
  }
  const handleConfirm = () => {
    if (pending) {
      return;
    }
    const signal = pageSignal();
    setPending(true);
    disassociate(parting.routeTableId, parting.associationId, signal).then(
      () => {
        if (signal.aborted) return;
        setPending(false);
        onDone(parting, undefined);
      },
      (error: unknown) => {
        if (signal.aborted) return;
        setPending(false);
        onDone(parting, failureOf(error, ROUTE_CHANGE_OPERATIONS.disassociateRouteTable));
      },
    );
  };
  return (
    <PartDialog
      visible
      header="Disassociate subnet?"
      body={
        <>
          <ValueText kind="name" value={parting.subnetId} /> is no longer associated with{' '}
          <ValueText kind="name" value={parting.tableLabel} />.
        </>
      }
      action="Disassociate"
      pending={pending}
      onConfirm={handleConfirm}
      onDismiss={onDismiss}
    />
  );
}

/** "Route table not found", with Cloudscape's empty-state pattern, in the place of the sections. */
function NotFound() {
  const handleFollow = useFollow();
  return (
    <Container>
      <Box textAlign="center" color="inherit">
        <SpaceBetween size="xxs">
          <Box variant="strong" color="inherit">
            Route table not found
          </Box>
          <Box variant="p" color="inherit">
            The emulator holds no route table with this ID.
          </Box>
          <Link href={ROUTE_TABLES_PATH} onFollow={handleFollow}>
            View route tables
          </Link>
        </SpaceBetween>
      </Box>
    </Container>
  );
}

/**
 * `/aws/vpc/route-tables/route-table/{id}`: the table `id`, its routes, associations and tags, read on every opening
 * and refresh. A failed read is read again once the connection is connected again, so after an emulator restart the
 * page shows "Route table not found".
 */
export function RouteTablePage({ connection, params }: ScreenPageProps) {
  useShowsResources(ROUTE_TABLES_WORD);
  const id = params['id'] ?? '';
  const flash = usePageFlash();
  const [announcement, announce] = useAnnouncer();
  const reading = useRouteTable(connection.engineOrigin, id);
  const [deleting, setDeleting] = useState<RouteTableTarget>();
  const [selectedRoute, setSelectedRoute] = useState<string>();
  const [selectedAssociation, setSelectedAssociation] = useState<string>();
  const [deletingRoute, setDeletingRoute] = useState<RouteTarget>();
  const [parting, setParting] = useState<PartingTarget>();
  const { value: read, failure, refresh } = reading;
  const table = read?.found === true ? read.value : undefined;
  const failureState = failure === undefined ? undefined : readFailureState(failure, connection, 'route table');

  // Kept from the previous render, as React's own pattern for it, so each change is acted on once.
  const [seenFailureLine, setSeenFailureLine] = useState<string>();
  const failureLine = failureState?.firstText;
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
    if (connected && (failure !== undefined || wasDown)) {
      setWasDown(false);
      refresh();
    }
  }

  let content;
  if (failureState !== undefined) {
    content = (
      <Container>
        <ReadFailure state={failureState} onRetry={refresh} />
      </Container>
    );
  } else if (read === undefined) {
    content = (
      <Container>
        <Box textAlign="center" color="inherit">
          <StatusIndicator type="loading">Loading route table</StatusIndicator>
        </Box>
      </Container>
    );
  } else if (table === undefined) {
    content = <NotFound />;
  } else {
    content = (
      <SpaceBetween size="l">
        <Details table={table} />
        <Routes
          key={`routes-${table.id}`}
          table={table}
          selectedKey={selectedRoute}
          onSelect={setSelectedRoute}
          onDelete={(route) => {
            setDeletingRoute({
              routeTableId: table.id,
              tableLabel: nameOrId(table.id, table.tags),
              destination: route.destination?.value ?? '',
              target: route.target ?? NONE,
            });
          }}
        />
        <Associations
          key={`associations-${table.id}`}
          table={table}
          selectedId={selectedAssociation}
          onSelect={setSelectedAssociation}
          onDisassociate={(association) => {
            setParting({
              routeTableId: table.id,
              tableLabel: nameOrId(table.id, table.tags),
              associationId: association.id,
              subnetId: association.subnetId ?? '',
            });
          }}
        />
        <TagsTable tags={table.tags} />
      </SpaceBetween>
    );
  }

  const deleteReason = table?.main === true ? MAIN_REASON : undefined;

  const handleDeleted = (deleted: RouteTableTarget) => {
    setDeleting(undefined);
    flash.handOver(ROUTE_TABLES_PATH, [{ type: 'success', content: `Deleted route table ${deleted.label}` }]);
  };

  const handleRouteDeleted = (route: RouteTarget) => {
    setDeletingRoute(undefined);
    setSelectedRoute(undefined);
    flash.show([{ type: 'success', content: `Deleted the route ${route.destination}` }]);
  };

  const handleRouteFailed = (route: RouteTarget, routeFailure: RequestFailure) => {
    setDeletingRoute(undefined);
    flash.show([actionFailureItem(routeFailure, `Deleting the route ${route.destination}`, connection.engineOrigin)]);
  };

  const handleParted = (parted: PartingTarget, partFailure: RequestFailure | undefined) => {
    setParting(undefined);
    if (partFailure === undefined) {
      setSelectedAssociation(undefined);
      flash.show([{ type: 'success', content: `Disassociated ${parted.subnetId}` }]);
    } else {
      flash.show([actionFailureItem(partFailure, `Disassociating ${parted.subnetId}`, connection.engineOrigin)]);
    }
  };

  return (
    <>
      <ContentLayout
        header={
          <Header
            variant="h1"
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button iconName="refresh" ariaLabel="Refresh" onClick={refresh} />
                {table !== undefined && (
                  <Button
                    disabled={deleteReason !== undefined}
                    disabledReason={deleteReason}
                    onClick={() => {
                      if (deleteReason === undefined) {
                        setDeleting({ id: table.id, label: nameOrId(table.id, table.tags) });
                      }
                    }}
                  >
                    Delete route table
                  </Button>
                )}
              </SpaceBetween>
            }
          >
            <ValueText kind="name" value={table === undefined ? id : nameOrId(table.id, table.tags)} />
          </Header>
        }
      >
        {content}
      </ContentLayout>
      <DeleteRouteTableDialog
        table={deleting}
        connection={connection}
        onDeleted={handleDeleted}
        onDismiss={() => {
          setDeleting(undefined);
        }}
      />
      <DeleteRouteDialog
        route={deletingRoute}
        connection={connection}
        onDeleted={handleRouteDeleted}
        onFailed={handleRouteFailed}
        onDismiss={() => {
          setDeletingRoute(undefined);
        }}
      />
      <DisassociateDialog
        key={parting?.associationId ?? 'none'}
        parting={parting}
        connection={connection}
        onDone={handleParted}
        onDismiss={() => {
          setParting(undefined);
        }}
      />
      {announcement}
    </>
  );
}
