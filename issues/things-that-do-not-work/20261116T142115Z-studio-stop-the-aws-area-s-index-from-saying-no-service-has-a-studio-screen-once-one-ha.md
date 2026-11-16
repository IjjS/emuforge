Issue-Id: 61
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: bug
Issue-Source: plan
Issue-Key: studio|aws-area.index|no-service-has-a-screen-sentence
Issue-Check-Ids:
Issue-Commit: e3e2027757e708c29b88927fb2c504a3fa4b1eda

# Stop the AWS area's index from saying no service has a Studio screen once one has

> Identified against commit `e3e2027757e708c29b88927fb2c504a3fa4b1eda`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The AWS area's index (`/aws`) lists the services under the heading "Services (19)" with the description "No
service has a Studio screen yet." The sentence is a constant of the page. Issue #56 gives Amazon Simple Storage
Service its first screen, the bucket list; from the merge of its `s3` unit the index states something that is no
longer true, and it does not show which of the listed services lead to a screen and which to a "no screen yet"
page.

Found while planning issue #57 (the "no screen yet" page below a service that has a screen), which has the same
cause on another page: the area's own pages do not read the area's screens registry. Issue #56 changes nothing
on the index (its breakdown gives `pages/index-page.tsx` to no unit).

Reference: none; an EmuForge-only page of the AWS area (`studio/AGENTS.md`, "AWS screen policy", point 3: the
area's own words say only what is known).

## Evidence

```
$ grep -n "No service has" studio/src/providers/aws/area/pages/index-page.tsx
39:            description="No service has a Studio screen yet."
$ grep -rn "No service has" studio/src --include=*.test.tsx
studio/src/app/routes.test.tsx:120:    expect(header).toHaveTextContent('No service has a Studio screen yet.');
studio/src/providers/aws/area/area-layout.test.tsx:672:    expect(services?.findDescription()?.getElement()).toHaveTextContent('No service has a Studio screen yet.');
```

`studio/src/providers/aws/area/screens.ts` (`SCREENS`) is the registry the sentence does not read;
`.pm/issue-56/breakdown.md` unit `s3` adds the S3 entry to it.

## Steps to Reproduce

1. With issue #56 merged, open `/aws`.
2. The "Services" container says "No service has a Studio screen yet." while its link "Amazon Simple Storage
   Service" opens the bucket list.

## Expected

- The index never says that no service has a Studio screen while the area's registry lists a screen.
- What it says about the services' screens follows the registry: with no screen registered, today's sentence;
  with one or more, a statement that is true for the registry as it is, and the services that have a screen can
  be told from those that have none.
- The two unit cases that read the sentence follow the registry too; flow checks cover the index with S3's
  screen registered; the page keeps its critique pass.

## Out of scope

- The "no screen yet" page (issue #57) and the dead-end pages' actions (issue #51).
- Any service screen.
