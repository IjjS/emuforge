import Alert, { type AlertProps } from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button, { type ButtonProps } from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Form from '@cloudscape-design/components/form';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import Input, { type InputProps } from '@cloudscape-design/components/input';
import Select, { type SelectProps } from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';

import { DiscardDialog, type DiscardAnswer } from '../../../components/discard-dialog';
import { actionFailureItem } from '../../../components/failure-states';
import { usePageFlash, type FlashItem } from '../../../components/page-flash';
import { useAvailabilityZones } from '../../../components/use-availability-zones';
import { useShowsResources } from '../../../components/page-resources';
import { failureOf } from '../../../components/use-token-listing';
import type { VpcChoice } from '../../../lib/ec2-network-choices';
import type { ScreenPageProps } from '../../../screens';
import { CHOOSE_A_VPC, VpcField } from '../components/vpc-field';
import { CREATE_SUBNET_TITLE, subnetHref, SUBNETS_PATH, SUBNETS_WORD, VPC_QUERY } from '../format';
import { blockMessage, NAME_CONSTRAINT, nameMessage, SUBNET_BLOCK } from '../form';
import { useCreateSubnet } from '../subnet-changes';
import { SUBNET_CHANGE_OPERATIONS, type NewSubnet } from '../subnet-changes-api';

// S5, "Create subnet" (issue 574, design task 2, step 3): the VPC (the one of `?vpc=` chosen at start), a name, an
// Availability Zone of `DescribeAvailabilityZones` ("Chosen by the emulator" sends none) and the IPv4 block. `form.ts`
// checks what is said before anything is sent; then one `CreateSubnet`. On 200 the new subnet's page opens with the
// result; a refusal (a block outside the VPC's or one that overlaps another subnet) stays on the form as it came,
// with every entry. A failed read of the zones never fails the form.

const CREATING = 'Creating';
const BLOCK_DESCRIPTION =
  "The emulator refuses a block outside the VPC's block and one that overlaps another subnet of the VPC.";
const BLOCK_CONSTRAINT = 'An IPv4 block in CIDR notation, from /16 to /28, such as 10.0.1.0/24.';
const CHOSEN_BY_EMULATOR = 'Chosen by the emulator';

/** The value of "Chosen by the emulator"; no zone's name is empty. */
const NO_ZONE = '';

interface SubnetFormState {
  vpc: VpcChoice | undefined;
  name: string;
  zone: string;
  cidr: string;
}

interface SubnetFormMessages {
  vpc?: string | undefined;
  name?: string | undefined;
  cidr?: string | undefined;
}

function messagesOf(form: SubnetFormState): SubnetFormMessages {
  return {
    vpc: form.vpc === undefined ? CHOOSE_A_VPC : undefined,
    name: nameMessage(form.name),
    cidr: blockMessage(form.cidr, SUBNET_BLOCK),
  };
}

/** Whether the form differs from how it opened, the VPC of `?vpc=` included (`aws-area.md`, entry 5). */
function differs(form: SubnetFormState, openedWith: VpcChoice | undefined): boolean {
  return form.name !== '' || form.zone !== NO_ZONE || form.cidr !== '' || form.vpc?.id !== openedWith?.id;
}

/** What `CreateSubnet` is sent: the zone and the name only when given. */
function subnetOf(form: SubnetFormState, vpcId: string): NewSubnet {
  return {
    vpcId,
    cidr: form.cidr,
    ...(form.zone === NO_ZONE ? {} : { zone: form.zone }),
    ...(form.name === '' ? {} : { name: form.name }),
  };
}

/**
 * `/aws/vpc/subnets/create`, with `?vpc={id}` choosing the VPC. "Create subnet" checks the form, then sends
 * `CreateSubnet`; on success the new subnet's page opens with "Created subnet {id}".
 */
export function CreateSubnetPage({ connection }: ScreenPageProps) {
  useShowsResources(SUBNETS_WORD);
  const navigate = useNavigate();
  const flash = usePageFlash();
  const [query] = useSearchParams();
  const [preset] = useState(() => {
    const value = query.get(VPC_QUERY);
    return value === null || value === '' ? undefined : value;
  });
  const engineOrigin = connection.engineOrigin;
  const create = useCreateSubnet(engineOrigin);
  const zones = useAvailabilityZones(engineOrigin);

  const [form, setForm] = useState<SubnetFormState>({ vpc: undefined, name: '', zone: NO_ZONE, cidr: '' });
  const [openedWith, setOpenedWith] = useState<VpcChoice>();
  const [tried, setTried] = useState(false);
  const [failure, setFailure] = useState<FlashItem>();
  const [pending, setPending] = useState(false);

  const vpcRef = useRef<SelectProps.Ref>(null);
  const nameRef = useRef<InputProps.Ref>(null);
  const cidrRef = useRef<InputProps.Ref>(null);
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

  const change = useCallback((update: Partial<SubnetFormState>) => {
    setForm((current) => ({ ...current, ...update }));
  }, []);
  const handleVpc = useCallback(
    (vpc: VpcChoice | undefined) => {
      change({ vpc });
    },
    [change],
  );
  const handlePresetSettled = useCallback((vpc: VpcChoice | undefined) => {
    setOpenedWith(vpc);
  }, []);

  const messages: SubnetFormMessages = tried ? messagesOf(form) : {};

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy.current) {
      return;
    }
    setTried(true);
    setFailure(undefined);
    const found = messagesOf(form);
    if (found.vpc !== undefined) {
      vpcRef.current?.focus();
      return;
    }
    if (found.name !== undefined) {
      nameRef.current?.focus();
      return;
    }
    if (found.cidr !== undefined || form.vpc === undefined) {
      cidrRef.current?.focus();
      return;
    }
    const operation = SUBNET_CHANGE_OPERATIONS.createSubnet;
    const what = `Creating subnet ${form.cidr}`;
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
      const id = await create(subnetOf(form, form.vpc.id), controller.signal);
      if (controller.signal.aborted) {
        return;
      }
      settle();
      flash.handOver(subnetHref(id), [{ type: 'success', content: `Created subnet ${id}` }]);
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
  const handleCancel = () => {
    if (differs(form, openedWith)) {
      setAsking(true);
      return;
    }
    void navigate(SUBNETS_PATH);
  };
  const handleDiscardAnswer = useCallback(
    (answer: DiscardAnswer) => {
      setAsking(false);
      if (answer === 'discard') {
        void navigate(SUBNETS_PATH);
      } else {
        setKept((count) => count + 1);
      }
    },
    [navigate],
  );

  const zoneFixed: SelectProps.Option = { value: NO_ZONE, label: CHOSEN_BY_EMULATOR };
  const zoneOptions: SelectProps.Option[] = [
    zoneFixed,
    ...(zones.zones ?? []).map((zone) => ({ value: zone, label: zone })),
  ];
  const zoneSelected = zoneOptions.find((option) => option.value === form.zone) ?? {
    value: form.zone,
    label: form.zone,
  };

  return (
    <SpaceBetween size="l">
      <Header variant="h1">{CREATE_SUBNET_TITLE}</Header>
      <form onSubmit={(event) => void handleSubmit(event)} noValidate>
        <Form
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button ref={cancelRef} variant="link" formAction="none" onClick={handleCancel}>
                Cancel
              </Button>
              <Button variant="primary" loading={pending} loadingText={CREATING}>
                {pending ? CREATING : CREATE_SUBNET_TITLE}
              </Button>
            </SpaceBetween>
          }
        >
          <SpaceBetween size="l">
            <Container header={<Header variant="h2">Subnet</Header>}>
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
                <FormField label="Availability Zone - optional">
                  <SpaceBetween size="xs">
                    <Select
                      selectedOption={zoneSelected}
                      options={zoneOptions}
                      ariaLabel="Availability Zone"
                      onChange={({ detail }) => {
                        change({ zone: detail.selectedOption.value ?? NO_ZONE });
                      }}
                    />
                    {zones.loading && engineOrigin !== undefined && (
                      <StatusIndicator type="loading">Loading Availability Zones</StatusIndicator>
                    )}
                    {zones.failure !== undefined && (
                      <Box>
                        <SpaceBetween direction="horizontal" size="xs" alignItems="center">
                          <StatusIndicator type="error">The Availability Zones could not be loaded</StatusIndicator>
                          <Button formAction="none" onClick={zones.retry}>
                            Retry
                          </Button>
                        </SpaceBetween>
                      </Box>
                    )}
                  </SpaceBetween>
                </FormField>
                <FormField
                  label="IPv4 CIDR block"
                  description={BLOCK_DESCRIPTION}
                  constraintText={BLOCK_CONSTRAINT}
                  errorText={messages.cidr}
                >
                  <Input
                    ref={cidrRef}
                    value={form.cidr}
                    invalid={messages.cidr !== undefined}
                    autoComplete={false}
                    spellcheck={false}
                    onChange={({ detail }) => {
                      change({ cidr: detail.value });
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
