/**
 * Crystal Storage - In-memory storage backend for the Memory Crystal.
 *
 * Implements capsule CRUD, append-only audit log, and index management.
 * This is a reference implementation; production would use SQLite or similar.
 */

import { randomUUID } from "node:crypto";
import type {
  AuditAction,
  AuditEntry,
  Capsule,
  DeterminativeTag,
  PromotionRecord,
  TrustLevel,
  WriteProposal,
  WriteResult,
} from "../types.js";
import { TRUST_RANK } from "../types.js";
import { hashContent, isCapsuleExpired, validateCapsule } from "./capsule.js";

// ─── Crystal Storage ─────────────────────────────────────────────

export class CrystalStorage {
  private capsules: Map<string, Capsule> = new Map();
  private auditLog: AuditEntry[] = [];
  private contentHashIndex: Map<string, string> = new Map(); // hash → capsule ID

  // ─── Read Operations ───────────────────────────────────────

  getCapsule(id: string): Capsule | undefined {
    const capsule = this.capsules.get(id);
    if (!capsule) return undefined;
    // Record the access on the stored capsule...
    capsule.accessedAt = new Date().toISOString();
    capsule.accessCount++;
    // ...but hand the caller a copy so external mutation cannot bypass the
    // propose-validate-commit write path or corrupt stored state.
    return { ...capsule, tags: [...capsule.tags] };
  }

  /**
   * Read a capsule WITHOUT recording an access (no accessedAt/accessCount
   * bump). Use this for maintenance/introspection reads (annealing, drift
   * scans) so background sweeps do not inflate usage metrics.
   */
  peekCapsule(id: string): Capsule | undefined {
    const capsule = this.capsules.get(id);
    if (!capsule) return undefined;
    return { ...capsule, tags: [...capsule.tags] };
  }

  getCapsules(ids: string[]): Capsule[] {
    return ids.map((id) => this.getCapsule(id)).filter((c): c is Capsule => c !== undefined);
  }

  getAllCapsules(): Capsule[] {
    return Array.from(this.capsules.values());
  }

  getCapsuleCount(): number {
    return this.capsules.size;
  }

  // ─── Query by Metadata ─────────────────────────────────────

  getCapsulesByTrust(trust: TrustLevel): Capsule[] {
    return this.getAllCapsules().filter((c) => c.trust === trust);
  }

  getCapsulesByType(type: Capsule["type"]): Capsule[] {
    return this.getAllCapsules().filter((c) => c.type === type);
  }

  getCapsulesByTag(category: DeterminativeTag["category"], value?: string): Capsule[] {
    return this.getAllCapsules().filter((c) =>
      c.tags.some((t) => t.category === category && (value === undefined || t.value === value)),
    );
  }

  getCapsulesByAgent(agentId: string): Capsule[] {
    return this.getAllCapsules().filter((c) => c.sourceAgentId === agentId);
  }

  getExpiredCapsules(now: Date = new Date()): Capsule[] {
    return this.getAllCapsules().filter((c) => isCapsuleExpired(c, now));
  }

  // ─── Write Path (Propose → Validate → Commit) ─────────────

  /**
   * Process a write proposal through the validation pipeline.
   * Agents never write directly; they propose, and the crystal validates.
   */
  processWriteProposal(proposal: WriteProposal): WriteResult {
    const errors: string[] = [];

    // Step 1: Validate the proposal itself
    if (!proposal.proposedBy) {
      errors.push("Proposal must have a proposedBy agent ID");
    }
    if (!proposal.capsule.content) {
      errors.push("Proposal must include capsule content");
    }
    if (!proposal.justification) {
      errors.push("Proposal must include justification");
    }

    if (errors.length > 0) {
      this.logAudit("write_rejected", proposal.proposedBy, {
        proposalId: proposal.proposalId,
        errors,
      });
      return {
        proposalId: proposal.proposalId,
        committed: false,
        validationErrors: errors,
      };
    }

    switch (proposal.operation) {
      case "create":
        return this.commitCreate(proposal);
      case "update":
        return this.commitUpdate(proposal);
      case "archive":
        return this.commitArchive(proposal);
      case "promote":
        return this.commitPromote(proposal);
      case "demote":
        return this.commitDemote(proposal);
      default:
        return {
          proposalId: proposal.proposalId,
          committed: false,
          validationErrors: [`Unknown operation: ${proposal.operation}`],
        };
    }
  }

  private commitCreate(proposal: WriteProposal): WriteResult {
    // Step 2: Duplicate detection (content hash)
    const contentHash = hashContent(proposal.capsule.content);
    const existingId = this.contentHashIndex.get(contentHash);
    if (existingId) {
      return {
        proposalId: proposal.proposalId,
        committed: false,
        capsuleId: existingId,
        reason: `Duplicate content: capsule ${existingId} has identical content`,
        validationErrors: ["Duplicate content detected"],
      };
    }

    // Step 3: Trust gate - CANON requires governed approval
    if (proposal.targetTrust === "CANON" && proposal.proposedBy !== "governance") {
      return {
        proposalId: proposal.proposalId,
        committed: false,
        reason: "CANON trust requires governed approval",
        validationErrors: ["Cannot create CANON capsule without governance approval"],
      };
    }

    // Step 4: Build the full capsule
    const now = new Date().toISOString();
    const capsule: Capsule = {
      id: proposal.capsule.id ?? `cap_${randomUUID()}`,
      type: proposal.capsule.type ?? "observation",
      version: 1,
      content: proposal.capsule.content,
      contentHash,
      embedding: proposal.capsule.embedding,
      trust: proposal.targetTrust,
      tags: proposal.capsule.tags ?? [],
      promotionHistory: [],
      createdAt: now,
      updatedAt: now,
      accessedAt: now,
      ttl: proposal.capsule.ttl,
      provenance: proposal.capsule.provenance ?? [],
      sourceAgentId: proposal.proposedBy,
      parentCapsuleIds: proposal.capsule.parentCapsuleIds ?? [],
      accessCount: 0,
      usefulness: 0,
    };

    // Step 5: Schema validation
    const validationErrors = validateCapsule(capsule);
    if (validationErrors.length > 0) {
      return {
        proposalId: proposal.proposalId,
        committed: false,
        validationErrors: validationErrors.map((e) => `${e.field}: ${e.message}`),
      };
    }

    // Step 6: Commit
    this.capsules.set(capsule.id, capsule);
    this.contentHashIndex.set(contentHash, capsule.id);

    this.logAudit("capsule_created", proposal.proposedBy, {
      proposalId: proposal.proposalId,
      capsuleId: capsule.id,
      type: capsule.type,
      trust: capsule.trust,
    });

    return {
      proposalId: proposal.proposalId,
      committed: true,
      capsuleId: capsule.id,
    };
  }

  private commitUpdate(proposal: WriteProposal): WriteResult {
    const capsuleId = proposal.capsule.id;
    if (!capsuleId) {
      return {
        proposalId: proposal.proposalId,
        committed: false,
        validationErrors: ["Update requires capsule ID"],
      };
    }

    const existing = this.capsules.get(capsuleId);
    if (!existing) {
      return {
        proposalId: proposal.proposalId,
        committed: false,
        validationErrors: [`Capsule ${capsuleId} not found`],
      };
    }

    // Cannot update CANON without governance
    if (existing.trust === "CANON" && proposal.proposedBy !== "governance") {
      return {
        proposalId: proposal.proposalId,
        committed: false,
        validationErrors: ["Cannot update CANON capsule without governance"],
      };
    }

    const now = new Date().toISOString();
    const updated: Capsule = {
      ...existing,
      content: proposal.capsule.content,
      contentHash: hashContent(proposal.capsule.content),
      version: existing.version + 1,
      updatedAt: now,
      tags: proposal.capsule.tags ?? existing.tags,
      provenance: [...existing.provenance, ...(proposal.capsule.provenance ?? [])],
    };

    // Re-index content hash
    this.contentHashIndex.delete(existing.contentHash);
    this.contentHashIndex.set(updated.contentHash, capsuleId);

    this.capsules.set(capsuleId, updated);

    this.logAudit("capsule_updated", proposal.proposedBy, {
      proposalId: proposal.proposalId,
      capsuleId,
      fromVersion: existing.version,
      toVersion: updated.version,
    });

    return {
      proposalId: proposal.proposalId,
      committed: true,
      capsuleId,
    };
  }

  private commitArchive(proposal: WriteProposal): WriteResult {
    const capsuleId = proposal.capsule.id;
    if (!capsuleId) {
      return {
        proposalId: proposal.proposalId,
        committed: false,
        validationErrors: ["Archive requires capsule ID"],
      };
    }

    const existing = this.capsules.get(capsuleId);
    if (!existing) {
      return {
        proposalId: proposal.proposalId,
        committed: false,
        validationErrors: [`Capsule ${capsuleId} not found`],
      };
    }

    // Archive = set trust to UNTRUSTED + add archived tag
    // Never delete: Memory Statue v2 Rule 1 - never delete raw sources
    const archived: Capsule = {
      ...existing,
      trust: "UNTRUSTED",
      tags: [...existing.tags, { category: "authority", value: "ARCHIVED", enforced: true }],
      updatedAt: new Date().toISOString(),
      version: existing.version + 1,
    };

    this.capsules.set(capsuleId, archived);

    this.logAudit("capsule_archived", proposal.proposedBy, {
      proposalId: proposal.proposalId,
      capsuleId,
    });

    return {
      proposalId: proposal.proposalId,
      committed: true,
      capsuleId,
    };
  }

  private commitPromote(proposal: WriteProposal): WriteResult {
    const capsuleId = proposal.capsule.id;
    if (!capsuleId) {
      return {
        proposalId: proposal.proposalId,
        committed: false,
        validationErrors: ["Promote requires capsule ID"],
      };
    }

    const existing = this.capsules.get(capsuleId);
    if (!existing) {
      return {
        proposalId: proposal.proposalId,
        committed: false,
        validationErrors: [`Capsule ${capsuleId} not found`],
      };
    }

    // Trust can only go up
    if (TRUST_RANK[proposal.targetTrust] <= TRUST_RANK[existing.trust]) {
      return {
        proposalId: proposal.proposalId,
        committed: false,
        validationErrors: [`Cannot promote from ${existing.trust} to ${proposal.targetTrust}`],
      };
    }

    // CANON promotion requires governance
    if (proposal.targetTrust === "CANON" && proposal.proposedBy !== "governance") {
      return {
        proposalId: proposal.proposalId,
        committed: false,
        validationErrors: ["CANON promotion requires governed approval"],
      };
    }

    const promotionRecord: PromotionRecord = {
      from: existing.trust,
      to: proposal.targetTrust,
      timestamp: new Date().toISOString(),
      approvedBy: proposal.proposedBy,
      reason: proposal.justification,
      reversible: proposal.targetTrust !== "CANON",
    };

    const promoted: Capsule = {
      ...existing,
      trust: proposal.targetTrust,
      promotionHistory: [...existing.promotionHistory, promotionRecord],
      updatedAt: new Date().toISOString(),
      version: existing.version + 1,
    };

    this.capsules.set(capsuleId, promoted);

    this.logAudit("capsule_promoted", proposal.proposedBy, {
      proposalId: proposal.proposalId,
      capsuleId,
      from: existing.trust,
      to: proposal.targetTrust,
    });

    return {
      proposalId: proposal.proposalId,
      committed: true,
      capsuleId,
    };
  }

  private commitDemote(proposal: WriteProposal): WriteResult {
    const capsuleId = proposal.capsule.id;
    if (!capsuleId) {
      return {
        proposalId: proposal.proposalId,
        committed: false,
        validationErrors: ["Demote requires capsule ID"],
      };
    }

    const existing = this.capsules.get(capsuleId);
    if (!existing) {
      return {
        proposalId: proposal.proposalId,
        committed: false,
        validationErrors: [`Capsule ${capsuleId} not found`],
      };
    }

    if (TRUST_RANK[proposal.targetTrust] >= TRUST_RANK[existing.trust]) {
      return {
        proposalId: proposal.proposalId,
        committed: false,
        validationErrors: [`Cannot demote from ${existing.trust} to ${proposal.targetTrust}`],
      };
    }

    const promotionRecord: PromotionRecord = {
      from: existing.trust,
      to: proposal.targetTrust,
      timestamp: new Date().toISOString(),
      approvedBy: proposal.proposedBy,
      reason: proposal.justification,
      reversible: true,
    };

    const demoted: Capsule = {
      ...existing,
      trust: proposal.targetTrust,
      promotionHistory: [...existing.promotionHistory, promotionRecord],
      updatedAt: new Date().toISOString(),
      version: existing.version + 1,
    };

    this.capsules.set(capsuleId, demoted);

    this.logAudit("capsule_demoted", proposal.proposedBy, {
      proposalId: proposal.proposalId,
      capsuleId,
      from: existing.trust,
      to: proposal.targetTrust,
    });

    return {
      proposalId: proposal.proposalId,
      committed: true,
      capsuleId,
    };
  }

  // ─── Audit Log ─────────────────────────────────────────────

  private logAudit(action: AuditAction, agentId: string, details: Record<string, unknown>): void {
    this.auditLog.push({
      id: `audit_${randomUUID()}`,
      timestamp: new Date().toISOString(),
      action,
      agentId,
      details,
      capsuleId: details.capsuleId as string | undefined,
      proposalId: details.proposalId as string | undefined,
    });
  }

  getAuditLog(filter?: {
    action?: AuditAction;
    agentId?: string;
    after?: string;
    limit?: number;
  }): AuditEntry[] {
    let entries = this.auditLog;

    if (filter?.action) {
      entries = entries.filter((e) => e.action === filter.action);
    }
    if (filter?.agentId) {
      entries = entries.filter((e) => e.agentId === filter.agentId);
    }
    if (filter?.after) {
      entries = entries.filter((e) => e.timestamp > filter.after!);
    }
    if (filter?.limit) {
      entries = entries.slice(-filter.limit);
    }

    return entries;
  }

  getAuditLogSize(): number {
    return this.auditLog.length;
  }

  // ─── Bulk Operations (for maintenance/annealing) ───────────

  bulkUpdateEmbeddings(updates: Map<string, number[]>): number {
    let count = 0;
    for (const [id, embedding] of updates) {
      const capsule = this.capsules.get(id);
      if (capsule) {
        capsule.embedding = embedding;
        capsule.updatedAt = new Date().toISOString();
        count++;
      }
    }
    if (count > 0) {
      // Keep the audit trail complete: even bulk maintenance writes are logged.
      this.logAudit("capsule_updated", "system:reindex", {
        reason: "bulk embedding update",
        count,
      });
    }
    return count;
  }

  /**
   * Expire capsules that have passed their TTL.
   * Returns the IDs of expired capsules.
   */
  expireStaleCapsules(now: Date = new Date()): string[] {
    const expired: string[] = [];
    for (const capsule of this.capsules.values()) {
      if (isCapsuleExpired(capsule, now)) {
        const action = capsule.ttl?.onExpiry ?? "archive";
        if (action === "archive") {
          capsule.trust = "UNTRUSTED";
          capsule.tags.push({
            category: "freshness",
            value: "EXPIRED",
            enforced: true,
          });
        } else if (action === "quarantine") {
          capsule.trust = "UNTRUSTED";
          capsule.tags.push({
            category: "freshness",
            value: "QUARANTINED",
            enforced: true,
          });
        }
        // "delete" intentionally does NOT delete - Memory Statue v2 Rule 1
        // We archive instead
        capsule.updatedAt = now.toISOString();
        expired.push(capsule.id);

        this.logAudit("capsule_archived", "system:ttl", {
          capsuleId: capsule.id,
          reason: "TTL expired",
          expiresAt: capsule.ttl?.expiresAt,
        });
      }
    }
    return expired;
  }
}
