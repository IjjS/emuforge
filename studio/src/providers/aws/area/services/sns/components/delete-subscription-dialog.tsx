import { ConfirmDialog } from '../../../components/confirm-dialog';
import { ValueText } from '../../../components/value-text';

// "Delete subscription?" (issue 536, design task 5 step 1), from S3's "Subscriptions": the area's `ConfirmDialog`,
// confirmed by typing `delete`. It names the endpoint and the topic and says the queue's policy or the function's
// permission is left as it is.

export interface DeleteSubscriptionDialogProps {
  visible: boolean;
  /** The endpoint's name. */
  endpointName: string;
  /** The topic's name. */
  topicName: string;
  /** `Unsubscribe` is in flight: neither button acts, and the dialog stays. */
  pending: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
}

export function DeleteSubscriptionDialog({
  visible,
  endpointName,
  topicName,
  pending,
  onConfirm,
  onDismiss,
}: DeleteSubscriptionDialogProps) {
  return (
    <ConfirmDialog
      visible={visible}
      header="Delete subscription?"
      body={
        <>
          <ValueText kind="text" value="The subscription of " />
          <ValueText kind="name" value={endpointName} />
          <ValueText kind="text" value=" to " />
          <ValueText kind="name" value={topicName} />
          <ValueText kind="text" value=" is deleted. The policy of the queue or the function is left as it is." />
        </>
      }
      word="delete"
      action="Delete"
      pending={pending}
      onConfirm={onConfirm}
      onDismiss={onDismiss}
    />
  );
}
