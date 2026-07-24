/**
 * 장면 렌더러.
 *
 * 스테이지를 전혀 몰라도 되도록 만들었습니다. 월드에 들어 있는 것
 * (물체·벽·트랙·파동)과 스테이지가 데이터로 선언한 장식(decorations)만 보고 그립니다.
 * 그래서 스테이지 파일 하나를 추가하면 렌더러를 고치지 않아도 화면에 뜹니다.
 *
 * ■ 색각 이상 대응
 *   색만으로 정보를 구분하지 않습니다. Okabe–Ito 안전 팔레트 + 선 패턴 + 글자 라벨을
 *   함께 씁니다. 흑백으로 인쇄해도 구분됩니다.
 *
 * ■ 정적/동적 분리
 *   격자·트랙·벽처럼 안 바뀌는 것은 오프스크린 캔버스에 한 번만 그려두고
 *   매 프레임 통째로 복사합니다. 매 프레임 격자선 수십 개를 stroke 하면
 *   그것만으로 느린 노트북의 프레임 예산을 절반 씁니다.
 */

import { evalTrack, trackLength } from '../engine/constraints.ts';
import { createTrackFrame, type World } from '../engine/types.ts';
import { sampleWave } from '../engine/waves.ts';
import type { Decoration } from '../content/schema.ts';
import {
  niceSpacing,
  slen,
  sx,
  sy,
  type Viewport,
} from './viewport.ts';

type Ctx = CanvasRenderingContext2D;

/** Okabe–Ito 색각 이상 안전 팔레트. */
export const PALETTE = [
  '#4c9be8', '#e8734a', '#2fbf8f', '#d982c4',
  '#e8b64c', '#7fd0ff', '#f2e05a', '#a8b2c4',
] as const;

/** 계열별 선 패턴. 색과 함께 써서 흑백에서도 구분됩니다. */
const DASHES: number[][] = [
  [], [10, 5], [3, 4], [14, 4, 3, 4],
  [7, 3, 2, 3], [2, 3], [18, 6], [5, 3, 1, 3],
];

export function color(i: number): string {
  return PALETTE[((i % PALETTE.length) + PALETTE.length) % PALETTE.length]!;
}

function dash(i: number): number[] {
  return DASHES[((i % DASHES.length) + DASHES.length) % DASHES.length]!;
}

const tf = createTrackFrame();

// ────────────────────────────────────────────────────────────
// 정적 배경 (격자 + 트랙 + 벽)
// ────────────────────────────────────────────────────────────

export function drawStatic(ctx: Ctx, vp: Viewport, world: World): void {
  ctx.clearRect(0, 0, vp.width, vp.height);
  drawGrid(ctx, vp);
  for (let i = 0; i < world.tracks.length; i++) drawTrack(ctx, vp, world, i);
  for (const w of world.walls) drawWall(ctx, vp, w.a.x, w.a.y, w.b.x, w.b.y);
}

function drawGrid(ctx: Ctx, vp: Viewport): void {
  const step = niceSpacing(vp.xMax - vp.xMin);
  const dpr = vp.dpr;
  ctx.save();
  ctx.lineWidth = Math.max(1, dpr);

  for (let x = Math.ceil(vp.xMin / step) * step; x <= vp.xMax + 1e-9; x += step) {
    ctx.strokeStyle = 'rgba(150,168,196,0.13)';
    const px = Math.round(sx(vp, x)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, vp.height);
    ctx.stroke();
  }
  for (let y = Math.ceil(vp.yMin / step) * step; y <= vp.yMax + 1e-9; y += step) {
    ctx.strokeStyle = 'rgba(150,168,196,0.13)';
    const py = Math.round(sy(vp, y)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(0, py);
    ctx.lineTo(vp.width, py);
    ctx.stroke();
  }

  // 원점 축
  ctx.strokeStyle = 'rgba(180,198,226,0.45)';
  ctx.lineWidth = Math.max(1.5, dpr * 1.5);
  if (vp.yMin <= 0 && vp.yMax >= 0) {
    const py = Math.round(sy(vp, 0)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(0, py);
    ctx.lineTo(vp.width, py);
    ctx.stroke();
  }
  if (vp.xMin <= 0 && vp.xMax >= 0) {
    const px = Math.round(sx(vp, 0)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, vp.height);
    ctx.stroke();
  }

  // 격자 간격을 글자로 밝혀 둡니다 (화살표·거리를 눈대중하지 않도록)
  ctx.fillStyle = 'rgba(190,205,230,0.75)';
  ctx.font = `${Math.round(11 * dpr)}px ui-monospace, monospace`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(`격자 한 칸 = ${step} m`, 8 * dpr, 8 * dpr);
  ctx.restore();
}

function drawWall(ctx: Ctx, vp: Viewport, ax: number, ay: number, bx: number, by: number): void {
  const dpr = vp.dpr;
  ctx.save();
  ctx.strokeStyle = '#6b7c96';
  ctx.lineWidth = Math.max(3, 3 * dpr);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(sx(vp, ax), sy(vp, ay));
  ctx.lineTo(sx(vp, bx), sy(vp, by));
  ctx.stroke();

  // 어느 쪽이 "막힌 쪽"인지 빗금으로 표시
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy);
  if (len > 1e-9) {
    const nx = -dy / len;
    const ny = dx / len;
    const count = Math.max(2, Math.min(60, Math.floor(slen(vp, len) / (12 * dpr))));
    ctx.lineWidth = Math.max(1, dpr);
    ctx.globalAlpha = 0.45;
    ctx.beginPath();
    for (let i = 0; i < count; i++) {
      const t = (i + 0.5) / count;
      const px = sx(vp, ax + dx * t);
      const py = sy(vp, ay + dy * t);
      ctx.moveTo(px, py);
      ctx.lineTo(px - nx * 9 * dpr, py + ny * 9 * dpr);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function drawTrack(ctx: Ctx, vp: Viewport, world: World, index: number): void {
  const track = world.tracks[index];
  if (!track) return;
  const total = trackLength(track);
  if (total <= 0) return;

  // 화면 해상도에 맞춰 촘촘히 샘플링 (곡선이 각져 보이지 않게)
  const samples = Math.max(64, Math.min(3000, Math.round(slen(vp, total) / 3)));
  ctx.save();
  ctx.strokeStyle = '#8fa3bf';
  ctx.lineWidth = Math.max(2.5, 3 * vp.dpr);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let i = 0; i <= samples; i++) {
    evalTrack(track, (i / samples) * total, tf);
    const px = sx(vp, tf.px);
    const py = sy(vp, tf.py);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
  ctx.restore();
}

// ────────────────────────────────────────────────────────────
// 장식 (물리에 참여하지 않는 화면 요소)
// ────────────────────────────────────────────────────────────

export function drawDecorations(ctx: Ctx, vp: Viewport, list: Decoration[]): void {
  const dpr = vp.dpr;
  ctx.save();
  ctx.font = `600 ${Math.round(12 * dpr)}px system-ui, sans-serif`;

  for (const d of list) {
    const c = color(d.kind === 'label' ? d.colorIndex : d.colorIndex);
    switch (d.kind) {
      case 'hline': {
        ctx.strokeStyle = c;
        ctx.globalAlpha = 0.7;
        ctx.lineWidth = Math.max(1.5, 1.5 * dpr);
        ctx.setLineDash(dash(d.dashIndex).map((v) => v * dpr));
        const py = Math.round(sy(vp, d.y)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(0, py);
        ctx.lineTo(vp.width, py);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
        ctx.fillStyle = c;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        ctx.fillText(d.label, vp.width - 8 * dpr, py - 3 * dpr);
        break;
      }
      case 'line': {
        ctx.strokeStyle = c;
        ctx.lineWidth = Math.max(2, 2 * dpr);
        ctx.setLineDash(dash(d.dashIndex).map((v) => v * dpr));
        ctx.beginPath();
        ctx.moveTo(sx(vp, d.x1), sy(vp, d.y1));
        ctx.lineTo(sx(vp, d.x2), sy(vp, d.y2));
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = c;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.fillText(d.label, sx(vp, d.x1) + 6 * dpr, sy(vp, d.y1) - 5 * dpr);
        break;
      }
      case 'zone': {
        ctx.fillStyle = c;
        ctx.globalAlpha = 0.22;
        ctx.fillRect(sx(vp, d.x), sy(vp, d.y + d.h), slen(vp, d.w), slen(vp, d.h));
        ctx.globalAlpha = 1;
        ctx.strokeStyle = c;
        ctx.lineWidth = Math.max(1.5, 1.5 * dpr);
        ctx.strokeRect(sx(vp, d.x), sy(vp, d.y + d.h), slen(vp, d.w), slen(vp, d.h));
        ctx.fillStyle = c;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(d.label, sx(vp, d.x + d.w / 2), sy(vp, d.y + d.h) - 4 * dpr);
        break;
      }
      case 'marker': {
        ctx.strokeStyle = c;
        ctx.lineWidth = Math.max(2, 2 * dpr);
        ctx.beginPath();
        ctx.arc(sx(vp, d.x), sy(vp, d.y), Math.max(4 * dpr, slen(vp, d.radius)), 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = c;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(d.label, sx(vp, d.x), sy(vp, d.y) + 8 * dpr);
        break;
      }
      case 'label': {
        ctx.fillStyle = c;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(d.text, sx(vp, d.x), sy(vp, d.y));
        break;
      }
    }
  }
  ctx.restore();
}

// ────────────────────────────────────────────────────────────
// 물체 + 속도 벡터 + 잔상
// ────────────────────────────────────────────────────────────

/**
 * 잔상 버퍼. 고정 크기라 매 프레임 할당이 없습니다.
 * 일정 프레임 간격으로만 점을 남깁니다 — 그래야 점 사이 간격이
 * "같은 시간 동안 간 거리"가 되어 등속·등가속을 눈으로 읽을 수 있습니다.
 */
export class Trails {
  private readonly xy: Float32Array;
  private readonly counts: Int32Array;
  private readonly heads: Int32Array;
  private tick = 0;

  constructor(
    readonly bodyCount: number,
    readonly capacity = 70,
    readonly every = 4,
  ) {
    this.xy = new Float32Array(bodyCount * capacity * 2);
    this.counts = new Int32Array(bodyCount);
    this.heads = new Int32Array(bodyCount);
  }

  clear(): void {
    this.counts.fill(0);
    this.heads.fill(0);
    this.tick = 0;
  }

  push(world: World): void {
    if (this.tick++ % this.every !== 0) return;
    for (let b = 0; b < this.bodyCount; b++) {
      const body = world.bodies[b];
      if (!body) continue;
      const head = this.heads[b]!;
      const base = (b * this.capacity + head) * 2;
      this.xy[base] = body.p.x;
      this.xy[base + 1] = body.p.y;
      this.heads[b] = (head + 1) % this.capacity;
      if (this.counts[b]! < this.capacity) this.counts[b]!++;
    }
  }

  draw(ctx: Ctx, vp: Viewport, colorIndexOf: (b: number) => number): void {
    ctx.save();
    for (let b = 0; b < this.bodyCount; b++) {
      const n = this.counts[b]!;
      if (n === 0) continue;
      ctx.fillStyle = color(colorIndexOf(b));
      const start = (this.heads[b]! - n + this.capacity) % this.capacity;
      for (let i = 0; i < n; i++) {
        const slot = (start + i) % this.capacity;
        const base = (b * this.capacity + slot) * 2;
        ctx.globalAlpha = 0.1 + 0.5 * (i / Math.max(1, n - 1));
        ctx.beginPath();
        ctx.arc(sx(vp, this.xy[base]!), sy(vp, this.xy[base + 1]!), 2.4 * vp.dpr, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }
}

export interface OverlayOptions {
  showVelocity: boolean;
  showAcceleration: boolean;
  /** 속도 1 m/s 를 몇 px 로 그릴지 */
  velocityScale: number;
  /** 가속도 1 m/s² 를 몇 px 로 그릴지 */
  accelScale: number;
  labels: string[];
}

export function drawBodies(
  ctx: Ctx,
  vp: Viewport,
  world: World,
  opts: OverlayOptions,
): void {
  const dpr = vp.dpr;
  for (let i = 0; i < world.bodies.length; i++) {
    const b = world.bodies[i]!;
    if (!b.active) continue;
    const cx = sx(vp, b.p.x);
    const cy = sy(vp, b.p.y);
    const r = Math.max(4 * dpr, slen(vp, b.radius));

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = color(b.colorIndex);
    ctx.fill();
    // 채움 위에 패턴 링을 얹어 색 외의 단서를 하나 더 줍니다.
    ctx.strokeStyle = 'rgba(10,14,22,0.85)';
    ctx.lineWidth = Math.max(1.5, 1.5 * dpr);
    ctx.setLineDash(dash(b.styleIndex).map((v) => v * dpr));
    ctx.stroke();
    ctx.setLineDash([]);

    const label = opts.labels[i] ?? b.tag;
    if (label) {
      // 물체가 겹칠 때(같은 자리에서 출발하는 비교 실험) 라벨이 포개져
      // 글자가 뭉개지지 않도록 물체마다 줄을 어긋나게 놓습니다.
      const lift = r + (5 + i * 14) * dpr;
      ctx.strokeStyle = 'rgba(10,14,22,0.9)';
      ctx.lineWidth = 3 * dpr;
      ctx.fillStyle = color(b.colorIndex);
      ctx.font = `700 ${Math.round(12 * dpr)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      // 어두운 외곽선을 먼저 깔아 배경과 겹쳐도 읽히게 합니다.
      ctx.strokeText(label, cx, cy - lift);
      ctx.fillText(label, cx, cy - lift);
      // 라벨과 물체를 잇는 가는 선 (어느 라벨이 어느 물체인지 분명하게)
      if (i > 0) {
        ctx.strokeStyle = 'rgba(200,215,240,0.3)';
        ctx.lineWidth = Math.max(1, dpr);
        ctx.beginPath();
        ctx.moveTo(cx, cy - r - 3 * dpr);
        ctx.lineTo(cx, cy - lift + 2 * dpr);
        ctx.stroke();
      }
    }
    ctx.restore();

    // 여러 물체가 나란히 같은 속도로 움직이면 화살표 끝이 한 줄에 모여
    // 숫자가 겹칩니다. 물체마다 라벨을 화살표 방향으로 조금씩 더 밀어냅니다.
    const labelGap = (6 + i * 15) * dpr;
    if (opts.showVelocity) {
      arrow(ctx, vp, cx, cy,
        cx + b.v.x * opts.velocityScale * dpr,
        cy - b.v.y * opts.velocityScale * dpr,
        color(b.colorIndex), `v ${Math.hypot(b.v.x, b.v.y).toFixed(2)} m/s`, labelGap);
    }
    if (opts.showAcceleration) {
      arrow(ctx, vp, cx, cy,
        cx + b.a.x * opts.accelScale * dpr,
        cy - b.a.y * opts.accelScale * dpr,
        '#ffffff', `a ${Math.hypot(b.a.x, b.a.y).toFixed(2)} m/s²`, labelGap);
    }
  }
}

/** 화살표 옆에 항상 수치와 단위를 적습니다 — 길이를 절대량으로 오해하지 않도록. */
function arrow(
  ctx: Ctx, vp: Viewport,
  x1: number, y1: number, x2: number, y2: number,
  stroke: string, label: string, labelGap = 6,
): void {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 3) return;
  const dpr = vp.dpr;
  const head = Math.min(len * 0.35, 11 * dpr);
  const ux = dx / len;
  const uy = dy / len;
  const bx = x2 - ux * head;
  const by = y2 - uy * head;

  ctx.save();
  ctx.strokeStyle = stroke;
  ctx.fillStyle = stroke;
  ctx.lineWidth = Math.max(1.8, 2 * dpr);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(bx, by);
  ctx.stroke();

  const wing = head * 0.5;
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(bx - uy * wing, by + ux * wing);
  ctx.lineTo(bx + uy * wing, by - ux * wing);
  ctx.closePath();
  ctx.fill();

  ctx.font = `600 ${Math.round(11 * dpr)}px ui-monospace, monospace`;
  ctx.textAlign = ux >= 0 ? 'left' : 'right';
  ctx.textBaseline = uy >= 0 ? 'top' : 'bottom';
  const lx = x2 + ux * labelGap;
  const ly = y2 + uy * labelGap;
  // 어두운 외곽선을 깔아 격자·다른 화살표와 겹쳐도 읽히게 합니다.
  ctx.strokeStyle = 'rgba(10,14,22,0.9)';
  ctx.lineWidth = 3 * dpr;
  ctx.strokeText(label, lx, ly);
  ctx.fillText(label, lx, ly);
  ctx.restore();
}

// ────────────────────────────────────────────────────────────
// 파동
// ────────────────────────────────────────────────────────────

const waveBuf = new Float32Array(400);

/**
 * 각 파동을 **따로** 그린 뒤 합성파를 굵게 그립니다.
 * 따로 보여주지 않으면 "겹치는 동안에도 두 파동이 각자 존재한다"는 사실이
 * 화면에서 사라지고, 그게 이 스테이지가 없애려는 오개념입니다.
 */
export function drawWaves(ctx: Ctx, vp: Viewport, world: World): void {
  const field = world.waves;
  if (!field) return;
  const dpr = vp.dpr;
  const t = world.time;

  for (let s = 0; s < field.sources.length; s++) {
    sampleWave(field, t, waveBuf, s);
    strokeWave(ctx, vp, field.xMin, field.xMax, waveBuf, color(s), 2, dash(s === 0 ? 0 : 1));
  }
  sampleWave(field, t, waveBuf, -1);
  strokeWave(ctx, vp, field.xMin, field.xMax, waveBuf, color(4), 3.4, []);

  ctx.save();
  ctx.font = `600 ${Math.round(12 * dpr)}px system-ui, sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const items = [
    ['파동 1', color(0)],
    ['파동 2', color(1)],
    ['합성파', color(4)],
  ] as const;
  let x = 8 * dpr;
  for (const [text, c] of items) {
    ctx.fillStyle = c;
    ctx.fillText(`— ${text}`, x, 26 * dpr);
    x += ctx.measureText(`— ${text}`).width + 14 * dpr;
  }
  ctx.restore();
}

function strokeWave(
  ctx: Ctx, vp: Viewport,
  xMin: number, xMax: number,
  ys: Float32Array,
  stroke: string, widthPx: number, dashPattern: number[],
): void {
  const n = ys.length;
  ctx.save();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = Math.max(1.5, widthPx * vp.dpr);
  ctx.lineJoin = 'round';
  ctx.setLineDash(dashPattern.map((v) => v * vp.dpr));
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const x = xMin + ((xMax - xMin) * i) / (n - 1);
    const px = sx(vp, x);
    const py = sy(vp, ys[i]!);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
  ctx.restore();
}
