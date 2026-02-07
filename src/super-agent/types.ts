/**
 * Super-Agent Shared Type Definitions
 *
 * Core types used across all subsystems. Based on Memory Statue v2
 * (Frazier, 2026) and extended for multi-LLM orchestration, swarm
 * coordination, and incremental context management.
 */

// ─── Capsule Types ───────────────────────────────────────────────

export type CapsuleType =
  | "observation" // raw fact or data point
  | "decision" // a choice made and why
  | "policy" // a rule or constraint
  | "state_card" // current state snapshot
  | "summary" // compressed summary of sources
  | "skill" // learned procedure or technique
  | "artifact" // produced output (code, document, etc.)
  | "correction" // explicit correction of prior knowledge
  | "reflection"; // meta-reasoning about performance

export type TrustLevel = "CANON" | "OPERATIONAL" | "DRAFT" | "UNTRUSTED";

export const TRUST_RANK: Record<TrustLevel, number> = {
  CANON: 4,
  OPERATIONAL: 3,
  DRAFT: 2,
  UNTRUSTED: 1,
};

// ─── Determinative Tags ──────────────────────────────────────────

export interface DeterminativeTag {
  category: "authority" | "freshness" | "security" | "scope" | "artifact";
  value: string;
  enforced: boolean;
}

// ─── TTL Policy ──────────────────────────────────────────────────

export interface TTLPolicy {
  expiresAt?: string;
  refreshAfter?: string;
  onExpiry: "archive" | "quarantine" | "delete";
}

// ─── Provenance ──────────────────────────────────────────────────

export type ProvenanceSourceType =
  | "agent_output"
  | "tool_result"
  | "human_input"
  | "document"
  | "api_response"
  | "capsule_derivation";

export interface ProvenanceEntry {
  sourceType: ProvenanceSourceType;
  sourceId: string;
  sourceAgentId?: string;
  timestamp: string;
  span?: [number, number];
  hash: string;
}

export interface PromotionRecord {
  from: TrustLevel;
  to: TrustLevel;
  timestamp: string;
  approvedBy: string;
  reason: string;
  reversible: boolean;
}

// ─── Capsule ─────────────────────────────────────────────────────

export interface Capsule {
  id: string;
  type: CapsuleType;
  version: number;

  content: string;
  contentHash: string;
  embedding?: number[];

  trust: TrustLevel;
  tags: DeterminativeTag[];
  promotionHistory: PromotionRecord[];

  createdAt: string;
  updatedAt: string;
  accessedAt: string;
  ttl?: TTLPolicy;

  provenance: ProvenanceEntry[];
  sourceAgentId?: string;
  parentCapsuleIds: string[];

  accessCount: number;
  usefulness: number;
}

// ─── Write Operations ────────────────────────────────────────────

export type WriteOperation = "create" | "update" | "archive" | "promote" | "demote";

export interface WriteProposal {
  proposalId: string;
  proposedBy: string;
  operation: WriteOperation;
  capsule: Partial<Capsule> & { content: string };
  justification: string;
  targetTrust: TrustLevel;
  conflictResolution?: "replace" | "supersede" | "merge";
}

export interface WriteResult {
  proposalId: string;
  committed: boolean;
  capsuleId?: string;
  reason?: string;
  validationErrors?: string[];
}

// ─── Retrieval ───────────────────────────────────────────────────

export interface RetrievalRequest {
  query: string;
  queryIntent?: string;
  requester: string;
  permissions: string[];
  constraints: RetrievalConstraints;
}

export interface RetrievalConstraints {
  maxCapsules: number;
  maxTokens: number;
  trustFloor: TrustLevel;
  requiredTags?: DeterminativeTag[];
  excludedTags?: DeterminativeTag[];
  timeWindow?: { after?: string; before?: string };
  maxDepth: number;
  maxToolCalls: number;
}

export interface RetrievalResult {
  capsules: Capsule[];
  totalCandidates: number;
  pipelineTrace: PipelineTrace;
  contextPackHash: string;
  tokenCount: number;
}

export interface PipelineTrace {
  stage1_policyFiltered: number;
  stage2_candidateCount: number;
  stage3_rerankedCount: number;
  stage4_packedCount: number;
  durationMs: number;
}

// ─── Drift Metrics ───────────────────────────────────────────────

export interface DefectVector {
  contradictionRate: number; // CVR [0,1]
  unfaithfulnessRate: number; // UF [0,1]
  decisionInconsistency: number; // DI [0,1]
  stalenessIndex: number; // SI [0,1]
  summaryDivergence: number; // SD [0,1]
  retrievalMissRate: number; // RMR [0,1]
  toolCallTailLatency: number; // TL [normalized]
  tokenTailCost: number; // TC [normalized]
}

export const DEFAULT_DRIFT_WEIGHTS: number[] = [
  0.2, // CVR - contradiction is high priority
  0.15, // UF - unfaithfulness
  0.1, // DI - decision inconsistency
  0.15, // SI - staleness
  0.1, // SD - summary divergence
  0.15, // RMR - retrieval miss
  0.075, // TL - latency
  0.075, // TC - cost
];

// ─── Audit Log ───────────────────────────────────────────────────

export type AuditAction =
  | "capsule_created"
  | "capsule_updated"
  | "capsule_archived"
  | "capsule_promoted"
  | "capsule_demoted"
  | "retrieval_executed"
  | "write_proposed"
  | "write_rejected"
  | "annealing_started"
  | "annealing_completed"
  | "threshold_breached"
  | "capability_granted"
  | "capability_revoked"
  | "escalation_requested"
  | "escalation_resolved";

export interface AuditEntry {
  id: string;
  timestamp: string;
  action: AuditAction;
  agentId: string;
  details: Record<string, unknown>;
  capsuleId?: string;
  proposalId?: string;
}

// ─── Multi-LLM ──────────────────────────────────────────────────

export type ModelProvider = "anthropic" | "openai" | "google" | "local" | string;

export type RoutingStrategy = "route" | "verify" | "synthesize";

export interface ModelProfile {
  id: string;
  provider: ModelProvider;
  name: string;
  capabilities: ModelCapabilities;
  costPer1kTokens: { input: number; output: number };
  latencyP50Ms: number;
  latencyP95Ms: number;
  contextWindow: number;
  supportsStreaming: boolean;
  supportsToolUse: boolean;
}

export interface ModelCapabilities {
  reasoning: number; // 0-1
  coding: number;
  creativity: number;
  factualAccuracy: number;
  instruction: number;
  safety: number;
  multimodal: boolean;
  languages: string[];
}

export type TaskDomain =
  | "reasoning"
  | "coding"
  | "creative"
  | "factual"
  | "instruction"
  | "multimodal"
  | "translation";

export type TaskComplexity = "simple" | "moderate" | "complex";
export type TaskStakes = "low" | "medium" | "high";

export interface TaskAnalysis {
  primaryDomain: TaskDomain;
  complexity: TaskComplexity;
  stakes: TaskStakes;
  latencyBudgetMs: number;
  tokenBudget: number;
}

export interface ModelOutput {
  modelId: string;
  content: string;
  tokenCount: { input: number; output: number };
  latencyMs: number;
  finishReason: string;
}

export interface ExtractedElements {
  claims: { text: string; confidence: number; evidence?: string }[];
  reasoningSteps: { step: string; valid: boolean }[];
  codeBlocks: { code: string; language: string; correctness?: number }[];
  caveats: string[];
  uniqueInsights: string[];
}

export interface CrossModelComparison {
  agreements: {
    claim: string;
    supportedBy: string[];
    confidence: number;
  }[];
  disagreements: { claim: string; positions: Map<string, string> }[];
  uniqueContributions: {
    modelId: string;
    contribution: string;
    value: number;
  }[];
}

export interface SynthesizedOutput {
  content: string;
  sourceModels: string[];
  elementSources: Map<string, string>; // element → model that contributed it
  confidence: number;
  synthesisTrace: string;
}

// ─── Swarm ───────────────────────────────────────────────────────

export interface AgentSpecialization {
  domain: string;
  subdomains: string[];
  preferredModels: string[];
  writeTags: DeterminativeTag[];
}

export interface AgentMetrics {
  tasksCompleted: number;
  taskSuccessRate: number;
  avgTaskDurationMs: number;
  capsulesContributed: number;
  capsuleUsefulnessAvg: number;
  driftContribution: number;
}

export type AgentStatus = "idle" | "working" | "blocked" | "offline";

export interface SwarmAgent {
  id: string;
  name: string;
  specialization: AgentSpecialization;
  status: AgentStatus;
  currentTask?: string;
  capabilities: string[];
  trustLevel: TrustLevel;
  performanceMetrics: AgentMetrics;
}

export type TaskStatus =
  | "pending"
  | "assigned"
  | "in_progress"
  | "completed"
  | "failed"
  | "blocked";

export interface SwarmTask {
  id: string;
  parentId?: string;
  description: string;
  domain: string;
  requiredCapabilities: string[];
  assignedAgent?: string;
  status: TaskStatus;
  priority: number;
  deadline?: string;
  result?: TaskResult;
  writeProposals: WriteProposal[];
}

export interface TaskResult {
  output: string;
  capsuleIds: string[];
  confidence: number;
  verifiedBy?: string;
}

export interface TaskDependency {
  from: string;
  to: string;
  type: "data" | "approval" | "ordering";
}

// ─── Security ────────────────────────────────────────────────────

export type CapabilityScopeType = "global" | "project" | "domain" | "capsule" | "temporal";

export interface CapabilityScope {
  type: CapabilityScopeType;
  projectId?: string;
  domain?: string;
  capsuleIds?: string[];
  validAfter?: string;
  validBefore?: string;
}

export interface Capability {
  id: string;
  resource: string;
  actions: string[];
  scope: CapabilityScope;
  grantedTo: string;
  grantedBy: string;
  expiresAt?: string;
  delegatable: boolean;
  revocable: boolean;
  conditions?: CapabilityCondition[];
}

export interface CapabilityCondition {
  field: string;
  operator: "eq" | "neq" | "in" | "gt" | "lt";
  value: string | number | string[];
}

export interface EscalationRequest {
  requestId: string;
  requestedBy: string;
  capability: Partial<Capability>;
  justification: string;
  taskContext: string;
  urgency: "low" | "medium" | "high";
}

export interface EscalationResponse {
  requestId: string;
  granted: boolean;
  capability?: Capability;
  reason: string;
  approvedBy: string;
}

// ─── Trace ───────────────────────────────────────────────────────

export type TraceEventType =
  | "task_received"
  | "retrieval_start"
  | "retrieval_result"
  | "llm_call_start"
  | "llm_call_result"
  | "tool_call"
  | "write_proposal"
  | "write_committed"
  | "quality_gate"
  | "synthesis_step"
  | "capability_check"
  | "escalation_request"
  | "delta_computed"
  | "checkpoint"
  | "drift_measurement"
  | "annealing_triggered"
  | "error"
  | "decision"
  | "reflection";

export interface TraceEvent {
  id: string;
  timestamp: string;
  agentId: string;
  taskId?: string;
  type: TraceEventType;
  data: Record<string, unknown>;
  parentEventId?: string;
  durationMs?: number;
}

// ─── Context Snapshots ───────────────────────────────────────────

export interface ContextSnapshot {
  snapshotId: string;
  turnNumber: number;
  capsuleIds: string[];
  capsuleVersions: Map<string, number>;
  tokenCount: number;
  contentHash: string;
  createdAt: string;
}

export type DeltaReason =
  | "new_query"
  | "new_capsule"
  | "capsule_expired"
  | "capsule_promoted"
  | "relevance_shift"
  | "checkpoint";

export interface ContextDelta {
  added: string[];
  removed: string[];
  updated: string[];
  reordered: boolean;
  reason: DeltaReason;
}

export interface CheckpointPolicy {
  maxTurnsSinceCheckpoint: number;
  maxDeltaAccumulation: number;
  onTopicShift: boolean;
  onAnnealingComplete: boolean;
}

// ─── TFRD Canon ──────────────────────────────────────────────────

export interface CanonPrinciple {
  id: string;
  name: string;
  description: string;
  enforcementLevel: "hard" | "soft";
  violationResponse: "block" | "warn" | "log";
  measurable: boolean;
  metric?: string;
}

export interface WorkflowStep {
  id: string;
  name: string;
  description: string;
  required: boolean;
}

export interface WorkflowPhase {
  id: string;
  name: string;
  steps: WorkflowStep[];
  required: boolean;
  maxDurationMs?: number;
}

export interface QualityCheck {
  name: string;
  evaluator: "self" | "judge_llm" | "rule_based";
  weight: number;
}

export interface QualityGate {
  id: string;
  checks: QualityCheck[];
  passThreshold: number;
  blockOnFailure: boolean;
}

export interface ScoringDimension {
  name: string;
  scale: [number, number];
  masteryThreshold: number;
  description: string;
}

// ─── Utility Types ───────────────────────────────────────────────

export interface TimeRange {
  after?: string;
  before?: string;
}

export type LogLevel = "debug" | "info" | "warn" | "error";
