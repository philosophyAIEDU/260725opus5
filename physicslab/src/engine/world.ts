/**
 * 월드 스텝.
 *
 * ■ "순수 함수" 에 대하여
 *   step(world, h) 는 **결정론적 상태 전이**입니다.
 *   같은 입력 상태 + 같은 h → 항상 비트 단위로 같은 출력 상태.
 *   다만 성능 예산(물리 hot loop 힙 할당 0회) 때문에 새 객체를 만들지 않고
 *   전달받은 world 를 제자리에서 갱신한 뒤 그대로 돌려줍니다.
 *   불변 버전이 필요하면 stepped() 를 쓰세요 — cloneWorld 후 step 을 돌립니다.
 *   (테스트와 문서에서는 stepped 로 "순수성"을 확인하고,
 *    실행 경로에서는 step 으로 할당을 0으로 유지합니다.)
 *
 * ■ 실시간 값 차단
 *   이 파일 어디에서도 Date.now(), performance.now(), Math.random() 을 쓰지 않습니다.
 *   물리는 오직 (상태, h) 만의 함수입니다. 되감기·리플레이·자동 테스트·
 *   교사 시연 재현이 전부 여기에 달려 있습니다.
 */

import {
  createImpact,
  findEarliestImpact,
  IMPACT_BODY,
  IMPACT_NONE,
  IMPACT_WALL,
  resolveBodyImpact,
  resolveWallImpact,
  separate,
  type Impact,
} from './collision.ts';
import { ensureCompiled, evalTrack, trackLength } from './constraints.ts';
import { createForceOut, totalForce } from './forces.ts';
import {
  autoIntegrator,
  primeAcceleration,
  stepFreeBody,
} from './integrator.ts';
import { cloneRng, createRng } from './rng.ts';
import {
  createEventBuffer,
  createTrackFrame,
  EVENT_LEAVE_TRACK,
  EVENT_SLIP_START,
  EVENT_STICK,
  pushEvent,
  type Body,
  type EnergyBreakdown,
  type Fields,
  type IntegratorKind,
  type TrackPath,
  type World,
} from './types.ts';

// ── 모듈 스크래치 (스텝당 할당 0회) ───────────────────────────
const impact: Impact = createImpact();
const frame = createTrackFrame();
const frame2 = createTrackFrame();
const forceScratch = createForceOut();

/** 한 substep 안에서 처리할 최대 충돌 횟수. */
const MAX_IMPACTS_PER_STEP = 8;
/** "정지 중"으로 볼 접선 속도 한계 [m/s] */
const U_EPS = 1e-7;
/** 충돌 후 겹침을 밀어내는 양 [m] */
const SEPARATION_EPS = 1e-9;

// ────────────────────────────────────────────────────────────
// 월드 생성
// ────────────────────────────────────────────────────────────

export interface WorldInit {
  dt?: number;
  bodies?: Body[];
  walls?: World['walls'];
  springs?: World['springs'];
  tracks?: TrackPath[];
  fields?: Partial<Fields>;
  waves?: World['waves'];
  integrator?: IntegratorKind;
  seed?: number;
  userScalarCount?: number;
}

export const DEFAULT_DT = 1 / 960;

export function createWorld(init: WorldInit = {}): World {
  const world: World = {
    dt: init.dt ?? DEFAULT_DT,
    time: 0,
    steps: 0,
    bodies: init.bodies ?? [],
    walls: init.walls ?? [],
    springs: init.springs ?? [],
    tracks: init.tracks ?? [],
    fields: {
      gravity: {
        x: init.fields?.gravity?.x ?? 0,
        y: init.fields?.gravity?.y ?? -9.81,
      },
      electric: {
        x: init.fields?.electric?.x ?? 0,
        y: init.fields?.electric?.y ?? 0,
      },
      magneticZ: init.fields?.magneticZ ?? 0,
    },
    waves: init.waves ?? null,
    integrator: init.integrator ?? 'velocityVerlet',
    rng: createRng(init.seed ?? 0x9e3779b9),
    thermal: 0,
    events: createEventBuffer(),
    userScalars: new Float64Array(init.userScalarCount ?? 4),
  };

  if (!init.integrator) world.integrator = autoIntegrator(world);
  for (const t of world.tracks) ensureCompiled(t);

  // 트랙 구속 물체의 데카르트 상태 초기 동기화
  for (const b of world.bodies) {
    if (b.trackIndex >= 0) syncTrackBody(world, b);
  }
  // 베를레는 첫 스텝에 a 가 필요합니다.
  for (let i = 0; i < world.bodies.length; i++) {
    const b = world.bodies[i]!;
    if (b.trackIndex < 0) primeAcceleration(world, i, b);
  }
  return world;
}

// ────────────────────────────────────────────────────────────
// 트랙 구속 운동
// ────────────────────────────────────────────────────────────

/** 트랙 좌표 (s, u) → 데카르트 (p, v). 렌더·충돌·측정이 p, v 를 읽습니다. */
export function syncTrackBody(world: World, body: Body): void {
  const track = world.tracks[body.trackIndex];
  if (!track) return;
  evalTrack(track, body.s, frame);
  body.p.x = frame.px;
  body.p.y = frame.py;
  body.v.x = frame.tx * body.u;
  body.v.y = frame.ty * body.u;
}

interface TrackAccelOut {
  at: number;
  normal: number;
}
const trackAccelOut: TrackAccelOut = { at: 0, normal: 0 };

/**
 * 트랙 위 접선 가속도와 수직항력.
 *
 *   a = u̇ t̂ + u²κ n̂           (프레네 분해)
 *   m a = F_ext + N n̂ + f t̂
 *   → 접선: m u̇ = F_ext·t̂ + f
 *   → 법선: m u²κ = F_ext·n̂ + N   →   N = m u²κ − F_ext·n̂
 */
function trackAccel(
  world: World,
  index: number,
  body: Body,
  track: TrackPath,
  s: number,
  u: number,
  out: TrackAccelOut,
): void {
  evalTrack(track, s, frame2);
  const vx = frame2.tx * u;
  const vy = frame2.ty * u;
  totalForce(world, index, body, frame2.px, frame2.py, vx, vy, forceScratch);

  const ft = forceScratch.fx * frame2.tx + forceScratch.fy * frame2.ty;
  const fn = forceScratch.fx * frame2.nx + forceScratch.fy * frame2.ny;
  const N = body.mass * u * u * frame2.kappa - fn;
  out.normal = N;

  // 지지 방식에 따른 유효 수직항력 크기
  const nAbs = track.support === 'twoSided' ? Math.abs(N) : Math.max(0, N);

  let tangential = ft;
  if (Math.abs(u) < U_EPS) {
    // 정지 상태: 정지마찰은 "필요한 만큼" 생기되 μs·N 이 상한
    if (Math.abs(ft) <= track.muS * nAbs) {
      tangential = 0;
    } else {
      tangential = ft - Math.sign(ft) * track.muK * nAbs;
    }
  } else if (track.muK > 0) {
    tangential = ft - Math.sign(u) * track.muK * nAbs;
  }

  out.at = tangential * body.invMass;
}

/** 트랙이 마찰도 항력도 없는 보존계인가 → 속도 베를레를 쓸 수 있는가 */
function trackIsConservative(track: TrackPath, body: Body): boolean {
  return (
    track.muK === 0 &&
    track.muS === 0 &&
    body.dragLinear === 0 &&
    body.dragQuad === 0
  );
}

function stepTrackBody(
  world: World,
  index: number,
  body: Body,
  h: number,
): void {
  const track = world.tracks[body.trackIndex];
  if (!track) return;

  const wasSticking = body.sticking;
  const uBefore = body.u;
  let s: number;
  let u: number;

  if (trackIsConservative(track, body)) {
    // ── 속도 베를레: a 가 s 만의 함수 → 심플렉틱, 에너지 표류 없음 ──
    trackAccel(world, index, body, track, body.s, body.u, trackAccelOut);
    const a0 = trackAccelOut.at;
    s = body.s + body.u * h + 0.5 * a0 * h * h;
    trackAccel(world, index, body, track, s, body.u, trackAccelOut);
    const a1 = trackAccelOut.at;
    u = body.u + 0.5 * (a0 + a1) * h;
  } else {
    // ── 반음적 오일러 + 2회 예측-보정: a 가 (s, u) 의 함수 ──
    const s0 = body.s;
    const u0 = body.u;
    trackAccel(world, index, body, track, s0, u0, trackAccelOut);
    const a0 = trackAccelOut.at;
    u = u0 + a0 * h;
    s = s0 + u * h;
    for (let it = 0; it < 2; it++) {
      trackAccel(world, index, body, track, s, u, trackAccelOut);
      const a1 = trackAccelOut.at;
      u = u0 + 0.5 * (a0 + a1) * h;
      s = s0 + 0.5 * (u0 + u) * h;
    }
  }

  // 운동마찰이 속도를 뒤집는 것은 비물리적 — 0 에서 멈춰야 합니다.
  if (track.muK > 0 && uBefore !== 0 && uBefore * u < 0) {
    u = 0;
    s = body.s;
  }

  const len = trackLength(track);
  if (track.closed && len > 0) {
    // 닫힌 트랙(진자·원형 레일)은 호길이가 한 바퀴마다 되감깁니다.
    s = s % len;
    if (s < 0) s += len;
  }
  body.s = s;
  body.u = u;

  // 최신 상태에서 수직항력과 정지 여부를 다시 평가
  trackAccel(world, index, body, track, body.s, body.u, trackAccelOut);
  body.normalForce = trackAccelOut.normal;
  body.sticking = Math.abs(body.u) < U_EPS && trackAccelOut.at === 0;

  if (body.sticking !== wasSticking) {
    pushEvent(
      world.events,
      body.sticking ? EVENT_STICK : EVENT_SLIP_START,
      index,
      -1,
      world.time,
      Math.abs(body.normalForce),
    );
  }

  // ── 트랙 이탈 판정 ──────────────────────────────────────
  if (track.support === 'oneSided' && trackAccelOut.normal < 0) {
    detachFromTrack(world, index, body, 'normal');
    return;
  }
  if (!track.closed && (body.s < 0 || body.s > len)) {
    // 트랙 끝에 도달 → 자유 낙하로 전환
    body.s = body.s < 0 ? 0 : len;
    detachFromTrack(world, index, body, 'end');
    return;
  }

  syncTrackBody(world, body);
}

/**
 * 트랙에서 떨어져 자유 물체가 됩니다.
 *
 * 다시 트랙에 붙는 재부착은 모델링하지 않습니다. 일반적인 재부착은
 * 곡선-원 교차를 매 스텝 풀어야 해서 성능 예산을 넘고,
 * 무엇보다 "이탈했다"는 사실 자체가 스테이지의 학습 목표(루프 최소 높이,
 * 언덕 마루 이탈)이기 때문에 이탈 후 포물선 낙하가 정답에 해당합니다.
 */
function detachFromTrack(
  world: World,
  index: number,
  body: Body,
  reason: 'normal' | 'end',
): void {
  const track = world.tracks[body.trackIndex]!;
  evalTrack(track, body.s, frame);
  body.p.x = frame.px;
  body.p.y = frame.py;
  body.v.x = frame.tx * body.u;
  body.v.y = frame.ty * body.u;
  body.trackIndex = -1;
  body.kind = 'free';
  body.normalForce = 0;
  body.sticking = false;
  primeAcceleration(world, index, body);
  pushEvent(
    world.events,
    EVENT_LEAVE_TRACK,
    index,
    reason === 'normal' ? 0 : 1,
    world.time,
    Math.abs(body.u),
  );
}

// ────────────────────────────────────────────────────────────
// 자유 물체 적분 + CCD
// ────────────────────────────────────────────────────────────

function integrateFreeBodies(world: World, h: number, kind: IntegratorKind): void {
  const bodies = world.bodies;
  for (let i = 0; i < bodies.length; i++) {
    const b = bodies[i]!;
    if (!b.active || b.trackIndex >= 0 || b.invMass === 0) continue;
    stepFreeBody(world, i, b, h, kind);
  }
}

/**
 * 한 substep 을 충돌 시각으로 잘라가며 진행합니다.
 * (collision.ts 상단의 4단계 절차)
 */
function advanceFreeBodies(world: World, h: number, kind: IntegratorKind): void {
  let remaining = h;
  let guard = 0;

  while (remaining > 1e-15 && guard < MAX_IMPACTS_PER_STEP) {
    const hit = findEarliestImpact(world, remaining, impact);
    const sub = hit ? Math.min(remaining, Math.max(0, impact.t)) : remaining;

    if (sub > 0) integrateFreeBodies(world, sub, kind);

    if (!hit || impact.kind === IMPACT_NONE) {
      remaining -= sub;
      break;
    }

    const t = world.time + (h - remaining) + sub;
    if (impact.kind === IMPACT_WALL) {
      const body = world.bodies[impact.a]!;
      const wall = world.walls[impact.b]!;
      world.thermal += resolveWallImpact(
        body, wall, impact.nx, impact.ny,
        world.events, impact.a, impact.b, t,
      );
      separate(body, impact.nx, impact.ny, SEPARATION_EPS);
      primeAcceleration(world, impact.a, body);
    } else if (impact.kind === IMPACT_BODY) {
      const a = world.bodies[impact.a]!;
      const b = world.bodies[impact.b]!;
      world.thermal += resolveBodyImpact(
        a, b, impact.nx, impact.ny,
        world.events, impact.a, impact.b, t,
      );
      separate(a, impact.nx, impact.ny, SEPARATION_EPS);
      separate(b, -impact.nx, -impact.ny, SEPARATION_EPS);
      primeAcceleration(world, impact.a, a);
      primeAcceleration(world, impact.b, b);
    }

    remaining -= sub;
    guard++;
  }

  // 충돌이 과도하게 몰린 예외 상황에서도 시간은 정확히 h 만큼 흘러야 합니다.
  if (remaining > 1e-15) integrateFreeBodies(world, remaining, kind);
}

// ────────────────────────────────────────────────────────────
// step
// ────────────────────────────────────────────────────────────

/**
 * 한 substep 진행. 반환값은 인자로 받은 world 와 동일한 객체입니다.
 * (상단 "순수 함수에 대하여" 참조)
 */
export function step(world: World, h: number = world.dt): World {
  world.events.count = 0;

  const kind = world.integrator;

  for (let i = 0; i < world.bodies.length; i++) {
    const b = world.bodies[i]!;
    if (!b.active || b.trackIndex < 0 || b.invMass === 0) continue;
    stepTrackBody(world, i, b, h);
  }

  advanceFreeBodies(world, h, kind);

  world.steps += 1;
  // 시각은 정수 스텝 수에서 재계산합니다. 누적 덧셈은 부동소수 오차가 쌓입니다.
  world.time = world.steps * world.dt;
  return world;
}

/** n 회 substep. */
export function stepN(world: World, n: number, h: number = world.dt): World {
  for (let i = 0; i < n; i++) step(world, h);
  return world;
}

/** 불변 버전 (테스트·문서용). 성능 경로에서는 쓰지 마세요. */
export function stepped(world: World, h: number = world.dt): World {
  return step(cloneWorld(world), h);
}

// ────────────────────────────────────────────────────────────
// 복제 / 에너지
// ────────────────────────────────────────────────────────────

export function cloneWorld(w: World): World {
  return {
    dt: w.dt,
    time: w.time,
    steps: w.steps,
    bodies: w.bodies.map((b) => ({
      ...b,
      p: { x: b.p.x, y: b.p.y },
      v: { x: b.v.x, y: b.v.y },
      a: { x: b.a.x, y: b.a.y },
    })),
    // 정적 기하는 스텝이 건드리지 않으므로 참조를 공유합니다 (복제 비용 절감).
    walls: w.walls,
    springs: w.springs,
    tracks: w.tracks,
    fields: {
      gravity: { x: w.fields.gravity.x, y: w.fields.gravity.y },
      electric: { x: w.fields.electric.x, y: w.fields.electric.y },
      magneticZ: w.fields.magneticZ,
    },
    waves: w.waves,
    integrator: w.integrator,
    rng: cloneRng(w.rng),
    thermal: w.thermal,
    events: createEventBuffer(w.events.capacity),
    userScalars: new Float64Array(w.userScalars),
  };
}

/**
 * 에너지 분해.
 * 중력 퍼텐셜의 기준면은 y = 0 입니다.
 * 스택 막대그래프(스테이지 5)와 검증 ①이 이 함수를 씁니다.
 */
export function computeEnergy(world: World): EnergyBreakdown {
  let kinetic = 0;
  let potentialGravity = 0;
  let potentialElectric = 0;
  let potentialSpring = 0;

  const g = world.fields.gravity;
  const E = world.fields.electric;

  for (const b of world.bodies) {
    if (!b.active || b.invMass === 0) continue;
    if (b.trackIndex >= 0) {
      kinetic += 0.5 * b.mass * b.u * b.u;
    } else {
      kinetic += 0.5 * b.mass * (b.v.x * b.v.x + b.v.y * b.v.y);
    }
    potentialGravity += -b.mass * (g.x * b.p.x + g.y * b.p.y);
    potentialElectric += -b.charge * (E.x * b.p.x + E.y * b.p.y);
  }

  for (const sp of world.springs) {
    const a = world.bodies[sp.i];
    if (!a) continue;
    const ox = sp.j >= 0 ? world.bodies[sp.j]!.p.x : sp.anchor.x;
    const oy = sp.j >= 0 ? world.bodies[sp.j]!.p.y : sp.anchor.y;
    const d = Math.hypot(a.p.x - ox, a.p.y - oy) - sp.restLength;
    potentialSpring += 0.5 * sp.k * d * d;
  }

  const total =
    kinetic +
    potentialGravity +
    potentialElectric +
    potentialSpring +
    world.thermal;

  return {
    kinetic,
    potentialGravity,
    potentialSpring,
    potentialElectric,
    thermal: world.thermal,
    total,
  };
}

/** 전체 운동량 (x, y) 를 out 에 채웁니다. */
export function totalMomentum(world: World, out: { x: number; y: number }): void {
  out.x = 0;
  out.y = 0;
  for (const b of world.bodies) {
    if (!b.active || b.invMass === 0) continue;
    out.x += b.mass * b.v.x;
    out.y += b.mass * b.v.y;
  }
}

export function findBody(world: World, tag: string): Body | undefined {
  return world.bodies.find((b) => b.tag === tag);
}

export function findBodyIndex(world: World, tag: string): number {
  return world.bodies.findIndex((b) => b.tag === tag);
}
