export const PATH_PART_RULE =
  'Use letters, digits, periods, underscores, hyphens or colons, or a path variable such as {id} or {proxy+}.';

export function pathPartError(value: string): string | undefined {
  const allowed = /^(?:[a-zA-Z0-9._:-]+|\{[a-zA-Z0-9._:-]+\+?\})$/;
  return allowed.test(value) ? undefined : PATH_PART_RULE;
}
