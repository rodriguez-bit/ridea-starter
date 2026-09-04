-- Denny strop vydavkov na platene sluzby (prepis reci + Claude analyza).
-- Jeden riadok na den, suma v micro-EUR ako integer (1 EUR = 1 000 000).
-- Integer preto, aby sa nescitavali desatinne chyby, a micro preto, lebo
-- jedna analyza stoji radovo tisiciny eura.

CREATE TABLE IF NOT EXISTS spend (
  day       TEXT PRIMARY KEY,            -- 'YYYY-MM-DD' v UTC
  micro_eur INTEGER NOT NULL DEFAULT 0
);
