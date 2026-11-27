export interface SendForm {
  source: string;
  detailType: string;
  detail: string;
}

export const INITIAL_SEND_FORM: SendForm = { source: '', detailType: '', detail: '{}' };
export const SOURCE_CONSTRAINT = 'The source cannot start with aws.';
export const DETAIL_CONSTRAINT = 'Enter a JSON object.';

function isJsonObject(text: string): boolean {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  } catch {
    return false;
  }
}

export function validateSendForm({ source, detailType, detail }: SendForm): Partial<Record<keyof SendForm, string>> {
  const errors: Partial<Record<keyof SendForm, string>> = {};
  if (source.trim() === '') errors.source = 'Enter a source.';
  else if (source.startsWith('aws.')) errors.source = SOURCE_CONSTRAINT;
  if (detailType.trim() === '') errors.detailType = 'Enter a detail type.';
  if (!isJsonObject(detail)) errors.detail = DETAIL_CONSTRAINT;
  return errors;
}

export function sendEntry(bus: string, { source, detailType, detail }: SendForm) {
  return { EventBusName: bus, Source: source, DetailType: detailType, Detail: detail };
}
