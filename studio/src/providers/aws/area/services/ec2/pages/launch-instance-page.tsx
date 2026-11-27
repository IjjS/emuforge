import Alert, { type AlertProps } from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button, { type ButtonProps } from '@cloudscape-design/components/button';
import Checkbox from '@cloudscape-design/components/checkbox';
import Container from '@cloudscape-design/components/container';
import Form from '@cloudscape-design/components/form';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import Input, { type InputProps } from '@cloudscape-design/components/input';
import Link from '@cloudscape-design/components/link';
import type { SelectProps } from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Textarea from '@cloudscape-design/components/textarea';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';

import { ChoiceMultiselect } from '../../../components/choice-multiselect';
import { ChoiceSelect } from '../../../components/choice-select';
import { DiscardDialog, type DiscardAnswer } from '../../../components/discard-dialog';
import { actionFailureItem, readFailureState, type ReadFailureState } from '../../../components/failure-states';
import { usePageFlash, type FlashItem } from '../../../components/page-flash';
import { useShowsResources } from '../../../components/page-resources';
import { TagsField, type TagsFieldRef } from '../../../components/tags-field';
import { failureOf } from '../../../components/use-token-listing';
import type { ScreenPageProps } from '../../../screens';
import type { SubnetChoice, VpcChoice } from '../../../lib/ec2-network-choices';
import { checkTagRows, type TagRow } from '../../../lib/tag-rows';
import type { GroupChoice, ImageChoice, InstanceTypeChoice, KeyPairChoice } from '../choices-api';
import {
  groupChoices,
  imageChoices,
  instanceTypeChoices,
  keyPairChoices,
  subnetChoices,
  useDefaultVpc,
  useInstanceTypeOfferings,
  vpcChoices,
} from '../choices-queries';
import {
  CREATE_KEY_PAIR_PATH,
  CREATE_KEY_PAIR_TITLE,
  instanceHref,
  INSTANCES_PATH,
  INSTANCES_WORD,
  LAUNCH_INSTANCE_TITLE,
} from '../format';
import { instanceProfileChoices, type InstanceProfileChoice } from '../instance-profile-choices';
import { LAUNCH_OPERATION, type NewInstance } from '../launch-api';
import { launchFormMessages, NAME_RULE, typeDescription, type LaunchFormMessages } from '../launch-form';
import { useLaunchInstance } from '../launch-queries';

const LAUNCHING = 'Launching';
const NO_TYPES = new Set<string>();
const GROUPS_DEFAULT = 'With none chosen the instance gets the group default.';

function FieldReadFailure({
  state,
  unsupportedOperation,
  onRetry,
}: {
  state: ReadFailureState;
  unsupportedOperation: string | undefined;
  onRetry: () => void;
}) {
  return (
    <SpaceBetween size="xxs">
      <StatusIndicator type={state.type}>{state.first}</StatusIndicator>
      <Box variant="small">
        {unsupportedOperation === undefined
          ? state.detail
          : `The emulator answered 501 Not Implemented for ${unsupportedOperation}.`}
      </Box>
      {unsupportedOperation === undefined && (
        <Button variant="inline-link" formAction="none" onClick={onRetry}>
          Retry
        </Button>
      )}
    </SpaceBetween>
  );
}

interface LaunchFormState {
  name: string;
  image: ImageChoice | undefined;
  type: InstanceTypeChoice | undefined;
  keyPair: KeyPairChoice | undefined;
  vpc: VpcChoice | undefined;
  subnet: SubnetChoice | undefined;
  groups: GroupChoice[];
  profile: InstanceProfileChoice | undefined;
  terminationProtection: boolean;
  userData: string;
  tags: TagRow[];
}

const START: LaunchFormState = {
  name: '',
  image: undefined,
  type: undefined,
  keyPair: undefined,
  vpc: undefined,
  subnet: undefined,
  groups: [],
  profile: undefined,
  terminationProtection: false,
  userData: '',
  tags: [],
};

/** Whether the form differs from how it opened. */
function differs(form: LaunchFormState, defaultVpc: VpcChoice | undefined): boolean {
  return (
    form.name !== '' ||
    form.image !== undefined ||
    form.type !== undefined ||
    form.keyPair !== undefined ||
    (form.vpc !== undefined && form.vpc.id !== defaultVpc?.id) ||
    form.subnet !== undefined ||
    form.groups.length > 0 ||
    form.profile !== undefined ||
    form.terminationProtection ||
    form.userData !== '' ||
    form.tags.length > 0
  );
}

function messagesOf(form: LaunchFormState, vpc: VpcChoice | undefined): LaunchFormMessages {
  return launchFormMessages({
    name: form.name,
    imageChosen: form.image !== undefined,
    typeChosen: form.type !== undefined,
    vpc,
    subnetChosen: form.subnet !== undefined,
  });
}

/** What `RunInstances` is sent for the form: only what was chosen. */
function launchOf(form: LaunchFormState, image: ImageChoice, type: InstanceTypeChoice, tags: TagRow[]): NewInstance {
  const launch: NewInstance = { imageId: image.id, instanceType: type.type };
  if (form.name !== '') {
    launch.name = form.name;
  }
  if (form.keyPair !== undefined) {
    launch.keyName = form.keyPair.name;
  }
  if (form.subnet !== undefined) {
    launch.subnetId = form.subnet.id;
  }
  if (form.groups.length > 0) {
    launch.securityGroupIds = form.groups.map((group) => group.id);
  }
  if (form.profile !== undefined) launch.instanceProfileName = form.profile.name;
  if (form.terminationProtection) launch.terminationProtection = true;
  if (form.userData !== '') launch.userData = form.userData;
  if (tags.length > 0) launch.tags = tags;
  return launch;
}

/**
 * `/aws/ec2/instances/launch`. "Launch instance" checks the form, then sends `RunInstances`; on success the new
 * instance's page opens with "Launched instance {id}". A failure stays on the form with what was entered, and takes
 * the focus.
 */
export function LaunchInstancePage({ connection }: ScreenPageProps) {
  useShowsResources(INSTANCES_WORD);
  const navigate = useNavigate();
  const flash = usePageFlash();
  const engineOrigin = connection.engineOrigin;
  const launch = useLaunchInstance(engineOrigin);

  const [form, setForm] = useState<LaunchFormState>(START);
  const [tried, setTried] = useState(false);
  const [failure, setFailure] = useState<FlashItem>();
  const [pending, setPending] = useState(false);
  const defaultVpc = useDefaultVpc(engineOrigin);
  const vpc = form.vpc ?? defaultVpc.vpc;
  const zone = form.subnet?.zone;
  const offerings = useInstanceTypeOfferings(engineOrigin, zone);
  const checkingType = zone !== undefined && offerings.types === undefined;
  const typeSource = instanceTypeChoices(
    engineOrigin,
    zone,
    offerings.failure === undefined ? offerings.types : NO_TYPES,
  );
  const tags = checkTagRows(form.tags, form.name === '' ? undefined : 'Name');

  if (form.type !== undefined && offerings.types?.has(form.type.type) === false) {
    setForm({ ...form, type: undefined });
  }

  const nameRef = useRef<InputProps.Ref>(null);
  const imageRef = useRef<SelectProps.Ref>(null);
  const typeRef = useRef<SelectProps.Ref>(null);
  const vpcRef = useRef<SelectProps.Ref>(null);
  const subnetRef = useRef<SelectProps.Ref>(null);
  const tagsRef = useRef<TagsFieldRef>(null);
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

  const change = useCallback((update: Partial<LaunchFormState>) => {
    setForm((current) => ({ ...current, ...update }));
  }, []);

  const handleVpc = (chosen: VpcChoice | undefined) => {
    if (chosen !== undefined && chosen.id !== vpc?.id) {
      change({ vpc: chosen, subnet: undefined, groups: [] });
    }
  };

  const messages = tried ? messagesOf(form, vpc) : {};
  const vpcFailure = defaultVpc.failure && readFailureState(defaultVpc.failure, connection, 'default VPC');
  const typesFailure = offerings.failure && readFailureState(offerings.failure, connection, 'instance types');

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy.current || checkingType) {
      return;
    }
    setTried(true);
    setFailure(undefined);
    const found = messagesOf(form, vpc);
    if (found.name !== undefined) {
      nameRef.current?.focus();
      return;
    }
    if (found.image !== undefined || form.image === undefined) {
      imageRef.current?.focus();
      return;
    }
    if (found.type !== undefined || form.type === undefined) {
      typeRef.current?.focus();
      return;
    }
    if (found.vpc !== undefined) {
      vpcRef.current?.focus();
      return;
    }
    if (found.subnet !== undefined) {
      subnetRef.current?.focus();
      return;
    }
    if (tags.firstInvalid !== undefined) {
      tagsRef.current?.focusKey(tags.firstInvalid);
      return;
    }
    if (engineOrigin === undefined) {
      setFailure(
        actionFailureItem({ kind: 'engine-did-not-answer', operation: LAUNCH_OPERATION }, 'Launching', undefined),
      );
      return;
    }
    busy.current = true;
    setPending(true);
    const controller = new AbortController();
    inFlight.current = controller;
    try {
      const id = await launch(launchOf(form, form.image, form.type, tags.tags), controller.signal);
      if (controller.signal.aborted) {
        return;
      }
      inFlight.current = null;
      busy.current = false;
      setPending(false);
      flash.handOver(instanceHref(id), [{ type: 'success', content: `Launched instance ${id}` }]);
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }
      inFlight.current = null;
      busy.current = false;
      setPending(false);
      setFailure(actionFailureItem(failureOf(error, LAUNCH_OPERATION), 'Launching instance', engineOrigin));
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
    if (differs(form, defaultVpc.vpc)) {
      setAsking(true);
      return;
    }
    void navigate(INSTANCES_PATH);
  };
  const handleDiscardAnswer = useCallback(
    (answer: DiscardAnswer) => {
      setAsking(false);
      if (answer === 'discard') {
        void navigate(INSTANCES_PATH);
      } else {
        setKept((count) => count + 1);
      }
    },
    [navigate],
  );

  return (
    <SpaceBetween size="l">
      <Header variant="h1">{LAUNCH_INSTANCE_TITLE}</Header>
      <form onSubmit={(event) => void handleSubmit(event)} noValidate>
        <Form
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button ref={cancelRef} variant="link" formAction="none" onClick={handleCancel}>
                Cancel
              </Button>
              <Button variant="primary" loading={pending} loadingText={LAUNCHING} disabled={checkingType}>
                {pending ? LAUNCHING : LAUNCH_INSTANCE_TITLE}
              </Button>
            </SpaceBetween>
          }
        >
          <SpaceBetween size="l">
            <Container header={<Header variant="h2">Instance</Header>}>
              <SpaceBetween size="l">
                <FormField label="Name - optional" constraintText={NAME_RULE} errorText={messages.name}>
                  <Input
                    ref={nameRef}
                    value={form.name}
                    invalid={messages.name !== undefined}
                    autoComplete={false}
                    onChange={({ detail }) => {
                      change({ name: detail.value });
                    }}
                  />
                </FormField>
                <FormField label="Image" errorText={messages.image}>
                  <ChoiceSelect<ImageChoice>
                    selectRef={imageRef}
                    source={imageChoices(engineOrigin)}
                    connection={connection}
                    things="images"
                    placeholder="Choose an image"
                    invalid={messages.image !== undefined}
                    value={form.image}
                    onChange={(image) => {
                      change({ image });
                    }}
                  />
                </FormField>
                <FormField
                  label="Instance type"
                  description={typeDescription(form.image?.architecture)}
                  errorText={messages.type}
                >
                  <ChoiceSelect<InstanceTypeChoice>
                    key={zone}
                    selectRef={typeRef}
                    source={typeSource}
                    held={offerings.pending ? 'Checking Instance type' : undefined}
                    none={
                      offerings.failure !== undefined
                        ? 'Instance types unavailable'
                        : zone === undefined
                          ? undefined
                          : `No instance types in ${zone}`
                    }
                    connection={connection}
                    things="instance types"
                    placeholder="Choose an instance type"
                    invalid={messages.type !== undefined}
                    value={form.type}
                    onChange={(type) => {
                      change({ type });
                    }}
                  />
                </FormField>
                {typesFailure !== undefined && (
                  <FieldReadFailure
                    state={typesFailure}
                    unsupportedOperation={
                      offerings.failure?.kind === 'not-implemented' ? offerings.failure.operation : undefined
                    }
                    onRetry={offerings.retry}
                  />
                )}
              </SpaceBetween>
            </Container>

            <Container header={<Header variant="h2">Access and network</Header>}>
              <SpaceBetween size="l">
                <FormField
                  label="Key pair - optional"
                  secondaryControl={
                    // In a new tab, so what was entered here stays; the key pairs are read again at the next opening.
                    <Link href={CREATE_KEY_PAIR_PATH} external externalIconAriaLabel="(opens in a new tab)">
                      {CREATE_KEY_PAIR_TITLE}
                    </Link>
                  }
                >
                  <ChoiceSelect<KeyPairChoice>
                    source={keyPairChoices(engineOrigin)}
                    connection={connection}
                    things="key pairs"
                    fixed="No key pair"
                    fixedDescription="The instance is launched without a key pair."
                    value={form.keyPair}
                    onChange={(keyPair) => {
                      change({ keyPair });
                    }}
                  />
                </FormField>
                <FormField label="VPC" errorText={messages.vpc}>
                  <ChoiceSelect
                    selectRef={vpcRef}
                    source={vpcChoices(engineOrigin)}
                    connection={connection}
                    things="VPCs"
                    placeholder="Choose a VPC"
                    held={defaultVpc.pending && vpc === undefined ? 'Checking VPC' : undefined}
                    invalid={messages.vpc !== undefined}
                    value={vpc}
                    onChange={handleVpc}
                  />
                </FormField>
                {vpcFailure !== undefined && (
                  <FieldReadFailure
                    state={vpcFailure}
                    unsupportedOperation={
                      defaultVpc.failure?.kind === 'not-implemented' ? defaultVpc.failure.operation : undefined
                    }
                    onRetry={defaultVpc.retry}
                  />
                )}
                <FormField label="Subnet" errorText={messages.subnet}>
                  <ChoiceSelect<SubnetChoice>
                    selectRef={subnetRef}
                    source={subnetChoices(engineOrigin, vpc?.id)}
                    connection={connection}
                    things="subnets"
                    placeholder="Choose a subnet"
                    lockedBy={vpc === undefined ? 'VPC' : undefined}
                    fixed={vpc?.isDefault ? 'Chosen by the emulator' : undefined}
                    fixedDescription="The emulator uses a default subnet of the default VPC."
                    invalid={messages.subnet !== undefined}
                    value={form.subnet}
                    onChange={(subnet) => change({ subnet })}
                  />
                </FormField>
                <FormField label="Security groups - optional" description={GROUPS_DEFAULT}>
                  <ChoiceMultiselect<GroupChoice>
                    source={groupChoices(engineOrigin, vpc?.id)}
                    lockedBy={vpc === undefined ? 'VPC' : undefined}
                    connection={connection}
                    things="security groups"
                    placeholder="Choose security groups"
                    value={form.groups}
                    onChange={(chosen) => {
                      change({ groups: chosen });
                    }}
                  />
                </FormField>
                <FormField label="IAM instance profile">
                  <ChoiceSelect
                    source={instanceProfileChoices(engineOrigin)}
                    connection={connection}
                    things="instance profiles"
                    fixed="No instance profile"
                    fixedDescription="The instance is launched without one."
                    value={form.profile}
                    onChange={(profile) => change({ profile })}
                  />
                </FormField>
              </SpaceBetween>
            </Container>

            <Container header={<Header variant="h2">Instance settings</Header>}>
              <SpaceBetween size="l">
                <Checkbox
                  checked={form.terminationProtection}
                  description="While it is on, the emulator refuses to terminate the instance."
                  onChange={({ detail }) => change({ terminationProtection: detail.checked })}
                >
                  Termination protection
                </Checkbox>
                <FormField label="User data - optional">
                  <Textarea value={form.userData} onChange={({ detail }) => change({ userData: detail.value })} />
                </FormField>
              </SpaceBetween>
            </Container>

            <TagsField
              ref={tagsRef}
              rows={form.tags}
              errors={tried ? tags.errors : undefined}
              onChange={(rows) => change({ tags: rows })}
            />

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
