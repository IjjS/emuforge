import Alert from '@cloudscape-design/components/alert';
import Button, { type ButtonProps } from '@cloudscape-design/components/button';
import Checkbox from '@cloudscape-design/components/checkbox';
import Container from '@cloudscape-design/components/container';
import Form from '@cloudscape-design/components/form';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import Input, { type InputProps } from '@cloudscape-design/components/input';
import Select, { type SelectProps } from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';

import { ChoiceSelect } from '../../../components/choice-select';
import { DiscardDialog, type DiscardAnswer } from '../../../components/discard-dialog';
import { actionFailureItem, ReadFailure, readFailureState } from '../../../components/failure-states';
import { kmsKeyChoices, type KmsKeyChoice } from '../../../components/kms-key-choices';
import { usePageFlash, type FlashItem } from '../../../components/page-flash';
import { useShowsResources } from '../../../components/page-resources';
import { TagsField, type TagsFieldRef } from '../../../components/tags-field';
import { useAvailabilityZones } from '../../../components/use-availability-zones';
import { failureOf, usePageSignal } from '../../../components/use-token-listing';
import { withValues } from '../../../lib/ec2-client';
import { checkTagRows, type TagRow } from '../../../lib/tag-rows';
import type { ScreenPageProps } from '../../../screens';
import { VOLUME_OPERATIONS, type NewVolume, type VolumeSnapshot } from '../volume-api';
import { VOLUMES_PATH, VOLUMES_WORD, volumeHref } from '../volume-format';
import {
  changeVolumeType,
  checkVolumeSettings,
  DEFAULT_VOLUME_SETTINGS,
  rangeText,
  sizeConstraint,
  VOLUME_TYPE_OPTIONS,
  volumeRules,
  type VolumeType,
} from '../volume-form';
import { useCreateVolume, useRefreshVolumeData, volumeSnapshotChoices } from '../volume-queries';

function CreateVolumeForm({
  connection,
  endpoint,
}: Pick<ScreenPageProps, 'connection'> & { endpoint: string | undefined }) {
  const navigate = useNavigate();
  const flash = usePageFlash();
  const pageSignal = usePageSignal();
  const refresh = useRefreshVolumeData();
  const create = useCreateVolume(endpoint);
  const zones = useAvailabilityZones(endpoint);
  const [zone, setZone] = useState<string>();
  const [settings, setSettings] = useState(DEFAULT_VOLUME_SETTINGS);
  const [snapshot, setSnapshot] = useState<VolumeSnapshot>();
  const [encrypted, setEncrypted] = useState(false);
  const [kmsKey, setKmsKey] = useState<KmsKeyChoice>();
  const [tags, setTags] = useState<TagRow[]>([]);
  const [tried, setTried] = useState(false);
  const [pending, setPending] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [failure, setFailure] = useState<FlashItem>();
  const [asking, setAsking] = useState(false);
  const [kept, setKept] = useState(0);
  const busy = useRef(false);
  const cancelRef = useRef<ButtonProps.Ref>(null);
  const zoneRef = useRef<SelectProps.Ref>(null);
  const typeRef = useRef<SelectProps.Ref>(null);
  const iopsRef = useRef<InputProps.Ref>(null);
  const throughputRef = useRef<InputProps.Ref>(null);
  const tagsRef = useRef<TagsFieldRef>(null);
  const sizeRef = useRef<InputProps.Ref>(null);

  useEffect(() => {
    if (kept > 0) cancelRef.current?.focus();
  }, [kept]);

  const options = (zones.zones ?? []).map((name) =>
    withValues<SelectProps.Option>(
      { value: name, label: name },
      {
        description: zones.zoneDetails?.find((zone) => zone.name === name)?.id,
      },
    ),
  );
  const selected = options.find(({ value }) => value === zone);
  const selectedType = VOLUME_TYPE_OPTIONS.find(({ value }) => value === settings.type) ?? null;
  const { errors, values } = checkVolumeSettings(settings, snapshot?.size);
  const checkedTags = checkTagRows(tags);
  const rules = volumeRules(settings.type);
  const mayInheritSize =
    snapshot?.size !== undefined && snapshot.size >= rules.size[0] && snapshot.size <= rules.size[1];
  const dirty =
    zone !== undefined ||
    settings.type !== DEFAULT_VOLUME_SETTINGS.type ||
    settings.size !== '' ||
    settings.iops !== '' ||
    settings.throughput !== '' ||
    snapshot !== undefined ||
    encrypted ||
    tags.length !== 0;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy.current || asking || unavailable || endpoint === undefined) return;

    setTried(true);
    if (selected === undefined || zone === undefined) {
      zoneRef.current?.focus();
      return;
    }
    const fields = [
      { error: errors.type, ref: typeRef },
      { error: errors.size, ref: sizeRef },
      { error: errors.iops, ref: iopsRef },
      { error: errors.throughput, ref: throughputRef },
    ];
    const invalidField = fields.find(({ error }) => error !== undefined)?.ref;
    if (invalidField !== undefined) {
      invalidField.current?.focus();
      return;
    }
    if (checkedTags.firstInvalid !== undefined) {
      tagsRef.current?.focusKey(checkedTags.firstInvalid);
      return;
    }

    setFailure(undefined);
    const signal = pageSignal();
    busy.current = true;
    setPending(true);
    try {
      const id = await create(
        withValues<NewVolume>(
          { zone, type: values.type },
          {
            size: values.size,
            iops: values.iops,
            throughput: values.throughput,
            snapshotId: snapshot?.id,
            encrypted: encrypted ? true : undefined,
            kmsKeyId: kmsKey?.arn,
            tags: checkedTags.tags.length > 0 ? checkedTags.tags : undefined,
          },
        ),
        signal,
      );
      if (signal.aborted) return;
      flash.handOver(volumeHref(id), [{ type: 'success', content: `Volume ${id} created.` }]);
      refresh(id);
    } catch (error) {
      if (signal.aborted) return;
      busy.current = false;
      setPending(false);
      const reason = failureOf(error, VOLUME_OPERATIONS.createVolume);
      setFailure(actionFailureItem(reason, 'Creating volume', endpoint));
      setUnavailable(reason.kind === 'not-implemented');
    }
  };

  const handleCancel = () => {
    if (busy.current) return;
    if (dirty) {
      setAsking(true);
    } else {
      void navigate(VOLUMES_PATH);
    }
  };

  const handleDiscardAnswer = (answer: DiscardAnswer) => {
    setAsking(false);
    if (answer === 'discard') {
      void navigate(VOLUMES_PATH);
    } else {
      setKept((count) => count + 1);
    }
  };

  return (
    <SpaceBetween size="l">
      <Header variant="h1" description="Choose the zone where you will attach this volume.">
        Create volume
      </Header>
      {zones.failure !== undefined && (
        <ReadFailure state={readFailureState(zones.failure, connection, 'Availability Zones')} onRetry={zones.retry} />
      )}
      {failure !== undefined && (
        <Alert type={failure.type} header={failure.header}>
          {failure.content}
        </Alert>
      )}
      <form noValidate onSubmit={(event) => void handleSubmit(event)}>
        <Form
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button ref={cancelRef} variant="link" formAction="none" disabled={pending} onClick={handleCancel}>
                Cancel
              </Button>
              <Button
                variant="primary"
                loading={pending}
                loadingText="Creating volume"
                disabled={unavailable || endpoint === undefined}
              >
                Create volume
              </Button>
            </SpaceBetween>
          }
        >
          <SpaceBetween size="l">
            <Container header={<Header variant="h2">Volume settings</Header>}>
              <SpaceBetween size="l">
                <FormField
                  label="Availability Zone"
                  errorText={tried && selected === undefined ? 'Choose an Availability Zone.' : undefined}
                >
                  <Select
                    ref={zoneRef}
                    selectedOption={selected ?? null}
                    options={options}
                    placeholder="Choose an Availability Zone"
                    loadingText="Loading Availability Zones"
                    empty="No Availability Zones"
                    statusType={zones.loading && endpoint !== undefined ? 'loading' : 'finished'}
                    onChange={({ detail }) => setZone(detail.selectedOption.value)}
                    disabled={pending || endpoint === undefined}
                  />
                </FormField>
                <FormField label="Volume type" errorText={errors.type}>
                  <Select
                    ref={typeRef}
                    selectedOption={selectedType}
                    options={VOLUME_TYPE_OPTIONS}
                    disabled={pending}
                    invalid={errors.type !== undefined}
                    onChange={({ detail }) => {
                      const type = detail.selectedOption.value as VolumeType;
                      setSettings((current) => changeVolumeType(current, type));
                    }}
                  />
                </FormField>
                <FormField label="Snapshot - optional">
                  <ChoiceSelect
                    source={volumeSnapshotChoices(endpoint)}
                    connection={connection}
                    things="snapshots"
                    ariaLabel="Snapshot"
                    fixed="No snapshot"
                    fixedDescription="The volume starts empty."
                    value={snapshot}
                    held={pending ? 'Creating volume' : undefined}
                    onChange={setSnapshot}
                  />
                </FormField>
                <FormField
                  label={mayInheritSize ? 'Size (GiB) - optional' : 'Size (GiB)'}
                  constraintText={sizeConstraint(settings.type, snapshot?.size)}
                  errorText={tried ? errors.size : undefined}
                >
                  <Input
                    ref={sizeRef}
                    value={settings.size}
                    inputMode="numeric"
                    disabled={pending}
                    onChange={({ detail }) => setSettings((current) => ({ ...current, size: detail.value }))}
                  />
                </FormField>
                {rules.iops !== undefined && (
                  <FormField
                    label={rules.iops.required ? 'IOPS' : 'IOPS - optional'}
                    constraintText={`Enter a whole number from ${rangeText(rules.iops.range)}.`}
                    errorText={tried ? errors.iops : undefined}
                  >
                    <Input
                      ref={iopsRef}
                      value={settings.iops}
                      inputMode="numeric"
                      disabled={pending}
                      onChange={({ detail }) => setSettings((current) => ({ ...current, iops: detail.value }))}
                    />
                  </FormField>
                )}
                {rules.throughput !== undefined && (
                  <FormField
                    label="Throughput (MiB/s) - optional"
                    constraintText={`Enter a whole number from ${rangeText(rules.throughput)}.`}
                    errorText={tried ? errors.throughput : undefined}
                  >
                    <Input
                      ref={throughputRef}
                      value={settings.throughput}
                      inputMode="numeric"
                      disabled={pending}
                      onChange={({ detail }) => setSettings((current) => ({ ...current, throughput: detail.value }))}
                    />
                  </FormField>
                )}
              </SpaceBetween>
            </Container>
            <Container header={<Header variant="h2">Encryption</Header>}>
              <SpaceBetween size="l">
                <Checkbox
                  checked={encrypted}
                  description="The emulator reports the volume as encrypted."
                  disabled={pending}
                  onChange={({ detail }) => {
                    setEncrypted(detail.checked);
                    if (!detail.checked) setKmsKey(undefined);
                  }}
                >
                  Encrypt the volume
                </Checkbox>
                {encrypted && (
                  <FormField label="KMS key">
                    <ChoiceSelect
                      source={kmsKeyChoices(endpoint)}
                      connection={connection}
                      things="KMS keys"
                      ariaLabel="KMS key"
                      fixed="Chosen by the emulator"
                      fixedDescription="No key is sent. The emulator reports the volume as encrypted, with no key."
                      value={kmsKey}
                      held={pending ? 'Creating volume' : undefined}
                      onChange={setKmsKey}
                    />
                  </FormField>
                )}
              </SpaceBetween>
            </Container>
            <TagsField
              ref={tagsRef}
              rows={tags}
              onChange={setTags}
              errors={tried ? checkedTags.errors : undefined}
              disabled={pending}
            />
          </SpaceBetween>
        </Form>
      </form>
      {asking && <DiscardDialog visible onAnswer={handleDiscardAnswer} />}
    </SpaceBetween>
  );
}

export function CreateVolumePage({ connection }: ScreenPageProps) {
  useShowsResources(VOLUMES_WORD);
  const down = connection.result !== undefined && connection.result.kind !== 'connected';
  const endpoint = down ? undefined : connection.engineOrigin;
  return <CreateVolumeForm key={endpoint} connection={connection} endpoint={endpoint} />;
}
