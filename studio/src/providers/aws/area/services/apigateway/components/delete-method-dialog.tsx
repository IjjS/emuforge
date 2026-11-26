import { ValueText } from '../../../components/value-text';
import { useDeleteMethod } from '../rest-change-queries';
import { RestDeleteDialog } from './delete-resource-dialog';

interface DeleteMethodDialogProps {
  endpoint: string | undefined;
  apiId: string;
  resourceId: string;
  path: string;
  method: string;
  onDeleted: () => void;
  onDismiss: () => void;
}

export function DeleteMethodDialog({
  endpoint,
  apiId,
  resourceId,
  path,
  method,
  onDeleted,
  onDismiss,
}: DeleteMethodDialogProps) {
  const change = useDeleteMethod(endpoint, apiId, onDeleted);
  return (
    <RestDeleteDialog
      header={
        <>
          Delete method <ValueText kind="fixed" value={method} /> <ValueText kind="address" value={path} />?
        </>
      }
      sentence="It cannot be undone."
      word="delete"
      endpoint={endpoint}
      change={change}
      onConfirm={() => change.submit({ resourceId, method })}
      onDismiss={onDismiss}
    />
  );
}
