import { ConfirmDialog } from '../../../components/confirm-dialog';
import { ValueText } from '../../../components/value-text';
import type { SecurityGroupRule } from '../group-api';
import { ruleSentence } from '../group-format';

// "Delete rule?" (issue 553, requirement "Delete a rule"): the area's dialog confirmed by typing `delete`, naming the
// rule by its direction, protocol, ports and source or destination, and the group, in the words of S6's table.

export interface DeleteRuleDialogProps {
  /** The rule to delete; none while the dialog is closed. */
  rule: SecurityGroupRule | undefined;
  /** The group's name. */
  groupName: string;
  /** The revoke is in flight: neither button acts. */
  pending: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
}

export function DeleteRuleDialog({ rule, groupName, pending, onConfirm, onDismiss }: DeleteRuleDialogProps) {
  return (
    <ConfirmDialog
      visible={rule !== undefined}
      header="Delete rule?"
      body={rule === undefined ? null : <ValueText kind="text" value={ruleSentence(rule, groupName)} />}
      word="delete"
      action="Delete"
      pending={pending}
      onConfirm={onConfirm}
      onDismiss={onDismiss}
    />
  );
}
