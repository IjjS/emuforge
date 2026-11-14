import { useState } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router';

import { Providers } from './providers';
import { routes } from './routes';

/** Studio: the shell and its routes in the browser's history. */
export function App() {
  const [router] = useState(() => createBrowserRouter(routes));
  return (
    <Providers>
      <RouterProvider router={router} />
    </Providers>
  );
}
