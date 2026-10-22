"use client";

import { ArrowUp, Plus } from "lucide-react";
import { AttachmentChips, type useAttachments } from "@/components/kiln/attachments";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@/components/ui/input-group";
import { cn } from "@/lib/utils";

/**
 * The AI Elements Prompt Input: attachments above the text, the attach button, `tools` and the
 * send button below it. Enter sends, Shift+Enter adds a new line; files can be dropped on it.
 */
export function PromptInput({
  value,
  onChange,
  onSubmit,
  canSend,
  files,
  label,
  sendLabel,
  placeholder,
  tools,
  autoFocus,
  className,
  textareaClassName,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  canSend: boolean;
  files: ReturnType<typeof useAttachments>;
  label: string;
  sendLabel: string;
  placeholder: string;
  tools?: React.ReactNode;
  autoFocus?: boolean;
  className?: string;
  textareaClassName?: string;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (e.dataTransfer.files.length) void files.add(e.dataTransfer.files);
      }}
      className={className}
    >
      {files.input}
      <InputGroup className="h-auto rounded-xl bg-background shadow-xs transition-shadow focus-within:shadow-sm dark:bg-muted/20">
        {files.items.length > 0 && (
          <InputGroupAddon align="block-start">
            <AttachmentChips items={files.items} onRemove={files.remove} />
          </InputGroupAddon>
        )}
        <InputGroupTextarea
          aria-label={label}
          autoFocus={autoFocus}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              onSubmit();
            }
          }}
          placeholder={placeholder}
          className={cn("px-3 text-sm leading-6", textareaClassName)}
        />
        <InputGroupAddon align="block-end">
          <InputGroupButton size="icon-xs" variant="outline" aria-label="Attach files" onClick={files.open}>
            <Plus />
          </InputGroupButton>
          {tools}
          <InputGroupButton type="submit" size="icon-xs" variant="default" aria-label={sendLabel} disabled={!canSend} className="ml-auto">
            <ArrowUp />
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </form>
  );
}
