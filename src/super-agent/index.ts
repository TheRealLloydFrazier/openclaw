/**
 * Super-Agent Public API
 *
 * Re-exports all subsystems and the unified runtime.
 */

// Runtime
export { SuperAgentRuntime } from "./runtime.js";
export type { SuperAgentConfig, SystemHealth } from "./runtime.js";

// Types
export type {
  Capsule,
  CapsuleType,
  TrustLevel,
  DeterminativeTag,
  TTLPolicy,
  ProvenanceEntry,
  PromotionRecord,
  WriteProposal,
  WriteResult,
  RetrievalRequest,
  RetrievalConstraints,
  RetrievalResult,
  DefectVector,
  ModelProfile,
  ModelCapabilities,
  TaskAnalysis,
  SwarmAgent,
  SwarmTask,
  TaskResult,
  Capability,
  CapabilityScope,
  EscalationRequest,
  EscalationResponse,
  TraceEvent,
  TraceEventType,
  ContextSnapshot,
  ContextDelta,
  CanonPrinciple,
  QualityGate,
  ScoringDimension,
} from "./types.js";

// Crystal
export { CrystalStorage } from "./crystal/storage.js";
export { RetrievalPipeline } from "./crystal/retrieval.js";
export { DriftMonitor } from "./crystal/drift.js";
export type { DriftThresholds, InteractionLog } from "./crystal/drift.js";
export { AnnealingEngine } from "./crystal/annealing.js";
export type { AnnealingResult, AnnealingSchedule } from "./crystal/annealing.js";
export {
  createCapsule,
  validateCapsule,
  hashContent,
  isCapsuleExpired,
  isCapsuleStale,
  estimateTokens,
} from "./crystal/capsule.js";

// Context
export { IncrementalContextEngine } from "./context/engine.js";
export type { IncrementalRetrievalResult } from "./context/engine.js";

// Router
export { MultiLLMRouter } from "./router/router.js";
export type { ModelAdapter, ExecutionResult, VerifiedOutput } from "./router/router.js";

// Swarm
export { SwarmOrchestrator } from "./swarm/orchestrator.js";
export type { CompoundingEvent, CompoundingMetrics, SwarmStatus } from "./swarm/orchestrator.js";

// Canon
export { TFRDCanon, TFRD_PRINCIPLES, TFRD_WORKFLOW, TFRD_SCORING } from "./canon/tfrd.js";
export type { QualityGateResult, PrincipleViolation } from "./canon/tfrd.js";

// Security
export { CapabilityEngine } from "./security/capabilities.js";
export type { PermissionResult } from "./security/capabilities.js";

// Trace
export { TraceStore } from "./trace/store.js";
export type { AgentTraceSummary } from "./trace/store.js";
