import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Form from '@cloudscape-design/components/form';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import Input, { type InputProps } from '@cloudscape-design/components/input';
import RadioGroup from '@cloudscape-design/components/radio-group';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Textarea, { type TextareaProps } from '@cloudscape-design/components/textarea';
import { useId, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';

import type { RequestFailure } from '../../../../../../lib/aws/request';
import { DiscardDialog } from '../../../components/discard-dialog';
import { actionFailureItem, Code } from '../../../components/failure-states';
import { usePageFlash } from '../../../components/page-flash';
import { useShowsResources } from '../../../components/page-resources';
import { failureOf, usePageSignal } from '../../../components/use-token-listing';
import { ValueText } from '../../../components/value-text';
import type { ScreenPageProps } from '../../../screens';
import { BusSelect } from '../components/bus-select';
import { TargetFields, type TargetFieldsRef } from '../components/target-fields';
import { rulePath, rulesPath } from '../format';
import { RULE_OPERATIONS } from '../rule-api';
import { createRule, PUT_RULE, ruleNameTaken } from '../rule-create-api';
import {
  chooseRuleBus,
  createRuleInput,
  CREATE_RULE_TITLE,
  EVENT_PATTERN_RULE,
  INITIAL_RULE_FORM,
  RATE_NUMBER_RULE,
  rateExpression,
  RULE_DESCRIPTION_RULE,
  RULE_NAME_RULE,
  validateRule,
  type RateUnit,
  type RuleField,
  type RuleForm,
} from '../rule-form';
import { putRuleTargets, PUT_TARGETS } from '../target-api';
import {
  buildTarget,
  emptyTarget,
  MAX_TARGETS,
  TARGET_LIMIT_TEXT,
  validateTarget,
  type TargetDraft,
  type TargetField,
} from '../target-form';
import { useBusChoice } from '../use-bus-choice';

const SCHEDULE_KINDS = [
  {
    value: 'rate',
    label: 'Fixed rate',
    description: 'Runs again each time the number of minutes, hours or days has passed.',
  },
  {
    value: 'cron',
    label: 'Cron expression',
    description: 'Runs at the times a cron expression of six fields names, such as cron(0 12 * * ? *).',
  },
];
const RATE_UNITS: ReadonlyArray<{ value: RateUnit; label: string }> = [
  { value: 'minute', label: 'Minutes' },
  { value: 'hour', label: 'Hours' },
  { value: 'day', label: 'Days' },
];
const STATES = [
  {
    value: 'ENABLED',
    label: 'Enabled',
    description:
      "Matching events are routed to the rule's targets. A target receives them only if it allows EventBridge to deliver.",
  },
  { value: 'DISABLED', label: 'Disabled', description: 'The rule is kept and routes nothing until it is enabled.' },
];

interface TargetRow {
  key: number;
  draft: TargetDraft;
}

function writeFailure(failure: RequestFailure, endpoint: string | undefined) {
  const item = actionFailureItem(failure, failure.operation, endpoint);
  if (failure.kind === 'engine-did-not-answer' || failure.kind === 'emulator-did-not-answer') {
    return {
      ...item,
      content: (
        <>
          {failure.operation} failed. {item.content}
        </>
      ),
    };
  }
  return item;
}

export function CreateRulePage({ connection }: ScreenPageProps) {
  useShowsResources('rules');
  const { engineOrigin } = connection;
  const navigate = useNavigate();
  const flash = usePageFlash();
  const pageSignal = usePageSignal();
  const submitId = useId();
  const [search] = useSearchParams();
  const addressBus = search.get('bus');
  const [selectedBus, setSelectedBus] = useState<string>();
  const choice = useBusChoice(engineOrigin, selectedBus ?? addressBus, selectedBus);
  const bus = choice.kind === 'chosen' ? choice.name : undefined;
  const [form, setForm] = useState(INITIAL_RULE_FORM);
  const [rows, setRows] = useState<TargetRow[]>([]);
  const [tried, setTried] = useState(false);
  const [pending, setPending] = useState(false);
  const [duplicateName, setDuplicateName] = useState(false);
  const [failure, setFailure] = useState<RequestFailure>();
  const [askDiscard, setAskDiscard] = useState(false);
  const inFlight = useRef(false);
  const nextRow = useRef(0);
  const targetToFocus = useRef<number>(null);
  const busField = useRef<HTMLDivElement>(null);
  const nameInput = useRef<InputProps.Ref>(null);
  const descriptionInput = useRef<TextareaProps.Ref>(null);
  const patternInput = useRef<TextareaProps.Ref>(null);
  const rateInput = useRef<InputProps.Ref>(null);
  const cronInput = useRef<InputProps.Ref>(null);
  const targetFields = useRef(new Map<number, TargetFieldsRef>());

  const errors = validateRule(form);
  const targetErrors = rows.map(({ key, draft }) =>
    validateTarget(draft, { duplicate: rows.some((row) => row.key !== key && row.draft.id === draft.id) }),
  );
  const limitReached = rows.length >= MAX_TARGETS;
  const unavailable = failure?.operation === PUT_RULE && failure.kind === 'not-implemented';
  const feedback = failure && writeFailure(failure, engineOrigin);
  const changed =
    (selectedBus !== undefined && selectedBus !== (addressBus ?? 'default')) ||
    rows.length > 0 ||
    (Object.keys(INITIAL_RULE_FORM) as (keyof RuleForm)[]).some((field) => form[field] !== INITIAL_RULE_FORM[field]);

  function change(patch: Partial<RuleForm>) {
    if (inFlight.current) return;
    if (patch.name !== undefined) setDuplicateName(false);
    setForm((current) => ({ ...current, ...patch }));
  }

  function leave() {
    void navigate(rulesPath(bus));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    // A Retry inside a choice can also submit the containing form.
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    if ((submitter && submitter.id !== submitId) || inFlight.current || unavailable || askDiscard) return;
    setTried(true);
    setFailure(undefined);
    if (bus === undefined) {
      busField.current?.querySelector('button')?.focus();
      return;
    }
    const [firstField] = Object.keys(errors) as RuleField[];
    if (firstField !== undefined) {
      const inputs = {
        name: nameInput,
        description: descriptionInput,
        pattern: patternInput,
        rate: rateInput,
        cron: cronInput,
      };
      inputs[firstField].current?.focus();
      return;
    }
    for (const [index, row] of rows.entries()) {
      const [first] = Object.keys(targetErrors[index] ?? {}) as TargetField[];
      if (first !== undefined) {
        targetFields.current.get(row.key)?.focus(first);
        return;
      }
    }
    const targets = rows.map(({ draft }) => buildTarget(draft));
    if (!targets.every((target) => target !== undefined)) return;
    if (engineOrigin === undefined) {
      setFailure({ kind: 'engine-did-not-answer', operation: RULE_OPERATIONS.describeRule });
      return;
    }

    const { name } = form;
    const signal = pageSignal();
    inFlight.current = true;
    setPending(true);
    setDuplicateName(false);
    let operation: string = RULE_OPERATIONS.describeRule;
    let leaving = false;
    const to = rulePath(bus, name);
    const ruleName = <ValueText kind="name" value={name} />;
    try {
      const taken = await ruleNameTaken(engineOrigin, bus, name, signal);
      if (signal.aborted) return;
      if (taken) {
        setDuplicateName(true);
        return;
      }
      operation = PUT_RULE;
      await createRule(engineOrigin, createRuleInput(form, bus), signal);
      if (signal.aborted) return;
      if (targets.length > 0) {
        operation = PUT_TARGETS;
        await putRuleTargets(engineOrigin, bus, name, targets, signal);
        if (signal.aborted) return;
      }
      leaving = true;
      flash.handOver(to, [{ type: 'success', content: <>Rule {ruleName} created.</> }]);
    } catch (error) {
      if (signal.aborted) return;
      const refusal = failureOf(error, operation);
      if (operation !== PUT_TARGETS) {
        setFailure(refusal);
        return;
      }
      const item = writeFailure(refusal, engineOrigin);
      leaving = true;
      flash.handOver(
        to,
        [
          {
            type: 'warning',
            content: (
              <>
                Rule {ruleName} created, but its targets were not added. {item.header}. {item.content}
              </>
            ),
          },
        ],
        refusal.kind === 'not-implemented' ? { notImplemented: PUT_TARGETS, bus, rule: name } : undefined,
      );
    } finally {
      if (!leaving && !signal.aborted) {
        inFlight.current = false;
        setPending(false);
      }
    }
  }

  return (
    <>
      <form onSubmit={(event) => void handleSubmit(event)} noValidate>
        <Form
          header={<Header variant="h1">{CREATE_RULE_TITLE}</Header>}
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button
                variant="link"
                formAction="none"
                disabled={pending}
                onClick={() => {
                  if (inFlight.current) return;
                  if (changed) setAskDiscard(true);
                  else leave();
                }}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                formAction="submit"
                loading={pending}
                disabled={unavailable}
                nativeButtonAttributes={{ id: submitId }}
              >
                {CREATE_RULE_TITLE}
              </Button>
            </SpaceBetween>
          }
        >
          <SpaceBetween size="l">
            <Container header={<Header variant="h2">Rule settings</Header>}>
              <SpaceBetween size="l">
                <div ref={busField} inert={pending}>
                  <BusSelect
                    connection={connection}
                    choice={choice}
                    onChange={(name) => {
                      if (inFlight.current || bus === name) return;
                      setSelectedBus(name);
                      setDuplicateName(false);
                      setForm((current) => chooseRuleBus(current, name));
                    }}
                  />
                </div>
                <FormField
                  label="Rule name"
                  constraintText={RULE_NAME_RULE}
                  errorText={
                    duplicateName ? (
                      <ValueText
                        kind="text"
                        value={`A rule named ${form.name} already exists on ${bus ?? ''}. Creating it again would replace it.`}
                      />
                    ) : (
                      tried && errors.name
                    )
                  }
                >
                  <Input
                    ref={nameInput}
                    ariaRequired
                    value={form.name}
                    readOnly={pending}
                    autoComplete={false}
                    spellcheck={false}
                    onChange={({ detail }) => change({ name: detail.value })}
                  />
                </FormField>
                <FormField
                  label="Description - optional"
                  constraintText={RULE_DESCRIPTION_RULE}
                  errorText={tried && errors.description}
                >
                  <Textarea
                    ref={descriptionInput}
                    value={form.description}
                    readOnly={pending}
                    onChange={({ detail }) => change({ description: detail.value })}
                  />
                </FormField>
                <FormField label="State">
                  <RadioGroup
                    value={form.state}
                    items={STATES}
                    readOnly={pending}
                    onChange={({ detail }) => change({ state: detail.value === 'DISABLED' ? 'DISABLED' : 'ENABLED' })}
                  />
                </FormField>
              </SpaceBetween>
            </Container>
            <Container header={<Header variant="h2">Trigger</Header>}>
              <SpaceBetween size="l">
                <FormField
                  label="What starts the rule"
                  description={
                    bus !== undefined && bus !== 'default' && 'Schedules are available only on the default event bus.'
                  }
                >
                  <RadioGroup
                    value={form.trigger}
                    readOnly={pending}
                    items={[
                      {
                        value: 'pattern',
                        label: 'Event pattern',
                        description: 'Runs for each event on the bus that matches the pattern.',
                      },
                      {
                        value: 'schedule',
                        label: 'Schedule',
                        description:
                          'Runs at a fixed rate or at the times of a cron expression. The emulator accepts a schedule only on the default event bus.',
                        disabled: bus !== 'default',
                      },
                    ]}
                    onChange={({ detail }) => change({ trigger: detail.value === 'schedule' ? 'schedule' : 'pattern' })}
                  />
                </FormField>
                {form.trigger === 'pattern' ? (
                  <FormField
                    label="Event pattern"
                    description={
                      <>
                        List the source values you want to match in an array, such as{' '}
                        <Code>{'{"source":["shop.checkout"]}'}</Code>.
                      </>
                    }
                    constraintText={EVENT_PATTERN_RULE}
                    errorText={tried && errors.pattern}
                  >
                    <Textarea
                      ref={patternInput}
                      ariaRequired
                      value={form.pattern}
                      readOnly={pending}
                      spellcheck={false}
                      rows={5}
                      onChange={({ detail }) => change({ pattern: detail.value })}
                    />
                  </FormField>
                ) : (
                  <>
                    <FormField label="Schedule type">
                      <RadioGroup
                        value={form.scheduleKind}
                        items={SCHEDULE_KINDS}
                        readOnly={pending}
                        onChange={({ detail }) => change({ scheduleKind: detail.value === 'cron' ? 'cron' : 'rate' })}
                      />
                    </FormField>
                    {form.scheduleKind === 'rate' ? (
                      <SpaceBetween size="m">
                        <FormField label="Rate" constraintText={RATE_NUMBER_RULE} errorText={tried && errors.rate}>
                          <Input
                            ref={rateInput}
                            ariaRequired
                            inputMode="numeric"
                            value={form.rate}
                            readOnly={pending}
                            onChange={({ detail }) => change({ rate: detail.value })}
                          />
                        </FormField>
                        <FormField label="Unit">
                          <RadioGroup
                            value={form.unit}
                            readOnly={pending}
                            items={RATE_UNITS.map((unit) => ({
                              ...unit,
                              ...(!errors.rate && { description: rateExpression(form.rate, unit.value) }),
                            }))}
                            onChange={({ detail }) => {
                              const unit = RATE_UNITS.find(({ value }) => value === detail.value);
                              if (unit) change({ unit: unit.value });
                            }}
                          />
                        </FormField>
                      </SpaceBetween>
                    ) : (
                      <FormField label="Cron expression" errorText={tried && errors.cron}>
                        <Input
                          ref={cronInput}
                          ariaRequired
                          value={form.cron}
                          readOnly={pending}
                          spellcheck={false}
                          onChange={({ detail }) => change({ cron: detail.value })}
                        />
                      </FormField>
                    )}
                  </>
                )}
              </SpaceBetween>
            </Container>
            <Container header={<Header variant="h2">Targets - optional</Header>}>
              <SpaceBetween size="l">
                {rows.map(({ key, draft }, index) => (
                  <SpaceBetween key={key} size="m" data-testid="create-rule-target-row">
                    <Header
                      variant="h3"
                      actions={
                        <Button
                          formAction="none"
                          disabled={pending}
                          ariaLabel={`Remove target ${index + 1}`}
                          onClick={() => setRows((current) => current.filter((row) => row.key !== key))}
                        >
                          Remove
                        </Button>
                      }
                    >
                      Target {index + 1}
                    </Header>
                    <TargetFields
                      ref={(fields) => {
                        if (fields === null) {
                          targetFields.current.delete(key);
                          return;
                        }
                        targetFields.current.set(key, fields);
                        if (targetToFocus.current === key) {
                          targetToFocus.current = null;
                          fields.focus('id');
                        }
                      }}
                      connection={connection}
                      draft={draft}
                      errors={tried ? targetErrors[index] : undefined}
                      disabled={pending}
                      onChange={(update) =>
                        setRows((current) =>
                          current.map((row) => (row.key === key ? { ...row, draft: update(row.draft) } : row)),
                        )
                      }
                    />
                  </SpaceBetween>
                ))}
                <Button
                  formAction="none"
                  disabled={pending || limitReached}
                  onClick={() => {
                    const row = { key: nextRow.current++, draft: emptyTarget() };
                    targetToFocus.current = row.key;
                    setRows((current) => (current.length < MAX_TARGETS ? [...current, row] : current));
                  }}
                >
                  Add target
                </Button>
                {limitReached && <Box color="text-body-secondary">{TARGET_LIMIT_TEXT}</Box>}
              </SpaceBetween>
            </Container>
            {feedback && (
              <div role="alert">
                <Alert type={feedback.type} header={feedback.header}>
                  {feedback.content}
                </Alert>
              </div>
            )}
          </SpaceBetween>
        </Form>
      </form>
      {askDiscard && (
        <DiscardDialog
          visible
          onAnswer={(answer) => {
            setAskDiscard(false);
            if (answer === 'discard') leave();
          }}
        />
      )}
    </>
  );
}
