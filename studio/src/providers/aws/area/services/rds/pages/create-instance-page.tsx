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
  ClassField,
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
  classError,
  databaseNameError,
  identifierError,
  masterUserNameError,
  passwordError,
  storageError,
} from '../form';
import { CREATE_INSTANCE_TITLE, instanceHref, INSTANCES_PATH, INSTANCES_WORD } from '../format';

// S2, "Create DB instance" (issue 573, design task 2): one short form, checked by `form.ts` before anything is sent,
// then one `CreateDBInstance` with the required values and only the optional ones given. On 200 the new instance's
// page opens at the answer's identifier with the result; a refusal stays on the form with the emulator's code and
// message and every entry. A list that failed to load never keeps the form from being sent. The master password lives
// in this page's state alone while it is open and goes into the one request: no address, storage, log, query key,
// cached read or result handed over holds it.

/** The engines whose instance the emulator opens a database socket for. */
const ENGINES: readonly EngineOption[] = [
  { value: 'postgres', label: 'PostgreSQL' },
  { value: 'mysql', label: 'MySQL' },
  { value: 'mariadb', label: 'MariaDB' },
];

interface InstanceForm {
  identifier: string;
  engine: string;
  version: EngineVersionChoice | undefined;
  instanceClass: string;
  storage: string;
  user: string;
  password: string;
  dbName: string;
  subnetGroup: SubnetGroupChoice | undefined;
  groups: SecurityGroupChoice[];
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
};

type Checked = 'identifier' | 'instanceClass' | 'storage' | 'user' | 'password' | 'dbName';

/** The fields' messages, in the order of the form. */
function messagesOf(form: InstanceForm): Record<Checked, string | undefined> {
  return {
    identifier: identifierError(form.identifier),
    instanceClass: classError(form.instanceClass),
    storage: storageError(form.storage),
    user: masterUserNameError(form.user, form.engine),
    password: passwordError(form.password),
    dbName: databaseNameError(form.dbName),
  };
}

function differs(form: InstanceForm): boolean {
  return (
    form.identifier !== START.identifier ||
    form.engine !== START.engine ||
    form.version !== undefined ||
    form.instanceClass !== START.instanceClass ||
    form.storage !== START.storage ||
    form.user !== '' ||
    form.password !== '' ||
    form.dbName !== '' ||
    form.subnetGroup !== undefined ||
    form.groups.length > 0
  );
}

/** What `CreateDBInstance` is sent for the form: the required values, and the optional ones given. */
function requestOf(form: InstanceForm): NewInstance {
  const values: NewInstance = {
    identifier: form.identifier,
    engine: form.engine,
    instanceClass: form.instanceClass,
    allocatedStorage: Number(form.storage),
    masterUsername: form.user,
    masterPassword: form.password,
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
  const identifierRef = useRef<InputProps.Ref>(null);
  const instanceClassRef = useRef<InputProps.Ref>(null);
  const storageRef = useRef<InputProps.Ref>(null);
  const userRef = useRef<InputProps.Ref>(null);
  const passwordRef = useRef<InputProps.Ref>(null);
  const dbNameRef = useRef<InputProps.Ref>(null);

  const change = useCallback((update: Partial<InstanceForm>) => {
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
      instanceClass: instanceClassRef,
      storage: storageRef,
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
      differs={differs(form)}
      check={check}
      send={(signal) => create(requestOf(form), signal)}
      onCreated={(id) => {
        flash.handOver(instanceHref(id), [{ type: 'success', content: `Creating DB instance ${id}` }]);
      }}
    >
      <Container>
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
          <ClassField
            inputRef={instanceClassRef}
            value={form.instanceClass}
            error={messages.instanceClass}
            onChange={(instanceClass) => {
              change({ instanceClass });
            }}
          />
          <StorageField
            inputRef={storageRef}
            value={form.storage}
            error={messages.storage}
            onChange={(storage) => {
              change({ storage });
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
            what="the DB instance"
            inputRef={passwordRef}
            value={form.password}
            error={messages.password}
            onChange={(password) => {
              change({ password });
            }}
          />
          <DatabaseNameField
            inputRef={dbNameRef}
            value={form.dbName}
            error={messages.dbName}
            onChange={(dbName) => {
              change({ dbName });
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
