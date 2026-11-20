import Alert, { type AlertProps } from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button, { type ButtonProps } from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Form from '@cloudscape-design/components/form';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import Input, { type InputProps } from '@cloudscape-design/components/input';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import RadioGroup from '@cloudscape-design/components/radio-group';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Textarea, { type TextareaProps } from '@cloudscape-design/components/textarea';
import Tiles from '@cloudscape-design/components/tiles';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';

import { CopyValue } from '../../../components/copy-value';
import { DiscardDialog, type DiscardAnswer } from '../../../components/discard-dialog';
import { actionFailureItem } from '../../../components/failure-states';
import { usePageFlash, type FlashItem } from '../../../components/page-flash';
import { useShowsResources } from '../../../components/page-resources';
import { useFollow } from '../../../components/use-follow';
import { failureOf } from '../../../components/use-token-listing';
import type { ScreenPageProps } from '../../../screens';
import { PrivateKey } from '../components/private-key';
import { CREATE_KEY_PAIR_TITLE, KEY_PAIRS_PATH, KEY_PAIRS_WORD, NONE } from '../format';
import { KEY_PAIR_OPERATIONS, type CreatedKeyPair, type KeyFormat, type KeyType } from '../key-pair-api';
import { KEY_NAME_RULE, keyNameMessage, publicKeyMessage, type KeyPairMode } from '../key-pair-form';
import { useCreateKeyPair, useImportKeyPair } from '../key-pair-queries';

// S9, "Create key pair" (issue 553, design task 5): create a new key pair, or import a public key. `key-pair-form.ts`
// checks the fields before anything is sent; then one `CreateKeyPair` or `ImportKeyPair`. After an import the key
// pairs list opens with the result. After a create the page stays and shows the private key, once, in place of the
// form: the answer is held in this page's state alone, so leaving the page, any way, drops it. A refusal stays on the
// form with the emulator's code and message.

const IMPORT_TITLE = 'Import key pair';
const CREATING = 'Creating';
const IMPORTING = 'Importing';

const MODE_ITEMS = [
  {
    value: 'create',
    label: 'Create a new key pair',
    description: 'The emulator makes the key pair and returns the private key once.',
  },
  { value: 'import', label: 'Import a public key', description: 'The emulator stores a public key you already have.' },
];

const TYPE_ITEMS = [
  { value: 'rsa', label: 'RSA' },
  { value: 'ed25519', label: 'ED25519' },
];

const FORMAT_ITEMS = [
  { value: 'pem', label: '.pem' },
  { value: 'ppk', label: '.ppk' },
];

interface KeyPairFormState {
  mode: KeyPairMode;
  name: string;
  type: KeyType;
  format: KeyFormat;
  publicKey: string;
}

const START: KeyPairFormState = { mode: 'create', name: '', type: 'rsa', format: 'pem', publicKey: '' };

/** Whether the form differs from how it opened (`aws-area.md`, entry 5). */
function differs(form: KeyPairFormState): boolean {
  return (
    form.mode !== START.mode ||
    form.name !== '' ||
    form.type !== START.type ||
    form.format !== START.format ||
    form.publicKey !== ''
  );
}

interface Messages {
  name?: string;
  publicKey?: string;
}

function messagesOf(form: KeyPairFormState): Messages {
  const messages: Messages = {};
  const name = keyNameMessage(form.name);
  if (name !== undefined) {
    messages.name = name;
  }
  const publicKey = publicKeyMessage(form.mode, form.publicKey);
  if (publicKey !== undefined) {
    messages.publicKey = publicKey;
  }
  return messages;
}

/** A key pair just created, with the format its private key was asked in. */
interface Created {
  keyPair: CreatedKeyPair;
  format: KeyFormat;
}

/** What S9 shows after a create, in place of the form. */
function CreatedView({ created }: { created: Created }) {
  const handleFollow = useFollow();
  const resultRef = useRef<AlertProps.Ref>(null);
  useEffect(() => {
    resultRef.current?.focus();
  }, []);
  const { keyPair, format } = created;
  return (
    <SpaceBetween size="l">
      <Alert ref={resultRef} type="success" header={`Key pair ${keyPair.name} created`}>
        This is the only time the private key is shown. EmuForge Studio does not keep it: copy or save it before you
        leave this page.
      </Alert>
      <Container header={<Header variant="h2">Private key</Header>}>
        <SpaceBetween size="l">
          {keyPair.privateKey === undefined ? (
            // An answer without a private key: nothing to copy or save.
            <KeyValuePairs items={[{ label: 'Private key', value: NONE }]} />
          ) : (
            <PrivateKey name={keyPair.name} format={format} privateKey={keyPair.privateKey} />
          )}
          <KeyValuePairs
            items={[
              {
                label: 'Fingerprint',
                value: <CopyValue label="Fingerprint" value={keyPair.fingerprint} none={NONE} />,
              },
            ]}
          />
        </SpaceBetween>
      </Container>
      <Box>
        <Button variant="primary" href={KEY_PAIRS_PATH} onFollow={handleFollow}>
          View key pairs
        </Button>
      </Box>
    </SpaceBetween>
  );
}

/**
 * `/aws/ec2/key-pairs/create`. "Create key pair" or "Import key pair" checks the fields, then sends; a failure stays
 * on the form with what was entered, and takes the focus.
 */
export function CreateKeyPairPage({ connection }: ScreenPageProps) {
  useShowsResources(KEY_PAIRS_WORD);
  const navigate = useNavigate();
  const flash = usePageFlash();
  const engineOrigin = connection.engineOrigin;
  const create = useCreateKeyPair(engineOrigin);
  const importKey = useImportKeyPair(engineOrigin);

  const [form, setForm] = useState<KeyPairFormState>(START);
  const [tried, setTried] = useState(false);
  const [failure, setFailure] = useState<FlashItem>();
  const [pending, setPending] = useState(false);
  const [created, setCreated] = useState<Created>();

  const nameRef = useRef<InputProps.Ref>(null);
  const publicKeyRef = useRef<TextareaProps.Ref>(null);
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

  const change = useCallback((update: Partial<KeyPairFormState>) => {
    setForm((current) => ({ ...current, ...update }));
  }, []);

  const messages = tried ? messagesOf(form) : {};
  const importing = form.mode === 'import';
  const operation = importing ? KEY_PAIR_OPERATIONS.importKeyPair : KEY_PAIR_OPERATIONS.createKeyPair;

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
    if (found.publicKey !== undefined) {
      publicKeyRef.current?.focus();
      return;
    }
    const what = importing ? `Importing key pair ${form.name}` : `Creating key pair ${form.name}`;
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
      if (importing) {
        await importKey(form.name, form.publicKey, controller.signal);
        if (controller.signal.aborted) {
          return;
        }
        settle();
        flash.handOver(KEY_PAIRS_PATH, [{ type: 'success', content: `Imported key pair ${form.name}` }]);
      } else {
        const keyPair = await create({ name: form.name, type: form.type, format: form.format }, controller.signal);
        if (controller.signal.aborted) {
          return;
        }
        settle();
        setCreated({ keyPair, format: form.format });
      }
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
    void navigate(KEY_PAIRS_PATH);
  };
  const handleDiscardAnswer = useCallback(
    (answer: DiscardAnswer) => {
      setAsking(false);
      if (answer === 'discard') {
        void navigate(KEY_PAIRS_PATH);
      } else {
        setKept((count) => count + 1);
      }
    },
    [navigate],
  );

  if (created !== undefined) {
    return (
      <SpaceBetween size="l">
        <Header variant="h1">{CREATE_KEY_PAIR_TITLE}</Header>
        <CreatedView created={created} />
      </SpaceBetween>
    );
  }

  const submitText = importing ? IMPORT_TITLE : CREATE_KEY_PAIR_TITLE;
  const pendingText = importing ? IMPORTING : CREATING;

  return (
    <SpaceBetween size="l">
      <Header variant="h1">{CREATE_KEY_PAIR_TITLE}</Header>
      <form onSubmit={(event) => void handleSubmit(event)} noValidate>
        <Form
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button ref={cancelRef} variant="link" formAction="none" onClick={handleCancel}>
                Cancel
              </Button>
              <Button variant="primary" loading={pending} loadingText={pendingText}>
                {pending ? pendingText : submitText}
              </Button>
            </SpaceBetween>
          }
        >
          <SpaceBetween size="l">
            <Container header={<Header variant="h2">Key pair</Header>}>
              <SpaceBetween size="l">
                <FormField label="What to do" stretch>
                  <Tiles
                    value={form.mode}
                    items={MODE_ITEMS}
                    onChange={({ detail }) => {
                      change({ mode: detail.value as KeyPairMode });
                    }}
                  />
                </FormField>
                <FormField label="Name" constraintText={KEY_NAME_RULE} errorText={messages.name}>
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
                {importing ? (
                  <FormField
                    label="Public key"
                    description="In OpenSSH format, as in a .pub file."
                    errorText={messages.publicKey}
                    stretch
                  >
                    <Textarea
                      ref={publicKeyRef}
                      value={form.publicKey}
                      invalid={messages.publicKey !== undefined}
                      spellcheck={false}
                      rows={4}
                      onChange={({ detail }) => {
                        change({ publicKey: detail.value });
                      }}
                    />
                  </FormField>
                ) : (
                  <>
                    <FormField label="Type">
                      <RadioGroup
                        value={form.type}
                        items={TYPE_ITEMS}
                        onChange={({ detail }) => {
                          change({ type: detail.value as KeyType });
                        }}
                      />
                    </FormField>
                    <FormField label="Private key format">
                      <RadioGroup
                        value={form.format}
                        items={FORMAT_ITEMS}
                        onChange={({ detail }) => {
                          change({ format: detail.value as KeyFormat });
                        }}
                      />
                    </FormField>
                  </>
                )}
              </SpaceBetween>
            </Container>

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
