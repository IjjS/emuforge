import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { creationDateText } from '../../../components/format-date';
import { RestDetails } from './rest-details';

it('shows the name, copyable ID, description, endpoint types and creation time', () => {
  const api = {
    id: 'api-1',
    name: 'Orders',
    description: 'Order records',
    endpointConfiguration: { types: ['REGIONAL', 'PRIVATE'] as const },
    createdDate: new Date('2026-11-26T12:00:00Z'),
  };
  const { rerender } = render(
    <RestDetails
      api={{ ...api, endpointConfiguration: { types: [...api.endpointConfiguration.types] } }}
      apiId="api-1"
      onRefresh={vi.fn()}
    />,
  );
  expect(screen.getByText(api.name)).toBeInTheDocument();
  expect(screen.getByText(api.id)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Copy ID' })).toBeEnabled();
  expect(screen.getByText(api.description)).toBeInTheDocument();
  for (const value of ['Regional, Private', creationDateText(api.createdDate)]) {
    expect(
      screen.getByText(
        (_, element) =>
          element?.textContent === value && ![...element.children].some((child) => child.textContent === value),
      ),
    ).toBeInTheDocument();
  }

  rerender(
    <RestDetails
      api={{ name: api.name, createdDate: api.createdDate, endpointConfiguration: { types: ['PRIVATE'] } }}
      apiId="api-1"
      onRefresh={vi.fn()}
    />,
  );
  expect(screen.queryByText(api.description)).not.toBeInTheDocument();
  expect(screen.getByText('-')).toBeInTheDocument();
});
