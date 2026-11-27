import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useRef } from 'react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../../lib/aws/request';
import { AreaRootContext } from '../../../area-root';
import { PageFlashContext, type PageFlash } from '../../../components/page-flash';
import { getEventBus, listEventBuses } from '../bus-api';
import { createRule, ruleNameTaken } from '../rule-create-api';
import { PutTargetsError, putRuleTargets } from '../target-api';
import { getTargetQueueArn, targetChoiceSource } from '../target-sources';
import { CreateRulePage } from './create-rule-page';

vi.mock('../bus-api', async (original) => ({
  ...(await original<typeof import('../bus-api')>()),
  getEventBus: vi.fn(),
  listEventBuses: vi.fn(),
}));
vi.mock('../rule-create-api', async (original) => ({
  ...(await original<typeof import('../rule-create-api')>()),
  ruleNameTaken: vi.fn(),
  createRule: vi.fn(),
}));
vi.mock('../target-api', async (original) => ({
  ...(await original<typeof import('../target-api')>()),
  putRuleTargets: vi.fn(),
}));
vi.mock('../target-sources', async (original) => ({
  ...(await original<typeof import('../target-sources')>()),
  getTargetQueueArn: vi.fn(),
  targetChoiceSource: vi.fn(),
}));

const endpoint = 'http://127.0.0.1:8346';
const createPath = '/aws/events/rules/create';
const rulePath = '/aws/events/rules/rule/default/route';
const lookup = vi.mocked(ruleNameTaken);
const put = vi.mocked(createRule);
const putTargets = vi.mocked(putRuleTargets);
const queueUrl = 'https://127.0.0.1/queues/orders';
const topicArn = 'arn:aws:sns:us-east-1:000000000000:orders';
const pattern = '{"source":["shop"]}';
const unsupported = (operation: string) => new RequestError({ operation, kind: 'not-implemented' });
const refused = (operation: string, message: string) =>
  new RequestError({ operation, kind: 'other', code: 'ValidationException', message });

beforeEach(() => {
  lookup.mockReset().mockResolvedValue(false);
  put.mockReset().mockResolvedValue(undefined);
  putTargets.mockReset().mockResolvedValue(undefined);
  vi.mocked(getEventBus)
    .mockReset()
    .mockImplementation((_endpoint, Name) => Promise.resolve({ kind: 'found', bus: { Name } }));
  vi.mocked(listEventBuses)
    .mockReset()
    .mockResolvedValue({ items: [{ Name: 'default' }, { Name: 'orders' }] });
  vi.mocked(getTargetQueueArn).mockReset().mockResolvedValue('arn:queue');
  vi.mocked(targetChoiceSource)
    .mockReset()
    .mockImplementation((kind) => ({
      key: [kind],
      endpoint,
      operation: kind === 'sqs' ? 'ListQueues' : 'ListTopics',
      read: () =>
        Promise.resolve({
          items: [{ value: kind === 'sqs' ? queueUrl : topicArn, label: 'orders', description: 'Orders' }],
        }),
      optionOf: (resource) => resource,
    }));
});

function open(search = '') {
  const handOver = vi.fn<PageFlash['handOver']>();
  const client = new QueryClient();
  function Area() {
    const root = useRef<HTMLDivElement>(null);
    const { pathname, search } = useLocation();
    const navigate = useNavigate();
    return (
      <AreaRootContext.Provider value={root}>
        <div ref={root}>
          <div data-testid="address">
            {pathname}
            {search}
          </div>
          <PageFlashContext.Provider
            value={{
              show: vi.fn(),
              handOver: (...args) => {
                handOver(...args);
                void navigate(args[0]);
              },
            }}
          >
            {pathname === createPath && (
              <CreateRulePage connection={{ engineOrigin: endpoint, result: undefined }} params={{}} />
            )}
          </PageFlashContext.Provider>
        </div>
      </AreaRootContext.Provider>
    );
  }
  const { container } = render(
    <MemoryRouter initialEntries={[createPath + search]}>
      <QueryClientProvider client={client}>
        <Area />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  const page = createWrapper(container);
  function select(label: string, index = 0) {
    const field = page
      .findAllFormFields()
      .filter((candidate) => candidate.findLabel()?.getElement().textContent === label)[index];
    const found = field && createWrapper(field.getElement()).findSelect();
    if (!found) throw new Error(`Expected a select for ${label}`);
    return found;
  }
  async function choose(label: string, value: string, index = 0) {
    const field = select(label, index);
    act(() => field.openDropdown());
    await waitFor(() => expect(field.findDropdown().findOptionByValue(value)).not.toBeNull());
    act(() => field.selectOptionByValue(value));
  }
  return { handOver, select, choose, container };
}

function textbox(name: string) {
  return screen.getByRole('textbox', { name });
}

function enter(name: string, value: string) {
  fireEvent.change(textbox(name), { target: { value } });
}

function button(name: string) {
  return screen.getByRole('button', { name });
}

function click(name: string) {
  fireEvent.click(button(name));
}

function radio(value: string) {
  const control = screen.getAllByRole('radio').find((input) => input.getAttribute('value') === value);
  if (!control) throw new Error(`Expected a radio option for ${value}`);
  return control;
}

function fill() {
  enter('Rule name', 'route');
  enter('Description', 'Routes orders');
  enter('Event pattern', pattern);
}

function expectUnsent() {
  expect(lookup).not.toHaveBeenCalled();
  expect(put).not.toHaveBeenCalled();
  expect(putTargets).not.toHaveBeenCalled();
}

async function addTopic(page: ReturnType<typeof open>, id: string, index = 0) {
  click('Add target');
  const field = screen.getAllByRole('textbox', { name: 'Target ID' })[index];
  if (!field) throw new Error('Expected the target row');
  fireEvent.change(field, { target: { value: id } });
  await page.choose('Target kind', 'sns', index);
  await page.choose('Topic', topicArn, index);
}

it('opens with the bus from the address, a pattern, an enabled state and no target row', async () => {
  const page = open('?bus=orders');
  await waitFor(() => expect(page.select('Event bus').findTrigger().getElement()).toHaveTextContent(/^orders$/));
  expect(getEventBus).toHaveBeenCalledWith(endpoint, 'orders', expect.any(AbortSignal));
  expect(radio('pattern')).toBeChecked();
  expect(radio('ENABLED')).toBeChecked();
  expect(textbox('Rule name')).toHaveAccessibleDescription(
    '1 to 64 characters. Use letters, digits, periods, hyphens and underscores.',
  );
  expect(screen.queryByRole('textbox', { name: 'Target ID' })).toBeNull();
  for (const [value, description] of [
    ['pattern', 'Runs for each event on the bus that matches the pattern.'],
    [
      'schedule',
      'Runs at a fixed rate or at the times of a cron expression. The emulator accepts a schedule only on the default event bus.',
    ],
    [
      'ENABLED',
      "Matching events are routed to the rule's targets. A target receives them only if it allows EventBridge to deliver.",
    ],
    ['DISABLED', 'The rule is kept and routes nothing until it is enabled.'],
  ] as const) {
    expect(radio(value)).toHaveAccessibleDescription(description);
  }
});

it('offers both schedule kinds on default and returns to a pattern on another bus', async () => {
  const page = open();
  expect(page.select('Event bus').findTrigger().getElement()).toHaveTextContent(/^default$/);
  expect(radio('schedule')).toBeEnabled();
  fireEvent.click(radio('schedule'));
  expect(radio('rate')).toBeChecked();
  expect(radio('rate')).toHaveAccessibleDescription(
    'Runs again each time the number of minutes, hours or days has passed.',
  );
  expect(radio('cron')).toHaveAccessibleDescription(
    'Runs at the times a cron expression of six fields names, such as cron(0 12 * * ? *).',
  );
  expect(textbox('Rate')).toHaveValue('1');
  fireEvent.click(radio('cron'));
  expect(textbox('Cron expression')).toBeVisible();
  expect(screen.queryByRole('textbox', { name: 'Rate' })).toBeNull();
  await page.choose('Event bus', 'orders');
  expect(radio('schedule')).toBeDisabled();
  expect(radio('pattern')).toBeChecked();
  expect(textbox('Event pattern')).toBeVisible();
});

it('shows the expressions for the rate currently entered', () => {
  open();
  fireEvent.click(radio('schedule'));
  for (const [unit, plural] of [
    ['minute', 'minutes'],
    ['hour', 'hours'],
    ['day', 'days'],
  ] as const) {
    expect(radio(unit)).toHaveAccessibleDescription(`rate(1 ${unit})`);
    enter('Rate', '5');
    expect(radio(unit)).toHaveAccessibleDescription(`rate(5 ${plural})`);
    enter('Rate', '1');
  }
});

it('accepts up to five target rows and makes room when one is removed', () => {
  open();
  for (let row = 0; row < 5; row += 1) click('Add target');
  expect(screen.getAllByRole('textbox', { name: 'Target ID' })).toHaveLength(5);
  expect(button('Add target')).toBeDisabled();
  expect(screen.getByText('A rule holds at most 5 targets.')).toBeVisible();
  click('Remove target 2');
  expect(screen.getAllByRole('textbox', { name: 'Target ID' })).toHaveLength(4);
  expect(button('Add target')).toBeEnabled();
});

it('reads the name before creating a rule without targets and hands over success', async () => {
  let resolveLookup!: (taken: boolean) => void;
  lookup.mockReturnValueOnce(
    new Promise((resolve) => {
      resolveLookup = resolve;
    }),
  );
  const { handOver } = open();
  fill();
  click('Create rule');
  expect(lookup).toHaveBeenCalledExactlyOnceWith(endpoint, 'default', 'route', expect.any(AbortSignal));
  expect(put).not.toHaveBeenCalled();
  expect(putTargets).not.toHaveBeenCalled();
  await act(() => resolveLookup(false));
  expect(put).toHaveBeenCalledExactlyOnceWith(
    endpoint,
    {
      Name: 'route',
      EventBusName: 'default',
      Description: 'Routes orders',
      State: 'ENABLED',
      EventPattern: pattern,
    },
    expect.any(AbortSignal),
  );
  expect(putTargets).not.toHaveBeenCalled();
  expect(screen.getByTestId('address')).toHaveTextContent(rulePath);
  expect(handOver).toHaveBeenCalledOnce();
  const [first] = handOver.mock.calls[0]?.[1] ?? [];
  expect(first?.type).toBe('success');
  expect(render(<>{first?.content}</>).container).toHaveTextContent('Rule route created.');
});

it('waits for PutRule, then writes both targets and hands over success', async () => {
  let resolvePut!: () => void;
  put.mockReturnValueOnce(
    new Promise((resolve) => {
      resolvePut = resolve;
    }),
  );
  const page = open();
  fill();
  await addTopic(page, 'first');
  await addTopic(page, 'second', 1);
  click('Create rule');
  await waitFor(() => expect(put).toHaveBeenCalledOnce());
  expect(putTargets).not.toHaveBeenCalled();
  await act(() => resolvePut());
  expect(putTargets).toHaveBeenCalledExactlyOnceWith(
    endpoint,
    'default',
    'route',
    [
      { Id: 'first', Arn: topicArn },
      { Id: 'second', Arn: topicArn },
    ],
    expect.any(AbortSignal),
  );
  expect(screen.getByTestId('address')).toHaveTextContent(rulePath);
  const [first] = page.handOver.mock.calls[0]?.[1] ?? [];
  expect(first?.type).toBe('success');
  expect(render(<>{first?.content}</>).container).toHaveTextContent('Rule route created.');
});

it('reports an existing name at its field and sends no write', async () => {
  lookup.mockResolvedValueOnce(true);
  const { handOver } = open();
  fill();
  click('Create rule');
  expect(
    await screen.findByText('A rule named route already exists on default. Creating it again would replace it.'),
  ).toBeVisible();
  expect(textbox('Rule name')).toHaveAccessibleDescription(/already exists on default/);
  expect(put).not.toHaveBeenCalled();
  expect(putTargets).not.toHaveBeenCalled();
  expect(handOver).not.toHaveBeenCalled();
});

it.each([
  ['DescribeRule', refused('DescribeRule', 'Read refused'), 'Read refused', false],
  ['PutRule', refused('PutRule', 'Pattern refused'), 'Pattern refused', false],
  ['PutRule', unsupported('PutRule'), 'Not implemented by the emulator', true],
  ['DescribeRule', unsupported('DescribeRule'), 'Not implemented by the emulator', false],
] as const)('keeps the form after a failure of %s (%s)', async (operation, error, reason, disables) => {
  const page = open();
  fill();
  await addTopic(page, 'first');
  if (operation === 'DescribeRule') lookup.mockRejectedValueOnce(error);
  else put.mockRejectedValueOnce(error);
  click('Create rule');
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent(operation);
  expect(alert).toHaveTextContent(reason);
  expect(textbox('Rule name')).toHaveValue('route');
  expect(textbox('Description')).toHaveValue('Routes orders');
  expect(textbox('Event pattern')).toHaveValue(pattern);
  expect(textbox('Target ID')).toHaveValue('first');
  expect(page.select('Topic').findTrigger().getElement()).toHaveTextContent(/^orders$/);
  expect(screen.getByTestId('address')).toHaveTextContent(createPath);
  if (disables) expect(button('Create rule')).toBeDisabled();
  else expect(button('Create rule')).toBeEnabled();
  if (operation === 'DescribeRule') expect(put).not.toHaveBeenCalled();
  expect(putTargets).not.toHaveBeenCalled();
  expect(page.handOver).not.toHaveBeenCalled();
});

it.each([
  [refused('PutTargets', 'Targets refused'), 'Targets refused'],
  [new PutTargetsError([{ ErrorCode: 'Refused', ErrorMessage: 'Entry refused', TargetId: 'first' }]), 'Entry refused'],
  [unsupported('PutTargets'), 'Not implemented by the emulator'],
] as const)('hands over a warning after a refused target write (%s)', async (error, reason) => {
  const page = open();
  fill();
  await addTopic(page, 'first');
  putTargets.mockRejectedValueOnce(error);
  click('Create rule');
  await waitFor(() => expect(page.handOver).toHaveBeenCalledOnce());
  const [to, items, note] = page.handOver.mock.calls[0] ?? [];
  expect(to).toBe(rulePath);
  expect(screen.getByTestId('address')).toHaveTextContent(new RegExp(`^${rulePath}$`));
  expect(items?.[0].type).toBe('warning');
  const { container } = render(
    <>
      {items?.[0].header}
      {items?.[0].content}
    </>,
  );
  expect(container).toHaveTextContent('Rule route created, but its targets were not added.');
  expect(container).toHaveTextContent('PutTargets');
  expect(container).toHaveTextContent(reason);
  expect(note).toEqual(
    error.failure.kind === 'not-implemented'
      ? { notImplemented: 'PutTargets', bus: 'default', rule: 'route' }
      : undefined,
  );
});

it('shows a 501 bus read at the field with Retry and sends no rule read or write', async () => {
  vi.mocked(getEventBus).mockRejectedValueOnce(unsupported('DescribeEventBus'));
  const page = open('?bus=orders');
  expect(await screen.findByText('Not implemented by the emulator')).toBeVisible();
  expect(screen.getByText(/for DescribeEventBus/)).toBeVisible();
  expect(button('Retry')).toBeEnabled();
  expect(page.select('Event bus').findTrigger().getElement()).toHaveTextContent('Choose an event bus');
  fill();
  click('Create rule');
  expectUnsent();
  click('Retry');
  await waitFor(() => expect(page.select('Event bus').findTrigger().getElement()).toHaveTextContent(/^orders$/));
  expectUnsent();
});

it.each([
  ['?bus=missing', 'Event bus missing is not in your local emulator. Choose an event bus.'],
  ['?bus=arn%3Abus', 'Event bus arn:bus is not in your local emulator. Choose an event bus.'],
  ['?bus=', 'The address names no event bus. Choose an event bus.'],
])('validates an unresolved bus from %s and accepts a listed bus instead', async (search, message) => {
  vi.mocked(getEventBus).mockResolvedValueOnce({ kind: 'not-found' });
  const page = open(search);
  expect(await screen.findByText(message)).toBeVisible();
  fill();
  click('Create rule');
  expect(page.select('Event bus').findTrigger().getElement()).toHaveFocus();
  expectUnsent();
  await page.choose('Event bus', 'orders');
  expect(screen.queryByText(message)).toBeNull();
  click('Create rule');
  await waitFor(() => expect(page.handOver).toHaveBeenCalledOnce());
  expect(lookup).toHaveBeenCalledWith(endpoint, 'orders', 'route', expect.any(AbortSignal));
});

it('focuses the first invalid field and sends no requests to create the rule', () => {
  open();
  enter('Rule name', 'invalid/name');
  enter('Event pattern', '[]');
  click('Create rule');
  expect(textbox('Rule name')).toHaveFocus();
  expect(textbox('Rule name')).toHaveAttribute('aria-invalid', 'true');
  expect(textbox('Event pattern')).toHaveAttribute('aria-invalid', 'true');
  expectUnsent();
});

it('focuses a queue with its ARN still outstanding and sends no requests to create the rule', async () => {
  vi.mocked(getTargetQueueArn).mockReturnValueOnce(new Promise(() => undefined));
  const page = open();
  fill();
  click('Add target');
  enter('Target ID', 'queue');
  await page.choose('Target kind', 'sqs');
  await page.choose('Queue', queueUrl);
  click('Create rule');
  expect(screen.getByText('The queue ARN must be read before saving.')).toBeVisible();
  expect(page.select('Queue').findTrigger().getElement()).toHaveFocus();
  expectUnsent();
});

it('cancels an unchanged form directly to the chosen bus’s Rules', async () => {
  const page = open('?bus=orders');
  await waitFor(() => expect(page.select('Event bus').findTrigger().getElement()).toHaveTextContent(/^orders$/));
  click('Cancel');
  expect(screen.getByTestId('address')).toHaveTextContent(/^\/aws\/events\/rules\?bus=orders$/);
  expect(screen.queryByRole('dialog')).toBeNull();
  expectUnsent();
});

it.each(['field', 'choice', 'row'] as const)('asks before discarding a changed %s', async (change) => {
  open();
  if (change === 'field') enter('Description', 'Routes orders');
  if (change === 'choice') fireEvent.click(radio('DISABLED'));
  if (change === 'row') click('Add target');
  click('Cancel');
  const dialog = () => screen.findByRole('dialog', { name: 'Discard what you entered?' });
  fireEvent.click(within(await dialog()).getByRole('button', { name: 'Keep editing' }));
  if (change === 'field') expect(textbox('Description')).toHaveValue('Routes orders');
  if (change === 'choice') expect(radio('DISABLED')).toBeChecked();
  if (change === 'row') expect(textbox('Target ID')).toBeVisible();
  click('Cancel');
  fireEvent.click(within(await dialog()).getByRole('button', { name: 'Discard' }));
  expect(screen.getByTestId('address')).toHaveTextContent(/^\/aws\/events\/rules\?bus=default$/);
  expectUnsent();
});
