/**
 * Divergence Detection Utilities
 * Finds where two branches split from a common ancestor
 */

import type { Node, Edge } from 'reactflow';

export interface DivergencePoint {
    commonAncestorId: string;
    branchAPath: string[];  // Event IDs from ancestor to tip A
    branchBPath: string[];  // Event IDs from ancestor to tip B
    divergenceSequence: number;
}

/**
 * Builds a map of parent relationships from edges
 */
function buildParentMap(edges: Edge[]): Map<string, string> {
    const parentMap = new Map<string, string>();
    edges.forEach(edge => {
        parentMap.set(edge.target, edge.source);
    });
    return parentMap;
}

/**
 * Traces the path from a node back to the root
 */
function tracePath(nodeId: string, parentMap: Map<string, string>): string[] {
    const path: string[] = [];
    let current: string | undefined = nodeId;

    while (current) {
        path.push(current);
        current = parentMap.get(current);
    }

    return path.reverse(); // Root to current
}

/**
 * Finds the common ancestor of two nodes (the divergence point)
 */
export function findDivergencePoint(
    nodeAId: string,
    nodeBId: string,
    nodes: Node[],
    edges: Edge[]
): DivergencePoint | null {
    const parentMap = buildParentMap(edges);

    // Get full paths from root to each node
    const pathA = tracePath(nodeAId, parentMap);
    const pathB = tracePath(nodeBId, parentMap);

    // Find the last common ancestor
    let commonAncestorId: string | null = null;
    let divergenceIndex = 0;

    for (let i = 0; i < Math.min(pathA.length, pathB.length); i++) {
        if (pathA[i] === pathB[i]) {
            commonAncestorId = pathA[i];
            divergenceIndex = i;
        } else {
            break;
        }
    }

    if (!commonAncestorId) {
        return null; // No common ancestor (shouldn't happen in valid DAG)
    }

    // Get the divergent paths (from ancestor to tips)
    const branchAPath = pathA.slice(divergenceIndex);
    const branchBPath = pathB.slice(divergenceIndex);

    // Get the sequence number of the divergence point
    const ancestorNode = nodes.find(n => n.id === commonAncestorId);
    const divergenceSequence = ancestorNode?.data.sequence ?? 0;

    return {
        commonAncestorId,
        branchAPath,
        branchBPath,
        divergenceSequence
    };
}

/**
 * Calculates the bounding box that encompasses multiple nodes
 */
export function calculateBoundingBox(nodeIds: string[], nodes: Node[]): {
    x: number;
    y: number;
    width: number;
    height: number;
} | null {
    const relevantNodes = nodes.filter(n => nodeIds.includes(n.id));

    if (relevantNodes.length === 0) return null;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    relevantNodes.forEach(node => {
        const x = node.position.x;
        const y = node.position.y;
        const width = 300; // Default node width
        const height = 200; // Approximate node height

        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x + width);
        maxY = Math.max(maxY, y + height);
    });

    // Add padding
    const padding = 50;

    return {
        x: minX - padding,
        y: minY - padding,
        width: (maxX - minX) + (padding * 2),
        height: (maxY - minY) + (padding * 2)
    };
}

/**
 * Calculates the optimal viewport to show a comparison
 */
export function calculateComparisonViewport(
    divergence: DivergencePoint,
    nodes: Node[]
): {
    x: number;
    y: number;
    zoom: number;
} | null {
    // Get all nodes in both branches
    const allRelevantIds = [
        divergence.commonAncestorId,
        ...divergence.branchAPath,
        ...divergence.branchBPath
    ];

    const bbox = calculateBoundingBox(allRelevantIds, nodes);

    if (!bbox) return null;

    // Calculate zoom to fit viewport (assuming 1200x800 viewport)
    const viewportWidth = 1200;
    const viewportHeight = 800;

    const zoomX = viewportWidth / bbox.width;
    const zoomY = viewportHeight / bbox.height;
    const zoom = Math.min(zoomX, zoomY, 1.5); // Cap at 1.5x zoom

    // Center point of the bounding box
    const centerX = bbox.x + (bbox.width / 2);
    const centerY = bbox.y + (bbox.height / 2);

    return {
        x: centerX,
        y: centerY,
        zoom
    };
}

/**
 * Identifies the differences between two branches
 */
export interface BranchDifference {
    nodeId: string;
    branchLabel: 'A' | 'B';
    eventType: string;
    content: string;
    metadata: any;
}

export function extractBranchDifferences(
    divergence: DivergencePoint,
    nodes: Node[]
): {
    branchA: BranchDifference[];
    branchB: BranchDifference[];
} {
    const extractDiffs = (path: string[], label: 'A' | 'B'): BranchDifference[] => {
        return path
            .filter(nodeId => nodeId !== divergence.commonAncestorId) // Exclude common ancestor
            .map(nodeId => {
                const node = nodes.find(n => n.id === nodeId);
                if (!node) return null;

                // Extract text content
                const payload = node.data.payload || {};
                const messages = payload['gen_ai.input.messages'] || payload['gen_ai.output.messages'] || [];
                const content = messages[0]?.parts?.[0]?.text || '[No content]';

                return {
                    nodeId,
                    branchLabel: label,
                    eventType: node.data.label,
                    content,
                    metadata: node.data.metadata
                };
            })
            .filter(Boolean) as BranchDifference[];
    };

    return {
        branchA: extractDiffs(divergence.branchAPath, 'A'),
        branchB: extractDiffs(divergence.branchBPath, 'B')
    };
}