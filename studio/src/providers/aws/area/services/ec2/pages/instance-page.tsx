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
import { useCallback, useState, type ReactNode } from 'react';

import { CopyValue } from '../../../components/copy-value';
import type { AreaConnection } from '../../../components/emulator-line';
import { readFailureState, ReadFailure, useAnnouncer } from '../../../components/failure-states';
import { creationDateText } from '../../../components/format-date';
import { useShowsResources } from '../../../components/page-resources';
import { useFollow } from '../../../components/use-follow';
import { ValueText } from '../../../components/value-text';
import { nameOf, type Tag } from '../../../lib/ec2-client';
import type { ScreenPageProps } from '../../../screens';
import type { BlockDevice, Instance, InstanceGroup } from '../api';
import { InstanceActions } from '../components/instance-actions';
import { InstanceStateValue } from '../components/instance-state';
import { instanceHeading, INSTANCES_PATH, INSTANCES_WORD, KEY_PAIRS_PATH, NONE, securityGroupHref } from '../format';
import { useInstance, useTerminationProtection, type Ec2Read } from '../queries';

// An instance's page, S3 (issue 553, design task 1 and task 3): read by the filter `instance-id`, so an id the
// emulator does not hold is "Instance not found", and its termination protection by a read of its own, whose failure
// fails only that value. Its header holds the instance's actions; a terminated instance stays here, still listed.

/** A value with its copy control, "-" without one. */
function Copy({ label, value }: { label: string; value: string | undefined }) {
  return <CopyValue label={label} value={value} kind="name" none={NONE} />;
}

function Pairs({ label, items }: { label: string; items: { label: string; value: ReactNode }[] }) {
  return <KeyValuePairs columns={3} minColumnWidth={220} items={items} ariaLabel={label} />;
}

/** Under "On": the emulator's operation that changes it; Studio has no screen for it yet (critique r3 P2 2, issue 561). */
const PROTECTION_CHANGED = 'Changed with ModifyInstanceAttribute.';

/** "Termination protection": "On", "Off", loading in that value alone, or its read's failure in that value alone. */
function Protection({ read, connection }: { read: Ec2Read<boolean>; connection: AreaConnection }) {
  if (read.failure !== undefined) {
    const state = readFailureState(read.failure, connection, 'termination protection');
    return (
      <SpaceBetween size="xxs">
        <StatusIndicator type={state.type}>{state.first}</StatusIndicator>
        {state.detail !== undefined && <Box variant="small">{state.detail}</Box>}
      </SpaceBetween>
    );
  }
  if (read.value === undefined) {
    return <StatusIndicator type="loading">Loading</StatusIndicator>;
  }
  if (!read.value) {
    return <ValueText kind="fixed" value="Off" />;
  }
  return (
    <SpaceBetween size="xxs">
      <ValueText kind="fixed" value="On" />
      <Box variant="small">{PROTECTION_CHANGED}</Box>
    </SpaceBetween>
  );
}

/** The key pair's name as a link to the key pairs, "-" without one (critique final P3 3). */
function KeyPair({ name }: { name: string | undefined }) {
  const handleFollow = useFollow();
  if (name === undefined) {
    return <>{NONE}</>;
  }
  return (
    <Link href={KEY_PAIRS_PATH} onFollow={handleFollow}>
      <ValueText kind="name" value={name} />
    </Link>
  );
}

function Details({ instance, protection }: { instance: Instance; protection: ReactNode }) {
  return (
    <Container header={<Header variant="h2">Instance details</Header>}>
      <Pairs
        label="Instance details"
        items={[
          { label: 'Instance ID', value: <Copy label="Instance ID" value={instance.id} /> },
          {
            label: 'State',
            value: (
              <SpaceBetween size="xxs">
                <InstanceStateValue state={instance.state} />
                {instance.stateReason !== undefined && <ValueText kind="text" value={instance.stateReason} />}
              </SpaceBetween>
            ),
          },
          { label: 'Termination protection', value: protection },
          { label: 'Type', value: <ValueText kind="fixed" value={instance.type} none={NONE} /> },
          { label: 'Image ID', value: <Copy label="Image ID" value={instance.imageId} /> },
          { label: 'Launched', value: <ValueText kind="fixed" value={creationDateText(instance.launchTime)} /> },
          { label: 'Key pair', value: <KeyPair name={instance.keyName} /> },
          { label: 'Architecture', value: <ValueText kind="fixed" value={instance.architecture} none={NONE} /> },
          { label: 'Platform', value: <ValueText kind="fixed" value={instance.platform} none={NONE} /> },
        ]}
      />
    </Container>
  );
}

function Network({ instance }: { instance: Instance }) {
  return (
    <Container header={<Header variant="h2">Network</Header>}>
      <Pairs
        label="Network"
        items={[
          { label: 'Availability Zone', value: <ValueText kind="fixed" value={instance.zone} none={NONE} /> },
          { label: 'Subnet ID', value: <ValueText kind="name" value={instance.subnetId} none={NONE} /> },
          { label: 'VPC ID', value: <ValueText kind="name" value={instance.vpcId} none={NONE} /> },
          { label: 'Private IPv4', value: <Copy label="Private IPv4" value={instance.privateIp} /> },
          { label: 'Public IPv4', value: <Copy label="Public IPv4" value={instance.publicIp} /> },
          {
            label: 'Private DNS name',
            value: <CopyValue label="Private DNS name" value={instance.privateDns} kind="address" none={NONE} />,
          },
          {
            label: 'Public DNS name',
            value: <CopyValue label="Public DNS name" value={instance.publicDns} kind="address" none={NONE} />,
          },
        ]}
      />
    </Container>
  );
}

function Empty({ children }: { children: string }) {
  return (
    <Box textAlign="center" color="inherit">
      <Box variant="strong" color="inherit">
        {children}
      </Box>
    </Box>
  );
}

function Groups({ groups }: { groups: InstanceGroup[] }) {
  const handleFollow = useFollow();
  const columns: TableProps.ColumnDefinition<InstanceGroup>[] = [
    {
      id: 'name',
      header: 'Name',
      isRowHeader: true,
      cell: (group) => (
        <Link href={securityGroupHref(group.id)} onFollow={handleFollow}>
          <ValueText kind="name" value={group.name ?? group.id} />
        </Link>
      ),
    },
    { id: 'id', header: 'Group ID', cell: (group) => <ValueText kind="name" value={group.id} /> },
  ];
  return (
    <Table<InstanceGroup>
      variant="container"
      header={<Header variant="h2">Security groups</Header>}
      items={groups}
      trackBy="id"
      columnDefinitions={columns}
      wrapLines
      empty={<Empty>No security groups</Empty>}
    />
  );
}

function Volumes({ volumes }: { volumes: BlockDevice[] }) {
  const columns: TableProps.ColumnDefinition<BlockDevice>[] = [
    {
      id: 'device',
      header: 'Device',
      isRowHeader: true,
      cell: (volume) => <ValueText kind="name" value={volume.device} none={NONE} />,
    },
    { id: 'volume', header: 'Volume ID', cell: (volume) => <Copy label="Volume ID" value={volume.volumeId} /> },
    {
      id: 'delete',
      header: 'Deleted on termination',
      cell: (volume) => (
        <ValueText
          kind="fixed"
          value={volume.deleteOnTermination === undefined ? undefined : volume.deleteOnTermination ? 'Yes' : 'No'}
          none={NONE}
        />
      ),
    },
  ];
  return (
    <Table<BlockDevice>
      variant="container"
      header={<Header variant="h2">Volumes</Header>}
      items={volumes}
      columnDefinitions={columns}
      wrapLines
      empty={<Empty>No volumes</Empty>}
    />
  );
}

function Tags({ tags }: { tags: Tag[] }) {
  const columns: TableProps.ColumnDefinition<Tag>[] = [
    { id: 'key', header: 'Key', isRowHeader: true, cell: (tag) => <ValueText kind="name" value={tag.key} /> },
    { id: 'value', header: 'Value', cell: (tag) => <ValueText kind="text" value={tag.value} none={NONE} /> },
  ];
  return (
    <Table<Tag>
      variant="container"
      header={<Header variant="h2">Tags</Header>}
      items={tags}
      trackBy="key"
      columnDefinitions={columns}
      wrapLines
      empty={<Empty>No tags</Empty>}
    />
  );
}

/** "Instance not found", with Cloudscape's empty-state pattern, in the place of the sections. */
function NotFound() {
  const handleFollow = useFollow();
  return (
    <Container>
      <Box textAlign="center" color="inherit">
        <SpaceBetween size="xxs">
          <Box variant="strong" color="inherit">
            Instance not found
          </Box>
          <Box variant="p" color="inherit">
            The emulator holds no instance with this ID.
          </Box>
          <Link href={INSTANCES_PATH} onFollow={handleFollow}>
            View instances
          </Link>
        </SpaceBetween>
      </Box>
    </Container>
  );
}

/**
 * `/aws/ec2/instances/instance/{id}`: the instance `id`, read on every opening and refresh, again every 3 seconds
 * while its state moves by itself, and after each action. A failed read is read again once the connection is
 * connected again, so after an emulator restart the page shows "Instance not found".
 */
export function InstancePage({ connection, params }: ScreenPageProps) {
  useShowsResources(INSTANCES_WORD);
  const id = params['id'] ?? '';
  const [announcement, announce] = useAnnouncer();
  const reading = useInstance(connection.engineOrigin, id);
  const protection = useTerminationProtection(connection.engineOrigin, id);
  const { value: read, failure, refresh } = reading;
  const refreshProtection = protection.refresh;
  const instance = read?.found === true ? read.instance : undefined;
  const failureState = failure === undefined ? undefined : readFailureState(failure, connection, 'instance');

  const readAgain = useCallback(() => {
    refresh();
    refreshProtection();
  }, [refresh, refreshProtection]);

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
    if (connected && (failure !== undefined || protection.failure !== undefined || wasDown)) {
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
          <StatusIndicator type="loading">Loading instance</StatusIndicator>
        </Box>
      </Container>
    );
  } else if (instance === undefined) {
    content = <NotFound />;
  } else {
    content = (
      <SpaceBetween size="l">
        <Details instance={instance} protection={<Protection read={protection} connection={connection} />} />
        <Network instance={instance} />
        <Groups groups={instance.groups} />
        <Volumes volumes={instance.volumes} />
        <Tags tags={instance.tags} />
      </SpaceBetween>
    );
  }

  const name = instance === undefined ? undefined : nameOf(instance.tags);

  return (
    <>
      <ContentLayout
        header={
          <Header
            variant="h1"
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button iconName="refresh" ariaLabel="Refresh" onClick={readAgain} />
                {instance !== undefined && (
                  <InstanceActions
                    instance={{ id: instance.id, state: instance.state, ...(name === undefined ? {} : { name }) }}
                    connection={connection}
                    protectionOn={protection.failure === undefined && protection.value === true}
                  />
                )}
              </SpaceBetween>
            }
          >
            <ValueText kind="name" value={instanceHeading(id, instance?.tags ?? [])} />
          </Header>
        }
      >
        {content}
      </ContentLayout>
      {announcement}
    </>
  );
}
