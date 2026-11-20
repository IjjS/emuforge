import Alert, { type AlertProps } from '@cloudscape-design/components/alert';
import Button, { type ButtonProps } from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Form from '@cloudscape-design/components/form';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import type { SelectProps } from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';

import { ChoiceSelect } from '../../../components/choice-select';
import { DiscardDialog, type DiscardAnswer } from '../../../components/discard-dialog';
import type { AreaConnection } from '../../../components/emulator-line';
import { actionFailureItem } from '../../../components/failure-states';
import { usePageFlash, type FlashItem } from '../../../components/page-flash';
import { useShowsResources } from '../../../components/page-resources';
import { failureOf } from '../../../components/use-token-listing';
import type { SubnetChoice } from '../../../lib/ec2-network-choices';
import type { ScreenPageProps } from '../../../screens';
import type { RouteTable } from '../api';
import { subnetChoices } from '../choices';
import { ASSOCIATE_SUBNET_TITLE, nameOrId, NONE, routeTableHref, ROUTE_TABLES_WORD } from '../format';
import { ROUTE_CHANGE_OPERATIONS } from '../route-changes-api';
import { useAssociateSubnet } from '../route-changes';
import { ForRouteTable } from './add-route-page';

// S11, "Associate subnet" (issue 574, design task 3), for the route table of its address, read by `route-table-id`:
// the subnet, chosen a page of `DescribeSubnets` by the table's `vpc-id` at a time when the field opens. One
// `AssociateRouteTable`; on 200 S9 opens with the result. A refusal (a subnet that has an association already) stays
// on the form with the emulator's code and message and the choice.

const ASSOCIATING = 'Associating';
const CHOOSE_A_SUBNET = 'Choose a subnet.';

function AssociateForm({ table, connection }: { table: RouteTable; connection: AreaConnection }) {
  const navigate = useNavigate();
  const flash = usePageFlash();
  const engineOrigin = connection.engineOrigin;
  const associate = useAssociateSubnet(engineOrigin);
  const vpcId = table.vpcId ?? '';

  const [subnet, setSubnet] = useState<SubnetChoice>();
  const [tried, setTried] = useState(false);
  const [failure, setFailure] = useState<FlashItem>();
  const [pending, setPending] = useState(false);
  const subnetRef = useRef<SelectProps.Ref>(null);
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

  const message = tried && subnet === undefined ? CHOOSE_A_SUBNET : undefined;
  const tableHref = routeTableHref(table.id);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy.current) {
      return;
    }
    setTried(true);
    setFailure(undefined);
    if (subnet === undefined) {
      subnetRef.current?.focus();
      return;
    }
    const operation = ROUTE_CHANGE_OPERATIONS.associateRouteTable;
    const what = `Associating ${subnet.id}`;
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
      await associate(table.id, subnet.id, controller.signal);
      if (controller.signal.aborted) {
        return;
      }
      settle();
      flash.handOver(tableHref, [{ type: 'success', content: `Associated ${subnet.id} with ${table.id}` }]);
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }
      settle();
      setFailure(actionFailureItem(failureOf(error, operation), what, engineOrigin));
    }
  };

  // "Cancel" leaves at once while nothing is chosen; otherwise it asks (`aws-area.md`, entry 5).
  const [asking, setAsking] = useState(false);
  const cancelRef = useRef<ButtonProps.Ref>(null);
  const [kept, setKept] = useState(0);
  useEffect(() => {
    if (kept > 0) {
      cancelRef.current?.focus();
    }
  }, [kept]);
  const handleCancel = () => {
    if (subnet !== undefined) {
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
              <Button variant="primary" loading={pending} loadingText={ASSOCIATING}>
                {pending ? ASSOCIATING : ASSOCIATE_SUBNET_TITLE}
              </Button>
            </SpaceBetween>
          }
        >
          <SpaceBetween size="l">
            <Container header={<Header variant="h2">Subnet</Header>}>
              <FormField label="Subnet" {...(message === undefined ? {} : { errorText: message })}>
                <ChoiceSelect<SubnetChoice>
                  source={subnetChoices(engineOrigin, vpcId)}
                  connection={connection}
                  things="subnets"
                  placeholder="Choose a subnet"
                  ariaLabel="Subnet"
                  invalid={message !== undefined}
                  value={subnet}
                  onChange={setSubnet}
                  selectRef={subnetRef}
                />
              </FormField>
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

/** `/aws/vpc/route-tables/route-table/{id}/associate-subnet`. */
export function AssociateSubnetPage({ connection, params }: ScreenPageProps) {
  useShowsResources(ROUTE_TABLES_WORD);
  const id = params['id'] ?? '';
  return (
    <ForRouteTable
      connection={connection}
      id={id}
      title={ASSOCIATE_SUBNET_TITLE}
      description={(table) => (
        <>
          Associates a subnet of {table.vpcId ?? NONE} with {nameOrId(table.id, table.tags)}.
        </>
      )}
    >
      {(table) => <AssociateForm table={table} connection={connection} />}
    </ForRouteTable>
  );
}
