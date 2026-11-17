# Where each item of `create-bucket.yaml` is found

No capture shows the form (`decisions-needed.md`, question 3). Sources as in `bucket-properties.sources.md`.
User guide pages: **Create** = `create-bucket-overview`; **Lock** = `object-lock-configure`; **Block** =
`access-control-block-public-access`; **Enc** = `default-bucket-encryption`.

| Spec item | Source |
|---|---|
| `breadcrumbs` S3, Buckets | capture `docs/aws-console/s3/02-general-purpose-buckets`: the console's crumbs of the list |
| `breadcrumbs` Create bucket, `header.title` Create bucket | Create: "Choose **Create bucket**. The **Create bucket** page opens." |
| `header.actions` Create bucket, `header.primary_action` | Create: the procedure's last step, "Choose **Create bucket**."; capture `02-general-purpose-buckets`: the list's primary button of the same name |
| `sections` General configuration | Create: "Under **General configuration**" |
| field Region | Lock: "For **Region**" (the create procedure of that page); Create: the Region is viewed under "General configuration" |
| field Bucket name | Create: "For **Bucket name**, enter a name for your bucket" |
| field Copy settings from existing bucket | Create: "under **Copy settings from existing bucket**, select **Choose bucket**" |
| `sections` Object Ownership, field Object Ownership | Create: "Under **Object Ownership**"; the choices "**Bucket owner enforced (default)**", "**Bucket owner preferred**", "**Object writer**" |
| `sections` Block Public Access settings for this bucket | Create: "Under **Block Public Access settings for this bucket**" |
| fields BlockPublicAcls, IgnorePublicAcls, BlockPublicPolicy, RestrictPublicBuckets | **no page of the guide gives the form's labels.** Block names the four settings by these names (the API model's `PublicAccessBlockConfiguration` members); provisional until a capture of the form (question 3) |
| `sections` Bucket Versioning, field Bucket Versioning | Create: "**Bucket Versioning** is disabled … choose **Enable**"; Lock: "**Bucket Versioning**", "**Enabled**" |
| `sections` Tags | Create: "Under **Tags**" ("**Key**", "**Value**", "**Add Tag**"; the same guide writes the button "**Add tag**" on `using-intelligent-tiering`, the spelling requirement R6.1 uses; it is not a spec item, and a match ignores case) |
| `sections` Default encryption | Create: "**Default encryption**" |
| field Encryption type | Create: "under **Encryption type**", with the three types |
| field AWS KMS key | Create: "Under **AWS KMS key**"; of its choices Studio shows "**Enter AWS KMS key ARN**" as a text field (requirement R3) |
| field Bucket Key | Create: "under **Bucket Key**, choose **Disable**" |
| `sections` Advanced settings | Create: "Choose **Advanced settings**"; Lock: "Under **Advanced settings**, find **Object Lock** and choose **Enable**" |
| field Object Lock | the same sentences |
| the sections' and fields' order | Create's procedure, step by step: General configuration (Region, Bucket name, Copy settings), Object Ownership, Block Public Access settings for this bucket, Bucket Versioning, Tags, Default encryption (Encryption type, AWS KMS key, Bucket Key), Advanced settings |

"Object Ownership" as one choice of three is provisional (question 5). `control` and `required` record what
requirement R6.1 builds; the guide marks no field required but says a bucket needs a name.
