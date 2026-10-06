import * as THREE from 'three';
import type { CrewBoat } from '../rowing/crewboat';
import { addSystem } from '../sim/systems';
import { CrewAI } from './traffic/crews';
import { Launch, Motorboat } from './traffic/motor';
import { type Agent, type Body, CARDINAL, type Ctx, rng, WHITE } from './traffic/nav';
import { Kayak, OutriggerCanoe, Paddleboard } from './traffic/paddle';
import { PeopleBatch } from './traffic/people';
import { C420, Dinghy, FJ } from './traffic/sail';
import { centerline } from './terrain';
import { WakeField } from './traffic/wake';

/** Max craft simultaneously near the camera (fully simulated + rendered); the motorboat waits for a slot. */
const MAX_ACTIVE = 10;
const NEAR = 1800;
const DETAIL = 700;

class PlayerBody implements Body {
  x = 0;
  z = 0;
  heading = 0;
  speed = 0;
  readonly halfLen = 8.8;
  readonly halfBeam = 3.1;
}

/**
 * Other people on Redwood Creek: AI crews (8+, 4+, 2-) with a coaching launch, FJ/420 dinghies,
 * an OC6 outrigger, kayaks, a SUP and an occasional motorboat. One system drives them all.
 */
export function initTraffic(scene: THREE.Scene, getPlayerBoat: () => CrewBoat | null | undefined, camera?: THREE.Camera) {
  const root = new THREE.Group();
  root.name = 'traffic';
  scene.add(root);
  const wake = new WakeField(root);
  const people = new PeopleBatch(root);

  const w8 = new CrewAI(scene, '8+', 'traffic-w8', WHITE, -160, 1, 0.36, -1500, 2300, 1);
  const four = new CrewAI(scene, '4+', 'traffic-4', CARDINAL, 520, -1, 0.36, -1000, 1600, 2);
  const pair = new CrewAI(scene, '2-', 'traffic-2', WHITE, -620, 1, 0.42, -700, 1200, 3);
  const launch = new Launch(root, w8);
  const fj = new Dinghy(root, FJ, -120, centerline(-120) - 20, 0.6, 11, WHITE);
  const c420 = new Dinghy(root, C420, 260, centerline(260) + 15, 2.4, 12, WHITE);
  const oc6 = new OutriggerCanoe(root, 950, -1, 0.3, -1300, 1900, '#c9a227');
  const kayakA = new Kayak(root, 300, 1, 0.62, -600, 800, '#e4572e', 21);
  const kayakB = new Kayak(root, 296, 1, 0.62, -600, 800, '#f3c623', 22, kayakA);
  kayakA.follower = kayakB;
  const sup = new Paddleboard(root, -260, -1, 0.68, -420, 480, '#3fa7c9');
  const motor = new Motorboat(root);

  const agents: Agent[] = [w8, four, pair, launch, fj, c420, oc6, kayakA, kayakB, sup, motor];
  const player = new PlayerBody();
  const bodies: Body[] = [...agents, player];
  const ctx: Ctx = { bodies, cam: new THREE.Vector3(), wake, people };
  const slow = new Float32Array(agents.length);
  const rand = rng(99);
  let motorTimer = 45;

  const system = {
    update(dt: number, time: number) {
      const pb = getPlayerBoat();
      if (pb) {
        player.x = pb.x;
        player.z = pb.z;
        player.heading = pb.heading;
        player.speed = pb.speed;
      }
      if (camera) camera.getWorldPosition(ctx.cam);
      else ctx.cam.set(player.x, 2, player.z);

      let near = 0;
      for (const a of agents) {
        if (!a.active) {
          a.camDist = Infinity;
          continue;
        }
        a.camDist = Math.hypot(a.x - ctx.cam.x, a.z - ctx.cam.z);
        if (a.camDist < NEAR) near++;
      }
      motorTimer -= dt;
      if (!motor.active && motorTimer <= 0) {
        if (near < MAX_ACTIVE) motor.spawn(rand);
        motorTimer = 180 + rand() * 240;
      }

      for (let i = 0; i < agents.length; i++) {
        const a = agents[i];
        if (!a.active) {
          a.setVisible(false, false);
          continue;
        }
        const vis = a.camDist < NEAR;
        a.setVisible(vis, a.camDist < DETAIL);
        if (vis) a.update(dt, time, ctx);
        else {
          // Far craft keep moving at a 4 Hz tick so they're where they should be when you arrive.
          slow[i] += dt;
          if (slow[i] >= 0.25) {
            a.update(slow[i], time, ctx);
            slow[i] = 0;
          }
        }
      }

      // Hard separation as a last resort (avoidance should keep this from ever triggering).
      for (let i = 0; i < agents.length; i++) {
        const a = agents[i];
        if (!a.active) continue;
        for (let j = i + 1; j < bodies.length; j++) {
          const b = bodies[j];
          if (b instanceof Motorboat && !b.active) continue;
          const dx = a.x - b.x;
          const dz = a.z - b.z;
          const min = a.halfBeam + b.halfBeam + 0.35 * (a.halfLen + b.halfLen) * 0.5;
          const d2 = dx * dx + dz * dz;
          if (!(d2 <= min * min) || d2 < 1e-6) continue;
          const d = Math.sqrt(d2);
          const push = (min - d) / d;
          if (b === player) a.nudge(dx * push, dz * push);
          else {
            a.nudge(dx * push * 0.5, dz * push * 0.5);
            (b as Agent).nudge(-dx * push * 0.5, -dz * push * 0.5);
          }
        }
      }

      wake.update(dt);
      people.begin();
      for (const a of agents) if (a.active && a.camDist < 450) a.draw(people, time);
      people.end();
    },
  };
  addSystem(system);

  const api = { root, agents, wake, people, system };
  (window as unknown as { __traffic: typeof api }).__traffic = api;
  return api;
}
