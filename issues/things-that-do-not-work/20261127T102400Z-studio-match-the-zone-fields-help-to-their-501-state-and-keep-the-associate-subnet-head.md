Issue-Id: 689
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: bug
Issue-Source: plan
Issue-Key: studio|ec2-vpc.zone-field-and-headings|failure-state-wording
Issue-Check-Ids:
Issue-Commit: 9ca6568bce7018a52d430993eea7a49e1dfd5e7a

# Match the zone fields' help to their 501 state and keep the associate subnet heading together at 390 px

> Identified against commit `9ca6568bce7018a52d430993eea7a49e1dfd5e7a`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

Three small faults of wording and placement that the impeccable critique of issue 651 found (third `final`, P3) in
states the forms rarely show:

- Create volume (`studio/src/providers/aws/area/services/ec2/pages/create-volume-page.tsx:183`): when `DescribeAvailabilityZones` answers 501 and the
  required zone field is disabled, the section's description still tells the developer to choose a zone.
- Create subnet (`studio/src/providers/aws/area/services/vpc/pages/create-subnet-page.tsx:297`): when the same read answers 501 and only "Chosen by the
  emulator" is left, its explanation is inside the picker only, not by the closed field.
- Associate subnet (`studio/src/providers/aws/area/services/vpc/pages/associate-subnet-page.tsx:198`): at 390 px the route table's name wraps alone
  onto the second line of the heading's description.

The reference is the same forms' other states, where the help matches what the field can do.

## Evidence

`.pm/issue-651/review-final.md` (third `final`, section P3), on the built app of `feat/651` at `9ca6568b`; the critique's
captures and logs are under `output/` of the issue's worktree (`emuforge-651`) and are not kept after the issue is
archived: reproduce on `main`.

## Steps to Reproduce

1. Open Studio on an emulator; for the first two, make `DescribeAvailabilityZones` answer 501 (a browser fixture,
   as the critique did: the emulator supports the read).
2. Open `/aws/ec2/volumes/create` and `/aws/vpc/subnets/create` and read the zone field and the text around it.
3. At 390x844, open "Associate subnet" of a route table with a name and read the heading's description.

## Expected

- Create volume's description does not ask for a choice the 501 state makes impossible.
- Create subnet shows the omission's explanation by the closed zone field when no other option is offered.
- The associate subnet heading's description keeps the route table's name with its sentence at 390 px.

## Out of scope

- The 501 state itself and the fields' choices (issue 651).
