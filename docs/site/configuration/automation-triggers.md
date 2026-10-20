---
title: Automation triggers
description: Every trigger provider, event and filter key, generated from the trigger catalogue.
owner: docs
section: Factory configuration
generated: true
---

Generated from `packages/schema/src/triggers.ts`. A trigger names a `provider` and an `event`; its `filter` accepts only the keys listed for that pair. Every key must match (AND); any value in a list matches (OR). See [Automations](automations.md) for the matcher grammar, alias resolution and bot policy.

## azure_devops

| Event | Filter keys |
| --- | --- |
| `pull_request_closed` | `base_branches` (list or `{in, not_in}`), `repos` (list or `{in, not_in}`), `source_repos` (list or `{in, not_in}`) |
| `pull_request_commented` | `base_branches` (list or `{in, not_in}`), `repos` (list or `{in, not_in}`), `source_repos` (list or `{in, not_in}`) |
| `pull_request_created` | `base_branches` (list or `{in, not_in}`), `repos` (list or `{in, not_in}`), `source_repos` (list or `{in, not_in}`) |
| `pull_request_merged` | `base_branches` (list or `{in, not_in}`), `repos` (list or `{in, not_in}`), `source_repos` (list or `{in, not_in}`) |
| `pull_request_updated` | `base_branches` (list or `{in, not_in}`), `repos` (list or `{in, not_in}`), `source_repos` (list or `{in, not_in}`) |
| `pull_request_mentioned` | `mentioned` (list or `{in, not_in}`), `repos` (list or `{in, not_in}`) |
| `push` | `branches` (list or `{in, not_in}`), `repos` (list or `{in, not_in}`) |
| `work_item_assigned` | `assignees` (list or `{in, not_in}`), `authors` (list or `{in, not_in}`), `labels` (list or `{in, not_in}`), `work_item_types` (list or `{in, not_in}`) |
| `work_item_created` | `assignees` (list or `{in, not_in}`), `authors` (list or `{in, not_in}`), `labels` (list or `{in, not_in}`), `work_item_types` (list or `{in, not_in}`) |
| `work_item_labeled` | `assignees` (list or `{in, not_in}`), `authors` (list or `{in, not_in}`), `labels` (list or `{in, not_in}`), `work_item_types` (list or `{in, not_in}`) |
| `work_item_mentioned` | `mentioned` (list or `{in, not_in}`) |

## bitbucket

| Event | Filter keys |
| --- | --- |
| `pull_request_created` | `repos` (list or `{in, not_in}`), `base_branches` (list or `{in, not_in}`), `authors` (list or `{in, not_in}`), `keywords` (list or `{in, not_in}`) |
| `pull_request_commented` | `repos` (list or `{in, not_in}`), `authors` (list or `{in, not_in}`), `keywords` (list or `{in, not_in}`), `mentioned` (list or `{in, not_in}`) |
| `push` | `repos` (list or `{in, not_in}`), `branches` (list or `{in, not_in}`) |

## discord

| Event | Filter keys |
| --- | --- |
| `app_mention` | `guild_ids` (list or `{in, not_in}`), `channel_ids` (list or `{in, not_in}`), `user_ids` (list or `{in, not_in}`), `keywords` (list or `{in, not_in}`) |
| `slash_command` | `guild_ids` (list or `{in, not_in}`), `channel_ids` (list or `{in, not_in}`), `user_ids` (list or `{in, not_in}`), `keywords` (list or `{in, not_in}`) |
| `message_posted` | `guild_ids` (list or `{in, not_in}`), `channel_ids` (list or `{in, not_in}`), `user_ids` (list or `{in, not_in}`), `keywords` (list or `{in, not_in}`) |
| `reaction_added` | `guild_ids` (list or `{in, not_in}`), `channel_ids` (list or `{in, not_in}`), `user_ids` (list or `{in, not_in}`), `keywords` (list or `{in, not_in}`), `emojis` (list or `{in, not_in}`) |

## factory

| Event | Filter keys |
| --- | --- |
| `work_item_stage_changed` | `stages` (list or `{in, not_in}`) |

## github

| Event | Filter keys |
| --- | --- |
| `check_run_rerequested` | `repos` (list or `{in, not_in}`), `skip_bots` (`all` \| `self` \| `none`) |
| `check_suite_rerequested` | `repos` (list or `{in, not_in}`), `skip_bots` (`all` \| `self` \| `none`) |
| `check_suite_completed` | `authors` (list or `{in, not_in}`), `branches` (list or `{in, not_in}`), `conclusions` (list or `{in, not_in}`), `labels` (list or `{in, not_in}`), `repos` (list or `{in, not_in}`), `skip_bots` (`all` \| `self` \| `none`) |
| `commit_status` | `contexts` (list or `{in, not_in}`), `repos` (list or `{in, not_in}`), `skip_bots` (`all` \| `self` \| `none`), `states` (list or `{in, not_in}`) |
| `issue_assigned` | `assignees` (list or `{in, not_in}`), `authors` (list or `{in, not_in}`), `labels` (list or `{in, not_in}`), `repos` (list or `{in, not_in}`), `skip_bots` (`all` \| `self` \| `none`) |
| `pull_request_assigned` | `assignees` (list or `{in, not_in}`), `authors` (list or `{in, not_in}`), `labels` (list or `{in, not_in}`), `repos` (list or `{in, not_in}`), `skip_bots` (`all` \| `self` \| `none`) |
| `issue_commented` | `authors` (list or `{in, not_in}`), `keywords` (list or `{in, not_in}`), `labels` (list or `{in, not_in}`), `repos` (list or `{in, not_in}`), `skip_bots` (`all` \| `self` \| `none`) |
| `pull_request_commented` | `authors` (list or `{in, not_in}`), `keywords` (list or `{in, not_in}`), `labels` (list or `{in, not_in}`), `repos` (list or `{in, not_in}`), `skip_bots` (`all` \| `self` \| `none`) |
| `issue_created` | `assignees` (list or `{in, not_in}`), `authors` (list or `{in, not_in}`), `keywords` (list or `{in, not_in}`), `labels` (list or `{in, not_in}`), `repos` (list or `{in, not_in}`), `skip_bots` (`all` \| `self` \| `none`) |
| `issue_labeled` | `assignees` (list or `{in, not_in}`), `authors` (list or `{in, not_in}`), `labels` (list or `{in, not_in}`), `repos` (list or `{in, not_in}`), `skip_bots` (`all` \| `self` \| `none`) |
| `issue_mentioned` | `authors` (list or `{in, not_in}`), `keywords` (list or `{in, not_in}`), `labels` (list or `{in, not_in}`), `mentioned` (list or `{in, not_in}`), `repos` (list or `{in, not_in}`), `skip_bots` (`all` \| `self` \| `none`) |
| `pull_request_mentioned` | `authors` (list or `{in, not_in}`), `keywords` (list or `{in, not_in}`), `labels` (list or `{in, not_in}`), `mentioned` (list or `{in, not_in}`), `repos` (list or `{in, not_in}`), `skip_bots` (`all` \| `self` \| `none`) |
| `pull_request_closed` | `assignees` (list or `{in, not_in}`), `authors` (list or `{in, not_in}`), `baseBranches` (list or `{in, not_in}`), `base_branches` (list or `{in, not_in}`), `labels` (list or `{in, not_in}`), `paths` (list or `{in, not_in}`), `prNumbers` (list of integers or `{in, not_in}`), `pr_numbers` (list of integers or `{in, not_in}`), `repos` (list or `{in, not_in}`), `skip_bots` (`all` \| `self` \| `none`) |
| `pull_request_dequeued` | `assignees` (list or `{in, not_in}`), `authors` (list or `{in, not_in}`), `baseBranches` (list or `{in, not_in}`), `base_branches` (list or `{in, not_in}`), `labels` (list or `{in, not_in}`), `paths` (list or `{in, not_in}`), `prNumbers` (list of integers or `{in, not_in}`), `pr_numbers` (list of integers or `{in, not_in}`), `repos` (list or `{in, not_in}`), `skip_bots` (`all` \| `self` \| `none`) |
| `pull_request_enqueued` | `assignees` (list or `{in, not_in}`), `authors` (list or `{in, not_in}`), `baseBranches` (list or `{in, not_in}`), `base_branches` (list or `{in, not_in}`), `labels` (list or `{in, not_in}`), `paths` (list or `{in, not_in}`), `prNumbers` (list of integers or `{in, not_in}`), `pr_numbers` (list of integers or `{in, not_in}`), `repos` (list or `{in, not_in}`), `skip_bots` (`all` \| `self` \| `none`) |
| `pull_request_labeled` | `assignees` (list or `{in, not_in}`), `authors` (list or `{in, not_in}`), `baseBranches` (list or `{in, not_in}`), `base_branches` (list or `{in, not_in}`), `labels` (list or `{in, not_in}`), `paths` (list or `{in, not_in}`), `prNumbers` (list of integers or `{in, not_in}`), `pr_numbers` (list of integers or `{in, not_in}`), `repos` (list or `{in, not_in}`), `skip_bots` (`all` \| `self` \| `none`) |
| `pull_request_merged` | `assignees` (list or `{in, not_in}`), `authors` (list or `{in, not_in}`), `baseBranches` (list or `{in, not_in}`), `base_branches` (list or `{in, not_in}`), `labels` (list or `{in, not_in}`), `paths` (list or `{in, not_in}`), `prNumbers` (list of integers or `{in, not_in}`), `pr_numbers` (list of integers or `{in, not_in}`), `repos` (list or `{in, not_in}`), `skip_bots` (`all` \| `self` \| `none`) |
| `pull_request_synchronized` | `assignees` (list or `{in, not_in}`), `authors` (list or `{in, not_in}`), `baseBranches` (list or `{in, not_in}`), `base_branches` (list or `{in, not_in}`), `labels` (list or `{in, not_in}`), `paths` (list or `{in, not_in}`), `prNumbers` (list of integers or `{in, not_in}`), `pr_numbers` (list of integers or `{in, not_in}`), `repos` (list or `{in, not_in}`), `skip_bots` (`all` \| `self` \| `none`) |
| `pull_request_opened` | `assignees` (list or `{in, not_in}`), `authors` (list or `{in, not_in}`), `baseBranches` (list or `{in, not_in}`), `base_branches` (list or `{in, not_in}`), `labels` (list or `{in, not_in}`), `paths` (list or `{in, not_in}`), `prNumbers` (list of integers or `{in, not_in}`), `pr_numbers` (list of integers or `{in, not_in}`), `repos` (list or `{in, not_in}`), `skip_bots` (`all` \| `self` \| `none`), `keywords` (list or `{in, not_in}`) |
| `pull_request_ready` | `assignees` (list or `{in, not_in}`), `authors` (list or `{in, not_in}`), `baseBranches` (list or `{in, not_in}`), `base_branches` (list or `{in, not_in}`), `labels` (list or `{in, not_in}`), `paths` (list or `{in, not_in}`), `prNumbers` (list of integers or `{in, not_in}`), `pr_numbers` (list of integers or `{in, not_in}`), `repos` (list or `{in, not_in}`), `skip_bots` (`all` \| `self` \| `none`), `keywords` (list or `{in, not_in}`) |
| `pull_request_reopened` | `assignees` (list or `{in, not_in}`), `authors` (list or `{in, not_in}`), `baseBranches` (list or `{in, not_in}`), `base_branches` (list or `{in, not_in}`), `labels` (list or `{in, not_in}`), `paths` (list or `{in, not_in}`), `prNumbers` (list of integers or `{in, not_in}`), `pr_numbers` (list of integers or `{in, not_in}`), `repos` (list or `{in, not_in}`), `skip_bots` (`all` \| `self` \| `none`), `keywords` (list or `{in, not_in}`) |
| `pull_request_review_requested` | `authors` (list or `{in, not_in}`), `repos` (list or `{in, not_in}`), `reviewer_teams` (list or `{in, not_in}`), `reviewers` (list or `{in, not_in}`), `skip_bots` (`all` \| `self` \| `none`) |
| `pull_request_review_submitted` | `authors` (list or `{in, not_in}`), `keywords` (list or `{in, not_in}`), `labels` (list or `{in, not_in}`), `mentioned` (list or `{in, not_in}`), `repos` (list or `{in, not_in}`), `review_states` (list or `{in, not_in}`), `skip_bots` (`all` \| `self` \| `none`) |
| `push` | `branches` (list or `{in, not_in}`), `paths` (list or `{in, not_in}`), `repos` (list or `{in, not_in}`), `skip_bots` (`all` \| `self` \| `none`) |
| `workflow_run_completed` | `authors` (list or `{in, not_in}`), `branches` (list or `{in, not_in}`), `conclusions` (list or `{in, not_in}`), `labels` (list or `{in, not_in}`), `repos` (list or `{in, not_in}`), `skip_bots` (`all` \| `self` \| `none`), `workflows` (list or `{in, not_in}`) |

## gitlab

| Event | Filter keys |
| --- | --- |
| `bot_mentioned` | `mentioned` (list or `{in, not_in}`), `repos` (list or `{in, not_in}`) |
| `merge_request` | `actions` (list or `{in, not_in}`), `base_branches` (list or `{in, not_in}`), `repos` (list or `{in, not_in}`) |
| `push` | `branches` (list or `{in, not_in}`), `repos` (list or `{in, not_in}`) |

## jira

| Event | Filter keys |
| --- | --- |
| `agent_session_created` | `keywords` (list or `{in, not_in}`), `labels` (list or `{in, not_in}`), `project_keys` (list or `{in, not_in}`) |
| `issue_created` | `labels` (list or `{in, not_in}`), `project_keys` (list or `{in, not_in}`) |
| `issue_labeled` | `labels` (list or `{in, not_in}`), `project_keys` (list or `{in, not_in}`) |
| `status_changed` | `project_keys` (list or `{in, not_in}`), `status_ids` (list or `{in, not_in}`) |

## linear

| Event | Filter keys |
| --- | --- |
| `agent_session_created` | `creator_ids` (list or `{in, not_in}`), `keywords` (list or `{in, not_in}`), `labels` (list or `{in, not_in}`), `project_ids` (list or `{in, not_in}`), `projects` (list of names (resolved on apply)), `team_ids` (list or `{in, not_in}`), `teams` (list of names (resolved on apply)) |
| `comment_created` | `creator_ids` (list or `{in, not_in}`), `issue_ids` (list or `{in, not_in}`), `issues` (list of numbers (resolved on apply)), `labels` (list or `{in, not_in}`), `mentioned_user_ids` (list or `{in, not_in}`), `project_ids` (list or `{in, not_in}`), `projects` (list of names (resolved on apply)), `state_ids` (list or `{in, not_in}`), `states` (list of names (resolved on apply)), `team_ids` (list or `{in, not_in}`), `teams` (list of names (resolved on apply)) |
| `issue_assigned` | `assignee_ids` (list or `{in, not_in}`), `creator_ids` (list or `{in, not_in}`), `labels` (list or `{in, not_in}`), `mentioned_user_ids` (list or `{in, not_in}`), `project_ids` (list or `{in, not_in}`), `projects` (list of names (resolved on apply)), `state_ids` (list or `{in, not_in}`), `states` (list of names (resolved on apply)), `team_ids` (list or `{in, not_in}`), `teams` (list of names (resolved on apply)) |
| `issue_created` | `assignee_ids` (list or `{in, not_in}`), `creator_ids` (list or `{in, not_in}`), `labels` (list or `{in, not_in}`), `mentioned_user_ids` (list or `{in, not_in}`), `project_ids` (list or `{in, not_in}`), `projects` (list of names (resolved on apply)), `state_ids` (list or `{in, not_in}`), `states` (list of names (resolved on apply)), `team_ids` (list or `{in, not_in}`), `teams` (list of names (resolved on apply)) |
| `issue_labeled` | `assignee_ids` (list or `{in, not_in}`), `creator_ids` (list or `{in, not_in}`), `labels` (list or `{in, not_in}`), `mentioned_user_ids` (list or `{in, not_in}`), `project_ids` (list or `{in, not_in}`), `projects` (list of names (resolved on apply)), `state_ids` (list or `{in, not_in}`), `states` (list of names (resolved on apply)), `team_ids` (list or `{in, not_in}`), `teams` (list of names (resolved on apply)) |
| `issue_state_changed` | `assignee_ids` (list or `{in, not_in}`), `creator_ids` (list or `{in, not_in}`), `labels` (list or `{in, not_in}`), `mentioned_user_ids` (list or `{in, not_in}`), `project_ids` (list or `{in, not_in}`), `projects` (list of names (resolved on apply)), `state_ids` (list or `{in, not_in}`), `states` (list of names (resolved on apply)), `team_ids` (list or `{in, not_in}`), `teams` (list of names (resolved on apply)) |

## schedule

| Event | Filter keys |
| --- | --- |
| `cron_fired` | `schedule_ids` (list or `{in}`) |

## slack

| Event | Filter keys |
| --- | --- |
| `app_mention` | `channel_ids` (list or `{in, not_in}`), `channels` (list of names (resolved on apply)), `keywords` (list or `{in, not_in}`), `user_ids` (list or `{in, not_in}`), `users` (list of names (resolved on apply)) |
| `message_dm` | `channel_ids` (list or `{in, not_in}`), `channels` (list of names (resolved on apply)), `keywords` (list or `{in, not_in}`), `user_ids` (list or `{in, not_in}`), `users` (list of names (resolved on apply)) |
| `message_im` | `channel_ids` (list or `{in, not_in}`), `channels` (list of names (resolved on apply)), `keywords` (list or `{in, not_in}`), `user_ids` (list or `{in, not_in}`), `users` (list of names (resolved on apply)) |
| `message_mpim` | `channel_ids` (list or `{in, not_in}`), `channels` (list of names (resolved on apply)), `keywords` (list or `{in, not_in}`), `user_ids` (list or `{in, not_in}`), `users` (list of names (resolved on apply)) |
| `message_posted` | `channel_ids` (list or `{in, not_in}`), `channels` (list of names (resolved on apply)), `keywords` (list or `{in, not_in}`), `user_ids` (list or `{in, not_in}`), `users` (list of names (resolved on apply)) |
| `member_joined_channel` | `channel_ids` (list or `{in, not_in}`), `channels` (list of names (resolved on apply)), `user_ids` (list or `{in, not_in}`), `users` (list of names (resolved on apply)) |
| `reaction_added` | `channel_ids` (list or `{in, not_in}`), `channels` (list of names (resolved on apply)), `emojis` (list or `{in, not_in}`), `itemUsers` (list of names (resolved on apply)), `item_user_ids` (list or `{in, not_in}`), `keywords` (list or `{in, not_in}`), `user_ids` (list or `{in, not_in}`), `users` (list of names (resolved on apply)) |

## teams

| Event | Filter keys |
| --- | --- |
| `app_mention` | `team_ids` (list or `{in}`), `channel_ids` (list or `{in}`), `keywords` (list or `{in, not_in}`), `user_ids` (list or `{in, not_in}`) |
| `message_posted` | `team_ids` (list or `{in}`), `channel_ids` (list or `{in}`), `keywords` (list or `{in, not_in}`), `user_ids` (list or `{in, not_in}`) |

## webhook

| Event | Filter keys |
| --- | --- |
| `received` | `webhook_ids` (exactly one webhook), `payload` (payload pattern) |

Server-managed keys are rejected in definitions: GitLab `bot_mentioned` fills `mentioned` with the factory's bot, and `schedule_ids` is set from each inline schedule.

## Related pages

- [Automations](automations.md)
- [Custom webhooks](../integrations/custom-webhooks.md)
- [Connections](../integrations/connections.md)
