// The real-Cloudscape wizard fixture of requirement 8: a Wizard opened at step <k> for ?step=<k> (the Studio
// convention of requirement 4), with Container, Header, FormField, Input and BreadcrumbGroup, in plain JavaScript
// (React.createElement, no JSX). Nothing on the page is operated by the tool; Next and Previous work for a person.
import React from "react";
import { createRoot } from "react-dom/client";
import "@cloudscape-design/global-styles/index.css";
import BreadcrumbGroup from "@cloudscape-design/components/breadcrumb-group";
import Container from "@cloudscape-design/components/container";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Wizard from "@cloudscape-design/components/wizard";

const h = React.createElement;

const STEPS = [
  { title: "Select trusted entity", sections: [["Trusted entity type", ["Use case", "Service"]]] },
  { title: "Add permissions", sections: [["Permissions policies", ["Policy name"]]] },
  { title: "Name, review, and create", sections: [["Role details", ["Role name", "Description"]]] },
];

function Field({ label }) {
  const [value, setValue] = React.useState("");
  return h(FormField, { label }, h(Input, { value, onChange: ({ detail }) => setValue(detail.value) }));
}

function Section({ title, fields }) {
  return h(Container, { header: h(Header, { variant: "h2" }, title) },
    h(SpaceBetween, { size: "l" }, ...fields.map((f) => h(Field, { key: f, label: f }))));
}

function App() {
  const asked = parseInt(new URLSearchParams(window.location.search).get("step") || "1", 10) || 1;
  const [active, setActive] = React.useState(Math.max(1, Math.min(STEPS.length, asked)) - 1);
  return h("main", null,
    h(SpaceBetween, { size: "l" },
      h(BreadcrumbGroup, {
        ariaLabel: "Breadcrumbs",
        items: [{ text: "IAM", href: "/aws/iam" }, { text: "Roles", href: "/aws/iam/roles" },
          { text: "Create role", href: "/aws/iam/roles/create" }],
      }),
      h(Wizard, {
        activeStepIndex: active,
        onNavigate: ({ detail }) => setActive(detail.requestedStepIndex),
        submitButtonText: "Create role",
        i18nStrings: {
          stepNumberLabel: (n) => `Step ${n}`,
          collapsedStepsLabel: (n, count) => `Step ${n} of ${count}`,
          navigationAriaLabel: "Steps",
          cancelButton: "Cancel",
          previousButton: "Previous",
          nextButton: "Next",
          optional: "optional",
        },
        steps: STEPS.map((s) => ({
          title: s.title,
          content: h(SpaceBetween, { size: "l" },
            ...s.sections.map(([title, fields]) => h(Section, { key: title, title, fields }))),
        })),
      })));
}

createRoot(document.getElementById("root")).render(h(App));
