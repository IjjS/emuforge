import Alert, { type AlertProps } from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Form from '@cloudscape-design/components/form';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import Input, { type InputProps } from '@cloudscape-design/components/input';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Textarea, { type TextareaProps } from '@cloudscape-design/components/textarea';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';

import { DiscardDialog, type DiscardAnswer } from '../../../components/discard-dialog';
import { usePageFlash, type FlashItem } from '../../../components/page-flash';
import { useShowsResources } from '../../../components/page-resources';
import type { ScreenPageProps } from '../../../screens';
import { documentErrorText, POLICY_SKELETON } from '../document-text';
import { POLICIES_PATH, policyPath } from '../format';
import { failureOf, useCreatePolicy } from '../queries';
import { DocumentEditor } from '../components/document-editor';
import { actionFailureItem } from '../components/failures';

// IAM's "Create policy" (issue 535, S6): a name, a description (optional) and the document as JSON text, starting
// from the skeleton. Studio checks, in this order, the name's rule, the description's length and that the text is one
// JSON value, each message at its field; then sends one `CreatePolicy` with the text as typed. A refusal keeps the form
// and what was typed, with the failure above the buttons; the new policy's page opens with the result. What is typed
// lives in this page alone.

/** The page's title, and its last crumb. */
export const CREATE_POLICY_TITLE = 'Create policy';

/** The longest name and description the emulator was seen to accept (requirement, probe-1, probe-4). */
const NAME_MAX = 128;
const DESCRIPTION_MAX = 1000;

/** A policy name's alphabet. */
const NAME_ALPHABET = /^[A-Za-z0-9+=,.@_-]+$/;

export const NAME_CONSTRAINT = '1 to 128 characters: letters (A-Z, a-z), digits and the characters + = , . @ _ -.';
export const DESCRIPTION_CONSTRAINT = 'Up to 1000 characters.';

const MESSAGES = {
  nameEmpty: 'Enter a policy name.',
  nameLength: `The name can have up to ${String(NAME_MAX)} characters.`,
  nameSigns: 'The name can have only letters, digits and the characters + = , . @ _ -.',
  description: `The description can have up to ${String(DESCRIPTION_MAX)} characters.`,
};

interface Values {
  name: string;
  description: string;
  document: string;
}

const START: Values = { name: '', description: '', document: POLICY_SKELETON };

interface Messages {
  name?: string;
  description?: string;
  document?: string;
}

function nameMessage(name: string): string | undefined {
  if (name === '') {
    return MESSAGES.nameEmpty;
  }
  if (name.length > NAME_MAX) {
    return MESSAGES.nameLength;
  }
  return NAME_ALPHABET.test(name) ? undefined : MESSAGES.nameSigns;
}

/** Each field's message, in the order of the checks. */
function messagesOf(values: Values): Messages {
  const name = nameMessage(values.name);
  const description = values.description.length > DESCRIPTION_MAX ? MESSAGES.description : undefined;
  const document = documentErrorText(values.document);
  return {
    ...(name !== undefined && { name }),
    ...(description !== undefined && { description }),
    ...(document !== undefined && { document }),
  };
}

function differsFromStart(values: Values): boolean {
  return values.name !== START.name || values.description !== START.description || values.document !== START.document;
}

/**
 * `/aws/iam/policies/create`: "Create policy". While the request is in flight the button shows progress and a second
 * press sends nothing. "Cancel" leaves at once while nothing differs from what the form opened with, and asks first
 * otherwise.
 */
export function CreatePolicyPage({ connection }: ScreenPageProps) {
  useShowsResources('policies');
  const navigate = useNavigate();
  const flash = usePageFlash();
  const engineOrigin = connection.engineOrigin;
  const create = useCreatePolicy(engineOrigin);
  const pending = create.isPending;
  const submitting = useRef(false);

  const [values, setValues] = useState<Values>(START);
  // Once "Create policy" was pressed, every field shows its message and follows what is typed.
  const [checked, setChecked] = useState(false);
  const messages = checked ? messagesOf(values) : {};
  const [failure, setFailure] = useState<FlashItem>();
  const failureRef = useRef<AlertProps.Ref>(null);
  useEffect(() => {
    if (failure !== undefined) {
      failureRef.current?.focus();
    }
  }, [failure]);

  const nameRef = useRef<InputProps.Ref>(null);
  const descriptionRef = useRef<TextareaProps.Ref>(null);
  const documentHolder = useRef<HTMLDivElement>(null);

  const change = (part: Partial<Values>) => {
    setValues((current) => ({ ...current, ...part }));
  };

  const handleSubmit = (event?: FormEvent) => {
    event?.preventDefault();
    if (pending || submitting.current) {
      return;
    }
    setChecked(true);
    const found = messagesOf(values);
    if (found.name !== undefined) {
      nameRef.current?.focus();
      return;
    }
    if (found.description !== undefined) {
      descriptionRef.current?.focus();
      return;
    }
    if (found.document !== undefined) {
      documentHolder.current?.querySelector('textarea')?.focus();
      return;
    }
    setFailure(undefined);
    submitting.current = true;
    const name = values.name;
    create.mutate(
      {
        name,
        document: values.document,
        ...(values.description !== '' && { description: values.description }),
      },
      {
        onSuccess: (arn) => {
          flash.handOver(policyPath(arn), [{ type: 'success', content: `Policy ${name} created.` }]);
        },
        onError: (error) => {
          submitting.current = false;
          setFailure(actionFailureItem(failureOf(error), 'Creating the policy', engineOrigin));
        },
      },
    );
  };

  const [asking, setAsking] = useState(false);
  const handleCancel = () => {
    if (pending) {
      return;
    }
    if (differsFromStart(values)) {
      setAsking(true);
      return;
    }
    void navigate(POLICIES_PATH);
  };
  const handleDiscardAnswer = useCallback(
    (answer: DiscardAnswer) => {
      setAsking(false);
      if (answer === 'discard') {
        void navigate(POLICIES_PATH);
      }
    },
    [navigate],
  );

  return (
    <>
      <form onSubmit={handleSubmit} noValidate>
        <Form
          header={<Header variant="h1">{CREATE_POLICY_TITLE}</Header>}
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button formAction="none" variant="link" disabled={pending} onClick={handleCancel}>
                Cancel
              </Button>
              <Button variant="primary" loading={pending} loadingText="Creating the policy">
                {pending ? 'Creating the policy' : CREATE_POLICY_TITLE}
              </Button>
            </SpaceBetween>
          }
        >
          <SpaceBetween size="l">
            <Container header={<Header variant="h2">Policy details</Header>}>
              <SpaceBetween size="l">
                <FormField label="Policy name" constraintText={NAME_CONSTRAINT} errorText={messages.name}>
                  <Input
                    ref={nameRef}
                    value={values.name}
                    disabled={pending}
                    invalid={messages.name !== undefined}
                    onChange={({ detail }) => {
                      change({ name: detail.value });
                    }}
                  />
                </FormField>
                <FormField
                  label={
                    <>
                      Description <i>- optional</i>
                    </>
                  }
                  constraintText={DESCRIPTION_CONSTRAINT}
                  errorText={messages.description}
                >
                  <Textarea
                    ref={descriptionRef}
                    value={values.description}
                    rows={3}
                    disabled={pending}
                    invalid={messages.description !== undefined}
                    onChange={({ detail }) => {
                      change({ description: detail.value });
                    }}
                  />
                </FormField>
              </SpaceBetween>
            </Container>
            <Container>
              <div ref={documentHolder}>
                <DocumentEditor
                  label="Policy document"
                  errorText={messages.document}
                  value={values.document}
                  disabled={pending}
                  onChange={(document) => {
                    change({ document });
                  }}
                />
              </div>
            </Container>
            {failure !== undefined && (
              <Box>
                <Alert ref={failureRef} type={failure.type} header={failure.header}>
                  {failure.content}
                </Alert>
              </Box>
            )}
          </SpaceBetween>
        </Form>
      </form>
      {asking && <DiscardDialog visible onAnswer={handleDiscardAnswer} />}
    </>
  );
}
