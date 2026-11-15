import { render, screen, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Providers } from '../../app/providers';
import { routes } from '../../app/routes';
import { BUNDLED_CATALOGUES } from '../../i18n/bundled';
import { PLACEHOLDER } from '../../i18n/catalogue';
import { languageStore, present, textNotFrom } from '../../test/home-test-kit';

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new TypeError('no network in this test'))),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
  document.documentElement.lang = 'en';
});

/** Studio at `path`, in the browser's language, or in `tag` as a browser whose only language it is. */
function open(path: string, tag?: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <Providers language={tag === undefined ? undefined : languageStore(tag)}>
      <RouterProvider router={router} />
    </Providers>,
  );
  return router;
}

/** The box that holds the requested path. */
function pathBox(): HTMLElement {
  const box = screen.getByRole('main').querySelector('code');
  expect(box).not.toBeNull();
  return box as HTMLElement;
}

describe('Studio’s "Page not found"', () => {
  it('on /does-not-exist/today: the h1, the sentence with the path, and "Go to Home" to /', () => {
    open('/does-not-exist/today');
    const main = screen.getByRole('main');

    expect(within(main).getByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument();
    expect(main).toHaveTextContent('Studio has no page at /does-not-exist/today.');
    expect(within(main).getByRole('link', { name: 'Go to Home' })).toHaveAttribute('href', '/');
  });

  it('shows a long path whole, each segment one piece, a break opportunity after every / and nowhere else', () => {
    const long = 'a'.repeat(80);
    const path = `/my-bucket.v2/${long}/objects-2026/x.y-z`;
    open(path);
    const box = pathBox();

    expect(box.textContent).toBe(path);
    // Children: a segment, then for each `/` the slash, a break opportunity (`wbr`) and the next segment.
    const nodes = [...box.childNodes];
    const segments = path.split('/');
    expect(nodes).toHaveLength(segments.length * 3 - 2);
    segments.forEach((segment, index) => {
      const piece = nodes[index * 3] as HTMLElement;
      expect(piece.nodeName).toBe('SPAN');
      expect(piece.textContent).toBe(segment);
      // One piece: text only, no break opportunity inside.
      expect([...piece.childNodes].every((node) => node.nodeType === Node.TEXT_NODE)).toBe(true);
      if (index > 0) {
        expect(nodes[index * 3 - 2]?.nodeType).toBe(Node.TEXT_NODE);
        expect(nodes[index * 3 - 2]?.textContent).toBe('/');
        expect(nodes[index * 3 - 1]?.nodeName).toBe('WBR');
      }
    });
    expect(box.querySelectorAll('wbr')).toHaveLength(segments.length - 1);
  });

  it('shows /caf%C3%A9/%3Cb%3E decoded, as /café/<b>, as text', () => {
    open('/caf%C3%A9/%3Cb%3E');
    const box = pathBox();

    expect(box.textContent).toBe('/café/<b>');
    expect(box.querySelector('b')).toBeNull();
  });

  it('shows a path that cannot be decoded, /%E0%A4%A, as the router gave it', () => {
    const router = open('/%E0%A4%A');

    expect(pathBox().textContent).toBe(router.state.location.pathname);
    expect(router.state.location.pathname).toBe('/%E0%A4%A');
  });
});

/** The catalogue's text of `key` in `tag`. */
function messageIn(tag: string, key: string): string {
  const message = BUNDLED_CATALOGUES.byTag.get(tag)?.messages.get(key);
  if (typeof message !== 'string') {
    throw new Error(`${tag} has no text "${key}"`);
  }
  return message;
}

const OVER_LONG = `/${'a-very-long-segment-of-a-path/'.repeat(12)}end`;

describe('Studio’s "Page not found" in each of the twelve languages (R4.4, R4.9)', () => {
  it.each(
    [...BUNDLED_CATALOGUES.byTag.keys()].flatMap((tag) => [[tag, 'short'] as const, [tag, 'over-long'] as const]),
  )(
    '%s, a %s path: every text of Studio comes from that catalogue or is kept as it is; the path box named "Path"',
    (tag, length) => {
      if (length === 'over-long') {
        // jsdom lays nothing out: the path box reports a width beyond its own, as an over-long path does.
        vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (this: HTMLElement) {
          return this.tagName === 'CODE' ? 4_000 : 0;
        });
      }
      open(length === 'short' ? '/does-not-exist' : OVER_LONG, tag);

      expect(document.documentElement.lang).toBe(tag);
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(messageIn(tag, 'notFound.title'));
      expect(textNotFrom(tag)).toEqual([]);
      const region = screen.queryByRole('region', { name: messageIn(tag, 'notFound.path') });
      if (length === 'over-long') {
        expect(region).toBe(pathBox());
      } else {
        expect(region).toBeNull();
      }
    },
  );

  it.each(['ko', 'ja'])('%s: the path box stands where the catalogue puts {path}, before the verb', (tag) => {
    open('/does-not-exist', tag);
    const [before, after] = messageIn(tag, 'notFound.statement')
      .split(PLACEHOLDER)
      .filter((_p, i) => i % 2 === 0);
    const statement = present(pathBox().parentElement, 'the statement');
    const nodes = [...statement.childNodes];

    expect(nodes.map((node) => node.nodeName)).toEqual(['#text', 'CODE', '#text']);
    expect(nodes[0]?.textContent).toBe(before);
    expect(nodes[1]).toBe(pathBox());
    expect(nodes[2]?.textContent).toBe(after);
    // The verb comes after the path in these languages.
    expect(present(after, 'the text after the path').trim()).toMatch(/(없습니다|ありません)。?\.?$/u);
  });
});
