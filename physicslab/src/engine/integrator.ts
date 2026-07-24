/**
 * 적분기.
 *
 * ■ 적분기 선택 규칙 (스테이지별 근거는 각 스테이지 파일 주석과 docs/PHYSICS.md 에도 기록)
 *
 *  1) 보존력만 작용  →  velocityVerlet
 *     심플렉틱 적분기라 에너지가 진동할 뿐 **한 방향으로 표류하지 않습니다**.
 *     롤러코스터·진자처럼 "에너지가 보존된다"를 눈으로 확인시키는 스테이지에서
 *     오일러를 쓰면 에너지가 스멀스멀 늘어나 학습 내용을 정면으로 배신합니다.
 *
 *  2) 속도 의존 힘(항력·마찰) 존재  →  semiImplicitPC
 *     베를레는 a(p) 를 전제로 하므로 a(p,v) 에서는 2차 정확도가 깨집니다.
 *     반음적 오일러로 예측하고 사다리꼴로 2회 보정하면
 *     종단속도 같은 정상상태를 정확한 값으로 수렴시킵니다(검증 ⑥).
 *
 *  3) 자기장 속 하전입자  →  boris
 *     로렌츠력은 속도에 수직이라 일을 하지 않아 속력이 보존되어야 하는데,
 *     오일러 계열은 매 스텝 속력을 키워 반지름이 계속 커집니다.
 *     Boris pusher 는 자기력을 "회전"으로 처리해 |v| 를 기계정밀도로 보존하고,
 *     이산 궤도의 자이로반지름이 정확히 mv/qB 가 됩니다(검증 ⑧).
 *
 *  4) rk4 — 위 세 가지를 검증할 때 쓰는 참조 적분기. 4차 정확도지만
 *     심플렉틱이 아니라 장시간 에너지가 서서히 줄어듭니다. 기본값으로 쓰지 않습니다.
 */

import { createForceOut, totalForce, type ForceOut } from './forces.ts';
import type { Body, IntegratorKind, World } from './types.ts';

// ── 스크래치 (모듈 전역 재사용 = 스텝당 힙 할당 0회) ──────────────
const f0: ForceOut = createForceOut();
const f1: ForceOut = createForceOut();
const f2: ForceOut = createForceOut();
const f3: ForceOut = createForceOut();

/**
 * 힘 계산에 쓰이는 세계 상태가 어떤 적분기를 요구하는지 판정합니다.
 * 스테이지가 명시적으로 지정하지 않았을 때의 자동 선택 규칙입니다.
 */
export function autoIntegrator(world: World): IntegratorKind {
  if (world.fields.magneticZ !== 0) {
    for (const b of world.bodies) {
      if (b.charge !== 0) return 'boris';
    }
  }
  for (const b of world.bodies) {
    if (b.dragLinear !== 0 || b.dragQuad !== 0) return 'semiImplicitPC';
  }
  for (const sp of world.springs) {
    if (sp.damping !== 0) return 'semiImplicitPC';
  }
  return 'velocityVerlet';
}

function accel(
  world: World,
  index: number,
  body: Body,
  px: number,
  py: number,
  vx: number,
  vy: number,
  out: ForceOut,
): void {
  totalForce(world, index, body, px, py, vx, vy, out);
  const im = body.invMass;
  out.fx *= im;
  out.fy *= im;
}

// ────────────────────────────────────────────────────────────
// 속도 베를레 (Velocity Verlet)
// ────────────────────────────────────────────────────────────

/**
 *   p(t+h) = p + v h + ½ a h²
 *   a(t+h) = A(p(t+h))
 *   v(t+h) = v + ½ (a + a(t+h)) h
 *
 * a 가 위치만의 함수라는 가정 위에서 2차 정확·시간가역·심플렉틱.
 */
export function stepVerlet(world: World, index: number, body: Body, h: number): void {
  const ax = body.a.x;
  const ay = body.a.y;

  const px = body.p.x + body.v.x * h + 0.5 * ax * h * h;
  const py = body.p.y + body.v.y * h + 0.5 * ay * h * h;

  accel(world, index, body, px, py, body.v.x, body.v.y, f1);

  body.v.x += 0.5 * (ax + f1.fx) * h;
  body.v.y += 0.5 * (ay + f1.fy) * h;
  body.p.x = px;
  body.p.y = py;
  body.a.x = f1.fx;
  body.a.y = f1.fy;
}

// ────────────────────────────────────────────────────────────
// 반음적 오일러 + 2회 예측-보정
// ────────────────────────────────────────────────────────────

const PC_ITERATIONS = 2;

/**
 * 예측:  v* = v + a(p,v) h        (반음적 = 새 속도로 위치를 밀어줌)
 *        p* = p + v* h
 * 보정:  v⁺ = v + ½(a(p,v) + a(p*,v*)) h
 *        p⁺ = p + ½(v + v⁺) h
 * 위 보정을 2회 반복합니다. 항력처럼 a 가 v 에 강하게 의존하는 계에서
 * 고정점 반복이 빠르게 수렴하여, 정상상태(종단속도)를 정확히 재현합니다.
 */
export function stepSemiImplicitPC(
  world: World,
  index: number,
  body: Body,
  h: number,
): void {
  const px0 = body.p.x;
  const py0 = body.p.y;
  const vx0 = body.v.x;
  const vy0 = body.v.y;

  accel(world, index, body, px0, py0, vx0, vy0, f0);

  // 예측 (반음적 오일러)
  let vx = vx0 + f0.fx * h;
  let vy = vy0 + f0.fy * h;
  let px = px0 + vx * h;
  let py = py0 + vy * h;

  for (let it = 0; it < PC_ITERATIONS; it++) {
    accel(world, index, body, px, py, vx, vy, f1);
    vx = vx0 + 0.5 * (f0.fx + f1.fx) * h;
    vy = vy0 + 0.5 * (f0.fy + f1.fy) * h;
    px = px0 + 0.5 * (vx0 + vx) * h;
    py = py0 + 0.5 * (vy0 + vy) * h;
  }

  accel(world, index, body, px, py, vx, vy, f2);

  body.p.x = px;
  body.p.y = py;
  body.v.x = vx;
  body.v.y = vy;
  body.a.x = f2.fx;
  body.a.y = f2.fy;
}

// ────────────────────────────────────────────────────────────
// RK4 (참조 적분기)
// ────────────────────────────────────────────────────────────

export function stepRK4(world: World, index: number, body: Body, h: number): void {
  const px = body.p.x;
  const py = body.p.y;
  const vx = body.v.x;
  const vy = body.v.y;

  // k1
  accel(world, index, body, px, py, vx, vy, f0);
  const k1vx = f0.fx;
  const k1vy = f0.fy;
  const k1px = vx;
  const k1py = vy;

  // k2
  const h2 = h * 0.5;
  accel(
    world, index, body,
    px + k1px * h2, py + k1py * h2,
    vx + k1vx * h2, vy + k1vy * h2,
    f1,
  );
  const k2vx = f1.fx;
  const k2vy = f1.fy;
  const k2px = vx + k1vx * h2;
  const k2py = vy + k1vy * h2;

  // k3
  accel(
    world, index, body,
    px + k2px * h2, py + k2py * h2,
    vx + k2vx * h2, vy + k2vy * h2,
    f2,
  );
  const k3vx = f2.fx;
  const k3vy = f2.fy;
  const k3px = vx + k2vx * h2;
  const k3py = vy + k2vy * h2;

  // k4
  accel(
    world, index, body,
    px + k3px * h, py + k3py * h,
    vx + k3vx * h, vy + k3vy * h,
    f3,
  );
  const k4vx = f3.fx;
  const k4vy = f3.fy;
  const k4px = vx + k3vx * h;
  const k4py = vy + k3vy * h;

  const s = h / 6;
  body.p.x = px + s * (k1px + 2 * k2px + 2 * k3px + k4px);
  body.p.y = py + s * (k1py + 2 * k2py + 2 * k3py + k4py);
  body.v.x = vx + s * (k1vx + 2 * k2vx + 2 * k3vx + k4vx);
  body.v.y = vy + s * (k1vy + 2 * k2vy + 2 * k3vy + k4vy);

  accel(world, index, body, body.p.x, body.p.y, body.v.x, body.v.y, f0);
  body.a.x = f0.fx;
  body.a.y = f0.fy;
}

// ────────────────────────────────────────────────────────────
// Boris pusher
// ────────────────────────────────────────────────────────────

/**
 * Boris 방식 (2차원, B = (0,0,Bz)):
 *
 *   v⁻ = v + (F_비자기/m)(h/2)          … 전기·중력 반 스텝
 *   t  = (qBz/m)(h/2)                    … 회전 파라미터 (스칼라)
 *   v' = v⁻ + v⁻ × t
 *   v⁺ = v⁻ + v' × s,   s = 2t/(1+t²)   … 여기까지가 정확한 "회전"
 *   v  = v⁺ + (F_비자기/m)(h/2)
 *   p += v h
 *
 * 회전 단계는 직교행렬이므로 |v⁻| = |v⁺| 가 **기계정밀도로** 성립합니다.
 * 순수 자기장에서 이산 궤도의 반지름은
 *   r = (v·h/2)/tan(θ/2),  θ = 2·arctan(ωh/2)
 * 인데 tan(θ/2) = ωh/2 이므로 r = v/ω = mv/(qB) — **오차 0**.
 * 남는 오차는 회전 주기뿐이며 (ωh)²/12 차수입니다.
 * 이것이 자기장 스테이지에서 다른 적분기를 쓰지 않는 이유입니다.
 *
 * 주의: leapfrog 계열이라 속도는 반 스텝 어긋난 시각의 값입니다.
 * h = 1/960 s 에서 표시·측정상 차이는 무시할 수준이며,
 * 속력과 반지름 같은 보존량에는 영향이 없습니다.
 */
export function stepBoris(world: World, index: number, body: Body, h: number): void {
  const im = body.invMass;
  const half = h * 0.5;

  totalForce(world, index, body, body.p.x, body.p.y, body.v.x, body.v.y, f0);

  let vx = body.v.x + f0.fx * im * half;
  let vy = body.v.y + f0.fy * im * half;

  const tz = body.charge * world.fields.magneticZ * im * half;
  const vpx = vx + vy * tz;
  const vpy = vy - vx * tz;
  const sz = (2 * tz) / (1 + tz * tz);
  vx = vx + vpy * sz;
  vy = vy - vpx * sz;

  totalForce(world, index, body, body.p.x, body.p.y, vx, vy, f1);
  vx += f1.fx * im * half;
  vy += f1.fy * im * half;

  body.v.x = vx;
  body.v.y = vy;
  body.p.x += vx * h;
  body.p.y += vy * h;

  // 표시용 가속도 (자기력 포함 — 학생에게 보여줄 실제 알짜힘)
  totalForce(world, index, body, body.p.x, body.p.y, vx, vy, f2);
  const qb = body.charge * world.fields.magneticZ;
  body.a.x = (f2.fx + vy * qb) * im;
  body.a.y = (f2.fy - vx * qb) * im;
}

// ────────────────────────────────────────────────────────────
// 디스패치
// ────────────────────────────────────────────────────────────

export function stepFreeBody(
  world: World,
  index: number,
  body: Body,
  h: number,
  kind: IntegratorKind,
): void {
  switch (kind) {
    case 'velocityVerlet':
      stepVerlet(world, index, body, h);
      return;
    case 'semiImplicitPC':
      stepSemiImplicitPC(world, index, body, h);
      return;
    case 'rk4':
      stepRK4(world, index, body, h);
      return;
    case 'boris':
      stepBoris(world, index, body, h);
      return;
  }
}

/** 자유 물체의 초기 가속도를 채웁니다 (베를레는 첫 스텝에 a 가 필요). */
export function primeAcceleration(world: World, index: number, body: Body): void {
  accel(world, index, body, body.p.x, body.p.y, body.v.x, body.v.y, f0);
  body.a.x = f0.fx;
  body.a.y = f0.fy;
}
