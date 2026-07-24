/**
 * 월드 좌표(SI 미터) ↔ 화면 좌표(픽셀) 변환.
 *
 * 물리는 미터, 화면은 픽셀이고 y축 방향이 반대입니다
 * (물리: 위가 +, 캔버스: 아래가 +). 이 변환을 한 곳에 모아두지 않으면
 * 부호 실수가 파일마다 흩어집니다.
 *
 * 배율은 **가로세로 같은 값(등방)** 을 씁니다. 비율을 깨면 원이 타원이 되고
 * 45° 경사면이 45°로 보이지 않습니다. 각도를 눈으로 재는 스테이지가 있으므로
 * 등방 배율은 타협 대상이 아닙니다.
 */

export interface Viewport {
  /** 월드 영역 [m] */
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  /** 캔버스 픽셀 크기 (devicePixelRatio 반영 후) */
  width: number;
  height: number;
  /** m → px 배율 */
  scale: number;
  /** 월드 원점의 화면 좌표 */
  originX: number;
  originY: number;
  dpr: number;
}

export function createViewport(): Viewport {
  return {
    xMin: -1, xMax: 1, yMin: -1, yMax: 1,
    width: 1, height: 1, scale: 1,
    originX: 0, originY: 0, dpr: 1,
  };
}

export interface WorldBox {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

/** 월드 영역이 캔버스 안에 비율을 유지한 채 들어가도록 맞춥니다. */
export function fitViewport(
  vp: Viewport,
  box: WorldBox,
  cssWidth: number,
  cssHeight: number,
  dpr: number,
  paddingPx = 10,
): void {
  vp.xMin = box.xMin;
  vp.xMax = box.xMax;
  vp.yMin = box.yMin;
  vp.yMax = box.yMax;
  vp.dpr = dpr;
  vp.width = Math.max(1, Math.round(cssWidth * dpr));
  vp.height = Math.max(1, Math.round(cssHeight * dpr));

  const pad = paddingPx * dpr;
  const availW = Math.max(1, vp.width - pad * 2);
  const availH = Math.max(1, vp.height - pad * 2);
  const worldW = Math.max(1e-9, box.xMax - box.xMin);
  const worldH = Math.max(1e-9, box.yMax - box.yMin);
  vp.scale = Math.min(availW / worldW, availH / worldH);

  vp.originX = (vp.width - worldW * vp.scale) / 2 - box.xMin * vp.scale;
  vp.originY = (vp.height + worldH * vp.scale) / 2 + box.yMin * vp.scale;
}

export function sx(vp: Viewport, x: number): number {
  return vp.originX + x * vp.scale;
}

/** 캔버스는 아래가 + 이므로 부호가 뒤집힙니다. */
export function sy(vp: Viewport, y: number): number {
  return vp.originY - y * vp.scale;
}

export function slen(vp: Viewport, meters: number): number {
  return meters * vp.scale;
}

/** 보기 좋은 격자 간격을 1-2-5 계열에서 고릅니다. */
export function niceSpacing(worldSpan: number, targetLines = 12): number {
  const raw = worldSpan / Math.max(1, targetLines);
  const mag = Math.pow(10, Math.floor(Math.log10(Math.max(1e-9, raw))));
  const norm = raw / mag;
  const step = norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10;
  return step * mag;
}
