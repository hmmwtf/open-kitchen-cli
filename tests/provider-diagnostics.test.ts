import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentAdapter } from "../src/agents/adapter.js";
import {
  ProviderDiagnosticsLedger,
  ProviderDiagnosticsService,
  renderProviderDiagnosticsMarkdown
} from "../src/agents/diagnostics.js";

describe("Provider diagnostics", () => {
  it("passes mock diagnostics without a smoke test", async () => {
    const result = await new ProviderDiagnosticsService().check({ adapterName: "mock" });

    expect(result.status).toBe("passed");
    expect(result.checks.find((item) => item.category === "installation")?.status).toBe("passed");
    expect(result.checks.find((item) => item.category === "smoke")?.status).toBe("skipped");
  });

  it("fails Ollama diagnostics when the required model is missing", async () => {
    const result = await new ProviderDiagnosticsService({ env: {} }).check({ adapterName: "ollama" });

    expect(result.status).toBe("failed");
    expect(result.checks.find((item) => item.category === "model")?.message).toContain("OPEN_KITCHEN_OLLAMA_MODEL");
  });

  it("warns for CLI auth and missing model when smoke is not requested", async () => {
    const result = await new ProviderDiagnosticsService({
      env: { OPEN_KITCHEN_CODEX_BIN: "codex-test" },
      commandExists: async () => true
    }).check({ adapterName: "codex-cli" });

    expect(result.status).toBe("warning");
    expect(result.checks.find((item) => item.category === "installation")?.status).toBe("passed");
    expect(result.checks.find((item) => item.category === "auth")?.status).toBe("warning");
    expect(result.checks.find((item) => item.category === "model")?.status).toBe("warning");
  });

  it("runs explicit smoke checks through an injectable adapter", async () => {
    const adapter: AgentAdapter = {
      metadata: {
        name: "codex-cli",
        displayName: "Codex CLI Adapter",
        kind: "cli",
        provider: "openai",
        isMock: false,
        supportsParallel: false,
        supportsStreaming: true,
        requiresCredentials: true,
        capabilities: {
          executionSurface: "subprocess",
          supportsParallelTasks: false,
          supportsStreaming: true,
          supportsWorkspaceMutation: true,
          readOnlyEnforcement: "native",
          credentialSource: "cli-auth",
          modelSource: "environment",
          maxConcurrency: 1
        }
      },
      execute: async () => ({
        taskId: "provider-smoke",
        agentRole: "context_scout",
        status: "completed",
        artifactName: "agent-output-provider-smoke.md",
        output: "provider ok",
        provider: {
          adapterName: "codex-cli",
          provider: "openai",
          surface: "subprocess",
          durationMs: 1
        }
      })
    };

    const result = await new ProviderDiagnosticsService({
      env: { OPEN_KITCHEN_CODEX_BIN: "codex-test", OPEN_KITCHEN_CODEX_MODEL: "gpt-test" },
      commandExists: async () => true,
      createAdapter: () => adapter
    }).check({ adapterName: "codex-cli", smoke: true });

    expect(result.checks.find((item) => item.category === "auth")?.status).toBe("skipped");
    expect(result.checks.find((item) => item.category === "smoke")?.status).toBe("passed");
    expect(result.status).toBe("passed");
  });

  it("uses the same resolved executable for installation diagnostics and smoke invocation", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "open-kitchen-diagnostics-bin-"));
    const binPath = path.join(root, process.platform === "win32" ? "codex.cmd" : "codex");
    if (process.platform === "win32") {
      await writeFile(path.join(root, "codex"), "extensionless codex", "utf8");
    }
    await writeFile(binPath, process.platform === "win32" ? "@ECHO off\r\n" : "#!/bin/sh\n", "utf8");
    if (process.platform !== "win32") {
      await chmod(binPath, 0o755);
    }
    let smokeEnv: NodeJS.ProcessEnv | undefined;
    const adapter: AgentAdapter = {
      metadata: {
        name: "codex-cli",
        displayName: "Codex CLI Adapter",
        kind: "cli",
        provider: "openai",
        isMock: false,
        supportsParallel: false,
        supportsStreaming: true,
        requiresCredentials: true,
        capabilities: {
          executionSurface: "subprocess",
          supportsParallelTasks: false,
          supportsStreaming: true,
          supportsWorkspaceMutation: true,
          readOnlyEnforcement: "native",
          credentialSource: "cli-auth",
          modelSource: "environment",
          maxConcurrency: 1
        }
      },
      execute: async () => ({
        taskId: "provider-smoke",
        agentRole: "context_scout",
        status: "completed",
        artifactName: "agent-output-provider-smoke.md",
        output: "provider ok"
      })
    };

    const result = await new ProviderDiagnosticsService({
      env: {
        PATH: `${root}${path.delimiter}${process.env.PATH ?? ""}`,
        PATHEXT: ".CMD;.EXE;.BAT",
        OPEN_KITCHEN_CODEX_MODEL: "gpt-test"
      },
      createAdapter: (_name, env) => {
        smokeEnv = env;
        return adapter;
      }
    }).check({ adapterName: "codex-cli", smoke: true });

    const installation = result.checks.find((item) => item.category === "installation");
    expect(installation?.status).toBe("passed");
    expect(installation?.details?.resolvedCommand).toBe(binPath);
    expect(smokeEnv?.OPEN_KITCHEN_CODEX_BIN).toBe(binPath);
  });

  it("records smoke failure classification details from the provider result", async () => {
    const adapter: AgentAdapter = {
      metadata: {
        name: "codex-cli",
        displayName: "Codex CLI Adapter",
        kind: "cli",
        provider: "openai",
        isMock: false,
        supportsParallel: false,
        supportsStreaming: true,
        requiresCredentials: true,
        capabilities: {
          executionSurface: "subprocess",
          supportsParallelTasks: false,
          supportsStreaming: true,
          supportsWorkspaceMutation: true,
          readOnlyEnforcement: "native",
          credentialSource: "cli-auth",
          modelSource: "environment",
          maxConcurrency: 1
        }
      },
      execute: async () => ({
        taskId: "provider-smoke",
        agentRole: "context_scout",
        status: "failed",
        artifactName: "agent-output-provider-smoke.md",
        output: "Codex CLI authentication appears invalid or missing.",
        provider: {
          adapterName: "codex-cli",
          provider: "openai",
          surface: "subprocess",
          durationMs: 1,
          failureReason: "login required",
          failureCategory: "auth_failure",
          failureSummary: "Codex CLI authentication appears invalid or missing."
        }
      })
    };

    const result = await new ProviderDiagnosticsService({
      env: { OPEN_KITCHEN_CODEX_BIN: "codex-test", OPEN_KITCHEN_CODEX_MODEL: "gpt-test" },
      commandExists: async () => true,
      createAdapter: () => adapter
    }).check({ adapterName: "codex-cli", smoke: true });

    const smoke = result.checks.find((item) => item.category === "smoke");
    expect(smoke?.status).toBe("failed");
    expect(JSON.stringify(smoke?.details)).toContain("auth_failure");
  });

  it("records Windows npm shim diagnostics when the configured command is a shim", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "open-kitchen-provider-shim-"));
    const shimPath = path.join(root, "codex.cmd");
    await writeFile(
      shimPath,
      '@ECHO off\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n',
      "utf8"
    );

    const result = await new ProviderDiagnosticsService({
      env: { OPEN_KITCHEN_CODEX_BIN: shimPath, OPEN_KITCHEN_CODEX_MODEL: "gpt-test" },
      commandExists: async () => true
    }).check({ adapterName: "codex-cli" });

    const shim = result.checks.find((item) => item.category === "windows_shim");
    if (process.platform === "win32") {
      expect(shim?.status).toBe("passed");
      expect(String(shim?.details?.scriptPath)).toContain("node_modules");
    } else {
      expect(shim?.status).toBe("skipped");
    }
  });

  it("writes provider diagnostics ledger records", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "open-kitchen-provider-checks-"));
    const result = await new ProviderDiagnosticsService().check({ adapterName: "mock" });
    const ledgerPath = await new ProviderDiagnosticsLedger(root).write(result);

    const json = await readFile(path.join(ledgerPath, "check.json"), "utf8");
    const markdown = await readFile(path.join(ledgerPath, "result.md"), "utf8");
    const events = await readFile(path.join(ledgerPath, "events.jsonl"), "utf8");

    expect(JSON.parse(json).checkId).toBe(result.checkId);
    expect(markdown).toBe(renderProviderDiagnosticsMarkdown(result));
    expect(events).toContain("provider_check.started");
    expect(events).toContain("provider_check.completed");
  });
});
