import { GrantOperation } from '@aws-sdk/client-kms';
import FormField from '@cloudscape-design/components/form-field';
import Input from '@cloudscape-design/components/input';
import Multiselect from '@cloudscape-design/components/multiselect';

const operations = Object.values(GrantOperation);
const options = operations.map((operation) => ({ label: operation, value: operation }));

export interface GrantDraft {
  grantee: string;
  operations: GrantOperation[];
}

export function GrantFields({
  draft,
  disabled,
  onChange,
}: {
  draft: GrantDraft;
  disabled: boolean;
  onChange: (draft: GrantDraft) => void;
}) {
  return (
    <>
      <FormField label="Grantee principal ARN" stretch>
        <Input
          value={draft.grantee}
          disabled={disabled}
          spellcheck={false}
          autoComplete={false}
          onChange={({ detail }) => onChange({ ...draft, grantee: detail.value })}
        />
      </FormField>
      <FormField label="Allowed operations" stretch>
        <Multiselect
          selectedOptions={options.filter(({ value }) => draft.operations.includes(value))}
          options={options}
          disabled={disabled}
          placeholder="Choose operations"
          filteringType="auto"
          filteringPlaceholder="Find an operation"
          selectedAriaLabel="Selected"
          deselectAriaLabel={(option) => `Remove ${option.label ?? ''}`}
          onChange={({ detail }) => {
            const selected = new Set(detail.selectedOptions.map(({ value }) => value));
            onChange({ ...draft, operations: operations.filter((operation) => selected.has(operation)) });
          }}
        />
      </FormField>
    </>
  );
}
