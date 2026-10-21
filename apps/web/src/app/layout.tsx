import type { Metadata } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import { headers } from "next/headers";
import { AppearanceSync } from "@/components/kiln/appearance-sync";
import { Sidebar } from "@/components/kiln/sidebar";
import { THEME_SCRIPT } from "@/components/kiln/theme";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { inboxCount, type GateLike } from "@/lib/inbox-model";
import { api, safe } from "@/lib/kiln";
import { isAuthPage } from "@/lib/session";
import { usageLabel } from "@/lib/usage";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const mono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Kiln", template: "%s - Kiln" },
  description: "Self-hostable software factories",
};

export const dynamic = "force-dynamic";

async function shell() {
  const [factories, inbox, items, me, usage] = await Promise.all([
    safe(() => api.factories(), []),
    safe(() => api.inbox({ all: true }), []),
    safe(() => api.workItems(), []),
    safe(() => api.me(), undefined),
    safe(() => api.usage(), undefined),
  ]);
  const user = me
    ? {
        name: me.user?.name ?? me.name ?? me.subject.split("@")[0]!,
        email: me.user?.email ?? me.subject,
        avatarUrl: me.user?.avatar,
        role: me.role ?? (me.grants.some((g) => g.scope === "admin" && g.factory === "*") ? "admin" : undefined),
      }
    : undefined;
  const team = me?.currentTeam ? { id: me.currentTeam.id, name: me.currentTeam.name } : undefined;
  const teams = (me?.teams ?? []).map((t) => ({ id: t.id, name: t.name }));
  return { factories, inboxCount: inboxCount(inbox as GateLike[], items), user, team, teams, usage: usage ? usageLabel(usage.limit) : undefined, appearance: me?.user?.appearance };
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const path = (await headers()).get("x-kiln-path") ?? "";
  const bare = isAuthPage(path);
  const s = bare ? undefined : await shell();
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="bg-background font-sans text-sm antialiased">
        <TooltipProvider>
          {s ? (
            <div className="flex min-h-screen">
              <Sidebar factories={s.factories} inboxCount={s.inboxCount} user={s.user} team={s.team} teams={s.teams} usage={s.usage} />
              <main className="min-w-0 flex-1">{children}</main>
              <AppearanceSync appearance={s.appearance} />
            </div>
          ) : (
            <main>{children}</main>
          )}
          <Toaster position="bottom-right" />
        </TooltipProvider>
      </body>
    </html>
  );
}
