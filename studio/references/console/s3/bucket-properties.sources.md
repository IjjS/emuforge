# Where each item of `bucket-properties.yaml` is found

No capture shows a bucket's page (`decisions-needed.md`, question 3). Sources, in the order
`studio/references/console-reference.md` gives them, then the API's model as the issue file allows ("where no
capture exists for a page … the user guide and the API's model give its fields"). An item from the API's model is
the model's member name written the console's way and is replaced when the owner adds a capture of this page.

User guide: Amazon S3 User Guide, English, `docs.aws.amazon.com/AmazonS3/latest/userguide/<page>.html`, read on
2026-11-17 with `probe/guide-lines.py` (the bold labels of the console procedures; nothing is copied but the
labels). Pages: **View** = `view-bucket-properties`; **Folders** = `using-folders`; **Meta** =
`metadata-tables-create-configuration`; **BPA** = `configuring-block-public-access-bucket`; **ReqMetrics** =
`configure-request-metrics-bucket`; **Lifecycle** = `how-to-set-lifecycle-configuration-intro`; **Versioning** =
`manage-versioning-examples`; **Abac** = `buckets-tagging-enable-abac`; **Create** = `create-bucket-overview`;
**Enc** = `default-bucket-encryption`; **Tiering** = `using-intelligent-tiering`; **Logging** =
`enable-server-access-logging`; **Events** = `enable-event-notifications`; **Bridge** =
`enable-event-notifications-eventbridge`; **Accel** = `transfer-acceleration-examples`; **Lock** =
`object-lock-configure`; **Payer** = `RequesterPaysExamples`; **Website** = `EnableWebsiteHosting`; **Policy** =
`add-bucket-policy`.

| Spec item | Source |
|---|---|
| `breadcrumbs` S3, Buckets | capture `docs/aws-console/s3/02-general-purpose-buckets`: the console's crumbs of the list |
| `breadcrumbs` structure-bucket, `header.title` structure-bucket | View: the procedure chooses a bucket's name in the buckets list, which opens the bucket's page, named by the bucket; the name is the seeded bucket's |
| `tabs` Objects | Folders: "**Objects** tab" |
| `tabs` Metadata | Meta: "**Metadata** tab" |
| `tabs` Properties | View: "Choose the **Properties** tab." |
| `tabs` Permissions | BPA: "Choose **Permissions**." |
| `tabs` Metrics | ReqMetrics: "**Metrics** tab" |
| `tabs` Management | Lifecycle: "**Management** tab" |
| the tabs' order | **no source** shows the tabs side by side; the order written is provisional (question 2) |
| `sections` Bucket overview | Payer: the page "displays your **Bucket overview**" |
| fields AWS Region, Creation date | capture `02-general-purpose-buckets`: the list's column labels for the same values |
| field Bucket ARN | Policy: the console "displays the **Bucket ARN**"; the value is the API model's `Bucket.BucketArn` |
| `sections` Bucket Versioning, field Bucket Versioning | View: the list of the tab's properties, "**Bucket Versioning**"; Versioning: "Under **Bucket Versioning**, choose **Edit**" |
| `sections` Bucket ABAC, field Bucket ABAC | Abac: "In the **Bucket ABAC** panel, and choose **Edit**" |
| `sections` Tags | View: "**Tags**" |
| `sections` Default encryption | View: "**Default encryption**"; Enc: "Under **Default encryption**, choose **Edit**" |
| fields Encryption type, AWS KMS key, Bucket Key | Enc: "under **Encryption type**", "Under **AWS KMS key**", "Under **Bucket Key**" |
| `sections` S3 Intelligent-Tiering Archive configurations | Tiering: "Navigate to the **S3 Intelligent-Tiering Archive configurations** section and choose **Create configuration**" |
| `sections` Server access logging, field Server access logging | View: "**Server access logging**"; Logging: "In the **Server access logging** section, choose **Edit**" |
| field Destination bucket | Logging: "Under **Destination bucket**, specify a bucket and an optional prefix" |
| `sections` AWS CloudTrail data events | View: "**AWS CloudTrail data events**" |
| `sections` Event notifications | View: "**Event notifications**"; Events: "Navigate to the **Event Notifications** section and choose **Create event notification**" |
| `sections` Amazon EventBridge | Bridge: "Navigate to the **Event Notifications** section and find the **Amazon EventBridge** subsection. Choose **Edit**" |
| field Send notifications to Amazon EventBridge for all events in this bucket | Bridge: "Under **Send notifications to Amazon EventBridge for all events in this bucket** choose **On**" |
| `sections` Transfer acceleration, field Transfer acceleration | View: "**Transfer acceleration**"; Accel: "Under **Transfer acceleration**, choose **Edit**" |
| `sections` Object Lock, field Object Lock | View: "**Object Lock**"; Lock: "Under **Properties**, scroll down to the **Object Lock** section, and choose **Edit**" |
| fields Default retention, Retention mode, Default retention period | Lock: "Under **Default retention**, choose **Enable**", "Under **Retention mode**, choose either **Governance mode** or **Compliance mode**", "Under **Default retention period**" |
| `sections` Requester pays, field Requester pays | View: "**Requester Pays**"; Payer: "Under **Requester pays**, choose **Edit**", "Under **Requester pays**, you see **Enabled**" |
| `sections` Static website hosting, field Static website hosting | View: "**Static website hosting**"; Website: "Under **Static website hosting**, choose **Edit**" |
| fields Index document, Error document | Website: "In **Index document**, enter the file name of the index document", "in **Error document**, enter the custom error document file name" |
| field Endpoint (omitted) | Website: "Under **Static website hosting**, note the **Endpoint**" |
| field Accelerated endpoint (omitted) | Accel: "Under **Transfer acceleration**, **Accelerated endpoint**" |
| the sections' order | View lists Bucket Versioning, Tags, Default encryption, Server access logging, AWS CloudTrail data events, Event notifications, Transfer acceleration, Object Lock, Requester Pays, Static website hosting in that order. **No source** places "Bucket overview", "Bucket ABAC", "S3 Intelligent-Tiering Archive configurations" among them; "Amazon EventBridge" follows "Event notifications" as its subsection (Bridge). Their places are provisional (question 3) |

Which fields each section holds beside the ones a procedure names, and the fields' order, is in no source;
requirement R5.3 sets it, provisional until a capture of a bucket's page (question 3). The values ("Enabled",
"Disabled", "Suspended", "On", "Off", the three encryption types) are the guide's words on the pages above and on
Create.
