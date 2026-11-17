import Box from '@cloudscape-design/components/box';
import FormField from '@cloudscape-design/components/form-field';
import Select, { type SelectProps } from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { forwardRef, useCallback } from 'react';

import type { LambdaFailure, Role } from '../api';
import { useRoleList } from '../queries';

// "Existing role" of "Create Event Function" (issue 84, requirement R6.2, R9.4, R10.3): the emulator's IAM roles, read
// with `ListRoles` page by page as Cloudscape's select asks for them, each shown by its name and, when it is not `/`,
// its path. Its states are EmuForge's own words; every name and path is the emulator's, rendered as text.

const EXISTING_ROLE = 'Existing role';
const DESCRIPTION = "Roles in the emulator's IAM.";
const PLACEHOLDER = 'Choose an existing role';
const LOADING = 'Loading roles';
const NO_ROLES = 'No roles';
const NO_ROLES_SENTENCE =
  'This emulator holds no roles. Choose “Create default role”, or create one with any tool pointed at the emulator.';

/**
 * A failed reading of the roles in the words of R10.3, as one line of text: the select's error status takes a string.
 * `engineOrigin` is the engine's address the page is configured with.
 */
function rolesFailureText(failure: LambdaFailure, engineOrigin: string | undefined): string {
  switch (failure.kind) {
    case 'not-implemented':
      return `Not implemented by the emulator. The emulator answered 501 Not Implemented for ${failure.operation}.`;
    case 'access-denied':
      return `Access denied. ${failure.operation} was refused: ${failure.message}`;
    case 'emulator-did-not-answer':
      return failure.message === ''
        ? 'The emulator did not answer.'
        : `The emulator did not answer. ${failure.message}`;
    case 'engine-did-not-answer':
      return `The EmuForge engine at ${engineOrigin ?? ''} did not answer.`;
    case 'other':
      return failure.message === undefined
        ? `Reading the roles failed. ${failure.code}`
        : `Reading the roles failed. ${failure.code}: ${failure.message}`;
  }
}

function roleOption(role: Role): SelectProps.Option {
  return {
    value: role.arn,
    label: role.name,
    ...(role.path === undefined || role.path === '/' ? {} : { description: role.path }),
  };
}

export interface RoleSelectProps {
  /** The engine's address; nothing is read while it is not known. */
  endpoint: string | undefined;
  /** The role chosen, by its ARN; `undefined` while none is. */
  chosen: SelectProps.Option | null;
  onChange: (option: SelectProps.Option) => void;
  /** The field's message (R6.4), or `undefined`. */
  errorText: string | undefined;
}

/** The field "Existing role", shown while "Use another role" is chosen. */
export const RoleSelect = forwardRef<SelectProps.Ref, RoleSelectProps>(function RoleSelect(
  { endpoint, chosen, onChange, errorText },
  ref,
) {
  const roles = useRoleList(endpoint);
  const { load, retry } = roles;

  const handleLoadItems = useCallback(
    ({ detail }: { detail: SelectProps.LoadItemsDetail }) => {
      if (detail.samePage) {
        retry();
      } else {
        load(detail.firstPage);
      }
    },
    [load, retry],
  );

  const handleChange = useCallback(
    ({ detail }: { detail: SelectProps.ChangeDetail }) => {
      onChange(detail.selectedOption);
    },
    [onChange],
  );

  return (
    <FormField label={EXISTING_ROLE} description={DESCRIPTION} errorText={errorText}>
      <Select
        ref={ref}
        selectedOption={chosen}
        onChange={handleChange}
        options={roles.roles.map(roleOption)}
        placeholder={PLACEHOLDER}
        statusType={roles.status}
        onLoadItems={handleLoadItems}
        loadingText={LOADING}
        empty={
          <SpaceBetween size="xxs">
            <Box variant="strong" color="inherit">
              {NO_ROLES}
            </Box>
            <Box variant="p" color="inherit">
              {NO_ROLES_SENTENCE}
            </Box>
          </SpaceBetween>
        }
        {...(roles.failure === undefined ? {} : { errorText: rolesFailureText(roles.failure, endpoint) })}
        recoveryText="Retry"
        invalid={errorText !== undefined}
      />
    </FormField>
  );
});
