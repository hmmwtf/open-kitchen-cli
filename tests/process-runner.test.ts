import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  commandLineForCmd,
  isWindowsCommandShim,
  killTimedOutProcess,
  nodeProcessRunner,
  quoteForCmd,
  resolveNpmShimScriptPath,
  resolveSpawnRequest,
  stdioForRequest
} from "../src/agents/process-runner.js";
import type { ProcessRunRequest } from "../src/agents/process-runner.js";

describe("Process runner spawn request resolution", () => {
  it("falls back to cmd.exe for non-npm Windows .cmd shims while preserving provider args", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "open-kitchen-process-runner-cmd-"));
    const command = path.join(root, "codex.cmd");
    await writeFile(command, "@ECHO off\r\necho codex\r\n", "utf8");
    const request = requestFor(command, ["exec", "--json", "prompt"]);
    const resolved = resolveSpawnRequest(request);

    if (process.platform === "win32") {
      expect(resolved.command).toBe(process.env.ComSpec ?? "cmd.exe");
      expect(resolved.args).toEqual([
        "/d",
        "/s",
        "/c",
        `${quoteForCmd(command)} "exec" "--json" "prompt"`
      ]);
      expect(resolved.windowsVerbatimArguments).toBe(true);
    } else {
      expect(resolved).toEqual({
        command,
        args: ["exec", "--json", "prompt"]
      });
    }
  });

  it("runs npm Windows .cmd shims through node.exe when a shim script path is present", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "open-kitchen-process-runner-npm-"));
    const command = path.join(root, "codex.cmd");
    await writeFile(
      command,
      '@ECHO off\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n',
      "utf8"
    );
    const request = requestFor(command, ["exec", "--json", "prompt"]);
    const resolved = resolveSpawnRequest(request);

    if (process.platform === "win32") {
      expect(resolved.command).toBe(process.execPath);
      expect(resolved.args).toEqual([
        path.join(root, "node_modules\\@openai\\codex\\bin\\codex.js"),
        "exec",
        "--json",
        "prompt"
      ]);
    } else {
      expect(resolved).toEqual({
        command,
        args: ["exec", "--json", "prompt"]
      });
    }
  });

  it("wraps Windows .bat shims with cmd.exe", () => {
    const request = requestFor("C:\\tools\\claude.bat", ["-p", "prompt"]);
    const resolved = resolveSpawnRequest(request);

    if (process.platform === "win32") {
      expect(resolved.command).toBe(process.env.ComSpec ?? "cmd.exe");
      expect(resolved.args).toEqual(["/d", "/s", "/c", "\"C:\\tools\\claude.bat\" \"-p\" \"prompt\""]);
      expect(resolved.windowsVerbatimArguments).toBe(true);
    } else {
      expect(resolved).toEqual({
        command: "C:\\tools\\claude.bat",
        args: ["-p", "prompt"]
      });
    }
  });

  it("leaves normal executable commands unchanged", () => {
    const request = requestFor("codex", ["exec", "--json", "prompt"]);
    const resolved = resolveSpawnRequest(request);

    expect(resolved).toEqual({
      command: "codex",
      args: ["exec", "--json", "prompt"]
    });
  });

  it("leaves non-Windows-style executable paths unchanged", () => {
    const request = requestFor("/usr/local/bin/codex", ["exec"]);
    const resolved = resolveSpawnRequest(request);

    expect(resolved).toEqual({
      command: "/usr/local/bin/codex",
      args: ["exec"]
    });
  });

  it("quotes command shim paths for cmd.exe", () => {
    expect(quoteForCmd("C:\\Program Files\\OpenKitchen\\codex.cmd")).toBe("\"C:\\Program Files\\OpenKitchen\\codex.cmd\"");
  });

  it("builds cmd.exe command lines from argv boundaries", () => {
    expect(commandLineForCmd("C:\\tools\\codex.cmd", ["exec", "--sandbox", "read-only", "hello world"])).toBe(
      "\"C:\\tools\\codex.cmd\" \"exec\" \"--sandbox\" \"read-only\" \"hello world\""
    );
  });

  it("resolves npm command shim script paths without changing public bin config", () => {
    const content = [
      "@ECHO off",
      "endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & \"%_prog%\"  \"%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js\" %*"
    ].join("\n");

    expect(resolveNpmShimScriptPath("C:\\Users\\asus\\AppData\\Roaming\\npm\\codex.cmd", content)).toBe(
      "C:\\Users\\asus\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\bin\\codex.js"
    );
  });

  it("detects Windows command shims only on Windows", () => {
    expect(isWindowsCommandShim("C:\\tools\\codex.cmd")).toBe(process.platform === "win32");
  });

  it("ignores stdin when no process input is provided", () => {
    expect(stdioForRequest({})).toEqual(["ignore", "pipe", "pipe"]);
  });

  it("uses piped stdin when process input is provided", () => {
    expect(stdioForRequest({ input: "hello" })).toEqual(["pipe", "pipe", "pipe"]);
  });

  it("records timeout observability when a process is killed", async () => {
    const result = await nodeProcessRunner({
      command: process.execPath,
      args: ["-e", "setTimeout(() => {}, 1000)"],
      timeoutMs: 20
    });

    expect(result.timedOut).toBe(true);
    expect(result.timeoutTriggeredAfterMs).toBeGreaterThanOrEqual(0);
    expect(result.closedAfterMs).toBeGreaterThanOrEqual(result.timeoutTriggeredAfterMs ?? 0);
    expect(result.closeDelayAfterTimeoutMs).toBeGreaterThanOrEqual(0);
  });

  it("uses taskkill for Windows process tree timeouts and does not call fallback when it succeeds", () => {
    let fallbackCalled = false;
    const calls: Array<{ command: string; args: string[] }> = [];
    const result = killTimedOutProcess(
      1234,
      () => {
        fallbackCalled = true;
        return true;
      },
      "win32",
      (command, args) => {
        calls.push({ command, args });
        return { status: 0, signal: null, output: [], pid: 1, stdout: Buffer.from(""), stderr: Buffer.from("") };
      }
    );

    expect(calls).toEqual([{ command: "taskkill", args: ["/PID", "1234", "/T", "/F"] }]);
    expect(fallbackCalled).toBe(false);
    expect(result).toEqual({ processTreeKillAttempted: true, processTreeKillSucceeded: true, processKillError: undefined });
  });

  it("falls back to child.kill when Windows taskkill fails", () => {
    let fallbackCalled = false;
    const result = killTimedOutProcess(
      1234,
      () => {
        fallbackCalled = true;
        return true;
      },
      "win32",
      () => ({ status: 1, signal: null, output: [], pid: 1, stdout: Buffer.from(""), stderr: Buffer.from("") })
    );

    expect(fallbackCalled).toBe(true);
    expect(result.processTreeKillAttempted).toBe(true);
    expect(result.processTreeKillSucceeded).toBe(false);
  });
});

function requestFor(command: string, args: string[]): ProcessRunRequest {
  return {
    command,
    args,
    timeoutMs: 1000
  };
}
