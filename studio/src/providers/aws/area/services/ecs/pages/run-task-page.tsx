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
import type { MultiselectProps } from '@cloudscape-design/components/multiselect';
import type { SelectProps } from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router';

import { ChoiceMultiselect } from '../../../components/choice-multiselect';
import { ChoiceSelect } from '../../../components/choice-select';
import { DiscardDialog, type DiscardAnswer } from '../../../components/discard-dialog';
import type { AreaConnection } from '../../../components/emulator-line';
import { actionFailureItem, CodeAndMessage, ReadFailure, readFailureState } from '../../../components/failure-states';
import type { GroupChoice, SubnetChoice } from '../../../components/network-choices';
import { usePageFlash, type FlashItem } from '../../../components/page-flash';
import { useShowsResources } from '../../../components/page-resources';
import { useFollow } from '../../../components/use-follow';
import { failureOf } from '../../../components/use-token-listing';
import type { ScreenPageProps } from '../../../screens';
import { NotFound } from '../components/not-found';
import { familyChoices, revisionChoices, type RevisionChoice } from '../definition-choices';
import {
  clusterHref,
  CLUSTERS_PATH,
  CLUSTERS_TITLE,
  registerHref,
  RUN_TASK_TITLE,
  SERVICES_AND_TASKS_WORD,
  taskHref,
} from '../format';
import { useCluster } from '../queries';
import { RUN_OPERATION, type RunOutcome } from '../run-api';
import {
  COUNT_RULE,
  RUN_FORM_START,
  runFormDiffers,
  runFormMessages,
  runRequestOf,
  vpcOf,
  withFamily,
  withNewest,
  withSubnets,
  type RunFormState,
} from '../run-form';
import { runGroupChoices, runSubnetChoices, useHasChoices, useNewestRevision, useRunTask } from '../run-queries';

// S6, "Run task" (issue 575, requirement S6; design task 2): one form of a cluster, behind the cluster's gate. A
// family and its revision, preset to the newest; the number of tasks; the subnets, then only their VPC's, and that
// VPC's security groups; the public IP, on at the start, since the emulator ends a task without one. `run-form.ts`
// checks the form before anything is sent; then one `RunTask` on Fargate. One task started opens its page, more the
// cluster's, each with the result; a refusal stays on the form with the emulator's code and message and every value.

const RUNNING = 'Running task';
const NOT_RUN = 'The emulator did not run the task.';
const PUBLIC_IP_DESCRIPTION =
  "Without a public IP the emulator ends the task before it starts, as a task that cannot reach its image's registry.";

/** Each failure's reason, as text. */
function reasonsOf(failures: readonly string[]): ReactNode {
  return failures.length === 0 ? undefined : (
    <SpaceBetween size="xxs">
      {failures.map((reason, index) => (
        <Box key={index}>{reason}</Box>
      ))}
    </SpaceBetween>
  );
}

/** `/aws/ecs/clusters/cluster/{cluster}/tasks/run`: the cluster's gate, then the form. */
export function RunTaskPage({ connection, params }: ScreenPageProps) {
  useShowsResources(SERVICES_AND_TASKS_WORD);
  const cluster = params.cluster ?? '';
  const read = useCluster(connection.engineOrigin, cluster);

  let body: ReactNode;
  if (read.failure !== undefined) {
    body = <ReadFailure state={readFailureState(read.failure, connection, 'cluster')} onRetry={read.refresh} />;
  } else if (read.value === undefined) {
    body = <StatusIndicator type="loading">Loading cluster</StatusIndicator>;
  } else if (!read.value.found) {
    body = (
      <NotFound
        heading={`No cluster named ${cluster}`}
        statement="The local emulator has no active cluster of this name."
        link={{ text: CLUSTERS_TITLE, href: CLUSTERS_PATH }}
      />
    );
  } else {
    body = <RunTaskForm connection={connection} cluster={cluster} />;
  }

  return (
    <SpaceBetween size="l">
      <Header variant="h1" description={`Runs a task of a task definition in cluster ${cluster}, on Fargate.`}>
        {RUN_TASK_TITLE}
      </Header>
      {body}
    </SpaceBetween>
  );
}

interface RunTaskFormProps {
  connection: AreaConnection;
  cluster: string;
}

function RunTaskForm({ connection, cluster }: RunTaskFormProps) {
  const navigate = useNavigate();
  const flash = usePageFlash();
  const handleFollow = useFollow();
  const engineOrigin = connection.engineOrigin;
  const run = useRunTask(engineOrigin);

  const [held, setForm] = useState<RunFormState>(RUN_FORM_START);
  const [tried, setTried] = useState(false);
  const [failure, setFailure] = useState<FlashItem>();
  const [pending, setPending] = useState(false);

  const families = familyChoices(engineOrigin);
  const hasFamilies = useHasChoices(families);
  const hasSubnets = useHasChoices(runSubnetChoices(engineOrigin, undefined));
  // Once the chosen family's newest revision is read, the revision is preset to it while none is chosen.
  const newest = useNewestRevision(engineOrigin, held.family);
  const form = newest === undefined ? held : withNewest(held, newest);
  const vpcId = vpcOf(form);

  const familyRef = useRef<SelectProps.Ref>(null);
  const revisionRef = useRef<SelectProps.Ref>(null);
  const countRef = useRef<InputProps.Ref>(null);
  const subnetsRef = useRef<MultiselectProps.Ref>(null);
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

  const messages = tried ? runFormMessages(form) : {};

  const settle = (outcome: RunOutcome, asked: number) => {
    const started = outcome.taskIds;
    if (started.length === 0) {
      setFailure({ type: 'error', header: NOT_RUN, content: reasonsOf(outcome.failures) });
      return;
    }
    if (started.length >= asked) {
      const [only] = started;
      if (asked === 1 && only !== undefined) {
        flash.handOver(taskHref(cluster, only), [{ type: 'success', content: `Task ${only} started.` }]);
      } else {
        flash.handOver(clusterHref(cluster), [
          { type: 'success', content: `${String(started.length)} tasks started.` },
        ]);
      }
      return;
    }
    flash.handOver(clusterHref(cluster), [
      {
        type: 'warning',
        header: `${String(started.length)} of ${String(asked)} tasks started.`,
        content: reasonsOf(outcome.failures),
      },
    ]);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy.current) {
      return;
    }
    setTried(true);
    setFailure(undefined);
    const found = runFormMessages(form);
    if (found.family !== undefined) {
      familyRef.current?.focus();
      return;
    }
    if (found.revision !== undefined) {
      revisionRef.current?.focus();
      return;
    }
    if (found.count !== undefined) {
      countRef.current?.focus();
      return;
    }
    const request = runRequestOf(cluster, form);
    if (found.subnets !== undefined || request === undefined) {
      subnetsRef.current?.focus();
      return;
    }
    if (engineOrigin === undefined) {
      setFailure(actionFailureItem({ kind: 'engine-did-not-answer', operation: RUN_OPERATION }, RUNNING, undefined));
      return;
    }
    busy.current = true;
    setPending(true);
    const controller = new AbortController();
    inFlight.current = controller;
    const done = () => {
      inFlight.current = null;
      busy.current = false;
      setPending(false);
    };
    try {
      const outcome = await run(request, controller.signal);
      if (controller.signal.aborted) {
        return;
      }
      done();
      settle(outcome, request.count);
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }
      done();
      const refused = failureOf(error, RUN_OPERATION);
      setFailure(
        refused.kind === 'other'
          ? {
              type: 'error',
              header: NOT_RUN,
              content: <CodeAndMessage code={refused.code} message={refused.message} />,
            }
          : actionFailureItem(refused, RUNNING, engineOrigin),
      );
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
    if (runFormDiffers(form)) {
      setAsking(true);
      return;
    }
    void navigate(clusterHref(cluster));
  };
  const handleDiscardAnswer = useCallback(
    (answer: DiscardAnswer) => {
      setAsking(false);
      if (answer === 'discard') {
        void navigate(clusterHref(cluster));
      } else {
        setKept((count) => count + 1);
      }
    },
    [navigate, cluster],
  );

  return (
    <>
      <form onSubmit={(event) => void handleSubmit(event)} noValidate>
        <Form
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button ref={cancelRef} variant="link" formAction="none" disabled={pending} onClick={handleCancel}>
                Cancel
              </Button>
              <Button variant="primary" loading={pending} loadingText={RUNNING}>
                {RUN_TASK_TITLE}
              </Button>
            </SpaceBetween>
          }
        >
          <SpaceBetween size="l">
            {failure !== undefined && (
              <Alert ref={failureRef} type={failure.type} header={failure.header}>
                {failure.content}
              </Alert>
            )}

            <Container header={<Header variant="h2">Task definition</Header>}>
              <SpaceBetween size="l">
                <FormField label="Task definition family" errorText={messages.family}>
                  {hasFamilies === false ? (
                    <Box>
                      No task definitions.{' '}
                      <Link href={registerHref()} onFollow={handleFollow}>
                        Register one first.
                      </Link>
                    </Box>
                  ) : (
                    <ChoiceSelect<string>
                      selectRef={familyRef}
                      source={families}
                      connection={connection}
                      things="task definition families"
                      placeholder="Choose a family"
                      invalid={messages.family !== undefined}
                      value={form.family}
                      onChange={(family) => {
                        if (family !== undefined && family !== form.family) {
                          setForm((current) => withFamily(current, family, undefined));
                        }
                      }}
                    />
                  )}
                </FormField>
                <FormField label="Revision" errorText={messages.revision}>
                  <ChoiceSelect<RevisionChoice>
                    selectRef={revisionRef}
                    source={revisionChoices(engineOrigin, form.family)}
                    connection={connection}
                    things="revisions"
                    placeholder={form.family === undefined ? 'Choose a family first' : 'Choose a revision'}
                    invalid={messages.revision !== undefined}
                    value={form.revision}
                    onChange={(revision) => {
                      setForm((current) => ({ ...current, revision }));
                    }}
                  />
                </FormField>
                <FormField label="Number of tasks" constraintText={COUNT_RULE} errorText={messages.count}>
                  <Input
                    ref={countRef}
                    type="number"
                    inputMode="numeric"
                    value={form.count}
                    invalid={messages.count !== undefined}
                    onChange={({ detail }) => {
                      setForm((current) => ({ ...current, count: detail.value }));
                    }}
                  />
                </FormField>
              </SpaceBetween>
            </Container>

            <Container header={<Header variant="h2">Network</Header>}>
              <SpaceBetween size="l">
                <FormField
                  label="Subnets"
                  description="After the first, only the subnets of its VPC are offered."
                  errorText={messages.subnets}
                >
                  {hasSubnets === false ? (
                    <Box>No subnets in the local emulator.</Box>
                  ) : (
                    <ChoiceMultiselect<SubnetChoice>
                      multiselectRef={subnetsRef}
                      source={runSubnetChoices(engineOrigin, vpcId)}
                      connection={connection}
                      things="subnets"
                      placeholder="Choose subnets"
                      invalid={messages.subnets !== undefined}
                      value={form.subnets}
                      onChange={(subnets) => {
                        setForm((current) => withSubnets(current, subnets));
                      }}
                    />
                  )}
                </FormField>
                <FormField label="Security groups - optional">
                  {vpcId === undefined ? (
                    <Box color="text-status-inactive">Choose a subnet first.</Box>
                  ) : (
                    <ChoiceMultiselect<GroupChoice>
                      source={runGroupChoices(engineOrigin, vpcId)}
                      connection={connection}
                      things="security groups"
                      placeholder="Choose security groups"
                      value={form.groups}
                      onChange={(groups) => {
                        setForm((current) => ({ ...current, groups }));
                      }}
                    />
                  )}
                </FormField>
                <FormField label="Public IP">
                  <Checkbox
                    checked={form.publicIp}
                    description={PUBLIC_IP_DESCRIPTION}
                    onChange={({ detail }) => {
                      setForm((current) => ({ ...current, publicIp: detail.checked }));
                    }}
                  >
                    Assign a public IP
                  </Checkbox>
                </FormField>
              </SpaceBetween>
            </Container>
          </SpaceBetween>
        </Form>
      </form>
      {/* Mounted only while it asks, so nothing of it is in the page before "Cancel" is pressed. */}
      {asking && <DiscardDialog visible onAnswer={handleDiscardAnswer} />}
    </>
  );
}
