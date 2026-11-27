import Alert, { type AlertProps } from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button, { type ButtonProps } from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Form from '@cloudscape-design/components/form';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import Input, { type InputProps } from '@cloudscape-design/components/input';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';

import { ChoiceSelect } from '../../../components/choice-select';
import { DiscardDialog, type DiscardAnswer } from '../../../components/discard-dialog';
import { actionFailureItem, readFailureState } from '../../../components/failure-states';
import { usePageFlash, type FlashItem } from '../../../components/page-flash';
import { useShowsResources } from '../../../components/page-resources';
import { TagsField, type TagsFieldRef } from '../../../components/tags-field';
import { failureOf } from '../../../components/use-token-listing';
import type { ScreenPageProps } from '../../../screens';
import type { VpcChoice } from '../../../lib/ec2-network-choices';
import { checkTagRows, type TagRow } from '../../../lib/tag-rows';
import { useDefaultVpc, vpcChoices } from '../choices-queries';
import { CREATE_SECURITY_GROUP_TITLE, securityGroupHref, SECURITY_GROUPS_PATH, SECURITY_GROUPS_WORD } from '../format';
import { GROUP_DESCRIPTION_RULE, groupFormMessages, GROUP_NAME_RULE, type GroupFormMessages } from '../group-form';
import { GROUP_FORM_OPERATIONS, type NewSecurityGroup } from '../group-form-api';
import { useCreateSecurityGroup } from '../group-form-queries';

// S5, "Create security group" (issue 553, design task 4): the name, the description and, optionally, the VPC, chosen
// a page of `DescribeVpcs` at a time when the field opens. `group-form.ts` checks the form before anything is sent;
// then one `CreateSecurityGroup`. On 200 the new group's page opens with the result; a refusal (a name the VPC already
// has included) stays on the form with the emulator's code and message and every entry. What is entered lives in this
// page alone.

const CREATING = 'Creating';

interface GroupFormState {
  name: string;
  description: string;
  vpc: VpcChoice | undefined;
  tags: TagRow[];
}

const START: GroupFormState = { name: '', description: '', vpc: undefined, tags: [] };

/** Whether the form differs from how it opened (`aws-area.md`, entry 5). */
function differs(form: GroupFormState): boolean {
  return form.name !== '' || form.description !== '' || form.vpc !== undefined || form.tags.length > 0;
}

function messagesOf(form: GroupFormState): GroupFormMessages {
  return groupFormMessages({ name: form.name, description: form.description });
}

/** What `CreateSecurityGroup` is sent for the form: the VPC only when one was chosen. */
function groupOf(form: GroupFormState, tags: TagRow[]): NewSecurityGroup {
  const group: NewSecurityGroup = { name: form.name, description: form.description };
  if (form.vpc !== undefined) {
    group.vpcId = form.vpc.id;
  }
  if (tags.length > 0) group.tags = tags;
  return group;
}

/**
 * `/aws/ec2/security-groups/create`. "Create security group" checks the form, then sends `CreateSecurityGroup`; on
 * success the new group's page opens with "Created security group {name}". A failure stays on the form with what was
 * entered, and takes the focus.
 */
export function CreateGroupPage({ connection }: ScreenPageProps) {
  useShowsResources(SECURITY_GROUPS_WORD);
  const navigate = useNavigate();
  const flash = usePageFlash();
  const engineOrigin = connection.engineOrigin;
  const create = useCreateSecurityGroup(engineOrigin);
  const defaultVpc = useDefaultVpc(engineOrigin);
  const defaultVpcId = defaultVpc.vpc?.id;
  const defaultVpcDescription =
    defaultVpcId === undefined
      ? 'The emulator creates the group in its default VPC.'
      : `The emulator creates the group in its default VPC, ${defaultVpcId}.`;
  const vpcFailure = defaultVpc.failure && readFailureState(defaultVpc.failure, connection, 'default VPC');

  const [form, setForm] = useState<GroupFormState>(START);
  const [tried, setTried] = useState(false);
  const [failure, setFailure] = useState<FlashItem>();
  const [pending, setPending] = useState(false);

  const nameRef = useRef<InputProps.Ref>(null);
  const descriptionRef = useRef<InputProps.Ref>(null);
  const tagsRef = useRef<TagsFieldRef>(null);
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

  const change = useCallback((update: Partial<GroupFormState>) => {
    setForm((current) => ({ ...current, ...update }));
  }, []);

  const messages = tried ? messagesOf(form) : {};
  const tags = checkTagRows(form.tags);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy.current) {
      return;
    }
    setTried(true);
    setFailure(undefined);
    const found = messagesOf(form);
    if (found.name !== undefined) {
      nameRef.current?.focus();
      return;
    }
    if (found.description !== undefined) {
      descriptionRef.current?.focus();
      return;
    }
    if (tags.firstInvalid !== undefined) {
      tagsRef.current?.focusKey(tags.firstInvalid);
      return;
    }
    const operation = GROUP_FORM_OPERATIONS.createSecurityGroup;
    const what = `Creating security group ${form.name}`;
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
      const id = await create(groupOf(form, tags.tags), controller.signal);
      if (controller.signal.aborted) {
        return;
      }
      settle();
      flash.handOver(securityGroupHref(id), [{ type: 'success', content: `Created security group ${form.name}` }]);
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
    void navigate(SECURITY_GROUPS_PATH);
  };
  const handleDiscardAnswer = useCallback(
    (answer: DiscardAnswer) => {
      setAsking(false);
      if (answer === 'discard') {
        void navigate(SECURITY_GROUPS_PATH);
      } else {
        setKept((count) => count + 1);
      }
    },
    [navigate],
  );

  return (
    <SpaceBetween size="l">
      <Header variant="h1">{CREATE_SECURITY_GROUP_TITLE}</Header>
      <form onSubmit={(event) => void handleSubmit(event)} noValidate>
        <Form
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button ref={cancelRef} variant="link" formAction="none" onClick={handleCancel}>
                Cancel
              </Button>
              <Button variant="primary" loading={pending} loadingText={CREATING}>
                {pending ? CREATING : CREATE_SECURITY_GROUP_TITLE}
              </Button>
            </SpaceBetween>
          }
        >
          <SpaceBetween size="l">
            <Container header={<Header variant="h2">Security group</Header>}>
              <SpaceBetween size="l">
                <FormField label="Name" constraintText={GROUP_NAME_RULE} errorText={messages.name}>
                  <Input
                    ref={nameRef}
                    value={form.name}
                    invalid={messages.name !== undefined}
                    autoComplete={false}
                    spellcheck={false}
                    onChange={({ detail }) => {
                      change({ name: detail.value });
                    }}
                  />
                </FormField>
                <FormField
                  label="Description"
                  constraintText={GROUP_DESCRIPTION_RULE}
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
                <FormField label="VPC - optional">
                  <ChoiceSelect<VpcChoice>
                    source={vpcChoices(engineOrigin)}
                    connection={connection}
                    things="VPCs"
                    fixed="The default VPC"
                    fixedDescription={defaultVpcDescription}
                    value={form.vpc}
                    onChange={(vpc) => {
                      change({ vpc });
                    }}
                  />
                </FormField>
                {vpcFailure !== undefined && (
                  <SpaceBetween size="xxs">
                    <StatusIndicator type={vpcFailure.type}>{vpcFailure.first}</StatusIndicator>
                    {vpcFailure.detail !== undefined && <Box variant="small">{vpcFailure.detail}</Box>}
                    {defaultVpc.failure?.kind !== 'not-implemented' && (
                      <Button variant="inline-link" formAction="none" onClick={defaultVpc.retry}>
                        Retry
                      </Button>
                    )}
                  </SpaceBetween>
                )}
              </SpaceBetween>
            </Container>

            <TagsField
              ref={tagsRef}
              rows={form.tags}
              errors={tried ? tags.errors : undefined}
              onChange={(rows) => change({ tags: rows })}
              disabled={pending}
            />

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
    </SpaceBetween>
  );
}
