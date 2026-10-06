import './style.css';
import * as THREE from 'three';
import { Sound } from './audio';
import { Player } from './player';
import { CrewBoat } from './rowing/crewboat';
import { compassPoint, conditions, KT, seekTide, tidePhase, updateConditions } from './sim/conditions';
import { systems } from './sim/systems';
import { setMaxAnisotropy } from './textures';
import { floorAt, floors } from './world/collide';
import { buildBoathouse, BALCONY_Y } from './world/boathouse';
import { Environment, PRESETS } from './world/env';
import { buildBackdrop } from './world/props';
import { buildSite, dockDeckY, DOCK, gangway, MOORING } from './world/site';
import { buildTerrain, centerline, channelDepthDist, PAD_Y, terrainHeight } from './world/terrain';
// [realism:interior]
import { interiorLabel } from './world/interior';
import { Handling } from './world/handling'; // [realism:handling]

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
// [realism:water]
const spawn = () => player.place(9, dockDeckY(), DOCK.minZ + 1.2, Math.PI - 0.35, 0.16);
spawn();
// [realism:handling] boat carrying crew: rack -> launch -> board, and dock -> rack
const handling = new Handling({
  scene,
  camera,
  player,
  eight,
  mode: () => mode,
  boardInPlace: () => board(true),
  enterWalk: () => {
    mode = 'walk';
    keys.clear();
    syncUI();
  },
});

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
  if (handling.active || handling.stowed) return false; // [realism:handling]
  const p = player.pos;
  return p.y < dockDeckY() + 0.3 && p.y > dockDeckY() - 0.3 && p.z < DOCK.minZ + 1.8 && Math.abs(p.x - eight.x) < 9.5; // [realism:water]
}

// [realism:stroke]
function setHelp() {
  $('help').innerHTML =
    mode === 'row'
      ? '<kbd>Space</kbd> stroke (tap the rhythm, hold to keep it) · <kbd>A</kbd>/<kbd>D</kbd> steer · <kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> pressure · <kbd>R</kbd> back it down · drag to look · <kbd>C</kbd> camera · <kbd>Esc</kbd> walk'
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

// [realism:stroke] [realism:handling]
function board(inPlace = false) {
  mode = 'row';
  chase = false;
  coxYaw = 0;
  coxPitch = 0;
  lastTap = -Infinity;
  wasAground = false;
  if (locked()) document.exitPointerLock();
  if (!inPlace) eight.reset(MOORING, 0); // [realism:handling]
  sound.start();
  syncUI();
  toast('You’re in the cox seat. Press Space or STROKE to row.', 4);
}

function toWalk() {
  mode = 'walk';
  keys.clear();
  if (locked()) document.exitPointerLock();
  eight.reset(MOORING, 0);
  player.place(eight.x + 3, dockDeckY(), DOCK.minZ + 1.1, 0.2, -0.15); // [realism:water]
  syncUI();
}

function goDock() {
  if (handling.active) return; // [realism:handling]
  if (mode === 'row') return toWalk();
  player.place(-2, dockDeckY(), DOCK.minZ + 1.0, 0.1, -0.12); // [realism:water]
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

// [realism:stroke]
let lastTap = -Infinity;
let wasAground = false;
function setPressure(pressure: 0 | 1 | 2) {
  eight.pressure = pressure;
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-pressure]')) {
    button.setAttribute('aria-pressed', button.dataset.pressure === String(pressure) ? 'true' : 'false');
  }
}
function strokeUI() {
  eight.stroke();
  lastTap = time;
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
// [realism:water]
$('lowTideBtn').addEventListener('click', () => seekTide('low'));
$('highTideBtn').addEventListener('click', () => seekTide('high'));
$('soundBtn').addEventListener('click', toggleSound);
$('dockBtn').addEventListener('click', goDock);
$('walkBtn').addEventListener('click', toWalk);
$('camBtn').addEventListener('click', () => {
  chase = !chase;
  $('camBtn').textContent = chase ? 'Cox seat' : 'Chase cam';
});
$('strokeBtn').addEventListener('click', strokeUI);
// [realism:stroke]
$('pressureLight').addEventListener('click', () => setPressure(0));
$('pressureHalf').addEventListener('click', () => setPressure(1));
$('pressureFull').addEventListener('click', () => setPressure(2));
$('backBtn').addEventListener('click', () => {
  if (eight.aground) eight.backStroke();
});
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
    // [realism:stroke]
    coxPitch = THREE.MathUtils.clamp(coxPitch - e.movementY * 0.003, -1.1, 0.6);
  }
});

// [realism:stroke]
window.addEventListener('keydown', (e) => {
  if (mode === 'intro') return;
  if ((e.target as HTMLElement).tagName === 'BUTTON' && (e.code === 'Space' || e.code === 'Enter')) {
    e.preventDefault();
  }
  keys.add(e.code);
  if (e.code === 'KeyT') cycleTod();
  if (e.code === 'KeyM') toggleSound();
  if (mode === 'walk') {
    if (e.code === 'KeyE') {
      if (!handling.next() && nearBoat()) board(); // [realism:handling]
    }
    if (e.code === 'Space') e.preventDefault();
  } else if (mode === 'row') {
    if (e.code === 'Space') {
      e.preventDefault();
      if (!e.repeat) strokeUI();
    }
    if (e.code === 'KeyC') $('camBtn').click();
    if (e.code === 'Digit1') setPressure(0);
    if (e.code === 'Digit2') setPressure(1);
    if (e.code === 'Digit3') setPressure(2);
    if (e.code === 'KeyR' && !e.repeat) eight.backStroke();
    if (e.code === 'KeyE') handling.dock(); // [realism:handling]
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
  // [realism:interior]
  const room = interiorLabel(p.x, p.y, p.z);
  if (room) return room;
  if (p.y > BALCONY_Y - 0.3 && p.z < 12.2) return 'Balcony';
  if (p.y > PAD_Y + 0.4) return 'Stairs';
  if (p.x > -24 && p.x < 24 && p.z > 12 && p.z < 34) return 'Boat bays';
  if (p.z < -0.5) return p.y < dockDeckY() + 0.3 ? 'Launch dock' : 'Gangway'; // [realism:water]
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
const _prev = new THREE.Vector3(); // [realism:handling]
let time = 0;
let hudTimer = 0;

// [realism:stroke]
function frame() {
  const dt = Math.min(0.05, clock.getDelta());
  time += dt;
  updateConditions(dt);
  for (const system of systems) system.update(dt, time);
  const moored = mode !== 'row';
  if (mode === 'row') {
    const steer = (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0) - (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0);
    if (keys.has('Space') && !eight.catchQueued && time - lastTap >= 60 / eight.rate) strokeUI();
    // [realism:stroke]
    eight.moored = moored;
    eight.update(dt, steer, time);
    if (eight.aground && !wasAground) toast('Aground. Back it down.', 4);
    wasAground = eight.aground;
    eight.group.updateMatrixWorld();
    eight.applyCamera(camera, coxYaw, coxPitch, chase, dt);
    sound.setSpeed(Math.abs(eight.speed));
  } else {
    // [realism:stroke]
    eight.moored = moored;
    eight.update(dt, 0, time);
    if (mode === 'walk') {
      _prev.copy(player.pos); // [realism:handling]
      const fell = player.update(dt, locked() ? keys : none);
      handling.constrain(_prev, dt); // [realism:handling]
      if (fell && player.pos.y < conditions.level - 0.4) {
        player.place(-2, dockDeckY(), DOCK.minZ + 1.0, 0.1, -0.1);
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
    // [realism:water]
    const arrow = conditions.levelRate > 0 ? '↑' : '↓';
    $('tideChip').textContent = `Tide ${conditions.tideHeight.toFixed(1)} m ${arrow} ${tidePhase()}`;
    $('windChip').textContent = `Wind ${Math.round(conditions.wind.length() / KT)} kt ${compassPoint(conditions.windFrom)}`;
    if (mode === 'row') {
      $('backBtn').classList.toggle('hidden', !eight.aground);
      $('spm').textContent = eight.spm > 0 ? eight.spm.toFixed(0) : '—';
      $('split').textContent = fmtSplit(eight.avgSpeed);
      $('speed').textContent = eight.avgSpeed.toFixed(1);
      $('dist').textContent = eight.distance.toFixed(0);
      $('where').textContent = `${eight.phase} · Redwood Creek`;
      $('rudderMarker').style.left = `${50 + (eight.rudder / 0.262) * 50}%`;
      for (const button of document.querySelectorAll<HTMLButtonElement>('[data-pressure]')) {
        button.setAttribute('aria-pressed', button.dataset.pressure === String(eight.pressure) ? 'true' : 'false');
      }
    } else if (mode === 'walk') {
      $('where').textContent = whereLabel();
      const hp = handling.prompt(); // [realism:handling]
      const show = locked() && (hp !== null || nearBoat());
      const pr = $('prompt');
      pr.classList.toggle('hidden', !show);
      if (show) pr.innerHTML = hp ?? '<kbd>E</kbd> or click: cox the varsity 8+'; // [realism:handling]
    } else {
      const rp = handling.rowPrompt(); // [realism:handling]
      const pr = $('prompt');
      pr.classList.toggle('hidden', rp === null);
      if (rp !== null) pr.innerHTML = rp;
    }
  }
  if (toastTimer > 0) {
    toastTimer -= dt;
    if (toastTimer <= 0) $('toast').classList.add('hidden');
  }
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

syncUI();
frame();
// [realism:water] [realism:stroke]
Object.assign(window, {
  __app: {
    scene,
    camera,
    renderer,
    player,
    eight,
    env,
    conditions,
    systems,
    gangway,
    floors,
    floorAt,
    terrainHeight,
    channelDepthDist,
    centerline,
    board,
    toWalk,
    goDock,
    strokeUI,
    setPressure,
    handling, // [realism:handling]
  },
});
