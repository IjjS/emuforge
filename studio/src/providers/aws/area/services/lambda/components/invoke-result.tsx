import './output-text.css';

import Box from '@cloudscape-design/components/box';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';

import { Code, CodeAndMessage } from '../../../components/failure-states';
import { ValueText } from '../../../components/value-text';
import type { InvokeOutcome, OutcomeDetail } from '../invoke-result';

// "Result" of the tab "Test" (issue 516, design "Task 2", steps 4a to 4d): the outcome's words, then the response and
// the log tail for an answer of the function, or why the invocation was refused or got no answer. The response and
// the log are the emulator's text: shown as text, never as markup or a link, their line breaks and tabs kept.

/** Before the first invoke. */
function NotInvoked() {
  return (
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
  );
}

/** Why the invocation was refused or got no answer. */
function Detail({ detail }: { detail: OutcomeDetail }) {
  if (detail.kind === 'code') {
    return (
      <Box variant="p" color="inherit">
        <CodeAndMessage code={detail.code} message={detail.message} />
      </Box>
    );
  }
  return (
    <SpaceBetween size="xxs">
      <Box variant="p" color="inherit">
        {detail.sentence}
      </Box>
      {detail.message !== undefined && (
        <Box variant="p" color="inherit">
          <ValueText kind="text" value={detail.message} />
        </Box>
      )}
    </SpaceBetween>
  );
}

/** One block of output: a heading, its description and the text as it came. */
function Output({ title, description, text }: { title: string; description: string; text: string }) {
  return (
    <SpaceBetween size="xxs">
      <Box variant="h3">{title}</Box>
      <Box variant="small" color="text-body-secondary">
        {description}
      </Box>
      <Box variant="code" display="block">
        <span className="aws-lambda-output-text">
          <ValueText kind="text" value={text} />
        </span>
      </Box>
    </SpaceBetween>
  );
}

/** The content of "Result": "Not invoked yet" until the first outcome, then the last one. */
export function InvokeResult({ outcome }: { outcome: InvokeOutcome | undefined }) {
  if (outcome === undefined) {
    return <NotInvoked />;
  }
  switch (outcome.kind) {
    case 'succeeded':
    case 'function-error':
      return (
        <SpaceBetween size="l">
          {outcome.kind === 'succeeded' ? (
            <StatusIndicator type="success">{outcome.words}</StatusIndicator>
          ) : (
            <StatusIndicator type="error">
              {outcome.words}: <Code>{outcome.functionError}</Code>
            </StatusIndicator>
          )}
          <Output
            title="Response"
            description="What the function returned, as the emulator returned it."
            text={outcome.response}
          />
          <Output
            title="Log tail"
            description="The end of this invocation's log, as the emulator returned it."
            text={outcome.log}
          />
        </SpaceBetween>
      );
    case 'refused':
    case 'no-answer':
      return (
        <SpaceBetween size="xxs">
          <StatusIndicator type="error">{outcome.words}</StatusIndicator>
          <Detail detail={outcome.detail} />
        </SpaceBetween>
      );
  }
}
