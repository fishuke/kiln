"use client";

import {
  AppWindow,
  Check,
  CircleAlert,
  Code2,
  ExternalLink,
  Eye,
  History,
  LoaderCircle,
  Monitor,
  Power,
  RotateCw,
  Route,
  Smartphone,
  Tablet,
  Undo2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { previewSrc } from "@/lib/studio/model";
import type { Preview, Version } from "@/lib/studio/types";
import { cn } from "@/lib/utils";
import { Confirm } from "./confirm";
import { DiffView } from "./diff-view";

type Device = "desktop" | "tablet" | "mobile";
const WIDTH: Record<Device, string> = { desktop: "100%", tablet: "820px", mobile: "390px" };

export type PreviewView = "preview" | "code";

/** A preview on Kiln's own origin (the fake, local development) must not get allow-same-origin. */
function sameOrigin(src: string | undefined): boolean {
  if (!src || typeof window === "undefined") return true;
  try {
    return new URL(src, window.location.href).origin === window.location.origin;
  } catch {
    return true;
  }
}

function IconButton({ label, children, ...props }: { label: string; children: React.ReactNode } & Omit<React.ComponentProps<typeof Button>, "children">) {
  return (
    <Tooltip>
      <TooltipTrigger render={<Button size="icon-sm" variant="ghost" aria-label={label} {...props} />}>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** The address bar: a route picker, the route, reload. */
function AddressBar({
  route,
  routes,
  onRoute,
  onReload,
  disabled,
}: {
  route: string;
  routes: string[];
  onRoute: (r: string) => void;
  onReload: () => void;
  disabled: boolean;
}) {
  const [draft, setDraft] = useState(route);
  useEffect(() => setDraft(route), [route]);
  return (
    <InputGroup className="h-8 max-w-md min-w-0 flex-1 bg-muted/40 dark:bg-input/20">
      <InputGroupAddon>
        <DropdownMenu>
          <DropdownMenuTrigger render={<InputGroupButton size="icon-xs" variant="ghost" aria-label="Pick a route" disabled={disabled} />}>
            <Route />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Routes</DropdownMenuLabel>
              {routes.map((r) => (
                <DropdownMenuItem key={r} onClick={() => onRoute(r)} className="font-mono text-xs">
                  {r}
                  {r === route && <Check className="ml-auto size-3.5" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </InputGroupAddon>
      <InputGroupInput
        aria-label="Route"
        value={draft}
        disabled={disabled}
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onRoute(draft.trim() || "/");
          if (e.key === "Escape") setDraft(route);
        }}
        onBlur={() => setDraft(route)}
        className="font-mono text-xs"
      />
      <InputGroupAddon align="inline-end">
        <InputGroupButton size="icon-xs" variant="ghost" aria-label="Reload preview" onClick={onReload} disabled={disabled}>
          <RotateCw />
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  );
}

/** "Previewing v3": an old version is in the preview, with Restore and Back to latest. */
export function PreviewingBanner({
  version,
  number,
  onRestore,
  onBack,
}: {
  version: Version;
  number: number;
  onRestore: () => Promise<unknown>;
  onBack: () => void;
}) {
  return (
    <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b bg-amber-500/10 px-3 py-2 text-sm">
      <History className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
      <span className="min-w-0 flex-1">
        <span className="font-medium">Previewing v{number}</span>
        <span className="text-muted-foreground"> · {version.title}</span>
      </span>
      <Confirm
        trigger={
          <Button size="sm" variant="outline">
            <Undo2 data-icon="inline-start" />
            Restore
          </Button>
        }
        icon={<Undo2 />}
        title={`Restore v${number}?`}
        description="Creates a new version with this version's code. Later versions stay in History."
        action="Restore"
        onConfirm={onRestore}
      />
      <Button size="sm" onClick={onBack}>
        Back to latest
      </Button>
    </div>
  );
}

/** Loading shimmer over the frame until the dev server answers. */
function FrameLoading({ label }: { label: string }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-background">
      <div className="flex w-64 flex-col gap-2.5">
        <div className="h-3 w-2/3 animate-pulse rounded-full bg-muted" />
        <div className="h-3 w-full animate-pulse rounded-full bg-muted [animation-delay:150ms]" />
        <div className="h-3 w-5/6 animate-pulse rounded-full bg-muted [animation-delay:300ms]" />
      </div>
      <span className="shimmer text-sm text-muted-foreground">{label}</span>
    </div>
  );
}

/** A dev server that stopped: why, its last output lines, and Restart. */
export function DevServerFailed({ preview, onRestart }: { preview: Preview; onRestart?: () => Promise<void> }) {
  const [restarting, setRestarting] = useState(false);
  return (
    <div className="flex w-full max-w-xl flex-col gap-2 text-sm">
      <div className="flex items-center gap-2 font-medium">
        <CircleAlert className="size-4 shrink-0 text-destructive" />
        The dev server stopped
      </div>
      {preview.reason && <p className="text-muted-foreground">{preview.reason}</p>}
      {preview.output && (
        <pre className="max-h-64 overflow-auto rounded-md border bg-muted/40 p-2.5 font-mono text-xs whitespace-pre-wrap">{preview.output}</pre>
      )}
      {onRestart && (
        <Button
          size="sm"
          variant="outline"
          className="self-start"
          disabled={restarting}
          onClick={async () => {
            setRestarting(true);
            try {
              await onRestart();
            } finally {
              setRestarting(false);
            }
          }}
        >
          {restarting ? <LoaderCircle className="animate-spin" /> : <Power />}
          Restart
        </Button>
      )}
    </div>
  );
}

/**
 * The Web Preview: Preview and Code tabs, an address bar with a route picker and reload, a device
 * toggle and "open in a new tab". `children` replaces the frame (setup progress, empty state).
 */
export function PreviewPane({
  preview,
  error,
  reload,
  routes,
  banner,
  view,
  onViewChange,
  loadDiff,
  diffKey,
  onRestart,
  children,
}: {
  preview?: Preview;
  error?: string;
  /** Restarts the dev server (it reads the App's environment when it starts). */
  onRestart?: () => Promise<void>;
  /** Bumps when the frame should reload (a turn finished). */
  reload: number;
  routes: string[];
  banner?: React.ReactNode;
  view: PreviewView;
  onViewChange: (v: PreviewView) => void;
  loadDiff?: () => Promise<{ diff: string }>;
  /** Changes when the diff should be fetched again. */
  diffKey: string;
  children?: React.ReactNode;
}) {
  const [route, setRoute] = useState("/");
  const [device, setDevice] = useState<Device>("desktop");
  const [nonce, setNonce] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [diff, setDiff] = useState<string>();
  const src = preview?.status === "ready" ? previewSrc(preview.url, route) : undefined;
  const frameKey = `${src}|${reload}|${nonce}`;

  useEffect(() => setLoaded(false), [frameKey]);
  useEffect(() => {
    if (view !== "code" || !loadDiff) return;
    let stop = false;
    setDiff(undefined);
    loadDiff()
      .then((d) => !stop && setDiff(d.diff))
      .catch(() => !stop && setDiff(""));
    return () => {
      stop = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `diffKey` identifies `loadDiff`
  }, [view, diffKey, reload]);

  const noFrame = Boolean(children) || !preview;
  return (
    <Tabs value={view} onValueChange={(v) => onViewChange(v as PreviewView)} className="flex h-full min-h-0 flex-col gap-0 bg-muted/30 dark:bg-background">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b bg-background px-3">
        <TabsList className="shrink-0">
          <TabsTrigger value="preview" className="px-2.5">
            <Eye />
            <span className="hidden sm:inline">Preview</span>
          </TabsTrigger>
          <TabsTrigger value="code" className="px-2.5">
            <Code2 />
            <span className="hidden sm:inline">Code</span>
          </TabsTrigger>
        </TabsList>
        <div className="flex min-w-0 flex-1 justify-center">
          {view === "preview" && <AddressBar route={route} routes={routes} onRoute={setRoute} onReload={() => setNonce((n) => n + 1)} disabled={noFrame} />}
        </div>
        {view === "preview" && (
          <ToggleGroup
            value={[device]}
            onValueChange={(v: string[]) => v[0] && setDevice(v[0] as Device)}
            size="sm"
            spacing={0}
            variant="outline"
            className="hidden md:flex"
            aria-label="Device"
          >
            <ToggleGroupItem value="desktop" aria-label="Desktop">
              <Monitor />
            </ToggleGroupItem>
            <ToggleGroupItem value="tablet" aria-label="Tablet">
              <Tablet />
            </ToggleGroupItem>
            <ToggleGroupItem value="mobile" aria-label="Phone">
              <Smartphone />
            </ToggleGroupItem>
          </ToggleGroup>
        )}
        {onRestart && preview && !children && (
          <IconButton label="Restart the dev server" onClick={() => void onRestart()}>
            <Power />
          </IconButton>
        )}
        {src ? (
          <IconButton label="Open in a new tab" render={<a href={src} target="_blank" rel="noreferrer" />} nativeButton={false}>
            <ExternalLink />
          </IconButton>
        ) : (
          <IconButton label="Open in a new tab" disabled>
            <ExternalLink />
          </IconButton>
        )}
      </div>
      {banner}
      <TabsContent value="preview" className="relative min-h-0 flex-1">
        {children ??
          (error ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center text-sm">
              <CircleAlert className="size-5 text-destructive" />
              <span className="font-medium">The preview didn&apos;t start</span>
              <span className="max-w-sm text-muted-foreground">{error}</span>
            </div>
          ) : !preview || preview.status === "starting" ? (
            <FrameLoading label="Starting the dev server…" />
          ) : preview.status === "failed" ? (
            <div className="flex h-full items-center justify-center overflow-y-auto p-8">
              <DevServerFailed preview={preview} onRestart={onRestart} />
            </div>
          ) : (
            <div className={cn("flex h-full justify-center", device !== "desktop" && "p-4")}>
              <div
                className={cn("relative h-full overflow-hidden bg-background", device !== "desktop" && "rounded-2xl border shadow-lg")}
                style={{ width: WIDTH[device], maxWidth: "100%" }}
              >
                {!loaded && <FrameLoading label="Loading…" />}
                <iframe
                  key={frameKey}
                  src={src}
                  title="App preview"
                  onLoad={() => setLoaded(true)}
                  className="size-full border-0"
                  sandbox={`allow-scripts allow-forms allow-popups allow-modals allow-downloads${sameOrigin(src) ? "" : " allow-same-origin"}`}
                />
              </div>
            </div>
          ))}
      </TabsContent>
      <TabsContent value="code" className="flex min-h-0 flex-1 flex-col bg-background p-3">
        {loadDiff ? <DiffView diff={diff} className="min-h-0 flex-1" /> : <EmptyPreview />}
      </TabsContent>
    </Tabs>
  );
}

/** Before the first build: where the app will appear. */
export function EmptyPreview({ starting }: { starting?: boolean }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl border bg-background shadow-xs">
        {starting ? <LoaderCircle className="size-6 animate-spin text-muted-foreground" /> : <AppWindow className="size-6 text-muted-foreground" />}
      </div>
      <div className="text-sm font-medium">{starting ? "Setting up" : "No preview yet"}</div>
      <p className="max-w-xs text-sm text-muted-foreground">{starting ? "Creating the workspace" : "Send a message to start building"}</p>
    </div>
  );
}
