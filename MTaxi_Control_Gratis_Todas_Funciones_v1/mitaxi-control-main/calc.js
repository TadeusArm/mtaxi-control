// Núcleo de cálculo de MiTaxi Control.
// No toca el DOM ni el almacenamiento: así se puede comprobar aparte y se
// reutiliza igual en la hoja diaria, en el historial y en los informes PDF.
(function (root) {
  "use strict";

  const WEEK_MS = 604800000;
  const DEFAULT_ANCHOR = "2026-01-03"; // sábado, sólo referencia inicial del turno alterno.

  const defaultShift = { weekdays: [1, 2, 3, 4], weekend: "alt", anchor: DEFAULT_ANCHOR };

  const defaultConfig = {
    insurance: 0,
    annualOther: 0,
    selfEmployed: 0,
    agency: 0,
    vehicleLoan: 0,
    parking: 0,
    maintenance: 0,
    monthlyOther: 0,
    custom: [],
    shift: { ...defaultShift }
  };

  const FIXED_FIELDS = [
    { key: "selfEmployed", label: "Cuota de autónomos", period: "month" },
    { key: "agency", label: "Gestoría", period: "month" },
    { key: "vehicleLoan", label: "Préstamo/financiación", period: "month" },
    { key: "parking", label: "Parking/Garaje", period: "month" },
    { key: "maintenance", label: "Mantenimiento", period: "month" },
    { key: "monthlyOther", label: "Otros mensuales", period: "month" },
    { key: "insurance", label: "Seguro", period: "year" },
    { key: "annualOther", label: "Otros anuales", period: "year" }
  ];

  function parseMoney(value) {
    const cleaned = String(value ?? "").trim().replace(/\s/g, "").replace(",", ".").replace(/[^0-9.-]/g, "");
    const n = Number.parseFloat(cleaned);
    return Number.isFinite(n) ? Math.max(0, n) : 0;
  }

  const num = (value) => (Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0);
  const isDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));

  // Acepta configuraciones antiguas (sin mantenimiento, sin gastos
  // personalizados y sin calendario) y las completa con los valores por defecto.
  function normalizeConfig(raw) {
    const source = raw && typeof raw === "object" ? raw : {};
    const config = { ...defaultConfig, ...source };
    FIXED_FIELDS.forEach((field) => { config[field.key] = num(config[field.key]); });

    config.custom = (Array.isArray(source.custom) ? source.custom : [])
      .map((item, index) => ({
        id: typeof item?.id === "string" && item.id ? item.id : `gasto-${index + 1}`,
        name: String(item?.name ?? "").slice(0, 60),
        amount: num(item?.amount),
        period: item?.period === "year" ? "year" : "month"
      }));

    const shift = source.shift && typeof source.shift === "object" ? source.shift : {};
    const weekdays = Array.isArray(shift.weekdays)
      ? [...new Set(shift.weekdays.map(Number).filter((d) => d >= 1 && d <= 5))].sort()
      : [...defaultShift.weekdays];
    const weekend = ["alt", "sat", "sun", "satsun", "none"].includes(shift.weekend) ? shift.weekend : defaultShift.weekend;
    config.shift = { weekdays, weekend, anchor: isDate(shift.anchor) ? shift.anchor : DEFAULT_ANCHOR };
    return config;
  }

  // ---------------------------------------------------------------- calendario

  function dateFrom(value) { return value instanceof Date ? value : new Date(`${value}T12:00:00`); }

  function mondayOf(date) {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d;
  }

  // Semanas completas de diferencia; Math.round absorbe los cambios de hora.
  function weekDistance(date, reference) {
    return Math.round((mondayOf(date).getTime() - mondayOf(reference).getTime()) / WEEK_MS);
  }

  function isWorkDay(value, config) {
    const cfg = normalizeConfig(config).shift;
    const date = dateFrom(value);
    const dow = date.getDay();
    if (dow >= 1 && dow <= 5) return cfg.weekdays.includes(dow);
    if (cfg.weekend === "none") return false;
    if (cfg.weekend === "satsun") return true;
    if (cfg.weekend === "sat") return dow === 6;
    if (cfg.weekend === "sun") return dow === 0;
    // Turno alterno: la semana de la fecha de referencia se trabaja el mismo
    // día que esa referencia y a partir de ahí se alterna sábado/domingo.
    const anchor = dateFrom(cfg.anchor);
    const anchorIsSaturday = anchor.getDay() === 6;
    const even = Math.abs(weekDistance(date, anchor) % 2) === 0;
    const saturdayWeek = even ? anchorIsSaturday : !anchorIsSaturday;
    return saturdayWeek ? dow === 6 : dow === 0;
  }

  function daysInMonth(year, month) { return new Date(year, month + 1, 0).getDate(); }

  const shiftCache = new Map();
  function shiftKey(config) {
    const cfg = normalizeConfig(config).shift;
    return `${cfg.weekdays.join("")}|${cfg.weekend}|${cfg.anchor}`;
  }

  // Cuenta día a día las jornadas que caen dentro del mes natural. Por eso una
  // semana partida deja su fin de semana en el mes al que pertenece la fecha.
  function shiftsInMonth(year, month, config) {
    const cfg = normalizeConfig(config);
    const key = `${year}-${month}-${shiftKey(cfg)}`;
    if (shiftCache.has(key)) return shiftCache.get(key);
    const last = daysInMonth(year, month);
    let count = 0;
    for (let day = 1; day <= last; day += 1) {
      if (isWorkDay(new Date(year, month, day, 12, 0, 0, 0), cfg)) count += 1;
    }
    shiftCache.set(key, count);
    return count;
  }

  function shiftsBetween(startDate, endDate, config) {
    const cfg = normalizeConfig(config);
    const cursor = dateFrom(startDate);
    const end = dateFrom(endDate);
    let count = 0;
    while (cursor <= end) {
      if (isWorkDay(cursor, cfg)) count += 1;
      cursor.setDate(cursor.getDate() + 1);
    }
    return count;
  }

  function clearShiftCache() { shiftCache.clear(); }

  // --------------------------------------------------------------- gastos fijos

  function fixedCategories(config) {
    const cfg = normalizeConfig(config);
    const list = FIXED_FIELDS.map((field) => ({
      key: field.key,
      label: field.label,
      period: field.period,
      amount: cfg[field.key],
      monthly: field.period === "year" ? cfg[field.key] / 12 : cfg[field.key],
      custom: false
    }));
    cfg.custom.forEach((item) => list.push({
      key: `custom:${item.id}`,
      label: item.name || "Gasto personalizado",
      period: item.period,
      amount: item.amount,
      monthly: item.period === "year" ? item.amount / 12 : item.amount,
      custom: true
    }));
    return list;
  }

  function fixedMonthlyTotal(config) {
    return fixedCategories(config).reduce((sum, item) => sum + item.monthly, 0);
  }

  // Divisor del prorrateo: las jornadas reales del mes. Si el usuario todavía no
  // ha marcado ninguna, se reparte entre los días del mes para no perder gasto.
  function shiftDivisor(year, month, config) {
    const shifts = shiftsInMonth(year, month, config);
    return shifts > 0 ? shifts : daysInMonth(year, month);
  }

  function fixedPerShift(year, month, config) {
    return fixedMonthlyTotal(config) / shiftDivisor(year, month, config);
  }

  function fixedForDate(value, config) {
    const date = dateFrom(value);
    if (Number.isNaN(date.getTime())) return 0;
    return fixedPerShift(date.getFullYear(), date.getMonth(), config);
  }

  // Reparte cada gasto fijo con el mismo divisor que usa la jornada, para que la
  // suma del desglose del informe coincida siempre con el total de gastos fijos.
  function fixedBreakdown(records, config) {
    const categories = fixedCategories(config);
    const totals = categories.map((item) => ({ key: item.key, label: item.label, custom: item.custom, amount: 0 }));
    (records || []).forEach((record) => {
      const date = dateFrom(record.date);
      if (Number.isNaN(date.getTime())) return;
      const divisor = shiftDivisor(date.getFullYear(), date.getMonth(), config);
      categories.forEach((item, index) => { totals[index].amount += item.monthly / divisor; });
    });
    return totals;
  }

  // ------------------------------------------------------------------ jornadas

  // Recalcula siempre desde la configuración vigente: los registros guardados
  // conservan sus campos, pero el prorrateo mostrado es el correcto.
  function recordTotals(record, config) {
    const revenue = num(record.revenue);
    const card = num(record.card);
    const apps = num(record.apps);
    const cash = record.cash != null ? num(record.cash) : Math.max(0, revenue - card - apps);
    const fuel = num(record.fuel);

    if (record.mode === "salary") {
      const percentage = Math.min(100, num(record.percentage));
      const driver = (revenue * percentage) / 100;
      return {
        mode: "salary", revenue, card, apps, cash, fuel, other: 0, fixed: 0,
        percentage, driver, net: driver,
        expenses: fuel,
        ownerShare: revenue - driver,
        delivery: revenue - driver - fuel, // recaudación − parte del conductor − gasolina
        balance: cash - driver - fuel      // lo que sale del efectivo que lleva encima
      };
    }

    const other = num(record.other);
    const fixed = fixedForDate(record.date, config);
    const expenses = fuel + other + fixed;
    return {
      mode: "owner", revenue, card, apps, cash, fuel, other, fixed,
      percentage: 0, driver: 0, expenses,
      net: revenue - expenses,
      ownerShare: 0, delivery: 0, balance: 0
    };
  }

  function aggregate(records, config) {
    const totals = {
      count: 0, revenue: 0, card: 0, apps: 0, cash: 0, fuel: 0, other: 0,
      fixed: 0, expenses: 0, net: 0, driver: 0, delivery: 0, balance: 0
    };
    (records || []).forEach((record) => {
      const v = recordTotals(record, config);
      totals.count += 1;
      ["revenue", "card", "apps", "cash", "fuel", "other", "fixed", "expenses", "net", "driver", "delivery", "balance"]
        .forEach((key) => { totals[key] += v[key]; });
    });
    return totals;
  }

  root.MiTaxiCalc = {
    DEFAULT_ANCHOR,
    FIXED_FIELDS,
    defaultConfig,
    normalizeConfig,
    parseMoney,
    isWorkDay,
    daysInMonth,
    shiftsInMonth,
    shiftsBetween,
    shiftDivisor,
    clearShiftCache,
    fixedCategories,
    fixedMonthlyTotal,
    fixedPerShift,
    fixedForDate,
    fixedBreakdown,
    recordTotals,
    aggregate
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
