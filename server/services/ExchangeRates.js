// European Central Bank daily reference rates (EUR base). Display-only estimates:
// stored quotes are never rewritten. The last good snapshot is kept in planner_settings.
const ECB_URL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';
const NEEDED = ['CAD', 'USD', 'GBP'];
const KEY = 'exchange_rates';
const REFRESH_MS = 6 * 60 * 60 * 1000;

function parseEcb(xml) {
  const date = /time=['"](\d{4}-\d{2}-\d{2})['"]/.exec(xml)?.[1];
  const rates = { EUR: 1 };
  for (const [, code, rate] of xml.matchAll(/currency=['"]([A-Z]{3})['"]\s+rate=['"](\d+(?:\.\d+)?)['"]/g)) {
    if (NEEDED.includes(code) && Number(rate) > 0) rates[code] = Number(rate);
  }
  if (!date || NEEDED.some(code => !rates[code])) throw new Error('Unexpected ECB response');
  return { date, rates };
}

class ExchangeRates {
  constructor(pool, { url = ECB_URL } = {}) {
    this.pool = pool;
    this.url = url;
    this.current = null;
  }

  async load() {
    const row = (await this.pool.query('SELECT value FROM planner_settings WHERE key=$1', [KEY])).rows[0];
    if (row) this.current = JSON.parse(row.value);
  }

  async refresh() {
    try {
      const response = await fetch(this.url, { signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const snapshot = { ...parseEcb(await response.text()), fetchedAt: new Date().toISOString() };
      await this.pool.query(`INSERT INTO planner_settings(key,value) VALUES($1,$2)
        ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`, [KEY, JSON.stringify(snapshot)]);
      this.current = snapshot;
    } catch (error) {
      console.warn('Exchange rate refresh failed:', error.message);
    }
  }

  async start() {
    await this.load().catch(() => {});
    const age = this.current ? Date.now() - Date.parse(this.current.fetchedAt) : Infinity;
    if (!(age < REFRESH_MS)) this.refresh();
    setInterval(() => this.refresh(), REFRESH_MS).unref();
  }

  // null when a rate is unknown, so callers fall back to the quoted currency.
  convert(amount, from, to) {
    if (from === to) return Number(amount);
    const rates = this.current?.rates;
    if (!rates?.[from] || !rates?.[to]) return null;
    return Number(amount) / rates[from] * rates[to];
  }
}

module.exports = { ExchangeRates, parseEcb };
