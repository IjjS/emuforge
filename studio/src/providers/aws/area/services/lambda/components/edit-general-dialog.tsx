import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import FormField from '@cloudscape-design/components/form-field';
import Input, { type InputProps } from '@cloudscape-design/components/input';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Textarea, { type TextareaProps } from '@cloudscape-design/components/textarea';
import { useRef, useState } from 'react';

import { AreaModal } from '../../../components/area-modal';
import { actionFailureItem } from '../../../components/failure-states';
import type { FlashItem } from '../../../components/page-flash';
import { usePageFlash } from '../../../components/page-flash';
import {
  checkDescription,
  checkMemory,
  checkTimeout,
  DESCRIPTION_RULE,
  MEMORY_RULE,
  NOT_READY,
  TIMEOUT_RULE,
} from '../configuration-form';
import { useUpdateFunctionConfiguration } from '../queries';
import type { EditDialogProps } from './edit-runtime-dialog';

// "Edit" of "General configuration" on the tab "Configuration" (issue 516, design "Task 5"): "Description", "Memory
// (MB)" and "Timeout (seconds)", sent as one `UpdateFunctionConfiguration` with those three fields.

function numberText(value: number | undefined): string {
  return value === undefined ? '' : String(value);
}

/** The dialog "Edit general configuration". */
export function EditGeneralDialog({ fn, name, engineOrigin, ready, onClose }: EditDialogProps) {
  const [description, setDescription] = useState(fn.description ?? '');
  const [memory, setMemory] = useState(numberText(fn.memorySize));
  const [timeout, setTimeoutText] = useState(numberText(fn.timeout));
  const [errors, setErrors] = useState<{ description?: string; memory?: string; timeout?: string }>({});
  const [failure, setFailure] = useState<FlashItem>();
  const descriptionRef = useRef<TextareaProps.Ref>(null);
  const memoryRef = useRef<InputProps.Ref>(null);
  const timeoutRef = useRef<InputProps.Ref>(null);
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
    const checkedDescription = checkDescription(description);
    const checkedMemory = checkMemory(memory);
    const checkedTimeout = checkTimeout(timeout);
    setErrors({
      ...(checkedDescription.error !== undefined && { description: checkedDescription.error }),
      ...(checkedMemory.error !== undefined && { memory: checkedMemory.error }),
      ...(checkedTimeout.error !== undefined && { timeout: checkedTimeout.error }),
    });
    if (checkedDescription.error !== undefined) {
      descriptionRef.current?.focus();
      return;
    }
    if (checkedMemory.error !== undefined) {
      memoryRef.current?.focus();
      return;
    }
    if (checkedTimeout.error !== undefined) {
      timeoutRef.current?.focus();
      return;
    }
    setFailure(undefined);
    update.mutate(
      { description: checkedDescription.value, memorySize: checkedMemory.value, timeout: checkedTimeout.value },
      {
        onSuccess: () => {
          flash.show([{ type: 'success', content: `General configuration of ${name} saved.` }]);
          onClose();
        },
        onError: (failed) => {
          setFailure(actionFailureItem(failed, `Saving the general configuration of ${name}`, engineOrigin));
        },
      },
    );
  };

  return (
    <AreaModal
      visible
      header="Edit general configuration"
      closeAriaLabel="Close modal"
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
        <FormField label="Description" constraintText={DESCRIPTION_RULE} errorText={errors.description}>
          <Textarea
            ref={descriptionRef}
            value={description}
            onChange={({ detail }) => {
              setDescription(detail.value);
            }}
          />
        </FormField>
        <FormField label="Memory (MB)" constraintText={MEMORY_RULE} errorText={errors.memory}>
          <Input
            ref={memoryRef}
            value={memory}
            inputMode="numeric"
            onChange={({ detail }) => {
              setMemory(detail.value);
            }}
          />
        </FormField>
        <FormField label="Timeout (seconds)" constraintText={TIMEOUT_RULE} errorText={errors.timeout}>
          <Input
            ref={timeoutRef}
            value={timeout}
            inputMode="numeric"
            onChange={({ detail }) => {
              setTimeoutText(detail.value);
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
