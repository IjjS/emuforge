import Alert, { type AlertProps } from '@cloudscape-design/components/alert';
import Button, { type ButtonProps } from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Form from '@cloudscape-design/components/form';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import Input, { type InputProps } from '@cloudscape-design/components/input';
import type { SelectProps } from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';

import { DiscardDialog, type DiscardAnswer } from '../../../components/discard-dialog';
import { actionFailureItem } from '../../../components/failure-states';
import { usePageFlash, type FlashItem } from '../../../components/page-flash';
import { useShowsResources } from '../../../components/page-resources';
import { failureOf } from '../../../components/use-token-listing';
import type { VpcChoice } from '../../../lib/ec2-network-choices';
import type { ScreenPageProps } from '../../../screens';
import { CHOOSE_A_VPC, VpcField } from '../components/vpc-field';
import { CREATE_ROUTE_TABLE_TITLE, routeTableHref, ROUTE_TABLES_PATH, ROUTE_TABLES_WORD, VPC_QUERY } from '../format';
import { NAME_CONSTRAINT, nameMessage } from '../form';
import { ROUTE_TABLE_CHANGE_OPERATIONS, type NewRouteTable } from '../route-table-changes-api';
import { useCreateRouteTable } from '../route-table-changes';

// S8, "Create route table" (issue 574, design task 3): the VPC, chosen a page of `DescribeVpcs` at a time when the
// field opens, or the one of `?vpc=` read on its own; and an optional name. The form is checked before anything is
// sent; then one `CreateRouteTable`. On 200 the new table's page opens with the result; a refusal stays on the form
// with the emulator's code and message and every entry. What is entered lives in this page alone.

const CREATING = 'Creating';

interface TableFormState {
  vpc: VpcChoice | undefined;
  name: string;
}

interface TableFormMessages {
  vpc?: string;
  name?: string;
}

function messagesOf(form: TableFormState): TableFormMessages {
  const name = nameMessage(form.name);
  return {
    ...(form.vpc === undefined ? { vpc: CHOOSE_A_VPC } : {}),
    ...(name === undefined ? {} : { name }),
  };
}

/** What `CreateRouteTable` is sent for the form: the name only when one is given. */
function tableOf(vpc: VpcChoice, form: TableFormState): NewRouteTable {
  return { vpcId: vpc.id, ...(form.name === '' ? {} : { name: form.name }) };
}

/**
 * `/aws/vpc/route-tables/create`, with `?vpc={id}` choosing the VPC. "Create route table" checks the form, then sends
 * `CreateRouteTable`; on success the new table's page opens with "Created route table {id}". A failure stays on the
 * form with what was entered, and takes the focus.
 */
export function CreateRouteTablePage({ connection }: ScreenPageProps) {
  useShowsResources(ROUTE_TABLES_WORD);
  const navigate = useNavigate();
  const flash = usePageFlash();
  const [query] = useSearchParams();
  const [preset] = useState(() => query.get(VPC_QUERY) ?? undefined);
  const engineOrigin = connection.engineOrigin;
  const create = useCreateRouteTable(engineOrigin);

  const [form, setForm] = useState<TableFormState>({ vpc: undefined, name: '' });
  // What the form opened with: the VPC of `?vpc=` once its read has answered, else none.
  const [opening, setOpening] = useState<VpcChoice | undefined>();
  const [tried, setTried] = useState(false);
  const [failure, setFailure] = useState<FlashItem>();
  const [pending, setPending] = useState(false);

  const vpcRef = useRef<SelectProps.Ref>(null);
  const nameRef = useRef<InputProps.Ref>(null);
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

  const change = useCallback((update: Partial<TableFormState>) => {
    setForm((current) => ({ ...current, ...update }));
  }, []);

  const handleVpc = useCallback(
    (vpc: VpcChoice | undefined) => {
      change({ vpc });
    },
    [change],
  );

  const handlePresetSettled = useCallback((vpc: VpcChoice | undefined) => {
    setOpening(vpc);
  }, []);

  const messages = tried ? messagesOf(form) : {};

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy.current) {
      return;
    }
    setTried(true);
    setFailure(undefined);
    const found = messagesOf(form);
    if (found.vpc !== undefined || form.vpc === undefined) {
      vpcRef.current?.focus();
      return;
    }
    if (found.name !== undefined) {
      nameRef.current?.focus();
      return;
    }
    const operation = ROUTE_TABLE_CHANGE_OPERATIONS.createRouteTable;
    const what = 'Creating route table';
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
      const id = await create(tableOf(form.vpc, form), controller.signal);
      if (controller.signal.aborted) {
        return;
      }
      settle();
      flash.handOver(routeTableHref(id), [{ type: 'success', content: `Created route table ${id}` }]);
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }
      settle();
      setFailure(actionFailureItem(failureOf(error, operation), what, engineOrigin));
    }
  };

  // "Cancel" leaves at once while nothing differs from the opening state; otherwise it asks (`aws-area.md`, entry 5).
  const [asking, setAsking] = useState(false);
  const cancelRef = useRef<ButtonProps.Ref>(null);
  const [kept, setKept] = useState(0);
  useEffect(() => {
    if (kept > 0) {
      cancelRef.current?.focus();
    }
  }, [kept]);
  const differs = form.name !== '' || form.vpc?.id !== opening?.id;
  const handleCancel = () => {
    if (differs) {
      setAsking(true);
      return;
    }
    void navigate(ROUTE_TABLES_PATH);
  };
  const handleDiscardAnswer = useCallback(
    (answer: DiscardAnswer) => {
      setAsking(false);
      if (answer === 'discard') {
        void navigate(ROUTE_TABLES_PATH);
      } else {
        setKept((count) => count + 1);
      }
    },
    [navigate],
  );

  return (
    <SpaceBetween size="l">
      <Header variant="h1">{CREATE_ROUTE_TABLE_TITLE}</Header>
      <form onSubmit={(event) => void handleSubmit(event)} noValidate>
        <Form
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button ref={cancelRef} variant="link" formAction="none" onClick={handleCancel}>
                Cancel
              </Button>
              <Button variant="primary" loading={pending} loadingText={CREATING}>
                {pending ? CREATING : CREATE_ROUTE_TABLE_TITLE}
              </Button>
            </SpaceBetween>
          }
        >
          <SpaceBetween size="l">
            <Container header={<Header variant="h2">Route table</Header>}>
              <SpaceBetween size="l">
                <VpcField
                  connection={connection}
                  value={form.vpc}
                  onChange={handleVpc}
                  preset={preset}
                  onPresetSettled={handlePresetSettled}
                  errorText={messages.vpc}
                  selectRef={vpcRef}
                />
                <FormField label="Name - optional" constraintText={NAME_CONSTRAINT} errorText={messages.name}>
                  <Input
                    ref={nameRef}
                    value={form.name}
                    invalid={messages.name !== undefined}
                    autoComplete={false}
                    spellcheck={false}
                    onChange={({ detail }) => {
                      change({ name: detail.value });
                    }}
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
    </SpaceBetween>
  );
}
