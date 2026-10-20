import { redirect } from "next/navigation";

export default async function FactoryHome({ params }: { params: Promise<{ factory: string }> }) {
  const { factory } = await params;
  redirect(`/f/${factory}/dashboard`);
}
