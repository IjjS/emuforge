import Button from '@cloudscape-design/components/button';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';

import { RequestError } from '../../../../../../lib/aws/request';
import type { AreaConnection } from '../../../components/emulator-line';
import { usePageFlash } from '../../../components/page-flash';
import { useShowsResources } from '../../../components/page-resources';
import { ValueText } from '../../../components/value-text';
import type { ScreenPageProps } from '../../../screens';
import { NO_SUCH_BUCKET, NO_SUCH_KEY, OPERATIONS, type ObjectHead } from '../api';
import { actionFailure } from '../components/action-failure';
import { lineText, pageFailure, type FailureView } from '../components/bucket-read';
import { BucketReadFailure } from '../components/bucket-read-state';
import { DeleteObjectsDialog } from '../components/delete-objects-dialog';
import { ObjectMetadata, ObjectOverview, ObjectPreview, ObjectTags } from '../components/object-sections';
import { ObjectGone, ObjectLoading } from '../components/object-states';
import { ObjectsBucketGone } from '../components/objects-states';
import { useAnnouncer } from '../components/use-announcer';
import { keyName, keyPrefix, objectsPath } from '../format';
import { useDownloadObject, useObjectHead, useObjectPreview, useObjectTags } from '../queries';

// An object's page (issue 480, tasks 2 and 4): `/aws/s3/buckets/{name}/object?key=<key>`. What `HeadObject` reports
// (overview and metadata), the tags, a preview of the first 64 KiB, "Download" of the whole body and "Delete" of the
// key. The body is rendered as text only and never stored or logged; a download goes from a `Blob` the page makes to
// the browser, under the key's last part.

const REFRESHED = 'Object refreshed';
const FOLDER_KEY = 'This key names a folder.';
const COULD_NOT_READ = 'The object could not be read';

/** "Not implemented by the emulator: {operation}". */
function notImplemented(operation: string): string {
  return `Not implemented by the emulator: ${operation}`;
}

/** The view of a failed `HeadObject`: a 501 naming it, else the rows of a page's read. */
function headFailure(failure: NonNullable<ReturnType<typeof useObjectHead>['failure']>, connection: AreaConnection) {
  if (failure.kind === 'not-implemented') {
    const view: FailureView = {
      type: 'info',
      first: { before: 'Not implemented by the emulator: ', code: failure.operation },
      detail: { before: 'The emulator answered 501 Not Implemented, so Studio cannot show this object.' },
      recovery: false,
    };
    return view;
  }
  return pageFailure(failure, connection, COULD_NOT_READ);
}

/** Hands `bytes` to the browser to save as `fileName`, from a `blob:` URL the page makes and revokes after. */
function saveFile(bytes: Uint8Array, contentType: string | undefined, fileName: string): void {
  const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], contentType === undefined ? {} : { type: contentType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  anchor.click();
  // Revoked once the click's download has taken the URL.
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}

/** The page: one view per key, so a new key starts afresh. */
export function ObjectPage({ connection, params }: ScreenPageProps) {
  const name = params.name ?? '';
  const [search] = useSearchParams();
  const objectKey = search.get('key') ?? '';
  useShowsResources('objects');
  return <ObjectView key={objectKey} bucket={name} objectKey={objectKey} connection={connection} />;
}

interface ObjectViewProps {
  bucket: string;
  objectKey: string;
  connection: AreaConnection;
}

function ObjectView({ bucket, objectKey, connection }: ObjectViewProps) {
  const flash = usePageFlash();
  const [announcement, announce] = useAnnouncer();
  const lookup = useObjectHead(connection.engineOrigin, bucket, objectKey);
  const { refresh, generation } = lookup;
  const head: ObjectHead | undefined =
    lookup.value === undefined || lookup.value === NO_SUCH_KEY || lookup.value === NO_SUCH_BUCKET
      ? undefined
      : lookup.value;
  const tags = useObjectTags(connection.engineOrigin, bucket, objectKey, { generation, enabled: head !== undefined });
  const preview = useObjectPreview(connection.engineOrigin, bucket, head, { generation });
  const download = useDownloadObject(connection.engineOrigin, bucket);

  const failure = lookup.failure === undefined ? undefined : headFailure(lookup.failure, connection);

  // Kept from the previous render, as the bucket's page does: each change is acted on once, in the render that first
  // shows it.
  const failureLine = failure === undefined ? undefined : lineText(failure.first);
  const [seenFailureLine, setSeenFailureLine] = useState<string>();
  if (failureLine !== seenFailureLine) {
    setSeenFailureLine(failureLine);
    if (failureLine !== undefined) {
      announce(failureLine);
    }
  }
  const [refreshing, setRefreshing] = useState(false);
  const reading = lookup.loading || (head !== undefined && (tags.loading || preview.loading));
  if (refreshing && !reading) {
    setRefreshing(false);
    if (failure === undefined) {
      announce(REFRESHED);
    }
  }
  // Once the connection is connected again after it was not, the object is read again: after an emulator restart the
  // page says what the emulator now holds.
  const connected = connection.result?.kind === 'connected';
  const [seenConnected, setSeenConnected] = useState(connected);
  const down = connection.result !== undefined && !connected;
  const [wasDown, setWasDown] = useState(down);
  if (down && !wasDown) {
    setWasDown(true);
  }
  if (connected !== seenConnected) {
    setSeenConnected(connected);
    if (connected && (lookup.failure !== undefined || wasDown)) {
      setWasDown(false);
      refresh();
    }
  }

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    setWasDown(false);
    refresh();
  }, [refresh]);

  const handleRetry = useCallback(() => {
    setWasDown(false);
    refresh();
  }, [refresh]);

  // "Download": the whole body, saved under the key's last part.
  const [downloading, setDownloading] = useState(false);
  const [downloadMissing, setDownloadMissing] = useState(false);
  const downloadController = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      downloadController.current?.abort();
    },
    [],
  );
  const handleDownload = () => {
    if (downloading) {
      return;
    }
    const controller = new AbortController();
    downloadController.current = controller;
    setDownloading(true);
    download(objectKey, controller.signal).then(
      ({ bytes, contentType }) => {
        setDownloading(false);
        saveFile(bytes, contentType ?? head?.contentType, keyName(objectKey));
      },
      (error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        setDownloading(false);
        if (!(error instanceof RequestError)) {
          return;
        }
        if (error.failure.kind === 'not-implemented') {
          setDownloadMissing(true);
        }
        const view = actionFailure(error.failure, 'Downloading the object', connection.engineOrigin);
        flash.show([{ type: view.type, header: view.header, content: view.detail ?? null }]);
      },
    );
  };

  // "Delete": the dialog for the one key; after a delete, the tab "Objects" at the key's folder.
  const [deleting, setDeleting] = useState(false);
  const handleDeleteClose = useCallback(
    (changed: boolean) => {
      setDeleting(false);
      if (changed) {
        refresh();
      }
    },
    [refresh],
  );

  const headMissing = lookup.failure?.kind === 'not-implemented' ? lookup.failure.operation : undefined;
  const getMissing = downloadMissing || preview.failure?.kind === 'not-implemented' ? OPERATIONS.getObject : undefined;
  const isFolderKey = objectKey.endsWith('/');
  const downloadReason = isFolderKey
    ? FOLDER_KEY
    : headMissing !== undefined
      ? notImplemented(headMissing)
      : getMissing !== undefined
        ? notImplemented(getMissing)
        : undefined;
  const deleteReason = headMissing === undefined ? undefined : notImplemented(headMissing);
  const showActions = head !== undefined || headMissing !== undefined;

  return (
    <SpaceBetween size="l">
      <Header
        variant="h1"
        actions={
          <SpaceBetween direction="horizontal" size="xs">
            <Button iconName="refresh" onClick={handleRefresh}>
              Refresh
            </Button>
            {showActions && (
              <Button
                disabled={deleteReason !== undefined}
                {...(deleteReason !== undefined && { disabledReason: deleteReason })}
                onClick={() => {
                  setDeleting(true);
                }}
              >
                Delete
              </Button>
            )}
            {showActions && (
              <Button
                variant="primary"
                iconName="download"
                loading={downloading}
                disabled={downloadReason !== undefined}
                {...(downloadReason !== undefined && { disabledReason: downloadReason })}
                onClick={handleDownload}
              >
                Download
              </Button>
            )}
          </SpaceBetween>
        }
      >
        <ValueText kind="name" value={keyName(objectKey)} />
      </Header>
      {failure !== undefined && <BucketReadFailure view={failure} onRetry={handleRetry} />}
      {failure === undefined && lookup.value === undefined && <ObjectLoading />}
      {failure === undefined && lookup.value === NO_SUCH_BUCKET && <ObjectsBucketGone name={bucket} />}
      {failure === undefined && lookup.value === NO_SUCH_KEY && <ObjectGone bucket={bucket} objectKey={objectKey} />}
      {failure === undefined && head !== undefined && (
        <SpaceBetween size="l">
          <ObjectOverview bucket={bucket} head={head} />
          <ObjectPreview read={preview} connection={connection} />
          <ObjectMetadata head={head} />
          <ObjectTags read={tags} connection={connection} />
        </SpaceBetween>
      )}
      <DeleteObjectsDialog
        visible={deleting}
        endpoint={connection.engineOrigin}
        bucket={bucket}
        selection={{ keys: [objectKey], folders: [] }}
        single={objectKey}
        after={objectsPath(bucket, keyPrefix(objectKey))}
        onClose={handleDeleteClose}
      />
      {announcement}
    </SpaceBetween>
  );
}
