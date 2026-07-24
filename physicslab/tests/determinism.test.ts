/**
 * 결정론 검증.
 *
 * 이 앱의 되감기 / 리플레이 / 자동 테스트 / 교사 시연 재현은 전부
 * "같은 시드 + 같은 입력 → 항상 비트 단위로 같은 궤적" 위에 서 있습니다.
 * 여기가 깨지면 학생이 "아까랑 다르게 나왔는데요?" 라고 말하는 순간
 * 시뮬레이션의 교육적 권위가 사라집니다.
 */

import { describe, expect, it } from 'vitest';

import { createBody } from '../src/engine/types.ts';
import { makeLoopTrack, makePendulumTrack } from '../src/engine/constraints.ts';
import { createWorld, step, stepN } from '../src/engine/world.ts';
import {
  createRecorder,
  hashWorld,
  recordFrame,
  restoreNearestKeyframe,
  TrajectoryHasher,
} from '../src/engine/recorder.ts';
import { createRng, hashSeed, nextFloat, nextGaussian } from '../src/engine/rng.ts';

const DT = 1 / 960;
const G = 9.81;

function buildScene(seed: number) {
  return createWorld({
    dt: DT,
    seed,
    tracks: [makePendulumTrack({ x: -4, y: 5 }, 1.5), makeLoopTrack(3, 0.8, 3)],
    bodies: [
      createBody({
        id: 0, tag: 'ball', mass: 1.2, radius: 0.22, restitution: 0.75,
        p: { x: 0, y: 4 }, v: { x: 3.3, y: 0.7 },
      }),
      createBody({
        id: 1, tag: 'ball2', mass: 2.7, radius: 0.31, restitution: 0.6,
        p: { x: 3, y: 2.1 }, v: { x: -1.7, y: 2.2 },
      }),
      createBody({
        id: 2, tag: 'bob', kind: 'track', mass: 0.8, radius: 0.1,
        trackIndex: 0, s: 1.5 * 0.9, u: 0,
      }),
      createBody({
        id: 3, tag: 'car', kind: 'track', mass: 1.5, radius: 0.09,
        trackIndex: 1, s: 0, u: 6.4,
      }),
    ],
    walls: [
      { tag: 'floor', a: { x: -12, y: 0 }, b: { x: 12, y: 0 }, restitution: 0.65, friction: 0.25 },
      { tag: 'left', a: { x: -12, y: 8 }, b: { x: -12, y: 0 }, restitution: 0.9, friction: 0 },
      { tag: 'right', a: { x: 12, y: 0 }, b: { x: 12, y: 8 }, restitution: 0.9, friction: 0 },
    ],
    fields: { gravity: { x: 0, y: -G } },
    integrator: 'semiImplicitPC',
  });
}

describe('시드 난수', () => {
  it('같은 시드는 같은 수열을 낸다', () => {
    const a = createRng(0xdeadbeef);
    const b = createRng(0xdeadbeef);
    for (let i = 0; i < 10_000; i++) {
      expect(nextFloat(a)).toBe(nextFloat(b));
    }
  });

  it('다른 시드는 다른 수열을 낸다', () => {
    const a = createRng(1);
    const b = createRng(2);
    let same = 0;
    for (let i = 0; i < 1000; i++) {
      if (nextFloat(a) === nextFloat(b)) same++;
    }
    expect(same).toBe(0);
  });

  it('출력이 [0,1) 범위를 벗어나지 않는다', () => {
    const r = createRng(42);
    for (let i = 0; i < 100_000; i++) {
      const v = nextFloat(r);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('가우시안도 시드에 대해 결정론적이다', () => {
    const a = createRng(7);
    const b = createRng(7);
    for (let i = 0; i < 1000; i++) {
      expect(nextGaussian(a)).toBe(nextGaussian(b));
    }
  });

  it('문자열 시드 해시가 안정적이다', () => {
    expect(hashSeed('freefall|mass=2.0')).toBe(hashSeed('freefall|mass=2.0'));
    expect(hashSeed('freefall|mass=2.0')).not.toBe(hashSeed('freefall|mass=2.1'));
  });
});

describe('궤적 결정론', () => {
  it('동일 시드로 두 번 실행 → 궤적 해시 완전 일치', () => {
    function run(): string {
      const w = buildScene(2024);
      const h = new TrajectoryHasher();
      for (let i = 0; i < 12_000; i++) {
        step(w);
        h.update(w);
      }
      return h.digest();
    }
    const a = run();
    const b = run();
    expect(a).toBe(b);
  });

  /**
   * ★ 프레임 드랍 독립성 ★
   * 물리는 항상 dt = 1/960 substep 으로만 진행합니다.
   * 한 화면 프레임에 substep 을 몇 개 묶어 돌리든 (16개든, 1개든, 뒤죽박죽이든)
   * substep 의 **순서와 개수**만 같으면 결과는 완전히 같아야 합니다.
   * 이게 성립해야 느린 크롬북에서 프레임이 튀어도 궤적이 달라지지 않습니다.
   */
  it('substep 묶는 방식이 달라도 궤적이 동일하다', () => {
    const steady = buildScene(99);
    stepN(steady, 9600); // 16개씩 600프레임과 같은 총량

    const jittery = buildScene(99);
    const pattern = [16, 3, 31, 1, 7, 22, 16, 16, 9, 40];
    let done = 0;
    let pi = 0;
    while (done < 9600) {
      const n = Math.min(pattern[pi % pattern.length]!, 9600 - done);
      stepN(jittery, n);
      done += n;
      pi++;
    }

    expect(hashWorld(jittery)).toBe(hashWorld(steady));
    expect(jittery.steps).toBe(steady.steps);
  });

  it('시각(time)이 정수 스텝 수에서 재계산되어 누적오차가 없다', () => {
    const w = buildScene(5);
    stepN(w, 96_000);
    expect(w.steps).toBe(96_000);
    expect(w.time).toBe(96_000 * DT);
    expect(w.time).toBeCloseTo(100, 12);
  });
});

describe('되감기 / 리플레이', () => {
  it('키프레임 복원 후 재개하면 원래 궤적과 비트 단위로 같다', () => {
    const bodyCount = 4;
    const rec = createRecorder({
      capacity: 600,
      bodyCount,
      scalarCount: 3,
      keyframeInterval: 60,
      keyframeCapacity: 11,
    });

    const SUBSTEPS_PER_FRAME = 16;
    const FRAMES = 400;

    // 기준 실행: 매 프레임 기록하면서 프레임별 해시를 남깁니다.
    const ref = buildScene(31337);
    const refHashes: string[] = [];
    const scalars = new Float64Array(3);
    for (let f = 0; f < FRAMES; f++) {
      recordFrame(rec, ref, scalars);
      refHashes.push(hashWorld(ref));
      stepN(ref, SUBSTEPS_PER_FRAME);
    }

    // 임의 시점으로 되감았다가 이어서 돌립니다.
    for (const target of [120, 255, 301, 399]) {
      const world = buildScene(31337);
      const restored = restoreNearestKeyframe(rec, world, target);
      expect(restored).toBeGreaterThanOrEqual(0);
      expect(restored).toBeLessThanOrEqual(target);

      // 키프레임 → 목표 프레임까지 다시 밟기
      stepN(world, (target - restored) * SUBSTEPS_PER_FRAME);
      expect(hashWorld(world)).toBe(refHashes[target]);

      // 되감은 지점에서 이어서 돌려도 궤적이 갈라지지 않아야 합니다.
      for (let f = target + 1; f < Math.min(target + 40, FRAMES); f++) {
        stepN(world, SUBSTEPS_PER_FRAME);
        expect(hashWorld(world)).toBe(refHashes[f]);
      }
    }
  });

  it('링버퍼는 용량을 넘겨도 최근 구간을 정확히 유지한다', () => {
    const rec = createRecorder({
      capacity: 600,
      bodyCount: 1,
      scalarCount: 0,
      keyframeInterval: 60,
      keyframeCapacity: 11,
    });
    const w = createWorld({
      dt: DT,
      bodies: [createBody({ id: 0, tag: 'b', p: { x: 0, y: 100 } })],
      fields: { gravity: { x: 0, y: -G } },
    });

    const expectedY: number[] = [];
    for (let f = 0; f < 1000; f++) {
      recordFrame(rec, w, null);
      expectedY.push(w.bodies[0]!.p.y);
      stepN(w, 16);
    }

    // 최근 600 프레임만 남아 있어야 합니다.
    expect(rec.written).toBe(1000);
    for (let f = 400; f < 1000; f++) {
      const o = (f % 600) * rec.stride;
      // Float32 로 저장하므로 f32 반올림 오차 범위 안에서 일치
      expect(rec.ring[o + 4 + 1]!).toBeCloseTo(expectedY[f]!, 3);
    }
  });

  it('링버퍼와 키프레임 기록에 매 프레임 힙 할당이 없다', () => {
    const rec = createRecorder({
      capacity: 600, bodyCount: 2, scalarCount: 4,
      keyframeInterval: 60, keyframeCapacity: 11,
    });
    const w = buildScene(11);
    const scalars = new Float64Array(4);

    const ringRef = rec.ring;
    const exactRef = rec.exact;
    for (let f = 0; f < 900; f++) {
      recordFrame(rec, w, scalars);
      stepN(w, 16);
    }
    // 같은 버퍼 객체를 계속 재사용했는지 (재할당했으면 참조가 달라짐)
    expect(rec.ring).toBe(ringRef);
    expect(rec.exact).toBe(exactRef);
  });
});
