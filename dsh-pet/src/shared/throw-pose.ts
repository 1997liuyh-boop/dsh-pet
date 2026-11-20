/** 网页和桌面共用的甩飞动作播放器。原有物理层负责移动，这里只切换动作帧。 */
import { WALL_HOLD_MS, WALL_KICK_MS, type GesturePose } from './throw-gesture.ts';
import { CANVAS_H } from './constants.ts';
import { FALL_MS, KICK_MS, kickEdge, settlingPose, throwAxis } from './throw-visual.ts';
import type { ThrowAxis, ThrowEdge, ThrowPose, ThrowVisualFrame } from './throw-visual.ts';

interface ThrowPoseDeps {
  videos(): readonly (HTMLVideoElement | null)[];
  atlasUrl(): string | null;
}

const STAGE_W = 640;
const LEGACY_FRAME_W = STAGE_W / 2;
const LEGACY_ROW_COUNT = 10;
const WALL_ROW_COUNT = 12;
const UMBRELLA_ROW_COUNT = 14;
const RELEASE_ROW_COUNT = 16;
const ROW_COUNT = 18;
const FRAME_COUNT = 12;
const ROWS = {
  flySide: 0,
  flyUp: 1,
  flyDown: 2,
  kickSide: 3,
  kickCeiling: 4,
  kickFloor: 5,
  flutter: 6,
  brake: 7,
  fallSlide: 8,
  fallDown: 9,
  wallLeft: 10,
  wallRight: 11,
  umbrellaOpen: 12,
  umbrellaGlide: 13,
  wallReleaseLeft: 14,
  wallReleaseRight: 15,
  wallKickLeft: 16,
  wallKickRight: 17,
} as const;
const FLUTTER_MS = 320;
const BRAKE_MS = 240;
const FLY_MS = 520;
const UMBRELLA_OPEN_MS = 780;
const UMBRELLA_SWING_MS = 1250;

type FlightDirection = 'left' | 'right' | 'up' | 'down';
type Clip = { row: number; duration: number; mirror?: boolean; loop?: boolean; swing?: boolean; offset?: number };

function flightDirection(vx: number, vy: number): FlightDirection {
  if (throwAxis(vx, vy) === 'vertical') return vy < 0 ? 'up' : 'down';
  return vx < 0 ? 'left' : 'right';
}

function clipFor(
  pose: ThrowPose,
  axis: ThrowAxis,
  edge: ThrowEdge,
  facing: FlightDirection,
  mirror: boolean,
  rowCount: number,
  elapsed: number,
): Clip {
  switch (pose) {
    case 'fly': {
      const row = facing === 'up' ? ROWS.flyUp : facing === 'down' ? ROWS.flyDown : ROWS.flySide;
      return { row, duration: FLY_MS, mirror: facing === 'left', loop: true };
    }
    case 'descend':
      if (rowCount < UMBRELLA_ROW_COUNT) return { row: ROWS.flyDown, duration: 950, loop: true };
      if (elapsed < UMBRELLA_OPEN_MS) return { row: ROWS.umbrellaOpen, duration: UMBRELLA_OPEN_MS };
      return { row: ROWS.umbrellaGlide, duration: UMBRELLA_SWING_MS, swing: true, offset: UMBRELLA_OPEN_MS };
    case 'wall':
      if (rowCount >= WALL_ROW_COUNT)
        return { row: edge === 'left' ? ROWS.wallLeft : ROWS.wallRight, duration: WALL_HOLD_MS };
      return { row: ROWS.kickSide, duration: 400, mirror: edge === 'left' };
    case 'wall-kick':
      if (rowCount >= ROW_COUNT)
        return { row: edge === 'left' ? ROWS.wallKickLeft : ROWS.wallKickRight, duration: WALL_KICK_MS };
      if (rowCount >= RELEASE_ROW_COUNT)
        return { row: edge === 'left' ? ROWS.wallReleaseLeft : ROWS.wallReleaseRight, duration: WALL_KICK_MS };
      return { row: ROWS.kickSide, duration: WALL_KICK_MS, mirror: edge === 'left' };
    case 'kick': {
      const row = edge === 'ceiling' ? ROWS.kickCeiling : edge === 'floor' ? ROWS.kickFloor : ROWS.kickSide;
      return { row, duration: KICK_MS, mirror: edge === 'left' };
    }
    case 'flutter':
      return { row: ROWS.flutter, duration: FLUTTER_MS };
    case 'brake':
      return { row: ROWS.brake, duration: BRAKE_MS, mirror };
    case 'fall':
      return axis === 'horizontal'
        ? { row: ROWS.fallSlide, duration: FALL_MS, mirror }
        : { row: ROWS.fallDown, duration: FALL_MS };
  }
}

/** 素材未就绪时保留普通视频，避免在加载或自定义角色时覆盖原来的动画。 */
export function createThrowPose(deps: ThrowPoseDeps) {
  let layer: HTMLCanvasElement | null = null;
  let atlas: HTMLImageElement | null = null;
  let atlasUrl: string | null = null;
  let pose: ThrowPose | null = null;
  let poseSince = 0;
  let axis: ThrowAxis = 'horizontal';
  let edge: ThrowEdge = 'floor';
  let facing: FlightDirection = 'right';
  let mirror = false;
  let recovery: number | null = null;
  let hidden: { el: HTMLVideoElement; visibility: string }[] = [];

  const setPose = (next: ThrowPose, now: number): void => {
    if (pose === next) return;
    pose = next;
    poseSince = now;
  };

  const reset = (): void => {
    if (recovery !== null) cancelAnimationFrame(recovery);
    recovery = null;
    pose = null;
    layer?.remove();
    layer = null;
    for (const { el, visibility } of hidden) el.style.visibility = visibility;
    hidden = [];
  };

  const prepare = (): void => {
    const url = deps.atlasUrl();
    if (!url || url === atlasUrl) return;
    atlasUrl = url;
    atlas = new Image();
    atlas.src = url;
  };

  const render = (now: number): void => {
    if (pose === null || !atlas) return;
    if (deps.atlasUrl() !== atlasUrl) {
      reset();
      return;
    }
    if (!layer) {
      const videos = deps.videos().filter((video): video is HTMLVideoElement => video !== null);
      const first = videos[0];
      const parent = first?.parentElement;
      if (!first || !parent) return;
      layer = document.createElement('canvas');
      layer.width = STAGE_W;
      layer.height = CANVAS_H;
      layer.className = first.classList.contains('pet-video') ? 'pet-video is-front' : 'dsh-pet-video is-front';
      layer.setAttribute('aria-hidden', 'true');
      parent.insertBefore(layer, videos[videos.length - 1].nextSibling);
      hidden = videos.map((el) => ({ el, visibility: el.style.visibility }));
      for (const { el } of hidden) el.style.visibility = 'hidden';
    }
    const ctx = layer.getContext('2d');
    if (!ctx) {
      reset();
      return;
    }
    const frameW = atlas.naturalWidth / FRAME_COUNT;
    const frameH = (frameW / STAGE_W) * CANVAS_H;
    const elapsed = Math.max(0, now - poseSince);
    const clip = clipFor(pose, axis, edge, facing, mirror, atlas.naturalHeight / frameH, elapsed);
    const progress = (elapsed - (clip.offset ?? 0)) / clip.duration;
    // 伞的摆荡到达一侧后沿原帧回摆，避免直接跳回另一侧。
    const fraction = clip.swing ? 1 - Math.abs(1 - (progress % 2)) : clip.loop ? progress % 1 : progress;
    const frame = Math.min(FRAME_COUNT - 1, Math.floor(fraction * FRAME_COUNT));
    const variant = `${clip.row}:${frame}:${Boolean(clip.mirror)}`;
    layer.dataset.throwPose = pose;
    if (pose === 'kick' || pose === 'wall' || pose === 'wall-kick') layer.dataset.throwEdge = edge;
    else delete layer.dataset.throwEdge;
    if (pose === 'fall') layer.dataset.throwAxis = axis;
    if (layer.dataset.throwFrame === variant) return;
    layer.dataset.throwFrame = variant;
    ctx.clearRect(0, 0, STAGE_W, CANVAS_H);
    ctx.save();
    if (clip.mirror) {
      ctx.translate(STAGE_W, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(atlas, frame * frameW, clip.row * frameH, frameW, frameH, 0, 0, STAGE_W, CANVAS_H);
    ctx.restore();
  };

  const start = (vx: number, vy: number, now: number): void => {
    reset();
    if (typeof window === 'undefined' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (Math.hypot(vx, vy) < 125) return;
    prepare();
    if (!deps.atlasUrl() || !atlas) return;
    const frameW = atlas.naturalWidth / FRAME_COUNT;
    if (frameW !== STAGE_W && frameW !== LEGACY_FRAME_W) return;
    const frameH = (frameW / STAGE_W) * CANVAS_H;
    const rowCount = atlas.naturalHeight / frameH;
    if (![LEGACY_ROW_COUNT, WALL_ROW_COUNT, UMBRELLA_ROW_COUNT, RELEASE_ROW_COUNT, ROW_COUNT].includes(rowCount)) return;
    axis = throwAxis(vx, vy);
    facing = flightDirection(vx, vy);
    mirror = vx < 0;
    setPose('fly', now);
    render(now);
  };

  const step = (frame: ThrowVisualFrame, now: number): void => {
    if (pose === null || pose === 'fall') return;
    const hit = kickEdge(frame.hit);
    if (hit !== null) {
      if (pose !== 'kick' || edge !== hit) poseSince = now;
      edge = hit;
      setPose('kick', now);
    } else if (pose !== 'kick' || now - poseSince >= KICK_MS) {
      if (Math.abs(frame.vx) > 45) mirror = frame.vx < 0;
      if (!frame.grounded && Math.hypot(frame.vx, frame.vy) > 100) facing = flightDirection(frame.vx, frame.vy);
      setPose(settlingPose(axis, frame) ?? 'fly', now);
    }
    render(now);
  };

  const steer = (next: GesturePose, now: number): void => {
    if (pose === null) return;
    if (next === 'left-wall' || next === 'right-wall') {
      edge = next === 'left-wall' ? 'left' : 'right';
      setPose('wall', now);
    } else if (next === 'left-wall-kick' || next === 'right-wall-kick') {
      edge = next === 'left-wall-kick' ? 'left' : 'right';
      setPose('wall-kick', now);
    } else if (next === 'descend') {
      setPose('descend', now);
    } else {
      facing = next;
      setPose('fly', now);
    }
    render(now);
  };

  const finish = (now: number): void => {
    if (pose === null || recovery !== null) return;
    const delay = pose === 'kick' ? Math.max(0, KICK_MS - (now - poseSince)) : 0;
    const settleAt = now + delay;
    const settle = axis === 'vertical' ? 'flutter' : 'brake';
    const duration = axis === 'vertical' ? FLUTTER_MS : BRAKE_MS;
    const recover = (time: number): void => {
      if (time >= settleAt) {
        if (pose !== 'fall') {
          setPose(settle, time);
          if (time - poseSince >= duration) setPose('fall', time);
        }
        if (pose === 'fall' && time - poseSince >= FALL_MS) {
          reset();
          return;
        }
      }
      render(time);
      if (pose !== null) recovery = requestAnimationFrame(recover);
    };
    recover(now);
  };

  return { start, step, steer, finish, reset, prepare, isActive: () => pose !== null };
}
