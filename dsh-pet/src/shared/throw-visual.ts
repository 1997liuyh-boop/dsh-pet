/** 抛掷动画的方向和阶段。物理位置、摩擦和速度仍由原有积分器计算。 */
import type { ThrowHit } from './physics/throw.ts';

export type ThrowAxis = 'vertical' | 'horizontal';
export type ThrowEdge = ThrowHit['edge'];
export type ThrowPose = 'fly' | 'descend' | 'wall' | 'wall-kick' | 'kick' | 'flutter' | 'brake' | 'fall';

export interface ThrowVisualFrame {
  vx: number;
  vy: number;
  hit: ThrowHit | null;
  grounded: boolean;
  /** 脚底距当前工作区下边的距离，按视频盒尺寸归一化。 */
  floorGap: number;
}

export const throwAxis = (vx: number, vy: number): ThrowAxis =>
  Math.abs(vy) > Math.abs(vx) ? 'vertical' : 'horizontal';

export const KICK_MS = 170;
export const FALL_MS = 520;

/** 常驻贴地接触会重复上报，只有冲击或真正到过空中后的着陆才做蹬墙。 */
export const kickEdge = (hit: ThrowHit | null): ThrowEdge | null =>
  hit && hit.speed >= 180 && (hit.edge !== 'floor' || hit.speed >= 270) ? hit.edge : null;

/** 竖甩在下落接近底边时扑腾，横甩在靠近底边减速时伸脚。 */
export function settlingPose(axis: ThrowAxis, frame: ThrowVisualFrame): 'flutter' | 'brake' | null {
  if (axis === 'vertical') return frame.vy >= 0 && frame.floorGap <= 0.56 ? 'flutter' : null;
  return frame.floorGap <= 0.18 && Math.abs(frame.vx) <= 640 ? 'brake' : null;
}
