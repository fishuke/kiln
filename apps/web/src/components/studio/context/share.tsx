"use client";

import { Trash2, UserPlus, Users } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { FunctionalRole, type Member } from "@/lib/studio/types";
import { ROLE_LABEL } from "./fragment-meta";
import { memberColor, PERMISSION_LABEL } from "./people";

const select = "h-7 rounded-md border bg-background px-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-60";

export type MemberInput = { user: string; name?: string; permission: "editor" | "viewer"; role: FunctionalRole };

/**
 * Share: who is in this Context, what each may do (editor or viewer) and their role (what they
 * review). Only the owner adds people and changes what they may do; everyone picks their own role.
 */
export function Share({ members, me, onSet, onRemove, onRole }: { members: Member[]; me: Member; onSet(input: MemberInput): Promise<boolean>; onRemove(user: string): void; onRole(role: FunctionalRole): void }) {
  const owner = me.permission === "owner";
  const [email, setEmail] = useState("");
  const [permission, setPermission] = useState<"editor" | "viewer">("viewer");
  const [role, setRole] = useState<FunctionalRole>("product");
  const add = async () => {
    if (!email.trim()) return;
    if (await onSet({ user: email.trim(), permission, role })) setEmail("");
  };
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger render={<PopoverTrigger render={<Button size="sm" variant="ghost" className="gap-1.5" />} />}>
          <Users />
          <span className="hidden xl:inline">Share</span>
        </TooltipTrigger>
        <TooltipContent>Who is in this Context, and what each may do</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-[26rem] gap-0 p-0">
        <div className="border-b px-3 py-2 text-sm font-medium">People in this Context</div>
        <ul className="flex max-h-72 flex-col overflow-y-auto p-1.5">
          {members.map((m) => {
            const mine = m.user === me.user;
            return (
              <li key={m.user} className="flex items-center gap-2 rounded-lg px-1.5 py-1.5">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white uppercase" style={{ backgroundColor: memberColor(m.user) }}>
                  {m.name.slice(0, 1)}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium">
                    {m.name}
                    {mine && <span className="font-normal text-muted-foreground"> (you)</span>}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">{m.user}</span>
                </span>
                <select
                  aria-label={`${m.name}'s role`}
                  className={select}
                  value={m.role}
                  disabled={!mine && !(owner && m.permission !== "owner")}
                  onChange={(e) => {
                    const r = e.target.value as FunctionalRole;
                    if (mine) onRole(r);
                    else if (m.permission !== "owner") void onSet({ user: m.user, name: m.name, permission: m.permission, role: r });
                  }}
                >
                  {FunctionalRole.options.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABEL[r]}
                    </option>
                  ))}
                </select>
                {m.permission === "owner" ? (
                  <span className="w-[4.5rem] text-center text-xs text-muted-foreground">Owner</span>
                ) : (
                  <select
                    aria-label={`What ${m.name} may do`}
                    className={`${select} w-[4.5rem]`}
                    value={m.permission}
                    disabled={!owner}
                    onChange={(e) => void onSet({ user: m.user, name: m.name, permission: e.target.value as "editor" | "viewer", role: m.role })}
                  >
                    <option value="editor">{PERMISSION_LABEL.editor}</option>
                    <option value="viewer">{PERMISSION_LABEL.viewer}</option>
                  </select>
                )}
                {owner && m.permission !== "owner" ? (
                  <Button size="icon-xs" variant="ghost" aria-label={`Remove ${m.name}`} onClick={() => onRemove(m.user)}>
                    <Trash2 />
                  </Button>
                ) : (
                  <span className="size-6 shrink-0" />
                )}
              </li>
            );
          })}
        </ul>
        {owner ? (
          <form
            className="flex items-center gap-1.5 border-t p-2"
            onSubmit={(e) => {
              e.preventDefault();
              void add();
            }}
          >
            <input type="email" aria-label="Email of the person to add" placeholder="name@company.com" value={email} onChange={(e) => setEmail(e.target.value)} className="ctx-input h-8 min-w-0 flex-1" />
            <select aria-label="Role" className={`${select} h-8`} value={role} onChange={(e) => setRole(e.target.value as FunctionalRole)}>
              {FunctionalRole.options.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
            <select aria-label="What they may do" className={`${select} h-8`} value={permission} onChange={(e) => setPermission(e.target.value as "editor" | "viewer")}>
              <option value="viewer">Viewer</option>
              <option value="editor">Editor</option>
            </select>
            <Button type="submit" size="sm" disabled={!email.trim()}>
              <UserPlus data-icon="inline-start" />
              Add
            </Button>
          </form>
        ) : (
          <p className="border-t px-3 py-2 text-xs text-muted-foreground">Only the owner adds people and changes what they may do. Your role is yours to pick.</p>
        )}
        <p className="border-t px-3 py-2 text-xs text-muted-foreground">Editors change the Context. A viewer&apos;s edits, answers and requests become proposals an editor decides. The role is what a person reviews; it never changes what they may do.</p>
      </PopoverContent>
    </Popover>
  );
}
