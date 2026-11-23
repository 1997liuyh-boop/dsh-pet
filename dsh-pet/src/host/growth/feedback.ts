import { LEVEL_UP_ANIMATION, LEVEL_UP_FALLBACK_ANIMATION, growthAnimationAsset } from '../../shared/growth.ts';
import { growthPlayActions, growthProject } from '../../shared/growth-projects.ts';
import type { Animations } from '../../shared/types.ts';
import { animationNames } from '../anim.ts';
import type { PollStateStore } from '../state.ts';
import { activityEnd, growthLevel, growthStatusText, growthView } from './rules.ts';
import type { GrowthCommand } from './rules.ts';
import type { GrowthChange } from './store.ts';

const activityAnimations = { study: '工作状态-思考冒泡', work: '工作状态-忙碌点按', play: '原地专心玩魔方' };

export function growthFeedbackText(change: GrowthChange, text = '', now = Date.now()): string {
  const { next, ended, leveledUp } = change;
  const lines = [text];
  if (leveledUp) lines.unshift(`升级啦！现在是 Lv.${growthLevel(next)}。`);
  if (ended && !text)
    lines.push(next.fullness === 0 && ended !== 'play' ? '肚子太饿了，先休息一下。' : '这轮活动结束啦。');
  lines.push(growthStatusText(next, now));
  return lines.filter(Boolean).join('\n');
}

export function publishGrowthAnimation(
  state: PollStateStore,
  conf: Record<string, unknown>,
  change: GrowthChange,
  animation?: GrowthCommand,
  project?: string,
): void {
  const feedAsset = animation === 'feed' ? (project ?? '吃饭·碗饭') : null;
  const available = animationNames(conf.animations);
  const candidates = change.leveledUp ? [LEVEL_UP_ANIMATION, LEVEL_UP_FALLBACK_ANIMATION] : [feedAsset];
  const name = candidates.find((item) => item && available.includes(growthAnimationAsset(item)));
  if (name) state.writePet(change.petId, 'anim', { name });
}

export function publishGrowthState(
  state: PollStateStore,
  conf: Record<string, unknown> | undefined,
  change: GrowthChange,
): void {
  const now = Date.now();
  const { level, xp, xpToLevel, activity, project } = growthView(change.next, now);
  const until = activityEnd(change.next);
  let animation: string | null = null;
  if (activity && until > now) {
    const available = animationNames(conf?.animations);
    const item = project && activity !== 'play' ? growthProject(activity, project) : undefined;
    const fallback = item && 'fallback' in item ? item.fallback : undefined;
    const play =
      activity === 'play' &&
      growthPlayActions(conf?.animations as Animations | undefined).find((name) => name === project);
    animation =
      [item?.animation, fallback, play, activityAnimations[activity]].find(
        (name) => name && available.includes(name),
      ) || null;
  }
  state.writePet(change.petId, 'growth', { level, xp, xpToLevel, animation, until });
}
