/**
 * 구속 조건 — 트랙 위 운동과 진자.
 *
 * ■ 왜 "호길이 s" 하나로 통일했는가
 *   진자, 경사면, 롤러코스터, 루프는 전부 "정해진 곡선 위를 움직이는 1자유도 운동"
 *   입니다. 데카르트 좌표에서 구속력을 매 스텝 푸는 대신
 *   곡선의 호길이 s 를 일반화 좌표로 삼으면
 *     m·s̈ = F_ext·t̂ + f_마찰
 *   이라는 1차원 방정식이 되어, 구속이 **정확히** 만족되고
 *   (수치적으로 물체가 트랙을 뚫거나 떨어져 나가는 일이 원천적으로 없음)
 *   보존력만 있을 때 속도 베를레가 에너지를 장시간 보존합니다.
 *
 * ■ 법선과 수직항력 부호 규약 (중요)
 *   n̂ ≡ rot90(t̂) = (-t̂y, t̂x),  곡률 κ 는 dt̂/ds = κ n̂ 로 정의.
 *   물체의 가속도를 프레네 분해하면  a = u̇ t̂ + u²κ n̂  이므로
 *     N = m u² κ − F_ext·n̂
 *   이 됩니다. 진행 방향 기준 "왼쪽"이 항상 물체가 올라타 있는 쪽이 되도록
 *   트랙을 만들면(오르막·내리막·루프 안쪽 모두 이 규약으로 일관됨)
 *   한쪽 지지 트랙의 이탈 조건은 그대로 **N < 0** 입니다.
 *     · 언덕 마루: κ<0 → N = mg − mu²/R,  u² > gR 이면 튀어오름 ✔
 *     · 루프 꼭대기: κ>0, n̂ 이 아래(중심)를 향함 → N = mu²/R − mg,
 *       u² ≥ gR 이어야 붙어 있음 ✔  (여기서 최소 높이 2.5R 이 나옵니다)
 */

import type {
  ArcSegmentSpec,
  CompiledSegment,
  CompiledTrack,
  LineSegmentSpec,
  ProfileSegmentSpec,
  TrackFrame,
  TrackPath,
  TrackSegmentSpec,
  Vec2,
} from './types.ts';

// ────────────────────────────────────────────────────────────
// 단조 3차 에르미트 보간 (Fritsch–Carlson)
// ────────────────────────────────────────────────────────────

/**
 * 제어점 사이 기울기를 계산합니다.
 *
 * 자연 3차 스플라인(C²) 대신 단조 보간(C¹)을 쓰는 이유:
 * 롤러코스터 트랙 높이를 학생이 드래그로 편집하는데, 자연 스플라인은
 * 제어점 사이에서 overshoot 해서 **학생이 만들지 않은 봉우리**를 만듭니다.
 * "내가 그린 트랙"과 "시뮬레이션 트랙"이 다르면 그 자체가 오개념 유발이므로,
 * 곡률 연속성을 포기하고 단조성을 택했습니다.
 * (곡률이 마디에서 불연속 → 수직항력이 계단처럼 변함. docs/PHYSICS.md 참조)
 */
export function monotoneSlopes(xs: number[], ys: number[]): Float64Array {
  const n = xs.length;
  const m = new Float64Array(n);
  if (n < 2) return m;

  const delta = new Float64Array(n - 1);
  for (let i = 0; i < n - 1; i++) {
    const x0 = xs[i]!;
    const x1 = xs[i + 1]!;
    const y0 = ys[i]!;
    const y1 = ys[i + 1]!;
    delta[i] = (y1 - y0) / (x1 - x0);
  }

  m[0] = delta[0]!;
  m[n - 1] = delta[n - 2]!;
  for (let i = 1; i < n - 1; i++) {
    const d0 = delta[i - 1]!;
    const d1 = delta[i]!;
    m[i] = d0 * d1 <= 0 ? 0 : (d0 + d1) / 2;
  }

  for (let i = 0; i < n - 1; i++) {
    const d = delta[i]!;
    if (d === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i]! / d;
    const b = m[i + 1]! / d;
    const h = Math.hypot(a, b);
    if (h > 3) {
      const t = 3 / h;
      m[i] = t * a * d;
      m[i + 1] = t * b * d;
    }
  }
  return m;
}

/** 구간 인덱스 탐색 (이분). xs 는 오름차순. */
function findInterval(xs: number[], x: number): number {
  let lo = 0;
  let hi = xs.length - 2;
  if (hi < 0) return 0;
  if (x <= xs[0]!) return 0;
  if (x >= xs[xs.length - 1]!) return hi;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (xs[mid]! <= x) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** 단조 에르미트 곡선의 값·1차·2차 도함수. */
function hermiteEval(
  xs: number[],
  ys: number[],
  slopes: Float64Array,
  x: number,
  out: { y: number; dy: number; ddy: number },
): void {
  const n = xs.length;
  if (n === 1) {
    out.y = ys[0]!;
    out.dy = 0;
    out.ddy = 0;
    return;
  }
  // 정의역 밖은 끝점 접선으로 선형 연장 (곡률 0).
  if (x < xs[0]!) {
    out.y = ys[0]! + slopes[0]! * (x - xs[0]!);
    out.dy = slopes[0]!;
    out.ddy = 0;
    return;
  }
  const last = n - 1;
  if (x > xs[last]!) {
    out.y = ys[last]! + slopes[last]! * (x - xs[last]!);
    out.dy = slopes[last]!;
    out.ddy = 0;
    return;
  }

  const i = findInterval(xs, x);
  const x0 = xs[i]!;
  const x1 = xs[i + 1]!;
  const h = x1 - x0;
  const t = (x - x0) / h;
  const y0 = ys[i]!;
  const y1 = ys[i + 1]!;
  const m0 = slopes[i]!;
  const m1 = slopes[i + 1]!;

  const t2 = t * t;
  const t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  out.y = h00 * y0 + h10 * h * m0 + h01 * y1 + h11 * h * m1;

  const d00 = 6 * t2 - 6 * t;
  const d10 = 3 * t2 - 4 * t + 1;
  const d01 = -6 * t2 + 6 * t;
  const d11 = 3 * t2 - 2 * t;
  out.dy = (d00 * y0 + d01 * y1) / h + d10 * m0 + d11 * m1;

  const s00 = 12 * t - 6;
  const s10 = 6 * t - 4;
  const s01 = -12 * t + 6;
  const s11 = 6 * t - 2;
  out.ddy = (s00 * y0 + s01 * y1) / (h * h) + (s10 * m0 + s11 * m1) / h;
}

const hermiteScratch = { y: 0, dy: 0, ddy: 0 };

/** 높이 프로파일의 y 값만 필요할 때 (트랙 그리기, UI). */
export function profileHeight(
  spec: ProfileSegmentSpec,
  slopes: Float64Array,
  x: number,
): number {
  hermiteEval(spec.xs, spec.ys, slopes, x, hermiteScratch);
  return hermiteScratch.y;
}

// ────────────────────────────────────────────────────────────
// 트랙 컴파일
// ────────────────────────────────────────────────────────────

function segmentLength(spec: TrackSegmentSpec, slopes: Float64Array | null): number {
  switch (spec.kind) {
    case 'line': {
      const dx = spec.b.x - spec.a.x;
      const dy = spec.b.y - spec.a.y;
      return Math.hypot(dx, dy);
    }
    case 'arc':
      return Math.abs(spec.sweep) * spec.radius;
    case 'profile': {
      // 사다리꼴 적분으로 ∫√(1+f'²) dx
      const xs = spec.xs;
      const x0 = xs[0]!;
      const x1 = xs[xs.length - 1]!;
      const m = spec.samples;
      const h = (x1 - x0) / m;
      let total = 0;
      let prev = Math.hypot(1, derivAt(spec, slopes!, x0));
      for (let i = 1; i <= m; i++) {
        const cur = Math.hypot(1, derivAt(spec, slopes!, x0 + i * h));
        total += ((prev + cur) / 2) * h;
        prev = cur;
      }
      return total;
    }
  }
}

function derivAt(
  spec: ProfileSegmentSpec,
  slopes: Float64Array,
  x: number,
): number {
  hermiteEval(spec.xs, spec.ys, slopes, x, hermiteScratch);
  return hermiteScratch.dy;
}

/**
 * profile 세그먼트의 호길이 → x 룩업 테이블을 만듭니다.
 * s 를 등간격으로 나눈 격자 위의 x 값을 저장하므로, 조회는 O(1) 보간입니다.
 * (hot loop 안에서 이분탐색조차 피하기 위한 설계)
 */
function buildProfileTable(
  spec: ProfileSegmentSpec,
  slopes: Float64Array,
  length: number,
): Float64Array {
  const xs = spec.xs;
  const x0 = xs[0]!;
  const x1 = xs[xs.length - 1]!;
  const m = spec.samples;
  const h = (x1 - x0) / m;

  // 먼저 x 격자 위의 누적 호길이를 구합니다.
  const cum = new Float64Array(m + 1);
  let prev = Math.hypot(1, derivAt(spec, slopes, x0));
  for (let i = 1; i <= m; i++) {
    const cur = Math.hypot(1, derivAt(spec, slopes, x0 + i * h));
    cum[i] = cum[i - 1]! + ((prev + cur) / 2) * h;
    prev = cur;
  }

  // 그 다음 s 등간격 격자에 대해 x 를 역보간합니다.
  const table = new Float64Array(m + 1);
  const ds = length / m;
  let j = 0;
  for (let i = 0; i <= m; i++) {
    const target = i * ds;
    while (j < m && cum[j + 1]! < target) j++;
    const c0 = cum[j]!;
    const c1 = cum[j + 1] ?? c0;
    const frac = c1 > c0 ? (target - c0) / (c1 - c0) : 0;
    table[i] = x0 + (j + frac) * h;
  }
  table[m] = x1;
  return table;
}

export function compileTrack(track: TrackPath): CompiledTrack {
  const segments: CompiledSegment[] = [];
  const starts: number[] = [];
  let total = 0;

  for (const spec of track.segments) {
    let slopes: Float64Array | null = null;
    if (spec.kind === 'profile') {
      slopes = monotoneSlopes(spec.xs, spec.ys);
    }
    const length = segmentLength(spec, slopes);
    const sToX =
      spec.kind === 'profile' ? buildProfileTable(spec, slopes!, length) : null;
    starts.push(total);
    segments.push({ spec, length, sToX, slopes });
    total += length;
  }

  const compiled: CompiledTrack = { totalLength: total, segments, starts };
  track.compiled = compiled;
  return compiled;
}

export function ensureCompiled(track: TrackPath): CompiledTrack {
  return track.compiled ?? compileTrack(track);
}

// ────────────────────────────────────────────────────────────
// 트랙 평가
// ────────────────────────────────────────────────────────────

/** 호길이 s 에 해당하는 세그먼트 인덱스. 세그먼트 수가 적어 선형 탐색이 가장 빠릅니다. */
function segmentAt(c: CompiledTrack, s: number): number {
  const n = c.segments.length;
  for (let i = n - 1; i >= 0; i--) {
    if (s >= c.starts[i]!) return i;
  }
  return 0;
}

/**
 * 트랙 위 호길이 s 에서의 위치·접선·법선·곡률을 out 에 채웁니다.
 * **할당 없음.**
 */
export function evalTrack(track: TrackPath, s: number, out: TrackFrame): void {
  const c = ensureCompiled(track);
  let clamped: number;
  if (track.closed && c.totalLength > 0) {
    clamped = s % c.totalLength;
    if (clamped < 0) clamped += c.totalLength;
  } else {
    clamped = s < 0 ? 0 : s > c.totalLength ? c.totalLength : s;
  }
  const si = segmentAt(c, clamped);
  const seg = c.segments[si]!;
  const local = clamped - c.starts[si]!;

  switch (seg.spec.kind) {
    case 'line':
      evalLine(seg.spec, seg.length, local, out);
      return;
    case 'arc':
      evalArc(seg.spec, local, out);
      return;
    case 'profile':
      evalProfile(seg.spec, seg, local, out);
      return;
  }
}

function evalLine(
  spec: LineSegmentSpec,
  length: number,
  local: number,
  out: TrackFrame,
): void {
  const inv = length > 0 ? 1 / length : 0;
  const tx = (spec.b.x - spec.a.x) * inv;
  const ty = (spec.b.y - spec.a.y) * inv;
  out.px = spec.a.x + tx * local;
  out.py = spec.a.y + ty * local;
  out.tx = tx;
  out.ty = ty;
  out.nx = -ty;
  out.ny = tx;
  out.kappa = 0;
}

function evalArc(spec: ArcSegmentSpec, local: number, out: TrackFrame): void {
  const sigma = spec.sweep >= 0 ? 1 : -1;
  const phi = spec.startAngle + (sigma * local) / spec.radius;
  const c = Math.cos(phi);
  const s = Math.sin(phi);
  out.px = spec.center.x + spec.radius * c;
  out.py = spec.center.y + spec.radius * s;
  // d(위치)/d(호길이) = σ(-sinφ, cosφ)
  out.tx = -sigma * s;
  out.ty = sigma * c;
  out.nx = -out.ty;
  out.ny = out.tx;
  // dt̂/ds = κ n̂  를 풀면 κ = σ/R
  out.kappa = sigma / spec.radius;
}

function evalProfile(
  spec: ProfileSegmentSpec,
  seg: CompiledSegment,
  local: number,
  out: TrackFrame,
): void {
  const table = seg.sToX!;
  const m = spec.samples;
  const ds = seg.length / m;
  let idx = ds > 0 ? local / ds : 0;
  if (idx < 0) idx = 0;
  if (idx > m) idx = m;
  const i0 = Math.min(m - 1, Math.floor(idx));
  const frac = idx - i0;
  const x = table[i0]! + (table[i0 + 1]! - table[i0]!) * frac;

  hermiteEval(spec.xs, spec.ys, seg.slopes!, x, hermiteScratch);
  const dy = hermiteScratch.dy;
  const ddy = hermiteScratch.ddy;
  const w = Math.sqrt(1 + dy * dy);
  const invW = 1 / w;

  out.px = x;
  out.py = hermiteScratch.y;
  out.tx = invW;
  out.ty = dy * invW;
  out.nx = -out.ty;
  out.ny = out.tx;
  // κ = f'' / (1+f'²)^{3/2}
  out.kappa = ddy / (w * w * w);
}

export function trackLength(track: TrackPath): number {
  return ensureCompiled(track).totalLength;
}

// ────────────────────────────────────────────────────────────
// 편의 생성자
// ────────────────────────────────────────────────────────────

export function makeTrack(
  tag: string,
  segments: TrackSegmentSpec[],
  opts: Partial<Pick<TrackPath, 'support' | 'muK' | 'muS' | 'closed'>> = {},
): TrackPath {
  const t: TrackPath = {
    tag,
    segments,
    support: opts.support ?? 'oneSided',
    closed: opts.closed ?? false,
    muK: opts.muK ?? 0,
    muS: opts.muS ?? 0,
    compiled: null,
  };
  compileTrack(t);
  return t;
}

/**
 * 강체 막대 진자.
 *
 * 피벗을 중심으로 하는 반지름 L 의 완전한 원을 양쪽 지지(twoSided) 트랙으로 만듭니다.
 * 막대는 밀 수도 당길 수도 있으므로 N 부호 제한이 없어야 하고,
 * 그 결과 호길이 방정식이 그대로  L θ̈ = −g sinθ  가 됩니다.
 * (constraints.ts 상단 규약 참조)
 *
 * 각도 θ 는 최하점 기준. θ=0 이 s = 0 이 되도록 startAngle 을 −π/2 로 잡았습니다.
 */
export function makePendulumTrack(pivot: Vec2, length: number): TrackPath {
  return makeTrack(
    'pendulum',
    [
      {
        kind: 'arc',
        center: { x: pivot.x, y: pivot.y },
        radius: length,
        startAngle: -Math.PI / 2,
        sweep: 2 * Math.PI,
      },
    ],
    { support: 'twoSided', closed: true },
  );
}

/** 진자 각도 θ(최하점 기준, 반시계 +) → 호길이 s */
export function pendulumAngleToS(length: number, theta: number): number {
  return theta * length;
}

/** 호길이 s → 진자 각도 θ */
export function pendulumSToAngle(length: number, s: number): number {
  return s / length;
}

/**
 * 경사면 (단일 직선 트랙).
 * angle 은 수평면과 이루는 각 [rad]. 물체는 내리막 방향(+s)으로 미끄러집니다.
 */
export function makeInclineTrack(
  top: Vec2,
  angleRad: number,
  length: number,
  muS: number,
  muK: number,
): TrackPath {
  // 진행 방향이 내리막(오른쪽 아래)이 되도록 잡으면 t̂=(cos, −sin),
  // n̂ = rot90(t̂) = (sin, cos) 로 경사면 위쪽을 향합니다. 물체는 그 위에 놓입니다.
  const b: Vec2 = {
    x: top.x + Math.cos(angleRad) * length,
    y: top.y - Math.sin(angleRad) * length,
  };
  return makeTrack('incline', [{ kind: 'line', a: { ...top }, b }], {
    support: 'oneSided',
    muS,
    muK,
  });
}

/**
 * 루프 트랙: 평평한 진입 구간 + 수직 원형 루프 + 퇴출 구간.
 * 진입은 +x 방향, 루프는 반시계로 한 바퀴 돕니다.
 * 검증 ⑦(최소 높이 2.5R)이 이 트랙 위에서 이루어집니다.
 */
export function makeLoopTrack(
  entryLength: number,
  radius: number,
  exitLength: number,
): TrackPath {
  return makeTrack(
    'loop',
    [
      { kind: 'line', a: { x: -entryLength, y: 0 }, b: { x: 0, y: 0 } },
      {
        kind: 'arc',
        center: { x: 0, y: radius },
        radius,
        startAngle: -Math.PI / 2,
        sweep: 2 * Math.PI,
      },
      { kind: 'line', a: { x: 0, y: 0 }, b: { x: exitLength, y: 0 } },
    ],
    { support: 'oneSided' },
  );
}
