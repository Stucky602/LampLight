// Structure-of-arrays entity pools (ARCHITECTURE §5.3).
//
// One typed array per field, one dense index per live entity: live entities are always
// indices 0..count-1, so hot loops run over plain typed arrays with no per-entity objects and
// no garbage. Removal is swap-with-last (the last entity moves into the hole), so the arrays
// stay dense. Every field of a new entity starts at zero.
//
// Handles: anything that refers to another entity for more than a moment (a homing target, a
// chain hop, a boss slot) keeps a handle, not an index, because indices move when entities are
// removed. A handle is a stable slot id plus that slot's generation, packed into one
// non-negative int32 so it fits in an Int32Array field. Removing an entity bumps its slot's
// generation, so an old handle to it resolves to -1, even after the slot is reused.
// Generations wrap after 2^(31 - id bits) reuses of one slot (524,288 at a capacity of 4,096);
// only a handle kept that long could resolve again, and no run comes near it (enemy slots
// reach the tens). NO_HANDLE (-1) is the empty value.
//
// Iterating while removing: walk from count-1 down to 0. The entity that moves into index i
// comes from the end, which a backwards walk has already visited.

export const NO_HANDLE = -1;

const GEN_BITS = 31; // total bits in a handle; ids take the low bits, generations the rest

/**
 * @param {number} capacity maximum live entities (a power of two keeps the id mask exact)
 * @param {Record<string, Function | [Function, number]>} fields name -> typed array
 *   constructor, or [constructor, stride] for several values per entity (e.g. a hit ring)
 */
export function createPool(capacity, fields) {
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 1 << 20) throw new Error(`createPool: bad capacity ${capacity}`);
  let idBits = 0;
  while ((1 << idBits) < capacity) idBits++;
  const idSpace = 1 << idBits;
  const idMask = idSpace - 1;
  const genMask = ((1 << (GEN_BITS - idBits)) >>> 0) - 1;   // 2 to the (GEN_BITS - idBits), less 1 (>>> 0 keeps 1 << 31 positive)

  const idOf = new Int32Array(capacity);      // dense index -> slot id
  const denseOf = new Int32Array(capacity).fill(-1); // slot id -> dense index, or -1
  const gen = new Int32Array(capacity);       // slot id -> generation
  const freeIds = new Int32Array(capacity);   // stack of unused slot ids
  let freeTop = capacity;
  for (let i = 0; i < capacity; i++) freeIds[i] = capacity - 1 - i; // id 0 is used first

  const pool = {
    capacity,
    count: 0,
    /** Most entities alive at once (the soak test reports it). */
    highWater: 0,
    /** Spawns refused because the pool was full. */
    refused: 0,
  };
  const columns = []; // [array, stride]
  // Single-value columns grouped by array type, so each copy loop in remove() only ever sees
  // one type. A loop over mixed typed arrays makes V8's element access megamorphic, and a
  // megamorphic read from a float array boxes the number (16 bytes per field per removal).
  const f32 = [], f64 = [], i8 = [], u8 = [], i16 = [], u16 = [], i32 = [], strided = [];
  const GROUP = new Map([[Float32Array, f32], [Float64Array, f64], [Int8Array, i8], [Uint8Array, u8], [Int16Array, i16], [Uint16Array, u16], [Int32Array, i32]]);
  for (const [name, spec] of Object.entries(fields)) {
    if (name in pool) throw new Error(`createPool: field name "${name}" is reserved`);
    const [Ctor, stride] = Array.isArray(spec) ? spec : [spec, 1];
    if (!Number.isInteger(stride) || stride < 1) throw new Error(`createPool: bad stride for ${name}`);
    if (!GROUP.has(Ctor)) throw new Error(`createPool: field ${name} must be a typed array (Float32/64, Int8/16/32, Uint8/16)`);
    const arr = new Ctor(capacity * stride);
    pool[name] = arr;
    columns.push([arr, stride]);
    if (stride === 1) GROUP.get(Ctor).push(arr); else strided.push([arr, stride]);
  }

  /** Add an entity with every field zeroed. Returns its dense index, or -1 if the pool is full. */
  pool.alloc = function alloc() {
    if (pool.count >= capacity) { pool.refused++; return -1; }
    const id = freeIds[--freeTop];
    const i = pool.count++;
    idOf[i] = id;
    denseOf[id] = i;
    for (let c = 0; c < columns.length; c++) {
      const col = columns[c], arr = col[0], stride = col[1];
      if (stride === 1) arr[i] = 0;
      else arr.fill(0, i * stride, i * stride + stride);
    }
    if (pool.count > pool.highWater) pool.highWater = pool.count;
    return i;
  };

  /** Remove the entity at dense index i (swap-with-last). Old handles to it stop resolving. */
  pool.remove = function remove(i) {
    const n = pool.count;
    if (!(i >= 0 && i < n)) throw new Error(`pool.remove: index ${i} is not live (count ${n})`);
    const id = idOf[i];
    const last = n - 1;
    if (i !== last) {
      for (let c = 0; c < f32.length; c++) f32[c][i] = f32[c][last];
      for (let c = 0; c < f64.length; c++) f64[c][i] = f64[c][last];
      for (let c = 0; c < i8.length; c++) i8[c][i] = i8[c][last];
      for (let c = 0; c < u8.length; c++) u8[c][i] = u8[c][last];
      for (let c = 0; c < i16.length; c++) i16[c][i] = i16[c][last];
      for (let c = 0; c < u16.length; c++) u16[c][i] = u16[c][last];
      for (let c = 0; c < i32.length; c++) i32[c][i] = i32[c][last];
      for (let c = 0; c < strided.length; c++) {
        const arr = strided[c][0], stride = strided[c][1];
        arr.copyWithin(i * stride, last * stride, last * stride + stride);
      }
      const movedId = idOf[last];
      idOf[i] = movedId;
      denseOf[movedId] = i;
    }
    denseOf[id] = -1;
    gen[id] = (gen[id] + 1) & genMask;
    freeIds[freeTop++] = id;
    pool.count = last;
  };

  /** The handle for the entity at dense index i (NO_HANDLE if i isn't live). */
  pool.handle = function handle(i) {
    if (!(i >= 0 && i < pool.count)) return NO_HANDLE;
    const id = idOf[i];
    return gen[id] * idSpace + id;
  };

  /**
   * The stable slot id of the entity at dense index i (0 to capacity - 1). The renderer keys its
   * own per-entity state (facing, squash) by it; a slot's id is reused after its entity is
   * removed, so pair it with handle(i) to notice a newcomer.
   */
  pool.idAt = function idAt(i) { return idOf[i]; };

  /** The slot id inside a handle (no liveness check). */
  pool.slotOf = function slotOf(h) { return h & idMask; };

  /** Dense index for a handle, or -1 if that entity is gone (or the handle is NO_HANDLE). */
  pool.resolve = function resolve(h) {
    if (h < 0) return -1;
    const id = h & idMask;
    if (id >= capacity) return -1;
    const i = denseOf[id];
    if (i < 0 || gen[id] !== ((h - id) / idSpace)) return -1;
    return i;
  };

  /** Remove everything. Every outstanding handle stops resolving. */
  pool.clear = function clear() {
    while (pool.count > 0) pool.remove(pool.count - 1);
  };

  /** For the state hash: the dense order and slot bookkeeping, which decide future behavior. */
  pool.hashInto = function hashInto(h) {
    h.int(pool.count);
    h.array(idOf, pool.count);
    for (let c = 0; c < columns.length; c++) h.array(columns[c][0], pool.count * columns[c][1]);
    h.array(gen);
    h.int(freeTop);
    h.array(freeIds, freeTop);
    return h;
  };

  return pool;
}
