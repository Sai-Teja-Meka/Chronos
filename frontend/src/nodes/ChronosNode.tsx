import React, { memo, useState, useEffect, useRef } from 'react';
import { Handle, Position } from 'reactflow';
import type { NodeProps } from 'reactflow';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  User, Bot, Wrench, AlertTriangle, Clock, Coins, GitBranch 
} from 'lucide-react';
import type { Variants } from 'framer-motion';

interface OTelPart {
  type: 'text' | 'tool_use' | 'tool_result' | 'image';
  text?: string;
  id?: string;
  name?: string;
  arguments?: any;
  content?: any;
}

interface OTelMessage {
  role: string;
  parts: OTelPart[];
  finish_reason?: string;
}

interface ChronosNodeData {
  label: string;
  sequence: number;
  payload: any;
  metadata: any;
  onFork?: (id: string) => void;
  isOnActivePath?: boolean;
}

const getNodeStyles = (eventType: string) => {
  switch (eventType) {
    case 'user_message':
      return { 
        borderColor: 'border-blue-500', 
        bgHeader: 'bg-blue-100', 
        textColor: 'text-blue-800', 
        Icon: User,
        glowColor: 'rgba(59, 130, 246, 0.6)'
      };
    case 'assistant_message':
      return { 
        borderColor: 'border-purple-500', 
        bgHeader: 'bg-purple-100', 
        textColor: 'text-purple-800', 
        Icon: Bot,
        glowColor: 'rgba(168, 85, 247, 0.6)'
      };
    case 'tool_call':
    case 'tool_result':
      return { 
        borderColor: 'border-green-600', 
        bgHeader: 'bg-green-100', 
        textColor: 'text-green-800', 
        Icon: Wrench,
        glowColor: 'rgba(22, 163, 74, 0.6)'
      };
    case 'error':
      return { 
        borderColor: 'border-red-500', 
        bgHeader: 'bg-red-100', 
        textColor: 'text-red-800', 
        Icon: AlertTriangle,
        glowColor: 'rgba(239, 68, 68, 0.6)'
      };
    default:
      return { 
        borderColor: 'border-gray-400', 
        bgHeader: 'bg-gray-100', 
        textColor: 'text-gray-800', 
        Icon: Clock,
        glowColor: 'rgba(156, 163, 175, 0.6)'
      };
  }
};

const getNodeSize = (eventType: string) => {
  switch (eventType) {
    case 'assistant_message':
    case 'tool_call':
      return { width: 350, scale: 1.0 };
    case 'user_message':
      return { width: 320, scale: 0.95 };
    case 'error':
      return { width: 340, scale: 1.0 };
    default:
      return { width: 280, scale: 0.85 };
  }
};

// ✨ NEW: Extract text for preview
const extractPreviewText = (payload: any): string => {
  const messages = payload["gen_ai.input.messages"] || payload["gen_ai.output.messages"];
  
  if (!messages || messages.length === 0) return 'No content';
  
  const lastMsg = messages[messages.length - 1];
  const parts = lastMsg.parts || [];
  
  const text = parts
    .filter((p: OTelPart) => p.type === 'text')
    .map((p: OTelPart) => p.text)
    .join(' ');
  
  // Truncate to 100 chars for preview
  return text.length > 100 ? text.substring(0, 100) + '...' : text;
};

const renderContent = (data: ChronosNodeData) => {
  const { payload, label } = data;
  
  if (label === 'error') {
    return (
      <div className="text-red-600 font-mono text-sm p-2">
        {payload["error.message"] || "Unknown Error"}
      </div>
    );
  }
  
  const messages = payload["gen_ai.input.messages"] || payload["gen_ai.output.messages"];
  
  if (!messages || messages.length === 0) {
    return (
      <div className="text-gray-400 italic p-2">No Content</div>
    );
  }
  
  const lastMsg = messages[messages.length - 1];
  const parts = lastMsg.parts || [];

  return (
    <div className="flex flex-col gap-2 p-2 text-sm">
      {parts.map((part: OTelPart, idx: number) => {
        if (part.type === 'text') {
          return (
            <div key={idx} className="whitespace-pre-wrap font-sans text-gray-700">
              {part.text}
            </div>
          );
        }
        
        if (part.type === 'tool_use') {
          return (
            <div key={idx} className="bg-slate-50 border border-slate-200 rounded p-2 font-mono text-xs">
              <div className="font-bold text-green-700 mb-1">
                Calling {part.name}()...
              </div>
              <pre className="overflow-x-auto text-slate-600">
                {JSON.stringify(part.arguments, null, 2)}
              </pre>
            </div>
          );
        }
        
        if (part.type === 'tool_result') {
          // Extract and parse content
          let displayContent = part.content;

          // If content is a JSON string, try to parse and re-stringify it prettily
          if (typeof displayContent === 'string') {
            try {
              const parsed = JSON.parse(displayContent);
              displayContent = JSON.stringify(parsed, null, 2);
            } catch {
              // If parsing fails, keep it as-is (plain text)
              displayContent = displayContent;
            }
          } else if (typeof displayContent === 'object' && displayContent !== null) {
            // If it's already an object, stringify it
            displayContent = JSON.stringify(displayContent, null, 2);
          } else {
            // Fallback for undefined/null
            displayContent = '[Empty Result]';
          }

          return (
            <div key={idx} className="bg-green-50 border border-green-200 rounded p-3 font-mono text-xs">
              <div className="font-bold text-green-700 mb-2 flex items-center gap-1">
                <Wrench size={12} />
                Result [{part.id}]:
              </div>
              <pre className="overflow-x-auto text-slate-700 whitespace-pre-wrap bg-white p-2 rounded border border-green-100">
                {displayContent}
              </pre>
            </div>
          );
        }
        
        return null;
      })}
    </div>
  );
};

const ChronosNode = ({ id, data }: NodeProps<ChronosNodeData>) => {
  const styles = getNodeStyles(data.label);
  const size = getNodeSize(data.label);
  const Icon = styles.Icon;
  const [showMenu, setShowMenu] = useState(false);
  const [showPreview, setShowPreview] = useState(false); // ✨ NEW
  const menuRef = useRef<HTMLDivElement>(null);
  const hoverTimeoutRef = useRef<ReturnType<typeof setInterval> | null>(null); // ✨ NEW

  const calculateHeight = () => {
    const payload = data.payload || {};
    let textContent = '';
    
    if (payload['gen_ai.input.messages']?.length > 0) {
      const msg = payload['gen_ai.input.messages'][0];
      textContent = msg.parts?.[0]?.text || '';
    } else if (payload['gen_ai.output.messages']?.length > 0) {
      const msg = payload['gen_ai.output.messages'][0];
      textContent = msg.parts?.[0]?.text || '';
    }
    
    const CHARS_PER_LINE = 40;
    const LINE_HEIGHT = 20;
    const HEADER_HEIGHT = 40;
    const FOOTER_HEIGHT = data.metadata?.latency_ms ? 24 : 0;
    const PADDING = 16;
    
    const estimatedLines = Math.max(2, Math.ceil(textContent.length / CHARS_PER_LINE));
    const bodyHeight = Math.min(estimatedLines * LINE_HEIGHT + PADDING, 280);
    const totalHeight = HEADER_HEIGHT + bodyHeight + FOOTER_HEIGHT;
    
    return Math.max(120, Math.min(totalHeight, 400));
  };

  const nodeHeight = calculateHeight();
  const hasFooter = data.metadata && (data.metadata.latency_ms || data.metadata["gen_ai.usage.output_tokens"]);
  const footerHeight = hasFooter ? 24 : 0;
  const bodyHeight = nodeHeight - 40 - footerHeight;

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // ✨ NEW: Hover preview handlers
  const handleMouseEnter = () => {
    // Delay showing preview by 300ms (debounce)
    hoverTimeoutRef.current = setTimeout(() => {
      setShowPreview(true);
    }, 300);
  };

  const handleMouseLeave = () => {
    // Clear timeout and hide preview
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }
    setShowPreview(false);
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setShowMenu(true);
  };

  const handleBranchClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowMenu(false);
    if (data.onFork) data.onFork(id);
  };

  const isActive = data.isOnActivePath ?? false;
  
  const nodeVariants: Variants = {
    hidden: { 
      opacity: 0, 
      scale: 0.8,
      y: -20
    },
    visible: { 
      opacity: isActive ? 1 : 0.65,
      scale: 1,
      y: 0,
      transition: {
        duration: 0.4,
        ease: 'easeOut', // ✅ TYPE-SAFE FIX
        delay: data.sequence * 0.05
      }
    }
  };

  const glowStyle = isActive ? {
    boxShadow: `
      0 0 15px ${styles.glowColor},
      0 0 30px ${styles.glowColor.replace('0.6', '0.3')},
      0 4px 20px rgba(0, 0, 0, 0.3)
    `,
    borderWidth: '3px'
  } : {
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)',
    borderWidth: '2px'
  };

  const previewText = extractPreviewText(data.payload);

  return (
    <motion.div
      variants={nodeVariants}
      initial="hidden"
      animate="visible"
      whileHover={{ 
        scale: 1.02,
        transition: { duration: 0.2 }
      }}
      onMouseEnter={handleMouseEnter} // ✨ NEW
      onMouseLeave={handleMouseLeave} // ✨ NEW
      className={`shadow-md rounded-lg bg-white border-2 overflow-visible relative ${styles.borderColor} ${
        isActive ? 'ring-2 ring-cyan-400 ring-opacity-50' : ''
      }`}
      style={{ 
        width: `${size.width}px`,
        height: `${nodeHeight}px`,
        minHeight: '120px',
        maxHeight: '400px',
        ...glowStyle,
        filter: isActive ? 'none' : 'grayscale(20%)'
      }}
      onContextMenu={handleContextMenu}
    >
      {/* TOP HANDLE */}
      <Handle type="target" position={Position.Top} className="w-3 h-3 bg-gray-500" />

      {/* ✨ NEW: Hover Preview Tooltip */}
      <AnimatePresence>
        {showPreview && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="absolute -top-2 left-1/2 transform -translate-x-1/2 -translate-y-full z-50 pointer-events-none"
          >
            <div className="bg-gray-900 text-white text-xs rounded-lg px-3 py-2 max-w-xs shadow-xl">
              <div className="font-semibold mb-1">{data.label.replace('_', ' ')}</div>
              <div className="text-gray-300 leading-relaxed">{previewText}</div>
              {data.metadata?.latency_ms && (
                <div className="text-gray-400 mt-1 flex items-center gap-1">
                  <Clock size={10} />
                  {Math.round(data.metadata.latency_ms)}ms
                </div>
              )}
              {/* Tooltip arrow */}
              <div className="absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900"></div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* HEADER */}
      <div 
        className={`flex items-center justify-between px-3 py-2 border-b ${styles.bgHeader} ${styles.borderColor}`}
        style={{ height: '40px' }}
      >
        <div className="flex items-center gap-2">
          <Icon size={16} className={styles.textColor} />
          <span className={`font-bold uppercase text-xs tracking-wider ${styles.textColor}`}>
            {data.label.replace('_', ' ')}
          </span>
        </div>
        <span className="text-xs text-gray-400 font-mono">#{data.sequence}</span>
      </div>

      {/* BODY */}
      <div 
        className="overflow-y-auto"
        style={{ 
          height: `${bodyHeight}px`,
          maxHeight: '280px'
        }}
      >
        {renderContent(data)}
      </div>

      {/* FOOTER */}
      {hasFooter && (
        <div 
          className="flex gap-3 px-3 py-1 bg-gray-50 border-t border-gray-100 text-[10px] text-gray-500 font-mono"
          style={{ height: '24px' }}
        >
          {data.metadata.latency_ms && (
            <div className="flex items-center gap-1">
              <Clock size={10} />
              {Math.round(data.metadata.latency_ms)}ms
            </div>
          )}
          {data.metadata["gen_ai.usage.output_tokens"] && (
            <div className="flex items-center gap-1">
              <Coins size={10} />
              {data.metadata["gen_ai.usage.output_tokens"]} toks
            </div>
          )}
        </div>
      )}

      {/* BOTTOM HANDLE */}
      <Handle type="source" position={Position.Bottom} className="w-3 h-3 bg-gray-500" />

      {/* CONTEXT MENU */}
      {showMenu && (
        <motion.div
          ref={menuRef}
          initial={{ opacity: 0, x: 10 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 10 }}
          className="absolute -right-24 top-0 z-50 w-32 bg-white rounded-lg shadow-xl border border-gray-200 overflow-hidden"
        >
          <button 
            onClick={handleBranchClick}
            className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-purple-50 hover:text-purple-700 flex items-center gap-2 transition-colors"
          >
            <GitBranch size={14} />
            Branch Here
          </button>
        </motion.div>
      )}
    </motion.div>
  );
};

export default memo(ChronosNode);