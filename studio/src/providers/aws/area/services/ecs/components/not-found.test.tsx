import { fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';

import { NotFound } from './not-found';

describe('the not-found state', () => {
  it('given a heading, a statement and a link → all three shown, the link a route change to its address', () => {
    const router = createMemoryRouter(
      [
        {
          path: '/aws/ecs/clusters/cluster/gone',
          element: (
            <NotFound
              heading="No cluster named gone"
              statement="The local emulator has no active cluster of this name."
              link={{ text: 'Clusters', href: '/aws/ecs/clusters' }}
            />
          ),
        },
        { path: '/aws/ecs/clusters', element: <p>The clusters</p> },
      ],
      { initialEntries: ['/aws/ecs/clusters/cluster/gone'] },
    );
    render(<RouterProvider router={router} />);
    expect(screen.getByText('No cluster named gone')).toBeInTheDocument();
    expect(screen.getByText('The local emulator has no active cluster of this name.')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Clusters' });
    expect(link).toHaveAttribute('href', '/aws/ecs/clusters');
    fireEvent.click(link);
    expect(router.state.location.pathname).toBe('/aws/ecs/clusters');
    expect(screen.getByText('The clusters')).toBeInTheDocument();
  });
});
