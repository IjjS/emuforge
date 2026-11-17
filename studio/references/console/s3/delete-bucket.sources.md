# Where each item of `delete-bucket.yaml` is found

No capture shows the page (`decisions-needed.md`, question 3). User guide: Amazon S3 User Guide, English, page
**Delete** = `delete-bucket` (`docs.aws.amazon.com/AmazonS3/latest/userguide/delete-bucket.html`), read on
2026-11-17.

| Spec item | Source |
|---|---|
| `breadcrumbs` S3, Buckets | capture `docs/aws-console/s3/02-general-purpose-buckets`: the console's crumbs of the list |
| `breadcrumbs` structure-bucket | **no source** shows the page's crumbs; it follows the bucket's own page (`bucket-properties.yaml`), provisional (question 3) |
| `breadcrumbs` Delete bucket, `header.title` Delete bucket | Delete: "On the **Delete bucket** page, confirm that you want to delete the bucket by entering the bucket name in the text field, and then choose **Delete bucket**." |
| `header.actions` Delete bucket, `header.primary_action` | the same sentence |
| `header.actions` Empty bucket | Delete: the note says to empty the bucket "by choosing the **Empty bucket** button in the **This bucket is not empty** error alert", then to return to the **Delete bucket** page |
| the actions' order | the alert is shown before the confirmation (the note: empty first, "Then return to the **Delete bucket** page") |

Not items: the alert's header "This bucket is not empty" (a spec has no item for an alert; requirement R7.3 has
it), the text field (the guide gives it no label) and "Cancel" (in no source).
