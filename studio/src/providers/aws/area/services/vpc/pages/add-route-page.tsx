import Alert, { type AlertProps } from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button, { type ButtonProps } from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Form from '@cloudscape-design/components/form';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import Input, { type InputProps } from '@cloudscape-design/components/input';
import Link from '@cloudscape-design/components/link';
import Select, { type SelectProps } from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router';

import { ChoiceSelect } from '../../../components/choice-select';
import { DiscardDialog, type DiscardAnswer } from '../../../components/discard-dialog';
import type { AreaConnection } from '../../../components/emulator-line';
import { actionFailureItem, readFailureState, ReadFailure, useAnnouncer } from '../../../components/failure-states';
import { usePageFlash, type FlashItem } from '../../../components/page-flash';
import { useShowsResources } from '../../../components/page-resources';
import { useFollow } from '../../../components/use-follow';
import { failureOf } from '../../../components/use-token-listing';
import type { ScreenPageProps } from '../../../screens';
import type { RouteTable } from '../api';
import { ADD_ROUTE_TITLE, nameOrId, routeTableHref, ROUTE_TABLES_PATH, ROUTE_TABLES_WORD } from '../format';
import { blockMessage, ROUTE_DESTINATION } from '../form';
import { useRouteTable } from '../queries';
import { ROUTE_CHANGE_OPERATIONS } from '../route-changes-api';
import { useAddRoute } from '../route-changes';
import { ROUTE_TARGET_KINDS, routeTargetChoices, type RouteTarget, type RouteTargetKind } from '../route-targets';

const targetKinds = Object.entries(ROUTE_TARGET_KINDS).map(([value, { label, description }]) => ({
  value: value as RouteTargetKind,
  label,
  description,
}));

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

function AddRouteForm({ table, connection }: { table: RouteTable; connection: AreaConnection }) {
  const navigate = useNavigate();
  const flash = usePageFlash();
  const engineOrigin = connection.engineOrigin;
  const add = useAddRoute(engineOrigin);
  const vpcId = table.vpcId ?? '';

  const [destination, setDestination] = useState('');
  const [kind, setKind] = useState<RouteTargetKind>();
  const [target, setTarget] = useState<RouteTarget>();
  const kindRef = useRef<SelectProps.Ref>(null);
  const targetRef = useRef<SelectProps.Ref>(null);
  const targets = kind === undefined ? 'targets' : ROUTE_TARGET_KINDS[kind].plural;
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
  const kindMessage = tried && kind === undefined ? 'Choose a target type.' : undefined;
  const targetMessage = tried && kind !== undefined && target === undefined ? 'Choose a target.' : undefined;
  const tableHref = routeTableHref(table.id);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy.current) {
      return;
    }
    setTried(true);
    setFailure(undefined);
    if (blockMessage(destination, ROUTE_DESTINATION) !== undefined) {
      destinationRef.current?.focus();
      return;
    }
    if (kind === undefined) {
      kindRef.current?.focus();
      return;
    }
    if (target === undefined) {
      targetRef.current?.focus();
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
      await add({ routeTableId: table.id, destination, target: { kind, id: target.id } }, controller.signal);
      if (controller.signal.aborted) {
        return;
      }
      settle();
      flash.handOver(tableHref, [{ type: 'success', content: `Saved the route to ${target.id} in ${table.id}` }]);
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
    if (destination !== '' || kind !== undefined) {
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
              <Button variant="primary" loading={pending} loadingText={ADDING}>
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
                <FormField label="Target type" errorText={kindMessage}>
                  <Select
                    ref={kindRef}
                    ariaLabel="Target type"
                    placeholder="Choose a target type"
                    options={targetKinds}
                    selectedOption={targetKinds.find((option) => option.value === kind) ?? null}
                    onChange={({ detail }) => {
                      const next = targetKinds.find((option) => option.value === detail.selectedOption.value)?.value;
                      if (next !== kind) {
                        setKind(next);
                        setTarget(undefined);
                      }
                    }}
                  />
                </FormField>
                <FormField label="Target" errorText={targetMessage}>
                  <ChoiceSelect
                    key={kind}
                    source={routeTargetChoices(engineOrigin, vpcId, kind ?? 'GatewayId')}
                    connection={connection}
                    things={targets}
                    none={`No ${targets} in ${vpcId}`}
                    lockedBy={kind === undefined ? 'Target type' : undefined}
                    placeholder="Choose a target"
                    ariaLabel="Target"
                    invalid={targetMessage !== undefined}
                    value={target}
                    onChange={setTarget}
                    selectRef={targetRef}
                  />
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
