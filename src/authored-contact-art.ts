import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

let state: 'idle' | 'loading' | 'ready' | 'failed' = 'idle';
let geometry: THREE.BufferGeometry | undefined;
// Also keep the same UV mapping while the Blender geometry loads or fails.
const fallback = new THREE.SphereGeometry(21, 32, 20);
const positions = fallback.getAttribute('position');
const uv = fallback.getAttribute('uv');
for (let i=0;i<positions.count;i++) {
  uv.setXY(i,.5+Math.atan2(positions.getX(i),Math.abs(positions.getZ(i)))/Math.PI,
    .5-Math.asin(Math.max(-1,Math.min(1,positions.getY(i)/21)))/Math.PI);
}

export function contactGeometry(): THREE.BufferGeometry {
  if (state === 'idle') {
    state = 'loading';
    void (async () => {
      const response = await fetch('/models/contact-sphere-v1.glb',{signal:AbortSignal.timeout(8000)});
      if (!response.ok) throw new Error(`Contact art HTTP ${response.status}`);
      const gltf = await new GLTFLoader().parseAsync(await response.arrayBuffer(),'');
      gltf.scene.updateMatrixWorld(true);
      gltf.scene.traverse(obj => {
        if (!(obj instanceof THREE.Mesh)) return;
        geometry = obj.geometry.clone().applyMatrix4(obj.matrixWorld);
        obj.geometry.dispose();
        (Array.isArray(obj.material)?obj.material:[obj.material]).forEach(m=>m.dispose());
      });
      if (!geometry?.getAttribute('uv')) throw new Error('Contact portrait UV missing');
      state = 'ready';
    })().catch(() => { geometry?.dispose(); geometry=undefined; state='failed'; });
  }
  return geometry ?? fallback;
}

export function contactGeometryDiagnostics() {
  const g=geometry ?? fallback;
  return {state,triangles:(g.index?.count ?? g.getAttribute('position').count)/3,uv:g.hasAttribute('uv')};
}
