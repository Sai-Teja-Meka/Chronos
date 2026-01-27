import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Clock, Coins, Hash, GitBranch, Copy, Check } from 'lucide-react';
import type { Node } from 'reactflow';

interface NodeDetailPanelProps {
  selectedNode: Node | null;
  onClose: () => void;
  onBranch: (nodeId: string) => void;
}

const NodeDetailPanel: React.FC<NodeDetailPanelProps> = ({ 
  selectedNode, 
  onClose, 
  onBranch 
}) => {
  const [copied, setCopied] = React.useState(false);

  if (!selectedNode) return null;

  const { data } = selectedNode;

  // Extract full text content
  const extractFullText = () => {
    const payload = data.payload || {};
    const messages = payload['gen_ai.input.messages'] || payload['gen_ai.output.messages'];
    
    if (!messages || messages.length === 0) return 'No content available';
    
    const lastMsg = messages[messages.length - 1];
    const parts = lastMsg.parts || [];
    
    return parts
      .filter((p: any) => p.type === 'text')
      .map((p: any) => p.text)
      .join('\n\n');
  };

  // Extract tool information
  const extractToolInfo = () => {
    const payload = data.payload || {};
    const messages = payload['gen_ai.output.messages'] || [];
    
    if (messages.length === 0) return null;
    
    const parts = messages[0].parts || [];
    const toolParts = parts.filter((p: any) => p.type === 'tool_use' || p.type === 'tool_result');
    
    return toolParts.length > 0 ? toolParts : null;
  };

  const fullText = extractFullText();
  const toolInfo = extractToolInfo();
  const hasMetadata = data.metadata && Object.keys(data.metadata).length > 0;

  const handleCopy = () => {
    navigator.clipboard.writeText(fullText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleBranch = () => {
    onBranch(selectedNode.id);
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ x: 400, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 400, opacity: 0 }}
        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
        className="fixed top-0 right-0 h-full w-[400px] bg-white shadow-2xl z-50 flex flex-col"
        style={{ borderLeft: '1px solid #e2e8f0' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-gradient-to-r from-slate-50 to-white">
          <div>
            <h2 className="text-lg font-bold text-gray-800 capitalize">
              {data.label.replace('_', ' ')}
            </h2>
            <div className="flex items-center gap-2 mt-1">
              <Hash size={14} className="text-gray-400" />
              <span className="text-sm text-gray-500">Sequence {data.sequence}</span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X size={20} className="text-gray-600" />
          </button>
        </div>

        {/* Content - Scrollable */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          
          {/* Full Message Content */}
          <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-gray-700">Content</h3>
              <button
                onClick={handleCopy}
                className="flex items-center gap-1 text-xs text-gray-600 hover:text-gray-800 transition-colors"
              >
                {copied ? (
                  <>
                    <Check size={14} className="text-green-600" />
                    <span className="text-green-600">Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy size={14} />
                    <span>Copy</span>
                  </>
                )}
              </button>
            </div>
            <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
              {fullText}
            </p>
          </div>

          {/* Tool Information */}
          {toolInfo && (
            <div className="bg-green-50 rounded-lg p-4 border border-green-200">
              <h3 className="text-sm font-semibold text-green-800 mb-2">Tool Execution</h3>
              <div className="space-y-2">
                {toolInfo.map((tool: any, idx: number) => (
                  <div key={idx} className="bg-white rounded p-3 border border-green-200">
                    <div className="font-mono text-xs text-green-700 font-bold mb-1">
                      {tool.name || 'Tool Result'}
                    </div>
                    <pre className="text-xs text-gray-600 overflow-x-auto">
                      {JSON.stringify(tool.arguments || tool.content, null, 2)}
                    </pre>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Metadata */}
          {hasMetadata && (
            <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
              <h3 className="text-sm font-semibold text-blue-800 mb-3">Metadata</h3>
              <div className="space-y-2">
                
                {data.metadata.latency_ms && (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Clock size={16} className="text-blue-600" />
                      <span className="text-sm text-gray-700">Latency</span>
                    </div>
                    <span className="text-sm font-mono text-gray-900">
                      {Math.round(data.metadata.latency_ms)}ms
                    </span>
                  </div>
                )}

                {data.metadata['gen_ai.usage.input_tokens'] && (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Coins size={16} className="text-blue-600" />
                      <span className="text-sm text-gray-700">Input Tokens</span>
                    </div>
                    <span className="text-sm font-mono text-gray-900">
                      {data.metadata['gen_ai.usage.input_tokens']}
                    </span>
                  </div>
                )}

                {data.metadata['gen_ai.usage.output_tokens'] && (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Coins size={16} className="text-blue-600" />
                      <span className="text-sm text-gray-700">Output Tokens</span>
                    </div>
                    <span className="text-sm font-mono text-gray-900">
                      {data.metadata['gen_ai.usage.output_tokens']}
                    </span>
                  </div>
                )}

                {/* Show all other metadata */}
                {Object.entries(data.metadata)
                  .filter(([key]) => 
                    !['latency_ms', 'gen_ai.usage.input_tokens', 'gen_ai.usage.output_tokens'].includes(key)
                  )
                  .map(([key, value]) => (
                    <div key={key} className="flex items-center justify-between">
                      <span className="text-sm text-gray-700">{key}</span>
                      <span className="text-sm font-mono text-gray-900">
                        {String(value)}
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* Node ID (for debugging) */}
          <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
            <h3 className="text-xs font-semibold text-gray-600 mb-1">Node ID</h3>
            <code className="text-xs text-gray-500 break-all">
              {selectedNode.id}
            </code>
          </div>

        </div>

        {/* Footer - Actions */}
        <div className="p-4 border-t border-gray-200 bg-gray-50">
          <button
            onClick={handleBranch}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-purple-600 hover:bg-purple-700 text-white font-semibold rounded-lg shadow-md transition-all hover:shadow-lg active:scale-95"
          >
            <GitBranch size={18} />
            Branch from Here
          </button>
          
          <p className="text-xs text-gray-500 text-center mt-2">
            Create an alternate timeline from this point
          </p>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};

export default NodeDetailPanel;