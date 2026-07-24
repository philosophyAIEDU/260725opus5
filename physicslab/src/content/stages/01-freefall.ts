/**
 * 스테이지 1 — 낙하의 비밀
 *
 * 겨냥 오개념: "무거운 물체가 빨리 떨어진다"
 *
 * ■ 물리 모델
 *   진공 기둥: F = mg 만 작용 → a = g. 질량이 소거되어 **모든 물체가 같은 운동**.
 *   공기 기둥: F = mg − c|v|v,  c = ½ρC_dA (구, C_d ≈ 0.47, ρ = 1.225 kg/m³)
 *              종단속도 v_t = √(mg/c) — 질량에 비례해 커집니다.
 *
 * ■ 이 스테이지의 핵심
 *   "무거운 게 빨리 떨어진다"는 관찰 자체는 **일상에서 대체로 맞습니다**.
 *   틀린 건 그 이유입니다. 원인은 질량이 아니라 공기저항이고,
 *   공기를 없애면 관찰이 뒤집힙니다. 그래서 진공/공기를 **나란히** 보여줍니다.
 *   한쪽만 보여주면 학생은 자기 경험과 충돌해 시뮬레이션을 안 믿습니다.
 *
 * ■ 적분기
 *   속도 의존 힘(2차 항력)이 있으므로 semiImplicitPC. 베를레는 a(p) 전제라
 *   여기서는 종단속도 근처에서 오차가 남습니다.
 */

import { createBody } from '../../engine/types.ts';
import { createWorld } from '../../engine/world.ts';
import { BF_RESTING, B_AY, B_VY, B_Y } from '../../engine/frame.ts';
import {
  num,
  traceAny,
  traceBody,
  traceFrameAtTime,
  traceLandingTime,
  type StageSpec,
} from '../schema.ts';

/** 공기 밀도 [kg/m³] (1기압 20 ℃) */
const RHO = 1.225;
/** 구의 항력계수 (레이놀즈수 10⁴~10⁵ 구간) */
const CD = 0.47;

/** 2차 항력계수 c = ½ρC_dA [kg/m] */
function dragCoefficient(radius: number): number {
  return 0.5 * RHO * CD * Math.PI * radius * radius;
}

const VAC_LIGHT = 0;
const VAC_HEAVY = 1;
const AIR_LIGHT = 2;
const AIR_HEAVY = 3;

export const freefallStage: StageSpec = {
  id: 'freefall',
  title: '낙하의 비밀',
  subtitle: '진공과 공기 중에서 무거운 공과 가벼운 공을 나란히 떨어뜨려 봅니다',
  domain: '역학',
  concepts: ['등가속도 운동', '중력', '공기저항', '종단속도'],
  targetMisconception: '무거운 물체가 가벼운 물체보다 빨리 떨어진다',
  situation:
    '왼쪽은 공기를 모두 빼낸 진공 기둥, 오른쪽은 보통 공기가 든 기둥입니다. ' +
    '각 기둥에 크기가 똑같고 질량만 다른 두 공을 같은 높이에서 동시에 놓습니다.',

  controls: [
    {
      kind: 'slider', id: 'massLight', label: '가벼운 공의 질량',
      unit: 'kg', min: 0.05, max: 3, step: 0.05, default: 0.2,
      help: '두 공의 크기는 항상 같습니다. 질량만 다릅니다.',
    },
    {
      kind: 'slider', id: 'massHeavy', label: '무거운 공의 질량',
      unit: 'kg', min: 0.5, max: 20, step: 0.5, default: 5,
    },
    {
      kind: 'slider', id: 'radius', label: '두 공의 반지름',
      unit: 'm', min: 0.03, max: 0.3, step: 0.01, default: 0.15,
      help: '반지름이 커지면 공기와 부딪히는 단면적이 넓어집니다.',
    },
    {
      kind: 'slider', id: 'height', label: '떨어뜨리는 높이',
      unit: 'm', min: 5, max: 60, step: 1, default: 30,
    },
  ],

  build: (p) => {
    const mL = num(p, 'massLight', 0.2);
    const mH = num(p, 'massHeavy', 5);
    const r = num(p, 'radius', 0.15);
    const h = num(p, 'height', 30);
    const c = dragCoefficient(r);

    const make = (
      id: number, tag: string, x: number, mass: number,
      drag: number, colorIndex: number, styleIndex: number,
    ) =>
      createBody({
        id, tag, mass, radius: r,
        p: { x, y: h },
        v: { x: 0, y: 0 },
        dragQuad: drag,
        // 튕기면 낙하 시간 비교가 흐려지므로 완전비탄성으로 딱 멈추게 합니다.
        restitution: 0,
        colorIndex, styleIndex,
      });

    return createWorld({
      bodies: [
        make(0, 'vacLight', -3.4, mL, 0, 0, 0),
        make(1, 'vacHeavy', -1.4, mH, 0, 1, 1),
        make(2, 'airLight', 1.4, mL, c, 2, 2),
        make(3, 'airHeavy', 3.4, mH, c, 3, 3),
      ],
      walls: [
        { tag: 'floor', a: { x: -6, y: 0 }, b: { x: 6, y: 0 }, restitution: 0, friction: 0.5 },
      ],
      fields: { gravity: { x: 0, y: -9.81 } },
      integrator: 'semiImplicitPC',
    });
  },

  measure: {
    channels: [
      { id: 'yVacLight', label: '진공·가벼움 높이', unit: 'm' },
      { id: 'yVacHeavy', label: '진공·무거움 높이', unit: 'm' },
      { id: 'yAirLight', label: '공기·가벼움 높이', unit: 'm' },
      { id: 'yAirHeavy', label: '공기·무거움 높이', unit: 'm' },
      { id: 'vVacLight', label: '진공·가벼움 속력', unit: 'm/s' },
      { id: 'vVacHeavy', label: '진공·무거움 속력', unit: 'm/s' },
      { id: 'vAirLight', label: '공기·가벼움 속력', unit: 'm/s' },
      { id: 'vAirHeavy', label: '공기·무거움 속력', unit: 'm/s' },
    ],
    compute: (world, out) => {
      for (let i = 0; i < 4; i++) {
        const b = world.bodies[i]!;
        out[i] = b.p.y;
        out[4 + i] = Math.abs(b.v.y);
      }
    },
  },

  prediction: {
    kind: 'numeric',
    prompt:
      '진공 기둥에서, 무거운 공이 바닥에 닿은 뒤 가벼운 공이 닿기까지 걸리는 시간은 몇 초일까요? ' +
      '(가벼운 공이 먼저 닿는다고 생각하면 음수로 입력하세요)',
    unit: 's',
    min: -3, max: 3, step: 0.05,
    tolerance: 0.05,
    truth: () => 0,
    help: '두 공의 크기는 같고 질량만 다릅니다. 진공이므로 공기저항은 전혀 없습니다.',
  },

  missions: [
    {
      id: 'vacuum-tie',
      title: '진공에서는 무승부',
      description: '진공 기둥의 두 공이 0.02초 이내 차이로 바닥에 닿는 것을 확인하기',
      hint: '진공 기둥의 공은 질량과 상관없이 같은 가속도로 떨어집니다. 그냥 한 번 실행해 보세요.',
      check: (t) => {
        const a = traceLandingTime(t, VAC_LIGHT, BF_RESTING);
        const b = traceLandingTime(t, VAC_HEAVY, BF_RESTING);
        if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
        return Math.abs(a - b) <= 0.02;
      },
    },
    {
      id: 'terminal-speed',
      title: '종단속도 목격하기',
      description:
        '공기 기둥의 가벼운 공이 낙하 도중 가속도가 g의 10% 아래로 떨어지는 순간 만들기',
      hint: '반지름을 키우거나 가벼운 공을 더 가볍게 하면 공기저항이 중력을 더 빨리 따라잡습니다.',
      check: (t) =>
        traceAny(t, (f) => {
          const y = traceBody(t, f, AIR_LIGHT, B_Y);
          const vy = traceBody(t, f, AIR_LIGHT, B_VY);
          const ay = traceBody(t, f, AIR_LIGHT, B_AY);
          return y > 1 && Math.abs(vy) > 0.5 && Math.abs(ay) < 0.981;
        }),
    },
    {
      id: 'air-tie',
      title: '공기 중에서도 비기게 만들기',
      description:
        '조건을 바꿔서 공기 기둥의 두 공이 0.3초 이내 차이로 바닥에 닿게 하기',
      hint:
        '공기저항이 있어도 두 공이 거의 같이 떨어지려면? 저항의 영향이 작아지는 쪽으로 밀어보세요.',
      check: (t) => {
        const a = traceLandingTime(t, AIR_LIGHT, BF_RESTING);
        const b = traceLandingTime(t, AIR_HEAVY, BF_RESTING);
        if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
        return Math.abs(a - b) <= 0.3;
      },
    },
  ],

  overlays: ['velocityVector', 'ghostTrail', 'ruler'],

  charts: [
    {
      id: 'speed',
      title: '속력 - 시간',
      yLabel: '속력',
      unit: 'm/s',
      autoScale: true,
      series: [
        { channel: 'vVacLight', label: '진공·가벼움', colorIndex: 0, dash: [] },
        { channel: 'vVacHeavy', label: '진공·무거움', colorIndex: 1, dash: [10, 5] },
        { channel: 'vAirLight', label: '공기·가벼움', colorIndex: 2, dash: [3, 4] },
        { channel: 'vAirHeavy', label: '공기·무거움', colorIndex: 3, dash: [14, 4, 3, 4] },
      ],
    },
    {
      id: 'height',
      title: '높이 - 시간',
      yLabel: '높이',
      unit: 'm',
      autoScale: true,
      series: [
        { channel: 'yVacLight', label: '진공·가벼움', colorIndex: 0, dash: [] },
        { channel: 'yVacHeavy', label: '진공·무거움', colorIndex: 1, dash: [10, 5] },
        { channel: 'yAirLight', label: '공기·가벼움', colorIndex: 2, dash: [3, 4] },
        { channel: 'yAirHeavy', label: '공기·무거움', colorIndex: 3, dash: [14, 4, 3, 4] },
      ],
    },
  ],

  probe: {
    question:
      '진공 기둥에서 0.2 kg 공과 5 kg 공이 동시에 바닥에 닿았습니다. 그 이유로 가장 알맞은 것은?',
    choices: [
      {
        text: '무거운 공에는 더 큰 중력이 작용하지만, 그만큼 관성(질량)도 커서 가속도가 같아지기 때문',
        correct: true,
        feedback:
          '정확합니다. F = mg 이고 a = F/m 이므로 a = g 로 질량이 소거됩니다. ' +
          '무거운 공은 더 세게 당겨지지만 그만큼 움직이기 어렵습니다.',
      },
      {
        text: '진공에서는 중력이 작용하지 않기 때문',
        correct: false,
        feedback:
          '중력은 공기와 무관합니다. 진공에서도 그대로 작용하고, 그래서 두 공 모두 떨어졌습니다. ' +
          '떨어지는 장면을 다시 보겠습니다.',
      },
      {
        text: '두 공에 작용하는 중력의 크기가 같기 때문',
        correct: false,
        feedback:
          '중력의 크기는 다릅니다(5 kg 공이 25배 큽니다). 같아지는 것은 힘이 아니라 가속도입니다. ' +
          '속력 그래프에서 두 선이 겹치는 것을 다시 확인해 보세요.',
      },
      {
        text: '높이가 낮아서 차이가 나타날 시간이 없었기 때문',
        correct: false,
        feedback:
          '높이를 60 m로 올려도 두 공은 계속 같이 떨어집니다. 높이 문제가 아닙니다. ' +
          '직접 확인해 보세요.',
      },
    ],
    rewindTo: (t) => {
      // 진공 두 공이 나란히 떨어지는 중간 지점 — 가장 설득력 있는 장면
      const land = traceLandingTime(t, VAC_HEAVY, BF_RESTING);
      return traceFrameAtTime(t, Number.isFinite(land) ? land * 0.6 : 1);
    },
    rewindCaption:
      '진공 기둥의 두 공을 보세요. 질량이 25배 차이인데 높이가 정확히 같습니다.',
  },

  explain: `## 정리: 왜 진공에서는 같이 떨어질까

중력은 질량에 **비례**합니다.
$$F = mg$$

그런데 가속도는 힘을 질량으로 **나눈** 값입니다.
$$a = \\frac{F}{m} = \\frac{mg}{m} = g$$

질량이 위아래에서 약분됩니다. 무거운 공은 더 세게 당겨지지만, 정확히 그만큼 **움직이기 어렵습니다**(관성이 큽니다). 두 효과가 정확히 상쇄되어 모든 물체가 같은 가속도로 떨어집니다.

### 그럼 일상에서는 왜 무거운 게 빨리 떨어질까

공기저항 때문입니다. 공기저항은 질량이 아니라 **크기와 속력**으로 결정됩니다.
$$F_{저항} = \\tfrac{1}{2}\\rho C_d A v^2$$

중력과 저항이 같아지면 더 이상 빨라지지 않습니다. 이때의 속력이 **종단속도**입니다.
$$v_t = \\sqrt{\\frac{mg}{c}}, \\qquad c = \\tfrac{1}{2}\\rho C_d A$$

같은 크기라면 무거운 공일수록 종단속도가 큽니다. 그래서 공기 중에서는 무거운 공이 먼저 닿습니다.
**"무거우니까"가 아니라 "공기저항의 영향을 덜 받으니까"** 입니다.

### 한 줄 요약
- 진공: 질량 무관, 모두 $a = g$
- 공기: 크기가 같으면 무거운 쪽이 빠름 (종단속도가 크므로)`,

  duration: 9,
  view: (p) => {
    const h = num(p, 'height', 30);
    return { xMin: -5.5, xMax: 5.5, yMin: -1.5, yMax: h + 4 };
  },
  bodyTags: ['vacLight', 'vacHeavy', 'airLight', 'airHeavy'],
  bodyLabels: ['진공·가벼움', '진공·무거움', '공기·가벼움', '공기·무거움'],
};
