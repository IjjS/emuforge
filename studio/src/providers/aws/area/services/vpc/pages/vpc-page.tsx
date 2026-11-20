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
import { useCallback, useState, type ReactNode } from 'react';

import { CopyValue } from '../../../components/copy-value';
import type { AreaConnection } from '../../../components/emulator-line';
import { readFailureState, ReadFailure, useAnnouncer } from '../../../components/failure-states';
import { usePageFlash } from '../../../components/page-flash';
import { useShowsResources } from '../../../components/page-resources';
import { useFollow } from '../../../components/use-follow';
import type { TokenListing } from '../../../components/use-token-listing';
import { ValueText } from '../../../components/value-text';
import type { ScreenPageProps } from '../../../screens';
import type { InternetGateway, RouteTable, Subnet, Vpc } from '../api';
import { DeleteVpcDialog, type VpcTarget } from '../components/delete-vpc-dialog';
import { TagsTable } from '../components/tags-table';
import {
  createRouteTableHref,
  createSubnetHref,
  CREATE_ROUTE_TABLE_TITLE,
  CREATE_SUBNET_TITLE,
  INTERNET_GATEWAYS_PATH,
  nameOrId,
  NONE,
  resourceName,
  routeTableHref,
  subnetHref,
  VPCS_PATH,
  VPCS_WORD,
} from '../format';
import {
  useDnsSetting,
  useGatewayListing,
  useRouteTableListing,
  useSubnetListing,
  useVpc,
  type VpcRead,
} from '../queries';

// A VPC's page, S3 (issue 574, design task 1 and 2): the VPC read by the filter `vpc-id`, so an id the emulator does
// not hold is "VPC not found"; each DNS setting a read of its own, which fails that value alone; and what the VPC
// holds, its subnets, its route tables and its internet gateway, each a section that reads on its own, with its own
// loading, empty and failed state. "Delete VPC" leads to S1 with its result. The delete dialog is rendered beside the
// content, so a read that turns to "not found" keeps it and what it says.

/** A name keeps room for 24 characters (`aws-area.md`, entry 4): 28ch is those 24 and the cell's padding. */
const NAME_MIN_WIDTH = '28ch';
/** The least width of an ID column that is a row header, so a zero-padded ID keeps to one or two lines at 390. */
const ID_MIN_WIDTH = '22ch';

const yesNo = (value: boolean) => (value ? 'Yes' : 'No');

/** An empty state of a section, with Cloudscape's pattern. */
function Empty({ title, sentence, action }: { title: string; sentence?: string; action?: ReactNode }) {
  return (
    <Box textAlign="center" color="inherit">
      <SpaceBetween size="xxs">
        <Box variant="strong" color="inherit">
          {title}
        </Box>
        {sentence !== undefined && (
          <Box variant="p" color="inherit">
            {sentence}
          </Box>
        )}
      </SpaceBetween>
      {action !== undefined && <Box margin={{ top: 's' }}>{action}</Box>}
    </Box>
  );
}

/** One DNS setting: "On" or "Off"; loading or its failure in this value alone. */
function DnsValue({ read, connection, thing }: { read: VpcRead<boolean>; connection: AreaConnection; thing: string }) {
  if (read.failure !== undefined) {
    const state = readFailureState(read.failure, connection, thing);
    return (
      <SpaceBetween size="xxxs">
        <StatusIndicator type={state.type}>{state.first}</StatusIndicator>
        {state.detail !== undefined && (
          <Box variant="small" color="inherit">
            {state.detail}
          </Box>
        )}
      </SpaceBetween>
    );
  }
  if (read.value === undefined) {
    return <StatusIndicator type="loading">Loading</StatusIndicator>;
  }
  return <ValueText kind="fixed" value={read.value ? 'On' : 'Off'} />;
}

interface DetailsProps {
  vpc: Vpc;
  dnsSupport: VpcRead<boolean>;
  dnsHostnames: VpcRead<boolean>;
  connection: AreaConnection;
}

function Details({ vpc, dnsSupport, dnsHostnames, connection }: DetailsProps) {
  const blocks = vpc.cidrs.length > 0 ? vpc.cidrs : vpc.cidr === undefined ? [] : [vpc.cidr];
  return (
    <Container header={<Header variant="h2">VPC details</Header>}>
      <KeyValuePairs
        columns={3}
        minColumnWidth={220}
        ariaLabel="VPC details"
        items={[
          { label: 'VPC ID', value: <CopyValue label="VPC ID" value={vpc.id} kind="name" none={NONE} /> },
          { label: 'State', value: <ValueText kind="fixed" value={vpc.state} none={NONE} /> },
          {
            label: 'IPv4 CIDR blocks',
            value:
              blocks.length === 0 ? (
                NONE
              ) : (
                <SpaceBetween size="xxxs">
                  {blocks.map((block) => (
                    <ValueText key={block} kind="fixed" value={block} />
                  ))}
                </SpaceBetween>
              ),
          },
          { label: 'Default VPC', value: <ValueText kind="fixed" value={yesNo(vpc.isDefault)} /> },
          {
            label: 'DNS resolution',
            value: <DnsValue read={dnsSupport} connection={connection} thing="DNS resolution" />,
          },
          {
            label: 'DNS hostnames',
            value: <DnsValue read={dnsHostnames} connection={connection} thing="DNS hostnames" />,
          },
        ]}
      />
    </Container>
  );
}

interface SectionPagination {
  listing: TokenListing<unknown>;
  of: string;
}

/** The pagination of a section's table, by the API's tokens. */
function SectionPages({ listing, of }: SectionPagination) {
  return (
    <Pagination
      currentPageIndex={listing.currentPage}
      pagesCount={listing.pagesCount}
      openEnd={listing.openEnd}
      disabled={listing.items === undefined}
      ariaLabels={{
        nextPageLabel: `Next page of ${of}`,
        previousPageLabel: `Previous page of ${of}`,
        pageLabel: (page) => `Page ${String(page)} of ${of}`,
      }}
      onChange={({ detail }) => {
        listing.goToPage(detail.currentPageIndex);
      }}
    />
  );
}

interface SectionProps<T> {
  vpcId: string;
  listing: TokenListing<T>;
  connection: AreaConnection;
}

function Subnets({ vpcId, listing, connection }: SectionProps<Subnet>) {
  const handleFollow = useFollow();
  const { items, failure, refresh } = listing;
  const create = (
    <Button href={createSubnetHref(vpcId)} onFollow={handleFollow}>
      {CREATE_SUBNET_TITLE}
    </Button>
  );

  const columns: TableProps.ColumnDefinition<Subnet>[] = [
    {
      id: 'name',
      header: 'Name',
      minWidth: NAME_MIN_WIDTH,
      cell: (row) => <ValueText kind="name" value={resourceName(row.tags)} />,
    },
    {
      id: 'id',
      header: 'Subnet ID',
      isRowHeader: true,
      minWidth: ID_MIN_WIDTH,
      cell: (row) => (
        <Link href={subnetHref(row.id)} onFollow={handleFollow}>
          <ValueText kind="name" value={row.id} />
        </Link>
      ),
    },
    { id: 'cidr', header: 'IPv4 CIDR', cell: (row) => <ValueText kind="fixed" value={row.cidr} none={NONE} /> },
    {
      id: 'zone',
      header: 'Availability Zone',
      cell: (row) => <ValueText kind="fixed" value={row.zone} none={NONE} />,
    },
    {
      id: 'free',
      header: 'Free IPv4 addresses',
      cell: (row) => (
        <ValueText
          kind="fixed"
          value={row.freeAddresses === undefined ? undefined : String(row.freeAddresses)}
          none={NONE}
        />
      ),
    },
  ];

  let empty = null;
  if (failure !== undefined) {
    empty = <ReadFailure state={readFailureState(failure, connection, 'subnets')} onRetry={refresh} />;
  } else if (items !== undefined && items.length === 0) {
    empty = listing.pastEnd ? (
      <Empty title="No more subnets" />
    ) : (
      <Empty title="No subnets" sentence="This VPC has no subnet." action={create} />
    );
  }

  return (
    <Table<Subnet>
      variant="container"
      items={items ?? []}
      trackBy="id"
      columnDefinitions={columns}
      wrapLines
      loading={failure === undefined && items === undefined}
      loadingText="Loading subnets"
      empty={empty}
      header={<Header actions={create}>Subnets</Header>}
      pagination={<SectionPages listing={listing} of="subnets" />}
    />
  );
}

function RouteTables({ vpcId, listing, connection }: SectionProps<RouteTable>) {
  const handleFollow = useFollow();
  const { items, failure, refresh } = listing;
  const create = (
    <Button href={createRouteTableHref(vpcId)} onFollow={handleFollow}>
      {CREATE_ROUTE_TABLE_TITLE}
    </Button>
  );

  const columns: TableProps.ColumnDefinition<RouteTable>[] = [
    {
      id: 'name',
      header: 'Name',
      minWidth: NAME_MIN_WIDTH,
      cell: (row) => <ValueText kind="name" value={resourceName(row.tags)} />,
    },
    {
      id: 'id',
      header: 'Route table ID',
      isRowHeader: true,
      minWidth: ID_MIN_WIDTH,
      cell: (row) => (
        <Link href={routeTableHref(row.id)} onFollow={handleFollow}>
          <ValueText kind="name" value={row.id} />
        </Link>
      ),
    },
    { id: 'main', header: 'Main', cell: (row) => <ValueText kind="fixed" value={yesNo(row.main)} /> },
    {
      id: 'subnets',
      header: 'Associated subnets',
      cell: (row) => <ValueText kind="fixed" value={String(row.subnetCount)} />,
    },
  ];

  let empty = null;
  if (failure !== undefined) {
    empty = <ReadFailure state={readFailureState(failure, connection, 'route tables')} onRetry={refresh} />;
  } else if (items !== undefined && items.length === 0) {
    empty = listing.pastEnd ? (
      <Empty title="No more route tables" />
    ) : (
      <Empty title="No route tables" action={create} />
    );
  }

  return (
    <Table<RouteTable>
      variant="container"
      items={items ?? []}
      trackBy="id"
      columnDefinitions={columns}
      wrapLines
      loading={failure === undefined && items === undefined}
      loadingText="Loading route tables"
      empty={empty}
      header={<Header actions={create}>Route tables</Header>}
      pagination={<SectionPages listing={listing} of="route tables" />}
    />
  );
}

function Gateway({ listing, connection }: Omit<SectionProps<InternetGateway>, 'vpcId'>) {
  const handleFollow = useFollow();
  const { items, failure, refresh } = listing;
  const gateway = items?.[0];

  let content;
  if (failure !== undefined) {
    content = <ReadFailure state={readFailureState(failure, connection, 'internet gateway')} onRetry={refresh} />;
  } else if (items === undefined) {
    content = (
      <Box textAlign="center" color="inherit">
        <StatusIndicator type="loading">Loading internet gateway</StatusIndicator>
      </Box>
    );
  } else if (gateway === undefined) {
    content = <Box variant="p">No internet gateway is attached to this VPC.</Box>;
  } else {
    content = (
      <KeyValuePairs
        columns={2}
        minColumnWidth={220}
        ariaLabel="Internet gateway"
        items={[
          { label: 'Internet gateway ID', value: <ValueText kind="name" value={gateway.id} /> },
          { label: 'Name', value: <ValueText kind="name" value={resourceName(gateway.tags)} /> },
        ]}
      />
    );
  }

  return (
    <Container
      header={
        <Header
          actions={
            <Button href={INTERNET_GATEWAYS_PATH} onFollow={handleFollow}>
              View internet gateways
            </Button>
          }
        >
          Internet gateway
        </Header>
      }
    >
      {content}
    </Container>
  );
}

/** "VPC not found", with Cloudscape's empty-state pattern, in the place of the sections. */
function NotFound() {
  const handleFollow = useFollow();
  return (
    <Container>
      <Box textAlign="center" color="inherit">
        <SpaceBetween size="xxs">
          <Box variant="strong" color="inherit">
            VPC not found
          </Box>
          <Box variant="p" color="inherit">
            The emulator holds no VPC with this ID.
          </Box>
          <Link href={VPCS_PATH} onFollow={handleFollow}>
            View VPCs
          </Link>
        </SpaceBetween>
      </Box>
    </Container>
  );
}

/**
 * `/aws/vpc/vpcs/vpc/{id}`: the VPC `id`, its DNS settings and what it holds, read on every opening and "Refresh". A
 * failed read is read again once the connection is connected again, so after an emulator restart the page of a VPC
 * made before it shows "VPC not found".
 */
export function VpcPage({ connection, params }: ScreenPageProps) {
  useShowsResources(VPCS_WORD);
  const id = params['id'] ?? '';
  const endpoint = connection.engineOrigin;
  const flash = usePageFlash();
  const [announcement, announce] = useAnnouncer();
  const reading = useVpc(endpoint, id);
  const dnsSupport = useDnsSetting(endpoint, id, 'enableDnsSupport');
  const dnsHostnames = useDnsSetting(endpoint, id, 'enableDnsHostnames');
  const subnets = useSubnetListing(endpoint, { name: '', vpcId: id });
  const routeTables = useRouteTableListing(endpoint, { name: '', vpcId: id });
  const gateways = useGatewayListing(endpoint, { name: '', vpcId: id });
  const [deleting, setDeleting] = useState<VpcTarget>();

  const { value: read, failure } = reading;
  const vpc = read?.found === true ? read.value : undefined;
  const failureState = failure === undefined ? undefined : readFailureState(failure, connection, 'VPC');

  const refreshVpc = reading.refresh;
  const refreshSupport = dnsSupport.refresh;
  const refreshHostnames = dnsHostnames.refresh;
  const refreshSubnets = subnets.refresh;
  const refreshRouteTables = routeTables.refresh;
  const refreshGateways = gateways.refresh;
  const readAgain = useCallback(() => {
    refreshVpc();
    refreshSupport();
    refreshHostnames();
    refreshSubnets();
    refreshRouteTables();
    refreshGateways();
  }, [refreshVpc, refreshSupport, refreshHostnames, refreshSubnets, refreshRouteTables, refreshGateways]);

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
  const anyFailed = [
    failure,
    dnsSupport.failure,
    dnsHostnames.failure,
    subnets.failure,
    routeTables.failure,
    gateways.failure,
  ].some((each) => each !== undefined);
  if (connected !== seenConnected) {
    setSeenConnected(connected);
    if (connected && (anyFailed || wasDown)) {
      setWasDown(false);
      readAgain();
    }
  }

  let content;
  if (failureState !== undefined) {
    content = (
      <Container>
        <ReadFailure state={failureState} onRetry={readAgain} />
      </Container>
    );
  } else if (read === undefined) {
    content = (
      <Container>
        <Box textAlign="center" color="inherit">
          <StatusIndicator type="loading">Loading VPC</StatusIndicator>
        </Box>
      </Container>
    );
  } else if (vpc === undefined) {
    content = <NotFound />;
  } else {
    content = (
      <SpaceBetween size="l">
        <Details vpc={vpc} dnsSupport={dnsSupport} dnsHostnames={dnsHostnames} connection={connection} />
        <Subnets vpcId={vpc.id} listing={subnets} connection={connection} />
        <RouteTables vpcId={vpc.id} listing={routeTables} connection={connection} />
        <Gateway listing={gateways} connection={connection} />
        <TagsTable tags={vpc.tags} />
      </SpaceBetween>
    );
  }

  const handleDeleted = (deleted: VpcTarget) => {
    setDeleting(undefined);
    flash.handOver(VPCS_PATH, [{ type: 'success', content: `Deleted VPC ${deleted.label}` }]);
  };

  return (
    <>
      <ContentLayout
        header={
          <Header
            variant="h1"
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button iconName="refresh" ariaLabel="Refresh" onClick={readAgain} />
                {vpc !== undefined && (
                  <Button
                    onClick={() => {
                      setDeleting({ id: vpc.id, label: nameOrId(vpc.id, vpc.tags) });
                    }}
                  >
                    Delete VPC
                  </Button>
                )}
              </SpaceBetween>
            }
          >
            <ValueText kind="name" value={vpc === undefined ? id : nameOrId(vpc.id, vpc.tags)} />
          </Header>
        }
      >
        {content}
      </ContentLayout>
      <DeleteVpcDialog
        vpc={deleting}
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
