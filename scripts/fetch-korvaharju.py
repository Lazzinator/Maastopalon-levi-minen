#!/usr/bin/env python3
"""
Hakee Kuopion Korvaharjun (Pelastusopiston harjoitusalue) kartta-aineiston
maastopalosimulaattoria varten ja kirjoittaa sen tiedostoon data/korvaharju.js.

Ajo:
    export MML_API_KEY=...        # Maanmittauslaitoksen avoimen rajapinnan avain
    pip install numpy pillow tifffile imagecodecs
    python3 scripts/fetch-korvaharju.py check     # yhteys- ja avaintarkistus
    python3 scripts/fetch-korvaharju.py locate    # paikanna alue nimistöstä
    python3 scripts/fetch-korvaharju.py fetch     # hae aineistot ja kirjoita data/

Avainta ei koskaan tulosteta eikä tallenneta; se lähetetään HTTP Basic -otsakkeena.
"""
import base64
import io
import json
import os
import sys
import urllib.parse
import urllib.request
import urllib.error

MML_GEOCODE = "https://avoin-paikkatieto.maanmittauslaitos.fi/geocoding/v2/pelias/search"
MML_WCS = "https://avoin-karttakuva.maanmittauslaitos.fi/ortokuvat-ja-korkeusmallit/wcs/v2"
MML_MTK = "https://avoin-paikkatieto.maanmittauslaitos.fi/maastotiedot/features/v1"
SYKE_HOST = "https://paikkatieto.ymparisto.fi"

UA = "maastopalosimulaattori-esikasittely/1.0"


def api_key():
    key = os.environ.get("MML_API_KEY", "").strip()
    if not key:
        sys.exit("VIRHE: ympäristömuuttuja MML_API_KEY puuttuu.")
    return key


def http_get(url, params=None, auth=False, timeout=120, retries=4):
    if params:
        url = url + ("&" if "?" in url else "?") + urllib.parse.urlencode(params, safe=":,/")
    headers = {"User-Agent": UA}
    if auth:
        token = base64.b64encode((api_key() + ":").encode()).decode()
        headers["Authorization"] = "Basic " + token
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.status, r.headers.get("Content-Type", ""), r.read()
        except urllib.error.HTTPError as e:
            return e.code, e.headers.get("Content-Type", ""), e.read()
        except Exception as e:  # verkkovirhe – yritä uudelleen
            last = e
            import time
            time.sleep(2 ** (attempt + 1))
    raise RuntimeError(f"Verkkovirhe ({urllib.parse.urlsplit(url).netloc}): {last}")


def cmd_check():
    api_key()
    print("MML_API_KEY: asetettu")
    tests = [
        ("MML geokoodaus", MML_GEOCODE, {"text": "Kuopio", "size": 1, "crs": "EPSG:3067"}, True),
        ("MML WCS (korkeusmallit)", MML_WCS, {"service": "WCS", "request": "GetCapabilities"}, True),
        ("Syke paikkatieto", SYKE_HOST + "/arcgis/rest/services", {"f": "json"}, False),
    ]
    ok = True
    for name, url, params, auth in tests:
        try:
            code, ctype, body = http_get(url, params, auth=auth, timeout=60)
            good = code == 200
            print(f"{'OK ' if good else 'EI '} {name}: HTTP {code}, {len(body)} tavua, {ctype}")
            ok &= good
        except Exception as e:
            print(f"EI  {name}: {e}")
            ok = False
    sys.exit(0 if ok else 1)


def cmd_locate(*terms):
    terms = terms or ("Pelastusopisto", "Korvaharju")
    for t in terms:
        for src in ("geographic-names", "addresses", "interpolated-road-addresses"):
            code, _, body = http_get(MML_GEOCODE, {"text": t, "size": 10, "crs": "EPSG:3067",
                                                   "sources": src, "lang": "fin"}, auth=True)
            if code != 200:
                print(f"{t} / {src}: HTTP {code} {body[:200]!r}")
                continue
            for f in json.loads(body).get("features", []):
                p = f["properties"]
                c = f["geometry"]["coordinates"]
                print(f"{t:16s} {src:28s} {p.get('label','')[:70]:70s} "
                      f"{p.get('label:placeType', p.get('placeType',''))!s:20s} E={c[0]:.0f} N={c[1]:.0f}")


# --------------------------------------------------------------------------
# Aineistojen haku ja luokittelu
# --------------------------------------------------------------------------

# Rajaus ETRS-TM35FIN (EPSG:3067), 2,0 × 1,5 km. Valittu niin, että Pelastusopiston
# harjoitusalue Korvaharjun tien varrella (rakennusryhmä n. E 526100–526370,
# N 6966680–6967210) sekä Alimmainen ja Keskimmäinen Korvalampi ovat mukana.
BBOX = (525100, 6965850, 527100, 6967350)   # E_min, N_min, E_max, N_max
CELL = 10        # simulaattorin ruutu (m)
SUB = 2          # apuruudukko polygonien rasterointiin (m), = korkeusmallin resoluutio
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "korvaharju.js")

# Simulaattorin maastotyypit (js/sim.js FUELS)
WATER, ROCK, GRASS, SHRUB, CONIFER, MIXED, BOG, FIREBREAK, URBAN = range(9)

CRS = "http://www.opengis.net/def/crs/EPSG/0/3067"


def mtk_items(collection):
    """Hakee maastotietokannan kohteet rajauksen alueelta (kaikki sivut)."""
    url = f"{MML_MTK}/collections/{collection}/items"
    params = {"bbox": ",".join(map(str, BBOX)), "bbox-crs": CRS, "crs": CRS, "limit": 2000, "f": "json"}
    feats = []
    while url:
        code, _, body = http_get(url, params, auth=True)
        if code != 200:
            raise RuntimeError(f"MTK {collection}: HTTP {code} {body[:200]!r}")
        js = json.loads(body)
        feats += js.get("features", [])
        url, params = None, None
        for link in js.get("links", []):
            if link.get("rel") == "next":
                url = link["href"]
    return feats


def wcs_tiff(coverage, extra=""):
    import tifffile
    e0, n0, e1, n1 = BBOX
    url = (f"{MML_WCS}?service=WCS&version=2.0.1&request=GetCoverage&coverageId={coverage}"
           f"&subset=E({e0},{e1})&subset=N({n0},{n1})&format=image/tiff{extra}")
    code, ctype, body = http_get(url, auth=True, timeout=300)
    if code != 200 or "tiff" not in ctype:
        raise RuntimeError(f"WCS {coverage}: HTTP {code} {ctype} {body[:200]!r}")
    return tifffile.imread(io.BytesIO(body))


def block_mean(a, k):
    h, w = a.shape[0] // k * k, a.shape[1] // k * k
    a = a[:h, :w]
    return a.reshape(h // k, k, w // k, k, *a.shape[2:]).mean(axis=(1, 3))


class Raster:
    """Piirtää MTK-geometriat 2 m apuruudukolle (Pillow)."""

    def __init__(self):
        from PIL import Image, ImageDraw
        self.Image, self.ImageDraw = Image, ImageDraw
        e0, n0, e1, n1 = BBOX
        self.w, self.h = (e1 - e0) // SUB, (n1 - n0) // SUB

    def px(self, c):
        return ((c[0] - BBOX[0]) / SUB, (BBOX[3] - c[1]) / SUB)

    def mask(self, feats, line_width_m=None):
        import numpy as np
        img = self.Image.new("L", (self.w, self.h), 0)
        d = self.ImageDraw.Draw(img)
        for f in feats:
            g = f["geometry"]
            if g is None:
                continue
            t, cs = g["type"], g["coordinates"]
            polys = [cs] if t == "Polygon" else cs if t == "MultiPolygon" else None
            if polys is not None:
                for poly in polys:
                    d.polygon([self.px(c) for c in poly[0]], fill=1)
                    for hole in poly[1:]:
                        d.polygon([self.px(c) for c in hole], fill=0)
            elif t in ("LineString", "MultiLineString") and line_width_m:
                lines = [cs] if t == "LineString" else cs
                width = line_width_m(f) if callable(line_width_m) else line_width_m
                if width:
                    for ln in lines:
                        d.line([self.px(c) for c in ln], fill=1, width=max(1, round(width / SUB)))
        return np.asarray(img, dtype=np.float32)


# Tieluokan leveys metreinä (MTK tieviiva.kohdeluokka). Polut ja kävelytiet
# (123xx) eivät ole merkittäviä palon esteitä, joten ne jätetään pois.
ROAD_WIDTH = {12111: 20, 12112: 14, 12121: 10, 12122: 8, 12131: 7, 12132: 5, 12141: 4}


def cmd_fetch():
    import numpy as np
    import time
    api_key()
    e0, n0, e1, n1 = BBOX
    W, H = (e1 - e0) // CELL, (n1 - n0) // CELL
    k = CELL // SUB
    print(f"Rajaus E {e0}–{e1}, N {n0}–{n1} (EPSG:3067), {W} × {H} ruutua à {CELL} m")

    # --- Korkeus: MML korkeusmalli 2 m → 10 m (keskiarvo) ---
    dem2 = wcs_tiff("korkeusmalli_2m").astype(np.float64)
    if dem2.shape != (H * k, W * k):
        raise RuntimeError(f"Odottamaton korkeusmallin koko {dem2.shape}")
    if np.any(dem2 < -100):
        raise RuntimeError("Korkeusmallissa puuttuvia arvoja")
    elev = block_mean(dem2, k)
    print(f"Korkeus {elev.min():.1f}–{elev.max():.1f} m mpy")

    # --- Väärävärikuva (NIR, R, G) 2,5 m → 10 m, havu/lehti-erotteluun ---
    cir = wcs_tiff("ortokuva_vaaravari", "&scalefactor=0.2").astype(np.float64)
    if cir.shape[:2] != (H * 4, W * 4):
        raise RuntimeError(f"Odottamaton ortokuvan koko {cir.shape}")
    cir = block_mean(cir, 4)
    nir, red = cir[..., 0], cir[..., 1]
    ndvi = (nir - red) / np.maximum(nir + red, 1)

    # --- Maastotietokanta ---
    R = Raster()

    def frac(*collections, filt=None, line=None):
        feats = []
        for c in collections:
            fs = mtk_items(c)
            if filt:
                fs = [f for f in fs if filt(f["properties"])]
            print(f"  MTK {c}: {len(fs)} kohdetta")
            feats += fs
            time.sleep(0.2)
        return block_mean(R.mask(feats, line), k)

    water = frac("jarvi", "virtavesialue", "meri")
    bog = frac("suo", "soistuma", "maatuvavesialue")
    rock = frac("kallioalue", "louhos", "maaaineksenottoalue", "kivikko", "hietikko")
    open_ = frac("maatalousmaa", "niitty", "muuavoinalue", "puisto", "urheilujavirkistysalue")
    built = frac("rakennus", "varastoalue", "kaatopaikka", "autoliikennealue",
                 "taajaanrakennettualue", "satamaalue", "lentokenttaalue", "taytemaa")
    roads = frac("tieviiva", line=lambda f: ROAD_WIDTH.get(f["properties"].get("kohdeluokka")))
    powerline = frac("sahkolinja", line=lambda f: 20)

    # --- Luokittelu (prioriteettijärjestyksessä) ---
    fuel = np.full((H, W), CONIFER, dtype=np.uint8)
    forest = np.ones((H, W), bool)

    def put(mask, cls):
        fuel[mask & forest] = cls
        forest[mask] = False

    put(water >= 0.5, WATER)
    put(roads >= 0.3, URBAN)            # tie ylittää muut luokat (kapea kohde)
    put(built >= 0.5, URBAN)
    put(rock >= 0.5, ROCK)
    put(bog >= 0.5, BOG)
    put(open_ >= 0.5, GRASS)
    put(powerline >= 0.4, SHRUB)        # raivattu johtoaukea

    # Metsämaa (ei MTK-aluekohdetta): väärävärikuvasta. Alueen ortokuva on
    # lehdettömältä ajalta, joten havupuusto näkyy tummanpunaisena (korkea NDVI,
    # tumma), lehtipuut ja sekametsä heikompana, hakkuuaukeat/taimikot vaaleina
    # (matala NDVI, kirkas) ja päällystetyt/sorapintaiset kentät negatiivisena NDVI:nä.
    # Raja-arvot on tarkistettu silmämääräisesti tämän rajauksen ortokuvasta.
    bright = cir.mean(axis=-1)
    fuel[forest] = MIXED
    fuel[forest & (ndvi >= 0.18) & (bright < 95)] = CONIFER
    fuel[forest & (bright >= 105) & (ndvi < 0.15)] = SHRUB
    fuel[forest & (ndvi < -0.05)] = URBAN

    names = ["vesi", "kallio", "niitty", "pensaikko", "havumetsä", "sekametsä", "suo", "palokuja", "tie/rakennettu"]
    cnt = np.bincount(fuel.ravel(), minlength=9)
    for i, c in enumerate(cnt):
        print(f"  {names[i]:15s} {c:6d} ruutua ({100 * c / fuel.size:4.1f} %)")

    write_js(W, H, elev, fuel)


def write_js(W, H, elev, fuel):
    import numpy as np
    base = float(np.floor(elev.min()))
    dm = np.round((elev - base) * 10).astype("<u2")       # desimetreinä
    data = {
        "id": "korvaharju",
        "name": "Kuopio, Korvaharju",
        "description": "Pelastusopiston harjoitusalueen ympäristö, Kuopio",
        "crs": "EPSG:3067",
        "bbox": list(BBOX),
        "cellSize": CELL,
        "width": W,
        "height": H,
        "elevationBase": base,
        "elevationScale": 0.1,
        "elevation": base64.b64encode(dm.tobytes()).decode(),
        "fuel": base64.b64encode(fuel.astype(np.uint8).tobytes()).decode(),
        "sources": [
            "Sisältää Maanmittauslaitoksen maastotietokannan, korkeusmallin (2 m) ja ortokuvien aineistoa "
            + time_label() + " (CC BY 4.0)",
        ],
        "generated": time_label(),
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    js = ("/* Korvaharjun kartta maastopalosimulaattoriin. Generoitu: scripts/fetch-korvaharju.py\n"
          " * Rivit pohjoisesta etelään, sarakkeet lännestä itään. elevation: Uint16 LE (dm + base),\n"
          " * fuel: Uint8 (js/sim.js FUELS-indeksi), molemmat base64. */\n"
          "(function (g) {\n  g.FIRESIM_MAPS = g.FIRESIM_MAPS || {};\n  g.FIRESIM_MAPS.korvaharju = "
          + json.dumps(data, ensure_ascii=False, indent=1) + ";\n"
          "  if (typeof module === 'object' && module.exports) module.exports = g.FIRESIM_MAPS.korvaharju;\n"
          "})(typeof self !== 'undefined' ? self : globalThis);\n")
    with open(OUT, "w", encoding="utf-8") as fh:
        fh.write(js)
    print(f"Kirjoitettu {os.path.relpath(OUT)} ({len(js) / 1024:.0f} kt)")


def time_label():
    import datetime
    return datetime.date.today().strftime("%m/%Y")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "fetch"
    args = sys.argv[2:]
    if cmd == "check":
        cmd_check()
    elif cmd == "locate":
        cmd_locate(*args)
    elif cmd == "fetch":
        cmd_fetch()
    else:
        sys.exit(__doc__)
