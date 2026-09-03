# Ridea Starter

Hlasovy zachytavac napadov. Nahras si hlasovku, server ju prepise na text a AI ju
vyhodnoti. Vsetko bezi na Cloudflare, na vlastnom ucte, s vlastnymi API klucmi.

Toto je **startovacia kostra**, nie hotovy produkt. Zamerne je mala, aby si jej cely
rozumel za pol hodinu a dalej si ju stavias sam (ideal s Claude Code, viz `CLAUDE.md`).

---

## Na co to je

Puvodne pouzitie: firma chce zbierat napady od ludi, ale nikto nechce pisat.
Rozpravat sa vsak chce kazdemu. Takze:

1. Clovek klikne, 30 sekund rozprava, klikne znova.
2. Server nahravku ulozi, posle ju na prepis a potom na AI analyzu.
3. O 20 sekund je z toho zaznam s nazvom, zhrnutim, skore 1-10, silnymi strankami,
   rizikami a dalsimi krokmi.

To iste sa da pouzit na cokolvek, kde je hlas rychlejsi ako klavesnica: poznamky z
porady, denne reporty z terenu, zaznam z obhliadky, hlasovy dennik, spatna vazba
od zakaznikov.

---

## Ako je to postavene

```
Prehliadac (MediaRecorder)
   |  multipart POST /api/ideas
   v
Cloudflare Worker (Hono)
   |-- audio  ->  R2 bucket           (objektove ulozisko)
   |-- zaznam ->  D1 databaza          (SQLite na edge, status='processing')
   |
   `-- waitUntil() na pozadi:
          1. STT: ElevenLabs Scribe   (fallback OpenAI Whisper)
          2. cistenie halucinacii     (STT modely na tichu vymyslaju frazy)
          3. Claude API -> JSON       (skore, zhrnutie, tagy, dalsie kroky)
          4. UPDATE ideas SET status='done'
```

Cely backend je jeden Worker. Frontend su tri staticke subory, ziadny build step,
ziadny npm balik navyse. To je zamer - menej vrstiev, menej veci co sa rozbije.

### Subory

| Cesta | Co to robi |
|---|---|
| `src/index.ts` | vstupny bod, CORS, routing, `/api/health` |
| `src/types.ts` | `Env` (bindingy a secrets), `User`, `JWTPayload` |
| `src/lib/jwt.ts` | podpis a overenie JWT cez Web Crypto (HMAC-SHA256) |
| `src/lib/password.ts` | PBKDF2-SHA256 hashovanie, constant-time porovnanie, hash IP |
| `src/lib/stt.ts` | ElevenLabs + Whisper, filter halucinacii, detekcia nezmyslov |
| `src/lib/analysis.ts` | prompt a volanie Claude API, parsovanie JSON odpovede |
| `src/middleware/auth.ts` | `authMiddleware` (Bearer token), `requireRole` |
| `src/routes/auth.ts` | login, bootstrap prveho admina, sprava pouzivatelov |
| `src/routes/ideas.ts` | CRUD napadov, upload, streamovanie audia, pipeline na pozadi |
| `migrations/0001_init.sql` | schema: `users`, `ideas`, `login_attempts`, `company_context` |
| `public/` | login, zoznam, nahravanie, detail (vanilla JS + CSS) |

### Role

- `submitter` - vidi len svoje napady
- `reviewer` - vidi vsetky
- `admin` - vidi vsetky, vie mazat cudzie, vie zakladat pouzivatelov

---

## Co potrebujes

- ucet na [Cloudflare](https://dash.cloudflare.com) (zadarmo, R2 chce kartu ale ma
  velky free tier)
- [Node.js](https://nodejs.org) 20+ (alebo [Bun](https://bun.sh))
- API kluc od [Anthropic](https://console.anthropic.com) - povinne, robi analyzu
- API kluc na prepis, aspon jeden:
  - [ElevenLabs](https://elevenlabs.io) - lepsi na slovencinu, zvlada mix jazykov
  - [OpenAI](https://platform.openai.com) - Whisper, funguje ako zaloha

Naklady pri beznom pouzivani (par desiatok nahravok denne) su radovo jednotky eur
mesacne. Precitaj si sekciu **Naklady** nizsie **skor** ako to pustis medzi ludi.

---

## Setup krok za krokom

### 1. Stiahni a nainstaluj

```bash
git clone https://github.com/POUZI-SVOJ-ODKAZ/ridea-starter.git
cd ridea-starter
npm install
npx wrangler login
```

### 2. Vytvor databazu a bucket

```bash
npx wrangler d1 create ridea-starter
npx wrangler r2 bucket create ridea-starter-audio
```

Prvy prikaz vypise `database_id`. Skopiruj si ho.

### 3. Priprav konfiguraciu

```bash
cp wrangler.toml.example wrangler.toml
```

V `wrangler.toml` nahrad `SEM_VLOZ_SVOJE_DATABASE_ID` tym, co ti vypisal prikaz
vyssie. `wrangler.toml` je v `.gitignore`, tvoje ID-cka sa nikam nedostanu.

### 4. Spusti migracie

```bash
npx wrangler d1 migrations apply ridea-starter --remote
```

### 5. Nastav tajomstva

Nikdy nedavaj kluce do suborov. Vzdy takto:

```bash
npx wrangler secret put JWT_SECRET          # nahodny retazec, min 32 znakov
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put ELEVENLABS_API_KEY  # alebo OPENAI_API_KEY
npx wrangler secret put BOOTSTRAP_TOKEN     # nahodny retazec, po setupe zmazes
```

Nahodny retazec si vygenerujes napr. takto:

```bash
node -e "console.log(crypto.randomUUID() + crypto.randomUUID())"
```

### 6. Nasad

```bash
npx wrangler deploy
```

Wrangler vypise URL, nieco ako `https://ridea-starter.tvoj-ucet.workers.dev`.

### 7. Vytvor prveho admina

```bash
curl -X POST https://TVOJA-URL/api/auth/bootstrap \
  -H "Content-Type: application/json" \
  -d '{"token":"TVOJ_BOOTSTRAP_TOKEN","email":"ty@firma.sk","password":"dlhe-heslo-min-10","display_name":"Tvoje meno"}'
```

Potom token hned zmaz, uz ho nepotrebujes:

```bash
npx wrangler secret delete BOOTSTRAP_TOKEN
```

(Endpoint aj tak funguje len kym je tabulka pouzivatelov prazdna, ale zbytocne
secrety sa nedrzia.)

### 8. Prihlas sa

Otvor svoju URL v prehliadaci. Hotovo.

Dalsich ludi zakladas ako admin:

```bash
curl -X POST https://TVOJA-URL/api/auth/users \
  -H "Authorization: Bearer TVOJ_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"email":"kolega@firma.sk","password":"dlhe-heslo","display_name":"Kolega","role":"submitter"}'
```

Token si vytiahnes z prehliadaca: konzola -> `localStorage.getItem('token')`.

---

## Lokalny vyvoj

```bash
cp .dev.vars.example .dev.vars   # doplni si kluce
npx wrangler d1 migrations apply ridea-starter --local
npx wrangler dev
```

Bezi na `http://localhost:8787`. Lokalne mas vlastnu prazdnu databazu a bucket.

---

## Co si dorobis sam

Starter je zamerne holy. Toto su najcastejsie dalsie kroky, zoradene podla toho,
co ludia obvykle chcu ako prve:

1. **Dlhe nahravky.** Teraz je strop 4 MB (cca 8 minut). Worker cita subor do
   pamate a synchronne STT volanie ma na strane providera asi 100 sekundovy strop.
   Riesenia: ElevenLabs webhook rezim (`webhook=true` + endpoint na callback),
   alebo sekanie audia na kusy, alebo presun prepisu do cronu.
2. **Fronta a opakovanie.** Ked STT zlyha, napad ostane v stave `error`. Pridaj si
   cron (`[triggers] crons = ["*/5 * * * *"]`), ktory taketo znovu skusi. **Vzdy**
   pridaj aj stlpec `attempts` a terminalny stav, inak si vyrobis nekonecnu slucku,
   ktora ti bude horiet peniaze.
3. **Kontext firmy.** Do tabulky `company_context` vloz riadok s klucom `context` a
   popisom toho, co robite. Analyza bude o triedu presnejsia.
4. **Komentare a hlasovanie.** Dve male tabulky, par endpointov.
5. **PWA / desktop app.** `manifest.json` + service worker, alebo Electron obal.
6. **Rozpoznavanie hovoriacich.** ElevenLabs vie `diarize=true` a vrati slova so
   `speaker_id`. Priradit tie stopy k realnym menam je uz vlastna kapitola a je to
   podstatne tazsie, ako to vyzera.

---

## Naklady - precitaj skor ako to pustis medzi ludi

Toto je jedina cast, kde sa da realne popalit. Tri pravidla, ktore stoja za
skutocne prestrelene faktury:

**1. Limituj eura, nie pocet volani.** Prepis sa uctuje za minuty audia, Claude za
tokeny. Dvesto volani moze stat 2 eura aj 40 eur - zalezi na dlzke. Ak si robis
strop, rataj cenu, nie pocty.

**2. Kill switch nikdy nedavaj do `wrangler.toml`.** Vars a secrets zdielaju v
Cloudflare jeden namespace. Ked pocas problemu nastavis `wrangler secret put
STT_DISABLED 1`, vydrzi to len do najblizsieho deployu, ktory hodnotu prepise spat
zo suboru - teda presne vtedy, ked nasadzujes opravu. Preto je vypinac v tomto
projekte **negativny** (`STT_DISABLED === '1'`), default v kode je zapnute, a v
`wrangler.toml` nie je.

**3. Retry bez pocitadla je nekonecna slucka.** Kazdy stav, do ktoreho sa da vratit
z cronu, musi mat `attempts` a stav, z ktoreho uz niet navratu.

Naklady si over v Cloudflare **Billing -> Usage** a v konzolach providerov, nie
odhadom. Nastav si u kazdeho providera hard limit na ucte hned na zaciatku.

---

## Bezpecnost - co je uz vyriesene a co nie

Vyriesene v starteri:

- hesla su PBKDF2-SHA256, 100k iteracii, nahodny salt
- prihlasenie bezi v konstantnom case aj pre neexistujuci ucet (dummy hash) -
  neda sa cez neho zistovat, ktore emaily su registrovane
- rate limit 5 pokusov / IP / 5 minut, IP sa uklada len ako hash
- SQL vzdy cez `.bind()`, nikdy skladanim retazca
- role sa citaju z databazy, nie z tokenu - odobrane prava platia okamzite
- submitter nevidi cudzie napady ani cudzie audio

Co si musis dorobit ty, ak to otvoris verejne:

- **verejny registracny formular** starter zamerne nema. Ked si ho spravis, potrebuje
  vlastnu obranu: kill switch, honeypot pole, kontrolu casu vyplnenia formulara,
  rate limit na IP, globalny strop a rovnaku odpoved pre kazde odmietnutie. Botnet
  vie na nechraneny formular poslat statisice poziadaviek za hodinu.
- **CORS** si zuz na svoju domenu (`src/index.ts`), teraz povoluje kazdy
  `*.workers.dev`.
- V Cloudflare si zapni Bot Fight Mode a Browser Integrity Check.

---

## Licencia

MIT. Rob si s tym co chces.
