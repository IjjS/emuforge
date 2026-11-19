import Alert from '@cloudscape-design/components/alert';
import Button from '@cloudscape-design/components/button';
import FileUpload from '@cloudscape-design/components/file-upload';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useState, type ReactNode } from 'react';

import type { RequestFailure } from '../../../../../../lib/aws/request';
import { actionFailureItem, Code } from '../../../components/failure-states';
import type { FlashItem } from '../../../components/page-flash';
import { usePageFlash } from '../../../components/page-flash';
import { isTooLarge } from '../api';
import { NOT_READY } from '../configuration-form';
import { useUpdateFunctionCode } from '../queries';
import { isZipArchive } from '../zip';

// "Upload a .zip file" in "Package" of the tab "Code" (issue 516, design "Task 3"). Studio checks that a file is
// chosen and that its last 65,557 bytes hold a zip end record, and nothing else of it; the whole file is read only to
// be sent as `UpdateFunctionCode`'s `ZipFile`. Studio sets no limit on the size: the emulator's refusal is shown as
// it answers.

const FILE_RULE = "One .zip file. It replaces all of the function's code.";
const NO_FILE = 'Choose a .zip file.';

export interface UploadCodeProps {
  /** The function's name, as its page's address names it. */
  name: string;
  /** The engine's origin. */
  engineOrigin: string | undefined;
  /** False while the function is being created or updated. */
  ready: boolean;
}

/** "{file} is not a .zip archive." */
function notAnArchive(file: File): string {
  return `${file.name} is not a .zip archive.`;
}

/**
 * The file field and "Upload". A refusal as too large is said at the field with the status as it came; any other
 * failure under the field as the area words it. The file stays chosen after a failure and is emptied after a success.
 */
export function UploadCode({ name, engineOrigin, ready }: UploadCodeProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [fieldError, setFieldError] = useState<ReactNode>();
  const [failure, setFailure] = useState<FlashItem>();
  const [checking, setChecking] = useState(false);
  const flash = usePageFlash();
  const upload = useUpdateFunctionCode(engineOrigin, name);
  const busy = upload.isPending || checking;

  const handleFailure = (file: File, failed: RequestFailure) => {
    if (isTooLarge(failed)) {
      setFieldError(
        <>
          The emulator refused {file.name} as too large.
          {failed.kind === 'other' && failed.code !== '' && (
            <>
              {' '}
              <Code>{failed.code}</Code>
            </>
          )}
        </>,
      );
      return;
    }
    setFailure(actionFailureItem(failed, `Uploading ${file.name}`, engineOrigin));
  };

  const handleUpload = async () => {
    if (busy || !ready) {
      return;
    }
    setFailure(undefined);
    const file = files[0];
    if (file === undefined) {
      setFieldError(NO_FILE);
      return;
    }
    setChecking(true);
    let bytes: Uint8Array | undefined;
    try {
      bytes = (await isZipArchive(file)) ? new Uint8Array(await file.arrayBuffer()) : undefined;
    } catch {
      // The file could not be read (moved or deleted after it was chosen): said as the create form says it.
      bytes = undefined;
    } finally {
      setChecking(false);
    }
    if (bytes === undefined) {
      setFieldError(notAnArchive(file));
      return;
    }
    setFieldError(undefined);
    upload.mutate(bytes, {
      onSuccess: () => {
        setFiles([]);
        flash.show([{ type: 'success', content: `Code uploaded to ${name}.` }]);
      },
      onError: (failed) => {
        handleFailure(file, failed);
      },
    });
  };

  return (
    <SpaceBetween size="s">
      <Header variant="h3">Upload a .zip file</Header>
      <FormField label="File" constraintText={FILE_RULE} errorText={fieldError}>
        {/* A fieldset makes the file control unavailable while the upload is in flight; it has no look of its own. */}
        <fieldset disabled={upload.isPending} style={{ border: 0, margin: 0, padding: 0, minInlineSize: 0 }}>
          <FileUpload
            accept=".zip"
            value={files}
            onChange={({ detail }) => {
              setFiles(detail.value.slice(-1));
              setFieldError(undefined);
              setFailure(undefined);
            }}
            i18nStrings={{
              uploadButtonText: () => 'Choose file',
              dropzoneText: () => 'Drop a .zip file to choose it',
              removeFileAriaLabel: () => 'Remove file',
              limitShowFewer: 'Show fewer files',
              limitShowMore: 'Show more files',
              errorIconAriaLabel: 'Error',
              warningIconAriaLabel: 'Warning',
            }}
          />
        </fieldset>
      </FormField>
      {failure !== undefined && (
        <Alert type={failure.type} header={failure.header}>
          {failure.content}
        </Alert>
      )}
      <Button
        disabled={!ready}
        disabledReason={NOT_READY}
        loading={busy}
        onClick={() => {
          void handleUpload();
        }}
      >
        {upload.isPending ? 'Uploading' : 'Upload'}
      </Button>
    </SpaceBetween>
  );
}
