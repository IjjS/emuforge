import Alert, { type AlertProps } from '@cloudscape-design/components/alert';
import Button, { type ButtonProps } from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Form from '@cloudscape-design/components/form';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import Input, { type InputProps } from '@cloudscape-design/components/input';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';

import { DiscardDialog, type DiscardAnswer } from '../../../components/discard-dialog';
import { actionFailureItem } from '../../../components/failure-states';
import { usePageFlash, type FlashItem } from '../../../components/page-flash';
import { useShowsResources } from '../../../components/page-resources';
import { TagsField, type TagsFieldRef } from '../../../components/tags-field';
import { failureOf } from '../../../components/use-token-listing';
import { checkTagRows, type TagRow } from '../../../lib/tag-rows';
import type { ScreenPageProps } from '../../../screens';
import { blockMessage, NAME_CONSTRAINT, nameMessage, VPC_BLOCK } from '../form';
import { CREATE_VPC_TITLE, vpcHref, VPCS_PATH, VPCS_WORD } from '../format';
import { VPC_CHANGE_OPERATIONS, type NewVpc } from '../vpc-changes-api';
import { useCreateVpc } from '../vpc-changes';

// S2, "Create VPC" (issue 574, design task 2): a name, optional, and the IPv4 block. `form.ts` checks both before
// anything is sent; then one `CreateVpc`. On 200 the new VPC's page opens with "Created VPC {id}", handed over to the
// area's flash, so no read the create starts can take it away. A refusal stays on the form with the emulator's code
// and message and every entry. What is entered lives in this page alone.

const CREATING = 'Creating';
const BLOCK_CONSTRAINT = 'An IPv4 block in CIDR notation, from /16 to /28, such as 10.0.0.0/16.';

interface VpcFormState {
  name: string;
  cidr: string;
}

const START: VpcFormState = { name: '', cidr: '' };

interface VpcFormMessages {
  name?: string;
  cidr?: string;
}

function messagesOf(form: VpcFormState): VpcFormMessages {
  const messages: VpcFormMessages = {};
  const name = nameMessage(form.name);
  const cidr = blockMessage(form.cidr, VPC_BLOCK);
  if (name !== undefined) {
    messages.name = name;
  }
  if (cidr !== undefined) {
    messages.cidr = cidr;
  }
  return messages;
}

/** Whether the form differs from how it opened (`aws-area.md`, entry 5). */
function differs(form: VpcFormState): boolean {
  return form.name !== START.name || form.cidr !== START.cidr;
}

/** What `CreateVpc` is sent: the name only when one is given. */
function vpcOf(form: VpcFormState): NewVpc {
  return form.name === '' ? { cidr: form.cidr } : { cidr: form.cidr, name: form.name };
}

/**
 * `/aws/vpc/vpcs/create`. "Create VPC" checks the form, then sends `CreateVpc`; on success the new VPC's page opens
 * with "Created VPC {id}". A failure stays on the form with what was entered, and takes the focus.
 */
export function CreateVpcPage({ connection }: ScreenPageProps) {
  useShowsResources(VPCS_WORD);
  const navigate = useNavigate();
  const flash = usePageFlash();
  const engineOrigin = connection.engineOrigin;
  const create = useCreateVpc(engineOrigin);

  const [form, setForm] = useState<VpcFormState>(START);
  const [tags, setTags] = useState<TagRow[]>([]);
  const [tried, setTried] = useState(false);
  const [failure, setFailure] = useState<FlashItem>();
  const [pending, setPending] = useState(false);

  const nameRef = useRef<InputProps.Ref>(null);
  const cidrRef = useRef<InputProps.Ref>(null);
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

  const change = useCallback((update: Partial<VpcFormState>) => {
    setForm((current) => ({ ...current, ...update }));
  }, []);

  const messages = tried ? messagesOf(form) : {};

  const checkedTags = checkTagRows(tags, form.name === '' ? undefined : 'Name');

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
    if (found.cidr !== undefined) {
      cidrRef.current?.focus();
      return;
    }
    if (checkedTags.firstInvalid !== undefined) {
      tagsRef.current?.focusKey(checkedTags.firstInvalid);
      return;
    }
    const extraTags = checkedTags.tags.length === 0 ? {} : { tags: checkedTags.tags };
    const operation = VPC_CHANGE_OPERATIONS.createVpc;
    const what = `Creating VPC ${form.cidr}`;
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
      const id = await create({ ...vpcOf(form), ...extraTags }, controller.signal);
      if (controller.signal.aborted) {
        return;
      }
      settle();
      flash.handOver(vpcHref(id), [{ type: 'success', content: `Created VPC ${id}` }]);
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
    if (differs(form) || tags.length > 0) {
      setAsking(true);
      return;
    }
    void navigate(VPCS_PATH);
  };
  const handleDiscardAnswer = useCallback(
    (answer: DiscardAnswer) => {
      setAsking(false);
      if (answer === 'discard') {
        void navigate(VPCS_PATH);
      } else {
        setKept((count) => count + 1);
      }
    },
    [navigate],
  );

  return (
    <SpaceBetween size="l">
      <Header variant="h1">{CREATE_VPC_TITLE}</Header>
      <form onSubmit={(event) => void handleSubmit(event)} noValidate>
        <Form
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button ref={cancelRef} variant="link" formAction="none" onClick={handleCancel}>
                Cancel
              </Button>
              <Button variant="primary" loading={pending} loadingText={CREATING}>
                {pending ? CREATING : CREATE_VPC_TITLE}
              </Button>
            </SpaceBetween>
          }
        >
          <SpaceBetween size="l">
            <Container header={<Header variant="h2">VPC</Header>}>
              <SpaceBetween size="l">
                <FormField label="Name - optional" constraintText={NAME_CONSTRAINT} errorText={messages.name}>
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
                <FormField label="IPv4 CIDR block" constraintText={BLOCK_CONSTRAINT} errorText={messages.cidr}>
                  <Input
                    ref={cidrRef}
                    value={form.cidr}
                    invalid={messages.cidr !== undefined}
                    autoComplete={false}
                    spellcheck={false}
                    onChange={({ detail }) => {
                      change({ cidr: detail.value });
                    }}
                  />
                </FormField>
              </SpaceBetween>
            </Container>
            <TagsField ref={tagsRef} rows={tags} onChange={setTags} errors={tried ? checkedTags.errors : undefined} />

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
