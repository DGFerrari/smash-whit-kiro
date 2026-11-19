import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  CharacterAnimator,
  CROSSFADE_SECONDS,
  playerVisualState,
  resolveClipPlan,
  selectAnimState,
  stepYaw,
  targetYaw,
  transitionFor,
  TURN_SECONDS,
  type PlayerVisualState,
} from './animator';

const idle: PlayerVisualState = {
  stunned: false,
  dodging: false,
  shieldRadius: 0,
  attackKind: null,
  charging: false,
  wallSliding: false,
  onGround: true,
  velX: 0,
  velY: 0,
  facing: 1,
};
const v = (over: Partial<PlayerVisualState>): PlayerVisualState => ({ ...idle, ...over });

describe('selectAnimState', () => {
  it('mapea cada condición aislada a su estado (R11.3)', () => {
    expect(selectAnimState(idle)).toBe('idle');
    expect(selectAnimState(v({ velX: 120 }))).toBe('run');
    expect(selectAnimState(v({ onGround: false, velY: -300 }))).toBe('jump');
    expect(selectAnimState(v({ onGround: false, velY: 0 }))).toBe('fall');
    expect(selectAnimState(v({ onGround: false, velY: 200 }))).toBe('fall');
    expect(selectAnimState(v({ onGround: false, wallSliding: true }))).toBe('wallSlide');
    expect(selectAnimState(v({ charging: true }))).toBe('charge');
    expect(selectAnimState(v({ attackKind: 'light' }))).toBe('light');
    expect(selectAnimState(v({ attackKind: 'heavy' }))).toBe('heavy');
    expect(selectAnimState(v({ shieldRadius: 20 }))).toBe('shield');
    expect(selectAnimState(v({ dodging: true }))).toBe('dodge');
    expect(selectAnimState(v({ stunned: true }))).toBe('stun');
  });

  it('respeta la prioridad descendente de R11.8', () => {
    const all = v({
      stunned: true,
      dodging: true,
      shieldRadius: 20,
      attackKind: 'heavy',
      charging: true,
      wallSliding: true,
      onGround: false,
      velX: 50,
      velY: -100,
    });
    expect(selectAnimState(all)).toBe('stun');
    expect(selectAnimState({ ...all, stunned: false })).toBe('dodge');
    expect(selectAnimState({ ...all, stunned: false, dodging: false })).toBe('shield');
    expect(selectAnimState({ ...all, stunned: false, dodging: false, shieldRadius: 0 })).toBe('heavy');
    expect(
      selectAnimState({ ...all, stunned: false, dodging: false, shieldRadius: 0, attackKind: 'light' }),
    ).toBe('light');
    expect(
      selectAnimState({ ...all, stunned: false, dodging: false, shieldRadius: 0, attackKind: null }),
    ).toBe('charge');
    expect(selectAnimState(v({ wallSliding: true, onGround: false, velY: -100 }))).toBe('wallSlide');
  });

  it('playerVisualState copia los campos reales del Player', () => {
    const p = { ...idle, attack: { def: { kind: 'heavy' as const } }, vel: { x: 3, y: -4 } };
    const snap = playerVisualState(p);
    expect(snap.attackKind).toBe('heavy');
    expect(snap.velX).toBe(3);
    expect(snap.velY).toBe(-4);
    expect(selectAnimState(snap)).toBe('heavy');
  });
});

describe('transitionFor', () => {
  it('fundido de 120 ms, instantáneo para ligero/pesado/esquiva', () => {
    expect(CROSSFADE_SECONDS).toBeLessThanOrEqual(0.15);
    expect(transitionFor('idle', 'idle')).toEqual({ kind: 'none' });
    expect(transitionFor(null, 'idle')).toEqual({ kind: 'instant' });
    expect(transitionFor('idle', 'run')).toEqual({ kind: 'crossfade', duration: 0.12 });
    for (const s of ['light', 'heavy', 'dodge'] as const) {
      expect(transitionFor('run', s)).toEqual({ kind: 'instant' });
    }
  });
});

describe('stepYaw', () => {
  it('completa el giro de -90° a +90° en 80 ms', () => {
    let yaw = targetYaw(-1);
    const target = targetYaw(1);
    let t = 0;
    const dt = 1 / 144;
    while (yaw !== target) {
      yaw = stepYaw(yaw, target, dt);
      t += dt;
    }
    expect(t).toBeLessThanOrEqual(TURN_SECONDS + dt);
    expect(t).toBeLessThanOrEqual(0.1);
  });
});

describe('resolveClipPlan', () => {
  it('usa sustitutos para los clips que faltan', () => {
    const plan = resolveClipPlan(['Idle', 'Jump', 'HeavySwing'], { heavy: 'HeavySwing' });
    expect(plan.idle).toEqual({ clip: 'Idle', frozen: false });
    expect(plan.fall).toEqual({ clip: 'Jump', frozen: false });
    expect(plan.wallSlide).toEqual({ clip: 'Jump', frozen: false });
    expect(plan.charge).toEqual({ clip: 'HeavySwing', frozen: true });
    expect(plan.celebrate).toEqual({ clip: 'Idle', frozen: false });
  });

  it('devuelve null si el modelo no trae clips', () => {
    expect(resolveClipPlan([]).idle).toBeNull();
  });
});

describe('CharacterAnimator', () => {
  const clip = (name: string) =>
    new THREE.AnimationClip(name, 1, [
      new THREE.NumberKeyframeTrack('.position[x]', [0, 1], [0, 1]),
    ]);

  it('cambia de estado, gira y fuerza la celebración sin clips completos', () => {
    const root = new THREE.Object3D();
    const [idleClip, runClip, lightClip] = [clip('idle'), clip('run'), clip('light')];
    const anim = new CharacterAnimator(root, [idleClip, runClip, lightClip]);
    anim.update(idle, 1 / 60);
    expect(anim.state).toBe('idle');
    expect(root.rotation.y).toBeCloseTo(Math.PI / 2);

    anim.update(v({ attackKind: 'light', facing: -1 }), 1 / 60);
    expect(anim.state).toBe('light');
    expect(anim.mixer.existingAction(lightClip)!.isRunning()).toBe(true);
    expect(anim.mixer.existingAction(idleClip)!.isRunning()).toBe(false);

    anim.setCelebrating(true);
    anim.update(v({ stunned: true, facing: -1 }), 0.1);
    expect(anim.state).toBe('celebrate');
    expect(root.rotation.y).toBeCloseTo(-Math.PI / 2);
    anim.dispose();
  });

  it('tolera un modelo sin animaciones', () => {
    const root = new THREE.Object3D();
    const anim = new CharacterAnimator(root, []);
    expect(() => anim.update(v({ velX: 10 }), 1 / 60)).not.toThrow();
    expect(anim.state).toBe('run');
  });
});
