/**
 * 시뮬레이션 드라이버 — 물리 루프의 주인.
 *
 * DOM 을 전혀 쓰지 않습니다. 그래서 Node 테스트에서도, 나중에 화면을 붙일 때도
 * **똑같은 코드가 그대로** 돕니다. 물리 루프가 실행 환경마다 갈라지지 않게 하려는
 * 설계입니다.
 *
 * ■ accumulator 패턴을 정수로 하는 이유
 *   화면 프레임 1장당 진행할 substep 수는 배속에 따라 16, 8, 4, 1.6, 32 입니다.
 *   1.6 같은 값을 부동소수로 누적하면 실행마다 반올림이 달라져
 *   "같은 시드인데 궤적이 다른" 사태가 납니다.
 *   그래서 분자/분모 정수쌍(8/5)으로 누적합니다 — 오차가 원천적으로 0입니다.
 *
 * ■ 프레임 드랍이 물리를 바꾸지 못하는 구조
 *   "실제로 흐른 시간"을 물리에 절대 넣지 않습니다.
 *   한 프레임에 진행하는 substep 수는 오직 배속만으로 정해집니다.
 *   느린 기기에서는 재생이 실시간보다 느려질 뿐, 궤적은 한 치도 달라지지 않습니다.
 *   (정확도와 부드러움이 충돌하면 정확도를 택한다는 최상위 원칙의 적용)
 */

import {
  BODY_STRIDE,
  B_AX, B_AY, B_FLAGS, B_MASS, B_N, B_RADIUS, B_S, B_U, B_VX, B_VY, B_X, B_Y,
  BF_ACTIVE, BF_ON_TRACK, BF_RESTING, BF_STICKING,
  computeLayout,
  EVENT_CAP, EVENT_STRIDE,
  FLAG_FINISHED, FLAG_IMPACT, FLAG_PLAYING,
  FRAME_BODY_COUNT, FRAME_EVENT_COUNT, FRAME_FLAGS, FRAME_HEADER,
  FRAME_INDEX, FRAME_SCALAR_COUNT, FRAME_STEPS, FRAME_THERMAL, FRAME_TIME,
  SPEED_FRACTIONS,
  type FrameLayout,
  type SpeedRatio,
} from './frame.ts';
import {
  createRecorder,
  newestFrame,
  oldestFrame,
  recordFrame,
  restoreNearestKeyframe,
  truncateRecorder,
  type Recorder,
} from './recorder.ts';
import { step } from './world.ts';
import { EVENT_BODY_BODY, EVENT_BODY_WALL, type World } from './types.ts';

/** 스테이지가 드라이버에 제공해야 하는 최소 인터페이스. */
export interface DriverStage {
  id: string;
  duration: number;
  bodyTags: string[];
  channelCount: number;
  build: () => World;
  measure: (world: World, out: Float64Array) => void;
}

export interface DriverOptions {
  /** 표시용 링버퍼 프레임 수 (기본 600 = 10초) */
  ringCapacity?: number;
  keyframeInterval?: number;
  keyframeCapacity?: number;
  /** 화면 프레임 주기 [s] */
  frameDt?: number;
}

export class Simulation {
  readonly stage: DriverStage;
  readonly layout: FrameLayout;
  readonly frameDt: number;

  world: World;
  recorder: Recorder;

  /** 현재 재생 위치 (프레임 인덱스). world 는 항상 이 시점 상태입니다. */
  playhead = 0;
  playing = false;
  speed: SpeedRatio = 1;
  finished = false;

  private speedAcc = 0;
  private readonly scalarBuf: Float64Array;
  /** 프레임별 누적 substep 수 (링 인덱싱). 되감기 재현에 필수. */
  private readonly stepsAtFrame: Int32Array;
  /** 이번 프레임에 모인 사건 */
  private readonly eventBuf: Float32Array;
  private eventCount = 0;

  /** 실행 전체 궤적 (미션 판정용 append-only 버퍼) */
  private readonly traceData: Float32Array;
  private readonly maxTraceFrames: number;
  private traceCount = 0;

  constructor(stage: DriverStage, opts: DriverOptions = {}) {
    this.stage = stage;
    this.frameDt = opts.frameDt ?? 1 / 60;
    const ringCapacity = opts.ringCapacity ?? 600;
    this.layout = computeLayout(stage.bodyTags.length, stage.channelCount);
    this.scalarBuf = new Float64Array(stage.channelCount);
    this.stepsAtFrame = new Int32Array(ringCapacity);
    this.eventBuf = new Float32Array(EVENT_CAP * EVENT_STRIDE);
    this.maxTraceFrames = Math.ceil(stage.duration / this.frameDt) + 2;
    this.traceData = new Float32Array(this.maxTraceFrames * this.layout.size);

    this.world = stage.build();
    this.recorder = createRecorder({
      capacity: ringCapacity,
      bodyCount: stage.bodyTags.length,
      scalarCount: stage.channelCount,
      keyframeInterval: opts.keyframeInterval ?? 60,
      keyframeCapacity: opts.keyframeCapacity ?? 12,
    });
    this.captureFrame();
  }

  // ── 조회 ────────────────────────────────────────────────
  get totalFrames(): number {
    return this.recorder.written;
  }
  get oldestAvailableFrame(): number {
    return oldestFrame(this.recorder);
  }
  get newestAvailableFrame(): number {
    return newestFrame(this.recorder);
  }
  get time(): number {
    return this.world.time;
  }

  // ── 제어 ────────────────────────────────────────────────

  reset(): void {
    this.world = this.stage.build();
    this.recorder.written = 0;
    this.recorder.exactFrame.fill(-1);
    this.recorder.exactWritten = 0;
    this.playhead = 0;
    this.playing = false;
    this.finished = false;
    this.speedAcc = 0;
    this.eventCount = 0;
    this.traceCount = 0;
    this.captureFrame();
  }

  setSpeed(speed: SpeedRatio): void {
    this.speed = speed;
    this.speedAcc = 0;
  }

  play(): void {
    if (this.finished) return;
    this.playing = true;
  }

  pause(): void {
    this.playing = false;
  }

  /**
   * 화면 프레임 1장 진행. 재생 중이 아니면 아무 일도 하지 않습니다.
   * 반환값 = 실제로 프레임이 진행되었는가.
   */
  tick(): boolean {
    if (!this.playing || this.finished) return false;
    this.advanceOneFrame();
    if (this.world.time >= this.stage.duration - 1e-9) {
      this.finished = true;
      this.playing = false;
    }
    return true;
  }

  /** 배속에 따른 이번 프레임의 substep 수 (정수 누산). */
  private substepsThisFrame(): number {
    const [num, den] = SPEED_FRACTIONS[this.speed];
    this.speedAcc += num;
    const n = Math.floor(this.speedAcc / den);
    this.speedAcc -= n * den;
    return n;
  }

  advanceOneFrame(): void {
    // 되감은 지점에서 다시 진행하면 그 이후 기록은 새 가지가 됩니다.
    if (this.playhead + 1 < this.recorder.written) {
      truncateRecorder(this.recorder, this.playhead);
      this.traceCount = Math.min(this.traceCount, this.playhead + 1);
    }

    this.eventCount = 0;
    const n = this.substepsThisFrame();
    for (let i = 0; i < n; i++) {
      step(this.world);
      this.collectEvents();
    }
    this.captureFrame();
  }

  /** 프레임 단위 이동. delta 는 음수 가능. */
  stepFrames(delta: number): void {
    this.playing = false;
    let target = this.playhead + delta;
    if (target < this.oldestAvailableFrame) target = this.oldestAvailableFrame;
    if (target < this.playhead) {
      this.seek(target);
      return;
    }
    while (this.playhead < target) {
      if (this.playhead + 1 < this.recorder.written) {
        this.seek(this.playhead + 1);
      } else {
        if (this.finished) break;
        this.advanceOneFrame();
        if (this.world.time >= this.stage.duration - 1e-9) this.finished = true;
      }
    }
  }

  /**
   * 임의 프레임으로 되감기 / 앞감기.
   *
   * 표시용 Float32 값을 그대로 상태로 되돌리면 안 됩니다. 그 미세한 반올림이
   * 충돌 시각을 바꿔 이후 궤적을 갈라놓기 때문입니다.
   * 그래서 **가장 가까운 이전 정확 키프레임(Float64)으로 복원한 뒤
   * 목표 프레임까지 substep 을 다시 밟습니다.** 최대 1초분(960 substep)이라
   * 최신 기기에서 1 ms 미만입니다.
   */
  seek(frame: number): void {
    const lo = this.oldestAvailableFrame;
    const hi = this.newestAvailableFrame;
    const target = Math.max(lo, Math.min(hi, frame));
    if (target === this.playhead) return;

    const restored = restoreNearestKeyframe(this.recorder, this.world, target);
    if (restored < 0) {
      // 키프레임이 없으면 처음부터 (링을 벗어난 아주 옛날 구간)
      this.world = this.stage.build();
      this.playhead = 0;
      if (target > 0) this.replayTo(target);
      this.playing = false;
      return;
    }
    this.playhead = restored;
    this.replayTo(target);
    this.playing = false;
    this.finished = this.world.time >= this.stage.duration - 1e-9;
  }

  /** 현재 world 상태에서 목표 프레임의 substep 수까지 정확히 다시 밟습니다. */
  private replayTo(target: number): void {
    const targetSteps = this.stepsAtFrame[target % this.recorder.config.capacity]!;
    const need = targetSteps - this.world.steps;
    this.eventCount = 0;
    for (let i = 0; i < need; i++) {
      step(this.world);
      this.collectEvents();
    }
    this.playhead = target;
  }

  // ── 기록 / 출력 ─────────────────────────────────────────

  private collectEvents(): void {
    const ev = this.world.events;
    for (let i = 0; i < ev.count; i++) {
      if (this.eventCount >= EVENT_CAP) return;
      const o = this.eventCount * EVENT_STRIDE;
      this.eventBuf[o] = ev.type[i]!;
      this.eventBuf[o + 1] = ev.a[i]!;
      this.eventBuf[o + 2] = ev.b[i]!;
      this.eventBuf[o + 3] = ev.magnitude[i]!;
      this.eventCount++;
    }
  }

  private captureFrame(): void {
    this.stage.measure(this.world, this.scalarBuf);
    const frame = recordFrame(this.recorder, this.world, this.scalarBuf);
    this.stepsAtFrame[frame % this.recorder.config.capacity] = this.world.steps;
    this.playhead = frame;

    if (frame < this.maxTraceFrames) {
      const stride = this.layout.size;
      this.writeFrame(this.traceData.subarray(frame * stride, (frame + 1) * stride));
      this.traceCount = Math.max(this.traceCount, frame + 1);
    }
  }

  /**
   * 현재 상태를 전송용 Float32Array 로 씁니다.
   * 이 버퍼는 Transferable 로 메인 스레드에 소유권째 넘어갑니다(복사 없음).
   */
  writeFrame(out: Float32Array): void {
    const w = this.world;
    this.stage.measure(w, this.scalarBuf);

    let impact = 0;
    for (let i = 0; i < this.eventCount; i++) {
      const t = this.eventBuf[i * EVENT_STRIDE]!;
      if (t === EVENT_BODY_BODY || t === EVENT_BODY_WALL) impact = FLAG_IMPACT;
    }

    out[FRAME_TIME] = w.time;
    out[FRAME_STEPS] = w.steps;
    out[FRAME_INDEX] = this.playhead;
    out[FRAME_FLAGS] =
      (this.playing ? FLAG_PLAYING : 0) | impact | (this.finished ? FLAG_FINISHED : 0);
    out[FRAME_EVENT_COUNT] = this.eventCount;
    out[FRAME_THERMAL] = w.thermal;
    out[FRAME_BODY_COUNT] = this.layout.bodyCount;
    out[FRAME_SCALAR_COUNT] = this.layout.scalarCount;

    for (let i = 0; i < this.layout.bodyCount; i++) {
      const b = w.bodies[i];
      const o = FRAME_HEADER + i * BODY_STRIDE;
      if (!b) {
        for (let k = 0; k < BODY_STRIDE; k++) out[o + k] = 0;
        continue;
      }
      out[o + B_X] = b.p.x;
      out[o + B_Y] = b.p.y;
      out[o + B_VX] = b.v.x;
      out[o + B_VY] = b.v.y;
      out[o + B_AX] = b.a.x;
      out[o + B_AY] = b.a.y;
      out[o + B_S] = b.s;
      out[o + B_U] = b.u;
      out[o + B_N] = b.normalForce;
      out[o + B_FLAGS] =
        (b.active ? BF_ACTIVE : 0) |
        (b.trackIndex >= 0 ? BF_ON_TRACK : 0) |
        (b.sticking ? BF_STICKING : 0) |
        (b.resting ? BF_RESTING : 0);
      out[o + B_RADIUS] = b.radius;
      out[o + B_MASS] = b.mass;
    }

    for (let k = 0; k < this.layout.scalarCount; k++) {
      out[this.layout.scalarOffset + k] = this.scalarBuf[k]!;
    }

    const evLen = EVENT_CAP * EVENT_STRIDE;
    for (let k = 0; k < evLen; k++) {
      out[this.layout.eventOffset + k] =
        k < this.eventCount * EVENT_STRIDE ? this.eventBuf[k]! : 0;
    }
  }

  /**
   * 실행 전체 궤적 (미션 판정용).
   *
   * 표시용 링버퍼는 최근 10초만 담지만, 미션은 "실행 처음부터 끝까지"를
   * 봐야 하므로 별도의 평면 버퍼에 매 프레임 한 장씩 append 합니다.
   * 프레임이 만들어질 때 곧바로 써두므로 나중에 되감아 재수집할 필요가 없습니다.
   */
  get traceFrames(): number {
    return this.traceCount;
  }

  get trace(): Float32Array {
    return this.traceData;
  }
}
