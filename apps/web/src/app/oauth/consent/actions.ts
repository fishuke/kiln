"use server";

import { redirect } from "next/navigation";
import { api, errorMessage } from "@/lib/kiln";

/** The person's answer; the API checks the request again and returns where to send the browser. */
export async function answer(params: Record<string, string>, approve: boolean): Promise<{ error: string } | never> {
  let target: string;
  try {
    target = (await api.request<{ redirect: string }>("POST", approve ? "/api/v1/oauth/approve" : "/api/v1/oauth/deny", params)).redirect;
  } catch (err) {
    return { error: errorMessage(err) };
  }
  redirect(target);
}
