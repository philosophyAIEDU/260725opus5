/**
 * 스테이지 DSL.
 *
 * 스테이지는 **코드가 아니라 데이터**입니다.
 * 파일 하나 = 스테이지 하나. 레지스트리에 한 줄 추가하면 화면에 뜹니다.
 * 교사가 직접 새 스테이지를 만들 수 있어야 하므로
 *  · 필드 이름은 물리 교사에게 익숙한 말로 (겨냥 오개념, 예측, 미션…)
 *  · 모든 물리량에 단위를 필수로
 *  · 미션 판정은 순수 함수로 (가짜 궤적을 넣어 테스트 가능)
 * 를 지켰습니다. 작성법은 docs/ADDING_STAGES.md 참조.
 */

import { BODY_STRIDE, FRAME_HEADER } from '../engine/frame.ts';
import type { World } from '../engine/types.ts';

export type ParamValue = number | boolean | string;
export type Params = Record<string, ParamValue>;

/** 파라미터를 숫자로 안전하게 꺼냅니다. 없으면 fallback. */
export function num(p: Params, id: string, fallback = 0): number {
  const v = p[id];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

export function bool(p: Params, id: string, fallback = false): boolean {
  const v = p[id];
  return typeof v === 'boolean' ? v : fallback;
}

export function str(p: Params, id: string, fallback = ''): string {
  const v = p[id];
  return typeof v === 'string' ? v : fallback;
}

// ────────────────────────────────────────────────────────────
// 컨트롤 (슬라이더 / 토글 / 선택)
// ────────────────────────────────────────────────────────────

export interface SliderControl {
  kind: 'slider';
  id: string;
  label: string;
  /**
   * SI 단위. UI에 반드시 함께 표시됩니다.
   * 무차원량(마찰계수 μ, 반발계수 e 등)은 빈 문자열 '' 로 둡니다.
   * 타입상 필수 필드라 "깜빡하고 안 쓰는" 경우는 컴파일 단계에서 막힙니다.
   */
  unit: string;
  min: number;
  max: number;
  step: number;
  default: number;
  /** 학생용 한 줄 설명 */
  help?: string;
}

export interface ToggleControl {
  kind: 'toggle';
  id: string;
  label: string;
  default: boolean;
  help?: string;
}

export interface SelectControl {
  kind: 'select';
  id: string;
  label: string;
  options: { value: string; label: string }[];
  default: string;
  help?: string;
}

export type ControlSpec = SliderControl | ToggleControl | SelectControl;

export function defaultParams(controls: ControlSpec[]): Params {
  const p: Params = {};
  for (const c of controls) p[c.id] = c.default;
  return p;
}

// ────────────────────────────────────────────────────────────
// 측정 채널 (그래프와 미션이 읽는 파생 물리량)
// ────────────────────────────────────────────────────────────

export interface ChannelSpec {
  id: string;
  label: string;
  unit: string;
}

export interface MeasureSpec {
  channels: ChannelSpec[];
  /**
   * 매 프레임 호출됩니다. out[i] 에 channels[i] 값을 씁니다.
   * **할당 금지** — out 은 재사용되는 버퍼입니다.
   */
  compute: (world: World, out: Float64Array) => void;
}

// ────────────────────────────────────────────────────────────
// 궤적 (Trace) — 미션 판정의 입력
// ────────────────────────────────────────────────────────────

export interface TraceEvent {
  frame: number;
  time: number;
  type: number;
  a: number;
  b: number;
  magnitude: number;
}

/**
 * 한 번의 실행 전체 기록.
 *
 * 드라이버가 매 프레임 기록한 것을 그대로 이어붙인 평면 Float32Array 입니다.
 * (프레임 레이아웃은 engine/frame.ts 와 동일)
 * 미션 check 는 이 구조만 보고 판정하므로, 테스트에서 손으로 만든
 * 가짜 Trace 를 넣어 검증할 수 있습니다.
 */
export interface Trace {
  data: Float32Array;
  /** 프레임 1장의 float 개수 */
  stride: number;
  frameCount: number;
  bodyCount: number;
  /** 프레임 간격 [s] (= 1/60) */
  dtFrame: number;
  /** 물체 tag → 인덱스 */
  bodyTags: string[];
  channels: string[];
  events: TraceEvent[];
  params: Params;
}

export function traceTime(t: Trace, frame: number): number {
  return t.data[frame * t.stride] ?? 0;
}

/** field 는 engine/frame.ts 의 B_X, B_VY … 상수. */
export function traceBody(
  t: Trace,
  frame: number,
  bodyIndex: number,
  field: number,
): number {
  return t.data[frame * t.stride + FRAME_HEADER + bodyIndex * BODY_STRIDE + field] ?? 0;
}

export function traceBodyIndex(t: Trace, tag: string): number {
  return t.bodyTags.indexOf(tag);
}

export function traceScalar(t: Trace, frame: number, channel: string): number {
  const ci = t.channels.indexOf(channel);
  if (ci < 0) return 0;
  return t.data[frame * t.stride + FRAME_HEADER + t.bodyCount * BODY_STRIDE + ci] ?? 0;
}

export function traceScalarMax(t: Trace, channel: string): number {
  let m = -Infinity;
  for (let f = 0; f < t.frameCount; f++) m = Math.max(m, traceScalar(t, f, channel));
  return m;
}

export function traceScalarMin(t: Trace, channel: string): number {
  let m = Infinity;
  for (let f = 0; f < t.frameCount; f++) m = Math.min(m, traceScalar(t, f, channel));
  return m;
}

export function traceScalarFinal(t: Trace, channel: string): number {
  return t.frameCount === 0 ? 0 : traceScalar(t, t.frameCount - 1, channel);
}

/** 채널 값이 target 에 가장 가까운 프레임. 결정적 순간 찾기에 씁니다. */
export function traceFrameNearest(t: Trace, channel: string, target: number): number {
  let best = 0;
  let bestD = Infinity;
  for (let f = 0; f < t.frameCount; f++) {
    const d = Math.abs(traceScalar(t, f, channel) - target);
    if (d < bestD) {
      bestD = d;
      best = f;
    }
  }
  return best;
}

/** 조건을 처음 만족하는 프레임. 없으면 -1. */
export function traceFirstFrame(
  t: Trace,
  predicate: (frame: number) => boolean,
): number {
  for (let f = 0; f < t.frameCount; f++) if (predicate(f)) return f;
  return -1;
}

/** 조건을 만족하는 프레임이 하나라도 있는가. */
export function traceAny(t: Trace, predicate: (frame: number) => boolean): boolean {
  return traceFirstFrame(t, predicate) >= 0;
}

/** 물체 플래그 검사 (engine/frame.ts 의 BF_* 상수). */
export function traceBodyFlag(
  t: Trace,
  frame: number,
  bodyIndex: number,
  flag: number,
): boolean {
  return (traceBody(t, frame, bodyIndex, 9) & flag) !== 0;
}

/**
 * 물체가 바닥에 닿아 멈춘 첫 프레임의 시각 [s]. 끝까지 안 멈추면 NaN.
 * 여러 스테이지의 미션이 "도착 시각"을 묻기 때문에 공통으로 둡니다.
 */
export function traceLandingTime(
  t: Trace,
  bodyIndex: number,
  restingFlag: number,
): number {
  const f = traceFirstFrame(t, (fr) => traceBodyFlag(t, fr, bodyIndex, restingFlag));
  return f < 0 ? NaN : traceTime(t, f);
}

/** 지정한 시각에 가장 가까운 프레임. */
export function traceFrameAtTime(t: Trace, time: number): number {
  let best = 0;
  let bestD = Infinity;
  for (let f = 0; f < t.frameCount; f++) {
    const d = Math.abs(traceTime(t, f) - time);
    if (d < bestD) {
      bestD = d;
      best = f;
    }
  }
  return best;
}

/** 채널이 최댓값을 갖는 프레임. */
export function traceFrameOfMax(t: Trace, channel: string): number {
  let best = 0;
  let bestV = -Infinity;
  for (let f = 0; f < t.frameCount; f++) {
    const v = traceScalar(t, f, channel);
    if (v > bestV) {
      bestV = v;
      best = f;
    }
  }
  return best;
}

// ────────────────────────────────────────────────────────────
// 미션
// ────────────────────────────────────────────────────────────

export interface Mission {
  id: string;
  title: string;
  /** 학생에게 보여줄 달성 조건 설명 */
  description: string;
  /**
   * 판정. **순수 함수여야 합니다** — 같은 (trace, params) 에는 항상 같은 결과.
   * 외부 상태(시간, 난수, DOM)를 읽으면 tests/missions.test.ts 가 못 잡습니다.
   */
  check: (trace: Trace, params: Params) => boolean;
  /** 실패했을 때 보여줄 힌트. 정답을 알려주지 않고 방향만 제시합니다. */
  hint: string;
}

// ────────────────────────────────────────────────────────────
// 예측
// ────────────────────────────────────────────────────────────

export interface NumericPrediction {
  kind: 'numeric';
  prompt: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  /** 상대오차 허용치 (0.05 = 5%) */
  tolerance: number;
  truth: (p: Params) => number;
  /** 입력 전 보조 설명 (정답 암시 금지) */
  help?: string;
}

export interface ChoicePrediction {
  kind: 'choice';
  prompt: string;
  choices: string[];
  /** 정답 선택지 인덱스 */
  truth: (p: Params) => number;
  tolerance: number;
  help?: string;
}

export interface OrderingPrediction {
  kind: 'ordering';
  prompt: string;
  items: string[];
  /** 올바른 순서 (items 인덱스 배열) */
  truthOrder: (p: Params) => number[];
  truth: (p: Params) => number;
  tolerance: number;
  help?: string;
}

export type PredictionSpec =
  | NumericPrediction
  | ChoicePrediction
  | OrderingPrediction;

/** 예측이 맞았는지. 배지 기준은 상대오차 5% 이내입니다. */
export function evaluatePrediction(
  spec: PredictionSpec,
  params: Params,
  answer: number | number[],
): { correct: boolean; relativeError: number; truthValue: number } {
  if (spec.kind === 'numeric') {
    const truth = spec.truth(params);
    const a = typeof answer === 'number' ? answer : NaN;
    const denom = Math.abs(truth) > 1e-12 ? Math.abs(truth) : 1;
    const rel = Math.abs(a - truth) / denom;
    return { correct: rel <= spec.tolerance, relativeError: rel, truthValue: truth };
  }
  if (spec.kind === 'choice') {
    const truth = spec.truth(params);
    const a = typeof answer === 'number' ? answer : -1;
    return { correct: a === truth, relativeError: a === truth ? 0 : 1, truthValue: truth };
  }
  const order = spec.truthOrder(params);
  const a = Array.isArray(answer) ? answer : [];
  const correct =
    a.length === order.length && a.every((v, i) => v === order[i]);
  // 순서 문제의 "오차" = 자리가 틀린 항목 비율
  let wrong = 0;
  for (let i = 0; i < order.length; i++) if (a[i] !== order[i]) wrong++;
  return {
    correct,
    relativeError: order.length ? wrong / order.length : 1,
    truthValue: spec.truth(params),
  };
}

// ────────────────────────────────────────────────────────────
// 오개념 진단 문항
// ────────────────────────────────────────────────────────────

export interface ProbeChoice {
  text: string;
  correct: boolean;
  /** 이 선택지를 고른 학생에게 줄 피드백. 오답도 존중하는 어조로. */
  feedback: string;
}

export interface MisconceptionProbe {
  question: string;
  choices: ProbeChoice[];
  /**
   * 오답 시 자동으로 되감을 "결정적 순간" 프레임.
   * 말로 설명하는 대신 그 장면을 직접 보게 합니다.
   */
  rewindTo: (trace: Trace) => number;
  /** 되감은 뒤 화면에 띄울 안내 문구 */
  rewindCaption: string;
}

// ────────────────────────────────────────────────────────────
// 오버레이 / 그래프
// ────────────────────────────────────────────────────────────

export type OverlayId =
  | 'velocityVector'
  | 'accelerationVector'
  | 'forceBody'
  | 'ghostTrail'
  | 'componentSplit'
  | 'normalForce'
  | 'lorentzTriad'
  | 'fieldArrows'
  | 'energyBars'
  | 'momentumBars'
  | 'ruler'
  | 'apexMarker'
  | 'waveParts';

export interface SeriesSpec {
  channel: string;
  label: string;
  /** 팔레트 인덱스 — 색만으로 구분하지 않도록 dash 와 함께 씁니다. */
  colorIndex: number;
  /** 선 패턴 (색각 이상 대응). [] = 실선 */
  dash: number[];
}

export interface ChartSpec {
  id: string;
  title: string;
  yLabel: string;
  unit: string;
  series: SeriesSpec[];
  yMin?: number;
  yMax?: number;
  /** true 면 데이터에 맞춰 y축 자동 조정 */
  autoScale: boolean;
}

// ────────────────────────────────────────────────────────────
// 스테이지
// ────────────────────────────────────────────────────────────

export interface ViewBox {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

// ────────────────────────────────────────────────────────────
// 장식 (물체가 아닌 화면 요소)
// ────────────────────────────────────────────────────────────

/**
 * 물리에 참여하지 않지만 화면에 있어야 하는 것들 — 과녁, 구역 라벨, 안내선.
 * 렌더러가 스테이지를 몰라도 되도록 데이터로 선언합니다.
 */
export type Decoration =
  | { kind: 'marker'; x: number; y: number; label: string; colorIndex: number; radius: number }
  | { kind: 'label'; x: number; y: number; text: string; colorIndex: number }
  | { kind: 'zone'; x: number; y: number; w: number; h: number; label: string; colorIndex: number }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; label: string; colorIndex: number; dashIndex: number }
  | { kind: 'hline'; y: number; label: string; colorIndex: number; dashIndex: number };

// ────────────────────────────────────────────────────────────
// 자유물체도 선언
// ────────────────────────────────────────────────────────────

/**
 * 자유물체도 화살표 하나. 힘의 x/y 성분을 측정 채널에서 읽습니다.
 * 렌더러가 물리 모델을 다시 계산하지 않게 하려는 설계입니다 —
 * 화면에 그리는 힘과 실제로 적분에 쓰인 힘이 어긋날 여지를 없앱니다.
 */
export interface FbdArrowSpec {
  label: string;
  xChannel: string;
  yChannel: string;
  colorIndex: number;
  dashIndex: number;
}

export interface FbdSpec {
  /** 자유물체도를 그릴 물체 인덱스 */
  body: number;
  arrows: FbdArrowSpec[];
  /** 1 N 을 몇 px 로 그릴지 (스테이지마다 힘의 규모가 다름) */
  pxPerNewton: number;
}

export interface StageSpec {
  id: string;
  title: string;
  /** 한 줄 부제 */
  subtitle: string;
  /** 단원 분류 */
  domain: '역학' | '파동' | '전자기';
  /** 관련 개념 태그 */
  concepts: string[];
  /** 이 스테이지가 겨냥하는 오개념 */
  targetMisconception: string;
  /** 상황 설명 (예측 입력 전에 보여줌 — 정답 암시 금지) */
  situation: string;

  controls: ControlSpec[];
  /** 파라미터 → 초기 월드. seed 는 결정론을 위해 명시적으로 전달됩니다. */
  build: (params: Params, seed: number) => World;
  measure: MeasureSpec;

  prediction: PredictionSpec;
  missions: Mission[];
  overlays: OverlayId[];
  charts: ChartSpec[];
  probe: MisconceptionProbe;
  /** 설명 단계에서 보여줄 개념 정리 (간이 마크다운) */
  explain: string;

  /** 자동 정지 시각 [s] */
  duration: number;
  /**
   * 카메라가 잡을 월드 영역 [m].
   * 파라미터에 따라 장면 크기가 달라지는 스테이지(낙하 높이, 사거리 등)는
   * 함수로 주면 됩니다. 고정 장면이면 그냥 객체로 두세요.
   */
  view: ViewBox | ((p: Params) => ViewBox);
  /** 물체 tag 순서 — Trace 인덱스와 대응 */
  bodyTags: string[];
  /** 과녁·구역 라벨 등 물리에 참여하지 않는 화면 요소 */
  decorations?: (p: Params) => Decoration[];
  /** 자유물체도 선언 ('forceBody' 오버레이를 쓸 때 필요) */
  fbd?: FbdSpec;
  /**
   * 파동 스테이지 전용 — 화면에 개별 파동을 따로 그릴지.
   * (일반 입자 스테이지에서는 undefined)
   */
  waveView?: {
    /** 개별 파동 색 인덱스 */
    sourceColors: number[];
    sourceLabels: string[];
    sumColorIndex: number;
    yScale: number;
  };
}

/**
 * 스테이지 정의의 자기 점검.
 * 새 스테이지를 추가한 교사가 실수를 바로 발견할 수 있도록,
 * 앱 시작 시 개발 모드에서 호출됩니다.
 */
/** view 가 함수든 객체든 실제 영역으로 풀어냅니다. */
export function resolveView(stage: StageSpec, params: Params): ViewBox {
  return typeof stage.view === 'function' ? stage.view(params) : stage.view;
}

export function validateStage(stage: StageSpec): string[] {
  const errors: string[] = [];
  if (!stage.id) errors.push('id 가 비어 있습니다.');
  if (stage.missions.length !== 3) {
    errors.push(`미션은 정확히 3개여야 합니다 (현재 ${stage.missions.length}개). 별 3개 = 미션 3개.`);
  }
  if (stage.probe.choices.length !== 4) {
    errors.push(`진단 문항은 4지선다여야 합니다 (현재 ${stage.probe.choices.length}개).`);
  }
  if (stage.probe.choices.filter((c) => c.correct).length !== 1) {
    errors.push('진단 문항의 정답은 정확히 1개여야 합니다.');
  }
  if (stage.controls.length === 0) {
    errors.push('컨트롤이 하나도 없습니다. 학생이 바꿀 수 있는 변수가 있어야 합니다.');
  }
  for (const c of stage.controls) {
    if (c.kind === 'slider') {
      if (!(c.min < c.max)) errors.push(`슬라이더 ${c.id}: min < max 여야 합니다.`);
      if (c.default < c.min || c.default > c.max)
        errors.push(`슬라이더 ${c.id}: 기본값이 범위 밖입니다.`);
      // unit 은 타입상 필수이므로 누락은 컴파일에서 걸립니다.
      // 여기서는 '무차원을 뜻하는 빈 문자열'과 구분할 방법이 없으므로 검사하지 않습니다.
    }
  }
  const ids = new Set<string>();
  for (const c of stage.controls) {
    if (ids.has(c.id)) errors.push(`컨트롤 id 중복: ${c.id}`);
    ids.add(c.id);
  }
  const chIds = new Set(stage.measure.channels.map((c) => c.id));
  for (const chart of stage.charts) {
    for (const s of chart.series) {
      if (!chIds.has(s.channel)) {
        errors.push(`그래프 ${chart.id}: 없는 채널 '${s.channel}' 을 참조합니다.`);
      }
    }
  }
  if (stage.duration <= 0) errors.push('duration 은 양수여야 합니다.');
  const view = resolveView(stage, defaultParams(stage.controls));
  if (!(view.xMin < view.xMax && view.yMin < view.yMax)) {
    errors.push('view 범위가 잘못되었습니다.');
  }
  return errors;
}
