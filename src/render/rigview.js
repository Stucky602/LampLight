// A boss rig drawn with Pixi sprites (ARCHITECTURE §5.13): one sprite per part, placed and turned
// each frame by render/rigs.js (the layout) and render/rigpose.js (the pose). The whole rig
// mirrors to face the way the boss walks, flashes white when hit (every part swaps to its #flash
// frame), and takes the boss's warning tint.

import { Container, Sprite } from 'pixi.js';
import { RIGS, createPose, rigPlace } from './rigs.js';
import { rigPose, rigLightAt, RIG_LIGHTS } from './rigpose.js';
import { color } from '../data/palette.js';

export function createRigView(atlas, id) {
  const rig = RIGS[id];
  if (!rig) throw new Error(`No rig "${id}"`);
  const view = new Container();
  const parts = rig.parts.map((p) => {
    const tex = atlas.tex(p.frame), flash = atlas.tex(`${p.frame}#flash`);
    const s = new Sprite(tex);
    s.anchor.set(p.px / tex.frame.width, p.py / tex.frame.height);
    view.addChild(s);
    return { s, tex, flash, flip: p.flip ? -1 : 1 };
  });
  const pose = createPose(rig);
  const at = new Float64Array(rig.parts.length * 2);
  /** What the pose is worked out from; the run view fills it in each frame (rigpose.js rigInput). */
  const input = { t: 0, state: 0, attack: '', u: 0 };
  const light = RIG_LIGHTS[id] || null;
  const lightColor = light ? color(light.color) : 0;
  const local = new Float64Array(2);
  return {
    view,
    input,
    /**
     * Pose and place the rig. x, y: the boss's position (whole pixels); facing: 1 or -1; flash:
     * the hit flash is on; tint: 0xrrggbb.
     */
    draw(x, y, facing, flash, tint) {
      rigPose(id, input, pose);
      rigPlace(id, pose, at);
      view.position.set(x, y);
      view.scale.x = facing;
      for (let k = 0; k < parts.length; k++) {
        const P = parts[k], s = P.s, o = k * 5;
        s.texture = flash ? P.flash : P.tex;
        s.position.set(Math.round(at[k * 2]), Math.round(at[k * 2 + 1]));
        s.rotation = pose[o + 2];
        s.scale.set(P.flip * pose[o + 3], pose[o + 4]);
        s.tint = tint;
      }
    },
    /**
     * Where the rig's light is (the Maw's lure, the Tidecaller's eyes), in world pixels, after
     * the last draw(). Writes [x, y, radius, 0xrrggbb] into `out`; false when the rig has no light.
     */
    lightAt(out) {
      if (!rigLightAt(id, pose, at, local)) return false;
      out[0] = view.position.x + local[0] * view.scale.x;   // the rig mirrors with its facing
      out[1] = view.position.y + local[1];
      out[2] = light.radius;
      out[3] = lightColor;
      return true;
    },
    destroy() { view.destroy({ children: true }); },
  };
}
