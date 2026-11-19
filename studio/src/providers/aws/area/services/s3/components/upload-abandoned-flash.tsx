import { useEffect, type ComponentType } from 'react';

import { usePageFlash } from '../../../components/page-flash';
import type { ScreenPageProps } from '../../../screens';
import { actionFailure } from './action-failure';
import { Quoted } from './quoted';
import { listenForAbandoned } from './upload-abandoned';

// Every page of S3 shows, in the area's flash, a multipart upload the Upload page could not abort (issue 480, task 3):
// "The unfinished upload `{upload id}` of `{key}` could not be aborted:" with the emulator's message, also once the
// Upload page is gone.

function useAbandonedUploadFlash(engineOrigin: string | undefined): void {
  const flash = usePageFlash();
  useEffect(
    () =>
      listenForAbandoned(({ key, uploadId, failure }) => {
        const view = actionFailure(failure, 'Aborting the upload', engineOrigin);
        flash.show([
          {
            type: 'error',
            header: (
              <>
                <Quoted before="The unfinished upload " name={uploadId} after=" of " />
                <Quoted before="" name={key} after=" could not be aborted:" />
              </>
            ),
            content: view.detail ?? view.header,
          },
        ]);
      }),
    [flash, engineOrigin],
  );
}

/** `Page`, which also shows the uploads the Upload page could not abort. */
export function withAbandonedUploads(Page: ComponentType<ScreenPageProps>): ComponentType<ScreenPageProps> {
  function WithAbandonedUploads(props: ScreenPageProps) {
    useAbandonedUploadFlash(props.connection.engineOrigin);
    return <Page {...props} />;
  }
  WithAbandonedUploads.displayName = `WithAbandonedUploads(${Page.displayName ?? Page.name})`;
  return WithAbandonedUploads;
}
