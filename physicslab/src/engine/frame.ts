/**
 * 프레임 버퍼 규약.
 *
 * 시뮬레이션 한 순간의 상태를 **평면 Float32Array 한 장**으로 표현합니다.
 * 이 형식 하나가 세 곳에서 그대로 쓰입니다.
 *   · 드라이버가 매 프레임 기록하는 궤적 버퍼 (미션 판정 입력)
 *   · 스테이지 DSL 의 Trace (content/schema.ts)
 *   · 화면 전송용 버퍼 (Transferable 로 복사 없이 넘길 수 있는 형태)
 *
 * 객체 배열이 아니라 평면 배열인 이유: 프레임당 객체를 만들면
 * 60 fps × 물체 수만큼 GC 압력이 생기고, 그대로 전송·해싱도 못 합니다.
 *
 * ■ 레이아웃 (Float32)
 *   [0] time            시뮬레이션 시각 [s]
 *   [1] steps           누적 substep 수 (결정론 기준점)
 *   [2] frameIndex      기록 프레임 인덱스
 *   [3] flags           비트 0: 재생중, 1: 이번 프레임에 충돌 발생, 2: 완료
 *   [4] eventCount      이번 프레임에 쌓인 사건 수
 *   [5] thermal         누적 열에너지 [J]
 *   [6] bodyCount
 *   [7] scalarCount
 *   그 다음 bodyCount × BODY_STRIDE, 그 다음 scalarCount 개 스칼라,
 *   마지막에 EVENT_CAP × EVENT_STRIDE 개 사건 슬롯.
 */

export const FRAME_HEADER = 8;
export const FRAME_TIME = 0;
export const FRAME_STEPS = 1;
export const FRAME_INDEX = 2;
export const FRAME_FLAGS = 3;
export const FRAME_EVENT_COUNT = 4;
export const FRAME_THERMAL = 5;
export const FRAME_BODY_COUNT = 6;
export const FRAME_SCALAR_COUNT = 7;

export const FLAG_PLAYING = 1;
export const FLAG_IMPACT = 2;
export const FLAG_FINISHED = 4;

/** 물체 1개당 float: x y vx vy ax vy s u N flags radius mass */
export const BODY_STRIDE = 12;
export const B_X = 0;
export const B_Y = 1;
export const B_VX = 2;
export const B_VY = 3;
export const B_AX = 4;
export const B_AY = 5;
export const B_S = 6;
export const B_U = 7;
export const B_N = 8;
export const B_FLAGS = 9;
export const B_RADIUS = 10;
export const B_MASS = 11;

export const BF_ACTIVE = 1;
export const BF_ON_TRACK = 2;
export const BF_STICKING = 4;
export const BF_RESTING = 8;

/** 사건 1개당 float: type a b magnitude */
export const EVENT_STRIDE = 4;
export const EVENT_CAP = 8;

export interface FrameLayout {
  bodyCount: number;
  scalarCount: number;
  /** 전체 float 개수 */
  size: number;
  scalarOffset: number;
  eventOffset: number;
}

export function computeLayout(bodyCount: number, scalarCount: number): FrameLayout {
  const scalarOffset = FRAME_HEADER + bodyCount * BODY_STRIDE;
  const eventOffset = scalarOffset + scalarCount;
  return {
    bodyCount,
    scalarCount,
    scalarOffset,
    eventOffset,
    size: eventOffset + EVENT_CAP * EVENT_STRIDE,
  };
}

export function bodyOffset(index: number): number {
  return FRAME_HEADER + index * BODY_STRIDE;
}

export function readBodyField(
  frame: Float32Array,
  index: number,
  field: number,
): number {
  return frame[FRAME_HEADER + index * BODY_STRIDE + field] ?? 0;
}

export function readScalar(
  frame: Float32Array,
  layout: FrameLayout,
  channel: number,
): number {
  return frame[layout.scalarOffset + channel] ?? 0;
}

/**
 * 두 프레임을 alpha 로 선형 보간해 out 에 씁니다.
 *
 * 물리는 항상 고정 substep 으로만 돌고, 화면은 그 사이를 보간해서 그립니다.
 * 이 분리 덕분에 렌더 프레임이 튀어도 물리 결과가 바뀌지 않습니다.
 * 각도·플래그처럼 보간하면 안 되는 값은 최신 프레임 값을 그대로 씁니다.
 */
export function interpolateFrame(
  prev: Float32Array,
  next: Float32Array,
  alpha: number,
  layout: FrameLayout,
  out: Float32Array,
): void {
  const a = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;

  out[FRAME_TIME] = lerp(prev[FRAME_TIME]!, next[FRAME_TIME]!, a);
  out[FRAME_STEPS] = next[FRAME_STEPS]!;
  out[FRAME_INDEX] = next[FRAME_INDEX]!;
  out[FRAME_FLAGS] = next[FRAME_FLAGS]!;
  out[FRAME_EVENT_COUNT] = next[FRAME_EVENT_COUNT]!;
  out[FRAME_THERMAL] = lerp(prev[FRAME_THERMAL]!, next[FRAME_THERMAL]!, a);
  out[FRAME_BODY_COUNT] = next[FRAME_BODY_COUNT]!;
  out[FRAME_SCALAR_COUNT] = next[FRAME_SCALAR_COUNT]!;

  for (let i = 0; i < layout.bodyCount; i++) {
    const o = FRAME_HEADER + i * BODY_STRIDE;
    for (let f = 0; f <= B_N; f++) {
      out[o + f] = lerp(prev[o + f]!, next[o + f]!, a);
    }
    out[o + B_FLAGS] = next[o + B_FLAGS]!;
    out[o + B_RADIUS] = next[o + B_RADIUS]!;
    out[o + B_MASS] = next[o + B_MASS]!;
  }

  for (let k = 0; k < layout.scalarCount; k++) {
    const o = layout.scalarOffset + k;
    out[o] = lerp(prev[o]!, next[o]!, a);
  }

  // 사건은 보간 대상이 아닙니다 (있었거나 없었거나)
  const evLen = EVENT_CAP * EVENT_STRIDE;
  for (let k = 0; k < evLen; k++) {
    out[layout.eventOffset + k] = next[layout.eventOffset + k]!;
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// ────────────────────────────────────────────────────────────
// 재생 배속
// ────────────────────────────────────────────────────────────

export type SpeedRatio = 0.1 | 0.25 | 0.5 | 1 | 2;

/**
 * 배속을 **정수 분수**로 표현합니다.
 * 화면 프레임당 substep 수를 부동소수로 누적하면 실행마다 미세하게 달라져
 * 궤적이 갈라집니다. 정수 분자/분모로 누산하면 오차가 원천적으로 0입니다.
 * (1/60초 프레임 × 960 substep/s = 프레임당 16 substep 이 기준)
 */
export const SPEED_FRACTIONS: Record<SpeedRatio, [number, number]> = {
  0.1: [8, 5], //  16 × 1/10 = 1.6
  0.25: [4, 1],
  0.5: [8, 1],
  1: [16, 1],
  2: [32, 1],
};
