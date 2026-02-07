/**
 * Capsule - The atomic unit of memory in the Memory Crystal.
 *
 * Implements the capsule schema from Memory Statue v2 (Frazier, 2026) Section 5.
 * Capsules are typed, tagged, provenance-tracked knowledge records.
 */

import { createHash, randomUUID } from "node:crypto";
import type {
  Capsule,
  CapsuleType,
  DeterminativeTag,
  ProvenanceEntry,
  TTLPolicy,
  TrustLevel,
} from "../types.js";

// ─── Capsule Creation ────────────────────────────────────────────

export interface CreateCapsuleInput {
  type: CapsuleType;
  content: string;
  trust: TrustLevel;
  tags?: DeterminativeTag[];
  ttl?: TTLPolicy;
  provenance?: ProvenanceEntry[];
  sourceAgentId?: string;
  parentCapsuleIds?: string[];
}

export function createCapsule(input: CreateCapsuleInput): Capsule {
  const now = new Date().toISOString();
  return {
    id: `cap_${randomUUID()}`,
    type: input.type,
    version: 1,
    content: input.content,
    contentHash: hashContent(input.content),
    trust: input.trust,
    tags: input.tags ?? [],
    promotionHistory: [],
    createdAt: now,
    updatedAt: now,
    accessedAt: now,
    ttl: input.ttl,
    provenance: input.provenance ?? [],
    sourceAgentId: input.sourceAgentId,
    parentCapsuleIds: input.parentCapsuleIds ?? [],
    accessCount: 0,
    usefulness: 0,
  };
}

// ─── Content Hashing ─────────────────────────────────────────────

export function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

// ─── Validation ──────────────────────────────────────────────────

const VALID_TYPES: Set<CapsuleType> = new Set([
  "observation",
  "decision",
  "policy",
  "state_card",
  "summary",
  "skill",
  "artifact",
  "correction",
  "reflection",
]);

const VALID_TRUST_LEVELS: Set<TrustLevel> = new Set(["CANON", "OPERATIONAL", "DRAFT", "UNTRUSTED"]);

export interface ValidationError {
  field: string;
  message: string;
}

export function validateCapsule(capsule: Capsule): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!capsule.id || typeof capsule.id !== "string") {
    errors.push({ field: "id", message: "Capsule must have a string ID" });
  }

  if (!VALID_TYPES.has(capsule.type)) {
    errors.push({
      field: "type",
      message: `Invalid capsule type: ${capsule.type}`,
    });
  }

  if (!capsule.content || typeof capsule.content !== "string") {
    errors.push({
      field: "content",
      message: "Capsule must have string content",
    });
  }

  if (capsule.content && hashContent(capsule.content) !== capsule.contentHash) {
    errors.push({
      field: "contentHash",
      message: "Content hash does not match content",
    });
  }

  if (!VALID_TRUST_LEVELS.has(capsule.trust)) {
    errors.push({
      field: "trust",
      message: `Invalid trust level: ${capsule.trust}`,
    });
  }

  if (!Array.isArray(capsule.tags)) {
    errors.push({ field: "tags", message: "Tags must be an array" });
  }

  if (!Array.isArray(capsule.provenance)) {
    errors.push({
      field: "provenance",
      message: "Provenance must be an array",
    });
  }

  if (typeof capsule.version !== "number" || capsule.version < 1) {
    errors.push({
      field: "version",
      message: "Version must be a positive integer",
    });
  }

  if (!capsule.createdAt) {
    errors.push({
      field: "createdAt",
      message: "Capsule must have a createdAt timestamp",
    });
  }

  return errors;
}

// ─── TTL Checking ────────────────────────────────────────────────

export function isCapsuleExpired(capsule: Capsule, now: Date = new Date()): boolean {
  if (!capsule.ttl?.expiresAt) return false;
  return now >= new Date(capsule.ttl.expiresAt);
}

export function isCapsuleStale(capsule: Capsule, now: Date = new Date()): boolean {
  if (!capsule.ttl?.refreshAfter) return false;
  return now >= new Date(capsule.ttl.refreshAfter);
}

// ─── Tag Utilities ───────────────────────────────────────────────

export function hasTag(
  capsule: Capsule,
  category: DeterminativeTag["category"],
  value?: string,
): boolean {
  return capsule.tags.some(
    (t) => t.category === category && (value === undefined || t.value === value),
  );
}

export function getEnforcedTags(capsule: Capsule): DeterminativeTag[] {
  return capsule.tags.filter((t) => t.enforced);
}

// ─── Capsule Comparison ──────────────────────────────────────────

export function capsuleContentEquals(a: Capsule, b: Capsule): boolean {
  return a.contentHash === b.contentHash;
}

// ─── Estimated Token Count ───────────────────────────────────────
// Rough approximation: 1 token per 4 characters for English text

export function estimateTokens(content: string): number {
  return Math.ceil(content.length / 4);
}
