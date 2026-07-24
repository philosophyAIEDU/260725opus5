/**
 * 스테이지 레지스트리.
 *
 * ★ 새 스테이지를 추가하는 방법은 딱 두 줄입니다 ★
 *   1. src/content/stages/ 에 파일 하나 추가 (기존 파일 복사해서 고치면 됩니다)
 *   2. 아래 import 한 줄 + STAGES 배열에 이름 한 번 추가
 * 자세한 설명은 docs/ADDING_STAGES.md 를 보세요.
 */

import { Simulation, type DriverStage } from '../engine/driver.ts';
import { EVENT_STRIDE, FRAME_HEADER } from '../engine/frame.ts';
import {
  defaultParams,
  validateStage,
  type Params,
  type StageSpec,
  type Trace,
  type TraceEvent,
} from './schema.ts';

import { freefallStage } from './stages/01-freefall.ts';
import { projectileStage } from './stages/02-projectile.ts';
import { newtonSecondStage } from './stages/03-newton-second.ts';
import { collisionStage } from './stages/04-collision.ts';
import { coasterStage } from './stages/05-coaster.ts';
import { waveStage } from './stages/06-wave.ts';
import { efieldStage } from './stages/07-efield.ts';

/** ← 여기에 새 스테이지를 추가하세요. 배열 순서가 화면 순서입니다. */
export const STAGES: StageSpec[] = [
  freefallStage,
  projectileStage,
  newtonSecondStage,
  collisionStage,
  coasterStage,
  waveStage,
  efieldStage,
];

export const STAGE_IDS: string[] = STAGES.map((s) => s.id);

export function getStage(id: string): StageSpec | undefined {
  return STAGES.find((s) => s.id === id);
}

export function getStageIndex(id: string): number {
  return STAGES.findIndex((s) => s.id === id);
}

export function stageDefaults(stage: StageSpec): Params {
  return defaultParams(stage.controls);
}

/**
 * StageSpec → 드라이버가 쓰는 최소 인터페이스.
 * 파라미터와 시드를 여기서 고정(클로저로 캡처)하기 때문에
 * 드라이버는 스테이지 DSL 을 전혀 몰라도 됩니다.
 */
export function toDriverStage(
  stage: StageSpec,
  params: Params,
  seed: number,
): DriverStage {
  return {
    id: stage.id,
    duration: stage.duration,
    bodyTags: stage.bodyTags,
    channelCount: stage.measure.channels.length,
    build: () => stage.build(params, seed),
    measure: stage.measure.compute,
  };
}

/**
 * 스테이지를 끝까지 헤드리스로 돌려 Trace 를 얻습니다.
 *
 * 화면 없이 물리와 미션 판정을 전부 확인할 수 있는 경로입니다.
 * 자동 테스트(tests/missions.test.ts)와, 교사가 새 스테이지를 만든 뒤
 * "이 미션이 정말 달성 가능한가"를 확인하는 데 씁니다.
 */
export function runStage(
  stage: StageSpec,
  params: Params = stageDefaults(stage),
  seed = 0,
): Trace {
  const sim = new Simulation(toDriverStage(stage, params, seed));
  sim.play();
  let guard = 0;
  const maxFrames = Math.ceil(stage.duration * 60) + 10;
  while (!sim.finished && guard++ < maxFrames) sim.tick();
  return traceFromSimulation(sim, stage, params);
}

/** Simulation 이 쌓아둔 평면 버퍼를 스테이지 DSL 의 Trace 로 감쌉니다. */
export function traceFromSimulation(
  sim: Simulation,
  stage: StageSpec,
  params: Params,
): Trace {
  const stride = sim.layout.size;
  const frameCount = sim.traceFrames;
  const data = sim.trace.subarray(0, frameCount * stride);

  // 프레임마다 기록된 사건 슬롯을 평평한 목록으로 풀어냅니다.
  const events: TraceEvent[] = [];
  for (let f = 0; f < frameCount; f++) {
    const base = f * stride;
    const count = data[base + 4] ?? 0;
    for (let i = 0; i < count; i++) {
      const o = base + sim.layout.eventOffset + i * EVENT_STRIDE;
      events.push({
        frame: f,
        time: data[base] ?? 0,
        type: data[o] ?? 0,
        a: data[o + 1] ?? 0,
        b: data[o + 2] ?? 0,
        magnitude: data[o + 3] ?? 0,
      });
    }
  }

  return {
    data,
    stride,
    frameCount,
    bodyCount: stage.bodyTags.length,
    dtFrame: 1 / 60,
    bodyTags: stage.bodyTags,
    channels: stage.measure.channels.map((c) => c.id),
    events,
    params,
  };
}

/** Trace 의 스칼라 채널이 시작되는 오프셋 (진단용). */
export function traceScalarOffset(trace: Trace): number {
  return FRAME_HEADER + trace.bodyCount * 12;
}

/** 개발 모드 자기 점검. 스테이지 정의 실수를 콘솔에 바로 알려줍니다. */
export function validateAllStages(): { id: string; errors: string[] }[] {
  const bad: { id: string; errors: string[] }[] = [];
  const seen = new Set<string>();
  for (const s of STAGES) {
    const errors = validateStage(s);
    if (seen.has(s.id)) errors.push(`스테이지 id 중복: ${s.id}`);
    seen.add(s.id);
    if (errors.length > 0) bad.push({ id: s.id, errors });
  }
  return bad;
}
