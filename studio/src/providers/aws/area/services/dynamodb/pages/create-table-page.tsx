import Alert from '@cloudscape-design/components/alert';
import Button, { type ButtonProps } from '@cloudscape-design/components/button';
import ColumnLayout from '@cloudscape-design/components/column-layout';
import Container from '@cloudscape-design/components/container';
import Form from '@cloudscape-design/components/form';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import Input, { type InputProps } from '@cloudscape-design/components/input';
import RadioGroup from '@cloudscape-design/components/radio-group';
import Select, { type SelectProps } from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useCallback, useEffect, useRef, useState, type FormEvent, type RefObject } from 'react';
import { useNavigate } from 'react-router';

import { DiscardDialog, type DiscardAnswer } from '../../../components/discard-dialog';
import { actionFailureItem, useAnnouncer } from '../../../components/failure-states';
import { usePageFlash } from '../../../components/page-flash';
import { useShowsResources } from '../../../components/page-resources';
import { ValueText } from '../../../components/value-text';
import type { ScreenPageProps } from '../../../screens';
import type { KeyType, NewTable } from '../api';
import { tablePath, TABLES_PATH } from '../format';
import { useCreateTable } from '../queries';
import { MAX_NAME_LENGTH, MIN_NAME_LENGTH, NAME_ALPHABET } from '../start-name';

// DynamoDB's "Create table", S3 (issue 496, design.md task 4): a name, a partition key and an optional sort key with
// their types, and the capacity mode. Nothing is read on opening, and nothing typed is kept anywhere: the form lives
// as long as the page is open. Each limit the form states and checks is one the emulator was seen to refuse past
// (requirement, probe-5 §1, probe-2 §5).

/** The page's title, its `h1`, its crumb and its submit button. */
export const CREATE_TABLE_TITLE = 'Create table';

const NAME_RULE = '3 to 255 characters: letters (A-Z, a-z), digits, underscores (_), periods (.) and hyphens (-).';
const PARTITION_KEY_RULE = '1 to 255 characters.';
const SORT_KEY_RULE = 'Up to 255 characters.';
const UNITS_RULE = 'A whole number of 1 or more.';

const ENTER_NAME = 'Enter a table name.';
const NAME_LENGTH = 'The name must have 3 to 255 characters.';
const NAME_CHARACTERS = 'Use only letters, digits, underscore (_), period (.) and hyphen (-).';
const ENTER_PARTITION_KEY = 'Enter a partition key.';
const KEY_LENGTH = 'A key name can have up to 255 characters.';
const SAME_KEYS = 'The sort key must differ from the partition key.';
const UNITS = 'Enter a whole number of 1 or more.';

const CREATING = 'Creating the table';

/** The longest key name the emulator takes (probe-5 §1). */
const MAX_KEY_LENGTH = 255;

const KEY_TYPES: readonly (SelectProps.Option & { value: KeyType })[] = [
  { value: 'S', label: 'String' },
  { value: 'N', label: 'Number' },
  { value: 'B', label: 'Binary' },
];

type Mode = 'on-demand' | 'provisioned';

const MODES: { value: Mode; label: string }[] = [
  { value: 'on-demand', label: 'On-demand' },
  { value: 'provisioned', label: 'Provisioned' },
];

/** What the form holds, as typed. */
interface TableForm {
  name: string;
  partitionKey: string;
  partitionKeyType: KeyType;
  sortKey: string;
  sortKeyType: KeyType;
  mode: Mode;
  read: string;
  write: string;
}

const OPENED: TableForm = {
  name: '',
  partitionKey: '',
  partitionKeyType: 'S',
  sortKey: '',
  sortKeyType: 'S',
  mode: 'on-demand',
  read: '5',
  write: '5',
};

type Field = 'name' | 'partitionKey' | 'sortKey' | 'read' | 'write';

/** The fields in the order they are on the page: the first with a message takes focus. */
const FIELDS: readonly Field[] = ['name', 'partitionKey', 'sortKey', 'read', 'write'];

type Messages = Partial<Record<Field, string>>;

function nameMessage(name: string): string | undefined {
  if (name === '') {
    return ENTER_NAME;
  }
  const length = [...name].length;
  if (length < MIN_NAME_LENGTH || length > MAX_NAME_LENGTH) {
    return NAME_LENGTH;
  }
  return [...name].every((character) => NAME_ALPHABET.includes(character)) ? undefined : NAME_CHARACTERS;
}

function unitsMessage(units: string): string | undefined {
  return /^[0-9]+$/.test(units) && Number(units) >= 1 && Number.isSafeInteger(Number(units)) ? undefined : UNITS;
}

/** The message of each field whose value the form does not let through (design.md task 4). */
function formMessages(form: TableForm): Messages {
  const messages: Messages = {};
  const name = nameMessage(form.name);
  if (name !== undefined) messages.name = name;
  if (form.partitionKey === '') {
    messages.partitionKey = ENTER_PARTITION_KEY;
  } else if ([...form.partitionKey].length > MAX_KEY_LENGTH) {
    messages.partitionKey = KEY_LENGTH;
  }
  if ([...form.sortKey].length > MAX_KEY_LENGTH) {
    messages.sortKey = KEY_LENGTH;
  } else if (form.sortKey !== '' && form.sortKey === form.partitionKey) {
    messages.sortKey = SAME_KEYS;
  }
  if (form.mode === 'provisioned') {
    const read = unitsMessage(form.read);
    const write = unitsMessage(form.write);
    if (read !== undefined) messages.read = read;
    if (write !== undefined) messages.write = write;
  }
  return messages;
}

/** What "Create table" sends for a form that passed every check. */
function newTable(form: TableForm): NewTable {
  return {
    name: form.name,
    partitionKey: { name: form.partitionKey, type: form.partitionKeyType },
    ...(form.sortKey === '' ? {} : { sortKey: { name: form.sortKey, type: form.sortKeyType } }),
    capacity:
      form.mode === 'provisioned'
        ? { mode: 'provisioned', read: Number(form.read), write: Number(form.write) }
        : { mode: 'on-demand' },
  };
}

function differs(form: TableForm): boolean {
  return (Object.keys(OPENED) as (keyof TableForm)[]).some((key) => form[key] !== OPENED[key]);
}

function keyTypeOption(type: KeyType): SelectProps.Option {
  return KEY_TYPES.find((option) => option.value === type) ?? { value: type, label: type };
}

/** A field's message, rendered as free text. */
function shown(message: string | undefined) {
  return message === undefined ? undefined : <ValueText kind="text" value={message} />;
}

/**
 * `/aws/dynamodb/tables/create`: the form. "Create table" checks the fields, then sends one `CreateTable`; on its
 * success the new table's page opens with the result in the area's flash, and a refusal keeps the form with every
 * value and shows the failure above the buttons.
 */
export function CreateTablePage({ connection }: ScreenPageProps) {
  useShowsResources('tables');
  const navigate = useNavigate();
  const flash = usePageFlash();
  const engineOrigin = connection.engineOrigin;
  const creation = useCreateTable(engineOrigin);
  const [announcement, announce] = useAnnouncer();

  const [form, setForm] = useState<TableForm>(OPENED);
  const [messages, setMessages] = useState<Messages>({});

  const nameRef = useRef<InputProps.Ref>(null);
  const partitionKeyRef = useRef<InputProps.Ref>(null);
  const sortKeyRef = useRef<InputProps.Ref>(null);
  const readRef = useRef<InputProps.Ref>(null);
  const writeRef = useRef<InputProps.Ref>(null);
  const focusField = (field: Field) => {
    const refs: Record<Field, RefObject<InputProps.Ref | null>> = {
      name: nameRef,
      partitionKey: partitionKeyRef,
      sortKey: sortKeyRef,
      read: readRef,
      write: writeRef,
    };
    refs[field].current?.focus();
  };

  const change = <K extends keyof TableForm>(key: K, value: TableForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  // The emulator accepted the table: its page opens, once, with the result.
  const handedOver = useRef(false);
  const { created, failure, pending } = creation;
  useEffect(() => {
    if (created !== undefined && !handedOver.current) {
      handedOver.current = true;
      flash.handOver(tablePath(created), [{ type: 'success', content: `Table ${created} is being created.` }]);
    }
  }, [created, flash]);

  // A refusal stays above the buttons until the next press sends again; it is announced once.
  const failureItem = failure === undefined || pending ? undefined : actionFailureItem(failure, CREATING, engineOrigin);
  const [seenFailure, setSeenFailure] = useState(failure);
  if (failure !== seenFailure) {
    setSeenFailure(failure);
    if (failure !== undefined) {
      announce(`${CREATING} failed`);
    }
  }

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (pending) {
      return;
    }
    const found = formMessages(form);
    setMessages(found);
    const first = FIELDS.find((field) => found[field] !== undefined);
    if (first !== undefined) {
      focusField(first);
      return;
    }
    creation.create(newTable(form));
  };

  // "Cancel" leaves at once while nothing differs from what the form showed when it opened; otherwise it asks
  // (`aws-area.md`, entry 5). Once it is answered "keep", focus is back on "Cancel".
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
    void navigate(TABLES_PATH);
  };
  const handleDiscardAnswer = useCallback(
    (answer: DiscardAnswer) => {
      setAsking(false);
      if (answer === 'discard') {
        void navigate(TABLES_PATH);
      } else {
        setKept((count) => count + 1);
      }
    },
    [navigate],
  );

  const provisioned = form.mode === 'provisioned';

  return (
    <SpaceBetween size="l">
      <Header variant="h1">{CREATE_TABLE_TITLE}</Header>
      <form onSubmit={handleSubmit} noValidate>
        <Form
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button ref={cancelRef} variant="link" formAction="none" onClick={handleCancel}>
                Cancel
              </Button>
              <Button variant="primary" loading={pending} loadingText={CREATING}>
                {CREATE_TABLE_TITLE}
              </Button>
            </SpaceBetween>
          }
        >
          <SpaceBetween size="l">
            <Container header={<Header variant="h2">Table</Header>}>
              <SpaceBetween size="l">
                <FormField label="Table name" constraintText={NAME_RULE} errorText={shown(messages.name)}>
                  <Input
                    ref={nameRef}
                    value={form.name}
                    invalid={messages.name !== undefined}
                    autoComplete={false}
                    spellcheck={false}
                    onChange={({ detail }) => {
                      change('name', detail.value);
                    }}
                  />
                </FormField>
                <FormField
                  label="Partition key"
                  constraintText={PARTITION_KEY_RULE}
                  errorText={shown(messages.partitionKey)}
                  secondaryControl={
                    <Select
                      ariaLabel="Partition key type"
                      selectedOption={keyTypeOption(form.partitionKeyType)}
                      options={KEY_TYPES}
                      onChange={({ detail }) => {
                        change('partitionKeyType', detail.selectedOption.value as KeyType);
                      }}
                    />
                  }
                >
                  <Input
                    ref={partitionKeyRef}
                    value={form.partitionKey}
                    invalid={messages.partitionKey !== undefined}
                    autoComplete={false}
                    spellcheck={false}
                    onChange={({ detail }) => {
                      change('partitionKey', detail.value);
                    }}
                  />
                </FormField>
                <FormField
                  label={
                    <>
                      Sort key - <i>optional</i>
                    </>
                  }
                  constraintText={SORT_KEY_RULE}
                  errorText={shown(messages.sortKey)}
                  secondaryControl={
                    <Select
                      ariaLabel="Sort key type"
                      selectedOption={keyTypeOption(form.sortKeyType)}
                      options={KEY_TYPES}
                      onChange={({ detail }) => {
                        change('sortKeyType', detail.selectedOption.value as KeyType);
                      }}
                    />
                  }
                >
                  <Input
                    ref={sortKeyRef}
                    value={form.sortKey}
                    invalid={messages.sortKey !== undefined}
                    autoComplete={false}
                    spellcheck={false}
                    onChange={({ detail }) => {
                      change('sortKey', detail.value);
                    }}
                  />
                </FormField>
                <FormField label="Capacity mode">
                  <RadioGroup
                    value={form.mode}
                    items={MODES}
                    onChange={({ detail }) => {
                      change('mode', detail.value as Mode);
                    }}
                  />
                </FormField>
                {provisioned && (
                  <ColumnLayout columns={2}>
                    <FormField label="Read capacity units" constraintText={UNITS_RULE} errorText={shown(messages.read)}>
                      <Input
                        ref={readRef}
                        value={form.read}
                        inputMode="numeric"
                        invalid={messages.read !== undefined}
                        onChange={({ detail }) => {
                          change('read', detail.value);
                        }}
                      />
                    </FormField>
                    <FormField
                      label="Write capacity units"
                      constraintText={UNITS_RULE}
                      errorText={shown(messages.write)}
                    >
                      <Input
                        ref={writeRef}
                        value={form.write}
                        inputMode="numeric"
                        invalid={messages.write !== undefined}
                        onChange={({ detail }) => {
                          change('write', detail.value);
                        }}
                      />
                    </FormField>
                  </ColumnLayout>
                )}
              </SpaceBetween>
            </Container>
            {failureItem !== undefined && (
              <Alert type={failureItem.type} header={failureItem.header}>
                {failureItem.content}
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
