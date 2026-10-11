import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export type FlightModel = 'interceptor' | 'guardian' | 'heavy' | 'carrier' | 'abductor' | 'hunter' | 'jammer' | 'forgery' | 'spammer' | 'sybil';
interface FlightPart { geometry: THREE.BufferGeometry; material: THREE.MeshStandardMaterial; surface: string }
interface Asset { state: 'idle' | 'loading' | 'ready' | 'failed'; parts: FlightPart[] }
const assets: Record<FlightModel, Asset> = {
  interceptor: { state:'idle', parts:[] }, guardian: { state:'idle', parts:[] },
  heavy: { state:'idle', parts:[] }, carrier: { state:'idle', parts:[] },
  abductor: { state:'idle', parts:[] }, hunter: { state:'idle', parts:[] },
  jammer: { state:'idle', parts:[] }, forgery: { state:'idle', parts:[] },
  spammer: { state:'idle', parts:[] }, sybil: { state:'idle', parts:[] },
};
let environment: THREE.Texture | undefined;
let environmentTarget: THREE.WebGLRenderTarget | undefined;
const bakes = new Map<FlightModel, THREE.MeshBasicMaterial>();
// One neutral studio reflection map, shared by all authored metals. The old
// coloured scene lights still provide the game's cyan/rose rim lighting.
export function prepareFlightEnvironment(renderer: THREE.WebGLRenderer, restored = false): void {
  if (environment && !restored) return;
  environmentTarget?.dispose();
  const generator = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  environmentTarget = generator.fromScene(room, 0.04);
  environment = environmentTarget.texture;
  room.dispose();
  generator.dispose();
  for (const asset of Object.values(assets)) for (const part of asset.parts) {
    part.material.envMap = environment;
    part.material.needsUpdate = true;
  }
}

export function requestFlightArt(names: readonly FlightModel[] = ['interceptor','guardian','heavy','carrier']): void {
  for (const name of names) {
    const asset = assets[name];
    if (asset.state !== 'idle') continue;
    asset.state = 'loading';
    new THREE.TextureLoader().load(`/models/${name}-${flightVersion(name)}.webp`, texture => {
      texture.colorSpace = THREE.SRGBColorSpace;
      bakes.set(name, new THREE.MeshBasicMaterial({ map:texture, transparent:true, depthWrite:false, alphaTest:0.02, toneMapped:false }));
    }, undefined, () => { /* Immediate geometry fallback remains available. */ });
    void load(name, asset).catch(error => {
      asset.parts.forEach(p => { p.geometry.dispose(); p.material.dispose(); });
      asset.parts.length = 0;
      asset.state = 'failed';
      console.warn(`[flight-art:${name}] Using immediate procedural fallback`, error);
    });
  }
}

async function load(name: FlightModel, asset: Asset): Promise<void> {
  const response = await fetch(`/models/${name}-${flightVersion(name)}.glb`, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`Flight art HTTP ${response.status}`);
  const gltf = await new GLTFLoader().parseAsync(await response.arrayBuffer(), '');
  gltf.scene.updateMatrixWorld(true);
  const batches = new Map<string, { geometries: THREE.BufferGeometry[]; material: THREE.MeshStandardMaterial }>();
  const axes = new THREE.Matrix4().makeRotationX(Math.PI / 2);
  gltf.scene.traverse(obj => {
    if (!(obj instanceof THREE.Mesh)) return;
    const material = obj.material as THREE.MeshStandardMaterial;
    material.envMap = environment ?? null;
    material.envMapIntensity = 0.85;
    const geometry = obj.geometry.clone().applyMatrix4(obj.matrixWorld).applyMatrix4(axes);
    // Blender primitives carry UVs, authored lofts do not. This pipeline is
    // texture-free, so normalize the layouts before merging material batches.
    geometry.deleteAttribute('uv');
    // All authored parts share five material identities. Keep their Blender
    // PBR values instead of substituting the old emissive procedural colours.
    const batch = batches.get(material.name) ?? { geometries: [], material };
    batch.geometries.push(geometry);
    batches.set(material.name, batch);
    obj.geometry.dispose();
  });
  for (const [surface, batch] of batches) {
    const geometry = mergeGeometries(batch.geometries);
    batch.geometries.forEach(g => g.dispose());
    if (!geometry) throw new Error('Flight material batch failed');
    asset.parts.push({ surface, geometry, material: batch.material });
  }
  if (!asset.parts.length || asset.parts.length > 5) throw new Error('Incomplete flight model');
  asset.state = 'ready';
}

export function getFlightArt(name: FlightModel): readonly FlightPart[] { return assets[name].parts; }
function flightVersion(name: FlightModel): string {
  return ['interceptor','guardian','heavy','carrier'].includes(name) ? 'v2' : 'v3';
}
export function getFlightBake(name: FlightModel): THREE.MeshBasicMaterial | undefined { return bakes.get(name); }
export function flightArtDiagnostics() {
  return Object.fromEntries(Object.entries(assets).map(([name, a]) => [name, { state:a.state, batches:a.parts.length, bakeReady:bakes.has(name as FlightModel) }]));
}
