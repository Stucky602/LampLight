// Loading the atlas page (src/assets/atlas.png) as an image, before the atlas is made from it.
// Kept apart from render/atlas.js (which needs Pixi) so the gate can test it with a stand-in
// document.

/** Load the atlas page. Resolves with the decoded image; rejects with a plain message. */
export function loadAtlasImage(url, doc = document) {
  return new Promise((resolve, reject) => {
    const img = doc.createElement('img');
    img.onload = () => (img.decode ? img.decode().then(() => resolve(img), () => resolve(img)) : resolve(img));
    img.onerror = () => reject(new Error(`The sprite atlas didn't load (${url})`));
    img.src = url;
  });
}
