import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import FormField from '@cloudscape-design/components/form-field';
import Grid from '@cloudscape-design/components/grid';
import Header from '@cloudscape-design/components/header';
import Textarea, { type TextareaProps } from '@cloudscape-design/components/textarea';
import { useEffect, useRef, useState } from 'react';

import { useAnnouncer } from '../../../components/failure-states';
import { invokeOutcome } from '../invoke-result';
import type { Invocation } from '../queries';
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
}

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

/** "Test": "Event" with "Event JSON" and "Invoke"; "Result". */
export function TestTab({ eventText, onEventTextChange, invoke }: TestTabProps) {
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
    if (invoke.isPending) {
      return;
    }
    if (!isOneJsonValue(eventText)) {
      setFieldError(NOT_JSON);
      field.current?.focus();
      return;
    }
    setFieldError(undefined);
    invoke.mutate(eventText);
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
                <Button variant="primary" loading={invoke.isPending} onClick={handleInvoke}>
                  {invoke.isPending ? 'Invoking' : 'Invoke'}
                </Button>
              }
            >
              Event
            </Header>
          }
        >
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
        </Container>
        <div ref={resultPlace}>
          <Container header={<Header variant="h2">Result</Header>}>
            <InvokeResult outcome={outcome} />
          </Container>
        </div>
      </Grid>
    </>
  );
}
