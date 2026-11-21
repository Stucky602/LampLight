// A harbor building's frame (shared with the atlas builder, tools/atlas): its plot's size, plus
// ROOF_ROOM px of room above the roof for what rises from it (each building's own outline, 0.7.3:
// a bell-cote, a forge's stack, a lookout). The view stands a building by its foot on its plot's
// bottom edge, so the room only ever reaches up into the tile above the plot, which comes out of
// the fog with the building (data/hub.js, §20 call 54).

export const ROOF_ROOM = 16;
