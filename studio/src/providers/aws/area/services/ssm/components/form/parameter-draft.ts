import type { ParameterMetadata, ParameterType, PutParameterCommandInput } from '@aws-sdk/client-ssm';

export interface ParameterDraft {
  name: string;
  type: ParameterType;
  value: string;
  description: string;
  tier: 'Standard' | 'Advanced';
  keyId: string;
  pattern: string;
  policies: string;
}

export function policyObjects(text: string): string {
  const result: unknown = JSON.parse(text);
  if (
    !Array.isArray(result) ||
    !result.every((item: unknown) => item !== null && typeof item === 'object' && !Array.isArray(item))
  ) {
    throw new Error('Enter a JSON array of policy objects.');
  }
  return JSON.stringify(result);
}

function metadataPolicies(metadata: ParameterMetadata): string {
  const policies = metadata.Policies?.map(({ PolicyText }) => PolicyText ?? 'null') ?? [];
  return policies.length ? `[${policies.join(',')}]` : '';
}

export function initialDraft(name: string, metadata?: ParameterMetadata): ParameterDraft {
  const policies = metadata ? metadataPolicies(metadata) : '';
  let formatted = policies;
  try {
    if (policies) formatted = JSON.stringify(JSON.parse(policies), null, 2);
  } catch {
    // Keep the returned text visible so the user can correct it.
  }
  return {
    name,
    type: metadata?.Type ?? 'String',
    value: '',
    description: metadata?.Description ?? '',
    tier: metadata?.Tier === 'Advanced' ? 'Advanced' : 'Standard',
    keyId: metadata?.KeyId ?? '',
    pattern: metadata?.AllowedPattern ?? '',
    policies: formatted,
  };
}

export function createInput(draft: ParameterDraft, policies: string | undefined): PutParameterCommandInput {
  return {
    Name: draft.name,
    Value: draft.value,
    Type: draft.type,
    Tier: draft.tier,
    Description: draft.description || undefined,
    KeyId: draft.type === 'SecureString' ? draft.keyId.trim() || undefined : undefined,
    AllowedPattern: draft.pattern || undefined,
    Policies: policies,
    Overwrite: false,
  };
}

export function editInput(
  draft: ParameterDraft,
  initial: ParameterDraft,
  metadata: ParameterMetadata,
  policies: string | undefined,
): PutParameterCommandInput {
  const existingPolicies = metadataPolicies(metadata);
  return {
    Name: initial.name,
    Value: draft.value,
    Type: metadata.Type,
    Tier: metadata.Tier,
    KeyId: metadata.KeyId,
    DataType: metadata.DataType,
    Description: draft.description === initial.description ? metadata.Description : draft.description,
    AllowedPattern: draft.pattern === initial.pattern ? metadata.AllowedPattern : draft.pattern,
    Policies:
      draft.policies === initial.policies
        ? existingPolicies
          ? policyObjects(existingPolicies)
          : undefined
        : (policies ?? '[]'),
    Overwrite: true,
  };
}
