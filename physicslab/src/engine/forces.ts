/**
 * 힘 모델.
 *
 * 모든 함수는 **할당이 없고**, (위치, 속도) 를 인자로 받는 순수 함수입니다.
 * RK4 나 예측-보정 적분기는 한 스텝 안에서 힘을 서로 다른 (p, v) 에서
 * 여러 번 평가해야 하므로, 힘 계산이 물체 상태를 읽어버리면 안 됩니다.
 */

import type { Body, World } from './types.ts';

/** 힘 누산용 out 구조체. 모듈 전역 재사용은 하지 않고 호출자가 소유합니다. */
export interface ForceOut {
  fx: number;
  fy: number;
}

export function createForceOut(): ForceOut {
  return { fx: 0, fy: 0 };
}

/**
 * 중력: F = m g.
 *
 * 관성질량과 중력질량이 같기 때문에 가속도 a = g 로 질량이 소거됩니다.
 * 이것이 스테이지 1("무거운 물체가 빨리 떨어진다" 오개념)의 핵심이며,
 * 코드 상에서도 mass 를 곱했다가 나중에 invMass 로 나누는 형태 그대로 두어
 * 소거가 눈에 보이도록 했습니다.
 */
export function gravityForce(body: Body, world: World, out: ForceOut): void {
  out.fx += body.mass * world.fields.gravity.x;
  out.fy += body.mass * world.fields.gravity.y;
}

/**
 * 전기력: F = q E.
 * 중력과 똑같이 "일정한 힘 → 등가속도" 구조입니다 (스테이지 7의 요지).
 */
export function electricForce(body: Body, world: World, out: ForceOut): void {
  out.fx += body.charge * world.fields.electric.x;
  out.fy += body.charge * world.fields.electric.y;
}

/**
 * 로렌츠 자기력 (2D, B = (0,0,Bz)):
 *   F = q v × B = q (vy·Bz, −vx·Bz)
 *
 * 힘이 항상 속도에 수직이므로 일을 하지 않습니다 → 속력 불변, 등속 원운동.
 * "힘의 방향으로 물체가 움직인다"는 오개념(스테이지 8)을 정면으로 반박하는 힘입니다.
 *
 * 주의: 이 힘을 일반 적분기에 그냥 넣으면 자이로반지름이 계속 커집니다.
 * 실제 적분은 Boris pusher 로 해야 하며(integrator.ts 참조),
 * 이 함수는 자유물체도 표시와 참조 적분기(RK4) 검증용입니다.
 */
export function magneticForce(body: Body, world: World, vx: number, vy: number, out: ForceOut): void {
  const qb = body.charge * world.fields.magneticZ;
  out.fx += vy * qb;
  out.fy += -vx * qb;
}

/**
 * 선형(스토크스) 항력: F = −b v.
 * 저속·소형 물체(레이놀즈수 ≪ 1)에서 성립. 종단속도는 v_t = mg/b.
 */
export function linearDragForce(body: Body, vx: number, vy: number, out: ForceOut): void {
  const b = body.dragLinear;
  if (b === 0) return;
  out.fx += -b * vx;
  out.fy += -b * vy;
}

/**
 * 2차(뉴턴) 항력: F = −c |v| v,  c = ½ρC_dA.
 * 일상 크기·속도의 물체(빗방울, 야구공, 사람)는 이쪽입니다.
 * 종단속도 v_t = √(mg/c)  ← 검증 ⑥.
 */
export function quadraticDragForce(body: Body, vx: number, vy: number, out: ForceOut): void {
  const c = body.dragQuad;
  if (c === 0) return;
  const speed = Math.sqrt(vx * vx + vy * vy);
  if (speed === 0) return;
  out.fx += -c * speed * vx;
  out.fy += -c * speed * vy;
}

/**
 * 용수철: F = −k(|d| − L₀) d̂ − c v_rel.
 *
 * 다물체 예측-보정 중에는 상대 물체의 위치를 현재 저장값으로 읽습니다.
 * (스텝 내 동시 예측을 하면 O(n²) 재평가가 되어 성능 예산을 넘김.
 *  dt = 1/960 에서 이 근사가 만드는 오차는 무시 가능 — docs/PHYSICS.md)
 */
export function springForces(
  world: World,
  bodyIndex: number,
  px: number,
  py: number,
  vx: number,
  vy: number,
  out: ForceOut,
): void {
  const springs = world.springs;
  for (let si = 0; si < springs.length; si++) {
    const sp = springs[si]!;
    let otherX: number;
    let otherY: number;
    let otherVx = 0;
    let otherVy = 0;
    let sign: number;

    if (sp.i === bodyIndex) {
      sign = 1;
      if (sp.j >= 0) {
        const o = world.bodies[sp.j]!;
        otherX = o.p.x;
        otherY = o.p.y;
        otherVx = o.v.x;
        otherVy = o.v.y;
      } else {
        otherX = sp.anchor.x;
        otherY = sp.anchor.y;
      }
    } else if (sp.j === bodyIndex) {
      sign = 1;
      const o = world.bodies[sp.i]!;
      otherX = o.p.x;
      otherY = o.p.y;
      otherVx = o.v.x;
      otherVy = o.v.y;
    } else {
      continue;
    }

    const dx = px - otherX;
    const dy = py - otherY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 1e-12) continue;
    const inv = 1 / dist;
    const ux = dx * inv;
    const uy = dy * inv;
    const stretch = dist - sp.restLength;
    const fMag = -sp.k * stretch;

    // 감쇠는 시선 방향 상대속도 성분에만 작용 (횡방향 감쇠는 비물리적)
    const relV = (vx - otherVx) * ux + (vy - otherVy) * uy;
    const fDamp = -sp.damping * relV;

    const f = (fMag + fDamp) * sign;
    out.fx += f * ux;
    out.fy += f * uy;
  }
}

/**
 * 자유 물체에 작용하는 총 힘.
 *
 * (px, py, vx, vy) 를 명시적으로 받는 이유: 예측-보정과 RK4 가
 * 물체의 "현재" 상태가 아닌 시험 상태에서 힘을 평가해야 하기 때문입니다.
 *
 * 자기력은 포함하지 않습니다 — Boris pusher 가 회전으로 따로 처리하며,
 * 여기에 넣으면 이중 적용이 됩니다. FBD 표시용으로는 magneticForce 를 직접 부르세요.
 */
export function totalForce(
  world: World,
  bodyIndex: number,
  body: Body,
  px: number,
  py: number,
  vx: number,
  vy: number,
  out: ForceOut,
): void {
  out.fx = 0;
  out.fy = 0;
  gravityForce(body, world, out);
  electricForce(body, world, out);
  linearDragForce(body, vx, vy, out);
  quadraticDragForce(body, vx, vy, out);
  if (world.springs.length > 0) {
    springForces(world, bodyIndex, px, py, vx, vy, out);
  }
}

// ────────────────────────────────────────────────────────────
// 마찰 법칙
// ────────────────────────────────────────────────────────────

/**
 * 쿨롱 마찰.
 *
 * 정지마찰은 "고정된 크기의 힘"이 아니라 **필요한 만큼 생기되 상한이 있는** 힘입니다.
 * (μsN 은 최댓값이지 항상 그 값이 아님 — 학생이 가장 자주 틀리는 지점)
 * 그래서 아래 두 함수를 분리했습니다.
 */

/** 정지 상태를 유지할 수 있는가: |구동력| ≤ μs N */
export function staticFrictionHolds(
  drivingForce: number,
  normalForce: number,
  muS: number,
): boolean {
  return Math.abs(drivingForce) <= muS * Math.max(0, normalForce);
}

/**
 * 운동마찰력 (부호 포함). 항상 상대운동 반대 방향, 크기 μk N.
 * 속력과 무관하다는 점이 항력과의 결정적 차이입니다.
 */
export function kineticFriction(
  velocity: number,
  normalForce: number,
  muK: number,
): number {
  if (velocity === 0) return 0;
  return -Math.sign(velocity) * muK * Math.max(0, normalForce);
}
