import { describe, expect, it } from 'vitest';

import { findResourceEntry } from '../../entries';
import { ENTRIES } from './entries';
import { SCREENS } from './screens';

const currentLinks = {
  '/aws/lambda': { href: '/aws/lambda/functions', label: 'Event Functions' },
  '/aws/lambda/functions': { href: '/aws/lambda/functions', label: 'Event Functions' },
  '/aws/lambda/functions/function/{name}': { href: '/aws/lambda/functions', label: 'Event Functions' },
  '/aws/lambda/functions/create': { href: '/aws/lambda/functions', label: 'Event Functions' },
  '/aws/lambda/layers': { href: '/aws/lambda/layers', label: 'Layers' },
};

describe("Lambda's screen navigation (issue 650)", () => {
  it('marks Event Functions or Layers current on their respective screens', () => {
    const linksByPath = Object.fromEntries(
      SCREENS.flatMap(({ paths, navigation: { activeHref } }) =>
        paths.map((path) => [path, { href: activeHref, label: findResourceEntry(ENTRIES, activeHref)?.label }]),
      ),
    );
    expect(linksByPath).toEqual(currentLinks);
  });

  it('leaves the items to the entry registry', () => {
    for (const screen of SCREENS) {
      expect(screen.navigation.items, screen.paths[0]).toBeUndefined();
    }
  });
});
