import { fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';

import type { Service } from '../../services';
import type { EntryAreaPage } from '../area-page';
import type { EntryGroup, ResourceEntry } from '../entries';
import { entryLinks } from '../entry-navigation';
import type { AreaScreen } from '../screens';
import { EntryPage } from './entry-page';

const service: Service = { route: '/example', label: 'Amazon Example', crumb: 'Example', hasScreen: true };
const route = '/aws/example';
const accounts = { label: 'Accounts', path: `${route}/accounts`, listedBy: 'ListAccounts' };
const rules = { label: 'Rules', path: `${route}/rules`, listedBy: 'ListRules' };
const subService = { name: 'Sub-service', path: `${route}/sub-service` };
const navigation = { header: { text: service.label, href: route }, activeHref: accounts.path };
const accountsScreen: AreaScreen = {
  service: service.route,
  paths: [route, accounts.path],
  title: accounts.label,
  crumbs: [{ text: accounts.label }],
  navigation,
  Page: () => null,
};
const first = { screen: accountsScreen, address: route, title: accounts.label };

function page(resource: ResourceEntry, multipleGroups = false): EntryAreaPage {
  const group = { name: service.label, entries: [accounts, resource] };
  return {
    kind: 'entry',
    label: resource.label,
    match: { resource, group },
    groups: multipleGroups ? [group, { name: subService.name, subService, entries: [] }] : [group],
    service,
    first,
    navigation,
  };
}

function open(page: EntryAreaPage) {
  const router = createMemoryRouter(
    [
      { path: '/entry', element: <EntryPage page={page} /> },
      { path: '/', element: <h1>Home</h1> },
      { path: `${route}/*`, element: <h1>Destination</h1> },
    ],
    { initialEntries: ['/entry'] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

describe('the page of an entry without a screen (issue 650, R5)', () => {
  it('describes a kind listed for the account and offers the service’s first screen and Home', () => {
    open(page(rules, true));

    expect(screen.getByRole('heading', { level: 1, name: rules.label })).toBeInTheDocument();
    expect(screen.getByText('Studio has no screen for this yet.')).toBeInTheDocument();
    expect(screen.getByText('Resource kind')).toBeInTheDocument();
    expect(screen.getByText('Part of')).toBeInTheDocument();
    expect(screen.getByText(service.label)).toBeInTheDocument();
    expect(screen.getByText('Listed by')).toBeInTheDocument();
    expect(screen.getByText(rules.listedBy).tagName).toBe('CODE');
    expect(screen.getByText('Opening this page changed nothing in your local emulator.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to Accounts' })).toHaveAttribute('href', route);
    expect(screen.getByRole('link', { name: 'Go to Home' })).toHaveAttribute('href', '/');
  });

  it('omits the group name for a kind in a single group', () => {
    open(page(rules));
    expect(screen.queryByText('Part of')).not.toBeInTheDocument();
  });

  it('names and links to the parent of a scoped kind without promising a view there', () => {
    open(page({ ...rules, listedInside: accounts.path }));

    expect(screen.getByText('Studio has no screen for this yet.')).toBeInTheDocument();
    expect(screen.getByText('Listed inside')).toBeInTheDocument();
    expect(screen.getByText(accounts.label)).toBeInTheDocument();
    expect(screen.queryByText(/^It shows them in/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to Accounts' })).toHaveAttribute('href', accounts.path);
  });

  it.each([true, false])('names the existing view and its link (scoped: %s)', (scoped) => {
    open(
      page({
        ...rules,
        ...(scoped ? { listedInside: accounts.path } : {}),
        shownIn: { entry: accounts.path, place: 'the "Rules" section of an account' },
      }),
    );

    expect(screen.getByText('Studio has no screen that lists these across Example yet.')).toBeInTheDocument();
    expect(screen.getByText('It shows them in the "Rules" section of an account.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to Accounts' })).toHaveAttribute('href', accounts.path);
    expect(screen.queryByText('Listed inside') !== null).toBe(scoped);
  });

  it('lists a sub-service’s resource kinds and marks links without screens', () => {
    const group: EntryGroup = { name: subService.name, subService, entries: [accounts, rules] };
    open({
      ...page(rules, true),
      label: subService.name,
      match: { subService, group, links: entryLinks(group.entries, [accountsScreen], service.route) },
    });

    expect(screen.getByRole('heading', { level: 1, name: subService.name })).toBeInTheDocument();
    expect(screen.getAllByText('Sub-service').some((element) => element.closest('dt') !== null)).toBe(true);
    expect(screen.getByText('Part of')).toBeInTheDocument();
    expect(screen.getByText(service.crumb)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Resource kinds' })).toBeInTheDocument();

    const built = screen.getByRole('link', { name: accounts.label });
    const unbuilt = screen.getByRole('link', { name: rules.label });
    expect(built).toHaveAttribute('href', accounts.path);
    expect(built.closest('li')).not.toHaveTextContent('No screen yet');
    expect(unbuilt).toHaveAttribute('href', rules.path);
    expect(unbuilt.closest('li')).toHaveTextContent('No screen yet');
  });

  it('offers Home alone when the service has no first screen at a literal path', () => {
    open({ ...page(rules), first: undefined });
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAccessibleName('Go to Home');
  });

  it.each([
    ['Go to Accounts', route],
    ['Go to Home', '/'],
  ])('follows %s in place', (label, path) => {
    const router = open(page(rules));
    const link = screen.getByRole('link', { name: label });
    expect(fireEvent.click(link)).toBe(false);
    expect(router.state.location.pathname).toBe(path);
  });
});
