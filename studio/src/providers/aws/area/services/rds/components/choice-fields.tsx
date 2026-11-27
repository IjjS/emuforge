import type { OrderableDBInstanceOption } from '@aws-sdk/client-rds';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Checkbox from '@cloudscape-design/components/checkbox';
import FormField from '@cloudscape-design/components/form-field';
import Input, { type InputProps } from '@cloudscape-design/components/input';
import Link from '@cloudscape-design/components/link';
import Multiselect from '@cloudscape-design/components/multiselect';
import Select, { type SelectProps } from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import { useState, type Ref } from 'react';

import type { RequestFailure } from '../../../../../../lib/aws/request';
import { ChoiceSelect, optional } from '../../../components/choice-select';
import type { AreaConnection } from '../../../components/emulator-line';
import { readFailureState } from '../../../components/failure-states';
import { kmsKeyChoices, type KmsKeyChoice } from '../../../components/kms-key-choices';
import type { ZonesRead } from '../../../components/use-availability-zones';
import { useFollow } from '../../../components/use-follow';
import type { UpgradeTarget } from '../choices-api';
import { useUpgradeTargets, type ChoiceRead } from '../choices-queries';
import { iopsConstraint, requiresIops } from '../form';
import { NOT_IN_LIST } from '../modify-draft';
import { instanceClasses, storageTypes, type StorageTypeChoice } from '../orderable';

type RowsRead = ChoiceRead<OrderableDBInstanceOption[]>;

function FieldReadFailure({
  connection,
  thing,
  failure,
  retry,
}: {
  connection: AreaConnection;
  thing: string;
  failure: RequestFailure;
  retry: () => void;
}) {
  const handleFollow = useFollow();
  const state = readFailureState(failure, connection, thing);
  const detail =
    failure.kind === 'not-implemented'
      ? `The emulator answered 501 Not Implemented for ${failure.operation}.`
      : state.detail;
  return (
    <SpaceBetween size="xxs">
      <StatusIndicator type={state.type}>{state.first}</StatusIndicator>
      {detail !== undefined && <Box variant="p">{detail}</Box>}
      {state.recovery && (
        <Link href="/" onFollow={handleFollow}>
          Connection status
        </Link>
      )}
      {failure.kind !== 'not-implemented' && (
        <Button variant="inline-link" formAction="none" onClick={retry}>
          Retry
        </Button>
      )}
    </SpaceBetween>
  );
}

export function FieldReadStatus({
  connection,
  thing,
  failure,
  retry,
  loading,
}: {
  connection: AreaConnection;
  thing: string;
  failure?: RequestFailure | undefined;
  retry: () => void;
  loading?: boolean | undefined;
}) {
  if (failure !== undefined) {
    return <FieldReadFailure connection={connection} thing={thing} failure={failure} retry={retry} />;
  }
  return loading === true ? <StatusIndicator type="loading">Checking {thing}</StatusIndicator> : null;
}

interface ListedFieldProps {
  connection: AreaConnection;
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  error?: string | undefined;
  missing?: boolean | undefined;
  selectRef?: Ref<SelectProps.Ref> | undefined;
}

function selectedOption(
  options: readonly SelectProps.Option[],
  value: string | undefined,
  missing = false,
): SelectProps.Option | null {
  const found = options.find((option) => option.value === value);
  if (found !== undefined) return found;
  if (value === undefined) return null;

  return { value, label: value, ...(missing ? { description: NOT_IN_LIST } : {}) };
}

interface OrderableFieldProps extends ListedFieldProps {
  rows: RowsRead;
  defaultFailure?: RequestFailure | undefined;
  retryDefault?: (() => void) | undefined;
  defaultLoading?: boolean | undefined;
}

export function InstanceClassField({
  engine,
  version,
  rows,
  defaultFailure,
  defaultLoading,
  retryDefault,
  connection,
  value,
  onChange,
  error,
  missing,
  selectRef,
}: OrderableFieldProps & { engine: string; version: string | undefined }) {
  const label = 'DB instance class';
  const failure = defaultFailure ?? rows.failure;
  const options = instanceClasses(failure === undefined ? (rows.data ?? []) : []).map((choice) => ({
    value: choice.name,
    label: choice.name,
    ...optional({
      description:
        choice.storageTypes.length > 0
          ? `Storage: ${choice.storageTypes.map(({ type }) => type).join(', ')}`
          : undefined,
    }),
  }));

  return (
    <FormField label={label} errorText={error}>
      <SpaceBetween size="xs">
        <Select
          ref={selectRef}
          ariaLabel={label}
          options={options}
          selectedOption={selectedOption(options, value, missing)}
          triggerVariant="option"
          placeholder="Choose a class"
          filteringType="auto"
          filteringAriaLabel="Find DB instance classes"
          empty={
            version === undefined ? 'No DB instance classes' : `The emulator lists no class for ${engine} ${version}.`
          }
          invalid={error !== undefined}
          disabled={rows.data === undefined || failure !== undefined}
          onChange={({ detail }) => onChange(detail.selectedOption.value)}
        />
        <FieldReadStatus
          connection={connection}
          thing={label}
          failure={failure}
          loading={defaultLoading === true || rows.loading}
          retry={defaultFailure === undefined ? rows.retry : (retryDefault ?? rows.retry)}
        />
      </SpaceBetween>
    </FormField>
  );
}

const FIXED_STORAGE = '';
function storageOption(choice: StorageTypeChoice, cluster: boolean): SelectProps.Option {
  const size =
    choice.minSize === undefined || choice.maxSize === undefined
      ? undefined
      : `${choice.minSize} to ${choice.maxSize} GiB`;
  const iops =
    cluster || choice.minIops === undefined || choice.maxIops === undefined
      ? undefined
      : `${choice.minIops} to ${choice.maxIops} IOPS`;
  const description = [size, iops].filter(Boolean).join(', ');
  return { value: choice.type, label: choice.type, ...optional({ description: description || undefined }) };
}

export function StorageTypeField({
  instanceClass,
  mode,
  rows,
  defaultFailure,
  defaultLoading,
  retryDefault,
  connection,
  value,
  onChange,
  error,
  missing,
  selectRef,
}: OrderableFieldProps & {
  instanceClass?: string | undefined;
  mode: 'instance-create' | 'instance-modify' | 'cluster-create' | 'cluster-modify';
}) {
  const label = 'Storage type';
  const cluster = mode === 'cluster-create' || mode === 'cluster-modify';
  const locked = !cluster && instanceClass === undefined;
  const failure = defaultFailure ?? rows.failure;
  const available = failure === undefined ? (rows.data ?? []) : [];
  const types = storageTypes(cluster ? available : available.filter((row) => row.DBInstanceClass === instanceClass));
  const options = types.map((choice) => storageOption(choice, cluster));
  const fixed =
    mode === 'instance-modify'
      ? undefined
      : {
          value: FIXED_STORAGE,
          label: mode === 'cluster-modify' ? 'Not set' : 'Chosen by the emulator',
          description:
            mode === 'cluster-modify'
              ? 'The cluster has no storage type.'
              : cluster
                ? 'The emulator records no storage type for the cluster.'
                : 'The emulator creates gp2 storage.',
        };
  const choices = fixed === undefined ? options : [fixed, ...options];
  const chosen = value === undefined && error === undefined ? (fixed ?? null) : selectedOption(options, value, missing);
  const fixedDescription = !locked && chosen === fixed ? fixed.description : undefined;

  return (
    <FormField label={label} description={fixedDescription} errorText={error}>
      <SpaceBetween size="xs">
        <Select
          ref={selectRef}
          ariaLabel={label}
          options={choices}
          selectedOption={locked ? null : chosen}
          triggerVariant={fixedDescription === undefined ? 'option' : 'label'}
          placeholder={locked ? 'Choose DB instance class first' : 'Choose a storage type'}
          disabled={locked || (!cluster && rows.data === undefined)}
          invalid={error !== undefined}
          onChange={({ detail }) =>
            onChange(detail.selectedOption.value === FIXED_STORAGE ? undefined : detail.selectedOption.value)
          }
        />
        {cluster && (
          <FieldReadStatus
            connection={connection}
            thing={label}
            failure={failure}
            loading={defaultLoading === true || rows.loading}
            retry={defaultFailure === undefined ? rows.retry : (retryDefault ?? rows.retry)}
          />
        )}
      </SpaceBetween>
    </FormField>
  );
}

export function UpgradeVersionField({
  connection,
  engine,
  version,
  value,
  onChange,
}: {
  connection: AreaConnection;
  engine: string;
  version: string;
  value: UpgradeTarget | undefined;
  onChange: (choice: UpgradeTarget | undefined) => void;
}) {
  const [opened, setOpened] = useState(false);
  const read = useUpgradeTargets(connection.engineOrigin, engine, version, opened);
  const keep = { value: '', label: `Keep ${version}`, description: 'No version is sent.' };
  const options = (read.data ?? []).map((target) => ({
    value: target.version,
    label: target.version,
    description: target.major ? 'Major upgrade' : 'Minor upgrade',
  }));

  return (
    <FormField label="Engine version">
      <SpaceBetween size="xs">
        <Select
          ariaLabel="Engine version"
          options={[keep, ...options]}
          selectedOption={value === undefined ? keep : selectedOption(options, value.version)}
          triggerVariant="option"
          statusType={read.loading ? 'loading' : 'finished'}
          loadingText="Checking engine versions"
          onLoadItems={() => setOpened(true)}
          onChange={({ detail }) => {
            onChange(read.data?.find((target) => target.version === detail.selectedOption.value));
          }}
        />
        <FieldReadStatus connection={connection} thing="engine versions" failure={read.failure} retry={read.retry} />
      </SpaceBetween>
    </FormField>
  );
}

export function IopsField({
  storageType,
  value,
  onChange,
  error,
  inputRef,
}: {
  storageType: StorageTypeChoice | undefined;
  value: string;
  onChange: (value: string) => void;
  error?: string | undefined;
  inputRef?: Ref<InputProps.Ref> | undefined;
}) {
  if (storageType === undefined || !requiresIops(storageType.type)) return null;

  return (
    <FormField label="Provisioned IOPS" constraintText={iopsConstraint(storageType)} errorText={error}>
      <Input
        ref={inputRef}
        value={value}
        invalid={error !== undefined}
        inputMode="numeric"
        onChange={({ detail }) => onChange(detail.value)}
      />
    </FormField>
  );
}

interface ZoneProps {
  connection: AreaConnection;
  zones: readonly string[] | undefined;
  zoneRead: ZonesRead;
  placement?: Pick<ChoiceRead<unknown>, 'failure' | 'retry'> | undefined;
}

function zoneOptions(zones: ZoneProps['zones'], zoneRead: ZonesRead): SelectProps.Option[] {
  const byName = new Map(
    zoneRead.failure === undefined ? zoneRead.zoneDetails?.map((zone) => [zone.name, zone.id]) : [],
  );
  return (zones ?? []).map((zone) => ({ value: zone, label: zone, ...optional({ description: byName.get(zone) }) }));
}

function ZonesStatus({ connection, zoneRead, placement }: ZoneProps) {
  return (
    <FieldReadStatus
      connection={connection}
      thing="Availability Zones"
      failure={placement?.failure ?? zoneRead.failure}
      retry={placement?.failure === undefined ? zoneRead.retry : placement.retry}
    />
  );
}

const NO_ZONE = {
  value: '',
  label: 'No preference',
  description: "No zone is sent. The emulator reports a zone of its own, which may be none of the subnet group's.",
};

export function ZoneField({
  value,
  onChange,
  disabled = false,
  ...props
}: ZoneProps & {
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  disabled?: boolean;
}) {
  const label = 'Availability Zone';
  const options = props.placement?.failure === undefined ? zoneOptions(props.zones, props.zoneRead) : [];
  const noPreference = disabled || value === undefined;
  return (
    <FormField label={label} description={noPreference ? NO_ZONE.description : undefined}>
      <SpaceBetween size="xs">
        <Select
          ariaLabel={label}
          disabled={disabled}
          options={[NO_ZONE, ...options]}
          selectedOption={noPreference ? NO_ZONE : selectedOption(options, value)}
          triggerVariant={noPreference ? 'label' : 'option'}
          onChange={({ detail }) => onChange(detail.selectedOption.value || undefined)}
        />
        <ZonesStatus {...props} />
      </SpaceBetween>
    </FormField>
  );
}

export function ZonesField({
  value,
  onChange,
  ...props
}: ZoneProps & { value: readonly string[]; onChange: (value: string[]) => void }) {
  const label = 'Availability Zones';
  const options = props.placement?.failure === undefined ? zoneOptions(props.zones, props.zoneRead) : [];
  return (
    <FormField label={label}>
      <SpaceBetween size="xs">
        <Multiselect
          ariaLabel={label}
          options={options}
          selectedOptions={value.map((zone) => selectedOption(options, zone) ?? { value: zone, label: zone })}
          placeholder="Choose Availability Zones"
          empty="No Availability Zones"
          deselectAriaLabel={(option) => `Remove ${option.label ?? ''}`}
          onChange={({ detail }) => onChange(detail.selectedOptions.flatMap((option) => option.value ?? []))}
        />
        <ZonesStatus {...props} />
      </SpaceBetween>
    </FormField>
  );
}

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
}

function Toggle({ checked, onChange, label, description }: ToggleProps & { label: string; description: string }) {
  return (
    <Checkbox checked={checked} description={description} onChange={({ detail }) => onChange(detail.checked)}>
      {label}
    </Checkbox>
  );
}

export function MultiAzField(props: ToggleProps) {
  return (
    <Toggle
      {...props}
      label="Multi-AZ"
      description="The emulator reports a second zone for the instance. A zone cannot be chosen with it."
    />
  );
}

export function EncryptStorageField(props: ToggleProps) {
  return (
    <Toggle
      {...props}
      label="Encrypt storage"
      description="The emulator records the storage as encrypted with the chosen key."
    />
  );
}

export function DeletionProtectionField({ cluster, ...props }: ToggleProps & { cluster?: boolean }) {
  return (
    <Toggle
      {...props}
      label="Deletion protection"
      description={`While it is on, the emulator refuses to delete the DB ${cluster === true ? 'cluster' : 'instance'}.`}
    />
  );
}

export function KeyField({
  connection,
  encrypted,
  restore = false,
  value,
  onChange,
  missing = false,
}: {
  connection: AreaConnection;
  encrypted: boolean;
  restore?: boolean;
  value: KmsKeyChoice | undefined;
  onChange: (choice: KmsKeyChoice | undefined) => void;
  missing?: boolean;
}) {
  if (!encrypted) return null;

  const source = kmsKeyChoices(connection.engineOrigin);
  return (
    <FormField label="KMS key">
      <ChoiceSelect
        source={{
          ...source,
          optionOf: (choice) => {
            const option = source.optionOf(choice);
            return missing && choice === value ? { ...option, description: NOT_IN_LIST } : option;
          },
        }}
        connection={connection}
        things="KMS keys"
        fixed={restore ? "Keep the snapshot's encryption" : 'Chosen by the emulator'}
        fixedDescription={
          restore ? 'No key is sent.' : 'No key is sent. The emulator uses the key of its alias alias/aws/rds.'
        }
        triggerVariant="option"
        value={value}
        onChange={onChange}
      />
    </FormField>
  );
}
