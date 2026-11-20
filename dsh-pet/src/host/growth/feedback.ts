import { animationNames } from '../anim.ts';
import type { PollStateStore } from '../state.ts';
import { growthLevel, growthStatusText } from './rules.ts';
import type { GrowthCommand } from './rules.ts';
import type { GrowthChange } from './store.ts';

const animations: Partial<Record<GrowthCommand | 'levelUp', readonly string[]>> = {
  study: ['工作状态-思考冒泡'],
  work: ['工作状态-忙碌点按'],
  play: ['原地专心玩魔方'],
  feed: ['吃饭·碗饭'],
  levelUp: ['升级庆祝', '工作状态-雀跃庆祝'],
};

export function growthFeedbackText(change: GrowthChange, text = '', now = Date.now()): string {
  const { next, ended, leveledUp } = change;
  const lines = [text];
  if (leveledUp) lines.unshift(`升级啦！现在是 Lv.${growthLevel(next)}。`);
  if (ended && !text) lines.push(next.fullness === 0 ? '肚子太饿了，先休息一下。' : '这轮活动结束啦。');
  lines.push(growthStatusText(next, now));
  return lines.filter(Boolean).join(' ');
}

export function publishGrowthAnimation(
  state: PollStateStore,
  conf: Record<string, unknown>,
  change: GrowthChange,
  animation?: GrowthCommand,
): void {
  const candidates = animations[change.leveledUp ? 'levelUp' : (animation ?? 'status')];
  if (!candidates) return;
  const available = animationNames(conf.animations);
  const name = candidates.find((item) => available.includes(item));
  if (name) state.writePet(change.petId, 'anim', { name });
}
