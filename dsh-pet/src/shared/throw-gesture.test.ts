/** 普通甩飞的方向、停留与落位契约。 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { throwSpace, type ThrowState } from './physics/throw.ts';
import { createThrowGesture, WALL_KICK_CONTACT_MS } from './throw-gesture.ts';

const display = { x: 0, y: 0, width: 1200, height: 900 };
const metrics = { size: 200, sideAllow: 55 };
const space = throwSpace({ areas: [display], ...metrics });

function last<T>(items: T[]): T {
  return items[items.length - 1];
}

function simulate(initial: ThrowState, region = space, lockScreen = -1) {
  const gesture = createThrowGesture(initial, lockScreen);
  const sample = (now: number) => ({ ...gesture.step(region, 0.01, now), now });
  const frames = [sample(10)];
  for (let now = 20; !last(frames)?.done && now <= 20000; now += 10) frames.push(sample(now));
  assert.equal(last(frames)?.done, true);
  return frames;
}

for (const direction of ['left', 'right'] as const) {
  test(`横甩向 ${direction} 放慢速度，贴墙半秒后回到松手位置`, () => {
    const initial = { x: 450, y: 330, vx: direction === 'left' ? -2800 : 2800, vy: 0 };
    const frames = simulate(initial);
    const wall = frames.filter(({ pose }) => pose === `${direction}-wall`);
    const final = last(frames)?.position;
    assert.ok(Math.abs(frames[0].position.vx) <= 951);
    assert.equal(wall.length, 50);
    const wallX = direction === 'left' ? space.bounds[0].minX : space.bounds[0].maxX;
    assert.ok(wall.every(({ position }) => position.x === wallX && position.vx === 0));
    assert.ok(frames.every(({ position }) => position.y === initial.y && position.vy === 0));
    const returning = frames.slice(frames.indexOf(last(wall)) + 1);
    assert.ok(returning.every(({ position }) => (direction === 'left' ? position.vx >= 0 : position.vx <= 0)));
    assert.equal(final?.x, initial.x);
  });
}

test('向上甩先到顶，随后连续缓降，触底直接停稳', () => {
  const frames = simulate({ x: 450, y: 330, vx: 0, vy: -1600 });
  const descending = frames.filter(({ pose }) => pose === 'descend');
  assert.equal(frames[0].pose, 'up');
  assert.equal(descending[0].position.y, space.bounds[0].minY);
  assert.ok(descending.every(({ position }, i) => i === 0 || position.y >= descending[i - 1].position.y));
  assert.ok(last(descending).now - descending[0].now >= 1800);
  assert.deepEqual(last(descending)?.position, { x: 450, y: space.bounds[0].maxY, vx: 0, vy: 0 });
});

test('向下甩直接缓降，不向顶部折返', () => {
  const frames = simulate({ x: 450, y: 330, vx: 0, vy: 1600 });
  assert.ok(frames.every(({ pose }) => pose === 'descend'));
  assert.equal(last(frames)?.position.y, space.bounds[0].maxY);
});

test('相邻屏幕接缝允许穿越，锁屏时在本屏边缘贴住', () => {
  const region = throwSpace({ areas: [display, { ...display, x: display.width }], ...metrics });
  const initial = { x: 900, y: 330, vx: 1900, vy: -50 };
  const across = simulate(initial, region).find(({ pose }) => pose === 'right-wall');
  const locked = simulate(initial, region, 0).find(({ pose }) => pose === 'right-wall');
  assert.equal(across?.position.x, region.bounds[1].maxX);
  assert.equal(locked?.position.x, region.bounds[0].maxX);
});

for (const [vx, vy] of [
  [900, -600],
  [-900, -600],
  [900, 600],
  [-900, 600],
]) {
  test(`斜甩保留松手角度 (${vx}, ${vy})`, () => {
    const initial = { x: 450, y: 330, vx, vy };
    const [first, second] = simulate(initial);
    const dx = second.position.x - first.position.x;
    const dy = second.position.y - first.position.y;
    assert.equal(Math.sign(dx), Math.sign(vx));
    assert.equal(Math.sign(dy), Math.sign(vy));
    assert.ok(Math.abs(dy / dx - vy / vx) < 1e-10);
  });
}

for (const side of ['left', 'right'] as const) {
  test(`斜上甩先碰 ${side} 侧墙时，脚掌发力后向内斜下回滑`, () => {
    const initial = { x: side === 'left' ? 90 : 900, y: 330, vx: side === 'left' ? -900 : 900, vy: -600 };
    const frames = simulate(initial);
    const kickPose = `${side}-wall-kick`;
    const kick = frames.filter(({ pose }) => pose === kickPose);
    assert.ok(kick.length > 0 && frames.slice(frames.indexOf(kick[0])).every(({ pose }) => pose === kickPose));
    const contact = kick[0];
    const wallX = side === 'left' ? space.bounds[0].minX : space.bounds[0].maxX;
    assert.equal(contact.position.x, wallX);
    assert.ok(contact.position.y < initial.y);
    const launch = kick.findIndex(({ position }) => position.x !== wallX);
    assert.ok(launch > 0);
    assert.equal(kick[launch].now - contact.now, WALL_KICK_CONTACT_MS + 10);
    assert.ok(kick.slice(0, launch).every(({ position }) => position.y === contact.position.y && position.vy === 0));
    for (let i = launch; i < kick.length; i++) {
      assert.ok(side === 'left' ? kick[i].position.x >= kick[i - 1].position.x : kick[i].position.x <= kick[i - 1].position.x);
      assert.ok(kick[i].position.y >= kick[i - 1].position.y);
    }
    assert.deepEqual({ x: last(frames).position.x, y: last(frames).position.y }, { x: initial.x, y: initial.y });
  });
}

test('横甩时的轻微上移和斜下甩都沿用普通返回动画', () => {
  for (const vy of [-35, 600]) {
    const frames = simulate({ x: 900, y: 330, vx: 900, vy });
    assert.ok(frames.some(({ pose }) => pose === 'right-wall'));
    assert.equal(last(frames).pose, 'left');
  }
});

test('斜甩先碰顶部时从撞顶位置开始缓降', () => {
  const frames = simulate({ x: 450, y: 90, vx: 400, vy: -1000 });
  const down = frames.filter(({ pose }) => pose === 'descend');
  assert.equal(down[0].position.y, space.bounds[0].minY);
  assert.ok(down[0].position.x > 450);
  assert.equal(last(frames).position.x, down[0].position.x);
});
