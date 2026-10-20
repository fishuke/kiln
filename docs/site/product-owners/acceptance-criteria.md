---
title: Writing acceptance criteria
description: Write acceptance criteria the factory can test and prove with a video, and understand how Kiln checks them before and after the build.
owner: docs
section: Product owners
---

Good acceptance criteria are short, numbered statements a test can check, because Kiln checks each one before the spec is approved and expects one passing, recorded test per criterion before the work is handed off.

## The format

The spec agent writes numbered criteria:

```text
AC1: The settings page has a dark mode switch
AC2: The choice is remembered after reload
```

The number matters. The verify agent names each Playwright test after its criterion, for example `AC2: the choice is remembered after reload`, and Kiln matches videos and results to criteria by that `AC<number>`.

## What makes a criterion testable

Each criterion should describe one thing a person or a test can observe:

| Instead of | Write |
| --- | --- |
| The page loads fast | The invoices page shows the first 50 invoices within 2 seconds on the staging data set |
| The form is user-friendly | Every form field has a visible label, and errors appear next to the field |
| Export works properly | Clicking "Export CSV" downloads a file with one row per invoice |
| Handle edge cases etc. | An empty invoice list shows "No invoices yet" |

Words like "fast", "nice", "better", "intuitive", "properly" or "robust" usually mean the criterion is not testable yet.

## How Kiln checks criteria

**Before approval.** Kiln runs the `spec-check` decision on every criterion. A criterion is rejected when the probability that it is testable is below 0.5, or the probability that it is ambiguous is 0.5 or more. The spec agent gets one chance to rewrite the rejected criteria. Any that still fail are listed under "Not yet testable" in the spec approval request, so you can fix them before you approve.

**After the build.** When a pipeline stage requires `criteria_videos`, every criterion must have a passing test with a video. If one is missing, the work goes back to build. The preview card shows each criterion with its result and a link to its video.

## Tips for your request

- Put each requirement on its own bulleted line. Clear bullets make it easier for the factory to size the work and write criteria.
- Name the screen, the action and the visible result.
- Put open questions in the request instead of leaving them implied. The spec lists open questions, and you can answer them when you approve.
- Leave out how to build it, unless it is a real constraint.

## Related pages

- [Approving specs and previews](approving-specs-and-previews.md)
- [Product owner workspace](workspace.md)
- [Previews](../integrations/previews.md)
- [Typed decisions](../configuration/decisions.md)
