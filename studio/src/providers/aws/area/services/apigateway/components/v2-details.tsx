import type { GetApiResponse } from '@aws-sdk/client-apigatewayv2';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';

import { CopyValue } from '../../../components/copy-value';
import { creationDateText } from '../../../components/format-date';
import { ValueText } from '../../../components/value-text';
import { apiKindText } from '../format';
import { useShowPart } from '../show-part';

export function V2PartHeading({ part, children }: { part: string; children: string }) {
  const show = useShowPart(part);
  return (
    <span
      ref={(text) => {
        const heading = text?.closest('h2');
        if (heading) {
          heading.tabIndex = -1;
          show(heading);
        }
      }}
    >
      {children}
    </span>
  );
}

export function V2Details({ api, id, onRefresh }: { api: GetApiResponse; id: string; onRefresh: () => void }) {
  return (
    <Container
      header={
        <Header
          variant="h2"
          actions={
            <Button onClick={onRefresh} iconName="refresh">
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
          { label: 'Name', value: <ValueText kind="name" value={api.Name ?? id} /> },
          { label: 'ID', value: <CopyValue kind="name" label="API ID" value={api.ApiId ?? id} /> },
          {
            label: 'Protocol',
            value: <ValueText kind="fixed" value={api.ProtocolType && apiKindText(api.ProtocolType)} none="-" />,
          },
          { label: 'Description', value: <ValueText kind="text" value={api.Description} none="-" /> },
          { label: 'API endpoint', value: <CopyValue label="API endpoint" value={api.ApiEndpoint} none="-" /> },
          { label: 'Creation time', value: <ValueText kind="fixed" value={creationDateText(api.CreatedDate)} /> },
        ]}
      />
    </Container>
  );
}
