import { useLanguage } from '../../i18n/language-context';
import { InlineCode } from '../../ui/command';

/** What the engine answered instead of a call's success: its status, and its code and message when it gave them. */
export interface EngineAnswerError {
  status: number;
  code: string | undefined;
  message: string | undefined;
}

/**
 * The engine's error as the page says it (requirement R8): "answered with an error: {code}" and its message as text,
 * in English as it came; without a code, "answered with HTTP status {status}".
 */
export function EngineErrorText({ error }: { error: EngineAnswerError }) {
  const { t } = useLanguage();
  if (error.code === undefined) {
    return <>{t('connections.engineErrorStatus', { status: String(error.status) })}</>;
  }
  return (
    <>
      {t('connections.engineErrorCode', { code: <InlineCode>{error.code}</InlineCode> })}
      {error.message !== undefined && error.message !== '' && (
        <span className="st-engine-message" lang="en">
          {error.message}
        </span>
      )}
    </>
  );
}
