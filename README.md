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
eivät pala lainkaan).

Simulaatio on opetuksellinen havainnollistus, ei operatiivinen ennustetyökalu.

## Rakenne

- `index.html`, `style.css` – käyttöliittymä
- `js/sim.js` – simulaatiomalli (toimii selaimessa ja Node.js:ssä)
- `js/app.js` – piirto ja vuorovaikutus
- `test/sim.test.js` – mallin testit (`npm test`)
