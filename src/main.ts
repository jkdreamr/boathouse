import './style.css';
import * as THREE from 'three';
import { Sound } from './audio';
import { Player } from './player';
import { CrewBoat } from './rowing/crewboat';
import { conditions, updateConditions } from './sim/conditions';
import { systems } from './sim/systems';
import { setMaxAnisotropy } from './textures';
import { buildBoathouse, BALCONY_Y } from './world/boathouse';
import { Environment, PRESETS } from './world/env';
import { buildBackdrop } from './world/props';
// [realism:birds]
import { initBirds } from './world/birds';
import { buildSite, DOCK, DOCK_Y, MOORING } from './world/site';
import { buildTerrain, PAD_Y } from './world/terrain';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
$('app').appendChild(renderer.domElement);
setMaxAnisotropy(renderer.capabilities.getMaxAnisotropy());

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 60000);
const env = new Environment(scene, renderer);
scene.add(buildTerrain());
buildSite(scene);
buildBoathouse(scene);
buildBackdrop(scene);

const eight = new CrewBoat(scene, '8+');
eight.reset(MOORING, 0);
const sound = new Sound();
eight.onCatch = () => sound.catch();
eight.onFinish = () => sound.finish();

const player = new Player(camera);
const spawn = () => player.place(9, DOCK_Y, DOCK.minZ + 1.2, Math.PI - 0.35, 0.16);
spawn();

type Mode = 'intro' | 'walk' | 'row';
let mode: Mode = 'intro';
let chase = false;
let coxYaw = 0;
let coxPitch = 0;
let dragging = false;
const keys = new Set<string>();
const none = new Set<string>();
const canvas = renderer.domElement;
const locked = () => document.pointerLockElement === canvas;

let toastTimer = 0;
function toast(msg: string, secs = 3) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  toastTimer = secs;
}

function lock() {
  try {
    const r = canvas.requestPointerLock() as unknown as Promise<void> | undefined;
    r?.catch?.(() => undefined);
  } catch {
    /* pointer lock unavailable */
  }
}

function nearBoat() {
  const p = player.pos;
  return p.y < DOCK_Y + 0.3 && p.y > DOCK_Y - 0.3 && p.z < DOCK.minZ + 1.8 && Math.abs(p.x - eight.x) < 9.5;
}

function setHelp() {
  $('help').innerHTML =
    mode === 'row'
      ? '<kbd>Space</kbd> stroke (hold to keep rowing) · <kbd>A</kbd>/<kbd>D</kbd> steer · <kbd>[</kbd>/<kbd>]</kbd> rate · drag to look · <kbd>C</kbd> camera · <kbd>Esc</kbd> back to walk'
      : '<kbd>WASD</kbd> walk · <kbd>Shift</kbd> run · <kbd>Space</kbd> jump · <kbd>E</kbd> board the 8+ at the dock · <kbd>T</kbd> time of day · <kbd>Esc</kbd> release mouse';
}

function syncUI() {
  document.body.classList.toggle('row', mode === 'row');
  $('intro').classList.toggle('hidden', mode !== 'intro');
  for (const id of ['topbar', 'help']) $(id).classList.toggle('hidden', mode === 'intro');
  $('rowPanel').classList.toggle('hidden', mode !== 'row');
  $('reticle').classList.toggle('hidden', mode !== 'walk');
  $('pause').classList.toggle('hidden', !(mode === 'walk' && !locked()));
  $('modeChip').textContent = mode === 'row' ? 'ROWING' : 'WALK';
  $('dockBtn').textContent = mode === 'row' ? 'Back to the dock' : 'Go to the dock';
  if (mode !== 'walk') $('prompt').classList.add('hidden');
  setHelp();
}

function board() {
  mode = 'row';
  chase = false;
  coxYaw = 0;
  coxPitch = 0;
  if (locked()) document.exitPointerLock();
  eight.reset(MOORING, 0);
  sound.start();
  syncUI();
  toast('You’re in the cox seat. Press Space or STROKE to row.', 4);
}

function toWalk() {
  mode = 'walk';
  keys.clear();
  if (locked()) document.exitPointerLock();
  eight.reset(MOORING, 0);
  player.place(eight.x + 3, DOCK_Y, DOCK.minZ + 1.1, 0.2, -0.15);
  syncUI();
}

function goDock() {
  if (mode === 'row') return toWalk();
  player.place(-2, DOCK_Y, DOCK.minZ + 1.0, 0.1, -0.12);
  toast('Launch dock. Walk up to the eight and press E.');
}

function cycleTod() {
  const name = env.next();
  $('todBtn').textContent = name;
  toast(name, 1.6);
}

function toggleSound() {
  sound.start();
  sound.setMuted(!sound.muted);
  $('soundBtn').textContent = sound.muted ? 'Sound off' : 'Sound on';
}

function setRate(r: number) {
  eight.rate = THREE.MathUtils.clamp(r, 18, 36);
  $('rateVal').textContent = String(eight.rate);
}

function strokeUI() {
  eight.stroke();
  const b = $('strokeBtn');
  b.classList.add('pulse');
  setTimeout(() => b.classList.remove('pulse'), 120);
}

$('play').addEventListener('click', () => {
  mode = 'walk';
  sound.start();
  syncUI();
  lock();
});
$('todBtn').addEventListener('click', cycleTod);
$('soundBtn').addEventListener('click', toggleSound);
$('dockBtn').addEventListener('click', goDock);
$('walkBtn').addEventListener('click', toWalk);
$('camBtn').addEventListener('click', () => {
  chase = !chase;
  $('camBtn').textContent = chase ? 'Cox seat' : 'Chase cam';
});
$('strokeBtn').addEventListener('click', strokeUI);
$('rateDown').addEventListener('click', () => setRate(eight.rate - 2));
$('rateUp').addEventListener('click', () => setRate(eight.rate + 2));
$('todBtn').textContent = PRESETS[env.presetIndex].name;

canvas.addEventListener('click', () => {
  if (mode !== 'walk') return;
  if (!locked()) lock();
  else if (nearBoat()) board();
});
canvas.addEventListener('pointerdown', (e) => {
  if (mode === 'row') {
    dragging = true;
    canvas.setPointerCapture(e.pointerId);
  }
});
canvas.addEventListener('pointerup', () => (dragging = false));
document.addEventListener('pointerlockchange', syncUI);
document.addEventListener('mousemove', (e) => {
  if (mode === 'walk' && locked()) player.look(e.movementX, e.movementY);
  else if (mode === 'row' && dragging) {
    coxYaw = THREE.MathUtils.clamp(coxYaw - e.movementX * 0.003, -2.0, 2.0);
    coxPitch = THREE.MathUtils.clamp(coxPitch - e.movementY * 0.003, -0.6, 0.6);
  }
});

window.addEventListener('keydown', (e) => {
  if (mode === 'intro') return;
  if ((e.target as HTMLElement).tagName === 'BUTTON' && (e.code === 'Space' || e.code === 'Enter')) {
    e.preventDefault();
  }
  keys.add(e.code);
  if (e.code === 'KeyT') cycleTod();
  if (e.code === 'KeyM') toggleSound();
  if (mode === 'walk') {
    if (e.code === 'KeyE' && nearBoat()) board();
    if (e.code === 'Space') e.preventDefault();
  } else if (mode === 'row') {
    if (e.code === 'Space') {
      e.preventDefault();
      if (!e.repeat) strokeUI();
    }
    if (e.code === 'KeyC') $('camBtn').click();
    if (e.code === 'BracketLeft' || e.code === 'Minus') setRate(eight.rate - 2);
    if (e.code === 'BracketRight' || e.code === 'Equal') setRate(eight.rate + 2);
    if (e.code === 'Escape' && !locked()) toWalk();
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

function whereLabel() {
  const p = player.pos;
  if (p.y > BALCONY_Y - 0.3 && p.z < 12.2) return 'Balcony';
  if (p.y > PAD_Y + 0.4) return 'Stairs';
  if (p.x > -24 && p.x < 24 && p.z > 12 && p.z < 34) return 'Boat bays';
  if (p.z < -0.5) return p.y < DOCK_Y + 0.3 ? 'Launch dock' : 'Gangway';
  return 'Apron';
}

const fmtSplit = (v: number) => {
  if (v < 0.4) return '—';
  const s = 500 / v;
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
};

const clock = new THREE.Clock();
const focus = new THREE.Vector3();
const dir = new THREE.Vector3();
let time = 0;
let hudTimer = 0;

function frame() {
  const dt = Math.min(0.05, clock.getDelta());
  time += dt;
  updateConditions(dt);
  for (const system of systems) system.update(dt, time);
  if (mode === 'row') {
    const steer = (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0) - (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0);
    if (keys.has('Space')) eight.stroke();
    eight.update(dt, steer, time);
    eight.group.updateMatrixWorld();
    eight.applyCamera(camera, coxYaw, coxPitch, chase, dt);
    sound.setSpeed(eight.speed);
  } else {
    eight.update(dt, 0, time);
    if (mode === 'walk') {
      const fell = player.update(dt, locked() ? keys : none);
      if (fell) {
        player.place(-2, DOCK_Y, DOCK.minZ + 1.0, 0.1, -0.1);
        toast('Splash! Back on the dock.');
      }
    } else {
      player.update(dt, none);
      player.yaw += dt * 0.03;
    }
    sound.setSpeed(0);
  }
  camera.getWorldDirection(dir);
  focus.copy(camera.position).addScaledVector(dir, 25);
  env.update(dt, focus);

  hudTimer -= dt;
  if (hudTimer <= 0) {
    hudTimer = 0.1;
    if (mode === 'row') {
      $('spm').textContent = eight.spm > 0 ? eight.spm.toFixed(0) : '—';
      $('split').textContent = fmtSplit(eight.speed);
      $('speed').textContent = eight.speed.toFixed(1);
      $('dist').textContent = eight.distance.toFixed(0);
      $('where').textContent = `${eight.phase} · Redwood Creek`;
    } else if (mode === 'walk') {
      $('where').textContent = whereLabel();
      const show = locked() && nearBoat();
      const pr = $('prompt');
      pr.classList.toggle('hidden', !show);
      if (show) pr.innerHTML = '<kbd>E</kbd> or click: cox the varsity 8+';
    }
  }
  if (toastTimer > 0) {
    toastTimer -= dt;
    if (toastTimer <= 0) $('toast').classList.add('hidden');
  }
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

// [realism:birds]
const birdFocus = new THREE.Vector3();
initBirds(scene, () => (mode === 'row' ? birdFocus.set(eight.x, conditions.level, eight.z) : player.pos), { muted: () => sound.muted });

syncUI();
frame();
Object.assign(window, { __app: { scene, camera, player, eight, env, conditions, board, toWalk, goDock } });
