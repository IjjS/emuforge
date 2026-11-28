import Alert, { type AlertProps } from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button, { type ButtonProps } from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Form from '@cloudscape-design/components/form';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import Input, { type InputProps } from '@cloudscape-design/components/input';
import Link from '@cloudscape-design/components/link';
import type { SelectProps } from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';

import { DiscardDialog, type DiscardAnswer } from '../../../components/discard-dialog';
import { actionFailureItem, readFailureState, ReadFailure } from '../../../components/failure-states';
import { usePageFlash, type FlashItem } from '../../../components/page-flash';
import { TagsField, type TagsFieldRef } from '../../../components/tags-field';
import { useAvailabilityZones } from '../../../components/use-availability-zones';
import { checkTagRows, type TagRow } from '../../../lib/tag-rows';
import type { AreaConnection } from '../../../components/emulator-line';
import { useShowsResources } from '../../../components/page-resources';
import { useFollow } from '../../../components/use-follow';
import { failureOf, usePageSignal } from '../../../components/use-token-listing';
import type { ScreenPageProps } from '../../../screens';
import { useOrderableRows, useSubnetGroup } from '../choices-queries';
import { InstanceClassField, ZoneField } from '../components/choice-fields';
import { CLUSTER_OPERATIONS, type DbCluster } from '../cluster-api';
import { useAddInstance, useClusterOnce } from '../cluster-queries';
import { ADD_INSTANCE_TITLE, clusterHref, CLUSTERS_PATH, CLUSTERS_WORD } from '../format';
import { IDENTIFIER_CONSTRAINT, identifierError } from '../form';
import { instanceClasses } from '../orderable';

// S7, "Add DB instance" (issue 573, design task 4): a DB instance for the cluster of the address, read first by
// `DBClusterIdentifier`, so a cluster the emulator does not hold shows "DB cluster not found" and no form. The
// identifier, class and tags are checked before anything is sent; then one `CreateDBInstance` with the
// cluster's engine and version as read. On 200 the cluster's page opens with the result; a refusal stays on the form
// with the emulator's code and message and every entry. The page, which stays mounted, holds the request.

const ADDING = 'Adding';
const START_CLASS = 'db.r6g.large';

interface AddFormState {
  id: string;
  instanceClass: string;
  zone: string | undefined;
  tags: TagRow[];
}

/** "DB cluster not found", with Cloudscape's empty-state pattern, in the place of the form. */
function NotFound() {
  const handleFollow = useFollow();
  return (
    <Container>
      <Box textAlign="center" color="inherit">
        <SpaceBetween size="xxs">
          <Box variant="strong" color="inherit">
            DB cluster not found
          </Box>
          <Box variant="p" color="inherit">
            The emulator holds no DB cluster with this identifier.
          </Box>
          <Link href={CLUSTERS_PATH} onFollow={handleFollow}>
            View DB clusters
          </Link>
        </SpaceBetween>
      </Box>
    </Container>
  );
}

interface AddFormProps {
  cluster: DbCluster;
  connection: AreaConnection;
  pending: boolean;
  failure: FlashItem | undefined;
  /** The checks passed: send it. */
  onAdd: (form: AddFormState) => void;
  /** A press of "Add DB instance" starts again: the failure shown is dropped. */
  onTry: () => void;
}

/** The form of a DB instance for `cluster`, a cluster the emulator holds. */
function AddForm({ cluster, connection, pending, failure, onAdd, onTry }: AddFormProps) {
  const navigate = useNavigate();
  const clusterPath = clusterHref(cluster.id);
  const engine = cluster.engine ?? '';
  const rows = useOrderableRows(connection.engineOrigin, engine, cluster.engineVersion);
  const classes = instanceClasses(rows.data ?? []);
  const defaultClass = classes.some(({ name }) => name === START_CLASS) ? START_CLASS : undefined;
  const [chosenClass, setChosenClass] = useState<string>();
  const instanceClass = chosenClass ?? defaultClass;
  const group = useSubnetGroup(connection.engineOrigin, cluster.subnetGroup);
  const zoneRead = useAvailabilityZones(connection.engineOrigin);
  const [id, setId] = useState('');
  const [zone, setZone] = useState<string>();
  const [tags, setTags] = useState<TagRow[]>([]);
  const [tried, setTried] = useState(false);
  const idRef = useRef<InputProps.Ref>(null);
  const classRef = useRef<SelectProps.Ref>(null);
  const tagsRef = useRef<TagsFieldRef>(null);
  const failureRef = useRef<AlertProps.Ref>(null);

  // A failure takes the focus when it is shown, so a screen reader reads it at once.
  useEffect(() => {
    if (failure !== undefined) {
      failureRef.current?.focus();
    }
  }, [failure]);

  const idError = identifierError(id);
  const classError = !classes.some(({ name }) => name === instanceClass) ? 'Choose a class.' : undefined;
  const tagCheck = checkTagRows(tags);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (pending || rows.loading) {
      return;
    }
    setTried(true);
    onTry();
    if (idError !== undefined) {
      idRef.current?.focus();
      return;
    }
    if (classError !== undefined || instanceClass === undefined) {
      classRef.current?.focus();
      return;
    }
    if (tagCheck.firstInvalid !== undefined) {
      tagsRef.current?.focusKey(tagCheck.firstInvalid);
      return;
    }
    onAdd({ id, instanceClass, zone, tags: tagCheck.tags });
  };

  // "Cancel" leaves at once while nothing differs from the opening state; otherwise it asks (`aws-area.md`, entry 5).
  const [asking, setAsking] = useState(false);
  const cancelRef = useRef<ButtonProps.Ref>(null);
  const [kept, setKept] = useState(0);
  useEffect(() => {
    if (kept > 0) {
      cancelRef.current?.focus();
    }
  }, [kept]);
  const handleCancel = () => {
    if (
      id !== '' ||
      (chosenClass !== undefined && chosenClass !== defaultClass) ||
      zone !== undefined ||
      tags.length > 0
    ) {
      setAsking(true);
      return;
    }
    void navigate(clusterPath);
  };
  const handleDiscardAnswer = useCallback(
    (answer: DiscardAnswer) => {
      setAsking(false);
      if (answer === 'discard') {
        void navigate(clusterPath);
      } else {
        setKept((count) => count + 1);
      }
    },
    [navigate, clusterPath],
  );

  return (
    <>
      <form onSubmit={handleSubmit} noValidate>
        <Form
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button ref={cancelRef} variant="link" formAction="none" onClick={handleCancel}>
                Cancel
              </Button>
              <Button variant="primary" loading={pending} loadingText={ADDING} disabled={rows.loading}>
                {pending ? ADDING : ADD_INSTANCE_TITLE}
              </Button>
            </SpaceBetween>
          }
        >
          <SpaceBetween size="l">
            <Container header={<Header variant="h2">DB instance</Header>}>
              <SpaceBetween size="l">
                <FormField
                  label="DB instance identifier"
                  constraintText={IDENTIFIER_CONSTRAINT}
                  errorText={tried ? idError : undefined}
                >
                  <Input
                    ref={idRef}
                    value={id}
                    invalid={tried && idError !== undefined}
                    autoComplete={false}
                    spellcheck={false}
                    onChange={({ detail }) => {
                      setId(detail.value);
                    }}
                  />
                </FormField>
                <InstanceClassField
                  connection={connection}
                  engine={engine}
                  version={cluster.engineVersion}
                  rows={rows}
                  value={instanceClass}
                  onChange={setChosenClass}
                  error={tried ? classError : undefined}
                  selectRef={classRef}
                />
                <ZoneField
                  connection={connection}
                  zones={group.data?.zones}
                  zoneRead={zoneRead}
                  placement={group}
                  value={zone}
                  onChange={setZone}
                />
              </SpaceBetween>
            </Container>
            <TagsField rows={tags} onChange={setTags} errors={tried ? tagCheck.errors : undefined} ref={tagsRef} />
            {failure !== undefined && (
              <Alert ref={failureRef} type={failure.type} header={failure.header}>
                {failure.content}
              </Alert>
            )}
          </SpaceBetween>
        </Form>
      </form>
      {/* Mounted only while it asks, so nothing of it is in the page before "Cancel" is pressed. */}
      {asking && <DiscardDialog visible onAnswer={handleDiscardAnswer} />}
    </>
  );
}

/**
 * `/aws/rds/clusters/cluster/{id}/add-instance`. The cluster `id` is read on opening; once it is held, the form. A
 * failed read is read again once the connection is connected again.
 */
export function AddInstancePage({ connection, params }: ScreenPageProps) {
  useShowsResources(CLUSTERS_WORD);
  const id = params['id'] ?? '';
  const flash = usePageFlash();
  const pageSignal = usePageSignal();
  const engineOrigin = connection.engineOrigin;
  const add = useAddInstance(engineOrigin);
  const reading = useClusterOnce(engineOrigin, id);
  const { value: read, failure: readFailure, refresh } = reading;
  const cluster = read?.found === true ? read.cluster : undefined;
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<FlashItem>();
  // A press while an earlier one is in flight sends nothing.
  const busy = useRef(false);

  // Kept from the previous render, as React's own pattern for it, so a return of the connection is acted on once.
  const connected = connection.result?.kind === 'connected';
  const [seenConnected, setSeenConnected] = useState(connected);
  if (connected !== seenConnected) {
    setSeenConnected(connected);
    if (connected && readFailure !== undefined) {
      refresh();
    }
  }

  const handleTry = useCallback(() => {
    setFailure(undefined);
  }, []);

  const handleAdd = (form: AddFormState) => {
    if (busy.current || cluster === undefined) {
      return;
    }
    const operation = CLUSTER_OPERATIONS.createDBInstance;
    const what = `Adding DB instance ${form.id} to ${cluster.id}`;
    if (engineOrigin === undefined) {
      setFailure(actionFailureItem({ kind: 'engine-did-not-answer', operation }, what, undefined));
      return;
    }
    busy.current = true;
    setPending(true);
    const signal = pageSignal();
    add(
      {
        id: form.id,
        clusterId: cluster.id,
        engine: cluster.engine,
        engineVersion: cluster.engineVersion,
        instanceClass: form.instanceClass,
        zone: form.zone,
        tags: form.tags,
      },
      signal,
    ).then(
      (created) => {
        if (signal.aborted) return;
        busy.current = false;
        setPending(false);
        flash.handOver(clusterHref(cluster.id), [{ type: 'success', content: `Creating DB instance ${created}` }]);
      },
      (error: unknown) => {
        if (signal.aborted) return;
        busy.current = false;
        setPending(false);
        setFailure(actionFailureItem(failureOf(error, operation), what, engineOrigin));
      },
    );
  };

  let content;
  if (readFailure !== undefined) {
    content = (
      <Container>
        <ReadFailure state={readFailureState(readFailure, connection, 'DB cluster')} onRetry={refresh} />
      </Container>
    );
  } else if (read === undefined) {
    content = (
      <Container>
        <Box textAlign="center" color="inherit">
          <StatusIndicator type="loading">Loading DB cluster</StatusIndicator>
        </Box>
      </Container>
    );
  } else if (cluster === undefined) {
    content = <NotFound />;
  } else {
    content = (
      <AddForm
        cluster={cluster}
        connection={connection}
        pending={pending}
        failure={failure}
        onAdd={handleAdd}
        onTry={handleTry}
      />
    );
  }

  const description =
    cluster === undefined ? undefined : `Adds a DB instance to ${cluster.id}, with the cluster's engine and version.`;

  return (
    <SpaceBetween size="l">
      <Header variant="h1" description={description}>
        {ADD_INSTANCE_TITLE}
      </Header>
      {content}
    </SpaceBetween>
  );
}
