import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import {
  advanceGrowth,
  applyGrowthCommand,
  applyTokenUsage,
  growthLevel,
  initialGrowth,
  petGrowthSchema,
} from './rules.ts';
import type { GrowthCommand, PetGrowth } from './rules.ts';
import { usageCursorSchema } from './usage.ts';
import type { readGrowthUsage } from './usage.ts';

const fileSchema = z.object({
  pets: z.array(z.tuple([z.string(), petGrowthSchema])),
  sessions: z.array(z.tuple([z.string(), usageCursorSchema])),
});
type GrowthFile = z.infer<typeof fileSchema>;
type GrowthUsage = NonNullable<ReturnType<typeof readGrowthUsage>>;

export interface GrowthChange {
  petId: string;
  next: PetGrowth;
  leveledUp: boolean;
  ended: boolean;
}

function changeOf(petId: string, prev: PetGrowth, next: PetGrowth): GrowthChange {
  return {
    petId,
    next,
    leveledUp: growthLevel(next) > growthLevel(prev),
    ended: prev.activity !== null && next.activity === null,
  };
}

export class GrowthStore {
  declare private cached: GrowthFile | undefined;
  declare private queue: Promise<void>;

  declare private readonly file: string;
  declare private readonly now: () => number;

  constructor(file: string, now = Date.now) {
    this.file = file;
    this.now = now;
    this.queue = Promise.resolve();
  }

  private run<T>(task: (data: GrowthFile, now: number) => Promise<T>): Promise<T> {
    const job = this.queue.then(async () => {
      if (!this.cached) {
        try {
          this.cached = fileSchema.parse(JSON.parse(await readFile(this.file, 'utf8')));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          this.cached = { pets: [], sessions: [] };
        }
      }
      return task(this.cached, this.now());
    });
    this.queue = job.then(
      () => undefined,
      () => undefined,
    );
    return job;
  }

  private async save(data: GrowthFile): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    const temp = `${this.file}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(data), 'utf8');
    await rename(temp, this.file);
    this.cached = data;
  }

  command(petId: string, command: GrowthCommand, validate?: () => void) {
    return this.run(async (data, now) => {
      validate?.();
      const pets = new Map(data.pets);
      const prev = pets.get(petId) ?? initialGrowth();
      const { next, text, animation } = applyGrowthCommand(advanceGrowth(prev, now), command, now);
      if (next !== prev) {
        pets.set(petId, next);
        await this.save({ ...data, pets: [...pets] });
      }
      return { ...changeOf(petId, prev, next), text, animation, now };
    });
  }

  tick(): Promise<GrowthChange[]> {
    return this.run(async (data, now) => {
      const changes: GrowthChange[] = [];
      const pets = data.pets.map(([petId, prev]): [string, PetGrowth] => {
        const next = advanceGrowth(prev, now);
        if (next !== prev) changes.push(changeOf(petId, prev, next));
        return [petId, next];
      });
      if (changes.length) await this.save({ ...data, pets });
      return changes;
    });
  }

  recordUsage(sessionId: string, sample: GrowthUsage, activePet: string): Promise<GrowthChange | undefined> {
    return this.run(async (data, now) => {
      const sessions = new Map(data.sessions);
      const cursor = sessions.get(sessionId);
      if (cursor && cursor.seq >= sample.seq) return;
      const sameSlot = cursor?.slot === sample.slot;
      if (sample.tokens === null && !sameSlot) return;
      const previous = sameSlot ? cursor.tokens : 0;
      // 一个请求的 attempt/message 可能重复报告。补记更大的样本，重试则从新的请求开始累计。
      const delta = sample.tokens === null ? 0 : Math.max(0, sample.tokens - previous);
      const petId = sameSlot && sample.tokens !== null ? cursor.petId : activePet;
      if (!petId) return;
      sessions.set(sessionId, {
        seq: sample.seq,
        slot: sample.tokens === null ? '' : sample.slot,
        tokens: sample.tokens === null ? 0 : Math.max(previous, sample.tokens),
        petId,
      });
      if (!delta) {
        await this.save({ ...data, sessions: [...sessions] });
        return;
      }
      const pets = new Map(data.pets);
      const prev = pets.get(petId) ?? initialGrowth();
      const next = applyTokenUsage(advanceGrowth(prev, now), delta);
      pets.set(petId, next);
      await this.save({ pets: [...pets], sessions: [...sessions] });
      return changeOf(petId, prev, next);
    });
  }
}
