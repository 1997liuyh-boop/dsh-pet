import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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
  PLAY_DURATION_MS,
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

test('工作中可以连续切换项目，计时与结算不中断', () => {
  const started = applyGrowthCommand(initialGrowth(), 'work', now, 'copywriting').next;
  const tickAt = now + GROWTH_TICK_MS;
  const switched = applyGrowthCommand(started, 'work', tickAt - 1, 'video-editing');
  assert.equal(switched.text, '已切换到剪视频。');
  assert.deepEqual(switched.next.activity, { ...started.activity, project: 'video-editing' });
  const settled = advanceGrowth(switched.next, tickAt);
  const another = applyGrowthCommand(settled, 'work', tickAt + 1, 'carry-token').next;
  assert.deepEqual(another.activity, { ...settled.activity, project: 'carry-token' });
  assert.equal(growthView(another, tickAt + 1).xp, 4);
  assert.equal(growthView(another, tickAt + 1).fullness, 97);
  assert.equal(applyGrowthCommand(another, 'work', tickAt + 1, 'carry-token').next, another);
  assert.equal(applyGrowthCommand(another, 'study', tickAt + 1, 'drawing').next, another);
});

test('降低 Token 经验时仍正常结算饥饿、喂食和玩耍', () => {
  const hungry = applyTokenUsage(initialGrowth(), 2_125_000);
  const hungryView = growthView(hungry, now);
  assert.deepEqual([hungryView.level, hungryView.xp, hungryView.fullness, hungryView.mood], [0, 21, 0, 50]);
  assert.equal(applyGrowthCommand(hungry, 'study', now).next, hungry);
  const fed = applyGrowthCommand(hungry, 'feed', now).next;
  const played = applyGrowthCommand(fed, 'play', now).next;
  assert.deepEqual([growthView(played, now).fullness, growthView(played, now).mood], [30, 68]);
  assert.equal(applyGrowthCommand(played, 'play', now + 1).next, played);
  assert.equal(growthView(played, now).activity, 'play');
  assert.equal(applyGrowthCommand(played, 'study', now).next, played);
  assert.equal(advanceGrowth(played, now + PLAY_DURATION_MS - 1), played);
  const rested = advanceGrowth(played, now + PLAY_DURATION_MS);
  assert.equal(rested.activity, null);
  assert.equal(rested.mood, played.mood);
  assert.equal(rested.xp, played.xp);
  assert.equal(applyGrowthCommand(rested, 'study', now + PLAY_DURATION_MS).next.activity?.kind, 'study');
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
  assert.equal(growthView(completed.next, clock).xp, 30);
  assert.equal((await reopened.tick()).length, 0);
  assert.equal(growthView((await reopened.command('other', 'status')).next, clock).xp, 0);

  await reopened.recordUsage('session', { ...sample, seq: 4, tokens: null }, 'pet');
  await reopened.recordUsage('session', { ...sample, seq: 5 }, 'pet');
  assert.equal(growthView((await reopened.command('pet', 'status')).next, clock).xp, 30);
});

test('Token 按十万比一累计，升级后逐级提高经验门槛', () => {
  const first = applyTokenUsage(initialGrowth(), 99_999);
  assert.equal(growthView(first, now).xp, 0);
  assert.equal(growthView(applyTokenUsage(first, 1), now).xp, 1);
  const before = applyTokenUsage(initialGrowth(), 9_999_999);
  assert.equal(growthView(before, now).level, 0);
  const firstLevel = applyTokenUsage(before, 1);
  assert.deepEqual([firstLevel.level, firstLevel.xp, growthView(firstLevel, now).xpToLevel], [1, 0, 150]);
  const further = applyTokenUsage(firstLevel, 35_500_000);
  assert.deepEqual([further.level, growthView(further, now).xp, growthView(further, now).xpToLevel], [3, 5, 250]);
});

test('旧存档保留等级和进度比例，Token 零头重启后继续累计', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'dsh-pet-growth-legacy-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const file = join(folder, 'growth.json');
  const oldPet = {
    xp: 2_250_000,
    fullness: 900_000,
    mood: 880_000,
    effortTicks: 0,
    lastEffortAt: 0,
    playReadyAt: 0,
    activity: null,
  };
  await writeFile(file, JSON.stringify({ pets: [['pet', oldPet]], sessions: [] }));
  const store = new GrowthStore(file, () => now);
  const [migrated] = await store.snapshot();
  assert.equal(migrated?.leveledUp, false);
  assert.deepEqual([migrated?.next.level, migrated?.next.xp], [2, 500_000]);
  await store.recordUsage('session', { seq: 1, slot: '[1,0]', tokens: 99_999 }, 'pet');
  const reopened = new GrowthStore(file, () => now);
  const change = await reopened.recordUsage('session', { seq: 2, slot: '[1,0]', tokens: 100_000 }, 'pet');
  assert.ok(change);
  assert.equal(change.leveledUp, false);
  assert.deepEqual([change.next.level, growthView(change.next, now).xp, change.next.tokenRemainder], [2, 51, 0]);
});
