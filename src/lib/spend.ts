// Denny strop vydavkov na platene sluzby.
//
// Preco to tu je: prepis reci aj Claude sa uctuju za mnozstvo, nie za pocet
// volani. Dvesto nahravok moze stat dve eura aj styridsat, podla toho, ake su
// dlhe. Bez stropu staci jeden clovek s makrom alebo jedna zacyklena fronta a
// faktura rastie celu noc. Cloudflare strop vydavkov nema, takze ho musi mat
// aplikacia.
//
// Ako to funguje:
//   1. reserveSpend() PRED volanim odpocita konzervativny odhad. Ked by odhad
//      presiahol denny strop, volanie sa vobec neuskutocni.
//   2. settleSpend() PO odpovedi opravi rezervaciu na realnu cenu.
//   3. releaseSpend() vrati rezervaciu, ked volanie zlyhalo.
//
// Fail-closed: ked sa stav neda precitat ani zapisat, reserveSpend povie NIE.
// Radsej nespracovana nahravka ako nekontrolovana faktura.

import type { Env } from '../types';

/** 1 EUR = 1 000 000 micro-EUR. */
export const MICRO = 1_000_000;

/** Default denny strop, ked nie je nastaveny DAILY_SPEND_LIMIT_EUR. */
const DEFAULT_DAILY_LIMIT_EUR = 2;

// --- Cenniky (konzervativne, radsej nadhodnotene) ---------------------------

/** Prepis reci: micro-EUR za minutu audia. ElevenLabs uctuje za hodinu audia. */
export const STT_MICRO_PER_MIN = 7_000;

/** Odhad dlzky nahravky z velkosti suboru, kym nepozname realnu dlzku. */
export function estimateMinutes(bytes: number): number {
  // Pocitame s 0,5 MB na minutu. Realne hlasove nahravky su hustejsie, takze
  // tento odhad je vyssi ako skutocnost - a to je zamer.
  return Math.max(1, Math.ceil(bytes / (0.5 * 1024 * 1024)));
}

/** Claude analyza: micro-EUR za tisic vstupnych a vystupnych tokenov. */
const CLAUDE_MICRO_PER_1K_INPUT = 1; // 1 USD / MTok
const CLAUDE_MICRO_PER_1K_OUTPUT = 5; // 5 USD / MTok

/** Konzervativna rezervacia na jednu analyzu (dlhy prepis + plna odpoved). */
export const CLAUDE_RESERVE_MICRO = 6_000;

export function claudeCostMicro(inputTokens: number, outputTokens: number): number {
  return Math.ceil(
    (inputTokens / 1000) * CLAUDE_MICRO_PER_1K_INPUT +
      (outputTokens / 1000) * CLAUDE_MICRO_PER_1K_OUTPUT
  );
}

// --- Ucet ------------------------------------------------------------------

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function dailyLimitMicro(env: Env): number {
  const raw = Number(env.DAILY_SPEND_LIMIT_EUR);
  const eur = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_DAILY_LIMIT_EUR;
  return Math.round(eur * MICRO);
}

export interface Reservation {
  ok: boolean;
  micro: number;
  /** Vyplnene, ked ok === false. */
  error?: string;
}

/**
 * Atomicky rezervuje `micro` z dnesneho rozpoctu. Vracia ok:false, ked by
 * rezervacia presiahla strop alebo ked sa stav neda zapisat.
 *
 * Podmienka je sucastou jedineho UPDATE prikazu, takze dve subezne nahravky
 * nemozu obe prejst cez ten isty zvysok rozpoctu.
 */
export async function reserveSpend(env: Env, micro: number): Promise<Reservation> {
  const limit = dailyLimitMicro(env);
  const day = today();

  try {
    await env.DB.prepare('INSERT OR IGNORE INTO spend (day, micro_eur) VALUES (?, 0)')
      .bind(day)
      .run();

    const r = await env.DB.prepare(
      `UPDATE spend SET micro_eur = micro_eur + ?
       WHERE day = ? AND micro_eur + ? <= ?`
    )
      .bind(micro, day, micro, limit)
      .run();

    if (r.meta.changes === 0) {
      const row = await env.DB.prepare('SELECT micro_eur FROM spend WHERE day = ?')
        .bind(day)
        .first<{ micro_eur: number }>();
      const used = ((row?.micro_eur ?? 0) / MICRO).toFixed(2);
      return {
        ok: false,
        micro: 0,
        error:
          `Denny strop vydavkov je vycerpany (dnes ${used} EUR z ` +
          `${(limit / MICRO).toFixed(2)} EUR). Nahravka sa spracuje zajtra, ` +
          'alebo zvys DAILY_SPEND_LIMIT_EUR.',
      };
    }

    return { ok: true, micro };
  } catch (e: unknown) {
    // Fail-closed: ked nevieme zistit stav rozpoctu, nemineme.
    console.error('reserveSpend zlyhalo', e);
    return { ok: false, micro: 0, error: 'Nepodarilo sa overit denny rozpocet' };
  }
}

/** Vrati rezervaciu spat do rozpoctu (volanie zlyhalo, nic sa neminulo). */
export async function releaseSpend(env: Env, micro: number): Promise<void> {
  if (micro <= 0) return;
  try {
    await env.DB.prepare(
      `UPDATE spend SET micro_eur = MAX(0, micro_eur - ?) WHERE day = ?`
    )
      .bind(micro, today())
      .run();
  } catch (e: unknown) {
    console.error('releaseSpend zlyhalo', e);
  }
}

/** Opravi rezervaciu na realnu cenu po odpovedi sluzby. */
export async function settleSpend(
  env: Env,
  reservedMicro: number,
  actualMicro: number
): Promise<void> {
  const diff = actualMicro - reservedMicro;
  if (diff === 0) return;
  try {
    await env.DB.prepare(
      `UPDATE spend SET micro_eur = MAX(0, micro_eur + ?) WHERE day = ?`
    )
      .bind(diff, today())
      .run();
  } catch (e: unknown) {
    console.error('settleSpend zlyhalo', e);
  }
}
