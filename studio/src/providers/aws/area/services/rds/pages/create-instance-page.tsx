import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import type { InputProps } from '@cloudscape-design/components/input';
import type { SelectProps } from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useCallback, useRef, useState, type RefObject } from 'react';

import type { KmsKeyChoice } from '../../../components/kms-key-choices';
import { usePageFlash } from '../../../components/page-flash';
import { useShowsResources } from '../../../components/page-resources';
import type { SecurityGroupChoice } from '../../../components/security-group-choices';
import { TagsField, type TagsFieldRef } from '../../../components/tags-field';
import { useAvailabilityZones } from '../../../components/use-availability-zones';
import { checkTagRows, type TagRow } from '../../../lib/tag-rows';
import type { ScreenPageProps } from '../../../screens';
import type { EngineVersionChoice, SubnetGroupChoice } from '../choices-api';
import { useDefaultVersions, useOrderableRows, useSubnetGroupPlacement } from '../choices-queries';
import {
  DeletionProtectionField,
  EncryptStorageField,
  KeyField,
  StorageTypeField,
  InstanceClassField,
  IopsField,
  MultiAzField,
  ZoneField,
} from '../components/choice-fields';
import {
  DatabaseNameField,
  EngineField,
  EngineVersionField,
  IdentifierField,
  MasterPasswordField,
  MasterUserNameField,
  SecurityGroupsField,
  StorageField,
  SubnetGroupField,
  type EngineOption,
} from '../components/create-fields';
import { CreateForm } from '../components/create-form';
import { CREATE_OPERATIONS, type NewInstance } from '../create-api';
import { useCreateInstance } from '../create-queries';
import {
  databaseNameError,
  identifierError,
  iopsError,
  masterUserNameError,
  passwordError,
  requiresIops,
  storageError,
} from '../form';
import { CREATE_INSTANCE_TITLE, instanceHref, INSTANCES_PATH, INSTANCES_WORD } from '../format';

import { instanceClasses, type StorageTypeChoice } from '../orderable';

/** The engines whose instance the emulator opens a database socket for. */
const ENGINES: readonly EngineOption[] = [
  { value: 'postgres', label: 'PostgreSQL' },
  { value: 'mysql', label: 'MySQL' },
  { value: 'mariadb', label: 'MariaDB' },
];

const ENGINE_IDS = ENGINES.map(({ value }) => value);

interface InstanceForm {
  identifier: string;
  engine: string;
  version: EngineVersionChoice | undefined;
  instanceClass: string | undefined;
  storage: string;
  user: string;
  password: string;
  dbName: string;
  subnetGroup: SubnetGroupChoice | undefined;
  groups: SecurityGroupChoice[];
  storageType: string | undefined;
  encrypted: boolean;
  key: KmsKeyChoice | undefined;
  deletionProtection: boolean;
  tags: TagRow[];
  zone: string | undefined;
  multiAz: boolean;
  iops: string;
}

const START: InstanceForm = {
  identifier: '',
  engine: 'postgres',
  version: undefined,
  instanceClass: 'db.t3.micro',
  storage: '20',
  user: '',
  password: '',
  dbName: '',
  subnetGroup: undefined,
  groups: [],
  storageType: undefined,
  encrypted: false,
  key: undefined,
  deletionProtection: false,
  tags: [],
  zone: undefined,
  multiAz: false,
  iops: '',
};

type Checked = 'identifier' | 'instanceClass' | 'storage' | 'iops' | 'user' | 'password' | 'dbName';

/** The fields' messages, in the order of the form. */
function messagesOf(
  form: InstanceForm,
  storageType: StorageTypeChoice | undefined,
): Record<Checked, string | undefined> {
  return {
    identifier: identifierError(form.identifier),
    instanceClass: form.instanceClass === undefined ? 'Choose a class.' : undefined,
    storage: storageError(form.storage, storageType),
    iops: iopsError(form.iops, form.storage, storageType),
    dbName: databaseNameError(form.dbName),
    user: masterUserNameError(form.user, form.engine),
    password: passwordError(form.password),
  };
}

function differs(form: InstanceForm, initialClass: string | undefined): boolean {
  return (
    form.identifier !== START.identifier ||
    form.engine !== START.engine ||
    form.version !== undefined ||
    form.instanceClass !== initialClass ||
    form.storage !== START.storage ||
    form.user !== '' ||
    form.password !== '' ||
    form.dbName !== '' ||
    form.subnetGroup !== undefined ||
    form.groups.length > 0 ||
    form.storageType !== undefined ||
    form.encrypted ||
    form.deletionProtection ||
    form.tags.length > 0 ||
    form.zone !== undefined ||
    form.multiAz ||
    form.iops !== ''
  );
}

/** What `CreateDBInstance` is sent for the form: the required values, and the optional ones given. */
function requestOf(form: InstanceForm, instanceClass: string, tags: TagRow[]): NewInstance {
  const values: NewInstance = {
    identifier: form.identifier,
    engine: form.engine,
    instanceClass,
    ...(requiresIops(form.storageType) ? { iops: Number(form.iops) } : {}),
    ...(form.multiAz ? { multiAz: true } : {}),
    ...(form.zone === undefined ? {} : { availabilityZone: form.zone }),
    allocatedStorage: Number(form.storage),
    masterUsername: form.user,
    masterPassword: form.password,
    ...(form.storageType === undefined ? {} : { storageType: form.storageType }),
    ...(form.encrypted ? { encrypted: true, ...(form.key === undefined ? {} : { kmsKeyId: form.key.arn }) } : {}),
    ...(form.deletionProtection ? { deletionProtection: true } : {}),
    ...(tags.length === 0 ? {} : { tags }),
  };
  if (form.version !== undefined) {
    values.engineVersion = form.version.version;
  }
  if (form.dbName !== '') {
    values.dbName = form.dbName;
  }
  if (form.subnetGroup !== undefined) {
    values.subnetGroupName = form.subnetGroup.name;
  }
  if (form.groups.length > 0) {
    values.securityGroupIds = form.groups.map((group) => group.id);
  }
  return values;
}

/** `/aws/rds/instances/create`. */
export function CreateInstancePage({ connection }: ScreenPageProps) {
  useShowsResources(INSTANCES_WORD);
  const flash = usePageFlash();
  const engineOrigin = connection.engineOrigin;
  const create = useCreateInstance(engineOrigin);

  const [form, setForm] = useState<InstanceForm>(START);
  const [tried, setTried] = useState(false);
  const tagsRef = useRef<TagsFieldRef>(null);
  const tags = checkTagRows(form.tags);
  const defaults = useDefaultVersions(engineOrigin, ENGINE_IDS);
  const defaultVersion = defaults.data?.versions[form.engine];
  const version = form.version?.version ?? defaultVersion;
  const rows = useOrderableRows(engineOrigin, form.engine, version);
  const defaultFailure =
    form.version === undefined ? (defaults.failure ?? defaults.data?.failures[form.engine]) : undefined;
  const defaultLoading = form.version === undefined && defaults.loading;
  const placement = useSubnetGroupPlacement(engineOrigin, form.subnetGroup, 'default', true);
  const zoneRead = useAvailabilityZones(engineOrigin);
  const groups = placement.loading
    ? form.groups
    : form.groups.filter((group) => placement.data != null && group.vpcId === placement.data);
  const [initialClass, setInitialClass] = useState<{ value: string | undefined }>();
  const classes = rows.data === undefined ? undefined : instanceClasses(rows.data);
  const selectedClass = classes?.find(({ name }) => name === form.instanceClass);
  const storageType = selectedClass?.storageTypes.find(({ type }) => type === form.storageType);
  // Keep the selections while checking a new catalogue. Only its answer can rule them out.
  const instanceClass = classes === undefined ? form.instanceClass : selectedClass?.name;
  const storage = classes === undefined ? form.storageType : storageType?.type;
  const zone =
    placement.loading || (form.zone !== undefined && placement.zones?.includes(form.zone)) ? form.zone : undefined;

  if (
    initialClass === undefined &&
    classes !== undefined &&
    form.engine === START.engine &&
    form.version === undefined
  ) {
    setInitialClass({
      value: classes.some(({ name }) => name === START.instanceClass) ? START.instanceClass : undefined,
    });
  }
  if (
    instanceClass !== form.instanceClass ||
    storage !== form.storageType ||
    groups.length !== form.groups.length ||
    zone !== form.zone
  ) {
    setForm({
      ...form,
      instanceClass,
      storageType: storage,
      iops: storage === form.storageType ? form.iops : '',
      groups,
      zone,
    });
  }

  const identifierRef = useRef<InputProps.Ref>(null);
  const instanceClassRef = useRef<SelectProps.Ref>(null);
  const iopsRef = useRef<InputProps.Ref>(null);
  const storageRef = useRef<InputProps.Ref>(null);
  const userRef = useRef<InputProps.Ref>(null);
  const passwordRef = useRef<InputProps.Ref>(null);
  const dbNameRef = useRef<InputProps.Ref>(null);

  const change = useCallback((update: Partial<InstanceForm>) => {
    setForm((current) => ({ ...current, ...update }));
  }, []);

  const messages: Partial<Record<Checked, string | undefined>> = tried ? messagesOf(form, storageType) : {};

  const check = () => {
    if (engineOrigin !== undefined && rows.data === undefined) return false;
    if (placement.loading && (form.groups.length > 0 || form.zone !== undefined)) return false;

    setTried(true);
    const found = messagesOf(form, storageType);
    const first = (Object.keys(found) as Checked[]).find((field) => found[field] !== undefined);
    if (first === undefined) {
      if (tags.firstInvalid === undefined) return true;
      tagsRef.current?.focusKey(tags.firstInvalid);
      return false;
    }
    const refs: Record<Checked, RefObject<{ focus: () => void } | null>> = {
      identifier: identifierRef,
      instanceClass: instanceClassRef,
      storage: storageRef,
      iops: iopsRef,
      user: userRef,
      password: passwordRef,
      dbName: dbNameRef,
    };
    refs[first].current?.focus();
    return false;
  };

  return (
    <CreateForm
      title={CREATE_INSTANCE_TITLE}
      operation={CREATE_OPERATIONS.createDBInstance}
      what="Creating DB instance"
      engineOrigin={engineOrigin}
      cancelTo={INSTANCES_PATH}
      differs={differs(form, initialClass === undefined ? START.instanceClass : initialClass.value)}
      check={check}
      send={(signal) => create(requestOf(form, instanceClass ?? '', tags.tags), signal)}
      onCreated={(id) => {
        flash.handOver(instanceHref(id), [{ type: 'success', content: `Creating DB instance ${id}` }]);
      }}
    >
      <Container header={<Header variant="h2">Database configuration</Header>}>
        <SpaceBetween size="l">
          <IdentifierField
            label="DB instance identifier"
            inputRef={identifierRef}
            value={form.identifier}
            error={messages.identifier}
            onChange={(identifier) => {
              change({ identifier });
            }}
          />
          <EngineField
            connection={connection}
            defaults={defaults}
            engines={ENGINES}
            value={form.engine}
            onChange={(engine) => {
              // Another engine's versions are another list: the version goes back to the emulator's default.
              change({ engine, version: undefined });
            }}
          />
          <EngineVersionField
            defaultVersion={defaultVersion}
            engine={form.engine}
            connection={connection}
            value={form.version}
            onChange={(version) => {
              change({ version });
            }}
          />
          <InstanceClassField
            connection={connection}
            engine={form.engine}
            version={version}
            rows={rows}
            defaultFailure={defaultFailure}
            defaultLoading={defaultLoading}
            retryDefault={defaults.retry}
            selectRef={instanceClassRef}
            value={
              initialClass === undefined &&
              classes === undefined &&
              form.engine === START.engine &&
              form.version === undefined
                ? undefined
                : instanceClass
            }
            error={messages.instanceClass}
            onChange={(instanceClass) => change({ instanceClass })}
          />
          <StorageTypeField
            mode="instance-create"
            connection={connection}
            rows={rows}
            instanceClass={instanceClass}
            value={form.storageType}
            onChange={(storageType) => change({ storageType, iops: '' })}
          />
          <StorageField
            storageType={storageType}
            inputRef={storageRef}
            value={form.storage}
            error={messages.storage}
            onChange={(storage) => {
              change({ storage });
            }}
          />
          <IopsField
            storageType={storageType}
            inputRef={iopsRef}
            value={form.iops}
            error={messages.iops}
            onChange={(iops) => change({ iops })}
          />
          <DatabaseNameField
            inputRef={dbNameRef}
            value={form.dbName}
            error={messages.dbName}
            onChange={(dbName) => {
              change({ dbName });
            }}
          />
        </SpaceBetween>
      </Container>
      <Container header={<Header variant="h2">Credentials</Header>}>
        <SpaceBetween size="l">
          <MasterUserNameField
            engine={form.engine}
            inputRef={userRef}
            value={form.user}
            error={messages.user}
            onChange={(user) => {
              change({ user });
            }}
          />
          <MasterPasswordField
            what="the DB instance"
            inputRef={passwordRef}
            value={form.password}
            error={messages.password}
            onChange={(password) => {
              change({ password });
            }}
          />
        </SpaceBetween>
      </Container>
      <Container header={<Header variant="h2">Connectivity</Header>}>
        <SpaceBetween size="l">
          <SubnetGroupField
            mode="instance"
            connection={connection}
            value={form.subnetGroup}
            onChange={(subnetGroup) => {
              change({ subnetGroup });
            }}
          />
          <SecurityGroupsField
            placement={placement}
            connection={connection}
            value={form.groups}
            onChange={(groups) => {
              change({ groups });
            }}
          />
          <ZoneField
            connection={connection}
            placement={placement}
            zoneRead={zoneRead}
            zones={placement.zones}
            disabled={form.multiAz || placement.failure !== undefined}
            value={form.zone}
            onChange={(zone) => change({ zone })}
          />
          <MultiAzField checked={form.multiAz} onChange={(multiAz) => change({ multiAz, zone: undefined })} />
        </SpaceBetween>
      </Container>
      <Container header={<Header variant="h2">Protection</Header>}>
        <SpaceBetween size="l">
          <EncryptStorageField
            checked={form.encrypted}
            onChange={(encrypted) => change({ encrypted, key: undefined })}
          />
          <KeyField
            connection={connection}
            encrypted={form.encrypted}
            value={form.key}
            onChange={(key) => change({ key })}
          />
          <DeletionProtectionField
            checked={form.deletionProtection}
            onChange={(deletionProtection) => change({ deletionProtection })}
          />
        </SpaceBetween>
      </Container>
      <TagsField
        ref={tagsRef}
        rows={form.tags}
        errors={tried ? tags.errors : undefined}
        onChange={(tags) => change({ tags })}
      />
    </CreateForm>
  );
}
