# ADR-006: Typed decisions with Jev and an LLM fallback

Status: Accepted · Date: 2026-10-20

## Context
A factory makes many small yes/no and pick-one decisions per work item; a typed-decision model such as TypeSafe AI's Jev answers them fast and cheaply.

## Decision
`packages/decide` has a `DecisionProvider` interface with Jev, LLM (OpenAI-compatible gateway) and fake providers, a safe expression language for policies, and built-in decisions (command guard, foreman routing, triage, spec check, review risk, model router, failure category, inbox urgency). Factories override them in `decisions/*.yaml`. Every decision is logged with inputs, answers and the action taken.

## Consequences
- Jev is optional per install; offline installs use transparent heuristics.
- Calibration must be checked on our own data before trusting thresholds.
