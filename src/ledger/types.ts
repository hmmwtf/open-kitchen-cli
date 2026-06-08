import type {
  AgentExecutionResult,
  Decision,
  HandoffRecommendation,
  ModeRecommendation,
  ModeName,
  PlannerPlan,
  RecipeContext,
  ResolvedPolicy,
  RunStatus,
  Task
} from "../core/types.js";
import type { AgentAdapterMetadata, AgentPermissionIntent } from "../agents/adapter.js";
import type { BanquetLedgerRecord } from "../banquet/types.js";
import type { ApprovalGate, ValidationResult } from "../validation/types.js";
import type { RunAssessment } from "./run-assessment.js";
import type { RepositoryContextSummary } from "../repository-map/types.js";

export interface LedgerRunMetadata {
  runId: string;
  mode: ModeName;
  adapter?: AgentAdapterMetadata;
  recipeContext?: RecipeContext;
  status: RunStatus;
  classification?: "partial_or_incomplete";
  startedAt: string;
  completedAt?: string;
}

export interface LedgerEvent {
  timestamp: string;
  type: string;
  message: string;
  data?: unknown;
}

export interface LedgerResult {
  runId: string;
  mode: ModeName;
  status: RunStatus;
  summary: string;
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
}

export interface LedgerProviderRecord {
  adapterName: string;
  provider: string;
  displayName: string;
  model?: string;
  surface: string;
  permissionIntent: AgentPermissionIntent;
  timeoutMs: number;
  capabilityAccepted: boolean;
  capabilityReason: string;
  supportsStreaming: boolean;
  supportsParallelTasks: boolean;
  supportsWorkspaceMutation: boolean;
  credentialSource: string;
  modelSource: string;
}
