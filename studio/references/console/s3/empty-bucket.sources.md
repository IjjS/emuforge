# Where each item of `empty-bucket.yaml` is found

No capture shows the page (`decisions-needed.md`, question 3). User guide: Amazon S3 User Guide, English, page
**Empty** = `empty-bucket` (`docs.aws.amazon.com/AmazonS3/latest/userguide/empty-bucket.html`), read on 2026-11-17.

| Spec item | Source |
|---|---|
| `breadcrumbs` S3, Buckets | capture `docs/aws-console/s3/02-general-purpose-buckets`: the console's crumbs of the list |
| `breadcrumbs` structure-bucket | **no source** shows the page's crumbs; it follows the bucket's own page (`bucket-properties.yaml`), provisional (question 3) |
| `breadcrumbs` Empty bucket, `header.title` Empty bucket | Empty: "On the **Empty bucket** page, confirm that you want to empty the bucket by entering the bucket name into the text field, and then choose **Empty**." |
| `header.actions` Empty, `header.primary_action` | the same sentence; capture `02-general-purpose-buckets`: the list's button "Empty" that opens the page |

Not items: the text field (the guide gives it no label), "Cancel" (in no source), and the page "**Empty bucket:
Status**" (Empty: "Monitor the progress of the bucket emptying process on the **Empty bucket: Status** page."),
which the score cannot reach without operating the page.
