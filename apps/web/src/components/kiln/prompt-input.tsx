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
  trailing,
  autoFocus,
  className,
  textareaClassName,
  textareaRef,
  header,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  canSend: boolean;
  /** Omit for a composer without attachments (no attach button, no drop). */
  files?: ReturnType<typeof useAttachments>;
  label: string;
  sendLabel: string;
  placeholder: string;
  tools?: React.ReactNode;
  /** Controls next to the send button, on the right. */
  trailing?: React.ReactNode;
  autoFocus?: boolean;
  className?: string;
  textareaClassName?: string;
  textareaRef?: React.Ref<HTMLTextAreaElement>;
  /** Shown above the text, inside the box (e.g. a note about steering). */
  header?: React.ReactNode;
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
        if (files && e.dataTransfer.files.length) void files.add(e.dataTransfer.files);
      }}
      className={className}
    >
      {files?.input}
      <InputGroup className="h-auto rounded-xl bg-background shadow-xs transition-shadow focus-within:shadow-sm dark:bg-muted/20">
        {header && <InputGroupAddon align="block-start">{header}</InputGroupAddon>}
        {files && files.items.length > 0 && (
          <InputGroupAddon align="block-start">
            <AttachmentChips items={files.items} onRemove={files.remove} />
          </InputGroupAddon>
        )}
        <InputGroupTextarea
          ref={textareaRef}
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
          {files && (
            <InputGroupButton size="icon-xs" variant="outline" aria-label="Attach files" onClick={files.open}>
              <Plus />
            </InputGroupButton>
          )}
          {tools}
          {/* Tools shrink before the send button does, so a narrow composer never hides it. */}
          <span className="ml-auto flex shrink-0 items-center gap-1">
            {trailing}
            <InputGroupButton type="submit" size="icon-xs" variant="default" aria-label={sendLabel} disabled={!canSend}>
              <ArrowUp />
            </InputGroupButton>
          </span>
        </InputGroupAddon>
      </InputGroup>
    </form>
  );
}
