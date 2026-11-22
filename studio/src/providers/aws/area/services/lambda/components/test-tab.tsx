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
import { useRef, useState, type Ref } from 'react';

import { reportedServiceCode } from '../../../../../../lib/aws/request';
import type { AreaConnection } from '../../../components/emulator-line';
import { Code, ReadFailure, readFailureState } from '../../../components/failure-states';
import { invokeOutcome } from '../invoke-result';
import type { Invocation } from '../queries';
import type { FunctionAlias, FunctionVersion } from '../version-api';
import type { ReleaseReading } from '../version-queries';
import { InvokeResult } from './invoke-result';

// The tab "Test" of a function's page (issue 516, design "Task 2"): the event as JSON text and "Invoke", then
// "Result". The page keeps the event and invocation across tabs. The field's validation message lives here.

export interface TestTabProps {
  functionName: string;
  /** Whether this function has been verified in the current connected session. */
  verified: boolean;
  /** The event as typed; `{}` when the page opened. */
  eventText: string;
  onEventTextChange: (text: string) => void;
  /** The page's invoke: its `mutate`, `isPending`, and the last answer or failure. */
  invoke: Invocation;
  resultRef?: Ref<HTMLDivElement> | undefined;
  connection: AreaConnection;
  versions: ReleaseReading<FunctionVersion>;
  aliases: ReleaseReading<FunctionAlias>;
  qualifier: string | undefined;
  targetUnavailable: boolean;
  targetReset?: boolean;
  invokeInputRef?: Ref<HTMLDivElement>;
  onTargetChange: (qualifier: string | undefined) => void;
}

const LATEST = '$LATEST';
const DEFAULT_TARGET = { label: LATEST, value: LATEST };
const NOT_IMPLEMENTED = 'Not implemented by the emulator';
const NOT_JSON = 'Enter the event as one JSON value.';
export const INVOKE_TARGET_RESET =
  'Invoke target reset to $LATEST. After verification, use Invoke target to select a version or alias for your preserved event draft.';

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
export function InvocationResult({
  invoke,
  resultRef,
}: {
  invoke: Invocation;
  resultRef?: Ref<HTMLDivElement> | undefined;
}) {
  const outcome = invokeOutcome(invoke.data, invoke.error);
  const failure = invoke.error;
  const reportedCode =
    failure?.kind === 'access-denied' || failure?.kind === 'emulator-did-not-answer'
      ? reportedServiceCode(failure)
      : undefined;
  return (
    <div ref={resultRef}>
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
          {reportedCode !== undefined && (
            <Box variant="p">
              <Code>{reportedCode}</Code>
            </Box>
          )}
          {failure?.kind === 'not-implemented' && invoke.qualifier !== undefined ? (
            <SpaceBetween size="xxs">
              <StatusIndicator type="info">{NOT_IMPLEMENTED}</StatusIndicator>
              <Box variant="p">
                The emulator answered 501 Not Implemented for <Code>{failure.operation}</Code>.
              </Box>
            </SpaceBetween>
          ) : (
            <InvokeResult outcome={outcome} />
          )}
        </SpaceBetween>
      </Container>
    </div>
  );
}

/** "Test": choose an invoke target, send an event and inspect the result. */
export function TestTab({
  verified,
  eventText,
  onEventTextChange,
  invoke,
  resultRef,
  connection,
  versions,
  aliases,
  qualifier,
  targetUnavailable,
  targetReset,
  invokeInputRef,
  onTargetChange,
}: TestTabProps) {
  const versionOptions = (versions.failure === undefined ? (versions.items ?? []) : [])
    .filter(({ version }) => version !== LATEST)
    .map(({ version }) => ({ label: version, value: version }));
  const aliasOptions = (aliases.failure === undefined ? (aliases.items ?? []) : []).map(({ name, version }) => ({
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
  const disabled = !verified || targetUnavailable || !verifiedTarget || unsupported;
  const field = useRef<TextareaProps.Ref>(null);
  const [fieldError, setFieldError] = useState<string | undefined>(undefined);
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
          <div ref={invokeInputRef}>
            <FormField
              label="Invoke target"
              description={targetReset ? INVOKE_TARGET_RESET : undefined}
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
          </div>
          {loadingTargets && <StatusIndicator type="loading">Loading invoke targets</StatusIndicator>}
          <TargetReadFailure reading={versions} connection={connection} label="published versions" />
          <TargetReadFailure reading={aliases} connection={connection} label="aliases" />
          {unsupported &&
            !(
              invoke.error?.kind === 'not-implemented' && (invoke.qualifier === undefined) === (qualifier === undefined)
            ) && (
              <StatusIndicator type="info">
                {NOT_IMPLEMENTED}. {qualifier === undefined ? 'Invoke' : 'Qualified Invoke'} is unavailable.
              </StatusIndicator>
            )}
          <div ref={invokeInputRef}>
            <FormField
              label="Event JSON"
              stretch
              errorText={fieldError}
              constraintText={verified ? undefined : 'Event editing is available after the function is verified.'}
            >
              <Textarea
                ref={field}
                value={eventText}
                rows={8}
                spellcheck={false}
                readOnly={!verified}
                invalid={fieldError !== undefined}
                onKeyDown={handleKeyDown}
                onChange={({ detail }) => {
                  if (verified) {
                    setFieldError(undefined);
                    onEventTextChange(detail.value);
                  }
                }}
              />
            </FormField>
          </div>
        </SpaceBetween>
      </Container>
      <InvocationResult invoke={invoke} resultRef={resultRef} />
    </Grid>
  );
}
