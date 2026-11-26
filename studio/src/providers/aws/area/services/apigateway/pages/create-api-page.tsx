import Alert, { type AlertProps } from '@cloudscape-design/components/alert';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Form from '@cloudscape-design/components/form';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import Input, { type InputProps } from '@cloudscape-design/components/input';
import RadioGroup from '@cloudscape-design/components/radio-group';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Textarea from '@cloudscape-design/components/textarea';
import Tiles from '@cloudscape-design/components/tiles';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';

import { refusalMessage, reportedNotImplementedMessage, type RequestFailure } from '../../../../../../lib/aws/request';
import { DiscardDialog } from '../../../components/discard-dialog';
import { actionFailureItem } from '../../../components/failure-states';
import { usePageFlash, type FlashResult } from '../../../components/page-flash';
import { useShowsResources } from '../../../components/page-resources';
import { ValueText } from '../../../components/value-text';
import type { ScreenPageProps } from '../../../screens';
import type { CreatedApi } from '../api-create-api';
import { useCreateApi } from '../api-create-queries';
import {
  apiFormChanged,
  apiNameError,
  apiNameRule,
  initialApiForm,
  type ApiForm,
  type CreateApiKind,
  type DefaultStageChoice,
  type RestEndpointType,
} from '../api-form';
import { apisPath, endpointTypeText, restApiPath, v2ApiPath } from '../format';

const kinds = [
  {
    value: 'REST',
    label: 'REST API',
    description:
      'Resources and methods, with a Lambda function, an HTTP endpoint or a mock behind each. Served after a deployment to a stage.',
  },
  {
    value: 'HTTP',
    label: 'HTTP API',
    description:
      'Routes with a Lambda function or an HTTP endpoint behind each. A $default stage serves changes at once.',
  },
];

const endpointDescriptions: Record<RestEndpointType, string> = {
  EDGE: "The API's own default when none is given.",
  REGIONAL: 'Meant for callers in the same Region.',
  PRIVATE: 'Meant to be reached from inside a VPC.',
};

const endpointTypes = Object.entries(endpointDescriptions).map(([value, description]) => ({
  value,
  label: endpointTypeText(value),
  description,
}));

const stages = [
  {
    value: 'create',
    label: 'Create the $default stage',
    description: 'The API gets a $default stage with auto-deploy on, which serves changes at once.',
  },
  {
    value: 'skip',
    label: 'No stage',
    description: 'No stage is created. The API has no invoke URL until you create a stage on its page.',
  },
];

function createResult({ name, stageFailure }: CreatedApi, engineOrigin: string | undefined): FlashResult {
  const success = {
    type: 'success' as const,
    content: (
      <>
        API <ValueText kind="name" value={name} /> created.
      </>
    ),
  };
  if (!stageFailure) return [success];

  const item = actionFailureItem(stageFailure, stageFailure.operation, engineOrigin);
  const reason =
    reportedNotImplementedMessage(stageFailure) ||
    refusalMessage(stageFailure) ||
    (stageFailure.kind === 'other' ? stageFailure.code : item.header);
  return [
    success,
    {
      type: 'warning',
      content: (
        <>
          API <ValueText kind="name" value={name} /> created, but stage $default was not:{' '}
          <ValueText kind="text" value={typeof reason === 'string' ? reason : undefined} none={reason} />
        </>
      ),
    },
  ];
}

export function CreateApiPage({ connection: { engineOrigin } }: ScreenPageProps) {
  useShowsResources('APIs');
  const navigate = useNavigate();
  const flash = usePageFlash();
  const { submit, isPending } = useCreateApi(engineOrigin);
  const [form, setForm] = useState<ApiForm>(initialApiForm);
  const [tried, setTried] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [failure, setFailure] = useState<RequestFailure>();
  const [unavailable, setUnavailable] = useState<Partial<Record<CreateApiKind, RequestFailure>>>({});
  const nameRef = useRef<InputProps.Ref>(null);
  const failureRef = useRef<AlertProps.Ref>(null);
  const { kind } = form;
  const shownFailure = (kind && unavailable[kind]) || failure;
  const failureItem = shownFailure && actionFailureItem(shownFailure, shownFailure.operation, engineOrigin);
  const nameError = kind && tried ? apiNameError(form.name, kind) : undefined;

  useEffect(() => {
    if (shownFailure) failureRef.current?.focus();
  }, [shownFailure]);

  function change(update: Partial<ApiForm>) {
    setForm((current) => ({ ...current, ...update }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!kind || isPending || unavailable[kind]) return;
    setTried(true);
    if (apiNameError(form.name, kind)) {
      nameRef.current?.focus();
      return;
    }

    setFailure(undefined);
    const outcome = await submit({ ...form, kind });
    if (!outcome) return;
    if ('failure' in outcome) {
      if (outcome.failure.kind === 'not-implemented') {
        setUnavailable((current) => ({ ...current, [kind]: outcome.failure }));
      } else {
        setFailure(outcome.failure);
      }
      return;
    }
    const { created } = outcome;
    const path = created.kind === 'REST' ? restApiPath(created.id) : v2ApiPath(created.id);
    flash.handOver(path, createResult(created, engineOrigin));
  }

  function handleCancel() {
    if (apiFormChanged(form)) setDiscard(true);
    else void navigate(apisPath);
  }

  return (
    <>
      <form onSubmit={(event) => void handleSubmit(event)}>
        <Form
          header={<Header variant="h1">Create API</Header>}
          actions={
            <SpaceBetween size="xs" direction="horizontal">
              <Button variant="link" formAction="none" disabled={isPending} onClick={handleCancel}>
                Cancel
              </Button>
              <Button
                variant="primary"
                formAction="submit"
                loading={isPending}
                disabled={!kind || engineOrigin === undefined || Boolean(unavailable[kind])}
              >
                Create API
              </Button>
            </SpaceBetween>
          }
        >
          <SpaceBetween size="l">
            {shownFailure && failureItem && (
              <Alert ref={failureRef} type={failureItem.type === 'info' ? 'info' : 'error'} header={failureItem.header}>
                {(shownFailure.kind === 'engine-did-not-answer' || shownFailure.kind === 'emulator-did-not-answer') && (
                  <>{shownFailure.operation} failed. </>
                )}
                {shownFailure.kind === 'other' ? (
                  <>
                    <ValueText kind="fixed" value={shownFailure.code} />
                    {shownFailure.message && (
                      <>
                        : <ValueText kind="text" value={shownFailure.message} />
                      </>
                    )}
                  </>
                ) : (
                  <ValueText
                    kind="text"
                    value={typeof failureItem.content === 'string' ? failureItem.content : undefined}
                    none={failureItem.content}
                  />
                )}
              </Alert>
            )}
            <Container>
              <FormField label="Kind of API">
                <Tiles
                  items={kinds.map((option) => ({ ...option, disabled: isPending }))}
                  value={kind}
                  onChange={({ detail }) => {
                    change({ kind: detail.value as CreateApiKind });
                    setFailure(undefined);
                    setTried(false);
                  }}
                />
              </FormField>
            </Container>
            {kind && (
              <Container header={<Header variant="h2">API details</Header>}>
                <SpaceBetween size="l">
                  <FormField label="Name" constraintText={apiNameRule(kind)} errorText={nameError}>
                    <Input
                      ref={nameRef}
                      value={form.name}
                      disabled={isPending}
                      onChange={({ detail }) => change({ name: detail.value })}
                    />
                  </FormField>
                  <FormField label="Description" stretch>
                    <Textarea
                      value={form.description}
                      disabled={isPending}
                      onChange={({ detail }) => change({ description: detail.value })}
                    />
                  </FormField>
                  {kind === 'REST' ? (
                    <FormField label="Endpoint type">
                      <RadioGroup
                        items={endpointTypes.map((option) => ({ ...option, disabled: isPending }))}
                        value={form.endpointType}
                        onChange={({ detail }) => change({ endpointType: detail.value as RestEndpointType })}
                      />
                    </FormField>
                  ) : (
                    <FormField label="$default stage">
                      <RadioGroup
                        items={stages.map((option) => ({ ...option, disabled: isPending }))}
                        value={form.defaultStage}
                        onChange={({ detail }) => change({ defaultStage: detail.value as DefaultStageChoice })}
                      />
                    </FormField>
                  )}
                </SpaceBetween>
              </Container>
            )}
          </SpaceBetween>
        </Form>
      </form>
      <DiscardDialog
        visible={discard}
        onAnswer={(answer) => {
          setDiscard(false);
          if (answer === 'discard') void navigate(apisPath);
        }}
      />
    </>
  );
}
