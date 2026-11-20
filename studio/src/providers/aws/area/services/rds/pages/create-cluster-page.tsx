import Container from '@cloudscape-design/components/container';
import type { InputProps } from '@cloudscape-design/components/input';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useCallback, useRef, useState, type RefObject } from 'react';

import { usePageFlash } from '../../../components/page-flash';
import { useShowsResources } from '../../../components/page-resources';
import type { SecurityGroupChoice } from '../../../components/security-group-choices';
import type { ScreenPageProps } from '../../../screens';
import type { EngineVersionChoice, SubnetGroupChoice } from '../choices-api';
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

// S5, "Create DB cluster" (issue 573, design task 4): S2's fields without the class and the storage, checked by
// `form.ts` before anything is sent, then one `CreateDBCluster` with the required values and only the optional ones
// given. On 200 the new cluster's page opens at the answer's identifier with the result; a refusal stays on the form
// with the emulator's code and message and every entry. The cluster is created alone: its DB instances are added from
// its page. The master password lives in this page's state alone, as on S2.

const DESCRIPTION = "Creates the cluster alone. Add its DB instances from the cluster's page.";

const ENGINES: readonly EngineOption[] = [
  { value: 'aurora-postgresql', label: 'Aurora PostgreSQL' },
  { value: 'aurora-mysql', label: 'Aurora MySQL' },
];

interface ClusterForm {
  identifier: string;
  engine: string;
  version: EngineVersionChoice | undefined;
  user: string;
  password: string;
  databaseName: string;
  subnetGroup: SubnetGroupChoice | undefined;
  groups: SecurityGroupChoice[];
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
};

type Checked = 'identifier' | 'user' | 'password' | 'databaseName';

/** The fields' messages, in the order of the form. */
function messagesOf(form: ClusterForm): Record<Checked, string | undefined> {
  return {
    identifier: identifierError(form.identifier),
    user: masterUserNameError(form.user, form.engine),
    password: passwordError(form.password),
    databaseName: databaseNameError(form.databaseName),
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
    form.groups.length > 0
  );
}

/** What `CreateDBCluster` is sent for the form: the required values, and the optional ones given. */
function requestOf(form: ClusterForm): NewCluster {
  const values: NewCluster = {
    identifier: form.identifier,
    engine: form.engine,
    masterUsername: form.user,
    masterPassword: form.password,
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
  const identifierRef = useRef<InputProps.Ref>(null);
  const userRef = useRef<InputProps.Ref>(null);
  const passwordRef = useRef<InputProps.Ref>(null);
  const databaseNameRef = useRef<InputProps.Ref>(null);

  const change = useCallback((update: Partial<ClusterForm>) => {
    setForm((current) => ({ ...current, ...update }));
  }, []);

  const messages: Partial<Record<Checked, string | undefined>> = tried ? messagesOf(form) : {};

  const check = () => {
    setTried(true);
    const found = messagesOf(form);
    const first = (Object.keys(found) as Checked[]).find((field) => found[field] !== undefined);
    if (first === undefined) {
      return true;
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
      send={(signal) => create(requestOf(form), signal)}
      onCreated={(id) => {
        flash.handOver(clusterHref(id), [{ type: 'success', content: `Creating DB cluster ${id}` }]);
      }}
    >
      <Container>
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
            engines={ENGINES}
            value={form.engine}
            onChange={(engine) => {
              // Another engine's versions are another list: the version goes back to the emulator's default.
              change({ engine, version: undefined });
            }}
          />
          <EngineVersionField
            engine={form.engine}
            connection={connection}
            value={form.version}
            onChange={(version) => {
              change({ version });
            }}
          />
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
          <DatabaseNameField
            inputRef={databaseNameRef}
            value={form.databaseName}
            error={messages.databaseName}
            onChange={(databaseName) => {
              change({ databaseName });
            }}
          />
          <SubnetGroupField
            connection={connection}
            value={form.subnetGroup}
            onChange={(subnetGroup) => {
              change({ subnetGroup });
            }}
          />
          <SecurityGroupsField
            connection={connection}
            value={form.groups}
            onChange={(groups) => {
              change({ groups });
            }}
          />
        </SpaceBetween>
      </Container>
    </CreateForm>
  );
}
