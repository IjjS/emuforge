import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import type { InputProps } from '@cloudscape-design/components/input';
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
  ZonesField,
} from '../components/choice-fields';
import {
  DatabaseNameField,
  EngineField,
  EngineVersionField,
  IdentifierField,
  MasterPasswordField,
  MasterUserNameField,
  SecurityGroupsField,
  SubnetGroupField,
  type EngineOption,
} from '../components/create-fields';
import { CreateForm } from '../components/create-form';
import { CREATE_OPERATIONS, type NewCluster } from '../create-api';
import { useCreateCluster } from '../create-queries';
import { databaseNameError, identifierError, masterUserNameError, passwordError } from '../form';
import { clusterHref, CLUSTERS_PATH, CLUSTERS_WORD, CREATE_CLUSTER_TITLE } from '../format';

import { storageTypes } from '../orderable';

const DESCRIPTION = "Creates the cluster alone. Add its DB instances from the cluster's page.";

const ENGINES: readonly EngineOption[] = [
  { value: 'aurora-postgresql', label: 'Aurora PostgreSQL' },
  { value: 'aurora-mysql', label: 'Aurora MySQL' },
];

const ENGINE_IDS = ENGINES.map(({ value }) => value);

interface ClusterForm {
  identifier: string;
  engine: string;
  version: EngineVersionChoice | undefined;
  user: string;
  password: string;
  databaseName: string;
  subnetGroup: SubnetGroupChoice | undefined;
  groups: SecurityGroupChoice[];
  storageType: string | undefined;
  encrypted: boolean;
  key: KmsKeyChoice | undefined;
  deletionProtection: boolean;
  tags: TagRow[];
  zones: string[];
}

const START: ClusterForm = {
  identifier: '',
  engine: 'aurora-postgresql',
  version: undefined,
  user: '',
  password: '',
  databaseName: '',
  subnetGroup: undefined,
  groups: [],
  storageType: undefined,
  encrypted: false,
  key: undefined,
  deletionProtection: false,
  tags: [],
  zones: [],
};

type Checked = 'identifier' | 'user' | 'password' | 'databaseName';

/** The fields' messages, in the order of the form. */
function messagesOf(form: ClusterForm): Record<Checked, string | undefined> {
  return {
    identifier: identifierError(form.identifier),
    databaseName: databaseNameError(form.databaseName),
    user: masterUserNameError(form.user, form.engine),
    password: passwordError(form.password),
  };
}

function differs(form: ClusterForm): boolean {
  return (
    form.identifier !== '' ||
    form.engine !== START.engine ||
    form.version !== undefined ||
    form.user !== '' ||
    form.password !== '' ||
    form.databaseName !== '' ||
    form.subnetGroup !== undefined ||
    form.groups.length > 0 ||
    form.storageType !== undefined ||
    form.encrypted ||
    form.deletionProtection ||
    form.tags.length > 0 ||
    form.zones.length > 0
  );
}

/** What `CreateDBCluster` is sent for the form: the required values, and the optional ones given. */
function requestOf(form: ClusterForm, storageType: string | undefined, tags: TagRow[]): NewCluster {
  const values: NewCluster = {
    identifier: form.identifier,
    engine: form.engine,
    masterUsername: form.user,
    masterPassword: form.password,
    ...(storageType === undefined ? {} : { storageType }),
    ...(form.zones.length === 0 ? {} : { availabilityZones: form.zones }),
    ...(form.encrypted ? { encrypted: true, ...(form.key === undefined ? {} : { kmsKeyId: form.key.arn }) } : {}),
    ...(form.deletionProtection ? { deletionProtection: true } : {}),
    ...(tags.length === 0 ? {} : { tags }),
  };
  if (form.version !== undefined) {
    values.engineVersion = form.version.version;
  }
  if (form.databaseName !== '') {
    values.databaseName = form.databaseName;
  }
  if (form.subnetGroup !== undefined) {
    values.subnetGroupName = form.subnetGroup.name;
  }
  if (form.groups.length > 0) {
    values.securityGroupIds = form.groups.map((group) => group.id);
  }
  return values;
}

/** `/aws/rds/clusters/create`. */
export function CreateClusterPage({ connection }: ScreenPageProps) {
  useShowsResources(CLUSTERS_WORD);
  const flash = usePageFlash();
  const engineOrigin = connection.engineOrigin;
  const create = useCreateCluster(engineOrigin);

  const [form, setForm] = useState<ClusterForm>(START);
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
  const available = rows.data === undefined ? undefined : storageTypes(rows.data);
  const storageType =
    available === undefined || available.some(({ type }) => type === form.storageType) ? form.storageType : undefined;
  const zones = placement.loading ? form.zones : form.zones.filter((zone) => placement.zones?.includes(zone));

  if (storageType !== form.storageType || groups.length !== form.groups.length || zones.length !== form.zones.length) {
    setForm({ ...form, groups, zones, storageType });
  }

  const identifierRef = useRef<InputProps.Ref>(null);
  const userRef = useRef<InputProps.Ref>(null);
  const passwordRef = useRef<InputProps.Ref>(null);
  const databaseNameRef = useRef<InputProps.Ref>(null);

  const change = useCallback((update: Partial<ClusterForm>) => {
    setForm((current) => ({ ...current, ...update }));
  }, []);

  const messages: Partial<Record<Checked, string | undefined>> = tried ? messagesOf(form) : {};

  const check = () => {
    if (engineOrigin !== undefined && (defaultLoading || rows.loading)) return false;

    if (placement.loading && (form.groups.length > 0 || form.zones.length > 0)) return false;

    setTried(true);
    const found = messagesOf(form);
    const first = (Object.keys(found) as Checked[]).find((field) => found[field] !== undefined);
    if (first === undefined) {
      if (tags.firstInvalid === undefined) return true;
      tagsRef.current?.focusKey(tags.firstInvalid);
      return false;
    }
    const refs: Record<Checked, RefObject<InputProps.Ref | null>> = {
      identifier: identifierRef,
      user: userRef,
      password: passwordRef,
      databaseName: databaseNameRef,
    };
    refs[first].current?.focus();
    return false;
  };

  return (
    <CreateForm
      title={CREATE_CLUSTER_TITLE}
      description={DESCRIPTION}
      operation={CREATE_OPERATIONS.createDBCluster}
      what="Creating DB cluster"
      engineOrigin={engineOrigin}
      cancelTo={CLUSTERS_PATH}
      differs={differs(form)}
      check={check}
      send={(signal) => create(requestOf(form, rows.data === undefined ? undefined : storageType, tags.tags), signal)}
      onCreated={(id) => {
        flash.handOver(clusterHref(id), [{ type: 'success', content: `Creating DB cluster ${id}` }]);
      }}
    >
      <Container header={<Header variant="h2">Database configuration</Header>}>
        <SpaceBetween size="l">
          <IdentifierField
            label="DB cluster identifier"
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
          <StorageTypeField
            mode="cluster-create"
            connection={connection}
            rows={rows}
            defaultFailure={defaultFailure}
            defaultLoading={defaultLoading}
            retryDefault={defaults.retry}
            value={defaultFailure !== undefined || rows.failure !== undefined ? undefined : storageType}
            onChange={(storageType) => change({ storageType })}
          />
          <DatabaseNameField
            inputRef={databaseNameRef}
            value={form.databaseName}
            error={messages.databaseName}
            onChange={(databaseName) => {
              change({ databaseName });
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
            what="the DB cluster"
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
            mode="cluster"
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
          <ZonesField
            connection={connection}
            placement={placement}
            zoneRead={zoneRead}
            zones={placement.zones}
            value={form.zones}
            onChange={(zones) => change({ zones })}
          />
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
            cluster
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
