/**
 * 해석해 대조 검증.
 *
 * 이 파일이 통과하지 못하면 그 엔진은 교육용으로 쓸 수 없습니다.
 * 틀린 시뮬레이션은 오개념을 강화하므로 없느니만 못하기 때문입니다.
 * 각 테스트는 "실측값 / 이론값 / 상대오차 / 허용치"를 표로 출력합니다.
 */

import { afterAll, describe, expect, it } from 'vitest';

import { createBody, type World } from '../src/engine/types.ts';
import {
  makeInclineTrack,
  makeLoopTrack,
  makePendulumTrack,
} from '../src/engine/constraints.ts';
import {
  computeEnergy,
  createWorld,
  findBody,
  step,
  stepN,
  totalMomentum,
} from '../src/engine/world.ts';
import { hashWorld, TrajectoryHasher } from '../src/engine/recorder.ts';

const G = 9.81;
const DT = 1 / 960;

// ────────────────────────────────────────────────────────────
// 결과 표
// ────────────────────────────────────────────────────────────

interface Row {
  no: string;
  name: string;
  measured: string;
  expected: string;
  error: string;
  tolerance: string;
}
const rows: Row[] = [];

function record(
  no: string,
  name: string,
  measured: number | string,
  expected: number | string,
  relError: number,
  tolerance: number,
  unit = '',
): void {
  const fmt = (v: number | string): string =>
    typeof v === 'number' ? `${v.toPrecision(8)}${unit}` : v;
  rows.push({
    no,
    name,
    measured: fmt(measured),
    expected: fmt(expected),
    error: relError < 1e-12 ? '<1e-12' : relError.toExponential(3),
    tolerance: tolerance.toExponential(3),
  });
}

afterAll(() => {
  const pad = (s: string, n: number): string =>
    s + ' '.repeat(Math.max(0, n - s.length));
  const w = [4, 30, 20, 20, 12, 12];
  const head = ['#', '검증 항목', '실측', '이론', '상대오차', '허용치'];
  const line = '─'.repeat(w.reduce((a, b) => a + b + 2, 0));
  const out: string[] = [];
  out.push('');
  out.push(line);
  out.push(head.map((h, i) => pad(h, w[i]!)).join('  '));
  out.push(line);
  for (const r of rows) {
    out.push(
      [r.no, r.name, r.measured, r.expected, r.error, r.tolerance]
        .map((c, i) => pad(c, w[i]!))
        .join('  '),
    );
  }
  out.push(line);
  console.log(out.join('\n'));
});

// ────────────────────────────────────────────────────────────
// ① 마찰 없는 단진자 120초 에너지 드리프트
// ────────────────────────────────────────────────────────────

describe('① 단진자 에너지 보존', () => {
  it('120초 적분 후 총 역학적 에너지 드리프트 < 0.1%', () => {
    const L = 1.2;
    const theta0 = 0.6; // 34.4°
    const mass = 0.5;

    // 피벗을 y = L 에 두어 최하점이 y = 0 이 되게 합니다.
    // 그래야 총 역학적 에너지가 mgL(1−cosθ₀) 로 양수가 되고
    // "상대 드리프트"의 분모가 물리적으로 의미 있는 값이 됩니다.
    const track = makePendulumTrack({ x: 0, y: L }, L);
    const bob = createBody({
      id: 0,
      tag: 'bob',
      kind: 'track',
      mass,
      radius: 0.05,
      trackIndex: 0,
      s: L * theta0,
      u: 0,
    });

    const world = createWorld({
      dt: DT,
      tracks: [track],
      bodies: [bob],
      fields: { gravity: { x: 0, y: -G } },
      integrator: 'velocityVerlet',
    });

    const e0 = computeEnergy(world).total;
    const analytic = mass * G * L * (1 - Math.cos(theta0));

    let maxDrift = 0;
    const total = Math.round(120 / DT);
    for (let i = 0; i < total; i++) {
      step(world);
      if (i % 960 === 0) {
        const e = computeEnergy(world).total;
        maxDrift = Math.max(maxDrift, Math.abs(e - e0) / analytic);
      }
    }
    const eEnd = computeEnergy(world).total;
    const drift = Math.abs(eEnd - e0) / analytic;

    record('①', '진자 120초 에너지 드리프트', eEnd, e0, Math.max(drift, maxDrift), 1e-3, ' J');
    expect(Math.abs(e0 - analytic) / analytic).toBeLessThan(1e-12);
    expect(maxDrift).toBeLessThan(1e-3);
  });
});

// ────────────────────────────────────────────────────────────
// ② 소진폭 단진자 주기
// ────────────────────────────────────────────────────────────

describe('② 단진자 주기', () => {
  it('소진폭 주기 vs 2π√(L/g) 오차 < 0.2%', () => {
    const L = 1.0;
    const theta0 = (5 * Math.PI) / 180;

    const track = makePendulumTrack({ x: 0, y: L }, L);
    const bob = createBody({
      id: 0,
      tag: 'bob',
      kind: 'track',
      mass: 0.25,
      radius: 0.03,
      trackIndex: 0,
      s: L * theta0,
      u: 0,
    });
    const world = createWorld({
      dt: DT,
      tracks: [track],
      bodies: [bob],
      fields: { gravity: { x: 0, y: -G } },
      integrator: 'velocityVerlet',
    });

    // 추의 x 좌표가 0 을 지나는 시각을 선형보간으로 찾습니다.
    // 반주기마다 한 번씩 지나므로 crossings 개수 N 에 대해 T = 2Δt/N.
    const body = findBody(world, 'bob')!;
    const crossings: number[] = [];
    let prevX = body.p.x;
    let prevT = world.time;
    const target = 20; // 10주기
    const maxSteps = Math.round(60 / DT);

    for (let i = 0; i < maxSteps && crossings.length <= target; i++) {
      step(world);
      const x = body.p.x;
      if (prevX > 0 !== x > 0 && prevX !== x) {
        const frac = prevX / (prevX - x);
        crossings.push(prevT + frac * DT);
      }
      prevX = x;
      prevT = world.time;
    }

    expect(crossings.length).toBeGreaterThan(target);
    const first = crossings[0]!;
    const last = crossings[target]!;
    const period = (2 * (last - first)) / target;

    const ideal = 2 * Math.PI * Math.sqrt(L / G);
    const err = Math.abs(period - ideal) / ideal;
    record('②', '단진자 주기 (θ₀=5°)', period, ideal, err, 2e-3, ' s');
    expect(err).toBeLessThan(2e-3);
  });
});

// ────────────────────────────────────────────────────────────
// ③ 포물선 사거리
// ────────────────────────────────────────────────────────────

describe('③ 포물선 운동', () => {
  it('사거리 vs v²sin(2θ)/g 오차 < 0.1%', () => {
    const v0 = 22;
    const theta = (37 * Math.PI) / 180;

    const ball = createBody({
      id: 0,
      tag: 'ball',
      mass: 0.145,
      radius: 0.037,
      p: { x: 0, y: 0 },
      v: { x: v0 * Math.cos(theta), y: v0 * Math.sin(theta) },
    });
    const world = createWorld({
      dt: DT,
      bodies: [ball],
      fields: { gravity: { x: 0, y: -G } },
      integrator: 'velocityVerlet',
    });

    const b = world.bodies[0]!;
    let prevY = b.p.y;
    let prevX = b.p.x;
    let range = NaN;
    const maxSteps = Math.round(20 / DT);
    for (let i = 0; i < maxSteps; i++) {
      step(world);
      if (prevY >= 0 && b.p.y < 0) {
        const frac = prevY / (prevY - b.p.y);
        range = prevX + (b.p.x - prevX) * frac;
        break;
      }
      prevY = b.p.y;
      prevX = b.p.x;
    }

    const ideal = (v0 * v0 * Math.sin(2 * theta)) / G;
    const err = Math.abs(range - ideal) / ideal;
    record('③', '포물선 사거리', range, ideal, err, 1e-3, ' m');
    expect(err).toBeLessThan(1e-3);
  });
});

// ────────────────────────────────────────────────────────────
// ④ 탄성 충돌 보존량
// ────────────────────────────────────────────────────────────

describe('④ 탄성 충돌', () => {
  it('e=1 에서 운동량·운동에너지 상대오차 < 1e-9', () => {
    const a = createBody({
      id: 0, tag: 'a', mass: 2, radius: 0.2, restitution: 1,
      p: { x: -1, y: 0 }, v: { x: 3, y: 0 },
    });
    const b = createBody({
      id: 1, tag: 'b', mass: 5, radius: 0.3, restitution: 1,
      p: { x: 1, y: 0 }, v: { x: -1, y: 0 },
    });
    const world = createWorld({
      dt: DT,
      bodies: [a, b],
      fields: { gravity: { x: 0, y: 0 } },
      integrator: 'velocityVerlet',
    });

    const p0 = { x: 0, y: 0 };
    totalMomentum(world, p0);
    const ke0 = computeEnergy(world).kinetic;

    stepN(world, Math.round(3 / DT));

    const p1 = { x: 0, y: 0 };
    totalMomentum(world, p1);
    const ke1 = computeEnergy(world).kinetic;

    // 충돌이 실제로 일어났는지 확인 (안 일어났으면 보존은 자명해서 의미 없음)
    expect(world.bodies[0]!.v.x).toBeLessThan(0);

    const pErr = Math.abs(p1.x - p0.x) / Math.abs(p0.x);
    const keErr = Math.abs(ke1 - ke0) / ke0;

    // 해석해 (1차원 탄성충돌 공식)
    const m1 = 2, m2 = 5, u1 = 3, u2 = -1;
    const v1 = ((m1 - m2) * u1 + 2 * m2 * u2) / (m1 + m2);
    const v2 = ((m2 - m1) * u2 + 2 * m1 * u1) / (m1 + m2);
    const v1Err = Math.abs(world.bodies[0]!.v.x - v1) / Math.abs(v1);
    const v2Err = Math.abs(world.bodies[1]!.v.x - v2) / Math.abs(v2);

    record('④', '탄성충돌 운동량 보존', p1.x, p0.x, pErr, 1e-9, ' kg·m/s');
    record('④', '탄성충돌 운동에너지 보존', ke1, ke0, keErr, 1e-9, ' J');
    record('④', '충돌 후 속도 v₁', world.bodies[0]!.v.x, v1, v1Err, 1e-9, ' m/s');
    record('④', '충돌 후 속도 v₂', world.bodies[1]!.v.x, v2, v2Err, 1e-9, ' m/s');

    expect(pErr).toBeLessThan(1e-9);
    expect(keErr).toBeLessThan(1e-9);
    expect(v1Err).toBeLessThan(1e-9);
    expect(v2Err).toBeLessThan(1e-9);
  });
});

// ────────────────────────────────────────────────────────────
// ⑤ 경사면 미끄러짐 임계각
// ────────────────────────────────────────────────────────────

describe('⑤ 경사면 임계각', () => {
  it('임계각 vs arctan(μs) 오차 < 0.01°', () => {
    const muS = 0.6;
    const muK = 0.45;

    function slides(angleDeg: number): boolean {
      const angle = (angleDeg * Math.PI) / 180;
      const track = makeInclineTrack({ x: 0, y: 40 }, angle, 60, muS, muK);
      const block = createBody({
        id: 0, tag: 'block', kind: 'track', mass: 2,
        radius: 0.1, trackIndex: 0, s: 0, u: 0,
      });
      const world = createWorld({
        dt: DT, tracks: [track], bodies: [block],
        fields: { gravity: { x: 0, y: -G } },
        integrator: 'semiImplicitPC',
      });
      stepN(world, Math.round(1.5 / DT));
      return Math.abs(world.bodies[0]!.s) > 1e-4;
    }

    let lo = 1;
    let hi = 80;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (slides(mid)) hi = mid;
      else lo = mid;
    }
    const critical = (lo + hi) / 2;
    const ideal = (Math.atan(muS) * 180) / Math.PI;
    const errDeg = Math.abs(critical - ideal);

    record('⑤', '경사면 임계각', critical, ideal, errDeg / ideal, 0.01 / ideal, '°');
    expect(errDeg).toBeLessThan(0.01);
  });
});

// ────────────────────────────────────────────────────────────
// ⑥ 2차 항력 종단속도
// ────────────────────────────────────────────────────────────

describe('⑥ 종단속도', () => {
  it('2차 항력 종단속도 vs √(mg/c) 오차 < 0.2%', () => {
    const mass = 1;
    const c = 0.5;

    const ball = createBody({
      id: 0, tag: 'ball', mass, radius: 0.05,
      dragQuad: c, p: { x: 0, y: 0 }, v: { x: 0, y: 0 },
    });
    const world = createWorld({
      dt: DT, bodies: [ball],
      fields: { gravity: { x: 0, y: -G } },
      integrator: 'semiImplicitPC',
    });

    stepN(world, Math.round(25 / DT));
    const speed = Math.abs(world.bodies[0]!.v.y);
    const ideal = Math.sqrt((mass * G) / c);
    const err = Math.abs(speed - ideal) / ideal;

    record('⑥', '2차 항력 종단속도', speed, ideal, err, 2e-3, ' m/s');
    expect(err).toBeLessThan(2e-3);
  });
});

// ────────────────────────────────────────────────────────────
// ⑦ 루프 통과 최소 높이
// ────────────────────────────────────────────────────────────

describe('⑦ 루프 최소 높이', () => {
  it('최소 높이 vs 2.5R 오차 < 0.5%', () => {
    const R = 1.0;
    const entry = 4;
    const exit = 4;
    const loopEnd = entry + 2 * Math.PI * R;

    /** 높이 h 에서 출발한 속력으로 루프를 완주하는가 */
    function completes(h: number): boolean {
      const track = makeLoopTrack(entry, R, exit);
      const car = createBody({
        id: 0, tag: 'car', kind: 'track', mass: 1.5,
        radius: 0.05, trackIndex: 0, s: 0,
        u: Math.sqrt(2 * G * h),
      });
      const world = createWorld({
        dt: DT, tracks: [track], bodies: [car],
        fields: { gravity: { x: 0, y: -G } },
        integrator: 'velocityVerlet',
      });
      const maxSteps = Math.round(20 / DT);
      for (let i = 0; i < maxSteps; i++) {
        step(world);
        const b = world.bodies[0]!;
        if (b.trackIndex < 0) return false; // 트랙에서 떨어짐
        if (b.s >= loopEnd) return true; // 루프를 다 돌고 퇴출 구간 진입
        if (b.u <= 0 && b.s > entry) return false; // 루프 안에서 되돌아감
      }
      return false;
    }

    let lo = 2.0 * R;
    let hi = 3.5 * R;
    for (let i = 0; i < 50; i++) {
      const mid = (lo + hi) / 2;
      if (completes(mid)) hi = mid;
      else lo = mid;
    }
    const hMin = (lo + hi) / 2;
    const ideal = 2.5 * R;
    const err = Math.abs(hMin - ideal) / ideal;

    record('⑦', '루프 통과 최소 높이', hMin, ideal, err, 5e-3, ' m');
    expect(err).toBeLessThan(5e-3);
  });
});

// ────────────────────────────────────────────────────────────
// ⑧ 자기장 속 원운동
// ────────────────────────────────────────────────────────────

describe('⑧ 자기장 속 원운동', () => {
  it('반지름 vs mv/qB, 100주기 후 반지름 변화 < 0.1%', () => {
    const mass = 1;
    const charge = 1;
    const B = 1;
    const speed = 2;

    const p = createBody({
      id: 0, tag: 'p', mass, charge, radius: 0.02,
      p: { x: 0, y: 0 }, v: { x: speed, y: 0 },
    });
    const world = createWorld({
      dt: DT, bodies: [p],
      fields: { gravity: { x: 0, y: 0 }, magneticZ: B },
      integrator: 'boris',
    });

    const omega = (Math.abs(charge) * B) / mass;
    const period = (2 * Math.PI) / omega;
    const stepsPerPeriod = Math.round(period / DT);

    function measureRadius(): number {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (let i = 0; i < stepsPerPeriod; i++) {
        step(world);
        const b = world.bodies[0]!;
        if (b.p.x < minX) minX = b.p.x;
        if (b.p.x > maxX) maxX = b.p.x;
        if (b.p.y < minY) minY = b.p.y;
        if (b.p.y > maxY) maxY = b.p.y;
      }
      return ((maxX - minX) / 2 + (maxY - minY) / 2) / 2;
    }

    const rEarly = measureRadius();
    stepN(world, stepsPerPeriod * 98);
    const rLate = measureRadius();

    const ideal = (mass * speed) / (Math.abs(charge) * B);
    const errEarly = Math.abs(rEarly - ideal) / ideal;
    const growth = Math.abs(rLate - rEarly) / rEarly;

    // 속력 보존도 함께 확인 (로렌츠력은 일을 하지 않음)
    const finalSpeed = Math.hypot(world.bodies[0]!.v.x, world.bodies[0]!.v.y);
    const speedErr = Math.abs(finalSpeed - speed) / speed;

    record('⑧', '자이로반지름 r = mv/qB', rEarly, ideal, errEarly, 1e-3, ' m');
    record('⑧', '100주기 후 반지름 변화', rLate, rEarly, growth, 1e-3, ' m');
    record('⑧', '100주기 후 속력 보존', finalSpeed, speed, speedErr, 1e-12, ' m/s');

    expect(errEarly).toBeLessThan(1e-3);
    expect(growth).toBeLessThan(1e-3);
    expect(speedErr).toBeLessThan(1e-12);
  });
});

// ────────────────────────────────────────────────────────────
// ⑨ 결정론
// ────────────────────────────────────────────────────────────

function buildMixedWorld(seed: number, nudge = 0): World {
  const track = makeInclineTrack({ x: -6, y: 5 }, Math.PI / 6, 12, 0.3, 0.2);
  return createWorld({
    dt: DT,
    seed,
    tracks: [track],
    bodies: [
      createBody({
        id: 0, tag: 'ball', mass: 1, radius: 0.2, restitution: 0.8,
        p: { x: -2 + nudge, y: 3 }, v: { x: 4, y: 1 },
      }),
      createBody({
        id: 1, tag: 'ball2', mass: 3, radius: 0.35, restitution: 0.8,
        p: { x: 2, y: 2.4 }, v: { x: -2, y: 0 },
      }),
      createBody({
        id: 2, tag: 'slider', kind: 'track', mass: 2, radius: 0.15,
        trackIndex: 0, s: 0.5, u: 0,
      }),
    ],
    walls: [
      { tag: 'floor', a: { x: -10, y: 0 }, b: { x: 10, y: 0 }, restitution: 0.7, friction: 0.2 },
      { tag: 'left', a: { x: -10, y: 6 }, b: { x: -10, y: 0 }, restitution: 0.9, friction: 0 },
      { tag: 'right', a: { x: 10, y: 0 }, b: { x: 10, y: 6 }, restitution: 0.9, friction: 0 },
    ],
    fields: { gravity: { x: 0, y: -G } },
    integrator: 'semiImplicitPC',
  });
}

function runHash(seed: number, nudge = 0): string {
  const w = buildMixedWorld(seed, nudge);
  const h = new TrajectoryHasher();
  for (let i = 0; i < 8000; i++) {
    step(w);
    if (i % 16 === 0) h.update(w);
  }
  return h.digest();
}

describe('⑨ 결정론', () => {
  it('동일 시드 → 궤적 해시 완전 일치', () => {
    const a = runHash(12345);
    const b = runHash(12345);
    record('⑨', '동일 시드 궤적 해시', a, b, a === b ? 0 : 1, 0);
    expect(a).toBe(b);
  });

  it('초기 조건이 1e-9 만 달라도 해시가 달라짐 (해시 민감도 확인)', () => {
    const a = runHash(12345);
    const c = runHash(12345, 1e-9);
    expect(a).not.toBe(c);
  });

  it('되감기 후 재개해도 원래 궤적과 비트 단위로 동일', () => {
    const ref = buildMixedWorld(777);
    const hashes: string[] = [];
    for (let i = 0; i < 3000; i++) {
      step(ref);
      hashes.push(hashWorld(ref));
    }

    // 1500 스텝 지점 상태를 그대로 재현해 이어서 돌립니다.
    const replay = buildMixedWorld(777);
    stepN(replay, 1500);
    expect(hashWorld(replay)).toBe(hashes[1499]);
    for (let i = 1500; i < 3000; i++) {
      step(replay);
      expect(hashWorld(replay)).toBe(hashes[i]);
    }
  });
});

// ────────────────────────────────────────────────────────────
// ⑩ 터널링 방지
// ────────────────────────────────────────────────────────────

describe('⑩ 터널링', () => {
  it('500 m/s 물체가 벽을 통과하지 못함', () => {
    const speed = 500;
    const radius = 0.05;

    const bullet = createBody({
      id: 0, tag: 'bullet', mass: 0.01, radius, restitution: 1,
      p: { x: -1, y: 0 }, v: { x: speed, y: 0 },
    });
    const world = createWorld({
      dt: DT, bodies: [bullet],
      walls: [
        { tag: 'wall', a: { x: 0, y: -1 }, b: { x: 0, y: 1 }, restitution: 1, friction: 0 },
      ],
      fields: { gravity: { x: 0, y: 0 } },
      integrator: 'velocityVerlet',
    });

    const steps = Math.round(1 / DT);
    let maxX = -Infinity;
    let bounced = false;
    for (let i = 0; i < steps; i++) {
      step(world);
      const b = world.bodies[0]!;
      if (b.p.x > maxX) maxX = b.p.x;
      if (b.v.x < 0) bounced = true;
    }

    // substep 경계에서 본 최대 x. 한 스텝에 0.52 m 를 가므로 이 값만으로는
    // "얼마나 깊이 들어갔나"를 잴 수 없습니다(샘플 간격이 침투 깊이보다 큼).
    // 대신 총 이동거리에서 **반사 지점을 역산**해 정확한 접촉 위치를 구합니다.
    //   경로길이 = |X_r − x₀| + |X_r − x_f| = v·T   →   X_r = (v·T + x₀ + x_f)/2
    const xFinal = world.bodies[0]!.p.x;
    const elapsed = world.time;
    const reflectX = (speed * elapsed + -1 + xFinal) / 2;
    const penetration = reflectX + radius; // 0 이면 정확히 벽면에서 반사

    expect(maxX).toBeLessThanOrEqual(-radius);
    record('⑩', '터널링 (반사 지점 침투)', penetration, 0, Math.abs(penetration), 1e-6, ' m');

    expect(bounced).toBe(true);
    expect(Math.abs(penetration)).toBeLessThanOrEqual(1e-6);
    // 탄성 반사이므로 속력이 유지되어야 합니다.
    expect(Math.abs(Math.abs(world.bodies[0]!.v.x) - speed) / speed).toBeLessThan(1e-12);
  });

  it('아주 빠른 물체도 여러 번 반사됨 (좁은 상자)', () => {
    const world = createWorld({
      dt: DT,
      bodies: [
        createBody({
          id: 0, tag: 'fast', mass: 0.01, radius: 0.02, restitution: 1,
          p: { x: 0, y: 0 }, v: { x: 500, y: 0 },
        }),
      ],
      walls: [
        { tag: 'r', a: { x: 0.5, y: -1 }, b: { x: 0.5, y: 1 }, restitution: 1, friction: 0 },
        { tag: 'l', a: { x: -0.5, y: 1 }, b: { x: -0.5, y: -1 }, restitution: 1, friction: 0 },
      ],
      fields: { gravity: { x: 0, y: 0 } },
      integrator: 'velocityVerlet',
    });

    for (let i = 0; i < Math.round(0.5 / DT); i++) {
      step(world);
      const b = world.bodies[0]!;
      expect(Math.abs(b.p.x)).toBeLessThanOrEqual(0.5 - 0.02 + 1e-6);
    }
  });
});
