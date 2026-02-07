/**
 * Capability Security Engine
 *
 * Fine-grained, runtime-negotiable permission system.
 * Instead of coarse allow/deny lists, capabilities are tokens
 * that can be granted, delegated, and revoked.
 *
 * Security invariants:
 * 1. No agent can write CANON without governed approval
 * 2. No agent can read outside its ACL scope
 * 3. No agent can delegate capabilities it doesn't hold
 * 4. All grants are logged in the audit trail
 * 5. Expired capabilities are enforced (no grace period)
 * 6. Escalation requests are rate-limited per agent
 */

import { randomUUID } from "node:crypto";
import type {
  AuditEntry,
  Capability,
  CapabilityCondition,
  CapabilityScope,
  EscalationRequest,
  EscalationResponse,
} from "../types.js";

// ─── Capability Security Engine ──────────────────────────────────

export class CapabilityEngine {
  private capabilities: Map<string, Capability> = new Map();
  private auditLog: AuditEntry[] = [];
  private escalationLog: EscalationRequest[] = [];
  private escalationRateLimit: Map<string, number[]> = new Map(); // agentId → timestamps

  private escalationHandler?: (req: EscalationRequest) => EscalationResponse;

  constructor(config?: {
    escalationHandler?: (req: EscalationRequest) => EscalationResponse;
    maxEscalationsPerHour?: number;
  }) {
    this.escalationHandler = config?.escalationHandler;
    this.maxEscalationsPerHour = config?.maxEscalationsPerHour ?? 10;
  }

  private maxEscalationsPerHour: number;

  // ─── Grant / Revoke ────────────────────────────────────────

  /**
   * Grant a capability to an agent.
   */
  grant(capability: Omit<Capability, "id">): Capability {
    const cap: Capability = {
      ...capability,
      id: `cap_${randomUUID()}`,
    };

    this.capabilities.set(cap.id, cap);

    this.logAudit("capability_granted", cap.grantedBy, {
      capabilityId: cap.id,
      resource: cap.resource,
      actions: cap.actions,
      grantedTo: cap.grantedTo,
    });

    return cap;
  }

  /**
   * Revoke a capability.
   */
  revoke(capabilityId: string, revokedBy: string): boolean {
    const cap = this.capabilities.get(capabilityId);
    if (!cap) return false;
    if (!cap.revocable) return false;

    this.capabilities.delete(capabilityId);

    this.logAudit("capability_revoked", revokedBy, {
      capabilityId,
      resource: cap.resource,
      grantedTo: cap.grantedTo,
    });

    return true;
  }

  // ─── Permission Checking ───────────────────────────────────

  /**
   * Check if an agent has permission to perform an action on a resource.
   */
  check(agentId: string, resource: string, action: string): PermissionResult {
    const now = new Date();

    // Find all capabilities for this agent that match
    const matching = Array.from(this.capabilities.values()).filter((cap) => {
      // Must be granted to this agent
      if (cap.grantedTo !== agentId) return false;

      // Must match resource
      if (cap.resource !== resource && cap.resource !== "*") return false;

      // Must include the action
      if (!cap.actions.includes(action) && !cap.actions.includes("*")) return false;

      // Must not be expired
      if (cap.expiresAt && new Date(cap.expiresAt) < now) return false;

      // Check scope temporal bounds
      if (cap.scope.validAfter && now < new Date(cap.scope.validAfter)) return false;
      if (cap.scope.validBefore && now > new Date(cap.scope.validBefore)) return false;

      // Check conditions
      if (cap.conditions) {
        // Conditions are checked by the caller with context
        // Here we just verify the capability exists
      }

      return true;
    });

    if (matching.length === 0) {
      return {
        allowed: false,
        reason: `No capability grants ${action} on ${resource} to ${agentId}`,
        capabilityId: undefined,
      };
    }

    return {
      allowed: true,
      reason: "Capability matched",
      capabilityId: matching[0]!.id,
    };
  }

  /**
   * Check with conditions (for context-dependent permissions).
   */
  checkWithConditions(
    agentId: string,
    resource: string,
    action: string,
    context: Record<string, string | number>,
  ): PermissionResult {
    const baseResult = this.check(agentId, resource, action);
    if (!baseResult.allowed) return baseResult;

    // Verify conditions on the matched capability
    const cap = this.capabilities.get(baseResult.capabilityId!);
    if (!cap?.conditions || cap.conditions.length === 0) return baseResult;

    for (const condition of cap.conditions) {
      const contextValue = context[condition.field];
      if (contextValue === undefined) {
        return {
          allowed: false,
          reason: `Missing context field: ${condition.field}`,
          capabilityId: cap.id,
        };
      }

      if (!evaluateCondition(condition, contextValue)) {
        return {
          allowed: false,
          reason: `Condition failed: ${condition.field} ${condition.operator} ${condition.value}`,
          capabilityId: cap.id,
        };
      }
    }

    return baseResult;
  }

  // ─── Delegation ────────────────────────────────────────────

  /**
   * Delegate a capability from one agent to another.
   * The delegator must hold the capability and it must be delegatable.
   */
  delegate(capabilityId: string, fromAgent: string, toAgent: string): Capability | null {
    const original = this.capabilities.get(capabilityId);
    if (!original) return null;

    // Invariant: cannot delegate what you don't hold
    if (original.grantedTo !== fromAgent) return null;

    // Invariant: must be delegatable
    if (!original.delegatable) return null;

    // Create a derived capability (non-delegatable by default)
    const delegated = this.grant({
      resource: original.resource,
      actions: original.actions,
      scope: original.scope,
      grantedTo: toAgent,
      grantedBy: fromAgent,
      expiresAt: original.expiresAt,
      delegatable: false, // derived capabilities cannot be re-delegated
      revocable: true,
      conditions: original.conditions,
    });

    return delegated;
  }

  // ─── Escalation ────────────────────────────────────────────

  /**
   * Request a capability escalation (when an agent needs permission it doesn't have).
   */
  requestEscalation(request: EscalationRequest): EscalationResponse {
    // Rate limiting
    if (this.isRateLimited(request.requestedBy)) {
      return {
        requestId: request.requestId,
        granted: false,
        reason: "Escalation rate limit exceeded",
        approvedBy: "system:rate_limiter",
      };
    }

    this.escalationLog.push(request);
    this.recordEscalationTimestamp(request.requestedBy);

    this.logAudit("escalation_requested", request.requestedBy, {
      requestId: request.requestId,
      resource: request.capability.resource,
      actions: request.capability.actions,
      urgency: request.urgency,
    });

    // Use the configured handler (or default deny)
    if (this.escalationHandler) {
      const response = this.escalationHandler(request);

      if (response.granted && response.capability) {
        this.grant(response.capability);
      }

      this.logAudit("escalation_resolved", response.approvedBy, {
        requestId: request.requestId,
        granted: response.granted,
        reason: response.reason,
      });

      return response;
    }

    // Default: deny all escalations without a handler
    return {
      requestId: request.requestId,
      granted: false,
      reason: "No escalation handler configured",
      approvedBy: "system:default_deny",
    };
  }

  // ─── Query ─────────────────────────────────────────────────

  getAgentCapabilities(agentId: string): Capability[] {
    const now = new Date();
    return Array.from(this.capabilities.values()).filter(
      (cap) => cap.grantedTo === agentId && (!cap.expiresAt || new Date(cap.expiresAt) > now),
    );
  }

  getCapability(id: string): Capability | undefined {
    return this.capabilities.get(id);
  }

  getAllCapabilities(): Capability[] {
    return Array.from(this.capabilities.values());
  }

  getEscalationLog(): EscalationRequest[] {
    return [...this.escalationLog];
  }

  getAuditLog(): AuditEntry[] {
    return [...this.auditLog];
  }

  // ─── Maintenance ───────────────────────────────────────────

  /**
   * Remove all expired capabilities.
   */
  cleanupExpired(): number {
    const now = new Date();
    let removed = 0;

    for (const [id, cap] of this.capabilities) {
      if (cap.expiresAt && new Date(cap.expiresAt) < now) {
        this.capabilities.delete(id);
        removed++;
      }
    }

    return removed;
  }

  // ─── Internals ─────────────────────────────────────────────

  private isRateLimited(agentId: string): boolean {
    const timestamps = this.escalationRateLimit.get(agentId) ?? [];
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    const recentTimestamps = timestamps.filter((t) => t > oneHourAgo);
    this.escalationRateLimit.set(agentId, recentTimestamps);
    return recentTimestamps.length >= this.maxEscalationsPerHour;
  }

  private recordEscalationTimestamp(agentId: string): void {
    const timestamps = this.escalationRateLimit.get(agentId) ?? [];
    timestamps.push(Date.now());
    this.escalationRateLimit.set(agentId, timestamps);
  }

  private logAudit(
    action: AuditEntry["action"],
    agentId: string,
    details: Record<string, unknown>,
  ): void {
    this.auditLog.push({
      id: `audit_${randomUUID()}`,
      timestamp: new Date().toISOString(),
      action,
      agentId,
      details,
    });
  }
}

// ─── Types ───────────────────────────────────────────────────────

export interface PermissionResult {
  allowed: boolean;
  reason: string;
  capabilityId?: string;
}

// ─── Condition Evaluation ────────────────────────────────────────

function evaluateCondition(condition: CapabilityCondition, value: string | number): boolean {
  switch (condition.operator) {
    case "eq":
      return value === condition.value;
    case "neq":
      return value !== condition.value;
    case "in":
      return Array.isArray(condition.value) && condition.value.includes(String(value));
    case "gt":
      return typeof value === "number" && value > Number(condition.value);
    case "lt":
      return typeof value === "number" && value < Number(condition.value);
    default:
      return false;
  }
}
