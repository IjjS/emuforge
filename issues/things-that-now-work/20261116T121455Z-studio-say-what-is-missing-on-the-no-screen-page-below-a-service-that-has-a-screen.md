Issue-Id: 57
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: bug
Issue-Source: plan
Issue-Key: studio|aws-area.no-screen-page|service-with-a-screen
Issue-Check-Ids: studio.aws-no-screen-part-says-what-is-missing studio.aws-no-screen-part-changes-nothing-in-the-emulator studio.aws-no-screen-part-same-page-at-every-unlisted-path studio.aws-no-screen-part-follows-emulator-stop-and-start studio.aws-no-screen-part-keyboard-and-layout
Issue-Commit: 3fe1072bb359e60a3c71e72169eebb96dd1dc3a9

# Say what is missing on the no-screen page below a service that has a screen

> Identified against commit `3fe1072bb359e60a3c71e72169eebb96dd1dc3a9`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The AWS area's "no screen yet" page is shown at a service's route and at every path below it, with the service's
label as its `h1` and the sentence "Studio has no screen for <service label> yet." Issue #56 gives S3 its first
screen, the bucket list, at `/aws/s3` and `/aws/s3/buckets`. Every other path below `/aws/s3` (a bucket's page,
the create form, the empty and delete pages, the directory bucket list, which the bucket list's own controls lead
to) still shows that page, and its sentence then says that Studio has no screen for Amazon Simple Storage
Service, which is no longer exact: the service has a screen, this part of it has none. The page's one action is
"Go to Home"; the bucket list the user came from is not offered.

Found while planning issue #56. The page is `native` and issue #56 is `console`, so it is not changed there.
Reference: none; an EmuForge-only page of the AWS area (`studio/AGENTS.md`, "AWS screen policy").

## Evidence

```
$ cat studio/src/providers/aws/area/pages/no-screen-page.tsx | tail -3
export function NoScreenPage({ service }: { service: Service }) {
  return <EmptyPage title={service.label}>{`Studio has no screen for ${service.label} yet.`}</EmptyPage>;
}
```

`studio/src/providers/aws/area/area-page.ts` maps every path below a service's route to that page;
`.pm/issue-56/requirement.md` R6 lists the routes the bucket list leads to.

## Steps to Reproduce

1. With issue #56 merged, open `/aws/s3/buckets` and choose "Create bucket".
2. The page at `/aws/s3/bucket/create` has the `h1` "Amazon Simple Storage Service" and says Studio has no screen
   for Amazon Simple Storage Service yet; its only action leads to Home.

## Expected

- Below a service that has at least one screen, the page says that this part of the service has no screen yet,
  and never that the service has none.
- Its first action leads back into the service (its first screen); the area's index and Home follow as issue #51
  decides for these pages.
- A service without any screen keeps today's sentence.
- Flow checks cover both cases; the page keeps its critique pass.

## Out of scope

- Any service screen, and the screens the bucket list's controls lead to.
- The order of the page's actions on a service without a screen: issue #51.
