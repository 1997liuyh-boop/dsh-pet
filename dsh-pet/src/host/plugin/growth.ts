import type { LoggerLike } from '../log-file.ts';
import type { PollStateStore } from '../state.ts';
import { sessionIdOf } from '../notify-events.ts';
import { growthFeedbackText, publishGrowthAnimation, publishGrowthState } from '../growth/feedback.ts';
import type { GrowthChange, GrowthStore } from '../growth/store.ts';
import { readGrowthUsage } from '../growth/usage.ts';

interface GrowthLifecycle {
  effect(start: () => () => void, label: string): void;
  on(name: 'session/event', listener: (session: unknown, event: unknown) => void): () => void;
}

export function registerGrowth(deps: {
  ctx: GrowthLifecycle;
  log: LoggerLike;
  growth: GrowthStore;
  state: PollStateStore;
  resolveActivePetId: () => string;
  canShow: (petId: string) => boolean;
  petConfig: (petId: string) => Record<string, unknown> | undefined;
}): void {
  const { ctx, log, growth, state, resolveActivePetId, canShow, petConfig } = deps;
  ctx.effect(() => {
    let disposed = false;
    const publish = (change: GrowthChange): void => {
      if (disposed) return;
      const conf = petConfig(change.petId);
      publishGrowthState(state, conf, change);
      if ((!change.leveledUp && !change.ended) || !canShow(change.petId)) return;
      if (!conf) return;
      publishGrowthAnimation(state, conf, change);
      state.writePet(change.petId, 'say', { text: growthFeedbackText(change), duration: 6500, anim: false });
    };
    const report = (error: unknown): void => log.warn?.('[dsh-pet] 养成结算失败：' + String(error));
    // session/event 只接收实时提交的会话事件，不扫描历史日志。
    const off = ctx.on('session/event', (session, event) => {
      const usage = readGrowthUsage(event);
      if (!usage) return;
      const id = sessionIdOf(session);
      if (!id || id === 'unknown') return;
      void growth
        .recordUsage(id, usage, resolveActivePetId())
        .then((change) => {
          if (change) publish(change);
        })
        .catch(report);
    });
    void growth
      .snapshot()
      .then((changes) => changes.forEach(publish))
      .catch(report);
    const timer = setInterval(() => {
      void growth
        .tick()
        .then((changes) => changes.forEach(publish))
        .catch(report);
    }, 5000);
    return () => {
      disposed = true;
      clearInterval(timer);
      off();
    };
  }, 'dsh-pet: pet growth');
}
