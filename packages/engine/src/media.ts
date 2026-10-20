import type { Artifact } from "./types";

const MEDIA: Record<string, [Artifact["kind"], string]> = {
  png: ["image", "image/png"],
  jpg: ["image", "image/jpeg"],
  jpeg: ["image", "image/jpeg"],
  gif: ["image", "image/gif"],
  webp: ["image", "image/webp"],
  svg: ["image", "image/svg+xml"],
  webm: ["video", "video/webm"],
  mp4: ["video", "video/mp4"],
  mov: ["video", "video/quicktime"],
  pdf: ["file", "application/pdf"],
  json: ["report", "application/json"],
  html: ["report", "text/html"],
  md: ["report", "text/markdown"],
  txt: ["file", "text/plain"],
  csv: ["file", "text/csv"],
  log: ["file", "text/plain"],
  zip: ["file", "application/zip"],
};

export function mediaOf(name: string): { kind: Artifact["kind"]; contentType: string } {
  const [kind, contentType] = MEDIA[name.split(".").pop()?.toLowerCase() ?? ""] ?? ["file", "application/octet-stream"];
  return { kind, contentType };
}

/** Where people open a stored object: the web app proxies /files/<key> to the API. */
export const fileUrl = (key: string) => `/files/${key.split("/").map(encodeURIComponent).join("/")}`;
