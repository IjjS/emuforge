Issue-Id: 679
Issue-Severity: HIGH
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|create-forms.keys-and-secrets|choices-from-emulator
Issue-Check-Ids:
Issue-Commit: fab7ba7217133ac83b9d3844d380d1db51565c41

# Make the create forms of S3, KMS, Secrets Manager and Systems Manager choose from what the emulator holds

> Identified against commit `fab7ba7217133ac83b9d3844d380d1db51565c41`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The owner's words for issue 651 (2026-11-26) are this issue's ground: create forms are thin; a field with a known
set of values is chosen, not typed; a dependent choice follows its parent; the forms connect one service to
another; each option has at least a short description; and it is checked that a form takes the parameters the
resource needs. Issue 651 was cut by service family (`pm`, 2026-11-27): it holds the rule
(`studio/references/create-forms.md`), the shared parts (the choice fields that read again on every opening, lock on
a parent and describe each option; the tags part; the KMS key source) and the forms of RDS, EC2 and VPC. This issue
brings the same rule to S3, KMS, Secrets Manager and Systems Manager: 15 forms (S3 4, KMS 4, Secrets Manager 5, Systems Manager 2, counted on `main` at `3ca5e3bf`). The reference for each form is the same request sent straight to
aws-emulator: what its operation accepts, and what the emulator's lists hold to choose from.

This issue waits for issue 651's base on `main`: it builds on the rule and the shared parts, and does not make its
own.

## Evidence

Form counts measured on `main` at `3ca5e3bf` (`.pm/issue-651/decisions-needed.md`, first entry). Fields that take the
identifier of a resource of another service as typed text, at `fab7ba72`:

- `studio/src/providers/aws/area/services/s3/pages/create-bucket-page.tsx:404`: "AWS KMS key"
- `studio/src/providers/aws/area/services/s3/pages/notification-page.tsx:432`: "Destination ARN"
- `studio/src/providers/aws/area/services/secretsmanager/pages/create-page.tsx:159` and `components/lifecycle/lifecycle-dialog.tsx:90`: "KMS key ARN"
- `studio/src/providers/aws/area/services/secretsmanager/components/rotation-replication/rotation.tsx:48`: "Rotation Lambda function ARN"
- `studio/src/providers/aws/area/services/secretsmanager/components/rotation-replication/replication.tsx:37` and `:40`: "Target Region", "KMS key ARN
  (optional)"
- `studio/src/providers/aws/area/services/ssm/components/form/parameter-fields.tsx:87`: "KMS key ID"
- `studio/src/providers/aws/area/services/kms/components/access/grant-fields.tsx:57`: "Grantee principal ARN"

No parameter table of these forms' operations has been made from calls to the emulator; that is this issue's
requirement stage.

## Steps to Reproduce

1. Start a fresh emulator and open Studio on it.
2. Open each create and modify form of S3, KMS, Secrets Manager and Systems Manager.
3. For each field, compare it with the rule of `studio/references/create-forms.md` (on `main` once issue 651 is
   merged) and with the members the form's operation accepts on the emulator: a value the emulator holds or lists
   that is typed, a dependent field that does not follow its parent, an option with no description, a parameter the
   resource needs that the form does not take.

## Expected

- Every field of these forms whose values the emulator holds or lists is a choice read from the emulator, read
  again on each opening, and a resource made outside Studio while the form is open is offered at the next opening.
- A dependent choice is locked until its parent is chosen, narrowed by it, and cleared only when it no longer
  belongs.
- Every option shows at least a short description.
- Each form offers the parameters its resource needs by the offering rule of `studio/references/create-forms.md`,
  each shown from a call to the emulator; a parameter left out has its reason.
- A read answering 501 is shown as "Not implemented by the emulator" with the operation's name, never hidden.
- The owner's issue 651 is finished only when this issue and its two siblings are.

## Out of scope

- The rule itself and the area's shared parts: issue 651's. A change one of these forms needs in a shared part is
  made additively, in this issue.
- The forms of RDS, EC2 and VPC (issue 651) and of the other two families (the sibling issues).
- Forms of services built after 2026-11-27 (CloudWatch, issue 70, and EventBridge, issue 75, keep their own forms
  to the rule).
- Matching the AWS console's screens.
