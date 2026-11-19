import Alert from '@cloudscape-design/components/alert';
import AttributeEditor from '@cloudscape-design/components/attribute-editor';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Input, { type InputProps } from '@cloudscape-design/components/input';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useRef, useState } from 'react';

import { AreaModal } from '../../../components/area-modal';
import { actionFailureItem } from '../../../components/failure-states';
import type { FlashItem } from '../../../components/page-flash';
import { usePageFlash } from '../../../components/page-flash';
import { checkVariableRows, NOT_READY, variablesOf, type VariableRow } from '../configuration-form';
import { useUpdateFunctionConfiguration } from '../queries';
import type { EditDialogProps } from './edit-runtime-dialog';

// "Edit" of "Environment variables" on the tab "Configuration" (issue 516, design "Task 5"): rows of "Key" and
// "Value", added, changed and removed, sent as the whole map in one `UpdateFunctionConfiguration`; `{}` when no row is
// left. The rows carry no constraint text (a row that repeats); a reserved key or variables over 4 KB are refused by
// the emulator and shown as it answers.

/** The dialog "Edit environment variables". */
export function EditVariablesDialog({ fn, name, engineOrigin, ready, onClose }: EditDialogProps) {
  const [rows, setRows] = useState<VariableRow[]>(() => fn.environment.map(({ key, value }) => ({ key, value })));
  const [keyErrors, setKeyErrors] = useState<(string | undefined)[]>([]);
  const [failure, setFailure] = useState<FlashItem>();
  const keyRefs = useRef<(InputProps.Ref | null)[]>([]);
  const flash = usePageFlash();
  const update = useUpdateFunctionConfiguration(engineOrigin, name);
  const pending = update.isPending;

  const handleDismiss = () => {
    if (!pending) {
      onClose();
    }
  };

  const change = (index: number, field: keyof VariableRow, value: string) => {
    setRows((current) => current.map((row, at) => (at === index ? { ...row, [field]: value } : row)));
  };

  const handleSave = () => {
    if (pending || !ready) {
      return;
    }
    const found = checkVariableRows(rows);
    setKeyErrors(found);
    const first = found.findIndex((error) => error !== undefined);
    if (first !== -1) {
      keyRefs.current[first]?.focus();
      return;
    }
    setFailure(undefined);
    update.mutate(
      { variables: variablesOf(rows) },
      {
        onSuccess: () => {
          flash.show([{ type: 'success', content: `Environment variables of ${name} saved.` }]);
          onClose();
        },
        onError: (failed) => {
          setFailure(actionFailureItem(failed, `Saving the environment variables of ${name}`, engineOrigin));
        },
      },
    );
  };

  return (
    <AreaModal
      visible
      size="large"
      header="Edit environment variables"
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
        <AttributeEditor<VariableRow>
          items={rows}
          addButtonText="Add variable"
          removeButtonText="Remove"
          empty="No environment variables"
          onAddButtonClick={() => {
            setRows((current) => [...current, { key: '', value: '' }]);
          }}
          onRemoveButtonClick={({ detail }) => {
            setRows((current) => current.filter((_, at) => at !== detail.itemIndex));
            setKeyErrors((current) => current.filter((_, at) => at !== detail.itemIndex));
          }}
          definition={[
            {
              label: 'Key',
              errorText: (_, index) => keyErrors[index],
              control: (row, index) => (
                <Input
                  ref={(element) => {
                    keyRefs.current[index] = element;
                  }}
                  value={row.key}
                  onChange={({ detail }) => {
                    change(index, 'key', detail.value);
                  }}
                />
              ),
            },
            {
              label: 'Value',
              control: (row, index) => (
                <Input
                  value={row.value}
                  onChange={({ detail }) => {
                    change(index, 'value', detail.value);
                  }}
                />
              ),
            },
          ]}
        />
        {failure !== undefined && (
          <Alert type={failure.type} header={failure.header}>
            {failure.content}
          </Alert>
        )}
      </SpaceBetween>
    </AreaModal>
  );
}
