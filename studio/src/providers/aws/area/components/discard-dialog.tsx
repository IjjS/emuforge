import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { memo, useCallback, useLayoutEffect, useRef } from 'react';

import { AreaModal } from './area-modal';

// What "Cancel" opens on a create form or wizard that holds something the user entered (issue 467, requirement R7;
// `studio/AGENTS.md`, "What every AWS screen does", entry 5). The form decides when to open it and what each answer
// does: "keep" leaves the form as it was, "discard" leaves as "Cancel" did before.

/** The user's answer: go on with the form, or leave it. */
export type DiscardAnswer = 'keep' | 'discard';

interface DiscardDialogProps {
  visible: boolean;
  /** Called once per answer: "Keep editing", Esc and "Close" answer "keep"; "Discard" answers "discard". */
  onAnswer: (answer: DiscardAnswer) => void;
}

/**
 * The dialog "Discard what you entered?", an `AreaModal` inside the area's root. Cloudscape's `Modal` traps focus while
 * it is open and gives it back to what had it, the form's "Cancel", when it closes.
 */
export function DiscardDialog({ visible, onAnswer }: DiscardDialogProps) {
  // The form around the dialog re-renders while it is open (the connection's check every 5 seconds); the dialog takes
  // the latest handler without re-rendering, so `AreaModal` keeps its root and focus stays where it is.
  const latest = useRef(onAnswer);
  useLayoutEffect(() => {
    latest.current = onAnswer;
  });
  const handleAnswer = useCallback((answer: DiscardAnswer) => {
    latest.current(answer);
  }, []);
  return <Dialog visible={visible} onAnswer={handleAnswer} />;
}

const Dialog = memo(function Dialog({ visible, onAnswer }: DiscardDialogProps) {
  const handleKeep = useCallback(() => {
    onAnswer('keep');
  }, [onAnswer]);
  const handleDiscard = useCallback(() => {
    onAnswer('discard');
  }, [onAnswer]);
  return (
    <AreaModal
      visible={visible}
      header="Discard what you entered?"
      closeAriaLabel="Close"
      onDismiss={handleKeep}
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={handleKeep}>
              Keep editing
            </Button>
            <Button variant="primary" onClick={handleDiscard}>
              Discard
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      What you entered on this page is not kept.
    </AreaModal>
  );
});
