import React, { useState, useEffect } from 'react';
import { X, GitBranch, Loader2, User, Bot, Settings, Wrench, AlertCircle } from 'lucide-react';

interface ForkModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (mutationData: MutationData) => Promise<void>;
  parentEventId: string | null;
  parentEventData?: any; // The actual event data for context
}

interface MutationData {
  mutation_type: 'user_message' | 'system_message' | 'assistant_message' | 'tool_result';
  content: string;
  tool_call_id?: string;
  tool_name?: string;
}

type MessageType = 'user_message' | 'system_message' | 'assistant_message' | 'tool_result';

const ForkModal: React.FC<ForkModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  parentEventId,
  parentEventData
}) => {
  const [messageType, setMessageType] = useState<MessageType>('user_message');
  const [content, setContent] = useState('');
  const [toolCallId, setToolCallId] = useState('');
  const [toolName, setToolName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setMessageType('user_message');
      setContent('');
      setToolCallId('');
      setToolName('');
      setError(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validation
    if (!content.trim()) {
      setError('Content cannot be empty');
      return;
    }

    if (messageType === 'tool_result' && !toolCallId.trim()) {
      setError('Tool Call ID is required for tool results');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const mutationData: MutationData = {
        mutation_type: messageType,
        content: content.trim(),
        ...(messageType === 'tool_result' && {
          tool_call_id: toolCallId.trim(),
          tool_name: toolName.trim() || undefined
        })
      };

      await onSubmit(mutationData);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fork failed');
    } finally {
      setIsLoading(false);
    }
  };

  const getMessageTypeIcon = (type: MessageType) => {
    switch (type) {
      case 'user_message': return <User size={16} />;
      case 'system_message': return <Settings size={16} />;
      case 'assistant_message': return <Bot size={16} />;
      case 'tool_result': return <Wrench size={16} />;
    }
  };

  const getMessageTypeColor = (type: MessageType) => {
    switch (type) {
      case 'user_message': return 'text-blue-600 bg-blue-50 border-blue-200';
      case 'system_message': return 'text-gray-600 bg-gray-50 border-gray-200';
      case 'assistant_message': return 'text-purple-600 bg-purple-50 border-purple-200';
      case 'tool_result': return 'text-green-600 bg-green-50 border-green-200';
    }
  };

  const getPlaceholder = (type: MessageType) => {
    switch (type) {
      case 'user_message': return 'e.g., What if the user asked for a refund instead?';
      case 'system_message': return 'e.g., You are a helpful assistant focused on technical support.';
      case 'assistant_message': return 'e.g., I understand you need help with...';
      case 'tool_result': return 'e.g., {"results": [], "count": 0} (simulate empty database result)';
    }
  };

  const getExampleText = (type: MessageType) => {
    switch (type) {
      case 'user_message': return 'Test alternative user input';
      case 'system_message': return 'Modify system instructions to change AI behavior';
      case 'assistant_message': return 'Inject a specific assistant response';
      case 'tool_result': return 'Simulate tool/function execution results (e.g., empty DB query)';
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-2xl bg-white rounded-xl shadow-2xl border border-gray-200 overflow-hidden max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="px-6 py-4 bg-gradient-to-r from-purple-50 to-white border-b border-gray-100 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-100 rounded-lg">
              <GitBranch size={24} className="text-purple-700" />
            </div>
            <div>
              <h3 className="font-bold text-lg text-gray-800">Advanced Branch Mutation</h3>
              <p className="text-xs text-gray-500">Simulate "What If" scenarios by modifying conversation state</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors p-1 hover:bg-gray-100 rounded"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body - Scrollable */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto">
          <div className="p-6 space-y-6">

            {/* Fork Point Info */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                Fork Point (Event ID)
              </label>
              <code className="block w-full px-3 py-2 bg-gray-100 text-xs text-gray-500 rounded font-mono border border-gray-200">
                {parentEventId || "No Node Selected"}
              </code>
            </div>

            {/* Message Type Selector */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-3">
                Message Type
              </label>
              <div className="grid grid-cols-2 gap-3">
                {(['user_message', 'system_message', 'assistant_message', 'tool_result'] as MessageType[]).map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setMessageType(type)}
                    className={`
                      flex items-center gap-2 px-4 py-3 rounded-lg border-2 transition-all
                      ${messageType === type
                        ? `${getMessageTypeColor(type)} border-current font-semibold shadow-sm`
                        : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                      }
                    `}
                  >
                    {getMessageTypeIcon(type)}
                    <span className="text-sm capitalize">
                      {type.replace('_', ' ')}
                    </span>
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-gray-500 italic">
                {getExampleText(messageType)}
              </p>
            </div>

            {/* Tool-specific Fields */}
            {messageType === 'tool_result' && (
              <div className="space-y-4 bg-green-50 p-4 rounded-lg border border-green-200">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Tool Call ID <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={toolCallId}
                    onChange={(e) => setToolCallId(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none font-mono"
                    placeholder="call_abc123xyz"
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    The ID of the tool call this result is responding to
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Tool Name (Optional)
                  </label>
                  <input
                    type="text"
                    value={toolName}
                    onChange={(e) => setToolName(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none font-mono"
                    placeholder="search_database"
                  />
                </div>
              </div>
            )}

            {/* Content Input */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">
                {messageType === 'tool_result' ? 'Tool Result (JSON or Text)' : 'Message Content'}
                <span className="text-red-500 ml-1">*</span>
              </label>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="w-full h-40 px-4 py-3 text-sm text-gray-800 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none outline-none font-mono"
                placeholder={getPlaceholder(messageType)}
                autoFocus
              />
              <p className="mt-2 text-xs text-gray-500">
                {messageType === 'tool_result'
                  ? 'Enter the simulated result. Use JSON for structured data (e.g., empty array for "no results").'
                  : 'Enter the message content. This will be added to the conversation history.'
                }
              </p>
            </div>

            {/* Error Display */}
            {error && (
              <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                <AlertCircle size={16} />
                <span>{error}</span>
              </div>
            )}

            {/* Use Case Examples */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <h4 className="text-sm font-semibold text-blue-900 mb-2">💡 Use Cases:</h4>
              <ul className="text-xs text-blue-800 space-y-1">
                <li>• <strong>System:</strong> Test different AI personalities or instruction sets</li>
                <li>• <strong>User:</strong> Try alternative questions or edge cases</li>
                <li>• <strong>Assistant:</strong> Force a specific response to test downstream logic</li>
                <li>• <strong>Tool Result:</strong> Simulate failures, empty results, or edge case data</li>
              </ul>
            </div>
          </div>

          {/* Footer - Fixed at Bottom */}
          <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex justify-end gap-3 flex-shrink-0">
            <button
              type="button"
              onClick={onClose}
              disabled={isLoading}
              className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading || !content.trim() || (messageType === 'tool_result' && !toolCallId.trim())}
              className="flex items-center gap-2 px-6 py-2 text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg shadow-sm transition-all"
            >
              {isLoading ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Creating Branch...
                </>
              ) : (
                <>
                  <GitBranch size={16} />
                  Create Branch
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ForkModal;