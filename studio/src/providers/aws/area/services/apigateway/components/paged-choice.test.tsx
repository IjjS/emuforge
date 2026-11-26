import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { expect, it, vi } from 'vitest';

import { RequestError } from '../../../../../../lib/aws/request';
import type { ChoiceSource } from '../../../components/use-paged-choices';
import { PagedChoice } from './paged-choice';

const endpoint = 'http://127.0.0.1:9681';
const operation = 'GetIntegrations';
const first = { value: 'int-1', label: 'Lambda function', description: 'The first integration' };
const second = { value: 'int-2', label: 'HTTP endpoint', description: 'The second integration' };
const firstPage = { items: [first], next: 'more-integrations' };
const lastPage = { items: [second] };

async function open(read: ChoiceSource<typeof first>['read']) {
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
          connection={{ engineOrigin: endpoint, result: undefined }}
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
  return { onChange, dropdown: select.findDropdown(), select };
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

it.each([false, true])('shows the operation failure and retries the same page (further page = %s)', async (further) => {
  const read = vi.fn<ChoiceSource<typeof first>['read']>();
  if (further) read.mockResolvedValueOnce(firstPage);
  read.mockRejectedValueOnce(
    new RequestError({ kind: 'other', operation, code: 'Denied', message: 'The integrations were refused.' }),
  );
  read.mockResolvedValueOnce(lastPage);
  const { dropdown } = await open(read);
  if (further) {
    await userEvent.click(await within(dropdown.getElement()).findByRole('button', { name: 'Load more' }));
  }
  expect(await screen.findByText('GetIntegrations: Denied: The integrations were refused.')).toBeInTheDocument();
  expect(within(dropdown.getElement()).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  if (further) expect(dropdown.findOptionByValue(first.value)).not.toBeNull();
  const retry = screen
    .getAllByRole('button', { name: 'Retry' })
    .find((button) => !dropdown.getElement().contains(button));
  if (retry === undefined) throw new Error('Missing retry button below the choice');
  await userEvent.click(retry);
  await waitFor(() => {
    expect(read).toHaveBeenLastCalledWith(
      endpoint,
      '',
      further ? 'more-integrations' : undefined,
      expect.any(AbortSignal),
    );
    expect(screen.queryByText('The integrations could not be read')).not.toBeInTheDocument();
  });
});
