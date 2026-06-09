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
  stdioForRequest,
  timeoutOutputDiagnostics
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
    expect(result.timeoutOverrunMs).toBeGreaterThanOrEqual(0);
    expect(result.stdoutLengthAtTimeout).toBeDefined();
    expect(result.stderrLengthAtClose).toBeDefined();
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
        return { status: 0, signal: null, output: [], pid: 1, stdout: Buffer.from("SUCCESS"), stderr: Buffer.from("") };
      }
    );

    expect(calls).toEqual([{ command: "taskkill", args: ["/PID", "1234", "/T", "/F"] }]);
    expect(fallbackCalled).toBe(false);
    expect(result).toMatchObject({
      processTreeKillAttempted: true,
      processTreeKillSucceeded: true,
      timedOutPid: 1234,
      killMethod: "taskkill",
      killSucceeded: true,
      taskkillAttempted: true,
      taskkillExitCode: 0,
      taskkillStdoutPreview: "SUCCESS",
      fallbackKillAttempted: false
    });
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
      () => ({ status: 1, signal: null, output: [], pid: 1, stdout: Buffer.from(""), stderr: Buffer.from("ERROR: Access is denied.") })
    );

    expect(fallbackCalled).toBe(true);
    expect(result.processTreeKillAttempted).toBe(true);
    expect(result.processTreeKillSucceeded).toBe(false);
    expect(result.killMethod).toBe("child.kill");
    expect(result.killSucceeded).toBe(true);
    expect(result.taskkillExitCode).toBe(1);
    expect(result.taskkillStderrPreview).toContain("Access is denied");
    expect(result.fallbackKillAttempted).toBe(true);
    expect(result.fallbackKillSucceeded).toBe(true);
    expect(result.killFailureSummary).toContain("Fallback child.kill succeeded");
  });

  it("records taskkill spawn errors and fallback kill failures", () => {
    const result = killTimedOutProcess(
      1234,
      () => {
        throw new Error("fallback failed");
      },
      "win32",
      () => ({
        status: null,
        signal: null,
        output: [],
        pid: 1,
        stdout: Buffer.from(""),
        stderr: Buffer.from(""),
        error: new Error("spawn taskkill ENOENT")
      })
    );

    expect(result.taskkillError).toBe("spawn taskkill ENOENT");
    expect(result.fallbackKillAttempted).toBe(true);
    expect(result.fallbackKillSucceeded).toBe(false);
    expect(result.fallbackKillError).toBe("fallback failed");
    expect(result.killSucceeded).toBe(false);
    expect(result.killFailureSummary).toContain("spawn taskkill ENOENT");
  });

  it("computes whether output grew after timeout", () => {
    expect(
      timeoutOutputDiagnostics({
        stdoutLengthAtTimeout: 5,
        stderrLengthAtTimeout: 1,
        stdoutLengthAtClose: 9,
        stderrLengthAtClose: 1
      }).outputGrewAfterTimeout
    ).toBe(true);
  });

  it("does not include timeout kill diagnostics for non-timeout runs", async () => {
    const result = await nodeProcessRunner({
      command: process.execPath,
      args: ["-e", "console.log('ok')"],
      timeoutMs: 1000
    });

    expect(result.timedOut).toBe(false);
    expect(result.killMethod).toBeUndefined();
    expect(result.timeoutOverrunMs).toBeUndefined();
    expect(result.stdoutLengthAtTimeout).toBeUndefined();
  });
});

function requestFor(command: string, args: string[]): ProcessRunRequest {
  return {
    command,
    args,
    timeoutMs: 1000
  };
}
