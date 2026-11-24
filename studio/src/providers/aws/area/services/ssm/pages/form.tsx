import type { ParameterMetadata } from '@aws-sdk/client-ssm';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Form from '@cloudscape-design/components/form';
import Header from '@cloudscape-design/components/header';
import Link from '@cloudscape-design/components/link';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { flushSync } from 'react-dom';
import { useNavigate, useSearchParams } from 'react-router';

import type { RequestFailure } from '../../../../../../lib/aws/request';
import { targetOf } from '../../../../../../lib/engine/engine-client';
import { DiscardDialog } from '../../../components/discard-dialog';
import type { AreaConnection } from '../../../components/emulator-line';
import { actionFailureItem, ReadFailure, readFailureState } from '../../../components/failure-states';
import { usePageFlash } from '../../../components/page-flash';
import { useShowsResources } from '../../../components/page-resources';
import { useFollow } from '../../../components/use-follow';
import { failureOf } from '../../../components/use-token-listing';
import { ValueText } from '../../../components/value-text';
import { DESCRIBE_PARAMETERS, findParameter } from '../api';
import {
  createInput,
  editInput,
  initialDraft,
  policyObjects,
  type ParameterDraft,
} from '../components/form/parameter-draft';
import { ParameterFields, type ParameterErrors } from '../components/form/parameter-fields';
import { PUT_PARAMETER, putParameter } from '../form-api';
import { PARAMETER_STORE_PATH, parameterName, parameterPath } from '../paths';
import { useParameterMetadata, useRefreshParameterSave, useUnsupportedOperation } from '../queries';

function MissingParameter({ name }: { name: string }) {
  const follow = useFollow();
  return (
    <Container>
      <SpaceBetween size="xs">
        <Box variant="p">
          {name ? (
            <>
              Parameter <ValueText kind="name" value={name} /> was not found.
            </>
          ) : (
            'No parameter name was provided.'
          )}
        </Box>
        <Link href={PARAMETER_STORE_PATH} onFollow={follow}>
          Back to Parameter Store
        </Link>
      </SpaceBetween>
    </Container>
  );
}

function validate(draft: ParameterDraft) {
  const errors: ParameterErrors = {};
  let policies: string | undefined;
  if (draft.name.trim() === '') errors.name = 'Enter a parameter name.';
  if (draft.value === '') errors.value = 'Enter a parameter value.';
  if (draft.tier === 'Advanced' && draft.policies.trim() !== '') {
    try {
      policies = policyObjects(draft.policies);
    } catch {
      errors.policies = 'Enter a JSON array of policy objects.';
    }
  }
  return { errors, policies };
}

function ParameterForm({
  connection,
  name,
  metadata,
  awaitingMetadata = false,
}: {
  connection: AreaConnection;
  name: string;
  metadata?: ParameterMetadata | undefined;
  awaitingMetadata?: boolean;
}) {
  const editing = metadata !== undefined;
  const navigate = useNavigate();
  const flash = usePageFlash();
  const refresh = useRefreshParameterSave(connection);
  const writes = useUnsupportedOperation(connection, PUT_PARAMETER);
  const reads = useUnsupportedOperation(connection, DESCRIBE_PARAMETERS);
  const [initial] = useState(() => initialDraft(name, metadata));
  const [draft, setDraft] = useState(initial);
  const [submitted, setSubmitted] = useState(false);
  const [asking, setAsking] = useState(false);
  const [pendingRequest, setPending] = useState<AbortController>();
  const [missing, setMissing] = useState(false);
  const [failure, setFailure] = useState<RequestFailure>();
  const request = useRef<AbortController | null>(null);
  const connected = connection.result?.kind === 'connected';
  const endpoint = connection.engineOrigin;
  const pending = connected && pendingRequest !== undefined && !pendingRequest.signal.aborted;

  useLayoutEffect(
    () => () => {
      request.current?.abort();
      request.current = null;
    },
    [connected, endpoint],
  );

  const { errors, policies } = validate(draft);
  const cancelPath = editing ? parameterPath(name) : PARAMETER_STORE_PATH;
  const blocked = writes.failure ?? (editing ? reads.failure : undefined);
  const saveDisabled = !connected || endpoint === undefined || awaitingMetadata || pending || blocked !== undefined;
  const reason = blocked ?? failure;
  const feedback = reason === undefined ? undefined : actionFailureItem(reason, 'Saving the parameter', endpoint);

  const handleCancel = () => {
    if (JSON.stringify(draft) !== JSON.stringify(initial)) setAsking(true);
    else void navigate(cancelPath);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saveDisabled || endpoint === undefined || request.current !== null || missing) return;
    if (Object.keys(errors).length > 0) {
      const form = event.currentTarget;
      // Commit the inline errors before focusing so the input already describes the error.
      flushSync(() => setSubmitted(true));
      const first = form.querySelector<HTMLInputElement | HTMLTextAreaElement>(
        'input[aria-invalid="true"], textarea[aria-invalid="true"]',
      );
      first?.scrollIntoView?.({ block: 'center' });
      first?.focus({ preventScroll: true });
      return;
    }
    setSubmitted(true);

    const controller = new AbortController();
    const { signal } = controller;
    request.current = controller;
    setPending(controller);
    setFailure(undefined);
    let operation = editing ? DESCRIBE_PARAMETERS : PUT_PARAMETER;
    let saved = false;
    try {
      let input;
      if (editing) {
        const current = await findParameter(endpoint, name, signal);
        signal.throwIfAborted();
        if (current === null) {
          setMissing(true);
          return;
        }
        input = editInput(draft, initial, current, policies);
      } else {
        input = createInput(draft, policies);
      }
      operation = PUT_PARAMETER;
      await putParameter(endpoint, input, signal);
      signal.throwIfAborted();
      saved = true;
      refresh(draft.name, editing);
      flash.handOver(parameterPath(draft.name), [
        {
          type: 'success',
          content: (
            <>
              Parameter <ValueText kind="name" value={draft.name} /> {editing ? 'updated' : 'created'}.
            </>
          ),
        },
      ]);
    } catch (cause) {
      if (signal.aborted) return;
      const rejection = failureOf(cause, operation);
      setFailure(rejection);
      if (rejection.kind === 'not-implemented') {
        if (operation === PUT_PARAMETER) writes.markUnsupported(rejection);
        else reads.markUnsupported(rejection);
      }
    } finally {
      if (!saved && request.current === controller) {
        request.current = null;
        setPending(undefined);
      }
    }
  };

  if (missing) return <MissingParameter name={name} />;
  return (
    <>
      <form onSubmit={(event) => void handleSubmit(event)}>
        <Form
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button formAction="none" variant="link" disabled={pending} onClick={handleCancel}>
                Cancel
              </Button>
              <Button variant="primary" loading={pending} disabled={saveDisabled}>
                {editing ? 'Save changes' : 'Create parameter'}
              </Button>
            </SpaceBetween>
          }
        >
          <SpaceBetween size="l">
            <ParameterFields
              metadata={metadata}
              draft={draft}
              errors={submitted ? errors : {}}
              disabled={pending}
              onChange={setDraft}
            />
            {feedback !== undefined && (
              <Alert type={reason?.kind === 'not-implemented' ? 'info' : 'error'} header={feedback.header}>
                {feedback.content}
              </Alert>
            )}
          </SpaceBetween>
        </Form>
      </form>
      <DiscardDialog
        visible={asking}
        onAnswer={(answer) => {
          setAsking(false);
          if (answer === 'discard') void navigate(cancelPath);
        }}
      />
    </>
  );
}

function EditParameter({ name, connection }: { name: string; connection: AreaConnection }) {
  const { metadata, failure, loading, refresh, rememberFailure } = useParameterMetadata(connection, name);
  const [parameter, setParameter] = useState<ParameterMetadata>();
  if (metadata && !loading && parameter === undefined) setParameter(metadata);
  useEffect(() => {
    if (failure?.kind === 'not-implemented') rememberFailure(failure);
  }, [failure, rememberFailure]);

  if (parameter && (metadata || failure !== undefined || loading)) {
    return (
      <>
        {failure !== undefined && failure.kind !== 'not-implemented' && (
          <Container>
            <ReadFailure state={readFailureState(failure, connection, 'parameter')} onRetry={refresh} />
          </Container>
        )}
        {loading && <StatusIndicator type="loading">Loading parameter…</StatusIndicator>}
        <ParameterForm
          connection={connection}
          name={name}
          metadata={parameter}
          awaitingMetadata={!metadata || loading}
        />
      </>
    );
  }
  if (failure !== undefined) {
    const state = readFailureState(failure, connection, 'parameter');
    return (
      <Container>
        {failure.kind === 'not-implemented' ? (
          <Box textAlign="center">
            <SpaceBetween size="xs">
              <StatusIndicator type={state.type}>{state.first}</StatusIndicator>
              <Box variant="p">{state.detail}</Box>
              <Button disabled>Retry</Button>
            </SpaceBetween>
          </Box>
        ) : (
          <ReadFailure state={state} onRetry={refresh} />
        )}
      </Container>
    );
  }
  if (loading) return <StatusIndicator type="loading">Loading parameter…</StatusIndicator>;
  return <MissingParameter name={name} />;
}

export function CreateParameterPage({ connection }: { connection: AreaConnection }) {
  useShowsResources('parameters');
  return (
    <SpaceBetween size="l">
      <Header variant="h1">Create parameter</Header>
      <ParameterForm connection={connection} name="" />
    </SpaceBetween>
  );
}

export function EditParameterPage({ connection }: { connection: AreaConnection }) {
  useShowsResources('parameters');
  const [query] = useSearchParams();
  const name = parameterName(query);
  const { engineOrigin, result } = connection;
  const reportedTarget =
    result?.kind === 'connected' || result?.kind === 'emulator-unreachable'
      ? JSON.stringify([targetOf(result), result.emulator.endpoint])
      : undefined;
  const [scope, setScope] = useState({ engineOrigin, target: reportedTarget });
  // An unreachable engine cannot identify its target. Keep the last reported identity for this origin.
  if (scope.engineOrigin !== engineOrigin || (reportedTarget !== undefined && scope.target !== reportedTarget)) {
    setScope({ engineOrigin, target: reportedTarget });
  }
  return (
    <SpaceBetween size="l">
      <Header variant="h1">Edit parameter</Header>
      <EditParameter
        key={JSON.stringify([name, scope.engineOrigin, scope.target])}
        connection={connection}
        name={name}
      />
    </SpaceBetween>
  );
}
