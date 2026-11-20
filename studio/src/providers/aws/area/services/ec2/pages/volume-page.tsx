import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import Link from '@cloudscape-design/components/link';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Table from '@cloudscape-design/components/table';
import { useRef, useState } from 'react';

import { CopyValue } from '../../../components/copy-value';
import { actionFailureItem, readFailureState, ReadFailure, useAnnouncer } from '../../../components/failure-states';
import { usePageFlash } from '../../../components/page-flash';
import { useShowsResources } from '../../../components/page-resources';
import { useFollow } from '../../../components/use-follow';
import { failureOf, usePageSignal } from '../../../components/use-token-listing';
import { ValueText } from '../../../components/value-text';
import type { ScreenPageProps } from '../../../screens';
import { VolumeAttachDialog } from '../components/volume-attach-dialog';
import { VolumeDeleteDialog } from '../components/volume-delete-dialog';
import { VolumeDetachDialog } from '../components/volume-detach-dialog';
import { instanceHref, NONE } from '../format';
import {
  attachVolume,
  deleteVolume,
  detachVolume,
  VOLUME_OPERATIONS,
  type AttachmentTarget,
  type Volume,
  type VolumeAttachment,
} from '../volume-api';
import { VOLUMES_PATH, VOLUMES_WORD, volumeSizeText } from '../volume-format';
import { attachmentChangePending, useRefreshVolumeData, useVolume, type AttachmentChange } from '../volume-queries';
import type { RequestFailure } from '../../../../../../lib/aws/request';

type Action = 'attach' | 'detach' | 'delete';
type Dialog = { action: 'detach'; target: AttachmentTarget } | { action: 'attach' | 'delete' };
type VolumeMutation = AttachmentChange | { action: 'delete' };
const actions = {
  attach: { operation: VOLUME_OPERATIONS.attachVolume, label: 'Attach volume' },
  detach: { operation: VOLUME_OPERATIONS.detachVolume, label: 'Detach volume' },
  delete: { operation: VOLUME_OPERATIONS.deleteVolume, label: 'Delete volume' },
};

function Details({ volume }: { volume: Volume }) {
  return (
    <Container header={<Header variant="h2">Volume details</Header>}>
      <KeyValuePairs
        ariaLabel="Volume details"
        columns={3}
        items={[
          { label: 'Volume ID', value: <CopyValue label="Volume ID" kind="name" value={volume.id} /> },
          { label: 'Size', value: <ValueText kind="fixed" value={volumeSizeText(volume.size)} none={NONE} /> },
          { label: 'Type', value: <ValueText kind="fixed" value={volume.type} none={NONE} /> },
          { label: 'Availability Zone', value: <ValueText kind="fixed" value={volume.zone} none={NONE} /> },
          { label: 'State', value: <ValueText kind="fixed" value={volume.state} none={NONE} /> },
        ]}
      />
    </Container>
  );
}

function Attachments({
  volume,
  detachDisabled,
  onDetach,
}: {
  volume: Volume;
  detachDisabled: boolean;
  onDetach: (target: AttachmentTarget) => void;
}) {
  const follow = useFollow();
  return (
    <Table<VolumeAttachment>
      variant="container"
      header={<Header variant="h2">Attachments</Header>}
      items={volume.attachments}
      wrapLines
      empty={
        <Box textAlign="center" variant="strong" color="inherit">
          No attachments
        </Box>
      }
      columnDefinitions={[
        {
          id: 'instance',
          header: 'Instance ID',
          isRowHeader: true,
          cell: ({ instanceId }) =>
            instanceId === undefined ? (
              NONE
            ) : (
              <Link href={instanceHref(instanceId)} onFollow={follow}>
                <ValueText kind="name" value={instanceId} />
              </Link>
            ),
        },
        { id: 'device', header: 'Device', cell: ({ device }) => <ValueText kind="name" value={device} none={NONE} /> },
        { id: 'state', header: 'State', cell: ({ state }) => <ValueText kind="fixed" value={state} none={NONE} /> },
        {
          id: 'action',
          header: 'Actions',
          cell: ({ instanceId, device, state }) =>
            instanceId === undefined || device === undefined ? (
              NONE
            ) : (
              <Button
                disabled={detachDisabled || state !== 'attached'}
                onClick={() => {
                  onDetach({ instanceId, device });
                }}
              >
                Detach volume
              </Button>
            ),
        },
      ]}
    />
  );
}

function NotFound() {
  const follow = useFollow();
  return (
    <Container>
      <Box textAlign="center" color="inherit">
        <SpaceBetween size="xs">
          <Box variant="strong">Volume not found</Box>
          <Link href={VOLUMES_PATH} onFollow={follow}>
            View volumes
          </Link>
        </SpaceBetween>
      </Box>
    </Container>
  );
}

function VolumeVisit({
  connection,
  id,
  endpoint,
}: Pick<ScreenPageProps, 'connection'> & {
  id: string;
  endpoint: string | undefined;
}) {
  const [dialog, setDialog] = useState<Dialog>();
  const [failure, setFailure] = useState<RequestFailure>();
  const [unavailable, setUnavailable] = useState<Action[]>([]);
  const [change, setChange] = useState<AttachmentChange>();
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const pageSignal = usePageSignal();
  const flash = usePageFlash();
  const refreshData = useRefreshVolumeData();
  const [announcement, announce] = useAnnouncer();
  const { value: read, failure: readFailure, refresh } = useVolume(endpoint, id, change);
  const volume = read?.found === true ? read.volume : undefined;
  const failureState = readFailure === undefined ? undefined : readFailureState(readFailure, connection, 'volume');
  const [seenFailure, setSeenFailure] = useState<string>();
  if (failureState?.firstText !== seenFailure) {
    setSeenFailure(failureState?.firstText);
    if (failureState !== undefined) announce(failureState.firstText);
  }
  if (
    change !== undefined &&
    read !== undefined &&
    (volume === undefined || !attachmentChangePending(volume, change))
  ) {
    setChange(undefined);
  }

  const open = (next: Dialog) => {
    setFailure(undefined);
    setDialog(next);
  };

  async function confirm(operation: VolumeMutation) {
    const { action } = operation;
    if (endpoint === undefined || inFlight.current || unavailable.includes(action)) return;

    const signal = pageSignal();
    inFlight.current = true;
    setPending(true);
    setFailure(undefined);
    try {
      if (operation.action === 'delete') {
        await deleteVolume(endpoint, id, signal);
        if (signal.aborted) return;
        flash.handOver(VOLUMES_PATH, [{ type: 'success', content: `Volume ${id} deleted.` }]);
        refreshData(id);
      } else {
        const request = operation.action === 'attach' ? attachVolume : detachVolume;
        await request(endpoint, id, operation.target, signal);
        if (signal.aborted) return;
        setChange(operation);
        const result = operation.action === 'attach' ? 'Attachment' : 'Detachment';
        flash.show([{ type: 'success', content: `${result} requested for ${id}.` }]);
        refreshData(id, operation.target.instanceId);
      }
      setDialog(undefined);
    } catch (error) {
      if (signal.aborted) return;
      const reason = failureOf(error, actions[action].operation);
      if (reason.kind === 'not-implemented') {
        setUnavailable((current) => [...current, action]);
        if (action === 'delete') {
          setDialog(undefined);
          flash.show([actionFailureItem(reason, actions[action].label, endpoint)]);
          return;
        }
      }
      setFailure(reason);
    } finally {
      inFlight.current = false;
      if (!signal.aborted) setPending(false);
    }
  }

  const dialogStatus = {
    pending,
    failure:
      failure === undefined || dialog === undefined
        ? undefined
        : actionFailureItem(failure, actions[dialog.action].label, endpoint),
    unavailable: dialog !== undefined && unavailable.includes(dialog.action),
    onDismiss: () => {
      setDialog(undefined);
    },
  };
  const settling = change !== undefined;

  let content;
  if (failureState !== undefined) {
    content = (
      <Container>
        <ReadFailure state={failureState} onRetry={refresh} />
      </Container>
    );
  } else if (read === undefined) {
    content = (
      <Container>
        <Box textAlign="center" color="inherit">
          <StatusIndicator type="loading">Loading volume</StatusIndicator>
        </Box>
      </Container>
    );
  } else if (volume === undefined) {
    content = <NotFound />;
  } else {
    content = (
      <SpaceBetween size="l">
        <Details volume={volume} />
        <Attachments
          volume={volume}
          detachDisabled={settling || unavailable.includes('detach')}
          onDetach={(target) => {
            open({ action: 'detach', target });
          }}
        />
      </SpaceBetween>
    );
  }

  return (
    <>
      <ContentLayout
        header={
          <Header
            variant="h1"
            actions={
              <SpaceBetween size="xs" direction="horizontal">
                <Button
                  iconName="refresh"
                  ariaLabel="Refresh"
                  disabled={endpoint === undefined || pending}
                  onClick={refresh}
                />
                {volume !== undefined && (
                  <>
                    <Button
                      disabled={settling || volume.state !== 'available' || unavailable.includes('attach')}
                      onClick={() => {
                        open({ action: 'attach' });
                      }}
                    >
                      Attach volume
                    </Button>
                    <Button
                      disabled={settling || unavailable.includes('delete')}
                      onClick={() => {
                        open({ action: 'delete' });
                      }}
                    >
                      Delete volume
                    </Button>
                  </>
                )}
              </SpaceBetween>
            }
          >
            <ValueText kind="name" value={id} />
          </Header>
        }
      >
        {content}
      </ContentLayout>
      {announcement}
      {dialog?.action === 'attach' && endpoint !== undefined && (
        <VolumeAttachDialog
          {...dialogStatus}
          connection={connection}
          endpoint={endpoint}
          onConfirm={(target) => {
            void confirm({ action: 'attach', target });
          }}
        />
      )}
      {dialog?.action === 'detach' && (
        <VolumeDetachDialog
          {...dialogStatus}
          id={id}
          target={dialog.target}
          onConfirm={() => {
            void confirm(dialog);
          }}
        />
      )}
      {dialog?.action === 'delete' && (
        <VolumeDeleteDialog
          {...dialogStatus}
          id={id}
          onConfirm={() => {
            void confirm({ action: 'delete' });
          }}
        />
      )}
    </>
  );
}

export function VolumePage({ connection, params }: ScreenPageProps) {
  useShowsResources(VOLUMES_WORD);
  const id = params['id'] ?? '';
  const down = connection.result !== undefined && connection.result.kind !== 'connected';
  const endpoint = down ? undefined : connection.engineOrigin;
  // Losing the connection ends the visit's reads and mutations, even when the engine origin stays the same.
  return <VolumeVisit key={JSON.stringify([id, endpoint])} connection={connection} id={id} endpoint={endpoint} />;
}
