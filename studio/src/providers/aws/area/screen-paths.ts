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
