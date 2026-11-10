import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { api, safe } from "@/lib/kiln";
import { buildReviewModel, type ReviewWorkItemLike } from "@/lib/review-model";
import { ReviewView } from "./review-view";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const wi = await safe(() => api.workItem(id), null);
  return { title: wi ? `Review · ${wi.title}` : "Review" };
}

/** A task as a reviewer needs it: what changed, the proof and the checks first; the chat is a link away. */
export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const wi = await safe(() => api.workItem(id), null);
  if (!wi) notFound();
  const factories = await safe(() => api.factories(), []);
  const factory = factories.find((f) => f.id === wi.factory);
  return <ReviewView model={buildReviewModel(wi as unknown as ReviewWorkItemLike)} factory={{ id: wi.factory, name: factory?.name ?? wi.factory }} />;
}
