# Dizajn manual - Ridea Starter

Toto nie je teoria o dizajne. Je to popis toho, co realne je v `public/style.css`,
`public/index.html` a `public/app.js` - a pravidla, ako do toho pridat dalsiu
obrazovku tak, aby nevybocila.

Ked stavias s Claude Code, nechaj ho tento subor precitat.

---

## 1. Princip

**Jeden hlavny akt na obrazovku.** Na hlavnej stranke je jedna velka vec:
nahrat. Vsetko ostatne je mensie a nizsie. Ked pridas druhu rovnako velku vec,
obrazovka prestane hovorit, co sa od cloveka chce.

**Tmavy podklad, jedna akcentova farba.** Fialova (`--accent`) znamena "toto sa
da stlacit" alebo "toto je aktivne". Nepouzivaj ju na dekoraciu - stratis tym
jediny signal, ktory mas.

**Ziadny framework, ziadny build.** Tri staticke subory. Ked pridavas komponent,
pridavas CSS triedu do `style.css`, nie kniznicu.

---

## 2. Tokeny (`:root` v style.css)

Vsetky farby a radiusy su premenne. **Nikdy nepis hex priamo do noveho kodu** -
pouzi token, alebo pridaj novy do `:root`.

### Farby

| Token | Hodnota | Na co |
|-------|---------|-------|
| `--bg` | `#0f1115` | pozadie stranky |
| `--panel` | `#171a21` | karty (`.card`) |
| `--panel-2` | `#1e222b` | vnorene plochy - inputy, `pre`, `.score` |
| `--line` | `#2a2f3a` | vsetky ciary a ramy, 1px |
| `--text` | `#e6e8ec` | hlavny text |
| `--muted` | `#9aa1ad` | labely, meta, sekundarny text |
| `--accent` | `#6d5cff` | primarne tlacidlo, focus ring |
| `--accent-2` | `#8b7bff` | hover primaru, odkazy |
| `--ok` | `#37c98b` | hotovo |
| `--warn` | `#ffb020` | spracovava sa |
| `--err` | `#ff5c5c` | chyba, prebiehajuce nahravanie |
| `--radius` | `12px` | karty |

### Tri urovne plochy

`--bg` (stranka) → `--panel` (karta) → `--panel-2` (vnorene). Kazda uroven je
o kusok svetlejsia. **Nikdy nevnaraj stvrtu uroven** - radsej pridaj oddelovac
`--line`.

### Radiusy

- `12px` (`--radius`) - karty
- `8px` - tlacidla, inputy, `.msg`, `pre`, `.score`
- `999px` - pilulky (`.pill`) a velke tlacidlo (`.big`)

### Stavova farba ma vzdy dve pouzitia

Text v plnej farbe, pozadie v 12-15 % priehladnosti, ziadny ram:

```css
.pill.done { background: rgba(55,201,139,.15); color: var(--ok); }
```

---

## 3. Typografia

Systemovy font (`system-ui`), takze appka vyzera ako zvysok operacneho systemu
a nic sa nedonahrava.

| Prvok | Velkost | Vaha |
|-------|---------|------|
| body | `15px / 1.55` | 400 |
| `header.top h1` | 17px | 600, letter-spacing -0.01em |
| `.idea h3` | 15px | 600 |
| `.idea p` | 14px | 400 |
| `label` | 13px | 400, `--muted` |
| `.idea .meta` | 12.5px | 400, `--muted` |
| `.pill` | 11.5px | 600 |
| `.timer` | 30px | 700, `font-variant-numeric: tabular-nums` |
| `pre` (prepis) | 13.5px | 400, `white-space: pre-wrap` |

**Tabular-nums na kazdom cisle, ktore sa meni v case** (casovac, pocitadla).
Bez toho text pri kazdej sekunde poskakuje.

Rozdiely medzi urovnami textu drz **male** (15 → 14 → 12.5). Hierarchiu tu robi
farba (`--text` vs `--muted`), nie velkost.

---

## 4. Spacing

Jedna sirka obsahu, jeden rytmus:

- `.wrap` = `max-width: 900px`, padding `24px 20px 80px`
- prihlasovacia obrazovka = ten isty `.wrap`, ale `max-width: 420px`
- `.card` = padding `20px`, `margin-bottom: 16px`
- `.row` = `gap: 10px`
- `label` = `margin: 12px 0 6px` (blizsie k svojmu inputu ako k predoslemu polu)

Vertikalny rytmus stoji na `16px` medzi kartami a `12px` vnutri formulara.
Ked treba vacsiu dieru, pouzi nasobok: 24, 32.

---

## 5. Komponenty

### `header.top`

Pas hore: nazov vlavo, kto je prihlaseny + odhlasenie vpravo, spodna ciara
`--line`. Nic ine tam nedavaj - navigacia v takto malej appke nema co robit
v hlavicke.

### `.card`

Vsetok obsah zije v kartach. Karta = `--panel` + 1px `--line` + radius 12.
Ziadne tiene. Ked chces kartu odlisit, zmen obsah, nie ram.

### Tlacidla

| Trieda | Kedy |
|--------|------|
| (default) | primarna akcia - `--accent` pozadie, biely text |
| `.ghost` | sekundarna akcia - priehladne, ram `--line` |
| `.rec` | prebiehajuce nahravanie - `--err` pozadie |
| `.big` | jediny hlavny akt na obrazovke - 16px, radius 999px |
| `:disabled` | `opacity: .5` + `cursor: not-allowed` |

**Na obrazovke je najviac jedno `.big` a najviac jedno primarne tlacidlo.**
Vsetko ostatne je `.ghost`.

### Inputy

Vzdy `label` nad polom - nie placeholder ako label, placeholder zmizne, ked
clovek zacne pisat. Placeholder pouzi na priklad hodnoty:
`placeholder="napr. Novy onboarding pre klientov"`.

Focus je `outline: 2px solid var(--accent)` s `outline-offset: -1px`.
**Nikdy nevypinaj outline** - klavesnicova navigacia by oslepla.

### `.msg` - hlaska k akcii

Skryta (`display: none`), zobrazi sa pridanim `.show`. Dve varianty: `.ok`
(zelena) a `.err` (cervena). Hlaska patri **k tomu prvku, ktoreho sa tyka** -
pod nahravaci blok, pod formular - nie do rohu obrazovky.

### `.pill` - stav zaznamu

`processing` (oranzova) / `done` (zelena) / `error` (cervena). Pilulka ma vzdy
aj **text**, nie len farbu - farba sama je pre farboslepeho cloveka nic.

### `.score` - AI skore

Kvadratik 30x30 s `--panel-2` a ramom. Cislo bez "/10", kontext je z hlavicky.

### `.idea` - riadok v zozname

Riadky delene hornou ciarou (`border-top`), prvy bez ciary. Cely riadok je
klikatelny (`cursor: pointer`). Struktura: nazov (`h3`) → autor a datum
(`.meta`) → zhrnutie (`p`). Skore a stav vpravo.

### `.detail` - detail zaznamu

Skryty, zobrazi sa `.show`. Prepis ide do `pre` s `white-space: pre-wrap`,
`max-height: 340px` a vlastnym scrollom - dlhy prepis nesmie roztlacit stranku.

---

## 6. UX pravidla

Toto je cast, ktora sa da najlahsie pokazit a najhorsie vidiet.

### 6.1 Kazda async akcia ma tri stavy

Nikdy nie len "pred" a "po":

1. **pred** - tlacidlo aktivne, jasny text ("Prihlasit sa")
2. **pocas** - `disabled` + zmeneny text ("Prihlasujem...")
3. **po** - povodny text + `.msg` s vysledkom

```js
btn.disabled = true;
btn.textContent = 'Prihlasujem...';
try {
  // ...
} finally {
  btn.disabled = false;
  btn.textContent = 'Prihlasit sa';
}
```

`finally` je povinne. Bez neho zostane tlacidlo po chybe mrtve.

### 6.2 Uspech zmizne, chyba zostane

Zelena hlaska sa po 5 sekundach schova sama (robi to `showMsg`). Cervena
zostane, kym clovek neurobi dalsiu akciu - chybu si musi mat cas precitat.

### 6.3 Nikdy nedrz cloveka pri obrazovke

Upload vrati odpoved hned (`status: 'processing'`), prepis a analyza bezia na
pozadi. Frontend sa 20-krat po 3 sekundach pozrie, ci je hotovo, potom to vzda
a necha to na rucne obnovenie. **Ziadny blokujuci spinner na 30 sekund.**

### 6.4 Ziadny zaznam nesmie visiet naveky

Kazda cesta na pozadi, ktora zlyha, zapise `status='error'` s dovodom a ten
dovod sa zobrazi v detaile. Zaznam, ktory zostane navzdy v `processing`, je
horsi ako zaznam s chybou - clovek nevie, ci ma cakat alebo nahrat znova.

### 6.5 Chybova hlaska = co sa stalo + co s tym

Zle: "Chyba 413".

Dobre: "Nahravka je prilis velka (6.2 MB, max 4 MB). Nahraj kratsiu alebo pozri
README sekciu o dlhych nahravkach."

Konkretne a s dalsim krokom.

### 6.6 Vypadok prihlasenia = presmerovanie, nie modal

Ked API vrati 401, `api()` zmaze token a posle cloveka na `/login.html`.
Ziadne "vasa session vyprsala" okno, z ktoreho sa neda vyliezt.

### 6.7 Mikrofon: surovy stream

`getUserMedia({ audio: true })` a rovno do `MediaRecorder`. **Ziadne Web Audio
medzivrstvy** - tie sa v mobilnom prehliadaci pri prepnuti na pozadie zastavia
a nahravka je ticha.

### 6.8 Vsetko z DB a z AI ide cez `escapeHtml`

Prepis, nazov, zhrnutie, tagy, mena. Text z AI je **tiez cudzi vstup** - kto
nahra "moj napad je `<img onerror=...>`", moze to model vratit vo svojej
odpovedi.

### 6.9 Cakanie ma mat text, nie len animaciu

`hintEl.textContent = 'Nahravam na server...'` povie viac ako rotujuce kolecko.
Clovek chce vediet, na co sa caka.

---

## 7. Ako pridat novu obrazovku

1. Skopiruj `index.html`, nechaj `header.top` a `.wrap`.
2. Obsah zabal do `.card`.
3. Formular: `label` + input, hlavna akcia ako primarne tlacidlo, ostatne `.ghost`.
4. Kazdu async akciu obal do vzoru z bodu 6.1.
5. Vysledok hlas cez `.msg` pri tom prvku, nie globalne.
6. Novu farbu pridaj ako token do `:root`, nie hex do triedy.
7. Nove komponenty pomenuj podla toho, **co to je** (`.idea`, `.pill`, `.score`),
   nie ako vyzeraju (`.box-purple`, `.small-text`).

---

## 8. Na co si dat pozor pri rozsirovani

- **Tabulky** v starteri nie su. Na mobile sa nezmestia - pouzi zoznam riadkov
  ako `.idea`, kde kazdy riadok drzi vsetko pod sebou.
- **Modaly** v starteri nie su a je to zamer. Detail sa otvara ako `.detail`
  karta na tej istej stranke. Modal potrebuje focus trap, escape a zamknutie
  scrollu - tri veci, ktore sa daju lahko pokazit.
- **Prazdny stav** vzdy napis textom: "Zatial ziadne napady. Nahraj prvy."
  Prazdna plocha bez textu vyzera ako chyba.
- **Dlhy obsah** dostane vlastny scroll (`max-height` + `overflow: auto`),
  neroztlaci stranku.
- **Svetly rezim** starter nema. Ked ho chces, pridaj druhu sadu tokenov do
  `@media (prefers-color-scheme: light)` a nemen nic ine - presne preto su
  tokeny na jednom mieste.
