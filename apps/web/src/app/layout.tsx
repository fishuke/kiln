import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Sidebar } from "@/components/kiln/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { api, safe } from "@/lib/kiln";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Kiln",
  description: "Self-hostable software factories",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const [factories, inbox, me, integrations] = await Promise.all([
    safe(() => api.factories(), []),
    safe(() => api.inbox({ all: true }), []),
    safe(() => api.me(), undefined),
    safe(() => api.integrations(), undefined),
  ]);
  const mode = integrations ? (integrations.forge === "github" ? "GitHub" : "local") : undefined;
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body className="bg-background font-sans antialiased">
        <TooltipProvider>
          <div className="flex min-h-screen">
            <Sidebar factories={factories} inboxCount={inbox.length} subject={me?.subject} mode={mode} />
            <main className="min-w-0 flex-1">{children}</main>
          </div>
        </TooltipProvider>
      </body>
    </html>
  );
}
