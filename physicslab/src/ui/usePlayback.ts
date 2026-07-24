/**
 * 재생 제어 훅.
 *
 * 물리 루프는 engine/driver.ts 의 Simulation 이 그대로 돕니다.
 * 이 훅은 rAF 로 tick 을 불러주고 React 에 상태 변화를 알리는 얇은 껍데기입니다.
 *
 * ■ 프레임이 튀어도 궤적이 달라지지 않는 이유
 *   한 프레임에 진행하는 substep 수는 오직 배속만으로 정해집니다.
 *   "실제로 흐른 시간"을 물리에 넣지 않으므로, 느린 기기에서는 재생이
 *   실시간보다 느려질 뿐 결과는 한 치도 달라지지 않습니다.
 *   (정확도와 부드러움이 충돌하면 정확도를 택합니다)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Simulation } from '../engine/driver.ts';
import type { SpeedRatio } from '../engine/frame.ts';
import { toDriverStage } from '../content/index.ts';
import type { Params, StageSpec } from '../content/schema.ts';

export interface PlaybackState {
  playing: boolean;
  finished: boolean;
  speed: SpeedRatio;
  frame: number;
  oldestFrame: number;
  newestFrame: number;
  time: number;
}

export interface Playback {
  /** 현재 시뮬레이션. 렌더러가 world 를 직접 읽습니다. */
  sim: Simulation;
  state: PlaybackState;
  play(): void;
  pause(): void;
  toggle(): void;
  reset(): void;
  seek(frame: number): void;
  stepFrames(delta: number): void;
  setSpeed(speed: SpeedRatio): void;
  /** 매 프레임 렌더 직전에 불릴 콜백 등록 */
  onFrame(cb: (sim: Simulation) => void): void;
}

export function usePlayback(stage: StageSpec, params: Params, seed = 0): Playback {
  // 스테이지나 파라미터가 바뀌면 시뮬레이션을 새로 만듭니다.
  const sim = useMemo(
    () => new Simulation(toDriverStage(stage, params, seed)),
    [stage, params, seed],
  );

  const [state, setState] = useState<PlaybackState>(() => snapshot(sim));
  const frameCb = useRef<((sim: Simulation) => void) | null>(null);
  const rafRef = useRef(0);

  const sync = useCallback(() => setState(snapshot(sim)), [sim]);

  useEffect(() => {
    sync();
    let alive = true;
    const loop = (): void => {
      if (!alive) return;
      if (sim.playing && !sim.finished) {
        sim.tick();
        setState(snapshot(sim));
      }
      frameCb.current?.(sim);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      alive = false;
      cancelAnimationFrame(rafRef.current);
    };
  }, [sim, sync]);

  return useMemo<Playback>(
    () => ({
      sim,
      state,
      play: () => { sim.play(); sync(); },
      pause: () => { sim.pause(); sync(); },
      toggle: () => { if (sim.playing) sim.pause(); else sim.play(); sync(); },
      reset: () => { sim.reset(); sync(); },
      seek: (f) => { sim.seek(f); sync(); },
      stepFrames: (d) => { sim.stepFrames(d); sync(); },
      setSpeed: (s) => { sim.setSpeed(s); sync(); },
      onFrame: (cb) => { frameCb.current = cb; },
    }),
    [sim, state, sync],
  );
}

function snapshot(sim: Simulation): PlaybackState {
  return {
    playing: sim.playing,
    finished: sim.finished,
    speed: sim.speed,
    frame: sim.playhead,
    oldestFrame: sim.oldestAvailableFrame,
    newestFrame: sim.newestAvailableFrame,
    time: sim.world.time,
  };
}
