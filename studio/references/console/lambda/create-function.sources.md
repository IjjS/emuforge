# Where each item of `create-function.yaml` is found

No capture shows the form (`decisions-needed.md`, question 3). Sources as in `function-detail.sources.md`. User
guide: AWS Lambda Developer Guide, English, `docs.aws.amazon.com/lambda/latest/dg/<page>.html`, read on
2026-11-17 with `probe/guide-lines.py`. Pages: **Start** = `getting-started`; **Zip** =
`configuration-function-zip`; **Role** = `lambda-intro-execution-role`; **Tags** = `configuration-tags`.

| Spec item | Source |
|---|---|
| `breadcrumbs` Lambda, Event Functions | capture `docs/aws-console/lambda/03-event-functions`: the console's crumbs of the list |
| `breadcrumbs` Create Event Function, `header.title` | Start, Zip: "Choose **Create Event Function**" opens the form; the form is named by the action that opens it and by its button (**no source shows the form's heading**; provisional, question 3) |
| `header.actions`, `primary_action` Create Event Function | Start: "…and then choose **Create Event Function**"; Zip: "Choose **Create Event Function**" as the procedure's last step |
| `header.actions` Cancel | **not the guide's**: Cloudscape's form pattern, the way out without a request; the label is the capture's `button` "Cancel" of the dialog "Delete functions" |
| `sections` Basic information | Start: "In the **Basic information** pane"; Zip: "Under **Basic information**, do the following" |
| field Function name (text, required) | Start, Zip: "for **Function name**, enter…"; required: `CreateFunction` needs `FunctionName` |
| field Runtime (select, required) | Start: "For **Runtime**, choose either **Node.js 24** or **Python 3.14**"; Zip: "For **Runtime**, choose the language version"; required: a zip package without a runtime is refused (requirement R2) |
| field Architecture (choice, required) | Start: "Leave **architecture** set to **x86_64**"; Zip: "(Optional) For **Architecture**, choose the instruction set architecture"; one of the two is always chosen |
| `sections` Permissions | Zip: "(Optional) Under **Permissions**, expand **Change default execution role**"; Role: "in the **Permissions** section" |
| field Execution role (choice, required) | Zip: "You can create a new **Execution role** or use an existing role"; its two options are Role's "**Create default role**" and "**Use another role**" |
| field Existing role (select, required) | **not the guide's**: Role says "Use another role" opens a drawer and names no control in it; the label is the API model's `Role` written the console's way, after Zip's "use an existing role" (question 9) |
| `sections` Advanced settings | Zip: "(Optional) Expand **Advanced settings**"; Tags: "Expand **Advanced settings**, and then select **Enable tags**" |
| the sections' order | Zip: Basic information, then Permissions, then Advanced settings, in the procedure's order |
| the fields' order | Start and Zip: Function name, Runtime, Architecture, in that order |

Not items, and where the requirement uses them: "Author from scratch", "Use a blueprint", "Container image" (Zip,
Tags: the form's first choice); "Change default execution role" (Zip: the expandable part of "Permissions" that holds the role choice in the
console; a form's spec has no item for an expandable part, so requirement R6.2 places "Execution role" directly in
"Permissions", a recorded choice); the runtime names (Start; the table of `lambda-runtimes`; the capture's cell
"Node.js 24.x").
