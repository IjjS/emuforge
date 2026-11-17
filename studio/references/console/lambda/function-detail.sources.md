# Where each item of `function-detail.yaml` is found

No capture shows a function's page (`decisions-needed.md`, question 3). Sources, in the order
`studio/references/console-reference.md` gives them, then the API's model as the owner's scope allows (the issue
files 87 to 292: "the user guide and the API's model give its fields"). An item from the API's model is the
model's member name written the console's way (sentence case) and is replaced when the owner adds a capture of
this page.

User guide: AWS Lambda Developer Guide, English, `docs.aws.amazon.com/lambda/latest/dg/<page>.html`, read on
2026-11-17 with `probe/guide-lines.py` (bold labels of the console procedures; nothing is copied but the labels).
Pages: **Start** = `getting-started`; **Zip** = `configuration-function-zip`; **Test** = `testing-functions`;
**Logs** = `monitoring-cloudwatchlogs-view`; **Timeout** = `configuration-timeout`; **Alias** =
`configuration-aliases`; **Version** = `configuration-versions`; **Url** = `urls-configuration`.

| Spec item | Source |
|---|---|
| `breadcrumbs` Lambda, Event Functions | capture `docs/aws-console/lambda/03-event-functions`: the console's crumbs of the list |
| `breadcrumbs` structure-function, `header.title` structure-function | Logs: "Open the Event Functions page of the Lambda console. Select an Event Function." opens the function's page, which is named by the function; the name is the seeded function's (requirement R12) |
| `header.actions` Refresh | **no source shows it on a function's page.** The label is the list's `button` "Refresh" in capture `03-event-functions`, the same console's control for reading again; provisional until a capture of a function's page (question 7) |
| `tabs` Code | Start: "Choose the **Code** tab"; Zip: "choose the **Code** tab" |
| `tabs` Test | Test: "Choose the **Test** tab" |
| `tabs` Monitor | Logs: "Choose the **Monitor** tab" |
| `tabs` Configuration | Timeout: "Choose the **Configuration** tab and then choose **General configuration**" |
| `tabs` Aliases | Alias: "Choose **Aliases** and then choose **Create alias**" |
| `tabs` Versions | Version: "Choose a function and then choose the **Versions** tab" |
| the tabs' order | **no source** shows the tabs side by side; the order written is provisional (question 8) |
| `sections` Function overview | Url: the function URL "appears in the **Function overview** section of the console" |
| field Function URL | Url: the same sentence; the label is the guide's name for the value ("function URL", "**Create function URL**") |
| fields Description, Last modified | capture `03-event-functions`: the list's column labels for the same values |
| field Function ARN | API model, `FunctionConfiguration.FunctionArn` |
| `sections` Code source | Zip: "Under **Code source**, choose **Upload from**" (on the "Code" tab) |
| `sections` Runtime settings | Zip: "Scroll down to the **Runtime settings** section, which is under the code editor"; "Under **Runtime settings**, choose **Edit**" |
| field Runtime | capture `03-event-functions`: the list's column label for the same value; Zip: the runtime is changed under "Runtime settings" ("Changing the runtime") |
| field Handler | Zip: "For **Handler**, specify file name and handler for your function" (under "Runtime settings") |
| field Architecture | Zip: "For **Architecture**, choose the instruction set architecture" (under "Runtime settings") |
| the sections' order | Url places "Function overview" as the page's own section, above the tabs; Zip: "Runtime settings" is "under the code editor", so after "Code source" |

Which fields "Function overview" holds beside "Function URL", and the fields' order in both sections, is in no
source; requirement R5.3 and R5.5 set it, provisional until a capture of a function's page (question 3).
