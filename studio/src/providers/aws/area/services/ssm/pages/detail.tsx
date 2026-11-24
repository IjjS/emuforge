import type { ParameterMetadata } from '@aws-sdk/client-ssm';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import Link from '@cloudscape-design/components/link';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import { useEffect } from 'react';
import { useSearchParams } from 'react-router';

import { CopyValue } from '../../../components/copy-value';
import type { AreaConnection } from '../../../components/emulator-line';
import { ReadFailure, readFailureState } from '../../../components/failure-states';
import { creationDateText } from '../../../components/format-date';
import { usePageFlash } from '../../../components/page-flash';
import { useShowsResources } from '../../../components/page-resources';
import { useFollow } from '../../../components/use-follow';
import { ValueText } from '../../../components/value-text';
import { DeleteControl } from '../components/delete/delete-control';
import { PARAMETER_STORE_PATH, parameterEditPath, parameterName } from '../paths';
import { useParameterMetadata } from '../queries';

function Metadata({ parameter }: { parameter: ParameterMetadata }) {
  const metadata = [
    { label: 'ARN', value: <CopyValue label="ARN" value={parameter.ARN} none="-" /> },
    { label: 'Type', value: parameter.Type ?? '-' },
    { label: 'Version', value: parameter.Version ?? '-' },
    {
      label: 'Last modified',
      value: <ValueText kind="fixed" value={creationDateText(parameter.LastModifiedDate)} />,
    },
    {
      label: 'Last modified by',
      value: <ValueText kind="address" value={parameter.LastModifiedUser} none="-" />,
    },
    { label: 'Tier', value: parameter.Tier ?? '-' },
    { label: 'Data type', value: <ValueText kind="fixed" value={parameter.DataType} none="-" /> },
  ];
  if (parameter.Description) {
    metadata.push({ label: 'Description', value: <ValueText kind="text" value={parameter.Description} /> });
  }
  if (parameter.KeyId) {
    metadata.push({ label: 'KMS key ID', value: <CopyValue label="KMS key ID" value={parameter.KeyId} /> });
  }
  if (parameter.AllowedPattern) {
    metadata.push({ label: 'Allowed pattern', value: <ValueText kind="name" value={parameter.AllowedPattern} /> });
  }

  return (
    <Container header={<Header variant="h2">Parameter details</Header>}>
      <SpaceBetween size="m">
        <KeyValuePairs columns={2} items={metadata} />
        {(parameter.Policies?.length ?? 0) > 0 && (
          <>
            <Box variant="h3">Parameter policies</Box>
            {parameter.Policies?.map(({ PolicyType, PolicyStatus, PolicyText }, index) => (
              <SpaceBetween size="xxs" key={index}>
                <Box variant="strong">{PolicyType}</Box>
                <ValueText kind="fixed" value={PolicyStatus} />
                <Box variant="code">
                  <ValueText kind="name" value={PolicyText} />
                </Box>
              </SpaceBetween>
            ))}
          </>
        )}
      </SpaceBetween>
    </Container>
  );
}

function ParameterDetail({ connection, name }: { connection: AreaConnection; name: string }) {
  const follow = useFollow();
  const flash = usePageFlash();
  const { metadata, loading, failure, refresh, disconnected, rememberFailure } = useParameterMetadata(connection, name);
  useEffect(() => {
    if (failure?.kind === 'not-implemented') rememberFailure(failure);
  }, [failure, rememberFailure]);
  const state = failure === undefined ? undefined : readFailureState(failure, connection, 'parameter');
  const parameter = metadata ?? undefined;

  return (
    <SpaceBetween size="l">
      <Header
        variant="h1"
        actions={
          <SpaceBetween direction="horizontal" size="xs">
            <DeleteControl
              key={JSON.stringify([connection.engineOrigin, disconnected])}
              names={parameter === undefined ? [] : [name]}
              connection={connection}
              disabled={disconnected || parameter === undefined}
              onDeleted={(_, result) => flash.handOver(PARAMETER_STORE_PATH, [result])}
            />
            <Button href={parameterEditPath(name)} onFollow={follow} disabled={disconnected || parameter === undefined}>
              Edit parameter
            </Button>
          </SpaceBetween>
        }
      >
        {name ? <ValueText kind="name" value={name} /> : 'Parameter details'}
      </Header>
      {state !== undefined ? (
        <Container>
          {failure?.kind === 'not-implemented' ? (
            <Box textAlign="center">
              <SpaceBetween size="xs">
                <StatusIndicator type={state.type}>{state.first}</StatusIndicator>
                <Box variant="p">{state.detail}</Box>
                <Button disabled>Retry</Button>
              </SpaceBetween>
            </Box>
          ) : (
            <ReadFailure state={state} onRetry={refresh} />
          )}
        </Container>
      ) : parameter !== undefined ? (
        <Metadata parameter={parameter} />
      ) : loading ? (
        <StatusIndicator type="loading">Loading parameter…</StatusIndicator>
      ) : (
        <Container>
          <SpaceBetween size="xs">
            <Box variant="p">
              {name ? (
                <>
                  Parameter <ValueText kind="name" value={name} /> was not found.
                </>
              ) : (
                'No parameter name was provided.'
              )}
            </Box>
            <Link href={PARAMETER_STORE_PATH} onFollow={follow}>
              Back to Parameter Store
            </Link>
          </SpaceBetween>
        </Container>
      )}
    </SpaceBetween>
  );
}

export function ParameterDetailPage({ connection }: { connection: AreaConnection }) {
  useShowsResources('parameters');
  const [query] = useSearchParams();
  const name = parameterName(query);
  return <ParameterDetail key={name} name={name} connection={connection} />;
}
