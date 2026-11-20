/** 普通鼠标甩飞的轨迹。保留松手角度，沿用逐屏边界，但接触边缘后不继承反弹速度。 */
import { throwStepRegion, type ThrowSpace, type ThrowState } from './physics/throw.ts';
import { MAX_STEP_DT } from './physics/constants.ts';
import { throwAxis } from './throw-visual.ts';

type FlightDirection = 'left' | 'right' | 'up' | 'down';
export type GesturePose = FlightDirection | 'descend' | 'left-wall' | 'right-wall' | 'left-wall-kick' | 'right-wall-kick';
export type ThrowAnimation = boolean | 'gesture';

export const WALL_HOLD_MS = 500;
export const WALL_KICK_MS = 720;
// 图集前三帧是触墙与发力，第四帧开始离墙。
export const WALL_KICK_CONTACT_MS = WALL_KICK_MS / 4;
const DIAGONAL_UP_SLOPE = 0.18;
const NO_GRAVITY = { gx: 0, gy: 0 };

function directionFor(vx: number, vy: number): FlightDirection {
  if (throwAxis(vx, vy) === 'vertical') return vy < 0 ? 'up' : 'down';
  return vx < 0 ? 'left' : 'right';
}

export function createThrowGesture(initial: ThrowState, lockScreen = -1) {
  const speed = Math.hypot(initial.vx, initial.vy);
  const scale = speed > 0 ? Math.min(0.65, 950 / speed) : 0;
  const vx = initial.vx * scale;
  const vy = initial.vy * scale;
  const outboundPose = directionFor(vx, vy);
  const wallEdge = vx < 0 ? 'left' : 'right';
  let contactPose: GesturePose = `${wallEdge}-wall`;
  let contactDuration = WALL_HOLD_MS;
  let wallKick = false;
  let downSpeed = 135;
  let phase: 'outbound' | 'descend' | 'wall' | 'return' = vx === 0 && vy > 0 ? 'descend' : 'outbound';
  let wallAt = 0;
  let returnDuration = 0;
  let returnMs = 0;
  let position = { ...initial, vx: 0, vy: 0 };
  let wallPosition = position;
  let returnPose: GesturePose = outboundPose;

  const step = (space: ThrowSpace, dtRaw: number, now: number) => {
    const dt = Math.min(MAX_STEP_DT, Math.max(0, dtRaw));
    const move = (vx: number, vy: number) => {
      const next = throwStepRegion({ ...position, vx, vy }, dt, space, undefined, lockScreen, NO_GRAVITY);
      position = {
        x: next.x,
        y: next.y,
        vx: vx && dt > 0 && !next.contacts.includes(vx < 0 ? 'left' : 'right') ? (next.x - position.x) / dt : 0,
        vy: vy && dt > 0 && !next.contacts.includes(vy < 0 ? 'ceiling' : 'floor') ? (next.y - position.y) / dt : 0,
      };
      return next.contacts;
    };
    const finishFrame = (pose: GesturePose, done = false) => ({ position, pose, done });

    if (phase === 'outbound') {
      const contacts = move(vx, vy);
      if (vx !== 0 && contacts.includes(wallEdge)) {
        phase = 'wall';
        wallAt = now;
        wallPosition = { ...position, vx: 0, vy: 0 };
        position = wallPosition;
        const dx = initial.x - wallPosition.x;
        const dy = initial.y - wallPosition.y;
        returnDuration = Math.max(750, (Math.hypot(dx, dy) / 750) * 1000);
        // 轻微的竖向手抖仍按横甩处理，贴墙与蹬墙各用自己的接触时长。
        wallKick = vy < -Math.abs(vx) * DIAGONAL_UP_SLOPE && dy > 0 && dx !== 0;
        if (wallKick) {
          contactPose = `${wallEdge}-wall-kick`;
          contactDuration = WALL_KICK_CONTACT_MS;
        }
        returnPose = wallKick ? contactPose : directionFor(dx, dy);
        return finishFrame(contactPose);
      }
      if (vy < 0 && contacts.includes('ceiling')) {
        phase = 'descend';
        position = { ...position, vx: 0, vy: 0 };
        return finishFrame('descend');
      }
      return finishFrame(
        outboundPose === 'down' ? 'descend' : outboundPose,
        speed === 0 || (vy > 0 && contacts.includes('floor')),
      );
    }

    if (phase === 'descend') {
      downSpeed = Math.min(420, downSpeed + 280 * dt);
      const contacts = move(0, downSpeed);
      return finishFrame('descend', contacts.includes('floor'));
    }

    const returnAge = now - wallAt - contactDuration;
    if (phase === 'wall' && returnAge < 0) {
      move(0, 0);
      return finishFrame(contactPose);
    }
    phase = 'return';
    returnMs += Math.min(dt * 1000, returnAge);
    const progress = Math.min(1, returnMs / returnDuration);
    // 蹬开时立即向内移动，抵达鼠标松手的位置前逐渐减速。
    const eased = wallKick ? progress + progress * progress * (1 - progress) : progress * progress * (3 - 2 * progress);
    const targetX = progress === 1 ? initial.x : wallPosition.x + (initial.x - wallPosition.x) * eased;
    const targetY = progress === 1 ? initial.y : wallPosition.y + (initial.y - wallPosition.y) * eased;
    move(dt > 0 ? (targetX - position.x) / dt : 0, dt > 0 ? (targetY - position.y) / dt : 0);
    return finishFrame(returnPose, progress === 1 && dt > 0);
  };

  return { step };
}
