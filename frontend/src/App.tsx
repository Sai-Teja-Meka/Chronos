import React from 'react';
import { ReactFlowProvider } from 'reactflow';
import TraceViewer from './components/TraceViewer';

function App() {
  // The ID used in the "Backend Completion Checkpoint" POST example
  // Ensure this matches the conversation_id you inserted via curl!
  const DEMO_CONVERSATION_ID = "5e43fb35-d34f-43c1-b69c-d751e2c34529";

  return (
    // FIX #2: Ensure the root App component fills the entire viewport
    // without padding or margins that could constrain the graph.
    <div style={{ width: '100vw', height: '100vh', margin: 0, padding: 0, overflow: 'hidden' }}>
      <ReactFlowProvider>
        <TraceViewer conversationId={DEMO_CONVERSATION_ID} />
      </ReactFlowProvider>
    </div>
  );
}

export default App;