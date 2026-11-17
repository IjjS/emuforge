import { describe, expect, it } from 'vitest';

import { screenAbove } from './screen-paths';
import type { AreaScreen } from './screens';

// The screen above a path that no screen matches (issue 57, requirement R4.11), as a function of a list of screens, a
// service and a path. The test screens are of a service `/x`, whose route is `/aws/x`.

function NoPage() {
  return null;
}

/** A screen of `service` at `paths`, leading to `leadsTo` when given, its other parts the least the type asks. */
function screenAt(paths: readonly string[], leadsTo?: readonly string[], service = '/x'): AreaScreen {
  return {
    service,
    paths,
    ...(leadsTo === undefined ? {} : { leadsTo }),
    title: paths[0] ?? '',
    crumbs: [{ text: paths[0] ?? '' }],
    navigation: { header: { text: 'X', href: '/aws/x' }, items: [], activeHref: '/aws/x' },
    Page: NoPage,
  };
}

const ROUTE = screenAt(['/aws/x']);
const LIST = screenAt(['/aws/x/things']);
const THING = screenAt(['/aws/x/things/{name}']);
const CREATE = screenAt(['/aws/x/things/create']);
const LEADS = screenAt(['/aws/x/things/{name}'], ['/aws/x/thing/{name}/property']);

describe('the screen above a path (issue 57, R4.11)', () => {
  it.each(['/aws/x/things/a/more', '/aws/x/things/a/more/again'])(
    '%s with a screen at /aws/x/things/{name} → that screen, name "a", and the leading part /aws/x/things/a',
    (path) => {
      expect(screenAbove([THING], '/x', path)).toEqual({
        screen: THING,
        params: { name: 'a' },
        address: '/aws/x/things/a',
      });
    },
  );

  it.each(['/aws/x/anything', '/aws/x/'])(
    "%s with a screen at /aws/x (the service's route) and no other → no screen above",
    (path) => {
      expect(screenAbove([ROUTE], '/x', path)).toBeUndefined();
    },
  );

  it('/aws/x/things/a/b with screens at /aws/x/things and /aws/x/things/{name} → the second, which matches more segments', () => {
    expect(screenAbove([LIST, THING], '/x', '/aws/x/things/a/b')).toMatchObject({
      screen: THING,
      params: { name: 'a' },
    });
  });

  it('/aws/x/things/create/more with screens at /aws/x/things/create and /aws/x/things/{name} → the first, a literal segment first', () => {
    for (const screens of [
      [CREATE, THING],
      [THING, CREATE],
    ]) {
      expect(screenAbove(screens, '/x', '/aws/x/things/create/more')).toEqual({
        screen: CREATE,
        params: {},
        address: '/aws/x/things/create',
      });
    }
  });

  it('/aws/x/things/a%2Fb/more → name a/b, decoded once, and the leading part /aws/x/things/a%2Fb, as the address carries it', () => {
    expect(screenAbove([THING], '/x', '/aws/x/things/a%2Fb/more')).toEqual({
      screen: THING,
      params: { name: 'a/b' },
      address: '/aws/x/things/a%2Fb',
    });
  });

  it('/aws/x/things/%zz/more → with /aws/x/things and /aws/x/things/{name}, the screen at /aws/x/things; with the second alone, no screen above', () => {
    expect(screenAbove([LIST, THING], '/x', '/aws/x/things/%zz/more')).toEqual({
      screen: LIST,
      params: {},
      address: '/aws/x/things',
    });
    expect(screenAbove([THING], '/x', '/aws/x/things/%zz/more')).toBeUndefined();
  });

  it.each(['/aws/x/thing/a/property/tags/edit', '/aws/x/thing/a/property'])(
    '%s with a screen at /aws/x/things/{name} that leads to /aws/x/thing/{name}/property → that screen, name "a", and its address /aws/x/things/a',
    (path) => {
      expect(screenAbove([LEADS], '/x', path)).toEqual({
        screen: LEADS,
        params: { name: 'a' },
        address: '/aws/x/things/a',
      });
    },
  );

  it('/aws/x/thing/a%2Fb/property/tags with that screen → name a/b, and its address /aws/x/things/a%2Fb (the first path, the value encoded once)', () => {
    expect(screenAbove([LEADS], '/x', '/aws/x/thing/a%2Fb/property/tags')).toEqual({
      screen: LEADS,
      params: { name: 'a/b' },
      address: '/aws/x/things/a%2Fb',
    });
  });

  it('/aws/x/thing/a/other with that screen, neither at nor below the pattern it leads to → no screen above', () => {
    expect(screenAbove([LEADS], '/x', '/aws/x/thing/a/other')).toBeUndefined();
  });

  it("a path below one screen's own path and below a pattern another screen leads to, as many segments each → the screen whose own path it is below", () => {
    const own = screenAt(['/aws/x/thing/{name}/property']);
    const leading = screenAt(['/aws/x/others/{name}'], ['/aws/x/thing/{name}/property']);
    for (const screens of [
      [own, leading],
      [leading, own],
    ]) {
      expect(screenAbove(screens, '/x', '/aws/x/thing/a/property/tags')).toEqual({
        screen: own,
        params: { name: 'a' },
        address: '/aws/x/thing/a/property',
      });
    }
  });

  it('a screen of another service whose pattern would match → never the screen above', () => {
    const other = screenAt(['/aws/x/things/{name}'], ['/aws/x/thing/{name}/property'], '/y');
    expect(screenAbove([other], '/x', '/aws/x/things/a/more')).toBeUndefined();
    expect(screenAbove([other], '/x', '/aws/x/thing/a/property')).toBeUndefined();
  });
});
