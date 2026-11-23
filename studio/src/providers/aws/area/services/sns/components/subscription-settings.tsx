import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import Select from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Textarea from '@cloudscape-design/components/textarea';
import { useState } from 'react';

import { AreaModal } from '../../../components/area-modal';
import { CopyValue } from '../../../components/copy-value';
import type { AreaConnection } from '../../../components/emulator-line';
import { ReadFailure, readFailureState } from '../../../components/failure-states';
import { ValueText } from '../../../components/value-text';
import type { Subscription, SubscriptionSetting, SubscriptionSettingsAttributes } from '../api';
import { useSubscriptionSettings } from '../queries';

const SCOPE_OPTIONS = [
  { value: 'MessageAttributes', label: 'Message attributes' },
  { value: 'MessageBody', label: 'Message body' },
] as const;

const RAW_OPTIONS = [
  { value: 'true', label: 'On' },
  { value: 'false', label: 'Off' },
] as const;

interface SubscriptionSettingsProps {
  subscription: Subscription;
  connection: AreaConnection;
  pending: { arn: string; setting: SubscriptionSetting } | undefined;
  saveUnavailable: boolean;
  onSave: (arn: string, setting: SubscriptionSetting) => Promise<void>;
  onClose: () => void;
}

interface SettingsFieldsProps {
  settings: SubscriptionSettingsAttributes;
  arn: string;
  disabled: boolean;
  saving: SubscriptionSetting | undefined;
  onSave: (setting: SubscriptionSetting) => void;
}

function SettingsFields({ settings, arn, disabled, saving, onSave }: SettingsFieldsProps) {
  const [read, setRead] = useState(settings);
  const [policyDraft, setPolicyDraft] = useState<string>();
  const [scopeDraft, setScopeDraft] = useState<(typeof SCOPE_OPTIONS)[number]>();
  const [rawDraft, setRawDraft] = useState<(typeof RAW_OPTIONS)[number]>();
  const [clearOpen, setClearOpen] = useState(false);
  if (settings !== read) {
    setRead(settings);
    setPolicyDraft(undefined);
    setScopeDraft(undefined);
    setRawDraft(undefined);
    setClearOpen(false);
  }
  const policy = policyDraft ?? settings.FilterPolicy ?? '';
  const hasPolicy = settings.FilterPolicy !== undefined;
  const currentScope = hasPolicy ? settings.FilterPolicyScope : undefined;
  const scope = scopeDraft ?? SCOPE_OPTIONS.find(({ value }) => value === currentScope);
  const raw = rawDraft ?? RAW_OPTIONS.find(({ value }) => value === settings.RawMessageDelivery);

  return (
    <SpaceBetween size="l">
      <SpaceBetween size="xs">
        <FormField
          label="Filter policy"
          description={
            !hasPolicy ? (
              'No filter policy'
            ) : policy !== settings.FilterPolicy ? (
              <>
                Current policy <ValueText kind="text" value={settings.FilterPolicy} />
              </>
            ) : undefined
          }
        >
          <Textarea
            value={policy}
            disabled={disabled}
            onChange={({ detail }) => {
              setPolicyDraft(detail.value);
            }}
          />
        </FormField>
        <SpaceBetween direction="horizontal" size="xs">
          <Button
            disabled={disabled || policy === '' || policy === settings.FilterPolicy}
            loading={saving?.name === 'FilterPolicy' && saving.value !== ''}
            onClick={() => {
              onSave({ name: 'FilterPolicy', value: policy });
            }}
          >
            Save filter policy
          </Button>
          <Button
            disabled={disabled || !hasPolicy}
            loading={saving?.name === 'FilterPolicy' && saving.value === ''}
            onClick={() => {
              setClearOpen(true);
            }}
          >
            Clear filter policy
          </Button>
        </SpaceBetween>
      </SpaceBetween>
      <SpaceBetween size="xs">
        <FormField label="Filter policy scope">
          <Select
            options={SCOPE_OPTIONS}
            selectedOption={scope ?? null}
            placeholder={currentScope ?? 'Not set'}
            disabled={disabled || !hasPolicy}
            onChange={({ detail }) => {
              setScopeDraft(SCOPE_OPTIONS.find(({ value }) => value === detail.selectedOption.value));
            }}
          />
        </FormField>
        <Button
          disabled={disabled || scope === undefined || !hasPolicy || scope.value === currentScope}
          loading={saving?.name === 'FilterPolicyScope'}
          onClick={() => {
            if (scope !== undefined) {
              onSave({ name: 'FilterPolicyScope', value: scope.value });
            }
          }}
        >
          Save scope
        </Button>
      </SpaceBetween>
      <SpaceBetween size="xs">
        <FormField label="Raw message delivery">
          <Select
            options={RAW_OPTIONS}
            selectedOption={raw ?? null}
            placeholder={settings.RawMessageDelivery ?? 'Not set'}
            disabled={disabled}
            onChange={({ detail }) => {
              setRawDraft(RAW_OPTIONS.find(({ value }) => value === detail.selectedOption.value));
            }}
          />
        </FormField>
        <Button
          disabled={disabled || raw === undefined || raw.value === settings.RawMessageDelivery}
          loading={saving?.name === 'RawMessageDelivery'}
          onClick={() => {
            if (raw !== undefined) {
              onSave({ name: 'RawMessageDelivery', value: raw.value });
            }
          }}
        >
          Save raw message delivery
        </Button>
      </SpaceBetween>
      <AreaModal
        visible={clearOpen}
        header="Clear filter policy?"
        closeAriaLabel="Close dialog"
        onDismiss={() => {
          setClearOpen(false);
        }}
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button
                variant="link"
                onClick={() => {
                  setClearOpen(false);
                }}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                disabled={disabled}
                onClick={() => {
                  setClearOpen(false);
                  onSave({ name: 'FilterPolicy', value: '' });
                }}
              >
                Clear filter policy
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="xs">
          <Box variant="p">
            Clear the filter policy for this subscription? Its filter policy scope will also be removed.
          </Box>
          <ValueText kind="address" value={arn} />
        </SpaceBetween>
      </AreaModal>
    </SpaceBetween>
  );
}

export function SubscriptionSettings({
  subscription,
  connection,
  pending,
  saveUnavailable,
  onSave,
  onClose,
}: SubscriptionSettingsProps) {
  const { arn, endpoint } = subscription;
  const { value, failure, loading, refresh } = useSubscriptionSettings(connection.engineOrigin, arn);
  const failureState =
    failure === undefined ? undefined : readFailureState(failure, connection, 'subscription settings');
  const readUnavailable = failure?.kind === 'not-implemented';
  const disabled = loading || failure !== undefined || pending !== undefined || saveUnavailable;

  return (
    <Container
      header={
        <Header
          variant="h2"
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button onClick={refresh} disabled={readUnavailable || loading}>
                Refresh
              </Button>
              <Button onClick={onClose}>Close</Button>
            </SpaceBetween>
          }
        >
          Subscription settings
        </Header>
      }
    >
      <SpaceBetween size="l">
        <KeyValuePairs
          columns={2}
          minColumnWidth={260}
          items={[
            { label: 'Subscription ARN', value: <CopyValue label="Subscription ARN" value={arn} kind="address" /> },
            { label: 'Endpoint', value: <CopyValue label="Endpoint" value={endpoint} kind="address" /> },
          ]}
        />
        {loading && <StatusIndicator type="loading">Loading subscription settings</StatusIndicator>}
        {!loading &&
          failureState !== undefined &&
          (readUnavailable ? (
            <SpaceBetween size="xxs">
              <StatusIndicator type={failureState.type}>{failureState.first}</StatusIndicator>
              <Box variant="p">{failureState.detail}</Box>
            </SpaceBetween>
          ) : (
            <ReadFailure state={failureState} onRetry={refresh} />
          ))}
        {value !== undefined && (
          <SettingsFields
            settings={value}
            arn={arn}
            disabled={disabled}
            saving={pending?.arn === arn ? pending.setting : undefined}
            onSave={(setting) => {
              if (!disabled) {
                void onSave(arn, setting);
              }
            }}
          />
        )}
      </SpaceBetween>
    </Container>
  );
}
