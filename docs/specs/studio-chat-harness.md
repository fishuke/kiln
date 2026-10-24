# Studio chats follow their agent's harness

## Problem

Setting an App agent's harness under Settings → Agents had no effect. Every chat copied the App
record's `harness` (`claude-code` unless the API set one at creation) and passed it to the run as an
override, which beats the agent's harness. The web app never sends a harness, so Studio chats always
ran Claude Code. The App record and the App definition both held a harness: two sources of truth.

## Change

- A new chat resolves its harness and model from its agent in the App definition
  (`AppDefinitions.chatConfig`). A harness the chat names itself (API) wins, without the agent's
  model for another harness. A chat keeps what it started with.
- `createApp` with `harness` or `model` writes them to the App layer's `general` agent, so the
  definition is the only source.
- `getApp` reports the `general` agent's harness and model, so a draft chat's model picker lists the
  right models.
- App settings: Model is a picker of the models the agent's harness runs, instead of free text.
- Composer: the tools shrink before the send button does. Studio list: no New app when Studio is off.

## Not changed

Chats created before this keep their stored harness. An App created through the API with a harness
before this change, and no agent setting, now runs its agent's harness (Claude Code).

## Tests

`packages/studio/src/studio.test.ts`: a new chat gets the agent's harness and model; a chat's own
harness drops the agent's model; an App created with a harness writes it into its settings.
