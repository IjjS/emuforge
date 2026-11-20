import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { fireEvent, render, screen, within } from '@testing-library/react';
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

const IDENTIFIER = 'DB instance identifier';
const CLASS = 'DB instance class';
const STORAGE = 'Allocated storage (GiB)';
const PASSWORD = 'New master password';
const PROTECTION = 'Deletion protection';
const RENAME_GUIDANCE =
  'After saving, the old identifier will stop resolving. Studio will open the renamed DB instance.';
type Field = typeof IDENTIFIER | typeof CLASS | typeof STORAGE | typeof PASSWORD;

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

function field(label: Field) {
  return within(screen.getByRole('dialog')).getByLabelText(label) as HTMLInputElement;
}

function change(label: Field, value: string) {
  fireEvent.change(field(label), { target: { value } });
}

function protection() {
  return within(screen.getByRole('dialog')).getByRole('checkbox', { name: PROTECTION });
}

function save() {
  return createWrapper(document.body)
    .findModal()
    ?.findFooter()
    ?.findButton('[class*="variant-primary"]')
    ?.getElement() as HTMLButtonElement;
}

describe('Modify DB instance', () => {
  it('U1 opens a standalone instance with its settings and a fresh masked password', async () => {
    const onSave = open();
    const dialog = await screen.findByRole('dialog', { name: 'Modify DB instance' });
    expect(field(IDENTIFIER)).toHaveValue('app-db');
    expect(field(CLASS)).toHaveValue('db.t3.micro');
    expect(field(STORAGE)).toHaveValue('20');
    expect(field(PASSWORD)).toHaveAttribute('type', 'password');
    expect(field(PASSWORD)).toHaveValue('');
    expect(within(dialog).getByText('Leave blank to keep the current password.')).toBeInTheDocument();
    expect(protection()).toBeChecked();
    expect(save()).toBeDisabled();
    fireEvent.click(save());
    expect(onSave).not.toHaveBeenCalled();
  });

  it('U2 sends only the field changed and disables saving when reverted', async () => {
    const onSave = open();
    await screen.findByRole('dialog');
    const edits = [
      [IDENTIFIER, 'new-db', 'app-db', { identifier: 'new-db' }],
      [CLASS, 'db.t3.small', 'db.t3.micro', { instanceClass: 'db.t3.small' }],
      [STORAGE, '30', '20', { allocatedStorage: 30 }],
      [PASSWORD, 'DemoPass!234', '', { masterPassword: 'DemoPass!234' }],
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
    [IDENTIFIER, '9bad', 'An identifier begins with a letter.', 'good-db'],
    [CLASS, '', 'Enter a class.', 'db.t3.small'],
    [STORAGE, '25.5', 'The storage is a whole number from 20 to 65536.', '30'],
    [STORAGE, '65537', 'The storage is a whole number from 20 to 65536.', '30'],
    [PASSWORD, 'short', 'A master password has at least 8 characters.', 'DemoPass!234'],
  ] as const)('U3 blocks invalid %s (%s) and permits a correction', async (label, invalid, error, valid) => {
    const onSave = open();
    await screen.findByRole('dialog');
    change(label, invalid);
    expect(field(label)).toHaveAccessibleDescription(expect.stringContaining(error));
    expect(save()).toBeDisabled();
    fireEvent.click(save());
    expect(onSave).not.toHaveBeenCalled();
    change(label, valid);
    expect(screen.queryByText(error)).toBeNull();
    expect(save()).toBeEnabled();
  });

  it('U4 cancels the draft and opens with the original settings', async () => {
    const onSave = open();
    const dialog = await screen.findByRole('dialog');
    change(IDENTIFIER, 'draft-db');
    change(CLASS, 'db.t3.small');
    change(STORAGE, '30');
    change(PASSWORD, 'DemoPass!234');
    fireEvent.click(protection());
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Modify' }));
    await screen.findByRole('dialog');
    expect(field(IDENTIFIER)).toHaveValue('app-db');
    expect(field(CLASS)).toHaveValue('db.t3.micro');
    expect(field(STORAGE)).toHaveValue('20');
    expect(field(PASSWORD)).toHaveValue('');
    expect(protection()).toBeChecked();
    expect(save()).toBeDisabled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('U5 offers only the settings owned by a cluster member', async () => {
    const onSave = open({ ...INSTANCE, clusterId: 'app-cluster' });
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('The cluster manages storage and master credentials.')).toBeInTheDocument();
    expect(within(dialog).queryByLabelText(STORAGE)).toBeNull();
    expect(within(dialog).queryByLabelText(PASSWORD)).toBeNull();
    change(IDENTIFIER, 'new-member');
    change(CLASS, 'db.r6g.xlarge');
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
    await screen.findByRole('dialog');
    expect(field(IDENTIFIER)).toHaveValue('legacy_db');
    expect(field(STORAGE)).toHaveValue('5');
    fireEvent.click(protection());
    fireEvent.click(save());
    expect(onSave).toHaveBeenCalledExactlyOnceWith({ deletionProtection: false });
  });

  it('describes what happens to the old identifier only for a valid rename', async () => {
    open();
    await screen.findByRole('dialog');
    expect(screen.queryByText(RENAME_GUIDANCE)).toBeNull();
    change(IDENTIFIER, '9bad');
    expect(screen.queryByText(RENAME_GUIDANCE)).toBeNull();
    change(IDENTIFIER, 'renamed-db');
    expect(field(IDENTIFIER)).toHaveAccessibleDescription(expect.stringContaining(RENAME_GUIDANCE));
    change(IDENTIFIER, 'app-db');
    expect(screen.queryByText(RENAME_GUIDANCE)).toBeNull();
  });

  it('treats a case-only identifier edit as unchanged while allowing an independent edit', async () => {
    const onSave = open();
    await screen.findByRole('dialog');
    change(IDENTIFIER, 'APP-DB');
    expect(field(IDENTIFIER)).toHaveValue('APP-DB');
    expect(screen.queryByText(RENAME_GUIDANCE)).toBeNull();
    expect(save()).toBeDisabled();
    fireEvent.click(save());
    expect(onSave).not.toHaveBeenCalled();

    change(CLASS, 'db.t3.small');
    expect(save()).toBeEnabled();
    fireEvent.click(save());
    expect(onSave).toHaveBeenCalledExactlyOnceWith({ instanceClass: 'db.t3.small' });
    expect(screen.queryByText(RENAME_GUIDANCE)).toBeNull();
  });
});
