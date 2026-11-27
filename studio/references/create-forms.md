# AWS area create and modify forms

Apply this reference to AWS area forms that create, modify or restore a resource. Use it at the Requirement
stage to decide what the form offers and at the Design stage to choose how the fields work.

**C1. A known set is chosen.** Use a choice field for a set of values. Read the set from the emulator when an
operation lists it, as with classes, versions, zones and instance types. Otherwise use the operation's API model
enumeration, excluding values the emulator refused in Requirement probes. Use a text field only when neither
source supplies a set, and record that in the requirement.

**C2. A held resource is chosen.** When a field names a resource held by the emulator, read its choices from
the emulator through the engine on every opening. Include resources created outside Studio. Give each choice
the resource's identifier and the description specified by C4.

**C2a. A modify form starts from the resource.** Initialize each field with the current value from the emulator.
If the list lacks the starting value, keep it selected with the description "Not in the emulator's list" while
its parents are on their starting values, until the developer chooses another value. Send only members whose
values differ from their starting values.

When a parent changes, apply C3 to every affected child, including its starting value. Keep a value the new list
holds. Clear a value the new list lacks and require the developer to pick a replacement with the message
"Choose {a value} for {parent's value}". When the parent returns to its starting value, restore the starting
value of a child that was cleared for it.

**C3. A dependent choice follows its parent.** Choose the parent first, as when a subnet follows a VPC, a class
follows an engine and version, or a storage type follows a class. Narrow the child's list to the selected parent
even when the emulator accepts values outside that list. Keep the child disabled until the parent is chosen and
say which field to choose first. When the parent changes, keep a child's value if it belongs to the new list and
clear it otherwise.

**C4. Every option is described.** Show values from the emulator beside each option's name, such as a subnet's
block and zone, an instance type's vCPUs and memory, or a key's alias and state. Leave out values the emulator
did not give. Give each fixed option one sentence in EmuForge's own words, including presets such as "None" or
"Chosen by the emulator". Explain what the selection sends or what the emulator reports, based on the Requirement
probes (see `aws-area.md`, point 3).

**C5. The parameter table.** Record every input member of the operation's API model in the requirement. Offer a
member when the emulator accepts it on this form's request, a read shows it or it changes the emulator's behavior,
and it is of an offered kind.

- Identity and labels, such as a name, identifier, description or tags.
- Size and kind, such as class, type, storage size and type, engine or version.
- Placement, such as VPC, subnet or subnet group, zone or security groups.
- Use and deletion, such as key pair, instance profile, encryption key, deletion or termination protection.
- Initial contents, such as a first database, master user or user data.

On a modify form, apply those kinds to the members the modify operation accepts and a read shows changed. On a
snapshot restore, offer placement, use and deletion settings, and labels. Take size, kind and initial contents
from the snapshot or omit those inputs. A subsequent modify can change them where the emulator supports it (X6).
Retain fields the form already offers.

Record one reason for each omitted member.

| Reason | Meaning |
| --- | --- |
| X1 | The emulator refuses the member on this form's request or answers 501. |
| X2 | The emulator accepts the value and it is absent from reads. |
| X3 | The emulator accepts and shows the value, and it falls outside the offered kinds and serves no task of the service's screens. |
| X4 | The member needs a kind of resource unavailable from the forms and lists that support this workflow, such as a directory, parameter group, Outpost, IPAM pool, launch template or prefix list. |
| X5 | The member duplicates an offered value or is a mechanism of the request, such as `DryRun`, `ClientToken` or `ApplyImmediately` supplied by the form. |
| X6 | The form intentionally fixes the member's value. |
| X7 | A repeating structure makes a second resource that has a form of its own. |

**C6. Use the area's form patterns.** Use the existing submit, errors and 501 states in `studio/AGENTS.md`, and the
constraint text and Cancel patterns in `aws-area.md` under "What earlier critiques found". Apply these rules to
the existing screens.

## Shared parts

- `providers/aws/area/components/choice-select.tsx` and `choice-multiselect.tsx` read a page at a time through
  `use-paged-choices.ts`. Mark held resources with `readAgainOnOpen`. Give each source the parent's value in
  its key and in the API filter when available. Use `lockedBy` for an unchosen parent, `held` for a check in
  progress and `none` for a contextual empty message. The form owns the chosen values and decides which
  children to clear.
- `providers/aws/area/components/tags-field.tsx` and `lib/tag-rows.ts` supply the optional tag rows and their
  validation. Submit the checked rows in order, with any tag supplied by the form itself first.
- `providers/aws/area/components/kms-key-choices.ts`, `security-group-choices.ts` and
  `use-availability-zones.ts` supply choices from the engine for keys, groups and zones.
