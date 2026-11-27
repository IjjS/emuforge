import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../../lib/aws/request';
import type { ChoiceSource } from '../../../components/use-paged-choices';
import type { AreaConnection } from '../../../components/emulator-line';
import { apiChoices } from '../api-choices';
import type { ApiRow } from '../apis-api';
import { PagedChoice } from './paged-choice';

const endpoint = 'http://127.0.0.1:9681';
const operation = 'GetIntegrations';
const emulator = { port: 9682, endpoint: 'https://127.0.0.1:9682' };
const connected = { kind: 'connected', checkedAt: 1, emulator } as const;
const disconnected = {
  kind: 'emulator-unreachable',
  checkedAt: 1,
  emulator,
  reason: 'not_started',
  message: '',
} as const;
const first = { value: 'int-1', label: 'Lambda function', description: 'The first integration' };
const second = { value: 'int-2', label: 'HTTP endpoint', description: 'The second integration' };
const firstPage = { items: [first], next: 'more-integrations' };
const lastPage = { items: [second] };

async function open(
  read: ChoiceSource<typeof first>['read'],
  result: AreaConnection['result'] = connected,
  readAgainOnOpen = false,
) {
  const onChange = vi.fn();
  const source: ChoiceSource<typeof first> = {
    key: ['integrations'],
    endpoint,
    operation,
    read,
    readAgainOnOpen,
    optionOf: (item) => item,
  };
  const test = render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient()}>
        <PagedChoice
          source={source}
          value={undefined}
          onChange={onChange}
          connection={{ engineOrigin: endpoint, result }}
          things="integrations"
          ariaLabel="Integration"
        />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  const select = createWrapper(test.container).findSelect();
  if (select === null) throw new Error('Missing integration select');
  await userEvent.click(select.findTrigger().getElement());
  return { ...test, onChange, dropdown: select.findDropdown(), select };
}

it('shows the chosen API identity and finds that API by typing its stored name', async () => {
  const api: ApiRow = {
    id: 'api-2',
    name: 'a  b',
    kind: 'REST',
    description: undefined,
    createdDate: undefined,
    endpointTypes: [],
  };
  const source = {
    ...apiChoices(endpoint, 'rest'),
    read: vi.fn().mockResolvedValue({ items: [{ ...api, id: 'api-1', name: 'a b' }, api] }),
  };
  const onChange = vi.fn();
  const { container } = render(
    <QueryClientProvider client={new QueryClient()}>
      <PagedChoice
        source={source}
        value={api}
        onChange={onChange}
        connection={{ engineOrigin: endpoint, result: connected }}
        things="APIs"
        ariaLabel="API"
      />
    </QueryClientProvider>,
  );
  const identity = 'a\\u0020\\u0020b';
  const select = createWrapper(container).findSelect();
  if (!select) throw new Error('Missing API select');
  const trigger = select.findTrigger().getElement();
  expect(trigger).toHaveRole('button');
  expect(trigger).toHaveAccessibleName(`API ${identity}`);
  expect(trigger.textContent).toBe(identity);
  const user = userEvent.setup();
  await user.click(trigger);
  const input = select.findFilteringInput()?.findNativeInput();
  if (!input) throw new Error('Missing API filter');
  await user.type(input.getElement(), 'a  b');

  const dropdown = select.findDropdown();
  await waitFor(() => {
    expect(dropdown.findOptionByValue('api-1')).toBeNull();
    expect(dropdown.findOptionByValue(api.id)?.findLabel().getElement().textContent).toBe(identity);
  });
  const option = dropdown.findOptionByValue(api.id);
  if (!option) throw new Error('Missing matching API');
  await user.click(option.getElement());
  expect(onChange).toHaveBeenCalledWith(api);
});

it('reads the current options on reopening while focus stays on the trigger', async () => {
  const read = vi.fn<ChoiceSource<typeof first>['read']>().mockResolvedValue(firstPage);
  const { select, dropdown } = await open(read, connected, true);
  const trigger = select.findTrigger().getElement();
  await waitFor(() => {
    expect(dropdown.findOptionByValue(first.value)?.getElement()).toHaveTextContent(first.label);
  });

  const user = userEvent.setup();
  await user.click(trigger);
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
  expect(trigger).toHaveFocus();
  expect(read).toHaveBeenCalledTimes(1);

  read.mockResolvedValue(lastPage);
  await user.click(trigger);
  await waitFor(() => {
    expect(select.findDropdown().findOptionByValue(second.value)?.getElement()).toHaveTextContent(second.label);
  });
  expect(select.findDropdown().findOptionByValue(first.value)).toBeNull();
  expect(read).toHaveBeenCalledTimes(2);
  expect(read).toHaveBeenLastCalledWith(endpoint, '', undefined, expect.any(AbortSignal));
});

it('shows options by value with label and description, and loads a further page by its token', async () => {
  const read = vi
    .fn<ChoiceSource<typeof first>['read']>()
    .mockResolvedValueOnce(firstPage)
    .mockResolvedValueOnce(lastPage);
  const { dropdown, onChange, select } = await open(read);
  await waitFor(() => {
    expect(dropdown.findOptionByValue(first.value)?.getElement()).toHaveTextContent(
      'Lambda functionThe first integration',
    );
  });
  const load = select.findDropdownFooter()?.findButton()?.getElement();
  if (load === undefined) throw new Error('Missing load more button');
  expect(load).toHaveTextContent('Load more');
  await userEvent.click(load);
  await waitFor(() => {
    expect(dropdown.findOptionByValue(second.value)?.getElement()).toHaveTextContent(
      'HTTP endpointThe second integration',
    );
  });
  expect(read).toHaveBeenNthCalledWith(2, endpoint, '', 'more-integrations', expect.any(AbortSignal));
  const option = dropdown.findOptionByValue(second.value);
  if (option === null) throw new Error('Missing second integration');
  await userEvent.click(option.getElement());
  expect(onChange).toHaveBeenCalledWith(second);
});

describe.each([
  ['first page', false],
  ['further page', true],
] as const)('failure on the %s', (_, further) => {
  it.each([
    [
      { kind: 'not-implemented' },
      connected,
      'Not implemented by the emulator. The emulator answered 501 Not Implemented for GetIntegrations.',
      'Not implemented by the emulator',
      'The emulator answered 501 Not Implemented for GetIntegrations, so Studio cannot show the integrations.',
      false,
    ],
    [
      { kind: 'other', code: 'Denied', message: 'The integrations were refused.' },
      disconnected,
      'Denied: The integrations were refused.',
      'The integrations could not be read',
      'GetIntegrations: Denied: The integrations were refused.',
      false,
    ],
    [
      { kind: 'emulator-did-not-answer', message: 'Timed out.' },
      connected,
      'The emulator did not answer',
      'Not answering at https://127.0.0.1:9682',
      'GetIntegrations got no answer from the emulator. Timed out.',
      true,
    ],
    [
      { kind: 'engine-did-not-answer' },
      connected,
      'The EmuForge engine at http://127.0.0.1:9681 did not answer',
      'The EmuForge engine at http://127.0.0.1:9681 is not answering',
      'GetIntegrations got no answer.',
      true,
    ],
  ] as const)('recovers the options from %j', async (failure, result, dropdownReason, heading, detail, recovery) => {
    const read = vi.fn<ChoiceSource<typeof first>['read']>();
    if (further) read.mockResolvedValueOnce(firstPage);
    read.mockRejectedValueOnce(new RequestError({ ...failure, operation })).mockResolvedValueOnce(lastPage);

    const { container, dropdown, select } = await open(read, result);
    if (further) {
      const load = await waitFor(() => {
        const button = select.findDropdownFooter()?.findButton()?.getElement();
        if (button === undefined) throw new Error('Missing load more button');
        expect(button).toHaveTextContent('Load more');
        return button;
      });
      await userEvent.click(load);
    }

    await waitFor(() => {
      expect(select.findStatusIndicator()?.getElement()).toHaveTextContent(
        `The integrations could not be loaded: ${dropdownReason}`,
      );
      expect(select.findErrorRecoveryButton()?.getElement()).toHaveTextContent('Retry');
    });
    expect(container).toHaveTextContent(heading);
    expect(container).toHaveTextContent(detail);
    const wrapper = createWrapper(container);
    const link = wrapper
      .findAllLinks()
      .map((item) => item.getElement())
      .find((item) => !dropdown.getElement().contains(item));
    if (recovery) {
      expect(link).toHaveTextContent('Connection status');
      expect(link).toHaveAttribute('href', '/');
    } else {
      expect(link).toBeUndefined();
    }
    if (further) expect(dropdown.findOptionByValue(first.value)?.getElement()).toHaveTextContent(first.label);

    const blockRetry = wrapper
      .findAllButtons()
      .map((button) => button.getElement())
      .find((button) => !dropdown.getElement().contains(button));
    if (blockRetry === undefined) throw new Error('Missing retry button below the choice');
    expect(blockRetry).toHaveTextContent('Retry');
    await userEvent.click(blockRetry);
    if (select.findTrigger().getElement().getAttribute('aria-expanded') === 'false') {
      await userEvent.click(select.findTrigger().getElement());
    }

    await waitFor(() => {
      expect(select.findDropdown().findOptionByValue(second.value)?.getElement()).toHaveTextContent(second.label);
    });
    if (further)
      expect(select.findDropdown().findOptionByValue(first.value)?.getElement()).toHaveTextContent(first.label);
    expect(read).toHaveBeenCalledTimes(further ? 3 : 2);
    expect(read).toHaveBeenLastCalledWith(
      endpoint,
      '',
      further ? 'more-integrations' : undefined,
      expect.any(AbortSignal),
    );
    expect(select.findErrorRecoveryButton()).toBeNull();
    expect(container).not.toHaveTextContent(detail);
  });
});
