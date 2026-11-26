import type { RestApi } from '@aws-sdk/client-api-gateway';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useState } from 'react';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';

import { CopyValue } from '../../../components/copy-value';
import { creationDateText } from '../../../components/format-date';
import { usePageFlash } from '../../../components/page-flash';
import { ValueText } from '../../../components/value-text';
import { endpointTypeText } from '../format';
import { EditRestApiDialog } from './edit-rest-api-dialog';

export function RestDetails({
  api,
  apiId,
  endpoint,
  onRefresh,
}: {
  api: RestApi;
  apiId: string;
  endpoint: string | undefined;
  onRefresh: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const flash = usePageFlash();

  function handleSaved(name: string) {
    flash.show([
      {
        type: 'success',
        content: (
          <>
            API <ValueText kind="name" value={name} /> updated.
          </>
        ),
      },
    ]);
    setEditing(false);
  }
  return (
    <Container
      header={
        <Header
          variant="h2"
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button iconName="refresh" onClick={onRefresh}>
                Refresh
              </Button>
              <Button onClick={() => setEditing(true)}>Edit</Button>
            </SpaceBetween>
          }
        >
          Details
        </Header>
      }
    >
      <KeyValuePairs
        columns={3}
        items={[
          { label: 'Name', value: <ValueText kind="name" value={api.name} none="-" /> },
          { label: 'ID', value: <CopyValue label="ID" value={api.id ?? apiId} kind="name" /> },
          {
            label: 'Endpoint type',
            value: (
              <ValueText
                kind="fixed"
                value={api.endpointConfiguration?.types?.map(endpointTypeText).join(', ')}
                none="-"
              />
            ),
          },
          { label: 'Description', value: <ValueText kind="text" value={api.description} none="-" /> },
          { label: 'Creation time', value: <ValueText kind="fixed" value={creationDateText(api.createdDate)} /> },
        ]}
      />
      {editing && (
        <EditRestApiDialog
          apiId={apiId}
          endpoint={endpoint}
          current={{ name: api.name ?? '', description: api.description ?? '' }}
          onSaved={handleSaved}
          onDismiss={() => setEditing(false)}
        />
      )}
    </Container>
  );
}
