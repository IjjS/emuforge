import Alert from '@cloudscape-design/components/alert';
import Button, { type ButtonProps } from '@cloudscape-design/components/button';
import Checkbox from '@cloudscape-design/components/checkbox';
import Container from '@cloudscape-design/components/container';
import ExpandableSection from '@cloudscape-design/components/expandable-section';
import Form from '@cloudscape-design/components/form';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import Input, { type InputProps } from '@cloudscape-design/components/input';
import RadioGroup from '@cloudscape-design/components/radio-group';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router';

import { DiscardDialog, type DiscardAnswer } from '../../../components/discard-dialog';
import { usePageFlash, type FlashItem } from '../../../components/page-flash';
import { useShowsResources } from '../../../components/page-resources';
import { ValueText } from '../../../components/value-text';
import type { ScreenPageProps } from '../../../screens';
import type { ObjectOwnership, PublicAccessBlock, Tag } from '../api';
import {
  bucketKeyShown,
  firstMessageField,
  formMessages,
  initialBucketForm,
  kmsKeyShown,
  nameTakenMessage,
  SETTING_WHAT,
  versioningShown,
  withObjectLock,
  type BucketForm,
  type CreateOutcome,
  type EncryptionChoice,
  type FormMessages,
  type MessageField,
} from '../bucket-form';
import { actionFailure, type ActionFailure } from '../components/action-failure';
import { BucketTags } from '../components/bucket-tags';
import { Quoted } from '../components/quoted';
import { useAnnouncer } from '../components/use-announcer';
import { BUCKETS_PATH, encryptionTypeLabel } from '../format';
import { useCreateBucket } from '../queries';
import { regionText } from '../regions';

// S2, "Create bucket" (issue 256, requirement R6, R9.3, R11.4): the console's sections and fields in the console's
// words (`studio/references/console/s3/create-bucket.yaml`), its field messages and failures in EmuForge's own.
// Nothing is read on opening, and nothing typed is kept anywhere: the form lives as long as the page is open. "Copy
// settings from existing bucket" and choosing a KMS key from a list are not built (R14 item 7). Issue 467: the `h1` has
// no description, the area's frame says where the bucket is made (requirement R3); "Bucket name" states its rule from
// the start (R4); and "Cancel" asks before it discards what was entered (R7).

const TITLE = 'Create bucket';
/**
 * The constraint text under "Bucket name" (issue 467, R4): what the form's own check lets through (`bucket-form.ts`);
 * its rarer rules (two periods in a row, the form of an IP address, reserved prefixes and suffixes) stay messages.
 */
export const NAME_RULE =
  '3 to 63 characters: lowercase letters (a-z), digits, periods (.) and hyphens (-). Begins and ends with a letter or digit.';
/** Studio creates every bucket in this Region of the emulator: no `LocationConstraint` is sent (R6.4). */
const REGION = 'us-east-1';
const REGION_DESCRIPTION = 'Studio creates buckets in this Region of the emulator.';
const KMS_KEY_DESCRIPTION = 'The ARN of a KMS key in the emulator.';
const LOCKED_VERSIONING = 'Object Lock enables Bucket Versioning.';
const CREATING = 'Creating the bucket';
const WITHOUT_IT = 'The bucket was created without it.';

const OWNERSHIP_ITEMS: { value: ObjectOwnership; label: string }[] = [
  { value: 'BucketOwnerEnforced', label: 'Bucket owner enforced' },
  { value: 'BucketOwnerPreferred', label: 'Bucket owner preferred' },
  { value: 'ObjectWriter', label: 'Object writer' },
];

/** The four settings of "Block Public Access settings for this bucket", named as the guide names them (R6.1). */
const BLOCK_SETTINGS: { key: keyof PublicAccessBlock; label: string }[] = [
  { key: 'blockPublicAcls', label: 'BlockPublicAcls' },
  { key: 'ignorePublicAcls', label: 'IgnorePublicAcls' },
  { key: 'blockPublicPolicy', label: 'BlockPublicPolicy' },
  { key: 'restrictPublicBuckets', label: 'RestrictPublicBuckets' },
];

/** The three encryption types, by the console's full names (R5.3, R6.1). */
const ENCRYPTION_ITEMS: { value: EncryptionChoice; label: string }[] = [
  { value: 'SSE-S3', label: encryptionTypeLabel('AES256') },
  { value: 'SSE-KMS', label: encryptionTypeLabel('aws:kms') },
  { value: 'DSSE-KMS', label: encryptionTypeLabel('aws:kms:dsse') },
];

const DISABLE = 'disable';
const ENABLE = 'enable';
const SWITCH_ITEMS = [
  { value: DISABLE, label: 'Disable' },
  { value: ENABLE, label: 'Enable' },
];
const switchValue = (on: boolean) => (on ? ENABLE : DISABLE);

const NO_MESSAGES: FormMessages = { tags: [] };

/**
 * Whether any field, choice or row differs from what the form showed when it opened, what its address preselected
 * included (issue 467, R7). A value typed and removed again does not differ; one kept by a choice no longer shown (a
 * KMS key under SSE-S3) still does, since choosing it again shows it.
 */
function differs(form: BucketForm, opened: BucketForm): boolean {
  const access = form.publicAccess;
  const start = opened.publicAccess;
  return (
    form.name !== opened.name ||
    form.ownership !== opened.ownership ||
    access.blockPublicAcls !== start.blockPublicAcls ||
    access.ignorePublicAcls !== start.ignorePublicAcls ||
    access.blockPublicPolicy !== start.blockPublicPolicy ||
    access.restrictPublicBuckets !== start.restrictPublicBuckets ||
    form.versioning !== opened.versioning ||
    form.tags.length !== opened.tags.length ||
    form.encryption !== opened.encryption ||
    form.kmsKey !== opened.kmsKey ||
    form.bucketKey !== opened.bucketKey ||
    form.objectLock !== opened.objectLock
  );
}

/** The result handed to the list once `CreateBucket` has succeeded and every setting has answered (R6.6). */
function createdResult(name: string, outcome: Extract<CreateOutcome, { outcome: 'created' }>, origin?: string) {
  const success: FlashItem = {
    type: 'success',
    content: <Quoted before="Bucket “" name={name} after="” was created in the local emulator." />,
  };
  const failures = outcome.settingFailures.map(({ setting, failure }): FlashItem => {
    const shown = actionFailure(failure, SETTING_WHAT[setting], origin);
    return {
      type: shown.type,
      header: shown.header,
      content: (
        <>
          {shown.detail}
          {shown.detail === undefined ? WITHOUT_IT : ` ${WITHOUT_IT}`}
        </>
      ),
    };
  });
  return [success, ...failures] as const;
}

/**
 * `/aws/s3/bucket/create`: the form, opened with SSE-KMS chosen when the address says `?encryption=sse-kms` (R6.2).
 * "Create bucket" checks the fields (R6.3), then sends the requests of R6.4 in order; once `CreateBucket` has
 * succeeded and every setting has answered, the list opens with the result in the area's flash (R6.6). A failed
 * name check or `CreateBucket` keeps the form with every value and shows the failure above the buttons.
 */
export function CreateBucketPage({ connection }: ScreenPageProps) {
  useShowsResources('buckets');
  const navigate = useNavigate();
  const flash = usePageFlash();
  const { search } = useLocation();
  const engineOrigin = connection.engineOrigin;
  const create = useCreateBucket(engineOrigin);
  const [announcement, announce] = useAnnouncer();

  // What the address preselected, kept as the form opened with it (R6.2; issue 467, R7).
  const [opened] = useState<BucketForm>(() => initialBucketForm(new URLSearchParams(search)));
  const [form, setForm] = useState<BucketForm>(opened);
  const [messages, setMessages] = useState<FormMessages>(NO_MESSAGES);
  const [nameTaken, setNameTaken] = useState<string>();
  const [failure, setFailure] = useState<ActionFailure>();
  const [pending, setPending] = useState(false);

  const nameRef = useRef<InputProps.Ref>(null);
  const kmsKeyRef = useRef<InputProps.Ref>(null);
  const tagRefs = useRef(new Map<string, InputProps.Ref>());

  // A press while an earlier one is in flight sends nothing, also before the page has rendered that it is (a double
  // click). The requests stop when the page is left, so nothing is handed to a page the user did not go to.
  const busy = useRef(false);
  const inFlight = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      inFlight.current?.abort();
    },
    [],
  );

  const change = useCallback((update: (current: BucketForm) => BucketForm) => {
    setForm(update);
  }, []);

  const focusField = useCallback((field: MessageField) => {
    switch (field.field) {
      case 'name':
        nameRef.current?.focus();
        return;
      case 'kms-key':
        kmsKeyRef.current?.focus();
        return;
      case 'tag-key':
      case 'tag-value':
        tagRefs.current.get(`${field.field}-${String(field.index)}`)?.focus();
    }
  }, []);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy.current) {
      return;
    }
    const found = formMessages(form);
    setMessages(found);
    setNameTaken(undefined);
    setFailure(undefined);
    const first = firstMessageField(found);
    if (first !== undefined) {
      focusField(first);
      return;
    }
    if (engineOrigin === undefined) {
      const shown = actionFailure({ kind: 'engine-did-not-answer', operation: 'ListBuckets' }, CREATING, undefined);
      setFailure(shown);
      announce(shown.headline);
      return;
    }
    busy.current = true;
    setPending(true);
    const controller = new AbortController();
    inFlight.current = controller;
    let outcome: CreateOutcome;
    try {
      outcome = await create(form, controller.signal);
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }
      // Not a failed request (those are outcomes): the form is usable again before the error goes on.
      inFlight.current = null;
      busy.current = false;
      setPending(false);
      throw error;
    }
    if (controller.signal.aborted) {
      return;
    }
    inFlight.current = null;
    busy.current = false;
    setPending(false);
    switch (outcome.outcome) {
      case 'name-taken':
        setNameTaken(form.name);
        nameRef.current?.focus();
        return;
      case 'failed': {
        const shown = actionFailure(
          outcome.failure,
          outcome.step === 'check' ? 'Checking the bucket name' : CREATING,
          engineOrigin,
        );
        setFailure(shown);
        announce(shown.headline);
        return;
      }
      case 'created':
        flash.handOver(BUCKETS_PATH, createdResult(form.name, outcome, engineOrigin));
    }
  };

  // "Cancel" leaves at once while nothing differs from what the form showed when it opened; otherwise it asks (R7).
  // The dialog is on the page only while it asks; once it is answered "keep", focus is back on "Cancel".
  const [asking, setAsking] = useState(false);
  const cancelRef = useRef<ButtonProps.Ref>(null);
  const [kept, setKept] = useState(0);
  useEffect(() => {
    if (kept > 0) {
      cancelRef.current?.focus();
    }
  }, [kept]);
  const handleCancel = () => {
    if (differs(form, opened)) {
      setAsking(true);
      return;
    }
    void navigate(BUCKETS_PATH);
  };
  const handleDiscardAnswer = useCallback(
    (answer: DiscardAnswer) => {
      setAsking(false);
      if (answer === 'discard') {
        void navigate(BUCKETS_PATH);
      } else {
        setKept((count) => count + 1);
      }
    },
    [navigate],
  );

  const setTags = (update: (tags: Tag[]) => Tag[]) => {
    change((current) => ({ ...current, tags: update(current.tags) }));
  };

  const nameMessage = nameTaken === undefined ? messages.name : nameTakenMessage(nameTaken);
  // A field's message is free text, the name it quotes included, as on Lambda's and IAM's forms (issue 467, R6): the
  // field is described by the message's sentence as it is written.
  const nameMessageShown = nameMessage === undefined ? undefined : <ValueText kind="text" value={nameMessage} />;
  const locked = form.objectLock;

  return (
    <SpaceBetween size="l">
      <Header variant="h1">{TITLE}</Header>
      <form onSubmit={(event) => void handleSubmit(event)} noValidate>
        <Form
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button ref={cancelRef} variant="link" formAction="none" onClick={handleCancel}>
                Cancel
              </Button>
              <Button variant="primary" loading={pending} loadingText={CREATING}>
                {TITLE}
              </Button>
            </SpaceBetween>
          }
        >
          <SpaceBetween size="l">
            <Container header={<Header variant="h2">General configuration</Header>}>
              <SpaceBetween size="l">
                <FormField label="Region" description={REGION_DESCRIPTION}>
                  <Input value={regionText(REGION)} readOnly />
                </FormField>
                <FormField label="Bucket name" constraintText={NAME_RULE} errorText={nameMessageShown}>
                  <Input
                    ref={nameRef}
                    value={form.name}
                    invalid={nameMessage !== undefined}
                    autoComplete={false}
                    spellcheck={false}
                    onChange={({ detail }) => {
                      change((current) => ({ ...current, name: detail.value }));
                    }}
                  />
                </FormField>
              </SpaceBetween>
            </Container>

            <Container header={<Header variant="h2">Object Ownership</Header>}>
              <FormField label="Object Ownership">
                <RadioGroup
                  value={form.ownership}
                  items={OWNERSHIP_ITEMS}
                  onChange={({ detail }) => {
                    change((current) => ({ ...current, ownership: detail.value as ObjectOwnership }));
                  }}
                />
              </FormField>
            </Container>

            <Container header={<Header variant="h2">Block Public Access settings for this bucket</Header>}>
              <SpaceBetween size="s">
                {BLOCK_SETTINGS.map(({ key, label }) => (
                  <FormField key={key} label={label}>
                    <Checkbox
                      checked={form.publicAccess[key]}
                      onChange={({ detail }) => {
                        change((current) => ({
                          ...current,
                          publicAccess: { ...current.publicAccess, [key]: detail.checked },
                        }));
                      }}
                    />
                  </FormField>
                ))}
              </SpaceBetween>
            </Container>

            <Container header={<Header variant="h2">Bucket Versioning</Header>}>
              <FormField label="Bucket Versioning" {...(locked && { description: LOCKED_VERSIONING })}>
                <RadioGroup
                  value={switchValue(versioningShown(form))}
                  items={SWITCH_ITEMS}
                  readOnly={locked}
                  onChange={({ detail }) => {
                    change((current) => ({ ...current, versioning: detail.value === ENABLE }));
                  }}
                />
              </FormField>
            </Container>

            <BucketTags
              form={form}
              messages={messages.tags}
              onChange={setTags}
              onRemove={(index) => {
                setMessages((current) => ({ ...current, tags: current.tags.filter((_, at) => at !== index) }));
              }}
              tagRefs={tagRefs}
            />

            <Container header={<Header variant="h2">Default encryption</Header>}>
              <SpaceBetween size="l">
                <FormField label="Encryption type">
                  <RadioGroup
                    value={form.encryption}
                    items={ENCRYPTION_ITEMS}
                    onChange={({ detail }) => {
                      change((current) => ({ ...current, encryption: detail.value as EncryptionChoice }));
                    }}
                  />
                </FormField>
                {kmsKeyShown(form) && (
                  <FormField label="AWS KMS key" description={KMS_KEY_DESCRIPTION} errorText={messages.kmsKey}>
                    <Input
                      ref={kmsKeyRef}
                      value={form.kmsKey}
                      invalid={messages.kmsKey !== undefined}
                      autoComplete={false}
                      spellcheck={false}
                      onChange={({ detail }) => {
                        change((current) => ({ ...current, kmsKey: detail.value }));
                      }}
                    />
                  </FormField>
                )}
                {bucketKeyShown(form) && (
                  <FormField label="Bucket Key">
                    <RadioGroup
                      value={switchValue(form.bucketKey)}
                      items={SWITCH_ITEMS}
                      onChange={({ detail }) => {
                        change((current) => ({ ...current, bucketKey: detail.value === ENABLE }));
                      }}
                    />
                  </FormField>
                )}
              </SpaceBetween>
            </Container>

            <ExpandableSection variant="container" headerText="Advanced settings" defaultExpanded>
              <FormField label="Object Lock">
                <RadioGroup
                  value={switchValue(form.objectLock)}
                  items={SWITCH_ITEMS}
                  onChange={({ detail }) => {
                    change((current) => withObjectLock(current, detail.value === ENABLE));
                  }}
                />
              </FormField>
            </ExpandableSection>

            {failure !== undefined && (
              <Alert type={failure.type} header={failure.header}>
                {failure.detail}
              </Alert>
            )}
          </SpaceBetween>
        </Form>
      </form>
      {asking && <DiscardDialog visible onAnswer={handleDiscardAnswer} />}
      {announcement}
    </SpaceBetween>
  );
}
