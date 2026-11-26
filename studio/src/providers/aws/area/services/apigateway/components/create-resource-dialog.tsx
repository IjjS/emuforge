import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import FormField from '@cloudscape-design/components/form-field';
import Input from '@cloudscape-design/components/input';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useState } from 'react';

import { AreaModal } from '../../../components/area-modal';
import type { AreaConnection } from '../../../components/emulator-line';
import type { ChoiceSource } from '../../../components/use-paged-choices';
import { apiQueryKey } from '../queries';
import { PATH_PART_RULE, pathPartError } from '../resource-form';
import { GET_RESOURCES, readRestResources } from '../rest-api';
import { useCreateResource } from '../rest-change-queries';
import { RestChangeFailure } from './delete-resource-dialog';
import { PagedChoice } from './paged-choice';

interface ResourceChoice {
  id: string;
  path: string;
}

interface CreateResourceDialogProps {
  apiId: string;
  root: ResourceChoice | undefined;
  connection: AreaConnection;
  onCreated: (path: string) => void;
  onDismiss: () => void;
}

export function CreateResourceDialog({ apiId, root, connection, onCreated, onDismiss }: CreateResourceDialogProps) {
  const [parent, setParent] = useState(root);
  const [pathPart, setPathPart] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const endpoint = connection.engineOrigin;
  const change = useCreateResource(endpoint, apiId, onCreated);
  const error = pathPartError(pathPart);
  const canCreate = change.available && !change.isPending;

  const source: ChoiceSource<ResourceChoice> = {
    key: [...apiQueryKey(endpoint, 'rest', apiId), 'resource-parents'],
    endpoint,
    operation: GET_RESOURCES,
    readAgainOnOpen: true,
    read: async (origin, _text, position, signal) => {
      const page = await readRestResources(origin, apiId, position, signal);
      return {
        ...page,
        items: page.items.flatMap(({ id, path }) => (id && path ? [{ id, path }] : [])),
      };
    },
    optionOf: ({ id, path }) => ({ value: id, label: path, description: `ID ${id}` }),
  };

  function handleCreate() {
    if (!canCreate) return;
    setSubmitted(true);
    if (parent && !error) change.submit({ parentId: parent.id, parentPath: parent.path, pathPart });
  }

  function handleDismiss() {
    if (!change.isPending) onDismiss();
  }

  return (
    <AreaModal
      visible
      header="Create resource"
      closeAriaLabel="Close dialog"
      onDismiss={handleDismiss}
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" disabled={change.isPending} onClick={handleDismiss}>
              Cancel
            </Button>
            <Button variant="primary" disabled={!canCreate} loading={change.isPending} onClick={handleCreate}>
              Create resource
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="m">
        <FormField label="Parent resource" errorText={submitted && !parent ? 'Choose a parent resource.' : undefined}>
          <PagedChoice
            source={source}
            value={parent}
            onChange={(choice) => {
              if (!change.isPending) setParent(choice);
            }}
            connection={connection}
            things="resources"
            placeholder="Choose a parent resource"
            ariaLabel="Parent resource"
          />
        </FormField>
        <FormField label="Path part" constraintText={PATH_PART_RULE} errorText={submitted ? error : undefined}>
          <Input value={pathPart} onChange={({ detail }) => setPathPart(detail.value)} readOnly={change.isPending} />
        </FormField>
        {change.failure && <RestChangeFailure failure={change.failure} endpoint={endpoint} />}
      </SpaceBetween>
    </AreaModal>
  );
}
