import type { Resource } from '@aws-sdk/client-api-gateway';
import Alert, { type AlertProps } from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button, { type ButtonProps } from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Form from '@cloudscape-design/components/form';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import Input, { type InputProps } from '@cloudscape-design/components/input';
import Link from '@cloudscape-design/components/link';
import Select, { type SelectProps } from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Textarea, { type TextareaProps } from '@cloudscape-design/components/textarea';
import Tiles from '@cloudscape-design/components/tiles';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router';

import type { RequestFailure } from '../../../../../../lib/aws/request';
import { CopyValue } from '../../../components/copy-value';
import { DiscardDialog } from '../../../components/discard-dialog';
import type { AreaConnection } from '../../../components/emulator-line';
import { actionFailureItem } from '../../../components/failure-states';
import { usePageFlash, type FlashItem, type FlashResult } from '../../../components/page-flash';
import { useShowsResources } from '../../../components/page-resources';
import { useFollow } from '../../../components/use-follow';
import type { ChoiceSource } from '../../../components/use-paged-choices';
import { failureOf, usePageSignal } from '../../../components/use-token-listing';
import { ValueText } from '../../../components/value-text';
import type { ScreenPageProps } from '../../../screens';
import { FunctionField } from '../components/function-field';
import { PagedChoice } from '../components/paged-choice';
import { RequestReadFailure } from '../components/request-read-failure';
import { apisPath, restApiPath } from '../format';
import { PUT_METHOD, type MethodOutcome } from '../method-create-api';
import {
  HTTP_METHODS,
  METHOD_START,
  methodChanged,
  validateMethod,
  type MethodForm,
  type MethodInput,
  type MethodResource,
} from '../method-form';
import { useCreateMethod, useLinkedMethodResource } from '../method-queries';
import { operationReason } from '../permission';
import { apiQueryKey } from '../queries';
import { GET_RESOURCES, readRestResources } from '../rest-api';
import { refreshRestApi, useRestApi } from '../rest-queries';

const title = 'Create method';
const authorizations = [
  { value: 'NONE', label: 'NONE', description: 'Open. No authorization is checked.' },
  { value: 'AWS_IAM', label: 'AWS_IAM', description: 'The caller signs the request with AWS credentials.' },
];
const keys = [
  { value: 'no', label: 'No', description: 'Callers need no API key.' },
  { value: 'yes', label: 'Yes', description: 'Callers send an API key.' },
];
const integrations = [
  { value: 'lambda', label: 'Lambda function', description: 'A Lambda function the emulator holds is invoked.' },
  { value: 'http', label: 'HTTP endpoint', description: 'The request is passed to an HTTP address.' },
  { value: 'mock', label: 'Mock', description: 'A fixed answer, without a backend.' },
];

function toResource(resource: Resource | null | undefined): MethodResource | undefined {
  return resource?.id && resource.path ? { id: resource.id, path: resource.path } : undefined;
}

function MethodTarget({ input }: { input: MethodInput }) {
  return <ValueText kind="name" value={`${input.method} ${input.resource.path}`} />;
}

function createdResult(
  input: MethodInput,
  outcome: Extract<MethodOutcome, { kind: 'created' }>,
  endpoint: string,
): FlashResult {
  const success: FlashItem = {
    type: 'success',
    content: (
      <>
        Method <MethodTarget input={input} /> created.
      </>
    ),
  };
  const warning = outcome.permissionWarning;
  if (!warning) return [success];
  const unsupported =
    warning.failure?.kind === 'not-implemented' ? actionFailureItem(warning.failure, title, endpoint) : undefined;
  return [
    success,
    {
      type: 'warning',
      header: unsupported?.header,
      content: (
        <>
          Method <MethodTarget input={input} /> created, but the permission was not added to{' '}
          <ValueText kind="name" value={warning.functionName} />:{' '}
          {unsupported?.content ?? <ValueText kind="text" value={warning.reason} />}
        </>
      ),
    },
  ];
}

function failureItem(
  outcome: Exclude<MethodOutcome, { kind: 'created' }>,
  input: MethodInput,
  endpoint: string,
  target: string,
  follow: ReturnType<typeof useFollow>,
): FlashItem {
  const { failure } = outcome;
  const unsupported =
    failure.kind === 'not-implemented'
      ? failure
      : outcome.kind === 'left' && outcome.removalFailure.kind === 'not-implemented'
        ? outcome.removalFailure
        : undefined;
  const base = actionFailureItem(unsupported ?? failure, title, endpoint);
  const reason = (request: RequestFailure) => (
    <ValueText kind="text" value={`${request.operation}: ${operationReason(request)}`} />
  );

  let content: ReactNode = reason(failure);
  if (outcome.kind === 'removed') {
    content = <>{content} No method was created.</>;
  } else if (outcome.kind === 'left') {
    content = (
      <SpaceBetween size="xs">
        <Box>{reason(failure)}</Box>
        <Box>
          Method <MethodTarget input={input} /> was created without a working integration and could not be removed:{' '}
          {reason(outcome.removalFailure)}
        </Box>
        <Link href={target} onFollow={follow}>
          View API resources
        </Link>
      </SpaceBetween>
    );
  }
  return { ...base, content };
}

interface MethodEditorProps {
  apiId: string;
  resourceId: string | undefined;
  connection: AreaConnection;
  endpoint: string;
}

function MethodEditor({ apiId, resourceId, connection, endpoint }: MethodEditorProps) {
  const navigate = useNavigate();
  const follow = useFollow();
  const flash = usePageFlash();
  const pageSignal = usePageSignal();
  const submitId = useId();
  const target = restApiPath(apiId, 'resources');
  const linked = useLinkedMethodResource(apiId, resourceId, endpoint);
  const baseline = toResource(linked.data);
  const [selection, setSelection] = useState<MethodResource | null>();
  const resource = selection === undefined ? baseline : (selection ?? undefined);
  const [form, setForm] = useState(METHOD_START);
  const [tried, setTried] = useState(false);
  const [failure, setFailure] = useState<FlashItem>();
  const [unavailable, setUnavailable] = useState(false);
  const [asking, setAsking] = useState(false);
  const [kept, setKept] = useState(0);
  const busy = useRef(false);
  const cancelRef = useRef<ButtonProps.Ref>(null);
  const resourceRef = useRef<SelectProps.Ref>(null);
  const functionRef = useRef<SelectProps.Ref>(null);
  const addressRef = useRef<InputProps.Ref>(null);
  const bodyRef = useRef<TextareaProps.Ref>(null);
  const failureRef = useRef<AlertProps.Ref>(null);
  const mutation = useCreateMethod(apiId, endpoint);

  useEffect(() => {
    if (kept > 0) cancelRef.current?.focus();
  }, [kept]);

  useEffect(() => {
    if (failure) failureRef.current?.focus();
  }, [failure]);

  const source: ChoiceSource<MethodResource> = {
    key: [...apiQueryKey(endpoint, 'rest', apiId), 'method-resource-choices'],
    endpoint,
    operation: GET_RESOURCES,
    readAgainOnOpen: true,
    read: async (origin, _text, token, signal) => {
      const page = await readRestResources(origin, apiId, token, signal);
      return {
        ...page,
        items: page.items.flatMap((item) => {
          const choice = toResource(item);
          return choice ? [choice] : [];
        }),
      };
    },
    optionOf: ({ id, path }) => ({ value: id, label: path, description: `ID ${id}` }),
  };

  const validation = validateMethod(form, resource);
  const errors = tried && 'errors' in validation ? validation.errors : {};
  const set = (change: Partial<MethodForm>) => setForm((previous) => ({ ...previous, ...change }));

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    // A Retry inside a choice can also submit the containing form.
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    if ((submitter && submitter.id !== submitId) || busy.current || unavailable) return;
    setTried(true);
    setFailure(undefined);
    if ('errors' in validation) {
      const invalid = validation.errors;
      if (invalid.resource) resourceRef.current?.focus();
      else if (invalid.function) functionRef.current?.focus();
      else if (invalid.address) addressRef.current?.focus();
      else if (invalid.body) bodyRef.current?.focus();
      return;
    }

    busy.current = true;
    const signal = pageSignal();
    const { input } = validation;
    try {
      const outcome = await mutation.mutateAsync({ input, signal });
      if (signal.aborted) return;
      if (outcome.kind === 'created') {
        flash.handOver(target, createdResult(input, outcome, endpoint));
      } else {
        const item = failureItem(outcome, input, endpoint, target, follow);
        setFailure(item);
        setUnavailable(
          outcome.failure.kind === 'not-implemented' ||
            (outcome.kind === 'left' && outcome.removalFailure.kind === 'not-implemented'),
        );
      }
    } catch (error) {
      if (!signal.aborted) setFailure(actionFailureItem(failureOf(error, PUT_METHOD), title, endpoint));
    } finally {
      busy.current = false;
    }
  };

  const handleCancel = () => {
    if (methodChanged(form, resource, baseline)) setAsking(true);
    else void navigate(restApiPath(apiId));
  };

  return (
    <>
      <form onSubmit={(event) => void handleSubmit(event)} noValidate>
        <Form
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button
                ref={cancelRef}
                variant="link"
                formAction="none"
                disabled={mutation.isPending}
                onClick={handleCancel}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                nativeButtonAttributes={{ id: submitId }}
                loading={mutation.isPending}
                loadingText="Creating method"
                disabled={unavailable}
              >
                {title}
              </Button>
            </SpaceBetween>
          }
        >
          <SpaceBetween size="l">
            {failure && (
              <Alert ref={failureRef} type={failure.type} header={failure.header}>
                {failure.content}
              </Alert>
            )}
            <Container header={<Header variant="h2">Method settings</Header>}>
              <SpaceBetween size="m">
                {linked.failure && (
                  <RequestReadFailure
                    failure={linked.failure}
                    connection={connection}
                    thing="linked resource"
                    onRetry={linked.retry}
                  />
                )}
                <FormField label="Resource" errorText={errors.resource}>
                  <PagedChoice
                    ariaLabel="Resource"
                    source={source}
                    connection={connection}
                    things="resources"
                    placeholder={
                      linked.loading && selection === undefined ? 'Loading linked resource…' : 'Choose a resource'
                    }
                    value={resource}
                    onChange={(choice) => setSelection(choice ?? null)}
                    selectRef={resourceRef}
                    invalid={errors.resource !== undefined}
                  />
                </FormField>
                {resource && <CopyValue label="resource ID" value={resource.id} kind="fixed" />}
                <FormField label="HTTP method">
                  <Select
                    ariaLabel="HTTP method"
                    options={HTTP_METHODS}
                    selectedOption={HTTP_METHODS.find(({ value }) => value === form.method) ?? null}
                    onChange={({ detail }) => set({ method: detail.selectedOption.value as MethodForm['method'] })}
                  />
                </FormField>
                <FormField label="Authorization">
                  <Select
                    ariaLabel="Authorization"
                    options={authorizations}
                    selectedOption={authorizations.find(({ value }) => value === form.authorization) ?? null}
                    onChange={({ detail }) =>
                      set({ authorization: detail.selectedOption.value as MethodForm['authorization'] })
                    }
                  />
                </FormField>
                <FormField label="API key required">
                  <Select
                    ariaLabel="API key required"
                    options={keys}
                    selectedOption={keys[form.apiKeyRequired ? 1 : 0] ?? null}
                    onChange={({ detail }) => set({ apiKeyRequired: detail.selectedOption.value === 'yes' })}
                  />
                </FormField>
              </SpaceBetween>
            </Container>
            <Container header={<Header variant="h2">Integration</Header>}>
              <SpaceBetween size="m">
                <FormField label="Integration kind">
                  <Tiles
                    ariaLabel="Integration kind"
                    value={form.kind}
                    items={integrations}
                    onChange={({ detail }) => set({ kind: detail.value as MethodForm['kind'] })}
                  />
                </FormField>
                {form.kind === 'lambda' && (
                  <FunctionField
                    connection={connection}
                    value={form.function}
                    onChange={(value) => set({ function: value })}
                    allow={form.allow}
                    onAllowChange={(allow) => set({ allow })}
                    errorText={errors.function}
                    selectRef={functionRef}
                  />
                )}
                {form.kind === 'http' && (
                  <>
                    <FormField
                      label="HTTP address"
                      description="The emulator sends no request to this address. It answers only for an address it serves itself, such as another API's invoke URL."
                      errorText={errors.address}
                    >
                      <Input
                        ref={addressRef}
                        value={form.address}
                        onChange={({ detail }) => set({ address: detail.value })}
                      />
                    </FormField>
                    <FormField label="Integration HTTP method">
                      <Select
                        ariaLabel="Integration HTTP method"
                        options={HTTP_METHODS}
                        selectedOption={HTTP_METHODS.find(({ value }) => value === form.integrationMethod) ?? null}
                        onChange={({ detail }) =>
                          set({ integrationMethod: detail.selectedOption.value as MethodForm['integrationMethod'] })
                        }
                      />
                    </FormField>
                  </>
                )}
                {form.kind === 'mock' && (
                  <FormField label="Response body" description="application/json · HTTP 200" errorText={errors.body}>
                    <Textarea ref={bodyRef} value={form.body} onChange={({ detail }) => set({ body: detail.value })} />
                  </FormField>
                )}
              </SpaceBetween>
            </Container>
          </SpaceBetween>
        </Form>
      </form>
      {asking && (
        <DiscardDialog
          visible
          onAnswer={(answer) => {
            setAsking(false);
            if (answer === 'discard') void navigate(restApiPath(apiId));
            else setKept((count) => count + 1);
          }}
        />
      )}
    </>
  );
}

export function CreateMethodPage({ connection, params }: ScreenPageProps) {
  useShowsResources('APIs');
  const client = useQueryClient();
  const follow = useFollow();
  const [query] = useSearchParams();
  const apiId = params.api_id ?? '';
  const resourceId = query.get('resource') || undefined;
  const endpoint = connection.engineOrigin;
  const api = useRestApi(apiId, endpoint);
  const notFound = api.data === null;
  return (
    <SpaceBetween size="l">
      <Header
        variant="h1"
        description={
          api.data?.name ? (
            <>
              API: <ValueText kind="name" value={api.data.name} />
            </>
          ) : undefined
        }
      >
        {notFound ? 'API not found' : title}
      </Header>
      {api.failure && (
        <RequestReadFailure
          failure={api.failure}
          connection={connection}
          thing="REST API"
          onRetry={() => void refreshRestApi(client, apiId)}
        />
      )}
      {notFound && (
        <SpaceBetween size="s">
          <Box>
            The emulator holds no REST API with the ID <CopyValue label="API ID" kind="fixed" value={apiId} />.
          </Box>
          <Link href={apisPath} onFollow={follow}>
            APIs
          </Link>
        </SpaceBetween>
      )}
      {api.data === undefined && api.loading && <StatusIndicator type="loading">Loading API…</StatusIndicator>}
      {api.data && endpoint !== undefined && (
        <MethodEditor
          key={JSON.stringify([endpoint, apiId, resourceId])}
          connection={connection}
          endpoint={endpoint}
          apiId={apiId}
          resourceId={resourceId}
        />
      )}
    </SpaceBetween>
  );
}
