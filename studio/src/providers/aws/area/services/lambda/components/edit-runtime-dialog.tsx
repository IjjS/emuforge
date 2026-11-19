import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import FormField from '@cloudscape-design/components/form-field';
import Input, { type InputProps } from '@cloudscape-design/components/input';
import Select from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useRef, useState } from 'react';

import { AreaModal } from '../../../components/area-modal';
import { actionFailureItem } from '../../../components/failure-states';
import type { FlashItem } from '../../../components/page-flash';
import { usePageFlash } from '../../../components/page-flash';
import type { LambdaFunction } from '../api';
import { checkHandler, HANDLER_RULE, NOT_READY } from '../configuration-form';
import { useUpdateFunctionConfiguration } from '../queries';
import { runtimeOptions } from '../runtimes';

// "Edit" of "Runtime settings" on the tab "Code" (issue 516, design "Task 5"): "Runtime" and "Handler", sent as one
// `UpdateFunctionConfiguration` with those two fields. The architecture is not changed here.

export interface EditDialogProps {
  /** The function as the page's last read gave it. */
  fn: LambdaFunction;
  /** The function's name, as its page's address names it. */
  name: string;
  /** The engine's origin. */
  engineOrigin: string | undefined;
  /** False while the function is being created or updated: "Save" is unavailable. */
  ready: boolean;
  /** Called when the dialog closes: "Cancel", Esc, the close control, or a saved change. */
  onClose: () => void;
}

/** The dialog "Edit runtime settings". */
export function EditRuntimeDialog({ fn, name, engineOrigin, ready, onClose }: EditDialogProps) {
  const options = runtimeOptions(fn.runtime);
  const [runtime, setRuntime] = useState(fn.runtime ?? options[0]?.value ?? '');
  const [handler, setHandler] = useState(fn.handler ?? '');
  const [handlerError, setHandlerError] = useState<string>();
  const [failure, setFailure] = useState<FlashItem>();
  const handlerRef = useRef<InputProps.Ref>(null);
  const flash = usePageFlash();
  const update = useUpdateFunctionConfiguration(engineOrigin, name);
  const pending = update.isPending;

  const handleDismiss = () => {
    if (!pending) {
      onClose();
    }
  };

  const handleSave = () => {
    if (pending || !ready) {
      return;
    }
    const checked = checkHandler(handler);
    setHandlerError(checked.error);
    if (checked.error !== undefined) {
      handlerRef.current?.focus();
      return;
    }
    setFailure(undefined);
    update.mutate(
      { runtime, handler: checked.value },
      {
        onSuccess: () => {
          flash.show([{ type: 'success', content: `Runtime settings of ${name} saved.` }]);
          onClose();
        },
        onError: (failed) => {
          setFailure(actionFailureItem(failed, `Saving the runtime settings of ${name}`, engineOrigin));
        },
      },
    );
  };

  return (
    <AreaModal
      visible
      header="Edit runtime settings"
      closeAriaLabel="Close"
      onDismiss={handleDismiss}
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={handleDismiss}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!ready}
              disabledReason={NOT_READY}
              loading={pending}
              loadingText="Saving"
              onClick={handleSave}
            >
              Save
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="m">
        <FormField label="Runtime">
          <Select
            selectedOption={options.find((option) => option.value === runtime) ?? null}
            options={options}
            onChange={({ detail }) => {
              setRuntime(detail.selectedOption.value ?? runtime);
            }}
          />
        </FormField>
        <FormField label="Handler" constraintText={HANDLER_RULE} errorText={handlerError}>
          <Input
            ref={handlerRef}
            value={handler}
            onChange={({ detail }) => {
              setHandler(detail.value);
            }}
          />
        </FormField>
        {failure !== undefined && (
          <Alert type={failure.type} header={failure.header}>
            {failure.content}
          </Alert>
        )}
      </SpaceBetween>
    </AreaModal>
  );
}
