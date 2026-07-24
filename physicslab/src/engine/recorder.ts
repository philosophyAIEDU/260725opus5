/**
 * 기록기 — 되감기·스크럽·리플레이의 저장소.
 *
 * ■ 두 종류의 기록을 따로 둡니다. 이게 이 파일의 핵심 설계입니다.
 *
 *   1) **표시용 링버퍼 (Float32Array, 최근 600프레임 = 10초)**
 *      타임라인 드래그 중 매 프레임 읽히므로 작고 빨라야 합니다.
 *      Float32 로 충분합니다 — 화면 픽셀과 소수 둘째 자리 표시에는
 *      7자리 유효숫자면 남습니다.
 *
 *   2) **정확 키프레임 (Float64Array, 1초 간격)**
 *      되감은 지점부터 **다시 이어서 돌렸을 때 원래와 같은 궤적**이 나오려면
 *      Float32 로 반올림된 상태에서 재개하면 안 됩니다. 그 미세한 차이가
 *      충돌 시각을 바꾸고 궤적을 갈라놓습니다.
 *      그래서 되감기는 "가장 가까운 이전 키프레임으로 정확 복원 → 목표
 *      프레임까지 다시 substep 을 밟는다" 로 구현합니다.
 *      1초 재계산은 최신 기기에서 1 ms 미만입니다.
 *
 * ■ 매 프레임 객체 생성이 없습니다. 모든 버퍼는 생성 시 1회만 할당합니다.
 */

import { SNAPSHOT_HEADER } from './types.ts';
import type { World } from './types.ts';

/** 표시용 프레임 헤더 float 개수: [time, steps, eventCount, flags] */
export const DISPLAY_HEADER = 4;
/** 표시용 물체 1개당 float 개수 */
export const DISPLAY_BODY_STRIDE = 10;
/** 정확 스냅샷의 물체 1개당 float 개수 */
export const EXACT_BODY_STRIDE = 12;

export interface RecorderConfig {
  /** 표시용 링버퍼 프레임 수 */
  capacity: number;
  bodyCount: number;
  /** 스테이지가 정의한 파생 물리량 채널 수 */
  scalarCount: number;
  /** 정확 키프레임 간격 (프레임) */
  keyframeInterval: number;
  /** 정확 키프레임 개수 */
  keyframeCapacity: number;
}

export interface Recorder {
  config: RecorderConfig;
  /** 프레임 1개가 차지하는 float 개수 */
  stride: number;
  /** 표시용 링버퍼 */
  ring: Float32Array;
  /** 지금까지 기록된 총 프레임 수 (링을 넘어가도 계속 증가) */
  written: number;

  exactStride: number;
  exact: Float64Array;
  /** 각 키프레임 슬롯이 담고 있는 프레임 인덱스 (-1 = 비어있음) */
  exactFrame: Int32Array;
  exactWritten: number;
}

export function createRecorder(config: RecorderConfig): Recorder {
  const stride =
    DISPLAY_HEADER + config.bodyCount * DISPLAY_BODY_STRIDE + config.scalarCount;
  const exactStride =
    SNAPSHOT_HEADER + config.bodyCount * EXACT_BODY_STRIDE + config.scalarCount;
  return {
    config,
    stride,
    ring: new Float32Array(stride * config.capacity),
    written: 0,
    exactStride,
    exact: new Float64Array(exactStride * config.keyframeCapacity),
    exactFrame: new Int32Array(config.keyframeCapacity).fill(-1),
    exactWritten: 0,
  };
}

export function resetRecorder(rec: Recorder): void {
  rec.written = 0;
  rec.exactWritten = 0;
  rec.exactFrame.fill(-1);
  rec.ring.fill(0);
  rec.exact.fill(0);
}

/** 링에 아직 남아 있는 가장 오래된 프레임 인덱스. */
export function oldestFrame(rec: Recorder): number {
  return Math.max(0, rec.written - rec.config.capacity);
}

/** 가장 최근에 기록된 프레임 인덱스. 기록이 없으면 -1. */
export function newestFrame(rec: Recorder): number {
  return rec.written - 1;
}

export function hasFrame(rec: Recorder, frame: number): boolean {
  return frame >= oldestFrame(rec) && frame <= newestFrame(rec);
}

// ────────────────────────────────────────────────────────────
// 표시용 프레임
// ────────────────────────────────────────────────────────────

/**
 * 현재 월드 상태를 표시용 프레임 1장으로 기록합니다.
 * scalars 는 스테이지가 계산한 파생 물리량 (없으면 null).
 */
export function recordFrame(
  rec: Recorder,
  world: World,
  scalars: Float64Array | null,
): number {
  const frame = rec.written;
  const slot = frame % rec.config.capacity;
  const base = slot * rec.stride;
  const ring = rec.ring;

  ring[base] = world.time;
  ring[base + 1] = world.steps;
  ring[base + 2] = world.events.count;
  ring[base + 3] = 0;

  const n = rec.config.bodyCount;
  for (let i = 0; i < n; i++) {
    const b = world.bodies[i];
    const o = base + DISPLAY_HEADER + i * DISPLAY_BODY_STRIDE;
    if (!b) {
      for (let k = 0; k < DISPLAY_BODY_STRIDE; k++) ring[o + k] = 0;
      continue;
    }
    ring[o] = b.p.x;
    ring[o + 1] = b.p.y;
    ring[o + 2] = b.v.x;
    ring[o + 3] = b.v.y;
    ring[o + 4] = b.a.x;
    ring[o + 5] = b.a.y;
    ring[o + 6] = b.s;
    ring[o + 7] = b.u;
    ring[o + 8] = b.normalForce;
    ring[o + 9] =
      (b.active ? 1 : 0) |
      (b.trackIndex >= 0 ? 2 : 0) |
      (b.sticking ? 4 : 0) |
      (b.resting ? 8 : 0);
  }

  const so = base + DISPLAY_HEADER + n * DISPLAY_BODY_STRIDE;
  const sc = rec.config.scalarCount;
  for (let k = 0; k < sc; k++) {
    ring[so + k] = scalars ? (scalars[k] ?? 0) : 0;
  }

  rec.written++;

  if (frame % rec.config.keyframeInterval === 0) {
    writeKeyframe(rec, world, frame);
  }
  return frame;
}

/** 프레임 데이터의 링버퍼 내 시작 오프셋. 없으면 -1. */
export function frameOffset(rec: Recorder, frame: number): number {
  if (!hasFrame(rec, frame)) return -1;
  return (frame % rec.config.capacity) * rec.stride;
}

export function frameTime(rec: Recorder, frame: number): number {
  const o = frameOffset(rec, frame);
  return o < 0 ? 0 : rec.ring[o]!;
}

/** 물체 i 의 필드 f 를 읽습니다. f 는 0..DISPLAY_BODY_STRIDE-1. */
export function frameBodyField(
  rec: Recorder,
  frame: number,
  bodyIndex: number,
  field: number,
): number {
  const o = frameOffset(rec, frame);
  if (o < 0) return 0;
  return rec.ring[o + DISPLAY_HEADER + bodyIndex * DISPLAY_BODY_STRIDE + field]!;
}

export function frameScalar(rec: Recorder, frame: number, channel: number): number {
  const o = frameOffset(rec, frame);
  if (o < 0) return 0;
  return rec.ring[
    o + DISPLAY_HEADER + rec.config.bodyCount * DISPLAY_BODY_STRIDE + channel
  ]!;
}

// ────────────────────────────────────────────────────────────
// 정확 스냅샷
// ────────────────────────────────────────────────────────────

/** 월드를 Float64 버퍼에 직렬화합니다. offset 부터 exactStride 개를 씁니다. */
export function serializeWorld(
  world: World,
  out: Float64Array,
  offset: number,
  bodyCount: number,
  scalarCount: number,
): void {
  out[offset] = world.time;
  out[offset + 1] = world.steps;
  out[offset + 2] = world.rng.s;
  out[offset + 3] = world.thermal;
  out[offset + 4] = bodyCount;
  out[offset + 5] = scalarCount;
  out[offset + 6] = world.impulse;

  for (let i = 0; i < bodyCount; i++) {
    const b = world.bodies[i];
    const o = offset + SNAPSHOT_HEADER + i * EXACT_BODY_STRIDE;
    if (!b) continue;
    out[o] = b.p.x;
    out[o + 1] = b.p.y;
    out[o + 2] = b.v.x;
    out[o + 3] = b.v.y;
    out[o + 4] = b.a.x;
    out[o + 5] = b.a.y;
    out[o + 6] = b.s;
    out[o + 7] = b.u;
    out[o + 8] = b.trackIndex;
    out[o + 9] = b.active ? 1 : 0;
    out[o + 10] = (b.sticking ? 1 : 0) + (b.resting ? 2 : 0);
    out[o + 11] = b.normalForce;
  }

  const so = offset + SNAPSHOT_HEADER + bodyCount * EXACT_BODY_STRIDE;
  for (let k = 0; k < scalarCount; k++) {
    out[so + k] = world.userScalars[k] ?? 0;
  }
}

/** 직렬화된 상태를 월드에 되돌립니다. 비트 단위로 원래 상태와 동일해집니다. */
export function deserializeWorld(
  world: World,
  src: Float64Array,
  offset: number,
  bodyCount: number,
  scalarCount: number,
): void {
  world.time = src[offset]!;
  world.steps = src[offset + 1]!;
  world.rng.s = src[offset + 2]! >>> 0;
  world.thermal = src[offset + 3]!;
  world.impulse = src[offset + 6]!;

  for (let i = 0; i < bodyCount; i++) {
    const b = world.bodies[i];
    const o = offset + SNAPSHOT_HEADER + i * EXACT_BODY_STRIDE;
    if (!b) continue;
    b.p.x = src[o]!;
    b.p.y = src[o + 1]!;
    b.v.x = src[o + 2]!;
    b.v.y = src[o + 3]!;
    b.a.x = src[o + 4]!;
    b.a.y = src[o + 5]!;
    b.s = src[o + 6]!;
    b.u = src[o + 7]!;
    b.trackIndex = src[o + 8]!;
    b.kind = b.trackIndex >= 0 ? 'track' : 'free';
    b.active = src[o + 9]! !== 0;
    const flags = src[o + 10]!;
    b.sticking = (flags & 1) !== 0;
    b.resting = (flags & 2) !== 0;
    b.normalForce = src[o + 11]!;
  }

  const so = offset + SNAPSHOT_HEADER + bodyCount * EXACT_BODY_STRIDE;
  for (let k = 0; k < scalarCount; k++) {
    world.userScalars[k] = src[so + k]!;
  }
  world.events.count = 0;
}

function writeKeyframe(rec: Recorder, world: World, frame: number): void {
  const slot =
    Math.floor(frame / rec.config.keyframeInterval) % rec.config.keyframeCapacity;
  serializeWorld(
    world,
    rec.exact,
    slot * rec.exactStride,
    rec.config.bodyCount,
    rec.config.scalarCount,
  );
  rec.exactFrame[slot] = frame;
  rec.exactWritten++;
}

/**
 * frame 이후의 기록을 버립니다.
 *
 * 학생이 과거로 되감은 뒤 다시 재생하면, 그 지점부터가 새 기록이 됩니다.
 * (물리는 결정론적이라 궤적 자체는 같지만, 배속을 바꿨다면 프레임 경계가
 *  달라지므로 옛 기록을 남겨두면 프레임↔substep 대응이 어긋납니다.)
 */
export function truncateRecorder(rec: Recorder, frame: number): void {
  rec.written = Math.max(0, frame + 1);
  for (let slot = 0; slot < rec.config.keyframeCapacity; slot++) {
    if (rec.exactFrame[slot]! > frame) rec.exactFrame[slot] = -1;
  }
}

/**
 * targetFrame 이하의 가장 가까운 정확 키프레임으로 월드를 복원합니다.
 * 반환값 = 복원된 프레임 인덱스. 쓸 수 있는 키프레임이 없으면 -1.
 *
 * 호출자는 여기서부터 (targetFrame − 반환값) 프레임만큼 다시 돌리면
 * 원래 궤적과 **비트 단위로 동일한** 상태에 도달합니다.
 */
export function restoreNearestKeyframe(
  rec: Recorder,
  world: World,
  targetFrame: number,
): number {
  let bestFrame = -1;
  let bestSlot = -1;
  for (let slot = 0; slot < rec.config.keyframeCapacity; slot++) {
    const f = rec.exactFrame[slot]!;
    if (f < 0 || f > targetFrame) continue;
    if (f > bestFrame) {
      bestFrame = f;
      bestSlot = slot;
    }
  }
  if (bestSlot < 0) return -1;
  deserializeWorld(
    world,
    rec.exact,
    bestSlot * rec.exactStride,
    rec.config.bodyCount,
    rec.config.scalarCount,
  );
  return bestFrame;
}

// ────────────────────────────────────────────────────────────
// 결정론 해시
// ────────────────────────────────────────────────────────────

/**
 * 월드 상태의 FNV-1a 해시 (32비트, 16진 문자열).
 *
 * Float64 의 **비트 패턴**을 그대로 먹입니다. 값을 문자열로 바꿔서
 * 해시하면 반올림 때문에 미세한 차이를 놓칠 수 있기 때문입니다.
 * 검증 ⑨(동일 시드 → 동일 해시)가 이 함수를 씁니다.
 */
export function hashFloat64Array(data: Float64Array, length = data.length): string {
  const view = new Uint32Array(data.buffer, data.byteOffset, length * 2);
  let h = 0x811c9dc5;
  for (let i = 0; i < view.length; i++) {
    let w = view[i]!;
    for (let b = 0; b < 4; b++) {
      h ^= w & 0xff;
      h = Math.imul(h, 0x01000193);
      w >>>= 8;
    }
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

const hashScratch = new Map<number, Float64Array>();

/** 월드 한 장의 상태 해시. */
export function hashWorld(world: World): string {
  const bodyCount = world.bodies.length;
  const scalarCount = world.userScalars.length;
  const size = SNAPSHOT_HEADER + bodyCount * EXACT_BODY_STRIDE + scalarCount;
  let buf = hashScratch.get(size);
  if (!buf) {
    buf = new Float64Array(size);
    hashScratch.set(size, buf);
  }
  serializeWorld(world, buf, 0, bodyCount, scalarCount);
  return hashFloat64Array(buf);
}

/**
 * 궤적 누적 해시.
 * 매 프레임 hashWorld 를 이어붙이면 문자열이 길어지므로,
 * 32비트 상태를 계속 굴려서 궤적 전체를 하나의 값으로 압축합니다.
 */
export class TrajectoryHasher {
  private h = 0x811c9dc5;

  update(world: World): void {
    const s = hashWorld(world);
    for (let i = 0; i < s.length; i++) {
      this.h ^= s.charCodeAt(i);
      this.h = Math.imul(this.h, 0x01000193);
    }
  }

  digest(): string {
    return (this.h >>> 0).toString(16).padStart(8, '0');
  }
}
