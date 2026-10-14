// The shape of a character's atlas frame, shared by the atlas builder (tools/atlas/atlas.mjs)
// and the renderer. The builder fingerprints every file it imports (ARCHITECTURE §16.3), so this
// file holds only what the atlas's pixels depend on.

/** A character's frame has this many pixels of room under her feet (the atlas pads it for what she holds). */
export const PLAYER_FEET_ROOM = 3;
