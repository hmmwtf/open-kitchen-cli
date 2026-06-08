import type { AgentAdapterMetadata, AgentAdapterName } from "../agents/adapter.js";
import type {
  ProviderFailureCategory,
  ProviderOutputReadability,
  ProviderStreamStats,
  ProviderTimeoutSource
} from "../agents/provider-reliability.js";
import type { BanquetLedgerRecord } from "../banquet/types.js";
import type { RunAssessment } from "../ledger/run-assessment.js";
import type { RepositoryContextSummary } from "../repository-map/types.js";
import type { ApprovalGate, ValidationCommand, ValidationResult } from "../validation/types.js";

export type ModeName = "chef" | "prep" | "cook" | "taste" | "banquet";

export type ExecutionPolicy =
  | "direct"
  | "planner_optional"
  | "task_first"
  | "parallel"
  | "read_first"
  | "evidence_first"
  | "review_gated"
  | "approval_gated"
  | "handoff_enabled"
  | "validation_aware";

export type ExecutionStrategy = "direct" | "task_list" | "parallel_tasks";

export type DecisionKind =
  | "direct_execution"
  | "task_generation"
  | "parallel_execution"
  | "handoff_recommended";

export type AgentRole =
  | "orchestrator"
  | "context_scout"
  | "dependency_mapper"
  | "implementation_agent"
  | "debugger"
  | "reviewer"
  | "test_runner"
  | "coordinator"
  | "worker"
  | "reconciliation_agent"
  | "validation_agent";

export type RunStatus = "completed" | "failed" | "needs_input";

export interface ModeDefinition {
  name: ModeName;
  displayName: string;
  description: string;
  defaultPolicies: ExecutionPolicy[];
  allowedPolicies: ExecutionPolicy[];
  agentRoles: AgentRole[];
  defaultAgentRole: AgentRole;
  planner: "optional" | "required" | "disallowed";
  allowsMutation: boolean;
  allowsMultipleAgents: boolean;
  handoffTargets: ModeName[];
}

export interface RunRequest {
  mode: ModeName;
  prompt: string;
  ledgerRoot?: string;
  forceTasks?: boolean;
  requireApproval?: boolean;
  approved?: boolean;
  adapter?: AgentAdapterName;
  recipeContext?: RecipeContext;
  validationCommands?: ValidationCommand[];
  fast?: boolean;
  instant?: boolean;
  onProgress?: (event: RunProgressEvent) => void;
}

export type RunProgressEvent =
  | {
      type: "run.started";
      runId: string;
      mode: ModeName;
      adapter: AgentAdapterMetadata;
      ledgerPath: string;
    }
  | {
      type: "repository_map.generated";
      filesIncluded: number;
      symbolsIncluded: number;
      truncated: boolean;
    }
  | {
      type: "provider.started";
      adapterName: string;
      timeoutMs: number;
      permissionIntent: string;
    }
  | {
      type: "provider.activity";
      adapterName: string;
      stream?: string;
      chunkCount: number;
    }
  | {
      type: "provider.completed";
      adapterName: string;
      durationMs?: number;
    }
  | {
      type: "provider.timed_out";
      adapterName: string;
      durationMs?: number;
    }
  | {
      type: "provider.failed";
      adapterName: string;
      reason?: string;
    };

export interface RecipeContext {
  recipeId: string;
  recipeName: string;
  stepId: string;
  stepTitle: string;
  workflowRunId?: string;
  stepIndex?: number;
  totalSteps?: number;
}

export interface DecisionSignal {
  name: string;
  value: string | boolean;
  explanation: string;
}

export interface ModeRecommendationSignal {
  name: string;
  matched: boolean;
  explanation: string;
}

export interface ModeRecommendationAlternative {
  mode: ModeName;
  reasonNotSelected: string;
}

export interface ModeRecommendation {
  id: string;
  recommendedMode: ModeName;
  selectedMode: ModeName;
  isOverride: boolean;
  confidence: "low" | "medium" | "high";
  reason: string;
  signals: ModeRecommendationSignal[];
  alternatives: ModeRecommendationAlternative[];
  nextCommand: string;
}

export interface DecisionAlternative {
  strategy: ExecutionStrategy;
  reasonNotSelected: string;
}

export interface Decision {
  id: string;
  kind: DecisionKind;
  selectedMode: ModeName;
  selectedStrategy: ExecutionStrategy;
  reason: string;
  signals: DecisionSignal[];
  alternatives: DecisionAlternative[];
  handoffRecommendation?: HandoffRecommendation;
}

export interface HandoffRecommendation {
  id: string;
  fromMode: ModeName;
  toMode: ModeName;
  reason: string;
  confidence: "low" | "medium" | "high";
  nextCommand: string;
  autoExecute: false;
}

export interface PlannerPlan {
  id: string;
  decisionId: string;
  mode: ModeName;
  strategy: ExecutionStrategy;
  reason: string;
  tasks: Task[];
}

export interface ResolvedPolicy {
  decisionId: string;
  decisionKind: DecisionKind;
  strategy: ExecutionStrategy;
  policies: ExecutionPolicy[];
  reason: string;
  requiresTasks: boolean;
  agentRoles: AgentRole[];
}

export interface Task {
  id: string;
  title: string;
  prompt: string;
  agentRole: AgentRole;
  ownership?: TaskOwnership;
}

export interface TaskOwnership {
  ownerWorkerId: string;
  claimedResources: string[];
  scope: "investigation" | "execution" | "reconciliation";
}

export interface AgentExecutionResult {
  taskId: string;
  agentRole: AgentRole;
  status: RunStatus;
  output: string;
  artifactName: string;
  rawOutput?: string;
  rawOutputArtifactName?: string;
  provider?: ProviderExecutionMetadata;
}

export interface ProviderExecutionMetadata {
  adapterName: string;
  provider: string;
  model?: string;
  surface: "mock" | "subprocess" | "http";
  durationMs: number;
  exitCode?: number;
  failureReason?: string;
  failureCategory?: ProviderFailureCategory;
  failureSummary?: string;
  resolvedCommand?: string;
  timeoutMs?: number;
  timeoutSource?: ProviderTimeoutSource;
  timedOut?: boolean;
  streamStats?: ProviderStreamStats;
  readability?: ProviderOutputReadability;
}

export interface RunResult {
  runId: string;
  mode: ModeName;
  status: RunStatus;
  ledgerPath: string;
  adapter: AgentAdapterMetadata;
  recipeContext?: RecipeContext;
  modeRecommendation?: ModeRecommendation;
  decision: Decision;
  policy: ResolvedPolicy;
  plan?: PlannerPlan;
  handoffRecommendation?: HandoffRecommendation;
  tasks: Task[];
  outputs: AgentExecutionResult[];
  banquet?: BanquetLedgerRecord;
  validation?: ValidationResult;
  approval?: ApprovalGate;
  assessment?: RunAssessment;
  repositoryContext?: RepositoryContextSummary;
  summary: string;
}
