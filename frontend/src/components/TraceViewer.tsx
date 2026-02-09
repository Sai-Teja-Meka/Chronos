import React, {
  useEffect,
  useMemo,
  useCallback,
  useState,
  useRef
} from 'react';

import ReactFlow, {
  useNodesState,
  useEdgesState,
  Controls,
  MiniMap,
  Background,
  BackgroundVariant,
  useReactFlow,
  type Node,
  type Edge,
  type NodeTypes,
  type ProOptions // Import ProOptions type
} from 'reactflow';

import 'reactflow/dist/style.css';

// 🛡️ IMPORT forkConversation to use centralized logic
import { fetchConversationGraph, forkConversation } from '../api/client';
import ChronosNodeComponent from '../nodes/ChronosNode';
import ForkModal from './ForkModal';
import NodeDetailPanel from './NodeDetailPanel';
import TimelineControls from './TimelineControls';
import VisualDiffPanel from './VisualDiffPanel';
import { getLayoutedElements } from '../utils/elkLayout';
import {
  findDivergencePoint,
  calculateComparisonViewport,
  extractBranchDifferences,
  type DivergencePoint,
  type BranchDifference
} from '../utils/divergenceUtils';
import { PlayCircle, PauseCircle, AlertCircle, GitCompare, BarChart3, Radio } from 'lucide-react';
import ArenaView from './ArenaView';
import { calculateAllBranchMetrics } from '../utils/metricsUtils';

/* =========================
   Types
========================= */
interface MutationData {
  mutation_type: 'user_message' | 'system_message' | 'assistant_message' | 'tool_result';
  content: string;
  tool_call_id?: string;
  tool_name?: string;
}

interface ChronosNodeData {
  sequence: number;
  label?: string;
  created_at?: string;
  isOnActivePath?: boolean;
  isSelectedForComparison?: boolean;
  onFork?: (nodeId: string) => void;
  [key: string]: any;
}

type ChronosNode = Node<ChronosNodeData>;

interface TraceViewerProps {
  conversationId: string;
}

/* =========================
   Component
========================= */

const TraceViewer: React.FC<TraceViewerProps> = ({ conversationId }) => {
  // API Key is now handled in client.ts, removed from here

  const [nodes, setNodes, onNodesChange] = useNodesState<ChronosNodeData>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [isLayoutReady, setIsLayoutReady] = useState(false);

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reactFlowInstance = useReactFlow();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [forkParentId, setForkParentId] = useState<string | null>(null);

  const [selectedNode, setSelectedNode] = useState<ChronosNode | null>(null);

  const [showTimeline, setShowTimeline] = useState(false);
  const [playbackIndex, setPlaybackIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [allNodes, setAllNodes] = useState<ChronosNode[]>([]);
  const [activePath, setActivePath] = useState<Set<string>>(new Set());

  /* ✨ Visual Diff State */
  const [isDiffPanelOpen, setIsDiffPanelOpen] = useState(false);
  const [currentDivergence, setCurrentDivergence] = useState<DivergencePoint | null>(null);
  const [branchADiffs, setBranchADiffs] = useState<BranchDifference[]>([]);
  const [branchBDiffs, setBranchBDiffs] = useState<BranchDifference[]>([]);
  const [selectedNodeA, setSelectedNodeA] = useState<string | null>(null);
  const [selectedNodeB, setSelectedNodeB] = useState<string | null>(null);
  const [comparisonMode, setComparisonMode] = useState(false);

  /* 🏆 Arena View State */
  const [isArenaOpen, setIsArenaOpen] = useState(false);
  const [branchMetrics, setBranchMetrics] = useState<any[]>([]);

  /* 📡 SSE State */
  const [isConnected, setIsConnected] = useState(false);
  const MODEL_STORAGE_KEY = "chronos.selectedModel";
  const DEFAULT_MODEL = "claude-opus-4-5-20251101";

  const [selectedModel, setSelectedModel] = useState<string>(() => {
    return localStorage.getItem(MODEL_STORAGE_KEY) || DEFAULT_MODEL;
  });

  useEffect(() => {
    localStorage.setItem(MODEL_STORAGE_KEY, selectedModel);
  }, [selectedModel]);

  // 🚀 OPTIMIZATION: Memoize nodeTypes to prevent re-renders
  const nodeTypes = useMemo<NodeTypes>(
    () => ({
      chronosNode: ChronosNodeComponent
    }),
    []
  );

  // 🚀 OPTIMIZATION: Memoize proOptions (static config)
  const proOptions = useMemo<ProOptions>(() => ({ hideAttribution: true }), []);

  // 🚀 OPTIMIZATION: Determine if graph is large for conditional rendering
  const isLargeGraph = useMemo(() => nodes.length > 200, [nodes.length]);

  const onForkNode = useCallback((nodeId: string) => {
    setForkParentId(nodeId);
    setIsModalOpen(true);
  }, []);

  // 🛡️ UPDATED: Uses client.ts forkConversation which handles Auth headers
  const handleForkSubmit = useCallback(async (mutationData: MutationData) => {
    if (!forkParentId) return;

    try {
      await forkConversation({
        parent_event_id: forkParentId,
        mutation_type: mutationData.mutation_type,
        content: mutationData.content,
        tool_call_id: mutationData.tool_call_id,
        tool_name: mutationData.tool_name,
        model: selectedModel
      });

      console.log('Branch created successfully');

      // Graph refresh will happen automatically via SSE 'fork' event
      setIsModalOpen(false);
    } catch (error) {
      console.error('Fork error:', error);
      alert(`Fork failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }, [forkParentId, selectedModel]);

  const calculateActivePath = useCallback(
    (nodeList: ChronosNode[], edgeList: Edge[]) => {
      const childrenMap = new Map<string, string[]>();
      const parentMap = new Map<string, string>();

      edgeList.forEach(edge => {
        if (!childrenMap.has(edge.source)) {
          childrenMap.set(edge.source, []);
        }
        childrenMap.get(edge.source)!.push(edge.target);
        parentMap.set(edge.target, edge.source);
      });

      const roots = nodeList.filter(n => !parentMap.has(n.id));
      if (!roots.length) return new Set<string>();

      const dfs = (id: string): string[] => {
        const children = childrenMap.get(id) ?? [];
        if (!children.length) return [id];

        let longest: string[] = [];
        for (const child of children) {
          const path = dfs(child);
          if (path.length > longest.length) longest = path;
        }
        return [id, ...longest];
      };

      return new Set(dfs(roots[0].id));
    },
    []
  );

  /* Node Click Handler */
  // 🚀 OPTIMIZATION: Memoize click handler
  const handleNodeClick = useCallback(
    (_e: React.MouseEvent, node: ChronosNode) => {
      if (isPlaying) return;

      if (comparisonMode) {
        if (!selectedNodeA) {
          setSelectedNodeA(node.id);
          return;
        }

        if (!selectedNodeB && selectedNodeA !== node.id) {
          setSelectedNodeB(node.id);
          const divergence = findDivergencePoint(selectedNodeA, node.id, nodes as ChronosNode[], edges);

          if (divergence) {
            setCurrentDivergence(divergence);
            const diffs = extractBranchDifferences(divergence, nodes as ChronosNode[]);
            setBranchADiffs(diffs.branchA);
            setBranchBDiffs(diffs.branchB);
            setIsDiffPanelOpen(true);

            const viewport = calculateComparisonViewport(divergence, nodes as ChronosNode[]);
            if (viewport && reactFlowInstance) {
              reactFlowInstance.setCenter(viewport.x, viewport.y, {
                zoom: viewport.zoom,
                duration: 800
              });
            }
          } else {
            alert('❌ No common ancestor found between selected nodes');
            setSelectedNodeA(null);
            setSelectedNodeB(null);
          }
          return;
        }

        if (selectedNodeA && selectedNodeB) {
          setSelectedNodeA(null);
          setSelectedNodeB(null);
          return;
        }
        return;
      }

      setSelectedNode(node);
      reactFlowInstance.setCenter(
        node.position.x + 150,
        node.position.y + 100,
        { zoom: 1.5, duration: 800 }
      );
    },
    [reactFlowInstance, isPlaying, comparisonMode, selectedNodeA, selectedNodeB, nodes, edges]
  );

  /* Focus on Specific Node */
  const handleFocusNode = useCallback((nodeId: string) => {
    const node = (nodes as ChronosNode[]).find(n => n.id === nodeId);
    if (node && reactFlowInstance) {
      reactFlowInstance.setCenter(
        node.position.x + 150,
        node.position.y + 100,
        { zoom: 1.2, duration: 500 }
      );
    }
  }, [nodes, reactFlowInstance]);

  const handleClosePanel = useCallback(() => {
    setSelectedNode(null);
    reactFlowInstance?.fitView({ padding: 0.2, duration: 800 });
  }, [reactFlowInstance]);

  /* Toggle Comparison Mode */
  const toggleComparisonMode = useCallback(() => {
    setComparisonMode(prev => !prev);
    setSelectedNodeA(null);
    setSelectedNodeB(null);
    setIsDiffPanelOpen(false);
  }, []);

  useEffect(() => {
    if (!isPlaying) return;

    const interval = setInterval(() => {
      setPlaybackIndex(prev => {
        if (prev >= allNodes.length - 1) {
          setIsPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isPlaying, allNodes.length]);

  const getVisibleNodes = useCallback(() => {
    if (!showTimeline) return nodes;

    const visibleIds = new Set(allNodes.slice(0, playbackIndex + 1).map(n => n.id));

    return nodes.map((node: ChronosNode) => {
      const visible = visibleIds.has(node.id);
      return {
        ...node,
        hidden: !visible,
        style: {
          ...node.style,
          opacity: visible ? 1 : 0,
          transition: 'opacity 0.3s ease',
        },
      };
    });
  }, [nodes, showTimeline, playbackIndex, allNodes]);


  const getVisibleEdges = useCallback(() => {
    if (!showTimeline) return edges;

    const visibleIds = new Set(allNodes.slice(0, playbackIndex + 1).map(n => n.id));

    return edges.map((edge: Edge) => {
      const visible = visibleIds.has(edge.source) && visibleIds.has(edge.target);
      return {
        ...edge,
        hidden: !visible,
        style: {
          ...edge.style,
          opacity: visible ? (edge.style?.opacity ?? 1) : 0,
        },
      };
    });
  }, [edges, showTimeline, playbackIndex, allNodes]);


  const loadGraph = useCallback(async () => {
    try {
      // Don't set global loading state on refresh to prevent flicker
      if (nodes.length === 0) setIsLoading(true);
      setError(null);

      const graph = await fetchConversationGraph(conversationId);

      // Handle empty graph gracefully
      if (!graph || !graph.nodes || graph.nodes.length === 0) {
        setAllNodes([]);
        setNodes([]);
        setEdges([]);
        setIsLayoutReady(true);
        setIsLoading(false);
        return;
      }

      const activePath = calculateActivePath(
        graph.nodes as ChronosNode[],
        graph.edges
      );

      setActivePath(activePath);

      const enrichedNodes: ChronosNode[] = graph.nodes.map((node: ChronosNode) => ({
        ...node,
        data: {
          ...node.data,
          onFork: onForkNode,
          isOnActivePath: activePath.has(node.id),
          isSelectedForComparison: node.id === selectedNodeA || node.id === selectedNodeB
        }
      }));

      const styledEdges = graph.edges.map(edge => {
        const isActive =
          activePath.has(edge.source) && activePath.has(edge.target);

        return {
          ...edge,
          animated: isActive,
          style: isActive
            ? {
              stroke: '#00d4ff',
              strokeWidth: 4,
              filter: 'drop-shadow(0 0 8px rgba(0,212,255,0.6))'
            }
            : {
              stroke: '#94a3b8',
              strokeWidth: 1.5,
              opacity: 0.4
            }
        };
      });

      const { nodes: layoutedNodes, edges: layoutedEdges } =
        await getLayoutedElements(enrichedNodes, styledEdges);

      const sorted = [...layoutedNodes].sort((a, b) => {
        const ta = a.data.created_at ? Date.parse(a.data.created_at) : Number.POSITIVE_INFINITY;
        const tb = b.data.created_at ? Date.parse(b.data.created_at) : Number.POSITIVE_INFINITY;

        if (ta !== tb) return ta - tb;

        // tie-breakers for stability
        return (a.data.sequence ?? 0) - (b.data.sequence ?? 0);
      });

      setAllNodes(sorted);
      setNodes(layoutedNodes);
      setEdges(layoutedEdges);
      setIsLayoutReady(true);

      const metrics = calculateAllBranchMetrics(layoutedNodes, layoutedEdges);
      setBranchMetrics(metrics);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load graph');
      console.error('Graph load error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [conversationId, onForkNode, calculateActivePath, setNodes, setEdges, selectedNodeA, selectedNodeB, nodes.length]);

  // 📡 SSE Connection Logic (Replaces Polling)
  useEffect(() => {
    loadGraph(); // Initial load

    // Use environment variable for API URL or default to relative path
    const apiUrl = import.meta.env?.VITE_API_URL || '';
    const eventSource = new EventSource(`${apiUrl}/stream/graph/${conversationId}`);

    eventSource.onopen = () => {
      console.log('✅ SSE Connected');
      setIsConnected(true);
    };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'ingest' || data.type === 'fork') {
          console.log(`📡 Graph Update Received: ${data.type}`);
          loadGraph(); // Refresh graph data
        }
      } catch (err) {
        console.error('Failed to parse SSE message:', err);
      }
    };

    eventSource.onerror = (err) => {
      console.error('❌ SSE Connection Error', err);
      setIsConnected(false);
      eventSource.close();

      // Retry connection after 5 seconds
      setTimeout(() => {
        // Trigger re-render to reconnect
        setIsConnected(false);
      }, 5000);
    };

    return () => {
      eventSource.close();
      setIsConnected(false);
    };
  }, [conversationId]); // Removed loadGraph from dependency to avoid loop

  if (isLoading && nodes.length === 0) {
    return (
      <div className="w-full h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading conversation graph...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center max-w-md">
          <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-gray-800 mb-2">Failed to Load Graph</h3>
          <p className="text-gray-600 mb-4">{error}</p>
          <button
            onClick={loadGraph}
            className="px-4 py-2 bg-cyan-600 text-white rounded-lg hover:bg-cyan-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-screen bg-slate-50 relative">
      <ReactFlow
        nodes={getVisibleNodes()}
        edges={getVisibleEdges()}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        nodeTypes={nodeTypes}
        proOptions={proOptions} // 🚀 OPTIMIZATION: Static config
        // 🚀 OPTIMIZATION: Performance flag for large graphs
        onlyRenderVisibleElements={isLargeGraph}
        // 🚀 OPTIMIZATION: Disable expensive interaction on large graphs
        selectNodesOnDrag={!isLargeGraph}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
        minZoom={0.1}
        style={{ opacity: isLayoutReady ? 1 : 0, transition: 'opacity 0.3s' }}
      >
        <Controls />
        <MiniMap
          nodeStrokeColor={(n) => {
            if (n.data.isOnActivePath) return '#00d4ff';
            if (n.data.label === 'error') return '#ef4444';
            if (n.data.label === 'user_message') return '#3b82f6';
            return '#94a3b8';
          }}
          nodeColor={(n) => {
            if (n.data.isOnActivePath) return '#7dd3fc';
            if (n.data.label === 'assistant_message') return '#a855f7';
            return '#e2e8f0';
          }}
          nodeBorderRadius={4}
        />
        <Background variant={BackgroundVariant.Dots} gap={16} size={1.5} color="#cbd5e1" />
      </ReactFlow>

      <div className="absolute top-4 left-4 bg-white/90 backdrop-blur-sm rounded-lg shadow-lg px-4 py-3 text-sm z-10">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-8 h-1 bg-cyan-400 rounded shadow-[0_0_8px_rgba(0,212,255,0.6)]"></div>
          <span className="font-semibold text-gray-700">Active Path</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-8 h-1 bg-gray-400 rounded opacity-40"></div>
          <span className="text-gray-500">Alternative Branches</span>
        </div>
      </div>

      <button
        onClick={toggleComparisonMode}
        className={`absolute top-20 left-4 backdrop-blur-sm rounded-lg shadow-lg px-4 py-2 flex items-center gap-2 hover:bg-white transition-all z-10 ${comparisonMode
          ? 'bg-gradient-to-r from-blue-500 to-purple-500 text-white ring-2 ring-yellow-400'
          : 'bg-white/90 text-gray-700'
          }`}
      >
        <GitCompare size={20} />
        <span className="text-sm font-semibold">
          {comparisonMode ? 'Exit Compare' : 'Compare Branches'}
        </span>
      </button>

      {comparisonMode && !selectedNodeA && (
        <div className="absolute top-36 left-4 bg-blue-500 text-white rounded-lg shadow-lg px-4 py-3 text-sm z-10 max-w-xs animate-pulse">
          <div className="font-bold mb-1">🔵 Step 1: Select Node A</div>
          <div>Click any node to start comparison</div>
        </div>
      )}

      {comparisonMode && selectedNodeA && !selectedNodeB && (
        <div className="absolute top-36 left-4 bg-purple-500 text-white rounded-lg shadow-lg px-4 py-3 text-sm z-10 max-w-xs animate-pulse">
          <div className="font-bold mb-1">🟣 Step 2: Select Node B</div>
          <div>Click another node to compare branches</div>
          <div className="mt-2 text-xs opacity-80">
            Node A: Sequence #{(nodes as ChronosNode[]).find(n => n.id === selectedNodeA)?.data.sequence}
          </div>
        </div>
      )}

      <button
        onClick={() => setIsArenaOpen(true)}
        className="absolute top-20 right-4 bg-white/90 backdrop-blur-sm rounded-lg shadow-lg px-4 py-2 flex items-center gap-2 hover:bg-white transition-colors z-10"
      >
        <BarChart3 size={20} className="text-orange-600" />
        <span className="text-sm font-semibold text-gray-700">Arena View</span>
      </button>

      <button
        onClick={() => {
          setShowTimeline(v => !v);
          if (showTimeline) {
            setPlaybackIndex(0);
            setIsPlaying(false);
          }
        }}
        className="absolute top-4 right-4 bg-white/90 backdrop-blur-sm rounded-lg shadow-lg px-4 py-2 flex items-center gap-2 hover:bg-white transition-colors z-10"
      >
        {showTimeline ? (
          <>
            <PauseCircle size={20} className="text-cyan-600" />
            <span className="text-sm font-semibold text-gray-700">Exit Timeline</span>
          </>
        ) : (
          <>
            <PlayCircle size={20} className="text-cyan-600" />
            <span className="text-sm font-semibold text-gray-700">Timeline Mode</span>
          </>
        )}
      </button>

      {selectedNode && !comparisonMode && (
        <NodeDetailPanel
          selectedNode={selectedNode}
          onClose={handleClosePanel}
          onBranch={(nodeId) => {
            handleClosePanel();
            onForkNode(nodeId);
          }}
        />
      )}

      <VisualDiffPanel
        isOpen={isDiffPanelOpen}
        onClose={() => {
          setIsDiffPanelOpen(false);
          setSelectedNodeA(null);
          setSelectedNodeB(null);
        }}
        divergence={currentDivergence}
        branchADiffs={branchADiffs}
        branchBDiffs={branchBDiffs}
        onFocusNode={handleFocusNode}
        ancestorNode={currentDivergence ? (nodes as ChronosNode[]).find(n => n.id === currentDivergence.commonAncestorId) || null : null}
      />

      {showTimeline && (
        <TimelineControls
          currentIndex={playbackIndex}
          totalSteps={allNodes.length}
          isPlaying={isPlaying}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onReset={() => {
            setPlaybackIndex(0);
            setIsPlaying(false);
          }}
          onStepBack={() => setPlaybackIndex(v => Math.max(0, v - 1))}
          onStepForward={() => setPlaybackIndex(v => Math.min(allNodes.length - 1, v + 1))}
          onSeek={setPlaybackIndex}
        />
      )}

      <ForkModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSubmit={handleForkSubmit}
        parentEventId={forkParentId}
      />

      <div className="absolute top-4 right-56 bg-white/90 backdrop-blur-sm rounded-lg shadow-lg px-3 py-2 text-xs z-10">
        <div className="text-gray-500 mb-1">Model</div>
        <select
          value={selectedModel}
          onChange={(e) => setSelectedModel(e.target.value)}
          className="bg-transparent text-gray-800 font-semibold outline-none"
        >
          <option value="claude-haiku-4-5-20251001">claude-haiku-4-5-20251001</option>
          <option value="claude-sonnet-4-5-20250929">claude-sonnet-4-5-20250929</option>
          <option value="claude-opus-4-5-20251101">claude-opus-4-5-20251101</option>
          <option value="gpt-3.5-turbo">gpt-3.5-turbo</option>
          <option value="gpt-4.1-nano">gpt-4.1-nano</option>
          <option value="gpt-4.1-mini">gpt-4.1-mini</option>
          <option value="gpt-4.1">gpt-4.1</option>

        </select>
      </div>

      <ArenaView
        isOpen={isArenaOpen}
        onClose={() => setIsArenaOpen(false)}
        branches={branchMetrics}
        nodes={nodes as ChronosNode[]}
        onFocusBranch={(branchId) => {
          const node = (nodes as ChronosNode[]).find(n => n.id === branchId);
          if (node && reactFlowInstance) {
            reactFlowInstance.setCenter(
              node.position.x + 150,
              node.position.y + 100,
              { zoom: 1.2, duration: 800 }
            );
          }
          setIsArenaOpen(false);
        }}
      />

      {/* SSE Connection Status Indicator */}
      <div className={`absolute bottom-3 left-11 backdrop-blur-sm rounded-lg shadow px-3 py-2 text-xs flex items-center gap-2 z-10 transition-colors ${isConnected ? 'bg-white/90 text-green-600' : 'bg-red-50 text-red-600'}`}>
        <Radio size={14} className={isConnected ? "animate-pulse" : ""} />
        {isConnected ? "Live Updates Active" : "Connecting..."}
      </div>

      {/* Performance Mode Indicator */}
      {isLargeGraph && (
        <div className="absolute bottom-3 right-3 bg-yellow-100 text-yellow-800 rounded px-2 py-1 text-[10px] font-mono border border-yellow-200">
          ⚡ Performance Mode ({nodes.length} nodes)
        </div>
      )}
    </div>
  );
};

export default TraceViewer;