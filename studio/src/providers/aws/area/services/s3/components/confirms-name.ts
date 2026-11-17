// The rule of the confirmation by a bucket's name (issue 256, requirement R7.2, R8.1): the field confirms the action
// only when it holds exactly the name.

/** Whether `typed` confirms the bucket `name`: exactly the name, case told apart, spaces around it not ignored. */
export function confirmsName(typed: string, name: string): boolean {
  return typed === name;
}
