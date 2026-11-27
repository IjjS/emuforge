import type { DescribeEventBusResponse } from '@aws-sdk/client-eventbridge';
import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';

import type { RequestFailure } from '../../../../../../lib/aws/request';
import type { AreaConnection } from '../../../components/emulator-line';
import { creationDateText } from '../../../components/format-date';
import type { useResourceTags } from '../queries';
import { BusDetails } from './bus-details';

const endpoint = 'http://127.0.0.1:8313';
const arn = 'arn:aws:events:us-east-1:123:event-bus/orders';
const kms = 'alias/orders';
const dlq = 'arn:aws:sqs:us-east-1:123:orders-dead-letters';
const policy = '{\n  "literal": "<test>"\n}';
const created = new Date('2026-11-26T10:00:00Z');
const changed = new Date('2026-11-27T10:00:00Z');

afterEach(() => vi.unstubAllGlobals());

function renderDetails(
  bus: DescribeEventBusResponse,
  tags: Partial<ReturnType<typeof useResourceTags>> = {},
  result: AreaConnection['result'] = undefined,
) {
  const refresh = vi.fn();
  const { container } = render(
    <MemoryRouter>
      <BusDetails
        connection={{ engineOrigin: endpoint, result }}
        bus={bus}
        tags={{ loading: false, value: undefined, failure: undefined, refresh, ...tags }}
      />
    </MemoryRouter>,
  );
  const page = createWrapper(container);
  const table = page.findTable();
  const details = page.findContainer()?.findContent();
  if (!table || !details) throw new Error('Expected bus details and tags');
  const values = Object.fromEntries(
    details
      .findAllKeyValuePairs()
      .flatMap((pairs) => pairs.findItems())
      .map((item) => [item.findLabel()?.getElement().textContent, item.findValue()]),
  );
  return { table, values, refresh };
}

it('renders the description and dates, keeps the policy literal and copies each identifier as supplied', async () => {
  const writeText = vi.fn(() => Promise.resolve());
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
  const { values } = renderDetails({
    Arn: arn,
    Description: 'Routes orders',
    CreationTime: created,
    LastModifiedTime: changed,
    KmsKeyIdentifier: kms,
    DeadLetterConfig: { Arn: dlq },
    Policy: policy,
  });
  expect(values.Description?.getElement().textContent).toBe('Routes orders');
  expect(values['Creation time']?.getElement().textContent).toBe(creationDateText(created));
  expect(values['Last change']?.getElement().textContent).toBe(creationDateText(changed));
  expect(values['Resource policy']?.getElement().textContent).toBe(policy);

  for (const [label, value] of [
    ['ARN', arn],
    ['KMS key', kms],
    ['Dead-letter queue ARN', dlq],
  ] as const) {
    const copy = values[label]?.findCopyToClipboard()?.findCopyButton();
    expect(values[label]?.getElement().textContent).toBe(value);
    expect(copy?.getElement()).toHaveAccessibleName(`Copy ${label}`);
    if (!copy) throw new Error(`Expected Copy ${label}`);
    fireEvent.click(copy.getElement());
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(value));
  }
  expect(writeText).toHaveBeenCalledTimes(3);
});

it('uses a dash for the absent description and omits optional configuration and its copy controls', () => {
  const { values, table } = renderDetails({ Arn: arn }, { value: {} });
  expect(values.Description?.getElement().textContent).toBe('-');
  expect(values).not.toHaveProperty('KMS key');
  expect(values).not.toHaveProperty('Dead-letter queue ARN');
  expect(values).not.toHaveProperty('Resource policy');
  expect(table.findEmptySlot()?.getElement().textContent).toBe('No tags');
});

it('shows loading and one row per tag when the read answers', () => {
  const loading = renderDetails({ Arn: arn }, { loading: true });
  expect(loading.table.findLoadingText()?.getElement().textContent).toBe('Loading tags');
  const { table } = renderDetails({ Arn: arn }, { value: { project: 'orders', env: 'local' } });
  expect(table.findRows().map((row) => row.getElement().textContent)).toEqual(['projectorders', 'envlocal']);
});

const operation = 'ListTagsForResource';
const failures: [RequestFailure, string, string?][] = [
  [{ kind: 'not-implemented', operation }, 'Not implemented by the emulator', operation],
  [{ kind: 'access-denied', operation, message: 'Denied' }, 'Access denied', 'Denied'],
  [{ kind: 'emulator-did-not-answer', operation, message: 'Timed out' }, 'The emulator did not answer', 'Timed out'],
  [{ kind: 'engine-did-not-answer', operation }, `The EmuForge engine at ${endpoint} did not answer`],
  [
    { kind: 'other', operation, code: 'ValidationException', message: 'Bad ARN' },
    'The event bus tags could not be read',
    'ValidationException: Bad ARN',
  ],
];

it.each(failures)('keeps the details visible when the tags read fails (%s)', (failure, status, detail) => {
  const { table, values, refresh } = renderDetails({ Arn: arn, Description: 'Order events' }, { failure });
  const empty = table.findEmptySlot();
  expect(empty?.findStatusIndicator()?.getElement().textContent).toBe(status);
  if (detail !== undefined) expect(empty?.getElement()).toHaveTextContent(detail);
  expect(values.Description?.getElement().textContent).toBe('Order events');
  const retry = empty?.findButton();
  expect(retry?.getElement()).toHaveAccessibleName('Retry');
  retry?.click();
  expect(refresh).toHaveBeenCalledTimes(1);
});

it.each(['not_started', 'connection_failed'] as const)(
  'links to connection status and retries the tags read when the emulator is %s',
  (reason) => {
    const emulator = { port: 9313, endpoint: 'https://127.0.0.1:9313' };
    const { table, refresh } = renderDetails(
      { Arn: arn },
      { failure: { kind: 'emulator-did-not-answer', operation, message: '' } },
      { kind: 'emulator-unreachable', checkedAt: 0, emulator, reason, message: '' },
    );
    const empty = table.findEmptySlot();
    const status = reason === 'not_started' ? 'Not started on port 9313' : `Not answering at ${emulator.endpoint}`;
    expect(empty?.findStatusIndicator()?.getElement().textContent).toBe(status);
    expect(empty?.findLink()?.getElement()).toHaveAccessibleName('Connection status');
    expect(empty?.findLink()?.getElement()).toHaveAttribute('href', '/');
    const retry = empty?.findButton();
    expect(retry?.getElement()).toHaveAccessibleName('Retry');
    retry?.click();
    expect(refresh).toHaveBeenCalledTimes(1);
  },
);
