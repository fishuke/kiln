"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";

export function SubmitButton({ children, variant, size, name, value, className }: { children: React.ReactNode; variant?: "default" | "outline" | "secondary" | "ghost" | "destructive"; size?: "default" | "sm" | "xs" | "lg" | "icon"; name?: string; value?: string; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} size={size} name={name} value={value} disabled={pending} className={className}>
      {pending ? "Working…" : children}
    </Button>
  );
}
