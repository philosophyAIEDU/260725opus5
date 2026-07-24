/**
 * 스테이지 3 — 힘을 밀어라
 *
 * 겨냥 오개념: "움직이려면 힘이 계속 필요하다" (아리스토텔레스적 운동관)
 *
 * ■ 물리 모델
 *   경사각 θ 인 빗면 위 물체. 빗면 방향(호길이 s)의 1자유도 운동입니다.
 *     m s̈ = F_밀기 − mg sinθ + f
 *     N = mg cosθ                       (직선 트랙이므로 곡률항 없음)
 *     정지: |F_밀기 − mg sinθ| ≤ μs N   → 안 움직임
 *     운동: f = −sign(ṡ)·μk N
 *
 * ■ 이 스테이지의 핵심 장치
 *   1) 실시간 자유물체도 — 화면에 그리는 힘이 곧 적분에 들어간 힘입니다.
 *      (measure 채널로 힘 성분을 내보내고 렌더러는 그걸 그대로 그림)
 *   2) "미는 힘을 도중에 뗀다" — 마찰이 0이면 손을 떼도 **속력이 변하지 않습니다**.
 *      학생이 평생 본 적 없는 장면이고, 그래서 이 오개념의 정확한 반례입니다.
 *   3) 정지마찰↔운동마찰 전환 순간을 사건으로 잡아 표시합니다.
 *
 * ■ 정지마찰계수와 운동마찰계수
 *   실제 재료는 보통 μs > μk 입니다. 컨트롤을 둘로 늘리면 학생이 헷갈리므로
 *   μ 하나만 받고 μs = μ, μk = 0.8μ 로 둡니다 (전형적인 금속-나무 비율).
 *   이 관계 때문에 "움직이기 시작하는 순간 갑자기 쑥 나가는" 현상이 재현됩니다.
 */

import { createBody, type AppliedForce } from '../../engine/types.ts';
import { makeTrack } from '../../engine/constraints.ts';
import { createWorld } from '../../engine/world.ts';
import { appliedForceMagnitude } from '../../engine/forces.ts';
import { B_U } from '../../engine/frame.ts';
import {
  num,
  traceAny,
  traceBody,
  traceFirstFrame,
  traceScalar,
  traceTime,
  type StageSpec,
} from '../schema.ts';

const G = 9.81;
const BLOCK = 0;
const TRACK_LENGTH = 40;
/** 운동마찰계수 = 정지마찰계수 × 이 비율 */
const KINETIC_RATIO = 0.8;

function slopeUnit(angleDeg: number): { tx: number; ty: number } {
  const th = (angleDeg * Math.PI) / 180;
  return { tx: Math.cos(th), ty: Math.sin(th) };
}

export const newtonSecondStage: StageSpec = {
  id: 'newton-second',
  title: '힘을 밀어라',
  subtitle: '물체를 밀다가 손을 떼면 어떻게 될까요?',
  domain: '역학',
  concepts: ['뉴턴 제1법칙', '뉴턴 제2법칙', '정지마찰', '운동마찰', '빗면'],
  targetMisconception: '물체가 계속 움직이려면 힘이 계속 작용해야 한다',
  situation:
    '빗면 위의 나무 상자를 일정한 힘으로 밀어 올립니다. ' +
    '정해진 시간이 지나면 손을 뗍니다. 마찰과 경사각을 바꿔가며 관찰해 보세요.',

  controls: [
    {
      kind: 'slider', id: 'mass', label: '상자의 질량',
      unit: 'kg', min: 0.5, max: 10, step: 0.5, default: 2,
    },
    {
      kind: 'slider', id: 'force', label: '미는 힘',
      unit: 'N', min: 0, max: 60, step: 1, default: 20,
    },
    {
      kind: 'slider', id: 'pushTime', label: '미는 시간',
      unit: 's', min: 0.5, max: 4, step: 0.1, default: 2,
      help: '이 시간이 지나면 손을 뗍니다.',
    },
    {
      kind: 'slider', id: 'mu', label: '정지마찰계수 μs',
      unit: '', min: 0, max: 0.8, step: 0.02, default: 0.2,
      help: `운동마찰계수는 자동으로 μs × ${KINETIC_RATIO} 가 됩니다.`,
    },
    {
      kind: 'slider', id: 'angle', label: '빗면의 경사각',
      unit: '°', min: 0, max: 35, step: 1, default: 0,
      help: '0°이면 평평한 바닥입니다.',
    },
  ],

  build: (p) => {
    const mass = num(p, 'mass', 2);
    const force = num(p, 'force', 20);
    const pushTime = num(p, 'pushTime', 2);
    const muS = num(p, 'mu', 0.2);
    const angle = num(p, 'angle', 0);
    const { tx, ty } = slopeUnit(angle);

    // +s 방향이 오르막이 되도록 만듭니다. 그러면 n̂ = rot90(t̂) 가 빗면 위쪽을
    // 향해 물체가 그 위에 올라탄 형태가 되고, 중력의 접선 성분이 −mg sinθ 입니다.
    const track = makeTrack(
      'slope',
      [{ kind: 'line', a: { x: 0, y: 0 }, b: { x: TRACK_LENGTH * tx, y: TRACK_LENGTH * ty } }],
      { support: 'oneSided', muS, muK: muS * KINETIC_RATIO },
    );

    const applied: AppliedForce[] = [
      {
        body: 0,
        fx: force * tx,
        fy: force * ty,
        startTime: 0,
        endTime: pushTime,
        label: '미는 힘',
      },
    ];

    return createWorld({
      tracks: [track],
      applied,
      bodies: [
        createBody({
          id: 0, tag: 'block', kind: 'track', mass, radius: 0.28,
          trackIndex: 0, s: 0.6, u: 0,
          colorIndex: 4, styleIndex: 0,
        }),
      ],
      fields: { gravity: { x: 0, y: -G } },
      integrator: 'semiImplicitPC',
    });
  },

  measure: {
    channels: [
      { id: 'pos', label: '빗면 위 이동거리', unit: 'm' },
      { id: 'vel', label: '속도', unit: 'm/s' },
      { id: 'acc', label: '가속도', unit: 'm/s²' },
      { id: 'Fpush', label: '미는 힘', unit: 'N' },
      { id: 'Ffric', label: '마찰력', unit: 'N' },
      { id: 'Fnormal', label: '수직항력', unit: 'N' },
      { id: 'Fnet', label: '알짜힘', unit: 'N' },
      { id: 'sticking', label: '정지마찰로 붙잡힘', unit: '' },
      // 자유물체도용 힘 벡터 성분 (x, y)
      { id: 'FgX', label: '중력 x', unit: 'N' },
      { id: 'FgY', label: '중력 y', unit: 'N' },
      { id: 'FnX', label: '수직항력 x', unit: 'N' },
      { id: 'FnY', label: '수직항력 y', unit: 'N' },
      { id: 'FfX', label: '마찰력 x', unit: 'N' },
      { id: 'FfY', label: '마찰력 y', unit: 'N' },
      { id: 'FpX', label: '미는 힘 x', unit: 'N' },
      { id: 'FpY', label: '미는 힘 y', unit: 'N' },
    ],
    compute: (world, out) => {
      const b = world.bodies[0]!;
      const track = world.tracks[0]!;
      const seg = track.segments[0]!;
      // 직선 트랙이므로 접선/법선이 상수입니다.
      let tx = 1;
      let ty = 0;
      if (seg.kind === 'line') {
        const dx = seg.b.x - seg.a.x;
        const dy = seg.b.y - seg.a.y;
        const L = Math.hypot(dx, dy) || 1;
        tx = dx / L;
        ty = dy / L;
      }
      const nx = -ty;
      const ny = tx;

      const m = b.mass;
      const N = Math.max(0, b.normalForce);
      const Fpush = appliedForceMagnitude(world, 0);
      const FgT = m * world.fields.gravity.y * ty; // 중력의 접선 성분
      // 알짜 접선력 = m·a_t. 트랙 물체의 a 는 데카르트이므로 접선 투영합니다.
      const netT = m * (b.a.x * tx + b.a.y * ty);
      const Ffric = netT - (Fpush + FgT);

      out[0] = b.s;
      out[1] = b.u;
      out[2] = netT / m;
      out[3] = Fpush;
      out[4] = Ffric;
      out[5] = N;
      out[6] = netT;
      out[7] = b.sticking ? 1 : 0;

      out[8] = 0;
      out[9] = m * world.fields.gravity.y;
      out[10] = N * nx;
      out[11] = N * ny;
      out[12] = Ffric * tx;
      out[13] = Ffric * ty;
      out[14] = Fpush * tx;
      out[15] = Fpush * ty;
    },
  },

  prediction: {
    kind: 'choice',
    prompt:
      '마찰이 전혀 없는 평평한 바닥(μs = 0, 경사각 0°)에서 상자를 밀다가 손을 떼면, 그 다음 상자는?',
    choices: [
      '점점 느려지다가 결국 멈춘다',
      '손을 떼는 순간 곧바로 멈춘다',
      '속력이 변하지 않고 계속 같은 속도로 간다',
      '점점 빨라진다',
    ],
    truth: () => 2,
    tolerance: 0,
    help: '"마찰이 전혀 없다"는 조건에 주목하세요.',
  },

  missions: [
    {
      id: 'no-friction-constant',
      title: '손을 떼도 계속 간다',
      description:
        '마찰계수를 0, 경사각을 0°로 두고 실행해서, 손을 뗀 뒤 속도가 1% 이내로 유지되는 것 확인하기',
      hint: '마찰계수 슬라이더를 0까지 내리고 경사각도 0으로 맞춰 보세요.',
      check: (t, p) => {
        if (num(p, 'mu', 0.2) > 1e-9 || num(p, 'angle', 0) > 1e-9) return false;
        const pushTime = num(p, 'pushTime', 2);
        const start = traceFirstFrame(t, (f) => traceTime(t, f) > pushTime + 0.1);
        if (start < 0 || start >= t.frameCount - 5) return false;
        const v0 = traceBody(t, start, BLOCK, B_U);
        if (Math.abs(v0) < 0.2) return false;
        for (let f = start; f < t.frameCount; f++) {
          const v = traceBody(t, f, BLOCK, B_U);
          if (Math.abs(v - v0) / Math.abs(v0) > 0.01) return false;
        }
        return true;
      },
    },
    {
      id: 'accelerate',
      title: '가속도 만들기',
      description: '미는 동안 가속도가 3.0 m/s² 이상 나오게 만들기',
      hint: 'a = 알짜힘 / 질량 입니다. 힘을 키우거나 질량을 줄여 보세요.',
      check: (t) => traceAny(t, (f) => traceScalar(t, f, 'acc') >= 3.0),
    },
    {
      id: 'stuck',
      title: '힘을 줘도 안 움직이는 상황',
      description:
        '미는 힘이 0보다 큰데도 상자가 정지마찰에 붙잡혀 1초 넘게 움직이지 않게 만들기',
      hint:
        '정지마찰의 최댓값은 μs·N 입니다. 마찰계수를 키우거나 미는 힘을 줄여 보세요. ' +
        '질량이 크면 N 도 커집니다.',
      check: (t) => {
        let run = 0;
        let best = 0;
        for (let f = 0; f < t.frameCount; f++) {
          const stuck =
            traceScalar(t, f, 'sticking') > 0.5 && traceScalar(t, f, 'Fpush') > 1e-6;
          run = stuck ? run + 1 : 0;
          if (run > best) best = run;
        }
        // 프레임 간격 1/60초 → 60프레임 = 1초
        return best >= 61;
      },
    },
  ],

  overlays: ['forceBody', 'velocityVector', 'ghostTrail', 'normalForce'],

  fbd: {
    body: 0,
    pxPerNewton: 2.2,
    arrows: [
      { label: '중력', xChannel: 'FgX', yChannel: 'FgY', colorIndex: 0, dashIndex: 0 },
      { label: '수직항력', xChannel: 'FnX', yChannel: 'FnY', colorIndex: 2, dashIndex: 1 },
      { label: '마찰력', xChannel: 'FfX', yChannel: 'FfY', colorIndex: 1, dashIndex: 2 },
      { label: '미는 힘', xChannel: 'FpX', yChannel: 'FpY', colorIndex: 4, dashIndex: 3 },
    ],
  },

  charts: [
    {
      id: 'motion',
      title: '속도와 가속도 - 시간',
      yLabel: '값',
      unit: 'm/s, m/s²',
      autoScale: true,
      series: [
        { channel: 'vel', label: '속도', colorIndex: 0, dash: [] },
        { channel: 'acc', label: '가속도', colorIndex: 1, dash: [10, 5] },
      ],
    },
    {
      id: 'forces',
      title: '힘 - 시간',
      yLabel: '힘',
      unit: 'N',
      autoScale: true,
      series: [
        { channel: 'Fpush', label: '미는 힘', colorIndex: 4, dash: [] },
        { channel: 'Ffric', label: '마찰력', colorIndex: 1, dash: [3, 4] },
        { channel: 'Fnet', label: '알짜힘', colorIndex: 2, dash: [14, 4, 3, 4] },
      ],
    },
  ],

  probe: {
    question:
      '마찰이 없는 평평한 얼음판 위에서 상자를 밀다가 손을 뗐습니다. 손을 뗀 뒤 상자에 작용하는 수평 방향 힘은?',
    choices: [
      {
        text: '0이다. 힘이 없어도 속도는 그대로 유지된다',
        correct: true,
        feedback:
          '정확합니다. 이것이 뉴턴 제1법칙입니다. 힘은 속도를 **유지**시키는 것이 아니라 **바꾸는** 것입니다.',
      },
      {
        text: '앞으로 미는 힘이 아직 남아 있어서 계속 간다',
        correct: false,
        feedback:
          '손을 뗀 순간 미는 힘은 정확히 0이 됩니다. 남아 있는 것은 힘이 아니라 **속도**입니다. ' +
          '힘 그래프에서 미는 힘이 0으로 뚝 떨어지는데도 속도는 그대로인 구간을 다시 보겠습니다.',
      },
      {
        text: '0이므로 상자는 곧바로 멈춘다',
        correct: false,
        feedback:
          '힘이 0이면 **가속도가 0**입니다. 속도가 0이 되는 게 아닙니다. ' +
          '멈추려면 뒤로 미는 힘(마찰)이 있어야 하는데, 얼음판에는 그게 없습니다.',
      },
      {
        text: '중력이 수평 방향으로도 조금 작용한다',
        correct: false,
        feedback:
          '중력은 항상 연직 아래 방향입니다. 평평한 바닥에서는 수직항력과 정확히 상쇄되어 ' +
          '수평 방향에는 아무 기여도 하지 않습니다. 자유물체도를 다시 보세요.',
      },
    ],
    rewindTo: (t) => {
      // 손을 떼는 순간 (미는 힘이 0으로 떨어지는 첫 프레임)
      const f = traceFirstFrame(
        t,
        (fr) => fr > 0 && traceScalar(t, fr, 'Fpush') === 0 && traceScalar(t, fr - 1, 'Fpush') > 0,
      );
      return f < 0 ? Math.floor(t.frameCount / 2) : f;
    },
    rewindCaption:
      '손을 뗀 순간입니다. 미는 힘이 0이 되었는데 상자는 어떻게 되는지 보세요.',
  },

  explain: `## 정리: 힘은 속도를 만드는 게 아니라 속도를 **바꾼다**

$$\\vec{F}_{알짜} = m\\vec{a} \\qquad (\\vec{a} = \\text{속도의 변화율})$$

- 알짜힘 = 0 → **가속도가 0** → 속도가 그대로 유지 (정지든 등속이든)
- 알짜힘 ≠ 0 → 속도가 변함

### 왜 일상에서는 "밀어야 계속 간다"고 느낄까
바닥에는 언제나 마찰이 있기 때문입니다. 손을 떼면 마찰력만 남아 물체를 감속시킵니다.
$$a = \\frac{-\\mu_k N}{m} = -\\mu_k g \\quad (\\text{평면일 때})$$
그래서 **밀기를 멈추면 마찰이 이긴다**는 경험이 쌓이고,
이것이 "움직이려면 힘이 필요하다"는 오개념으로 굳어집니다.
마찰을 0으로 만들면 그 경험이 바로 무너집니다.

### 정지마찰과 운동마찰
- 정지마찰: $f \\le \\mu_s N$ — **필요한 만큼만** 생기는 힘. 고정된 크기가 아닙니다.
- 운동마찰: $f = \\mu_k N$ — 크기가 정해져 있고, 속력과 무관합니다.
- 보통 $\\mu_s > \\mu_k$ 이므로, 움직이기 시작하는 순간 마찰이 **줄어들어** 갑자기 쑥 나갑니다.

### 빗면
빗면에서는 중력을 두 방향으로 나눕니다.
$$mg\\sin\\theta \\ (\\text{빗면 방향}), \\qquad mg\\cos\\theta \\ (\\text{빗면에 수직})$$
수직항력은 $N = mg\\cos\\theta$ 이므로 경사가 급할수록 마찰의 최댓값이 **줄어듭니다**.
$\\tan\\theta > \\mu_s$ 가 되면 아무도 밀지 않아도 미끄러지기 시작합니다.`,

  duration: 10,
  view: (p) => {
    const angle = num(p, 'angle', 0);
    const { tx, ty } = slopeUnit(angle);
    const span = 22;
    return {
      xMin: -2,
      xMax: span * tx + 2,
      yMin: -2,
      yMax: Math.max(6, span * ty + 3),
    };
  },
  bodyTags: ['block'],
  bodyLabels: ['상자'],

  decorations: (p) => {
    const { tx, ty } = slopeUnit(num(p, 'angle', 0));
    return [
      {
        kind: 'line',
        x1: 0, y1: 0,
        x2: TRACK_LENGTH * tx, y2: TRACK_LENGTH * ty,
        label: '빗면',
        colorIndex: 7,
        dashIndex: 0,
      },
    ];
  },
};
