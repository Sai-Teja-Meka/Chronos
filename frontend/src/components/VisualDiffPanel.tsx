import React from 'react';
import { X, GitBranch, Clock, Coins, Maximize2 } from 'lucide-react';
import type { Node } from 'reactflow';
import type { DivergencePoint, BranchDifference } from '../utils/divergenceUtils';

interface VisualDiffPanelProps {
    isOpen: boolean;
    onClose: () => void;
    divergence: DivergencePoint | null;
    branchADiffs: BranchDifference[];
    branchBDiffs: BranchDifference[];
    onFocusNode: (nodeId: string) => void;
    ancestorNode: Node | null;
}

const VisualDiffPanel: React.FC<VisualDiffPanelProps> = ({
    isOpen,
    onClose,
    divergence,
    branchADiffs,
    branchBDiffs,
    onFocusNode,
    ancestorNode
}) => {
    if (!isOpen || !divergence) return null;

    const getEventTypeColor = (type: string) => {
        switch (type) {
            case 'user_message': return 'text-blue-700 bg-blue-50 border-blue-200';
            case 'assistant_message': return 'text-purple-700 bg-purple-50 border-purple-200';
            case 'tool_call':
            case 'tool_result': return 'text-green-700 bg-green-50 border-green-200';
            default: return 'text-gray-700 bg-gray-50 border-gray-200';
        }
    };

    const renderDiffCard = (diff: BranchDifference, index: number) => (
        <div
            key={diff.nodeId}
            className={`border rounded-lg p-3 mb-2 hover:shadow-md transition-shadow cursor-pointer ${getEventTypeColor(diff.eventType)}`}
            onClick={() => onFocusNode(diff.nodeId)}
        >
            <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold uppercase tracking-wide">
                    {diff.eventType.replace('_', ' ')}
                </span>
                <span className="text-xs opacity-60">Step {index + 1}</span>
            </div>

            <div className="text-sm mb-2">
                {diff.content}
            </div>

            {diff.metadata && (
                <div className="flex gap-3 text-xs opacity-70">
                    {diff.metadata.latency_ms && (
                        <div className="flex items-center gap-1">
                            <Clock size={10} />
                            {Math.round(diff.metadata.latency_ms)}ms
                        </div>
                    )}
                    {diff.metadata['gen_ai.usage.output_tokens'] && (
                        <div className="flex items-center gap-1">
                            <Coins size={10} />
                            {diff.metadata['gen_ai.usage.output_tokens']} toks
                        </div>
                    )}
                </div>
            )}
        </div>
    );

    const totalTokensA = branchADiffs.reduce((sum, d) =>
        sum + (d.metadata?.['gen_ai.usage.output_tokens'] || 0), 0
    );

    const totalTokensB = branchBDiffs.reduce((sum, d) =>
        sum + (d.metadata?.['gen_ai.usage.output_tokens'] || 0), 0
    );

    const totalLatencyA = branchADiffs.reduce((sum, d) =>
        sum + (d.metadata?.latency_ms || 0), 0
    );

    const totalLatencyB = branchBDiffs.reduce((sum, d) =>
        sum + (d.metadata?.latency_ms || 0), 0
    );

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/30 backdrop-blur-sm"
                onClick={onClose}
            />

            {/* Panel - Simple fixed height approach */}
            <div className="relative w-full max-w-6xl bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col" style={{ height: '85vh' }} onWheelCapture={(e) => e.stopPropagation()} onTouchMoveCapture={(e) => e.stopPropagation()}>

                {/* Header */}
                <div className="px-6 py-4 bg-gradient-to-r from-purple-50 to-blue-50 border-b border-gray-200">
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-white rounded-lg shadow-sm">
                                <GitBranch size={24} className="text-purple-600" />
                            </div>
                            <div>
                                <h3 className="font-bold text-lg text-gray-800">Branch Comparison</h3>
                                <p className="text-sm text-gray-600">
                                    Diverged at sequence #{divergence.divergenceSequence}
                                </p>
                            </div>
                        </div>
                        <button
                            onClick={onClose}
                            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                        >
                            <X size={20} className="text-gray-600" />
                        </button>
                    </div>

                    {/* Metrics */}
                    <div className="grid grid-cols-4 gap-4">
                        <div className="bg-white rounded-lg p-3 shadow-sm">
                            <div className="text-xs text-gray-500 mb-1">Branch A Steps</div>
                            <div className="text-2xl font-bold text-blue-600">{branchADiffs.length}</div>
                        </div>
                        <div className="bg-white rounded-lg p-3 shadow-sm">
                            <div className="text-xs text-gray-500 mb-1">Branch B Steps</div>
                            <div className="text-2xl font-bold text-purple-600">{branchBDiffs.length}</div>
                        </div>
                        <div className="bg-white rounded-lg p-3 shadow-sm">
                            <div className="text-xs text-gray-500 mb-1">Token Δ</div>
                            <div className={`text-2xl font-bold ${totalTokensB > totalTokensA ? 'text-red-600' : 'text-green-600'}`}>
                                {totalTokensB > totalTokensA ? '+' : ''}{totalTokensB - totalTokensA}
                            </div>
                        </div>
                        <div className="bg-white rounded-lg p-3 shadow-sm">
                            <div className="text-xs text-gray-500 mb-1">Latency Δ</div>
                            <div className={`text-2xl font-bold ${totalLatencyB > totalLatencyA ? 'text-red-600' : 'text-green-600'}`}>
                                {totalLatencyB > totalLatencyA ? '+' : ''}{Math.round(totalLatencyB - totalLatencyA)}ms
                            </div>
                        </div>
                    </div>
                </div>

                {/* Divergence Point */}
                {ancestorNode && (
                    <div className="px-6 py-3 bg-gray-50 border-b border-gray-200">
                        <div className="text-xs font-semibold text-gray-500 mb-2">📍 Divergence Point</div>
                        <div
                            className="bg-white border border-gray-300 rounded-lg p-3 cursor-pointer hover:shadow-md transition-shadow"
                            onClick={() => onFocusNode(divergence.commonAncestorId)}
                        >
                            <div className="flex items-center justify-between">
                                <div className="text-sm font-medium text-gray-800">
                                    {ancestorNode.data.label.replace('_', ' ').toUpperCase()}
                                </div>
                                <div className="flex items-center gap-2 text-xs text-gray-500">
                                    <span>Sequence #{ancestorNode.data.sequence}</span>
                                    <Maximize2 size={14} />
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* 🎯 SIMPLE SOLUTION: Just use a div with fixed height and overflow */}
                <div className="flex-1 min-h-0">
                    <div className="grid grid-cols-2 h-full min-h-0">

                        {/* Branch A - Left Column */}
                        <div className="border-r border-gray-200 h-full min-h-0 flex flex-col">
                            <div className="px-6 py-3 bg-blue-50 border-b border-blue-200">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <div className="w-3 h-3 rounded-full bg-blue-500" />
                                        <span className="font-bold text-blue-800">Branch A</span>
                                    </div>
                                    <div className="text-xs text-blue-600">
                                        {branchADiffs.length} steps · {totalTokensA} tokens
                                    </div>
                                </div>
                            </div>

                            {/* 🎯 SCROLLABLE - Simple overflow-y-auto with explicit height */}
                            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-6 py-4">
                                {branchADiffs.length === 0 ? (
                                    <div className="text-center text-gray-400 italic py-8">
                                        No changes in this branch
                                    </div>
                                ) : (
                                    branchADiffs.map((diff, idx) => renderDiffCard(diff, idx))
                                )}
                            </div>
                        </div>

                        {/* Branch B - Right Column */}
                        <div className="h-full min-h-0 flex flex-col">
                            <div className="px-6 py-3 bg-purple-50 border-b border-purple-200">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <div className="w-3 h-3 rounded-full bg-purple-500" />
                                        <span className="font-bold text-purple-800">Branch B</span>
                                    </div>
                                    <div className="text-xs text-purple-600">
                                        {branchBDiffs.length} steps · {totalTokensB} tokens
                                    </div>
                                </div>
                            </div>

                            {/* 🎯 SCROLLABLE - Simple overflow-y-auto with explicit height */}
                            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-6 py-4">
                                {branchBDiffs.length === 0 ? (
                                    <div className="text-center text-gray-400 italic py-8">
                                        No changes in this branch
                                    </div>
                                ) : (
                                    branchBDiffs.map((diff, idx) => renderDiffCard(diff, idx))
                                )}
                            </div>
                        </div>

                    </div>
                </div>

            </div>
        </div>
    );
};

export default VisualDiffPanel;