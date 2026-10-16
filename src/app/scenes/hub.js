// The harbor scene (ARCHITECTURE §10.4): walk the town between runs. Doors open the buildings'
// panels, the gate at the quay's west end sets out on a run, the keepers and the characters on the
// square say their lines, and a purchase plays out in the town (the ceremony, the fog peeling
// back, a boat bringing someone in). After a run the results come up over the harbor.
//
// The harbor world is pure (hub/world.js); this scene feeds it input, draws it (render/hubview.js),
// shows the DOM over it (ui/hubhud.js, ui/hubscreens.js), and does the buying and saving through
// the meta layer. A safe point (the game may reload here) only while it's idle: nothing on screen
// (the results, a panel, the gate, the menu) and no set piece running; `onIdle` says when it
// becomes idle again.
//
// The tuning panel opens here too (F1, or hold Create; ARCHITECTURE §15): the harbor's own numbers
// (data/tuning.js HUB_TUNING, live through hub/tuning.js), and the harbor's dev commands (add
// materials, unlock everything; meta/dev.js), which change the saved profile like a purchase.

import { createHubWorld, stepHub, setPeople, setProps, startCeremony, startArrival, skipTimeline } from '../../hub/world.js';
import { createHubTuning, setHubTune, resetHubTuning } from '../../hub/tuning.js';
import { HUB_TERRAIN } from '../../data/hub.js';
import { revealedFog, hubPeople, shownProps, resolveContent } from '../../meta/state.js';
import { restoreBuilding, buyUpgrade, startResearch, MetaError } from '../../meta/actions.js';
import { nextAffordable } from '../../meta/next.js';
import { devAddMaterials, devUnlockAll } from '../../meta/dev.js';
import { buildingScreen, gateScreen, resultsScreen, hubMenuScreen } from '../../ui/hubscreens.js';
import { rankText } from '../../ui/hubtext.js';
import { tuningScreen } from '../../ui/tuning.js';
import { tuningDiff, tuningCopyText } from '../../ui/tuningmodel.js';
import { createHubHud, onScreen, routeExit } from '../../ui/hubhud.js';
import { routeTo } from '../../hub/map.js';
import { TILE } from '../../sim/terrain.js';
import { levelsOf, levelSetPieces, lineFor, promptFor, runHeading } from '../hublogic.js';
import { guideStep } from '../../meta/guide.js';
import { VIEW_W, VIEW_H } from '../../render/layout.js';

const SPEECH_MS = 4200;

/**
 * deps: { view (render/hubview.js), input, ui, menuCtx, audio, data, profile: { get(), save(doc) },
 * startRun({ character }), onTitle(), onSettings(), onQuit (desktop), onIdle(), hubTuning (the
 * live tuning the view draws with; a fresh one if not given), buildId, copyText(text) }
 */
export function createHubScene(deps) {
  const { view, input, ui, menuCtx, audio, data } = deps;
  const live = deps.hubTuning ?? createHubTuning(data.hubTuning);
  let world = null;
  let hud = null;
  let panel = null;          // the building panel that's open (it redraws after a purchase)
  let tuningOpen = null;     // the tuning panel, while it's open
  let pendingBanner = null;  // shown when the ceremony's building is done
  let wasBusy = false;       // last frame had a screen open or a set piece running
  let guide = null;          // the new player's guide: one goal and where it is (meta/guide.js)

  const doc = () => deps.profile.get();
  const sound = (name) => { if (audio.ok) audio.play(name); };

  function refreshHud() {
    const d = doc();
    hud.setMaterials(d.profile.materials);
    hud.setNext(nextAffordable(d, data, 3));
    guide = guideStep(d, data);
  }

  /** The walk from your tile to the guide's target (gate, or a building's door), kept until either moves. */
  let route = { key: '', path: null };
  function guideRoute() {
    const p = world.player, t = guide.target;
    const to = t.kind === 'gate' ? data.hub.gate.at : data.hub.plots.find((x) => x.building === t.id)?.door;
    if (!to) return null;
    const from = [Math.floor(p.x / TILE), Math.floor(p.y / TILE)];
    const key = `${from} ${to} ${world.revealed.size} ${world.props.length}`;
    if (key !== route.key) route = { key, path: routeTo(world.map, world.solid, from, to) };
    return route.path;
  }

  /** Keep the new profile, save it, and redraw what shows it. */
  function commit(next) {
    deps.profile.save(next);
    refreshHud();
    panel?.refresh();
  }

  // ---------------------------------------------------------------- buying

  /** A purchase the meta layer refused (the panels say why before you press, so this is rare). */
  function refused(e) {
    if (!(e instanceof MetaError)) throw e;
    panel?.say(e.message);
    sound('ui_back');
  }

  function restore(building) {
    let out;
    try { out = restoreBuilding(doc(), data, building); } catch (e) { refused(e); return; }
    commit(out.doc);
    const change = out.changes[0];
    const plan = levelSetPieces(out.doc, data, change);
    ui.closeAll();
    panel = null;
    view.setLevels(levelsOf(out.doc, data));
    startCeremony(world, plan.ceremony);
    for (const a of plan.arrivals) startArrival(world, a);
    pendingBanner = plan.banner;
    sound('ui_confirm');
  }

  function upgrade(id) {
    try { const out = buyUpgrade(doc(), data, id); commit(out.doc); sound('pickup'); panel?.say(rankText(data, id, out.changes[0].rank)); } catch (e) { refused(e); }
  }

  function research(id) {
    try { const out = startResearch(doc(), data, id); commit(out.doc); sound('pickup'); panel?.say(`Research started: ${data.research.find((r) => r.id === id).name}`); } catch (e) { refused(e); }
  }

  // ---------------------------------------------------------------- the harbor from the profile

  /**
   * Build the harbor's world from the profile: the fog, the props, who is out, the stages. `keep`
   * (a world) keeps where you stand and face, so rebuilding under you (after Unlock everything)
   * doesn't move you; anything that came out where you stand steps you aside.
   */
  function buildWorld(keep = null) {
    const d = doc();
    const avatar = data.characters.find((c) => c.id === data.hub.avatar);
    world = createHubWorld({
      hub: data.hub, terrain: HUB_TERRAIN, tuning: data.tuning, timing: live.timing,
      revealed: revealedFog(d, data), props: shownProps(d, data), moveSpeed: avatar?.base?.moveSpeed ?? 1,
    });
    if (keep) {
      const p = world.player, q = keep.player;
      p.x = p.px = q.x; p.y = p.py = q.y; p.fx = q.fx; p.fy = q.fy; p.facing = q.facing;
      world.cam.x = world.cam.px = p.x; world.cam.y = world.cam.py = p.y;
      setProps(world, world.props);
    }
    setPeople(world, hubPeople(d, data));
    view.attach(world, levelsOf(d, data));
  }

  // ---------------------------------------------------------------- the tuning panel (§15)

  /** A dev command's change to the profile: kept and saved like a purchase. */
  function devCommand(make) {
    let out;
    try { out = make(); } catch (e) { if (e instanceof MetaError) return e.message; throw e; }
    commit(out.doc);
    return out;
  }

  function harborCommands() {
    const add = (n) => () => {
      const out = devCommand(() => devAddMaterials(doc(), data, n));
      return typeof out === 'string' ? out : `Added ${n.toLocaleString('en-US')} of each material the maps drop (${out.changes.length} kinds). Saved to your profile.`;
    };
    return [
      { key: 'mats100', label: 'Add 100 of every material', run: add(100) },
      { key: 'mats1000', label: 'Add 1,000 of every material', run: add(1000) },
      {
        key: 'unlockAll', label: 'Unlock everything: every building restored, all research done',
        run: () => {
          const out = devCommand(() => devUnlockAll(doc(), data));
          if (typeof out === 'string') return out;
          // The harbor as it is now, at once (no ceremonies), where you stand.
          pendingBanner = null;
          buildWorld(world);
          const n = out.unlocks.length;
          return `Every building restored and all research complete${n ? ` (${n} unlocked)` : ''}. Saved to your profile.`;
        },
      },
    ];
  }

  function toggleTuning() {
    if (tuningOpen) { ui.close(tuningOpen); return; }
    // The panel's paths start "hub." (the harbor's numbers, apart from the run's in a copy).
    const inner = (path) => path.replace(/^hub\./, '');
    tuningOpen = tuningScreen(menuCtx, {
      defaults: { hub: data.hubTuning }, current: { hub: live }, commands: harborCommands(),
      intro: 'Left and right change a value, and the harbor shows it at once. Changes last until the game closes.',
      onTune: (path, value) => { try { setHubTune(live, inner(path), value); return null; } catch (e) { return e.message; } },
      onCopy: () => deps.copyText(tuningCopyText(tuningDiff({ hub: data.hubTuning }, { hub: live }), { build: deps.buildId ?? '', when: 'the harbor' })),
      onReset: () => resetHubTuning(live, data.hubTuning),
      onClose: () => ui.close(tuningOpen),
    });
    tuningOpen.onClose = () => { tuningOpen = null; };
    ui.push(tuningOpen);
  }

  // ---------------------------------------------------------------- screens

  function openBuilding(building) {
    panel = buildingScreen(menuCtx, {
      data, building, get: () => ({ doc: doc() }),
      onRestore: () => restore(building),
      onUpgrade: (id) => upgrade(id),
      onResearch: (id) => research(id),
      onClose: () => { ui.close(panel); panel = null; },
    });
    ui.push(panel);
  }

  function openGate() {
    const have = new Set(resolveContent(doc(), data).characters);
    const chars = data.characters.filter((c) => have.has(c.id)).map((c) => ({ ...c, startName: data.weapons.find((w) => w.id === c.start)?.name }));
    const map = data.maps[0];
    const s = gateScreen(menuCtx, {
      characters: chars, map: { name: map.name, desc: map.desc },
      onSetOut: (id) => { ui.closeAll(); deps.startRun({ character: id }); },
      onBack: () => ui.close(s),
    });
    ui.push(s);
  }

  function openMenu() {
    const s = hubMenuScreen(menuCtx, {
      onResume: () => ui.close(s),
      onSetOut: () => { ui.close(s); openGate(); },
      onSettings: () => deps.onSettings(),
      onTitle: () => { ui.closeAll(); deps.onTitle(); },
      onQuit: deps.onQuit || null,
    });
    ui.push(s);
  }

  function showResults({ changes, result, runs = 1 }) {
    const s = resultsScreen(menuCtx, {
      data, changes, next: nextAffordable(doc(), data, 3), summary: runHeading(result, runs, data),
      onContinue: () => ui.close(s),
      onSetOut: () => { ui.close(s); openGate(); },
    });
    ui.push(s);
  }

  function use(near) {
    if (near.kind === 'door') { sound('ui_confirm'); openBuilding(near.id); return; }
    if (near.kind === 'gate') { sound('ui_confirm'); openGate(); return; }
    const line = lineFor(doc(), data, near.id);
    if (line) { sound('ui_move'); hud.say(near.id, line.name, line.text, view.now + SPEECH_MS); }
  }

  /** What the harbor's set pieces and your dash sound like, and the banner when a level is built. */
  function onEvent(e) {
    if (e.kind === 'dash') sound('dash');
    else if (e.kind === 'build_start') sound('bell_ring');
    else if (e.kind === 'build_done') {
      sound('level_up');
      if (pendingBanner) { hud.showBanner(pendingBanner.title, pendingBanner.lines, view.now); pendingBanner = null; }
    } else if (e.kind === 'landed') sound('reel_land');
    else if (e.kind === 'walk_off' && !ui.open && !world.timeline) { sound('ui_confirm'); openGate(); }
  }

  // ---------------------------------------------------------------- scene

  return {
    /** In the harbor with nothing on screen and no set piece running (a safe point then). */
    get idle() { return world !== null && !ui.open && !world.timeline; },
    get world() { return world; },
    get hudForTools() { return hud; },
    /** The harbor's live tuning (the view draws with it; a report copies what changed). */
    get tuning() { return live; },
    // For the smoke and screenshot tools.
    openBuildingForTools: (id) => openBuilding(id),
    toggleTuningForTools: () => toggleTuning(),
    openGateForTools: () => openGate(),
    restoreForTools: (id) => restore(id),
    skipForTools: () => { if (world) for (const e of skipTimeline(world)) onEvent(e); },
    enter(params = {}) {
      buildWorld();
      tuningOpen = null;
      hud = createHubHud({ root: ui.view, icon: menuCtx.icon, glyph: (a) => ui.glyph(a), data, viewW: VIEW_W, viewH: VIEW_H });
      refreshHud();
      wasBusy = false;
      if (params.results) { showResults(params.results); wasBusy = true; }
    },
    exit() {
      ui.closeAll();
      view.detach();
      hud?.destroy(); hud = null;
      world = null; panel = null; tuningOpen = null; pendingBanner = null;
    },
    step(dt) {
      if (!world) return;
      // In the harbor ✕ or A and Space confirm, so only the dash's own buttons dash (R1, RB, Shift).
      stepHub(world, ui.open ? null : input.sampleFrame({ dashOnly: true }), dt);
      for (const e of world.events) onEvent(e);
    },
    frame(alpha, frameMs) {
      if (!world) return;
      if (!ui.open) {
        if (input.fired('tuning')) toggleTuning();
        else if (world.timeline) { if (input.fired('confirm') || input.fired('back')) for (const e of skipTimeline(world)) onEvent(e); }
        else if (input.fired('pause')) openMenu();
        else if (input.fired('confirm') && world.near) use(world.near);
      } else if (tuningOpen && ui.top === tuningOpen && input.fired('tuning')) toggleTuning();
      view.draw(alpha, frameMs);
      // The DOM over the harbor: the prompt over what's in reach, a keeper's bubble, the banner.
      const busy = ui.open || !!world.timeline;
      if (wasBusy && !busy) deps.onIdle?.();
      wasBusy = busy;
      // The tuning panel keeps to the right: the materials and Next up stay in view beside it.
      hud.setQuiet(busy && !(tuningOpen && ui.top === tuningOpen && !world.timeline));
      hud.setSkip(!!world.timeline && !ui.open);
      hud.placePlayer(busy ? null : view.toView(world.player.x, world.player.y));
      const near = busy ? null : world.near;
      const anchor = view.anchorOf(near);
      hud.setPrompt(near && hud.speaking !== near.id ? promptFor(data, near) : null, anchor ? view.toView(anchor.x, anchor.y) : null);
      const speaker = hud.speaking ? world.people.find((p) => p.id === hud.speaking) : null;
      hud.placeBubble(speaker ? view.toView(speaker.x, speaker.y - 26) : null, view.now, near?.id ?? null);
      // The guide: its goal at the top, and a marker where its prompt would be (over the lamp, the
      // sign, the door), or at the edge pointing there; once it's in reach the prompt takes over.
      const reached = guide && near && near.kind === guide.target.kind && (near.kind === 'gate' || near.id === guide.target.id);
      const target = guide && !busy && !reached ? view.anchorOf(guide.target) : null;
      let markAt = target ? view.toView(target.x, target.y) : null;
      // Off screen, the arrow follows the walk there (where it leaves the screen), not a straight
      // line through the fog.
      if (markAt && !onScreen(markAt, VIEW_W, VIEW_H)) markAt = routeExit(guideRoute(), (t) => view.toView((t[0] + 0.5) * TILE, (t[1] + 0.5) * TILE), VIEW_W, VIEW_H) ?? markAt;
      hud.setGuide(guide && !busy ? guide.text : null, markAt);
      hud.tick(view.now);
    },
  };
}
