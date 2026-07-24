/**
 * 충돌 — 연속 충돌 감지(CCD) + 반발계수 기반 충격량.
 *
 * ■ 이산 충돌 감지를 쓰지 않는 이유
 *   "스텝 끝에서 겹쳤는지 본다"는 방식은 빠른 물체가 벽을 통째로 건너뛰면
 *   충돌을 아예 놓칩니다(터널링). dt = 1/960 s 에서도 500 m/s 물체는
 *   한 스텝에 0.52 m 를 이동하므로 얇은 벽은 그냥 통과해버립니다.
 *   학생이 "속도를 올렸더니 공이 벽을 뚫었다"를 보는 순간
 *   시뮬레이션에 대한 신뢰가 무너지고, 그건 오개념보다 나쁩니다.
 *
 * ■ 그래서 이렇게 합니다
 *   1. 스텝 구간 [0, h] 안에서 **해석적으로 충돌 시각 t\* 를 계산**
 *   2. t\* 까지만 정상 적분
 *   3. 충격량 적용
 *   4. 남은 h − t\* 를 다시 1번부터 반복 (한 스텝 안 다중 충돌 지원)
 *
 * ■ 스윕 근사
 *   충돌 시각 계산은 직선 스윕 p + v·t 를 씁니다. 가속도가 만드는 처짐은
 *   ½|a|h² 이고 h = 1/960 s, |a| ≈ 10 m/s² 에서 5×10⁻⁶ m — 물체 반지름의
 *   1/10000 수준이라 접촉 시각에 유의미한 영향을 주지 않습니다.
 *   (docs/PHYSICS.md 에 근사 조건 명시)
 */

import type { Body, EventBuffer, Wall, World } from './types.ts';
import { EVENT_BODY_BODY, EVENT_BODY_WALL, pushEvent } from './types.ts';

export const IMPACT_NONE = 0;
export const IMPACT_WALL = 1;
export const IMPACT_BODY = 2;

export interface Impact {
  kind: number;
  /** 스텝 시작 기준 충돌 시각 [s] */
  t: number;
  /** 물체 인덱스 */
  a: number;
  /** 상대 물체 인덱스 (벽이면 벽 인덱스) */
  b: number;
  /** 접촉 법선. 항상 물체 a 를 밀어내는 방향(a 에서 바깥). */
  nx: number;
  ny: number;
}

export function createImpact(): Impact {
  return { kind: IMPACT_NONE, t: 0, a: -1, b: -1, nx: 0, ny: 0 };
}

/** 접촉 판정 여유. 수치 오차로 스텝마다 t=0 충돌이 반복되는 것을 막습니다. */
const CONTACT_SLOP = 1e-9;
/** 이 속도 미만의 수직 접근은 "놓여 있음"으로 처리해 지터를 없앱니다. */
const RESTING_SPEED = 0.12;

// ────────────────────────────────────────────────────────────
// 스윕 검사
// ────────────────────────────────────────────────────────────

/** sweepCircleSegment 결과 (할당 방지용 모듈 스크래치). */
const segHit = { t: 0, nx: 0, ny: 0, hit: false };

/**
 * 반지름 r 인 원이 (px,py) 에서 속도 (vx,vy) 로 움직일 때
 * 선분 A–B 와 처음 닿는 시각을 [0, maxT] 안에서 찾습니다.
 *
 * 선분의 면(face)과 두 끝점(cap)을 모두 검사합니다.
 * 끝점을 빼먹으면 벽 모서리를 지나는 물체가 순간이동합니다.
 */
function sweepCircleSegment(
  px: number, py: number,
  vx: number, vy: number,
  r: number,
  ax: number, ay: number,
  bx: number, by: number,
  maxT: number,
): boolean {
  segHit.hit = false;
  let best = maxT;

  const dx = bx - ax;
  const dy = by - ay;
  const segLen = Math.hypot(dx, dy);
  if (segLen < 1e-12) return false;
  const tx = dx / segLen;
  const ty = dy / segLen;
  const nx = -ty;
  const ny = tx;

  // ── 1. 면 접촉 ────────────────────────────────────────────
  const d0 = (px - ax) * nx + (py - ay) * ny; // 부호 있는 거리
  const vn = vx * nx + vy * ny;
  const side = d0 >= 0 ? 1 : -1;
  const dAbs = side * d0;
  const approach = -side * vn; // > 0 이면 벽 쪽으로 접근 중

  if (approach > 0) {
    let t: number;
    if (dAbs <= r + CONTACT_SLOP) {
      t = 0;
    } else {
      t = (dAbs - r) / approach;
    }
    if (t >= 0 && t <= best) {
      const cx = px + vx * t;
      const cy = py + vy * t;
      const proj = (cx - ax) * tx + (cy - ay) * ty;
      if (proj >= 0 && proj <= segLen) {
        best = t;
        segHit.t = t;
        segHit.nx = side * nx;
        segHit.ny = side * ny;
        segHit.hit = true;
      }
    }
  }

  // ── 2. 끝점 접촉 ──────────────────────────────────────────
  for (let e = 0; e < 2; e++) {
    const ex = e === 0 ? ax : bx;
    const ey = e === 0 ? ay : by;
    const rx = px - ex;
    const ry = py - ey;
    const A = vx * vx + vy * vy;
    if (A < 1e-24) continue;
    const B = 2 * (rx * vx + ry * vy);
    const C = rx * rx + ry * ry - r * r;
    if (C <= 0 && B < 0) {
      // 이미 겹쳐 있고 접근 중
      if (0 <= best) {
        const inv = 1 / Math.max(1e-12, Math.hypot(rx, ry));
        best = 0;
        segHit.t = 0;
        segHit.nx = rx * inv;
        segHit.ny = ry * inv;
        segHit.hit = true;
      }
      continue;
    }
    const disc = B * B - 4 * A * C;
    if (disc < 0) continue;
    const sq = Math.sqrt(disc);
    const t = (-B - sq) / (2 * A);
    if (t >= 0 && t <= best) {
      const cx = px + vx * t - ex;
      const cy = py + vy * t - ey;
      const inv = 1 / Math.max(1e-12, Math.hypot(cx, cy));
      best = t;
      segHit.t = t;
      segHit.nx = cx * inv;
      segHit.ny = cy * inv;
      segHit.hit = true;
    }
  }

  return segHit.hit;
}

const pairHit = { t: 0, nx: 0, ny: 0, hit: false };

/** 두 원의 스윕 접촉 시각. 법선은 a → b 방향. */
function sweepCircleCircle(a: Body, b: Body, maxT: number): boolean {
  pairHit.hit = false;
  const rx = b.p.x - a.p.x;
  const ry = b.p.y - a.p.y;
  const vx = b.v.x - a.v.x;
  const vy = b.v.y - a.v.y;
  const R = a.radius + b.radius;

  const A = vx * vx + vy * vy;
  const B = 2 * (rx * vx + ry * vy);
  const C = rx * rx + ry * ry - R * R;

  if (C <= CONTACT_SLOP && B < 0) {
    const inv = 1 / Math.max(1e-12, Math.hypot(rx, ry));
    pairHit.t = 0;
    pairHit.nx = rx * inv;
    pairHit.ny = ry * inv;
    pairHit.hit = true;
    return true;
  }
  if (A < 1e-24) return false;
  const disc = B * B - 4 * A * C;
  if (disc < 0) return false;
  const sq = Math.sqrt(disc);
  const t = (-B - sq) / (2 * A);
  if (t < 0 || t > maxT) return false;

  const cx = rx + vx * t;
  const cy = ry + vy * t;
  const inv = 1 / Math.max(1e-12, Math.hypot(cx, cy));
  pairHit.t = t;
  pairHit.nx = cx * inv;
  pairHit.ny = cy * inv;
  pairHit.hit = true;
  return true;
}

// ────────────────────────────────────────────────────────────
// 가장 이른 충돌 찾기
// ────────────────────────────────────────────────────────────

/** 충돌 후보가 되는 물체인지: 활성 + 트랙에 구속되지 않음 */
function collidable(b: Body): boolean {
  return b.active && b.trackIndex < 0;
}

export function findEarliestImpact(world: World, maxT: number, out: Impact): boolean {
  out.kind = IMPACT_NONE;
  let best = maxT;
  let found = false;

  const bodies = world.bodies;
  const walls = world.walls;

  for (let i = 0; i < bodies.length; i++) {
    const bi = bodies[i]!;
    if (!collidable(bi)) continue;

    for (let w = 0; w < walls.length; w++) {
      const wall = walls[w]!;
      if (
        sweepCircleSegment(
          bi.p.x, bi.p.y, bi.v.x, bi.v.y, bi.radius,
          wall.a.x, wall.a.y, wall.b.x, wall.b.y,
          best,
        )
      ) {
        if (segHit.t <= best) {
          best = segHit.t;
          out.kind = IMPACT_WALL;
          out.t = segHit.t;
          out.a = i;
          out.b = w;
          out.nx = segHit.nx;
          out.ny = segHit.ny;
          found = true;
        }
      }
    }

    for (let j = i + 1; j < bodies.length; j++) {
      const bj = bodies[j]!;
      if (!collidable(bj)) continue;
      if (bi.invMass === 0 && bj.invMass === 0) continue;
      if (sweepCircleCircle(bi, bj, best)) {
        if (pairHit.t <= best) {
          best = pairHit.t;
          out.kind = IMPACT_BODY;
          out.t = pairHit.t;
          out.a = i;
          out.b = j;
          // 법선을 "a 를 밀어내는 방향"으로 통일 → b → a 방향
          out.nx = -pairHit.nx;
          out.ny = -pairHit.ny;
          found = true;
        }
      }
    }
  }

  return found;
}

// ────────────────────────────────────────────────────────────
// 충격량 적용
// ────────────────────────────────────────────────────────────

/** 두 반발계수 합성. 기하평균 — 물리적 표준은 아니지만 널리 쓰이는 관례. */
function combineRestitution(e1: number, e2: number): number {
  return Math.sqrt(Math.max(0, e1) * Math.max(0, e2));
}

/**
 * 물체 ↔ 정지 벽.
 * n 은 벽에서 물체 쪽을 향하는 단위 법선.
 * 반환값은 발생한 열에너지 [J].
 */
export function resolveWallImpact(
  body: Body,
  wall: Wall,
  nx: number,
  ny: number,
  events: EventBuffer,
  bodyIndex: number,
  wallIndex: number,
  time: number,
): number {
  const vn = body.v.x * nx + body.v.y * ny;
  if (vn >= 0) return 0; // 이미 멀어지는 중

  const e = combineRestitution(body.restitution, wall.restitution);
  const keBefore = 0.5 * body.mass * (body.v.x * body.v.x + body.v.y * body.v.y);

  // 접선 방향
  const tx = -ny;
  const ty = nx;
  let vt = body.v.x * tx + body.v.y * ty;

  let newVn: number;
  if (-vn < RESTING_SPEED && e < 1) {
    // 튀어오르기엔 너무 느림 → 놓인 상태로 확정 (무한 미세 바운스 방지)
    newVn = 0;
    body.resting = true;
  } else {
    newVn = -e * vn;
    body.resting = false;
  }

  const jn = body.mass * (newVn - vn); // 수직 충격량 크기 [N·s]

  // 쿨롱 마찰: 접선 충격량은 μ·|수직 충격량| 을 넘을 수 없고,
  // 접선 속도를 반대로 뒤집을 수도 없습니다.
  const maxTangential = wall.friction * Math.abs(jn);
  const needed = Math.abs(vt) * body.mass;
  const jt = -Math.sign(vt) * Math.min(maxTangential, needed);
  vt += jt / body.mass;

  body.v.x = newVn * nx + vt * tx;
  body.v.y = newVn * ny + vt * ty;

  const keAfter = 0.5 * body.mass * (body.v.x * body.v.x + body.v.y * body.v.y);
  const heat = Math.max(0, keBefore - keAfter);

  pushEvent(events, EVENT_BODY_WALL, bodyIndex, wallIndex, time, Math.abs(jn));
  return heat;
}

/**
 * 물체 ↔ 물체.
 * n 은 b 에서 a 를 향하는 단위 법선.
 *
 * 뉴턴 제3법칙이 코드 구조에 그대로 드러나도록 썼습니다:
 * 같은 크기의 충격량 j 를 서로 반대 방향으로 준다 → 운동량 합은 반드시 보존.
 * 질량이 다르면 **속도 변화**가 다를 뿐 **힘(충격량)**은 같습니다.
 * (스테이지 4가 겨냥하는 "무거운 쪽이 더 센 힘을 준다" 오개념의 정면 반박)
 */
export function resolveBodyImpact(
  a: Body,
  b: Body,
  nx: number,
  ny: number,
  events: EventBuffer,
  ai: number,
  bi: number,
  time: number,
): number {
  const rvx = a.v.x - b.v.x;
  const rvy = a.v.y - b.v.y;
  const vn = rvx * nx + rvy * ny;
  if (vn >= 0) return 0;

  const e = combineRestitution(a.restitution, b.restitution);
  const invSum = a.invMass + b.invMass;
  if (invSum === 0) return 0;

  const j = (-(1 + e) * vn) / invSum;

  a.v.x += j * a.invMass * nx;
  a.v.y += j * a.invMass * ny;
  b.v.x -= j * b.invMass * nx;
  b.v.y -= j * b.invMass * ny;

  pushEvent(events, EVENT_BODY_BODY, ai, bi, time, Math.abs(j));

  // 손실 = ½ μ v_rel,n² (1 − e²),  μ = 환산질량
  const mu = 1 / invSum;
  return 0.5 * mu * vn * vn * (1 - e * e);
}

/** 겹침을 아주 살짝 밀어내 다음 스텝의 t=0 재충돌을 막습니다. */
export function separate(body: Body, nx: number, ny: number, amount: number): void {
  body.p.x += nx * amount;
  body.p.y += ny * amount;
}

export { RESTING_SPEED, CONTACT_SLOP };
