import './policy-document.css';

import Box from '@cloudscape-design/components/box';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';

import type { AreaConnection } from '../../../components/emulator-line';
import { ValueText } from '../../../components/value-text';
import type { InlineDocumentRead, ManagedDocumentRead } from '../api';
import type { DocumentQuery } from '../queries';
import { readFailureState } from './failures';
import { ReadFailure } from './states';

// A policy document shown as text (issue 535, design "Shared parts inside IAM's folder"), in each state of its read:
// loading, the text, not found, failed with a retry. Used by a role's two tabs and a policy's page. The text is the
// emulator's, untrusted, and is rendered as text only, character for character.

/** What a failed read names (R10.1). */
const THING = 'policy document';

export const LOADING_TEXT = 'Loading the policy document';

export const NOT_FOUND_TEXT = 'Policy not found';

/** What `PolicyDocument` shows: a document's read, or a text already in hand (a trust policy). */
export type PolicyDocumentSource =
  | { kind: 'query'; query: DocumentQuery<InlineDocumentRead | ManagedDocumentRead> }
  | { kind: 'text'; text: string };

interface PolicyDocumentProps {
  source: PolicyDocumentSource;
  /** The managed policy's ARN, named when the emulator holds no such policy; none for an inline policy. */
  arn?: string;
  connection: AreaConnection;
}

/** A document's text, its line breaks and spaces kept, broken as free text. */
export function DocumentText({ text }: { text: string }) {
  return (
    <Box variant="code" display="block">
      <span className="aws-iam-policy-document">
        <ValueText kind="text" value={text} />
      </span>
    </Box>
  );
}

/** "Policy not found": the sentence with the ARN for a managed policy, which a role can still name. */
function NotFound({ arn }: { arn: string | undefined }) {
  return (
    <SpaceBetween size="xxs">
      <Box variant="strong" color="inherit">
        {NOT_FOUND_TEXT}
      </Box>
      <Box variant="p" color="inherit">
        {arn === undefined ? (
          'The emulator holds no such policy.'
        ) : (
          <>
            The emulator holds no policy with the ARN <ValueText kind="address" value={arn} />. A role can still name
            it.
          </>
        )}
      </Box>
    </SpaceBetween>
  );
}

/** A policy document in the state of its read. */
export function PolicyDocument({ source, arn, connection }: PolicyDocumentProps) {
  if (source.kind === 'text') {
    return <DocumentText text={source.text} />;
  }
  const { query } = source;
  if (query.failure !== undefined && !query.loading) {
    return <ReadFailure state={readFailureState(query.failure, connection, THING)} onRetry={query.refresh} />;
  }
  if (query.read === undefined || query.loading) {
    return <StatusIndicator type="loading">{LOADING_TEXT}</StatusIndicator>;
  }
  if (query.read.kind === 'not-found') {
    return <NotFound arn={arn} />;
  }
  return <DocumentText text={query.read.text} />;
}
