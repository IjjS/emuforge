import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { AreaRootContext } from '../../../area-root';
import type { DbInstance } from '../api';
import { ModifyInstanceDialog } from './modify-instance-dialog';

const INSTANCE: DbInstance = {
  id: 'app-db',
  status: 'available',
  instanceClass: 'db.t3.micro',
  allocatedStorage: 20,
  deletionProtection: true,
  parameterGroups: [],
  securityGroups: [],
  tags: [],
};

const MODIFY_FIELD_LABELS = {
  identifier: 'DB instance identifier',
  class: 'DB instance class',
  storage: 'Allocated storage (GiB)',
  password: 'New master password',
} as const;
const PAGE = createWrapper(document.body);
const RENAME_GUIDANCE =
  'After saving, the old identifier will stop resolving. Studio will open the renamed DB instance.';
type Field = keyof typeof MODIFY_FIELD_LABELS;

function open(instance = INSTANCE) {
  const onSave = vi.fn();
  function InArea() {
    const root = useRef<HTMLDivElement>(null);
    const [editing, setEditing] = useState(true);
    return (
      <div ref={root}>
        <AreaRootContext value={root}>
          <button onClick={() => setEditing(true)}>Modify</button>
          {editing && (
            <ModifyInstanceDialog
              instance={instance}
              pending={false}
              failure={undefined}
              onSave={onSave}
              onDismiss={() => setEditing(false)}
            />
          )}
        </AreaRootContext>
      </div>
    );
  }
  render(<InArea />);
  return onSave;
}

async function opened() {
  await waitFor(() => {
    expect(PAGE.findModal()?.findHeader().getElement()).toHaveTextContent('Modify DB instance');
  });
}

function formField(field: Field) {
  const content = PAGE.findModal()?.findContent();
  const selector = `#rds-modify-field-${field}`;
  const wrapper = content?.findFormField(selector) ?? content?.find(selector)?.findFormField();
  if (wrapper != null) {
    expect(wrapper.findLabel()?.getElement().textContent?.trim()).toBe(MODIFY_FIELD_LABELS[field]);
  }
  return wrapper ?? undefined;
}

function input(field: Field) {
  const input = formField(field)?.findControl()?.findInput()?.findNativeInput().getElement();
  if (input === undefined) throw new Error(`Missing input: ${field}`);
  return input;
}

function change(field: Field, value: string) {
  fireEvent.change(input(field), { target: { value } });
}

function protection() {
  const checkbox = PAGE.findModal()?.findContent().findCheckbox();
  expect(checkbox?.findLabel().getElement()).toHaveTextContent('Deletion protection');
  return checkbox?.findNativeInput().getElement() as HTMLInputElement;
}

function save() {
  const button = PAGE.findModal()?.findFooter()?.findButton('#rds-modify-save')?.getElement();
  expect(button).toHaveTextContent('Save changes');
  return button as HTMLButtonElement;
}

function renameGuidance() {
  return formField('identifier')?.findDescription()?.getElement();
}

describe('Modify DB instance', () => {
  it('U1 opens a standalone instance with its settings and a fresh masked password', async () => {
    const onSave = open();
    await opened();
    expect(input('identifier')).toHaveValue('app-db');
    expect(input('class')).toHaveValue('db.t3.micro');
    expect(input('storage')).toHaveValue('20');
    expect(input('password')).toHaveAttribute('type', 'password');
    expect(input('password')).toHaveValue('');
    expect(formField('password')?.findDescription()?.getElement()).toHaveTextContent(
      'Leave blank to keep the current password.',
    );
    expect(protection()).toBeChecked();
    expect(save()).toBeDisabled();
    fireEvent.click(save());
    expect(onSave).not.toHaveBeenCalled();
  });

  it('U2 sends only the field changed and disables saving when reverted', async () => {
    const onSave = open();
    await opened();
    const edits = [
      ['identifier', 'new-db', 'app-db', { identifier: 'new-db' }],
      ['class', 'db.t3.small', 'db.t3.micro', { instanceClass: 'db.t3.small' }],
      ['storage', '30', '20', { allocatedStorage: 30 }],
      ['password', 'DemoPass!234', '', { masterPassword: 'DemoPass!234' }],
    ] as const;
    for (const [label, value, original, expected] of edits) {
      change(label, value);
      expect(save()).toBeEnabled();
      fireEvent.click(save());
      expect(onSave).toHaveBeenLastCalledWith(expected);
      change(label, original);
      expect(save()).toBeDisabled();
    }
    fireEvent.click(protection());
    fireEvent.click(save());
    expect(onSave).toHaveBeenLastCalledWith({ deletionProtection: false });
    fireEvent.click(protection());
    expect(save()).toBeDisabled();
    expect(onSave).toHaveBeenCalledTimes(5);
  });

  it.each([
    ['identifier', '9bad', 'An identifier begins with a letter.', 'good-db'],
    ['class', '', 'Enter a class.', 'db.t3.small'],
    ['storage', '25.5', 'The storage is a whole number from 20 to 65536.', '30'],
    ['storage', '65537', 'The storage is a whole number from 20 to 65536.', '30'],
    ['password', 'short', 'A master password has at least 8 characters.', 'DemoPass!234'],
  ] as const)('U3 blocks invalid %s (%s) and permits a correction', async (label, invalid, error, valid) => {
    const onSave = open();
    await opened();
    change(label, invalid);
    expect(formField(label)?.findError()?.getElement()).toHaveTextContent(error);
    expect(input(label)).toHaveAccessibleDescription(expect.stringContaining(error));
    expect(save()).toBeDisabled();
    fireEvent.click(save());
    expect(onSave).not.toHaveBeenCalled();
    change(label, valid);
    expect(formField(label)?.findError()).toBeNull();
    expect(save()).toBeEnabled();
  });

  it('U4 cancels the draft and opens with the original settings', async () => {
    const onSave = open();
    await opened();
    change('identifier', 'draft-db');
    change('class', 'db.t3.small');
    change('storage', '30');
    change('password', 'DemoPass!234');
    fireEvent.click(protection());
    const cancel = PAGE.findModal()?.findFooter()?.findButton('#rds-modify-cancel')?.getElement();
    expect(cancel).toHaveTextContent('Cancel');
    fireEvent.click(cancel as HTMLElement);
    expect(PAGE.findModal()).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Modify' }));
    await opened();
    expect(input('identifier')).toHaveValue('app-db');
    expect(input('class')).toHaveValue('db.t3.micro');
    expect(input('storage')).toHaveValue('20');
    expect(input('password')).toHaveValue('');
    expect(protection()).toBeChecked();
    expect(save()).toBeDisabled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('U5 offers only the settings owned by a cluster member', async () => {
    const onSave = open({ ...INSTANCE, clusterId: 'app-cluster' });
    await opened();
    expect(PAGE.findModal()?.findContent().find('#rds-modify-cluster-guidance')?.getElement()).toHaveTextContent(
      'The cluster manages storage and master credentials.',
    );
    expect(formField('storage')).toBeUndefined();
    expect(formField('password')).toBeUndefined();
    change('identifier', 'new-member');
    change('class', 'db.r6g.xlarge');
    fireEvent.click(protection());
    fireEvent.click(save());
    expect(onSave).toHaveBeenCalledExactlyOnceWith({
      identifier: 'new-member',
      instanceClass: 'db.r6g.xlarge',
      deletionProtection: false,
    });
  });

  it('U6 allows an independent edit with unchanged legacy settings', async () => {
    const onSave = open({ ...INSTANCE, id: 'legacy_db', allocatedStorage: 5 });
    await opened();
    expect(input('identifier')).toHaveValue('legacy_db');
    expect(input('storage')).toHaveValue('5');
    fireEvent.click(protection());
    fireEvent.click(save());
    expect(onSave).toHaveBeenCalledExactlyOnceWith({ deletionProtection: false });
  });

  it('describes what happens to the old identifier only for a valid rename', async () => {
    open();
    await opened();
    expect(renameGuidance()).toBeUndefined();
    change('identifier', '9bad');
    expect(renameGuidance()).toBeUndefined();
    change('identifier', 'renamed-db');
    expect(renameGuidance()).toHaveTextContent(RENAME_GUIDANCE);
    expect(input('identifier')).toHaveAccessibleDescription(expect.stringContaining(RENAME_GUIDANCE));
    change('identifier', 'app-db');
    expect(renameGuidance()).toBeUndefined();
  });

  it('treats a case-only identifier edit as unchanged while allowing an independent edit', async () => {
    const onSave = open();
    await opened();
    change('identifier', 'APP-DB');
    expect(input('identifier')).toHaveValue('APP-DB');
    expect(renameGuidance()).toBeUndefined();
    expect(save()).toBeDisabled();
    fireEvent.click(save());
    expect(onSave).not.toHaveBeenCalled();

    change('class', 'db.t3.small');
    expect(save()).toBeEnabled();
    fireEvent.click(save());
    expect(onSave).toHaveBeenCalledExactlyOnceWith({ instanceClass: 'db.t3.small' });
    expect(renameGuidance()).toBeUndefined();
  });
});
