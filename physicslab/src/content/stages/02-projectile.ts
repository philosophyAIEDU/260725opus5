/**
 * 스테이지 2 — 명중!
 *
 * 겨냥 오개념: "최고점에서는 힘이 0이다"
 *
 * ■ 물리 모델
 *   공기저항 없는 포물선 운동. 수평은 등속, 연직은 등가속도.
 *     x(t) = v₀cosθ·t,   y(t) = v₀sinθ·t − ½gt²
 *   사거리 R = v₀²sin(2θ)/g   (발사 높이 = 착지 높이일 때)
 *
 * ■ 왜 "최고점에서 힘이 0"이 나오는가
 *   학생은 v = 0 과 F = 0 을 구분하지 않습니다. 최고점에서 **연직 속도**는
 *   0이지만 가속도는 여전히 아래쪽 9.81 m/s² 입니다. 속도가 0인 순간에도
 *   힘이 있기 때문에 다음 순간 아래로 움직이기 시작하는 것입니다.
 *   그래서 이 스테이지는 최고점에서 중력 화살표를 강조하고,
 *   속도를 x/y 성분으로 분해해 "v_y 만 0이고 v_x 는 그대로"임을 보여줍니다.
 *
 * ■ 적분기
 *   보존력(중력)만 작용 → velocityVerlet. 등가속도에서는 베를레가
 *   위치를 기계정밀도로 정확히 재현합니다(2차 다항식을 정확히 적분).
 *
 * ■ 근사 조건
 *   공기저항 무시. 실제 야구공은 이 근사에서 20% 이상 벗어나지만,
 *   이 스테이지의 학습 목표는 "속도와 힘의 구분"이므로 방해 요인을 뺐습니다.
 *   공기저항이 있는 낙하는 스테이지 1에서 다룹니다.
 */

import { createBody } from '../../engine/types.ts';
import { createWorld } from '../../engine/world.ts';
import { BF_RESTING, B_X } from '../../engine/frame.ts';
import {
  num,
  traceBody,
  traceFirstFrame,
  traceFrameOfMax,
  traceBodyFlag,
  type StageSpec,
  type Trace,
} from '../schema.ts';

const G = 9.81;
const BALL = 0;
const RADIUS = 0.12;

/** 착지 지점 x [m]. 멈춘 첫 프레임의 위치. 끝까지 안 멈추면 NaN. */
function landingX(t: Trace): number {
  const f = traceFirstFrame(t, (fr) => traceBodyFlag(t, fr, BALL, BF_RESTING));
  return f < 0 ? NaN : traceBody(t, f, BALL, B_X);
}

export const projectileStage: StageSpec = {
  id: 'projectile',
  title: '명중!',
  subtitle: '대포의 속력과 각도를 조절해 과녁을 맞혀 봅니다',
  domain: '역학',
  concepts: ['포물선 운동', '벡터의 성분 분해', '등속과 등가속도의 합성'],
  targetMisconception: '최고점에서는 힘(또는 가속도)이 0이다',
  situation:
    '평평한 땅 위의 대포에서 공을 쏩니다. 공기저항은 없다고 봅니다. ' +
    '과녁은 정해진 거리에 놓여 있습니다.',

  controls: [
    {
      kind: 'slider', id: 'speed', label: '발사 속력 v₀',
      unit: 'm/s', min: 5, max: 40, step: 0.5, default: 20,
    },
    {
      kind: 'slider', id: 'angle', label: '발사 각도 θ',
      unit: '°', min: 10, max: 85, step: 1, default: 45,
      help: '수평면과 이루는 각입니다.',
    },
    {
      kind: 'slider', id: 'target', label: '과녁까지의 거리',
      unit: 'm', min: 10, max: 70, step: 1, default: 35,
    },
  ],

  build: (p) => {
    const v0 = num(p, 'speed', 20);
    const deg = num(p, 'angle', 45);
    const th = (deg * Math.PI) / 180;

    return createWorld({
      bodies: [
        createBody({
          id: 0, tag: 'ball', mass: 0.45, radius: RADIUS,
          p: { x: 0, y: 0 },
          v: { x: v0 * Math.cos(th), y: v0 * Math.sin(th) },
          restitution: 0,
          colorIndex: 1, styleIndex: 0,
        }),
      ],
      // 바닥을 y = −r 에 두면 공의 **중심**이 정확히 y = 0 에서 멈춥니다.
      // 그래야 착지 x 가 해석해 R = v₀²sin(2θ)/g 와 직접 비교됩니다.
      walls: [
        { tag: 'ground', a: { x: -2, y: -RADIUS }, b: { x: 300, y: -RADIUS }, restitution: 0, friction: 0.9 },
      ],
      fields: { gravity: { x: 0, y: -G } },
      integrator: 'velocityVerlet',
    });
  },

  measure: {
    channels: [
      { id: 'vx', label: '수평 속도 vₓ', unit: 'm/s' },
      { id: 'vy', label: '연직 속도 v_y', unit: 'm/s' },
      { id: 'speed', label: '속력', unit: 'm/s' },
      { id: 'height', label: '높이', unit: 'm' },
      { id: 'ay', label: '연직 가속도', unit: 'm/s²' },
      { id: 'range', label: '수평 이동 거리', unit: 'm' },
    ],
    compute: (world, out) => {
      const b = world.bodies[0]!;
      out[0] = b.v.x;
      out[1] = b.v.y;
      out[2] = Math.hypot(b.v.x, b.v.y);
      out[3] = b.p.y;
      out[4] = b.a.y;
      out[5] = b.p.x;
    },
  },

  prediction: {
    kind: 'numeric',
    prompt: '이 조건에서 공은 몇 미터 날아가 땅에 떨어질까요?',
    unit: 'm',
    min: 0, max: 180, step: 0.5,
    tolerance: 0.05,
    truth: (p) => {
      const v0 = num(p, 'speed', 20);
      const th = (num(p, 'angle', 45) * Math.PI) / 180;
      return (v0 * v0 * Math.sin(2 * th)) / G;
    },
    help: '발사 지점과 착지 지점의 높이는 같습니다.',
  },

  missions: [
    {
      id: 'hit',
      title: '명중',
      description: '과녁 중심에서 0.6 m 이내에 떨어뜨리기',
      hint: '사거리는 속력의 제곱에 비례하고, 각도에 대해서는 sin(2θ)를 따릅니다.',
      check: (t, p) => {
        const x = landingX(t);
        return Number.isFinite(x) && Math.abs(x - num(p, 'target', 35)) <= 0.6;
      },
    },
    {
      id: 'low-angle',
      title: '낮게 쏴서 명중',
      description: '40° 이하의 각도로 과녁 맞히기',
      hint: '같은 사거리를 만드는 각도는 하나가 아닙니다. 낮은 쪽 해를 찾아보세요.',
      check: (t, p) => {
        const x = landingX(t);
        return (
          Number.isFinite(x) &&
          Math.abs(x - num(p, 'target', 35)) <= 0.6 &&
          num(p, 'angle', 45) <= 40
        );
      },
    },
    {
      id: 'high-angle',
      title: '높게 쏴서 명중',
      description: '55° 이상의 각도로 같은 과녁 맞히기',
      hint: 'sin(2θ) 는 θ 와 90°−θ 에서 값이 같습니다. 낮은 각의 짝을 생각해 보세요.',
      check: (t, p) => {
        const x = landingX(t);
        return (
          Number.isFinite(x) &&
          Math.abs(x - num(p, 'target', 35)) <= 0.6 &&
          num(p, 'angle', 45) >= 55
        );
      },
    },
  ],

  overlays: [
    'velocityVector',
    'accelerationVector',
    'componentSplit',
    'ghostTrail',
    'apexMarker',
    'ruler',
  ],

  charts: [
    {
      id: 'components',
      title: '속도 성분 - 시간',
      yLabel: '속도',
      unit: 'm/s',
      autoScale: true,
      series: [
        { channel: 'vx', label: '수평 vₓ', colorIndex: 0, dash: [] },
        { channel: 'vy', label: '연직 v_y', colorIndex: 1, dash: [10, 5] },
      ],
    },
    {
      id: 'accel',
      title: '연직 가속도 - 시간',
      yLabel: '가속도',
      unit: 'm/s²',
      autoScale: false,
      yMin: -12,
      yMax: 2,
      series: [{ channel: 'ay', label: '가속도 a_y', colorIndex: 3, dash: [3, 4] }],
    },
  ],

  probe: {
    question: '공이 최고점에 도달한 바로 그 순간, 공에 작용하는 알짜힘은?',
    choices: [
      {
        text: '아래쪽으로 mg (날아가는 내내 변하지 않는다)',
        correct: true,
        feedback:
          '맞습니다. 공기저항이 없으면 발사 순간부터 착지까지 작용하는 힘은 중력 하나뿐입니다. ' +
          '최고점이라고 특별할 게 없습니다.',
      },
      {
        text: '0이다 (속도가 순간적으로 멈추므로)',
        correct: false,
        feedback:
          '멈춘 것은 속도의 **연직 성분**뿐이고, 수평 속도는 그대로입니다. ' +
          '그리고 힘이 0이면 그 상태로 계속 떠 있어야 하는데 공은 곧바로 내려옵니다. ' +
          '최고점 순간으로 되감아 가속도 화살표를 직접 보겠습니다.',
      },
      {
        text: '위쪽으로 mg (올라가는 힘이 아직 남아 있다)',
        correct: false,
        feedback:
          '"올라가는 힘"이라는 것은 없습니다. 손을 떠난 뒤 공을 위로 미는 것은 아무것도 없습니다. ' +
          '남아 있는 것은 힘이 아니라 **속도**입니다. 최고점 장면을 확인해 보세요.',
      },
      {
        text: '진행 방향(비스듬히 앞)으로 작용한다',
        correct: false,
        feedback:
          '힘은 속도의 방향과 아무 상관이 없습니다. 가속도 화살표는 날아가는 내내 ' +
          '똑바로 아래를 향합니다. 최고점 장면에서 확인해 보세요.',
      },
    ],
    rewindTo: (t) => traceFrameOfMax(t, 'height'),
    rewindCaption:
      '최고점입니다. 연직 속도 v_y = 0 이지만 가속도 화살표는 여전히 아래로 9.81 m/s² 입니다.',
  },

  explain: `## 정리: 속도가 0인 것과 힘이 0인 것은 다르다

공중의 공에 작용하는 힘은 **중력 하나**뿐입니다(공기저항 무시).
$$\\vec{F} = (0,\\ -mg) \\quad \\Rightarrow \\quad \\vec{a} = (0,\\ -g)$$

발사 순간에도, 최고점에서도, 착지 직전에도 **똑같습니다**.

### 최고점에서 실제로 일어나는 일
- 연직 속도 $v_y$ : $+v_0\\sin\\theta \\rightarrow 0 \\rightarrow -v_0\\sin\\theta$ (계속 변함)
- 수평 속도 $v_x = v_0\\cos\\theta$ : **한 번도 변하지 않음** (수평 힘이 없으므로)
- 가속도 : 내내 아래쪽 $g$

$v_y$ 가 0을 지나가는 것은 **부호가 바뀌는 중**이라는 뜻이지 힘이 없다는 뜻이 아닙니다.
오히려 힘이 계속 있기 때문에 $v_y$ 가 계속 줄어들어 0을 지나 음수가 되는 것입니다.

### 사거리 공식
$$R = \\frac{v_0^2 \\sin 2\\theta}{g}$$

$\\sin 2\\theta$ 는 $\\theta$ 와 $90° - \\theta$ 에서 값이 같습니다.
그래서 30°와 60°, 20°와 70°는 **같은 곳에 떨어집니다**. 다른 것은 비행시간과 최고점 높이입니다.`,

  duration: 12,
  view: (p) => {
    const target = num(p, 'target', 35);
    const v0 = num(p, 'speed', 20);
    const th = (num(p, 'angle', 45) * Math.PI) / 180;
    const range = (v0 * v0 * Math.sin(2 * th)) / G;
    const apex = (v0 * Math.sin(th)) ** 2 / (2 * G);
    const xMax = Math.max(target + 8, range + 8, 20);
    return { xMin: -3, xMax, yMin: -2, yMax: Math.max(apex + 4, xMax * 0.35) };
  },
  bodyTags: ['ball'],
  bodyLabels: ['포탄'],

  decorations: (p) => {
    const target = num(p, 'target', 35);
    return [
      { kind: 'hline', y: 0, label: '지면', colorIndex: 7, dashIndex: 0 },
      { kind: 'zone', x: target - 0.6, y: 0, w: 1.2, h: 0.9, label: '과녁', colorIndex: 2 },
      { kind: 'marker', x: target, y: 0, label: `${target.toFixed(0)} m`, colorIndex: 2, radius: 0.25 },
      { kind: 'label', x: 0, y: -1.1, text: '대포', colorIndex: 7 },
    ];
  },
};
