import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';

import { creationDateText } from '../../../components/format-date';
import { V2Details } from './v2-details';

it.each([
  ['HTTP', 'HTTP'],
  ['WEBSOCKET', 'WebSocket'],
] as const)(
  'shows the API metadata and lets the developer copy its ID and endpoint for %s',
  async (ProtocolType, protocol) => {
    const user = userEvent.setup();
    const CreatedDate = new Date('2026-11-26T12:00:00Z');
    const ApiEndpoint = 'https://127.0.0.1:9323/_aws/execute-api/api-1';
    const onRefresh = vi.fn();
    const { container } = render(
      <V2Details
        id="api-1"
        api={{ ApiId: 'api-1', Name: 'Events', ProtocolType, Description: 'Collects events', ApiEndpoint, CreatedDate }}
        onRefresh={onRefresh}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Details' })).toBeInTheDocument();
    for (const text of ['Events', 'api-1', protocol, 'Collects events', ApiEndpoint, creationDateText(CreatedDate)]) {
      expect(container).toHaveTextContent(text);
    }
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Copy API ID' }));
    expect(await navigator.clipboard.readText()).toBe('api-1');
    await user.click(screen.getByRole('button', { name: 'Copy API endpoint' }));
    expect(await navigator.clipboard.readText()).toBe(ApiEndpoint);
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(onRefresh).toHaveBeenCalledOnce();
  },
);
