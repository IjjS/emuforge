import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { render, screen, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Service } from '../../services';
import { IndexPage } from './index-page';

// The area's index (issue 61 with issue 494, requirements R4 and R5), rendered alone inside a router on the test's
// own services and registry: which of them have a screen is the registry's, never a list written in the page.

/** A test service named `name`, its route `/<name>`; `hasScreen` is not what the index reads. */
function service(name: string): Service {
  return { label: `Amazon ${name}`, crumb: name, route: `/${name.toLowerCase()}`, hasScreen: false };
}

/** Four services in label order. */
const FOUR = ['Alpha', 'Beta', 'Gamma', 'Delta'].map(service).sort((a, b) => a.label.localeCompare(b.label));

/** A registry holding one screen of each service of `routes`, and two of the first (a service with many screens). */
function registry(...routes: string[]): { service: string }[] {
  return [...routes, ...routes.slice(0, 1)].map((route) => ({ service: route }));
}

const fetchSpy = vi.fn(() => Promise.reject(new Error('the index sends no request')));

afterEach(() => {
  vi.unstubAllGlobals();
  fetchSpy.mockClear();
});

/** The index of `services` with `screens` registered, inside a router at `/aws`. */
function open(services: readonly Service[], screens: readonly { service: string }[]) {
  vi.stubGlobal('fetch', fetchSpy);
  const router = createMemoryRouter([{ path: '/aws', element: <IndexPage services={services} screens={screens} /> }], {
    initialEntries: ['/aws'],
  });
  const result = render(<RouterProvider router={router} />);
  const wrapper = createWrapper(result.container);
  const container = wrapper.findContainer();
  const header = container?.findHeader()?.findHeader();
  return {
    description: header?.findDescription()?.getElement().textContent,
    counter: header?.findCounter()?.getElement().textContent,
    container: container?.getElement() as HTMLElement,
  };
}

/** The links of `element`, each as its text and its address, in document order. */
function linksOf(element: HTMLElement): [string | null, string | null][] {
  return within(element)
    .queryAllByRole('link')
    .map((link) => [link.textContent, link.getAttribute('href')]);
}

/** `services` as links: each label to `/aws/<route>`. */
function asLinks(services: readonly Service[]): [string, string][] {
  return services.map(({ label, route }) => [label, `/aws${route}`]);
}

/** The group named `name`: a level-3 heading of that text and the region it names. */
function group(container: HTMLElement, name: string): HTMLElement {
  expect(within(container).getByRole('heading', { level: 3, name })).toBeInTheDocument();
  return within(container).getByRole('region', { name });
}

const ALPHA = FOUR[0] as Service;
const BETA = FOUR[1] as Service;
const DELTA = FOUR[2] as Service;
const GAMMA = FOUR[3] as Service;

describe('the index of the AWS area tells the services with a Studio screen from the others (issue 61, R4, R5)', () => {
  it('four services of which two have a screen → "2 of 4 services have a Studio screen.", then the group "With a Studio screen (2)" and the group "No Studio screen yet (2)", each with its links in label order', () => {
    const { description, container } = open(FOUR, registry(GAMMA.route, BETA.route));

    expect(description).toBe('2 of 4 services have a Studio screen.');
    const withScreen = group(container, 'With a Studio screen (2)');
    const without = group(container, 'No Studio screen yet (2)');
    expect(linksOf(withScreen)).toEqual(asLinks([BETA, GAMMA]));
    expect(linksOf(without)).toEqual(asLinks([ALPHA, DELTA]));
    expect(withScreen.compareDocumentPosition(without) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  });

  it('four services of which one has a screen → "1 of 4 services has a Studio screen." and the groups "(1)" and "(3)"', () => {
    const { description, container } = open(FOUR, registry(DELTA.route));

    expect(description).toBe('1 of 4 services has a Studio screen.');
    expect(linksOf(group(container, 'With a Studio screen (1)'))).toEqual(asLinks([DELTA]));
    expect(linksOf(group(container, 'No Studio screen yet (3)'))).toEqual(asLinks([ALPHA, BETA, GAMMA]));
  });

  it('no service has a screen → "No service has a Studio screen yet.", one list of every service in label order, and neither group heading', () => {
    const { description, container } = open(FOUR, []);

    expect(description).toBe('No service has a Studio screen yet.');
    expect(linksOf(container)).toEqual(asLinks(FOUR));
    expect(within(container).queryAllByRole('heading', { level: 3 })).toEqual([]);
    expect(within(container).queryAllByRole('region')).toEqual([]);
  });

  it('every service has a screen → "Every service has a Studio screen.", one list, and neither group heading', () => {
    const { description, container } = open(FOUR, registry(...FOUR.map(({ route }) => route)));

    expect(description).toBe('Every service has a Studio screen.');
    expect(linksOf(container)).toEqual(asLinks(FOUR));
    expect(within(container).queryAllByRole('heading', { level: 3 })).toEqual([]);
    expect(within(container).queryAllByRole('region')).toEqual([]);
  });

  it.each<[string, string[]]>([
    ['none', []],
    ['one', [DELTA.route]],
    ['two', [GAMMA.route, BETA.route]],
    ['every one', FOUR.map(({ route }) => route)],
  ])(
    'with %s having a screen → the counter of "Services" is the number of services, every service is linked exactly once, and rendering sends no request',
    (_what, routes) => {
      const { counter, container } = open(FOUR, registry(...routes));

      expect(counter?.trim()).toBe('(4)');
      expect(
        linksOf(container)
          .map(([label]) => label)
          .sort(),
      ).toEqual(FOUR.map(({ label }) => label).sort());
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Amazon Web Services');
    },
  );
});
