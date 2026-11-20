import FormField from '@cloudscape-design/components/form-field';
import Input, { type InputProps } from '@cloudscape-design/components/input';
import RadioGroup from '@cloudscape-design/components/radio-group';
import type { Ref } from 'react';

import { ChoiceMultiselect } from '../../../components/choice-multiselect';
import { ChoiceSelect } from '../../../components/choice-select';
import type { AreaConnection } from '../../../components/emulator-line';
import type { SecurityGroupChoice } from '../../../components/security-group-choices';
import type { EngineVersionChoice, SubnetGroupChoice } from '../choices-api';
import { engineVersionChoices, groupChoices, subnetGroupChoices } from '../choices-queries';
import {
  CLASS_DESCRIPTION,
  DATABASE_NAME_CONSTRAINT,
  IDENTIFIER_CONSTRAINT,
  masterUserNameConstraint,
  PASSWORD_CONSTRAINT,
  passwordDescription,
  STORAGE_CONSTRAINT,
} from '../form';

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

/** "Engine": one of the form's engines. */
export function EngineField({
  engines,
  value,
  onChange,
}: {
  engines: readonly EngineOption[];
  value: string;
  onChange: (engine: string) => void;
}) {
  return (
    <FormField label="Engine">
      <RadioGroup
        value={value}
        items={engines.map((engine) => ({ value: engine.value, label: engine.label }))}
        onChange={({ detail }) => {
          onChange(detail.value);
        }}
      />
    </FormField>
  );
}

/** "Engine version - optional": "The emulator's default" at start and above the versions of `engine`. */
export function EngineVersionField({
  engine,
  connection,
  value,
  onChange,
}: {
  engine: string;
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
        value={value}
        onChange={onChange}
      />
    </FormField>
  );
}

/** "DB instance class", typed as the API names it. */
export function ClassField(props: TextFieldProps) {
  return (
    <FormField label="DB instance class" description={CLASS_DESCRIPTION} errorText={props.error}>
      <TextInput {...props} />
    </FormField>
  );
}

/** "Allocated storage (GiB)", a whole number as typed. */
export function StorageField(props: TextFieldProps) {
  return (
    <FormField label="Allocated storage (GiB)" constraintText={STORAGE_CONSTRAINT} errorText={props.error}>
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
 * cluster"). The value is the form's alone and is never shown again once the form is left.
 */
export function MasterPasswordField({ what, ...props }: TextFieldProps & { what: string }) {
  return (
    <FormField
      label="Master password"
      description={passwordDescription(what)}
      constraintText={PASSWORD_CONSTRAINT}
      errorText={props.error}
    >
      <TextInput {...props} type="password" />
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

/** "DB subnet group - optional": "Chosen by the emulator" at start and above the groups. */
export function SubnetGroupField({
  connection,
  value,
  onChange,
}: {
  connection: AreaConnection;
  value: SubnetGroupChoice | undefined;
  onChange: (group: SubnetGroupChoice | undefined) => void;
}) {
  return (
    <FormField label="DB subnet group - optional">
      <ChoiceSelect<SubnetGroupChoice>
        source={subnetGroupChoices(connection.engineOrigin)}
        connection={connection}
        things="DB subnet groups"
        fixed="Chosen by the emulator"
        value={value}
        onChange={onChange}
      />
    </FormField>
  );
}

/** "Security groups - optional": several of every VPC's, each removable; a typed text narrows them. */
export function SecurityGroupsField({
  connection,
  value,
  onChange,
}: {
  connection: AreaConnection;
  value: readonly SecurityGroupChoice[];
  onChange: (groups: SecurityGroupChoice[]) => void;
}) {
  return (
    <FormField label="Security groups - optional">
      <ChoiceMultiselect<SecurityGroupChoice>
        source={groupChoices(connection.engineOrigin)}
        connection={connection}
        things="security groups"
        placeholder="Choose security groups"
        value={value}
        onChange={onChange}
      />
    </FormField>
  );
}
