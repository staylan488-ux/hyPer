import {
  CanvasTexture,
  CapsuleGeometry,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  LatheGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  SRGBColorSpace,
  Quaternion,
  Raycaster,
  Scene,
  SphereGeometry,
  Vector2,
  Vector3,
  type Texture,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { createSceneHost } from '@/lib/three/host';
import { stepSpring } from '@/lib/three/spring';
import {
  BODY_SOLIDS,
  MUSCLE_PARTS,
  muscleColor,
  type MaquettePalette,
  type MuscleShade,
  type Solid,
} from '@/lib/maquette';
import type { MuscleGroup } from '@/types';

export interface MaquetteOptions {
  palette: MaquettePalette;
  shades: Map<MuscleGroup, MuscleShade>;
  dark: boolean;
  /** Spin in from behind on first appearance. */
  intro: boolean;
  /** No autonomous motion: render the settled pose. */
  still: boolean;
  /** Accept drags and taps. */
  interactive: boolean;
  /** Emphasise one muscle and quiet the rest (compact insight). */
  focus?: MuscleGroup | null;
  onPick?: (muscle: MuscleGroup | null) => void;
  onReady?: () => void;
  onContextLost?: () => void;
}

export interface MaquetteController {
  update(options: Partial<Pick<MaquetteOptions, 'palette' | 'shades' | 'dark' | 'focus'>>): void;
  select(muscle: MuscleGroup | null): void;
  turnTo(side: 'front' | 'back'): void;
  turnBy(radians: number): void;
  dispose(): void;
}

const REST_ANGLE = 0.42; // three-quarter view
const TWO_PI = Math.PI * 2;

const unitSphere = new SphereGeometry(1, 48, 32);
const UP = new Vector3(0, 1, 0);

function buildMesh(solid: Solid, material: MeshPhysicalMaterial): Mesh {
  if (solid.kind === 'lathe') {
    const points = solid.profile.map(([r, y]) => new Vector2(r, y));
    const mesh = new Mesh(new LatheGeometry(points, 72), material);
    mesh.scale.set(1, 1, solid.depth);
    return mesh;
  }
  if (solid.kind === 'ellipsoid') {
    const mesh = new Mesh(unitSphere, material);
    mesh.position.set(...solid.center);
    mesh.scale.set(...solid.radii);
    if (solid.roll) mesh.rotation.z = solid.roll;
    return mesh;
  }
  const from = new Vector3(...solid.from);
  const to = new Vector3(...solid.to);
  const axis = to.clone().sub(from);
  const mesh = new Mesh(new CapsuleGeometry(solid.radius, axis.length(), 10, 28), material);
  mesh.position.copy(from.clone().add(to).multiplyScalar(0.5));
  mesh.quaternion.copy(new Quaternion().setFromUnitVectors(UP, axis.normalize()));
  return mesh;
}

function contactShadow(dark: boolean): Texture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  const tone = dark ? '255,255,255' : '20,24,22';
  gradient.addColorStop(0, `rgba(${tone},${dark ? 0.1 : 0.22})`);
  gradient.addColorStop(1, `rgba(${tone},0)`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return new CanvasTexture(canvas);
}

function bodyMaterial(palette: MaquettePalette, dark: boolean) {
  return new MeshPhysicalMaterial({
    color: new Color().setRGB(...palette.body, SRGBColorSpace),
    roughness: dark ? 0.32 : 0.42,
    metalness: dark ? 0.15 : 0,
    clearcoat: dark ? 1 : 0.55,
    clearcoatRoughness: dark ? 0.18 : 0.35,
    sheen: dark ? 0 : 0.4,
    sheenRoughness: 0.6,
    sheenColor: new Color(1, 1, 1),
    envMapIntensity: dark ? 0.9 : 0.55,
  });
}

export function createMaquette(canvas: HTMLCanvasElement, initial: MaquetteOptions): MaquetteController {
  const options = { ...initial };
  const scene = new Scene();
  const camera = new PerspectiveCamera(26, 1, 0.1, 50);
  camera.position.set(0, 0.15, 8.4);
  camera.lookAt(0, 0.02, 0);

  const hemi = new HemisphereLight(0xffffff, 0x8a8478, options.dark ? 0.55 : 0.5);
  const key = new DirectionalLight(0xffffff, options.dark ? 1.9 : 1.45);
  key.position.set(-3, 4, 5);
  const rim = new DirectionalLight(0xdfe8ff, options.dark ? 1.8 : 1.1);
  rim.position.set(3.5, 2, -4);
  const fill = new DirectionalLight(0xfff1e2, 0.3);
  fill.position.set(4, -1, 3);
  scene.add(hemi, key, rim, fill);

  const figure = new Group();
  scene.add(figure);

  let body = bodyMaterial(options.palette, options.dark);
  const bodyMeshes = BODY_SOLIDS.map((solid) => buildMesh(solid, body));
  bodyMeshes.forEach((mesh) => figure.add(mesh));

  const muscleMaterials = new Map<MuscleGroup, MeshPhysicalMaterial>();
  const muscleMeshes: Mesh[] = [];
  for (const part of MUSCLE_PARTS) {
    let material = muscleMaterials.get(part.muscle);
    if (!material) {
      material = new MeshPhysicalMaterial({ roughness: 0.4, clearcoat: 0.6, clearcoatRoughness: 0.25, envMapIntensity: 0.7 });
      muscleMaterials.set(part.muscle, material);
    }
    const mesh = buildMesh(part.solid, material);
    mesh.userData.muscle = part.muscle;
    muscleMeshes.push(mesh);
    figure.add(mesh);
  }

  const shadowMaterial = new MeshBasicMaterial({ map: contactShadow(options.dark), transparent: true, depthWrite: false });
  const shadow = new Mesh(new PlaneGeometry(1.5, 0.9), shadowMaterial);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -1.62;
  scene.add(shadow);

  let selected: MuscleGroup | null = null;
  let pulse = 0;

  const accentColor = new Color();
  const paint = () => {
    accentColor.setRGB(...options.palette.accent, SRGBColorSpace);
    for (const [muscle, material] of muscleMaterials) {
      const shade = options.shades.get(muscle);
      const base = new Color().setRGB(...muscleColor(shade, options.palette), SRGBColorSpace);
      if (options.focus === muscle) base.setRGB(...options.palette.accent, SRGBColorSpace);
      else if (options.focus) base.lerp(new Color().setRGB(...options.palette.body, SRGBColorSpace), 0.85);
      material.color.copy(base);
      material.emissive.copy(accentColor);
      material.emissiveIntensity = 0;
    }
  };
  paint();

  // Environment reflections give porcelain and obsidian their sheen.
  let pmrem: PMREMGenerator | null = null;

  // ── Pose state ────────────────────────────────────────────────────────
  const yaw = { value: options.intro && !options.still ? REST_ANGLE - Math.PI * 1.35 : REST_ANGLE, velocity: 0 };
  const pitch = { value: 0, velocity: 0 };
  const rise = { value: options.intro && !options.still ? 0.9 : 1, velocity: 0 };
  let yawTarget: number | null = REST_ANGLE;
  let dragging = false;
  let throwing = false;

  const host = createSceneHost(canvas, {
    maxPixelRatio: options.interactive ? 2 : 1.5,
    onResize: (width, height) => {
      camera.aspect = width / height;
      // Keep the whole figure in frame on narrow canvases.
      camera.position.z = width / height < 0.75 ? 8.4 / Math.max(0.55, (width / height) / 0.75) : 8.4;
      camera.updateProjectionMatrix();
    },
    onContextLost: () => options.onContextLost?.(),
    frame: (dt, h) => {
      if (options.still) {
        // Reduced motion: every change lands in its final pose at once.
        if (!dragging && yawTarget !== null) yaw.value = yawTarget;
        rise.value = 1;
        if (!dragging) pitch.value = 0;
        if (selected) muscleMaterials.get(selected)!.emissiveIntensity = 0.35;
        figure.rotation.set(pitch.value, yaw.value, 0);
        figure.scale.setScalar(1);
        figure.position.y = 0;
        h.renderer.render(scene, camera);
        return false;
      }
      let moving = false;
      if (!dragging) {
        if (throwing) {
          yaw.velocity *= Math.exp(-2.6 * dt);
          yaw.value += yaw.velocity * dt;
          if (Math.abs(yaw.velocity) < 0.05) {
            throwing = false;
            yaw.velocity = 0;
          } else {
            moving = true;
          }
        } else if (yawTarget !== null) {
          moving = stepSpring(yaw, yawTarget, dt, 34, 0.9) || moving;
        }
        moving = stepSpring(pitch, 0, dt, 60, 0.9) || moving;
      }
      moving = stepSpring(rise, 1, dt, 40, 0.85) || moving;
      if (selected) {
        pulse += dt;
        const material = muscleMaterials.get(selected);
        if (material) material.emissiveIntensity = 0.22 + Math.sin(pulse * 4) * 0.12 * Math.exp(-pulse * 0.9);
        moving = moving || pulse < 3;
      }
      figure.rotation.y = yaw.value;
      figure.rotation.x = pitch.value;
      figure.scale.setScalar(rise.value);
      figure.position.y = (1 - rise.value) * -1.2;
      h.renderer.render(scene, camera);
      return moving;
    },
  });

  pmrem = new PMREMGenerator(host.renderer);
  const environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = environment;
  scene.environmentIntensity = options.dark ? 0.5 : 0.35;

  // ── Input ─────────────────────────────────────────────────────────────
  const raycaster = new Raycaster();
  const pointer = new Vector2();
  let gesture: { id: number; x: number; y: number; lastX: number; lastT: number; moved: boolean } | null = null;

  const pick = (clientX: number, clientY: number) => {
    const rect = canvas.getBoundingClientRect();
    pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(muscleMeshes, false)[0];
    return (hit?.object.userData.muscle as MuscleGroup | undefined) ?? null;
  };

  const onDown = (event: PointerEvent) => {
    if (!options.interactive || event.button > 0) return;
    gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, lastX: event.clientX, lastT: event.timeStamp, moved: false };
  };
  const onMove = (event: PointerEvent) => {
    if (!gesture || gesture.id !== event.pointerId) return;
    const dx = event.clientX - gesture.x;
    const dy = event.clientY - gesture.y;
    if (!gesture.moved) {
      if (Math.abs(dx) < 6 || Math.abs(dx) < Math.abs(dy)) return;
      gesture.moved = true;
      dragging = true;
      throwing = false;
      yawTarget = null;
      try { canvas.setPointerCapture(event.pointerId); } catch { /* optional */ }
    }
    const step = (event.clientX - gesture.lastX) / Math.max(1, canvas.clientWidth);
    const elapsed = Math.max(1, event.timeStamp - gesture.lastT) / 1000;
    yaw.value += step * Math.PI * 1.6;
    yaw.velocity = (step * Math.PI * 1.6) / elapsed;
    pitch.value = Math.max(-0.22, Math.min(0.22, (dy / Math.max(1, canvas.clientHeight)) * 0.8));
    gesture.lastX = event.clientX;
    gesture.lastT = event.timeStamp;
    host.invalidate();
  };
  const onUp = (event: PointerEvent) => {
    if (!gesture || gesture.id !== event.pointerId) return;
    const wasDrag = gesture.moved;
    gesture = null;
    if (wasDrag) {
      dragging = false;
      throwing = !options.still && Math.abs(yaw.velocity) > 0.4;
      if (!throwing) yaw.velocity = 0;
      host.invalidate();
      return;
    }
    const muscle = pick(event.clientX, event.clientY);
    const next = muscle === selected ? null : muscle;
    controller.select(next);
    options.onPick?.(next);
  };
  const onCancel = (event: PointerEvent) => {
    if (gesture?.id !== event.pointerId) return;
    gesture = null;
    dragging = false;
    host.invalidate();
  };
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onCancel);

  const nearest = (base: number) => base + Math.round((yaw.value - base) / TWO_PI) * TWO_PI;

  const controller: MaquetteController = {
    update(next) {
      const themeChanged = next.dark !== undefined && next.dark !== options.dark;
      Object.assign(options, next);
      if (next.palette || themeChanged) {
        const previous = body;
        body = bodyMaterial(options.palette, options.dark);
        bodyMeshes.forEach((mesh) => { mesh.material = body; });
        previous.dispose();
        shadowMaterial.map?.dispose();
        shadowMaterial.map = contactShadow(options.dark);
        shadowMaterial.needsUpdate = true;
      }
      paint();
      if (selected) muscleMaterials.get(selected)!.emissiveIntensity = 0.3;
      host.invalidate();
    },
    select(muscle) {
      if (selected) muscleMaterials.get(selected)!.emissiveIntensity = 0;
      selected = muscle;
      pulse = 0;
      if (muscle) {
        // Turn the chosen muscle toward the viewer.
        const part = MUSCLE_PARTS.find((candidate) => candidate.muscle === muscle);
        const facesBack = part ? part.solid.center[2] < -0.02 : false;
        yawTarget = nearest(facesBack ? Math.PI + REST_ANGLE * 0.5 : REST_ANGLE * 0.5);
        throwing = false;
      }
      host.invalidate();
    },
    turnTo(side) {
      yawTarget = nearest(side === 'front' ? 0 : Math.PI);
      throwing = false;
      host.invalidate();
    },
    turnBy(radians) {
      yawTarget = (yawTarget ?? yaw.value) + radians;
      throwing = false;
      host.invalidate();
    },
    dispose() {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onCancel);
      host.dispose();
      body.dispose();
      muscleMaterials.forEach((material) => material.dispose());
      bodyMeshes.forEach((mesh) => { if (mesh.geometry !== unitSphere) mesh.geometry.dispose(); });
      muscleMeshes.forEach((mesh) => { if (mesh.geometry !== unitSphere) mesh.geometry.dispose(); });
      shadowMaterial.map?.dispose();
      shadowMaterial.dispose();
      shadow.geometry.dispose();
      environment.dispose();
      pmrem?.dispose();
    },
  };

  host.invalidate();
  // After the caller has stored the controller.
  queueMicrotask(() => options.onReady?.());
  return controller;
}
