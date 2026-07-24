/**
 * 데모 화면.
 *
 * 이 화면이 다루는 범위는 **시뮬레이션 관찰**까지입니다.
 * 예측 입력·미션 별점·오개념 진단 같은 학습 흐름(POER)은 아직 없습니다.
 * 없는 기능을 있는 것처럼 보이게 두지 않으려고, 화면에도 그 사실을 적어 둡니다.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { STAGES } from '../content/index.ts';
import {
  defaultParams,
  num,
  type ControlSpec,
  type Params,
  type StageSpec,
} from '../content/schema.ts';
import type { SpeedRatio } from '../engine/frame.ts';
import { SimCanvas } from './SimCanvas.tsx';
import { usePlayback } from './usePlayback.ts';

const SPEEDS: SpeedRatio[] = [0.1, 0.25, 0.5, 1, 2];

export function App(): JSX.Element {
  const [stageId, setStageId] = useState<string>(STAGES[0]!.id);
  const stage = useMemo<StageSpec>(
    () => STAGES.find((s) => s.id === stageId) ?? STAGES[0]!,
    [stageId],
  );

  const [params, setParams] = useState<Params>(() => defaultParams(stage.controls));
  useEffect(() => setParams(defaultParams(stage.controls)), [stage]);

  const [showVelocity, setShowVelocity] = useState(true);
  const [showAcceleration, setShowAcceleration] = useState(false);
  const [showTrail, setShowTrail] = useState(true);

  const playback = usePlayback(stage, params);
  const { state } = playback;

  const setParam = useCallback((id: string, value: number | boolean | string) => {
    setParams((p) => ({ ...p, [id]: value }));
  }, []);

  // 키보드: Space 재생/정지, R 리셋, ←/→ 프레임 이동, [ ] 배속
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) return;
      switch (e.key) {
        case ' ': e.preventDefault(); playback.toggle(); break;
        case 'r': case 'R': playback.reset(); break;
        case 'ArrowLeft': e.preventDefault(); playback.stepFrames(-1); break;
        case 'ArrowRight': e.preventDefault(); playback.stepFrames(1); break;
        case '[': {
          const i = SPEEDS.indexOf(state.speed);
          playback.setSpeed(SPEEDS[Math.max(0, i - 1)]!);
          break;
        }
        case ']': {
          const i = SPEEDS.indexOf(state.speed);
          playback.setSpeed(SPEEDS[Math.min(SPEEDS.length - 1, i + 1)]!);
          break;
        }
        default: break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [playback, state.speed]);

  const bodies = playback.sim.world.bodies;

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>PhysicsLab: 예측 실험실</h1>
          <p className="tagline">
            물리 엔진 데모 — 관찰·되감기까지. 예측 입력과 미션은 아직 없습니다.
          </p>
        </div>
        <label className="stage-select">
          <span>스테이지</span>
          <select
            value={stageId}
            onChange={(e) => setStageId(e.target.value)}
            aria-label="스테이지 선택"
          >
            {STAGES.map((s) => (
              <option key={s.id} value={s.id}>
                [{s.domain}] {s.title}
              </option>
            ))}
          </select>
        </label>
      </header>

      <main className="layout">
        <section className="stage-area">
          <div className="stage-brief">
            <h2>{stage.title}</h2>
            <p className="subtitle">{stage.subtitle}</p>
            <p className="situation">{stage.situation}</p>
            <p className="misconception">
              <strong>겨냥하는 오개념</strong> · {stage.targetMisconception}
            </p>
          </div>

          <SimCanvas
            stage={stage}
            params={params}
            playback={playback}
            showVelocity={showVelocity}
            showAcceleration={showAcceleration}
            showTrail={showTrail}
          />

          <Transport
            playback={playback}
            speeds={SPEEDS}
          />

          <Readout bodies={bodies} tags={stage.bodyLabels ?? stage.bodyTags} time={state.time} />
        </section>

        <aside className="panel">
          <h3>변수</h3>
          <div className="controls">
            {stage.controls.map((c) => (
              <Control key={c.id} spec={c} params={params} onChange={setParam} />
            ))}
          </div>

          <h3>표시</h3>
          <div className="toggles">
            <Toggle label="속도 벡터" checked={showVelocity} onChange={setShowVelocity} />
            <Toggle label="가속도 벡터" checked={showAcceleration} onChange={setShowAcceleration} />
            <Toggle label="잔상" checked={showTrail} onChange={setShowTrail} />
          </div>

          <h3>개념</h3>
          <ul className="concepts">
            {stage.concepts.map((c) => <li key={c}>{c}</li>)}
          </ul>

          <p className="hint-keys">
            단축키 · <kbd>Space</kbd> 재생/정지 · <kbd>R</kbd> 리셋 ·
            <kbd>←</kbd><kbd>→</kbd> 한 프레임 · <kbd>[</kbd><kbd>]</kbd> 배속
          </p>
        </aside>
      </main>
    </div>
  );
}

// ────────────────────────────────────────────────────────────

function Transport({
  playback, speeds,
}: { playback: ReturnType<typeof usePlayback>; speeds: SpeedRatio[] }): JSX.Element {
  const { state } = playback;
  const min = state.oldestFrame;
  const max = Math.max(min, state.newestFrame);

  return (
    <div className="transport">
      <div className="transport-buttons">
        <button
          type="button"
          className="primary"
          onClick={playback.toggle}
          aria-label={state.playing ? '일시정지' : '재생'}
        >
          {state.playing ? '⏸ 정지' : '▶ 재생'}
        </button>
        <button type="button" onClick={playback.reset} aria-label="처음으로 되돌리기">
          ⟲ 리셋
        </button>
        <button
          type="button"
          onClick={() => playback.stepFrames(-1)}
          aria-label="한 프레임 뒤로"
        >
          ◀ 1프레임
        </button>
        <button
          type="button"
          onClick={() => playback.stepFrames(1)}
          aria-label="한 프레임 앞으로"
        >
          1프레임 ▶
        </button>

        <div className="speeds" role="group" aria-label="재생 속도">
          {speeds.map((s) => (
            <button
              key={s}
              type="button"
              className={s === state.speed ? 'speed active' : 'speed'}
              onClick={() => playback.setSpeed(s)}
              aria-pressed={s === state.speed}
              aria-label={`${s}배속`}
            >
              {s}×
            </button>
          ))}
        </div>
      </div>

      <div className="timeline">
        <input
          type="range"
          min={min}
          max={max}
          step={1}
          value={Math.min(max, Math.max(min, state.frame))}
          onChange={(e) => playback.seek(Number(e.target.value))}
          aria-label="타임라인 되감기"
        />
        <span className="time-readout">
          {state.time.toFixed(2)} s
          {state.finished ? ' · 종료' : ''}
        </span>
      </div>
      <p className="scrub-note">
        타임라인을 끌면 과거 시점으로 되감깁니다(최근 10초).
        되감은 뒤 다시 재생해도 궤적이 바뀌지 않습니다.
      </p>
    </div>
  );
}

function Readout({
  bodies, tags, time,
}: {
  bodies: { p: { x: number; y: number }; v: { x: number; y: number } }[];
  tags: string[];
  time: number;
}): JSX.Element {
  return (
    <div className="readout" aria-live="off">
      <table>
        <caption>현재 값 (t = {time.toFixed(2)} s)</caption>
        <thead>
          <tr>
            <th scope="col">물체</th>
            <th scope="col">x [m]</th>
            <th scope="col">y [m]</th>
            <th scope="col">속력 [m/s]</th>
          </tr>
        </thead>
        <tbody>
          {bodies.map((b, i) => (
            <tr key={tags[i] ?? i}>
              <th scope="row">{tags[i] ?? `물체 ${i + 1}`}</th>
              <td>{b.p.x.toFixed(2)}</td>
              <td>{b.p.y.toFixed(2)}</td>
              <td>{Math.hypot(b.v.x, b.v.y).toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Control({
  spec, params, onChange,
}: {
  spec: ControlSpec;
  params: Params;
  onChange: (id: string, v: number | boolean | string) => void;
}): JSX.Element {
  if (spec.kind === 'slider') {
    const value = num(params, spec.id, spec.default);
    return (
      <label className="control">
        <span className="control-label">
          {spec.label}
          <output>
            {value.toFixed(decimalsFor(spec.step))} {spec.unit}
          </output>
        </span>
        <input
          type="range"
          min={spec.min}
          max={spec.max}
          step={spec.step}
          value={value}
          onChange={(e) => onChange(spec.id, Number(e.target.value))}
          aria-label={`${spec.label} (${spec.unit || '무차원'})`}
        />
        {spec.help ? <small>{spec.help}</small> : null}
      </label>
    );
  }
  if (spec.kind === 'toggle') {
    const value = params[spec.id] === true;
    return (
      <label className="control control-toggle">
        <input
          type="checkbox"
          checked={value}
          onChange={(e) => onChange(spec.id, e.target.checked)}
          aria-label={spec.label}
        />
        <span>{spec.label}</span>
        {spec.help ? <small>{spec.help}</small> : null}
      </label>
    );
  }
  const value = typeof params[spec.id] === 'string' ? (params[spec.id] as string) : spec.default;
  return (
    <label className="control">
      <span className="control-label">{spec.label}</span>
      <select
        value={value}
        onChange={(e) => onChange(spec.id, e.target.value)}
        aria-label={spec.label}
      >
        {spec.options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      {spec.help ? <small>{spec.help}</small> : null}
    </label>
  );
}

function Toggle({
  label, checked, onChange,
}: { label: string; checked: boolean; onChange: (v: boolean) => void }): JSX.Element {
  return (
    <label className="control-toggle">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={label}
      />
      <span>{label}</span>
    </label>
  );
}

/** 슬라이더 step 에 맞는 소수 자릿수 (물리량은 소수 둘째 자리까지). */
function decimalsFor(step: number): number {
  if (step >= 1) return 0;
  if (step >= 0.1) return 1;
  return 2;
}
