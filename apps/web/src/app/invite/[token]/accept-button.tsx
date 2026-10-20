"use client";

import { useRouter } from "next/navigation";
import { useAction } from "@/components/kiln/use-action";
import { Button } from "@/components/ui/button";
import { acceptInvite } from "./actions";

export function AcceptInviteButton({ token }: { token: string }) {
  const [pending, run] = useAction();
  const router = useRouter();
  return (
    <Button className="h-10 w-full" disabled={pending} onClick={() => void run(() => acceptInvite(token), { onSuccess: () => router.push("/") })}>
      {pending ? "Joining…" : "Accept invite"}
    </Button>
  );
}
