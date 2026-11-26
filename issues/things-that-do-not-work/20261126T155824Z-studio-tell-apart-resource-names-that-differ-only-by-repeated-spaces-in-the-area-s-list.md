Issue-Id: 664
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: bug
Issue-Source: plan
Issue-Key: studio|names-with-repeated-spaces|labels
Issue-Check-Ids:
Issue-Commit: b39aa927c3c654f3ae9681167c4f028c9339f345

# Tell apart resource names that differ only by repeated spaces in the area's lists, links and choices

> Identified against commit `b39aa927c3c654f3ae9681167c4f028c9339f345`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

A resource name can hold two or more spaces in a row (a CloudWatch Logs stream name can hold any character but `:`
and `*`). Studio shows a name as HTML text, as the label of a Cloudscape `Select` option, and as the accessible name
of a link or a selection control; each of these collapses repeated spaces into one. Two stored names that differ
only by the number of spaces in a row are then presented as the same name: a developer choosing a stream to search,
or a user of assistive technology following a link or selecting a row, cannot tell which resource is meant. The
values sent to the emulator and written in addresses are exact; only what is shown and announced is ambiguous.

The fault was found in the CloudWatch Logs screens of issue 71 by the implementation review's round 4. Its cause,
the collapsing of whitespace by HTML rendering and by accessible-name computation, is not particular to that
service: every list, link and choice of the area that shows a name the emulator lets hold repeated spaces is
exposed to it. Other services' screens were not examined for it when this was filed.

The reference behavior is what Studio already does for line terminators in a stream's name (issue 71): the name is
shown as it is, and where rendering would hide a difference its exact escaped identity is shown and announced with
it (`streamNameLabel` in `studio/src/providers/aws/area/services/logs/format.ts`).

## Evidence

The finding of the implementation review of issue 71, round 4 (`review-impl-r4.md`, 2026-11-27, on `feat/71` at
`b39aa927c`), first P1, quoted:

> [studio/src/providers/aws/area/services/logs/format.ts:59; studio/src/providers/aws/area/services/logs/choices.ts:37;
> studio/src/providers/aws/area/services/logs/components/stream-section.tsx:75,118] The escaped identity still
> produces indistinguishable labels for some multiline names. For example, `first  second\nthird` and `first
> second\nthird` have distinct stored names, but Cloudscape collapses the repeated spaces in the S5 choice and
> accessible-name computation collapses them in the S3/S6 link labels and S3 selection controls. Both are presented
> as `first second\nthird`.

The `pm` took it out of issue 71 as an issue of its own (decisions of issue 71, `## Review decisions`, impl r4,
2026-11-27).

## Steps to Reproduce

1. On the emulator, in one log group, create two log streams whose names differ only by one space against two in a
   row (`first second` and `first  second`), each with one event.
2. Open the log group in Studio, then Log streams and Log events with that group chosen.
3. Read the stream names in the tables, the labels of the stream choice on Log events, and the accessible names of
   the stream links and of the rows' selection controls.

## Expected

The two streams are told apart by sight and by their accessible names wherever a name is shown or chosen, and each
label stays tied to its exact stored value. The rule is the area's, so that every service's names follow it, and it
changes nothing in what is sent to the emulator or written in an address.

## Out of scope

- Line terminators in a name: answered in issue 71.
- Leading and trailing spaces and other invisible characters, unless the same rule covers them at no further cost.
- Names in Studio's own layer outside the AWS area.
