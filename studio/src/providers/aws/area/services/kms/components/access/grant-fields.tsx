import { GrantOperation } from '@aws-sdk/client-kms';
import FormField from '@cloudscape-design/components/form-field';
import Input from '@cloudscape-design/components/input';
import Multiselect from '@cloudscape-design/components/multiselect';

const operationGroups: Record<GrantOperation, string> = {
  Encrypt: 'Encrypt and decrypt data',
  Decrypt: 'Encrypt and decrypt data',
  ReEncryptFrom: 'Encrypt and decrypt data',
  ReEncryptTo: 'Encrypt and decrypt data',
  GenerateDataKey: 'Generate data keys',
  GenerateDataKeyWithoutPlaintext: 'Generate data keys',
  GenerateDataKeyPair: 'Generate data keys',
  GenerateDataKeyPairWithoutPlaintext: 'Generate data keys',
  Sign: 'Sign and verify',
  Verify: 'Sign and verify',
  GenerateMac: 'Generate and verify MACs',
  VerifyMac: 'Generate and verify MACs',
  Encapsulate: 'Establish shared secrets',
  Decapsulate: 'Establish shared secrets',
  DeriveSharedSecret: 'Establish shared secrets',
  GetPublicKey: 'Read key information',
  DescribeKey: 'Read key information',
  CreateGrant: 'Manage grants',
  RetireGrant: 'Manage grants',
};
const operationDescriptions: Partial<Record<GrantOperation, string>> = {
  ReEncryptFrom: 'Use this key as the source key for re-encryption.',
  ReEncryptTo: 'Use this key as the destination key for re-encryption.',
};
const operations = Object.values(GrantOperation);
const options = operations.map((operation) => {
  const description = operationDescriptions[operation];
  return { label: operation, value: operation, ...(description === undefined ? {} : { description }) };
});
const groupedOptions = Array.from(new Set(Object.values(operationGroups)), (label) => ({
  label,
  options: options.filter(({ value }) => operationGroups[value] === label),
}));

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
      <FormField label="Grantee principal ARN" constraintText="Example: arn:aws:iam::123456789012:role/app" stretch>
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
          options={groupedOptions}
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
