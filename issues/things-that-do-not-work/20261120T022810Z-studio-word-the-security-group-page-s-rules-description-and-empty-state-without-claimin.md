Issue-Id: 568
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: gap
Issue-Source: plan
Issue-Key: studio|ec2.group-rules-wording|critique-p2
Issue-Check-Ids:
Issue-Commit: 9bb0a6c407d4ad2dac9aaa256bd8789cb6fa5ee5

# Word the security group page's rules description and empty state without claiming enforcement

> Identified against commit `9bb0a6c407d4ad2dac9aaa256bd8789cb6fa5ee5`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The security group page reads "Inbound rules say what may reach an instance of this group, outbound rules what it may reach." and, with no rule, "This group allows nothing in and nothing out." Both read as if the local emulator enforced the rules, which nothing shows. The second critique of issue 553 found it (P2). The words are the requirement's and a unit criteria line's, so they were not changed inside issue 553.

## Evidence

`.pm/issue-553/review-final-r2.md`, P2 line 4; `studio/src/providers/aws/area/services/ec2/pages/group-page.tsx` (`RULES_DESCRIPTION` and the empty state).

## Steps to Reproduce

1. Start a fresh emulator and Studio.
2. Follow the evidence's screen as described above.

## Expected

- The rules table is described neutrally (the group's inbound and outbound rules) and the empty state says there is no rule, with no claim of what traffic is allowed.

## Out of scope

- The rules' columns and actions.
