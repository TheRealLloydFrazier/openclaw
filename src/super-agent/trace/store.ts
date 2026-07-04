/**
 * Reasoning Trace Store
 *
 * Append-only storage for agent decision traces. Provides full
 * observability into agent reasoning, retrieval, and actions.
 * Every agent action produces a trace event that can be replayed.
 */

import { randomUUID } from "node:crypto";
import type { DefectVector, TimeRange, TraceEvent, TraceEventType } from "../types.js";

// ─── Trace Store ─────────────────────────────────────────────────

export class TraceStore {
  private events: TraceEvent[] = [];
  private eventIndex: Map<string, number> = new Map(); // event ID → array index

  // ─── Write ─────────────────────────────────────────────────

  append(event: TraceEvent): void {
    this.eventIndex.set(event.id, this.events.length);
    this.events.push(event);
  }

  /**
   * Helper: create and append a trace event in one call.
   */
  record(
    agentId: string,
    type: TraceEventType,
    data: Record<string, unknown>,
    options?: {
      taskId?: string;
      parentEventId?: string;
      durationMs?: number;
    },
  ): TraceEvent {
    const event: TraceEvent = {
      id: `trace_${randomUUID()}`,
      timestamp: new Date().toISOString(),
      agentId,
      type,
      data,
      taskId: options?.taskId,
      parentEventId: options?.parentEventId,
      durationMs: options?.durationMs,
    };
    this.append(event);
    return event;
  }

  // ─── Read ──────────────────────────────────────────────────

  getEvent(id: string): TraceEvent | undefined {
    const index = this.eventIndex.get(id);
    if (index === undefined) return undefined;
    return this.events[index];
  }

  getEventCount(): number {
    return this.events.length;
  }

  // ─── Queries ───────────────────────────────────────────────

  byAgent(agentId: string): TraceEvent[] {
    return this.events.filter((e) => e.agentId === agentId);
  }

  byTask(taskId: string): TraceEvent[] {
    return this.events.filter((e) => e.taskId === taskId);
  }

  byType(type: TraceEventType, timeRange?: TimeRange): TraceEvent[] {
    let filtered = this.events.filter((e) => e.type === type);
    if (timeRange) {
      filtered = this.filterByTime(filtered, timeRange);
    }
    return filtered;
  }

  /**
   * Get the full chain of events that led to a specific event.
   * Follows parentEventId links backwards.
   */
  traceChain(eventId: string): TraceEvent[] {
    const chain: TraceEvent[] = [];
    const visited = new Set<string>(); // guard against circular parent references
    let currentId: string | undefined = eventId;

    while (currentId) {
      if (visited.has(currentId)) break; // cycle detected; stop to avoid infinite loop
      visited.add(currentId);
      const event = this.getEvent(currentId);
      if (!event) break;
      chain.unshift(event); // prepend to maintain chronological order
      currentId = event.parentEventId;
    }

    return chain;
  }

  /**
   * Get all child events for a given parent event.
   */
  children(parentEventId: string): TraceEvent[] {
    return this.events.filter((e) => e.parentEventId === parentEventId);
  }

  /**
   * Get the full reasoning path from a task start to completion.
   */
  reasoningPath(taskId: string): TraceEvent[] {
    return this.events
      .filter((e) => e.taskId === taskId)
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  /**
   * Get drift measurements over time.
   */
  driftTimeline(timeRange?: TimeRange): { timestamp: string; defects: DefectVector }[] {
    const driftEvents = this.byType("drift_measurement", timeRange);
    return driftEvents
      .filter((e) => e.data.defects)
      .map((e) => ({
        timestamp: e.timestamp,
        defects: e.data.defects as DefectVector,
      }));
  }

  /**
   * Get all errors within a time range.
   */
  errors(timeRange?: TimeRange): TraceEvent[] {
    return this.byType("error", timeRange);
  }

  /**
   * Get agent activity summary.
   */
  agentSummary(agentId: string): AgentTraceSummary {
    const agentEvents = this.byAgent(agentId);
    const typeCount = new Map<TraceEventType, number>();

    for (const event of agentEvents) {
      typeCount.set(event.type, (typeCount.get(event.type) ?? 0) + 1);
    }

    const errors = agentEvents.filter((e) => e.type === "error");
    const llmCalls = agentEvents.filter((e) => e.type === "llm_call_result");
    const totalLatency = llmCalls.reduce((sum, e) => sum + (e.durationMs ?? 0), 0);

    return {
      agentId,
      totalEvents: agentEvents.length,
      eventsByType: typeCount,
      errorCount: errors.length,
      llmCallCount: llmCalls.length,
      avgLLMLatencyMs: llmCalls.length > 0 ? totalLatency / llmCalls.length : 0,
      firstEvent: agentEvents[0]?.timestamp,
      lastEvent: agentEvents[agentEvents.length - 1]?.timestamp,
    };
  }

  // ─── Maintenance ───────────────────────────────────────────

  /**
   * Compact old traces (keep summaries, discard details).
   * Only compacts events before the given timestamp.
   */
  compact(before: string): CompactionResult {
    const cutoff = new Date(before).getTime();
    let compacted = 0;

    // Keep all events but strip large data payloads from old events
    for (const event of this.events) {
      if (new Date(event.timestamp).getTime() < cutoff) {
        // Preserve event metadata, compress data
        if (event.data && JSON.stringify(event.data).length > 1000) {
          event.data = {
            _compacted: true,
            _originalKeys: Object.keys(event.data),
            type: event.data.type,
          };
          compacted++;
        }
      }
    }

    return { compactedEvents: compacted, totalEvents: this.events.length };
  }

  /**
   * Export traces in JSON format (compatible with external tools).
   */
  export(
    format: "json" | "jsonl",
    filter?: { agentId?: string; taskId?: string; timeRange?: TimeRange },
  ): string {
    let events = this.events;

    if (filter?.agentId) {
      events = events.filter((e) => e.agentId === filter.agentId);
    }
    if (filter?.taskId) {
      events = events.filter((e) => e.taskId === filter.taskId);
    }
    if (filter?.timeRange) {
      events = this.filterByTime(events, filter.timeRange);
    }

    if (format === "jsonl") {
      return events.map((e) => JSON.stringify(e)).join("\n");
    }
    return JSON.stringify(events, null, 2);
  }

  // ─── Helpers ───────────────────────────────────────────────

  private filterByTime(events: TraceEvent[], range: TimeRange): TraceEvent[] {
    return events.filter((e) => {
      if (range.after && e.timestamp < range.after) return false;
      if (range.before && e.timestamp > range.before) return false;
      return true;
    });
  }
}

// ─── Types ───────────────────────────────────────────────────────

export interface AgentTraceSummary {
  agentId: string;
  totalEvents: number;
  eventsByType: Map<TraceEventType, number>;
  errorCount: number;
  llmCallCount: number;
  avgLLMLatencyMs: number;
  firstEvent?: string;
  lastEvent?: string;
}

export interface CompactionResult {
  compactedEvents: number;
  totalEvents: number;
}
