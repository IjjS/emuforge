import Alert, { type AlertProps } from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button, { type ButtonProps } from '@cloudscape-design/components/button';
import Checkbox from '@cloudscape-design/components/checkbox';
import FormField from '@cloudscape-design/components/form-field';
import Input from '@cloudscape-design/components/input';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useEffect, useRef, useState } from 'react';

import { AreaModal } from '../../../components/area-modal';
import type { FlashItem } from '../../../components/page-flash';
import type { DbInstance } from '../api';
import {
  classError,
  IDENTIFIER_CONSTRAINT,
  identifierError,
  PASSWORD_CONSTRAINT,
  passwordError,
  storageError,
} from '../form';
import type { InstanceChanges } from '../modify-api';
import { ClassField, StorageField } from './create-fields';

interface ModifyInstanceDialogProps {
  instance: DbInstance;
  pending: boolean;
  failure: FlashItem | undefined;
  onSave: (changes: InstanceChanges) => void;
  onDismiss: () => void;
}

/** Mounted only while editing, so each opening starts with a fresh draft. */
export function ModifyInstanceDialog({ instance, pending, failure, onSave, onDismiss }: ModifyInstanceDialogProps) {
  const originalClass = instance.instanceClass ?? '';
  const originalStorage = instance.allocatedStorage?.toString() ?? '';
  const originalProtection = instance.deletionProtection === true;
  const member = instance.clusterId !== undefined;

  const [identifier, setIdentifier] = useState(instance.id);
  const [instanceClass, setInstanceClass] = useState(originalClass);
  const [storage, setStorage] = useState(originalStorage);
  const [password, setPassword] = useState('');
  const [protection, setProtection] = useState(originalProtection);
  const saveRef = useRef<ButtonProps.Ref>(null);
  const failureRef = useRef<AlertProps.Ref>(null);
  useEffect(() => {
    // Hiding Close changes the modal's autofocus target. Keep focus on the loading Save button.
    if (pending) saveRef.current?.focus();
    else if (failure !== undefined) failureRef.current?.focus();
  }, [pending, failure]);

  const renamed = identifier.toLowerCase() !== instance.id.toLowerCase();
  const errors = {
    identifier: renamed ? identifierError(identifier) : undefined,
    instanceClass: instanceClass === originalClass ? undefined : classError(instanceClass),
    storage: member || storage === originalStorage ? undefined : storageError(storage),
    password: member || password === '' ? undefined : passwordError(password),
  };
  const changes: InstanceChanges = {};
  if (renamed && errors.identifier === undefined) changes.identifier = identifier;
  if (instanceClass !== originalClass) changes.instanceClass = instanceClass;
  if (!member && storage !== originalStorage && Number(storage) !== instance.allocatedStorage) {
    changes.allocatedStorage = Number(storage);
  }
  if (!member && password !== '') changes.masterPassword = password;
  if (protection !== originalProtection) changes.deletionProtection = protection;

  const canSave =
    !pending && Object.keys(changes).length > 0 && Object.values(errors).every((error) => error === undefined);

  return (
    <AreaModal
      visible
      header="Modify DB instance"
      closeAriaLabel="Close"
      hideDismissButton={pending}
      onDismiss={() => {
        if (!pending) onDismiss();
      }}
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button id="rds-modify-cancel" variant="link" disabled={pending} onClick={onDismiss}>
              Cancel
            </Button>
            <Button
              ref={saveRef}
              id="rds-modify-save"
              variant="primary"
              loading={pending}
              loadingText="Saving changes"
              disabled={!pending && !canSave}
              onClick={() => {
                if (canSave) onSave(changes);
              }}
            >
              Save changes
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <fieldset disabled={pending} style={{ border: 0, margin: 0, padding: 0, minInlineSize: 0 }}>
        <SpaceBetween size="m">
          {failure !== undefined && (
            <Alert ref={failureRef} type={failure.type} header={failure.header}>
              {failure.content}
            </Alert>
          )}
          <FormField
            label="DB instance identifier"
            description={
              changes.identifier === undefined
                ? undefined
                : 'After saving, the old identifier will stop resolving. Studio will open the renamed DB instance.'
            }
            constraintText={IDENTIFIER_CONSTRAINT}
            errorText={errors.identifier}
          >
            <Input
              value={identifier}
              invalid={errors.identifier !== undefined}
              autoComplete={false}
              spellcheck={false}
              onChange={({ detail }) => {
                setIdentifier(detail.value);
              }}
            />
          </FormField>
          <ClassField value={instanceClass} error={errors.instanceClass} onChange={setInstanceClass} />
          {member && (
            <Box id="rds-modify-cluster-guidance" variant="p">
              The cluster manages storage and master credentials.
            </Box>
          )}
          {!member && <StorageField value={storage} error={errors.storage} onChange={setStorage} />}
          {!member && (
            <FormField
              label="New master password"
              description="Leave blank to keep the current password."
              constraintText={PASSWORD_CONSTRAINT}
              errorText={errors.password}
            >
              <Input
                type="password"
                value={password}
                spellcheck={false}
                autoComplete="new-password"
                invalid={errors.password !== undefined}
                onChange={({ detail }) => {
                  setPassword(detail.value);
                }}
              />
            </FormField>
          )}
          <Checkbox
            checked={protection}
            disabled={pending}
            onChange={({ detail }) => {
              setProtection(detail.checked);
            }}
          >
            Deletion protection
          </Checkbox>
        </SpaceBetween>
      </fieldset>
    </AreaModal>
  );
}
