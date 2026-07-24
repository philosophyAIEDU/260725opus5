/**
 * 스테이지 7 — 전기장 속 하전입자
 *
 * 겨냥 오개념: "전기력은 중력과 완전히 다른 방식으로 작용한다"
 *
 * ■ 물리 모델
 *   평행판 사이의 균일 전기장 E 에 하전입자를 수평으로 쏩니다.
 *     F = qE  (일정한 힘) → a = qE/m  (일정한 가속도)
 *   중력장 속 포물선 운동과 **수학적으로 완전히 같은 문제**입니다.
 *     중력: a = g              (질량 무관)
 *     전기: a = qE/m           (전하-질량비에 의존)
 *   유일한 차이는 "가속도가 물체의 성질에 의존하는가"입니다.
 *
 * ■ 나란히 겹쳐 보기
 *   같은 초기 속도로 출발한 **중력만 받는 공**을 유령(반투명)으로 겹쳐 그립니다.
 *   qE/m 를 g 에 맞추면 두 궤적이 정확히 포개집니다. 이 순간이
 *   "전기력도 그냥 힘이다"를 가장 강하게 보여주는 장면입니다.
 *
 * ■ 근사 조건: 하전입자에는 중력을 넣지 않습니다
 *   실제 전자 편향 실험에서 전기력은 중력보다 10¹³ 배 이상 큽니다.
 *   교과서가 늘 하는 표준 이상화이고, 여기서도 그대로 따릅니다.
 *   대신 비교용 유령 공에는 중력을 **일정한 외력 F = mg 로 명시적으로** 넣어,
 *   "두 입자가 각각 어떤 힘 하나만 받는가"가 코드에서도 분명히 보이게 했습니다.
 *
 * ■ 적분기
 *   힘이 일정하므로 velocityVerlet 이 위치를 기계정밀도로 정확히 재현합니다.
 */

import { createBody, type AppliedForce } from '../../engine/types.ts';
import { createWorld } from '../../engine/world.ts';
import { B_X, B_Y } from '../../engine/frame.ts';
import {
  num,
  traceAny,
  traceBody,
  traceScalar,
  type StageSpec,
} from '../schema.ts';

const G = 9.81;
const PLATE_LENGTH = 8;
const PLATE_GAP = 4;
/** 전하량 단위 [μC] → [C] */
const MICRO = 1e-6;
/** 질량 단위 [mg] → [kg] */
const MILLIGRAM = 1e-6;

const CHARGED = 0;
const GHOST = 1;

/** 전기력에 의한 가속도 크기 [m/s²] */
export function electricAcceleration(
  chargeMicroC: number,
  massMg: number,
  fieldVpm: number,
): number {
  return (chargeMicroC * MICRO * fieldVpm) / (massMg * MILLIGRAM);
}

export const efieldStage: StageSpec = {
  id: 'efield',
  title: '전기장 속 하전입자',
  subtitle: '전기력이 만드는 궤적과 중력이 만드는 궤적을 겹쳐 봅니다',
  domain: '전자기',
  concepts: ['전기장', '전기력', '등가속도 운동', '전하-질량비'],
  targetMisconception: '전기력은 중력과 완전히 다른 방식으로 작용한다',
  situation:
    '평행판 사이에 균일한 전기장이 아래 방향으로 걸려 있습니다. ' +
    '왼쪽에서 대전된 입자를 수평으로 쏘아 넣습니다. ' +
    '같은 속도로 출발한 "중력만 받는 공"을 회색 유령으로 함께 그립니다.',

  controls: [
    {
      kind: 'slider', id: 'charge', label: '입자의 전하량 q',
      unit: 'μC', min: 0.1, max: 10, step: 0.1, default: 2,
    },
    {
      kind: 'slider', id: 'mass', label: '입자의 질량 m',
      unit: 'mg', min: 0.1, max: 10, step: 0.1, default: 2,
    },
    {
      kind: 'slider', id: 'field', label: '전기장의 세기 E',
      unit: 'V/m', min: 0, max: 40, step: 0.1, default: 20,
      help: '아래 방향으로 걸립니다.',
    },
    {
      kind: 'slider', id: 'speed', label: '입사 속력 v₀',
      unit: 'm/s', min: 1, max: 12, step: 0.25, default: 5,
    },
  ],

  build: (p) => {
    const q = num(p, 'charge', 2) * MICRO;
    const m = num(p, 'mass', 2) * MILLIGRAM;
    const E = num(p, 'field', 20);
    const v0 = num(p, 'speed', 5);

    const ghostGravity: AppliedForce[] = [
      { body: 1, fx: 0, fy: -1 * G, startTime: 0, endTime: Infinity, label: '중력' },
    ];

    return createWorld({
      bodies: [
        // 전기력만 받는 하전입자 (중력은 이 세계에서 0)
        createBody({
          id: 0, tag: 'charged', mass: m, charge: q, radius: 0.16,
          p: { x: -PLATE_LENGTH / 2, y: 0 },
          v: { x: v0, y: 0 },
          restitution: 0,
          colorIndex: 1, styleIndex: 0,
        }),
        // 비교용 유령: 전하가 0이라 전기장의 영향을 전혀 받지 않고,
        // 아래 applied 로 넣어준 중력 F = mg 만 받습니다.
        createBody({
          id: 1, tag: 'ghost', mass: 1, charge: 0, radius: 0.16,
          p: { x: -PLATE_LENGTH / 2, y: 0 },
          v: { x: v0, y: 0 },
          restitution: 0,
          colorIndex: 7, styleIndex: 2,
        }),
      ],
      // 유령에게만 중력 F = mg 를 줍니다. 세계의 중력장은 0으로 두어
      // 하전입자가 전기력만 받도록 했습니다 (위 근사 조건 참조).
      applied: ghostGravity,
      // 극판은 실제 장애물입니다. 너무 세게 휘면 여기에 부딪혀 멈춥니다.
      walls: [
        { tag: 'plateTop', a: { x: -PLATE_LENGTH / 2, y: PLATE_GAP / 2 }, b: { x: PLATE_LENGTH / 2, y: PLATE_GAP / 2 }, restitution: 0, friction: 0.4 },
        { tag: 'plateBottom', a: { x: PLATE_LENGTH / 2, y: -PLATE_GAP / 2 }, b: { x: -PLATE_LENGTH / 2, y: -PLATE_GAP / 2 }, restitution: 0, friction: 0.4 },
      ],
      fields: {
        gravity: { x: 0, y: 0 },
        electric: { x: 0, y: -E },
      },
      integrator: 'velocityVerlet',
    });
  },

  measure: {
    channels: [
      { id: 'yCharged', label: '하전입자의 y', unit: 'm' },
      { id: 'yGhost', label: '유령(중력)의 y', unit: 'm' },
      { id: 'gap', label: '두 궤적의 차이', unit: 'm' },
      { id: 'aCharged', label: '하전입자의 가속도', unit: 'm/s²' },
      { id: 'aGhost', label: '유령의 가속도', unit: 'm/s²' },
      { id: 'vy', label: '하전입자의 연직 속도', unit: 'm/s' },
    ],
    compute: (world, out) => {
      const c = world.bodies[0]!;
      const g = world.bodies[1]!;
      out[0] = c.p.y;
      out[1] = g.p.y;
      out[2] = Math.abs(c.p.y - g.p.y);
      out[3] = Math.hypot(c.a.x, c.a.y);
      out[4] = Math.hypot(g.a.x, g.a.y);
      out[5] = c.v.y;
    },
  },

  prediction: {
    kind: 'numeric',
    prompt: '이 하전입자가 받는 가속도의 크기는 몇 m/s² 일까요?',
    unit: 'm/s²',
    min: 0, max: 200, step: 0.5,
    tolerance: 0.05,
    truth: (p) =>
      electricAcceleration(
        num(p, 'charge', 2), num(p, 'mass', 2), num(p, 'field', 20),
      ),
    help:
      '전기력 F = qE 입니다. 단위에 주의하세요 (q는 μC = 10⁻⁶ C, m은 mg = 10⁻⁶ kg). ' +
      '이 입자에는 중력을 넣지 않았습니다 (실제 편향 실험에서 무시할 수 있는 크기).',
  },

  missions: [
    {
      id: 'match-gravity',
      title: '중력과 똑같이 만들기',
      description:
        '조건을 조절해서 하전입자의 궤적이 유령(중력만 받는 공)과 0.15 m 이내로 겹치게 하기',
      hint:
        '두 궤적이 겹치려면 가속도가 같아야 합니다. 하전입자의 가속도는 qE/m, ' +
        '유령의 가속도는 g = 9.81 m/s² 입니다. 어떤 조건을 맞추면 될까요?',
      check: (t) => {
        // 판 사이(전기장이 걸려 있는 구간)에서만 비교합니다.
        // 판을 빠져나간 뒤에는 실제 장치에도 전기장이 없으므로 비교 대상이 아닙니다.
        let compared = 0;
        let deflection = 0;
        for (let f = 0; f < t.frameCount; f++) {
          if (traceBody(t, f, CHARGED, B_X) > PLATE_LENGTH / 2) break;
          if (traceScalar(t, f, 'gap') > 0.15) return false;
          deflection = Math.abs(traceScalar(t, f, 'yCharged'));
          compared++;
        }
        // 실제로 휘어진 구간을 충분히 봤어야 의미가 있습니다.
        return compared >= 10 && deflection > 0.5;
      },
    },
    {
      id: 'double-accel',
      title: '중력의 두 배로 휘게 하기',
      description: '하전입자의 가속도를 19.6 m/s² 이상(중력의 2배 이상)으로 만들기',
      hint: 'a = qE/m 입니다. 전하량이나 전기장을 키우거나 질량을 줄여 보세요.',
      check: (t) => traceAny(t, (f) => traceScalar(t, f, 'aCharged') >= 2 * G),
    },
    {
      id: 'exit-plates',
      title: '판 사이를 빠져나가기',
      description:
        '입자가 위아래 판에 부딪히지 않고 오른쪽 끝(x = 4 m)까지 도달하게 하기',
      hint:
        '너무 세게 휘면 판에 부딪힙니다. 입사 속력을 키우면 판 사이에 머무는 시간이 짧아집니다.',
      check: (t) => {
        const half = PLATE_GAP / 2;
        for (let f = 0; f < t.frameCount; f++) {
          if (Math.abs(traceBody(t, f, CHARGED, B_Y)) >= half - 0.17) return false;
          if (traceBody(t, f, CHARGED, B_X) >= PLATE_LENGTH / 2) return true;
        }
        return false;
      },
    },
  ],

  overlays: ['velocityVector', 'accelerationVector', 'ghostTrail', 'fieldArrows', 'ruler'],

  charts: [
    {
      id: 'trajectory',
      title: '두 궤적의 y 좌표 - 시간',
      yLabel: 'y 좌표',
      unit: 'm',
      autoScale: true,
      series: [
        { channel: 'yCharged', label: '하전입자 (전기력)', colorIndex: 1, dash: [] },
        { channel: 'yGhost', label: '유령 (중력만)', colorIndex: 7, dash: [3, 4] },
      ],
    },
    {
      id: 'accel',
      title: '가속도 - 시간',
      yLabel: '가속도',
      unit: 'm/s²',
      autoScale: true,
      series: [
        { channel: 'aCharged', label: '하전입자', colorIndex: 1, dash: [] },
        { channel: 'aGhost', label: '유령', colorIndex: 7, dash: [3, 4] },
      ],
    },
  ],

  probe: {
    question:
      '균일한 전기장 속 하전입자의 궤적이 중력장 속 포물선과 똑같은 모양이 나오는 이유는?',
    choices: [
      {
        text: '두 경우 모두 크기와 방향이 일정한 힘이 작용해서, 같은 등가속도 운동 방정식을 따르기 때문',
        correct: true,
        feedback:
          '정확합니다. 힘의 **출처**가 무엇이든 "일정한 힘"이면 운동은 똑같습니다. ' +
          'F = qE 도 F = mg 도 결국 F = ma 를 통해 같은 포물선을 만듭니다.',
      },
      {
        text: '전기력이 사실은 중력의 한 종류이기 때문',
        correct: false,
        feedback:
          '전기력과 중력은 서로 다른 기본 상호작용입니다(세기 차이가 10³⁶배 정도 납니다). ' +
          '같은 것은 힘의 정체가 아니라 **운동방정식의 형태**입니다.',
      },
      {
        text: '우연히 비슷해 보일 뿐 실제 궤적은 다르다',
        correct: false,
        feedback:
          '우연이 아닙니다. 조건을 맞추면 두 궤적이 **완전히 포개집니다**. ' +
          '유령과 겹치는 순간을 다시 보겠습니다.',
      },
      {
        text: '전기장이 중력장과 같은 방향으로 걸려 있어서',
        correct: false,
        feedback:
          '방향만 같다고 궤적이 같아지지는 않습니다. 크기까지 맞아야 합니다. ' +
          '전기장 세기를 바꿔보면 유령과 어긋나는 것을 볼 수 있습니다.',
      },
    ],
    rewindTo: (t) => Math.max(0, Math.floor(t.frameCount * 0.7)),
    rewindCaption:
      '하전입자(주황)와 유령(회색)의 궤적을 비교해 보세요. 조건을 맞추면 완전히 포개집니다.',
  },

  explain: `## 정리: 힘의 출처가 달라도 운동방정식은 하나다

$$\\vec{F}_{알짜} = m\\vec{a}$$

이 식은 힘이 어디서 왔는지 **묻지 않습니다**. 일정한 힘이면 결과는 언제나 등가속도 운동입니다.

| | 중력 | 전기력 |
|---|---|---|
| 힘 | $F = mg$ | $F = qE$ |
| 가속도 | $a = g$ (질량 무관) | $a = \\dfrac{qE}{m}$ (전하-질량비에 의존) |
| 궤적 | 포물선 | 포물선 |

### 진짜 차이는 여기
중력에서는 질량이 약분되어 **모든 물체가 같은 가속도**를 받습니다(스테이지 1).
전기력에서는 약분되지 않아 **전하-질량비 $q/m$ 가 큰 입자일수록 크게 휩니다**.
톰슨이 전자의 $e/m$ 을 측정한 것이 바로 이 원리입니다.

### 편향의 크기
판 길이 $L$, 입사 속력 $v_0$ 일 때 판을 빠져나오는 동안의 편향은
$$y = \\frac{1}{2}\\left(\\frac{qE}{m}\\right)\\left(\\frac{L}{v_0}\\right)^2$$
빠르게 쏠수록 덜 휩니다. 판 사이에 머무는 **시간**이 짧아지기 때문입니다.
힘이 약해진 게 아닙니다.`,

  duration: 8,
  view: {
    xMin: -PLATE_LENGTH / 2 - 1,
    xMax: PLATE_LENGTH / 2 + 2,
    yMin: -PLATE_GAP / 2 - 0.8,
    yMax: PLATE_GAP / 2 + 0.8,
  },
  bodyTags: ['charged', 'ghost'],

  decorations: () => [
    {
      kind: 'line', x1: -PLATE_LENGTH / 2, y1: PLATE_GAP / 2,
      x2: PLATE_LENGTH / 2, y2: PLATE_GAP / 2,
      label: '+ 극판', colorIndex: 1, dashIndex: 0,
    },
    {
      kind: 'line', x1: -PLATE_LENGTH / 2, y1: -PLATE_GAP / 2,
      x2: PLATE_LENGTH / 2, y2: -PLATE_GAP / 2,
      label: '− 극판', colorIndex: 0, dashIndex: 0,
    },
    { kind: 'hline', y: 0, label: '입사선', colorIndex: 7, dashIndex: 2 },
    {
      kind: 'marker', x: PLATE_LENGTH / 2, y: 0,
      label: '판 끝', colorIndex: 2, radius: 0.1,
    },
  ],
};

export { GHOST, PLATE_GAP, PLATE_LENGTH };
