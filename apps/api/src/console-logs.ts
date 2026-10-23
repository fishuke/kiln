import { format } from "node:util";
import { context } from "@opentelemetry/api";
import { SeverityNumber, type Logger } from "@opentelemetry/api-logs";

/**
 * The API logs through console.*; each line also becomes a log record in the active context, so a line written
 * while handling a request or a run carries its trace and span ids. Lines outside any span (startup) have none.
 */
export function bridgeConsole(logger: Logger, target: Pick<Console, "debug" | "log" | "info" | "warn" | "error"> = console) {
  const levels = [
    ["debug", SeverityNumber.DEBUG, "DEBUG"],
    ["log", SeverityNumber.INFO, "INFO"],
    ["info", SeverityNumber.INFO, "INFO"],
    ["warn", SeverityNumber.WARN, "WARN"],
    ["error", SeverityNumber.ERROR, "ERROR"],
  ] as const;
  for (const [method, severityNumber, severityText] of levels) {
    const original = target[method].bind(target);
    target[method] = (...args: unknown[]) => {
      original(...args);
      const error = args.find((a): a is Error => a instanceof Error);
      logger.emit({
        severityNumber,
        severityText,
        body: format(...args),
        context: context.active(),
        attributes: error ? { "exception.type": error.name, "exception.message": error.message, "exception.stacktrace": error.stack } : undefined,
      });
    };
  }
}
