import type { AreaScreen, ScreenCrumb, ServiceScreen } from './screens';

// A screen's path patterns (issue 386, requirement R4.1 to R4.4): `/aws/<service>` and segments that are either
// literal text or a whole-segment parameter `{name}`, and what the area reads of a screen for an address. Kept apart
// from `screens.ts`, which the area's layout test replaces with its own registry, so the layout matches with this
// code whatever registry it reads.

/** The values of a pattern's parameters for an address, by name, each its segment percent-decoded once. */
export type ScreenParams = Readonly<Record<string, string>>;

/** One segment of a pattern: literal text, or a parameter by name. */
export type PatternSegment = { literal: string } | { param: string };

const LITERAL = /^[a-z0-9._-]+$/;
const PARAM = /^\{([a-z][a-z0-9_]*)\}$/;

/**
 * Why `pattern` is not a well formed path of the area (R4.1), or `undefined` when it is: it starts with `/aws/`,
 * then segments, each literal text of lower-case letters, digits, `-`, `_` and `.`, or a whole-segment parameter
 * `{name}` whose name is a lower-case letter then lower-case letters, digits or `_`, each name once; no empty
 * segment, no trailing slash, no `?`, no `#`, no brace elsewhere.
 */
export function patternFault(pattern: string): string | undefined {
  if (!pattern.startsWith('/aws/')) return `${pattern}: a path starts with /aws/`;
  if (pattern.includes('?') || pattern.includes('#')) return `${pattern}: a path holds no ? and no #`;
  const names = new Set<string>();
  for (const segment of pattern.slice(1).split('/')) {
    if (segment === '') return `${pattern}: a path has no empty segment and no trailing slash`;
    const param = PARAM.exec(segment);
    if (param !== null) {
      const name = param[1] as string;
      if (names.has(name)) return `${pattern}: the parameter {${name}} appears twice`;
      names.add(name);
    } else if (!LITERAL.test(segment)) {
      return `${pattern}: the segment "${segment}" is neither literal text (a-z, 0-9, - _ .) nor a parameter {name}`;
    }
  }
  return undefined;
}

/** The segments of a well formed pattern, after its leading `/`. */
export function patternSegments(pattern: string): PatternSegment[] {
  return pattern
    .slice(1)
    .split('/')
    .map((segment) => {
      const param = PARAM.exec(segment);
      return param === null ? { literal: segment } : { param: param[1] as string };
    });
}

/**
 * Whether `pathname` matches `pattern` (R4.2): as many segments, each literal one equal to the address's as written,
 * each parameter's segment not empty. Nothing is decoded here.
 */
export function matchesPattern(pattern: string, pathname: string): boolean {
  const segments = patternSegments(pattern);
  const parts = pathname.slice(1).split('/');
  return (
    pathname.startsWith('/') &&
    parts.length === segments.length &&
    segments.every((segment, index) => {
      const part = parts[index] as string;
      return 'literal' in segment ? part === segment.literal : part !== '';
    })
  );
}

/**
 * Orders two patterns that match one address (R4.3): the one with a literal segment at the first position where
 * they differ in kind comes first. `0` when they differ in no position but by their parameters' names.
 */
export function comparePatterns(a: string, b: string): number {
  const sa = patternSegments(a);
  const sb = patternSegments(b);
  for (let index = 0; index < Math.min(sa.length, sb.length); index += 1) {
    const literalA = 'literal' in (sa[index] as PatternSegment);
    const literalB = 'literal' in (sb[index] as PatternSegment);
    if (literalA !== literalB) return literalA ? -1 : 1;
  }
  return 0;
}

/**
 * Whether two well formed patterns match the same set of addresses (R3.4): as many segments, a parameter where the
 * other has one, and the same literal text where both have literal text.
 */
export function samePatterns(a: string, b: string): boolean {
  const sa = patternSegments(a);
  const sb = patternSegments(b);
  return (
    sa.length === sb.length &&
    sa.every((segment, index) => {
      const other = sb[index] as PatternSegment;
      return 'literal' in segment ? 'literal' in other && other.literal === segment.literal : 'param' in other;
    })
  );
}

/**
 * The values of `pattern`'s parameters in `pathname`, which matches it (R4.4): each segment percent-decoded once.
 * `undefined` when a parameter's segment is not valid percent-encoding.
 */
export function patternParams(pattern: string, pathname: string): ScreenParams | undefined {
  const parts = pathname.slice(1).split('/');
  const params: Record<string, string> = {};
  for (const [index, segment] of patternSegments(pattern).entries()) {
    if ('param' in segment) {
      try {
        params[segment.param] = decodeURIComponent(parts[index] as string);
      } catch {
        return undefined;
      }
    }
  }
  return params;
}

/** Sample values for every parameter of `pattern`, for a rule that calls a screen's title or crumbs. */
export function sampleParams(pattern: string): ScreenParams {
  return Object.fromEntries(
    patternSegments(pattern).flatMap((segment) => ('param' in segment ? [[segment.param, 'sample']] : [])),
  );
}

/** A screen's crumbs for `params`. */
export function screenCrumbs(screen: ServiceScreen, params: ScreenParams): readonly ScreenCrumb[] {
  return typeof screen.crumbs === 'function' ? screen.crumbs(params) : screen.crumbs;
}

/** A screen's title for `params`. */
export function screenTitle(screen: ServiceScreen, params: ScreenParams): string {
  return typeof screen.title === 'function' ? screen.title(params) : screen.title;
}

/** The screens of a service whose patterns `pathname` matches, with the pattern each matched by. */
export function matchingScreens(
  screens: readonly AreaScreen[],
  service: string,
  pathname: string,
): { screen: AreaScreen; pattern: string }[] {
  return screens
    .filter((screen) => screen.service === service)
    .flatMap((screen) =>
      screen.paths.filter((pattern) => matchesPattern(pattern, pathname)).map((pattern) => ({ screen, pattern })),
    );
}

/** The screen a path no screen matches is below (issue 57, requirement R4.11), with what the page reads of it. */
export interface ScreenAbove {
  screen: AreaScreen;
  /** The values of its parameters in the path, each decoded once. */
  params: ScreenParams;
  /**
   * The address its last crumb leads to: for a path below one of the screen's own paths, the leading part of the path
   * that the screen matches, exactly as the address carries it; for a path below a pattern the screen leads to, the
   * screen's first path with each parameter's value percent-encoded once (R4.3).
   */
  address: string;
}

/** `pattern` with each parameter replaced by its value in `params`, percent-encoded once. */
export function fillPattern(pattern: string, params: ScreenParams): string {
  return `/${patternSegments(pattern)
    .map((segment) => ('literal' in segment ? segment.literal : encodeURIComponent(params[segment.param] ?? '')))
    .join('/')}`;
}

/** One way a screen is above a path: by one of its own patterns or one it leads to, through `segments` segments. */
interface AboveMatch extends ScreenAbove {
  pattern: string;
  segments: number;
  leads: boolean;
}

/**
 * The screen of `service` (its route, `/s3`) that `pathname`, which no screen matches, is below (R4.11), or
 * `undefined` when there is none. Below one of a screen's own paths: a leading part of the path, of whole segments,
 * shorter than the path and longer than the service's route, matches one of its patterns. Below a path it leads to:
 * the path or such a leading part of it matches one of its `leadsTo` patterns. Of several, the one that matches the
 * most segments, then the pattern with a literal segment first (`comparePatterns`), then a screen's own path before
 * one it leads to. A match whose parameter is not valid percent-encoding is no match.
 */
export function screenAbove(
  screens: readonly AreaScreen[],
  service: string,
  pathname: string,
): ScreenAbove | undefined {
  const parts = pathname.slice(1).split('/');
  // `aws` and the service's own segments: a leading part must be longer than the service's route.
  const routeSegments = 1 + service.slice(1).split('/').length;
  const matches: AboveMatch[] = [];
  for (const screen of screens.filter((entry) => entry.service === service)) {
    const ways = [
      ...screen.paths.map((pattern) => ({ pattern, leads: false })),
      ...(screen.leadsTo ?? []).map((pattern) => ({ pattern, leads: true })),
    ];
    for (const { pattern, leads } of ways) {
      const segments = patternSegments(pattern).length;
      if (segments <= routeSegments || segments > parts.length || (!leads && segments === parts.length)) continue;
      const leading = `/${parts.slice(0, segments).join('/')}`;
      if (!matchesPattern(pattern, leading)) continue;
      const params = patternParams(pattern, leading);
      if (params === undefined) continue;
      const address = leads ? fillPattern(screen.paths[0] ?? pattern, params) : leading;
      matches.push({ screen, params, address, pattern, segments, leads });
    }
  }
  const [best] = matches.sort(
    (a, b) => b.segments - a.segments || comparePatterns(a.pattern, b.pattern) || Number(a.leads) - Number(b.leads),
  );
  return best === undefined ? undefined : { screen: best.screen, params: best.params, address: best.address };
}

/** A service's first screen (R4.1): the screen, the address the page's first action leads to, and its title there. */
export interface FirstScreen {
  screen: AreaScreen;
  address: string;
  title: string;
}

/**
 * The first screen of `service` (its route, `/s3`), whose route is `route` (`/aws/s3`), as R4.1 gives it: the screen
 * shown at the route; else the first screen of the service the registry lists that has a path without a parameter,
 * at the first such path; `undefined` when every screen of the service is at paths with a parameter.
 */
export function firstScreen(screens: readonly AreaScreen[], service: string, route: string): FirstScreen | undefined {
  const [atRoute] = matchingScreens(screens, service, route).sort((a, b) => comparePatterns(a.pattern, b.pattern));
  if (atRoute !== undefined) {
    return { screen: atRoute.screen, address: route, title: screenTitle(atRoute.screen, {}) };
  }
  for (const screen of screens.filter((entry) => entry.service === service)) {
    const address = screen.paths.find((pattern) => patternSegments(pattern).every((segment) => 'literal' in segment));
    if (address !== undefined) {
      return { screen, address, title: screenTitle(screen, {}) };
    }
  }
  return undefined;
}
