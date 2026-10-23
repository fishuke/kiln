"use client";

import { toast as sonner, type ExternalToast } from "sonner";
import { TraceId } from "@/components/kiln/trace-id";
import { splitTrace } from "./trace-id";

/** An error toast for `message`: a trace id at its end (lib/trace-id.ts) moves to a small line under it with a copy button. */
function error(message: Parameters<typeof sonner.error>[0], data?: ExternalToast) {
  if (typeof message !== "string") return sonner.error(message, data);
  const { message: text, traceId } = splitTrace(message);
  if (!traceId) return sonner.error(message, data);
  const description = typeof data?.description === "function" ? data.description() : data?.description;
  return sonner.error(text, {
    ...data,
    description: (
      <>
        {description && <span className="block whitespace-pre-line">{description}</span>}
        <TraceId traceId={traceId} />
      </>
    ),
  });
}

/** Sonner's toast; every error toast shows the trace id an error message carries. Import toasts from here, not from "sonner". */
export const toast: typeof sonner = Object.assign((...args: Parameters<typeof sonner>) => sonner(...args), sonner, { error });
