import { type Node, type Edge } from 'reactflow';

const API_BASE = import.meta.env.VITE_API_URL || '';;

// 🛡️ Get API key from environment variable
const API_KEY = import.meta.env.VITE_CHRONOS_API_KEY || '';

// Match Backend Pydantic Models
export interface ChronosNodeData {
  label: string;
  sequence: number;
  payload: any;
  metadata: any;
}

export interface GraphResponse {
  nodes: Node<ChronosNodeData>[];
  edges: Edge[];
}

export interface ForkRequest {
  parent_event_id: string;
  new_prompt?: string;
  mutation_type?: 'user_message' | 'system_message' | 'assistant_message' | 'tool_result';
  content?: string;
  tool_call_id?: string;
  tool_name?: string;
  model?: string;
}

export interface ForkResponse {
  status: string;
  conversation_id: string;
}

// 🛡️ Helper function to create authenticated headers
const getAuthHeaders = (additionalHeaders: HeadersInit = {}): HeadersInit => {
  const headers: Record<string, string> = { ...(additionalHeaders as any) };

  if (API_KEY && API_KEY.length > 0) {
    headers["X-API-Key"] = API_KEY;
  }

  return headers;
};


// 🛡️ Helper function to handle API errors
const handleApiError = (response: Response, error?: any): never => {
  if (response.status === 401) {
    throw new Error("This action is disabled in the public demo.");
  }
  if (response.status === 429) {
    throw new Error('Rate limit exceeded. Please wait before retrying.');
  }
  if (response.status === 403) {
    throw new Error("This action is disabled in the public demo.");
  }
  if (error) {
    throw new Error(`API Error: ${error.detail || error.message || response.statusText}`);
  }
  throw new Error(`API Error: ${response.statusText}`);
};

export const fetchConversationGraph = async (conversationId: string): Promise<GraphResponse> => {
  try {
    const response = await fetch(`${API_BASE}/trace/${conversationId}`, {
      headers: getAuthHeaders()
    });

    if (!response.ok) {
      handleApiError(response);
    }

    const data: GraphResponse = await response.json();
    return data;
  } catch (error) {
    console.error("Failed to fetch graph:", error);
    // Return empty graph on failure to prevent UI crash
    return { nodes: [], edges: [] };
  }
};

// 🛡️ NEW: Fork/Branch API call with authentication
export const forkConversation = async (request: ForkRequest): Promise<ForkResponse> => {
  try {
    const response = await fetch(`${API_BASE}/branch/fork`, {
      method: 'POST',
      headers: getAuthHeaders({
        'Content-Type': 'application/json'
      }),
      body: JSON.stringify(request)
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      handleApiError(response, error);
    }

    const data: ForkResponse = await response.json();
    return data;
  } catch (error) {
    console.error("Failed to fork conversation:", error);
    throw error;
  }
};

// 🛡️ NEW: Compare branches API call with authentication
export const compareBranches = async (branchA: string, branchB: string): Promise<any> => {
  try {
    const response = await fetch(
      `${API_BASE}/branch/compare?branch_a=${branchA}&branch_b=${branchB}`,
      {
        headers: getAuthHeaders()
      }
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      handleApiError(response, error);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error("Failed to compare branches:", error);
    throw error;
  }
};