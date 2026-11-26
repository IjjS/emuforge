import type { TestInvokeMethodCommandOutput } from '@aws-sdk/client-api-gateway';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Form from '@cloudscape-design/components/form';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import Input, { type InputProps } from '@cloudscape-design/components/input';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Textarea from '@cloudscape-design/components/textarea';
import { useEffect, useRef, useState, type FormEvent } from 'react';

import { ValueText } from '../../../components/value-text';
import { parseTestHeaders } from '../test-form';
import { useTestMethod } from '../test-queries';
import { RestChangeFailure } from './delete-resource-dialog';

function Preformatted({ value }: { value: string | undefined }) {
  return (
    <Box variant="pre" nativeAttributes={{ style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }}>
      {value ?? '-'}
    </Box>
  );
}

function MethodTestResult({ response }: { response: TestInvokeMethodCommandOutput }) {
  const headers = Object.entries(response.headers ?? {});
  return (
    <SpaceBetween size="s">
      <Box variant="h4">Response</Box>
      <KeyValuePairs
        columns={2}
        items={[
          { label: 'Status code', value: response.status ?? '-' },
          { label: 'Time taken', value: response.latency === undefined ? '-' : `${response.latency} ms` },
        ]}
      />
      <Box variant="strong">Headers</Box>
      {headers.length === 0 ? (
        <Box>-</Box>
      ) : (
        <KeyValuePairs
          columns={1}
          items={headers.map(([name, value]) => ({
            label: <ValueText kind="name" value={name} />,
            value: <ValueText kind="text" value={value} />,
          }))}
        />
      )}
      <Box variant="strong">Body</Box>
      <Preformatted value={response.body} />
      <Box variant="h4">Log</Box>
      <Preformatted value={response.log} />
    </SpaceBetween>
  );
}

interface TestMethodPanelProps {
  endpoint: string | undefined;
  apiId: string;
  resourceId: string;
  method: string;
  path: string;
}

export function TestMethodPanel({ endpoint, apiId, resourceId, method, path }: TestMethodPanelProps) {
  const [pathWithQueryString, setPath] = useState(path);
  const [headerText, setHeaders] = useState('');
  const [headerError, setHeaderError] = useState<string>();
  const [body, setBody] = useState('');
  const pathInput = useRef<InputProps.Ref>(null);
  const test = useTestMethod(endpoint);

  useEffect(() => pathInput.current?.focus(), []);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (test.unavailableReason !== undefined) return;
    const parsed = parseTestHeaders(headerText);
    if ('error' in parsed) {
      setHeaderError(parsed.error);
      return;
    }
    setHeaderError(undefined);
    test.submit({
      restApiId: apiId,
      resourceId,
      httpMethod: method,
      pathWithQueryString,
      headers: parsed.headers,
      body,
    });
  }

  return (
    <section aria-label="Test method">
      <form onSubmit={handleSubmit}>
        <Form
          actions={
            <Button
              variant="primary"
              formAction="submit"
              disabledReason={test.unavailableReason}
              disabled={test.unavailableReason !== undefined}
            >
              Test
            </Button>
          }
        >
          <Container
            header={
              <Header variant="h3" description="Calls the method in the emulator without a deployment.">
                Test method
              </Header>
            }
          >
            <SpaceBetween size="m">
              <KeyValuePairs
                columns={1}
                items={[{ label: 'Method', value: <ValueText kind="fixed" value={method} /> }]}
              />
              <FormField label="Path with query">
                <Input ref={pathInput} value={pathWithQueryString} onChange={({ detail }) => setPath(detail.value)} />
              </FormField>
              <FormField label="Headers" constraintText="One Name: value per line." errorText={headerError}>
                <Textarea
                  value={headerText}
                  onChange={({ detail }) => {
                    setHeaders(detail.value);
                    setHeaderError(undefined);
                  }}
                />
              </FormField>
              <FormField label="Body">
                <Textarea value={body} onChange={({ detail }) => setBody(detail.value)} />
              </FormField>
            </SpaceBetween>
          </Container>
        </Form>
      </form>
      <div aria-live="polite">
        {test.isPending && <StatusIndicator type="loading">Testing method…</StatusIndicator>}
        {test.response && <MethodTestResult response={test.response} />}
      </div>
      {test.failure && <RestChangeFailure failure={test.failure} endpoint={endpoint} />}
    </section>
  );
}
