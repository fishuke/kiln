import { AzureDevOpsIcon, BitbucketIcon, DiscordIcon, GitHubIcon, GitLabIcon, JiraIcon, LinearIcon, SentryIcon, SlackIcon, TeamsIcon } from "./brand-icons";

type IconC = React.ComponentType<{ className?: string }>;

export function PagerDutyIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden>
      <rect width="16" height="16" rx="3" fill="#06AC38" />
      <path d="M5 3.5h3.3c2 0 3.2 1 3.2 2.8S10.3 9 8.3 9H6.6v3.5H5zm1.6 1.4v2.7h1.6c1 0 1.6-.5 1.6-1.4 0-.8-.6-1.3-1.6-1.3z" fill="#fff" />
    </svg>
  );
}

export function VercelIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="currentColor" aria-hidden>
      <path d="M8 1.5 15.5 14.5H.5z" />
    </svg>
  );
}

/** Accounts a person can link so Kiln recognizes them in other tools. */
export const LINK_META: Record<string, { name: string; icon: IconC; idLabel: string; idHint: string; handle?: string }> = {
  github: { name: "GitHub", icon: GitHubIcon, idLabel: "GitHub user id", idHint: "Numeric id from api.github.com/users/<login>", handle: "Username" },
  gitlab: { name: "GitLab", icon: GitLabIcon, idLabel: "GitLab user id", idHint: "From your GitLab profile", handle: "Username" },
  slack: { name: "Slack", icon: SlackIcon, idLabel: "Slack member ID", idHint: "Profile › ⋯ › Copy member ID, e.g. U024BE7LH" },
  discord: { name: "Discord", icon: DiscordIcon, idLabel: "Discord user ID", idHint: "Developer mode › right-click your name › Copy User ID", handle: "Username" },
  linear: { name: "Linear", icon: LinearIcon, idLabel: "Linear user id or email", idHint: "Linear also matches you by email" },
  jira: { name: "Jira", icon: JiraIcon, idLabel: "Atlassian account ID", idHint: "From your Atlassian profile URL" },
  teams: { name: "Microsoft Teams", icon: TeamsIcon, idLabel: "Microsoft Entra object ID", idHint: "From your Microsoft account profile" },
  azure_devops: { name: "Azure DevOps", icon: AzureDevOpsIcon, idLabel: "Azure DevOps user descriptor or email", idHint: "From your Azure DevOps profile" },
};

export const PROVIDER_ICONS: Record<string, IconC> = {
  github: GitHubIcon,
  gitlab: GitLabIcon,
  azure_devops: AzureDevOpsIcon,
  "azure-devops": AzureDevOpsIcon,
  bitbucket: BitbucketIcon,
  slack: SlackIcon,
  teams: TeamsIcon,
  "microsoft-teams": TeamsIcon,
  discord: DiscordIcon,
  linear: LinearIcon,
  jira: JiraIcon,
  sentry: SentryIcon,
  pagerduty: PagerDutyIcon,
  vercel: VercelIcon,
};
