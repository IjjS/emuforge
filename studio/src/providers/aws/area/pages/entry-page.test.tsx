import createWrapper from '@cloudscape-design/components/test-utils/dom';
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
const reports = { label: 'Reports', path: `${route}/reports`, listedBy: 'ListReports' };
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
  const group = { name: service.label, entries: [accounts, reports, resource] };
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

function metadata() {
  return createWrapper(document.body)
    .findKeyValuePairs()
    ?.findItems()
    .map((item) => [item.findLabel()?.getElement().textContent, item.findValue()?.getElement().textContent]);
}

describe('the page of an entry without a screen (issue 650, R5)', () => {
  it('describes a kind listed for the account and offers the service’s first screen and Home', () => {
    open(page(rules, true));

    expect(screen.getByRole('heading', { level: 1, name: rules.label })).toBeInTheDocument();
    expect(screen.getByText('Studio has no screen for this yet.')).toBeInTheDocument();
    expect(metadata()).toEqual([
      ['Resource kind', rules.label],
      ['Part of', service.label],
      ['Listed by', rules.listedBy],
    ]);
    expect(screen.getByText(rules.listedBy).closest('code')).toHaveTextContent(rules.listedBy);
    expect(screen.getByText('Opening this page changed nothing in your local emulator.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to Accounts' })).toHaveAttribute('href', route);
    expect(screen.getByRole('link', { name: 'Go to Home' })).toHaveAttribute('href', '/');
  });

  it('omits the group name for a kind in a single group', () => {
    open(page(rules));
    expect(metadata()).toEqual([
      ['Resource kind', rules.label],
      ['Listed by', rules.listedBy],
    ]);
  });

  it('names and links to the parent of a scoped kind without promising a view there', () => {
    open(page({ ...rules, listedInside: accounts.path }));

    expect(screen.getByText('Studio has no screen for this yet.')).toBeInTheDocument();
    expect(metadata()).toContainEqual(['Listed inside', accounts.label]);
    expect(screen.queryByText(/^It shows them in/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to Accounts' })).toHaveAttribute('href', accounts.path);
  });

  it.each([true, false])('names the existing view and its link (scoped: %s)', (scoped) => {
    open(
      page({
        ...rules,
        ...(scoped ? { listedInside: accounts.path } : {}),
        shownIn: { entry: reports.path, place: 'the "Rules" section of a report' },
      }),
    );

    expect(screen.getByText('Studio has no screen that lists these across Example yet.')).toBeInTheDocument();
    expect(screen.getByText('It shows them in the "Rules" section of a report.')).toBeInTheDocument();
    expect(metadata()).toEqual([
      ['Resource kind', rules.label],
      ['Listed by', rules.listedBy],
      ...(scoped ? [['Listed inside', accounts.label]] : []),
    ]);
    expect(screen.getByRole('link', { name: `Go to ${reports.label}` })).toHaveAttribute('href', reports.path);
  });

  it('lists a sub-service’s resource kinds and marks links without screens', () => {
    const group: EntryGroup = { name: subService.name, subService, entries: [accounts, rules] };
    open({
      ...page(rules, true),
      label: subService.name,
      match: { subService, group, links: entryLinks(group.entries, [accountsScreen], service.route) },
    });

    expect(screen.getByRole('heading', { level: 1, name: subService.name })).toBeInTheDocument();
    expect(metadata()).toEqual([
      ['Sub-service', subService.name],
      ['Part of', service.crumb],
    ]);
    expect(screen.getByRole('heading', { level: 2, name: 'Resource kinds' })).toBeInTheDocument();

    const built = screen.getByRole('link', { name: accounts.label });
    const unbuilt = screen.getByRole('link', { name: rules.label });
    expect(built).toHaveAttribute('href', accounts.path);
    expect(built.closest('li')).not.toHaveTextContent('No screen yet');
    expect(built).not.toHaveAccessibleDescription();
    expect(unbuilt).toHaveAttribute('href', rules.path);
    expect(unbuilt.textContent).toBe(rules.label);
    expect(unbuilt.closest('li')).toHaveTextContent('No screen yet');
    expect(unbuilt).toHaveAccessibleDescription('No screen yet');
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
