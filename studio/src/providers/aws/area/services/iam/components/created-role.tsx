import type { FlashItem, FlashResult } from '../../../components/page-flash';
import type { CreatedRole } from '../api';
import { actionFailureItem } from './failures';
import { Quoted } from './quoted';

// What the role list shows once "Create role" has created a role (issue 82, requirement R6.7): the result the wizard
// hands over to the list; the name in it shown as a name (issue 467, requirement R6).

/**
 * The success item "Role “{name}” was created in the local emulator.", then one item per policy whose
 * `AttachRolePolicy` failed, "Attaching {policy name} to {name} failed" with the failure as R10.3 words it.
 */
export function createdRoleResult(
  { name, attachFailures }: CreatedRole,
  engineOrigin: string | undefined,
): FlashResult {
  const failures: FlashItem[] = attachFailures.map(({ policy, failure }) =>
    actionFailureItem(failure, `Attaching ${policy.name} to ${name}`, engineOrigin),
  );
  return [
    { type: 'success', content: <Quoted before="Role “" name={name} after="” was created in the local emulator." /> },
    ...failures,
  ];
}
