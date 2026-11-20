import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Checkbox from '@cloudscape-design/components/checkbox';
import FormField from '@cloudscape-design/components/form-field';
import Input from '@cloudscape-design/components/input';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import { useState } from 'react';

import type { RequestFailure } from '../../../../../../lib/aws/request';
import { AreaModal } from '../../../components/area-modal';
import { ChoiceSelect } from '../../../components/choice-select';
import type { AreaConnection } from '../../../components/emulator-line';
import { actionFailureItem, CodeAndMessage } from '../../../components/failure-states';
import { failureOf, usePageSignal } from '../../../components/use-token-listing';
import type { ChoiceSource } from '../../../components/use-paged-choices';
import { revisionChoices, type RevisionChoice } from '../definition-choices';
import { definitionText, type Definition } from '../task-format';
import type { Service } from '../service-api';
import { SERVICE_CHANGE_OPERATIONS } from '../service-change-api';
import { useUpdateService } from '../service-change-queries';
import {
  COUNT_RULE,
  keepLabel,
  updateFormMessages,
  updateFormStart,
  updateRequestOf,
  type UpdateFormMessages,
  type UpdateFormState,
} from '../update-form';

// "Update service" of S4 (issue 575, R4 and design task 6): the desired count, a revision of the service's own
// family ("Keep" its current one first, whether or not that one is still active) and "Force a new deployment". The
// dialog holds the service as it was when it opened, so what the page reads afterwards (a `DRAINING` service
// included) changes nothing of its submit. A refusal stays in the dialog with its values; a success closes it and
// tells its opener once.

export interface UpdateServiceDialogProps {
  /** The service as the page read it when the dialog opened; none while the dialog is closed. */
  service: Service | undefined;
  cluster: string;
  connection: AreaConnection;
  /** The emulator answered 200 for the service `name`. */
  onUpdated: (name: string) => void;
  onDismiss: () => void;
}

/**
 * The Revision field's description: what "Keep" sends (no task definition, so the service keeps its own), then which
 * revisions are listed below it.
 */
function revisionFieldDescription(service: Pick<Service, 'definition' | 'definitionArn'>): string {
  const keep = `${keepLabel(service)} sends no task definition.`;
  return service.definition === undefined
    ? keep
    : `${keep} Below it, the active revisions of family ${service.definition.family}, newest first.`;
}

/** The description of the listed revision that is the service's own: choosing it sends that revision again. */
function currentRevisionSends(current: Definition): string {
  return `Sends ${definitionText(current)} again`;
}

/** What "Force a new deployment" sends, beside its checkbox. */
const FORCE_SENDS = 'Sends forceNewDeployment, so the service starts new tasks even when nothing else changes.';

/**
 * The active revisions of the service's family, the one equal to the service's current revision described by what
 * it sends, so it is told apart from "Keep" it above: choosing it sends that revision, "Keep" sends none.
 */
function revisionSource(endpoint: string | undefined, current: Definition | undefined): ChoiceSource<RevisionChoice> {
  const listed = revisionChoices(endpoint, current?.family);
  return {
    ...listed,
    optionOf: (choice) => {
      const option = listed.optionOf(choice);
      return current !== undefined && choice.family === current.family && choice.revision === current.revision
        ? { ...option, description: currentRevisionSends(current) }
        : option;
    },
  };
}

/** The refusal in the dialog: the emulator's code and message, or the area's words for any other failure. */
function Failure({ failure, name, engineOrigin }: { failure: RequestFailure; name: string; engineOrigin?: string }) {
  const item =
    failure.kind === 'other'
      ? {
          type: 'error' as const,
          header: 'The emulator did not update the service.',
          content: <CodeAndMessage code={failure.code} message={failure.message} />,
        }
      : actionFailureItem(failure, `Updating service ${name}`, engineOrigin);
  return (
    <div role="alert">
      <StatusIndicator type={item.type === 'info' ? 'info' : 'error'}>{item.header}</StatusIndicator>
      {item.content !== undefined && <> {item.content}</>}
    </div>
  );
}

function Dialog({
  service,
  cluster,
  connection,
  onUpdated,
  onDismiss,
}: Omit<UpdateServiceDialogProps, 'service'> & { service: Service }) {
  const update = useUpdateService(connection.engineOrigin, cluster);
  const pageSignal = usePageSignal();
  const [form, setForm] = useState<UpdateFormState>(() => updateFormStart(service));
  const [messages, setMessages] = useState<UpdateFormMessages>({});
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<RequestFailure>();
  const [updated, setUpdated] = useState(false);

  const handleSubmit = () => {
    if (pending || updated) {
      return;
    }
    const found = updateFormMessages(form);
    setMessages(found);
    const request = updateRequestOf(form);
    if (request === undefined) {
      return;
    }
    const signal = pageSignal();
    setPending(true);
    setFailure(undefined);
    update(service.name, request, signal).then(
      () => {
        if (signal.aborted) return;
        setPending(false);
        setUpdated(true);
        onUpdated(service.name);
      },
      (error: unknown) => {
        if (signal.aborted) return;
        setPending(false);
        setFailure(failureOf(error, SERVICE_CHANGE_OPERATIONS.updateService));
      },
    );
  };
  const handleDismiss = () => {
    if (!pending) {
      onDismiss();
    }
  };

  return (
    <AreaModal
      visible={!updated}
      header={`Update service ${service.name}`}
      closeAriaLabel="Close dialog"
      onDismiss={handleDismiss}
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" disabled={pending} onClick={handleDismiss}>
              Cancel
            </Button>
            <Button variant="primary" disabled={pending} loading={pending} onClick={handleSubmit}>
              Update
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      {/* Enter in a field submits the dialog as "Update" does, under the same guards. */}
      <form
        noValidate
        aria-label={`Update service ${service.name}`}
        onSubmit={(event) => {
          event.preventDefault();
          handleSubmit();
        }}
      >
        <SpaceBetween size="m">
          <FormField label="Desired tasks" constraintText={COUNT_RULE} errorText={messages.count}>
            <Input
              value={form.count}
              inputMode="numeric"
              invalid={messages.count !== undefined}
              onChange={({ detail }) => {
                setForm((current) => ({ ...current, count: detail.value }));
              }}
            />
          </FormField>
          <FormField label="Revision" description={revisionFieldDescription(service)}>
            <ChoiceSelect
              source={revisionSource(connection.engineOrigin, service.definition)}
              connection={connection}
              things="revisions"
              fixed={keepLabel(service)}
              value={form.revision}
              onChange={(revision) => {
                setForm((current) => ({ ...current, revision }));
              }}
            />
          </FormField>
          <Checkbox
            checked={form.force}
            description={FORCE_SENDS}
            onChange={({ detail }) => {
              setForm((current) => ({ ...current, force: detail.checked }));
            }}
          >
            Force a new deployment
          </Checkbox>
          {failure !== undefined && (
            <Failure
              failure={failure}
              name={service.name}
              {...(connection.engineOrigin === undefined ? {} : { engineOrigin: connection.engineOrigin })}
            />
          )}
        </SpaceBetween>
      </form>
    </AreaModal>
  );
}

/** The dialog, mounted only while a service is given, so each opening starts from the service's own values. */
export function UpdateServiceDialog({ service, ...props }: UpdateServiceDialogProps) {
  return service === undefined ? null : <Dialog key={service.name} service={service} {...props} />;
}
