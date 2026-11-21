import Alert from '@cloudscape-design/components/alert';
import Button, { type ButtonProps } from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Form from '@cloudscape-design/components/form';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import Input, { type InputProps } from '@cloudscape-design/components/input';
import Select, { type SelectProps } from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';

import { DiscardDialog, type DiscardAnswer } from '../../../components/discard-dialog';
import { actionFailureItem, ReadFailure, readFailureState } from '../../../components/failure-states';
import { usePageFlash, type FlashItem } from '../../../components/page-flash';
import { useShowsResources } from '../../../components/page-resources';
import { useAvailabilityZones } from '../../../components/use-availability-zones';
import { failureOf, usePageSignal } from '../../../components/use-token-listing';
import type { ScreenPageProps } from '../../../screens';
import { VOLUME_OPERATIONS } from '../volume-api';
import { VOLUMES_PATH, VOLUMES_WORD, volumeHref } from '../volume-format';
import { useCreateVolume, useRefreshVolumeData } from '../volume-queries';

const SIZE_CONSTRAINT = 'Enter a whole number from 1 to 16384.';

function validSize(value: string): boolean {
  const size = Number(value);
  return /^\d+$/.test(value) && size >= 1 && size <= 16384;
}

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
  const [size, setSize] = useState('');
  const [tried, setTried] = useState(false);
  const [pending, setPending] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [failure, setFailure] = useState<FlashItem>();
  const [asking, setAsking] = useState(false);
  const [kept, setKept] = useState(0);
  const busy = useRef(false);
  const cancelRef = useRef<ButtonProps.Ref>(null);
  const zoneRef = useRef<SelectProps.Ref>(null);
  const sizeRef = useRef<InputProps.Ref>(null);

  useEffect(() => {
    if (kept > 0) cancelRef.current?.focus();
  }, [kept]);

  const options = (zones.zones ?? []).map((name) => ({ value: name, label: name }));
  const selected = options.find(({ value }) => value === zone);
  const sizeIsValid = validSize(size.trim());

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy.current || asking || unavailable || endpoint === undefined) return;

    setTried(true);
    if (selected === undefined || zone === undefined) {
      zoneRef.current?.focus();
      return;
    }
    if (!sizeIsValid) {
      sizeRef.current?.focus();
      return;
    }

    setFailure(undefined);
    const signal = pageSignal();
    busy.current = true;
    setPending(true);
    try {
      const id = await create({ zone, size: Number(size) }, signal);
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
    if (zone !== undefined || size !== '') {
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
          <Container>
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
              <FormField
                label="Size (GiB)"
                constraintText={SIZE_CONSTRAINT}
                errorText={tried && !sizeIsValid ? SIZE_CONSTRAINT : undefined}
              >
                <Input
                  ref={sizeRef}
                  value={size}
                  inputMode="numeric"
                  disabled={pending}
                  onChange={({ detail }) => setSize(detail.value)}
                />
              </FormField>
            </SpaceBetween>
          </Container>
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
