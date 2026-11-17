"""Move raw hex colours in the UI's CSS onto the design tokens in ui/src/tokens.css.

A colour is replaced by var(--token) only when it looks the same as the token (CIEDE2000 distance at most
--neutral for greys, --chroma for colours), so the screen does not change. Colours with alpha (#rgba, #rrggbbaa),
colours inside gradients (the shading of keys and buttons) and colours further from every token are left
for a person to decide.

usage: python3 tools/snap_colours.py [--neutral 3] [--chroma 2] [--dry] ui/src/perform.css ...
"""
import argparse, math, os, re, sys

HEX = re.compile(r'#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b')
TOKEN = re.compile(r'--((?:ui|c|t)-[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,6})\b')
# When two tokens share a value, the first listed wins (orange marks state before it names the Sound page).
PREFER = ['ui-accent', 'ui-white', 'ui-black-pure']


def rgb(h):
    h = h.lstrip('#')
    if len(h) in (3, 4): h = ''.join(c * 2 for c in h[:3])
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def lab(c):
    def lin(v):
        v /= 255
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
    r, g, b = map(lin, c)
    x = (r * .4124 + g * .3576 + b * .1805) / .95047; y = r * .2126 + g * .7152 + b * .0722; z = (r * .0193 + g * .1192 + b * .9505) / 1.08883
    f = lambda t: t ** (1 / 3) if t > .008856 else 7.787 * t + 16 / 116
    return 116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))


def de2000(p, q):
    (L1, a1, b1), (L2, a2, b2) = p, q
    Cb = (math.hypot(a1, b1) + math.hypot(a2, b2)) / 2
    G = .5 * (1 - math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)))
    a1p, a2p = a1 * (1 + G), a2 * (1 + G)
    C1, C2 = math.hypot(a1p, b1), math.hypot(a2p, b2)
    h1, h2 = math.degrees(math.atan2(b1, a1p)) % 360, math.degrees(math.atan2(b2, a2p)) % 360
    dh = 0 if C1 * C2 == 0 else (h2 - h1 - 360 if h2 - h1 > 180 else h2 - h1 + 360 if h2 - h1 < -180 else h2 - h1)
    dH = 2 * math.sqrt(C1 * C2) * math.sin(math.radians(dh / 2))
    Lb, Cbp = (L1 + L2) / 2, (C1 + C2) / 2
    hb = h1 + h2 if C1 * C2 == 0 else (h1 + h2) / 2 if abs(h1 - h2) <= 180 else (h1 + h2 + 360) / 2 if h1 + h2 < 360 else (h1 + h2 - 360) / 2
    T = 1 - .17 * math.cos(math.radians(hb - 30)) + .24 * math.cos(math.radians(2 * hb)) + .32 * math.cos(math.radians(3 * hb + 6)) - .2 * math.cos(math.radians(4 * hb - 63))
    Rt = -math.sin(math.radians(60 * math.exp(-((hb - 275) / 25) ** 2))) * 2 * math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7))
    Sl = 1 + .015 * (Lb - 50) ** 2 / math.sqrt(20 + (Lb - 50) ** 2); Sc = 1 + .045 * Cbp; Sh = 1 + .015 * Cbp * T
    return math.sqrt(((L2 - L1) / Sl) ** 2 + ((C2 - C1) / Sc) ** 2 + (dH / Sh) ** 2 + Rt * (C2 - C1) / Sc * dH / Sh)


def chroma(c): return math.hypot(*lab(c)[1:])


def tokens(path):
    found = {}
    for name, value in TOKEN.findall(open(path).read()):
        found.setdefault(name, value.lower())
    order = PREFER + [n for n in found if n not in PREFER]
    return [(n, found[n], lab(rgb(found[n]))) for n in order if n in found]


def nearest(h, table, neutral, chroma_limit):
    c = rgb(h); l = lab(c); grey = chroma(c) < 6
    best = min(table, key=lambda t: de2000(l, t[2]))
    d = de2000(l, best[2])
    return best[0] if d <= (neutral if grey else chroma_limit) else None


def snap(text, table, neutral, chroma_limit):
    out, changed, pos = [], 0, 0
    for m in HEX.finditer(text):
        h = m.group(0)
        if len(h) not in (4, 7): continue  # alpha colours stay
        line_start = text.rfind('\n', 0, m.start()) + 1
        decl = text[max(line_start, text.rfind(';', 0, m.start()) + 1, text.rfind('{', 0, m.start()) + 1):m.start()]
        g = decl.rfind('gradient(')
        if g >= 0 and decl.count('(', g) > decl.count(')', g): continue  # shading inside a gradient is the material, not a token
        name = nearest(h.lower(), table, neutral, chroma_limit)
        if not name or re.search(r'--' + re.escape(name) + r'\s*:', decl): continue  # never define a token by itself
        out.append(text[pos:m.start()]); out.append('var(--%s)' % name); pos = m.end(); changed += 1
    out.append(text[pos:])
    return ''.join(out), changed


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('files', nargs='+'); ap.add_argument('--neutral', type=float, default=3.); ap.add_argument('--chroma', type=float, default=2.)
    ap.add_argument('--dry', action='store_true')
    a = ap.parse_args()
    table = tokens(os.path.join(os.path.dirname(__file__), '..', 'ui', 'src', 'tokens.css'))
    total = 0
    for f in a.files:
        text = open(f).read(); new, n = snap(text, table, a.neutral, a.chroma); total += n
        print('%-34s %4d colours moved onto tokens' % (os.path.basename(f), n))
        if n and not a.dry: open(f, 'w').write(new)
    print('total', total)


if __name__ == '__main__':
    sys.exit(main())
