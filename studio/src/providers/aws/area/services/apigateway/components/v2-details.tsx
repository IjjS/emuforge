import type { GetApiResponse } from '@aws-sdk/client-apigatewayv2';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useState } from 'react';

import { CopyValue } from '../../../components/copy-value';
import { creationDateText } from '../../../components/format-date';
import { usePageFlash } from '../../../components/page-flash';
import { ValueText } from '../../../components/value-text';
import { apiKindText } from '../format';
import { useShowPart } from '../show-part';
import { EditV2ApiDialog } from './edit-v2-api-dialog';

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

export function V2Details({
  api,
  id,
  endpoint,
  onRefresh,
}: {
  api: GetApiResponse;
  id: string;
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
              <Button onClick={onRefresh} iconName="refresh">
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
      {editing && (
        <EditV2ApiDialog
          apiId={id}
          endpoint={endpoint}
          current={{ name: api.Name ?? '', description: api.Description ?? '' }}
          onSaved={handleSaved}
          onDismiss={() => setEditing(false)}
        />
      )}
    </Container>
  );
}
