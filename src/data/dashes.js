// Dash items (ruling 16, Kevin Nov 16: "the dash is an escape and nothing else"). Batch C2 owns
// this file's contents (work/cw/C2-DESIGN.md section 7); C1 drafts from it (sim/dash.js, sim/draft.js;
// work/cw/C1-CONTRACT.md section 14). Written here from C2's design table so the shared tree runs
// before C2's port; C2's own file replaces it as is.
//
// A run has one Dash slot holding one dash item. A dash item changes only how the dash works:
// distance, speed, charges, recharge, the moment after it you can't be hurt, and a plain mark on the
// ground (a slow or a knock, never damage). Nothing fires from the dash, and nothing refunds it.
//
//   character  whose starting item it is (undefined: drafted only). Every item can be drafted.
//   dist, time, cooldown   multipliers on tuning.player.dash distance, time, and cooldown (1 when left out)
//   charges    dashes held at once (1 when left out)
//   guard      s you can't be hurt once it ends (tuning.player.dash.iframesAfter when left out)
//   mark       null | { kind: 'slow', where: 'path' | 'end', radius, pct, sec }
//                    | { kind: 'knock', where: 'path' | 'end', radius, strength }
//   numbers    what its rolled cards can be: 'dash_recharge', 'dash_distance', 'dash_charges' (tuning.dashes)
//   icon, weight, unlock: as a weapon's.
// Loop check: none reads a kill, a hit, or a pickup; a charge comes back on time alone.

export const DASHES = [
  {
    id: 'wick_step', name: 'Wick Step', character: 'lamplighter', icon: 'icon_dash_wick',
    desc: 'Leaves a line of light for 1.5s. Enemies that cross it are slowed by 30%.',
    mark: { kind: 'slow', where: 'path', radius: 12, pct: 0.3, sec: 1.5 },
    numbers: ['dash_recharge', 'dash_distance'], weight: 100, unlock: 'starter',
  },
  {
    id: 'heavy_step', name: 'Heavy Step', character: 'harpooner', icon: 'icon_dash_heavy',
    desc: '40% shorter and recharges 25% faster. Knocks aside enemies it passes.',
    dist: 0.6, cooldown: 0.75,
    mark: { kind: 'knock', where: 'path', radius: 18, strength: 2 },
    numbers: ['dash_recharge', 'dash_distance'], weight: 100, unlock: 'starter',
  },
  {
    id: 'long_push', name: 'Long Push', character: 'punter', icon: 'icon_dash_long',
    desc: 'Goes 60% farther. Recharges 20% slower.',
    dist: 1.6, time: 1.3, cooldown: 1.2, mark: null,
    numbers: ['dash_recharge', 'dash_distance'], weight: 100, unlock: 'starter',
  },
  {
    id: 'mire_step', name: 'Mire Step', character: 'bog_warden', icon: 'icon_dash_mire',
    desc: 'Where it ends, the ground slows enemies by 50% for 2s.',
    mark: { kind: 'slow', where: 'end', radius: 34, pct: 0.5, sec: 2 },
    numbers: ['dash_recharge', 'dash_distance'], weight: 100, unlock: 'starter',
  },
  {
    id: 'sink', name: 'Sink', character: 'drowned_man', icon: 'icon_dash_sink',
    desc: '20% shorter. Nothing can hurt you for 0.4s after it.',
    dist: 0.8, guard: 0.4, mark: null,
    numbers: ['dash_recharge', 'dash_distance'], weight: 100, unlock: 'starter',
  },
  {
    id: 'swell', name: 'Swell', character: 'tide_priest', icon: 'icon_dash_swell',
    desc: 'Where it ends, a ring of water knocks back enemies close by.',
    mark: { kind: 'knock', where: 'end', radius: 40, strength: 4 },
    numbers: ['dash_recharge', 'dash_distance'], weight: 100, unlock: 'starter',
  },
  {
    id: 'spare_oar', name: 'Spare Oar', icon: 'icon_dash_oar',
    desc: 'Holds 2 dashes at once. Each recharges 30% slower.',
    charges: 2, cooldown: 1.3, mark: null,
    numbers: ['dash_recharge', 'dash_distance'], weight: 100, unlock: 'starter',
  },
  {
    id: 'quick_step', name: 'Light Step', icon: 'icon_dash_light',
    desc: '50% shorter. Recharges twice as fast.',
    dist: 0.5, cooldown: 0.5, mark: null,
    numbers: ['dash_recharge', 'dash_distance', 'dash_charges'], weight: 100, unlock: 'starter',
  },
];
