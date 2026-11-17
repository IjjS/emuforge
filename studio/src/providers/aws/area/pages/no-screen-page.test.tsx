import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';

import type { Service } from '../../services';
import { NoScreenPage, type NoScreenPart } from './no-screen-page';

// The area's "no screen yet" page, in both forms (issue 57, requirements R4.5 to R4.7 and R5), rendered alone inside a
// router with Studio's Home at `/` and the first screen's address as another route.

const DYNAMODB: Service = { label: 'Amazon DynamoDB', crumb: 'DynamoDB', route: '/dynamodb' };
const STATEMENT = 'Studio has no screen for this part of Amazon DynamoDB yet.';
const OLD_SENTENCE = 'Studio has no screen for Amazon DynamoDB yet.';
const SENTENCE = 'Opening this page changed nothing in your local emulator.';
const FIRST = { title: 'Things', href: '/aws/dynamodb' };

/** The page for `part` (or the page of a service without a screen when none is given) inside a router. */
function open(part?: NoScreenPart) {
  const router = createMemoryRouter(
    [
      { path: '/', element: <p>Studio's Home</p> },
      { path: '/aws/dynamodb', element: <p>The first screen</p> },
      { path: '/aws/dynamodb/*', element: <NoScreenPage service={DYNAMODB} part={part} /> },
    ],
    { initialEntries: ['/aws/dynamodb/other-things'] },
  );
  const result = render(<RouterProvider router={router} />);
  return { ...result, router, wrapper: createWrapper(result.container) };
}

/** The page for the path `path` below DynamoDB, whose first screen is "Things". */
function openPart(path: string) {
  return open({ path, first: FIRST });
}

/** The label "Path": the innermost element whose text is exactly "Path". */
function pathLabel(container: HTMLElement): HTMLElement | undefined {
  return [...container.querySelectorAll<HTMLElement>('*')].find(
    (element) =>
      element.textContent === 'Path' && ![...element.children].some((child) => child.textContent === 'Path'),
  );
}

/** The path's code text: the first `code` element after the label "Path". */
function shownPath(container: HTMLElement): HTMLElement | undefined {
  const label = pathLabel(container);
  return [...container.querySelectorAll<HTMLElement>('code')].find(
    (code) => label !== undefined && (label.compareDocumentPosition(code) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
  );
}

function follows(a: Node, b: Node): boolean {
  return (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

/** Clicks `link` as a user does, with `init`'s modifier keys; whether the browser would follow it (not prevented). */
function click(link: HTMLElement, init: MouseEventInit = {}): boolean {
  let followed = true;
  act(() => {
    followed = fireEvent.click(link, init);
  });
  return followed;
}

describe('the "no screen yet" page below a service that has screens (issue 57, R4)', () => {
  it('for a first screen "Things" and a path: inside one container, in order, the statement, the label "Path" with the path directly below in code text, the sentence, the actions', () => {
    const { wrapper } = openPart('/aws/dynamodb/other-things');

    const containers = wrapper.findAllContainers();
    expect(containers).toHaveLength(1);
    const container = containers[0]?.getElement() as HTMLElement;
    const statement = screen.getByText(STATEMENT);
    const label = pathLabel(container);
    const code = shownPath(container);
    const sentence = screen.getByText(SENTENCE);
    const goTo = screen.getByRole('link', { name: 'Go to Things' });
    const home = screen.getByRole('link', { name: 'Go to Home' });
    expect(label).toBeDefined();
    expect(code).toBeDefined();
    expect(code).toHaveTextContent('/aws/dynamodb/other-things');
    for (const element of [statement, label, code, sentence, goTo, home]) {
      expect(container.contains(element as HTMLElement)).toBe(true);
    }
    expect(follows(statement, label as HTMLElement)).toBe(true);
    expect(follows(label as HTMLElement, code as HTMLElement)).toBe(true);
    expect(follows(code as HTMLElement, sentence)).toBe(true);
    expect(follows(sentence, goTo)).toBe(true);
    expect(follows(goTo, home)).toBe(true);
    // Directly below: nothing with text between the label and the path.
    const between = [...container.querySelectorAll('*')].filter(
      (element) =>
        follows(label as HTMLElement, element) &&
        follows(element, code as HTMLElement) &&
        !element.contains(code as HTMLElement) &&
        (element.textContent ?? '') !== '',
    );
    expect(between).toEqual([]);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('No screen yet');
  });

  it('the path /aws/dynamodb/a%2Fb → shown as /aws/dynamodb/a%2Fb, nothing decoded', () => {
    const { container } = openPart('/aws/dynamodb/a%2Fb');

    expect(shownPath(container)?.textContent).toBe('/aws/dynamodb/a%2Fb');
  });

  it('the path /aws/dynamodb/%3Cb%3Ex%3C/b%3E → shown as it is, and no link has the path as its text or address', () => {
    const path = '/aws/dynamodb/%3Cb%3Ex%3C/b%3E';
    const { container } = openPart(path);

    expect(shownPath(container)?.textContent).toBe(path);
    for (const link of container.querySelectorAll('a')) {
      expect(link.textContent).not.toContain(path);
      expect(link.getAttribute('href')).not.toBe(path);
    }
  });

  it('the path handed to the page as the raw text /aws/dynamodb/<b>x</b> → the text holds it, and the page holds no b element', () => {
    const path = '/aws/dynamodb/<b>x</b>';
    const { container } = openPart(path);

    expect(shownPath(container)?.textContent).toBe(path);
    expect(container).toHaveTextContent(path);
    expect(container.querySelector('b')).toBeNull();
  });

  it('a path of 114 characters with a 63-character segment → the whole path is in the text, nothing shortened and no ellipsis', () => {
    const path = `/aws/s3/bucket/${'b'.repeat(63)}/property/intelligent-tiering/create`;
    expect(path).toHaveLength(114);
    const { container } = openPart(path);

    expect(shownPath(container)?.textContent).toBe(path);
    expect(container.textContent).not.toContain('…');
    expect(container.textContent).not.toContain('...');
  });

  it('"Go to Things" → a link that looks like a primary button, to the address handed to the page; a plain click changes the route without a document load; a click with a modifier key is left to the browser', () => {
    const { router } = openPart('/aws/dynamodb/other-things');
    const goTo = screen.getByRole('link', { name: 'Go to Things' });

    expect(goTo).toHaveAttribute('href', FIRST.href);
    expect(goTo.className).toMatch(/variant-primary/);
    for (const modifier of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }]) {
      expect(click(goTo, modifier)).toBe(true);
      expect(router.state.location.pathname).toBe('/aws/dynamodb/other-things');
    }
    expect(click(goTo)).toBe(false);
    expect(router.state.location.pathname).toBe(FIRST.href);
  });

  it('"Go to Home" → a link to /, second in visible and Tab order, not primary; a plain click changes the route without a document load', () => {
    const { router, container } = openPart('/aws/dynamodb/other-things');
    const home = screen.getByRole('link', { name: 'Go to Home' });

    expect(home).toHaveAttribute('href', '/');
    expect(home.className).not.toMatch(/variant-primary/);
    const stops = [...container.querySelectorAll<HTMLElement>('a[href], button')].filter((e) => e.tabIndex >= 0);
    expect(stops.map((stop) => stop.textContent)).toEqual(['Go to Things', 'Go to Home']);
    expect(click(home)).toBe(false);
    expect(router.state.location.pathname).toBe('/');
  });

  it('without a first screen → "Go to Home" is the one action', () => {
    open({ path: '/aws/dynamodb/x', first: undefined });

    expect(screen.getAllByRole('link').map((link) => link.textContent)).toEqual(['Go to Home']);
  });

  it('the page never holds the sentence that Studio has no screen for the service', () => {
    const { container } = openPart('/aws/dynamodb/other-things');

    expect(container).toHaveTextContent(STATEMENT);
    expect(container).not.toHaveTextContent(OLD_SENTENCE);
  });
});

describe('the "no screen yet" page of a service without a screen (R5)', () => {
  it('the h1 is the label, the sentence that Studio has no screen for it, one action "Go to Home", and no "Path"', () => {
    const { container } = open();

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Amazon DynamoDB');
    expect(container).toHaveTextContent(OLD_SENTENCE);
    expect(screen.getAllByRole('link').map((link) => link.textContent)).toEqual(['Go to Home']);
    expect(pathLabel(container)).toBeUndefined();
    expect(container).not.toHaveTextContent(SENTENCE);
  });
});
