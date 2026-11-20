import Alert, { type AlertProps } from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button, { type ButtonProps } from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Form from '@cloudscape-design/components/form';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import Input, { type InputProps } from '@cloudscape-design/components/input';
import Link from '@cloudscape-design/components/link';
import RadioGroup from '@cloudscape-design/components/radio-group';
import Select, { type SelectProps } from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';

import { ChoiceSelect } from '../../../components/choice-select';
import { DiscardDialog, type DiscardAnswer } from '../../../components/discard-dialog';
import { actionFailureItem, readFailureState, ReadFailure } from '../../../components/failure-states';
import { usePageFlash, type FlashItem } from '../../../components/page-flash';
import { useShowsResources } from '../../../components/page-resources';
import { useFollow } from '../../../components/use-follow';
import { failureOf } from '../../../components/use-token-listing';
import type { ScreenPageProps } from '../../../screens';
import type { GroupChoice } from '../choices-api';
import { groupChoices } from '../choices-queries';
import { ADD_RULE_TITLE, securityGroupHref, SECURITY_GROUPS_PATH, SECURITY_GROUPS_WORD } from '../format';
import type { SecurityGroup } from '../group-api';
import {
  FIRST_PORT_RULE,
  hasPorts,
  LAST_PORT_RULE,
  portOf,
  RULE_DESCRIPTION_RULE,
  ruleFormMessages,
  type PeerKind,
  type RuleFormMessages,
  type RuleProtocol,
} from '../group-form';
import { authorizeOperation, type NewRule } from '../group-form-api';
import { useAddRule } from '../group-form-queries';
import { useSecurityGroup } from '../group-queries';

// S7, "Add rule" (issue 553, design task 4): a rule for the group of the address, read by `GroupIds` so a group the
// emulator does not hold shows "Security group not found" and no form. The direction, the protocol, for TCP and UDP
// the two ports, the source (for an outbound rule the destination) as a CIDR block or a group of the edited group's
// own VPC, and a description. `group-form.ts` checks the form before anything is sent; then one
// `AuthorizeSecurityGroupIngress` or `AuthorizeSecurityGroupEgress` with one permission. On 200 the group's page
// opens with the result; a refusal stays on the form with the emulator's code and message and every entry.

const ADDING = 'Adding';

const DIRECTION_ITEMS = [
  { value: 'inbound', label: 'Inbound' },
  { value: 'outbound', label: 'Outbound' },
];

const PROTOCOL_OPTIONS: SelectProps.Option[] = [
  { value: 'tcp', label: 'TCP' },
  { value: 'udp', label: 'UDP' },
  { value: 'icmp', label: 'ICMP' },
  { value: 'all', label: 'All' },
];

const PEER_ITEMS = [
  { value: 'ipv4', label: 'IPv4 range' },
  { value: 'ipv6', label: 'IPv6 range' },
  { value: 'group', label: 'Security group' },
];

const CIDR_PLACEHOLDER: Record<'ipv4' | 'ipv6', string> = { ipv4: '10.0.0.0/16', ipv6: '2001:db8::/32' };

type Direction = 'inbound' | 'outbound';

interface RuleFormState {
  direction: Direction;
  protocol: RuleProtocol;
  firstPort: string;
  lastPort: string;
  peerKind: PeerKind;
  cidr: string;
  group: GroupChoice | undefined;
  description: string;
}

const START: RuleFormState = {
  direction: 'inbound',
  protocol: 'tcp',
  firstPort: '',
  lastPort: '',
  peerKind: 'ipv4',
  cidr: '',
  group: undefined,
  description: '',
};

/** Whether the form differs from how it opened (`aws-area.md`, entry 5). */
function differs(form: RuleFormState): boolean {
  return (Object.keys(START) as (keyof RuleFormState)[]).some((key) => form[key] !== START[key]);
}

function messagesOf(form: RuleFormState): RuleFormMessages {
  return ruleFormMessages({
    protocol: form.protocol,
    firstPort: form.firstPort,
    lastPort: form.lastPort,
    peerKind: form.peerKind,
    cidr: form.cidr,
    groupChosen: form.group !== undefined,
    description: form.description,
  });
}

/** What the authorize is sent for a form that passed its checks. */
function ruleOf(form: RuleFormState): NewRule {
  const peer =
    form.peerKind === 'group'
      ? { kind: 'group' as const, value: form.group?.id ?? '' }
      : { kind: form.peerKind, value: form.cidr.trim() };
  const rule: NewRule = { egress: form.direction === 'outbound', protocol: form.protocol, peer };
  if (hasPorts(form.protocol)) {
    const from = portOf(form.firstPort);
    const to = portOf(form.lastPort);
    if (from !== undefined) rule.fromPort = from;
    if (to !== undefined) rule.toPort = to;
  }
  if (form.description !== '') {
    rule.description = form.description;
  }
  return rule;
}

/** "Security group not found", with Cloudscape's empty-state pattern, in the place of the form. */
function NotFound() {
  const handleFollow = useFollow();
  return (
    <Container>
      <Box textAlign="center" color="inherit">
        <SpaceBetween size="xxs">
          <Box variant="strong" color="inherit">
            Security group not found
          </Box>
          <Box variant="p" color="inherit">
            The emulator holds no security group with this ID.
          </Box>
          <Link href={SECURITY_GROUPS_PATH} onFollow={handleFollow}>
            View security groups
          </Link>
        </SpaceBetween>
      </Box>
    </Container>
  );
}

interface RuleFormProps extends Pick<ScreenPageProps, 'connection'> {
  group: SecurityGroup;
}

/** The form of a rule for `group`, a group the emulator holds. */
function RuleForm({ group, connection }: RuleFormProps) {
  const navigate = useNavigate();
  const flash = usePageFlash();
  const engineOrigin = connection.engineOrigin;
  const add = useAddRule(engineOrigin);
  const groupName = group.name === '' ? group.id : group.name;
  const groupPath = securityGroupHref(group.id);

  const [form, setForm] = useState<RuleFormState>(START);
  const [tried, setTried] = useState(false);
  const [failure, setFailure] = useState<FlashItem>();
  const [pending, setPending] = useState(false);

  const firstPortRef = useRef<InputProps.Ref>(null);
  const lastPortRef = useRef<InputProps.Ref>(null);
  const cidrRef = useRef<InputProps.Ref>(null);
  const groupRef = useRef<SelectProps.Ref>(null);
  const descriptionRef = useRef<InputProps.Ref>(null);
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

  const change = useCallback((update: Partial<RuleFormState>) => {
    setForm((current) => ({ ...current, ...update }));
  }, []);

  const messages = tried ? messagesOf(form) : {};
  const outbound = form.direction === 'outbound';
  const operation = authorizeOperation(outbound);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy.current) {
      return;
    }
    setTried(true);
    setFailure(undefined);
    const found = messagesOf(form);
    const first = (
      [
        [found.firstPort, firstPortRef],
        [found.lastPort, lastPortRef],
        [found.cidr, cidrRef],
        [found.group, groupRef],
        [found.description, descriptionRef],
      ] as const
    ).find(([message]) => message !== undefined);
    if (first !== undefined) {
      first[1].current?.focus();
      return;
    }
    const direction = outbound ? 'outbound' : 'inbound';
    const what = `Adding an ${direction} rule to ${groupName}`;
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
      await add(group.id, ruleOf(form), controller.signal);
      if (controller.signal.aborted) {
        return;
      }
      settle();
      flash.handOver(groupPath, [{ type: 'success', content: `Added an ${direction} rule to ${groupName}` }]);
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
    if (differs(form)) {
      setAsking(true);
      return;
    }
    void navigate(groupPath);
  };
  const handleDiscardAnswer = useCallback(
    (answer: DiscardAnswer) => {
      setAsking(false);
      if (answer === 'discard') {
        void navigate(groupPath);
      } else {
        setKept((count) => count + 1);
      }
    },
    [navigate, groupPath],
  );

  const peerLabel = outbound ? 'Destination' : 'Source';
  const protocolOption = PROTOCOL_OPTIONS.find((option) => option.value === form.protocol) ?? null;

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
                {pending ? ADDING : ADD_RULE_TITLE}
              </Button>
            </SpaceBetween>
          }
        >
          <SpaceBetween size="l">
            <Container header={<Header variant="h2">Rule</Header>}>
              <SpaceBetween size="l">
                <FormField label="Direction">
                  <RadioGroup
                    value={form.direction}
                    items={DIRECTION_ITEMS}
                    onChange={({ detail }) => {
                      change({ direction: detail.value as Direction });
                    }}
                  />
                </FormField>
                <FormField label="Protocol">
                  <Select
                    selectedOption={protocolOption}
                    options={PROTOCOL_OPTIONS}
                    onChange={({ detail }) => {
                      change({ protocol: detail.selectedOption.value as RuleProtocol });
                    }}
                  />
                </FormField>
                {hasPorts(form.protocol) && (
                  <>
                    <FormField label="First port" constraintText={FIRST_PORT_RULE} errorText={messages.firstPort}>
                      <Input
                        ref={firstPortRef}
                        value={form.firstPort}
                        inputMode="numeric"
                        invalid={messages.firstPort !== undefined}
                        autoComplete={false}
                        onChange={({ detail }) => {
                          change({ firstPort: detail.value });
                        }}
                      />
                    </FormField>
                    <FormField
                      label="Last port - optional"
                      constraintText={LAST_PORT_RULE}
                      errorText={messages.lastPort}
                    >
                      <Input
                        ref={lastPortRef}
                        value={form.lastPort}
                        inputMode="numeric"
                        invalid={messages.lastPort !== undefined}
                        autoComplete={false}
                        onChange={({ detail }) => {
                          change({ lastPort: detail.value });
                        }}
                      />
                    </FormField>
                  </>
                )}
              </SpaceBetween>
            </Container>

            <Container header={<Header variant="h2">{peerLabel}</Header>}>
              <SpaceBetween size="l">
                <FormField label={peerLabel}>
                  <RadioGroup
                    value={form.peerKind}
                    items={PEER_ITEMS}
                    onChange={({ detail }) => {
                      change({ peerKind: detail.value as PeerKind });
                    }}
                  />
                </FormField>
                {form.peerKind === 'group' ? (
                  <FormField label="Security group" errorText={messages.group}>
                    <ChoiceSelect<GroupChoice>
                      selectRef={groupRef}
                      source={groupChoices(engineOrigin, group.vpcId)}
                      connection={connection}
                      things="security groups"
                      placeholder="Choose a security group"
                      invalid={messages.group !== undefined}
                      value={form.group}
                      onChange={(chosen) => {
                        change({ group: chosen });
                      }}
                    />
                  </FormField>
                ) : (
                  <FormField label="CIDR block" errorText={messages.cidr}>
                    <Input
                      ref={cidrRef}
                      value={form.cidr}
                      placeholder={CIDR_PLACEHOLDER[form.peerKind]}
                      invalid={messages.cidr !== undefined}
                      autoComplete={false}
                      spellcheck={false}
                      onChange={({ detail }) => {
                        change({ cidr: detail.value });
                      }}
                    />
                  </FormField>
                )}
                <FormField
                  label="Description - optional"
                  constraintText={RULE_DESCRIPTION_RULE}
                  errorText={messages.description}
                  stretch
                >
                  <Input
                    ref={descriptionRef}
                    value={form.description}
                    invalid={messages.description !== undefined}
                    autoComplete={false}
                    onChange={({ detail }) => {
                      change({ description: detail.value });
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
    </>
  );
}

/**
 * `/aws/ec2/security-groups/group/{id}/add-rule`. The group `id` is read on opening; once it is held, the form. A
 * failed read is read again once the connection is connected again.
 */
export function AddRulePage({ connection, params }: ScreenPageProps) {
  useShowsResources(SECURITY_GROUPS_WORD);
  const id = params['id'] ?? '';
  const reading = useSecurityGroup(connection.engineOrigin, id);
  const { value: read, failure, refresh } = reading;
  const group = read?.found === true ? read.group : undefined;

  // Kept from the previous render, as React's own pattern for it, so a return of the connection is acted on once.
  const connected = connection.result?.kind === 'connected';
  const [seenConnected, setSeenConnected] = useState(connected);
  if (connected !== seenConnected) {
    setSeenConnected(connected);
    if (connected && failure !== undefined) {
      refresh();
    }
  }

  let content;
  if (failure !== undefined) {
    content = (
      <Container>
        <ReadFailure state={readFailureState(failure, connection, 'security group')} onRetry={refresh} />
      </Container>
    );
  } else if (read === undefined) {
    content = (
      <Container>
        <Box textAlign="center" color="inherit">
          <StatusIndicator type="loading">Loading security group</StatusIndicator>
        </Box>
      </Container>
    );
  } else if (group === undefined) {
    content = <NotFound />;
  } else {
    content = <RuleForm group={group} connection={connection} />;
  }

  const description =
    group === undefined ? undefined : `Adds a rule to ${group.name === '' ? group.id : group.name}.`;

  return (
    <SpaceBetween size="l">
      <Header variant="h1" description={description}>
        {ADD_RULE_TITLE}
      </Header>
      {content}
    </SpaceBetween>
  );
}
