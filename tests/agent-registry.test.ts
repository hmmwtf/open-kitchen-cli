import { describe, expect, it } from "vitest";
import {
  createAgentAdapter,
  getAgentAdapterMetadata,
  isAgentAdapterName,
  listAgentAdapters
} from "../src/agents/registry.js";

describe("agent adapter registry", () => {
  it("lists provider adapter v1 adapters", () => {
    const adapters = listAgentAdapters();

    expect(adapters.map((adapter) => adapter.name)).toEqual(["mock", "codex-cli", "claude-code", "ollama"]);
    expect(adapters.find((adapter) => adapter.name === "mock")?.requiresCredentials).toBe(false);
    expect(adapters.find((adapter) => adapter.name === "codex-cli")?.requiresCredentials).toBe(true);
    expect(adapters.find((adapter) => adapter.name === "claude-code")?.requiresCredentials).toBe(true);
    expect(adapters.find((adapter) => adapter.name === "ollama")?.capabilities.executionSurface).toBe("http");
  });

  it("creates the mock adapter", () => {
    const adapter = createAgentAdapter("mock");

    expect(adapter.metadata.name).toBe("mock");
    expect(adapter.metadata.isMock).toBe(true);
  });

  it("gets mock adapter metadata", () => {
    const metadata = getAgentAdapterMetadata("mock");

    expect(metadata.displayName).toBe("Mock Agent Adapter");
    expect(metadata.supportsParallel).toBe(true);
    expect(metadata.capabilities.supportsParallelTasks).toBe(true);
  });

  it("creates provider adapters", () => {
    expect(createAgentAdapter("codex-cli").metadata.provider).toBe("openai");
    expect(createAgentAdapter("claude-code").metadata.provider).toBe("anthropic");
    expect(createAgentAdapter("ollama").metadata.provider).toBe("ollama");
  });

  it("rejects unknown adapter names", () => {
    expect(isAgentAdapterName("codex")).toBe(false);
    expect(() => createAgentAdapter("codex" as "mock")).toThrow('Unknown adapter "codex"');
  });
});
