import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import FormField from '@cloudscape-design/components/form-field';
import Grid from '@cloudscape-design/components/grid';
import Header from '@cloudscape-design/components/header';
import Select, { type SelectProps } from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Textarea, { type TextareaProps } from '@cloudscape-design/components/textarea';
import { useEffect, useRef, useState } from 'react';

import type { AreaConnection } from '../../../components/emulator-line';
import { Code, ReadFailure, readFailureState, useAnnouncer } from '../../../components/failure-states';
import { invokeOutcome } from '../invoke-result';
import type { Invocation } from '../queries';
import type { FunctionAlias, FunctionVersion } from '../version-api';
import type { ReleaseReading } from '../version-queries';
import { InvokeResult } from './invoke-result';

// The tab "Test" of a function's page (issue 516, design "Task 2"): the event as JSON text and "Invoke", then
// "Result". The event text and the invoke live in the page, so they stay across its tabs; the field's message and
// the announcement are the tab's own.

export interface TestTabProps {
  functionName: string;
  /** The event as typed; `{}` when the page opened. */
  eventText: string;
  onEventTextChange: (text: string) => void;
  /** The page's invoke: its `mutate`, `isPending`, and the last answer or failure. */
  invoke: Invocation;
  connection: AreaConnection;
  versions: ReleaseReading<FunctionVersion>;
  aliases: ReleaseReading<FunctionAlias>;
  qualifier: string | undefined;
  targetUnavailable: boolean;
  onTargetChange: (qualifier: string | undefined) => void;
}

const LATEST = '$LATEST';
const DEFAULT_TARGET = { label: LATEST, value: LATEST };
const NOT_JSON = 'Enter the event as one JSON value.';

/** Whether `text` is one JSON value (an empty or white-space text is not). */
function isOneJsonValue(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

function TargetReadFailure<T>({
  reading,
  connection,
  label,
}: {
  reading: ReleaseReading<T>;
  connection: AreaConnection;
  label: string;
}) {
  const failure = reading.failure;
  if (failure === undefined) {
    return null;
  }
  const state = readFailureState(failure, connection, label);
  return (
    <ReadFailure
      state={{
        ...state,
        detail: (
          <>
            {failure.kind !== 'not-implemented' && failure.kind !== 'access-denied' && (
              <>
                <Code>{failure.operation}</Code> failed.{' '}
              </>
            )}
            {failure.reportedCode !== undefined && (
              <>
                <Code>{failure.reportedCode}</Code>.{' '}
              </>
            )}
            {state.detail}
          </>
        ),
      }}
      onRetry={reading.refresh}
    />
  );
}

/** Keep the submitted target with the result, even if the detail reread removes the tabs. */
export function InvocationResult({ invoke }: { invoke: Invocation }) {
  const outcome = invokeOutcome(invoke.data, invoke.error);
  const failure = invoke.error;
  return (
    <Container header={<Header variant="h2">Result</Header>}>
      <SpaceBetween size="s">
        {outcome !== undefined && (
          <Box variant="p">
            Submitted target <Code>{invoke.qualifier ?? LATEST}</Code>
          </Box>
        )}
        {failure !== undefined && failure.kind !== 'not-implemented' && failure.kind !== 'access-denied' && (
          <Box variant="p">
            <Code>{failure.operation}</Code> failed.
          </Box>
        )}
        {failure?.reportedCode !== undefined && (
          <Box variant="p">
            <Code>{failure.reportedCode}</Code>
          </Box>
        )}
        <InvokeResult outcome={outcome} />
      </SpaceBetween>
    </Container>
  );
}

/** "Test": choose an invoke target, send an event and inspect the result. */
export function TestTab({
  eventText,
  onEventTextChange,
  invoke,
  connection,
  versions,
  aliases,
  qualifier,
  targetUnavailable,
  onTargetChange,
}: TestTabProps) {
  const versionOptions = (versions.items ?? [])
    .filter(({ version }) => version !== LATEST)
    .map(({ version }) => ({ label: version, value: version }));
  const aliasOptions = (aliases.items ?? []).map(({ name, version }) => ({
    label: name,
    value: name,
    description: `Version ${version}`,
  }));
  const options: SelectProps.Options = [
    DEFAULT_TARGET,
    ...(versionOptions.length > 0 ? [{ label: 'Published versions', options: versionOptions }] : []),
    ...(aliasOptions.length > 0 ? [{ label: 'Aliases', options: aliasOptions }] : []),
  ];
  const currentTarget = [...versionOptions, ...aliasOptions].find(({ value }) => value === qualifier);
  const selectedOption =
    qualifier === undefined ? DEFAULT_TARGET : (currentTarget ?? { label: qualifier, value: qualifier });
  const loadingTargets = versions.loading || aliases.loading;
  const verifiedTarget = qualifier === undefined || currentTarget !== undefined;
  const unsupported = invoke.isUnsupported(qualifier);
  const disabled = connection.result?.kind !== 'connected' || targetUnavailable || !verifiedTarget || unsupported;
  const field = useRef<TextareaProps.Ref>(null);
  const [fieldError, setFieldError] = useState<string | undefined>(undefined);
  const [announcement, announce] = useAnnouncer();
  const outcome = invokeOutcome(invoke.data, invoke.error);
  // Each outcome is said once, when it arrives: not again when the tab is opened again on the same one.
  // A new outcome is also brought into view, focus left where it is, so it is seen beside or below the event.
  const said = useRef(invoke.answers);
  const resultPlace = useRef<HTMLDivElement>(null);
  const words = outcome?.words;
  useEffect(() => {
    if (invoke.answers !== said.current) {
      said.current = invoke.answers;
      if (words !== undefined) {
        announce(words);
      }
      resultPlace.current?.scrollIntoView({ block: 'nearest' });
    }
  }, [invoke.answers, words, announce]);

  const handleInvoke = () => {
    if (invoke.isPending || disabled) {
      return;
    }
    if (!isOneJsonValue(eventText)) {
      setFieldError(NOT_JSON);
      field.current?.focus();
      return;
    }
    setFieldError(undefined);
    invoke.mutate(eventText, qualifier);
  };

  const handleKeyDown = ({ detail }: { detail: { key: string; ctrlKey: boolean; metaKey: boolean } }) => {
    if (detail.key === 'Enter' && (detail.ctrlKey || detail.metaKey)) {
      handleInvoke();
    }
  };

  // "Event" and "Result" side by side from Cloudscape's `l` breakpoint, stacked below it.
  return (
    <>
      {announcement}
      <Grid gridDefinition={[{ colspan: { default: 12, l: 6 } }, { colspan: { default: 12, l: 6 } }]}>
        <Container
          header={
            <Header
              variant="h2"
              description="The JSON the function receives as its event. Ctrl+Enter or Cmd+Enter in the field invokes."
              actions={
                <Button variant="primary" loading={invoke.isPending} disabled={disabled} onClick={handleInvoke}>
                  {invoke.isPending ? 'Invoking' : 'Invoke'}
                </Button>
              }
            >
              Event
            </Header>
          }
        >
          <SpaceBetween size="m">
            <FormField
              label="Invoke target"
              errorText={targetUnavailable ? `${qualifier} is unavailable. Choose another target.` : undefined}
            >
              <Select
                options={options}
                selectedOption={selectedOption}
                onChange={({ detail }) => {
                  const value = detail.selectedOption.value;
                  onTargetChange(value === LATEST ? undefined : value);
                }}
              />
            </FormField>
            {loadingTargets && <StatusIndicator type="loading">Loading invoke targets</StatusIndicator>}
            <TargetReadFailure reading={versions} connection={connection} label="published versions" />
            <TargetReadFailure reading={aliases} connection={connection} label="aliases" />
            {unsupported &&
              !(
                invoke.error?.kind === 'not-implemented' &&
                (invoke.qualifier === undefined) === (qualifier === undefined)
              ) && (
                <StatusIndicator type="info">
                  {qualifier === undefined ? 'Invoke' : 'Qualified Invoke'} is not implemented by the emulator.
                </StatusIndicator>
              )}
            <FormField label="Event JSON" stretch errorText={fieldError}>
              <Textarea
                ref={field}
                value={eventText}
                rows={8}
                spellcheck={false}
                invalid={fieldError !== undefined}
                onKeyDown={handleKeyDown}
                onChange={({ detail }) => {
                  setFieldError(undefined);
                  onEventTextChange(detail.value);
                }}
              />
            </FormField>
          </SpaceBetween>
        </Container>
        <div ref={resultPlace}>
          <InvocationResult invoke={invoke} />
        </div>
      </Grid>
    </>
  );
}
