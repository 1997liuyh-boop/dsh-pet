import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  advanceGrowth,
  applyGrowthCommand,
  applyTokenUsage,
  GROWTH_TICK_MS,
  growthView,
  initialGrowth,
} from './rules.ts';
import { GrowthStore } from './store.ts';
import { readGrowthUsage } from './usage.ts';

const now = 1_000_000;
const settle = (kind: 'study' | 'work', ticks: number) => ({ kind, nextAt: now + GROWTH_TICK_MS, remaining: ticks });

test('学习与工作每段累计经验和饱食消耗，连续进行额外降低心情', () => {
  const planned = applyGrowthCommand(initialGrowth(), 'study', now).next;
  assert.equal(advanceGrowth(planned, now + GROWTH_TICK_MS - 1), planned);
  const studied = advanceGrowth({ ...planned, activity: settle('study', 6) }, now + 6 * GROWTH_TICK_MS);
  const workStart = now + 6 * GROWTH_TICK_MS;
  const working = applyGrowthCommand(studied, 'work', workStart).next;
  const worked = growthView(advanceGrowth(working, workStart + GROWTH_TICK_MS), workStart + GROWTH_TICK_MS);
  assert.equal(worked.xp, 22);
  assert.equal(worked.fullness, 85);
  assert.equal(worked.mood, 92);
  assert.equal(worked.activity, 'work');
});

test('多次升级、饥饿、喂食和玩耍遵守状态边界', () => {
  const hungry = applyTokenUsage(initialGrowth(), 2_125_000);
  const hungryView = growthView(hungry, now);
  assert.deepEqual([hungryView.level, hungryView.xp, hungryView.fullness, hungryView.mood], [2, 12, 0, 50]);
  assert.equal(applyGrowthCommand(hungry, 'study', now).next, hungry);
  const fed = applyGrowthCommand(hungry, 'feed', now).next;
  const played = applyGrowthCommand(fed, 'play', now).next;
  assert.deepEqual([growthView(played, now).fullness, growthView(played, now).mood], [30, 68]);
  assert.equal(applyGrowthCommand(played, 'play', now + 1).next, played);
  assert.ok(applyGrowthCommand(played, 'study', now).next.activity);
});

test('只读取已结算的用量，流式事件取最后一份样本且不重复加推理量', () => {
  assert.equal(readGrowthUsage({ type: 'turn/end', seq: 1, data: {} }), null);
  assert.equal(readGrowthUsage({ type: 'assistant/message', seq: 2, data: {} }), null);
  const event = {
    type: 'assistant/attempt',
    seq: 3,
    data: {
      turn: 1,
      step: 2,
      stream: [
        { type: 'chunk', time: 1, chunk: { type: 'usage', usage: { inputTokens: 1 } } },
        {
          type: 'chunk',
          time: 2,
          chunk: {
            type: 'usage',
            usage: { inputTokens: 10, outputTokens: 20, reasoningTokens: 5, cacheReadTokens: 30, cacheWriteTokens: 40 },
          },
        },
      ],
    },
  };
  assert.deepEqual(readGrowthUsage(event), { seq: 3, slot: '[1,2]', tokens: 100 });
  assert.deepEqual(readGrowthUsage({ type: 'llm/retry-started', seq: 4, data: { turn: 1, step: 2 } }), {
    seq: 4,
    slot: '[1,2]',
    tokens: null,
  });
});

test('桌面和网页共享一轮活动，重启后补算并保留每个会话的去重游标', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'dsh-pet-growth-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  let clock = now;
  const file = join(folder, 'growth.json');
  const store = new GrowthStore(file, () => clock);
  const attempts = await Promise.all([store.command('pet', 'study'), store.command('pet', 'work')]);
  assert.deepEqual(
    attempts.map((value) => value.next.activity?.kind),
    ['study', 'study'],
  );
  const sample = { seq: 1, slot: '[1,0]', tokens: 10_000 };
  await store.recordUsage('session', sample, 'pet');
  assert.equal(await store.recordUsage('session', { ...sample, seq: 2 }, 'other'), undefined);
  await store.recordUsage('session', { ...sample, seq: 3, tokens: 20_000 }, 'other');

  clock += 24 * 60 * 60_000;
  const reopened = new GrowthStore(file, () => clock);
  assert.equal(await reopened.recordUsage('session', sample, 'other'), undefined);
  const [completed] = await reopened.tick();
  assert.ok(completed?.ended);
  assert.equal(growthView(completed.next, clock).xp, 32);
  assert.equal((await reopened.tick()).length, 0);
  assert.equal(growthView((await reopened.command('other', 'status')).next, clock).xp, 0);

  await reopened.recordUsage('session', { ...sample, seq: 4, tokens: null }, 'pet');
  await reopened.recordUsage('session', { ...sample, seq: 5 }, 'pet');
  assert.equal(growthView((await reopened.command('pet', 'status')).next, clock).xp, 33);
});
