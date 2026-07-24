/**
 * 스테이지 6 — 파동의 만남
 *
 * 겨냥 오개념: "두 파동이 만나면 서로 부딪혀 튕긴다"
 *
 * ■ 물리 모델
 *   선형 파동방정식 ∂²y/∂t² = v²∂²y/∂x² 의 d'Alembert 해를 **해석적으로** 평가합니다.
 *     y(x,t) = f₁(x − v₁t) + f₂(x − v₂t)
 *   두 파동이 겹치는 동안 변위는 **그냥 더해집니다**(중첩 원리).
 *   지나간 뒤에는 각자 원래 모양 그대로 계속 갑니다.
 *
 * ■ 왜 유한차분으로 풀지 않는가
 *   수치해법은 수치분산 때문에 펄스가 진행하면서 모양이 뭉개집니다.
 *   학생은 그걸 "부딪혀서 찌그러졌다"로 읽고, 이 스테이지가 없애려는 오개념을
 *   오히려 강화합니다. 해석해는 왜곡이 0이라 "지나간 뒤 원래 모양 그대로"가
 *   화면에서 완벽하게 재현됩니다. (engine/waves.ts 참조)
 *
 * ■ 화면 구성
 *   위 두 칸에 파동 1, 파동 2 를 **따로** 그리고, 아래 큰 칸에 합성파를 그립니다.
 *   따로 보여주지 않으면 "두 파동이 아직 각자 존재한다"는 사실이 보이지 않습니다.
 *
 * ■ 입자가 없는 스테이지
 *   물체(Body)가 하나도 없습니다. 대신 매질 위의 표시점 하나를 물체로 두어
 *   "매질은 제자리에서 위아래로만 움직인다"(횡파의 핵심)를 보여줍니다.
 */

import { createBody } from '../../engine/types.ts';
import { createWorld } from '../../engine/world.ts';
import {
  createWaveField,
  createWaveSource,
  sourceValue,
  superposition,
} from '../../engine/waves.ts';
import {
  num,
  str,
  traceAny,
  traceScalar,
  traceScalarMax,
  type StageSpec,
  type Trace,
} from '../schema.ts';

const X_MIN = 0;
const X_MAX = 20;
/** 매질 위의 관찰점 x 좌표 [m] */
const PROBE_X = 10;

export const waveStage: StageSpec = {
  id: 'wave',
  title: '파동의 만남',
  subtitle: '반대 방향에서 온 두 파동이 만나면 어떻게 될까요?',
  domain: '파동',
  concepts: ['중첩 원리', '보강간섭', '상쇄간섭', '정상파', '마디와 배'],
  targetMisconception: '두 파동이 만나면 서로 부딪혀 튕기거나 없어진다',
  situation:
    '긴 줄의 양쪽 끝에서 파동을 하나씩 보냅니다. 두 파동은 가운데에서 만납니다. ' +
    '만나는 동안, 그리고 지나간 뒤에 각 파동이 어떻게 되는지 보세요.',

  controls: [
    {
      kind: 'select', id: 'mode', label: '파동의 종류',
      options: [
        { value: 'pulse', label: '펄스 두 개 (같은 방향 변위)' },
        { value: 'opposite', label: '펄스 두 개 (반대 방향 변위)' },
        { value: 'standing', label: '연속파 두 개 → 정상파' },
      ],
      default: 'pulse',
    },
    {
      kind: 'slider', id: 'amplitude1', label: '파동 1의 진폭',
      unit: 'm', min: 0.1, max: 1.5, step: 0.05, default: 0.8,
    },
    {
      kind: 'slider', id: 'amplitude2', label: '파동 2의 진폭',
      unit: 'm', min: 0.1, max: 1.5, step: 0.05, default: 0.8,
    },
    {
      kind: 'slider', id: 'speed', label: '파동의 속력',
      unit: 'm/s', min: 0.5, max: 6, step: 0.1, default: 2.5,
      help: '두 파동은 같은 줄 위에 있으므로 속력이 같습니다.',
    },
    {
      kind: 'slider', id: 'wavelength', label: '파장 (연속파일 때)',
      unit: 'm', min: 1, max: 8, step: 0.25, default: 4,
    },
    {
      kind: 'slider', id: 'width', label: '펄스의 폭',
      unit: 'm', min: 0.3, max: 2.5, step: 0.1, default: 1,
    },
  ],

  build: (p) => {
    const mode = str(p, 'mode', 'pulse');
    const a1 = num(p, 'amplitude1', 0.8);
    const a2 = num(p, 'amplitude2', 0.8);
    const v = num(p, 'speed', 2.5);
    const lambda = num(p, 'wavelength', 4);
    const width = num(p, 'width', 1);

    const standing = mode === 'standing';
    const flip = mode === 'opposite' ? -1 : 1;

    const waves = createWaveField({
      xMin: X_MIN,
      xMax: X_MAX,
      samples: 400,
      // 정상파는 반대로 진행하는 연속파 두 개의 중첩 그 자체입니다.
      // 경계 반사를 쓰지 않고 파원 두 개로 만드는 편이 원리가 그대로 드러납니다.
      boundary: 'open',
      reflections: 0,
      sources: [
        createWaveSource({
          amplitude: a1,
          shape: standing ? 'sine' : 'gaussian',
          wavelength: lambda,
          width,
          speed: v,
          origin: standing ? 0 : 2.5,
          phase: 0,
        }),
        createWaveSource({
          amplitude: a2 * flip,
          shape: standing ? 'sine' : 'gaussian',
          wavelength: lambda,
          width,
          speed: -v,
          origin: standing ? 0 : X_MAX - 2.5,
          phase: 0,
        }),
      ],
    });

    return createWorld({
      waves,
      // 매질 위 관찰점. 물리 적분에는 참여하지 않고(고정질량) 위치만 파형을 따릅니다.
      // measure 에서 매 프레임 y 를 갱신합니다.
      bodies: [
        createBody({
          id: 0, tag: 'probe', mass: 0, invMass: 0, radius: 0.22,
          p: { x: PROBE_X, y: 0 },
          colorIndex: 4, styleIndex: 0,
        }),
      ],
      fields: { gravity: { x: 0, y: 0 } },
      integrator: 'velocityVerlet',
    });
  },

  measure: {
    channels: [
      { id: 'probeY', label: '관찰점의 변위', unit: 'm' },
      { id: 'wave1Y', label: '파동 1의 변위', unit: 'm' },
      { id: 'wave2Y', label: '파동 2의 변위', unit: 'm' },
      { id: 'maxY', label: '전체에서 가장 큰 변위', unit: 'm' },
      { id: 'minY', label: '전체에서 가장 작은 변위', unit: 'm' },
      { id: 'energyProxy', label: '파형의 제곱 합 (에너지 지표)', unit: 'm²' },
    ],
    compute: (world, out) => {
      const field = world.waves;
      if (!field) {
        out.fill(0);
        return;
      }
      const t = world.time;
      const s1 = field.sources[0]!;
      const s2 = field.sources[1]!;

      // 관찰점은 매질의 한 점 — 제자리에서 위아래로만 움직입니다.
      // (invMass = 0 이라 적분에 참여하지 않으므로 여기서 위치를 정합니다.
      //  시각 t 만의 함수이므로 되감아도 같은 값이 나옵니다 = 결정론 유지)
      const y = superposition(field, PROBE_X, t);
      const probe = world.bodies[0]!;
      probe.p.y = y;

      out[0] = y;
      out[1] = sourceValue(field, s1, PROBE_X, t);
      out[2] = sourceValue(field, s2, PROBE_X, t);

      let maxY = -Infinity;
      let minY = Infinity;
      let sq = 0;
      const n = 200;
      const dx = (field.xMax - field.xMin) / (n - 1);
      for (let i = 0; i < n; i++) {
        const v = superposition(field, field.xMin + i * dx, t);
        if (v > maxY) maxY = v;
        if (v < minY) minY = v;
        sq += v * v;
      }
      out[3] = maxY;
      out[4] = minY;
      out[5] = (sq / n) * (field.xMax - field.xMin);
    },
  },

  prediction: {
    kind: 'choice',
    prompt:
      '진폭이 같고 모양이 같은 두 펄스가 반대 방향에서 다가와 정확히 겹칩니다. ' +
      '완전히 겹친 그 순간 이후, 두 펄스는 어떻게 될까요?',
    choices: [
      '서로 부딪혀 튕겨서 왔던 방향으로 되돌아간다',
      '서로 상쇄되어 둘 다 사라진다',
      '겹치는 동안만 합쳐졌다가, 지나간 뒤에는 각자 원래 모양 그대로 계속 간다',
      '하나로 합쳐진 큰 펄스가 되어 한 방향으로 간다',
    ],
    truth: () => 2,
    tolerance: 0,
    help: '위 두 칸에 각 파동이 따로 그려집니다. 겹친 뒤 그것들이 어떻게 되는지 보세요.',
  },

  missions: [
    {
      id: 'constructive',
      title: '보강간섭 만들기',
      description:
        '두 펄스가 겹칠 때 최대 변위가 각 진폭의 합의 95% 이상이 되게 하기',
      hint: '두 펄스의 변위 방향이 같아야 합니다. "같은 방향 변위" 모드를 써 보세요.',
      check: (t, p) => {
        if (str(p, 'mode', 'pulse') === 'standing') return false;
        const a1 = num(p, 'amplitude1', 0.8);
        const a2 = num(p, 'amplitude2', 0.8);
        return traceScalarMax(t, 'maxY') >= (a1 + a2) * 0.95;
      },
    },
    {
      id: 'destructive',
      title: '상쇄간섭 목격하기',
      description:
        '두 펄스가 겹치는 순간 줄이 거의 평평해지는(최대 변위가 진폭의 15% 이하) 순간 만들기',
      hint: '두 펄스의 변위 방향이 반대여야 합니다. 진폭도 같아야 완전히 상쇄됩니다.',
      check: (t, p) => {
        if (str(p, 'mode', 'pulse') === 'standing') return false;
        const a = Math.max(num(p, 'amplitude1', 0.8), num(p, 'amplitude2', 0.8));
        return traceAny(
          t,
          (f) =>
            Math.max(
              Math.abs(traceScalar(t, f, 'maxY')),
              Math.abs(traceScalar(t, f, 'minY')),
            ) <= a * 0.15,
        );
      },
    },
    {
      id: 'survive',
      title: '지나간 뒤에도 살아 있다',
      description:
        '펄스가 겹친 뒤, 각 파동의 최대 변위가 처음 진폭의 95% 이상으로 되살아나는 것 확인하기',
      hint:
        '상쇄간섭으로 줄이 평평해진 순간에도 두 파동은 사라진 게 아닙니다. 조금 더 기다려 보세요.',
      check: (t, p) => {
        if (str(p, 'mode', 'pulse') === 'standing') return false;
        const a = Math.max(num(p, 'amplitude1', 0.8), num(p, 'amplitude2', 0.8));
        // 두 파동이 가장 크게 겹친 프레임을 기준으로 잡습니다.
        const overlap = overlapFrame(t);
        if (overlap < 0 || overlap >= t.frameCount - 2) return false;
        // 그 이후에 줄의 변위 크기가 원래 진폭 수준으로 되돌아오면
        // "두 파동이 살아남았다"는 뜻입니다.
        for (let f = overlap + 1; f < t.frameCount; f++) {
          const peak = Math.max(
            Math.abs(traceScalar(t, f, 'maxY')),
            Math.abs(traceScalar(t, f, 'minY')),
          );
          if (peak >= a * 0.95) return true;
        }
        return false;
      },
    },
  ],

  overlays: ['waveParts', 'ruler'],

  waveView: {
    sourceColors: [0, 1],
    sourceLabels: ['파동 1 (오른쪽으로)', '파동 2 (왼쪽으로)'],
    sumColorIndex: 4,
    yScale: 1,
  },

  charts: [
    {
      id: 'probe',
      title: '관찰점(x = 10 m)의 변위 - 시간',
      yLabel: '변위',
      unit: 'm',
      autoScale: true,
      series: [
        { channel: 'wave1Y', label: '파동 1', colorIndex: 0, dash: [] },
        { channel: 'wave2Y', label: '파동 2', colorIndex: 1, dash: [10, 5] },
        { channel: 'probeY', label: '합성', colorIndex: 4, dash: [3, 4] },
      ],
    },
    {
      id: 'extremes',
      title: '줄 전체의 최대·최소 변위 - 시간',
      yLabel: '변위',
      unit: 'm',
      autoScale: true,
      series: [
        { channel: 'maxY', label: '최대', colorIndex: 2, dash: [] },
        { channel: 'minY', label: '최소', colorIndex: 3, dash: [10, 5] },
      ],
    },
  ],

  probe: {
    question:
      '반대 방향 변위를 가진 두 펄스가 완전히 겹쳐서 줄이 순간적으로 완전히 평평해졌습니다. 이 순간 파동의 에너지는?',
    choices: [
      {
        text: '사라지지 않았다. 변위는 0이지만 줄의 각 점이 최대 속력으로 움직이고 있어 운동에너지 형태로 존재한다',
        correct: true,
        feedback:
          '정확합니다. 파동의 에너지는 변위(퍼텐셜)와 속도(운동) 두 형태로 존재합니다. ' +
          '줄이 평평한 순간에는 전부 운동에너지입니다. 그래서 곧바로 반대 모양이 나타납니다.',
      },
      {
        text: '두 파동이 서로를 없애서 에너지도 함께 사라졌다',
        correct: false,
        feedback:
          '에너지는 사라질 수 없습니다. 평평해진 순간 바로 다음에 두 펄스가 멀쩡히 나타나는 것을 ' +
          '다시 보겠습니다. 사라졌다면 다시 나타날 수 없습니다.',
      },
      {
        text: '한 파동의 에너지만 남고 나머지는 없어졌다',
        correct: false,
        feedback:
          '겹친 뒤 두 펄스가 **모두** 원래 진폭으로 계속 갑니다. 어느 쪽도 없어지지 않았습니다. ' +
          '위 두 칸에 그려진 각 파동을 확인해 보세요.',
      },
      {
        text: '에너지가 열로 바뀌었다',
        correct: false,
        feedback:
          '이상적인 줄에는 마찰이 없어 열이 생기지 않습니다. 그리고 열로 바뀌었다면 ' +
          '펄스가 다시 나타나지 못합니다. 겹친 직후 장면을 다시 보세요.',
      },
    ],
    rewindTo: (t) => Math.max(0, overlapFrame(t)),
    rewindCaption:
      '두 파동이 겹친 순간입니다. 위 두 칸을 보세요 — 각 파동은 멀쩡히 자기 자리에 있습니다.',
  },

  explain: `## 정리: 파동은 물체가 아니다

두 물체가 만나면 부딪히지만, 두 **파동**은 부딪히지 않습니다.
파동은 매질의 "상태"이고, 상태는 서로를 밀어낼 수 없기 때문입니다.

### 중첩 원리
같은 자리에 두 파동이 있으면 매질의 변위는 그냥 **더해집니다**.
$$y(x,t) = y_1(x,t) + y_2(x,t)$$

- 같은 방향 변위끼리 만나면 → 더 커짐 (**보강간섭**)
- 반대 방향 변위끼리 만나면 → 작아지거나 0 (**상쇄간섭**)

그리고 지나간 뒤에는 **각자 원래 모양 그대로** 계속 갑니다. 서로 아무 영향도 주지 않습니다.

### 상쇄간섭에서 에너지는 어디로?
줄이 평평해진 순간에도 각 점은 **최대 속력으로 움직이는 중**입니다.
에너지가 변위(퍼텐셜) 형태에서 속도(운동) 형태로 전부 옮겨간 것뿐입니다.
그래서 바로 다음 순간 반대 모양이 나타납니다.

### 정상파
같은 진폭·같은 파장의 파동 두 개가 반대 방향으로 진행하면,
겉보기에 **진행하지 않는** 파동이 만들어집니다.
$$y = 2A\\sin(kx)\\cos(\\omega t)$$
- **마디(node)**: $\\sin(kx) = 0$ 인 곳. 영원히 안 움직입니다. 간격은 $\\lambda/2$.
- **배(antinode)**: 마디 사이 한가운데. 가장 크게 흔들립니다.

정상파도 결국 진행파 두 개의 중첩입니다. 새로운 현상이 아닙니다.`,

  duration: 14,
  view: { xMin: X_MIN, xMax: X_MAX, yMin: -3.2, yMax: 3.2 },
  bodyTags: ['probe'],
  bodyLabels: ['관찰점'],

  // 관찰점은 물체로 그려지므로(파형을 따라 위아래로 움직임) 장식에는 넣지 않습니다.
  // 같은 이름표가 두 번 찍히면 학생이 서로 다른 것으로 오해합니다.
  decorations: () => [
    { kind: 'hline', y: 0, label: '평형 위치', colorIndex: 7, dashIndex: 2 },
  ],
};

/**
 * 두 파동이 가장 크게 겹친 프레임.
 * 줄 전체의 변위 제곱합(에너지 지표)이 최대가 되는 순간이 곧 최대 보강 지점이고,
 * 상쇄 모드에서는 최소가 되는 순간이 완전 상쇄 지점입니다.
 * 두 경우를 함께 잡기 위해 "지표가 초기값에서 가장 많이 벗어난 프레임"을 씁니다.
 */
function overlapFrame(t: Trace): number {
  if (t.frameCount === 0) return -1;
  const base = traceScalar(t, 0, 'energyProxy');
  let best = -1;
  let bestD = -Infinity;
  for (let f = 0; f < t.frameCount; f++) {
    const d = Math.abs(traceScalar(t, f, 'energyProxy') - base);
    if (d > bestD) {
      bestD = d;
      best = f;
    }
  }
  return best;
}
