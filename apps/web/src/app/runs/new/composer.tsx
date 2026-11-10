"use client";

import { Info } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "@/lib/toast";
import { startRun } from "@/app/runs/actions";
import { useAttachments } from "@/components/kiln/attachments";
import { FactoryPicker, type PickerFactory } from "@/components/kiln/factory-picker";
import { ForemanGuide } from "@/components/kiln/foreman-guide";
import { PromptInput } from "@/components/kiln/prompt-input";
import { useStudioClient } from "@/components/studio/use-client";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export function NewRunComposer({ factories, initialFactory }: { factories: PickerFactory[]; initialFactory: string }) {
  const router = useRouter();
  const [factory, setFactory] = useState(initialFactory);
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const [mode, setMode] = useState<"run" | "studio">("run");
  const studio = useStudioClient();
  const files = useAttachments();
  const current = factories.find((f) => f.id === factory);
  const canSend = text.trim().length > 0 && !files.uploading && !pending;

  const submit = () => {
    if (!canSend) return;
    if (mode === "studio") {
      if (!studio) return;
      start(async () => {
        try {
          const prompt = text.trim();
          const name = prompt.replace(/\s+/g, " ").slice(0, 40).trim() || "New app";
          const app = await studio.createApp({ name, source: { kind: "template", template: "nextjs" }, prompt });
          router.push(`/studio/${app.id}`);
        } catch (e) {
          toast.error("Could not start the Studio chat", { description: e instanceof Error ? e.message : String(e) });
        }
      });
      return;
    }
    start(async () => {
      const r = await startRun({ factory, text, attachments: files.attachments });
      if (!r.ok) {
        toast.error("Could not start the run", { description: r.error });
        return;
      }
      files.clear();
      router.push(`/runs/${r.id}`);
    });
  };

  return (
    <div className="w-full max-w-[672px]">
      <PromptInput
        value={text}
        onChange={setText}
        onSubmit={submit}
        canSend={canSend}
        files={files}
        label={mode === "studio" ? "Studio prompt" : "Run prompt"}
        sendLabel={mode === "studio" ? "Start Studio chat (Enter)" : "Start run (Enter)"}
        placeholder={
          mode === "studio" ? "Describe an app and chat it into existence..." : `Tell me what you'd like to build in ${current?.name ?? "your factory"}...`
        }
        tools={
          <div className="flex items-center gap-1">
            <div role="radiogroup" aria-label="Start a" className="flex rounded-md bg-muted p-0.5 text-xs font-medium">
              {(["run", "studio"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={mode === m}
                  onClick={() => setMode(m)}
                  className={cn("rounded px-2 py-0.5", mode === m ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}
                >
                  {m === "run" ? "Run" : "Studio chat"}
                </button>
              ))}
            </div>
            {mode === "run" && <FactoryPicker factories={factories} value={factory} onChange={setFactory} />}
          </div>
        }
        autoFocus
        textareaClassName="min-h-24 pt-3"
        className="kiln-hero-composer"
      />
      <Popover>
        <PopoverTrigger className="mt-3 ml-1 flex items-center gap-1.5 rounded-md px-0.5 text-sm text-muted-foreground hover:text-foreground">
          How to chat with the factory foreman in your connected apps
          <Info className="size-4" />
        </PopoverTrigger>
        <PopoverContent side="top" align="start" className="w-[600px] max-w-[calc(100vw-2rem)] bg-muted p-4 dark:bg-popover">
          <ForemanGuide alias={current?.alias ?? current?.id ?? "factory"} columns={2} />
        </PopoverContent>
      </Popover>
    </div>
  );
}
