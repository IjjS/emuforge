import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import Link from '@cloudscape-design/components/link';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import { useState, type ReactNode } from 'react';

import { CopyValue } from '../../../components/copy-value';
import { actionFailureItem, readFailureState, ReadFailure, useAnnouncer } from '../../../components/failure-states';
import { creationDateText } from '../../../components/format-date';
import { usePageFlash } from '../../../components/page-flash';
import { useShowsResources } from '../../../components/page-resources';
import { useFollow } from '../../../components/use-follow';
import { failureOf, usePageSignal } from '../../../components/use-token-listing';
import { ValueText } from '../../../components/value-text';
import type { ScreenPageProps } from '../../../screens';
import { ACTION_OPERATIONS, type ClusterSignIn, type DbInstance } from '../api';
import { ComposeHostEndpoint } from '../components/compose-host-endpoint';
import { InstanceActions } from '../components/instance-actions';
import { ProtectionValue } from '../components/protection-value';
import { StatusValue } from '../components/status';
import { TagsTable } from '../components/tags-table';
import { clusterHref, engineText, INSTANCES_PATH, INSTANCES_WORD, NONE } from '../format';
import { useClusterSignIn, useInstance, useInstanceAction } from '../queries';
import { ACTION_LABELS, ACTION_RESULTS, actionTarget, type ActionTarget, type InstanceAction } from '../status';

// A DB instance's page, S3 (issue 573, design tasks 1 and 3): read by `DBInstanceIdentifier`, so an identifier the
// emulator does not hold is "DB instance not found". "Connection" comes first: what a client is given. The header
// holds the instance's actions; this page holds their request and shows their answer, a delete's on S1.

const CONNECTION_DESCRIPTION =
  'The endpoint and the sign-in values as the emulator reports them. The API does not return the master password.';

/** Room for an ARN of an instance's identifier, or a resource ID, beside the other (critique final P2 3). */
const IDENTIFIERS_MIN_COLUMN = 360;

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

/** A sign-in value of a member taken from its DB cluster, with its copy control and, below it, where it is from. */
function FromCluster({ label, value, clusterId }: { label: string; value: string; clusterId: string }) {
  const handleFollow = useFollow();
  return (
    <SpaceBetween size="xxs">
      <CopyValue label={label} value={value} kind="name" />
      <Box variant="small">
        {'From '}
        <Link href={clusterHref(clusterId)} onFollow={handleFollow} variant="primary">
          {`DB cluster ${clusterId}`}
        </Link>
      </Box>
    </SpaceBetween>
  );
}

/** A sign-in value: the instance's own, else its DB cluster's when read, else "-". */
function SignInValue({
  label,
  own,
  fromCluster,
  clusterId,
}: {
  label: string;
  own: string | undefined;
  fromCluster: string | undefined;
  clusterId: string | undefined;
}) {
  if (own === undefined && fromCluster !== undefined && clusterId !== undefined) {
    return <FromCluster label={label} value={fromCluster} clusterId={clusterId} />;
  }
  return <CopyValue label={label} value={own} kind="name" none={NONE} />;
}

function Connection({ instance, signIn }: { instance: DbInstance; signIn: ClusterSignIn | undefined }) {
  return (
    <Container
      header={
        <Header variant="h2" description={CONNECTION_DESCRIPTION}>
          Connection
        </Header>
      }
    >
      <ComposeHostEndpoint
        kind="instance"
        engine={instance.engine}
        clusterId={instance.clusterId}
        port={instance.port}
      />
      <Pairs
        label="Connection"
        items={[
          {
            label: 'Endpoint address',
            value: <CopyValue label="Endpoint address" value={instance.address} kind="address" none={NONE} />,
          },
          { label: 'Port', value: <CopyValue label="Port" value={portText(instance.port)} kind="fixed" none={NONE} /> },
          {
            label: 'Master user name',
            value: (
              <SignInValue
                label="Master user name"
                own={instance.masterUsername}
                fromCluster={signIn?.masterUsername}
                clusterId={instance.clusterId}
              />
            ),
          },
          {
            label: 'Database name',
            value: (
              <SignInValue
                label="Database name"
                own={instance.dbName}
                fromCluster={signIn?.databaseName}
                clusterId={instance.clusterId}
              />
            ),
          },
        ]}
      />
    </Container>
  );
}

function Cluster({ id }: { id: string | undefined }) {
  const handleFollow = useFollow();
  if (id === undefined) {
    return <>{NONE}</>;
  }
  return (
    <Link href={clusterHref(id)} onFollow={handleFollow}>
      <ValueText kind="name" value={id} />
    </Link>
  );
}

/** Values one under another, "-" without one. */
function Lines({ values }: { values: readonly ReactNode[] }) {
  if (values.length === 0) {
    return <>{NONE}</>;
  }
  return <SpaceBetween size="xxs">{values}</SpaceBetween>;
}

function Details({ instance }: { instance: DbInstance }) {
  return (
    <Container header={<Header variant="h2">DB instance details</Header>}>
      <Pairs
        label="DB instance details"
        items={[
          { label: 'DB identifier', value: <Name value={instance.id} /> },
          { label: 'Status', value: <StatusValue status={instance.status} /> },
          { label: 'Engine', value: <Fixed value={engineText(instance.engine, instance.engineVersion)} /> },
          { label: 'Class', value: <Name value={instance.instanceClass} /> },
          {
            label: 'Allocated storage',
            value: (
              <Fixed
                value={instance.allocatedStorage === undefined ? undefined : `${String(instance.allocatedStorage)} GiB`}
              />
            ),
          },
          { label: 'Storage type', value: <Fixed value={instance.storageType} /> },
          { label: 'DB cluster', value: <Cluster id={instance.clusterId} /> },
          { label: 'Availability Zone', value: <Fixed value={instance.zone} /> },
          { label: 'Created', value: <ValueText kind="fixed" value={creationDateText(instance.createdAt)} /> },
          {
            label: 'Parameter group',
            value: (
              <Lines
                values={instance.parameterGroups.map((name) => (
                  <ValueText key={name} kind="name" value={name} />
                ))}
              />
            ),
          },
          {
            label: 'Deletion protection',
            value: <ProtectionValue on={instance.deletionProtection} operation="ModifyDBInstance" />,
          },
        ]}
      />
      {/* The two long identifiers in a row of their own, each wide enough for its whole value (critique final P2 3). */}
      <Box margin={{ top: 'l' }}>
        <KeyValuePairs
          columns={2}
          minColumnWidth={IDENTIFIERS_MIN_COLUMN}
          ariaLabel="DB instance identifiers"
          items={[
            { label: 'ARN', value: <CopyValue label="ARN" value={instance.arn} kind="address" none={NONE} /> },
            {
              label: 'Resource ID',
              value: <CopyValue label="Resource ID" value={instance.resourceId} kind="name" none={NONE} />,
            },
          ]}
        />
      </Box>
    </Container>
  );
}

function Network({ instance }: { instance: DbInstance }) {
  const groups = instance.securityGroups;
  return (
    <Container header={<Header variant="h2">Network</Header>}>
      <Pairs
        label="Network"
        items={[
          { label: 'DB subnet group', value: <Name value={instance.subnetGroup?.name} /> },
          { label: 'VPC ID', value: <Name value={instance.subnetGroup?.vpcId} /> },
          {
            label: 'Subnets',
            value: (
              <Lines
                values={(instance.subnetGroup?.subnets ?? []).map((subnet) => (
                  <ValueText key={subnet} kind="name" value={subnet} />
                ))}
              />
            ),
          },
          {
            label: 'Security groups',
            value:
              groups.length === 0 ? (
                'No security groups'
              ) : (
                <SpaceBetween size="xxs">
                  {groups.map((group) => (
                    <SpaceBetween key={group.id} direction="horizontal" size="xs">
                      <ValueText kind="name" value={group.id} />
                      {group.status !== undefined && <ValueText kind="fixed" value={group.status} />}
                    </SpaceBetween>
                  ))}
                </SpaceBetween>
              ),
          },
        ]}
      />
    </Container>
  );
}

/** "DB instance not found", with Cloudscape's empty-state pattern, in the place of the sections. */
function NotFound() {
  const handleFollow = useFollow();
  return (
    <Container>
      <Box textAlign="center" color="inherit">
        <SpaceBetween size="xxs">
          <Box variant="strong" color="inherit">
            DB instance not found
          </Box>
          <Box variant="p" color="inherit">
            The emulator holds no DB instance with this identifier.
          </Box>
          <Link href={INSTANCES_PATH} onFollow={handleFollow}>
            View DB instances
          </Link>
        </SpaceBetween>
      </Box>
    </Container>
  );
}

/**
 * `/aws/rds/instances/instance/{id}`: the DB instance `id`, read on every opening and refresh, again every 3 seconds
 * while its status is in progress, and after each action. A failed read is read again once the connection is
 * connected again, so after an emulator restart the page shows "DB instance not found".
 */
export function InstancePage({ connection, params }: ScreenPageProps) {
  useShowsResources(INSTANCES_WORD);
  const id = params['id'] ?? '';
  const flash = usePageFlash();
  const pageSignal = usePageSignal();
  const act = useInstanceAction(connection.engineOrigin);
  const [announcement, announce] = useAnnouncer();
  const [pending, setPending] = useState(false);
  const reading = useInstance(connection.engineOrigin, id);
  const { value: read, failure, refresh } = reading;
  const instance = read?.found === true ? read.instance : undefined;
  const failureState = failure === undefined ? undefined : readFailureState(failure, connection, 'DB instance');
  // A member without sign-in values of its own reads its DB cluster's; that read never fails the page.
  const signInCluster =
    instance?.clusterId !== undefined && (instance.masterUsername === undefined || instance.dbName === undefined)
      ? instance.clusterId
      : undefined;
  const signIn = useClusterSignIn(connection.engineOrigin, signInCluster);

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
  const handleAction = (action: InstanceAction, target: ActionTarget) => {
    if (pending) {
      return;
    }
    const signal = pageSignal();
    setPending(true);
    act(action, target.id, signal).then(
      () => {
        if (signal.aborted) return;
        setPending(false);
        const result = [{ type: 'success', content: `${ACTION_RESULTS[action]} ${target.id}` }] as const;
        if (action === 'delete') {
          flash.handOver(INSTANCES_PATH, result);
        } else {
          flash.show(result);
        }
      },
      (error: unknown) => {
        if (signal.aborted) return;
        setPending(false);
        flash.show([
          actionFailureItem(
            failureOf(error, ACTION_OPERATIONS[action]),
            `${ACTION_LABELS[action]} DB instance ${target.id}`,
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
  } else if (read === undefined) {
    content = (
      <Container>
        <Box textAlign="center" color="inherit">
          <StatusIndicator type="loading">Loading DB instance</StatusIndicator>
        </Box>
      </Container>
    );
  } else if (instance === undefined) {
    content = <NotFound />;
  } else {
    content = (
      <SpaceBetween size="l">
        <Connection instance={instance} signIn={signIn.failure === undefined ? signIn.value : undefined} />
        <Details instance={instance} />
        <Network instance={instance} />
        <TagsTable tags={instance.tags} />
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
                <Button
                  iconName="refresh"
                  ariaLabel="Refresh"
                  onClick={() => {
                    refresh();
                    signIn.refresh();
                  }}
                />
                {instance !== undefined && (
                  <InstanceActions instance={actionTarget(instance)} pending={pending} onAction={handleAction} />
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
