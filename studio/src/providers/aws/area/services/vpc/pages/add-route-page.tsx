import Alert, { type AlertProps } from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button, { type ButtonProps } from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Form from '@cloudscape-design/components/form';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import Input, { type InputProps } from '@cloudscape-design/components/input';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import Link from '@cloudscape-design/components/link';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router';

import { DiscardDialog, type DiscardAnswer } from '../../../components/discard-dialog';
import type { AreaConnection } from '../../../components/emulator-line';
import { actionFailureItem, readFailureState, ReadFailure, useAnnouncer } from '../../../components/failure-states';
import { usePageFlash, type FlashItem } from '../../../components/page-flash';
import { useShowsResources } from '../../../components/page-resources';
import { useFollow } from '../../../components/use-follow';
import { failureOf } from '../../../components/use-token-listing';
import { ValueText } from '../../../components/value-text';
import type { ScreenPageProps } from '../../../screens';
import type { RouteTable } from '../api';
import {
  ADD_ROUTE_TITLE,
  INTERNET_GATEWAYS_PATH,
  nameOrId,
  NONE,
  resourceName,
  routeTableHref,
  ROUTE_TABLES_PATH,
  ROUTE_TABLES_WORD,
} from '../format';
import { blockMessage, ROUTE_DESTINATION } from '../form';
import { useGatewayListing, useRouteTable } from '../queries';
import { ROUTE_CHANGE_OPERATIONS } from '../route-changes-api';
import { useAddRoute } from '../route-changes';

// S10, "Add route" (issue 574, design task 3), for the route table of its address, read by `route-table-id`: a
// destination, an IPv4 block; the target, the internet gateway attached to the table's VPC (`DescribeInternetGateways`
// by `attachment.vpc-id`), shown, not chosen. With none attached, or while its read is loading or failed, the form
// cannot be sent. One `CreateRoute` with `GatewayId`; on 200 S9 opens with a result that names the gateway and the
// table and no destination, since the emulator stores a destination without its host bits and answers 200 to a route
// the table already holds. A refusal stays on the form with the emulator's code and message and the entry.

const ADDING = 'Adding';

/** "Route table not found", with Cloudscape's empty-state pattern, in the place of the form. */
export function RouteTableNotFound() {
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

export interface ForRouteTableProps {
  connection: AreaConnection;
  id: string;
  /** The page's title ("Add route"). */
  title: string;
  /** The description under the title, once the table is read. */
  description: (table: RouteTable) => ReactNode;
  /** The form, once the table is read. */
  children: (table: RouteTable) => ReactNode;
}

/**
 * A form of S10 or S11 over the route table `id` of its address: the title, and in the form's place the table's
 * loading, failed ("Retry") or "not found" state until it is read. A failed read is read again once the connection is
 * connected again.
 */
export function ForRouteTable({ connection, id, title, description, children }: ForRouteTableProps) {
  const [announcement, announce] = useAnnouncer();
  const { value: read, failure, refresh } = useRouteTable(connection.engineOrigin, id);
  const table = read?.found === true ? read.value : undefined;
  const failureState = failure === undefined ? undefined : readFailureState(failure, connection, 'route table');

  // Kept from the previous render, as React's own pattern for it, so each change is acted on once.
  const [seenFailureLine, setSeenFailureLine] = useState<string>();
  const failureLine = failureState?.firstText;
  const connected = connection.result?.kind === 'connected';
  const [seenConnected, setSeenConnected] = useState(connected);
  if (failureLine !== seenFailureLine) {
    setSeenFailureLine(failureLine);
    if (failureLine !== undefined) {
      announce(failureLine);
    }
  }
  if (connected !== seenConnected) {
    setSeenConnected(connected);
    if (connected && failure !== undefined) {
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
    content = <RouteTableNotFound />;
  } else {
    content = children(table);
  }

  return (
    <SpaceBetween size="l">
      <Header variant="h1" {...(table === undefined ? {} : { description: description(table) })}>
        {title}
      </Header>
      {content}
      {announcement}
    </SpaceBetween>
  );
}

/** "Target": the internet gateway attached to the table's VPC, its read's states, or that none is attached. */
function Target({
  vpcId,
  listing,
  connection,
}: {
  vpcId: string;
  listing: ReturnType<typeof useGatewayListing>;
  connection: AreaConnection;
}) {
  const handleFollow = useFollow();
  const { items, failure, refresh } = listing;
  const gateway = items?.[0];
  if (failure !== undefined) {
    return <ReadFailure state={readFailureState(failure, connection, 'internet gateway')} onRetry={refresh} />;
  }
  if (items === undefined) {
    return <StatusIndicator type="loading">Loading internet gateway</StatusIndicator>;
  }
  if (gateway === undefined) {
    return (
      <SpaceBetween size="xxs">
        <Box variant="p">
          No internet gateway is attached to <ValueText kind="name" value={vpcId} none={NONE} />. Attach one to add a
          route to it.
        </Box>
        <Link href={INTERNET_GATEWAYS_PATH} onFollow={handleFollow}>
          View internet gateways
        </Link>
      </SpaceBetween>
    );
  }
  return (
    <KeyValuePairs
      columns={2}
      minColumnWidth={200}
      ariaLabel="Target"
      items={[
        { label: 'Internet gateway ID', value: <ValueText kind="name" value={gateway.id} /> },
        { label: 'Name', value: <ValueText kind="name" value={resourceName(gateway.tags)} none={NONE} /> },
      ]}
    />
  );
}

function AddRouteForm({ table, connection }: { table: RouteTable; connection: AreaConnection }) {
  const navigate = useNavigate();
  const flash = usePageFlash();
  const engineOrigin = connection.engineOrigin;
  const add = useAddRoute(engineOrigin);
  const vpcId = table.vpcId ?? '';
  const gateways = useGatewayListing(engineOrigin, { name: '', vpcId });
  const gateway = gateways.failure === undefined ? gateways.items?.[0] : undefined;

  const [destination, setDestination] = useState('');
  const [tried, setTried] = useState(false);
  const [failure, setFailure] = useState<FlashItem>();
  const [pending, setPending] = useState(false);
  const destinationRef = useRef<InputProps.Ref>(null);
  const failureRef = useRef<AlertProps.Ref>(null);

  // A press while an earlier one is in flight sends nothing; the request stops when the page is left.
  const busy = useRef(false);
  const inFlight = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      inFlight.current?.abort();
    },
    [],
  );

  // A failure takes the focus when it is shown, so a screen reader reads it at once.
  useEffect(() => {
    if (failure !== undefined) {
      failureRef.current?.focus();
    }
  }, [failure]);

  const message = tried ? blockMessage(destination, ROUTE_DESTINATION) : undefined;
  const tableHref = routeTableHref(table.id);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy.current || gateway === undefined) {
      return;
    }
    setTried(true);
    setFailure(undefined);
    if (blockMessage(destination, ROUTE_DESTINATION) !== undefined) {
      destinationRef.current?.focus();
      return;
    }
    const operation = ROUTE_CHANGE_OPERATIONS.createRoute;
    const what = 'Adding the route';
    if (engineOrigin === undefined) {
      setFailure(actionFailureItem({ kind: 'engine-did-not-answer', operation }, what, undefined));
      return;
    }
    busy.current = true;
    setPending(true);
    const controller = new AbortController();
    inFlight.current = controller;
    const settle = () => {
      inFlight.current = null;
      busy.current = false;
      setPending(false);
    };
    try {
      await add({ routeTableId: table.id, destination, gatewayId: gateway.id }, controller.signal);
      if (controller.signal.aborted) {
        return;
      }
      settle();
      flash.handOver(tableHref, [{ type: 'success', content: `Saved the route to ${gateway.id} in ${table.id}` }]);
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }
      settle();
      setFailure(actionFailureItem(failureOf(error, operation), what, engineOrigin));
    }
  };

  // "Cancel" leaves at once while nothing is entered; otherwise it asks (`aws-area.md`, entry 5).
  const [asking, setAsking] = useState(false);
  const cancelRef = useRef<ButtonProps.Ref>(null);
  const [kept, setKept] = useState(0);
  useEffect(() => {
    if (kept > 0) {
      cancelRef.current?.focus();
    }
  }, [kept]);
  const handleCancel = () => {
    if (destination !== '') {
      setAsking(true);
      return;
    }
    void navigate(tableHref);
  };
  const handleDiscardAnswer = useCallback(
    (answer: DiscardAnswer) => {
      setAsking(false);
      if (answer === 'discard') {
        void navigate(tableHref);
      } else {
        setKept((count) => count + 1);
      }
    },
    [navigate, tableHref],
  );

  return (
    <>
      <form onSubmit={(event) => void handleSubmit(event)} noValidate>
        <Form
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button ref={cancelRef} variant="link" formAction="none" onClick={handleCancel}>
                Cancel
              </Button>
              <Button variant="primary" disabled={gateway === undefined} loading={pending} loadingText={ADDING}>
                {pending ? ADDING : ADD_ROUTE_TITLE}
              </Button>
            </SpaceBetween>
          }
        >
          <SpaceBetween size="l">
            <Container header={<Header variant="h2">Route</Header>}>
              <SpaceBetween size="l">
                <FormField
                  label="Destination"
                  constraintText="An IPv4 block in CIDR notation, such as 0.0.0.0/0."
                  errorText={message}
                >
                  <Input
                    ref={destinationRef}
                    value={destination}
                    invalid={message !== undefined}
                    autoComplete={false}
                    spellcheck={false}
                    onChange={({ detail }) => {
                      setDestination(detail.value);
                    }}
                  />
                </FormField>
                <FormField label="Target" description="The internet gateway attached to this table's VPC.">
                  <Target vpcId={vpcId} listing={gateways} connection={connection} />
                </FormField>
              </SpaceBetween>
            </Container>

            {failure !== undefined && (
              <Alert ref={failureRef} type={failure.type} header={failure.header}>
                {failure.content}
              </Alert>
            )}
          </SpaceBetween>
        </Form>
      </form>
      {/* Mounted only while it asks, so nothing of it is in the page before "Cancel" is pressed. */}
      {asking && <DiscardDialog visible onAnswer={handleDiscardAnswer} />}
    </>
  );
}

/** `/aws/vpc/route-tables/route-table/{id}/add-route`. */
export function AddRoutePage({ connection, params }: ScreenPageProps) {
  useShowsResources(ROUTE_TABLES_WORD);
  const id = params['id'] ?? '';
  return (
    <ForRouteTable
      connection={connection}
      id={id}
      title={ADD_ROUTE_TITLE}
      description={(table) => <>Adds a route to {nameOrId(table.id, table.tags)}.</>}
    >
      {(table) => <AddRouteForm table={table} connection={connection} />}
    </ForRouteTable>
  );
}
