import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../../lib/aws/request';
import type { AreaConnection } from '../../../components/emulator-line';
import AwsArea from '../../../index';
import * as api from '../api';

function hold<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  getTopic: vi.fn(),
  listSubscriptions: vi.fn(),
  readDelivery: vi.fn(),
  getSubscriptionSettings: vi.fn(),
  setSubscriptionSetting: vi.fn(),
}));

const TOPIC = 'arn:aws:sns:us-east-1:000000000000:orders';
const ARN = `${TOPIC}:subscription`;
const ENDPOINT = 'arn:aws:sqs:us-east-1:000000000000:orders';
const ENGINE = 'http://127.0.0.1:8309';
const connection: AreaConnection = {
  engineOrigin: ENGINE,
  result: {
    kind: 'connected',
    checkedAt: 0,
    emulator: { port: 9309, endpoint: 'https://127.0.0.1:9309' },
  },
};

const POLICY = '{"color":["red"]}';
const REPLACEMENT = '{"color":["blue"]}';
const REFUSAL = 'Filter policy could not be parsed as JSON';
const SETTINGS: api.SubscriptionSettingsAttributes = {
  FilterPolicy: POLICY,
  FilterPolicyScope: 'MessageBody',
  RawMessageDelivery: 'false',
};
const notFound = (operation: string) =>
  new RequestError({ kind: 'other', operation, code: 'NotFound', message: 'Subscription does not exist' });
const invalidPolicy = () =>
  new RequestError({
    kind: 'other',
    operation: 'SetSubscriptionAttributes',
    code: 'InvalidParameter',
    message: REFUSAL,
  });
const PAGE = createWrapper(document.body);

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('matchMedia', (media: string) => ({
    media,
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  vi.mocked(api.getTopic).mockResolvedValue({
    found: true,
    topic: { arn: TOPIC, fifo: false, contentBasedDeduplication: false },
  });
  vi.mocked(api.listSubscriptions).mockResolvedValue({
    subscriptions: [{ arn: ARN, endpoint: ENDPOINT, protocol: 'sqs', pending: false }],
  });
  vi.mocked(api.readDelivery).mockResolvedValue({ kind: 'allowed' });
  vi.mocked(api.setSubscriptionSetting).mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const SAVE_ACTIONS = ['save-policy', 'save-scope', 'save-raw-delivery'] as const;

function editor() {
  return PAGE.findContainer('[data-testid="subscription-settings"]');
}

function field(id: string) {
  return editor()?.findContent().findFormField(`[data-testid="subscription-${id}"]`);
}

function fieldSelect(id: string) {
  const select = field(id)?.findControl()?.findSelect();
  if (!select) {
    throw new Error(`Select for ${id} is missing`);
  }
  return select;
}

function choose(id: string, value: string) {
  const select = fieldSelect(id);
  select.openDropdown();
  select.selectOptionByValue(value);
}

function expectValue(id: string, value: string) {
  expect(fieldSelect(id).findTrigger().getElement()).toHaveTextContent(value);
}

function flash(type: 'success' | 'error' | 'info') {
  return PAGE.findFlashbar()?.findItemsByType(type)[0];
}

function expectWriteSuccess() {
  return waitFor(() => {
    const header = flash('success')?.findHeader()?.getElement();
    expect(header).toBeVisible();
    expect(header).toHaveTextContent('Subscription settings updated');
  });
}

async function clearModal() {
  return waitFor(() => {
    const modal = PAGE.findModal();
    if (!modal) {
      throw new Error('Clear policy modal is missing');
    }
    expect(modal.getElement()).toBeVisible();
    expect(modal.findHeader().getElement()).toHaveTextContent('Clear filter policy?');
    expect(modal.getElement()).toHaveAccessibleName('Clear filter policy?');
    return modal;
  });
}

function readStatus() {
  return editor()?.findContent().find('[data-testid="subscription-settings-read-status"]');
}

function expectReadStatus(text: string) {
  const status = readStatus()?.findStatusIndicator()?.getElement();
  expect(status).toBeVisible();
  expect(status?.textContent?.trim()).toBe(text);
}

function expectReadErrorDetail(text: string) {
  const detail = readStatus()?.findBox('p')?.getElement();
  expect(detail).toBeVisible();
  expect(detail?.textContent).toBe(text);
}

function policyDescription() {
  return field('filter-policy')?.findDescription()?.getElement();
}

function policyTextarea() {
  return field('filter-policy')?.findControl()?.findTextarea()?.findNativeTextarea().getElement();
}

function expectPolicy(value: string) {
  const textarea = policyTextarea();
  expect(textarea).toBeVisible();
  expect(textarea).toHaveValue(value);
}

function changePolicy(value: string) {
  const textarea = policyTextarea();
  if (!textarea) {
    throw new Error('Filter policy textarea is missing');
  }
  fireEvent.change(textarea, { target: { value } });
}

function writeButton(id: string) {
  const control = editor()?.findContent().findButton(`[data-testid="subscription-settings-${id}"]`);
  if (!control) {
    throw new Error(`Write control ${id} is missing`);
  }
  return control;
}

function headerButton(index: number) {
  const control = editor()?.findHeader()?.findHeader()?.findActions()?.findAllButtons()[index];
  if (!control) {
    throw new Error(`Settings header button ${index} is missing`);
  }
  return control;
}

function settingsOpener() {
  const control = PAGE.findTable()?.findHeaderSlot()?.findHeader()?.findActions()?.findButton();
  if (!control) {
    throw new Error('Settings opener is missing');
  }
  expect(control.getElement()).toHaveTextContent('Subscription settings');
  return control;
}

function retryRead() {
  const control = readStatus()?.findButton();
  expect(control?.getElement()).toHaveTextContent('Retry');
  control?.click();
}

function returnToPolicy() {
  return flash('error')?.findContent()?.findButton()?.getElement();
}

function selectRow(index: number) {
  const radio = PAGE.findTable()?.findRowSelectionArea(index)?.find('input[type="radio"]');
  if (!radio) {
    throw new Error(`Subscription row ${index} is missing`);
  }
  radio.click();
}

async function openSettings() {
  const router = createMemoryRouter(
    [
      {
        path: '/aws/*',
        element: (
          <AwsArea
            headerSelector="#top-bar"
            onPageTitle={() => undefined}
            onContentTarget={() => undefined}
            routeChanges={0}
            connection={connection}
          />
        ),
      },
    ],
    { initialEntries: [`/aws/sns/topics/topic/${encodeURIComponent(TOPIC)}`] },
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(PAGE.findTable()?.findRowSelectionArea(1)?.getElement()).toBeVisible());
  selectRow(1);
  settingsOpener().click();
}

function refreshSettings() {
  const refresh = headerButton(0);
  expect(refresh.getElement()).toHaveTextContent('Refresh');
  return refresh;
}

async function confirmClearWhilePending() {
  const user = userEvent.setup();
  const opener = writeButton('clear-policy').getElement();
  opener.focus();
  await user.keyboard('{Enter}');
  const dialog = await clearModal();
  const dismiss = dialog.findHeader().findButton('[data-testid="subscription-settings-clear-dismiss"]')?.getElement();
  expect(dismiss).toBeVisible();
  expect(dismiss).toBeEnabled();
  const confirm = dialog.findFooter()?.findAllButtons()[1];
  if (!confirm) {
    throw new Error('Clear policy confirmation is missing');
  }
  const target = confirm.getElement();
  expect(target).toHaveTextContent('Clear filter policy');
  target.focus();
  const focusOut = vi.fn();
  target.addEventListener('focusout', focusOut);
  await user.keyboard('{Enter}');
  expect(api.setSubscriptionSetting).toHaveBeenCalledTimes(1);
  expect(target).toHaveFocus();
  expect(target).not.toBeDisabled();
  expect(target).toHaveAttribute('aria-disabled', 'true');
  expect(confirm.findLoadingIndicator()?.getElement()).toBeVisible();
  expect(dialog.findFooter()?.findAllButtons()[0]?.getElement()).toBeDisabled();
  expect(dismiss).toBeVisible();
  expect(dismiss).toBeDisabled();
  const progress = dialog.findContent().find('[data-testid="subscription-settings-clear-progress"]');
  expect(progress?.getElement()).toHaveAttribute('role', 'status');
  expect(progress?.findStatusIndicator()?.getElement()).toHaveTextContent('Clearing filter policy');
  await user.keyboard('{Enter} ');
  fireEvent.keyDown(target, { key: 'Escape', code: 'Escape', keyCode: 27 });
  expect(dialog.getElement()).toBeVisible();
  expect(target).toHaveFocus();
  expect(focusOut).not.toHaveBeenCalled();
  await user.tab({ shift: true });
  expect(target).toHaveFocus();
  expect(api.setSubscriptionSetting).toHaveBeenCalledExactlyOnceWith(
    ENGINE,
    ARN,
    { name: 'FilterPolicy', value: '' },
    expect.any(AbortSignal),
  );
}

function clearFeedback() {
  return editor()?.findContent().find('[data-testid="subscription-settings-clear-status"]');
}

describe('subscription settings', () => {
  it('shows loading, then missing values and an unavailable scope', async () => {
    const read = hold<api.SubscriptionSettingsAttributes>();
    vi.mocked(api.getSubscriptionSettings).mockReturnValueOnce(read.promise);
    await openSettings();
    expectReadStatus('Loading subscription settings');
    read.resolve({});
    await waitFor(() => expect(policyDescription()).toHaveTextContent('No filter policy'));
    expect(field('filter-policy')?.findConstraint()?.getElement()).toHaveTextContent('Enter a JSON filter policy.');
    expect(field('filter-policy-scope')?.findConstraint()?.getElement()).toHaveTextContent(
      'Save a filter policy to edit its scope.',
    );
    changePolicy(REPLACEMENT);
    expectValue('filter-policy-scope', 'Not set');
    expectValue('raw-message-delivery', 'Not set');
    expect(fieldSelect('filter-policy-scope').findTrigger().getElement()).toBeDisabled();
    expect(writeButton('save-scope').isDisabled()).toBe(true);
  });

  it('focuses the settings heading on open and restores focus to the opener on Close', async () => {
    const read = hold<api.SubscriptionSettingsAttributes>();
    vi.mocked(api.getSubscriptionSettings).mockReturnValueOnce(read.promise);
    await openSettings();
    const headingText = editor()?.findHeader()?.findHeader()?.findHeadingText().getElement();
    expect(headingText).toHaveTextContent('Subscription settings');
    const heading = headingText?.closest('h2');
    expect(heading).toHaveFocus();
    read.resolve(SETTINGS);
    await waitFor(() => expectPolicy(POLICY));
    expect(heading).toHaveFocus();
    const close = headerButton(1);
    expect(close.getElement()).toHaveTextContent('Close');
    close.click();
    expect(heading).not.toBeInTheDocument();
    expect(settingsOpener().getElement()).toHaveFocus();
  });

  it('sets raw delivery on without a policy and shows the readback', async () => {
    vi.mocked(api.getSubscriptionSettings)
      .mockResolvedValueOnce({ RawMessageDelivery: 'false' })
      .mockResolvedValueOnce({ RawMessageDelivery: 'true' });
    await openSettings();
    await waitFor(() => expect(policyDescription()).toHaveTextContent('No filter policy'));
    expectValue('raw-message-delivery', 'Off');
    choose('raw-message-delivery', 'true');
    writeButton('save-raw-delivery').click();
    expect(api.setSubscriptionSetting).toHaveBeenCalledExactlyOnceWith(
      ENGINE,
      ARN,
      { name: 'RawMessageDelivery', value: 'true' },
      expect.any(AbortSignal),
    );
    await expectWriteSuccess();
    await waitFor(() => {
      expect(api.getSubscriptionSettings).toHaveBeenCalledTimes(2);
      expect(readStatus()).toBeNull();
    });
    expectValue('raw-message-delivery', 'On');
    expect(policyDescription()).toHaveTextContent('No filter policy');
    expectValue('filter-policy-scope', 'Not set');
  });

  it('preserves an empty object policy and reads external changes when reopened', async () => {
    vi.mocked(api.getSubscriptionSettings)
      .mockResolvedValueOnce({ ...SETTINGS, FilterPolicy: '{}' })
      .mockResolvedValueOnce({ ...SETTINGS, FilterPolicy: REPLACEMENT, FilterPolicyScope: 'MessageAttributes' });
    await openSettings();
    await waitFor(() => expectPolicy('{}'));
    expectValue('filter-policy-scope', 'Message body');
    changePolicy('unsaved');
    headerButton(1).click();
    settingsOpener().click();
    await waitFor(() => expectPolicy(REPLACEMENT));
    expectValue('filter-policy-scope', 'Message attributes');
    expect(api.setSubscriptionSetting).not.toHaveBeenCalled();
    expect(api.getSubscriptionSettings).toHaveBeenCalledTimes(2);
  });

  it('refreshes all three settings from the emulator', async () => {
    vi.mocked(api.getSubscriptionSettings).mockResolvedValueOnce(SETTINGS).mockResolvedValueOnce({
      FilterPolicy: REPLACEMENT,
      FilterPolicyScope: 'MessageAttributes',
      RawMessageDelivery: 'true',
    });
    await openSettings();
    await waitFor(() => expectPolicy(POLICY));
    refreshSettings().click();
    await waitFor(() => expectPolicy(REPLACEMENT));
    expectValue('filter-policy-scope', 'Message attributes');
    expectValue('raw-message-delivery', 'On');
  });

  it.each([
    ['save-policy', 'Save filter policy', 'FilterPolicy', REPLACEMENT],
    ['save-scope', 'Save scope', 'FilterPolicyScope', 'MessageAttributes'],
    ['save-raw-delivery', 'Save raw message delivery', 'RawMessageDelivery', 'true'],
  ] as const)(
    'keeps keyboard focus on %s and blocks every other write while pending',
    async (id, label, name, value) => {
      const user = userEvent.setup();
      const write = hold<undefined>();
      vi.mocked(api.setSubscriptionSetting).mockReturnValueOnce(write.promise);
      vi.mocked(api.getSubscriptionSettings)
        .mockResolvedValueOnce(SETTINGS)
        .mockResolvedValueOnce({ ...SETTINGS, [name]: value });
      await openSettings();
      await waitFor(() => expectPolicy(POLICY));
      changePolicy(REPLACEMENT);
      choose('filter-policy-scope', 'MessageAttributes');
      choose('raw-message-delivery', 'true');

      for (const candidate of [...SAVE_ACTIONS, 'clear-policy']) {
        expect(writeButton(candidate).isDisabled()).toBe(false);
      }
      const submit = writeButton(id);
      const target = submit.getElement();
      expect(target).toHaveTextContent(label);
      target.focus();
      expect(target).toHaveFocus();
      await user.keyboard('{Enter}');
      expect(api.setSubscriptionSetting).toHaveBeenCalledTimes(1);
      expect(target).toHaveFocus();
      expect(target).not.toBeDisabled();
      expect(target).toHaveAttribute('aria-disabled', 'true');
      expect(submit.findLoadingIndicator()?.getElement()).toBeVisible();
      for (const competitor of [...SAVE_ACTIONS.filter((action) => action !== id), 'clear-policy']) {
        expect(writeButton(competitor).getElement()).toBeDisabled();
      }
      await user.keyboard('{Enter}');
      expect(target).toHaveFocus();
      expect(api.setSubscriptionSetting).toHaveBeenCalledExactlyOnceWith(
        ENGINE,
        ARN,
        { name, value },
        expect.any(AbortSignal),
      );
      write.resolve(undefined);
      await expectWriteSuccess();
    },
  );

  it('preserves the policy and scope drafts through Refresh and raw delivery readback', async () => {
    const externalPolicy = '{"color":["green"]}';
    const refreshed = { ...SETTINGS, FilterPolicy: externalPolicy, RawMessageDelivery: 'true' };
    const readback = hold<api.SubscriptionSettingsAttributes>();
    vi.mocked(api.getSubscriptionSettings)
      .mockResolvedValueOnce(SETTINGS)
      .mockResolvedValueOnce(refreshed)
      .mockReturnValueOnce(readback.promise)
      .mockResolvedValueOnce({ ...refreshed });
    await openSettings();
    await waitFor(() => expectPolicy(POLICY));
    changePolicy(REPLACEMENT);
    choose('filter-policy-scope', 'MessageAttributes');

    refreshSettings().click();
    await waitFor(() => expect(policyDescription()).toHaveTextContent(externalPolicy));
    expectPolicy(REPLACEMENT);
    expectValue('filter-policy-scope', 'Message attributes');
    expectValue('raw-message-delivery', 'On');

    choose('raw-message-delivery', 'false');
    writeButton('save-raw-delivery').click();
    await expectWriteSuccess();
    expectPolicy(REPLACEMENT);
    expectValue('raw-message-delivery', 'Off');
    readback.resolve({ ...refreshed, RawMessageDelivery: 'false' });
    await waitFor(() => {
      expect(writeButton('save-policy').isDisabled()).toBe(false);
      expect(writeButton('save-scope').isDisabled()).toBe(false);
    });
    expectPolicy(REPLACEMENT);
    expectValue('filter-policy-scope', 'Message attributes');
    expectValue('raw-message-delivery', 'Off');
    expect(writeButton('save-raw-delivery').isDisabled()).toBe(true);
    expect(api.setSubscriptionSetting).toHaveBeenCalledExactlyOnceWith(
      ENGINE,
      ARN,
      { name: 'RawMessageDelivery', value: 'false' },
      expect.any(AbortSignal),
    );

    refreshSettings().click();
    await waitFor(() => expectValue('raw-message-delivery', 'On'));
    expectPolicy(REPLACEMENT);
    expectValue('filter-policy-scope', 'Message attributes');
  });

  it('reconciles a saved policy to the emulator readback and preserves the raw delivery draft', async () => {
    const submitted = '{ "color" : ["blue"] }';
    vi.mocked(api.getSubscriptionSettings)
      .mockResolvedValueOnce(SETTINGS)
      .mockResolvedValueOnce({ ...SETTINGS, FilterPolicy: REPLACEMENT });
    await openSettings();
    await waitFor(() => expectPolicy(POLICY));
    changePolicy(submitted);
    choose('raw-message-delivery', 'true');
    writeButton('save-policy').click();
    await waitFor(() => expectPolicy(REPLACEMENT));
    expect(writeButton('save-policy').isDisabled()).toBe(true);
    expect(writeButton('save-raw-delivery').isDisabled()).toBe(false);
    expectValue('raw-message-delivery', 'On');
  });

  it('keeps the write result alongside a failed readback and retries the read', async () => {
    vi.mocked(api.getSubscriptionSettings)
      .mockResolvedValueOnce(SETTINGS)
      .mockRejectedValueOnce(notFound('GetSubscriptionAttributes'))
      .mockResolvedValueOnce({ ...SETTINGS, FilterPolicy: REPLACEMENT });
    await openSettings();
    await waitFor(() => expectPolicy(POLICY));
    changePolicy(REPLACEMENT);
    writeButton('save-policy').click();
    await expectWriteSuccess();
    await waitFor(() => expectReadStatus('The subscription settings could not be read'));
    expectReadErrorDetail('NotFound: Subscription does not exist');
    retryRead();
    await waitFor(() => {
      expect(readStatus()).toBeNull();
    });
    expectPolicy(REPLACEMENT);
    expect(api.setSubscriptionSetting).toHaveBeenCalledTimes(1);
  });

  it('shows the original error when reading a deleted subscription and lets the user retry', async () => {
    vi.mocked(api.getSubscriptionSettings).mockRejectedValue(notFound('GetSubscriptionAttributes'));
    await openSettings();
    await waitFor(() => expectReadErrorDetail('NotFound: Subscription does not exist'));
    retryRead();
    await waitFor(() => expect(api.getSubscriptionSettings).toHaveBeenCalledTimes(2));
  });

  it('returns keyboard focus from the refusal to the draft and clears the field error on correction', async () => {
    const user = userEvent.setup();
    vi.mocked(api.getSubscriptionSettings)
      .mockResolvedValueOnce(SETTINGS)
      .mockResolvedValueOnce({ ...SETTINGS, FilterPolicy: REPLACEMENT });
    vi.mocked(api.setSubscriptionSetting).mockRejectedValueOnce(invalidPolicy());
    await openSettings();
    await waitFor(() => expect(policyTextarea()).toHaveValue(POLICY));
    changePolicy('{{');
    writeButton('save-policy').click();
    await waitFor(() => {
      expect(flash('error')?.findContent()?.getElement()).toHaveTextContent(`InvalidParameter: ${REFUSAL}`);
      expect(field('filter-policy')?.findError()?.getElement()).toHaveTextContent(`InvalidParameter: ${REFUSAL}`);
    });
    expect(flash('error')?.findContent()?.getElement()).toHaveTextContent(ARN);
    const action = returnToPolicy();
    expect(action).toBeVisible();
    expect(action).toHaveTextContent('Return to filter policy');
    action?.focus();
    await user.keyboard('{Enter}');
    expect(policyTextarea()).toHaveFocus();
    expect(policyTextarea()).toHaveValue('{{');

    changePolicy(REPLACEMENT);
    expect(field('filter-policy')?.findError()).toBeNull();
    writeButton('save-policy').click();
    await expectWriteSuccess();
    await waitFor(() => expect(writeButton('save-policy').isDisabled()).toBe(true));
    expect(policyTextarea()).toHaveValue(REPLACEMENT);
    expect(api.setSubscriptionSetting).toHaveBeenNthCalledWith(
      2,
      ENGINE,
      ARN,
      { name: 'FilterPolicy', value: REPLACEMENT },
      expect.any(AbortSignal),
    );
  });

  it.each(['before', 'after'])(
    'keeps a refusal tied to its submission when the editor switches %s it arrives',
    async (when) => {
      const otherArn = `${TOPIC}:other-subscription`;
      vi.mocked(api.listSubscriptions).mockResolvedValue({
        subscriptions: [
          { arn: ARN, endpoint: ENDPOINT, protocol: 'sqs', pending: false },
          { arn: otherArn, endpoint: `${ENDPOINT}-other`, protocol: 'sqs', pending: false },
        ],
      });
      vi.mocked(api.getSubscriptionSettings).mockImplementation(async (_, arn) =>
        arn === ARN ? SETTINGS : { ...SETTINGS, FilterPolicy: REPLACEMENT },
      );
      const write = hold<undefined>();
      vi.mocked(api.setSubscriptionSetting).mockReturnValueOnce(
        write.promise.then(() => {
          throw invalidPolicy();
        }),
      );
      await openSettings();
      await waitFor(() => expect(policyTextarea()).toHaveValue(POLICY));
      changePolicy('{{');
      writeButton('save-policy').click();
      if (when === 'after') {
        write.resolve(undefined);
        await waitFor(() => expect(returnToPolicy()).toBeVisible());
      }
      selectRow(2);
      settingsOpener().click();
      await waitFor(() => expect(policyTextarea()).toHaveValue(REPLACEMENT));
      if (when === 'before') {
        write.resolve(undefined);
      }
      await waitFor(() => {
        const content = flash('error')?.findContent()?.getElement();
        expect(content).toHaveTextContent(`InvalidParameter: ${REFUSAL}`);
        expect(content).toHaveTextContent(ARN);
        expect(content).not.toHaveTextContent(otherArn);
        expect(returnToPolicy()).toBeUndefined();
        expect(field('filter-policy')?.findError()).toBeNull();
      });
    },
  );

  it.each([
    ['filter-policy-scope', 'MessageAttributes', 'save-scope', 'FilterPolicyScope'],
    ['raw-message-delivery', 'true', 'save-raw-delivery', 'RawMessageDelivery'],
  ])('shows the original error when saving %s to a deleted subscription', async (label, value, save, name) => {
    vi.mocked(api.getSubscriptionSettings).mockResolvedValue(SETTINGS);
    vi.mocked(api.setSubscriptionSetting).mockRejectedValue(notFound('SetSubscriptionAttributes'));
    await openSettings();
    await waitFor(() => expectPolicy(POLICY));
    choose(label, value);
    writeButton(save).click();
    await waitFor(() => {
      const content = flash('error')?.findContent()?.getElement();
      expect(content).toBeVisible();
      expect(content).toHaveTextContent('NotFound');
      expect(content).toHaveTextContent('Subscription does not exist');
    });
    expect(flash('success')).toBeUndefined();
    expect(api.setSubscriptionSetting).toHaveBeenCalledExactlyOnceWith(
      ENGINE,
      ARN,
      { name, value },
      expect.any(AbortSignal),
    );
    expect(writeButton(save).isDisabled()).toBe(false);
  });

  it('names an unsupported read operation and visibly disables its control', async () => {
    vi.mocked(api.getSubscriptionSettings).mockRejectedValue(
      new RequestError({ kind: 'not-implemented', operation: 'GetSubscriptionAttributes' }),
    );
    await openSettings();
    await waitFor(() => expectReadStatus('Not implemented by the emulator'));
    expectReadErrorDetail(
      'The emulator answered 501 Not Implemented for GetSubscriptionAttributes, so Studio cannot show the subscription settings.',
    );
    expect(refreshSettings().isDisabled()).toBe(true);
  });

  it('names an unsupported write operation and disables writes while keeping refresh available', async () => {
    vi.mocked(api.getSubscriptionSettings).mockResolvedValue(SETTINGS);
    vi.mocked(api.setSubscriptionSetting).mockRejectedValue(
      new RequestError({ kind: 'not-implemented', operation: 'SetSubscriptionAttributes' }),
    );
    await openSettings();
    await waitFor(() => expectPolicy(POLICY));
    changePolicy(REPLACEMENT);
    writeButton('save-policy').click();
    await waitFor(() => {
      const item = flash('info');
      expect(item?.getElement()).toBeVisible();
      expect(item?.findHeader()?.getElement()).toHaveTextContent('Not implemented by the emulator');
      expect(item?.findContent()?.getElement()).toHaveTextContent(
        'The emulator answered 501 Not Implemented for SetSubscriptionAttributes.',
      );
    });
    for (const id of [...SAVE_ACTIONS, 'clear-policy']) {
      const control = writeButton(id);
      expect(control.getElement()).toBeVisible();
      expect(control.isDisabled()).toBe(true);
    }
    expect(refreshSettings().isDisabled()).toBe(false);
    refreshSettings().click();
    await waitFor(() => expect(api.getSubscriptionSettings).toHaveBeenCalledTimes(2));
  });

  it('keeps a clear confirmation focused and restores focus to its opener when the write is refused', async () => {
    const otherArn = `${TOPIC}:other-subscription`;
    vi.mocked(api.listSubscriptions).mockResolvedValue({
      subscriptions: [
        { arn: ARN, endpoint: ENDPOINT, protocol: 'sqs', pending: false },
        { arn: otherArn, endpoint: `${ENDPOINT}-other`, protocol: 'sqs', pending: false },
      ],
    });
    const write = hold<undefined>();
    vi.mocked(api.setSubscriptionSetting).mockReturnValueOnce(
      write.promise.then(() => {
        throw notFound('SetSubscriptionAttributes');
      }),
    );
    vi.mocked(api.getSubscriptionSettings).mockImplementation(async (_, arn) =>
      arn === ARN ? SETTINGS : { ...SETTINGS, FilterPolicy: REPLACEMENT },
    );
    await openSettings();
    await waitFor(() => expectPolicy(POLICY));
    expect(clearFeedback()?.getElement()).toBeEmptyDOMElement();
    await confirmClearWhilePending();

    write.resolve(undefined);
    await waitFor(() => {
      expect(PAGE.findModal()).toBeNull();
      const flashContent = flash('error')?.findContent()?.getElement();
      expect(flashContent).toHaveTextContent('NotFound: Subscription does not exist');
      expect(flashContent).toHaveTextContent(ARN);
      const opener = writeButton('clear-policy').getElement();
      expect(opener).toHaveFocus();
      expect(opener).toBeEnabled();
      const feedback = clearFeedback();
      expect(feedback?.getElement()).toHaveAttribute('role', 'status');
      const message = feedback?.findStatusIndicator()?.getElement();
      expect(message).toBeVisible();
      expect(message).toHaveTextContent('The filter policy could not be cleared.');
    });
    expect(api.setSubscriptionSetting).toHaveBeenCalledTimes(1);
    expect(api.getSubscriptionSettings).toHaveBeenCalledTimes(1);
    expectPolicy(POLICY);
    selectRow(2);
    settingsOpener().click();
    await waitFor(() => expectPolicy(REPLACEMENT));
    expect(clearFeedback()?.getElement()).toBeEmptyDOMElement();
    expect(flash('error')?.findContent()?.getElement()).toHaveTextContent(ARN);
  });

  it('keeps a clear confirmation focused, restores focus through readback, and uses the new scope on recreation', async () => {
    const write = hold<undefined>();
    const readback = hold<api.SubscriptionSettingsAttributes>();
    vi.mocked(api.setSubscriptionSetting).mockReturnValueOnce(write.promise);
    vi.mocked(api.getSubscriptionSettings)
      .mockResolvedValueOnce({ ...SETTINGS, FilterPolicyScope: 'MessageAttributes' })
      .mockReturnValueOnce(readback.promise)
      .mockResolvedValueOnce({ ...SETTINGS, FilterPolicy: REPLACEMENT, FilterPolicyScope: 'MessageAttributes' });
    await openSettings();
    await waitFor(() => expectPolicy(POLICY));
    writeButton('clear-policy').click();
    const dialog = await clearModal();
    expect(dialog.findContent().find('.aws-area-value-address')?.getElement()).toHaveTextContent(ARN);
    const cancel = dialog.findFooter()?.findAllButtons()[0];
    expect(cancel?.getElement()).toBeVisible();
    expect(cancel?.getElement()).toHaveTextContent('Cancel');
    cancel?.click();
    expect(PAGE.findModal()).toBeNull();
    writeButton('clear-policy').click();
    const dismiss = (await clearModal()).findHeader().findButton('[data-testid="subscription-settings-clear-dismiss"]');
    expect(dismiss?.getElement()).toHaveAccessibleName('Close dialog');
    dismiss?.click();
    expect(PAGE.findModal()).toBeNull();
    writeButton('clear-policy').click();
    const escape = await clearModal();
    fireEvent.keyDown(escape.findHeader().getElement(), { key: 'Escape', code: 'Escape', keyCode: 27 });
    expect(PAGE.findModal()).toBeNull();
    expect(api.setSubscriptionSetting).not.toHaveBeenCalled();
    expectPolicy(POLICY);
    expectValue('filter-policy-scope', 'Message attributes');
    choose('filter-policy-scope', 'MessageBody');
    choose('raw-message-delivery', 'true');
    expectValue('filter-policy-scope', 'Message body');
    await confirmClearWhilePending();
    write.resolve(undefined);
    await expectWriteSuccess();
    const close = headerButton(1).getElement();
    expect(close).toHaveTextContent('Close');
    await waitFor(() => {
      expect(PAGE.findModal()).toBeNull();
      expect(close).toHaveFocus();
      expect(close).toBeEnabled();
      expectReadStatus('Loading subscription settings');
    });
    readback.resolve({ RawMessageDelivery: 'false' });
    await waitFor(() => {
      expect(policyDescription()).toHaveTextContent('No filter policy');
      expect(writeButton('save-raw-delivery').isDisabled()).toBe(false);
    });
    expect(close).toHaveFocus();
    expect(close).toBeEnabled();
    expect(clearFeedback()?.getElement()).toBeEmptyDOMElement();
    expect(writeButton('clear-policy').isDisabled()).toBe(true);
    expect(api.setSubscriptionSetting).toHaveBeenCalledTimes(1);
    expectValue('filter-policy-scope', 'Not set');
    expectValue('raw-message-delivery', 'On');
    changePolicy(REPLACEMENT);
    writeButton('save-policy').click();
    expect(api.setSubscriptionSetting).toHaveBeenNthCalledWith(
      2,
      ENGINE,
      ARN,
      { name: 'FilterPolicy', value: REPLACEMENT },
      expect.any(AbortSignal),
    );
    await waitFor(() => {
      expect(writeButton('save-raw-delivery').isDisabled()).toBe(false);
      expectValue('filter-policy-scope', 'Message attributes');
    });
    expect(writeButton('save-policy').isDisabled()).toBe(true);
    expect(writeButton('save-scope').isDisabled()).toBe(true);
    expectValue('raw-message-delivery', 'On');
  });
});
