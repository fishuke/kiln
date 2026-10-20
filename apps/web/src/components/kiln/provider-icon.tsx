import { Clock, Factory, Webhook } from "lucide-react";
import { AzureDevOpsIcon, BitbucketIcon, DiscordIcon, GitHubIcon, GitLabIcon, JiraIcon, LinearIcon, SentryIcon, SlackIcon, TeamsIcon } from "@/components/kiln/brand-icons";
import { cn } from "@/lib/utils";

/** Icon for an automation trigger provider or integration id. */
export function ProviderIcon({ provider, className }: { provider: string; className?: string }) {
  const c = cn("size-4 shrink-0", className);
  switch (provider) {
    case "github":
      return <GitHubIcon className={c} />;
    case "gitlab":
      return <GitLabIcon className={c} />;
    case "linear":
      return <LinearIcon className={c} />;
    case "jira":
      return <JiraIcon className={c} />;
    case "slack":
      return <SlackIcon className={c} />;
    case "teams":
    case "microsoft-teams":
      return <TeamsIcon className={c} />;
    case "discord":
      return <DiscordIcon className={c} />;
    case "azure_devops":
      return <AzureDevOpsIcon className={c} />;
    case "bitbucket":
      return <BitbucketIcon className={c} />;
    case "sentry":
      return <SentryIcon className={c} />;
    case "schedule":
      return <Clock className={cn(c, "text-muted-foreground")} aria-hidden />;
    case "webhook":
      return <Webhook className={cn(c, "text-muted-foreground")} aria-hidden />;
    default:
      return <Factory className={cn(c, "text-muted-foreground")} aria-hidden />;
  }
}
