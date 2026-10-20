# Idea: product-owner chat with a fast preview

Status: idea, not scheduled · Raised 2026-10-20 · Replaces the first PO workspace (removed until we have a good design)

## The idea

A product owner opens a chat, picks a new or existing project, and describes what they want in their own words. Within minutes they see a working preview of it, iterate on it by talking ("make the button bigger", "add a cancel step"), and when it looks right the result is already a pull request that is ready for a developer to review.

This is a proven way to work (chat-to-preview tools such as v0, Lovable and Claude Design work like this). What Kiln adds is that the same factory, with the same guardrails, produces it, so the preview is not a throwaway prototype but the start of real, reviewable work.

## How it could run on the same factory

Same work item, same agents, same sandboxes, same "a person merges" rule. Only the path through the stages differs:

| Normal path | Fast-preview path |
| --- | --- |
| Triage → spec → spec approval → build → verify → preview → review → hand-off | Chat → build → preview (fast, repeated) → the PO says "looks right" → spec written from the conversation → verify → review → hand-off to a developer |
| The spec comes first and is approved before code | The preview comes first; the spec and acceptance criteria are derived from the agreed preview and the chat |
| Preview acceptance is one gate near the end | The PO iterates on the preview in a loop; each message steers or reruns the build |

A first version could be expressed as a pipeline plus one new behavior:

```yaml
# pipelines/po-preview.yaml (sketch)
stages:
  - { id: build,   agent: implement }                       # first draft from the chat
  - { id: preview, action: preview.deploy, gate: po-iterate } # loop: PO messages go back to build
  - { id: spec,    agent: spec }                              # write criteria from the conversation + preview
  - { id: verify,  agent: verify, requires: [ci_green, criteria_videos], on_fail: build }
  - { id: review,  agent: review, advisory: true }
  - { id: handoff, action: handoff }                          # developer reviews and merges
```

What is new:
- **An iterate gate.** A gate kind where every PO message sends the work back to `build` with the message as steering, and "looks right" approves it. Today rejecting a preview already loops to build; this makes it the main interaction instead of the exception.
- **Fast previews.** Previews need to come up in under a minute: warm sandboxes, incremental builds, and a dev-server preview (hot reload inside the sandbox) instead of a full deploy for each iteration.
- **Spec after the fact.** The spec agent turns the conversation and the accepted preview into acceptance criteria, so the developer gets the same evidence as on the normal path.
- **New or existing project.** "New" scaffolds a repo from a template into a fresh factory; "existing" picks a factory and its repo.

## Open questions

- Where it lives in the app: a separate chat surface, or the home composer turning into a conversation for factories that allow it.
- How developers see that a PR came from a preview-first flow, and what extra review it needs.
- Limits: which repos allow PO-driven builds, budgets per conversation, and how many iterations before asking a developer.
- How design systems and existing components are made available so previews look like the product.

## Related

- [PLAN.md](../plan/PLAN.md) M4-T4 (PO workspace) and M4-T5 (preview environments)
- [Pipelines and gates](../site/configuration/pipelines-and-gates.md)
- [Previews](../site/integrations/previews.md)
