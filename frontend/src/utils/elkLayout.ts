import ELK from 'elkjs/lib/elk.bundled.js';
import type { Node, Edge } from 'reactflow';

const elk = new ELK();

const elkOptions = {
  'elk.algorithm': 'layered',
  'elk.direction': 'DOWN',
  'elk.spacing.nodeNode': '80',  // ✅ Reduced from 150 - tighter horizontal spacing
  'elk.layered.spacing.nodeNodeBetweenLayers': '120', // ✅ Consistent vertical spacing
  'elk.padding': '[top=50,left=50,bottom=50,right=50]',
  'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
  'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF', // ✅ Better for wide graphs
  'elk.edgeRouting': 'ORTHOGONAL',
  'elk.layered.compaction.postCompaction.strategy': 'EDGE_LENGTH',
  'elk.layered.compaction.connectedComponents': 'true', // ✅ Compact sibling clusters
  'elk.layered.nodePlacement.bk.fixedAlignment': 'BALANCED', // ✅ Balanced centering
};

/**
 * ✅ Calculate actual node height based on content length
 */
function calculateNodeHeight(node: Node): number {
  const eventType = node.data.label;
  const payload = node.data.payload || {};
  
  // Extract text content
  let textContent = '';
  
  if (payload['gen_ai.input.messages']?.length > 0) {
    const msg = payload['gen_ai.input.messages'][0];
    textContent = msg.parts?.[0]?.text || '';
  } else if (payload['gen_ai.output.messages']?.length > 0) {
    const msg = payload['gen_ai.output.messages'][0];
    textContent = msg.parts?.[0]?.text || '';
  }
  
  // Base heights
  const BASE_HEIGHT = 120; // Minimum node height
  const CHARS_PER_LINE = 40; // Approximate characters per line in ChronosNode
  const LINE_HEIGHT = 20; // Pixels per line
  const PADDING = 100; // Header + footer + padding
  
  // Calculate lines needed
  const estimatedLines = Math.ceil(textContent.length / CHARS_PER_LINE);
  const contentHeight = Math.max(3, estimatedLines) * LINE_HEIGHT;
  
  // Total height with bounds
  const calculatedHeight = contentHeight + PADDING;
  
  // Enforce min/max
  return Math.max(BASE_HEIGHT, Math.min(calculatedHeight, 400));
}

export const getLayoutedElements = async (nodes: Node[], edges: Edge[]) => {
  if (nodes.length === 0) return { nodes, edges };

  // 1. Convert React Flow -> ELK Graph with DYNAMIC heights
  const graph = {
    id: 'root',
    layoutOptions: elkOptions,
    children: nodes.map((node) => ({
      id: node.id,
      width: 300,
      height: calculateNodeHeight(node), // ✅ DYNAMIC HEIGHT
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      sources: [edge.source],
      targets: [edge.target],
    })),
  };

  try {
    const layoutedGraph = await elk.layout(graph);

    const layoutedNodes = nodes.map((node) => {
      const elkNode = layoutedGraph.children?.find((n) => n.id === node.id);

      if (elkNode?.x !== undefined && elkNode?.y !== undefined) {
        return {
          ...node,
          position: {
            x: elkNode.x,
            y: elkNode.y,
          },
        };
      }
      return node;
    });

    return { nodes: layoutedNodes, edges };

  } catch (error) {
    console.error('ELK layout failed:', error);
    return { nodes, edges };
  }
};