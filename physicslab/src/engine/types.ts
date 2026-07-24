/**
 * 엔진 공용 타입.
 *
 * 이 파일을 포함한 engine/ 전체는 **DOM 의존성이 0**입니다.
 * 그래야 Node 환경의 Vitest에서 해석해와 대조하는 자동 검증이 가능합니다.
 * (tsconfig 의 lib 에서 DOM 을 빼두었으므로 브라우저 API 를 쓰면 컴파일이 막힙니다)
 *
 * 단위는 전부 SI 입니다. 길이 m, 시간 s, 질량 kg, 전하 C, 자기장 T.
 */

import type { Vec2 } from './vec2.ts';
import type { RngState } from './rng.ts';

export type { Vec2 };

// ────────────────────────────────────────────────────────────
// 적분기
// ────────────────────────────────────────────────────────────

export type IntegratorKind =
  /** 보존력만 작용할 때. 심플렉틱이라 에너지가 장시간에도 표류하지 않음. */
  | 'velocityVerlet'
  /** 속도 의존 힘(항력·마찰)이 있을 때. 반음적 오일러 + 2회 예측-보정. */
  | 'semiImplicitPC'
  /** 일반 목적 4차. 정확도 기준을 별도로 확인할 때 쓰는 참조 적분기. */
  | 'rk4'
  /** 자기장 속 하전입자 전용. 회전각 오차만 남고 자이로반지름은 정확히 보존. */
  | 'boris';

// ────────────────────────────────────────────────────────────
// 물체
// ────────────────────────────────────────────────────────────

export type BodyKind =
  /** 자유 운동 (2자유도) */
  | 'free'
  /** 트랙(곡선) 위 구속 운동 (1자유도: 호길이 s) */
  | 'track';

export interface Body {
  id: number;
  /** 스테이지 코드/미션이 물체를 지목할 때 쓰는 이름. 예: 'ball', 'heavy' */
  tag: string;
  kind: BodyKind;
  active: boolean;

  /** 데카르트 상태. 트랙 구속 물체도 매 스텝 여기에 동기화됩니다. */
  p: Vec2;
  v: Vec2;
  a: Vec2;

  mass: number;
  /** 0 이면 고정(무한질량) 물체. */
  invMass: number;
  radius: number;
  charge: number;

  /** 반발계수 e. 1=완전탄성, 0=완전비탄성. */
  restitution: number;
  /** 정지마찰계수 */
  muS: number;
  /** 운동마찰계수 */
  muK: number;

  /** 선형(스토크스) 항력계수 b:  F = -b v      [kg/s] */
  dragLinear: number;
  /** 2차(뉴턴) 항력계수 c:      F = -c |v| v   [kg/m] */
  dragQuad: number;

  /** 구속된 트랙 인덱스. -1 이면 자유 물체. */
  trackIndex: number;
  /** 트랙 위 호길이 좌표 [m] */
  s: number;
  /** 접선 속도 ds/dt [m/s] (부호 = 진행 방향) */
  u: number;
  /** 직전 스텝의 수직항력 [N]. 자유물체도(FBD)와 이탈 판정에 사용. */
  normalForce: number;

  /** 접촉면 위에서 정지(정지마찰로 붙잡힘) 상태인지 */
  sticking: boolean;
  /** 바닥에 안정적으로 놓인 상태인지 (충돌 지터 억제용) */
  resting: boolean;

  /** 렌더 힌트 — 색만으로 구분하지 않기 위해 선 패턴 인덱스를 함께 보관 */
  colorIndex: number;
  styleIndex: number;
}

export function createBody(init: Partial<Body> & { id: number }): Body {
  const mass = init.mass ?? 1;
  return {
    id: init.id,
    tag: init.tag ?? `body${init.id}`,
    kind: init.kind ?? 'free',
    active: init.active ?? true,
    p: init.p ? { x: init.p.x, y: init.p.y } : { x: 0, y: 0 },
    v: init.v ? { x: init.v.x, y: init.v.y } : { x: 0, y: 0 },
    a: init.a ? { x: init.a.x, y: init.a.y } : { x: 0, y: 0 },
    mass,
    invMass: init.invMass ?? (mass > 0 ? 1 / mass : 0),
    radius: init.radius ?? 0.1,
    charge: init.charge ?? 0,
    restitution: init.restitution ?? 0.5,
    muS: init.muS ?? 0,
    muK: init.muK ?? 0,
    dragLinear: init.dragLinear ?? 0,
    dragQuad: init.dragQuad ?? 0,
    trackIndex: init.trackIndex ?? -1,
    s: init.s ?? 0,
    u: init.u ?? 0,
    normalForce: 0,
    sticking: false,
    resting: false,
    colorIndex: init.colorIndex ?? 0,
    styleIndex: init.styleIndex ?? 0,
  };
}

// ────────────────────────────────────────────────────────────
// 정적 기하: 벽
// ────────────────────────────────────────────────────────────

export interface Wall {
  tag: string;
  a: Vec2;
  b: Vec2;
  /** 벽의 반발계수. 물체 e 와 기하평균으로 합성됩니다. */
  restitution: number;
  /** 벽면 운동마찰계수 */
  friction: number;
}

// ────────────────────────────────────────────────────────────
// 용수철
// ────────────────────────────────────────────────────────────

export interface Spring {
  /** 연결된 물체 인덱스 */
  i: number;
  /** 상대 물체 인덱스. -1 이면 anchor 고정점에 연결. */
  j: number;
  anchor: Vec2;
  /** 용수철 상수 [N/m] */
  k: number;
  /** 자연 길이 [m] */
  restLength: number;
  /** 감쇠 계수 [kg/s] */
  damping: number;
}

// ────────────────────────────────────────────────────────────
// 외력 (사람이 미는 힘 등)
// ────────────────────────────────────────────────────────────

/**
 * 정해진 시간 구간에만 작용하는 일정한 힘.
 *
 * "밀다가 손을 뗀다"를 표현하기 위한 것입니다.
 * 시간에 의존하지만 그 시간은 world.time (상태의 일부) 이므로
 * 결정론이 깨지지 않습니다 — 실시간 시계는 여전히 어디에도 개입하지 않습니다.
 */
export interface AppliedForce {
  /** 대상 물체 인덱스 */
  body: number;
  fx: number;
  fy: number;
  /** 작용 시작 시각 [s] */
  startTime: number;
  /** 작용 종료 시각 [s]. Infinity 면 계속. */
  endTime: number;
  /** UI 라벨 (자유물체도에 표시) */
  label: string;
}

// ────────────────────────────────────────────────────────────
// 트랙 (구속 곡선)
// ────────────────────────────────────────────────────────────

export interface LineSegmentSpec {
  kind: 'line';
  a: Vec2;
  b: Vec2;
}

export interface ArcSegmentSpec {
  kind: 'arc';
  center: Vec2;
  radius: number;
  /** 시작 각 [rad] */
  startAngle: number;
  /** 훑는 각. 부호가 진행 방향(+ = 반시계). */
  sweep: number;
}

export interface ProfileSegmentSpec {
  kind: 'profile';
  /** x 오름차순 제어점. 단조 3차 에르미트로 보간됩니다. */
  xs: number[];
  ys: number[];
  /** 호길이 ↔ x 변환 테이블 해상도 */
  samples: number;
}

export type TrackSegmentSpec =
  | LineSegmentSpec
  | ArcSegmentSpec
  | ProfileSegmentSpec;

/** 트랙이 물체를 어느 쪽으로 밀 수 있는가. */
export type TrackSupport =
  /**
   * 한쪽만 지지. 수직항력 N ≥ 0 (법선 n̂ = rot90(t̂) 방향)만 가능.
   * 언덕 마루에서 뜨거나, 루프 꼭대기에서 떨어지는 현상이 이걸로 재현됩니다.
   */
  | 'oneSided'
  /** 양쪽 지지 (홈/레일/막대). N 부호 제한 없음. 강체 진자가 여기 해당. */
  | 'twoSided';

export interface TrackPath {
  tag: string;
  segments: TrackSegmentSpec[];
  support: TrackSupport;
  /**
   * 끝과 처음이 이어진 트랙인가 (진자의 원, 원형 레일).
   * true 면 호길이 s 가 전체 길이로 나머지 연산되어 무한히 돌 수 있고,
   * false 면 s 가 범위를 벗어나는 순간 트랙 끝으로 보고 자유 낙하로 전환됩니다.
   */
  closed: boolean;
  /** 트랙면 운동마찰계수 */
  muK: number;
  /** 트랙면 정지마찰계수 */
  muS: number;
  /** 컴파일된 내부 표현 (compileTrack 이 채움) */
  compiled: CompiledTrack | null;
}

export interface CompiledTrack {
  totalLength: number;
  segments: CompiledSegment[];
  /** 각 세그먼트 시작 호길이 */
  starts: number[];
}

export interface CompiledSegment {
  spec: TrackSegmentSpec;
  length: number;
  /** profile 세그먼트용: 호길이 → x 룩업 (등간격 s 격자에 대한 x 값) */
  sToX: Float64Array | null;
  /** profile 세그먼트용 단조 3차 에르미트 기울기 */
  slopes: Float64Array | null;
}

/** 트랙 위 한 점의 기하 정보. 할당 방지를 위해 out 객체로 채웁니다. */
export interface TrackFrame {
  /** 위치 */
  px: number;
  py: number;
  /** 단위 접선 (호길이 증가 방향) */
  tx: number;
  ty: number;
  /** 단위 법선 n̂ = rot90(t̂) */
  nx: number;
  ny: number;
  /** 부호 있는 곡률 κ. dt̂/ds = κ n̂ */
  kappa: number;
}

export function createTrackFrame(): TrackFrame {
  return { px: 0, py: 0, tx: 1, ty: 0, nx: 0, ny: 1, kappa: 0 };
}

// ────────────────────────────────────────────────────────────
// 장(field)
// ────────────────────────────────────────────────────────────

export interface Fields {
  /** 중력가속도 벡터 [m/s²]. 보통 (0, -9.81). */
  gravity: Vec2;
  /** 전기장 [V/m = N/C] */
  electric: Vec2;
  /** 자기장 z성분 [T]. 2차원 평면에 수직. + = 화면 밖으로 나오는 방향. */
  magneticZ: number;
}

// ────────────────────────────────────────────────────────────
// 파동 (스테이지 6 전용)
// ────────────────────────────────────────────────────────────

export type WavePulseShape = 'gaussian' | 'sine' | 'triangle';

export interface WaveSource {
  /** 진폭 [m] */
  amplitude: number;
  /** 파장 [m] (sine 일 때) */
  wavelength: number;
  /** 펄스 폭 [m] (gaussian/triangle 일 때) */
  width: number;
  /** 전파 속력 [m/s]. 부호가 진행 방향. */
  speed: number;
  /** t=0 에서의 중심 위치 [m] */
  origin: number;
  /** 위상 [rad] */
  phase: number;
  shape: WavePulseShape;
  enabled: boolean;
}

export interface WaveField {
  /** 매질 구간 [xMin, xMax] */
  xMin: number;
  xMax: number;
  /** 표본 개수 */
  samples: number;
  sources: WaveSource[];
  /**
   * 양 끝 경계 조건.
   * 'open'  — 반사 없음 (파동이 그냥 빠져나감)
   * 'fixed' — 고정단 반사 (위상 π 뒤집힘). 거울상 파원으로 구현.
   * 'free'  — 자유단 반사 (위상 유지)
   */
  boundary: 'open' | 'fixed' | 'free';
  /** 반사 이미지 차수 (정상파 만들 때 크게) */
  reflections: number;
}

// ────────────────────────────────────────────────────────────
// 충돌 이벤트
// ────────────────────────────────────────────────────────────

export const EVENT_BODY_BODY = 1;
export const EVENT_BODY_WALL = 2;
export const EVENT_LEAVE_TRACK = 3;
export const EVENT_SLIP_START = 4;
export const EVENT_STICK = 5;

/**
 * 스텝 중 발생한 사건 기록. 고정 용량 링으로 만들어 매 스텝 할당이 없습니다.
 * 자동 슬로우모션 트리거와 미션 판정이 이걸 읽습니다.
 */
export interface EventBuffer {
  capacity: number;
  count: number;
  type: Int32Array;
  a: Int32Array;
  b: Int32Array;
  time: Float64Array;
  /** 사건 세기 — 충돌이면 충격량 [N·s], 이탈이면 그때의 속력 */
  magnitude: Float64Array;
}

export function createEventBuffer(capacity = 32): EventBuffer {
  return {
    capacity,
    count: 0,
    type: new Int32Array(capacity),
    a: new Int32Array(capacity),
    b: new Int32Array(capacity),
    time: new Float64Array(capacity),
    magnitude: new Float64Array(capacity),
  };
}

export function pushEvent(
  buf: EventBuffer,
  type: number,
  a: number,
  b: number,
  time: number,
  magnitude: number,
): void {
  if (buf.count >= buf.capacity) return; // 넘치면 버림 — 할당 금지가 우선
  const i = buf.count++;
  buf.type[i] = type;
  buf.a[i] = a;
  buf.b[i] = b;
  buf.time[i] = time;
  buf.magnitude[i] = magnitude;
}

// ────────────────────────────────────────────────────────────
// 월드
// ────────────────────────────────────────────────────────────

export interface EnergyBreakdown {
  kinetic: number;
  potentialGravity: number;
  potentialSpring: number;
  potentialElectric: number;
  /** 마찰·비탄성충돌로 빠져나간 누적 열에너지 */
  thermal: number;
  total: number;
}

export interface World {
  /** 물리 substep [s]. 전 스테이지 공통 1/960. */
  dt: number;
  /** 누적 시뮬레이션 시각 [s] */
  time: number;
  /**
   * 누적 substep 개수. **결정론의 기준점.**
   * 시각(time)은 부동소수 누적 오차가 생길 수 있으므로
   * 재현·해시·되감기는 전부 이 정수를 기준으로 합니다.
   */
  steps: number;

  bodies: Body[];
  walls: Wall[];
  springs: Spring[];
  tracks: TrackPath[];
  applied: AppliedForce[];
  fields: Fields;
  waves: WaveField | null;

  integrator: IntegratorKind;
  rng: RngState;

  /** 마찰과 비탄성 충돌로 누적된 열에너지 [J] */
  thermal: number;
  /**
   * 물체끼리 주고받은 충격량의 누적 크기 [N·s].
   * events 버퍼는 substep 마다 비워지므로, 화면 프레임 경계에서 충돌 세기를
   * 측정하려면 이렇게 상태로 누적해 두어야 합니다.
   */
  impulse: number;

  events: EventBuffer;

  /** 스테이지가 자유롭게 쓰는 스칼라 상태 (예: 목표 통과 여부). 결정론 대상. */
  userScalars: Float64Array;
}

// ────────────────────────────────────────────────────────────
// 스냅샷 (되감기·리플레이용 정확 상태)
// ────────────────────────────────────────────────────────────

/** 물체 1개가 스냅샷에서 차지하는 float 개수. */
export const SNAPSHOT_BODY_STRIDE = 12;
/**
 * 스냅샷 헤더 float 개수:
 * [time, steps, rngState, thermal, bodyCount, userScalarCount, impulse]
 */
export const SNAPSHOT_HEADER = 7;

export interface Snapshot {
  /** Float64 정확 상태. 되감은 뒤 이어서 돌려도 비트 단위로 동일해야 하므로 f64. */
  data: Float64Array;
  /** 유효한 스냅샷인지 */
  valid: boolean;
  /** 이 스냅샷이 가리키는 substep 인덱스 */
  steps: number;
}
