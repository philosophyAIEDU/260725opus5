/**
 * 미션 판정 검증.
 *
 * 두 방향으로 확인합니다.
 *   1) **가짜 궤적** — 손으로 만든 Trace 를 넣어, 판정 함수가 순수 함수로서
 *      정확히 조건대로 동작하는지 봅니다. 물리를 돌리지 않으므로
 *      "판정 로직 자체"의 버그만 골라낼 수 있습니다.
 *   2) **실제 실행** — 스테이지를 헤드리스로 끝까지 돌려서,
 *      각 미션이 **정말 달성 가능한지**(그리고 아무 조건에서나 통과하지는 않는지)
 *      확인합니다. 달성 불가능한 미션은 학생에게 가장 나쁜 종류의 버그입니다.
 */

import { describe, expect, it } from 'vitest';

import {
  BODY_STRIDE,
  BF_ACTIVE,
  BF_RESTING,
  EVENT_CAP,
  EVENT_STRIDE,
  FRAME_HEADER,
  computeLayout,
  interpolateFrame,
  B_X,
  B_Y,
} from '../src/engine/frame.ts';
import {
  STAGES,
  getStage,
  runStage,
  stageDefaults,
  validateAllStages,
} from '../src/content/index.ts';
import {
  evaluatePrediction,
  resolveView,
  traceBody,
  traceScalar,
  traceTime,
  type Params,
  type StageSpec,
  type Trace,
} from '../src/content/schema.ts';

// ────────────────────────────────────────────────────────────
// 가짜 궤적 만들기
// ────────────────────────────────────────────────────────────

interface FakeBody {
  x?: number[];
  y?: number[];
  vx?: number[];
  vy?: number[];
  ax?: number[];
  ay?: number[];
  s?: number[];
  u?: number[];
  flags?: number[];
}

/**
 * 프레임 단위로 값을 직접 지정해 Trace 를 만듭니다.
 * 미션 check 는 이 구조만 보므로, 물리 엔진 없이도 판정을 검증할 수 있습니다.
 */
function makeTrace(opts: {
  frames: number;
  bodyTags: string[];
  channels: string[];
  params?: Params;
  scalars?: Record<string, number[]>;
  bodies?: FakeBody[];
  dtFrame?: number;
}): Trace {
  const dtFrame = opts.dtFrame ?? 1 / 60;
  const layout = computeLayout(opts.bodyTags.length, opts.channels.length);
  const data = new Float32Array(opts.frames * layout.size);

  for (let f = 0; f < opts.frames; f++) {
    const base = f * layout.size;
    data[base] = f * dtFrame;
    data[base + 1] = f * 16;
    data[base + 2] = f;

    for (let b = 0; b < opts.bodyTags.length; b++) {
      const src = opts.bodies?.[b];
      const o = base + FRAME_HEADER + b * BODY_STRIDE;
      data[o + 0] = src?.x?.[f] ?? 0;
      data[o + 1] = src?.y?.[f] ?? 0;
      data[o + 2] = src?.vx?.[f] ?? 0;
      data[o + 3] = src?.vy?.[f] ?? 0;
      data[o + 4] = src?.ax?.[f] ?? 0;
      data[o + 5] = src?.ay?.[f] ?? 0;
      data[o + 6] = src?.s?.[f] ?? 0;
      data[o + 7] = src?.u?.[f] ?? 0;
      data[o + 9] = src?.flags?.[f] ?? BF_ACTIVE;
    }

    opts.channels.forEach((id, ci) => {
      data[base + layout.scalarOffset + ci] = opts.scalars?.[id]?.[f] ?? 0;
    });
  }

  return {
    data,
    stride: layout.size,
    frameCount: opts.frames,
    bodyCount: opts.bodyTags.length,
    dtFrame,
    bodyTags: opts.bodyTags,
    channels: opts.channels,
    events: [],
    params: opts.params ?? {},
  };
}

function missionOf(stage: StageSpec, id: string) {
  const m = stage.missions.find((x) => x.id === id);
  if (!m) throw new Error(`미션을 찾을 수 없음: ${stage.id}/${id}`);
  return m;
}

function withParams(stage: StageSpec, overrides: Params): Params {
  return { ...stageDefaults(stage), ...overrides };
}

// ────────────────────────────────────────────────────────────
// 가짜 궤적으로 판정 로직 검증
// ────────────────────────────────────────────────────────────

describe('미션 판정 — 가짜 궤적', () => {
  const freefall = getStage('freefall')!;
  const CHANNELS = freefall.measure.channels.map((c) => c.id);

  it('진공 무승부: 두 공이 같은 프레임에 멈추면 통과', () => {
    const frames = 120;
    const landed = (at: number) =>
      Array.from({ length: frames }, (_, f) => (f >= at ? BF_ACTIVE | BF_RESTING : BF_ACTIVE));
    const trace = makeTrace({
      frames,
      bodyTags: freefall.bodyTags,
      channels: CHANNELS,
      bodies: [{ flags: landed(60) }, { flags: landed(60) }, {}, {}],
    });
    expect(missionOf(freefall, 'vacuum-tie').check(trace, {})).toBe(true);
  });

  it('진공 무승부: 착지 시각이 0.02초를 넘게 벌어지면 실패', () => {
    const frames = 120;
    const landed = (at: number) =>
      Array.from({ length: frames }, (_, f) => (f >= at ? BF_ACTIVE | BF_RESTING : BF_ACTIVE));
    const trace = makeTrace({
      frames,
      bodyTags: freefall.bodyTags,
      channels: CHANNELS,
      // 60프레임과 64프레임 = 약 0.067초 차이
      bodies: [{ flags: landed(64) }, { flags: landed(60) }, {}, {}],
    });
    expect(missionOf(freefall, 'vacuum-tie').check(trace, {})).toBe(false);
  });

  it('진공 무승부: 한쪽이 끝까지 안 멈추면 실패', () => {
    const frames = 60;
    const trace = makeTrace({
      frames,
      bodyTags: freefall.bodyTags,
      channels: CHANNELS,
      bodies: [{ flags: Array(frames).fill(BF_ACTIVE) }, {}, {}, {}],
    });
    expect(missionOf(freefall, 'vacuum-tie').check(trace, {})).toBe(false);
  });

  it('종단속도: 가속도가 g의 10% 아래인 프레임이 하나라도 있으면 통과', () => {
    const frames = 60;
    const base = {
      frames,
      bodyTags: freefall.bodyTags,
      channels: CHANNELS,
    };
    const falling = { y: Array(frames).fill(10), vy: Array(frames).fill(-9) };

    const pass = makeTrace({
      ...base,
      bodies: [{}, {}, { ...falling, ay: Array(frames).fill(-0.5) }, {}],
    });
    const fail = makeTrace({
      ...base,
      bodies: [{}, {}, { ...falling, ay: Array(frames).fill(-9.81) }, {}],
    });
    expect(missionOf(freefall, 'terminal-speed').check(pass, {})).toBe(true);
    expect(missionOf(freefall, 'terminal-speed').check(fail, {})).toBe(false);
  });

  it('종단속도: 이미 땅에 닿은 뒤(높이 ≤ 1 m)의 가속도 0은 인정하지 않는다', () => {
    const frames = 60;
    const trace = makeTrace({
      frames,
      bodyTags: freefall.bodyTags,
      channels: CHANNELS,
      bodies: [
        {}, {},
        { y: Array(frames).fill(0.15), vy: Array(frames).fill(0), ay: Array(frames).fill(0) },
        {},
      ],
    });
    expect(missionOf(freefall, 'terminal-speed').check(trace, {})).toBe(false);
  });

  it('포물선 명중: 착지 지점이 과녁에서 0.6 m 이내여야 통과', () => {
    const projectile = getStage('projectile')!;
    const chans = projectile.measure.channels.map((c) => c.id);
    const frames = 100;
    const build = (landX: number) =>
      makeTrace({
        frames,
        bodyTags: projectile.bodyTags,
        channels: chans,
        bodies: [
          {
            x: Array.from({ length: frames }, (_, f) => (f < 80 ? f * 0.4 : landX)),
            flags: Array.from({ length: frames }, (_, f) =>
              f >= 80 ? BF_ACTIVE | BF_RESTING : BF_ACTIVE,
            ),
          },
        ],
      });
    const p = withParams(projectile, { target: 35 });
    expect(missionOf(projectile, 'hit').check(build(35.4), p)).toBe(true);
    expect(missionOf(projectile, 'hit').check(build(36.2), p)).toBe(false);
  });

  it('포물선 발사각 미션은 각도 조건까지 함께 본다', () => {
    const projectile = getStage('projectile')!;
    const chans = projectile.measure.channels.map((c) => c.id);
    const frames = 90;
    const trace = makeTrace({
      frames,
      bodyTags: projectile.bodyTags,
      channels: chans,
      bodies: [
        {
          x: Array(frames).fill(35),
          flags: Array.from({ length: frames }, (_, f) =>
            f >= 50 ? BF_ACTIVE | BF_RESTING : BF_ACTIVE,
          ),
        },
      ],
    });
    const low = missionOf(projectile, 'low-angle');
    const high = missionOf(projectile, 'high-angle');
    expect(low.check(trace, withParams(projectile, { target: 35, angle: 30 }))).toBe(true);
    expect(low.check(trace, withParams(projectile, { target: 35, angle: 50 }))).toBe(false);
    expect(high.check(trace, withParams(projectile, { target: 35, angle: 60 }))).toBe(true);
    expect(high.check(trace, withParams(projectile, { target: 35, angle: 50 }))).toBe(false);
  });

  it('정지마찰 미션: 1초(61프레임) 이상 붙잡혀야 통과', () => {
    const newton = getStage('newton-second')!;
    const chans = newton.measure.channels.map((c) => c.id);
    const build = (stuckFrames: number) =>
      makeTrace({
        frames: 200,
        bodyTags: newton.bodyTags,
        channels: chans,
        scalars: {
          sticking: Array.from({ length: 200 }, (_, f) => (f < stuckFrames ? 1 : 0)),
          Fpush: Array(200).fill(10),
        },
      });
    const m = missionOf(newton, 'stuck');
    expect(m.check(build(61), {})).toBe(true);
    expect(m.check(build(40), {})).toBe(false);
  });

  it('정지마찰 미션: 미는 힘이 0이면 붙잡혀 있어도 통과가 아니다', () => {
    const newton = getStage('newton-second')!;
    const chans = newton.measure.channels.map((c) => c.id);
    const trace = makeTrace({
      frames: 200,
      bodyTags: newton.bodyTags,
      channels: chans,
      scalars: { sticking: Array(200).fill(1), Fpush: Array(200).fill(0) },
    });
    expect(missionOf(newton, 'stuck').check(trace, {})).toBe(false);
  });

  it('에너지 보존 미션: 총 에너지가 1% 넘게 흔들리면 실패', () => {
    const coaster = getStage('coaster')!;
    const chans = coaster.measure.channels.map((c) => c.id);
    const frames = 120;
    const build = (drift: number) =>
      makeTrace({
        frames,
        bodyTags: coaster.bodyTags,
        channels: chans,
        scalars: {
          total: Array.from({ length: frames }, (_, f) => 1000 * (1 + (drift * f) / frames)),
          ke: Array(frames).fill(600),
        },
      });
    const m = missionOf(coaster, 'energy-constant');
    const params = withParams(coaster, { friction: 0 });
    expect(m.check(build(0.002), params)).toBe(true);
    expect(m.check(build(0.05), params)).toBe(false);
  });

  it('미션 check 는 순수 함수다 (같은 입력 → 항상 같은 결과)', () => {
    for (const stage of STAGES) {
      const chans = stage.measure.channels.map((c) => c.id);
      const trace = makeTrace({
        frames: 40,
        bodyTags: stage.bodyTags,
        channels: chans,
      });
      const params = stageDefaults(stage);
      for (const mission of stage.missions) {
        const first = mission.check(trace, params);
        for (let i = 0; i < 5; i++) {
          expect(mission.check(trace, params)).toBe(first);
        }
      }
    }
  });

  it('빈 궤적을 넣어도 미션이 터지지 않는다', () => {
    for (const stage of STAGES) {
      const trace = makeTrace({
        frames: 0,
        bodyTags: stage.bodyTags,
        channels: stage.measure.channels.map((c) => c.id),
      });
      for (const mission of stage.missions) {
        expect(() => mission.check(trace, stageDefaults(stage))).not.toThrow();
      }
    }
  });
});

// ────────────────────────────────────────────────────────────
// 스테이지 정의 자기 점검
// ────────────────────────────────────────────────────────────

describe('스테이지 정의', () => {
  it('모든 스테이지가 정의 검사를 통과한다', () => {
    const bad = validateAllStages();
    expect(bad, JSON.stringify(bad, null, 2)).toEqual([]);
  });

  it('스테이지마다 미션 3개 = 별 3개', () => {
    for (const s of STAGES) expect(s.missions.length, s.id).toBe(3);
  });

  it('예측 정답이 유한한 값이고 입력 범위 안에 있다', () => {
    for (const s of STAGES) {
      const params = stageDefaults(s);
      const pred = s.prediction;
      if (pred.kind === 'numeric') {
        const truth = pred.truth(params);
        expect(Number.isFinite(truth), s.id).toBe(true);
        expect(truth, s.id).toBeGreaterThanOrEqual(pred.min);
        expect(truth, s.id).toBeLessThanOrEqual(pred.max);
      } else if (pred.kind === 'choice') {
        const truth = pred.truth(params);
        expect(truth, s.id).toBeGreaterThanOrEqual(0);
        expect(truth, s.id).toBeLessThan(pred.choices.length);
      }
    }
  });

  it('예측 채점: 5% 이내면 정답, 넘으면 오답', () => {
    for (const s of STAGES) {
      const params = stageDefaults(s);
      const pred = s.prediction;
      if (pred.kind !== 'numeric') continue;
      const truth = pred.truth(params);
      const scale = Math.abs(truth) > 1e-12 ? Math.abs(truth) : 1;
      expect(evaluatePrediction(pred, params, truth).correct, s.id).toBe(true);
      expect(
        evaluatePrediction(pred, params, truth + scale * pred.tolerance * 0.5).correct,
        s.id,
      ).toBe(true);
      expect(
        evaluatePrediction(pred, params, truth + scale * pred.tolerance * 3).correct,
        s.id,
      ).toBe(false);
    }
  });

  it('진단 문항은 4지선다이고 정답이 정확히 하나다', () => {
    for (const s of STAGES) {
      expect(s.probe.choices.length, s.id).toBe(4);
      expect(s.probe.choices.filter((c) => c.correct).length, s.id).toBe(1);
      for (const c of s.probe.choices) {
        // 오답에도 반드시 되감아 확인시킬 피드백이 있어야 합니다.
        expect(c.feedback.length, `${s.id}: ${c.text}`).toBeGreaterThan(10);
      }
    }
  });

  it('모든 슬라이더에 SI 단위가 붙어 있거나 무차원임이 명시돼 있다', () => {
    for (const s of STAGES) {
      for (const c of s.controls) {
        if (c.kind !== 'slider') continue;
        expect(typeof c.unit, `${s.id}/${c.id}`).toBe('string');
        expect(c.default >= c.min && c.default <= c.max, `${s.id}/${c.id}`).toBe(true);
      }
    }
  });

  it('그래프가 존재하지 않는 채널을 참조하지 않는다', () => {
    for (const s of STAGES) {
      const ids = new Set(s.measure.channels.map((c) => c.id));
      for (const chart of s.charts) {
        for (const series of chart.series) {
          expect(ids.has(series.channel), `${s.id}/${chart.id}/${series.channel}`).toBe(true);
        }
      }
    }
  });

  it('자유물체도가 선언된 스테이지는 채널이 실제로 존재한다', () => {
    for (const s of STAGES) {
      if (!s.fbd) continue;
      const ids = new Set(s.measure.channels.map((c) => c.id));
      for (const a of s.fbd.arrows) {
        expect(ids.has(a.xChannel), `${s.id}/${a.label}.x`).toBe(true);
        expect(ids.has(a.yChannel), `${s.id}/${a.label}.y`).toBe(true);
      }
    }
  });

  it('카메라 영역이 파라미터를 바꿔도 항상 유효하다', () => {
    for (const s of STAGES) {
      for (const c of s.controls) {
        if (c.kind !== 'slider') continue;
        for (const v of [c.min, c.default, c.max]) {
          const view = resolveView(s, { ...stageDefaults(s), [c.id]: v });
          expect(view.xMin < view.xMax, `${s.id}/${c.id}=${v}`).toBe(true);
          expect(view.yMin < view.yMax, `${s.id}/${c.id}=${v}`).toBe(true);
        }
      }
    }
  });
});

// ────────────────────────────────────────────────────────────
// 실제 실행 — 미션이 정말 달성 가능한가
// ────────────────────────────────────────────────────────────

describe('스테이지 실행', () => {
  it('모든 스테이지가 끝까지 돌고 유한한 값만 남긴다', () => {
    for (const stage of STAGES) {
      const trace = runStage(stage);
      expect(trace.frameCount, stage.id).toBeGreaterThan(30);
      expect(traceTime(trace, trace.frameCount - 1), stage.id).toBeGreaterThan(
        stage.duration * 0.5,
      );
      for (let f = 0; f < trace.frameCount; f += 17) {
        for (const ch of trace.channels) {
          expect(Number.isFinite(traceScalar(trace, f, ch)), `${stage.id}/${ch}@${f}`).toBe(true);
        }
        for (let b = 0; b < trace.bodyCount; b++) {
          expect(Number.isFinite(traceBody(trace, f, b, B_X)), stage.id).toBe(true);
          expect(Number.isFinite(traceBody(trace, f, b, B_Y)), stage.id).toBe(true);
        }
      }
    }
  });

  it('같은 파라미터로 두 번 실행하면 궤적이 완전히 같다', () => {
    for (const stage of STAGES) {
      const a = runStage(stage, stageDefaults(stage), 4242);
      const b = runStage(stage, stageDefaults(stage), 4242);
      expect(a.frameCount, stage.id).toBe(b.frameCount);
      expect(a.data.length, stage.id).toBe(b.data.length);
      for (let i = 0; i < a.data.length; i++) {
        if (a.data[i] !== b.data[i]) {
          throw new Error(`${stage.id}: 프레임 데이터 ${i} 불일치`);
        }
      }
    }
  });

  /**
   * 각 미션을 실제로 달성하는 파라미터 조합.
   * 달성 불가능한 미션은 학생 입장에서 가장 나쁜 버그이므로,
   * "이 조합이면 반드시 별을 준다"를 코드로 못박아 둡니다.
   */
  const solutions: { stage: string; mission: string; params: Params }[] = [
    { stage: 'freefall', mission: 'vacuum-tie', params: {} },
    { stage: 'freefall', mission: 'terminal-speed', params: {} },
    { stage: 'freefall', mission: 'air-tie', params: { radius: 0.03 } },

    { stage: 'projectile', mission: 'hit', params: { speed: 20, angle: 30, target: 35 } },
    { stage: 'projectile', mission: 'low-angle', params: { speed: 20, angle: 30, target: 35 } },
    { stage: 'projectile', mission: 'high-angle', params: { speed: 20, angle: 60, target: 35 } },

    {
      stage: 'newton-second',
      mission: 'no-friction-constant',
      params: { mu: 0, angle: 0, force: 20, mass: 2, pushTime: 2 },
    },
    { stage: 'newton-second', mission: 'accelerate', params: { force: 30, mass: 2, mu: 0.2 } },
    {
      stage: 'newton-second',
      mission: 'stuck',
      params: { force: 2, mass: 10, mu: 0.8, angle: 0, pushTime: 4 },
    },

    { stage: 'collision', mission: 'momentum-conserved', params: {} },
    { stage: 'collision', mission: 'perfectly-inelastic', params: { e: 0 } },
    { stage: 'collision', mission: 'energy-lost', params: { e: 0, m1: 1, m2: 4, u1: 3, u2: 0 } },

    { stage: 'coaster', mission: 'energy-constant', params: { friction: 0 } },
    {
      stage: 'coaster',
      mission: 'clear-loop',
      params: { loop: true, loopRadius: 3, startHeight: 18, friction: 0 },
    },
    { stage: 'coaster', mission: 'heat-30', params: { friction: 0.15 } },

    { stage: 'wave', mission: 'constructive', params: { mode: 'pulse' } },
    { stage: 'wave', mission: 'destructive', params: { mode: 'opposite' } },
    { stage: 'wave', mission: 'survive', params: { mode: 'opposite' } },

    {
      stage: 'efield',
      mission: 'match-gravity',
      params: { charge: 2, mass: 2, field: 9.8, speed: 5 },
    },
    { stage: 'efield', mission: 'double-accel', params: { charge: 2, mass: 2, field: 20 } },
    {
      stage: 'efield',
      mission: 'exit-plates',
      params: { charge: 2, mass: 2, field: 5, speed: 12 },
    },
  ];

  it('제시된 모든 미션에 실제로 달성 가능한 조합이 존재한다', () => {
    const failures: string[] = [];
    for (const sol of solutions) {
      const stage = getStage(sol.stage)!;
      const params = withParams(stage, sol.params);
      const trace = runStage(stage, params);
      const mission = missionOf(stage, sol.mission);
      if (!mission.check(trace, params)) {
        failures.push(`${sol.stage}/${sol.mission}`);
      }
    }
    expect(failures, `달성 불가능한 미션: ${failures.join(', ')}`).toEqual([]);
  });

  it('미션 목록과 해답 목록이 빠짐없이 대응한다', () => {
    for (const stage of STAGES) {
      for (const m of stage.missions) {
        const found = solutions.some((s) => s.stage === stage.id && s.mission === m.id);
        expect(found, `해답이 없는 미션: ${stage.id}/${m.id}`).toBe(true);
      }
    }
  });

  it('조건을 어긋나게 두면 해당 미션은 통과하지 않는다', () => {
    // 마찰을 켠 롤러코스터는 "에너지 보존" 미션을 통과하면 안 됩니다.
    const coaster = getStage('coaster')!;
    const withFriction = withParams(coaster, { friction: 0.1 });
    expect(
      missionOf(coaster, 'energy-constant').check(runStage(coaster, withFriction), withFriction),
    ).toBe(false);

    // 마찰이 없으면 "30% 태우기"를 통과하면 안 됩니다.
    const noFriction = withParams(coaster, { friction: 0 });
    expect(
      missionOf(coaster, 'heat-30').check(runStage(coaster, noFriction), noFriction),
    ).toBe(false);

    // 루프를 끄면 "루프 통과"를 통과하면 안 됩니다.
    const noLoop = withParams(coaster, { loop: false });
    expect(
      missionOf(coaster, 'clear-loop').check(runStage(coaster, noLoop), noLoop),
    ).toBe(false);

    // 루프 반지름이 출발 높이의 2.5분의 1보다 크면 통과할 수 없습니다 (h < 2.5R).
    const tooBig = withParams(coaster, {
      loop: true, loopRadius: 6, startHeight: 8, friction: 0,
    });
    expect(
      missionOf(coaster, 'clear-loop').check(runStage(coaster, tooBig), tooBig),
    ).toBe(false);
  });

  it('오개념 진단의 되감기 지점이 궤적 범위 안에 있다', () => {
    for (const stage of STAGES) {
      const trace = runStage(stage);
      const frame = stage.probe.rewindTo(trace);
      expect(Number.isInteger(frame), stage.id).toBe(true);
      expect(frame, stage.id).toBeGreaterThanOrEqual(0);
      expect(frame, stage.id).toBeLessThan(trace.frameCount);
    }
  });
});

// ────────────────────────────────────────────────────────────
// 프레임 버퍼 규약
// ────────────────────────────────────────────────────────────

describe('프레임 버퍼', () => {
  it('레이아웃 크기가 헤더 + 물체 + 채널 + 사건 슬롯의 합이다', () => {
    const layout = computeLayout(3, 5);
    expect(layout.scalarOffset).toBe(FRAME_HEADER + 3 * BODY_STRIDE);
    expect(layout.eventOffset).toBe(layout.scalarOffset + 5);
    expect(layout.size).toBe(layout.eventOffset + EVENT_CAP * EVENT_STRIDE);
  });

  it('보간은 연속량만 섞고 플래그는 최신 값을 그대로 쓴다', () => {
    const layout = computeLayout(1, 1);
    const prev = new Float32Array(layout.size);
    const next = new Float32Array(layout.size);

    prev[FRAME_HEADER + B_X] = 0;
    next[FRAME_HEADER + B_X] = 10;
    prev[FRAME_HEADER + 9] = BF_ACTIVE;
    next[FRAME_HEADER + 9] = BF_ACTIVE | BF_RESTING;
    prev[layout.scalarOffset] = 2;
    next[layout.scalarOffset] = 4;

    const out = new Float32Array(layout.size);
    interpolateFrame(prev, next, 0.25, layout, out);

    expect(out[FRAME_HEADER + B_X]).toBeCloseTo(2.5, 6);
    expect(out[layout.scalarOffset]).toBeCloseTo(2.5, 6);
    // 플래그는 보간하면 의미가 깨지므로 최신 프레임 값을 씁니다.
    expect(out[FRAME_HEADER + 9]).toBe(BF_ACTIVE | BF_RESTING);
  });

  it('보간 계수는 [0, 1] 밖으로 나가도 잘려서 안전하다', () => {
    const layout = computeLayout(1, 0);
    const prev = new Float32Array(layout.size);
    const next = new Float32Array(layout.size);
    prev[FRAME_HEADER + B_X] = 0;
    next[FRAME_HEADER + B_X] = 10;
    const out = new Float32Array(layout.size);

    interpolateFrame(prev, next, -5, layout, out);
    expect(out[FRAME_HEADER + B_X]).toBe(0);
    interpolateFrame(prev, next, 5, layout, out);
    expect(out[FRAME_HEADER + B_X]).toBe(10);
  });
});
