"use client";

import Link from "next/link";
import { Bell, Check, ChevronsUpDown, LayoutGrid, Plus, Settings2 } from "lucide-react";
import { useState } from "react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { StudioClient } from "@/lib/studio/client";
import { cowboyConfirmation, needsYouCount, SHIP_MODES, shipModeCopy } from "@/lib/studio/model";
import type { AppSource, ShipMode, StatusReport, StudioApp } from "@/lib/studio/types";
import { cn } from "@/lib/utils";

/** A square initial for an app, like a factory's avatar. */
export function AppAvatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-violet-500 to-orange-400 text-[10px] font-semibold text-white uppercase",
        className,
      )}
    >
      {name.slice(0, 1)}
    </span>
  );
}

/** The app switcher at the top of the chat rail. */
export function AppSwitcher({ client, app, href }: { client: StudioClient; app: StudioApp; href: (id: string) => string }) {
  const [apps, setApps] = useState<StudioApp[]>([]);
  return (
    <DropdownMenu onOpenChange={(o) => o && void client.apps().then(setApps, () => undefined)}>
      <DropdownMenuTrigger render={<Button variant="ghost" className="h-8 min-w-0 gap-2 px-1.5 font-semibold" />}>
        <AppAvatar name={app.name} />
        <span className="truncate">{app.name}</span>
        <ChevronsUpDown className="size-3.5 opacity-50" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Apps</DropdownMenuLabel>
          {(apps.length ? apps : [app]).map((a) => (
            <DropdownMenuItem key={a.id} render={<Link href={href(a.id)} />}>
              <AppAvatar name={a.name} />
              <span className="truncate">{a.name}</span>
              {a.id === app.id && <Check className="ml-auto size-4" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link href="/studio" />}>
          <LayoutGrid />
          All apps
        </DropdownMenuItem>
        <DropdownMenuItem render={<Link href="/studio?new=1" />}>
          <Plus />
          New app
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The "needs you" badge: chats in any app that asked something or hit a conflict. */
export function NeedsYouMenu({ status, href }: { status?: StatusReport; href: (appId: string, chatId: string) => string }) {
  const count = needsYouCount(status);
  const items = status?.apps.flatMap((p) => p.needsYou.map((n) => ({ ...n, app: p.name, appId: p.id }))) ?? [];
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              render={
                <Button
                  size="sm"
                  variant={count ? "outline" : "ghost"}
                  aria-label={`${count} need you`}
                  className={cn("gap-1.5", count && "border-amber-500/40")}
                />
              }
            />
          }
        >
          <Bell className={cn(count && "text-amber-600 dark:text-amber-400")} />
          {count > 0 && <span className="rounded-full bg-amber-500 px-1.5 text-[11px] leading-4 font-semibold text-white tabular-nums">{count}</span>}
          {count > 0 && <span className="hidden text-xs xl:inline">Needs you</span>}
        </TooltipTrigger>
        <TooltipContent>{count ? "Chats waiting on you" : "Nothing needs you"}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Needs you</DropdownMenuLabel>
          {items.length === 0 && <div className="px-2 py-3 text-sm text-muted-foreground">Nothing is waiting on you.</div>}
          {items.map((n) => (
            <DropdownMenuItem key={n.chatId} render={<Link href={href(n.appId, n.chatId)} />} className="flex-col items-start gap-0.5">
              <span className="text-xs font-medium text-muted-foreground">{n.app}</span>
              <span className="line-clamp-2 text-sm">{n.question}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Ship mode: Safe, Review or Cowboy, one line each. Cowboy on an imported repository asks first. */
const RANK: Record<ShipMode, number> = { safe: 0, review: 1, cowboy: 2 };

/** Ship mode: Safe, Review or Cowboy, one line each. Modes above the policy's cap are disabled; Cowboy on an imported repository asks first. */
export function ShipModePicker({ value, onChange, source, max, disabled }: { value: ShipMode; onChange: (m: ShipMode) => void; source?: AppSource; max?: ShipMode; disabled?: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const confirmation = cowboyConfirmation(source);
  return (
    <>
      <RadioGroup
        value={value}
        onValueChange={(v) => {
          if (v === "cowboy" && confirmation) setConfirming(true);
          else onChange(v as ShipMode);
        }}
        className="gap-2"
      >
        {SHIP_MODES.map((m) => {
          const copy = shipModeCopy(m);
          const off = disabled || (max !== undefined && RANK[m] > RANK[max]);
          return (
            <Label
              key={m}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-lg border p-3 font-normal transition-colors hover:bg-muted/50",
                value === m && "border-foreground/30 bg-muted/40",
                off && "cursor-not-allowed opacity-50 hover:bg-transparent",
              )}
            >
              <RadioGroupItem value={m} disabled={off} className="mt-0.5" />
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">{copy.label}</span>
                <span className="text-xs text-muted-foreground">{copy.line}</span>
              </span>
            </Label>
          );
        })}
      </RadioGroup>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Switch to Cowboy?</AlertDialogTitle>
            <AlertDialogDescription>{confirmation}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirming(false);
                onChange("cowboy");
              }}
            >
              Use Cowboy
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** The App's settings page (ship mode, workspace and the App definition). */
export function AppSettingsLink({ appId }: { appId: string }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<Button size="icon-sm" variant="ghost" aria-label="App settings" render={<Link href={`/studio/${appId}/settings`} />} nativeButton={false} />}>
        <Settings2 />
      </TooltipTrigger>
      <TooltipContent>App settings</TooltipContent>
    </Tooltip>
  );
}
