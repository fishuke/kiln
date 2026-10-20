/** Simple brand marks for the tools Kiln connects to (lucide ships no brand icons). */
type P = { className?: string };

export function GitHubIcon({ className }: P) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="currentColor" aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8" />
    </svg>
  );
}

export function GitLabIcon({ className }: P) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path fill="#E24329" d="m12 22.1 4-12.3H8z" />
      <path fill="#FC6D26" d="M12 22.1 8 9.8H2.4z" />
      <path fill="#FCA326" d="M2.4 9.8 1.2 13.5c-.1.3 0 .7.3.9L12 22.1z" />
      <path fill="#E24329" d="M2.4 9.8H8L5.6 2.4c-.1-.4-.7-.4-.8 0z" />
      <path fill="#FC6D26" d="m12 22.1 4-12.3h5.6z" />
      <path fill="#FCA326" d="m21.6 9.8 1.2 3.7c.1.3 0 .7-.3.9L12 22.1z" />
      <path fill="#E24329" d="M21.6 9.8H16l2.4-7.4c.1-.4.7-.4.8 0z" />
    </svg>
  );
}

export function SlackIcon({ className }: P) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path fill="#E01E5A" d="M5 15.2a2.5 2.5 0 1 1-2.5-2.5H5zm1.3 0a2.5 2.5 0 0 1 5 0v6.3a2.5 2.5 0 0 1-5 0z" />
      <path fill="#36C5F0" d="M8.8 5a2.5 2.5 0 1 1 2.5-2.5V5zm0 1.3a2.5 2.5 0 0 1 0 5H2.5a2.5 2.5 0 0 1 0-5z" />
      <path fill="#2EB67D" d="M19 8.8a2.5 2.5 0 1 1 2.5 2.5H19zm-1.3 0a2.5 2.5 0 0 1-5 0V2.5a2.5 2.5 0 0 1 5 0z" />
      <path fill="#ECB22E" d="M15.2 19a2.5 2.5 0 1 1-2.5 2.5V19zm0-1.3a2.5 2.5 0 0 1 0-5h6.3a2.5 2.5 0 0 1 0 5z" />
    </svg>
  );
}

export function LinearIcon({ className }: P) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <circle cx="12" cy="12" r="11" fill="#5E6AD2" />
      <path fill="#fff" d="M5.2 13.6 10.4 18.8A7 7 0 0 1 5.2 13.6M5 11.4l7.6 7.6a7 7 0 0 0 1.6-.3L5.3 9.8a7 7 0 0 0-.3 1.6m1-3 9.6 9.6c.4-.2.8-.5 1.2-.8L6.8 7.2c-.3.4-.6.8-.8 1.2m2-2a7 7 0 1 1 9.6 9.6z" />
    </svg>
  );
}

export function JiraIcon({ className }: P) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path fill="#2684FF" d="M22.2 11.3 12.7 1.8 12 1 4.8 8.2l-3 3a.9.9 0 0 0 0 1.3l6.5 6.5L12 22.7l7.2-7.2.1-.1 2.9-2.9a.9.9 0 0 0 0-1.2M12 15.2 8.8 12 12 8.8l3.2 3.2z" />
    </svg>
  );
}

export function DiscordIcon({ className }: P) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path fill="#5865F2" d="M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.6 1.3a18.4 18.4 0 0 0-5.6 0L8.6 3a19.7 19.7 0 0 0-4.9 1.5C.6 9.1-.3 13.6.1 18.1a19.9 19.9 0 0 0 6 3l1.3-2a12.9 12.9 0 0 1-2-1l.5-.4a14.2 14.2 0 0 0 12.2 0l.5.4c-.6.4-1.3.7-2 1l1.3 2a19.8 19.8 0 0 0 6-3c.5-5.2-.9-9.7-3.6-13.7M8 15.4c-1.2 0-2.2-1.1-2.2-2.4S6.8 10.6 8 10.6s2.2 1.1 2.2 2.4-1 2.4-2.2 2.4m8 0c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4" />
    </svg>
  );
}

export function TeamsIcon({ className }: P) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <rect x="2" y="5" width="13" height="14" rx="2" fill="#5059C9" />
      <path fill="#fff" d="M5.5 8.5h6v1.6H9.3V16H7.7v-5.9H5.5z" />
      <circle cx="19" cy="7" r="2.5" fill="#7B83EB" />
      <rect x="16" y="10" width="6" height="8" rx="2" fill="#7B83EB" />
    </svg>
  );
}

export function AzureDevOpsIcon({ className }: P) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path fill="#0078D4" d="M22 5.6v12.2L17 22l-7.8-2.8v2.8L4.8 16.3l12.8 1V6.2zM17.7 6.2 10.5 1.7v2.9L3.9 6.5 2 9v5.6l2.8 1.2V8.6z" />
    </svg>
  );
}

export function BitbucketIcon({ className }: P) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path fill="#2684FF" d="M1.6 2.3a.7.7 0 0 0-.7.8l3 18.4c.1.5.5.8 1 .8h14.4c.3 0 .6-.2.7-.6l3-18.6a.7.7 0 0 0-.7-.8zm12.7 13.3H9.7L8.5 9.2h7z" />
    </svg>
  );
}

export function SentryIcon({ className }: P) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M13.9 2.7a2.2 2.2 0 0 0-3.8 0L7 8a15.2 15.2 0 0 1 8.4 12.6h-2.2A13 13 0 0 0 5.9 9.9l-2.9 5a7.5 7.5 0 0 1 4.3 5.7H2.2a.4.4 0 0 1-.3-.5l1.4-2.4a5 5 0 0 0-1.6-.9L.3 19.2a2.2 2.2 0 0 0 1.9 3.2h6.9a9.3 9.3 0 0 0-3.8-8.3l1.1-1.9a11.5 11.5 0 0 1 4.9 10.2h5.9A17 17 0 0 0 9.4 7.5l2.2-3.9a.4.4 0 0 1 .7 0l9.8 17a.4.4 0 0 1-.3.6h-2.3l.1 1.8h2.2a2.2 2.2 0 0 0 1.9-3.3z" />
    </svg>
  );
}
