"use client";

import { ArrowUp, Info, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { startRun } from "@/app/runs/actions";
import { AttachmentChips, useAttachments } from "@/components/kiln/attachments";
import { FactoryPicker, type PickerFactory } from "@/components/kiln/factory-picker";
import { ForemanGuide } from "@/components/kiln/foreman-guide";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export function NewRunComposer({ factories, initialFactory }: { factories: PickerFactory[]; initialFactory: string }) {
  const router = useRouter();
  const [factory, setFactory] = useState(initialFactory);
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const files = useAttachments();
  const current = factories.find((f) => f.id === factory);
  const canSend = text.trim().length > 0 && !files.uploading && !pending;

  const submit = () => {
    if (!canSend) return;
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
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (e.dataTransfer.files.length) void files.add(e.dataTransfer.files);
        }}
        className="rounded-xl border bg-background p-4 shadow-xs transition-shadow focus-within:shadow-sm dark:bg-muted/20"
      >
        <AttachmentChips items={files.items} onRemove={files.remove} className="mb-2" />
        <textarea
          aria-label="Run prompt"
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          rows={3}
          placeholder={`Tell me what you'd like to build in ${current?.name ?? "your factory"}...`}
          className="block min-h-20 w-full resize-none bg-transparent text-sm leading-6 outline-none placeholder:text-muted-foreground"
        />
        <div className="mt-2 flex items-center gap-2">
          {files.input}
          <button type="button" aria-label="Attach files" onClick={files.open} className="flex size-7 items-center justify-center rounded-md border bg-background text-muted-foreground hover:bg-muted hover:text-foreground">
            <Plus className="size-4" />
          </button>
          <FactoryPicker factories={factories} value={factory} onChange={setFactory} />
          <button
            type="submit"
            aria-label="Start run (Enter)"
            disabled={!canSend}
            className={cn("ml-auto flex size-7 items-center justify-center rounded-md transition-colors", canSend ? "bg-primary text-primary-foreground hover:bg-primary/85" : "bg-foreground/5 text-muted-foreground")}
          >
            <ArrowUp className="size-4" />
          </button>
        </div>
      </form>
      <Popover>
        <PopoverTrigger className="mt-3 ml-1 flex items-center gap-1.5 rounded-md px-0.5 text-sm text-muted-foreground hover:text-foreground">
          How to chat with the factory foreman in your connected apps
          <Info className="size-4" />
        </PopoverTrigger>
        <PopoverContent side="top" align="start" className="max-h-[70vh] w-80 overflow-y-auto bg-muted p-4 dark:bg-popover">
          <ForemanGuide alias={current?.alias ?? current?.id ?? "factory"} />
        </PopoverContent>
      </Popover>
    </div>
  );
}
