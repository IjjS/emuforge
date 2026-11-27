import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../../lib/aws/request';
import { listTopicArns, listTopics } from '../topic-api';
import { ActionTopicsField } from './action-topics-field';

vi.mock('../topic-api');

const endpoint = 'http://127.0.0.1:9682';
const arn = (name: string) => `arn:aws:sns:us-east-1:000000000000:${name}`;
const first = arn('first');
const second = arn('second');
const absent = 'arn:aws:lambda:us-east-1:000000000000:function:old';
const PAGE = createWrapper(document.body);
const changed = vi.fn();

function renderField(initial: string[] = []) {
  function Field() {
    const [value, setValue] = useState(initial);
    return (
      <ActionTopicsField
        connection={{ engineOrigin: endpoint, result: undefined }}
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

it('reports a topics failure with the reason and preserves the chosen values', async () => {
  vi.mocked(listTopics)
    .mockRejectedValueOnce(new RequestError({ kind: 'not-implemented', operation: 'ListTopics' }))
    .mockRejectedValueOnce(new RequestError({ kind: 'access-denied', operation: 'ListTopics', message: 'denied' }));
  const field = renderField([first]);
  field.openDropdown();
  await waitFor(() =>
    expect(field.findStatusIndicator()?.getElement()).toHaveTextContent('501 Not Implemented for ListTopics'),
  );
  field.findErrorRecoveryButton()?.click();
  await waitFor(() =>
    expect(field.findStatusIndicator()?.getElement()).toHaveTextContent('ListTopics was refused: denied'),
  );
  expect(field.findToken(1)?.findLabel().getElement()).toHaveTextContent('first');
  expect(changed).not.toHaveBeenCalled();
});
