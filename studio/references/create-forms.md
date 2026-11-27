# AWS area create and modify forms

Apply this reference to AWS area forms that create, modify or restore a resource. Use it at the Requirement
stage to decide what the form offers and at the Design stage to choose how the fields work.

**C1. A known set is chosen.** A field whose values are a set is a choice, never typed text. The set is read from
the emulator where an operation lists it (a class, a version, a zone, an instance type), otherwise it is the
operation's enumeration in the service's API model, less every value the emulator was seen to refuse at the
Requirement stage. A field stays typed only when neither the emulator nor the model has a set for it, and the
requirement says so.

**C2. A held resource is chosen.** A field that names a resource the emulator holds, of the same service or another,
is chosen from what the emulator holds now: read through the engine when the field opens and read again each time it
opens, never from a cache of the browser, with resources made outside Studio included. It is never typed as an
identifier alone.

**C2a. A modify form starts from the resource.** Each field of a modify form starts on the resource's own value,
read from the emulator. A value the field's list does not hold (a class the orderable list lacks, a storage type
set outside Studio) is still shown as the chosen one, described "Not in the emulator's list", and stays chosen
while every field its list is narrowed by (its parents, C3) is as the form opened, until the developer picks
another. A modify form sends only the members whose value differs from the one the field started on, so saving one
edit never sends another field's value, and a save with the parents untouched never asks for a value the list lacks
to be replaced.

Once the developer changes a parent in a modify form, C3 holds for its child as in a create form, the child's
starting value included: a value the parent's new list holds stays chosen (and, when it is the starting value, is
still not sent); a value the new list lacks is cleared, whether the developer chose it or the form started on it,
the field says "Choose {a value} for {parent's value}", and the form cannot be saved until one is chosen. Putting
the parent back on its starting value puts a child that was cleared for it back on its own starting value. So an
edit of a parent needs a replacement only for a child the parent's new value cannot go with, and no other save
does.

**C3. A dependent choice follows its parent.** Where the emulator's data ties one choice to another (a subnet to its
VPC, a security group to its VPC, a version to its engine, a class to its engine and version, a storage type to its
class), the parent is chosen first; the child's list is read narrowed by the parent; a child whose parent is not
chosen cannot be opened and says which field to choose first; and a change of the parent clears a child that no
longer belongs, and only that. The form narrows even where the emulator would accept a value that does not belong
(1.1).

**C4. Every option is described.** An option read from the emulator shows the emulator's own values of it beside its
name (a subnet's block and zone, a type's vCPUs and memory, a key's alias and state); no text is invented for it. A
fixed option (a radio, a tile, a checkbox, an enumerated value, and the option that stands for "none" or "chosen by
the emulator") carries one sentence, in EmuForge's own words, of what choosing it sends or what the emulator then
reports; each such sentence is backed by a call made at the Requirement stage (`aws-area.md`, point 3).

**C5. The parameter table.** For each create and modify form the requirement lists every input member of its
operation, from the API model, as offered or as left out with one reason. A form offers a member when (1) the
emulator accepts it on the form's request, (2) a read shows it or the emulator's behaviour differs by it, and (3) it
is one of the offered kinds:

- the resource's identity and labels: its name or identifier, its description, its tags;
- its size and kind: class or type, storage size and type, engine and version;
- where it sits: VPC, subnet or subnet group, zone, security groups;
- who may use or delete it: key pair, instance profile, encryption key, deletion or termination protection;
- what it starts with: a first database, the master user, user data.

A modify form offers the members of its create form's kinds that the modify operation accepts and a read shows
changed. A form that restores from a snapshot offers where the new resource sits, who may use or delete it and its
labels. The snapshot's own size and kind and what it starts with are sent as the snapshot has them or not at all,
though the emulator would take another value of each (R6): a restore brings back what was saved, and a change of
the restored resource's kind is its modify form's (X6). A field a form offers on `main` stays, whatever its kind.

Every other member is left out with one of these reasons:

| Reason | Meaning |
|---|---|
| X1 | the emulator refuses it on the form's request, or answers 501 |
| X2 | accepted, and no read shows it |
| X3 | accepted and shown, but not of the offered kinds: the emulator keeps it as a value and no task of the service's screens uses it |
| X4 | needs a kind of resource that no form of the three services makes and no list of this issue reads (a directory, an option or parameter group, an Outpost, an IPAM pool, a launch template, a prefix list) |
| X5 | a second way to say what an offered field says, or a mechanism of the request (`DryRun`, `ClientToken`, `ApplyImmediately`, which the form sends itself) |
| X6 | fixed by the form on purpose |
| X7 | a repeating structure that makes a second resource which has a form of its own |

**C6. What does not change.** A form's submit, its errors, its "Cancel" (`aws-area.md`, "What earlier critiques
found", 5), its constraint texts (2) and the 501 state (`studio/AGENTS.md`) are as before; this rule adds no screen.

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
