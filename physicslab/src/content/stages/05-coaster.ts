/**
 * 스테이지 5 — 롤러코스터
 *
 * 겨냥 오개념: "속력이 빠르면 에너지가 늘어난다"
 *
 * ■ 물리 모델
 *   트랙 위 1자유도 운동(호길이 s). 마찰이 없으면 역학적 에너지가 보존됩니다.
 *     ½mv² + mgh = 일정
 *   마찰이 있으면 그만큼 열에너지로 옮겨갈 뿐, **전체 에너지의 합은 여전히 일정**합니다.
 *     ½mv² + mgh + Q = 일정,   Q = ∫ μ_k N ds
 *
 * ■ 오개념의 정체
 *   학생은 "빠르다 = 에너지가 많다"를 무조건 참으로 봅니다. 실제로는
 *   **높이가 낮아진 만큼** 빨라진 것이고, 총합은 변하지 않았습니다.
 *   그래서 위치E/운동E/열E 를 **하나의 스택 막대**로 보여줍니다.
 *   막대의 전체 높이가 변하지 않고 안에서 색만 바뀌는 것을 보면
 *   "에너지가 늘어난 게 아니라 형태가 바뀐 것"이 눈에 들어옵니다.
 *
 * ■ 수직항력과 루프
 *   N = m u²κ − F·n̂. 루프 꼭대기에서 N ≥ 0 이려면 u² ≥ gR 이어야 하고,
 *   에너지 보존과 합치면 출발 높이 h ≥ 2.5R 이 나옵니다 (검증 항목 ⑦).
 *
 * ■ 트랙 보간의 근사 조건
 *   높이 프로파일은 단조 3차 에르미트(C¹)로 보간합니다. 곡률이 마디에서
 *   불연속이므로 수직항력 그래프에 작은 계단이 생깁니다. 실제 코스터는
 *   클로소이드로 곡률을 연속으로 잇지만, 여기서는 "학생이 그린 높이를
 *   그대로 재현한다"를 더 중요하게 봤습니다 (자연 스플라인은 없는 봉우리를 만듭니다).
 *
 * ■ 왜 양쪽 지지(twoSided) 트랙인가
 *   실제 롤러코스터 차량에는 레일을 아래에서 붙잡는 **업스톱 휠**이 있어
 *   어떤 속도에서도 레일을 벗어나지 않습니다. 그래서 이 트랙도 양쪽 지지입니다.
 *   그러면 루프 통과 조건 h ≥ 2.5R 은 "떨어지느냐"가 아니라
 *   **"꼭대기에서 수직항력 N ≥ 0 을 유지하느냐"**로 나타납니다.
 *   이것이 교과서가 실제로 묻는 조건이고, 승객이 좌석에서 뜨지 않는 조건입니다.
 *   (한쪽 지지 트랙에서 구슬이 실제로 떨어지는 쪽은 tests/analytic.test.ts ⑦ 에서
 *    별도로 검증합니다 — 엔진은 두 상황을 모두 정확히 다룹니다)
 *
 * ■ 트랙 끝 처리
 *   마지막 제어점을 출발 높이보다 조금 높게 두어, 차량이 트랙 끝으로
 *   굴러 떨어지지 않고 되돌아오게 했습니다. 마찰이 0이면 두 끝 사이를
 *   영원히 왕복합니다 — 에너지 보존을 가장 직관적으로 보여주는 장면입니다.
 */

import { createBody, type TrackSegmentSpec } from '../../engine/types.ts';
import { makeTrack } from '../../engine/constraints.ts';
import { computeEnergy, createWorld } from '../../engine/world.ts';
import { BF_ON_TRACK } from '../../engine/frame.ts';
import {
  bool,
  num,
  traceBodyFlag,
  traceFirstFrame,
  traceFrameNearest,
  traceScalar,
  traceScalarFinal,
  traceScalarMax,
  type StageSpec,
} from '../schema.ts';

const G = 9.81;
const CAR = 0;
const CAR_MASS = 300;
const LOOP_X = 20;

/** 루프 진입 전까지의 호길이 [m] — 미션 판정에 필요합니다. */
function segments(p: {
  h0: number; h1: number; h3: number; loop: boolean; R: number;
}): TrackSegmentSpec[] {
  const { h0, h1, h3, loop, R } = p;

  // 마지막 제어점은 출발 높이보다 2 m 높게 — 차량이 끝에서 떨어지지 않고 되돌아옵니다.
  const endHeight = h0 + 2;

  if (!loop) {
    return [
      {
        kind: 'profile',
        xs: [0, 8, 16, LOOP_X, 24, 32, 40],
        ys: [h0, h1, 0, 0, 0, h3, endHeight],
        samples: 2048,
      },
    ];
  }

  // 루프를 붙이려면 이어지는 지점의 접선이 수평이어야 합니다.
  // 제어점 높이를 두 번 같게 두면 단조 보간의 기울기가 정확히 0이 됩니다.
  return [
    {
      kind: 'profile',
      xs: [0, 8, 16, LOOP_X],
      ys: [h0, h1, 0, 0],
      samples: 1024,
    },
    {
      kind: 'arc',
      center: { x: LOOP_X, y: R },
      radius: R,
      startAngle: -Math.PI / 2,
      sweep: 2 * Math.PI,
    },
    {
      kind: 'profile',
      xs: [LOOP_X, 24, 32, 40],
      ys: [0, 0, h3, endHeight],
      samples: 1024,
    },
  ];
}

export const coasterStage: StageSpec = {
  id: 'coaster',
  title: '롤러코스터',
  subtitle: '트랙 높이를 바꿔가며 에너지가 어디로 가는지 추적해 봅니다',
  domain: '역학',
  concepts: ['역학적 에너지 보존', '위치에너지', '운동에너지', '마찰과 열', '원운동과 수직항력'],
  targetMisconception: '속력이 빨라지면 물체의 에너지가 늘어난다',
  situation:
    '코스터 차량이 출발 언덕 꼭대기에서 정지 상태로 출발합니다. ' +
    '언덕 높이와 마찰을 바꿔가며 위치에너지·운동에너지·열에너지가 어떻게 변하는지 보세요.',

  controls: [
    {
      kind: 'slider', id: 'startHeight', label: '출발 언덕 높이',
      unit: 'm', min: 4, max: 30, step: 0.5, default: 18,
    },
    {
      kind: 'slider', id: 'hillHeight', label: '첫 번째 언덕 높이',
      unit: 'm', min: 0, max: 26, step: 0.5, default: 9,
    },
    {
      kind: 'slider', id: 'secondHill', label: '두 번째 언덕 높이',
      unit: 'm', min: 0, max: 22, step: 0.5, default: 6,
    },
    {
      kind: 'slider', id: 'friction', label: '트랙 마찰계수',
      unit: '', min: 0, max: 0.15, step: 0.005, default: 0,
      help: '0이면 역학적 에너지가 완벽히 보존됩니다.',
    },
    {
      kind: 'toggle', id: 'loop', label: '수직 루프 설치',
      default: false,
      help: '골짜기 한가운데에 원형 루프를 놓습니다.',
    },
    {
      kind: 'slider', id: 'loopRadius', label: '루프 반지름',
      unit: 'm', min: 1, max: 6, step: 0.5, default: 3,
    },
  ],

  build: (p) => {
    const h0 = num(p, 'startHeight', 18);
    const h1 = num(p, 'hillHeight', 9);
    const h3 = num(p, 'secondHill', 6);
    const mu = num(p, 'friction', 0);
    const loop = bool(p, 'loop', false);
    const R = num(p, 'loopRadius', 3);

    const track = makeTrack('coaster', segments({ h0, h1, h3, loop, R }), {
      // 업스톱 휠이 달린 실제 코스터와 같이 양쪽 지지 (위 주석 참조)
      support: 'twoSided',
      muS: mu,
      muK: mu,
    });

    return createWorld({
      tracks: [track],
      bodies: [
        createBody({
          id: 0, tag: 'car', kind: 'track', mass: CAR_MASS, radius: 0.5,
          trackIndex: 0, s: 0, u: 0,
          restitution: 0,
          colorIndex: 1, styleIndex: 0,
        }),
      ],
      fields: { gravity: { x: 0, y: -G } },
      integrator: mu > 0 ? 'semiImplicitPC' : 'velocityVerlet',
    });
  },

  measure: {
    channels: [
      { id: 'height', label: '높이', unit: 'm' },
      { id: 'speed', label: '속력', unit: 'm/s' },
      { id: 'pe', label: '위치에너지', unit: 'J' },
      { id: 'ke', label: '운동에너지', unit: 'J' },
      { id: 'heat', label: '열에너지', unit: 'J' },
      { id: 'total', label: '전체 에너지', unit: 'J' },
      { id: 'normal', label: '수직항력', unit: 'N' },
      { id: 'onTrack', label: '트랙 위에 있음', unit: '' },
    ],
    compute: (world, out) => {
      const b = world.bodies[0]!;
      const e = computeEnergy(world);
      out[0] = b.p.y;
      out[1] = b.trackIndex >= 0 ? Math.abs(b.u) : Math.hypot(b.v.x, b.v.y);
      out[2] = e.potentialGravity;
      out[3] = e.kinetic;
      out[4] = e.thermal;
      out[5] = e.total;
      out[6] = b.normalForce;
      out[7] = b.trackIndex >= 0 ? 1 : 0;
    },
  },

  prediction: {
    kind: 'numeric',
    prompt:
      '마찰이 전혀 없다고 할 때, 차량이 골짜기 바닥(높이 0 m)을 지날 때의 속력은 몇 m/s 일까요?',
    unit: 'm/s',
    min: 0, max: 40, step: 0.5,
    tolerance: 0.05,
    truth: (p) => Math.sqrt(2 * G * num(p, 'startHeight', 18)),
    help: '차량은 정지 상태에서 출발합니다. 차량의 질량은 300 kg 입니다.',
  },

  missions: [
    {
      id: 'energy-constant',
      title: '총합은 변하지 않는다',
      description:
        '마찰을 0으로 두고 실행해서, 전체 에너지가 처음 값의 1% 이내로 유지되는 것 확인하기',
      hint: '마찰계수 슬라이더를 0으로 내리고 실행해 보세요. 막대의 전체 높이를 지켜보세요.',
      check: (t, p) => {
        if (num(p, 'friction', 0) > 1e-9) return false;
        if (t.frameCount < 10) return false;
        const e0 = traceScalar(t, 0, 'total');
        if (Math.abs(e0) < 1e-6) return false;
        for (let f = 0; f < t.frameCount; f++) {
          if (Math.abs(traceScalar(t, f, 'total') - e0) / Math.abs(e0) > 0.01) return false;
        }
        // 실제로 움직여서 에너지 형태가 바뀌었는지도 확인
        return traceScalarMax(t, 'ke') > Math.abs(e0) * 0.3;
      },
    },
    {
      id: 'clear-loop',
      title: '루프 통과',
      description:
        '루프를 설치하고, 루프를 도는 내내 수직항력이 0 이상으로 유지되게 하기 ' +
        '(승객이 좌석에서 뜨지 않는 조건)',
      hint:
        '루프 꼭대기에서 필요한 최소 속력이 있습니다. ' +
        '출발 높이와 루프 반지름 사이의 관계를 찾아보세요.',
      check: (t, p) => {
        if (!bool(p, 'loop', false)) return false;
        const R = num(p, 'loopRadius', 3);
        // 루프 꼭대기(높이 ≈ 2R)를 실제로 지나야 하고,
        const topFrame = traceFirstFrame(
          t,
          (f) => Math.abs(traceScalar(t, f, 'height') - 2 * R) < R * 0.15,
        );
        if (topFrame < 0) return false;
        // 루프를 도는 동안(높이가 0보다 확실히 높은 구간) N ≥ 0 이어야 합니다.
        for (let f = 0; f < t.frameCount; f++) {
          const h = traceScalar(t, f, 'height');
          if (h < R * 0.5 || h > 2 * R + 0.1) continue;
          if (!traceBodyFlag(t, f, CAR, BF_ON_TRACK)) return false;
          if (traceScalar(t, f, 'normal') < 0) return false;
        }
        return true;
      },
    },
    {
      id: 'heat-30',
      title: '마찰로 30% 태우기',
      description: '마찰을 켜서 전체 에너지의 30% 이상이 열에너지로 바뀌게 하기',
      hint: '마찰계수를 올리면 트랙을 지나는 동안 열이 계속 쌓입니다.',
      check: (t) => {
        if (t.frameCount < 10) return false;
        const e0 = traceScalar(t, 0, 'total');
        if (Math.abs(e0) < 1e-6) return false;
        return traceScalarFinal(t, 'heat') / Math.abs(e0) >= 0.3;
      },
    },
  ],

  overlays: ['energyBars', 'velocityVector', 'ghostTrail', 'normalForce'],

  charts: [
    {
      id: 'energy',
      title: '에너지 - 시간',
      yLabel: '에너지',
      unit: 'J',
      autoScale: true,
      series: [
        { channel: 'pe', label: '위치E', colorIndex: 0, dash: [] },
        { channel: 'ke', label: '운동E', colorIndex: 4, dash: [10, 5] },
        { channel: 'heat', label: '열E', colorIndex: 1, dash: [3, 4] },
        { channel: 'total', label: '전체', colorIndex: 2, dash: [14, 4, 3, 4] },
      ],
    },
    {
      id: 'kinematics',
      title: '높이와 속력 - 시간',
      yLabel: '값',
      unit: 'm, m/s',
      autoScale: true,
      series: [
        { channel: 'height', label: '높이', colorIndex: 0, dash: [] },
        { channel: 'speed', label: '속력', colorIndex: 1, dash: [10, 5] },
      ],
    },
  ],

  probe: {
    question:
      '마찰 없는 코스터가 골짜기 바닥에서 가장 빠릅니다. 이때 차량의 역학적 에너지는 출발할 때와 비교해서?',
    choices: [
      {
        text: '똑같다. 위치에너지가 운동에너지로 바뀌었을 뿐이다',
        correct: true,
        feedback:
          '정확합니다. 에너지는 만들어지지도 사라지지도 않고 **형태만** 바뀝니다. ' +
          '스택 막대의 전체 높이가 변하지 않은 것이 그 증거입니다.',
      },
      {
        text: '늘어났다. 속력이 빨라졌으니까',
        correct: false,
        feedback:
          '빨라진 만큼 정확히 **높이가 낮아졌습니다**. 운동에너지가 늘어난 양과 ' +
          '위치에너지가 줄어든 양이 같습니다. 에너지 막대를 다시 보겠습니다.',
      },
      {
        text: '줄어들었다. 내려오면서 에너지를 썼으니까',
        correct: false,
        feedback:
          '마찰이 없으면 "쓰는" 곳이 없습니다. 위치에너지가 운동에너지로 옮겨갔을 뿐 ' +
          '총합은 그대로입니다. 마찰을 켜면 그때는 열로 빠져나갑니다.',
      },
      {
        text: '차량이 무거울수록 늘어난다',
        correct: false,
        feedback:
          '질량이 크면 위치에너지도 운동에너지도 함께 커지므로, 비율은 그대로입니다. ' +
          '그리고 어느 경우든 총합은 시간에 대해 변하지 않습니다.',
      },
    ],
    rewindTo: (t) => traceFrameNearest(t, 'height', 0),
    rewindCaption:
      '골짜기 바닥, 가장 빠른 순간입니다. 위치E 칸이 줄어든 만큼 운동E 칸이 늘어났고 전체 높이는 그대로입니다.',
  },

  explain: `## 정리: 에너지는 늘지 않고 **자리를 옮긴다**

$$E_{역학} = \\underbrace{\\tfrac{1}{2}mv^2}_{운동에너지} + \\underbrace{mgh}_{위치에너지}$$

마찰이 없으면 이 값이 시간에 대해 **일정**합니다.
낮아진 높이만큼 정확히 빨라집니다.
$$\\tfrac{1}{2}mv^2 = mg\\,\\Delta h \\quad \\Rightarrow \\quad v = \\sqrt{2g\\,\\Delta h}$$

질량 $m$ 이 양변에서 약분됩니다. **무거운 코스터든 가벼운 코스터든 골짜기에서의 속력은 같습니다.**

### 마찰이 있으면
에너지가 사라지는 게 아니라 **열**로 옮겨갑니다.
$$\\tfrac{1}{2}mv^2 + mgh + Q = \\text{일정}, \\qquad Q = \\int \\mu_k N \\, ds$$
스택 막대에 열E 칸이 자라나는 만큼 나머지가 줄어듭니다. 전체 높이는 여전히 그대로입니다.

### 루프를 도는 조건
꼭대기에서 트랙에 붙어 있으려면 수직항력이 0 이상이어야 합니다.
$$N = \\frac{mv_{꼭대기}^2}{R} - mg \\ge 0 \\quad \\Rightarrow \\quad v_{꼭대기}^2 \\ge gR$$
여기에 에너지 보존을 넣으면
$$h_{최소} = 2.5R$$
루프 반지름의 **2.5배** 높이에서 출발해야 합니다. 2배로는 부족합니다 —
꼭대기에서 속력이 0이면 그냥 떨어지기 때문입니다.`,

  duration: 16,
  view: (p) => {
    const h0 = num(p, 'startHeight', 18);
    const h1 = num(p, 'hillHeight', 9);
    const h3 = num(p, 'secondHill', 6);
    const R = bool(p, 'loop', false) ? num(p, 'loopRadius', 3) : 0;
    return {
      xMin: -3,
      xMax: 44,
      yMin: -3,
      yMax: Math.max(h0, h1, h3, 2 * R) + 4,
    };
  },
  bodyTags: ['car'],
  bodyLabels: ['차량'],

  decorations: (p) => {
    const R = num(p, 'loopRadius', 3);
    const deco = [
      { kind: 'hline' as const, y: 0, label: '기준 높이 0 m', colorIndex: 7, dashIndex: 2 },
    ];
    if (bool(p, 'loop', false)) {
      deco.push({
        kind: 'hline' as const,
        y: 2.5 * R,
        label: `루프 통과 최소 높이 2.5R = ${(2.5 * R).toFixed(1)} m`,
        colorIndex: 2,
        dashIndex: 1,
      });
    }
    return deco;
  },
};
