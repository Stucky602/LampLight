# The HUD's pixel font from the menus' own typeface (0.9.0: one typeface for menus and HUD).
# Samples Jersey 10 (src/ui/fonts/jersey-10-400.woff2, SIL OFL) on its own design grid: its
# outlines all sit on multiples of 75 font units, so at 75 units a pixel every edge lands on a
# pixel edge and the bitmap is exact (caps 10 px, strokes 2 px, descenders 2 px). Prints the glyph
# table src/render/font.js holds.
#
#   python3 tools/font/jersey.py           (workspace only: needs fontTools and brotli)
import sys
from fontTools.ttLib import TTFont
from fontTools.pens.pointInsidePen import PointInsidePen
from fontTools.pens.boundsPen import BoundsPen

UNIT, TOP, BOTTOM = 75, 750, -150
CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789:.,!?-+/%'()×"
f = TTFont(sys.argv[1] if len(sys.argv) > 1 else 'src/ui/fonts/jersey-10-400.woff2')
gs, cmap = f.getGlyphSet(), f.getBestCmap()
print(f"  ' ': [{f['hmtx'][cmap[32]][0] // UNIT}],")
for ch in CHARS:
    name = cmap[ord(ch)]
    adv = f['hmtx'][name][0]
    assert adv % UNIT == 0, ch
    b = BoundsPen(gs); gs[name].draw(b)
    w = -(-int(b.bounds[2]) // UNIT)
    rows = []
    for r in range((TOP - BOTTOM) // UNIT):
        y = TOP - UNIT * r - UNIT / 2
        row = ''
        for c in range(w):
            p = PointInsidePen(gs, (UNIT * c + UNIT / 2, y)); gs[name].draw(p)
            row += '1' if p.getResult() else '0'
        rows.append(row)
    key = "\\'" if ch == "'" else ch
    print(f"  '{key}': [{adv // UNIT}, " + ', '.join(f"'{r}'" for r in rows) + '],')
