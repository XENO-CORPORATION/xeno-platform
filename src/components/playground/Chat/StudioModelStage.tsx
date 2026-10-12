import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Grid3x3, RotateCw, ScanEye, Sun } from 'lucide-react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { Generation } from '@/lib/generations';
import { useResultMedia } from './StudioGenerationFeed';

/** Stage view (3D only): the model in a real scene that fills the pane behind the prompt box. The person
    owns the camera; the panel changes how the model is drawn and lit, never the model itself. */
type Look = 'shaded' | 'wire' | 'both' | 'clay' | 'normals';
type Light = 'studio' | 'soft' | 'hard' | 'rim';
const LOOKS: Array<[Look, string]> = [['shaded', 'Shaded'], ['both', 'Shaded + wire'], ['wire', 'Wire'], ['clay', 'Clay'], ['normals', 'Normals']];
const LIGHTS: Array<[Light, string]> = [['studio', 'Studio'], ['soft', 'Soft'], ['hard', 'Hard'], ['rim', 'Rim']];
const read = <T extends string>(key: string, allowed: readonly T[], fallback: T): T => { try { const v = localStorage.getItem(key) as T; return allowed.includes(v) ? v : fallback; } catch { return fallback; } };
const keep = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* the choice still applies now */ } };

type Scene = { setModel: (url: string | null) => void; setLook: (look: Look) => void; setLight: (light: Light, exposure: number) => void; setGrid: (on: boolean) => void; setTurn: (on: boolean) => void; frame: () => void; dispose: () => void };

function createScene(canvas: HTMLCanvasElement, host: HTMLElement, report: (state: { phase: 'idle' | 'loading' | 'ready' | 'failed'; triangles?: number; vertices?: number }) => void): Scene {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer); const room = pmrem.fromScene(new RoomEnvironment(), 0.04).texture; scene.environment = room;
  const camera = new THREE.PerspectiveCamera(34, 1, 0.01, 200);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.dampingFactor = 0.08; controls.rotateSpeed = 0.8; controls.maxPolarAngle = Math.PI * 0.497; controls.autoRotateSpeed = 1.1;
  // The floor: a faint grid that fades with distance, and a plane that only catches the shadow.
  const grid = new THREE.GridHelper(40, 80, 0x5a5a5a, 0x2c2c2c); (grid.material as any).transparent = true; (grid.material as any).opacity = 0.55; scene.add(grid);
  scene.fog = new THREE.Fog(0x0d0d0e, 9, 26);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.ShadowMaterial({ opacity: 0.42 })); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  const key = new THREE.DirectionalLight(0xffffff, 2.2), fill = new THREE.DirectionalLight(0xffffff, 0.6), back = new THREE.DirectionalLight(0xffffff, 0), sky = new THREE.HemisphereLight(0xffffff, 0x1a1a1a, 0.3);
  key.castShadow = true; key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -0.0002; key.shadow.radius = 5;
  Object.assign(key.shadow.camera, { near: 0.1, far: 30, left: -4, right: 4, top: 4, bottom: -4 });
  scene.add(key, fill, back, sky);
  const clay = new THREE.MeshStandardMaterial({ color: 0xb9b6b0, roughness: 0.78, metalness: 0 }), normals = new THREE.MeshNormalMaterial(), wire = new THREE.MeshBasicMaterial({ color: 0xe8e8e8, wireframe: true });
  const overlay = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.32 });
  let model: any = null, look: Look = 'shaded', frameId = 0, serial = 0, alive = true;
  const meshes = () => { const out: any[] = []; model?.traverse((o: any) => { if (o.isMesh && !o.userData.overlay) out.push(o); }); return out; };
  const applyLook = () => {
    for (const mesh of meshes()) {
      mesh.userData.own ??= mesh.material;
      mesh.material = look === 'wire' ? wire : look === 'clay' ? clay : look === 'normals' ? normals : mesh.userData.own;
      let lines = mesh.children.find((c: any) => c.userData.overlay);
      if (look === 'both' && !lines) { lines = new THREE.LineSegments(new THREE.WireframeGeometry(mesh.geometry), overlay); lines.userData.overlay = true; mesh.add(lines); }
      if (lines) lines.visible = look === 'both';
    }
  };
  const fit = () => {
    if (!model) return;
    const box = new THREE.Box3().setFromObject(model), size = box.getSize(new THREE.Vector3()), radius = Math.max(size.x, size.y, size.z) * 0.5 || 1;
    const distance = radius / Math.sin((camera.fov * Math.PI) / 360) * 2.05;
    // Aim below the model's middle: the prompt box covers the bottom of the pane, so the model sits above it.
    controls.target.set(0, size.y * 0.16, 0); camera.position.set(distance * 0.62, size.y * 0.16 + distance * 0.3, distance * 0.72);
    camera.near = distance / 100; camera.far = distance * 40; camera.updateProjectionMatrix(); controls.minDistance = radius * 0.6; controls.maxDistance = distance * 5; controls.update();
  };
  const clear = () => {
    if (!model) return; scene.remove(model);
    model.traverse((o: any) => { o.geometry?.dispose?.(); for (const m of [].concat(o.userData?.own || o.material || [])) { for (const v of Object.values(m as any)) (v as any)?.isTexture && (v as any).dispose(); (m as any).dispose?.(); } });
    model = null;
  };
  const resize = () => { const w = host.clientWidth, h = host.clientHeight; if (!w || !h) return; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); };
  const observer = new ResizeObserver(resize); observer.observe(host); resize();
  const tick = () => { if (!alive) return; frameId = requestAnimationFrame(tick); if (document.hidden) return; controls.update(); renderer.render(scene, camera); };
  tick();
  return {
    setModel(url) {
      const mine = ++serial; clear();
      if (!url) { report({ phase: 'idle' }); return; }
      report({ phase: 'loading' });
      new GLTFLoader().load(url, (gltf: any) => {
        if (!alive || mine !== serial) return;
        model = gltf.scene;
        // One size for every model: two units tall at most, centred, standing on the floor.
        const box = new THREE.Box3().setFromObject(model), size = box.getSize(new THREE.Vector3()), centre = box.getCenter(new THREE.Vector3()), scale = 2 / (Math.max(size.x, size.y, size.z) || 1);
        model.position.sub(centre).multiplyScalar(scale); model.scale.setScalar(scale); model.position.y += (size.y * scale) / 2;
        let triangles = 0, vertices = 0;
        model.traverse((o: any) => { if (!o.isMesh) return; o.castShadow = true; o.receiveShadow = true; const g = o.geometry; vertices += g.attributes.position?.count || 0; triangles += (g.index ? g.index.count : g.attributes.position?.count || 0) / 3; });
        scene.add(model); applyLook(); fit(); report({ phase: 'ready', triangles: Math.round(triangles), vertices });
      }, undefined, () => { if (alive && mine === serial) report({ phase: 'failed' }); });
    },
    setLook(next) { look = next; applyLook(); },
    setLight(light, exposure) {
      renderer.toneMappingExposure = exposure;
      const set = (k: number, f: number, b: number, s: number, env: number, kp: [number, number, number]) => { key.intensity = k; fill.intensity = f; back.intensity = b; sky.intensity = s; (scene as any).environmentIntensity = env; key.position.set(...kp); };
      fill.position.set(-4, 2.5, 2); back.position.set(-2.5, 3.5, -5);
      if (light === 'studio') set(2.2, 0.6, 0.5, 0.3, 0.9, [3.2, 5.5, 3.6]);
      else if (light === 'soft') set(0.7, 0.7, 0.2, 1.1, 1.35, [2, 7, 2]);
      else if (light === 'hard') set(4.2, 0.05, 0, 0.04, 0.12, [4.5, 4.2, 1.4]);
      else set(0.35, 0.1, 5.2, 0.05, 0.2, [1.5, 3, 4]);
    },
    setGrid(on) { grid.visible = on; },
    setTurn(on) { controls.autoRotate = on; },
    frame: fit,
    dispose() { alive = false; cancelAnimationFrame(frameId); observer.disconnect(); clear(); controls.dispose(); pmrem.dispose(); room.dispose(); for (const m of [clay, normals, wire, overlay, floor.material, grid.material]) (m as any).dispose(); floor.geometry.dispose(); grid.geometry.dispose(); renderer.dispose(); },
  };
}

export default function StudioModelStage({ records, activeId, modelNames, onOpen, onExit, barHost }: { records: Generation[]; barHost: HTMLElement | null; activeId: string | null; modelNames: Record<string, string>; onOpen: (id: string, replace?: boolean) => void; onExit: () => void }) {
  // Newest first in the list the feed gives us; the stage steps through the finished ones.
  const finished = records.filter(g => g.state === 'succeeded' && g.resultAssetIds[0]);
  const index = Math.max(0, finished.findIndex(g => g.id === activeId));
  const current = finished[index];
  const { media, error } = useResultMedia(current?.resultAssetIds[0]);
  const host = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null), scene = useRef<Scene | null>(null);
  const [status, setStatus] = useState<{ phase: 'idle' | 'loading' | 'ready' | 'failed'; triangles?: number; vertices?: number }>({ phase: 'idle' });
  const [look, setLook] = useState<Look>(() => read('xeno_stage_look', LOOKS.map(l => l[0]), 'shaded'));
  const [light, setLight] = useState<Light>(() => read('xeno_stage_light', LIGHTS.map(l => l[0]), 'studio'));
  const [exposure, setExposure] = useState(1);
  const [grid, setGrid] = useState(true);
  const [turn, setTurn] = useState(false);
  const [unsupported, setUnsupported] = useState(false);
  useEffect(() => {
    if (!canvas.current || !host.current) return;
    try { scene.current = createScene(canvas.current, host.current, setStatus); } catch { setUnsupported(true); return; }
    return () => { scene.current?.dispose(); scene.current = null; };
  }, []);
  useEffect(() => { scene.current?.setModel(media?.url ?? null); }, [media?.url]);
  useEffect(() => { scene.current?.setLook(look); keep('xeno_stage_look', look); }, [look]);
  useEffect(() => { scene.current?.setLight(light, exposure); keep('xeno_stage_light', light); }, [light, exposure]);
  useEffect(() => { scene.current?.setGrid(grid); }, [grid]);
  useEffect(() => { scene.current?.setTurn(turn); }, [turn]);
  const step = (direction: number) => { const next = finished[Math.min(finished.length - 1, Math.max(0, index + direction))]; if (next && next.id !== current?.id) onOpen(next.id, true); };
  const stepRef = useRef(step); stepRef.current = step;
  // The addressed result may be one that has not finished; the stage then shows the newest that has.
  useEffect(() => { if (current && current.id !== activeId) onOpen(current.id, true); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [current?.id]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const target = e.target as HTMLElement | null;
      const empty = target instanceof HTMLTextAreaElement && target.value === '';
      if (target && target !== document.body && !empty && !target.closest('.sms, .sms-bar')) return;
      if (target instanceof HTMLInputElement) return;
      if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); stepRef.current(-1); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); stepRef.current(1); }
      else if (e.key === 'Escape') { e.preventDefault(); onExit(); }
    };
    document.addEventListener('keydown', onKey, true); return () => document.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const message = unsupported ? 'This browser cannot draw 3D here.' : !finished.length ? 'No finished 3D model yet. Describe one below.' : error ? error : status.phase === 'failed' ? 'This model could not be opened.' : status.phase !== 'ready' ? 'Opening the model' : '';
  const ready = status.phase === 'ready';
  // The scene has the whole pane. Its tools are one strip joined to the top of the prompt box, so the box
  // and the tools read as a single console; what the model is, is written on the scene itself.
  const bar = <div className="sms-bar" role="toolbar" aria-label="Stage tools">
    <div className="sms-seg" role="radiogroup" aria-label="Display">{LOOKS.map(([value, label]) => <button key={value} type="button" role="radio" aria-checked={look === value} onClick={() => setLook(value)}>{label}</button>)}</div>
    <div className="sms-seg" role="radiogroup" aria-label="Lighting">{LIGHTS.map(([value, label]) => <button key={value} type="button" role="radio" aria-checked={light === value} onClick={() => setLight(value)}>{label}</button>)}</div>
    <label className="sms-range" title="Exposure"><Sun size={13} aria-hidden="true" /><input type="range" min="0.4" max="2" step="0.02" value={exposure} aria-label="Exposure" onChange={e => setExposure(Number(e.target.value))} /></label>
    <div className="sms-tools">
      <button type="button" aria-pressed={grid} aria-label="Floor grid" title="Floor grid" onClick={() => setGrid(v => !v)}><Grid3x3 size={14} /></button>
      <button type="button" aria-pressed={turn} aria-label="Turntable" title="Turntable" onClick={() => setTurn(v => !v)}><RotateCw size={14} /></button>
      <button type="button" aria-label="Reset the camera" title="Reset the camera" onClick={() => scene.current?.frame()}><ScanEye size={14} /></button>
    </div>
  </div>;
  return <div className="sms" ref={host}>
    <canvas ref={canvas} className="sms-canvas" aria-label={current ? current.request.prompt : '3D stage'} />
    {message && <p className="sms-message" role={error || status.phase === 'failed' || unsupported ? 'alert' : 'status'}>{message}</p>}
    {current && <div className="sms-readout">
      <b>{current.request.prompt}</b>
      <span>{modelNames[current.request.model] || current.request.model}{ready ? <> <i>/</i> {status.triangles!.toLocaleString()} triangles <i>/</i> {status.vertices!.toLocaleString()} vertices</> : null}</span>
    </div>}
    {finished.length > 1 && <nav className="sms-rail" aria-label="Your models">{finished.map((g, i) => <button key={g.id} type="button" aria-current={i === index || undefined} aria-label={g.request.prompt} title={g.request.prompt} onClick={() => onOpen(g.id, true)}><i aria-hidden="true" /></button>)}</nav>}
    {barHost && createPortal(bar, barHost)}
  </div>;
}
