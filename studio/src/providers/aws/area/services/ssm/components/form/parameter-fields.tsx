import type { ParameterMetadata, ParameterType } from '@aws-sdk/client-ssm';
import Container from '@cloudscape-design/components/container';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import Input from '@cloudscape-design/components/input';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import Select from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Textarea from '@cloudscape-design/components/textarea';

import { DocumentField } from '../../../../components/document-field';
import { ValueText } from '../../../../components/value-text';
import type { ParameterDraft } from './parameter-draft';

const TYPES: ParameterType[] = ['String', 'StringList', 'SecureString'];
const TIERS = ['Standard', 'Advanced'] as const;

export interface ParameterErrors {
  name?: string;
  value?: string;
  policies?: string;
}

export function ParameterFields({
  draft,
  metadata,
  errors,
  disabled,
  onChange,
}: {
  draft: ParameterDraft;
  metadata?: ParameterMetadata | undefined;
  errors: ParameterErrors;
  disabled: boolean;
  onChange: <Field extends keyof ParameterDraft>(field: Field, value: ParameterDraft[Field]) => void;
}) {
  const secure = draft.type === 'SecureString';
  const advanced = draft.tier === 'Advanced';
  const valueGuidance = [
    metadata && 'Enter a new value for every save. Saving creates a new version.',
    draft.type === 'StringList' && 'Enter a comma-separated list.',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <SpaceBetween size="l">
      <Container header={<Header variant="h2">Name and value</Header>}>
        <SpaceBetween size="m">
          {metadata === undefined ? (
            <>
              <FormField label="Name" errorText={errors.name}>
                <Input
                  value={draft.name}
                  onChange={({ detail }) => onChange('name', detail.value)}
                  autoComplete={false}
                  disabled={disabled}
                />
              </FormField>
              <FormField label="Type">
                <Select
                  selectedOption={{ value: draft.type, label: draft.type }}
                  options={TYPES.map((type) => ({ value: type, label: type }))}
                  onChange={({ detail }) => {
                    const type = TYPES.find((type) => type === detail.selectedOption.value);
                    if (type !== undefined) onChange('type', type);
                  }}
                  disabled={disabled}
                />
              </FormField>
            </>
          ) : (
            <KeyValuePairs
              columns={2}
              items={[
                { label: 'Name', value: <ValueText kind="name" value={draft.name} /> },
                { label: 'Type', value: metadata.Type ?? '-' },
                { label: 'Tier', value: metadata.Tier ?? '-' },
                { label: 'Data type', value: metadata.DataType ?? '-' },
                ...(secure
                  ? [{ label: 'KMS key ID', value: <ValueText kind="name" value={metadata.KeyId} none="-" /> }]
                  : []),
              ]}
            />
          )}
          {metadata === undefined && secure && (
            <FormField label="KMS key ID" description="Optional. Leave blank to use the default key.">
              <Input
                value={draft.keyId}
                onChange={({ detail }) => onChange('keyId', detail.value)}
                disabled={disabled}
              />
            </FormField>
          )}
          <FormField
            label={metadata === undefined ? 'Value' : 'New value'}
            description={valueGuidance || undefined}
            errorText={errors.value}
          >
            <Textarea
              value={draft.value}
              onChange={({ detail }) => onChange('value', detail.value)}
              autoComplete={false}
              spellcheck={false}
              disabled={disabled}
            />
          </FormField>
        </SpaceBetween>
      </Container>
      <Container header={<Header variant="h2">Parameter settings</Header>}>
        <SpaceBetween size="m">
          {metadata === undefined && (
            <FormField label="Tier" description="Choose Advanced to configure parameter policies.">
              <Select
                selectedOption={{ value: draft.tier, label: draft.tier }}
                options={TIERS.map((tier) => ({ value: tier, label: tier }))}
                onChange={({ detail }) => {
                  const tier = TIERS.find((tier) => tier === detail.selectedOption.value);
                  if (tier !== undefined) onChange('tier', tier);
                }}
                disabled={disabled}
              />
            </FormField>
          )}
          <FormField label="Description" constraintText="Optional">
            <Textarea
              value={draft.description}
              onChange={({ detail }) => onChange('description', detail.value)}
              disabled={disabled}
            />
          </FormField>
          <FormField
            label="Allowed pattern"
            description="Optional. Enter a regular expression that the value must match."
          >
            <Input
              value={draft.pattern}
              onChange={({ detail }) => onChange('pattern', detail.value)}
              disabled={disabled}
            />
          </FormField>
          {advanced && (
            <DocumentField
              label="Parameter policies"
              description="Optional. Enter a JSON array of policy objects."
              value={draft.policies}
              errorText={errors.policies}
              onChange={(policies) => onChange('policies', policies)}
              disabled={disabled}
              rows={8}
            />
          )}
        </SpaceBetween>
      </Container>
    </SpaceBetween>
  );
}
