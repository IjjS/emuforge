import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../../lib/aws/request';
import type { ChoiceSource } from '../../../components/use-paged-choices';
import type { AreaConnection } from '../../../components/emulator-line';
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

async function open(read: ChoiceSource<typeof first>['read'], result: AreaConnection['result'] = connected) {
  const onChange = vi.fn();
  const source: ChoiceSource<typeof first> = {
    key: ['integrations'],
    endpoint,
    operation,
    read,
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
  expect(read).not.toHaveBeenCalled();
  await userEvent.click(select.findTrigger().getElement());
  return { ...test, onChange, dropdown: select.findDropdown(), select };
}

it('shows options by value with label and description, and loads a further page by its token', async () => {
  const read = vi
    .fn<ChoiceSource<typeof first>['read']>()
    .mockResolvedValueOnce(firstPage)
    .mockResolvedValueOnce(lastPage);
  const { dropdown, onChange } = await open(read);
  await waitFor(() => {
    expect(dropdown.findOptionByValue(first.value)?.getElement()).toHaveTextContent(
      'Lambda functionThe first integration',
    );
  });
  const load = within(dropdown.getElement()).getByRole('button', { name: 'Load more' });
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
  expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
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
      await userEvent.click(await within(dropdown.getElement()).findByRole('button', { name: 'Load more' }));
    }

    const dropdownRetry = await waitFor(() => {
      expect(select.findStatusIndicator()?.getElement()).toHaveTextContent(
        `The integrations could not be loaded: ${dropdownReason}`,
      );
      const retry = select.findErrorRecoveryButton()?.getElement();
      if (retry === undefined) throw new Error('Missing dropdown recovery button');
      expect(retry).toHaveTextContent('Retry');
      return retry;
    });
    expect(container).toHaveTextContent(heading);
    expect(container).toHaveTextContent(detail);
    const link = screen.queryByRole('link', { name: 'Connection status' });
    if (recovery) {
      expect(link).toHaveAttribute('href', '/');
    } else {
      expect(link).not.toBeInTheDocument();
    }
    if (further) expect(dropdown.findOptionByValue(first.value)?.getElement()).toHaveTextContent(first.label);

    const blockRetry = screen.getAllByRole('button', { name: 'Retry' }).find((button) => button !== dropdownRetry);
    if (blockRetry === undefined) throw new Error('Missing retry button below the choice');
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
