import Box from '@cloudscape-design/components/box';
import Button, { type ButtonProps } from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import Select from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Textarea, { type TextareaProps } from '@cloudscape-design/components/textarea';
import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';

import { AreaModal } from '../../../components/area-modal';
import { CopyValue } from '../../../components/copy-value';
import type { AreaConnection } from '../../../components/emulator-line';
import { ReadFailure, readFailureState } from '../../../components/failure-states';
import { ValueText } from '../../../components/value-text';
import type { Subscription, SubscriptionSetting, SubscriptionSettingsAttributes } from '../api';
import { usePageSignal, useSubscriptionSettings } from '../queries';

const SCOPE_OPTIONS = [
  { value: 'MessageAttributes', label: 'Message attributes' },
  { value: 'MessageBody', label: 'Message body' },
] as const;

const RAW_OPTIONS = [
  { value: 'true', label: 'On' },
  { value: 'false', label: 'Off' },
] as const;

export interface FilterPolicyRecovery {
  signal: AbortSignal;
  showError: (detail: ReactNode) => void;
  focus: () => void;
}

interface SubscriptionSettingsProps {
  subscription: Subscription;
  connection: AreaConnection;
  pending: { arn: string; setting: SubscriptionSetting } | undefined;
  saveUnavailable: boolean;
  onSave: (arn: string, setting: SubscriptionSetting, recovery?: FilterPolicyRecovery) => Promise<boolean>;
  onClose: () => void;
}

interface SettingsFieldsProps {
  settings: SubscriptionSettingsAttributes;
  arn: string;
  disabled: boolean;
  saving: SubscriptionSetting | undefined;
  settingsClose: RefObject<ButtonProps.Ref | null>;
  onSave: (setting: SubscriptionSetting, recovery?: FilterPolicyRecovery) => Promise<boolean>;
}

type Drafts = Record<SubscriptionSetting['name'], string | undefined>;

function SettingsFields({ settings, arn, disabled, saving, settingsClose, onSave }: SettingsFieldsProps) {
  const policyInput = useRef<TextareaProps.Ref>(null);
  const clearOpener = useRef<ButtonProps.Ref>(null);
  const wasClearOpen = useRef(false);
  const editorSignal = usePageSignal();
  const [policyError, setPolicyError] = useState<ReactNode>();
  const [read, setRead] = useState(settings);
  const [drafts, setDrafts] = useState<Drafts>({
    FilterPolicy: undefined,
    FilterPolicyScope: undefined,
    RawMessageDelivery: undefined,
  });
  const [clearDialog, setClearDialog] = useState<'closed' | 'open' | 'cleared'>('closed');
  const [submitted, setSubmitted] = useState<{
    name: SubscriptionSetting['name'];
    before: SubscriptionSettingsAttributes;
  }>();
  const savedPolicy = settings.FilterPolicy ?? '';
  const hasPolicy = settings.FilterPolicy !== undefined;
  const clearOpen = clearDialog === 'open';
  const clearing = saving?.name === 'FilterPolicy' && saving.value === '';
  const clearDisabled = disabled || !hasPolicy;
  useLayoutEffect(() => {
    if (wasClearOpen.current && !clearOpen) {
      // A successful clear invalidates its opener, even if readback is still settling.
      const target = clearDialog === 'cleared' || clearDisabled ? settingsClose : clearOpener;
      target.current?.focus();
    }
    wasClearOpen.current = clearOpen;
  }, [clearOpen, clearDialog, clearDisabled, settingsClose]);

  const currentScope = hasPolicy ? settings.FilterPolicyScope : undefined;
  const savedName = submitted !== undefined && submitted.before !== settings ? submitted.name : undefined;
  if (settings !== read || savedName !== undefined) {
    setRead(settings);
    setDrafts({
      FilterPolicy:
        savedName === 'FilterPolicy' || drafts.FilterPolicy === savedPolicy ? undefined : drafts.FilterPolicy,
      FilterPolicyScope:
        !hasPolicy || savedName === 'FilterPolicyScope' || drafts.FilterPolicyScope === currentScope
          ? undefined
          : drafts.FilterPolicyScope,
      RawMessageDelivery:
        savedName === 'RawMessageDelivery' || drafts.RawMessageDelivery === settings.RawMessageDelivery
          ? undefined
          : drafts.RawMessageDelivery,
    });
    if (savedName !== undefined) {
      setSubmitted(undefined);
    }
    if (clearOpen && !clearing) {
      setClearDialog('closed');
    }
  }
  const policy = drafts.FilterPolicy ?? savedPolicy;
  const scope = SCOPE_OPTIONS.find(
    ({ value }) => value === (hasPolicy ? (drafts.FilterPolicyScope ?? currentScope) : undefined),
  );
  const raw = RAW_OPTIONS.find(({ value }) => value === (drafts.RawMessageDelivery ?? settings.RawMessageDelivery));
  // Cloudscape loading blocks activation while keeping the submitting button focusable.
  const savingPolicy = saving?.name === 'FilterPolicy' && saving.value !== '';
  const savingScope = saving?.name === 'FilterPolicyScope';
  const savingRawDelivery = saving?.name === 'RawMessageDelivery';

  const handleDraft = (name: SubscriptionSetting['name'], value: string | undefined) => {
    const saved = name === 'FilterPolicy' ? savedPolicy : settings[name];
    setDrafts((current) => ({ ...current, [name]: value === saved ? undefined : value }));
  };

  const handleSave = async (setting: SubscriptionSetting) => {
    let recovery: FilterPolicyRecovery | undefined;
    if (setting.name === 'FilterPolicy') {
      setPolicyError(undefined);
      if (setting.value !== '') {
        recovery = {
          signal: editorSignal(),
          showError: setPolicyError,
          focus: () => policyInput.current?.focus(),
        };
      }
    }
    const saved = await onSave(setting, recovery);
    if (saved) {
      setSubmitted({ name: setting.name, before: settings });
    }
    return saved;
  };

  const handleClear = async () => {
    if (clearDisabled) {
      return;
    }
    const cleared = await handleSave({ name: 'FilterPolicy', value: '' });
    setClearDialog(cleared ? 'cleared' : 'closed');
  };

  const handleDismissClear = () => {
    if (!clearing) {
      setClearDialog('closed');
    }
  };

  return (
    <SpaceBetween size="l">
      <SpaceBetween size="xs">
        <FormField
          data-testid="subscription-filter-policy"
          label="Filter policy"
          constraintText="Enter a JSON filter policy."
          errorText={policyError}
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
            ref={policyInput}
            value={policy}
            disabled={disabled}
            onChange={({ detail }) => {
              setPolicyError(undefined);
              handleDraft('FilterPolicy', detail.value);
            }}
          />
        </FormField>
        <SpaceBetween direction="horizontal" size="xs">
          <Button
            data-testid="subscription-settings-save-policy"
            disabled={!savingPolicy && (disabled || policy === '' || policy === settings.FilterPolicy)}
            loading={savingPolicy}
            onClick={() => {
              void handleSave({ name: 'FilterPolicy', value: policy });
            }}
          >
            Save filter policy
          </Button>
          <Button
            ref={clearOpener}
            data-testid="subscription-settings-clear-policy"
            disabled={clearDisabled}
            onClick={() => {
              setClearDialog('open');
            }}
          >
            Clear filter policy
          </Button>
        </SpaceBetween>
      </SpaceBetween>
      <SpaceBetween size="xs">
        <FormField
          data-testid="subscription-filter-policy-scope"
          label="Filter policy scope"
          constraintText={hasPolicy ? undefined : 'Save a filter policy to edit its scope.'}
        >
          <Select
            options={SCOPE_OPTIONS}
            selectedOption={scope ?? null}
            placeholder={currentScope ?? 'Not set'}
            disabled={disabled || !hasPolicy}
            onChange={({ detail }) => {
              handleDraft('FilterPolicyScope', detail.selectedOption.value);
            }}
          />
        </FormField>
        <Button
          data-testid="subscription-settings-save-scope"
          disabled={!savingScope && (disabled || scope === undefined || !hasPolicy || scope.value === currentScope)}
          loading={savingScope}
          onClick={() => {
            if (scope !== undefined) {
              void handleSave({ name: 'FilterPolicyScope', value: scope.value });
            }
          }}
        >
          Save scope
        </Button>
      </SpaceBetween>
      <SpaceBetween size="xs">
        <FormField data-testid="subscription-raw-message-delivery" label="Raw message delivery">
          <Select
            options={RAW_OPTIONS}
            selectedOption={raw ?? null}
            placeholder={settings.RawMessageDelivery ?? 'Not set'}
            disabled={disabled}
            onChange={({ detail }) => {
              handleDraft('RawMessageDelivery', detail.selectedOption.value);
            }}
          />
        </FormField>
        <Button
          data-testid="subscription-settings-save-raw-delivery"
          disabled={!savingRawDelivery && (disabled || raw === undefined || raw.value === settings.RawMessageDelivery)}
          loading={savingRawDelivery}
          onClick={() => {
            if (raw !== undefined) {
              void handleSave({ name: 'RawMessageDelivery', value: raw.value });
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
        onDismiss={handleDismissClear}
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button variant="link" disabled={clearing} onClick={handleDismissClear}>
                Cancel
              </Button>
              <Button
                variant="primary"
                disabled={!clearing && clearDisabled}
                loading={clearing}
                onClick={() => {
                  void handleClear();
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
  const headingText = useRef<HTMLSpanElement>(null);
  const settingsClose = useRef<ButtonProps.Ref>(null);
  useLayoutEffect(() => {
    const heading = headingText.current?.closest('h2');
    if (heading !== undefined && heading !== null) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
      heading.scrollIntoView?.({ block: 'center' });
    }
  }, []);
  const disabled = loading || failure !== undefined || pending !== undefined || saveUnavailable;

  return (
    <Container
      data-testid="subscription-settings"
      header={
        <Header
          variant="h2"
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button onClick={refresh} disabled={readUnavailable || loading}>
                Refresh
              </Button>
              <Button ref={settingsClose} onClick={onClose}>
                Close
              </Button>
            </SpaceBetween>
          }
        >
          <span ref={headingText}>Subscription settings</span>
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
        {(loading || failureState !== undefined) && (
          <div data-testid="subscription-settings-read-status">
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
          </div>
        )}
        {value !== undefined && (
          <SettingsFields
            settings={value}
            arn={arn}
            disabled={disabled}
            saving={pending?.arn === arn ? pending.setting : undefined}
            settingsClose={settingsClose}
            onSave={(setting, recovery) => (disabled ? Promise.resolve(false) : onSave(arn, setting, recovery))}
          />
        )}
      </SpaceBetween>
    </Container>
  );
}
