export const STAGE_NAME_RULE = 'Use letters, digits, and underscores only.';

export function checkDeployStage(target: 'existing' | 'new', existing: string | undefined, name: string) {
  if (target === 'existing') {
    return existing === undefined ? { error: 'Choose an existing stage.' } : { stageName: existing };
  }
  return /^[A-Za-z0-9_]+$/.test(name) ? { stageName: name } : { error: STAGE_NAME_RULE };
}
