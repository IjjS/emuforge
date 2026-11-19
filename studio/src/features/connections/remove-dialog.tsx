import { useRef } from 'react';

import { useLanguage } from '../../i18n/language-context';
import { ActionButton } from '../../ui/action-button';
import { Dialog } from '../../ui/dialog';

interface RemoveDialogProps {
  name: string;
  removing: boolean;
  onConfirm: () => void;
  /** "Cancel", "Close" and Escape: nothing is sent. */
  onCancel: () => void;
}

/** The question before a remove (requirement R5): "Remove {name}?", what it does and does not touch, and the choice. */
export function RemoveDialog({ name, removing, onConfirm, onCancel }: RemoveDialogProps) {
  const { t } = useLanguage();
  const cancel = useRef<HTMLButtonElement>(null);
  return (
    <Dialog
      title={t('connections.remove.title', { name })}
      closeLabel={t('connections.dialog.close')}
      onClose={onCancel}
      initialFocus={cancel}
      actions={
        <>
          <ActionButton ref={cancel} onClick={onCancel}>
            {t('connections.remove.cancel')}
          </ActionButton>
          <ActionButton primary busy={removing} onClick={onConfirm}>
            {t(removing ? 'connections.removing' : 'connections.remove.confirm')}
          </ActionButton>
        </>
      }
    >
      <p>{t('connections.remove.body')}</p>
    </Dialog>
  );
}
