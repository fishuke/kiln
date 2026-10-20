"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { api } from "@/lib/kiln";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

/** Home composer: "Tell me what you'd like to build in <factory>". */
export async function sendTask(form: FormData) {
  const text = str(form, "text");
  const factory = str(form, "factory");
  if (!text || !factory) return;
  const [title, ...rest] = text.split("\n");
  const wi = await api.send({ factory, title: title!.slice(0, 200), body: rest.join("\n").trim(), projectId: str(form, "projectId") || undefined });
  revalidatePath("/", "layout");
  redirect(`/runs/${wi.id}`);
}

export async function decideGate(form: FormData) {
  const id = str(form, "gateId");
  const decision = str(form, "decision") as "approve" | "reject" | "answer";
  await api.decide(id, decision, str(form, "answer") || undefined, "web");
  revalidatePath("/", "layout");
  const back = str(form, "back");
  if (back) redirect(back);
}

export async function messageForeman(form: FormData) {
  const id = str(form, "workItemId");
  const text = str(form, "text");
  if (text) await api.message(id, text);
  revalidatePath(`/runs/${id}`);
}

export async function steerRun(form: FormData) {
  const text = str(form, "text");
  if (text) await api.steer(str(form, "runId"), text);
  revalidatePath(`/agent-runs/${str(form, "runId")}`);
}

export async function runAction(form: FormData) {
  const id = str(form, "runId");
  const action = str(form, "action");
  if (action === "replay") {
    const r = await api.replay(id);
    redirect(`/agent-runs/${r.id}`);
  }
  if (action === "cancel") await api.cancelRun(id);
  if (action === "pause") await api.pauseRun(id);
  revalidatePath(`/agent-runs/${id}`);
}

export async function cancelWorkItem(form: FormData) {
  await api.cancel(str(form, "workItemId"));
  revalidatePath("/", "layout");
}

export async function confirmComplete(form: FormData) {
  await api.complete(str(form, "workItemId"));
  revalidatePath("/", "layout");
}

export async function createProject(form: FormData) {
  const factories = form.getAll("factories").map(String);
  const p = await api.createProject({ name: str(form, "name"), factories });
  redirect(`/projects/${p.id}`);
}

export async function planProject(form: FormData) {
  const id = str(form, "projectId");
  await api.plan(id, { goal: str(form, "goal"), prd: str(form, "prd") || undefined });
  revalidatePath(`/projects/${id}`);
}

export async function proposal(form: FormData) {
  const id = str(form, "proposalId");
  if (str(form, "action") === "approve") await api.approveProposal(id);
  else await api.rejectProposal(id, str(form, "reason") || undefined);
  revalidatePath("/", "layout");
}

export async function runSelfImprovement(form: FormData) {
  await api.runSelfImprovement(str(form, "factory"));
  revalidatePath(`/f/${str(form, "factory")}/self-improvement`);
}

export async function runBenchmark(form: FormData) {
  await api.runBenchmark(str(form, "factory"), str(form, "suite"));
  revalidatePath(`/f/${str(form, "factory")}/benchmarks`);
}

export async function proposeRouter(form: FormData) {
  await api.proposeRouter(str(form, "factory"), str(form, "suite"));
  revalidatePath(`/f/${str(form, "factory")}/benchmarks`);
}

export async function canary(form: FormData) {
  await api.canary(str(form, "factory"), str(form, "action") as "promote" | "rollback");
  revalidatePath(`/f/${str(form, "factory")}`, "layout");
}

export async function syncFactory(form: FormData) {
  await api.sync(str(form, "factory"));
  revalidatePath(`/f/${str(form, "factory")}`, "layout");
}

export async function connectRepo(form: FormData) {
  const [owner, name] = str(form, "repo").split("/");
  const r = await api.connect({ owner: owner!, name: name!, dir: str(form, "dir") || undefined, ref: str(form, "ref") || undefined });
  revalidatePath("/", "layout");
  if (r.ok) redirect(`/f/${r.factory}`);
}

export async function memory(form: FormData) {
  const id = str(form, "memoryId");
  if (str(form, "action") === "accept") await api.acceptMemory(id);
  else if (str(form, "action") === "reject") await api.rejectMemory(id);
  else await api.proposeMemory(str(form, "factory"), { title: str(form, "title"), body: str(form, "body") });
  revalidatePath("/", "layout");
}

export async function publishSkill(form: FormData) {
  await api.publishSkill(str(form, "factory"), str(form, "name"));
  revalidatePath("/skills");
}

export async function installSkill(form: FormData) {
  await api.installSkill(str(form, "listingId"), str(form, "factory"));
  revalidatePath("/skills");
}

export async function setSecret(form: FormData) {
  await api.setSecret(str(form, "name"), str(form, "value"));
  revalidatePath("/secrets");
}

export async function issueToken(form: FormData): Promise<void> {
  const grants = str(form, "grants")
    .split(",")
    .map((g) => g.trim())
    .filter(Boolean)
    .map((g) => {
      const parts = g.split(":");
      const factory = parts.pop()!;
      return { scope: parts.join(":"), factory };
    });
  const r = await api.issueToken({ name: str(form, "name"), subject: str(form, "subject"), grants });
  revalidatePath("/users");
  redirect(`/users?token=${encodeURIComponent(r.token)}`);
}
