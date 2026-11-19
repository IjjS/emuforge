import Autosuggest, { type AutosuggestProps } from '@cloudscape-design/components/autosuggest';
import Checkbox from '@cloudscape-design/components/checkbox';
import Container from '@cloudscape-design/components/container';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import Input, { type InputProps } from '@cloudscape-design/components/input';
import RadioGroup from '@cloudscape-design/components/radio-group';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Textarea, { type TextareaProps } from '@cloudscape-design/components/textarea';
import Tiles from '@cloudscape-design/components/tiles';
import type { ReactNode, RefObject } from 'react';

import type { EntityType, Messages, TrustedEntityValues } from './create-role-rules';

// Step 1 of "Create role", "Select trusted entity" (issue 82, requirement R6.3, R9.4): the section "Trusted entity
// type" and the fields of the type chosen, in the user guide's words; the help under the fields in EmuForge's.

/** The suggestions of "Service or use case": a fixed list of principals in Studio (R6.3). */
const SERVICE_PRINCIPALS = [
  'ec2.amazonaws.com',
  'lambda.amazonaws.com',
  'ecs-tasks.amazonaws.com',
  'states.amazonaws.com',
  'events.amazonaws.com',
  'apigateway.amazonaws.com',
  'cloudformation.amazonaws.com',
] as const;

const SERVICE_OPTIONS: AutosuggestProps.Options = SERVICE_PRINCIPALS.map((value) => ({ value }));

const ENTITY_TYPES: readonly { value: EntityType; label: string }[] = [
  { value: 'aws-service', label: 'AWS service' },
  { value: 'aws-account', label: 'AWS account' },
  { value: 'custom', label: 'Custom trust policy' },
];

/** The description of "Service or use case" (issue 492, R5): help about the emulator, not a rule the form keeps. */
const SERVICE_HELP =
  'Enter the principal of the service that may assume the role, written as a host name. The emulator accepts one that names no service.';
const CUSTOM_HELP = 'The emulator refuses a document that is not JSON or has no statement list.';
/** The constraint text of "Account ID" (issue 467, requirement R4): the form's own rule, narrower than the emulator's. */
export const ACCOUNT_ID_RULE = '12 digits.';

export interface TrustedEntityStepProps {
  values: TrustedEntityValues;
  onChange: (change: Partial<TrustedEntityValues>) => void;
  /** The account choice in force ("Another AWS account" while "This account" is unavailable). */
  accountChoice: TrustedEntityValues['account'];
  /** "This account" cannot be chosen. */
  thisAccountDisabled: boolean;
  /** Why "This account" could not be read, under the choice (R6.3, R10.3). */
  thisAccountFailure: ReactNode;
  /** The messages shown. */
  messages: Messages;
  /** The fields of step 1 that focus can be moved to. */
  principalRef: RefObject<AutosuggestProps.Ref | null>;
  accountIdRef: RefObject<InputProps.Ref | null>;
  externalIdRef: RefObject<InputProps.Ref | null>;
  documentRef: RefObject<TextareaProps.Ref | null>;
}

/** Step 1's content: the type, then the fields of that type. */
export function TrustedEntityStep({
  values,
  onChange,
  accountChoice,
  thisAccountDisabled,
  thisAccountFailure,
  messages,
  principalRef,
  accountIdRef,
  externalIdRef,
  documentRef,
}: TrustedEntityStepProps) {
  return (
    <SpaceBetween size="l">
      <Container header={<Header variant="h2">Trusted entity type</Header>}>
        <SpaceBetween size="l">
          <Tiles
            ariaLabel="Trusted entity type"
            value={values.type}
            items={ENTITY_TYPES.map(({ value, label }) => ({ value, label }))}
            onChange={({ detail }) => {
              onChange({ type: detail.value as EntityType });
            }}
          />
          {values.type === 'aws-service' && (
            <FormField label="Service or use case" description={SERVICE_HELP} errorText={messages.principal}>
              <Autosuggest
                ref={principalRef}
                value={values.principal}
                options={SERVICE_OPTIONS}
                enteredTextLabel={(text) => `Use: "${text}"`}
                clearAriaLabel="Clear"
                onChange={({ detail }) => {
                  onChange({ principal: detail.value });
                }}
              />
            </FormField>
          )}
          {values.type === 'aws-account' && (
            <SpaceBetween size="m">
              <RadioGroup
                ariaLabel="AWS account"
                value={accountChoice}
                items={[
                  {
                    value: 'this',
                    label: 'This account',
                    disabled: thisAccountDisabled,
                    ...(thisAccountFailure !== undefined && { description: thisAccountFailure }),
                  },
                  { value: 'another', label: 'Another AWS account' },
                ]}
                onChange={({ detail }) => {
                  onChange({ account: detail.value === 'another' ? 'another' : 'this' });
                }}
              />
              {accountChoice === 'another' && (
                <FormField label="Account ID" constraintText={ACCOUNT_ID_RULE} errorText={messages.accountId}>
                  <Input
                    ref={accountIdRef}
                    value={values.accountId}
                    inputMode="numeric"
                    onChange={({ detail }) => {
                      onChange({ accountId: detail.value });
                    }}
                  />
                </FormField>
              )}
              <Checkbox
                checked={values.requireExternalId}
                onChange={({ detail }) => {
                  onChange({ requireExternalId: detail.checked });
                }}
              >
                Require external ID
              </Checkbox>
              {values.requireExternalId && (
                <FormField label="External ID" errorText={messages.externalId}>
                  <Input
                    ref={externalIdRef}
                    value={values.externalId}
                    onChange={({ detail }) => {
                      onChange({ externalId: detail.value });
                    }}
                  />
                </FormField>
              )}
              <Checkbox
                checked={values.requireMfa}
                onChange={({ detail }) => {
                  onChange({ requireMfa: detail.checked });
                }}
              >
                Require MFA
              </Checkbox>
            </SpaceBetween>
          )}
        </SpaceBetween>
      </Container>
      {values.type === 'custom' && (
        <Container header={<Header variant="h2">Custom trust policy</Header>}>
          <FormField stretch constraintText={CUSTOM_HELP} errorText={messages.document}>
            <Textarea
              ref={documentRef}
              ariaLabel="Custom trust policy"
              value={values.document}
              rows={10}
              spellcheck={false}
              onChange={({ detail }) => {
                onChange({ document: detail.value });
              }}
            />
          </FormField>
        </Container>
      )}
    </SpaceBetween>
  );
}
