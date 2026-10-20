import { createHmac } from "node:crypto";
import { hmacHex, safeEqual } from "./http";


const FIVE_MINUTES = 300;

export function verifyGitHub(secret: string, body: string, signature: string | undefined): boolean {
  if (!signature) return false;
  return safeEqual(`sha256=${hmacHex("sha256", secret, body)}`, signature);
}

export function verifySlack(signingSecret: string, body: string, timestamp: string | undefined, signature: string | undefined, now = Date.now()): boolean {
  if (!timestamp || !signature) return false;
  if (Math.abs(now / 1000 - Number(timestamp)) > FIVE_MINUTES) return false;
  return safeEqual(`v0=${createHmac("sha256", signingSecret).update(`v0:${timestamp}:${body}`).digest("hex")}`, signature);
}

export function verifyLinear(secret: string, body: string, signature: string | undefined): boolean {
  if (!signature) return false;
  return safeEqual(hmacHex("sha256", secret, body), signature);
}

/** https://www.standardwebhooks.com — "v1,<base64 hmac>" over "<id>.<timestamp>.<body>"; older than 5 minutes is rejected. */
export function verifyStandardWebhook(secret: string, id: string | undefined, timestamp: string | undefined, body: string, signature: string | undefined, now = Date.now()): boolean {
  if (!id || !timestamp || !signature) return false;
  if (Math.abs(now / 1000 - Number(timestamp)) > FIVE_MINUTES) return false;
  const key = Buffer.from(secret.startsWith("whsec_") ? secret.slice(6) : secret, "base64");
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64");
  return signature.split(" ").some((s) => safeEqual(s.replace(/^v1,/, ""), expected));
}

/** Stripe: "t=<ts>,v1=<hex hmac of '<ts>.<body>'>"; older than 5 minutes is rejected. */
export function verifyStripe(secret: string, body: string, header: string | undefined, now = Date.now()): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]));
  const t = parts.t;
  if (!t || Math.abs(now / 1000 - Number(t)) > FIVE_MINUTES) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  return header.split(",").some((p) => p.startsWith("v1=") && safeEqual(p.slice(3), expected));
}

/** Sentry: hex HMAC-SHA256 of the body in the sentry-hook-signature header. */
export function verifySentry(secret: string, body: string, signature: string | undefined): boolean {
  if (!signature) return false;
  return safeEqual(hmacHex("sha256", secret, body), signature);
}

/** PagerDuty v3: "v1=<hex hmac sha256>", possibly several comma-separated during secret rotation. */
export function verifyPagerDuty(secret: string, body: string, header: string | undefined): boolean {
  if (!header) return false;
  const expected = `v1=${hmacHex("sha256", secret, body)}`;
  return header.split(",").some((s) => safeEqual(s.trim(), expected));
}

/** Vercel: hex HMAC-SHA1 of the body in x-vercel-signature. */
export function verifyVercel(secret: string, body: string, signature: string | undefined): boolean {
  if (!signature) return false;
  return safeEqual(hmacHex("sha1", secret, body), signature);
}

export type SignatureSchemeName = "github" | "pagerduty" | "sentry" | "standard_webhooks" | "stripe" | "vercel";

/** Header lookup that is case-insensitive. */
export type HeaderGetter = (name: string) => string | undefined;

export function verifySignature(scheme: SignatureSchemeName, secret: string, body: string, header: HeaderGetter, now = Date.now()): boolean {
  switch (scheme) {
    case "github":
      return verifyGitHub(secret, body, header("x-hub-signature-256"));
    case "stripe":
      return verifyStripe(secret, body, header("stripe-signature"), now);
    case "sentry":
      return verifySentry(secret, body, header("sentry-hook-signature"));
    case "pagerduty":
      return verifyPagerDuty(secret, body, header("x-pagerduty-signature"));
    case "vercel":
      return verifyVercel(secret, body, header("x-vercel-signature"));
    case "standard_webhooks":
      // Svix-compatible headers are accepted too.
      return verifyStandardWebhook(secret, header("webhook-id") ?? header("svix-id"), header("webhook-timestamp") ?? header("svix-timestamp"), body, header("webhook-signature") ?? header("svix-signature"), now);
  }
}

/** Each signed provider's own delivery-id header, used for deduplication after a configured header. */
export const PROVIDER_DELIVERY_HEADERS: Record<SignatureSchemeName, string[]> = {
  github: ["x-github-delivery"],
  standard_webhooks: ["webhook-id", "svix-id"],
  sentry: ["request-id", "sentry-hook-resource-id"],
  pagerduty: ["x-webhook-id"],
  vercel: ["x-vercel-id"],
  stripe: [],
};

/** The delivery id header any sender may set. */
export const KILN_DELIVERY_HEADER = "x-kiln-delivery-id";
