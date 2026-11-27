import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';

import type { AreaConnection } from '../../../components/emulator-line';
import { RequestError, type RequestFailure } from '../../../../../../lib/aws/request';
import { listTopicArns, listTopics } from '../topic-api';
import { ActionTopicsField } from './action-topics-field';

vi.mock('../topic-api');

const endpoint = 'http://127.0.0.1:9682';
const operation = 'ListTopics';
const emulator = { port: 9382, endpoint: 'https://127.0.0.1:9382' };
const disconnected = (reason: string): AreaConnection['result'] => ({
  kind: 'emulator-unreachable',
  checkedAt: 0,
  emulator,
  reason,
  message: '',
});
const failures: { failure: RequestFailure; result: AreaConnection['result']; message: string }[] = [
  {
    failure: { kind: 'not-implemented', operation },
    result: undefined,
    message: `501 Not Implemented for ${operation}`,
  },
  {
    failure: { kind: 'access-denied', operation, message: 'denied' },
    result: undefined,
    message: `${operation} was refused: denied`,
  },
  {
    failure: { kind: 'emulator-did-not-answer', operation, message: '' },
    result: disconnected('not_started'),
    message: 'Not started on port 9382',
  },
  {
    failure: { kind: 'emulator-did-not-answer', operation, message: '' },
    result: disconnected('timeout'),
    message: 'Not answering at https://127.0.0.1:9382',
  },
  {
    failure: { kind: 'engine-did-not-answer', operation },
    result: { kind: 'engine-unreachable', checkedAt: 0, lastEmulatorPort: 9382 },
    message: `The EmuForge engine at ${endpoint} is not answering`,
  },
  {
    failure: { kind: 'other', operation, code: 'InvalidParameterValue', message: 'bad filter' },
    result: undefined,
    message: 'InvalidParameterValue: bad filter',
  },
];

const arn = (name: string) => `arn:aws:sns:us-east-1:000000000000:${name}`;
const first = arn('first');
const second = arn('second');
const absent = 'arn:aws:lambda:us-east-1:000000000000:function:old';
const PAGE = createWrapper(document.body);
const changed = vi.fn();

function renderField(initial: string[] = [], result?: AreaConnection['result']) {
  function Field() {
    const [value, setValue] = useState(initial);
    return (
      <ActionTopicsField
        connection={{ engineOrigin: endpoint, result }}
        label="In alarm"
        value={value}
        onChange={(arns) => {
          changed(arns);
          setValue(arns);
        }}
      />
    );
  }
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Field />
    </QueryClientProvider>,
  );
  const field = PAGE.findMultiselect();
  if (!field) throw new Error('No topic field');
  return field;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(listTopicArns).mockResolvedValue([first, second]);
  vi.mocked(listTopics).mockImplementation(async (_origin, token) =>
    token === undefined ? { items: [first], next: 'more' } : { items: [second], next: 'even-more' },
  );
});

it('reads the next page only on Load more and reports choices in the order selected', async () => {
  const field = renderField();
  expect(listTopics).not.toHaveBeenCalled();
  field.openDropdown();
  await waitFor(() => {
    const option = field.findDropdown().findOptionByValue(first);
    expect(option?.findLabel().getElement()).toHaveTextContent('first');
    expect(option?.findDescription()?.getElement()).toHaveTextContent(first);
  });
  expect(listTopics).toHaveBeenCalledExactlyOnceWith(endpoint, undefined, expect.any(AbortSignal));
  field.findDropdownFooter()?.findButton()?.click();
  await waitFor(() => expect(field.findDropdown().findOptionByValue(second)).not.toBeNull());
  expect(field.findDropdown().findOptions()).toHaveLength(2);
  expect(listTopics).toHaveBeenLastCalledWith(endpoint, 'more', expect.any(AbortSignal));
  field.selectOptionByValue(second);
  field.selectOptionByValue(first);
  expect(changed).toHaveBeenLastCalledWith([second, first]);
  expect(listTopics).toHaveBeenCalledTimes(2);
});

it('marks a selected non-topic and lets it be removed without offering it again', async () => {
  const field = renderField([first, absent]);
  expect(field.findToken(1)?.findLabel().getElement()).toHaveTextContent('first');
  await waitFor(() => {
    expect(field.findToken(2)?.findOption().getElement()).toHaveTextContent('Not a topic in the emulator');
  });
  field.findToken(2)?.findDismiss().click();
  expect(changed).toHaveBeenLastCalledWith([first]);
  field.openDropdown();
  await waitFor(() => expect(field.findDropdown().findOptionByValue(first)).not.toBeNull());
  expect(field.findDropdown().findOptionByValue(absent)).toBeNull();
});

it.each(failures)(
  'reports $failure.kind at the topic picker and preserves its choices',
  async ({ failure, result, message }) => {
    vi.mocked(listTopics).mockRejectedValueOnce(new RequestError(failure));
    const field = renderField([first], result);
    field.openDropdown();
    await waitFor(() => expect(field.findStatusIndicator()?.getElement()).toHaveTextContent(message));
    field.findErrorRecoveryButton()?.click();
    await waitFor(() => expect(field.findDropdown().findOptionByValue(first)).not.toBeNull());
    expect(listTopics).toHaveBeenCalledTimes(2);
    expect(field.findToken(1)?.findLabel().getElement()).toHaveTextContent('first');
    expect(changed).not.toHaveBeenCalled();
  },
);
