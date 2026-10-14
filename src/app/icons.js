// Atlas sprites as DOM elements, for the menus: a span showing one frame of the atlas page,
// scaled by a whole number of game pixels (so an icon in a menu is exactly as crisp as in the
// world). The page is the same image file the renderer uses (src/assets/atlas.png).

export function createIconFactory(atlas, doc = document) {
  const url = atlas.url || '';
  return function icon(id, scale = 2) {
    const r = atlas.rect(id);
    const el = doc.createElement('span');
    el.className = 'icon';
    if (!r || !url) { el.classList.add('icon-blank'); return el; }
    const u = (n) => `calc(var(--u) * ${n})`;
    el.style.width = u(r.w * scale);
    el.style.height = u(r.h * scale);
    el.style.backgroundImage = `url(${url})`;
    el.style.backgroundPosition = `${u(-r.x * scale)} ${u(-r.y * scale)}`;
    el.style.backgroundSize = `${u(atlas.sheet.width * scale)} ${u(atlas.sheet.height * scale)}`;
    return el;
  };
}
