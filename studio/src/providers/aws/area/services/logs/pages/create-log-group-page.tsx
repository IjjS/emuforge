import AttributeEditor from '@cloudscape-design/components/attribute-editor';
import Button from '@cloudscape-design/components/button';
import Checkbox from '@cloudscape-design/components/checkbox';
import Container from '@cloudscape-design/components/container';
import Form from '@cloudscape-design/components/form';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import Input, { type InputProps } from '@cloudscape-design/components/input';
import Select from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';

import type { RequestFailure } from '../../../../../../lib/aws/request';
import { DiscardDialog } from '../../../components/discard-dialog';
import { actionFailureItem } from '../../../components/failure-states';
import { usePageFlash, type FlashResult } from '../../../components/page-flash';
import { useShowsResources } from '../../../components/page-resources';
import { failureOf, usePageSignal } from '../../../components/use-token-listing';
import type { ScreenPageProps } from '../../../screens';
import { RetentionSelect } from '../components/retention-select';
import { CREATE_LOG_GROUP_TITLE, LOG_GROUPS_PATH, logGroupClassText, logGroupPath } from '../format';
import { createLogGroup, GROUP_CREATE_OPERATIONS, putRetentionPolicy } from '../group-create-api';
import {
  createGroupInput,
  groupFormChanged,
  INITIAL_GROUP_FORM,
  logGroupNameError,
  NAME_RULE,
  type CreateLogGroupForm,
} from '../group-form';
import { LOGS_KEYS } from '../queries';
import { MAX_TAGS, TAG_LIMIT_MESSAGE, validateTags, type LogGroupTag } from '../tags';

const LIMITED_CLASS_DESCRIPTION = 'Log events can be put. The emulator refuses to read or search them in this class.';
const CLASS_OPTIONS = (
  [
    { value: 'STANDARD', description: 'Log events can be put, read and searched.' },
    { value: 'INFREQUENT_ACCESS', description: LIMITED_CLASS_DESCRIPTION },
    { value: 'DELIVERY', description: LIMITED_CLASS_DESCRIPTION },
  ] as const
).map(({ value, description }) => ({ value, label: logGroupClassText(value), description }));

function groupWriteFailure(failure: RequestFailure, engineOrigin: string | undefined) {
  const item = actionFailureItem(failure, failure.operation, engineOrigin);
  if (failure.kind === 'engine-did-not-answer' || failure.kind === 'emulator-did-not-answer') {
    return {
      ...item,
      content: (
        <>
          {failure.operation} failed. {item.content}
        </>
      ),
    };
  }
  return item;
}

export function CreateLogGroupPage({ connection }: ScreenPageProps) {
  useShowsResources('log groups');
  const { engineOrigin } = connection;
  const navigate = useNavigate();
  const flash = usePageFlash();
  const queryClient = useQueryClient();
  const pageSignal = usePageSignal();
  const [form, setForm] = useState(INITIAL_GROUP_FORM);
  const [tried, setTried] = useState(false);
  const [pending, setPending] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [askDiscard, setAskDiscard] = useState(false);
  const busy = useRef(false);
  const nameInput = useRef<InputProps.Ref>(null);
  const tagInputs = useRef(new Map<string, InputProps.Ref>());

  function change(patch: Partial<CreateLogGroupForm>) {
    if (!busy.current) setForm((current) => ({ ...current, ...patch }));
  }

  const leave = () => void navigate(LOG_GROUPS_PATH);
  const nameError = tried ? logGroupNameError(form.name) : undefined;
  const tagErrors = tried ? validateTags(form.tags) : undefined;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy.current || unavailable || askDiscard) return;

    setTried(true);
    const { name, retention } = form;
    if (logGroupNameError(name) !== undefined) {
      nameInput.current?.focus();
      return;
    }
    const tags = validateTags(form.tags);
    const invalidRow = tags.rows.findIndex(({ key, value }) => key !== undefined || value !== undefined);
    if (invalidRow >= 0) {
      const part = tags.rows[invalidRow]?.key === undefined ? 'value' : 'key';
      tagInputs.current.get(`${invalidRow.toString()}-${part}`)?.focus();
      return;
    }
    if (tags.limit !== undefined) return;

    const { createLogGroup: createOperation, putRetentionPolicy: retentionOperation } = GROUP_CREATE_OPERATIONS;
    if (engineOrigin === undefined) {
      flash.show([groupWriteFailure({ kind: 'engine-did-not-answer', operation: createOperation }, engineOrigin)]);
      return;
    }

    const signal = pageSignal();
    busy.current = true;
    setPending(true);
    try {
      await createLogGroup(engineOrigin, createGroupInput(form), signal);
    } catch (error) {
      if (signal.aborted) return;
      const failure = failureOf(error, createOperation);
      setUnavailable(failure.kind === 'not-implemented');
      setPending(false);
      busy.current = false;
      flash.show([groupWriteFailure(failure, engineOrigin)]);
      return;
    }
    if (signal.aborted) return;

    let result: FlashResult = [{ type: 'success', content: `Log group ${name} created.` }];
    if (retention !== undefined) {
      try {
        await putRetentionPolicy(engineOrigin, name, retention, signal);
      } catch (error) {
        if (signal.aborted) return;
        result = [
          { type: 'warning', content: `Log group ${name} created, but its retention was not set.` },
          groupWriteFailure(failureOf(error, retentionOperation), engineOrigin),
        ];
      }
    }
    if (signal.aborted) return;

    void queryClient.invalidateQueries({ queryKey: LOGS_KEYS.groups() });
    void queryClient.invalidateQueries({ queryKey: LOGS_KEYS.group(name) });
    void queryClient.invalidateQueries({ queryKey: LOGS_KEYS.tags(name) });
    flash.handOver(logGroupPath(name), result);
  }

  function tagField(tag: LogGroupTag, index: number, part: keyof LogGroupTag) {
    const id = `${index.toString()}-${part}`;
    return (
      <Input
        ref={(input) => {
          if (input === null) tagInputs.current.delete(id);
          else tagInputs.current.set(id, input);
        }}
        value={tag[part]}
        disabled={pending}
        autoComplete={false}
        spellcheck={false}
        onChange={({ detail }) => {
          change({ tags: form.tags.map((row, at) => (at === index ? { ...row, [part]: detail.value } : row)) });
        }}
      />
    );
  }

  return (
    <>
      <form onSubmit={(event) => void handleSubmit(event)} noValidate>
        <Form
          header={<Header variant="h1">{CREATE_LOG_GROUP_TITLE}</Header>}
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button
                variant="link"
                formAction="none"
                disabled={pending}
                onClick={() => {
                  if (groupFormChanged(form)) setAskDiscard(true);
                  else leave();
                }}
              >
                Cancel
              </Button>
              <Button variant="primary" formAction="submit" loading={pending} disabled={unavailable}>
                {CREATE_LOG_GROUP_TITLE}
              </Button>
            </SpaceBetween>
          }
        >
          <SpaceBetween size="l">
            <Container header={<Header variant="h2">Log group settings</Header>}>
              <SpaceBetween size="l">
                <FormField label="Log group name" constraintText={NAME_RULE} errorText={nameError}>
                  <Input
                    ref={nameInput}
                    ariaRequired
                    value={form.name}
                    disabled={pending}
                    autoComplete={false}
                    spellcheck={false}
                    onChange={({ detail }) => change({ name: detail.value })}
                  />
                </FormField>
                <FormField label="Log class" constraintText="The class is fixed once the log group is created.">
                  <Select
                    options={CLASS_OPTIONS}
                    selectedOption={CLASS_OPTIONS.find((option) => option.value === form.logClass) ?? null}
                    dropdownRole="dialog"
                    triggerVariant="option"
                    disabled={pending}
                    onChange={({ detail }) => {
                      const choice = CLASS_OPTIONS.find(({ value }) => value === detail.selectedOption.value);
                      if (choice !== undefined) change({ logClass: choice.value });
                    }}
                  />
                </FormField>
                <FormField label="Retention">
                  <RetentionSelect
                    value={form.retention}
                    disabled={pending}
                    onChange={(retention) => change({ retention })}
                  />
                </FormField>
                <Checkbox
                  checked={form.deletionProtection}
                  disabled={pending}
                  onChange={({ detail }) => change({ deletionProtection: detail.checked })}
                >
                  Deletion protection
                </Checkbox>
              </SpaceBetween>
            </Container>
            <Container header={<Header variant="h2">Tags</Header>}>
              <FormField errorText={tagErrors?.limit}>
                <AttributeEditor
                  items={form.tags}
                  addButtonText="Add tag"
                  removeButtonText="Remove"
                  removeButtonAriaLabel={(tag) => (tag.key === '' ? 'Remove tag' : `Remove tag ${tag.key}`)}
                  disableAddButton={pending || form.tags.length >= MAX_TAGS}
                  isItemRemovable={() => !pending}
                  additionalInfo={form.tags.length >= MAX_TAGS ? TAG_LIMIT_MESSAGE : undefined}
                  onAddButtonClick={() => change({ tags: [...form.tags, { key: '', value: '' }] })}
                  onRemoveButtonClick={({ detail }) =>
                    change({ tags: form.tags.filter((_, index) => index !== detail.itemIndex) })
                  }
                  definition={[
                    {
                      label: 'Key',
                      control: (tag, index) => tagField(tag, index, 'key'),
                      errorText: (_, index) => tagErrors?.rows[index]?.key,
                    },
                    {
                      label: 'Value',
                      control: (tag, index) => tagField(tag, index, 'value'),
                      errorText: (_, index) => tagErrors?.rows[index]?.value,
                    },
                  ]}
                />
              </FormField>
            </Container>
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
