Issue-Id: 618
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|aws-area.document-field|code-editor
Issue-Check-Ids:
Issue-Commit: ed00e3ee1f63bf394dd7f507baf0d93aa6e36224

# Give the area's document field a code editor for JSON

> Identified against commit `ed00e3ee1f63bf394dd7f507baf0d93aa6e36224`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
The area's field of a text document (`studio/src/providers/aws/area/components/document-field.tsx`, written by issue
575 for ECS's "Register task definition") is a Cloudscape `Textarea`: the JSON is in a proportional font, Tab leaves
the field and nothing indents. The impeccable critique of issue 575 raised it in every round (P3): Cloudscape's code
editor is the published way to edit a document. IAM's document screens hold the same kind of field
(`services/iam/components/document-editor.tsx`; issue 590 moves them onto the area's). The reference is Cloudscape's
own component for the task, not an AWS screen.

## Evidence
The critique's finding (final r1 and after, on `feat/575`):

```
- [studio/src/providers/aws/area/components/document-field.tsx:38-48] S10 JSON in a proportional font, no indent key;
  Cloudscape CodeEditor is the published way (shared; likely its own issue).
```

The field at `ed00e3ee`:

```
    <FormField label={label} description={description} errorText={invalid ? errorText : undefined} stretch>
      <Textarea
        ref={textareaRef}
        value={value}
        …
        rows={rows}
        spellcheck={false}
        invalid={invalid}
      />
    </FormField>
```

## Steps to Reproduce
1. Open ECS's "Register task definition" (`/aws/ecs/task-definitions/register`).
2. Read the starter JSON in the field and press Tab inside it.

## Expected
- A document is edited in a fixed-width font with its indents kept, and a key indents inside the field without trapping the keyboard (the field can be left by keyboard alone).
- The field keeps its label, description and error text, and what the screens that use it send is unchanged.
- The area still loads no code of the editor until a screen that has the field is opened.

## Out of scope
- Validation of a task definition or a policy beyond what the screens do today.
