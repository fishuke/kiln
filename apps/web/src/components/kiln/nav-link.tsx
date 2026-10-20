"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function NavLink({ href, children, exact, className }: { href: string; children: React.ReactNode; exact?: boolean; className?: string }) {
  const path = usePathname();
  const active = exact ? path === href : path === href || path.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-foreground/80 transition-colors hover:bg-black/5 dark:hover:bg-white/5",
        active && "bg-black/[0.07] font-medium text-foreground dark:bg-white/10",
        className,
      )}
    >
      {children}
    </Link>
  );
}
