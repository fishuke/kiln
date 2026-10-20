import type { Metadata } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import { Sidebar } from "@/components/kiln/sidebar";
import { THEME_SCRIPT } from "@/components/kiln/theme";
import { TooltipProvider } from "@/components/ui/tooltip";
import { api, safe } from "@/lib/kiln";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const mono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Kiln", template: "%s - Kiln" },
  description: "Self-hostable software factories",
};

export const dynamic = "force-dynamic";

type Me = { subject: string; name?: string; email?: string; avatarUrl?: string; role?: string; user?: { name: string; email: string; avatarUrl?: string }; team?: { id: string; name: string }; teams?: { id: string; name: string }[] };

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const [factories, inbox, me] = await Promise.all([safe(() => api.factories(), []), safe(() => api.inbox({ all: true }), []), safe(() => api.me() as Promise<Me>, undefined)]);
  const user = me ? { name: me.user?.name ?? me.subject.split("@")[0]!, email: me.user?.email ?? me.subject, avatarUrl: me.user?.avatarUrl, role: me.role ?? "admin" } : undefined;
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="bg-background font-sans text-sm antialiased">
        <TooltipProvider>
          <div className="flex min-h-screen">
            <Sidebar factories={factories} inboxCount={inbox.length} user={user} team={me?.team} teams={me?.teams} />
            <main className="min-w-0 flex-1">{children}</main>
          </div>
        </TooltipProvider>
      </body>
    </html>
  );
}
