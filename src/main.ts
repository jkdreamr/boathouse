import './style.css';
import * as THREE from 'three';
import { Sound } from './audio';
import { Player } from './player';
import { compassPoint, conditions, KT, seekTide, tidePhase, updateConditions } from './sim/conditions';
import { systems } from './sim/systems';
import { setMaxAnisotropy } from './textures';
import { floorAt, floors } from './world/collide';
import { buildBoathouse, BALCONY_Y } from './world/boathouse';
import { Environment, PRESETS } from './world/env';
import { buildBackdrop } from './world/props';
import { buildSite, dockDeckY, DOCK, gangway } from './world/site';
import { buildTerrain, centerline, channelDepthDist, PAD_Y, terrainHeight } from './world/terrain';
import { interiorLabel } from './world/interior';
import { PlayerLaunch } from './world/launch';
import { initTraffic } from './world/traffic';
import { initBirds } from './world/birds';

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
camera.layers.enable(1);
const env = new Environment(scene, renderer);
scene.add(buildTerrain());
buildSite(scene);
buildBoathouse(scene);
buildBackdrop(scene);

const sound = new Sound();
const player = new Player(camera);
let playerLaunch: PlayerLaunch | null = null;
const traffic = initTraffic(scene, () => playerLaunch, camera);
const launch = playerLaunch = new PlayerLaunch(scene, traffic.wake);
const spawn = () => player.place(20, dockDeckY(), DOCK.minZ + 1.2, Math.PI - 0.35, 0.16);
spawn();

type Mode = 'intro' | 'walk' | 'launch';
let mode: Mode = 'intro';
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

function clearToast() {
  toastTimer = 0;
  $('toast').classList.add('hidden');
}

function lock() {
  try {
    const r = canvas.requestPointerLock() as unknown as Promise<void> | undefined;
    r?.catch?.(() => undefined);
  } catch {
    /* pointer lock unavailable */
  }
}

function nearLaunch() {
  const p = player.pos;
  return Math.abs(p.y - dockDeckY()) < 0.45 && Math.hypot(p.x - launch.x, p.z - launch.z) < 4.5;
}

function setHelp() {
  $('help').textContent =
    mode === 'launch'
      ? 'W / S forward and reverse · A / D steer · Esc to return to the dock'
      : 'WASD to walk · Shift to run · Space to jump · E to board the launch · T for time of day · Esc to release the mouse';
}

function syncUI() {
  document.body.classList.toggle('launch', mode === 'launch');
  $('intro').classList.toggle('hidden', mode !== 'intro');
  for (const id of ['topbar', 'help']) $(id).classList.toggle('hidden', mode === 'intro');
  $('launchPanel').classList.toggle('hidden', mode !== 'launch');
  $('reticle').classList.toggle('hidden', mode !== 'walk');
  $('pause').classList.toggle('hidden', !(mode === 'walk' && !locked()));
  $('modeChip').textContent = mode === 'launch' ? 'On the launch' : 'Walking';
  $('dockBtn').textContent = mode === 'launch' ? 'Return to the dock' : 'Go to the dock';
  $('boardBtn').classList.toggle('hidden', mode !== 'walk' || !nearLaunch());
  if (mode !== 'walk') $('prompt').classList.add('hidden');
  setHelp();
}

function board() {
  if (mode !== 'walk' || !nearLaunch()) return;
  clearToast();
  mode = 'launch';
  keys.clear();
  if (locked()) document.exitPointerLock();
  sound.start();
  syncUI();
  toast('On the launch. Hold W to go, A / D to steer.', 3);
}

function toWalk() {
  clearToast();
  mode = 'walk';
  keys.clear();
  if (locked()) document.exitPointerLock();
  launch.reset();
  spawn();
  syncUI();
}

function goDock() {
  if (mode === 'launch') return toWalk();
  spawn();
  syncUI();
  toast('Launch dock. Press E near the launch to board.');
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
$('boardBtn').addEventListener('click', board);
$('todBtn').textContent = PRESETS[env.presetIndex].name;

canvas.addEventListener('click', () => {
  if (mode !== 'walk') return;
  if (!locked()) lock();
});
document.addEventListener('pointerlockchange', syncUI);
document.addEventListener('mousemove', (e) => {
  if (mode === 'walk' && locked()) player.look(e.movementX, e.movementY);
});

window.addEventListener('keydown', (e) => {
  if (mode === 'intro') return;
  if ((e.target as HTMLElement).tagName === 'BUTTON' && (e.code === 'Space' || e.code === 'Enter')) return;
  keys.add(e.code);
  if (e.code === 'KeyT') cycleTod();
  if (e.code === 'KeyM') toggleSound();
  if (mode === 'walk') {
    if (e.code === 'KeyE' && !e.repeat) board();
    if (e.code === 'Space') e.preventDefault();
  } else if (mode === 'launch') {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    if (e.code === 'Escape') toWalk();
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
  if (mode === 'launch') {
    const steer = (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0) - (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0);
    const forward = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
    launch.update(dt, time, forward, steer, true);
    launch.applyCamera(camera);
    sound.setSpeed(Math.abs(launch.speed));
  } else {
    launch.update(dt, time, 0, 0, false);
    if (mode === 'walk') {
      const fell = player.update(dt, locked() ? keys : none);
      if (fell && player.pos.y < conditions.level - 0.4) {
        spawn();
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
    const arrow = conditions.levelRate > 0 ? '↑' : '↓';
    $('tideChip').textContent = `Tide ${conditions.tideHeight.toFixed(1)} m ${arrow} ${tidePhase()}`;
    $('windChip').textContent = `Wind ${Math.round(conditions.wind.length() / KT)} kt ${compassPoint(conditions.windFrom)}`;
    if (mode === 'launch') {
      $('speed').textContent = Math.abs(launch.speed).toFixed(1);
      $('dist').textContent = launch.distance.toFixed(0);
      $('where').textContent = 'Redwood Creek';
    } else if (mode === 'walk') {
      $('where').textContent = whereLabel();
      const show = nearLaunch();
      const pr = $('prompt');
      pr.classList.toggle('hidden', !show);
      $('boardBtn').classList.toggle('hidden', !show);
      if (show) pr.textContent = 'Press E to board the launch';
    }
  }
  if (toastTimer > 0) {
    toastTimer -= dt;
    if (toastTimer <= 0) $('toast').classList.add('hidden');
  }
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

const birdFocus = new THREE.Vector3();
initBirds(scene, () => (mode === 'launch' ? birdFocus.set(launch.x, conditions.level, launch.z) : player.pos), { muted: () => sound.muted });

syncUI();
frame();
Object.assign(window, {
  __app: {
    scene,
    camera,
    renderer,
    player,
    launch,
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
  },
});
