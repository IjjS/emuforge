import { ConfirmDialog } from '../../../components/confirm-dialog';
import type { AreaConnection } from '../../../components/emulator-line';
import { usePageFlash, type FlashResult } from '../../../components/page-flash';
import { ValueText } from '../../../components/value-text';
import type { DeletePolicyStep, PolicyEntity } from '../api';
import { POLICIES_PATH } from '../format';
import { failureOf, useDeletePolicy, usePolicy } from '../queries';
import { actionFailureItem } from './failures';

// "Delete" of a customer managed policy (issue 535, design "Task 6", point 6), on the area's `ConfirmDialog`: the body
// names what the policy is attached to, as the page's read holds it, or as the dialog reads it itself on the policy
// list. Deleting reads them afresh, so one attached since is detached too. The result is shown once the emulator has
// answered, never before: on the policy list there, from the policy's page on the list it leads to; a failed step in
// the area's Flashbar of the page the dialog was opened on.

/** The word the field must hold exactly. */
const CONFIRM_WORD = 'delete';

/** An entity's kind, as the page names it. */
const ENTITY_KIND_TEXT: Readonly<Record<PolicyEntity['kind'], string>> = {
  role: 'Role',
  user: 'User',
  group: 'Group',
};

/** The step of deleting a policy that was refused, in words. */
function deleteStepText(step: DeletePolicyStep): string {
  switch (step.kind) {
    case 'read-entities':
      return 'Reading what the policy is attached to';
    case 'read-versions':
      return "Reading the policy's versions";
    case 'detach':
      return `Detaching it from ${step.entity.name}`;
    case 'delete-version':
      return `Deleting version ${step.versionId}`;
    case 'delete-policy':
      return 'Deleting the policy';
  }
}

/** The result shown once the policy is deleted. */
function deletedPolicyResult(name: string): FlashResult {
  return [{ type: 'success', content: `Policy ${name} deleted.` }];
}

/**
 * "It is first detached from {n} entities:" and each entity with its kind; nothing for none. Inline text only: the
 * area's dialog holds its body in one paragraph.
 */
function EntitiesLine({ entities }: { entities: readonly PolicyEntity[] }) {
  if (entities.length === 0) {
    return null;
  }
  const count = entities.length === 1 ? '1 entity' : `${String(entities.length)} entities`;
  return (
    <span className="aws-iam-policy-entities">
      {`It is first detached from ${count}: `}
      {entities.map((entity, index) => (
        <span key={`${entity.kind}:${entity.name}`}>
          {index > 0 && ', '}
          <ValueText kind="name" value={entity.name} /> ({ENTITY_KIND_TEXT[entity.kind]})
        </span>
      ))}
      .
    </span>
  );
}

/** The entities the dialog reads itself when it is opened from the policy list. */
function ReadEntities({ arn, connection }: { arn: string; connection: AreaConnection }) {
  const query = usePolicy({ endpoint: connection.engineOrigin, arn });
  if (query.loading || query.read === undefined) {
    return query.failure === undefined ? <span>Reading what the policy is attached to.</span> : null;
  }
  if (query.read.kind !== 'found' || query.read.entities.kind !== 'read') {
    return null;
  }
  return <EntitiesLine entities={query.read.entities.items} />;
}

export interface DeletePolicyDialogProps {
  policy: { arn: string; name: string };
  /** What the policy is attached to as the page read it; the dialog reads it itself when not given. */
  entities?: readonly PolicyEntity[] | undefined;
  /** Where the dialog was opened: the list shows the result itself; the policy's page leads to the list with it. */
  from: 'list' | 'page';
  connection: AreaConnection;
  /** Called when the dialog closes: "Cancel", Esc, or the emulator's answer. */
  onClose: () => void;
}

/** The dialog "Delete {name}?". */
export function DeletePolicyDialog({ policy, entities, from, connection, onClose }: DeletePolicyDialogProps) {
  const flash = usePageFlash();
  const engineOrigin = connection.engineOrigin;
  const remove = useDeletePolicy(engineOrigin);

  const handleConfirm = () => {
    remove.mutate(policy.arn, {
      onSuccess: (result) => {
        if (result.kind === 'deleted') {
          if (from === 'page') {
            flash.handOver(POLICIES_PATH, deletedPolicyResult(policy.name));
          } else {
            flash.show(deletedPolicyResult(policy.name));
          }
        } else {
          flash.show([actionFailureItem(result.failure, deleteStepText(result.step), engineOrigin)]);
        }
        onClose();
      },
      onError: (error) => {
        flash.show([actionFailureItem(failureOf(error), 'Deleting the policy', engineOrigin)]);
        onClose();
      },
    });
  };

  return (
    <ConfirmDialog
      visible
      header={`Delete ${policy.name}?`}
      body={
        <>
          The policy and every version of it are removed from the local emulator. This cannot be undone.{' '}
          {entities === undefined ? (
            <ReadEntities arn={policy.arn} connection={connection} />
          ) : (
            <EntitiesLine entities={entities} />
          )}
        </>
      }
      word={CONFIRM_WORD}
      action="Delete"
      pending={remove.isPending}
      onConfirm={handleConfirm}
      onDismiss={onClose}
    />
  );
}
