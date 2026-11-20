import Alert, { type AlertProps } from '@cloudscape-design/components/alert';
import Button, { type ButtonProps } from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Form from '@cloudscape-design/components/form';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import Input, { type InputProps } from '@cloudscape-design/components/input';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';

import { DiscardDialog, type DiscardAnswer } from '../../../components/discard-dialog';
import { actionFailureItem } from '../../../components/failure-states';
import { usePageFlash, type FlashItem } from '../../../components/page-flash';
import { useShowsResources } from '../../../components/page-resources';
import { failureOf } from '../../../components/use-token-listing';
import type { ScreenPageProps } from '../../../screens';
import { OPERATIONS } from '../api';
import { clusterHref, CLUSTERS_PATH, CLUSTERS_WORD, CREATE_CLUSTER_TITLE } from '../format';
import { useCreateCluster } from '../queries';

// S2, "Create cluster" (issue 575, design task 5): one field, the name, checked before anything is sent. Then the
// name is read (`DescribeClusters`): an active cluster of that name stops at the field, since the emulator would answer
// `CreateCluster` with the existing cluster as if it had made it. Otherwise one `CreateCluster`; on 200 the cluster's
// page opens with the result. A refusal stays on the form with the emulator's code and message and the name.

/** The constraint text of "Cluster name". */
const CLUSTER_NAME_RULE = '1 to 255 characters: letters, digits, hyphens and underscores.';

const NAME_PATTERN = /^[A-Za-z0-9_-]{1,255}$/;

/** What is wrong with `name`, before any request; `undefined` when nothing is. */
function clusterNameMessage(name: string): string | undefined {
  if (name === '') {
    return 'Enter a cluster name.';
  }
  return NAME_PATTERN.test(name) ? undefined : 'Use 1 to 255 letters, digits, hyphens and underscores.';
}

/**
 * `/aws/ecs/clusters/create`. "Create cluster" checks the name, reads it, then sends `CreateCluster`; on success the
 * cluster's page opens with "Cluster {name} created.". A failure stays on the form with the name, and takes the focus.
 */
export function CreateClusterPage({ connection }: ScreenPageProps) {
  useShowsResources(CLUSTERS_WORD);
  const navigate = useNavigate();
  const flash = usePageFlash();
  const engineOrigin = connection.engineOrigin;
  const create = useCreateCluster(engineOrigin);

  const [name, setName] = useState('');
  const [tried, setTried] = useState(false);
  /** The name the emulator answered as an active cluster, while the field still holds it. */
  const [existing, setExisting] = useState<string>();
  const [failure, setFailure] = useState<FlashItem>();
  const [pending, setPending] = useState(false);

  const nameRef = useRef<InputProps.Ref>(null);
  const failureRef = useRef<AlertProps.Ref>(null);

  // A press while an earlier one is in flight sends nothing; the request stops when the page is left.
  const busy = useRef(false);
  const inFlight = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      inFlight.current?.abort();
    },
    [],
  );

  // A failure takes the focus when it is shown, so a screen reader reads it at once.
  useEffect(() => {
    if (failure !== undefined) {
      failureRef.current?.focus();
    }
  }, [failure]);

  const nameError = tried
    ? (clusterNameMessage(name) ??
      (existing !== undefined && existing === name ? `A cluster named ${name} already exists.` : undefined))
    : undefined;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy.current) {
      return;
    }
    setTried(true);
    setFailure(undefined);
    setExisting(undefined);
    if (clusterNameMessage(name) !== undefined) {
      nameRef.current?.focus();
      return;
    }
    const submitted = name;
    const what = `Creating cluster ${submitted}`;
    if (engineOrigin === undefined) {
      setFailure(
        actionFailureItem({ kind: 'engine-did-not-answer', operation: OPERATIONS.createCluster }, what, undefined),
      );
      return;
    }
    busy.current = true;
    setPending(true);
    const controller = new AbortController();
    inFlight.current = controller;
    const settle = () => {
      inFlight.current = null;
      busy.current = false;
      setPending(false);
    };
    try {
      const outcome = await create(submitted, controller.signal);
      if (controller.signal.aborted) {
        return;
      }
      settle();
      if (outcome === 'exists') {
        setExisting(submitted);
        nameRef.current?.focus();
        return;
      }
      flash.handOver(clusterHref(submitted), [{ type: 'success', content: `Cluster ${submitted} created.` }]);
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }
      settle();
      setFailure(actionFailureItem(failureOf(error, OPERATIONS.createCluster), what, engineOrigin));
    }
  };

  // "Cancel" leaves at once while the name is as it opened; otherwise it asks (`aws-area.md`, entry 5).
  const [asking, setAsking] = useState(false);
  const cancelRef = useRef<ButtonProps.Ref>(null);
  const [kept, setKept] = useState(0);
  useEffect(() => {
    if (kept > 0) {
      cancelRef.current?.focus();
    }
  }, [kept]);
  const handleCancel = () => {
    if (name !== '') {
      setAsking(true);
      return;
    }
    void navigate(CLUSTERS_PATH);
  };
  const handleDiscardAnswer = useCallback(
    (answer: DiscardAnswer) => {
      setAsking(false);
      if (answer === 'discard') {
        void navigate(CLUSTERS_PATH);
      } else {
        setKept((count) => count + 1);
      }
    },
    [navigate],
  );

  return (
    <SpaceBetween size="l">
      <Header variant="h1">{CREATE_CLUSTER_TITLE}</Header>
      <form onSubmit={(event) => void handleSubmit(event)} noValidate>
        <Form
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button ref={cancelRef} variant="link" formAction="none" disabled={pending} onClick={handleCancel}>
                Cancel
              </Button>
              <Button variant="primary" loading={pending} loadingText="Creating cluster">
                {CREATE_CLUSTER_TITLE}
              </Button>
            </SpaceBetween>
          }
        >
          <SpaceBetween size="l">
            <Container header={<Header variant="h2">Cluster</Header>}>
              <FormField label="Cluster name" constraintText={CLUSTER_NAME_RULE} errorText={nameError}>
                <Input
                  ref={nameRef}
                  value={name}
                  invalid={nameError !== undefined}
                  autoComplete={false}
                  spellcheck={false}
                  onChange={({ detail }) => {
                    setName(detail.value);
                  }}
                />
              </FormField>
            </Container>

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
    </SpaceBetween>
  );
}
