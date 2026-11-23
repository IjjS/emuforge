export type SecretDraft = { format: 'string'; text: string } | { format: 'binary'; file: File | undefined };

export function hasValue(draft: SecretDraft): boolean {
  return draft.format === 'string' ? draft.text !== '' : draft.file !== undefined;
}

export async function secretValueInput(draft: SecretDraft, signal: AbortSignal) {
  if (draft.format === 'string') return { SecretString: draft.text };
  if (draft.file === undefined) throw new Error('Choose a file.');
  const bytes = new Uint8Array(await draft.file.arrayBuffer());
  signal.throwIfAborted();
  return { SecretBinary: bytes };
}
