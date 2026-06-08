import type { AgentAdapter, AgentAdapterMetadata, AgentAdapterName } from "./adapter.js";
import { MockAgentAdapter, mockAgentAdapterMetadata } from "./mock-agent.js";
import {
  ClaudeCodeAgentAdapter,
  CodexCliAgentAdapter,
  OllamaAgentAdapter,
  claudeCodeAdapterMetadata,
  codexCliAdapterMetadata,
  ollamaAdapterMetadata
} from "./provider-adapters.js";

const adapterMetadata = new Map<AgentAdapterName, AgentAdapterMetadata>([
  ["mock", mockAgentAdapterMetadata],
  ["codex-cli", codexCliAdapterMetadata],
  ["claude-code", claudeCodeAdapterMetadata],
  ["ollama", ollamaAdapterMetadata]
]);

export function listAgentAdapters(): AgentAdapterMetadata[] {
  return [...adapterMetadata.values()];
}

export function getAgentAdapterMetadata(name: AgentAdapterName): AgentAdapterMetadata {
  const metadata = adapterMetadata.get(name);
  if (!metadata) {
    throw new Error(unknownAdapterMessage(name));
  }
  return metadata;
}

export function createAgentAdapter(name: AgentAdapterName): AgentAdapter {
  if (name === "mock") {
    return new MockAgentAdapter();
  }
  if (name === "codex-cli") {
    return new CodexCliAgentAdapter();
  }
  if (name === "claude-code") {
    return new ClaudeCodeAgentAdapter();
  }
  if (name === "ollama") {
    return new OllamaAgentAdapter();
  }
  throw new Error(unknownAdapterMessage(name));
}

export function isAgentAdapterName(value: string): value is AgentAdapterName {
  return adapterMetadata.has(value as AgentAdapterName);
}

export function availableAgentAdapterNames(): string {
  return listAgentAdapters()
    .map((metadata) => metadata.name)
    .join(", ");
}

function unknownAdapterMessage(name: string): string {
  return `Unknown adapter "${name}". Available adapters: ${availableAgentAdapterNames()}.`;
}
