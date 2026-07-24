/**
 * 1차원 파동 — 중첩과 간섭 (스테이지 6).
 *
 * ■ 왜 유한차분으로 파동방정식을 풀지 않는가
 *   중첩 원리는 "선형 파동방정식의 해 두 개를 더한 것도 해"라는 **정확한 수학**입니다.
 *   유한차분으로 풀면 수치 분산 때문에 펄스가 진행하면서 모양이 뭉개지고,
 *   학생은 "만나서 찌그러졌다"고 잘못 읽습니다. 그건 이 스테이지가 겨냥하는
 *   오개념("두 파동이 만나면 부딪혀 튕긴다")을 오히려 강화합니다.
 *   그래서 각 파동을 d'Alembert 해 f(x − vt) 로 **해석적으로** 평가하고,
 *   합성파는 단순히 더합니다. 모양 왜곡이 0이므로
 *   "지나간 뒤 원래 모양 그대로"가 화면에서 완벽하게 보입니다.
 *
 * ■ 경계 반사는 거울상(image) 방법
 *   구간 [L, R] 에 대해 파원의 거울상들을 더합니다.
 *     y(x,t) = Σₖ [ f(x + 2kW, t) + s·f(2L − x + 2kW, t) ],  W = R − L
 *   s = −1 (고정단, 위상 π 뒤집힘) / +1 (자유단).
 *   이 합은 양 끝에서 항들이 정확히 쌍소멸하여 경계조건을 **엄밀히** 만족합니다.
 */

import type { WaveField, WaveSource } from './types.ts';

/** 파원의 진행파 모양. ξ = x − x₀ − v t 에 대한 함수. */
function shapeAt(src: WaveSource, xi: number): number {
  switch (src.shape) {
    case 'gaussian': {
      const z = xi / src.width;
      return src.amplitude * Math.exp(-z * z);
    }
    case 'triangle': {
      const z = Math.abs(xi) / src.width;
      return z >= 1 ? 0 : src.amplitude * (1 - z);
    }
    case 'sine': {
      const k = (2 * Math.PI) / src.wavelength;
      return src.amplitude * Math.sin(k * xi + src.phase);
    }
  }
}

/** 경계 반사를 무시한 단일 진행파 값. */
export function travelingValue(src: WaveSource, x: number, t: number): number {
  return shapeAt(src, x - src.origin - src.speed * t);
}

/** 경계 반사를 포함한 파원 1개의 변위. */
export function sourceValue(
  field: WaveField,
  src: WaveSource,
  x: number,
  t: number,
): number {
  if (!src.enabled) return 0;
  if (field.boundary === 'open') return travelingValue(src, x, t);

  const L = field.xMin;
  const R = field.xMax;
  const W = R - L;
  const s = field.boundary === 'fixed' ? -1 : 1;
  const K = field.reflections;

  let sum = 0;
  for (let k = -K; k <= K; k++) {
    const shift = 2 * k * W;
    sum += travelingValue(src, x + shift, t);
    sum += s * travelingValue(src, 2 * L - x + shift, t);
  }
  return sum;
}

/** 합성파 (모든 파원의 중첩). */
export function superposition(field: WaveField, x: number, t: number): number {
  let sum = 0;
  for (const src of field.sources) {
    sum += sourceValue(field, src, x, t);
  }
  return sum;
}

/**
 * 파형을 미리 잡아둔 Float32Array 에 채웁니다. 매 프레임 호출되므로 할당이 없습니다.
 * sourceIndex 가 -1 이면 합성파, 아니면 해당 파원 단독 파형.
 */
export function sampleWave(
  field: WaveField,
  t: number,
  out: Float32Array,
  sourceIndex = -1,
): void {
  const n = out.length;
  if (n === 0) return;
  const dx = n > 1 ? (field.xMax - field.xMin) / (n - 1) : 0;
  if (sourceIndex < 0) {
    for (let i = 0; i < n; i++) {
      out[i] = superposition(field, field.xMin + i * dx, t);
    }
    return;
  }
  const src = field.sources[sourceIndex];
  if (!src) {
    out.fill(0);
    return;
  }
  for (let i = 0; i < n; i++) {
    out[i] = sourceValue(field, src, field.xMin + i * dx, t);
  }
}

/**
 * 정상파 진단용: 구간 안에서 |y| 의 최댓값이 시간에 대해 거의 변하지 않는
 * 지점(마디, node)의 x 좌표들을 찾습니다. 미션 판정에 사용합니다.
 *
 * 한 주기를 sampleCount 번 훑어 각 x 에서의 진폭 포락선을 구한 뒤
 * 국소 최솟값을 마디로 봅니다.
 */
export function findNodes(
  field: WaveField,
  period: number,
  spatialSamples = 400,
  timeSamples = 24,
): number[] {
  const env = new Float64Array(spatialSamples);
  const dx = (field.xMax - field.xMin) / (spatialSamples - 1);
  for (let i = 0; i < spatialSamples; i++) {
    const x = field.xMin + i * dx;
    let m = 0;
    for (let j = 0; j < timeSamples; j++) {
      const t = (j / timeSamples) * period;
      const y = Math.abs(superposition(field, x, t));
      if (y > m) m = y;
    }
    env[i] = m;
  }
  const nodes: number[] = [];
  for (let i = 1; i < spatialSamples - 1; i++) {
    const a = env[i - 1]!;
    const b = env[i]!;
    const c = env[i + 1]!;
    if (b < a && b <= c) nodes.push(field.xMin + i * dx);
  }
  return nodes;
}

export function createWaveField(init: Partial<WaveField> = {}): WaveField {
  return {
    xMin: init.xMin ?? 0,
    xMax: init.xMax ?? 10,
    samples: init.samples ?? 400,
    sources: init.sources ?? [],
    boundary: init.boundary ?? 'open',
    reflections: init.reflections ?? 3,
  };
}

export function createWaveSource(init: Partial<WaveSource> = {}): WaveSource {
  return {
    amplitude: init.amplitude ?? 0.5,
    wavelength: init.wavelength ?? 2,
    width: init.width ?? 0.5,
    speed: init.speed ?? 2,
    origin: init.origin ?? 0,
    phase: init.phase ?? 0,
    shape: init.shape ?? 'gaussian',
    enabled: init.enabled ?? true,
  };
}
