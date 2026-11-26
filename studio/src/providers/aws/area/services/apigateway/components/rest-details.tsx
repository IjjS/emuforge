import type { RestApi } from '@aws-sdk/client-api-gateway';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';

import { CopyValue } from '../../../components/copy-value';
import { creationDateText } from '../../../components/format-date';
import { ValueText } from '../../../components/value-text';
import { endpointTypeText } from '../format';

export function RestDetails({ api, apiId, onRefresh }: { api: RestApi; apiId: string; onRefresh: () => void }) {
  return (
    <Container
      header={
        <Header
          variant="h2"
          actions={
            <Button iconName="refresh" onClick={onRefresh}>
              Refresh
            </Button>
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
    </Container>
  );
}
