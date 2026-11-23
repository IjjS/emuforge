import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

const button = (name: string) => screen.getByRole('button', { name });
const click = (name: string) => fireEvent.click(button(name));
const disabled = (element: HTMLElement) =>
  (element instanceof HTMLButtonElement && element.disabled) || element.getAttribute('aria-disabled') === 'true';

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

function wrapperButton(name: string, scope = PAGE) {
  return scope.findAllButtons().find((candidate) => candidate.getElement().textContent?.trim() === name);
}

function clickWrapped(name: string) {
  const control = wrapperButton(name);
  if (!control) {
    throw new Error(`Button ${name} is missing`);
  }
  control.click();
}

function returnToPolicy() {
  const content = flash('error')?.findContent();
  return content && wrapperButton('Return to filter policy', content)?.getElement();
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
  fireEvent.click(await screen.findByRole('radio', { name: `sqs ${ENDPOINT}` }));
  click('Subscription settings');
}

function refreshSettings() {
  const refresh = editor()
    ?.findHeader()
    ?.findHeader()
    ?.findActions()
    ?.findAllButtons()
    .find((control) => control.getElement().textContent === 'Refresh')
    ?.getElement();
  if (refresh === undefined) {
    throw new Error('Settings refresh is missing');
  }
  return refresh;
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
    expect(disabled(fieldSelect('filter-policy-scope').findTrigger().getElement())).toBe(true);
    expect(disabled(button('Save scope'))).toBe(true);
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
    click('Close');
    expect(heading).not.toBeInTheDocument();
    expect(button('Subscription settings')).toHaveFocus();
  });

  it('sets raw delivery on without a policy and shows the readback', async () => {
    vi.mocked(api.getSubscriptionSettings)
      .mockResolvedValueOnce({ RawMessageDelivery: 'false' })
      .mockResolvedValueOnce({ RawMessageDelivery: 'true' });
    await openSettings();
    await waitFor(() => expect(policyDescription()).toHaveTextContent('No filter policy'));
    expectValue('raw-message-delivery', 'Off');
    choose('raw-message-delivery', 'true');
    click('Save raw message delivery');
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
    click('Close');
    click('Subscription settings');
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
    fireEvent.click(refreshSettings());
    await waitFor(() => expectPolicy(REPLACEMENT));
    expectValue('filter-policy-scope', 'Message attributes');
    expectValue('raw-message-delivery', 'On');
  });

  it('submits only the edited policy when raw delivery also has a draft and prevents duplicate writes', async () => {
    const write = hold<undefined>();
    vi.mocked(api.setSubscriptionSetting).mockReturnValueOnce(write.promise);
    vi.mocked(api.getSubscriptionSettings)
      .mockResolvedValueOnce(SETTINGS)
      .mockResolvedValueOnce({ ...SETTINGS, FilterPolicy: REPLACEMENT });
    await openSettings();
    await waitFor(() => expectPolicy(POLICY));
    choose('raw-message-delivery', 'true');
    changePolicy(REPLACEMENT);
    click('Save filter policy');
    expect(disabled(button('Save filter policy'))).toBe(true);
    expect(disabled(button('Save raw message delivery'))).toBe(true);
    click('Save filter policy');
    expect(api.setSubscriptionSetting).toHaveBeenCalledExactlyOnceWith(
      ENGINE,
      ARN,
      { name: 'FilterPolicy', value: REPLACEMENT },
      expect.any(AbortSignal),
    );
    write.resolve(undefined);
    await expectWriteSuccess();
  });

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

    fireEvent.click(refreshSettings());
    await waitFor(() => expect(policyDescription()).toHaveTextContent(externalPolicy));
    expectPolicy(REPLACEMENT);
    expectValue('filter-policy-scope', 'Message attributes');
    expectValue('raw-message-delivery', 'On');

    choose('raw-message-delivery', 'false');
    click('Save raw message delivery');
    await expectWriteSuccess();
    expectPolicy(REPLACEMENT);
    expectValue('raw-message-delivery', 'Off');
    readback.resolve({ ...refreshed, RawMessageDelivery: 'false' });
    await waitFor(() => {
      expect(disabled(button('Save filter policy'))).toBe(false);
      expect(disabled(button('Save scope'))).toBe(false);
    });
    expectPolicy(REPLACEMENT);
    expectValue('filter-policy-scope', 'Message attributes');
    expectValue('raw-message-delivery', 'Off');
    expect(disabled(button('Save raw message delivery'))).toBe(true);
    expect(api.setSubscriptionSetting).toHaveBeenCalledExactlyOnceWith(
      ENGINE,
      ARN,
      { name: 'RawMessageDelivery', value: 'false' },
      expect.any(AbortSignal),
    );

    fireEvent.click(refreshSettings());
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
    click('Save filter policy');
    await waitFor(() => expectPolicy(REPLACEMENT));
    expect(disabled(button('Save filter policy'))).toBe(true);
    expect(disabled(button('Save raw message delivery'))).toBe(false);
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
    click('Save filter policy');
    await expectWriteSuccess();
    await waitFor(() => expectReadStatus('The subscription settings could not be read'));
    expectReadErrorDetail('NotFound: Subscription does not exist');
    click('Retry');
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
    click('Retry');
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
    clickWrapped('Save filter policy');
    await waitFor(() => {
      expect(flash('error')?.findContent()?.getElement()).toHaveTextContent(`InvalidParameter: ${REFUSAL}`);
      expect(field('filter-policy')?.findError()?.getElement()).toHaveTextContent(`InvalidParameter: ${REFUSAL}`);
    });
    expect(flash('error')?.findContent()?.getElement()).toHaveTextContent(ARN);
    const action = returnToPolicy();
    expect(action).toBeVisible();
    action?.focus();
    await user.keyboard('{Enter}');
    expect(policyTextarea()).toHaveFocus();
    expect(policyTextarea()).toHaveValue('{{');

    changePolicy(REPLACEMENT);
    expect(field('filter-policy')?.findError()).toBeNull();
    clickWrapped('Save filter policy');
    await expectWriteSuccess();
    await waitFor(() => expect(wrapperButton('Save filter policy')?.isDisabled()).toBe(true));
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
      clickWrapped('Save filter policy');
      if (when === 'after') {
        write.resolve(undefined);
        await waitFor(() => expect(returnToPolicy()).toBeVisible());
      }
      PAGE.findTable()?.findRowSelectionArea(2)?.find('input[type="radio"]')?.click();
      clickWrapped('Subscription settings');
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
    ['filter-policy-scope', 'MessageAttributes', 'Save scope', 'FilterPolicyScope'],
    ['raw-message-delivery', 'true', 'Save raw message delivery', 'RawMessageDelivery'],
  ])('shows the original error when saving %s to a deleted subscription', async (label, value, save, name) => {
    vi.mocked(api.getSubscriptionSettings).mockResolvedValue(SETTINGS);
    vi.mocked(api.setSubscriptionSetting).mockRejectedValue(notFound('SetSubscriptionAttributes'));
    await openSettings();
    await waitFor(() => expectPolicy(POLICY));
    choose(label, value);
    click(save);
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
    expect(disabled(button(save))).toBe(false);
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
    expect(disabled(refreshSettings())).toBe(true);
  });

  it('names an unsupported write operation and disables writes while keeping refresh available', async () => {
    vi.mocked(api.getSubscriptionSettings).mockResolvedValue(SETTINGS);
    vi.mocked(api.setSubscriptionSetting).mockRejectedValue(
      new RequestError({ kind: 'not-implemented', operation: 'SetSubscriptionAttributes' }),
    );
    await openSettings();
    await waitFor(() => expectPolicy(POLICY));
    changePolicy(REPLACEMENT);
    click('Save filter policy');
    await waitFor(() => {
      const item = flash('info');
      expect(item?.getElement()).toBeVisible();
      expect(item?.findHeader()?.getElement()).toHaveTextContent('Not implemented by the emulator');
      expect(item?.findContent()?.getElement()).toHaveTextContent(
        'The emulator answered 501 Not Implemented for SetSubscriptionAttributes.',
      );
    });
    for (const name of ['Save filter policy', 'Clear filter policy', 'Save scope', 'Save raw message delivery']) {
      expect(button(name)).toBeVisible();
      expect(disabled(button(name))).toBe(true);
    }
    expect(disabled(refreshSettings())).toBe(false);
    fireEvent.click(refreshSettings());
    await waitFor(() => expect(api.getSubscriptionSettings).toHaveBeenCalledTimes(2));
  });

  it('clears only after confirmation and uses the new scope on recreation while preserving the raw delivery draft', async () => {
    vi.mocked(api.getSubscriptionSettings)
      .mockResolvedValueOnce({ ...SETTINGS, FilterPolicyScope: 'MessageAttributes' })
      .mockResolvedValueOnce({ RawMessageDelivery: 'false' })
      .mockResolvedValueOnce({ ...SETTINGS, FilterPolicy: REPLACEMENT, FilterPolicyScope: 'MessageAttributes' });
    await openSettings();
    await waitFor(() => expectPolicy(POLICY));
    click('Clear filter policy');
    const dialog = await clearModal();
    expect(dialog.findContent().find('.aws-area-value-address')?.getElement()).toHaveTextContent(ARN);
    const cancel = dialog
      .findFooter()
      ?.findAllButtons()
      .find((button) => button.getElement().textContent === 'Cancel');
    expect(cancel?.getElement()).toBeVisible();
    if (cancel) {
      fireEvent.click(cancel.getElement());
    }
    expect(api.setSubscriptionSetting).not.toHaveBeenCalled();
    expectPolicy(POLICY);
    expectValue('filter-policy-scope', 'Message attributes');
    choose('filter-policy-scope', 'MessageBody');
    choose('raw-message-delivery', 'true');
    expectValue('filter-policy-scope', 'Message body');
    click('Clear filter policy');
    const reopened = await clearModal();
    const confirm = reopened
      .findFooter()
      ?.findAllButtons()
      .find((button) => button.getElement().textContent === 'Clear filter policy');
    expect(confirm?.getElement()).toBeVisible();
    if (confirm) {
      fireEvent.click(confirm.getElement());
    }
    expect(api.setSubscriptionSetting).toHaveBeenCalledExactlyOnceWith(
      ENGINE,
      ARN,
      { name: 'FilterPolicy', value: '' },
      expect.any(AbortSignal),
    );
    await waitFor(() => {
      expect(policyDescription()).toHaveTextContent('No filter policy');
      expect(disabled(button('Save raw message delivery'))).toBe(false);
    });
    expectValue('filter-policy-scope', 'Not set');
    expectValue('raw-message-delivery', 'On');
    changePolicy(REPLACEMENT);
    click('Save filter policy');
    expect(api.setSubscriptionSetting).toHaveBeenNthCalledWith(
      2,
      ENGINE,
      ARN,
      { name: 'FilterPolicy', value: REPLACEMENT },
      expect.any(AbortSignal),
    );
    await waitFor(() => {
      expect(disabled(button('Save raw message delivery'))).toBe(false);
      expectValue('filter-policy-scope', 'Message attributes');
    });
    expect(disabled(button('Save filter policy'))).toBe(true);
    expect(disabled(button('Save scope'))).toBe(true);
    expectValue('raw-message-delivery', 'On');
  });
});
