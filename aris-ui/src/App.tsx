import { useState, useEffect, useRef, useCallback } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import './App.css';

interface GraphNode {
  id: number;
  label: string;
  x?: number;
  y?: number;
}
interface GraphLink {
  source: number;
  target: number;
  kind: string;
}

export default function App() {
  const [query, setQuery] = useState('');
  const [graphData, setGraphData] = useState<{ nodes: GraphNode[]; links: GraphLink[] }>({ nodes: [], links: [] });
  const [highlightedNodes, setHighlightedNodes] = useState<Set<number>>(new Set());
  const [answer, setAnswer] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [mode, setMode] = useState<'idle' | 'loading_repo' | 'loaded' | 'querying'>('idle');
  const [wsStatus, setWsStatus] = useState<'connecting' | 'open' | 'closed'>('connecting');
  const [logs, setLogs] = useState<string[]>(['[ARIS] System initialized. Waiting for input...']);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [topFiles, setTopFiles] = useState<string[]>([]);

  const ws = useRef<WebSocket | null>(null);
  const fgRef = useRef<any>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const pushLog = useCallback((msg: string) => {
    setLogs(prev => [...prev.slice(-30), msg]);
  }, []);

  useEffect(() => {
    const connect = () => {
      const socket = new WebSocket('ws://127.0.0.1:9001');
      ws.current = socket;

      socket.onopen = () => {
        setWsStatus('open');
        pushLog('[ARIS] ✓ WebSocket connected to backend on port 9001');
        // Keepalive ping every 20s
        pingRef.current = setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'ping' }));
          }
        }, 20_000);
      };

      socket.onclose = () => {
        setWsStatus('closed');
        if (pingRef.current) clearInterval(pingRef.current);
        pushLog('[ARIS] ✗ Connection lost — retrying in 3s...');
        setTimeout(connect, 3000);
      };

      socket.onerror = () => {
        pushLog('[ARIS] ✗ WebSocket error');
      };

      socket.onmessage = (event) => {
        const msg = JSON.parse(event.data);

        if (msg.type === 'progress') {
          setProgress({ current: msg.current, total: msg.total });
          return;
        }

        if (msg.type === 'pong') return;

        if (msg.type === 'graph') {
          const links = msg.edges.map((e: any) => ({ source: e.source, target: e.target, kind: e.kind }));
          setGraphData({ nodes: msg.nodes, links });
          setMode('loaded');
          setIsLoading(false);
          setProgress(null);
          pushLog(`[ARIS] ✓ Graph loaded — ${msg.nodes.length} nodes, ${msg.edges.length} edges`);
          setTimeout(() => fgRef.current?.zoomToFit(500, 40), 600);
        }

        if (msg.type === 'answer') {
          setAnswer(msg.answer);
          const highlighted = new Set(msg.highlighted_nodes as number[]);
          setHighlightedNodes(highlighted);
          setTopFiles(msg.top_files || []);
          setMode('loaded');
          setIsLoading(false);
          pushLog(`[ARIS] ✓ LLM response received (${msg.answer.length} chars)`);
          
          // Camera Behavior (Centroid Zoom)
          if (msg.highlighted_nodes?.length > 0 && fgRef.current) {
            const hNodes = graphData.nodes.filter(n => highlighted.has(n.id));
            if (hNodes.length > 0) {
              const avgX = hNodes.reduce((acc, n) => acc + (n.x || 0), 0) / hNodes.length;
              const avgY = hNodes.reduce((acc, n) => acc + (n.y || 0), 0) / hNodes.length;
              fgRef.current.centerAt(avgX, avgY, 800);
              fgRef.current.zoom(3, 800);
            }
          }
        }

        if (msg.type === 'error') {
          setAnswer('⚠ ' + msg.message);
          setIsLoading(false);
          setProgress(null);
          setMode(graphData.nodes.length > 0 ? 'loaded' : 'idle');
          pushLog(`[ARIS] ✗ Error: ${msg.message}`);
        }
      };
    };

    connect();
    return () => ws.current?.close();
  }, []);

  const sendCommand = useCallback((input: string) => {
    if (!ws.current || ws.current.readyState !== WebSocket.OPEN) {
      pushLog('[ARIS] ✗ Not connected — cannot send command');
      return;
    }
    const trimmed = input.trim();
    if (!trimmed) return;

    setIsLoading(true);
    setAnswer('');
    setSelectedNode(null);

    if (trimmed.match(/^[\w.-]+\/[\w.-]+$/) || trimmed.includes('github.com')) {
      let owner = '', repo = '';
      if (trimmed.includes('github.com')) {
        const parts = trimmed.replace(/https?:\/\/github\.com\//, '').split('/');
        owner = parts[0];
        repo = parts[1]?.replace('.git', '') || '';
      } else {
        [owner, repo] = trimmed.split('/');
      }
      pushLog(`[ARIS] Loading repo ${owner}/${repo} from GitHub...`);
      setMode('loading_repo');
      setGraphData({ nodes: [], links: [] });
      setHighlightedNodes(new Set());
      ws.current.send(JSON.stringify({ type: 'load_repo', owner, repo }));
    } else {
      pushLog(`[ARIS] Querying LLM: "${trimmed}"`);
      setMode('querying');
      ws.current.send(JSON.stringify({ type: 'query', question: trimmed }));
    }
    setQuery('');
  }, [graphData.nodes, pushLog]);

  const handleNodeClick = useCallback((node: GraphNode) => {
    setSelectedNode(node);
    pushLog(`[ARIS] Node selected: ${node.label}`);
  }, [pushLog]);

  const querySelectedNode = useCallback(() => {
    if (!selectedNode) return;
    const q = `Explain the role of "${selectedNode.label}" in this codebase and what it depends on.`;
    sendCommand(q);
  }, [selectedNode, sendCommand]);

  const statusColor = wsStatus === 'open' ? '#00ffab' : wsStatus === 'connecting' ? '#f5c842' : '#ff4444';
  const nodeCount = graphData.nodes.length;
  const edgeCount = graphData.links.length;

  return (
    <div className="dashboard-container">
      {/* ── HEADER ── */}
      <header className="system-header glass-panel">
        <div className="logo-section">
          <div className="pulse-dot" style={{ background: statusColor, boxShadow: `0 0 10px ${statusColor}` }} />
          <div>
            <h1 className="logo-text">A.R.I.S.</h1>
            <span className="logo-sub">Autonomous Repository Intelligence System</span>
          </div>
        </div>

        <div className="header-status">
          {mode === 'idle' && <span className="header-hint">↓ Enter a GitHub repo (e.g. <code>pallets/flask</code>) to begin</span>}
          {mode === 'loading_repo' && <span className="header-hint syncing">◐ Fetching repository tree from GitHub...</span>}
          {mode === 'loaded' && <span className="header-hint">✓ {nodeCount} files indexed · ask a question below</span>}
          {mode === 'querying' && <span className="header-hint syncing">◐ Reasoning over graph context...</span>}
        </div>

        <div className="header-right">
          <span className="ws-badge" style={{ color: statusColor }}>
            {wsStatus === 'open' ? '● BACKEND LIVE' : wsStatus === 'connecting' ? '◌ CONNECTING' : '✕ DISCONNECTED'}
          </span>
          <span className="version-badge">v1.1.0</span>
        </div>
      </header>

      {/* ── MAIN CONTENT ── */}
      <main className="main-content">
        {/* Graph */}
        <div className="graph-area">
          {nodeCount === 0 && !isLoading && (
            <div className="graph-placeholder">
              <div className="placeholder-icon">⬡</div>
              <p>Graph will render here after loading a repository</p>
              <p className="placeholder-sub">Nodes = files · Edges = import dependencies</p>
            </div>
          )}
          {isLoading && mode === 'loading_repo' && (
            <div className="graph-placeholder">
              <div className="spinner" />
              <p>Parsing repository structure<span className="blink">_</span></p>
              {progress ? (
                <div className="progress-wrap">
                  <div className="progress-bar" style={{ width: `${Math.round((progress.current / progress.total) * 100)}%` }} />
                  <span className="progress-label">{progress.current} / {progress.total} files</span>
                </div>
              ) : (
                <p className="placeholder-sub">Fetching file tree...</p>
              )}
            </div>
          )}
          {nodeCount > 0 && (
            <ForceGraph2D
              ref={fgRef}
              graphData={graphData}
              nodeLabel="label"
              nodeId="id"
              nodeVal={(node: any) => highlightedNodes.has(node.id) ? 6 : 3}
              nodeColor={(node: any) => {
                if (highlightedNodes.size > 0 && !highlightedNodes.has(node.id) && selectedNode?.id !== node.id) {
                  return 'rgba(75, 85, 99, 0.3)'; // Dim non-highlighted to 0.3 opacity
                }
                if (selectedNode?.id === node.id) return '#ffffff';
                if (highlightedNodes.has(node.id)) return '#a1faff'; // Highlight color
                // Color by file extension
                const label: string = node.label || '';
                if (label.endsWith('.rs')) return '#f97316';
                if (label.endsWith('.py')) return '#3b82f6';
                if (label.endsWith('.ts') || label.endsWith('.tsx')) return '#8b5cf6';
                if (label.endsWith('.js') || label.endsWith('.jsx')) return '#eab308';
                if (label.endsWith('.go')) return '#06b6d4';
                if (label.endsWith('.java')) return '#ef4444';
                return '#4b5563';
              }}
              linkColor={(link: any) => {
                const isHighlight = highlightedNodes.size > 0 && 
                  highlightedNodes.has(typeof link.source === 'object' ? link.source.id : link.source) &&
                  highlightedNodes.has(typeof link.target === 'object' ? link.target.id : link.target);
                
                return link.kind === 'Imports' 
                  ? (isHighlight ? 'rgba(0, 255, 171, 0.8)' : 'rgba(0, 255, 171, 0.3)')
                  : 'rgba(255, 255, 255, 0.1)';
              }}

              linkWidth={1}
              linkDirectionalArrowLength={3}
              linkDirectionalArrowRelPos={1}
              backgroundColor="#0c0e12"
              onNodeClick={handleNodeClick}
              nodeCanvasObjectMode={() => 'after'}
              nodeCanvasObject={(node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
                if (globalScale < 1.5) return;
                const label: string = node.label?.split('/').pop() || '';
                const fontSize = 10 / globalScale;
                ctx.font = `${fontSize}px Inter, sans-serif`;
                ctx.fillStyle = highlightedNodes.has(node.id) ? '#a1faff' : 'rgba(255,255,255,0.6)';
                ctx.textAlign = 'center';
                ctx.fillText(label, node.x, (node.y || 0) + 8 / globalScale);
              }}
              warmupTicks={50}
              cooldownTicks={100}
            />
          )}
        </div>

        {/* Sidebar */}
        <aside className="sidebar glass-panel">
          <div className="sidebar-section">
            <h2 className="section-label">GRAPH METRICS</h2>
            <div className="metrics-grid">
              <div className="metric-card">
                <span className="metric-val" style={{ color: '#00ffab' }}>{nodeCount}</span>
                <span className="metric-key">FILES</span>
              </div>
              <div className="metric-card">
                <span className="metric-val" style={{ color: '#a1faff' }}>{edgeCount}</span>
                <span className="metric-key">EDGES</span>
              </div>
              <div className="metric-card">
                <span className="metric-val" style={{ color: '#f97316' }}>{highlightedNodes.size}</span>
                <span className="metric-key">HIGHLIGHTED</span>
              </div>
            </div>
          </div>

          {/* Legend */}
          {nodeCount > 0 && (
            <div className="sidebar-section">
              <h2 className="section-label">NODE LEGEND</h2>
              <div className="legend">
                {[
                  { color: '#f97316', label: '.rs  Rust' },
                  { color: '#3b82f6', label: '.py  Python' },
                  { color: '#8b5cf6', label: '.ts  TypeScript' },
                  { color: '#eab308', label: '.js  JavaScript' },
                  { color: '#06b6d4', label: '.go  Go' },
                  { color: '#ef4444', label: '.java Java' },
                ].map(({ color, label }) => (
                  <div key={label} className="legend-row">
                    <span className="legend-dot" style={{ background: color }} />
                    <span className="legend-text">{label}</span>
                  </div>
                ))}
                <div className="legend-row">
                  <span className="legend-dot" style={{ background: '#a1faff' }} />
                  <span className="legend-text">highlighted by LLM</span>
                </div>
              </div>
            </div>
          )}

          {/* Selected node */}
          {selectedNode && (
            <div className="sidebar-section">
              <h2 className="section-label">SELECTED NODE</h2>
              <div className="selected-node-box">
                <p className="selected-node-path">{selectedNode.label}</p>
                <button className="action-btn" onClick={querySelectedNode} disabled={isLoading}>
                  {isLoading ? 'Processing...' : '⚡ Ask ARIS about this file'}
                </button>
              </div>
            </div>
          )}

          {/* Answer panel */}
          {answer && (
            <div className="sidebar-section answer-section">
              <h2 className="section-label">ARIS RESPONSE</h2>
              <div className="answer-box">
                <p className="answer-text">{answer}</p>
                {topFiles.length > 0 && (
                  <div className="top-files-list">
                    <p className="small-label">RELEVANT FILES:</p>
                    {topFiles.map(f => <div key={f} className="file-chip">{f}</div>)}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Loading indicator */}
          {isLoading && mode === 'querying' && (
            <div className="sidebar-section">
              <div className="loading-indicator">
                <div className="spinner-small" />
                <span>ARIS processing<span className="blink">_</span></span>
              </div>
            </div>
          )}
        </aside>
      </main>

      {/* ── TERMINAL LOG ── */}
      <div className="log-strip glass-panel">
        <div className="log-scroll">
          {logs.map((l, i) => (
            <span key={i} className="log-line">{l}</span>
          ))}
        </div>
      </div>

      {/* ── TERMINAL INPUT ── */}
      <footer className="terminal-footer glass-panel">
        <span className="terminal-prefix">aris@graph:~$</span>
        <input
          ref={inputRef}
          type="text"
          className="command-input"
          placeholder={mode === 'idle' ? 'Enter owner/repo to load (e.g. pallets/flask)...' : nodeCount > 0 ? 'Ask a question about the codebase...' : 'Loading...'}
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') sendCommand(query); }}
          disabled={isLoading}
          autoFocus
        />
        <button
          className="execute-btn primary-btn"
          onClick={() => sendCommand(query)}
          disabled={isLoading || !query.trim()}
        >
          {isLoading ? <span className="blink">WAIT</span> : 'EXECUTE ↵'}
        </button>
      </footer>
    </div>
  );
}
