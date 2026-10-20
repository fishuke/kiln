import { redirect } from "next/navigation";

/** The API's invite links point at /join?invite=<token>. */
export default async function Join({ searchParams }: { searchParams: Promise<{ invite?: string }> }) {
  const { invite } = await searchParams;
  redirect(invite ? `/invite/${encodeURIComponent(invite)}` : "/login");
}
