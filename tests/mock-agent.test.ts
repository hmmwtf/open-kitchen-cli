import { describe, expect, it } from "vitest";
import { MockAgentAdapter } from "../src/agents/mock-agent.js";

describe("MockAgentAdapter", () => {
  it("exposes mock adapter metadata", () => {
    const adapter = new MockAgentAdapter();

    expect(adapter.metadata.name).toBe("mock");
    expect(adapter.metadata.isMock).toBe(true);
    expect(adapter.metadata.requiresCredentials).toBe(false);
  });

  it("returns deterministic mock output without provider calls", async () => {
    const result = await new MockAgentAdapter().execute({
      runId: "run-1",
      agentRole: "worker",
      task: {
        id: "task-1",
        title: "Test task",
        prompt: "Do mock work",
        agentRole: "worker"
      }
    });

    expect(result.status).toBe("completed");
    expect(result.artifactName).toBe("agent-output-task-1.md");
    expect(result.output).toContain("No provider was called.");
  });
});
