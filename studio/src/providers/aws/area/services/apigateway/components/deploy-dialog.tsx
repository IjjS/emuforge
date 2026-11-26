import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import FormField from '@cloudscape-design/components/form-field';
import Input, { type InputProps } from '@cloudscape-design/components/input';
import RadioGroup from '@cloudscape-design/components/radio-group';
import type { SelectProps } from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Textarea from '@cloudscape-design/components/textarea';
import { queryOptions, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useRef, useState } from 'react';

import { AreaModal } from '../../../components/area-modal';
import type { AreaConnection } from '../../../components/emulator-line';
import { actionFailureItem } from '../../../components/failure-states';
import { usePageFlash } from '../../../components/page-flash';
import { failureOf, noEndpoint } from '../../../components/use-token-listing';
import { ValueText } from '../../../components/value-text';
import { checkDeployStage, STAGE_NAME_RULE } from '../deploy-form';
import { apiQueryKey } from '../queries';
import { GET_REST_STAGES, readRestStages } from '../rest-api';
import { CREATE_DEPLOYMENT } from '../rest-stage-api';
import { useDeployRestApi } from '../rest-stage-queries';
import { PagedChoice } from './paged-choice';
import { RequestReadFailure } from './request-read-failure';

interface StageChoice {
  name: string;
  deploymentId: string | undefined;
}

function ExistingStageField({
  apiId,
  connection,
  value,
  onChange,
  error,
  selectRef,
}: {
  apiId: string;
  connection: AreaConnection;
  value: StageChoice | undefined;
  onChange: (stage: StageChoice | undefined) => void;
  error: string | undefined;
  selectRef: React.Ref<SelectProps.Ref>;
}) {
  const client = useQueryClient();
  const fieldId = useId();
  const endpoint = connection.engineOrigin;
  const [choiceOpened, setChoiceOpened] = useState(false);
  const firstRead = useRef(true);
  const options = queryOptions({
    queryKey: [...apiQueryKey(endpoint, 'rest', apiId), 'deploy-options', fieldId],
    queryFn: ({ signal }) => (endpoint === undefined ? noEndpoint() : readRestStages(endpoint, apiId, signal)),
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
  });
  // The dialog starts the read before the select opens. The select consumes that result and owns retries after opening.
  const preload = useQuery({ ...options, enabled: endpoint !== undefined });

  return (
    <FormField label="Existing stage" errorText={error}>
      <PagedChoice
        source={{
          key: [...options.queryKey, 'choice'],
          endpoint,
          operation: GET_REST_STAGES,
          read: async () => {
            setChoiceOpened(true);
            if (firstRead.current) {
              firstRead.current = false;
              const prior = client.getQueryState(options.queryKey);
              if (prior?.status === 'error' && prior.fetchStatus === 'idle') throw prior.error;
            }
            const stages = await client.fetchQuery(options);
            return {
              items: stages.flatMap(({ stageName, deploymentId }) =>
                stageName ? [{ name: stageName, deploymentId }] : [],
              ),
            };
          },
          optionOf: ({ name, deploymentId }) => ({
            value: name,
            label: name,
            ...(deploymentId !== undefined && { description: `Deployment ${deploymentId}` }),
          }),
        }}
        connection={connection}
        things="stages"
        placeholder="Choose a stage"
        ariaLabel="Existing stage"
        selectRef={selectRef}
        value={value}
        onChange={onChange}
      />
      {!choiceOpened && preload.isError && !preload.isFetching && (
        <RequestReadFailure
          connection={connection}
          failure={failureOf(preload.error, GET_REST_STAGES)}
          thing="stages"
          onRetry={() => void preload.refetch()}
        />
      )}
    </FormField>
  );
}

export function DeployDialog({
  apiId,
  connection,
  hasStages,
  onClose,
}: {
  apiId: string;
  connection: AreaConnection;
  hasStages: boolean;
  onClose: () => void;
}) {
  const [target, setTarget] = useState<'existing' | 'new'>(hasStages ? 'existing' : 'new');
  const [name, setName] = useState('');
  const [existing, setExisting] = useState<StageChoice>();
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string>();
  const nameRef = useRef<InputProps.Ref>(null);
  const selectRef = useRef<SelectProps.Ref>(null);
  const flash = usePageFlash();
  const deploy = useDeployRestApi(apiId, connection.engineOrigin);
  const failure = deploy.isError ? failureOf(deploy.error, CREATE_DEPLOYMENT) : undefined;
  const alert = failure && actionFailureItem(failure, failure.operation, connection.engineOrigin);
  const unavailable = connection.engineOrigin === undefined || failure?.kind === 'not-implemented';

  const handleDismiss = () => {
    if (!deploy.isPending) onClose();
  };
  const handleDeploy = () => {
    if (unavailable || deploy.isPending) return;
    const checked = checkDeployStage(target, existing?.name, name);
    setError(checked.error);
    if (checked.stageName === undefined) {
      if (target === 'new') nameRef.current?.focus();
      else selectRef.current?.focus();
      return;
    }
    const { stageName } = checked;
    deploy.mutate(
      { stageName, description },
      {
        onSuccess: () => {
          flash.show([
            {
              type: 'success',
              content: (
                <>
                  API deployed to stage <ValueText kind="name" value={stageName} />.
                </>
              ),
            },
          ]);
          onClose();
        },
      },
    );
  };

  return (
    <AreaModal
      visible
      header="Deploy API"
      closeAriaLabel="Close dialog"
      onDismiss={handleDismiss}
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" disabled={deploy.isPending} onClick={handleDismiss}>
              Cancel
            </Button>
            <Button variant="primary" loading={deploy.isPending} disabled={unavailable} onClick={handleDeploy}>
              Deploy
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="m">
        <FormField label="Deploy to" stretch>
          <RadioGroup
            ariaLabel="Deploy to"
            value={target}
            items={[
              {
                value: 'existing',
                label: 'An existing stage',
                description: 'Moves a stage this API has to the new deployment.',
              },
              { value: 'new', label: 'New stage', description: 'Creates a stage with this deployment.' },
            ]}
            onChange={({ detail }) => {
              setTarget(detail.value === 'existing' ? 'existing' : 'new');
              setExisting(undefined);
              setError(undefined);
            }}
          />
        </FormField>
        {target === 'existing' ? (
          <ExistingStageField
            apiId={apiId}
            connection={connection}
            value={existing}
            onChange={(stage) => {
              setExisting(stage);
              setError(undefined);
            }}
            error={error}
            selectRef={selectRef}
          />
        ) : (
          <FormField label="Stage name" constraintText={STAGE_NAME_RULE} errorText={error}>
            <Input
              ref={nameRef}
              value={name}
              onChange={({ detail }) => {
                setName(detail.value);
                setError(undefined);
              }}
            />
          </FormField>
        )}
        <FormField label="Description (optional)">
          <Textarea value={description} onChange={({ detail }) => setDescription(detail.value)} />
        </FormField>
        {alert && (
          <Alert type={alert.type} header={alert.header}>
            {(failure?.kind === 'emulator-did-not-answer' || failure?.kind === 'engine-did-not-answer') && (
              <Box variant="strong">{failure.operation}</Box>
            )}
            {alert.content}
          </Alert>
        )}
      </SpaceBetween>
    </AreaModal>
  );
}
