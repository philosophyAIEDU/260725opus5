/**
 * 시뮬레이션 캔버스.
 *
 * 정적 배경(격자·트랙·벽)은 오프스크린 캔버스에 한 번만 그려두고 매 프레임 복사합니다.
 * 화면 크기나 스테이지가 바뀔 때만 다시 그립니다.
 */

import { useEffect, useRef } from 'react';

import type { Simulation } from '../engine/driver.ts';
import {
  drawBodies,
  drawDecorations,
  drawStatic,
  drawWaves,
  Trails,
} from '../render/scene.ts';
import { createViewport, fitViewport } from '../render/viewport.ts';
import { resolveView, type Params, type StageSpec } from '../content/schema.ts';
import type { Playback } from './usePlayback.ts';

interface Props {
  stage: StageSpec;
  params: Params;
  playback: Playback;
  showVelocity: boolean;
  showAcceleration: boolean;
  showTrail: boolean;
}

export function SimCanvas({
  stage, params, playback, showVelocity, showAcceleration, showTrail,
}: Props): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const staticRef = useRef<HTMLCanvasElement | null>(null);
  const trailsRef = useRef<Trails | null>(null);
  const vpRef = useRef(createViewport());
  const sigRef = useRef('');

  // 오버레이 토글을 rAF 콜백에서 읽기 위해 ref 로 보관 (콜백 재등록 없이 최신값 사용)
  const optsRef = useRef({ showVelocity, showAcceleration, showTrail });
  optsRef.current = { showVelocity, showAcceleration, showTrail };

  useEffect(() => {
    trailsRef.current = new Trails(stage.bodyTags.length);
  }, [stage]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const view = resolveView(stage, params);
    const decorations = stage.decorations?.(params) ?? [];
    const vp = vpRef.current;

    const render = (sim: Simulation): void => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const cssW = wrap.clientWidth;
      const cssH = wrap.clientHeight;
      if (cssW < 2 || cssH < 2) return;

      fitViewport(vp, view, cssW, cssH, dpr);
      if (canvas.width !== vp.width || canvas.height !== vp.height) {
        canvas.width = vp.width;
        canvas.height = vp.height;
        canvas.style.width = `${cssW}px`;
        canvas.style.height = `${cssH}px`;
      }

      // ── 정적 배경: 필요할 때만 다시 그림 ──
      const sig = `${stage.id}|${vp.width}x${vp.height}|${JSON.stringify(params)}`;
      if (sigRef.current !== sig) {
        let off = staticRef.current;
        if (!off) {
          off = document.createElement('canvas');
          staticRef.current = off;
        }
        off.width = vp.width;
        off.height = vp.height;
        const octx = off.getContext('2d');
        if (octx) drawStatic(octx, vp, sim.world);
        sigRef.current = sig;
        trailsRef.current?.clear();
      }

      ctx.clearRect(0, 0, vp.width, vp.height);
      if (staticRef.current) ctx.drawImage(staticRef.current, 0, 0);
      drawDecorations(ctx, vp, decorations);

      const o = optsRef.current;
      const trails = trailsRef.current;
      if (o.showTrail && trails) {
        if (sim.playing) trails.push(sim.world);
        trails.draw(ctx, vp, (b) => sim.world.bodies[b]?.colorIndex ?? 0);
      }

      drawWaves(ctx, vp, sim.world);

      // 속도·가속도 화살표 배율은 장면 크기에 맞춰 정합니다.
      // 고정 배율을 쓰면 스테이지마다 화살표가 화면을 뚫고 나가거나 점처럼 보입니다.
      const spanPx = Math.min(vp.width, vp.height) / vp.dpr;
      drawBodies(ctx, vp, sim.world, {
        showVelocity: o.showVelocity,
        showAcceleration: o.showAcceleration,
        velocityScale: spanPx / 90,
        accelScale: spanPx / 220,
        labels: stage.bodyLabels ?? stage.bodyTags,
      });
    };

    playback.onFrame(render);
    render(playback.sim);
  }, [stage, params, playback]);

  // 장면 비율에 맞춰 캔버스 모양을 정합니다. 16:9 로 고정하면 낙하 스테이지처럼
  // 세로로 긴 장면에서 좌우가 텅 비고 물체가 점처럼 작아집니다.
  const view = resolveView(stage, params);
  const aspect = (view.xMax - view.xMin) / (view.yMax - view.yMin);
  const clamped = Math.max(0.62, Math.min(2.4, aspect));

  return (
    <div
      className="sim-canvas-wrap"
      ref={wrapRef}
      style={{ aspectRatio: `${clamped}` }}
    >
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={`${stage.title} 시뮬레이션 화면`}
      />
    </div>
  );
}
