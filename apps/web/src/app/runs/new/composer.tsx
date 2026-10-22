"use client";

import { Info } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { startRun } from "@/app/runs/actions";
import { useAttachments } from "@/components/kiln/attachments";
import { FactoryPicker, type PickerFactory } from "@/components/kiln/factory-picker";
import { ForemanGuide } from "@/components/kiln/foreman-guide";
import { PromptInput } from "@/components/kiln/prompt-input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

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
      <PromptInput
        value={text}
        onChange={setText}
        onSubmit={submit}
        canSend={canSend}
        files={files}
        label="Run prompt"
        sendLabel="Start run (Enter)"
        placeholder={`Tell me what you'd like to build in ${current?.name ?? "your factory"}...`}
        tools={<FactoryPicker factories={factories} value={factory} onChange={setFactory} />}
        autoFocus
        textareaClassName="min-h-24 pt-3"
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
