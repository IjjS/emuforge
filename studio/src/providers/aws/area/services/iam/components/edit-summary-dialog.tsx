import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import FormField from '@cloudscape-design/components/form-field';
import Input from '@cloudscape-design/components/input';
import Select, { type SelectProps } from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Textarea from '@cloudscape-design/components/textarea';
import { useState } from 'react';

import { AreaModal } from '../../../components/area-modal';
import type { FlashItem } from '../../../components/page-flash';
import { usePageFlash } from '../../../components/page-flash';
import type { Role } from '../api';
import { failureOf, useUpdateRole } from '../queries';
import { actionFailureItem } from './failures';
import { Quoted } from './quoted';

// "Edit" of a role's "Summary" (issue 82, requirement R5.5, R10.3): the dialog "Edit summary", in EmuForge's words
// where no source shows the console's, with the guide's "Description", "Maximum session duration" and "Custom
// duration". One `UpdateRole` per "Save changes"; the result is shown once the emulator has answered, never before.

/** The longest description the emulator was seen to accept (R2). */
const DESCRIPTION_MAX = 1000;
/** The bounds of a maximum session duration, in seconds: the API model's lower one, the emulator's upper one. */
const SECONDS_MIN = 3600;
const SECONDS_MAX = 43200;

/** The constraint texts of the two checked fields (issue 467, requirement R4): what "Save changes" lets through. */
export const DESCRIPTION_RULE = 'Up to 1000 characters.';
export const SECONDS_RULE = 'A whole number from 3600 to 43200.';

const DESCRIPTION_TOO_LONG = 'The description can have up to 1000 characters.';
const SECONDS_OUT_OF_RANGE = 'Enter a whole number from 3600 to 43200.';

const CUSTOM = 'custom';

/** The select's options, in order (R5.5): five durations, then "Custom duration". */
const DURATIONS: readonly { seconds: number; label: string }[] = [
  { seconds: 3600, label: '1 hour' },
  { seconds: 7200, label: '2 hours' },
  { seconds: 14400, label: '4 hours' },
  { seconds: 28800, label: '8 hours' },
  { seconds: 43200, label: '12 hours' },
];

const OPTIONS: SelectProps.Option[] = [
  ...DURATIONS.map(({ seconds, label }) => ({ value: String(seconds), label })),
  { value: CUSTOM, label: 'Custom duration' },
];

function optionOf(value: string): SelectProps.Option {
  return OPTIONS.find((option) => option.value === value) ?? { value: CUSTOM, label: 'Custom duration' };
}

/** What the select shows at start: the role's duration, or "Custom duration" when it is none of the five. */
function startChoice(seconds: number | undefined): { choice: string; seconds: string } {
  const read = seconds ?? SECONDS_MIN;
  return DURATIONS.some((duration) => duration.seconds === read)
    ? { choice: String(read), seconds: '' }
    : { choice: CUSTOM, seconds: String(read) };
}

/** A whole number of seconds within the bounds, or `undefined`. */
function parseSeconds(text: string): number | undefined {
  if (!/^\d+$/.test(text.trim())) {
    return undefined;
  }
  const seconds = Number(text.trim());
  return seconds >= SECONDS_MIN && seconds <= SECONDS_MAX ? seconds : undefined;
}

export interface EditSummaryDialogProps {
  /** The role as the page last read it. */
  role: Role;
  /** The engine's origin. */
  engineOrigin: string | undefined;
  /** Called when the dialog closes: "Cancel", Esc, or a saved change. */
  onClose: () => void;
}

/**
 * The dialog "Edit summary" (R5.5). "Save changes" checks the fields, then sends one `UpdateRole`; while it is in
 * flight the button is disabled and shows progress, and a second press sends nothing. A failure keeps the dialog and
 * its values, shown above the buttons. "Cancel" and Esc close it without a request.
 */
export function EditSummaryDialog({ role, engineOrigin, onClose }: EditSummaryDialogProps) {
  const start = startChoice(role.maxSessionDuration);
  const [description, setDescription] = useState(role.description ?? '');
  const [choice, setChoice] = useState(start.choice);
  const [seconds, setSeconds] = useState(start.seconds);
  const [errors, setErrors] = useState<{ description?: string; seconds?: string }>({});
  const [failure, setFailure] = useState<FlashItem>();
  const flash = usePageFlash();
  const update = useUpdateRole(engineOrigin);
  const pending = update.isPending;

  const handleDismiss = () => {
    if (!pending) {
      onClose();
    }
  };

  const handleSave = () => {
    if (pending) {
      return;
    }
    const chosen = choice === CUSTOM ? parseSeconds(seconds) : Number(choice);
    const found = {
      ...(description.length > DESCRIPTION_MAX && { description: DESCRIPTION_TOO_LONG }),
      ...(chosen === undefined && { seconds: SECONDS_OUT_OF_RANGE }),
    };
    setErrors(found);
    if (found.description !== undefined || chosen === undefined) {
      return;
    }
    setFailure(undefined);
    update.mutate(
      { name: role.name, description, maxSessionDuration: chosen, readMaxSessionDuration: role.maxSessionDuration },
      {
        onSuccess: () => {
          flash.show([
            {
              type: 'success',
              content: <Quoted before="Role “" name={role.name} after="” was updated in the local emulator." />,
            },
          ]);
          onClose();
        },
        onError: (error) => {
          setFailure(actionFailureItem(failureOf(error), `Updating ${role.name}`, engineOrigin));
        },
      },
    );
  };

  return (
    <AreaModal
      visible
      header="Edit summary"
      closeAriaLabel="Close modal"
      onDismiss={handleDismiss}
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={handleDismiss}>
              Cancel
            </Button>
            <Button variant="primary" loading={pending} loadingText="Saving changes" onClick={handleSave}>
              Save changes
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="m">
        <FormField label="Description" constraintText={DESCRIPTION_RULE} errorText={errors.description}>
          <Textarea
            value={description}
            onChange={({ detail }) => {
              setDescription(detail.value);
            }}
          />
        </FormField>
        <FormField label="Maximum session duration">
          <Select
            selectedOption={optionOf(choice)}
            options={OPTIONS}
            onChange={({ detail }) => {
              setChoice(detail.selectedOption.value ?? CUSTOM);
            }}
          />
        </FormField>
        {choice === CUSTOM && (
          <FormField label="Seconds" constraintText={SECONDS_RULE} errorText={errors.seconds}>
            <Input
              value={seconds}
              inputMode="numeric"
              onChange={({ detail }) => {
                setSeconds(detail.value);
              }}
            />
          </FormField>
        )}
        {failure !== undefined && (
          <Alert type={failure.type} header={failure.header}>
            {failure.content}
          </Alert>
        )}
      </SpaceBetween>
    </AreaModal>
  );
}
