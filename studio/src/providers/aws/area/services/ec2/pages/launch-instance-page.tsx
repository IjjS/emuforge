import Alert, { type AlertProps } from '@cloudscape-design/components/alert';
import Button, { type ButtonProps } from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Form from '@cloudscape-design/components/form';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import Input, { type InputProps } from '@cloudscape-design/components/input';
import Link from '@cloudscape-design/components/link';
import type { SelectProps } from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';

import { ChoiceMultiselect } from '../../../components/choice-multiselect';
import { ChoiceSelect } from '../../../components/choice-select';
import { DiscardDialog, type DiscardAnswer } from '../../../components/discard-dialog';
import { actionFailureItem } from '../../../components/failure-states';
import { usePageFlash, type FlashItem } from '../../../components/page-flash';
import { useShowsResources } from '../../../components/page-resources';
import { failureOf } from '../../../components/use-token-listing';
import type { ScreenPageProps } from '../../../screens';
import type { SubnetChoice } from '../../../lib/ec2-network-choices';
import type { GroupChoice, ImageChoice, InstanceTypeChoice, KeyPairChoice } from '../choices-api';
import { imageChoices, instanceTypeChoices, keyPairChoices, subnetChoices, useLaunchGroups } from '../choices-queries';
import {
  CREATE_KEY_PAIR_PATH,
  CREATE_KEY_PAIR_TITLE,
  instanceHref,
  INSTANCES_PATH,
  INSTANCES_WORD,
  LAUNCH_INSTANCE_TITLE,
} from '../format';
import { LAUNCH_OPERATION, type NewInstance } from '../launch-api';
import { launchFormMessages, NAME_RULE, typeDescription, type LaunchFormMessages } from '../launch-form';
import { useLaunchInstance } from '../launch-queries';

// S2, "Launch instance" (issue 553, design task 2): one short form of six fields, the name, the image, the instance
// type, the key pair, the subnet and the security groups, each list read a page at a time when its field opens.
// `launch-form.ts` checks the form before anything is sent; then one `RunInstances` of one instance. On 200 the new
// instance's page opens with the result; a refusal stays on the form with the emulator's code and message and every
// entry. A list that failed to load never keeps the form from being sent. What is entered lives in this page alone.

const LAUNCHING = 'Launching';
const GROUPS_DEFAULT = 'With none chosen the instance gets the group default.';

interface LaunchFormState {
  name: string;
  image: ImageChoice | undefined;
  type: InstanceTypeChoice | undefined;
  keyPair: KeyPairChoice | undefined;
  subnet: SubnetChoice | undefined;
  groups: GroupChoice[];
}

const START: LaunchFormState = {
  name: '',
  image: undefined,
  type: undefined,
  keyPair: undefined,
  subnet: undefined,
  groups: [],
};

/** Whether the form differs from how it opened: a text in the name, or any choice made. */
function differs(form: LaunchFormState): boolean {
  return (
    form.name !== '' ||
    form.image !== undefined ||
    form.type !== undefined ||
    form.keyPair !== undefined ||
    form.subnet !== undefined ||
    form.groups.length > 0
  );
}

function messagesOf(form: LaunchFormState): LaunchFormMessages {
  return launchFormMessages({
    name: form.name,
    imageChosen: form.image !== undefined,
    typeChosen: form.type !== undefined,
  });
}

/** What `RunInstances` is sent for the form: only what was chosen. */
function launchOf(form: LaunchFormState, image: ImageChoice, type: InstanceTypeChoice): NewInstance {
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
  const groups = useLaunchGroups(engineOrigin, form.subnet?.vpcId);

  const nameRef = useRef<InputProps.Ref>(null);
  const imageRef = useRef<SelectProps.Ref>(null);
  const typeRef = useRef<SelectProps.Ref>(null);
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

  // The groups are of one VPC: a subnet of another VPC than the one they were chosen in clears them.
  const handleSubnet = (subnet: SubnetChoice | undefined) => {
    const same = groups.vpcFor(form.subnet?.vpcId) === groups.vpcFor(subnet?.vpcId);
    change(same ? { subnet } : { subnet, groups: [] });
  };

  const messages = tried ? messagesOf(form) : {};

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy.current) {
      return;
    }
    setTried(true);
    setFailure(undefined);
    const found = messagesOf(form);
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
      const id = await launch(launchOf(form, form.image, form.type), controller.signal);
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
    if (differs(form)) {
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
              <Button variant="primary" loading={pending} loadingText={LAUNCHING}>
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
                    selectRef={typeRef}
                    source={instanceTypeChoices(engineOrigin)}
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
                    value={form.keyPair}
                    onChange={(keyPair) => {
                      change({ keyPair });
                    }}
                  />
                </FormField>
                <FormField label="Subnet - optional">
                  <ChoiceSelect<SubnetChoice>
                    source={subnetChoices(engineOrigin)}
                    connection={connection}
                    things="subnets"
                    fixed="Chosen by the emulator"
                    value={form.subnet}
                    onChange={handleSubnet}
                  />
                </FormField>
                <FormField label="Security groups - optional" description={GROUPS_DEFAULT}>
                  <ChoiceMultiselect<GroupChoice>
                    source={groups.source}
                    connection={connection}
                    things="security groups"
                    placeholder="Choose security groups"
                    value={form.groups}
                    onChange={(chosen) => {
                      change({ groups: chosen });
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
