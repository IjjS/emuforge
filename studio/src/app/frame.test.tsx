import { act, render, screen, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Frame } from './frame';
import { Providers } from './providers';
import { routes } from './routes';

beforeEach(() => {
  // No network in these tests: Home's check fails at once, and nothing reaches an engine.
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new TypeError('no network in this test'))),
  );
  // The AWS area follows the operating system's scheme, which jsdom does not report: light here.
  vi.stubGlobal('matchMedia', (media: string) => ({
    media,
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The frame alone at `path`, above an empty page. */
function openFrame(path: string) {
  const router = createMemoryRouter([{ element: <Frame />, children: [{ path: '*', element: null }] }], {
    initialEntries: [path],
  });
  return render(<RouterProvider router={router} />);
}

/** Studio at `path`, with its real routes. */
function openStudio(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  return render(
    <Providers>
      <RouterProvider router={router} />
    </Providers>,
  );
}

function frameLinks() {
  const banner = screen.getByRole('banner');
  const nav = within(banner).getByRole('navigation', { name: 'Studio' });
  return {
    banner,
    nav,
    home: within(nav).getByRole('link', { name: 'Home' }),
    aws: within(nav).getByRole('link', { name: 'AWS' }),
  };
}

describe('Studio’s frame', () => {
  it('on /: a banner with "EmuForge Studio" to / and the navigation "Studio" with Home then AWS; Home current', () => {
    openFrame('/');
    const { banner, nav, home, aws } = frameLinks();

    expect(within(banner).getByRole('link', { name: 'EmuForge Studio' })).toHaveAttribute('href', '/');
    const links = within(nav)
      .getAllByRole('link')
      .map((link) => [link.textContent, link.getAttribute('href')]);
    expect(links).toEqual([
      ['Home', '/'],
      ['AWS', '/aws'],
    ]);
    expect(home).toHaveAttribute('aria-current', 'page');
    expect(aws).not.toHaveAttribute('aria-current');
  });

  it('on /aws: AWS is the current page, Home is not marked', () => {
    openFrame('/aws');
    const { home, aws } = frameLinks();

    expect(aws).toHaveAttribute('aria-current', 'page');
    expect(home).not.toHaveAttribute('aria-current');
  });

  it.each(['/aws/s3', '/aws/does-not-exist'])('on %s: AWS is marked as current (true), Home is not', (path) => {
    openFrame(path);
    const { home, aws } = frameLinks();

    expect(aws).toHaveAttribute('aria-current', 'true');
    expect(home).not.toHaveAttribute('aria-current');
  });

  it.each(['/does-not-exist', '/s3'])('on %s: no link of the frame is marked', (path) => {
    openFrame(path);
    const { banner } = frameLinks();

    for (const link of within(banner).getAllByRole('link')) {
      expect(link).not.toHaveAttribute('aria-current');
    }
  });

  it.each(['/', '/aws', '/aws/s3', '/aws/does-not-exist', '/does-not-exist', '/s3'])(
    'on %s: no element of the frame has a Cloudscape class',
    async (path) => {
      openStudio(path);
      if (path.startsWith('/aws')) {
        // The area is on the page beside the frame.
        await screen.findByRole('main');
      }
      const { banner } = frameLinks();

      for (const element of [banner, ...banner.querySelectorAll('*')]) {
        expect([...element.classList].filter((name) => name.startsWith('awsui'))).toEqual([]);
      }
    },
  );

  it.each([
    ['/', 'EmuForge Studio'],
    ['/does-not-exist', 'Page not found | EmuForge Studio'],
    ['/aws', 'Amazon Web Services | EmuForge Studio'],
    ['/aws/s3/buckets', 'Amazon Simple Storage Service | EmuForge Studio'],
  ])('on %s: the document title is "%s"', async (path, title) => {
    document.title = 'not set by Studio';
    openStudio(path);

    await act(async () => {
      await vi.waitFor(() => {
        expect(document.title).toBe(title);
      });
    });
  });
});
