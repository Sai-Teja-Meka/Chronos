/**
 * Metrics Calculation Utilities for Arena View
 * Calculates comprehensive metrics for branch comparison
 */

import type { Node, Edge } from 'reactflow';

export interface BranchMetrics {
    branchId: string;
    branchName: string;
    tipNodeId: string;

    // Core metrics
    totalSteps: number;
    totalTokens: number;
    totalLatency: number;
    estimatedCost: number;

    // Status
    hasErrors: boolean;
    completionRate: number;

    // Breakdown
    userMessages: number;
    assistantMessages: number;
    toolCalls: number;
    toolResults: number;
    errors: number;
}

/**
 * GPT-3.5 Turbo pricing (as of 2024)
 * Input: $0.0005 per 1K tokens
 * Output: $0.0015 per 1K tokens
 */
const PRICING = {
    'gpt-3.5-turbo': {
        input: 0.0005 / 1000,   // per token
        output: 0.0015 / 1000,  // per token
    },
    'gpt-4': {
        input: 0.03 / 1000,
        output: 0.06 / 1000,
    },
    'claude-3-sonnet': {
        input: 0.003 / 1000,
        output: 0.015 / 1000,
    }
};

/**
 * Traces a branch from tip node back to root
 */
function traceBranch(tipNodeId: string, nodes: Node[], edges: Edge[]): string[] {
    const parentMap = new Map<string, string>();
    edges.forEach(edge => {
        parentMap.set(edge.target, edge.source);
    });

    const path: string[] = [];
    let current: string | undefined = tipNodeId;

    while (current) {
        path.push(current);
        current = parentMap.get(current);
    }

    return path.reverse(); // Root to tip
}

/**
 * Calculates metrics for a single branch
 */
export function calculateBranchMetrics(
    tipNodeId: string,
    nodes: Node[],
    edges: Edge[],
    branchName?: string
): BranchMetrics {
    // Get all nodes in this branch
    const branchPath = traceBranch(tipNodeId, nodes, edges);
    const branchNodes = nodes.filter(n => branchPath.includes(n.id));

    // Initialize counters
    let totalTokens = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalLatency = 0;
    let userMessages = 0;
    let assistantMessages = 0;
    let toolCalls = 0;
    let toolResults = 0;
    let errors = 0;
    let completedSteps = 0;

    // Calculate metrics
    branchNodes.forEach(node => {
        const { label, metadata, payload } = node.data;

        // Count event types
        switch (label) {
            case 'user_message': userMessages++; break;
            case 'assistant_message': assistantMessages++; break;
            case 'tool_call': toolCalls++; break;
            case 'tool_result': toolResults++; break;
            case 'error': errors++; break;
        }

        // Aggregate tokens
        if (metadata) {
            const inputTokens = metadata['gen_ai.usage.input_tokens'] || 0;
            const outputTokens = metadata['gen_ai.usage.output_tokens'] || 0;

            totalInputTokens += inputTokens;
            totalOutputTokens += outputTokens;
            totalTokens += inputTokens + outputTokens;

            // Aggregate latency
            const latency = metadata['latency_ms'] || 0;
            totalLatency += latency;
        }

        // Completion tracking (non-error events count as completed)
        if (label !== 'error') {
            completedSteps++;
        }
    });

    // Estimate cost (assuming GPT-3.5 Turbo for now)
    const model = 'gpt-3.5-turbo';
    const pricing = PRICING[model];
    const estimatedCost =
        (totalInputTokens * pricing.input) +
        (totalOutputTokens * pricing.output);

    // Completion rate
    const completionRate = branchNodes.length > 0
        ? completedSteps / branchNodes.length
        : 0;

    // Generate branch name if not provided
    const tipNode = nodes.find(n => n.id === tipNodeId);
    const defaultName = tipNode
        ? `Branch #${tipNode.data.sequence}`
        : `Branch ${tipNodeId.slice(0, 8)}`;

    return {
        branchId: tipNodeId,
        branchName: branchName || defaultName,
        tipNodeId,
        totalSteps: branchNodes.length,
        totalTokens,
        totalLatency,
        estimatedCost,
        hasErrors: errors > 0,
        completionRate,
        userMessages,
        assistantMessages,
        toolCalls,
        toolResults,
        errors
    };
}

/**
 * Finds all leaf nodes (branch tips) in the graph
 */
export function findBranchTips(nodes: Node[], edges: Edge[]): string[] {
    // Nodes that are not sources in any edge are leaf nodes
    const sourceIds = new Set(edges.map(e => e.source));
    const leafNodes = nodes.filter(n => !sourceIds.has(n.id));

    return leafNodes.map(n => n.id);
}

/**
 * Calculates metrics for all branches in the graph
 */
export function calculateAllBranchMetrics(
    nodes: Node[],
    edges: Edge[]
): BranchMetrics[] {
    const tipIds = findBranchTips(nodes, edges);

    return tipIds.map((tipId, index) =>
        calculateBranchMetrics(tipId, nodes, edges, `Branch ${String.fromCharCode(65 + index)}`)
    );
}

/**
 * Compares two branches and returns delta metrics
 */
export function compareBranches(
    branchA: BranchMetrics,
    branchB: BranchMetrics
): {
    costDelta: number;
    costDeltaPercent: number;
    tokenDelta: number;
    tokenDeltaPercent: number;
    latencyDelta: number;
    latencyDeltaPercent: number;
    winner: 'A' | 'B' | 'tie';
} {
    const costDelta = branchB.estimatedCost - branchA.estimatedCost;
    const costDeltaPercent = branchA.estimatedCost > 0
        ? (costDelta / branchA.estimatedCost) * 100
        : 0;

    const tokenDelta = branchB.totalTokens - branchA.totalTokens;
    const tokenDeltaPercent = branchA.totalTokens > 0
        ? (tokenDelta / branchA.totalTokens) * 100
        : 0;

    const latencyDelta = branchB.totalLatency - branchA.totalLatency;
    const latencyDeltaPercent = branchA.totalLatency > 0
        ? (latencyDelta / branchA.totalLatency) * 100
        : 0;

    // Determine winner (lower cost/tokens/latency is better)
    const aScore = branchA.estimatedCost + (branchA.totalLatency / 1000);
    const bScore = branchB.estimatedCost + (branchB.totalLatency / 1000);

    const winner = aScore < bScore ? 'A' : aScore > bScore ? 'B' : 'tie';

    return {
        costDelta,
        costDeltaPercent,
        tokenDelta,
        tokenDeltaPercent,
        latencyDelta,
        latencyDeltaPercent,
        winner
    };
}

/**
 * Generates a summary report for export
 */
export function generateComparisonReport(branches: BranchMetrics[]): {
    summary: string;
    recommendations: string[];
    data: any;
} {
    const bestCost = Math.min(...branches.map(b => b.estimatedCost));
    const bestLatency = Math.min(...branches.map(b => b.totalLatency));
    const bestTokens = Math.min(...branches.map(b => b.totalTokens));

    const winner = branches.find(b =>
        b.estimatedCost === bestCost &&
        b.totalLatency === bestLatency
    ) || branches[0];

    const recommendations: string[] = [];

    // Cost optimization
    const avgCost = branches.reduce((sum, b) => sum + b.estimatedCost, 0) / branches.length;
    if (winner.estimatedCost < avgCost * 0.7) {
        recommendations.push(`${winner.branchName} is 30%+ cheaper than average. Consider using this approach.`);
    }

    // Error detection
    const branchesWithErrors = branches.filter(b => b.hasErrors);
    if (branchesWithErrors.length > 0) {
        recommendations.push(`${branchesWithErrors.length} branch(es) have errors. Review error handling.`);
    }

    // Latency optimization
    const avgLatency = branches.reduce((sum, b) => sum + b.totalLatency, 0) / branches.length;
    if (winner.totalLatency < avgLatency * 0.7) {
        recommendations.push(`${winner.branchName} is 30%+ faster than average. Analyze prompt efficiency.`);
    }

    return {
        summary: `Compared ${branches.length} branches. Winner: ${winner.branchName} ($${winner.estimatedCost.toFixed(4)}, ${Math.round(winner.totalLatency)}ms)`,
        recommendations,
        data: {
            branches: branches.map(b => ({
                name: b.branchName,
                cost: b.estimatedCost,
                tokens: b.totalTokens,
                latency: b.totalLatency,
                hasErrors: b.hasErrors
            })),
            winner: winner.branchName,
            timestamp: new Date().toISOString()
        }
    };
}