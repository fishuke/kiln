import type { Metadata } from "next";
import { Suspense } from "react";
import { AppPage } from "@/components/studio/app-page";
import { studioFakeEnabled } from "@/lib/studio/flag";

export const metadata: Metadata = { title: "Studio" };

export default async function StudioApp({ params, searchParams }: { params: Promise<{ app: string }>; searchParams: Promise<{ seed?: string }> }) {
  const [{ app }, { seed }] = await Promise.all([params, searchParams]);
  return (
    <Suspense>
      <AppPage appId={app} fake={studioFakeEnabled()} seed={seed === "empty" ? "empty" : "demo"} />
    </Suspense>
  );
}
