import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { useRef } from 'react';
import { MemoryRouter, useLocation } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../../lib/aws/request';
import { AreaRootContext } from '../../../area-root';
import { AreaFlash, FlashAnnouncer } from '../../../components/area-flash';
import { PageFlashContext, type PageFlash } from '../../../components/page-flash';
import { useAreaFlash } from '../../../components/use-area-flash';
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

function waitForRender<T>(assertion: () => T) {
  // Cloudscape's scoped selectors temporarily change attributes as they query.
  return waitFor(assertion, { mutationObserverOptions: { childList: true, characterData: true, subtree: true } });
}

function open(search = '') {
  const handOver = vi.fn<PageFlash['handOver']>();
  const client = new QueryClient();
  function Area() {
    const root = useRef<HTMLDivElement>(null);
    const { pathname, search } = useLocation();
    const flash = useAreaFlash(pathname, pathname === createPath ? 0 : 1, true);
    return (
      <AreaRootContext.Provider value={root}>
        <div ref={root}>
          <div data-testid="address">
            {pathname}
            {search}
          </div>
          <FlashAnnouncer announcement={flash.announcement} />
          {flash.shown !== null && (
            <AreaFlash result={flash.shown} onDismiss={flash.dismiss} onAnnounce={flash.announce} />
          )}
          <PageFlashContext.Provider
            value={{
              show: flash.pageFlash.show,
              handOver: (...args) => {
                handOver(...args);
                flash.pageFlash.handOver(...args);
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
  const dom = createWrapper(container);
  function fields(label: string) {
    return dom.findAllFormFields().filter((field) => field.findLabel()?.getElement().textContent === label);
  }
  function field(label: string, index = 0) {
    return fields(label)[index];
  }
  function textbox(label: string, index = 0) {
    const control = field(label, index)?.findControl();
    const input =
      control?.findInput()?.findNativeInput().getElement() ??
      control?.findTextarea()?.findNativeTextarea().getElement();
    if (!input) throw new Error(`Expected an input for ${label}`);
    expect(input).toHaveAccessibleName(label);
    return input;
  }
  function enter(label: string, value: string, index = 0) {
    fireEvent.change(textbox(label, index), { target: { value } });
  }
  function select(label: string, index = 0) {
    const found = field(label, index)?.findControl()?.findSelect();
    if (!found) throw new Error(`Expected a select for ${label}`);
    return found;
  }
  async function choose(label: string, value: string, index = 0) {
    const control = select(label, index);
    act(() => control.openDropdown());
    await waitForRender(() => expect(control.findDropdown().findOptionByValue(value)).not.toBeNull());
    act(() => control.selectOptionByValue(value));
  }
  function button(name: string) {
    return namedButton(dom, name);
  }
  function click(name: string) {
    fireEvent.click(button(name));
  }
  function radio(value: string) {
    for (const group of dom.findAllRadioGroups()) {
      const input = group.findInputByValue(value);
      if (input) return input.getElement();
    }
    throw new Error(`Expected a radio option for ${value}`);
  }
  function fill() {
    enter('Rule name', 'route');
    enter('Description - optional', 'Routes orders');
    enter('Event pattern', pattern);
  }
  const fixture = dom.find('[data-testid="address"]');
  const announcer = dom.find('.aws-area-flash-announcer');
  return {
    dom,
    handOver,
    select,
    choose,
    field,
    fields,
    textbox,
    enter,
    button,
    click,
    radio,
    fill,
    fixture,
    announcer,
  };
}

function namedButton(scope: ReturnType<typeof createWrapper>, name: string) {
  const button = scope
    .findAllButtons()
    .find(
      (item) =>
        (item.getElement().getAttribute('aria-label') ?? item.findTextRegion()?.getElement().textContent?.trim()) ===
        name,
    )
    ?.getElement();
  if (!button) throw new Error(`Expected a button named ${name}`);
  expect(button).toHaveAccessibleName(name);
  return button;
}

function expectUnsent() {
  expect(lookup).not.toHaveBeenCalled();
  expect(put).not.toHaveBeenCalled();
  expect(putTargets).not.toHaveBeenCalled();
}

async function addTopic(page: ReturnType<typeof open>, id: string, index = 0) {
  page.click('Add target');
  page.enter('Target ID', id, index);
  await page.choose('Target kind', 'sns', index);
  await page.choose('Topic', topicArn, index);
}

it('opens with the bus from the address, a pattern, an enabled state and no target row', async () => {
  const page = open('?bus=orders');
  await waitForRender(() => expect(page.select('Event bus').findTrigger().getElement()).toHaveTextContent(/^orders$/));
  expect(getEventBus).toHaveBeenCalledWith(endpoint, 'orders', expect.any(AbortSignal));
  expect(page.radio('pattern')).toBeChecked();
  expect(page.radio('ENABLED')).toBeChecked();
  expect(page.textbox('Rule name')).toHaveAccessibleDescription(
    '1 to 64 characters. Use letters, digits, periods, hyphens and underscores.',
  );
  expect(page.textbox('Description - optional')).toBeVisible();
  expect(
    page.dom.findAllContainers().at(-1)?.findHeader()?.findHeader()?.findHeadingText().getElement(),
  ).toHaveTextContent(/^Targets - optional$/);
  expect(page.textbox('Event pattern')).toHaveValue('');
  expect(page.textbox('Event pattern')).toHaveAccessibleDescription(
    expect.stringContaining(
      'List the source values you want to match in an array, such as {"source":["shop.checkout"]}',
    ),
  );
  expect(page.textbox('Event pattern')).toHaveAccessibleDescription(expect.stringContaining('up to 2048 characters'));
  expect(page.fields('Target ID')).toHaveLength(0);
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
    expect(page.radio(value)).toHaveAccessibleDescription(description);
  }
});

it('offers both schedule kinds on default and returns to a pattern on another bus', async () => {
  const page = open();
  expect(page.select('Event bus').findTrigger().getElement()).toHaveTextContent(/^default$/);
  expect(page.radio('schedule')).toBeEnabled();
  const trigger = page.field('What starts the rule');
  const restriction = 'Schedules are available only on the default event bus.';
  expect(trigger?.findDescription()).toBeNull();
  fireEvent.click(page.radio('schedule'));
  expect(page.radio('rate')).toBeChecked();
  expect(page.radio('rate')).toHaveAccessibleDescription(
    'Runs again each time the number of minutes, hours or days has passed.',
  );
  expect(page.radio('cron')).toHaveAccessibleDescription(
    'Runs at the times a cron expression of six fields names, such as cron(0 12 * * ? *).',
  );
  expect(page.textbox('Rate')).toHaveValue('1');
  fireEvent.click(page.radio('cron'));
  expect(page.textbox('Cron expression')).toBeVisible();
  expect(page.fields('Rate')).toHaveLength(0);
  await page.choose('Event bus', 'orders');
  expect(page.radio('schedule')).toBeDisabled();
  expect(trigger?.findDescription()?.getElement()).toHaveTextContent(restriction);
  expect(trigger?.findControl()?.findRadioGroup()?.getElement()).toHaveAccessibleDescription(restriction);
  expect(page.radio('pattern')).toBeChecked();
  expect(page.textbox('Event pattern')).toBeVisible();
  await page.choose('Event bus', 'default');
  expect(trigger?.findDescription()).toBeNull();
});

it('shows the expressions for the rate currently entered', () => {
  const page = open();
  fireEvent.click(page.radio('schedule'));
  for (const [unit, plural] of [
    ['minute', 'minutes'],
    ['hour', 'hours'],
    ['day', 'days'],
  ] as const) {
    expect(page.radio(unit)).toHaveAccessibleDescription(`rate(1 ${unit})`);
    page.enter('Rate', '5');
    expect(page.radio(unit)).toHaveAccessibleDescription(`rate(5 ${plural})`);
    page.enter('Rate', '1');
  }
});

it('accepts up to five target rows and makes room when one is removed', () => {
  const page = open();
  for (let row = 0; row < 5; row += 1) {
    page.click('Add target');
    expect(page.textbox('Target ID', row)).toHaveFocus();
  }
  expect(page.fields('Target ID')).toHaveLength(5);
  expect(page.button('Add target')).toBeDisabled();
  expect(page.dom.findAllContainers().at(-1)?.findContent().findAllBoxes().at(-1)?.getElement()).toHaveTextContent(
    'A rule holds at most 5 targets.',
  );
  page.click('Remove target 2');
  expect(page.fields('Target ID')).toHaveLength(4);
  expect(page.button('Add target')).toBeEnabled();
  page.click('Add target');
  expect(page.textbox('Target ID', 4)).toHaveFocus();
});

it('reads the name before creating a rule without targets and hands over success', async () => {
  let resolveLookup!: (taken: boolean) => void;
  lookup.mockReturnValueOnce(
    new Promise((resolve) => {
      resolveLookup = resolve;
    }),
  );
  const page = open();
  page.fill();
  page.click('Create rule');
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
  expect(page.fixture?.getElement()).toHaveTextContent(rulePath);
  expect(page.handOver).toHaveBeenCalledOnce();
  expect(page.dom.findFlashbar()?.findItemsByType('success')[0]?.findContent()?.getElement()).toHaveTextContent(
    'Rule route created.',
  );
});

it('waits for PutRule, then writes both targets and hands over success', async () => {
  let resolvePut!: () => void;
  put.mockReturnValueOnce(
    new Promise((resolve) => {
      resolvePut = resolve;
    }),
  );
  const page = open();
  page.fill();
  await addTopic(page, 'first');
  await addTopic(page, 'second', 1);
  page.click('Create rule');
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
  expect(page.fixture?.getElement()).toHaveTextContent(rulePath);
  expect(page.dom.findFlashbar()?.findItemsByType('success')[0]?.findContent()?.getElement()).toHaveTextContent(
    'Rule route created.',
  );
});

it('reports an existing name at its field and sends no write', async () => {
  lookup.mockResolvedValueOnce(true);
  const page = open();
  page.fill();
  page.click('Create rule');
  await waitForRender(() =>
    expect(page.field('Rule name')?.findError()?.getElement()).toHaveTextContent(
      'A rule named route already exists on default. Creating it again would replace it.',
    ),
  );
  expect(page.textbox('Rule name')).toHaveAccessibleDescription(/already exists on default/);
  expect(put).not.toHaveBeenCalled();
  expect(putTargets).not.toHaveBeenCalled();
  expect(page.handOver).not.toHaveBeenCalled();
});

it.each([
  ['DescribeRule', refused('DescribeRule', 'Read refused'), 'Read refused', false],
  ['PutRule', refused('PutRule', 'Pattern refused'), 'Pattern refused', false],
  ['PutRule', unsupported('PutRule'), 'Not implemented by the emulator', true],
  ['DescribeRule', unsupported('DescribeRule'), 'Not implemented by the emulator', false],
] as const)('keeps the form after a failure of %s (%s)', async (operation, error, reason, disables) => {
  const page = open();
  page.fill();
  await addTopic(page, 'first');
  if (operation === 'DescribeRule') lookup.mockRejectedValueOnce(error);
  else put.mockRejectedValueOnce(error);
  page.click('Create rule');
  await waitForRender(() => expect(page.dom.findAlert()?.getElement()).toHaveTextContent(operation));
  expect(page.dom.findAlert()?.getElement()).toHaveTextContent(reason);
  expect(page.textbox('Rule name')).toHaveValue('route');
  expect(page.textbox('Description - optional')).toHaveValue('Routes orders');
  expect(page.textbox('Event pattern')).toHaveValue(pattern);
  expect(page.textbox('Target ID')).toHaveValue('first');
  expect(page.select('Topic').findTrigger().getElement()).toHaveTextContent(/^orders$/);
  expect(page.fixture?.getElement()).toHaveTextContent(createPath);
  if (disables) expect(page.button('Create rule')).toBeDisabled();
  else expect(page.button('Create rule')).toBeEnabled();
  if (operation === 'DescribeRule') expect(put).not.toHaveBeenCalled();
  expect(putTargets).not.toHaveBeenCalled();
  expect(page.handOver).not.toHaveBeenCalled();
  expect(page.dom.findFlashbar()).toBeNull();
});

it.each([
  [refused('PutTargets', 'Targets refused'), 'Targets refused'],
  [new PutTargetsError([{ ErrorCode: 'Refused', ErrorMessage: 'Entry refused', TargetId: 'first' }]), 'Entry refused'],
  [unsupported('PutTargets'), 'Not implemented by the emulator'],
] as const)('hands over a warning after a refused target write (%s)', async (error, reason) => {
  const page = open();
  page.fill();
  await addTopic(page, 'first');
  putTargets.mockRejectedValueOnce(error);
  page.click('Create rule');
  const warning = 'Rule route created, but its targets were not added.';
  const flashContent = () => page.dom.findFlashbar()?.findItemsByType('warning')[0]?.findContent()?.getElement();
  await waitForRender(() => expect(flashContent()).toHaveTextContent(warning));
  expect(page.handOver).toHaveBeenCalledOnce();
  const [to, , note] = page.handOver.mock.calls[0] ?? [];
  expect(to).toBe(rulePath);
  expect(page.fixture?.getElement()).toHaveTextContent(new RegExp(`^${rulePath}$`));
  expect(flashContent()).toHaveTextContent('PutTargets');
  expect(flashContent()).toHaveTextContent(reason);
  const liveRegion = page.announcer?.getElement();
  expect(liveRegion).toHaveAttribute('role', 'status');
  expect(liveRegion).toHaveTextContent(`Warning ${warning}`);
  expect(liveRegion).toHaveTextContent('PutTargets');
  expect(liveRegion).toHaveTextContent(reason);
  expect(note).toEqual(
    error.failure.kind === 'not-implemented'
      ? { notImplemented: 'PutTargets', bus: 'default', rule: 'route' }
      : undefined,
  );
});

it('shows a 501 bus read at the field with Retry and sends no rule read or write', async () => {
  vi.mocked(getEventBus).mockRejectedValueOnce(unsupported('DescribeEventBus'));
  const page = open('?bus=orders');
  const busFailure = () => page.field('Event bus')?.findSecondaryControl();
  await waitForRender(() =>
    expect(busFailure()?.findStatusIndicator()?.getElement()).toHaveTextContent('Not implemented by the emulator'),
  );
  expect(busFailure()?.getElement()).toHaveTextContent(/for DescribeEventBus/);
  const retry = busFailure()?.findButton()?.getElement();
  expect(retry).toHaveAccessibleName('Retry');
  expect(retry).toBeEnabled();
  expect(page.select('Event bus').findTrigger().getElement()).toHaveTextContent('Choose an event bus');
  page.fill();
  page.click('Create rule');
  expectUnsent();
  if (retry) fireEvent.click(retry);
  await waitForRender(() => expect(page.select('Event bus').findTrigger().getElement()).toHaveTextContent(/^orders$/));
  expectUnsent();
});

it.each([
  ['?bus=missing', 'Event bus missing is not in your local emulator. Choose an event bus.'],
  ['?bus=arn%3Abus', 'Event bus arn:bus is not in your local emulator. Choose an event bus.'],
  ['?bus=', 'The address names no event bus. Choose an event bus.'],
])('validates an unresolved bus from %s and accepts a listed bus instead', async (search, message) => {
  vi.mocked(getEventBus).mockResolvedValueOnce({ kind: 'not-found' });
  const page = open(search);
  await waitForRender(() => expect(page.field('Event bus')?.findError()?.getElement()).toHaveTextContent(message));
  page.fill();
  page.click('Create rule');
  expect(page.select('Event bus').findTrigger().getElement()).toHaveFocus();
  expectUnsent();
  await page.choose('Event bus', 'orders');
  expect(page.field('Event bus')?.findError()).toBeNull();
  page.click('Create rule');
  await waitFor(() => expect(page.handOver).toHaveBeenCalledOnce());
  expect(lookup).toHaveBeenCalledWith(endpoint, 'orders', 'route', expect.any(AbortSignal));
});

it('focuses the first invalid field and sends no requests to create the rule', () => {
  const page = open();
  page.enter('Rule name', 'invalid/name');
  page.enter('Event pattern', '[]');
  page.click('Create rule');
  expect(page.textbox('Rule name')).toHaveFocus();
  expect(page.textbox('Rule name')).toHaveAttribute('aria-invalid', 'true');
  expect(page.textbox('Event pattern')).toHaveAttribute('aria-invalid', 'true');
  expectUnsent();
});

it('focuses a queue with its ARN still outstanding and sends no requests to create the rule', async () => {
  vi.mocked(getTargetQueueArn).mockReturnValueOnce(new Promise(() => undefined));
  const page = open();
  page.fill();
  page.click('Add target');
  page.enter('Target ID', 'queue');
  await page.choose('Target kind', 'sqs');
  await page.choose('Queue', queueUrl);
  page.click('Create rule');
  expect(page.field('Queue')?.findError()?.getElement()).toHaveTextContent('The queue ARN must be read before saving.');
  expect(page.select('Queue').findTrigger().getElement()).toHaveFocus();
  expectUnsent();
});

it('cancels an unchanged form directly to the chosen bus’s Rules', async () => {
  const page = open('?bus=orders');
  await waitForRender(() => expect(page.select('Event bus').findTrigger().getElement()).toHaveTextContent(/^orders$/));
  page.click('Cancel');
  expect(page.fixture?.getElement()).toHaveTextContent(/^\/aws\/events\/rules\?bus=orders$/);
  expect(page.dom.findModal()).toBeNull();
  expectUnsent();
});

it.each(['field', 'choice', 'row'] as const)('asks before discarding a changed %s', async (change) => {
  const page = open();
  if (change === 'field') page.enter('Description - optional', 'Routes orders');
  if (change === 'choice') fireEvent.click(page.radio('DISABLED'));
  if (change === 'row') page.click('Add target');
  page.click('Cancel');
  async function answerDialog(name: string) {
    const button = await waitForRender(() => {
      const dialog = page.dom.findModal();
      expect(dialog?.findHeader().getElement()).toHaveTextContent('Discard what you entered?');
      const footer = dialog?.findFooter();
      if (!footer) throw new Error('Expected the discard dialog footer');
      return namedButton(createWrapper(footer.getElement()), name);
    });
    fireEvent.click(button);
  }
  await answerDialog('Keep editing');
  if (change === 'field') expect(page.textbox('Description - optional')).toHaveValue('Routes orders');
  if (change === 'choice') expect(page.radio('DISABLED')).toBeChecked();
  if (change === 'row') expect(page.textbox('Target ID')).toBeVisible();
  page.click('Cancel');
  await answerDialog('Discard');
  expect(page.fixture?.getElement()).toHaveTextContent(/^\/aws\/events\/rules\?bus=default$/);
  expectUnsent();
});
