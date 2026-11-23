import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
const SETTINGS: api.SubscriptionSettingsAttributes = {
  FilterPolicy: POLICY,
  FilterPolicyScope: 'MessageBody',
  RawMessageDelivery: 'false',
};
const notFound = (operation: string) =>
  new RequestError({ kind: 'other', operation, code: 'NotFound', message: 'Subscription does not exist' });

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

function fieldSelect(label: string) {
  const field = createWrapper(document.body)
    .findAllFormFields()
    .find((formField) => formField.findLabel()?.getElement().textContent === label);
  const select = field?.findControl()?.findSelect();
  if (!select) {
    throw new Error(`Select for ${label} is missing`);
  }
  return select;
}

function choose(label: string, value: string) {
  const select = fieldSelect(label);
  select.openDropdown();
  select.selectOptionByValue(value);
}

function expectValue(label: string, value: string) {
  expect(fieldSelect(label).findTrigger().getElement()).toHaveTextContent(value);
}

function changePolicy(value: string) {
  fireEvent.change(screen.getByRole('textbox', { name: 'Filter policy' }), { target: { value } });
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
  const refresh = screen.getAllByRole('button', { name: 'Refresh' }).at(-1);
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
    expect(screen.getByText('Loading subscription settings')).toBeVisible();
    read.resolve({});
    expect(await screen.findByText('No filter policy')).toBeVisible();
    expectValue('Filter policy scope', 'Not set');
    expectValue('Raw message delivery', 'Not set');
    expect(disabled(fieldSelect('Filter policy scope').findTrigger().getElement())).toBe(true);
    expect(disabled(button('Save scope'))).toBe(true);
  });

  it('sets raw delivery on without a policy and shows the readback', async () => {
    vi.mocked(api.getSubscriptionSettings)
      .mockResolvedValueOnce({ RawMessageDelivery: 'false' })
      .mockResolvedValueOnce({ RawMessageDelivery: 'true' });
    await openSettings();
    await screen.findByText('No filter policy');
    expectValue('Raw message delivery', 'Off');
    choose('Raw message delivery', 'true');
    click('Save raw message delivery');
    expect(api.setSubscriptionSetting).toHaveBeenCalledExactlyOnceWith(
      ENGINE,
      ARN,
      { name: 'RawMessageDelivery', value: 'true' },
      expect.any(AbortSignal),
    );
    await screen.findByText('Subscription settings updated');
    await waitFor(() => {
      expect(api.getSubscriptionSettings).toHaveBeenCalledTimes(2);
      expect(screen.queryByText('Loading subscription settings')).not.toBeInTheDocument();
    });
    expectValue('Raw message delivery', 'On');
    expect(screen.getByText('No filter policy')).toBeVisible();
    expectValue('Filter policy scope', 'Not set');
  });

  it('preserves an empty object policy and reads external changes when reopened', async () => {
    vi.mocked(api.getSubscriptionSettings)
      .mockResolvedValueOnce({ ...SETTINGS, FilterPolicy: '{}' })
      .mockResolvedValueOnce({ ...SETTINGS, FilterPolicy: REPLACEMENT, FilterPolicyScope: 'MessageAttributes' });
    await openSettings();
    expect(await screen.findByDisplayValue('{}')).toBeVisible();
    expectValue('Filter policy scope', 'Message body');
    changePolicy('unsaved');
    click('Close');
    click('Subscription settings');
    expect(await screen.findByDisplayValue(REPLACEMENT)).toBeVisible();
    expectValue('Filter policy scope', 'Message attributes');
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
    await screen.findByDisplayValue(POLICY);
    fireEvent.click(refreshSettings());
    expect(await screen.findByDisplayValue(REPLACEMENT)).toBeVisible();
    expectValue('Filter policy scope', 'Message attributes');
    expectValue('Raw message delivery', 'On');
  });

  it('submits only the edited policy when raw delivery also has a draft and prevents duplicate writes', async () => {
    const write = hold<undefined>();
    vi.mocked(api.setSubscriptionSetting).mockReturnValueOnce(write.promise);
    vi.mocked(api.getSubscriptionSettings)
      .mockResolvedValueOnce(SETTINGS)
      .mockResolvedValueOnce({ ...SETTINGS, FilterPolicy: REPLACEMENT });
    await openSettings();
    await screen.findByDisplayValue(POLICY);
    choose('Raw message delivery', 'true');
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
    expect(await screen.findByText('Subscription settings updated')).toBeVisible();
  });

  it('keeps the write result alongside a failed readback and retries the read', async () => {
    vi.mocked(api.getSubscriptionSettings)
      .mockResolvedValueOnce(SETTINGS)
      .mockRejectedValueOnce(notFound('GetSubscriptionAttributes'))
      .mockResolvedValueOnce({ ...SETTINGS, FilterPolicy: REPLACEMENT });
    await openSettings();
    await screen.findByDisplayValue(POLICY);
    changePolicy(REPLACEMENT);
    click('Save filter policy');
    expect(await screen.findByText('Subscription settings updated')).toBeVisible();
    expect(await screen.findByText('NotFound')).toBeVisible();
    click('Retry');
    await waitFor(() => {
      expect(screen.queryByText('NotFound')).not.toBeInTheDocument();
      expect(screen.queryByText('Loading subscription settings')).not.toBeInTheDocument();
    });
    expect(screen.getByDisplayValue(REPLACEMENT)).toBeVisible();
    expect(api.setSubscriptionSetting).toHaveBeenCalledTimes(1);
  });

  it('shows the original error when reading a deleted subscription and lets the user retry', async () => {
    vi.mocked(api.getSubscriptionSettings).mockRejectedValue(notFound('GetSubscriptionAttributes'));
    await openSettings();
    expect(await screen.findByText('NotFound')).toBeVisible();
    expect(screen.getByText(/Subscription does not exist/)).toBeVisible();
    click('Retry');
    await waitFor(() => expect(api.getSubscriptionSettings).toHaveBeenCalledTimes(2));
  });

  it.each([
    ['Filter policy scope', 'MessageAttributes', 'Save scope', 'FilterPolicyScope'],
    ['Raw message delivery', 'true', 'Save raw message delivery', 'RawMessageDelivery'],
  ])('shows the original error when saving %s to a deleted subscription', async (label, value, save, name) => {
    vi.mocked(api.getSubscriptionSettings).mockResolvedValue(SETTINGS);
    vi.mocked(api.setSubscriptionSetting).mockRejectedValue(notFound('SetSubscriptionAttributes'));
    await openSettings();
    await screen.findByDisplayValue(POLICY);
    choose(label, value);
    click(save);
    expect(await screen.findByText('NotFound')).toBeVisible();
    expect(screen.getByText(/Subscription does not exist/)).toBeVisible();
    expect(screen.queryByText('Subscription settings updated')).not.toBeInTheDocument();
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
    expect(await screen.findByText('Not implemented by the emulator')).toBeVisible();
    expect(screen.getByText(/GetSubscriptionAttributes/)).toBeVisible();
    expect(disabled(refreshSettings())).toBe(true);
  });

  it('names an unsupported write operation and disables writes while keeping refresh available', async () => {
    vi.mocked(api.getSubscriptionSettings).mockResolvedValue(SETTINGS);
    vi.mocked(api.setSubscriptionSetting).mockRejectedValue(
      new RequestError({ kind: 'not-implemented', operation: 'SetSubscriptionAttributes' }),
    );
    await openSettings();
    await screen.findByDisplayValue(POLICY);
    changePolicy(REPLACEMENT);
    click('Save filter policy');
    expect(await screen.findByText('Not implemented by the emulator')).toBeVisible();
    expect(screen.getByText(/SetSubscriptionAttributes/)).toBeVisible();
    for (const name of ['Save filter policy', 'Clear filter policy', 'Save scope', 'Save raw message delivery']) {
      expect(button(name)).toBeVisible();
      expect(disabled(button(name))).toBe(true);
    }
    expect(disabled(refreshSettings())).toBe(false);
    fireEvent.click(refreshSettings());
    await waitFor(() => expect(api.getSubscriptionSettings).toHaveBeenCalledTimes(2));
  });

  it('clears the policy only after confirmation and displays the remaining raw delivery setting', async () => {
    vi.mocked(api.getSubscriptionSettings)
      .mockResolvedValueOnce({ ...SETTINGS, RawMessageDelivery: 'true' })
      .mockResolvedValueOnce({ RawMessageDelivery: 'true' });
    await openSettings();
    await screen.findByDisplayValue(POLICY);
    click('Clear filter policy');
    const dialog = await screen.findByRole('dialog', { name: 'Clear filter policy?' });
    expect(
      within(dialog).getByText((_, element) => element?.textContent === ARN, { selector: '.aws-area-value-address' }),
    ).toBeVisible();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(api.setSubscriptionSetting).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue(POLICY)).toBeVisible();
    expectValue('Filter policy scope', 'Message body');
    click('Clear filter policy');
    const reopened = await screen.findByRole('dialog', { name: 'Clear filter policy?' });
    fireEvent.click(within(reopened).getByRole('button', { name: 'Clear filter policy' }));
    expect(api.setSubscriptionSetting).toHaveBeenCalledExactlyOnceWith(
      ENGINE,
      ARN,
      { name: 'FilterPolicy', value: '' },
      expect.any(AbortSignal),
    );
    expect(await screen.findByText('No filter policy')).toBeVisible();
    expectValue('Filter policy scope', 'Not set');
    expectValue('Raw message delivery', 'On');
  });
});
