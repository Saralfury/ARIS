import * as THREE from 'three';
import { OrbitControls } from 'three-stdlib';
import { EffectComposer } from 'three-stdlib';
import { RenderPass } from 'three-stdlib';
import { UnrealBloomPass } from 'three-stdlib';

export type GraphData = {
  nodes: { id: string; x: number; y: number; z: number; name?: string; type?: string }[];
  edges: { src: string; dst: string }[];
};

const MAX_NODES = 5000;
const NODE_GEOMETRY = new THREE.SphereGeometry(0.2, 16, 16);
const FILE_MATERIAL = new THREE.MeshBasicMaterial({ color: 0x00e5ff });
const FOLDER_MATERIAL = new THREE.MeshBasicMaterial({ color: 0xff00aa });

export class GraphRenderer {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private composer: EffectComposer;
  private controls: OrbitControls;
  
  private instancedMesh: THREE.InstancedMesh | null = null;
  private edgesLines: THREE.LineSegments | null = null;
  private dummy = new THREE.Object3D();

  // Hover detection
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();
  private onHoverCallback?: (nodeName: string | null) => void;

  constructor(canvas: HTMLCanvasElement, onHover?: (name: string | null) => void) {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, canvas.clientWidth / canvas.clientHeight, 0.1, 2000);
    this.camera.position.set(0, 0, 50);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight);

    this.onHoverCallback = onHover;

    // Controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;

    // Post-processing Bloom
    const renderScene = new RenderPass(this.scene, this.camera);
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
    bloomPass.threshold = 0;
    bloomPass.strength = 1.2;
    bloomPass.radius = 0.5;

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(renderScene);
    this.composer.addPass(bloomPass);

    // Resize handler
    window.addEventListener('resize', this.onWindowResize.bind(this));
    
    // Mouse tracking for hover
    canvas.addEventListener('mousemove', this.onMouseMove.bind(this));
  }

  private onWindowResize() {
    const parent = this.renderer.domElement.parentElement;
    if (!parent) return;
    this.camera.aspect = parent.clientWidth / parent.clientHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(parent.clientWidth, parent.clientHeight);
    this.composer.setSize(parent.clientWidth, parent.clientHeight);
  }

  private onMouseMove(event: MouseEvent) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  public updateGraph(data: GraphData) {
    this.cleanup();

    if (data.nodes.length === 0) return;

    // 1. Instanced Nodes
    const nodeCount = Math.min(data.nodes.length, MAX_NODES);
    this.instancedMesh = new THREE.InstancedMesh(NODE_GEOMETRY, FILE_MATERIAL, nodeCount);
    
    // Custom colors for folders vs files
    const color = new THREE.Color();
    
    data.nodes.slice(0, nodeCount).forEach((node, i) => {
      this.dummy.position.set(node.x, node.y, node.z);
      this.dummy.updateMatrix();
      this.instancedMesh!.setMatrixAt(i, this.dummy.matrix);

      if (node.type === 'tree') {
        color.setHex(0xff00aa); // Pink folders
      } else {
        color.setHex(0x00e5ff); // Cyan files
      }
      this.instancedMesh!.setColorAt(i, color);
    });

    this.instancedMesh.instanceMatrix.needsUpdate = true;
    if (this.instancedMesh.instanceColor) this.instancedMesh.instanceColor.needsUpdate = true;
    
    // Attach userData for node mapping
    this.instancedMesh.userData = { nodes: data.nodes.slice(0, nodeCount) };
    this.scene.add(this.instancedMesh);

    // 2. Lines (Edges)
    const lineMaterial = new THREE.LineBasicMaterial({ 
      color: 0x00ffff, 
      transparent: true, 
      opacity: 0.15 
    });
    
    const points: number[] = [];
    const nodeMap = new Map(data.nodes.map(n => [n.id, n]));
    
    data.edges.forEach(edge => {
      const src = nodeMap.get(edge.src);
      const dst = nodeMap.get(edge.dst);
      if (src && dst) {
        points.push(src.x, src.y, src.z);
        points.push(dst.x, dst.y, dst.z);
      }
    });

    const lineGeometry = new THREE.BufferGeometry();
    lineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    this.edgesLines = new THREE.LineSegments(lineGeometry, lineMaterial);
    this.scene.add(this.edgesLines);
  }

  public animate() {
    requestAnimationFrame(() => this.animate());
    
    this.controls.update();

    // Raycast hover logic
    if (this.instancedMesh) {
      this.raycaster.setFromCamera(this.mouse, this.camera);
      const intersects = this.raycaster.intersectObject(this.instancedMesh);
      if (intersects.length > 0) {
        const instanceId = intersects[0].instanceId;
        if (instanceId !== undefined && this.onHoverCallback) {
          const node = this.instancedMesh.userData.nodes[instanceId];
          this.onHoverCallback(node.name || node.id);
        }
      } else if (this.onHoverCallback) {
        this.onHoverCallback(null);
      }
    }

    // Spin whole scene slowly
    this.scene.rotation.y += 0.001;

    this.composer.render();
  }

  private cleanup() {
    if (this.instancedMesh) {
      this.scene.remove(this.instancedMesh);
      this.instancedMesh.dispose();
      this.instancedMesh = null;
    }
    if (this.edgesLines) {
      this.scene.remove(this.edgesLines);
      this.edgesLines.geometry.dispose();
      (this.edgesLines.material as THREE.Material).dispose();
      this.edgesLines = null;
    }
  }
}
