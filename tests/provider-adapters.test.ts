import { describe, expect, it } from "vitest";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { validateAgentCapabilities } from "../src/agents/capabilities.js";
import { ClaudeCodeAgentAdapter, CodexCliAgentAdapter, OllamaAgentAdapter } from "../src/agents/provider-adapters.js";
import type { ProcessRunner } from "../src/agents/process-runner.js";
import { getMode } from "../src/modes/registry.js";
import type { AgentProviderEvent } from "../src/agents/adapter.js";
import type { ResolvedPolicy } from "../src/core/types.js";

describe("Provider Adapter v1", () => {
  it("runs Codex CLI through an injectable subprocess runner", async () => {
    const calls: Parameters<ProcessRunner>[0][] = [];
    const events: AgentProviderEvent[] = [];
    const runner: ProcessRunner = async (request) => {
      calls.push(request);
      request.onStdout?.(`${JSON.stringify({ text: "codex output" })}\n`);
      return {
        stdout: "",
        stderr: "",
        exitCode: 0,
        timedOut: false,
        durationMs: 7
      };
    };

    const result = await new CodexCliAgentAdapter(runner, {
      OPEN_KITCHEN_CODEX_BIN: "codex-test",
      OPEN_KITCHEN_CODEX_MODEL: "gpt-test"
    }).execute({
      runId: "run-1",
      task: task(),
      agentRole: "worker",
      mode: getMode("cook"),
      policy: directPolicy(),
      permissionIntent: "workspace_write",
      onProviderEvent: (event) => events.push(event)
    });

    expect(calls[0]?.command).toBe("codex-test");
    expect(calls[0]?.args).toContain("exec");
    expect(calls[0]?.args).toContain("workspace-write");
    expect(calls[0]?.args).toContain("gpt-test");
    expect(result.status).toBe("completed");
    expect(result.output).toBe("codex output");
    expect(result.provider?.adapterName).toBe("codex-cli");
    expect(events.map((event) => event.type)).toContain("provider.stream.chunk");
    expect(events.map((event) => event.type)).toContain("provider.invocation.completed");
  });

  it("adds Codex ephemeral execution only for fast runs", async () => {
    const fastCalls: Parameters<ProcessRunner>[0][] = [];
    const instantCalls: Parameters<ProcessRunner>[0][] = [];
    const normalCalls: Parameters<ProcessRunner>[0][] = [];
    const runnerFor = (calls: Parameters<ProcessRunner>[0][]): ProcessRunner => async (request) => {
      calls.push(request);
      return {
        stdout: `${JSON.stringify({ text: "codex output" })}\n`,
        stderr: "",
        exitCode: 0,
        timedOut: false,
        durationMs: 7
      };
    };

    await new CodexCliAgentAdapter(runnerFor(fastCalls), { OPEN_KITCHEN_CODEX_BIN: "codex-test" }).execute({
      runId: "run-fast",
      task: task(),
      agentRole: "worker",
      permissionIntent: "read_only",
      fast: true
    });
    await new CodexCliAgentAdapter(runnerFor(instantCalls), { OPEN_KITCHEN_CODEX_BIN: "codex-test" }).execute({
      runId: "run-instant",
      task: task(),
      agentRole: "worker",
      permissionIntent: "read_only",
      instant: true
    });
    await new CodexCliAgentAdapter(runnerFor(normalCalls), { OPEN_KITCHEN_CODEX_BIN: "codex-test" }).execute({
      runId: "run-normal",
      task: task(),
      agentRole: "worker",
      permissionIntent: "read_only"
    });

    expect(fastCalls[0]?.args).toContain("--ephemeral");
    expect(instantCalls[0]?.args).toContain("--ephemeral");
    expect(normalCalls[0]?.args).not.toContain("--ephemeral");
  });

  it("adds fast provider prompt guidance only for fast runs", async () => {
    const fastCalls: Parameters<ProcessRunner>[0][] = [];
    const normalCalls: Parameters<ProcessRunner>[0][] = [];
    const runnerFor = (calls: Parameters<ProcessRunner>[0][]): ProcessRunner => async (request) => {
      calls.push(request);
      return {
        stdout: `${JSON.stringify({ text: "codex output" })}\n`,
        stderr: "",
        exitCode: 0,
        timedOut: false,
        durationMs: 7
      };
    };

    await new CodexCliAgentAdapter(runnerFor(fastCalls), { OPEN_KITCHEN_CODEX_BIN: "codex-test" }).execute({
      runId: "run-fast",
      task: task(),
      agentRole: "worker",
      permissionIntent: "read_only",
      fast: true
    });
    await new CodexCliAgentAdapter(runnerFor(normalCalls), { OPEN_KITCHEN_CODEX_BIN: "codex-test" }).execute({
      runId: "run-normal",
      task: task(),
      agentRole: "worker",
      permissionIntent: "read_only"
    });

    expect(fastCalls[0]?.args.at(-1)).toContain("Fast mode: prioritize a concise answer");
    expect(normalCalls[0]?.args.at(-1)).not.toContain("Fast mode:");
  });

  it("adds instant provider prompt guidance only for instant runs", async () => {
    const instantCalls: Parameters<ProcessRunner>[0][] = [];
    const fastInstantCalls: Parameters<ProcessRunner>[0][] = [];
    const normalCalls: Parameters<ProcessRunner>[0][] = [];
    const runnerFor = (calls: Parameters<ProcessRunner>[0][]): ProcessRunner => async (request) => {
      calls.push(request);
      return {
        stdout: `${JSON.stringify({ text: "codex output" })}\n`,
        stderr: "",
        exitCode: 0,
        timedOut: false,
        durationMs: 7
      };
    };

    await new CodexCliAgentAdapter(runnerFor(instantCalls), { OPEN_KITCHEN_CODEX_BIN: "codex-test" }).execute({
      runId: "run-instant",
      task: task(),
      agentRole: "worker",
      permissionIntent: "read_only",
      instant: true
    });
    await new CodexCliAgentAdapter(runnerFor(fastInstantCalls), { OPEN_KITCHEN_CODEX_BIN: "codex-test" }).execute({
      runId: "run-fast-instant",
      task: task(),
      agentRole: "worker",
      permissionIntent: "read_only",
      fast: true,
      instant: true
    });
    await new CodexCliAgentAdapter(runnerFor(normalCalls), { OPEN_KITCHEN_CODEX_BIN: "codex-test" }).execute({
      runId: "run-normal",
      task: task(),
      agentRole: "worker",
      permissionIntent: "read_only"
    });

    expect(instantCalls[0]?.args.at(-1)).toContain("Instant mode: answer using only the provided OpenKitchen context");
    expect(instantCalls[0]?.args.at(-1)).not.toContain("Fast mode:");
    expect(fastInstantCalls[0]?.args.at(-1)).toContain("Instant mode:");
    expect(fastInstantCalls[0]?.args.at(-1)).not.toContain("Fast mode:");
    expect(normalCalls[0]?.args.at(-1)).not.toContain("Instant mode:");
  });

  it("uses the instant Codex model only for instant runs", async () => {
    const instantCalls: Parameters<ProcessRunner>[0][] = [];
    const normalCalls: Parameters<ProcessRunner>[0][] = [];
    const runnerFor = (calls: Parameters<ProcessRunner>[0][]): ProcessRunner => async (request) => {
      calls.push(request);
      return {
        stdout: `${JSON.stringify({ text: "codex output" })}\n`,
        stderr: "",
        exitCode: 0,
        timedOut: false,
        durationMs: 7
      };
    };

    const env = {
      OPEN_KITCHEN_CODEX_BIN: "codex-test",
      OPEN_KITCHEN_CODEX_MODEL: "gpt-normal",
      OPEN_KITCHEN_CODEX_INSTANT_MODEL: "gpt-instant"
    };
    await new CodexCliAgentAdapter(runnerFor(instantCalls), env).execute({
      runId: "run-instant",
      task: task(),
      agentRole: "worker",
      permissionIntent: "read_only",
      instant: true
    });
    await new CodexCliAgentAdapter(runnerFor(normalCalls), env).execute({
      runId: "run-normal",
      task: task(),
      agentRole: "worker",
      permissionIntent: "read_only"
    });

    expect(instantCalls[0]?.args).toContain("gpt-instant");
    expect(instantCalls[0]?.args).not.toContain("gpt-normal");
    expect(normalCalls[0]?.args).toContain("gpt-normal");
    expect(normalCalls[0]?.args).not.toContain("gpt-instant");
  });

  it("uses instant timeout defaults unless an environment timeout is set", async () => {
    const runner: ProcessRunner = async () => ({
      stdout: `${JSON.stringify({ text: "codex output" })}\n`,
      stderr: "",
      exitCode: 0,
      timedOut: false,
      durationMs: 7
    });

    const instant = await new CodexCliAgentAdapter(runner, { OPEN_KITCHEN_CODEX_BIN: "codex-test" }).execute({
      runId: "run-instant",
      task: task(),
      agentRole: "worker",
      permissionIntent: "read_only",
      instant: true
    });
    const envOverride = await new CodexCliAgentAdapter(runner, {
      OPEN_KITCHEN_CODEX_BIN: "codex-test",
      OPEN_KITCHEN_PROVIDER_TIMEOUT_MS: "22000"
    }).execute({
      runId: "run-instant-env",
      task: task(),
      agentRole: "worker",
      permissionIntent: "read_only",
      instant: true
    });
    const normal = await new CodexCliAgentAdapter(runner, { OPEN_KITCHEN_CODEX_BIN: "codex-test" }).execute({
      runId: "run-normal",
      task: task(),
      agentRole: "worker",
      permissionIntent: "read_only"
    });

    expect(instant.provider?.timeoutMs).toBe(15000);
    expect(envOverride.provider?.timeoutMs).toBe(22000);
    expect(normal.provider?.timeoutMs).toBe(300000);
  });

  it("injects repository context maps into provider prompts when supplied", async () => {
    const calls: Parameters<ProcessRunner>[0][] = [];
    const runner: ProcessRunner = async (request) => {
      calls.push(request);
      return {
        stdout: `${JSON.stringify({ text: "codex output" })}\n`,
        stderr: "",
        exitCode: 0,
        timedOut: false,
        durationMs: 7
      };
    };

    await new CodexCliAgentAdapter(runner, { OPEN_KITCHEN_CODEX_BIN: "codex-test" }).execute({
      runId: "run-1",
      task: task(),
      agentRole: "context_scout",
      mode: getMode("prep"),
      policy: directPolicy(),
      permissionIntent: "read_only",
      repositoryContext: {
        kind: "repo_map",
        artifactName: "repo-map.md",
        markdown: "src/core/run-controller.ts\n- class RunController"
      }
    });

    const prompt = calls[0]?.args.at(-1);
    expect(prompt).toContain("Repository Context Map:");
    expect(prompt).toContain("This deterministic map is orientation only");
    expect(prompt).toContain("src/core/run-controller.ts");
  });

  it("resolves the default Codex CLI command before invoking the subprocess runner", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "open-kitchen-codex-bin-"));
    const binPath = path.join(root, process.platform === "win32" ? "codex.cmd" : "codex");
    if (process.platform === "win32") {
      await writeFile(path.join(root, "codex"), "extensionless codex", "utf8");
    }
    await writeFile(binPath, process.platform === "win32" ? "@ECHO off\r\n" : "#!/bin/sh\n", "utf8");
    if (process.platform !== "win32") {
      await chmod(binPath, 0o755);
    }
    const calls: Parameters<ProcessRunner>[0][] = [];
    const runner: ProcessRunner = async (request) => {
      calls.push(request);
      return {
        stdout: `${JSON.stringify({ text: "codex output" })}\n`,
        stderr: "",
        exitCode: 0,
        timedOut: false,
        durationMs: 7
      };
    };

    await new CodexCliAgentAdapter(runner, {
      PATH: `${root}${path.delimiter}${process.env.PATH ?? ""}`,
      PATHEXT: ".CMD;.EXE;.BAT"
    }).execute({
      runId: "run-1",
      task: task(),
      agentRole: "worker",
      permissionIntent: "read_only"
    });

    expect(calls[0]?.command).toBe(binPath);
  });

  it("runs Claude Code through an injectable subprocess runner", async () => {
    const calls: Parameters<ProcessRunner>[0][] = [];
    const runner: ProcessRunner = async (request) => {
      calls.push(request);
      request.onStdout?.(`${JSON.stringify({ message: { content: [{ type: "text", text: "claude output" }] } })}\n`);
      return {
        stdout: "",
        stderr: "",
        exitCode: 0,
        timedOut: false,
        durationMs: 9
      };
    };

    const result = await new ClaudeCodeAgentAdapter(runner, {
      OPEN_KITCHEN_CLAUDE_BIN: "claude-test",
      OPEN_KITCHEN_CLAUDE_MODEL: "sonnet-test"
    }).execute({
      runId: "run-1",
      task: task(),
      agentRole: "reviewer",
      mode: getMode("taste"),
      policy: directPolicy(),
      permissionIntent: "read_only"
    });

    expect(calls[0]?.command).toBe("claude-test");
    expect(calls[0]?.args).toContain("-p");
    expect(calls[0]?.args).toContain("stream-json");
    expect(calls[0]?.args).toContain("plan");
    expect(result.status).toBe("completed");
    expect(result.output).toBe("claude output");
    expect(result.provider?.provider).toBe("anthropic");
  });

  it("returns failed provider outputs for subprocess failures", async () => {
    const runner: ProcessRunner = async () => ({
      stdout: "",
      stderr: "auth failed",
      exitCode: 1,
      timedOut: false,
      durationMs: 3
    });

    const result = await new CodexCliAgentAdapter(runner).execute({
      runId: "run-1",
      task: task(),
      agentRole: "worker",
      permissionIntent: "read_only"
    });

    expect(result.status).toBe("failed");
    expect(result.output).toContain("auth failed");
    expect(result.provider?.failureReason).toContain("auth failed");
    expect(result.provider?.failureCategory).toBe("auth_failure");
  });

  it("classifies installation failures from subprocess spawn errors", async () => {
    const runner: ProcessRunner = async () => {
      throw new Error("spawn codex ENOENT");
    };

    const result = await new CodexCliAgentAdapter(runner).execute({
      runId: "run-1",
      task: task(),
      agentRole: "worker",
      permissionIntent: "read_only"
    });

    expect(result.status).toBe("failed");
    expect(result.provider?.failureCategory).toBe("installation_failure");
    expect(result.provider?.failureSummary).toContain("could not be executed");
  });

  it("classifies provider model failures", async () => {
    const runner: ProcessRunner = async () => ({
      stdout: "",
      stderr: "unknown model gpt-missing",
      exitCode: 1,
      timedOut: false,
      durationMs: 3
    });

    const result = await new CodexCliAgentAdapter(runner, { OPEN_KITCHEN_CODEX_MODEL: "gpt-missing" }).execute({
      runId: "run-1",
      task: task(),
      agentRole: "worker",
      permissionIntent: "read_only"
    });

    expect(result.status).toBe("failed");
    expect(result.provider?.failureCategory).toBe("model_failure");
    expect(result.provider?.failureSummary).toContain("rejected the configured model");
  });

  it("classifies provider timeouts with timeout metadata", async () => {
    const runner: ProcessRunner = async () => ({
      stdout: "",
      stderr: "",
      exitCode: undefined,
      timedOut: true,
      durationMs: 50
    });

    const result = await new CodexCliAgentAdapter(runner).execute({
      runId: "run-1",
      task: task(),
      agentRole: "worker",
      permissionIntent: "read_only",
      timeoutMs: 50
    });

    expect(result.status).toBe("failed");
    expect(result.provider?.failureCategory).toBe("timeout");
    expect(result.provider?.timeoutMs).toBe(50);
    expect(result.provider?.timeoutSource).toBe("request");
    expect(result.provider?.timedOut).toBe(true);
  });

  it("records streaming success stats", async () => {
    const runner: ProcessRunner = async (request) => {
      request.onStdout?.(`${JSON.stringify({ text: "hello " })}\n`);
      request.onStdout?.(`${JSON.stringify({ text: "world" })}\n`);
      return {
        stdout: "",
        stderr: "",
        exitCode: 0,
        timedOut: false,
        durationMs: 4
      };
    };

    const result = await new CodexCliAgentAdapter(runner).execute({
      runId: "run-1",
      task: task(),
      agentRole: "worker",
      permissionIntent: "read_only"
    });

    expect(result.status).toBe("completed");
    expect(result.output).toBe("hello world");
    expect(result.provider?.streamStats?.stdoutChunkCount).toBe(2);
    expect(result.provider?.streamStats?.jsonLineCount).toBe(2);
    expect(result.provider?.streamStats?.parseErrorCount).toBe(0);
  });

  it("extracts the final Codex agent message without mixing command output", async () => {
    const runner: ProcessRunner = async () => ({
      stdout: [
        JSON.stringify({
          type: "item.completed",
          item: {
            type: "command_execution",
            command: "npm test",
            status: "completed",
            exit_code: 0,
            aggregated_output: "very noisy test output"
          }
        }),
        JSON.stringify({
          type: "item.completed",
          item: {
            type: "agent_message",
            text: "Final answer for the human."
          }
        })
      ].join("\n"),
      stderr: "",
      exitCode: 0,
      timedOut: false,
      durationMs: 4
    });

    const result = await new CodexCliAgentAdapter(runner).execute({
      runId: "run-1",
      task: task(),
      agentRole: "worker",
      permissionIntent: "read_only"
    });

    expect(result.status).toBe("completed");
    expect(result.output).toBe("Final answer for the human.");
    expect(result.output).not.toContain("very noisy test output");
    expect(result.rawOutput).toContain("very noisy test output");
    expect(result.provider?.readability?.finalAnswerSource).toBe("last_agent_message");
    expect(result.provider?.readability?.commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          command: "npm test",
          status: "completed",
          exitCode: 0
        })
      ])
    );
  });

  it("extracts provider warnings and failed or blocked command quality flags", async () => {
    const runner: ProcessRunner = async (request) => {
      request.onStderr?.("Warning: failed to load optional skill\n");
      return {
        stdout: [
          JSON.stringify({
            type: "item.completed",
            item: {
              type: "command_execution",
              command: "rg foo",
              status: "failed",
              exit_code: 1,
              aggregated_output: "rg is not recognized"
            }
          }),
          JSON.stringify({
            type: "item.completed",
            item: {
              type: "command_execution",
              command: "git status",
              status: "blocked",
              aggregated_output: "blocked by policy"
            }
          }),
          JSON.stringify({
            type: "item.completed",
            item: {
              type: "agent_message",
              text: "Finished with caveats."
            }
          })
        ].join("\n"),
        stderr: "",
        exitCode: 0,
        timedOut: false,
        durationMs: 4
      };
    };

    const result = await new CodexCliAgentAdapter(runner).execute({
      runId: "run-1",
      task: task(),
      agentRole: "worker",
      permissionIntent: "read_only"
    });

    expect(result.status).toBe("completed");
    expect(result.provider?.readability?.warnings[0]).toEqual(
      expect.objectContaining({
        source: "stderr",
        message: expect.stringContaining("failed to load optional skill")
      })
    );
    expect(result.provider?.readability?.qualityFlags).toEqual(
      expect.arrayContaining(["completed_with_warnings", "provider_stderr", "command_failure", "blocked_command"])
    );
  });

  it("falls back to raw stdout while recording stream parse errors", async () => {
    const runner: ProcessRunner = async () => ({
      stdout: "plain provider output",
      stderr: "",
      exitCode: 0,
      timedOut: false,
      durationMs: 4
    });

    const result = await new CodexCliAgentAdapter(runner).execute({
      runId: "run-1",
      task: task(),
      agentRole: "worker",
      permissionIntent: "read_only"
    });

    expect(result.status).toBe("completed");
    expect(result.output).toBe("plain provider output");
    expect(result.provider?.streamStats?.parseErrorCount).toBe(1);
  });

  it("classifies empty provider output", async () => {
    const runner: ProcessRunner = async () => ({
      stdout: "",
      stderr: "",
      exitCode: 0,
      timedOut: false,
      durationMs: 4
    });

    const result = await new CodexCliAgentAdapter(runner).execute({
      runId: "run-1",
      task: task(),
      agentRole: "worker",
      permissionIntent: "read_only"
    });

    expect(result.status).toBe("failed");
    expect(result.provider?.failureCategory).toBe("empty_output");
    expect(result.provider?.failureSummary).toContain("no usable text output");
  });

  it("runs Ollama through an injectable HTTP fetch", async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const httpFetch = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), body: String(init?.body) });
      return {
        ok: true,
        status: 200,
        text: async () => `${JSON.stringify({ response: "ollama " })}\n${JSON.stringify({ response: "output", done: true })}\n`
      } as Response;
    };

    const result = await new OllamaAgentAdapter(httpFetch, {
      OPEN_KITCHEN_OLLAMA_HOST: "http://ollama.test",
      OPEN_KITCHEN_OLLAMA_MODEL: "llama-test"
    }).execute({
      runId: "run-1",
      task: task(),
      agentRole: "reviewer",
      permissionIntent: "read_only"
    });

    expect(calls[0]?.url).toBe("http://ollama.test/api/generate");
    expect(calls[0]?.body).toContain("llama-test");
    expect(result.status).toBe("completed");
    expect(result.output).toBe("ollama output");
    expect(result.provider?.adapterName).toBe("ollama");
  });

  it("requires an Ollama model", async () => {
    const result = await new OllamaAgentAdapter(async () => {
      throw new Error("should not call");
    }, {}).execute({
      runId: "run-1",
      task: task(),
      agentRole: "reviewer",
      permissionIntent: "read_only"
    });

    expect(result.status).toBe("failed");
    expect(result.provider?.failureReason).toContain("OPEN_KITCHEN_OLLAMA_MODEL");
  });

  it("rejects adapters that cannot support the resolved strategy or mutation intent", () => {
    const codexDecision = validateAgentCapabilities({
      adapter: new CodexCliAgentAdapter().metadata,
      mode: getMode("banquet"),
      policy: parallelPolicy()
    });
    const ollamaDecision = validateAgentCapabilities({
      adapter: new OllamaAgentAdapter(async () => ({ ok: true } as Response), { OPEN_KITCHEN_OLLAMA_MODEL: "llama" }).metadata,
      mode: getMode("cook"),
      policy: directPolicy()
    });

    expect(codexDecision.accepted).toBe(false);
    expect(codexDecision.reason).toContain("parallel task execution");
    expect(ollamaDecision.accepted).toBe(false);
    expect(ollamaDecision.reason).toContain("workspace mutation");
  });
});

function task() {
  return {
    id: "task-1",
    title: "Test task",
    prompt: "Do provider work",
    agentRole: "worker" as const
  };
}

function directPolicy(): ResolvedPolicy {
  return {
    decisionId: "decision-test",
    decisionKind: "direct_execution",
    strategy: "direct",
    policies: ["direct"],
    reason: "test",
    requiresTasks: false,
    agentRoles: ["worker"]
  };
}

function parallelPolicy(): ResolvedPolicy {
  return {
    decisionId: "decision-test",
    decisionKind: "parallel_execution",
    strategy: "parallel_tasks",
    policies: ["task_first", "parallel"],
    reason: "test",
    requiresTasks: true,
    agentRoles: ["worker"]
  };
}
