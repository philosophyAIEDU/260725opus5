/**
 * 2차원 벡터 연산.
 *
 * 설계 원칙: **할당 없는(allocation-free) out 파라미터 방식**.
 * 물리 hot loop는 1초에 960 substep × 물체 수만큼 돌기 때문에,
 * `{x, y}` 리터럴을 매번 만들면 GC가 프레임을 잡아먹습니다.
 * (성능 예산: 물리 루프 힙 할당 0회)
 *
 * 따라서 모든 이항 연산은 결과를 담을 `out`을 첫 인자로 받고 `out`을 반환합니다.
 * 순수 스칼라 결과(len, dot 등)만 값을 반환합니다.
 */

export interface Vec2 {
  x: number;
  y: number;
}

export function vec(x = 0, y = 0): Vec2 {
  return { x, y };
}

export function set(out: Vec2, x: number, y: number): Vec2 {
  out.x = x;
  out.y = y;
  return out;
}

export function copy(out: Vec2, a: Vec2): Vec2 {
  out.x = a.x;
  out.y = a.y;
  return out;
}

export function zero(out: Vec2): Vec2 {
  out.x = 0;
  out.y = 0;
  return out;
}

export function add(out: Vec2, a: Vec2, b: Vec2): Vec2 {
  out.x = a.x + b.x;
  out.y = a.y + b.y;
  return out;
}

export function sub(out: Vec2, a: Vec2, b: Vec2): Vec2 {
  out.x = a.x - b.x;
  out.y = a.y - b.y;
  return out;
}

export function scale(out: Vec2, a: Vec2, s: number): Vec2 {
  out.x = a.x * s;
  out.y = a.y * s;
  return out;
}

/** out = a + b * s  (적분기에서 가장 많이 쓰이는 형태) */
export function addScaled(out: Vec2, a: Vec2, b: Vec2, s: number): Vec2 {
  out.x = a.x + b.x * s;
  out.y = a.y + b.y * s;
  return out;
}

/** out += a * s */
export function accumulate(out: Vec2, a: Vec2, s: number): Vec2 {
  out.x += a.x * s;
  out.y += a.y * s;
  return out;
}

export function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

/** 2차원 외적의 z성분. 로렌츠력과 회전 판정에 사용. */
export function cross(a: Vec2, b: Vec2): number {
  return a.x * b.y - a.y * b.x;
}

export function len2(a: Vec2): number {
  return a.x * a.x + a.y * a.y;
}

export function len(a: Vec2): number {
  return Math.sqrt(a.x * a.x + a.y * a.y);
}

export function dist(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function dist2(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

/** 길이 0이면 (0,0)을 그대로 둡니다. NaN 전파 방지. */
export function normalize(out: Vec2, a: Vec2): Vec2 {
  const l = Math.sqrt(a.x * a.x + a.y * a.y);
  if (l === 0) {
    out.x = 0;
    out.y = 0;
    return out;
  }
  const inv = 1 / l;
  out.x = a.x * inv;
  out.y = a.y * inv;
  return out;
}

/** 반시계 90도 회전. 트랙 법선(n̂ = rot90(t̂)) 정의에 사용. */
export function rot90(out: Vec2, a: Vec2): Vec2 {
  const x = a.x;
  out.x = -a.y;
  out.y = x;
  return out;
}

/** 시계 90도 회전. */
export function rot270(out: Vec2, a: Vec2): Vec2 {
  const x = a.x;
  out.x = a.y;
  out.y = -x;
  return out;
}

export function rotate(out: Vec2, a: Vec2, radians: number): Vec2 {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  const x = a.x;
  const y = a.y;
  out.x = x * c - y * s;
  out.y = x * s + y * c;
  return out;
}

export function lerp(out: Vec2, a: Vec2, b: Vec2, t: number): Vec2 {
  out.x = a.x + (b.x - a.x) * t;
  out.y = a.y + (b.y - a.y) * t;
  return out;
}

export function equalsApprox(a: Vec2, b: Vec2, eps = 1e-12): boolean {
  return Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps;
}

/**
 * 임시 벡터 풀.
 * hot loop 안에서 중간 계산용 벡터가 필요할 때 사용합니다.
 * 재진입(recursion)하지 않는 코드에서만 안전하므로, 사용하는 함수 안에서
 * 즉시 소비하고 밖으로 내보내지 않는다는 규칙을 지킵니다.
 */
export function makePool(size: number): Vec2[] {
  const pool: Vec2[] = new Array(size);
  for (let i = 0; i < size; i++) pool[i] = { x: 0, y: 0 };
  return pool;
}
