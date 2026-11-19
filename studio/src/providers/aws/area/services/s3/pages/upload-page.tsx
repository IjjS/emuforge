import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import FileUpload, { type FileUploadProps } from '@cloudscape-design/components/file-upload';
import Form from '@cloudscape-design/components/form';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Table, { type TableProps } from '@cloudscape-design/components/table';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';

import type { RequestFailure } from '../../../../../../lib/aws/request';
import { DiscardDialog, type DiscardAnswer } from '../../../components/discard-dialog';
import type { AreaConnection } from '../../../components/emulator-line';
import { usePageFlash } from '../../../components/page-flash';
import { useShowsResources } from '../../../components/page-resources';
import { useFollow } from '../../../components/use-follow';
import { ValueText } from '../../../components/value-text';
import type { ScreenPageProps } from '../../../screens';
import { NO_SUCH_BUCKET } from '../api';
import { NAME_COLUMN_MIN_WIDTH } from '../components/name-column';
import { ObjectsBucketGone } from '../components/objects-states';
import { Quoted } from '../components/quoted';
import { reportAbandoned } from '../components/upload-abandoned';
import { formatSize, objectsPath, s3Uri } from '../format';
import { useBucketLookup, useObjectExists, useUploadOperations } from '../queries';
import { failedText, fileType, putFile, uploadedText } from '../upload';

// The Upload page (issue 480, task 3): `/aws/s3/bucket/{name}/upload?prefix=<prefix>`. "Add files" picks files, each
// listed with its name, size and type and removable; "Upload" puts them one after another (`upload.ts`) and says how
// each went. "Cancel", or leaving the page any way, while files are put ends the request in flight, aborts a
// multipart upload in flight and puts nothing further; the files put stay.

const REPLACES = 'Replaces an existing object';
const ADD_FIRST = 'Add the files to upload first';

/** How far one file is. */
type FileStatus =
  | { kind: 'ready' }
  | { kind: 'waiting' }
  | { kind: 'uploading'; parts?: { done: number; total: number } }
  | { kind: 'uploaded' }
  | { kind: 'failed'; failure: RequestFailure };

interface FileRow {
  id: string;
  file: File;
  /** `HeadObject` found an object of the file's key. */
  replaces: boolean;
  status: FileStatus;
}

/** The page's phase: files are chosen, then put, then the page says how it went. */
type Phase = 'choosing' | 'uploading' | 'done';

function StatusCell({ row, engineOrigin }: { row: FileRow; engineOrigin: string | undefined }) {
  const { status } = row;
  const replaces = row.replaces && status.kind !== 'uploaded' && status.kind !== 'failed' && (
    <StatusIndicator type="warning">{REPLACES}</StatusIndicator>
  );
  switch (status.kind) {
    case 'ready':
      return replaces || <ValueText kind="fixed" value="-" />;
    case 'waiting':
      return (
        <SpaceBetween size="xxs">
          <StatusIndicator type="pending">Waiting</StatusIndicator>
          {replaces}
        </SpaceBetween>
      );
    case 'uploading':
      return (
        <SpaceBetween size="xxs">
          <StatusIndicator type="in-progress">
            {status.parts === undefined
              ? 'Uploading'
              : `Uploading, ${String(status.parts.done)} of ${String(status.parts.total)} parts`}
          </StatusIndicator>
          {replaces}
        </SpaceBetween>
      );
    case 'uploaded':
      return <StatusIndicator type="success">Uploaded</StatusIndicator>;
    case 'failed':
      return (
        <StatusIndicator type={status.failure.kind === 'not-implemented' ? 'info' : 'error'}>
          <ValueText kind="text" value={failedText(status.failure, engineOrigin)} />
        </StatusIndicator>
      );
  }
}

/** The page: one view per folder, so a new folder starts afresh. */
export function UploadPage({ connection, params }: ScreenPageProps) {
  const name = params.name ?? '';
  const [search] = useSearchParams();
  const prefix = search.get('prefix') ?? '';
  useShowsResources('objects');
  return <UploadView key={prefix} bucket={name} prefix={prefix} connection={connection} />;
}

interface UploadViewProps {
  bucket: string;
  prefix: string;
  connection: AreaConnection;
}

let lastRowId = 0;

function UploadView({ bucket, prefix, connection }: UploadViewProps) {
  const navigate = useNavigate();
  const flash = usePageFlash();
  const handleFollow = useFollow();
  const engineOrigin = connection.engineOrigin;
  const lookup = useBucketLookup(engineOrigin, bucket);
  const operations = useUploadOperations(engineOrigin, bucket);
  const exists = useObjectExists(engineOrigin, bucket);

  const [rows, setRows] = useState<FileRow[]>([]);
  const [phase, setPhase] = useState<Phase>('choosing');
  const [discarding, setDiscarding] = useState(false);

  // The page's signal: aborted by "Cancel" during the upload and when the page is gone.
  const uploading = useRef<AbortController | null>(null);
  const checks = useRef(new AbortController());
  useEffect(() => {
    const ownChecks = checks.current;
    return () => {
      uploading.current?.abort();
      ownChecks.abort();
    };
  }, []);

  const back = objectsPath(bucket, prefix);

  const setStatus = useCallback((id: string, status: FileStatus) => {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, status } : row)));
  }, []);

  const handleAdd = ({ detail }: { detail: FileUploadProps.ChangeDetail }) => {
    const added = detail.value.map((file): FileRow => {
      lastRowId += 1;
      return { id: `file-${String(lastRowId)}`, file, replaces: false, status: { kind: 'ready' } };
    });
    setRows((current) => [...current, ...added]);
    if (exists === undefined) {
      return;
    }
    for (const row of added) {
      exists(`${prefix}${row.file.name}`, checks.current.signal).then(
        (found) => {
          if (found) {
            setRows((current) => current.map((other) => (other.id === row.id ? { ...other, replaces: true } : other)));
          }
        },
        () => {
          // Not known: the row says nothing of an object there.
        },
      );
    }
  };

  const handleRemove = (id: string) => {
    setRows((current) => current.filter((row) => row.id !== id));
  };

  const handleUpload = async () => {
    if (phase !== 'choosing' || operations === undefined || rows.length === 0) {
      return;
    }
    const controller = new AbortController();
    uploading.current = controller;
    const { signal } = controller;
    const queue = rows;
    setPhase('uploading');
    setRows(queue.map((row) => ({ ...row, status: { kind: 'waiting' } })));
    let uploaded = 0;
    for (const row of queue) {
      if (signal.aborted) {
        return;
      }
      setStatus(row.id, { kind: 'uploading' });
      try {
        const result = await putFile(`${prefix}${row.file.name}`, row.file, {
          operations,
          signal,
          onPart: (done, total) => {
            setStatus(row.id, { kind: 'uploading', parts: { done, total } });
          },
          onAbandoned: reportAbandoned,
        });
        if (result.ok) {
          uploaded += 1;
          setStatus(row.id, { kind: 'uploaded' });
        } else {
          setStatus(row.id, { kind: 'failed', failure: result.failure });
        }
      } catch {
        // Stopped by "Cancel" or by leaving: nothing further is put.
        return;
      }
    }
    setPhase('done');
    flash.show([
      { type: uploaded === queue.length ? 'success' : 'error', content: uploadedText(uploaded, queue.length) },
    ]);
  };

  const handleCancel = () => {
    if (phase === 'uploading') {
      uploading.current?.abort();
      void navigate(back);
    } else if (phase === 'choosing' && rows.length > 0) {
      setDiscarding(true);
    } else {
      void navigate(back);
    }
  };

  const handleDiscard = useCallback(
    (answer: DiscardAnswer) => {
      setDiscarding(false);
      if (answer === 'discard') {
        void navigate(back);
      }
    },
    [navigate, back],
  );

  if (lookup.value === NO_SUCH_BUCKET) {
    return <ObjectsBucketGone name={bucket} />;
  }

  const columns: TableProps.ColumnDefinition<FileRow>[] = [
    {
      id: 'name',
      header: 'Name',
      isRowHeader: true,
      minWidth: NAME_COLUMN_MIN_WIDTH,
      cell: (row) => <ValueText kind="name" value={row.file.name} />,
    },
    { id: 'size', header: 'Size', cell: (row) => <ValueText kind="fixed" value={formatSize(row.file.size)} /> },
    { id: 'type', header: 'Type', cell: (row) => <ValueText kind="fixed" value={fileType(row.file)} /> },
    { id: 'status', header: 'Status', cell: (row) => <StatusCell row={row} engineOrigin={engineOrigin} /> },
    ...(phase === 'choosing'
      ? [
          {
            id: 'remove',
            header: 'Remove',
            cell: (row: FileRow) => (
              <Button
                variant="inline-link"
                ariaLabel={`Remove ${row.file.name}`}
                onClick={() => {
                  handleRemove(row.id);
                }}
              >
                Remove
              </Button>
            ),
          },
        ]
      : []),
  ];

  const actions =
    phase === 'done' ? (
      <Button variant="primary" href={back} onFollow={handleFollow}>
        {`Go to ${bucket}`}
      </Button>
    ) : (
      <SpaceBetween direction="horizontal" size="xs">
        <Button variant="link" onClick={handleCancel}>
          Cancel
        </Button>
        <Button
          variant="primary"
          loading={phase === 'uploading'}
          disabled={rows.length === 0 || operations === undefined}
          {...(rows.length === 0 && { disabledReason: ADD_FIRST })}
          onClick={() => {
            void handleUpload();
          }}
        >
          Upload
        </Button>
      </SpaceBetween>
    );

  return (
    <>
      <Form
        header={
          <Header
            variant="h1"
            description={<Quoted before="Files are put under " name={s3Uri(bucket, prefix)} after="." />}
          >
            Upload
          </Header>
        }
        actions={actions}
      >
        <Table<FileRow>
          items={rows}
          trackBy="id"
          columnDefinitions={columns}
          wrapLines
          ariaLabels={{ tableLabel: 'Files to upload' }}
          header={
            <Header
              variant="h2"
              counter={rows.length === 0 ? undefined : `(${String(rows.length)})`}
              actions={
                phase === 'choosing' && (
                  <FileUpload
                    multiple
                    value={[]}
                    onChange={handleAdd}
                    i18nStrings={{
                      uploadButtonText: () => 'Add files',
                      dropzoneText: () => 'Drop files to add them',
                      removeFileAriaLabel: (index) => `Remove file ${String(index + 1)}`,
                      limitShowFewer: 'Show fewer files',
                      limitShowMore: 'Show more files',
                      errorIconAriaLabel: 'Error',
                      warningIconAriaLabel: 'Warning',
                    }}
                  />
                )
              }
            >
              Files
            </Header>
          }
          empty={
            <Box textAlign="center" color="inherit">
              <SpaceBetween size="xxs">
                <Box variant="strong" color="inherit">
                  No files
                </Box>
                <Box variant="p" color="inherit">
                  Add the files to put in this folder.
                </Box>
              </SpaceBetween>
            </Box>
          }
        />
      </Form>
      <DiscardDialog visible={discarding} onAnswer={handleDiscard} />
    </>
  );
}
