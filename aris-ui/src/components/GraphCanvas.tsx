import { useEffect, useRef, useState } from 'react';
import { GraphRenderer, type GraphData } from '../lib/renderer';

interface GraphCanvasProps {
  data: GraphData;
}

export default function GraphCanvas({ data }: GraphCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<GraphRenderer | null>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    
    if (!rendererRef.current) {
      rendererRef.current = new GraphRenderer(canvasRef.current, (name) => {
        setHoveredNode(name);
      });
      rendererRef.current.animate();
    }
  }, []);

  useEffect(() => {
    if (rendererRef.current && data.nodes.length > 0) {
      rendererRef.current.updateGraph(data);
    }
  }, [data]);

  return (
    <div style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0, zIndex: 0 }}>
      {hoveredNode && (
        <div style={{
          position: 'absolute',
          top: 20,
          right: 20,
          padding: '10px 15px',
          background: 'rgba(12, 14, 18, 0.8)',
          border: '1px solid #00f3ff',
          color: '#00f3ff',
          borderRadius: '4px',
          fontFamily: 'Space Grotesk, sans-serif',
          backdropFilter: 'blur(10px)',
          zIndex: 10,
          pointerEvents: 'none',
          boxShadow: '0 0 15px rgba(0, 243, 255, 0.3)'
        }}>
          {hoveredNode}
        </div>
      )}
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block', background: '#05070a' }} />
    </div>
  );
}
