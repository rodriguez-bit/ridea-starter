# CLAUDE.md - kontext pre Claude Code

Tento subor cita Claude Code automaticky pri kazdom spusteni v tomto priecinku.
Drz ho aktualny - ked pridas tabulku alebo endpoint, dopis to sem. Je to jediny
sposob, ako sa AI nebude opakovane pytat na to iste alebo si vymyslat.

Ak Claude Code este nemas: `npm install -g @anthropic-ai/claude-code`, potom v
priecinku projektu spusti `claude`.

---

## Co je tento projekt

Hlasovy zachytavac napadov. Clovek nahra hlasovku, server ju prepise a Claude ju
vyhodnoti (skore 1-10, zhrnutie, silne stranky, rizika, dalsie kroky).

## Stack

| Vrstva | Technologia |
|---|---|
| Runtime | Cloudflare Workers |
| Framework | Hono 4 |
| Databaza | Cloudflare D1 (SQLite na edge) |
| Ulozisko | Cloudflare R2 (audio subory) |
| Frontend | Vanilla JS + CSS, ziadny build step |
| Auth | JWT HMAC-SHA256, hesla PBKDF2 |
| Prepis | ElevenLabs Scribe, fallback OpenAI Whisper |
| Analyza | Claude API |
| Nasadenie | Wrangler CLI |

## Struktura

```
src/
  index.ts            vstupny bod, CORS, routing
  types.ts            Env (bindingy a secrets), User, JWTPayload
  lib/jwt.ts          podpis a overenie JWT
  lib/password.ts     PBKDF2 hashovanie, constant-time compare, hash IP
  lib/stt.ts          ElevenLabs + Whisper, filter halucinacii
  lib/analysis.ts     prompt a volanie Claude API
  middleware/auth.ts  authMiddleware, requireRole
  routes/auth.ts      login, bootstrap, sprava pouzivatelov
  routes/ideas.ts     CRUD, upload, audio, pipeline na pozadi
migrations/           SQL migracie, cislovane
public/               login.html, index.html, app.js, style.css
DESIGN.md             dizajn tokeny, komponenty a UX pravidla frontendu
```

Ked sa robi cokolvek na frontende (nova obrazovka, komponent, farba, stav
async akcie), **najprv si precitaj `DESIGN.md`** a drz sa jeho pravidiel.

## Databaza

- `users` - email, display_name, password_hash, role (submitter/reviewer/admin)
- `ideas` - user_id, title, audio_key, transcript, status, ai_score, ai_summary,
  ai_analysis (JSON), duration_sec
- `login_attempts` - ip_hash, created_at (sliding window rate limit)
- `company_context` - key-value, vklada sa do promptu pre analyzu

Statusy napadu: `processing` -> `done` alebo `error`.

## API

| Metoda | Cesta | Kto |
|---|---|---|
| POST | `/api/auth/login` | verejne, rate limit 5/5min |
| POST | `/api/auth/bootstrap` | verejne, len kym neexistuje ziadny pouzivatel |
| GET | `/api/auth/me` | prihlaseny |
| POST | `/api/auth/users` | admin |
| GET | `/api/ideas` | prihlaseny (submitter vidi len svoje) |
| POST | `/api/ideas` | prihlaseny, multipart `audio` + `title` |
| GET | `/api/ideas/:id` | prihlaseny |
| GET | `/api/ideas/:id/audio` | prihlaseny, streamuje z R2 |
| DELETE | `/api/ideas/:id` | autor alebo admin |
| GET | `/api/health` | verejne |

---

## Pravidla pri pisani kodu

### MUSI

- TypeScript strict, nikdy `any`, chyby chytat ako `catch (e: unknown)`
- SQL vzdy cez `.bind()`, NIKDY skladanim retazca
- Nova migracia = novy subor `migrations/000N_nazov.sql`. Existujucu migraciu uz
  nikdy nemen - u ostatnych uz bezala.
- Kazdy async pohyb v UI ma loading stav a citatelnu chybovu hlasku
- Cas v SQL vzdy SQLite-native: `datetime('now', '-5 minutes')`. NIKDY nedavaj do
  porovnania `new Date().toISOString()` - format s "T" sa proti CURRENT_TIMESTAMP
  (format s medzerou) porovna lexikograficky zle a rate limit sa ticho vypne.
- Commit message: `feat:` / `fix:` / `refactor:` / `chore:`

### NESMIE

- Commitovat `.dev.vars`, `wrangler.toml`, API kluce, `node_modules/`
- `git add .` - vzdy konkretne subory
- Pridavat npm zavislost bez dovodu. Cely projekt bezi na jednej (`hono`).
- Menit existujucu migraciu

### Vzor Hono route

```typescript
import { Hono } from 'hono'
import type { Env, User } from '../types'

const app = new Hono<{ Bindings: Env; Variables: { user: User } }>()

app.get('/', async (c) => {
  try {
    const { results } = await c.env.DB
      .prepare('SELECT * FROM ideas WHERE user_id = ? ORDER BY id DESC')
      .bind(c.get('user').id)
      .all()
    return c.json({ ok: true, data: results })
  } catch (e: unknown) {
    return c.json({ error: e instanceof Error ? e.message : 'Unknown error' }, 500)
  }
})

export default app
```

### Vzory D1

```typescript
const { results } = await c.env.DB.prepare(sql).bind(...args).all()   // viac riadkov
const row = await c.env.DB.prepare(sql).bind(...args).first<Typ>()     // jeden riadok
const r = await c.env.DB.prepare(sql).bind(...args).run()              // zapis
const id = r.meta.last_row_id
```

D1 zvlada v jednej davke obmedzeny pocet prikazov - pri hromadnych zapisoch
rozdel na kusy po cca 80.

---

## Bezpecnost - drz sa toho aj pri novom kode

**Kluce nikdy cez chat.** Ked vedies niekoho setupom, necha si ich napisat do suboru (`secrets.json`, `bootstrap.json` - oba su v `.gitignore`), nahraj ich cez `npx wrangler secret bulk` a subor hned zmaz. Nepytaj kluc ani heslo do konverzacie a nikdy ich nevypisuj spat.

1. **Kazdy endpoint, ktory berie email**, musi vratit rovnaku odpoved pre
   existujuci aj neexistujuci ucet: rovnaky HTTP status, rovnake telo, rovnaky cas.
   Inak sa cez neho da zistovat, kto je registrovany.
2. **Login vzdy prezenie overenie hesla**, aj ked ucet neexistuje - na to je
   `DUMMY_PASSWORD_HASH` v `lib/password.ts`. Bez toho unika informacia cez cas
   odpovede.
3. **Verejny formular** (registracia, kontakt, zdielanie) potrebuje sest vrstiev:
   kill switch, honeypot pole, kontrolu casu vyplnenia, rate limit na IP, globalny
   strop a rovnaku odpoved pre kazde odmietnutie. Bez toho ho botnet zaplavi.
4. **Akcia spustitelna z URL** (odhlasenie z odberu, reset hesla, potvrdenie mailu)
   potrebuje podpisany token, nie holy parameter.
5. **Role citaj z databazy**, nie z JWT. Odobrane prava musia platit okamzite.

---

## Naklady - drz sa toho aj pri novom kode

1. **Limituj eura, nie pocet volani.** Prepis sa uctuje za minuty audia, model za
   tokeny. Rovnaky pocet volani moze stat 2 eura aj 40.
2. **Kill switch je vzdy negativny** (`X_DISABLED === '1'`), default v kode je
   zapnute, a premenna **nikdy** nie je vo `wrangler.toml`. Vars a secrets zdielaju
   jeden namespace - hodnota zo suboru prepise pri deployi to, co si nastavil cez
   `wrangler secret put`, teda presne vtedy, ked nasadzujes opravu.
3. **`if (api_key)` nie je poistka.** Plateny efekt potrebuje vlastny explicitny
   prepinac.
4. **Ked ochrana nevie zistit stav, musi zastavit**, nie pustit dalej.
5. **Retry bez pocitadla je nekonecna slucka.** Kazdy stav, do ktoreho sa da vratit
   z cronu, musi mat `attempts` a terminalny stav.
6. **Ked pridavas strop, sprav grep na vsetky platene volania** v tom istom
   handleri a osetri ich naraz. Jedna osetrena cesta neochrani projekt.

---

## Prikazy

```bash
npx wrangler dev                                        # lokalne
npx wrangler deploy                                     # nasadenie
npx wrangler d1 migrations apply ridea-starter --remote # migracie
npx wrangler d1 execute ridea-starter --remote --command="SELECT * FROM ideas LIMIT 5"
npx wrangler tail --format pretty                       # zive logy
npx wrangler secret put NAZOV                           # tajomstvo
npx tsc --noEmit                                        # kontrola typov
```

---

## Ako sa s Claude Code rozpravat o tomto projekte

Funguje dobre:

- "Pridaj komentare k napadom - tabulka, endpointy, UI v detaile."
- "Nahravky nad 4 MB teraz padaju. Prerob prepis na ElevenLabs webhook rezim."
- "Sprav cron, ktory kazdych 5 minut skusi znova napady v stave error. Max 3 pokusy."
- "Pridaj export vsetkych napadov do CSV, len pre admina."

Funguje zle:

- "Sprav to lepsie." - AI netusi, co je lepsie, a prepise ti pol projektu.
- Tri veci naraz v jednej vete. Rob po jednom, po kazdom kroku otestuj.

Ked nieco nefunguje, nezacni tym, ze si vypytas opravu. Zacni tym, ze das AI
prikaz `npx wrangler tail --format pretty`, spravis tu akciu v prehliadaci a
poslete jej realny log. Bez logu AI hada.
