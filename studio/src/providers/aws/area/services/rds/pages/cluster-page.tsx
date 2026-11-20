import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import Link from '@cloudscape-design/components/link';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Table, { type TableProps } from '@cloudscape-design/components/table';
import { useState, type ReactNode } from 'react';

import type { RequestFailure } from '../../../../../../lib/aws/request';
import { CopyValue } from '../../../components/copy-value';
import type { AreaConnection } from '../../../components/emulator-line';
import {
  actionFailureItem,
  readFailureState,
  ReadFailure,
  useAnnouncer,
  type ReadFailureState,
} from '../../../components/failure-states';
import { creationDateText } from '../../../components/format-date';
import { usePageFlash } from '../../../components/page-flash';
import { useShowsResources } from '../../../components/page-resources';
import { useFollow } from '../../../components/use-follow';
import { failureOf, usePageSignal } from '../../../components/use-token-listing';
import { ValueText } from '../../../components/value-text';
import type { ScreenPageProps } from '../../../screens';
import type { DbInstance } from '../api';
import { CLUSTER_OPERATIONS, type DbCluster } from '../cluster-api';
import { deleteTarget } from '../cluster-delete';
import { useClusterDelete, useClusterRound, type MembersRead } from '../cluster-queries';
import { ClusterDeleteAction } from '../components/cluster-delete-action';
import { ComposeHostEndpoint } from '../components/compose-host-endpoint';
import { ProtectionValue } from '../components/protection-value';
import { StatusValue } from '../components/status';
import { TagsTable } from '../components/tags-table';
import { addInstanceHref, CLUSTERS_PATH, CLUSTERS_WORD, engineText, instanceHref, NONE } from '../format';

// A DB cluster's page, S6 (issue 573, design task 4): read by `DBClusterIdentifier`, so an identifier the emulator
// does not hold is "DB cluster not found", with its DB instances read by the filter `db-cluster-id` in the same round.
// "Connection" comes first: what a client is given. A failed read of the members fails their section alone. The
// header holds "Delete"; this page holds its request and shows its answer, on S4.

const CONNECTION_DESCRIPTION =
  'The endpoint and the sign-in values as the emulator reports them. The API does not return the master password.';

/** A name keeps room for 24 characters (`aws-area.md`, entry 4). */
const NAME_MIN_WIDTH = '28ch';
/** A status's icon, its gap, its word up to "rebooting" or "modifying" and the cell's padding on one line. */
const STATUS_MIN_WIDTH = '18ch';
/** A class as the API names it, up to "db.r6g.16xlarge", on one line. */
const CLASS_MIN_WIDTH = '17ch';

function Pairs({ label, items }: { label: string; items: { label: string; value: ReactNode }[] }) {
  return <KeyValuePairs columns={3} minColumnWidth={220} items={items} ariaLabel={label} />;
}

function Fixed({ value }: { value: string | undefined }) {
  return <ValueText kind="fixed" value={value} none={NONE} />;
}

function Name({ value }: { value: string | undefined }) {
  return <ValueText kind="name" value={value} none={NONE} />;
}

function portText(port: number | undefined): string | undefined {
  return port === undefined ? undefined : String(port);
}

function Connection({ cluster }: { cluster: DbCluster }) {
  return (
    <Container
      header={
        <Header variant="h2" description={CONNECTION_DESCRIPTION}>
          Connection
        </Header>
      }
    >
      <ComposeHostEndpoint kind="cluster" engine={cluster.engine} port={cluster.port} />
      <Pairs
        label="Connection"
        items={[
          {
            label: 'Writer endpoint',
            value: <CopyValue label="Writer endpoint" value={cluster.endpoint} kind="address" none={NONE} />,
          },
          {
            label: 'Reader endpoint',
            value: <CopyValue label="Reader endpoint" value={cluster.readerEndpoint} kind="address" none={NONE} />,
          },
          { label: 'Port', value: <CopyValue label="Port" value={portText(cluster.port)} kind="fixed" none={NONE} /> },
          {
            label: 'Master user name',
            value: <CopyValue label="Master user name" value={cluster.masterUsername} kind="name" none={NONE} />,
          },
          {
            label: 'Database name',
            value: <CopyValue label="Database name" value={cluster.databaseName} kind="name" none={NONE} />,
          },
        ]}
      />
    </Container>
  );
}

/** Values one under another, "-" without one. */
function Lines({ values }: { values: readonly string[] }) {
  if (values.length === 0) {
    return <>{NONE}</>;
  }
  return (
    <SpaceBetween size="xxs">
      {values.map((value) => (
        <ValueText key={value} kind="name" value={value} />
      ))}
    </SpaceBetween>
  );
}

function Details({ cluster }: { cluster: DbCluster }) {
  return (
    <Container header={<Header variant="h2">DB cluster details</Header>}>
      <SpaceBetween size="l">
        <Pairs
          label="DB cluster details"
          items={[
            { label: 'DB cluster identifier', value: <Name value={cluster.id} /> },
            { label: 'Status', value: <StatusValue status={cluster.status} /> },
            { label: 'Engine', value: <Fixed value={engineText(cluster.engine, cluster.engineVersion)} /> },
            { label: 'Created', value: <ValueText kind="fixed" value={creationDateText(cluster.createdAt)} /> },
            { label: 'DB subnet group', value: <Name value={cluster.subnetGroup} /> },
            { label: 'Security groups', value: <Lines values={cluster.securityGroups} /> },
            { label: 'Cluster parameter group', value: <Name value={cluster.parameterGroup} /> },
            {
              label: 'Deletion protection',
              value: <ProtectionValue on={cluster.deletionProtection} operation="ModifyDBCluster" />,
            },
          ]}
        />
        {/* The ARN and the resource ID in a column of their own, as wide as the section, so each is whole. */}
        <KeyValuePairs
          columns={1}
          ariaLabel="DB cluster identifiers"
          items={[
            { label: 'ARN', value: <CopyValue label="ARN" value={cluster.arn} kind="address" none={NONE} /> },
            {
              label: 'Resource ID',
              value: <CopyValue label="Resource ID" value={cluster.resourceId} kind="name" none={NONE} />,
            },
          ]}
        />
      </SpaceBetween>
    </Container>
  );
}

/** A member's role by the cluster's own entry for it: "Writer", "Reader", or "-" when the cluster does not name it. */
function roleOf(cluster: DbCluster, id: string): string {
  const entry = cluster.members.find((member) => member.id === id);
  if (entry === undefined) {
    return NONE;
  }
  return entry.writer ? 'Writer' : 'Reader';
}

/** The state of the members' failed read, under the section's own first line. */
function membersFailureState(failure: RequestFailure, connection: AreaConnection): ReadFailureState {
  const base = readFailureState(failure, connection, 'DB instances');
  const first = 'The DB instances could not be loaded';
  return {
    type: base.type === 'info' ? 'info' : 'error',
    first,
    firstText: first,
    detail: failure.kind === 'other' || failure.kind === 'not-implemented' ? base.detail : base.first,
    recovery: base.recovery,
  };
}

interface MembersProps {
  cluster: DbCluster;
  members: MembersRead | undefined;
  /** The round is read again with what it shows kept. */
  fetching: boolean;
  connection: AreaConnection;
  onRetry: () => void;
}

function Members({ cluster, members, fetching, connection, onRetry }: MembersProps) {
  const handleFollow = useFollow();
  const addHref = addInstanceHref(cluster.id);
  const columns: TableProps.ColumnDefinition<DbInstance>[] = [
    {
      id: 'id',
      header: 'DB identifier',
      isRowHeader: true,
      minWidth: NAME_MIN_WIDTH,
      cell: (row) => (
        <Link href={instanceHref(row.id)} onFollow={handleFollow}>
          <ValueText kind="name" value={row.id} />
        </Link>
      ),
    },
    { id: 'role', header: 'Role', cell: (row) => <ValueText kind="fixed" value={roleOf(cluster, row.id)} /> },
    { id: 'status', header: 'Status', minWidth: STATUS_MIN_WIDTH, cell: (row) => <StatusValue status={row.status} /> },
    { id: 'class', header: 'Class', minWidth: CLASS_MIN_WIDTH, cell: (row) => <Fixed value={row.instanceClass} /> },
    { id: 'port', header: 'Port', cell: (row) => <Fixed value={portText(row.port)} /> },
  ];

  const failed = members?.ok === false;
  const loading = members === undefined || (failed && fetching);
  let empty: ReactNode;
  if (failed && !fetching) {
    empty = <ReadFailure state={membersFailureState(members.failure, connection)} onRetry={onRetry} />;
  } else {
    empty = (
      <Box textAlign="center" color="inherit">
        <SpaceBetween size="xxs">
          <Box variant="strong" color="inherit">
            No DB instances
          </Box>
          <Box variant="p" color="inherit">
            This cluster has no DB instance.
          </Box>
        </SpaceBetween>
        <Box margin={{ top: 's' }}>
          <Button href={addHref} onFollow={handleFollow}>
            Add DB instance
          </Button>
        </Box>
      </Box>
    );
  }

  const items = members?.ok === true ? members.instances : [];
  return (
    <Table<DbInstance>
      variant="container"
      items={items}
      trackBy="id"
      columnDefinitions={columns}
      wrapLines
      loading={loading}
      loadingText="Loading DB instances"
      empty={empty}
      header={
        <Header
          variant="h2"
          counter={members?.ok === true ? `(${String(items.length)})` : undefined}
          actions={
            <Button href={addHref} onFollow={handleFollow}>
              Add DB instance
            </Button>
          }
        >
          DB instances
        </Header>
      }
    />
  );
}

/** "DB cluster not found", with Cloudscape's empty-state pattern, in the place of the sections. */
function NotFound() {
  const handleFollow = useFollow();
  return (
    <Container>
      <Box textAlign="center" color="inherit">
        <SpaceBetween size="xxs">
          <Box variant="strong" color="inherit">
            DB cluster not found
          </Box>
          <Box variant="p" color="inherit">
            The emulator holds no DB cluster with this identifier.
          </Box>
          <Link href={CLUSTERS_PATH} onFollow={handleFollow}>
            View DB clusters
          </Link>
        </SpaceBetween>
      </Box>
    </Container>
  );
}

/**
 * `/aws/rds/clusters/cluster/{id}`: the DB cluster `id` and its members, read on every opening and refresh, again
 * every 3 seconds while the cluster or a member is in progress, and after a delete. A failed read is read again once
 * the connection is connected again, so after an emulator restart the page shows "DB cluster not found".
 */
export function ClusterPage({ connection, params }: ScreenPageProps) {
  useShowsResources(CLUSTERS_WORD);
  const id = params['id'] ?? '';
  const flash = usePageFlash();
  const pageSignal = usePageSignal();
  const remove = useClusterDelete(connection.engineOrigin);
  const [announcement, announce] = useAnnouncer();
  const [pending, setPending] = useState(false);
  const reading = useClusterRound(connection.engineOrigin, id);
  const { value: round, failure, refresh, fetching, retryMembers } = reading;
  const cluster = round?.cluster.found === true ? round.cluster.cluster : undefined;
  const failureState = failure === undefined ? undefined : readFailureState(failure, connection, 'DB cluster');

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

  // The request and what follows its answer are this page's, which stays mounted whatever its read shows.
  const handleDelete = (target: string) => {
    if (pending) {
      return;
    }
    const signal = pageSignal();
    setPending(true);
    remove(target, signal).then(
      () => {
        if (signal.aborted) return;
        setPending(false);
        flash.handOver(CLUSTERS_PATH, [{ type: 'success', content: `Deleting DB cluster ${target}` }]);
      },
      (error: unknown) => {
        if (signal.aborted) return;
        setPending(false);
        flash.show([
          actionFailureItem(
            failureOf(error, CLUSTER_OPERATIONS.deleteDBCluster),
            `Delete DB cluster ${target}`,
            connection.engineOrigin,
          ),
        ]);
      },
    );
  };

  let content;
  if (failureState !== undefined) {
    content = (
      <Container>
        <ReadFailure state={failureState} onRetry={refresh} />
      </Container>
    );
  } else if (round === undefined) {
    content = (
      <Container>
        <Box textAlign="center" color="inherit">
          <StatusIndicator type="loading">Loading DB cluster</StatusIndicator>
        </Box>
      </Container>
    );
  } else if (cluster === undefined) {
    content = <NotFound />;
  } else {
    content = (
      <SpaceBetween size="l">
        <Connection cluster={cluster} />
        <Details cluster={cluster} />
        <Members
          cluster={cluster}
          members={round.members}
          fetching={fetching}
          connection={connection}
          onRetry={retryMembers}
        />
        <TagsTable tags={cluster.tags} />
      </SpaceBetween>
    );
  }

  return (
    <>
      <ContentLayout
        header={
          <Header
            variant="h1"
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button iconName="refresh" ariaLabel="Refresh" onClick={refresh} />
                {cluster !== undefined && (
                  <ClusterDeleteAction cluster={deleteTarget(cluster)} pending={pending} onDelete={handleDelete} />
                )}
              </SpaceBetween>
            }
          >
            <ValueText kind="name" value={id} />
          </Header>
        }
      >
        {content}
      </ContentLayout>
      {announcement}
    </>
  );
}
