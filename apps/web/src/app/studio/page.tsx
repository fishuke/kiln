import type { Metadata } from "next";
import { AppsList } from "@/components/studio/apps-list";

export const metadata: Metadata = { title: "Studio" };

export default async function Studio({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const { new: startNew } = await searchParams;
  return <AppsList startNew={startNew === "1"} />;
}
