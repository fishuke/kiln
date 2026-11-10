import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FAKE_SHELL } from "@kiln/sandbox/testing";
import { describe, expect, it } from "vitest";
import { isolatePinCommand } from "./pin-isolation";

const sh = (cmd: string, cwd: string) => execSync(cmd, { cwd, encoding: "utf8", shell: FAKE_SHELL[0] }).trim();

describe("isolatePinCommand", () => {
  it("leaves only the pin and its ancestors in the clone", () => {
    const origin = mkdtempSync(join(tmpdir(), "kiln-pin-origin-"));
    sh("git init -q -b main && git config user.email t@t && git config user.name t", origin);
    writeFileSync(join(origin, "a.txt"), "before");
    sh("git add . && git commit -q -m 'before the fix'", origin);
    const pin = sh("git rev-parse HEAD", origin);
    writeFileSync(join(origin, "a.txt"), "the real fix");
    sh("git commit -qam 'FNLF-1: the real fix' && git tag v1.0.1 && git branch hotfix/FNLF-1", origin);
    const future = sh("git rev-parse HEAD", origin);

    const work = mkdtempSync(join(tmpdir(), "kiln-pin-work-"));
    sh(`git clone -q ${origin} repo`, work);
    const repo = join(work, "repo");
    sh(`git checkout -q -B kiln/replay ${pin}`, repo);
    sh(isolatePinCommand("kiln/replay"), repo);

    expect(sh("git log --all --format=%H", repo)).toBe(pin);
    expect(sh("git for-each-ref --format='%(refname)'", repo)).toBe("refs/heads/kiln/replay");
    expect(sh("git remote", repo)).toBe("");
    expect(() => sh(`git cat-file -e ${future}`, repo)).toThrow();
  });
});
