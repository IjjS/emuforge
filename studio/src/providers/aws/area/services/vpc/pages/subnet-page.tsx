import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import Link from '@cloudscape-design/components/link';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import { useCallback, useState } from 'react';

import { CopyValue } from '../../../components/copy-value';
import type { AreaConnection } from '../../../components/emulator-line';
import { actionFailureItem, readFailureState, ReadFailure, useAnnouncer } from '../../../components/failure-states';
import { usePageFlash } from '../../../components/page-flash';
import { useShowsResources } from '../../../components/page-resources';
import { useFollow } from '../../../components/use-follow';
import { failureOf, usePageSignal } from '../../../components/use-token-listing';
import { NameText } from '../../../components/name-text';
import { ValueText } from '../../../components/value-text';
import type { ScreenPageProps } from '../../../screens';
import type { Subnet } from '../api';
import { DeleteSubnetDialog, type SubnetTarget } from '../components/delete-subnet-dialog';
import { RoutesTable } from '../components/routes-table';
import { TagsTable } from '../components/tags-table';
import { nameOf } from '../../../lib/ec2-client';
import { NONE, routeTableHref, SUBNETS_PATH, SUBNETS_WORD, vpcHref } from '../format';
import { useAppliedRouteTable, useSubnet } from '../queries';
import { useSetPublicAddresses } from '../subnet-changes';
import { SUBNET_CHANGE_OPERATIONS } from '../subnet-changes-api';

// A subnet's page, S6 (issue 574, design task 1, step 4, and task 2, steps 4 and 5): read by the filter `subnet-id`,
// so an id the emulator does not hold is "Subnet not found". "Subnet details" holds its public IPv4 addresses on
// launch with the action that changes them, one `ModifySubnetAttribute`, unavailable while it is in flight; "Route
// table" is the table whose routes apply to it, read on its own, so a failed read fails that section alone. "Delete
// subnet" leads to S4 with its result; the dialog is rendered beside the content, so a read that turns to "not
// found" keeps it.

const PUBLIC_SENTENCE = 'Decides whether an instance launched into this subnet gets a public IPv4 address.';

function count(value: number | undefined): string | undefined {
  return value === undefined ? undefined : String(value);
}

interface DetailsProps {
  subnet: Subnet;
  connection: AreaConnection;
}

function Details({ subnet, connection }: DetailsProps) {
  const handleFollow = useFollow();
  const flash = usePageFlash();
  const pageSignal = usePageSignal();
  const change = useSetPublicAddresses(connection.engineOrigin);
  const [pending, setPending] = useState(false);
  const on = subnet.publicAddresses;

  const handleToggle = () => {
    if (pending) {
      return;
    }
    const next = !on;
    const word = next ? 'on' : 'off';
    const signal = pageSignal();
    setPending(true);
    change(subnet.id, next, signal).then(
      () => {
        if (signal.aborted) return;
        setPending(false);
        flash.show([{ type: 'success', content: `Public IPv4 addresses on launch turned ${word} for ${subnet.id}` }]);
      },
      (error: unknown) => {
        if (signal.aborted) return;
        setPending(false);
        flash.show([
          actionFailureItem(
            failureOf(error, SUBNET_CHANGE_OPERATIONS.modifySubnetAttribute),
            `Turning ${word} public IPv4 addresses on launch for ${subnet.id}`,
            connection.engineOrigin,
          ),
        ]);
      },
    );
  };

  return (
    <Container header={<Header variant="h2">Subnet details</Header>}>
      <KeyValuePairs
        columns={3}
        minColumnWidth={220}
        ariaLabel="Subnet details"
        items={[
          { label: 'Subnet ID', value: <CopyValue label="Subnet ID" value={subnet.id} kind="name" none={NONE} /> },
          { label: 'ARN', value: <CopyValue label="ARN" value={subnet.arn} kind="address" none={NONE} /> },
          { label: 'State', value: <ValueText kind="fixed" value={subnet.state} none={NONE} /> },
          {
            label: 'VPC ID',
            value:
              subnet.vpcId === undefined ? (
                NONE
              ) : (
                <Link href={vpcHref(subnet.vpcId)} onFollow={handleFollow}>
                  <ValueText kind="name" value={subnet.vpcId} />
                </Link>
              ),
          },
          { label: 'IPv4 CIDR', value: <ValueText kind="fixed" value={subnet.cidr} none={NONE} /> },
          { label: 'Availability Zone', value: <ValueText kind="fixed" value={subnet.zone} none={NONE} /> },
          {
            label: 'Free IPv4 addresses',
            value: <ValueText kind="fixed" value={count(subnet.freeAddresses)} none={NONE} />,
          },
          { label: 'Default subnet', value: <ValueText kind="fixed" value={subnet.isDefault ? 'Yes' : 'No'} /> },
          {
            label: 'Public IPv4 address on launch',
            value: (
              <SpaceBetween size="xxs">
                <ValueText kind="fixed" value={on ? 'On' : 'Off'} />
                <Box variant="small" color="text-body-secondary">
                  {PUBLIC_SENTENCE}
                </Box>
                <Button disabled={pending} onClick={handleToggle}>
                  {on ? 'Turn off' : 'Turn on'}
                </Button>
              </SpaceBetween>
            ),
          },
        ]}
      />
    </Container>
  );
}

interface RouteTableSectionProps {
  subnet: Subnet;
  connection: AreaConnection;
}

/** Mounted once the subnet is read, so the read that decides knows its VPC; mounted again on "Refresh". */
function RouteTableSection({ subnet, connection }: RouteTableSectionProps) {
  const read = useAppliedRouteTable(connection.engineOrigin, subnet.id, subnet.vpcId);
  const handleFollow = useFollow();
  const header = <Header variant="h2">Route table</Header>;
  if (read.failure !== undefined) {
    return (
      <Container header={header}>
        <ReadFailure state={readFailureState(read.failure, connection, 'route table')} onRetry={read.refresh} />
      </Container>
    );
  }
  if (read.value === undefined) {
    return (
      <Container header={header}>
        <StatusIndicator type="loading">Loading route table</StatusIndicator>
      </Container>
    );
  }
  if (read.value === null) {
    return (
      <Container header={header}>
        <Box color="inherit">No route table found for this subnet.</Box>
      </Container>
    );
  }
  const { table, how } = read.value;
  return (
    <Container header={header}>
      <SpaceBetween size="l">
        <KeyValuePairs
          columns={2}
          minColumnWidth={220}
          ariaLabel="Route table"
          items={[
            {
              label: 'Route table ID',
              value: (
                <Link href={routeTableHref(table.id)} onFollow={handleFollow}>
                  <ValueText kind="name" value={table.id} />
                </Link>
              ),
            },
            {
              label: 'Applies as',
              value: (
                <ValueText
                  kind="text"
                  value={how === 'associated' ? 'Associated with this subnet' : "The VPC's main route table"}
                />
              ),
            },
          ]}
        />
        <RoutesTable routes={table.routes} variant="borderless" ariaLabel="Routes of the route table" />
      </SpaceBetween>
    </Container>
  );
}

/** "Subnet not found", with Cloudscape's empty-state pattern, in the place of the sections. */
function NotFound() {
  const handleFollow = useFollow();
  return (
    <Container>
      <Box textAlign="center" color="inherit">
        <SpaceBetween size="xxs">
          <Box variant="strong" color="inherit">
            Subnet not found
          </Box>
          <Box variant="p" color="inherit">
            The emulator holds no subnet with this ID.
          </Box>
          <Link href={SUBNETS_PATH} onFollow={handleFollow}>
            View subnets
          </Link>
        </SpaceBetween>
      </Box>
    </Container>
  );
}

/** The sections of a subnet the emulator holds; `reads` counts "Refresh", which reads the route table again. */
function Sections({ subnet, connection, reads }: DetailsProps & { reads: number }) {
  return (
    <SpaceBetween size="l">
      <Details subnet={subnet} connection={connection} />
      <RouteTableSection key={reads} subnet={subnet} connection={connection} />
      <TagsTable tags={subnet.tags} />
    </SpaceBetween>
  );
}

/**
 * `/aws/vpc/subnets/subnet/{id}`: the subnet `id` and the route table that applies to it, read on every opening and
 * "Refresh". A failed read is read again once the connection is connected again, so after an emulator restart the
 * page shows "Subnet not found".
 */
export function SubnetPage({ connection, params }: ScreenPageProps) {
  useShowsResources(SUBNETS_WORD);
  const id = params['id'] ?? '';
  const flash = usePageFlash();
  const [announcement, announce] = useAnnouncer();
  const reading = useSubnet(connection.engineOrigin, id);
  const { value: read, failure, refresh } = reading;
  const subnet = read?.found === true ? read.value : undefined;
  const [reads, setReads] = useState(0);
  const [deleting, setDeleting] = useState<SubnetTarget>();
  const failureState = failure === undefined ? undefined : readFailureState(failure, connection, 'subnet');

  const readAgain = useCallback(() => {
    refresh();
    setReads((current) => current + 1);
  }, [refresh]);

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
          <StatusIndicator type="loading">Loading subnet</StatusIndicator>
        </Box>
      </Container>
    );
  } else if (subnet === undefined) {
    content = <NotFound />;
  } else {
    content = <Sections subnet={subnet} connection={connection} reads={reads} />;
  }

  const name = subnet === undefined ? undefined : nameOf(subnet.tags);

  const handleDeleted = (deleted: SubnetTarget) => {
    setDeleting(undefined);
    flash.handOver(SUBNETS_PATH, [{ type: 'success', content: `Deleted subnet ${deleted.label}` }]);
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
                {subnet !== undefined && (
                  <Button
                    onClick={() => {
                      setDeleting({ id: subnet.id, label: name ?? subnet.id });
                    }}
                  >
                    Delete subnet
                  </Button>
                )}
              </SpaceBetween>
            }
          >
            <NameText name={name ?? id} />
          </Header>
        }
      >
        {content}
      </ContentLayout>
      <DeleteSubnetDialog
        subnet={deleting}
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
