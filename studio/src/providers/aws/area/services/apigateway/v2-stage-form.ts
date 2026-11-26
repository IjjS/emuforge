export const V2_STAGE_NAME_RULE = 'Use letters, digits, hyphens and underscores, or enter $default.';

export function v2StageNameError(name: string): string | undefined {
  return name === '$default' || /^[A-Za-z0-9_-]+$/.test(name) ? undefined : V2_STAGE_NAME_RULE;
}
