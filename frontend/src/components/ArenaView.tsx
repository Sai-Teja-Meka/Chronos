import React, { useState, useMemo } from 'react';
import { X, Download, Trophy, Zap, DollarSign, Clock, AlertTriangle } from 'lucide-react';
import type { Node } from 'reactflow';

interface BranchMetrics {
    branchId: string;
    branchName: string;
    tipNodeId: string;
    model: string;

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

interface ArenaViewProps {
    isOpen: boolean;
    onClose: () => void;
    branches: BranchMetrics[];
    nodes: Node[];
    onFocusBranch: (branchId: string) => void;
}

const ArenaView: React.FC<ArenaViewProps> = ({
    isOpen,
    onClose,
    branches,
    onFocusBranch
}) => {
    // 1. HOOKS ALWAYS COME FIRST (Unconditionally)
    const [sortBy, setSortBy] = useState<'cost' | 'tokens' | 'latency' | 'steps'>('cost');
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

    // Calculate sorted branches (Hook)
    const sortedBranches = useMemo(() => {
        if (!branches || branches.length === 0) return [];

        const sorted = [...branches].sort((a, b) => {
            let aVal = 0, bVal = 0;

            switch (sortBy) {
                case 'cost': aVal = a.estimatedCost; bVal = b.estimatedCost; break;
                case 'tokens': aVal = a.totalTokens; bVal = b.totalTokens; break;
                case 'latency': aVal = a.totalLatency; bVal = b.totalLatency; break;
                case 'steps': aVal = a.totalSteps; bVal = b.totalSteps; break;
            }

            return sortOrder === 'asc' ? aVal - bVal : bVal - aVal;
        });

        return sorted;
    }, [branches, sortBy, sortOrder]);

    // 2. CONDITIONAL RETURN (Only after all hooks are called)
    if (!isOpen || branches.length === 0) return null;

    // 3. Derived calculations (Safe to do here because we know branches exist)
    const bestCost = Math.min(...branches.map(b => b.estimatedCost));
    const worstCost = Math.max(...branches.map(b => b.estimatedCost));
    const bestLatency = Math.min(...branches.map(b => b.totalLatency));
    const worstLatency = Math.max(...branches.map(b => b.totalLatency));
    const bestTokens = Math.min(...branches.map(b => b.totalTokens));
    const worstTokens = Math.max(...branches.map(b => b.totalTokens));

    const winner = sortedBranches[0];

    // Export data
    const handleExport = (format: 'json' | 'csv') => {
        const timestamp = new Date().toISOString().split('T')[0];

        if (format === 'json') {
            const data = {
                exportDate: timestamp,
                branches: branches.map(b => ({
                    name: b.branchName,
                    metrics: {
                        steps: b.totalSteps,
                        tokens: b.totalTokens,
                        model: b.model,
                        latency: `${b.totalLatency}ms`,
                        cost: `$${b.estimatedCost.toFixed(4)}`,
                        hasErrors: b.hasErrors,
                        completionRate: `${(b.completionRate * 100).toFixed(1)}%`
                    }
                }))
            };

            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `arena-comparison-${timestamp}.json`;
            a.click();
            URL.revokeObjectURL(url);
        } else {
            // CSV format
            const headers = ['Branch,Model,Steps,Tokens,Latency (ms),Cost ($),Has Errors,Completion Rate (%)'];
            const rows = branches.map(b =>
                `${b.branchName},${b.model},${b.totalSteps},${b.totalTokens},${b.totalLatency},${b.estimatedCost.toFixed(4)},${b.hasErrors},${(b.completionRate * 100).toFixed(1)}`
            );

            const csv = [headers, ...rows].join('\n');
            const blob = new Blob([csv], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `arena-comparison-${timestamp}.csv`;
            a.click();
            URL.revokeObjectURL(url);
        }
    };

    // Metric card component
    const MetricCard = ({
        label,
        value,
        isBest,
        isWorst,
        icon: Icon
    }: {
        label: string;
        value: string | number;
        isBest: boolean;
        isWorst: boolean;
        icon: any;
    }) => (
        <div className={`p-3 rounded-lg border-2 transition-all ${isBest ? 'bg-green-50 border-green-300 shadow-md' :
            isWorst ? 'bg-red-50 border-red-300' :
                'bg-gray-50 border-gray-200'
            }`}>
            <div className="flex items-center gap-2 mb-1">
                <Icon size={14} className={
                    isBest ? 'text-green-600' :
                        isWorst ? 'text-red-600' :
                            'text-gray-600'
                } />
                <span className="text-xs text-gray-600">{label}</span>
                {isBest && <Trophy size={12} className="text-yellow-500 ml-auto" />}
            </div>
            <div className={`text-lg font-bold ${isBest ? 'text-green-700' :
                isWorst ? 'text-red-700' :
                    'text-gray-800'
                }`}>
                {value}
            </div>
        </div>
    );

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/40 backdrop-blur-sm"
                onClick={onClose}
            />

            {/* Arena Panel */}
            <div
                className="relative w-full max-w-7xl bg-white rounded-2xl shadow-2xl flex flex-col"
                style={{ height: 'calc(100vh - 60px)', maxHeight: '1000px' }}
            >

                {/* Header */}
                <div className="flex-shrink-0 px-6 py-4 bg-gradient-to-r from-orange-50 to-yellow-50 border-b border-gray-200">
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-white rounded-lg shadow-sm">
                                <Trophy size={24} className="text-orange-600" />
                            </div>
                            <div>
                                <h3 className="font-bold text-xl text-gray-800">Arena View</h3>
                                <p className="text-sm text-gray-600">
                                    Comparing {branches.length} branches
                                </p>
                            </div>
                        </div>

                        <div className="flex items-center gap-2">
                            {/* Export buttons */}
                            <button
                                onClick={() => handleExport('json')}
                                className="px-3 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors flex items-center gap-2 text-sm"
                            >
                                <Download size={16} />
                                JSON
                            </button>
                            <button
                                onClick={() => handleExport('csv')}
                                className="px-3 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors flex items-center gap-2 text-sm"
                            >
                                <Download size={16} />
                                CSV
                            </button>

                            <button
                                onClick={onClose}
                                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                            >
                                <X size={20} className="text-gray-600" />
                            </button>
                        </div>
                    </div>

                    {/* Winner Banner */}
                    {winner && (
                        <div className="bg-gradient-to-r from-yellow-100 to-orange-100 rounded-lg p-4 border-2 border-yellow-300 shadow-md">
                            <div className="flex items-center gap-3">
                                <Trophy size={32} className="text-yellow-600" />
                                <div>
                                    <div className="text-sm font-semibold text-gray-600">🏆 Best Overall (by {sortBy})</div>
                                    <div className="text-xl font-bold text-gray-800">{winner.branchName}</div>
                                </div>
                                <div className="ml-auto text-right">
                                    <div className="text-xs text-gray-600">Estimated Cost</div>
                                    <div className="text-2xl font-bold text-green-600">${winner.estimatedCost.toFixed(4)}</div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Scrollable Content */}
                <div className="flex-1 overflow-y-auto min-h-0 px-6 py-4">

                    {/* Sort Controls */}
                    <div className="mb-4 flex items-center gap-4">
                        <span className="text-sm font-semibold text-gray-700">Sort by:</span>
                        {(['cost', 'tokens', 'latency', 'steps'] as const).map(metric => (
                            <button
                                key={metric}
                                onClick={() => {
                                    if (sortBy === metric) {
                                        setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
                                    } else {
                                        setSortBy(metric);
                                        setSortOrder('asc');
                                    }
                                }}
                                className={`px-3 py-1 rounded-lg text-sm font-medium transition-colors ${sortBy === metric
                                    ? 'bg-orange-500 text-white'
                                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                                    }`}
                            >
                                {metric.charAt(0).toUpperCase() + metric.slice(1)}
                                {sortBy === metric && (
                                    sortOrder === 'asc' ? ' ↑' : ' ↓'
                                )}
                            </button>
                        ))}
                    </div>

                    {/* Branch Cards */}
                    <div className="space-y-4">
                        {sortedBranches.map((branch, index) => (
                            <div
                                key={branch.branchId}
                                className="bg-gradient-to-r from-gray-50 to-white rounded-xl border-2 border-gray-200 p-6 hover:shadow-lg transition-all cursor-pointer"
                                onClick={() => onFocusBranch(branch.branchId)}
                            >
                                {/* Branch Header */}
                                <div className="flex items-center justify-between mb-4">
                                    <div className="flex items-center gap-3">
                                        <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold ${index === 0 ? 'bg-gradient-to-br from-yellow-400 to-orange-500' :
                                            index === 1 ? 'bg-gradient-to-br from-gray-400 to-gray-500' :
                                                index === 2 ? 'bg-gradient-to-br from-orange-400 to-red-500' :
                                                    'bg-gray-400'
                                            }`}>
                                            {index + 1}
                                        </div>
                                        <div>
                                            <div className="font-bold text-lg text-gray-800">{branch.branchName}</div>
                                            <div className="text-xs text-gray-500">{branch.totalSteps} steps</div>
                                        </div>
                                    </div>
                                    <div className="text-xs text-gray-500">{branch.model} • {branch.totalSteps} steps</div>


                                    {/* Status Badge */}
                                    <div className={`px-3 py-1 rounded-full text-xs font-semibold ${branch.hasErrors
                                        ? 'bg-red-100 text-red-700'
                                        : 'bg-green-100 text-green-700'
                                        }`}>
                                        {branch.hasErrors ? '⚠️ Has Errors' : '✓ Success'}
                                    </div>
                                </div>

                                {/* Metrics Grid */}
                                <div className="grid grid-cols-4 gap-3">
                                    <MetricCard
                                        label="Cost"
                                        value={`$${branch.estimatedCost.toFixed(4)}`}
                                        isBest={branch.estimatedCost === bestCost}
                                        isWorst={branch.estimatedCost === worstCost}
                                        icon={DollarSign}
                                    />
                                    <MetricCard
                                        label="Tokens"
                                        value={branch.totalTokens.toLocaleString()}
                                        isBest={branch.totalTokens === bestTokens}
                                        isWorst={branch.totalTokens === worstTokens}
                                        icon={Zap}
                                    />
                                    <MetricCard
                                        label="Latency"
                                        value={`${Math.round(branch.totalLatency)}ms`}
                                        isBest={branch.totalLatency === bestLatency}
                                        isWorst={branch.totalLatency === worstLatency}
                                        icon={Clock}
                                    />
                                    <MetricCard
                                        label="Completion"
                                        value={`${(branch.completionRate * 100).toFixed(1)}%`}
                                        isBest={branch.completionRate === 1.0}
                                        isWorst={branch.completionRate < 0.5}
                                        icon={branch.hasErrors ? AlertTriangle : Trophy}
                                    />
                                </div>

                                {/* Event Breakdown */}
                                <div className="mt-4 pt-4 border-t border-gray-200">
                                    <div className="flex items-center gap-6 text-xs text-gray-600">
                                        <div>👤 {branch.userMessages} user</div>
                                        <div>🤖 {branch.assistantMessages} assistant</div>
                                        <div>🔧 {branch.toolCalls} tools</div>
                                        {branch.errors > 0 && (
                                            <div className="text-red-600 font-semibold">❌ {branch.errors} errors</div>
                                        )}
                                    </div>
                                </div>

                            </div>
                        ))}
                    </div>

                </div>

            </div>
        </div>
    );
};

export default ArenaView;