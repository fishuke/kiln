"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/**
 * The Confirmation pattern in a popover: what will happen, and Cancel or the action. Used for
 * Restore and Apply, which change main.
 */
export function Confirm({
  trigger,
  icon,
  title,
  description,
  action,
  onConfirm,
}: {
  trigger: React.ReactElement;
  icon: React.ReactNode;
  title: string;
  description: string;
  action: string;
  onConfirm: () => Promise<unknown> | void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={trigger} />
      <PopoverContent align="end" className="w-80 p-0">
        <Item size="sm" className="items-start">
          <ItemMedia variant="icon">{icon}</ItemMedia>
          <ItemContent>
            <ItemTitle>{title}</ItemTitle>
            <ItemDescription className="line-clamp-none">{description}</ItemDescription>
          </ItemContent>
          <ItemActions className="basis-full justify-end pt-1">
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await onConfirm();
                  setOpen(false);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {action}
            </Button>
          </ItemActions>
        </Item>
      </PopoverContent>
    </Popover>
  );
}
