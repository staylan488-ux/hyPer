import {
  CanvasTexture,
  CircleGeometry,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  LatheGeometry,
  Mesh,
  MeshPhysicalMaterial,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  SRGBColorSpace,
  Vector2,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { createSceneHost } from '@/lib/three/host';
import { stepSpring } from '@/lib/three/spring';
import { subscribeMotionLight } from '@/lib/motionLight';

export interface TokenFace {
  title: string;
  dateLabel: string;
  completedSets: number;
  totalSets: number;
  /** e.g. "12,340 lb" */
  figure: string;
}

export interface TokenOptions {
  face: TokenFace;
  dark: boolean;
  colors: { accent: string; paper: string; ink: string };
  still: boolean;
  onReady?: () => void;
  onContextLost?: () => void;
}

const TEXTURE = 1024;

/** Draw the medallion's face (and a matching height map for embossing). */
function drawFace(face: TokenFace, colors: TokenOptions['colors'], mode: 'color' | 'bump'): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = TEXTURE;
  canvas.height = TEXTURE;
  const ctx = canvas.getContext('2d')!;
  const mid = TEXTURE / 2;
  const raised = mode === 'bump' ? '#ffffff' : colors.paper;
  ctx.fillStyle = mode === 'bump' ? '#000000' : colors.accent;
  ctx.fillRect(0, 0, TEXTURE, TEXTURE);

  if (mode === 'color') {
    // Enamel depth: a soft darker well toward the rim.
    const well = ctx.createRadialGradient(mid, mid * 0.86, TEXTURE * 0.08, mid, mid, mid);
    well.addColorStop(0, 'rgba(255,255,255,0.10)');
    well.addColorStop(0.7, 'rgba(0,0,0,0)');
    well.addColorStop(1, 'rgba(0,0,0,0.28)');
    ctx.fillStyle = well;
    ctx.fillRect(0, 0, TEXTURE, TEXTURE);
  }

  // Tick ring: one mark per set, filled for completed sets.
  const total = Math.max(1, Math.min(40, face.totalSets));
  const done = Math.min(total, face.completedSets);
  for (let i = 0; i < total; i += 1) {
    const angle = -Math.PI / 2 + (i / total) * Math.PI * 2;
    ctx.save();
    ctx.translate(mid + Math.cos(angle) * mid * 0.84, mid + Math.sin(angle) * mid * 0.84);
    ctx.rotate(angle + Math.PI / 2);
    ctx.globalAlpha = i < done ? 1 : mode === 'bump' ? 0.35 : 0.3;
    ctx.fillStyle = raised;
    ctx.fillRect(-5, -26, 10, 52);
    ctx.restore();
  }
  ctx.globalAlpha = 1;

  // Inner hairline ring.
  ctx.strokeStyle = raised;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(mid, mid, mid * 0.74, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = raised;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '500 34px Geist, "Helvetica Neue", Arial, sans-serif';
  ctx.letterSpacing = '10px';
  ctx.fillText('SESSION BANKED', mid, mid - 196);
  ctx.letterSpacing = '0px';

  // Title in Fraunces, shrunk to fit the medallion's inner width.
  let size = 132;
  const maxWidth = TEXTURE * 0.6;
  do {
    ctx.font = `360 ${size}px Fraunces, Georgia, serif`;
    size -= 6;
  } while (ctx.measureText(face.title).width > maxWidth && size > 48);
  ctx.fillText(face.title, mid, mid - 30);

  ctx.font = 'italic 400 54px Fraunces, Georgia, serif';
  ctx.fillText(face.dateLabel, mid, mid + 70);

  ctx.font = '500 38px Geist, "Helvetica Neue", Arial, sans-serif';
  ctx.letterSpacing = '6px';
  ctx.fillText(`${face.completedSets}/${face.totalSets} SETS · ${face.figure.toUpperCase()}`, mid, mid + 176);
  ctx.letterSpacing = '0px';
  return canvas;
}

function coinProfile(): Vector2[] {
  // Radius, height from the back face to the front face, with a raised rim.
  const points: Array<[number, number]> = [
    [0.001, -0.06], [0.9, -0.06], [0.915, -0.085], [0.975, -0.085], [1, -0.055],
    [1, 0.055], [0.975, 0.085], [0.915, 0.085], [0.9, 0.06], [0.001, 0.06],
  ];
  return points.map(([r, y]) => new Vector2(r, y));
}

export function createToken(canvas: HTMLCanvasElement, options: TokenOptions) {
  const scene = new Scene();
  const camera = new PerspectiveCamera(30, 1, 0.1, 30);
  camera.position.set(0, 0, 4.4);

  scene.add(new HemisphereLight(0xffffff, 0x6b5f55, 0.6));
  const key = new DirectionalLight(0xffffff, 1.8);
  key.position.set(-2.5, 3, 4);
  const rim = new DirectionalLight(0xffe7d6, 1.2);
  rim.position.set(3, -1, 2);
  scene.add(key, rim);

  const coin = new Group();
  scene.add(coin);

  const rimMaterial = new MeshPhysicalMaterial({
    color: new Color(options.dark ? 0xd8d6d0 : 0x3b3936),
    metalness: 1,
    roughness: 0.28,
    clearcoat: 0.4,
  });
  const body = new Mesh(new LatheGeometry(coinProfile(), 96), rimMaterial);
  body.rotation.x = Math.PI / 2;
  coin.add(body);

  const colorMap = new CanvasTexture(drawFace(options.face, options.colors, 'color'));
  colorMap.colorSpace = SRGBColorSpace;
  colorMap.anisotropy = 4;
  const bumpMap = new CanvasTexture(drawFace(options.face, options.colors, 'bump'));
  const faceMaterial = new MeshPhysicalMaterial({
    map: colorMap,
    bumpMap,
    bumpScale: 2.2,
    roughness: 0.34,
    metalness: 0.05,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
  });
  const face = new Mesh(new CircleGeometry(0.9, 128), faceMaterial);
  face.position.z = 0.0605;
  coin.add(face);

  const backMaterial = new MeshPhysicalMaterial({
    color: new Color(options.colors.accent),
    roughness: 0.3,
    clearcoat: 1,
    clearcoatRoughness: 0.1,
  });
  const back = new Mesh(new CircleGeometry(0.9, 96), backMaterial);
  back.position.z = -0.0605;
  back.rotation.y = Math.PI;
  coin.add(back);

  // ── Motion ────────────────────────────────────────────────────────────
  const REST_YAW = -0.22;
  const REST_PITCH = 0.1;
  const yaw = { value: options.still ? REST_YAW : REST_YAW - Math.PI * 4, velocity: 0 };
  const pitch = { value: options.still ? REST_PITCH : 0.9, velocity: 0 };
  const drop = { value: options.still ? 0 : 1.6, velocity: 0 };
  let yawTarget = REST_YAW;
  let pitchTarget = REST_PITCH;
  let lightX = 0;
  let lightY = 0;

  const host = createSceneHost(canvas, {
    onResize: (width, height) => {
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    },
    onContextLost: () => options.onContextLost?.(),
    frame: (dt, h) => {
      let moving = false;
      if (options.still) {
        yaw.value = yawTarget;
        pitch.value = pitchTarget;
        drop.value = 0;
      } else {
        moving = stepSpring(yaw, yawTarget + lightX * 0.18, dt, 26, 0.55) || moving;
        moving = stepSpring(pitch, pitchTarget - lightY * 0.14, dt, 40, 0.6) || moving;
        moving = stepSpring(drop, 0, dt, 60, 0.7) || moving;
      }
      coin.rotation.set(pitch.value, yaw.value, 0);
      coin.position.y = drop.value;
      h.renderer.render(scene, camera);
      return moving;
    },
  });

  // Only the baked texture is kept; the generator's scratch target and the room go now.
  const pmrem = new PMREMGenerator(host.renderer);
  const room = new RoomEnvironment();
  const environment = pmrem.fromScene(room, 0.04).texture;
  pmrem.dispose();
  room.dispose();
  scene.environment = environment;
  scene.environmentIntensity = options.dark ? 0.8 : 0.7;

  // Finger tilt: the coin follows, then springs back to rest.
  let gesture: { id: number; x: number; y: number } | null = null;
  const onDown = (event: PointerEvent) => {
    gesture = { id: event.pointerId, x: event.clientX, y: event.clientY };
    try { canvas.setPointerCapture(event.pointerId); } catch { /* optional */ }
  };
  const onMove = (event: PointerEvent) => {
    if (!gesture || gesture.id !== event.pointerId) return;
    const w = Math.max(1, canvas.clientWidth);
    yawTarget = REST_YAW + Math.max(-1.1, Math.min(1.1, ((event.clientX - gesture.x) / w) * 2.4));
    pitchTarget = REST_PITCH + Math.max(-0.6, Math.min(0.6, ((event.clientY - gesture.y) / w) * 1.6));
    host.invalidate();
  };
  const onUp = (event: PointerEvent) => {
    if (!gesture || gesture.id !== event.pointerId) return;
    gesture = null;
    // A long pull spins the coin a full turn before it settles face-on.
    const offset = yawTarget - REST_YAW;
    const turns = Math.round((yaw.value - REST_YAW) / (Math.PI * 2)) + (Math.abs(offset) > 0.8 ? Math.sign(offset) : 0);
    yawTarget = REST_YAW + turns * Math.PI * 2;
    pitchTarget = REST_PITCH;
    host.invalidate();
  };
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);

  const stopLight = options.still
    ? () => {}
    : subscribeMotionLight(({ x, y }) => {
        lightX = x;
        lightY = y;
        host.invalidate();
      });

  host.invalidate();
  queueMicrotask(() => options.onReady?.());

  return {
    dispose() {
      stopLight();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      host.dispose();
      [rimMaterial, faceMaterial, backMaterial].forEach((material) => material.dispose());
      [body.geometry, face.geometry, back.geometry].forEach((geometry) => geometry.dispose());
      colorMap.dispose();
      bumpMap.dispose();
      environment.dispose();
    },
  };
}
