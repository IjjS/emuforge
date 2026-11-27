import Alert from '@cloudscape-design/components/alert';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Form from '@cloudscape-design/components/form';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import Input, { type InputProps } from '@cloudscape-design/components/input';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Textarea, { type TextareaProps } from '@cloudscape-design/components/textarea';
import { useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';

import type { RequestFailure } from '../../../../../../lib/aws/request';
import { DiscardDialog } from '../../../components/discard-dialog';
import { actionFailureItem } from '../../../components/failure-states';
import { usePageFlash } from '../../../components/page-flash';
import { useShowsResources } from '../../../components/page-resources';
import { validateTags } from '../../../components/tags';
import { failureOf, usePageSignal } from '../../../components/use-token-listing';
import { ValueText } from '../../../components/value-text';
import type { ScreenPageProps } from '../../../screens';
import { BUS_CHANGE_OPERATIONS, createEventBus } from '../bus-change-api';
import {
  BUS_DESCRIPTION_RULE,
  BUS_NAME_RULE,
  busDescriptionError,
  busNameError,
  createBusInput,
  INITIAL_BUS_FORM,
  type BusForm,
} from '../bus-form';
import { TagEditor, type TagEditorRef } from '../components/tag-editor';
import { busPath, CREATE_EVENT_BUS_TITLE, EVENT_BUSES_PATH } from '../format';

export function CreateEventBusPage({ connection }: ScreenPageProps) {
  useShowsResources('event buses');
  const { engineOrigin } = connection;
  const navigate = useNavigate();
  const flash = usePageFlash();
  const pageSignal = usePageSignal();
  const [form, setForm] = useState(INITIAL_BUS_FORM);
  const [tried, setTried] = useState(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<RequestFailure>();
  const [askDiscard, setAskDiscard] = useState(false);
  const inFlight = useRef(false);
  const nameInput = useRef<InputProps.Ref>(null);
  const descriptionInput = useRef<TextareaProps.Ref>(null);
  const tagEditor = useRef<TagEditorRef>(null);
  const nameError = busNameError(form.name);
  const descriptionError = busDescriptionError(form.description);
  const tagErrors = validateTags(form.tags);
  const unavailable = failure?.kind === 'not-implemented';
  const operation = BUS_CHANGE_OPERATIONS.create;
  const feedback = failure && actionFailureItem(failure, operation, engineOrigin);
  const changed = form.name !== '' || form.description !== '' || form.tags.length > 0;

  function change(patch: Partial<BusForm>) {
    if (!inFlight.current) setForm((current) => ({ ...current, ...patch }));
  }

  function leave() {
    void navigate(EVENT_BUSES_PATH);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current || unavailable || askDiscard) return;
    setTried(true);

    if (nameError) {
      nameInput.current?.focus();
      return;
    }
    if (descriptionError) {
      descriptionInput.current?.focus();
      return;
    }
    const invalidTag = tagErrors.rows.findIndex(({ key, value }) => key !== undefined || value !== undefined);
    if (invalidTag >= 0) {
      tagEditor.current?.focus(invalidTag, tagErrors.rows[invalidTag]?.key ? 'key' : 'value');
      return;
    }
    if (tagErrors.limit) return;
    if (engineOrigin === undefined) {
      setFailure({ kind: 'engine-did-not-answer', operation });
      return;
    }

    const signal = pageSignal();
    inFlight.current = true;
    setPending(true);
    setFailure(undefined);
    try {
      await createEventBus(engineOrigin, createBusInput(form), signal);
    } catch (error) {
      if (signal.aborted) return;
      setFailure(failureOf(error, operation));
      inFlight.current = false;
      setPending(false);
      return;
    }
    if (!signal.aborted) {
      flash.handOver(busPath(form.name), [
        {
          type: 'success',
          content: (
            <>
              Event bus <ValueText kind="name" value={form.name} /> created.
            </>
          ),
        },
      ]);
    }
  }

  return (
    <>
      <form onSubmit={(event) => void handleSubmit(event)} noValidate>
        <Form
          header={<Header variant="h1">{CREATE_EVENT_BUS_TITLE}</Header>}
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
              <Button variant="primary" formAction="submit" loading={pending} disabled={unavailable}>
                {CREATE_EVENT_BUS_TITLE}
              </Button>
            </SpaceBetween>
          }
        >
          <SpaceBetween size="l">
            <Container header={<Header variant="h2">Event bus settings</Header>}>
              <SpaceBetween size="l">
                <FormField label="Event bus name" constraintText={BUS_NAME_RULE} errorText={tried && nameError}>
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
                  label="Description"
                  constraintText={BUS_DESCRIPTION_RULE}
                  errorText={tried && descriptionError}
                >
                  <Textarea
                    ref={descriptionInput}
                    value={form.description}
                    readOnly={pending}
                    onChange={({ detail }) => change({ description: detail.value })}
                  />
                </FormField>
              </SpaceBetween>
            </Container>
            <Container header={<Header variant="h2">Tags</Header>}>
              <TagEditor
                ref={tagEditor}
                tags={form.tags}
                errors={tried ? tagErrors : undefined}
                disabled={pending}
                onChange={(tags) => change({ tags })}
              />
            </Container>
            {feedback && (
              <div role="alert">
                <Alert type={feedback.type} header={feedback.header}>
                  {(failure.kind === 'engine-did-not-answer' || failure.kind === 'emulator-did-not-answer') &&
                    `${operation} failed. `}
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
