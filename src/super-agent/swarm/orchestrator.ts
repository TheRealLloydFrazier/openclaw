/**
 * Swarm Orchestrator
 *
 * Manages a swarm of specialized agents that share a Memory Crystal.
 * Handles task decomposition, agent assignment, coordination, and
 * knowledge compounding.
 *
 * Key design decisions:
 * - Agents communicate through the crystal, not direct messaging
 * - Knowledge compounds: one agent's learning benefits all others
 * - Task assignment considers specialization and past performance
 */

import { randomUUID } from "node:crypto";
import type { CrystalStorage } from "../crystal/storage.js";
import type { TraceStore } from "../trace/store.js";
import type {
  AgentMetrics,
  AgentSpecialization,
  AgentStatus,
  SwarmAgent,
  SwarmTask,
  TaskDependency,
  TaskResult,
  TaskStatus,
  TrustLevel,
  WriteProposal,
} from "../types.js";

// ─── Swarm Orchestrator ──────────────────────────────────────────

export class SwarmOrchestrator {
  private agents: Map<string, SwarmAgent> = new Map();
  private tasks: Map<string, SwarmTask> = new Map();
  private dependencies: TaskDependency[] = [];
  private compoundingLog: CompoundingEvent[] = [];

  constructor(
    private crystal: CrystalStorage,
    private trace: TraceStore,
  ) {}

  // ─── Agent Lifecycle ───────────────────────────────────────

  registerAgent(config: {
    name: string;
    specialization: AgentSpecialization;
    capabilities: string[];
    trustLevel?: TrustLevel;
  }): SwarmAgent {
    const agent: SwarmAgent = {
      id: `agent_${randomUUID()}`,
      name: config.name,
      specialization: config.specialization,
      status: "idle",
      capabilities: config.capabilities,
      trustLevel: config.trustLevel ?? "OPERATIONAL",
      performanceMetrics: {
        tasksCompleted: 0,
        taskSuccessRate: 1.0,
        avgTaskDurationMs: 0,
        capsulesContributed: 0,
        capsuleUsefulnessAvg: 0,
        driftContribution: 0,
      },
    };

    this.agents.set(agent.id, agent);

    this.trace.record(agent.id, "task_received", {
      event: "agent_registered",
      name: config.name,
      domain: config.specialization.domain,
    });

    return agent;
  }

  deregisterAgent(agentId: string): boolean {
    const agent = this.agents.get(agentId);
    if (!agent) return false;

    // Reassign any active tasks
    if (agent.currentTask) {
      this.reassignTask(agent.currentTask);
    }

    this.agents.delete(agentId);
    return true;
  }

  getAgent(id: string): SwarmAgent | undefined {
    return this.agents.get(id);
  }

  getAllAgents(): SwarmAgent[] {
    return Array.from(this.agents.values());
  }

  getIdleAgents(): SwarmAgent[] {
    return this.getAllAgents().filter((a) => a.status === "idle");
  }

  // ─── Task Management ───────────────────────────────────────

  /**
   * Submit a task to the swarm. The orchestrator will decompose it
   * if needed and assign to the best available agent.
   */
  submitTask(config: {
    description: string;
    domain: string;
    requiredCapabilities?: string[];
    priority?: number;
    deadline?: string;
    parentId?: string;
  }): SwarmTask {
    const task: SwarmTask = {
      id: `task_${randomUUID()}`,
      parentId: config.parentId,
      description: config.description,
      domain: config.domain,
      requiredCapabilities: config.requiredCapabilities ?? [],
      status: "pending",
      priority: config.priority ?? 5,
      deadline: config.deadline,
      writeProposals: [],
    };

    this.tasks.set(task.id, task);

    // Try to assign immediately
    this.tryAssignTask(task);

    return task;
  }

  /**
   * Decompose a complex task into subtasks.
   */
  decompose(
    parentTaskId: string,
    subtasks: { description: string; domain: string; capabilities?: string[] }[],
    dependencyEdges?: { fromIndex: number; toIndex: number; type?: TaskDependency["type"] }[],
  ): SwarmTask[] {
    const parentTask = this.tasks.get(parentTaskId);
    if (!parentTask) {
      throw new Error(`Parent task ${parentTaskId} not found`);
    }

    // Step 1: Create all tasks (without assignment)
    const created: SwarmTask[] = [];
    for (const sub of subtasks) {
      const task: SwarmTask = {
        id: `task_${randomUUID()}`,
        parentId: parentTaskId,
        description: sub.description,
        domain: sub.domain,
        requiredCapabilities: sub.capabilities ?? [],
        status: "pending",
        priority: parentTask.priority,
        writeProposals: [],
      };
      this.tasks.set(task.id, task);
      created.push(task);
    }

    // Step 2: Register dependencies BEFORE assignment.
    // Reject cyclic dependency graphs up front — a cycle would leave every task
    // in the cycle permanently "blocked" with no way to make progress.
    if (dependencyEdges) {
      if (hasCycle(created.length, dependencyEdges)) {
        // Roll back the tasks we just created so the swarm state stays clean.
        for (const t of created) this.tasks.delete(t.id);
        throw new Error("Cyclic task dependencies detected; decomposition rejected");
      }
      for (const edge of dependencyEdges) {
        const fromTask = created[edge.fromIndex];
        const toTask = created[edge.toIndex];
        if (fromTask && toTask) {
          this.dependencies.push({
            from: fromTask.id,
            to: toTask.id,
            type: edge.type ?? "data",
          });
        }
      }
    }

    // Step 3: Now try to assign tasks (dependencies are registered)
    for (const task of created) {
      this.tryAssignTask(task);
    }

    return created;
  }

  /**
   * Report task completion with results and capsule proposals.
   */
  completeTask(taskId: string, result: TaskResult, writeProposals?: WriteProposal[]): void {
    const task = this.tasks.get(taskId);
    if (!task) return;

    task.status = "completed";
    task.result = result;

    if (writeProposals) {
      task.writeProposals = writeProposals;
      // Process write proposals through the crystal
      for (const proposal of writeProposals) {
        const writeResult = this.crystal.processWriteProposal(proposal);
        if (writeResult.committed && writeResult.capsuleId) {
          result.capsuleIds.push(writeResult.capsuleId);
        }
      }
    }

    // Update agent metrics
    if (task.assignedAgent) {
      const agent = this.agents.get(task.assignedAgent);
      if (agent) {
        agent.status = "idle";
        agent.currentTask = undefined;
        this.updateAgentMetrics(agent, task, true);
      }
    }

    // Log compounding event
    if (result.capsuleIds.length > 0) {
      for (const capsuleId of result.capsuleIds) {
        this.compoundingLog.push({
          sourceAgent: task.assignedAgent ?? "unknown",
          capsuleId,
          retrievedBy: [],
          usedInTasks: [],
          feedbackScores: [],
          promotionCandidate: false,
        });
      }
    }

    this.trace.record(task.assignedAgent ?? "orchestrator", "task_received", {
      event: "task_completed",
      taskId,
      capsuleCount: result.capsuleIds.length,
      confidence: result.confidence,
    });

    // Check if any blocked tasks can now proceed
    this.checkDependencies(taskId);
  }

  /**
   * Report task failure.
   */
  failTask(taskId: string, reason: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;

    task.status = "failed";

    if (task.assignedAgent) {
      const agent = this.agents.get(task.assignedAgent);
      if (agent) {
        agent.status = "idle";
        agent.currentTask = undefined;
        this.updateAgentMetrics(agent, task, false);
      }
    }

    this.trace.record(task.assignedAgent ?? "orchestrator", "error", {
      event: "task_failed",
      taskId,
      reason,
    });
  }

  getTask(id: string): SwarmTask | undefined {
    return this.tasks.get(id);
  }

  getTasksByStatus(status: TaskStatus): SwarmTask[] {
    return Array.from(this.tasks.values()).filter((t) => t.status === status);
  }

  // ─── Task Assignment ───────────────────────────────────────

  private tryAssignTask(task: SwarmTask): boolean {
    // Check dependencies first
    const blockedBy = this.dependencies
      .filter((d) => d.to === task.id)
      .map((d) => this.tasks.get(d.from))
      .filter((t) => t && t.status !== "completed");

    if (blockedBy.length > 0) {
      task.status = "blocked";
      return false;
    }

    // Find the best idle agent for this task
    const agent = this.findBestAgent(task);
    if (!agent) {
      return false; // no suitable agent available
    }

    task.status = "assigned";
    task.assignedAgent = agent.id;
    agent.status = "working";
    agent.currentTask = task.id;

    this.trace.record(agent.id, "task_received", {
      event: "task_assigned",
      taskId: task.id,
      agentId: agent.id,
      domain: task.domain,
    });

    return true;
  }

  private findBestAgent(task: SwarmTask): SwarmAgent | undefined {
    const idle = this.getIdleAgents();
    if (idle.length === 0) return undefined;

    // Score each agent for this task
    const scored = idle.map((agent) => ({
      agent,
      score: this.scoreAgentForTask(agent, task),
    }));

    // Filter agents with required capabilities
    const capable = scored.filter((s) =>
      task.requiredCapabilities.every((cap) => s.agent.capabilities.includes(cap)),
    );

    if (capable.length === 0) {
      // Fall back to any idle agent if no specialist available
      return scored.sort((a, b) => b.score - a.score)[0]?.agent;
    }

    return capable.sort((a, b) => b.score - a.score)[0]?.agent;
  }

  private scoreAgentForTask(agent: SwarmAgent, task: SwarmTask): number {
    let score = 0;

    // Domain match (most important)
    if (agent.specialization.domain === task.domain) {
      score += 0.5;
    }
    if (
      agent.specialization.subdomains.some((sd) =>
        task.description.toLowerCase().includes(sd.toLowerCase()),
      )
    ) {
      score += 0.2;
    }

    // Past performance
    score += agent.performanceMetrics.taskSuccessRate * 0.2;

    // Capability match
    const capMatch =
      task.requiredCapabilities.length === 0
        ? 1.0
        : task.requiredCapabilities.filter((c) => agent.capabilities.includes(c)).length /
          task.requiredCapabilities.length;
    score += capMatch * 0.1;

    return score;
  }

  private reassignTask(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;

    task.status = "pending";
    task.assignedAgent = undefined;
    this.tryAssignTask(task);
  }

  private checkDependencies(completedTaskId: string): void {
    const unblocked = this.dependencies.filter((d) => d.from === completedTaskId).map((d) => d.to);

    for (const taskId of unblocked) {
      const task = this.tasks.get(taskId);
      if (task && task.status === "blocked") {
        this.tryAssignTask(task);
      }
    }
  }

  // ─── Agent Metrics ─────────────────────────────────────────

  private updateAgentMetrics(agent: SwarmAgent, task: SwarmTask, success: boolean): void {
    const m = agent.performanceMetrics;
    const total = m.tasksCompleted + 1;

    m.taskSuccessRate = (m.taskSuccessRate * m.tasksCompleted + (success ? 1 : 0)) / total;
    m.tasksCompleted = total;
    m.capsulesContributed += task.result?.capsuleIds.length ?? 0;
  }

  // ─── Knowledge Compounding ─────────────────────────────────

  /**
   * Track when a capsule written by one agent is retrieved by another.
   * This measures the compounding effect of shared knowledge.
   */
  trackCapsuleRetrieval(capsuleId: string, retrievedByAgent: string): void {
    const event = this.compoundingLog.find((e) => e.capsuleId === capsuleId);
    if (event && !event.retrievedBy.includes(retrievedByAgent)) {
      event.retrievedBy.push(retrievedByAgent);
    }
  }

  /**
   * Track when a capsule influences a task result.
   */
  trackCapsuleUsage(capsuleId: string, taskId: string): void {
    const event = this.compoundingLog.find((e) => e.capsuleId === capsuleId);
    if (event && !event.usedInTasks.includes(taskId)) {
      event.usedInTasks.push(taskId);
    }
  }

  /**
   * Record feedback on a capsule's usefulness.
   */
  recordCapsuleFeedback(capsuleId: string, score: number): void {
    const event = this.compoundingLog.find((e) => e.capsuleId === capsuleId);
    if (event) {
      event.feedbackScores.push(score);

      // Check if this capsule should be promoted to CANON candidate
      if (
        event.retrievedBy.length >= 3 &&
        event.feedbackScores.length >= 3 &&
        average(event.feedbackScores) >= 0.8
      ) {
        event.promotionCandidate = true;
      }
    }
  }

  /**
   * Get the compounding rate: how much knowledge is being reused
   * across agents.
   */
  getCompoundingRate(): CompoundingMetrics {
    if (this.compoundingLog.length === 0) {
      return {
        totalCapsules: 0,
        crossAgentRetrievals: 0,
        avgRetrievalsByOthers: 0,
        promotionCandidates: 0,
        compoundingFactor: 0,
      };
    }

    const crossRetrievals = this.compoundingLog.filter((e) => e.retrievedBy.length > 0);
    const totalRetrievals = crossRetrievals.reduce((sum, e) => sum + e.retrievedBy.length, 0);
    const promotionCandidates = this.compoundingLog.filter((e) => e.promotionCandidate).length;

    return {
      totalCapsules: this.compoundingLog.length,
      crossAgentRetrievals: crossRetrievals.length,
      avgRetrievalsByOthers:
        this.compoundingLog.length > 0 ? totalRetrievals / this.compoundingLog.length : 0,
      promotionCandidates,
      compoundingFactor: crossRetrievals.length / Math.max(1, this.compoundingLog.length),
    };
  }

  getCompoundingLog(): CompoundingEvent[] {
    return [...this.compoundingLog];
  }

  // ─── Swarm Health ──────────────────────────────────────────

  getSwarmStatus(): SwarmStatus {
    const agents = this.getAllAgents();
    const tasks = Array.from(this.tasks.values());

    return {
      totalAgents: agents.length,
      idleAgents: agents.filter((a) => a.status === "idle").length,
      workingAgents: agents.filter((a) => a.status === "working").length,
      blockedAgents: agents.filter((a) => a.status === "blocked").length,
      totalTasks: tasks.length,
      pendingTasks: tasks.filter((t) => t.status === "pending").length,
      inProgressTasks: tasks.filter((t) => t.status === "in_progress" || t.status === "assigned")
        .length,
      completedTasks: tasks.filter((t) => t.status === "completed").length,
      failedTasks: tasks.filter((t) => t.status === "failed").length,
      compounding: this.getCompoundingRate(),
    };
  }
}

// ─── Types ───────────────────────────────────────────────────────

export interface CompoundingEvent {
  sourceAgent: string;
  capsuleId: string;
  retrievedBy: string[];
  usedInTasks: string[];
  feedbackScores: number[];
  promotionCandidate: boolean;
}

export interface CompoundingMetrics {
  totalCapsules: number;
  crossAgentRetrievals: number;
  avgRetrievalsByOthers: number;
  promotionCandidates: number;
  compoundingFactor: number; // 0-1: fraction of capsules reused by other agents
}

export interface SwarmStatus {
  totalAgents: number;
  idleAgents: number;
  workingAgents: number;
  blockedAgents: number;
  totalTasks: number;
  pendingTasks: number;
  inProgressTasks: number;
  completedTasks: number;
  failedTasks: number;
  compounding: CompoundingMetrics;
}

// ─── Helpers ─────────────────────────────────────────────────────

function average(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/**
 * Detect a cycle in a dependency graph over `nodeCount` tasks given edges
 * expressed as fromIndex -> toIndex. Uses DFS three-color marking.
 */
function hasCycle(
  nodeCount: number,
  edges: { fromIndex: number; toIndex: number }[],
): boolean {
  const adjacency: number[][] = Array.from({ length: nodeCount }, () => []);
  for (const edge of edges) {
    if (
      edge.fromIndex >= 0 &&
      edge.fromIndex < nodeCount &&
      edge.toIndex >= 0 &&
      edge.toIndex < nodeCount
    ) {
      adjacency[edge.fromIndex]!.push(edge.toIndex);
    }
  }

  // 0 = unvisited, 1 = in-progress (on current DFS stack), 2 = done
  const state = new Array<number>(nodeCount).fill(0);

  const visit = (node: number): boolean => {
    state[node] = 1;
    for (const next of adjacency[node]!) {
      if (state[next] === 1) return true; // back-edge => cycle
      if (state[next] === 0 && visit(next)) return true;
    }
    state[node] = 2;
    return false;
  };

  for (let i = 0; i < nodeCount; i++) {
    if (state[i] === 0 && visit(i)) return true;
  }
  return false;
}
