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
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router';

import type { RequestFailure } from '../../../../../../lib/aws/request';
import { DiscardDialog, type DiscardAnswer } from '../../../components/discard-dialog';
import type { AreaConnection } from '../../../components/emulator-line';
import { actionFailureItem, CodeAndMessage, ReadFailure, readFailureState } from '../../../components/failure-states';
import { usePageFlash } from '../../../components/page-flash';
import { useShowsResources } from '../../../components/page-resources';
import { useFollow } from '../../../components/use-follow';
import { failureOf, usePageSignal } from '../../../components/use-token-listing';
import type { ScreenPageProps } from '../../../screens';
import { CreateServiceChoice, useCreateServiceChoices } from '../components/create-service-choices';
import { NotFound } from '../components/not-found';
import { CREATE_SERVICE_OPERATION } from '../create-service-api';
import { fargateRevisionChoices } from '../create-service-choices';
import {
  CREATE_SERVICE_START,
  createServiceDiffers,
  createServiceMessages,
  createServiceRequestOf,
  type CreateServiceField,
} from '../create-service-form';
import { useCreateService } from '../create-service-queries';
import { familyChoices } from '../definition-choices';
import {
  CLUSTERS_PATH,
  CLUSTERS_TITLE,
  CREATE_SERVICE_TITLE,
  SERVICES_AND_TASKS_WORD,
  clusterHref,
  registerHref,
  serviceHref,
} from '../format';
import { useCluster } from '../queries';
import { vpcOf } from '../run-form';
import { runGroupChoices, runSubnetChoices } from '../run-queries';
import { COUNT_RULE } from '../update-form';

const CREATING = 'Creating service';

function ClusterReadFailure({
  connection,
  failure,
  retry,
}: {
  connection: AreaConnection;
  failure: RequestFailure;
  retry: () => void;
}) {
  const status = readFailureState(failure, connection, 'cluster');
  if (failure.kind === 'not-implemented') {
    return (
      <Box textAlign="center">
        <SpaceBetween size="xs">
          <StatusIndicator type={status.type}>{status.first}</StatusIndicator>
          <Box>{status.detail}</Box>
          <Button disabled>Retry</Button>
        </SpaceBetween>
      </Box>
    );
  }
  const diagnostic = readFailureState(failure, { ...connection, result: undefined }, 'cluster');
  const disconnected =
    status.recovery && (failure.kind === 'emulator-did-not-answer' || failure.kind === 'engine-did-not-answer');
  return (
    <ReadFailure
      state={
        disconnected
          ? {
              ...status,
              detail: (
                <>
                  {diagnostic.first}
                  {diagnostic.detail && <>. {diagnostic.detail}</>}
                </>
              ),
            }
          : status
      }
      onRetry={retry}
    />
  );
}

export function CreateServicePage({ connection, params }: ScreenPageProps) {
  useShowsResources(SERVICES_AND_TASKS_WORD);
  const cluster = params.cluster ?? '';
  const read = useCluster(connection.engineOrigin, cluster);

  let content: ReactNode;
  if (read.failure !== undefined) {
    content = <ClusterReadFailure connection={connection} failure={read.failure} retry={read.refresh} />;
  } else if (read.value === undefined) {
    content = <StatusIndicator type="loading">Loading cluster</StatusIndicator>;
  } else if (!read.value.found) {
    content = (
      <NotFound
        heading={`No cluster named ${cluster}`}
        statement="The local emulator has no active cluster of this name."
        link={{ text: CLUSTERS_TITLE, href: CLUSTERS_PATH }}
      />
    );
  } else {
    content = <CreateServiceForm cluster={cluster} connection={connection} />;
  }

  return (
    <SpaceBetween size="l">
      <Header variant="h1" description={`Cluster ${cluster} · Launch type Fargate`}>
        {CREATE_SERVICE_TITLE}
      </Header>
      {content}
    </SpaceBetween>
  );
}

function CreateServiceForm({ cluster, connection }: { cluster: string; connection: AreaConnection }) {
  const navigate = useNavigate();
  const flash = usePageFlash();
  const follow = useFollow();
  const pageSignal = usePageSignal();
  const endpoint = connection.engineOrigin;
  const create = useCreateService(endpoint);
  const returnTo = clusterHref(cluster);

  const [held, setForm] = useState(CREATE_SERVICE_START);
  const [tried, setTried] = useState(false);
  const [failure, setFailure] = useState<RequestFailure>();
  const [pending, setPending] = useState(false);
  const [asking, setAsking] = useState(false);
  const [kept, setKept] = useState(0);

  const busy = useRef(false);
  const nameRef = useRef<InputProps.Ref>(null);
  const familyRef = useRef<SelectProps.Ref>(null);
  const revisionRef = useRef<SelectProps.Ref>(null);
  const countRef = useRef<InputProps.Ref>(null);
  const subnetsRef = useRef<MultiselectProps.Ref>(null);
  const cancelRef = useRef<ButtonProps.Ref>(null);
  const failureRef = useRef<AlertProps.Ref>(null);
  const fields: Record<CreateServiceField, typeof nameRef | typeof familyRef | typeof subnetsRef> = {
    name: nameRef,
    family: familyRef,
    revision: revisionRef,
    count: countRef,
    subnets: subnetsRef,
  };

  const families = familyChoices(endpoint);
  const revisions = fargateRevisionChoices(endpoint, held.family);
  const vpc = vpcOf(held);
  const subnets = runSubnetChoices(endpoint, vpc);
  const groups = runGroupChoices(endpoint, vpc);

  const familyList = useCreateServiceChoices(families);
  const revisionList = useCreateServiceChoices(revisions);
  const subnetList = useCreateServiceChoices(subnets);
  const groupList = useCreateServiceChoices(groups);
  const form = { ...held, revision: held.revision ?? revisionList.choices?.[0] };
  const errors = tried ? createServiceMessages(form) : {};
  const unsupported = failure?.kind === 'not-implemented';

  useEffect(() => {
    if (failure !== undefined) {
      failureRef.current?.focus();
    }
  }, [failure]);
  useEffect(() => {
    if (kept > 0) {
      cancelRef.current?.focus();
    }
  }, [kept]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy.current || unsupported) {
      return;
    }
    setTried(true);
    setFailure(undefined);
    const request = createServiceRequestOf(cluster, form);
    if (request === undefined) {
      const messages = createServiceMessages(form);
      const first = (Object.keys(fields) as CreateServiceField[]).find((field) => messages[field] !== undefined);
      if (first !== undefined) {
        fields[first].current?.focus();
      }
      return;
    }

    busy.current = true;
    setPending(true);
    const signal = pageSignal();
    try {
      const name = await create(request, signal);
      if (!signal.aborted) {
        flash.handOver(serviceHref(cluster, name), [{ type: 'success', content: `Service ${name} created.` }]);
      }
    } catch (error) {
      if (!signal.aborted) {
        setFailure(failureOf(error, CREATE_SERVICE_OPERATION));
      }
    } finally {
      if (!signal.aborted) {
        busy.current = false;
        setPending(false);
      }
    }
  };

  const handleCancel = () => {
    if (createServiceDiffers(form)) {
      setAsking(true);
    } else {
      void navigate(returnTo);
    }
  };
  const handleDiscard = (answer: DiscardAnswer) => {
    setAsking(false);
    if (answer === 'discard') {
      void navigate(returnTo);
    } else {
      setKept((count) => count + 1);
    }
  };

  const notice =
    failure === undefined
      ? undefined
      : failure.kind === 'other'
        ? {
            type: 'error' as const,
            header: 'The emulator did not create the service.',
            content: <CodeAndMessage code={failure.code} message={failure.message} />,
          }
        : actionFailureItem(failure, CREATING, endpoint);

  return (
    <>
      <form onSubmit={(event) => void handleSubmit(event)} noValidate>
        <Form
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button ref={cancelRef} variant="link" formAction="none" disabled={pending} onClick={handleCancel}>
                Cancel
              </Button>
              <Button variant="primary" disabled={unsupported} loading={pending} loadingText={CREATING}>
                {pending ? CREATING : CREATE_SERVICE_TITLE}
              </Button>
            </SpaceBetween>
          }
        >
          <SpaceBetween size="l">
            {notice !== undefined && (
              <Alert ref={failureRef} type={notice.type} header={notice.header}>
                {notice.content}
              </Alert>
            )}
            <Container header={<Header variant="h2">Service configuration</Header>}>
              <SpaceBetween size="l">
                <FormField label="Service name" errorText={errors.name}>
                  <Input
                    ref={nameRef}
                    value={form.name}
                    autoComplete={false}
                    spellcheck={false}
                    onChange={({ detail }) => setForm((current) => ({ ...current, name: detail.value }))}
                  />
                </FormField>
                <CreateServiceChoice
                  label="Task definition family"
                  source={families}
                  listing={familyList}
                  connection={connection}
                  inputRef={familyRef}
                  value={form.family}
                  placeholder="Choose a family"
                  error={errors.family}
                  empty={
                    <>
                      No task definitions.{' '}
                      <Link href={registerHref()} onFollow={follow}>
                        Register one first.
                      </Link>
                    </>
                  }
                  onChange={(family) =>
                    setForm((current) =>
                      current.family === family ? current : { ...current, family, revision: undefined },
                    )
                  }
                />
                <CreateServiceChoice
                  label="Revision"
                  source={revisions}
                  listing={revisionList}
                  connection={connection}
                  inputRef={revisionRef}
                  value={form.revision}
                  placeholder={form.family === undefined ? 'Choose a family first' : 'Choose a revision'}
                  error={errors.revision}
                  empty={
                    <>
                      This family has no active Fargate revisions.{' '}
                      <Link href={registerHref()} onFollow={follow}>
                        Register task definition
                      </Link>
                    </>
                  }
                  onChange={(revision) => setForm((current) => ({ ...current, revision }))}
                />
                <FormField label="Desired tasks" constraintText={COUNT_RULE} errorText={errors.count}>
                  <Input
                    ref={countRef}
                    type="number"
                    inputMode="numeric"
                    value={form.count}
                    onChange={({ detail }) => setForm((current) => ({ ...current, count: detail.value }))}
                  />
                </FormField>
              </SpaceBetween>
            </Container>
            <Container header={<Header variant="h2">Network</Header>}>
              <SpaceBetween size="l">
                <CreateServiceChoice
                  multiple
                  label="Subnets"
                  source={subnets}
                  listing={subnetList}
                  connection={connection}
                  value={form.subnets}
                  placeholder="Choose subnets"
                  inputRef={subnetsRef}
                  error={errors.subnets}
                  description="Choose one or more subnets in the same VPC."
                  empty="No subnets in the local emulator."
                  onChange={(chosen) =>
                    setForm((current) => ({
                      ...current,
                      subnets: chosen,
                      groups: chosen[0]?.vpcId === vpcOf(current) && chosen.length > 0 ? current.groups : [],
                    }))
                  }
                />
                <CreateServiceChoice
                  multiple
                  label="Security groups"
                  source={groups}
                  listing={groupList}
                  connection={connection}
                  value={form.groups}
                  description="Optional"
                  placeholder={vpc === undefined ? 'Choose a subnet first.' : 'Choose security groups'}
                  empty="No security groups in this VPC."
                  onChange={(chosen) => setForm((current) => ({ ...current, groups: chosen }))}
                />
                <Checkbox
                  checked={form.publicIp}
                  onChange={({ detail }) => setForm((current) => ({ ...current, publicIp: detail.checked }))}
                >
                  Assign public IP
                </Checkbox>
              </SpaceBetween>
            </Container>
          </SpaceBetween>
        </Form>
      </form>
      {asking && <DiscardDialog visible onAnswer={handleDiscard} />}
    </>
  );
}
