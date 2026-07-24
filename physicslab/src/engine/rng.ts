/**
 * mulberry32 시드 난수.
 *
 * 왜 직접 구현하는가:
 *   Math.random()은 시드를 줄 수 없어서 같은 실행을 두 번 재현할 수 없습니다.
 *   이 앱의 되감기 / 리플레이 / 자동 테스트 / 교사 시연 재현은 전부
 *   "같은 시드 → 같은 궤적"에 의존합니다. 따라서 엔진 안에서
 *   Math.random() 직접 호출은 금지이며 모든 난수는 이 파일을 경유합니다.
 *
 * mulberry32는 32비트 정수 상태 하나만 쓰므로 스냅샷에 4바이트로 저장되고,
 * 링버퍼 되감기 시 난수열까지 정확히 복원됩니다.
 * 주기는 2^32로 통계 시뮬레이션용으로는 짧지만, 이 앱의 용도
 * (초기 조건 미세 요동, 잔상 산란 등)에는 충분합니다.
 */

export interface RngState {
  /** uint32 로 유지되는 내부 상태. 스냅샷에 그대로 직렬화됩니다. */
  s: number;
}

export function createRng(seed: number): RngState {
  // 시드를 uint32 범위로 정규화. 0 시드도 유효하게 동작합니다.
  return { s: seed >>> 0 };
}

export function cloneRng(r: RngState): RngState {
  return { s: r.s };
}

export function copyRng(out: RngState, src: RngState): RngState {
  out.s = src.s;
  return out;
}

/** [0, 1) 균등분포. */
export function nextFloat(r: RngState): number {
  r.s = (r.s + 0x6d2b79f5) >>> 0;
  let t = r.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** [lo, hi) 균등분포. */
export function nextRange(r: RngState, lo: number, hi: number): number {
  return lo + (hi - lo) * nextFloat(r);
}

/** [0, n) 정수. */
export function nextInt(r: RngState, n: number): number {
  return Math.floor(nextFloat(r) * n);
}

/**
 * 표준정규분포 (Box–Muller).
 * 두 값 중 하나만 쓰고 버립니다. 캐시를 두면 상태가 늘어나
 * 스냅샷 복원이 복잡해지므로 일부러 무상태로 둡니다.
 */
export function nextGaussian(r: RngState): number {
  const u1 = 1 - nextFloat(r); // (0, 1] — log(0) 방지
  const u2 = nextFloat(r);
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/**
 * 문자열 → uint32 시드 (FNV-1a).
 * 스테이지 id + 파라미터 문자열로 재현 가능한 시드를 만들 때 사용합니다.
 */
export function hashSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
