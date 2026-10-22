import type { Metadata } from "next";
import { AppsList } from "@/components/studio/apps-list";
import { studioFakeEnabled } from "@/lib/studio/flag";

export const metadata: Metadata = { title: "Studio" };

export default async function Studio({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const { new: startNew } = await searchParams;
  return <AppsList fake={studioFakeEnabled()} startNew={startNew === "1"} />;
}
