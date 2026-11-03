# Maastopalon leviämissimulaattori

Selaimessa toimiva, interaktiivinen simulaattori, joka havainnollistaa maastopalon
leviämistä tuulen, kosteuden, maaston muotojen ja kasvillisuuden mukaan.

## Käyttö

Avaa `index.html` suoraan selaimessa – asennuksia ei tarvita.
(Vaihtoehtoisesti `npm start` käynnistää paikallisen palvelimen osoitteeseen http://localhost:8080.)

| Toiminto | Ohje |
|---|---|
| 🔥 Sytytä | Klikkaa tai vedä kartalla |
| 🪓 Palokuja | Vedä kartalla – raivattu kaista, joka ei pala |
| 💧 Vesipommitus | Sammuttaa palon ja kastelee maaston (kosteus haihtuu ajan myötä) |
| Tuuli | Nopeus 0–25 m/s, suunta liukusäätimellä tai vetämällä kompassia |
| Kosteus | Polttoaineen kosteus 2–36 % (sammumiskosteus 35 %) |
| Kipinälento | Voimakas tuuli kuljettaa kekäleitä etäälle palorintaman eteen |

Kartan voi vaihtaa valikosta **Kartta: Satunnainen / Kuopio, Korvaharju** (tai osoitteella
`index.html?kartta=korvaharju`). Korvaharjun kartalla kohdistimen kohdalla näytetään myös
ETRS-TM35FIN-koordinaatit.

Pikanäppäimet: `välilyönti` käynnistä/tauko, `S` askel, `R` nollaa palo, `N` uusi kartta, `1–3` työkalut.

## Malli

Maasto on 160 × 110 ruudun soluautomaatti (ruutu 10 × 10 m, askel 1 min). Korkeus ja
kasvillisuus generoidaan siemenluvusta kohinafunktiolla. Jokainen palava ruutu yrittää
sytyttää 8 naapuriaan todennäköisyydellä

```
p = p_polttoaine · f_kosteus · f_tuuli · f_rinne · f_diagonaali · (1 − kastelu)

f_tuuli  = exp(c1·V) · exp(c2·V·(cos θ − 1))     c1 = 0.045, c2 = 0.131
f_rinne  = exp(a·θs)                             a  = 0.078
f_kosteus = (1 − M / 35 %)^1.3
```

missä `V` on tuulen nopeus, `θ` tuulen ja leviämissuunnan välinen kulma ja `θs`
rinteen kaltevuus asteina. Tuuli- ja rinnekertoimet perustuvat Alexandridis ym. (2008)
soluautomaattimalliin. Eri maastotyypeillä on oma syttyvyys ja palamisaika
(esim. havumetsä palaa pitkään ja levittää kipinöitä, suo syttyy huonosti, vesi ja palokuja
eivät pala lainkaan, tie / rakennettu syttyy vain heikosti).

Simulaatio on opetuksellinen havainnollistus, ei operatiivinen ennustetyökalu.

## Oikea kartta: Kuopio, Korvaharju

Kartta kattaa Pelastusopiston harjoitusalueen ympäristön Kuopion Korvaharjussa:

| | |
|---|---|
| Rajaus (EPSG:3067, ETRS-TM35FIN) | E 525 100 – 527 100, N 6 965 850 – 6 967 350 |
| Koko | 2,0 × 1,5 km = 200 × 150 ruutua à 10 m |
| Sisältää | harjoitusalueen kentät ja rakennukset (n. E 526 100–526 370, N 6 966 680–6 967 210), Alimmaisen ja Keskimmäisen Korvalammen, niitä reunustavat suot, jätekeskuksen alueen idässä sekä ympäröivät metsät ja hakkuuaukeat |

Alue paikannettiin MML:n geokoodauspalvelusta (paikannimi ja osoitteet *Korvaharju*) ja
maastotietokannan rakennuksista; harjoitusalueen sijainti Korvaharjussa on mainittu mm. Ylen uutisessa.

### Aineistot

- **Korkeus:** Maanmittauslaitoksen korkeusmalli 2 m (WCS `korkeusmalli_2m`), keskiarvoistettu 10 m:iin.
- **Maanpeite:** Maanmittauslaitoksen maastotietokanta (OGC API Features): järvet, suot ja soistumat,
  kalliot, louhokset, pellot, niityt, avoimet alueet, rakennukset, varasto- ja kaatopaikka-alueet,
  tiet (leveys tieluokan mukaan) ja sähkölinjat. Polygonit rasteroidaan 2 m apuruudukolle ja
  10 m ruudun luokka valitaan peittävyyden mukaan.
- **Metsätyypit:** MML:n vääräväriortokuva (`ortokuva_vaaravari`, 2,5 m). Kuva on lehdettömältä
  ajalta, joten metsämaan ruuduille: tumma ja korkea NDVI → havumetsä, välimuodot → sekametsä,
  kirkas ja matala NDVI (hakkuuaukeat, taimikot) → pensaikko, negatiivinen NDVI (sora- ja
  päällystetyt kentät) → tie / rakennettu.
- Syken CORINE Land Cover 2018 -rajapinta (`paikkatieto.ymparisto.fi/.../INSPIRE/SYKE_Maanpeite`)
  ei ollut aineistoa haettaessa käynnissä, joten CORINEa **ei** käytetty.

Lähde: *Sisältää Maanmittauslaitoksen maastotietokannan, korkeusmallin ja ortokuvien aineistoa
11/2026* ([CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.fi)).

### Datan päivittäminen

Sivu lataa kartan tiedostosta `data/korvaharju.js` (asettaa `window.FIRESIM_MAPS.korvaharju`),
joten se toimii ilman verkkoyhteyttä myös `file://`-osoitteesta. Tiedosto tuotetaan kerran skriptillä:

```sh
pip install numpy pillow tifffile imagecodecs
export MML_API_KEY=...                         # MML:n avoimen rajapinnan avain (ei tallenneta repoon)
python3 scripts/fetch-korvaharju.py check      # avain ja yhteydet
python3 scripts/fetch-korvaharju.py locate     # paikannimihaku (Pelastusopisto, Korvaharju)
python3 scripts/fetch-korvaharju.py fetch      # hae, luokittele ja kirjoita data/korvaharju.js
```

Datamuoto: `elevation` = Uint16 LE desimetreinä + `elevationBase`, `fuel` = Uint8 maastotyyppi-indeksi
(`js/sim.js` FUELS), molemmat base64, rivit pohjoisesta etelään. Muun alueen voi lisätä vastaavalla
tiedostolla ja `createSimulation({ map })` -kutsulla.

### Rajoitukset

- Havu/seka-jako on johdettu yhdestä ortokuvasta kiinteillä raja-arvoilla, ei metsävaratiedoista.
- Kapeat purot ja polut eivät näy 10 m ruudukossa; tie ylittää ruudun, jos se peittää ≥ 30 %.
- Harjoitusalueen ja jätekeskuksen kentät ovat lähes palamatonta "tie / rakennettu" -luokkaa.

## Rakenne

- `index.html`, `style.css` – käyttöliittymä
- `js/sim.js` – simulaatiomalli (toimii selaimessa ja Node.js:ssä)
- `js/app.js` – piirto, karttavalinta ja vuorovaikutus
- `data/korvaharju.js` – esikäsitelty Korvaharjun kartta
- `scripts/fetch-korvaharju.py` – kartta-aineiston haku ja luokittelu
- `test/sim.test.js`, `test/map.test.js` – testit (`npm test`)

## Julkaisu (GitHub Pages)

Simulaattori on staattinen sivu, joten sen voi julkaista GitHub Pagesissa:

1. Repositorion **Settings → Pages → Build and deployment**
2. *Source*: **Deploy from a branch**, haara `ccr-32db7e51-wcwawz` (tai `main`), kansio `/ (root)` → **Save**
3. Sivu ilmestyy osoitteeseen https://lazzinator.github.io/Maastopalon-levi-minen/

Upotus toiselle sivustolle (esim. WordPressin *Mukautettu HTML* -lohko):

```html
<iframe src="https://lazzinator.github.io/Maastopalon-levi-minen/"
        title="Maastopalon leviämissimulaattori"
        style="width:100%; height:1150px; border:0;" loading="lazy"></iframe>
```
