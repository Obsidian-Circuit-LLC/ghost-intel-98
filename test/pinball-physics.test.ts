import { describe, it, expect } from 'vitest';
import { collideSegment, collideCircle, plungerLaunch, isDrained } from '../src/renderer/modules/pinball/physics';

describe('pinball physics (pure)', () => {
  it('reflects a ball off a wall: flips the normal velocity component and pushes it out', () => {
    const seg = { a: { x: 0, y: 100 }, b: { x: 10, y: 100 } }; // horizontal wall
    const h = collideSegment({ x: 5, y: 95 }, { x: 0, y: 3 }, seg, 8, 0.7)!; // ball moving down into it
    expect(h).not.toBeNull();
    expect(h.vel.y).toBeLessThan(0);          // now moving away (up)
    expect(h.pos.y).toBeCloseTo(92, 5);       // pushed out to r=8 from the wall
  });

  it('returns null when the ball is not touching the segment', () => {
    const seg = { a: { x: 0, y: 100 }, b: { x: 10, y: 100 } };
    expect(collideSegment({ x: 5, y: 50 }, { x: 0, y: 3 }, seg, 8, 0.7)).toBeNull();
  });

  it('a bumper adds an outward kick beyond a plain reflection', () => {
    const incoming = 5;
    const reflectedOnly = collideCircle({ x: 0, y: -15 }, { x: 0, y: incoming }, { x: 0, y: 0 }, 10, 8, 0.7, 0)!;
    const withKick = collideCircle({ x: 0, y: -15 }, { x: 0, y: incoming }, { x: 0, y: 0 }, 10, 8, 0.7, 4)!;
    expect(withKick.vel.y).toBeLessThan(reflectedOnly.vel.y); // more outward (more negative)
    expect(Math.abs(withKick.vel.y)).toBeGreaterThan(incoming);
    expect(withKick.pos.y).toBeCloseTo(-18, 5); // resting on the bumper surface (r+cr)
  });

  it('plunger launch speed is monotonic in charge and clamps at full power', () => {
    expect(plungerLaunch(1).y).toBeLessThan(plungerLaunch(0).y); // more charge → more upward
    expect(plungerLaunch(0.5).y).toBeLessThan(plungerLaunch(0).y);
    expect(plungerLaunch(2)).toEqual(plungerLaunch(1)); // clamped to [0,1]
  });

  it('isDrained triggers below the bottom line', () => {
    expect(isDrained({ x: 200, y: 776 }, 760)).toBe(true);
    expect(isDrained({ x: 200, y: 700 }, 760)).toBe(false);
  });
});
