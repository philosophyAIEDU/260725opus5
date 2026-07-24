/**
 * 스테이지 4 — 충돌 실험실
 *
 * 겨냥 오개념: "무거운 쪽이 항상 더 센 힘을 준다"
 *
 * ■ 물리 모델
 *   마찰 없는 에어트랙 위 1차원 충돌 (중력 없음 = 수평 트랙 위 운동으로 볼 것).
 *   충격량-운동량 정리와 반발계수 e 로 충돌 후 속도가 완전히 결정됩니다.
 *     운동량 보존:  m₁u₁ + m₂u₂ = m₁v₁ + m₂v₂
 *     반발계수:     e = −(v₁ − v₂)/(u₁ − u₂)
 *   두 식을 풀면
 *     v₁ = u₁ − (1+e)·m₂(u₁−u₂)/(m₁+m₂)
 *     v₂ = u₂ + (1+e)·m₁(u₁−u₂)/(m₁+m₂)
 *
 * ■ 오개념의 정확한 반박 지점
 *   뉴턴 제3법칙에 의해 두 물체가 주고받는 **힘(그리고 충격량)의 크기는 항상 같습니다**.
 *   다른 것은 그 힘이 만드는 **속도 변화**입니다: Δv = J/m.
 *   가벼운 쪽이 더 많이 튕겨 나가는 것은 힘을 더 받아서가 아니라 질량이 작아서입니다.
 *   그래서 이 스테이지는 충돌 순간 두 물체가 받은 **충격량 크기**를 나란히 보여줍니다.
 *
 * ■ 충돌 순간을 놓치지 않으려면
 *   충돌은 substep 몇 개 안에 끝나므로 1배속으로는 그냥 "탁" 하고 끝납니다.
 *   그래서 충돌 순간을 프레임 단위로 되짚을 수 있도록 누적 충격량을 채널로 내보내고,
 *   진단 문항의 rewindTo 가 충돌 직전 프레임을 가리키게 해두었습니다.
 *
 * ■ 적분기
 *   힘이 전혀 없는 등속 구간 + 충격량이므로 어느 적분기든 정확합니다.
 *   velocityVerlet 을 씁니다.
 */

import { createBody } from '../../engine/types.ts';
import { createWorld } from '../../engine/world.ts';
import {
  num,
  traceFirstFrame,
  traceScalar,
  type StageSpec,
  type Trace,
} from '../schema.ts';

const TRACK_HALF = 6;

/** 1차원 충돌의 해석해. 예측 정답과 미션 판정에 함께 씁니다. */
export function collisionOutcome(
  m1: number, u1: number, m2: number, u2: number, e: number,
): { v1: number; v2: number } {
  const rel = u1 - u2;
  const sum = m1 + m2;
  return {
    v1: u1 - ((1 + e) * m2 * rel) / sum,
    v2: u2 + ((1 + e) * m1 * rel) / sum,
  };
}

/**
 * 두 수레가 처음 충돌한 프레임. 충돌이 없었으면 -1.
 * 누적 충격량이 처음 0을 벗어나는 순간으로 찾습니다.
 */
function collisionFrame(t: Trace): number {
  return traceFirstFrame(t, (f) => traceScalar(t, f, 'impulse') > 1e-9);
}

export const collisionStage: StageSpec = {
  id: 'collision',
  title: '충돌 실험실',
  subtitle: '질량이 다른 두 수레를 마찰 없는 에어트랙에서 충돌시켜 봅니다',
  domain: '역학',
  concepts: ['운동량 보존', '충격량', '반발계수', '뉴턴 제3법칙', '탄성·비탄성 충돌'],
  targetMisconception: '무거운 물체가 가벼운 물체에게 더 큰 힘을 준다',
  situation:
    '마찰이 없는 에어트랙 위에 수레 두 대가 있습니다. 왼쪽 수레가 오른쪽으로 달려가 ' +
    '오른쪽 수레와 부딪힙니다. 반발계수를 바꾸면 충돌의 성질이 달라집니다.',

  controls: [
    {
      kind: 'slider', id: 'm1', label: '왼쪽 수레의 질량 m₁',
      unit: 'kg', min: 0.5, max: 10, step: 0.5, default: 1,
    },
    {
      kind: 'slider', id: 'm2', label: '오른쪽 수레의 질량 m₂',
      unit: 'kg', min: 0.5, max: 10, step: 0.5, default: 4,
    },
    {
      kind: 'slider', id: 'u1', label: '왼쪽 수레의 처음 속도 u₁',
      unit: 'm/s', min: 0, max: 6, step: 0.1, default: 3,
    },
    {
      kind: 'slider', id: 'u2', label: '오른쪽 수레의 처음 속도 u₂',
      unit: 'm/s', min: -6, max: 6, step: 0.1, default: 0,
      help: '음수면 왼쪽으로 달려옵니다.',
    },
    {
      kind: 'slider', id: 'e', label: '반발계수 e',
      unit: '', min: 0, max: 1, step: 0.05, default: 1,
      help: 'e = 1 완전탄성(운동에너지 보존), e = 0 완전비탄성(붙어서 함께 이동)',
    },
  ],

  build: (p) => {
    const m1 = num(p, 'm1', 1);
    const m2 = num(p, 'm2', 4);
    const u1 = num(p, 'u1', 3);
    const u2 = num(p, 'u2', 0);
    const e = num(p, 'e', 1);

    // 질량에 따라 크기를 다르게 그려야 "무거운 쪽"이 눈에 보입니다.
    const r1 = 0.18 + 0.06 * Math.cbrt(m1);
    const r2 = 0.18 + 0.06 * Math.cbrt(m2);

    return createWorld({
      bodies: [
        createBody({
          id: 0, tag: 'cart1', mass: m1, radius: r1, restitution: e,
          p: { x: -2.5, y: 0 }, v: { x: u1, y: 0 },
          colorIndex: 0, styleIndex: 0,
        }),
        createBody({
          id: 1, tag: 'cart2', mass: m2, radius: r2, restitution: e,
          p: { x: 1.2, y: 0 }, v: { x: u2, y: 0 },
          colorIndex: 1, styleIndex: 1,
        }),
      ],
      walls: [
        { tag: 'left', a: { x: -TRACK_HALF, y: 1.2 }, b: { x: -TRACK_HALF, y: -1.2 }, restitution: 1, friction: 0 },
        { tag: 'right', a: { x: TRACK_HALF, y: -1.2 }, b: { x: TRACK_HALF, y: 1.2 }, restitution: 1, friction: 0 },
      ],
      // 에어트랙(수평면 위 마찰 없는 운동)이므로 중력의 알짜 효과는 0입니다.
      fields: { gravity: { x: 0, y: 0 } },
      integrator: 'velocityVerlet',
    });
  },

  measure: {
    channels: [
      { id: 'v1', label: '왼쪽 수레 속도', unit: 'm/s' },
      { id: 'v2', label: '오른쪽 수레 속도', unit: 'm/s' },
      { id: 'p1', label: '왼쪽 수레 운동량', unit: 'kg·m/s' },
      { id: 'p2', label: '오른쪽 수레 운동량', unit: 'kg·m/s' },
      { id: 'pTotal', label: '전체 운동량', unit: 'kg·m/s' },
      { id: 'ke1', label: '왼쪽 수레 운동에너지', unit: 'J' },
      { id: 'ke2', label: '오른쪽 수레 운동에너지', unit: 'J' },
      { id: 'keTotal', label: '전체 운동에너지', unit: 'J' },
      { id: 'heat', label: '충돌로 잃은 에너지', unit: 'J' },
      { id: 'impulse', label: '주고받은 충격량(누적)', unit: 'N·s' },
    ],
    compute: (world, out) => {
      const a = world.bodies[0]!;
      const b = world.bodies[1]!;
      out[0] = a.v.x;
      out[1] = b.v.x;
      out[2] = a.mass * a.v.x;
      out[3] = b.mass * b.v.x;
      out[4] = out[2]! + out[3]!;
      out[5] = 0.5 * a.mass * a.v.x * a.v.x;
      out[6] = 0.5 * b.mass * b.v.x * b.v.x;
      out[7] = out[5]! + out[6]!;
      out[8] = world.thermal;
      // world.events 는 substep 마다 비워지므로 화면 프레임 경계에서는 이미 사라집니다.
      // 그래서 엔진이 상태에 누적해 두는 world.impulse 를 읽습니다.
      out[9] = world.impulse;
    },
  },

  prediction: {
    kind: 'numeric',
    prompt: '충돌한 뒤, 오른쪽 수레(m₂)의 속도는 얼마가 될까요?',
    unit: 'm/s',
    min: -12, max: 12, step: 0.1,
    tolerance: 0.05,
    truth: (p) =>
      collisionOutcome(
        num(p, 'm1', 1), num(p, 'u1', 3),
        num(p, 'm2', 4), num(p, 'u2', 0),
        num(p, 'e', 1),
      ).v2,
    help: '운동량은 항상 보존됩니다. 반발계수 e 는 충돌 후 상대속도의 크기를 결정합니다.',
  },

  missions: [
    {
      id: 'momentum-conserved',
      title: '운동량은 언제나 보존된다',
      description:
        '반발계수를 아무 값으로나 두고 실행해서, 충돌 전후 전체 운동량 변화가 0.1% 이내임을 확인하기',
      hint: '반발계수를 0으로 두어도 운동량은 보존됩니다. 보존되지 않는 것은 운동에너지입니다.',
      check: (t) => {
        const hit = collisionFrame(t);
        if (hit < 0) return false;
        // 충돌 **직전과 직후**를 비교합니다.
        // 실행 끝까지 비교하면 수레가 끝 벽에 부딪힌 뒤라, 벽(지구)이 가져간
        // 운동량 때문에 당연히 달라집니다. 보존 법칙이 말하는 것은
        // "외력이 없는 두 물체 사이의 상호작용"입니다.
        const before = Math.max(0, hit - 3);
        const after = Math.min(t.frameCount - 1, hit + 8);
        const p0 = traceScalar(t, before, 'pTotal');
        const p1 = traceScalar(t, after, 'pTotal');
        const scale = Math.max(Math.abs(p0), 1e-6);
        return Math.abs(p1 - p0) / scale <= 1e-3;
      },
    },
    {
      id: 'perfectly-inelastic',
      title: '완전비탄성 충돌 만들기',
      description:
        '반발계수를 0으로 두고 충돌시켜서, 충돌 후 두 수레의 속도가 같아지게 하기',
      hint: 'e = 0 이면 충돌 후 상대속도가 0 입니다. 두 수레가 붙어서 함께 움직입니다.',
      check: (t, p) => {
        if (num(p, 'e', 1) > 1e-9) return false;
        const hit = collisionFrame(t);
        if (hit < 0 || hit + 10 >= t.frameCount) return false;
        // 충돌 직후를 봅니다 (나중에 벽에 부딪히면 다시 갈라지므로)
        const f = hit + 8;
        return Math.abs(traceScalar(t, f, 'v1') - traceScalar(t, f, 'v2')) <= 0.02;
      },
    },
    {
      id: 'energy-lost',
      title: '에너지를 절반 넘게 잃게 만들기',
      description: '충돌로 처음 운동에너지의 50% 이상이 열로 빠져나가게 조건 맞추기',
      hint:
        '잃는 에너지는 반발계수와 두 수레의 질량비에 달려 있습니다. ' +
        '가장 많이 잃는 조합은 어떤 걸까요?',
      check: (t) => {
        const hit = collisionFrame(t);
        if (hit < 0) return false;
        const ke0 = traceScalar(t, Math.max(0, hit - 3), 'keTotal');
        if (ke0 < 1e-6) return false;
        const ke1 = traceScalar(t, Math.min(t.frameCount - 1, hit + 8), 'keTotal');
        return (ke0 - ke1) / ke0 >= 0.5;
      },
    },
  ],

  overlays: ['velocityVector', 'ghostTrail', 'momentumBars', 'energyBars'],

  charts: [
    {
      id: 'velocity',
      title: '속도 - 시간',
      yLabel: '속도',
      unit: 'm/s',
      autoScale: true,
      series: [
        { channel: 'v1', label: '왼쪽 m₁', colorIndex: 0, dash: [] },
        { channel: 'v2', label: '오른쪽 m₂', colorIndex: 1, dash: [10, 5] },
      ],
    },
    {
      id: 'conserved',
      title: '운동량과 운동에너지 - 시간',
      yLabel: '값',
      unit: 'kg·m/s, J',
      autoScale: true,
      series: [
        { channel: 'pTotal', label: '전체 운동량', colorIndex: 2, dash: [] },
        { channel: 'keTotal', label: '전체 운동에너지', colorIndex: 4, dash: [3, 4] },
        { channel: 'heat', label: '잃은 에너지', colorIndex: 1, dash: [14, 4, 3, 4] },
      ],
    },
  ],

  probe: {
    question:
      '1 kg 수레가 4 kg 수레에 부딪혔습니다. 충돌하는 동안 두 수레가 서로에게 준 힘의 크기를 비교하면?',
    choices: [
      {
        text: '두 힘의 크기는 항상 같다. 속도 변화가 다른 것은 질량이 다르기 때문이다',
        correct: true,
        feedback:
          '정확합니다. 뉴턴 제3법칙에 따라 힘은 항상 크기가 같고 방향이 반대입니다. ' +
          '충격량도 같습니다. Δv = J/m 이므로 가벼운 쪽의 속도가 더 크게 변할 뿐입니다.',
      },
      {
        text: '4 kg 수레가 더 큰 힘을 준다 (무거우니까)',
        correct: false,
        feedback:
          '무거운 쪽이 더 센 힘을 준다면 운동량이 보존될 수 없습니다. ' +
          '실제로 두 수레가 받은 충격량의 크기는 정확히 같습니다. 충돌 순간으로 되감아 확인해 보세요.',
      },
      {
        text: '1 kg 수레가 더 큰 힘을 준다 (더 빨리 움직이니까)',
        correct: false,
        feedback:
          '속도가 빠른 것과 힘이 큰 것은 다릅니다. 충돌 순간 두 수레가 받는 힘의 크기는 같습니다. ' +
          '충돌 장면을 느리게 다시 보겠습니다.',
      },
      {
        text: '충돌 전 속도의 비율만큼 차이가 난다',
        correct: false,
        feedback:
          '힘은 속도의 비율과 무관합니다. 상호작용하는 두 물체가 주고받는 힘은 언제나 크기가 같습니다. ' +
          '충격량 막대를 다시 보세요.',
      },
    ],
    rewindTo: (t) => {
      const f = collisionFrame(t);
      return f < 0 ? Math.floor(t.frameCount / 2) : Math.max(0, f - 6);
    },
    rewindCaption:
      '충돌 순간입니다. 두 수레가 받은 충격량의 크기가 같은지 막대를 비교해 보세요.',
  },

  explain: `## 정리: 힘은 같고, 결과가 다르다

### 뉴턴 제3법칙
$$\\vec{F}_{1\\to 2} = -\\vec{F}_{2\\to 1}$$
두 힘은 **항상** 크기가 같고 방향이 반대입니다. 질량, 속도, 크기와 무관합니다.
접촉 시간도 같으므로 충격량 $J = F\\Delta t$ 의 크기도 같습니다.

### 그런데 왜 가벼운 쪽이 훨씬 많이 튕길까
$$\\Delta v = \\frac{J}{m}$$
같은 충격량을 받아도 질량이 작으면 속도 변화가 큽니다.
**"더 센 힘을 받아서"가 아니라 "더 가벼워서"** 입니다.

### 운동량 보존
충격량의 크기가 같고 방향이 반대이므로 두 물체의 운동량 변화가 정확히 상쇄됩니다.
$$m_1u_1 + m_2u_2 = m_1v_1 + m_2v_2$$
이것은 **반발계수와 무관하게 언제나** 성립합니다. 붙어버리는 충돌에서도 마찬가지입니다.

### 반발계수
$$e = -\\frac{v_1 - v_2}{u_1 - u_2}$$
- $e = 1$ (완전탄성): 운동에너지도 보존됩니다.
- $0 < e < 1$: 일부가 열·소리·변형으로 빠져나갑니다.
- $e = 0$ (완전비탄성): 둘이 붙어서 함께 움직입니다. 이때 **운동에너지 손실이 최대**입니다.

보존되는 것은 운동량이고, 보존되지 않을 수 있는 것은 운동에너지입니다. 둘을 섞지 마세요.`,

  duration: 8,
  view: { xMin: -6.5, xMax: 6.5, yMin: -2.2, yMax: 2.2 },
  bodyTags: ['cart1', 'cart2'],
  bodyLabels: ['수레 m₁', '수레 m₂'],

  decorations: () => [
    { kind: 'hline', y: -0.75, label: '에어트랙', colorIndex: 7, dashIndex: 0 },
  ],
};
