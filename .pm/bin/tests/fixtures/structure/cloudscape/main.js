// The real-Cloudscape fixture of requirement 8 and design 2.7: the components the matching rules of 5.2 assume,
// in plain JavaScript (React.createElement, no JSX). The rows come from /data.json, which the test writes next to
// the build: three buckets for state seeded, none for state empty (the table then shows its empty slot).
import React from "react";
import { createRoot } from "react-dom/client";
import "@cloudscape-design/global-styles/index.css";
import BreadcrumbGroup from "@cloudscape-design/components/breadcrumb-group";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Container from "@cloudscape-design/components/container";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import KeyValuePairs from "@cloudscape-design/components/key-value-pairs";
import Pagination from "@cloudscape-design/components/pagination";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Table from "@cloudscape-design/components/table";
import Tabs from "@cloudscape-design/components/tabs";
import TextFilter from "@cloudscape-design/components/text-filter";

const h = React.createElement;

const COLUMNS = [
  { id: "name", header: "Name", cell: (item) => item.name },
  { id: "region", header: "AWS Region", cell: (item) => item.region },
  { id: "created", header: "Creation date", cell: (item) => item.created },
];

function App({ items }) {
  const [selected, setSelected] = React.useState([]);
  const [filtering, setFiltering] = React.useState("");
  const [bucketName, setBucketName] = React.useState("");
  const [bucketType, setBucketType] = React.useState("");
  const actions = h(SpaceBetween, { direction: "horizontal", size: "xs" },
    h(Button, null, "Empty"),
    h(Button, null, "Delete"),
    h(Button, { variant: "primary" }, "Create bucket"));
  return h("main", null,
    h(SpaceBetween, { size: "l" },
      h(BreadcrumbGroup, {
        ariaLabel: "Breadcrumbs",
        items: [{ text: "Amazon S3", href: "/s3" }, { text: "Buckets", href: "/s3/buckets" }],
      }),
      h(Table, {
        columnDefinitions: COLUMNS,
        items,
        trackBy: "name",
        selectionType: "single",
        selectedItems: selected,
        onSelectionChange: ({ detail }) => setSelected(detail.selectedItems),
        ariaLabels: {
          selectionGroupLabel: "Bucket selection",
          itemSelectionLabel: (_, item) => `Select ${item.name}`,
          tableLabel: "General purpose buckets",
        },
        header: h(Header, { counter: `(${items.length})`, actions }, "General purpose buckets"),
        filter: h(TextFilter, {
          filteringText: filtering,
          filteringPlaceholder: "Find buckets by name",
          filteringAriaLabel: "Find buckets by name",
          onChange: ({ detail }) => setFiltering(detail.filteringText),
        }),
        pagination: h(Pagination, {
          currentPageIndex: 1,
          pagesCount: 1,
          ariaLabels: { nextPageLabel: "Next page", previousPageLabel: "Previous page" },
        }),
        empty: h(Box, { textAlign: "center" },
          h(Box, { variant: "strong" }, "No buckets"),
          h(Box, { variant: "p" }, "You don't have any buckets."),
          h(Button, null, "Create bucket")),
      }),
      h(Tabs, {
        tabs: [
          { id: "objects", label: "Objects", content: "Objects of the selected bucket." },
          { id: "properties", label: "Properties", content: "Properties of the selected bucket." },
        ],
      }),
      h(Container, { header: h(Header, { variant: "h2" }, "General configuration") },
        h(SpaceBetween, { size: "m" },
          h(FormField, { label: "Bucket name" },
            h(Input, { value: bucketName, onChange: ({ detail }) => setBucketName(detail.value) })),
          h(FormField, { label: "Bucket type" },
            h(Input, { value: bucketType, onChange: ({ detail }) => setBucketType(detail.value) })))),
      h(Container, { header: h(Header, { variant: "h2" }, "Bucket details") },
        h(KeyValuePairs, {
          columns: 2,
          items: [{ label: "Owner", value: "emuforge" }, { label: "Versioning", value: "Disabled" }],
        }))));
}

const data = await (await fetch("/data.json")).json();
createRoot(document.getElementById("root")).render(h(App, { items: data.items }));
