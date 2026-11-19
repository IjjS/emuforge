import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Textarea from '@cloudscape-design/components/textarea';

import type { Invocation } from '../queries';

// The tab "Test" of a function's page (issue 516, design "Task 2"): the event as JSON text and "Invoke", then
// "Result". The event text and the invoke live in the page, so they stay across its tabs. The check of the event
// text, the result's outcomes, the response and the log tail are task 2's, in their places here.

export interface TestTabProps {
  functionName: string;
  /** The event as typed; `{}` when the page opened. */
  eventText: string;
  onEventTextChange: (text: string) => void;
  /** The page's invoke: its `mutate`, `isPending`, and the last answer or failure. */
  invoke: Invocation;
}

/** "Test": "Event" with "Event JSON" and "Invoke"; "Result". */
export function TestTab({ eventText, onEventTextChange, invoke }: TestTabProps) {
  const handleInvoke = () => {
    invoke.mutate(eventText);
  };
  return (
    <SpaceBetween size="l">
      <Container
        header={
          <Header
            variant="h2"
            description="The JSON the function receives as its event."
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
        <FormField label="Event JSON" stretch>
          <Textarea
            value={eventText}
            rows={8}
            spellcheck={false}
            onChange={({ detail }) => {
              onEventTextChange(detail.value);
            }}
          />
        </FormField>
      </Container>
      <Container header={<Header variant="h2">Result</Header>}>
        <Box textAlign="center" color="inherit">
          <SpaceBetween size="xxs">
            <Box variant="strong" color="inherit">
              Not invoked yet
            </Box>
            <Box variant="p" color="inherit">
              Invoke the function to see what it returns and the end of its log.
            </Box>
          </SpaceBetween>
        </Box>
      </Container>
    </SpaceBetween>
  );
}
