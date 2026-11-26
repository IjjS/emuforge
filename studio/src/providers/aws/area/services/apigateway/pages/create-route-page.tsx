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
import Tiles from '@cloudscape-design/components/tiles';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';

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
import { apisPath, v2ApiPath } from '../format';
import { HTTP_METHODS } from '../method-form';
import { operationReason } from '../permission';
import { apiQueryKey } from '../queries';
import { CREATE_INTEGRATION, CREATE_ROUTE, type RouteOutcome } from '../route-create-api';
import {
  ROUTE_PATH_RULE,
  ROUTE_START,
  routeChanged,
  routeKey,
  validateRoute,
  type IntegrationChoice,
  type RouteForm,
} from '../route-form';
import { useCreateRoute } from '../route-queries';
import { GET_INTEGRATIONS, readV2Integrations } from '../v2-api';
import { useV2Api } from '../v2-queries';

const title = 'Create route';

const routeTypes = [
  { value: 'default', label: '$default route', description: 'Catches every request no other route matches.' },
  { value: 'method', label: 'Method and path', description: 'One HTTP method and one path.' },
] as const;
const authorizations = [
  { value: 'NONE', label: 'NONE', description: 'Open. No authorization is checked.' },
  { value: 'AWS_IAM', label: 'AWS_IAM', description: 'The caller signs the request with AWS credentials.' },
] as const;
const integrationSources = [
  { value: 'existing', label: 'Use an existing integration', description: 'One this API has already.' },
  { value: 'new', label: 'Create an integration', description: 'A new Lambda function or HTTP endpoint integration.' },
] as const;
const integrationKinds = [
  { value: 'lambda', label: 'Lambda function', description: 'A Lambda function the emulator holds is invoked.' },
  { value: 'http', label: 'HTTP endpoint', description: 'The emulator returns a redirect to an HTTP address.' },
];
const payloadFormats = [
  {
    value: '2.0',
    label: '2.0',
    description: 'The function gets the HTTP API event: rawPath, routeKey, requestContext.',
  },
  {
    value: '1.0',
    label: '1.0',
    description: 'The function gets the REST API event: httpMethod, path, multi-value headers.',
  },
] as const;

function RouteSelect<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { value: T; label: string; description: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <FormField label={label}>
      <Select
        ariaLabel={label}
        options={options}
        selectedOption={options.find((option) => option.value === value) ?? null}
        onChange={({ detail }) => {
          const option = options.find((entry) => entry.value === detail.selectedOption.value);
          if (option) onChange(option.value);
        }}
      />
    </FormField>
  );
}

function createdResult(key: string, outcome: Extract<RouteOutcome, { kind: 'created' }>): FlashResult {
  const route = <ValueText kind="name" value={key} />;
  const success: FlashItem = { type: 'success', content: <>Route {route} created.</> };
  const warning = outcome.permissionWarning;
  if (!warning) return [success];
  return [
    success,
    {
      type: 'warning',
      content: (
        <>
          Route {route} created, but the permission was not added to{' '}
          <ValueText kind="name" value={warning.functionName} />: <ValueText kind="text" value={warning.reason} />
        </>
      ),
    },
  ];
}

function requestReason(failure: RequestFailure) {
  return <ValueText kind="text" value={`${failure.operation}: ${operationReason(failure)}`} />;
}

function failureItem(outcome: Exclude<RouteOutcome, { kind: 'created' }>, endpoint: string): FlashItem {
  const { failure } = outcome;
  const base = actionFailureItem(failure, title, endpoint);
  if (outcome.kind === 'left') {
    return {
      ...base,
      content: (
        <SpaceBetween size="xs">
          <Box>{requestReason(failure)}</Box>
          <Box>
            Integration <CopyValue label="integration ID" kind="fixed" value={outcome.integrationId} /> was created
            without a route and could not be removed: {requestReason(outcome.removalFailure)}
          </Box>
        </SpaceBetween>
      ),
    };
  }
  return {
    ...base,
    content: (
      <>
        {requestReason(failure)}
        {outcome.kind === 'removed' && ' No route was created.'}
      </>
    ),
  };
}

function RouteEditor({ apiId, endpoint, connection }: { apiId: string; endpoint: string; connection: AreaConnection }) {
  const navigate = useNavigate();
  const flash = usePageFlash();
  const pageSignal = usePageSignal();
  const submitId = useId();
  const [form, setForm] = useState(ROUTE_START);
  const [tried, setTried] = useState(false);
  const [failure, setFailure] = useState<FlashItem>();
  const [unavailableOperation, setUnavailableOperation] = useState<string>();
  const [asking, setAsking] = useState(false);
  const [kept, setKept] = useState(0);
  const busy = useRef(false);
  const cancelRef = useRef<ButtonProps.Ref>(null);
  const pathRef = useRef<InputProps.Ref>(null);
  const existingRef = useRef<SelectProps.Ref>(null);
  const functionRef = useRef<SelectProps.Ref>(null);
  const addressRef = useRef<InputProps.Ref>(null);
  const failureRef = useRef<AlertProps.Ref>(null);
  const mutation = useCreateRoute(apiId, endpoint);

  useEffect(() => {
    if (kept > 0) cancelRef.current?.focus();
  }, [kept]);

  useEffect(() => {
    if (failure) failureRef.current?.focus();
  }, [failure]);

  const source: ChoiceSource<IntegrationChoice> = {
    key: [...apiQueryKey(endpoint, 'v2', apiId), 'route-integration-choices'],
    endpoint,
    operation: GET_INTEGRATIONS,
    readAgainOnOpen: true,
    read: async (origin, _text, token, signal) => {
      const page = await readV2Integrations(origin, apiId, token, signal);
      return {
        ...page,
        items: page.items.flatMap(({ IntegrationId, IntegrationType, IntegrationUri }) =>
          IntegrationId ? [{ id: IntegrationId, type: IntegrationType, target: IntegrationUri }] : [],
        ),
      };
    },
    optionOf: ({ id, type, target }) => ({
      value: id,
      label: id,
      description: [type, target].filter(Boolean).join(' · ') || 'No type or target was returned.',
    }),
  };

  const key = routeKey(form);
  const validation = validateRoute(form);
  const errors = tried && 'errors' in validation ? validation.errors : {};
  const set = (change: Partial<RouteForm>) => setForm((previous) => ({ ...previous, ...change }));
  const unavailable =
    unavailableOperation === CREATE_ROUTE || (unavailableOperation === CREATE_INTEGRATION && form.source === 'new');

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    // A Retry inside a choice can also submit the containing form.
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    if ((submitter && submitter.id !== submitId) || busy.current || unavailable) return;
    setTried(true);
    setFailure(undefined);
    if ('errors' in validation) {
      const invalid = validation.errors;
      if (invalid.path) pathRef.current?.focus();
      else if (invalid.existing) existingRef.current?.focus();
      else if (invalid.function) functionRef.current?.focus();
      else if (invalid.address) addressRef.current?.focus();
      return;
    }

    busy.current = true;
    const signal = pageSignal();
    const { input } = validation;
    try {
      const outcome = await mutation.mutateAsync({ input, signal });
      if (signal.aborted) return;
      if (outcome.kind === 'created') {
        flash.handOver(v2ApiPath(apiId, 'routes'), createdResult(input.key, outcome));
      } else {
        setFailure(failureItem(outcome, endpoint));
        if (outcome.failure.kind === 'not-implemented') setUnavailableOperation(outcome.failure.operation);
      }
    } catch (error) {
      if (!signal.aborted) {
        const request = failureOf(error, CREATE_ROUTE);
        setFailure(failureItem({ kind: 'unchanged', failure: request }, endpoint));
      }
    } finally {
      busy.current = false;
    }
  };

  const handleCancel = () => {
    if (routeChanged(form)) setAsking(true);
    else void navigate(v2ApiPath(apiId));
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
                loadingText="Creating route"
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
            <Container header={<Header variant="h2">Route settings</Header>}>
              <SpaceBetween size="m">
                <RouteSelect
                  label="Route"
                  options={routeTypes}
                  value={form.route}
                  onChange={(route) => set({ route })}
                />
                {form.route === 'method' && (
                  <>
                    <RouteSelect
                      label="HTTP method"
                      options={HTTP_METHODS}
                      value={form.method}
                      onChange={(method) => set({ method })}
                    />
                    <FormField label="Path" constraintText={ROUTE_PATH_RULE} errorText={errors.path}>
                      <Input ref={pathRef} value={form.path} onChange={({ detail }) => set({ path: detail.value })} />
                    </FormField>
                  </>
                )}
                {key && (
                  <Box>
                    Route key <ValueText kind="name" value={key} />
                  </Box>
                )}
                <RouteSelect
                  label="Authorization"
                  options={authorizations}
                  value={form.authorization}
                  onChange={(authorization) => set({ authorization })}
                />
              </SpaceBetween>
            </Container>
            <Container header={<Header variant="h2">Integration</Header>}>
              <SpaceBetween size="m">
                <RouteSelect
                  label="Integration"
                  options={integrationSources}
                  value={form.source}
                  onChange={(source) => set({ source })}
                />
                {form.source === 'existing' ? (
                  <>
                    <FormField
                      label="Existing integration"
                      constraintText="Creating a route with an existing integration does not change the Lambda function's permission."
                      errorText={errors.existing}
                    >
                      <PagedChoice
                        ariaLabel="Existing integration"
                        source={source}
                        connection={connection}
                        things="integrations"
                        placeholder="Choose an integration"
                        value={form.existing}
                        onChange={(existing) => set({ existing })}
                        selectRef={existingRef}
                        invalid={errors.existing !== undefined}
                      />
                    </FormField>
                    {form.existing && <CopyValue label="integration ID" kind="fixed" value={form.existing.id} />}
                    {form.existing?.target && <CopyValue label="integration target" value={form.existing.target} />}
                  </>
                ) : (
                  <>
                    <FormField label="Integration kind">
                      <Tiles
                        ariaLabel="Integration kind"
                        value={form.kind}
                        items={integrationKinds}
                        onChange={({ detail }) => set({ kind: detail.value === 'http' ? 'http' : 'lambda' })}
                      />
                    </FormField>
                    {form.kind === 'lambda' ? (
                      <>
                        <FunctionField
                          connection={connection}
                          value={form.function}
                          onChange={(value) => set({ function: value })}
                          allow={form.allow}
                          onAllowChange={(allow) => set({ allow })}
                          errorText={errors.function}
                          selectRef={functionRef}
                        />
                        <RouteSelect
                          label="Payload format"
                          options={payloadFormats}
                          value={form.payload}
                          onChange={(payload) => set({ payload })}
                        />
                      </>
                    ) : (
                      <>
                        <FormField
                          label="HTTP address"
                          description="The emulator calls no backend for an HTTP API. It answers this route with 307 and this address as Location."
                          errorText={errors.address}
                        >
                          <Input
                            ref={addressRef}
                            value={form.address}
                            onChange={({ detail }) => set({ address: detail.value })}
                          />
                        </FormField>
                        <RouteSelect
                          label="Integration HTTP method"
                          options={HTTP_METHODS}
                          value={form.integrationMethod}
                          onChange={(integrationMethod) => set({ integrationMethod })}
                        />
                      </>
                    )}
                  </>
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
            if (answer === 'discard') void navigate(v2ApiPath(apiId));
            else setKept((count) => count + 1);
          }}
        />
      )}
    </>
  );
}

export function CreateRoutePage({ connection, params }: ScreenPageProps) {
  useShowsResources('APIs');
  const follow = useFollow();
  const apiId = params.api_id ?? '';
  const endpoint = connection.engineOrigin;
  const reading = useV2Api(endpoint, apiId);
  const api = reading.value?.found === true ? reading.value.api : undefined;
  const notFound = reading.value?.found === false;
  const webSocket = api?.ProtocolType === 'WEBSOCKET';

  return (
    <SpaceBetween size="l">
      <Header
        variant="h1"
        description={
          api?.ProtocolType === 'HTTP' && api.Name ? (
            <>
              API: <ValueText kind="name" value={api.Name} />
            </>
          ) : undefined
        }
      >
        {notFound ? 'API not found' : webSocket ? 'Routes are created here for HTTP APIs only' : title}
      </Header>
      {reading.failure && (
        <RequestReadFailure
          failure={reading.failure}
          connection={connection}
          thing="API"
          onRetry={() => void reading.refresh()}
        />
      )}
      {reading.value === undefined && reading.loading && <StatusIndicator type="loading">Loading API…</StatusIndicator>}
      {notFound && (
        <SpaceBetween size="s">
          <Box>
            The emulator holds no HTTP or WebSocket API with the ID{' '}
            <CopyValue label="API ID" kind="fixed" value={apiId} />.
          </Box>
          <Link href={apisPath} onFollow={follow}>
            View APIs
          </Link>
        </SpaceBetween>
      )}
      {webSocket && (
        <SpaceBetween size="s">
          <Box>
            <CopyValue label="API ID" kind="fixed" value={apiId} /> is a WebSocket API.
          </Box>
          <Link href={v2ApiPath(apiId)} onFollow={follow}>
            View API
          </Link>
        </SpaceBetween>
      )}
      {api?.ProtocolType === 'HTTP' && endpoint !== undefined && (
        <RouteEditor
          key={JSON.stringify([endpoint, apiId])}
          connection={connection}
          endpoint={endpoint}
          apiId={apiId}
        />
      )}
    </SpaceBetween>
  );
}
