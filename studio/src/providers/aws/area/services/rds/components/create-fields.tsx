import Checkbox from '@cloudscape-design/components/checkbox';
import FormField from '@cloudscape-design/components/form-field';
import Input, { type InputProps } from '@cloudscape-design/components/input';
import RadioGroup from '@cloudscape-design/components/radio-group';
import { useState, type Ref } from 'react';
import SpaceBetween from '@cloudscape-design/components/space-between';

import { ChoiceMultiselect } from '../../../components/choice-multiselect';
import { ChoiceSelect, optional } from '../../../components/choice-select';
import type { AreaConnection } from '../../../components/emulator-line';
import type { SecurityGroupChoice } from '../../../components/security-group-choices';
import type { EngineVersionChoice, SubnetGroupChoice } from '../choices-api';
import {
  engineVersionChoices,
  groupChoices,
  subnetGroupChoices,
  type ChoiceRead,
  type DefaultVersions,
} from '../choices-queries';
import {
  DATABASE_NAME_CONSTRAINT,
  IDENTIFIER_CONSTRAINT,
  masterUserNameConstraint,
  PASSWORD_CONSTRAINT,
  passwordDescription,
  storageConstraint,
} from '../form';
import { NOT_IN_LIST } from '../modify-draft';
import type { StorageTypeChoice } from '../orderable';
import { FieldReadStatus } from './choice-fields';

// The fields of RDS's two create forms (issue 573, design tasks 2 and 4), each a Cloudscape `FormField` with its label
// and, from the start, its constraint text or description (`aws-area.md`, entry 2); a failed check's message is shown
// at its field with the constraint text beside it. The three lists are the area's paged choice fields, each read a
// page at a time when it opens, with its own loading, empty and failed states inside the field. Each field is given
// its value and hands back what is entered; what is entered lives in the page that holds the form.

interface TextFieldProps {
  value: string;
  error?: string | undefined;
  onChange: (value: string) => void;
  inputRef?: Ref<InputProps.Ref> | undefined;
}

function TextInput({
  value,
  error,
  onChange,
  inputRef,
  type,
  inputMode,
}: TextFieldProps & { type?: InputProps['type']; inputMode?: InputProps['inputMode'] }) {
  return (
    <Input
      ref={inputRef}
      value={value}
      invalid={error !== undefined}
      autoComplete={false}
      spellcheck={false}
      {...(type === undefined ? {} : { type })}
      {...(inputMode === undefined ? {} : { inputMode })}
      onChange={({ detail }) => {
        onChange(detail.value);
      }}
    />
  );
}

/** The identifier of what is created: "DB instance identifier", "DB cluster identifier". */
export function IdentifierField({ label, ...props }: TextFieldProps & { label: string }) {
  return (
    <FormField label={label} constraintText={IDENTIFIER_CONSTRAINT} errorText={props.error}>
      <TextInput {...props} />
    </FormField>
  );
}

/** An engine of the form, as the API names it, with its label. */
export interface EngineOption {
  value: string;
  label: string;
}

const ENGINE_DESCRIPTIONS: Readonly<Record<string, string>> = {
  postgres: 'PostgreSQL.',
  mysql: 'MySQL.',
  mariadb: 'MariaDB.',
  'aurora-postgresql': 'Aurora, PostgreSQL-compatible.',
  'aurora-mysql': 'Aurora, MySQL-compatible.',
};

/** "Engine": one of the form's engines. */
export function EngineField({
  engines,
  value,
  onChange,
  defaults,
  connection,
}: {
  engines: readonly EngineOption[];
  value: string;
  onChange: (engine: string) => void;
  defaults?: ChoiceRead<DefaultVersions> | undefined;
  connection?: AreaConnection;
}) {
  const failure = defaults?.failure ?? Object.values(defaults?.data?.failures ?? {}).find(Boolean);
  return (
    <FormField label="Engine">
      <SpaceBetween size="xs">
        <RadioGroup
          value={value}
          items={engines.map((engine) => {
            const version = defaults?.data?.versions[engine.value];
            const name = ENGINE_DESCRIPTIONS[engine.value] ?? `${engine.label}.`;
            const description = version === undefined ? name : `${name} The emulator's default version is ${version}.`;
            return { value: engine.value, label: engine.label, ...optional({ description: defaults && description }) };
          })}
          onChange={({ detail }) => {
            onChange(detail.value);
          }}
        />
        {defaults !== undefined && connection !== undefined && (
          <FieldReadStatus
            connection={connection}
            thing="default engine versions"
            failure={failure}
            retry={defaults.retry}
          />
        )}
      </SpaceBetween>
    </FormField>
  );
}

/** "Engine version - optional": "The emulator's default" at start and above the versions of `engine`. */
export function EngineVersionField({
  engine,
  connection,
  value,
  onChange,
  defaultVersion,
}: {
  engine: string;
  defaultVersion?: string | undefined;
  connection: AreaConnection;
  value: EngineVersionChoice | undefined;
  onChange: (version: EngineVersionChoice | undefined) => void;
}) {
  return (
    <FormField label="Engine version - optional">
      {/* Another engine is another list, read when the field is next opened. */}
      <ChoiceSelect<EngineVersionChoice>
        key={engine}
        source={engineVersionChoices(connection.engineOrigin, engine)}
        connection={connection}
        things="engine versions"
        fixed="The emulator's default"
        fixedDescription={
          defaultVersion === undefined
            ? 'The emulator uses its default version when none is sent.'
            : `${defaultVersion}, the version the emulator creates when none is sent.`
        }
        value={value}
        onChange={onChange}
      />
    </FormField>
  );
}

/** "Allocated storage (GiB)", a whole number as typed. */
export function StorageField({
  storageType,
  implied,
  ...props
}: TextFieldProps & { storageType?: StorageTypeChoice | undefined; implied?: StorageTypeChoice | undefined }) {
  return (
    <FormField
      label="Allocated storage (GiB)"
      constraintText={storageConstraint(storageType, implied)}
      errorText={props.error}
    >
      <TextInput {...props} inputMode="numeric" />
    </FormField>
  );
}

/** "Master user name", its limit the engine's. */
export function MasterUserNameField({ engine, ...props }: TextFieldProps & { engine: string }) {
  return (
    <FormField label="Master user name" constraintText={masterUserNameConstraint(engine)} errorText={props.error}>
      <TextInput {...props} />
    </FormField>
  );
}

/**
 * "Master password", typed into a password field; its description names what is created ("the DB instance", "the DB
 * cluster"). "Show password" under it switches the field to text and back, so what is typed can be checked before it is
 * noted; the choice is this field's own state, a password field at start on every form, and stored nowhere. The value
 * is the form's alone and is never shown again once the form is left.
 */
export function MasterPasswordField({ what, ...props }: TextFieldProps & { what: string }) {
  const [shown, setShown] = useState(false);
  return (
    <FormField
      label="Master password"
      description={passwordDescription(what)}
      constraintText={PASSWORD_CONSTRAINT}
      errorText={props.error}
    >
      <SpaceBetween size="xs">
        <TextInput {...props} type={shown ? 'text' : 'password'} />
        <Checkbox
          checked={shown}
          onChange={({ detail }) => {
            setShown(detail.checked);
          }}
        >
          Show password
        </Checkbox>
      </SpaceBetween>
    </FormField>
  );
}

/** "Database name - optional". */
export function DatabaseNameField(props: TextFieldProps) {
  return (
    <FormField label="Database name - optional" constraintText={DATABASE_NAME_CONSTRAINT} errorText={props.error}>
      <TextInput {...props} />
    </FormField>
  );
}

export function SubnetGroupField({
  connection,
  value,
  onChange,
  mode,
  missing,
  error,
}: {
  connection: AreaConnection;
  value: SubnetGroupChoice | undefined;
  onChange: (group: SubnetGroupChoice | undefined) => void;
  mode?: 'instance' | 'cluster' | 'modify';
  missing?: boolean | undefined;
  error?: string | undefined;
}) {
  const source = subnetGroupChoices(connection.engineOrigin);
  const description =
    mode === undefined || mode === 'modify'
      ? undefined
      : `The emulator puts the ${mode} in its subnet group named default.`;

  return (
    <FormField label={mode === 'modify' ? 'DB subnet group' : 'DB subnet group - optional'} errorText={error}>
      <ChoiceSelect<SubnetGroupChoice>
        source={{
          ...source,
          optionOf: (choice) => {
            const option = source.optionOf(choice);
            return missing === true && choice === value ? { ...option, description: NOT_IN_LIST } : option;
          },
        }}
        connection={connection}
        things="DB subnet groups"
        fixed={mode === 'modify' ? undefined : 'Chosen by the emulator'}
        fixedDescription={description}
        triggerVariant={missing === true ? 'option' : undefined}
        invalid={error !== undefined}
        value={value}
        onChange={onChange}
      />
    </FormField>
  );
}

/** With placement supplied, the source and the selection are restricted to the subnet group's VPC. */
export function SecurityGroupsField({
  connection,
  value,
  onChange,
  placement,
  required,
  error,
  missingIds,
}: {
  connection: AreaConnection;
  value: readonly SecurityGroupChoice[];
  onChange: (groups: SecurityGroupChoice[]) => void;
  placement?:
    | (Pick<ChoiceRead<string | null>, 'data' | 'failure' | 'retry'> &
        Partial<Pick<ChoiceRead<string | null>, 'loading'>>)
    | undefined;
  required?: boolean;
  error?: string | undefined;
  missingIds?: ReadonlySet<string> | undefined;
}) {
  const vpcId = placement?.data ?? undefined;
  const loading = placement?.loading === true;
  const failed = placement?.failure !== undefined;
  const source = groupChoices(connection.engineOrigin, vpcId);
  return (
    <FormField label={required === true ? 'Security groups' : 'Security groups - optional'} errorText={error}>
      <SpaceBetween size="xs">
        <fieldset disabled={failed} style={{ border: 0, margin: 0, padding: 0, minInlineSize: 0 }}>
          <ChoiceMultiselect<SecurityGroupChoice>
            source={{
              ...source,
              ready: !loading && !failed,
              optionOf: (choice) => {
                const option = source.optionOf(choice);
                return missingIds?.has(choice.id) === true ? { ...option, description: NOT_IN_LIST } : option;
              },
            }}
            connection={connection}
            things="security groups"
            placeholder="Choose security groups"
            lockedBy={
              placement !== undefined && vpcId === undefined && !loading && !failed ? 'DB subnet group' : undefined
            }
            held={loading && !failed ? "Checking the DB subnet group's VPC" : undefined}
            none={vpcId === undefined ? undefined : `No security groups in ${vpcId}`}
            invalid={error !== undefined}
            value={value}
            onChange={onChange}
          />
        </fieldset>
        {placement !== undefined && (
          <FieldReadStatus
            connection={connection}
            thing="security groups"
            failure={placement.failure}
            retry={placement.retry}
          />
        )}
      </SpaceBetween>
    </FormField>
  );
}
