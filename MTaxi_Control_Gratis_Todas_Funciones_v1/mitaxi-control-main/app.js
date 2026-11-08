const ACCOUNT_KEY = localStorage.getItem("mitaxi-active-account") || "guest";
const STORAGE_KEY = `mitaxi-control-records-v1-${ACCOUNT_KEY}`;
const CONFIG_KEY = `mitaxi-control-config-v1-${ACCOUNT_KEY}`;
const CLIENT_KEY = `mitaxi-control-client-v1-${ACCOUNT_KEY}`;
const C = globalThis.MiTaxiCalc;

const formMoneyIds = ["totalSheet", "card", "apps", "fuel", "other", "percentage"];
const fixedFieldIds = C.FIXED_FIELDS.map((f) => f.key);
const $ = (id) => document.getElementById(id);

const state = {
  mode: "owner",
  period: "day",
  cursor: new Date(),
  records: load(STORAGE_KEY, []),
  config: C.normalizeConfig(load(CONFIG_KEY, {})),
  clientId: localStorage.getItem(CLIENT_KEY) || crypto.randomUUID(),
  draft: null,          // copia de los gastos personalizados mientras el diálogo está abierto
  pdfScope: "month",
  chartScope: "month",
};
localStorage.setItem(CLIENT_KEY, state.clientId);

function load(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
const parseMoney = C.parseMoney;
function fmt(value) { return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(value || 0); }
const nf2 = new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money2 = (value) => nf2.format(value || 0);
function localDate(date = new Date()) { const d = new Date(date.getTime() - date.getTimezoneOffset() * 60000); return d.toISOString().slice(0, 10); }
const comma = (value) => (value ? String(value).replace(".", ",") : "");

// ------------------------------------------------------------------ hoja diaria

function formValues() {
  const date = $("date").value || localDate();
  const total = parseMoney($("totalSheet").value);
  const card = parseMoney($("card").value);
  const apps = parseMoney($("apps").value);
  const cash = total - card - apps;
  const fuel = parseMoney($("fuel").value);
  const other = parseMoney($("other").value);
  const fixed = C.fixedForDate(date, state.config);
  const pct = Math.min(100, parseMoney($("percentage").value));
  const driver = (total * pct) / 100;
  const delivery = total - driver - fuel;   // recaudación − parte del conductor − gasolina
  const balance = cash - driver - fuel;     // lo que sale del efectivo que lleva encima
  return {
    date, total, card, apps, cash, fuel, other, fixed, pct, driver, delivery, balance,
    expenses: fuel + other + fixed,
    net: state.mode === "owner" ? total - fuel - other - fixed : driver
  };
}

function updatePreview() {
  const v = formValues();
  $("dailyFixed").textContent = fmt(v.fixed);
  $("cashDisplay").textContent = fmt(v.cash);
  $("cashNote").classList.toggle("negative", v.cash < 0);
  $("revenuePreview").textContent = fmt(v.total);
  $("expensePreview").textContent = `− ${fmt(v.expenses)}`;
  $("fuelPreview").textContent = `− ${fmt(v.fuel)}`;
  $("netPreview").textContent = fmt(v.net);
  $("deliveryPreview").textContent = fmt(v.delivery);
  $("balancePreview").textContent = fmt(v.balance);
  $("balanceLabel").textContent = v.balance < 0 ? "A tu favor (te debe el jefe)" : "Entregar al jefe en efectivo";
  $("balanceRow").classList.toggle("negative", v.balance < 0);
  $("deliveryRow").classList.toggle("negative", v.delivery < 0);
}

function setMode(mode) {
  state.mode = mode;
  const owner = mode === "owner";
  document.querySelectorAll("[data-mode]").forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
  $("ownerFields").hidden = !owner;
  $("salaryFields").hidden = owner;
  $("deductionRow").hidden = !owner;
  $("fuelRow").hidden = owner;
  $("fuelSalaryNote").hidden = owner;
  $("deliveryRow").hidden = owner;
  $("balanceRow").hidden = owner;
  $("resultLabel").textContent = owner ? "Beneficio neto real" : "Tu parte";
  renderHistory();
  updatePreview();
}

// --------------------------------------------------------- guardado y sincronía

function saveLocal() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.records)); }
async function syncRecord(record) {
  $("syncStatus").textContent = "Sincronizando…";
  try {
    const res = await fetch("/api/registros", { method: "PUT", credentials:"same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(record) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { $("syncStatus").textContent = data.error || "No se ha podido sincronizar"; return { ok:false, error:data.error || "No se ha podido guardar en el servidor.", code:data.code }; }
    $("syncStatus").textContent = "Sincronizado"; return {ok:true};
  } catch { $("syncStatus").textContent = "Sin conexión con el servidor"; return {ok:false,error:"No hay conexión con el servidor. La jornada no se ha confirmado; vuelve a intentarlo."}; }
}
async function deleteRemote(id) {
  const response = await fetch(`/api/registros?id=${encodeURIComponent(id)}`, {
    method: "DELETE", credentials: "same-origin"
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "No se ha podido eliminar la jornada del servidor.");
  return true;
}
function recordTimestamp(record) {
  const value = Date.parse(record?.updatedAt || record?.createdAt || "");
  return Number.isFinite(value) ? value : 0;
}
async function pullSettings() {
  try {
    const response = await fetch("/api/account/settings", { credentials: "same-origin", cache: "no-store" });
    if (!response.ok) return;
    const data = await response.json();
    if (data.settings && typeof data.settings === "object") {
      state.config = C.normalizeConfig(data.settings);
      localStorage.setItem(CONFIG_KEY, JSON.stringify(state.config));
      C.clearShiftCache(); updatePreview(); renderHistory();
    } else {
      // Primera sincronización: publica la configuración local del usuario en su cuenta.
      const saved = await fetch("/api/account/settings", { method: "PUT", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ settings: state.config }) });
      if (!saved.ok) $("syncStatus").textContent = "Configuración pendiente de sincronizar";
    }
  } catch { $("syncStatus").textContent = "No se pudo sincronizar la configuración"; }
}
async function pullRemote() {
  try {
    const res = await fetch("/api/registros", { credentials: "same-origin", cache: "no-store" });
    if (!res.ok) {
      if (res.status === 401) $("syncStatus").textContent = "Sesión caducada. Vuelve a entrar.";
      return;
    }
    const remote = await res.json();
    if (!Array.isArray(remote)) throw new Error("Respuesta de sincronización no válida.");
    const merged = new Map();
    for (const record of remote) {
      if (record && typeof record.id === "string") merged.set(record.id, record);
    }
    const localNewer = [];
    for (const local of state.records) {
      if (!local || typeof local.id !== "string") continue;
      const serverRecord = merged.get(local.id);
      // Conserva la versión más reciente; ante empate, el servidor es la fuente autoritativa.
      if (!serverRecord || recordTimestamp(local) > recordTimestamp(serverRecord)) {
        merged.set(local.id, local);
        localNewer.push(local);
      }
    }
    state.records = [...merged.values()];
    saveLocal(); renderHistory();
    // Repara en el servidor cualquier versión local más reciente que se haya conservado.
    for (const record of localNewer) {
      const result = await syncRecord(record);
      if (!result.ok) throw new Error(result.error || "No se pudo completar la sincronización.");
    }
    $("syncStatus").textContent = "Sincronizado";
  } catch (error) {
    $("syncStatus").textContent = "No se pudo actualizar desde el servidor";
  }
}

function resetForm() {
  $("recordForm").reset();
  $("date").value = localDate();
  $("percentage").value = "40";
  $("editingId").value = "";
  $("formKicker").textContent = "NUEVO REGISTRO";
  $("saveText").textContent = "Guardar jornada";
  $("cancelEdit").hidden = true;
  $("formError").textContent = "";
  updatePreview();
}

async function submitRecord(e) {
  e.preventDefault();
  const date = $("date").value;
  if (!date) { $("formError").textContent = "Selecciona una fecha."; return; }
  const v = formValues();
  if (v.total <= 0) { $("formError").textContent = "Añade el Total hoja de la jornada."; return; }
  if (v.cash < 0) { $("formError").textContent = "Visa/Tarjeta + Aplicaciones no puede superar el Total hoja."; return; }
  const oldId = $("editingId").value;
  const owner = state.mode === "owner";
  const record = {
    id: oldId || crypto.randomUUID(),
    date, mode: state.mode,
    cash: v.cash, card: v.card, apps: v.apps,
    fuel: v.fuel,                       // la gasolina se guarda en los dos modos
    other: owner ? v.other : 0,
    fixed: owner ? v.fixed : 0,
    percentage: owner ? 0 : v.pct,
    revenue: v.total,
    net: v.net,
    delivery: owner ? 0 : v.delivery,
    balance: owner ? 0 : v.balance,
    updatedAt: new Date().toISOString()
  };
  const sync = await syncRecord(record);
  if (!sync.ok) {
    $("formError").textContent = sync.error;
    return;
  }
  const idx = state.records.findIndex((r) => r.id === record.id);
  if (idx >= 0) state.records[idx] = record; else state.records.push(record);
  saveLocal(); resetForm();
  state.cursor = new Date(`${date}T12:00:00`);
  renderHistory();
  // Tras regenerar las opciones, seleccionar el mes/año de la jornada recién guardada.
  const chartPeriod = $("chartPeriod");
  if (chartPeriod) {
    const wantedPeriod = state.chartScope === "month" ? date.slice(0, 7) : date.slice(0, 4);
    if ([...chartPeriod.options].some(option => option.value === wantedPeriod)) {
      chartPeriod.value = wantedPeriod;
      renderAnalytics();
    }
  }
  toast(oldId ? "Jornada actualizada" : "Jornada guardada");
  document.querySelector(".history-section").scrollIntoView({ behavior: "smooth", block: "start" });
}

function editRecord(id) {
  const r = state.records.find((x) => x.id === id);
  if (!r) return;
  setMode(r.mode);
  $("totalSheet").value = comma(r.revenue);
  ["card", "apps", "fuel", "other"].forEach((k) => { $(k).value = comma(r[k]); });
  $("percentage").value = r.percentage || 40;
  $("date").value = r.date;
  $("editingId").value = r.id;
  $("formKicker").textContent = "EDITANDO REGISTRO";
  $("saveText").textContent = "Actualizar jornada";
  $("cancelEdit").hidden = false;
  updatePreview();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function removeRecord(id) {
  if (!confirm("¿Eliminar esta jornada? Esta acción no se puede deshacer.")) return;
  const button = document.querySelector(`[data-delete="${CSS.escape(id)}"]`);
  if (button) button.disabled = true;
  try {
    await deleteRemote(id);
    state.records = state.records.filter((r) => r.id !== id);
    saveLocal(); renderHistory(); toast("Jornada eliminada");
  } catch (error) {
    toast(error.message || "No se ha podido eliminar la jornada.");
    if (button) button.disabled = false;
  }
}

// --------------------------------------------------------------------- historial

function periodBounds() {
  const d = new Date(state.cursor); d.setHours(0, 0, 0, 0);
  let start = new Date(d), end = new Date(d);
  if (state.period === "week") { const day = (d.getDay() + 6) % 7; start.setDate(d.getDate() - day); end = new Date(start); end.setDate(start.getDate() + 6); }
  if (state.period === "month") { start = new Date(d.getFullYear(), d.getMonth(), 1); end = new Date(d.getFullYear(), d.getMonth() + 1, 0); }
  if (state.period === "year") { start = new Date(d.getFullYear(), 0, 1); end = new Date(d.getFullYear(), 11, 31); }
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

function periodTitle(start, end) {
  const f = (d, o) => new Intl.DateTimeFormat("es-ES", o).format(d);
  if (state.period === "day") return f(start, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  if (state.period === "week") return `${f(start, { day: "numeric", month: "short" })} — ${f(end, { day: "numeric", month: "short", year: "numeric" })}`;
  if (state.period === "month") return f(start, { month: "long", year: "numeric" });
  return String(start.getFullYear());
}

function recordsInPeriod(mode = state.mode) {
  const { start, end } = periodBounds();
  return state.records
    .filter((r) => r.mode === mode)
    .filter((r) => { const d = new Date(`${r.date}T12:00:00`); return d >= start && d <= end; })
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

function cell(label, value, cls = "") { return `<div class="${cls}"><span>${label}</span><strong>${value}</strong></div>`; }

function renderHistory() {
  const { start, end } = periodBounds();
  $("periodLabel").textContent = periodTitle(start, end);
  const rows = recordsInPeriod();
  const t = C.aggregate(rows, state.config);
  const owner = state.mode === "owner";

  $("totalRevenue").textContent = fmt(t.revenue);
  $("totalExpenses").textContent = fmt(owner ? t.expenses : t.delivery);
  $("totalNet").textContent = fmt(t.net);
  $("totalCard").textContent = fmt(t.card);
  $("totalApps").textContent = fmt(t.apps);
  $("totalCash").textContent = fmt(t.cash);
  $("totalSecondaryLabel").textContent = owner ? "Gastos" : "A entregar";
  $("totalNetLabel").textContent = owner ? "Neto" : "Tu parte";

  const detail = $("detailStrip");
  detail.hidden = false;
  detail.classList.toggle("cols-2", !owner);
  detail.innerHTML = owner
    ? cell("Gasolina", fmt(t.fuel)) + cell("Otros gastos", fmt(t.other)) + cell("Gastos fijos", fmt(t.fixed))
    : cell("Gasolina", fmt(t.fuel)) + cell("Entregar en efectivo", fmt(t.balance));

  $("recordList").innerHTML = rows.length ? rows.map((r) => {
    const v = C.recordTotals(r, state.config);
    const d = new Date(`${r.date}T12:00:00`);
    const day = String(d.getDate()).padStart(2, "0");
    const month = new Intl.DateTimeFormat("es-ES", { month: "short" }).format(d).replace(".", "");
    const detailText = v.mode === "owner"
      ? `${fmt(v.expenses)} en gastos${v.fuel ? ` · ${fmt(v.fuel)} gasolina` : ""}`
      : `${v.percentage}% de comisión${v.fuel ? ` · ${fmt(v.fuel)} gasolina` : ""}`;
    return `<article class="record-item"><div class="record-date"><strong>${day}</strong><span>${month.toUpperCase()}</span></div><div class="record-info"><strong>${fmt(v.revenue)} facturados</strong><span>${detailText}</span></div><div class="record-amount"><strong>${fmt(v.net)}</strong><div class="record-actions"><button data-edit="${r.id}">Editar</button><button data-delete="${r.id}">Borrar</button></div></div></article>`;
  }).join("") : `<div class="empty"><strong>Sin jornadas</strong>No hay registros en este periodo.</div>`;
  renderAnalytics();
}

// Sincroniza los gráficos si los registros cambian en otra pestaña del navegador.
window.addEventListener("storage", event => {
  if (event.key === STORAGE_KEY && event.newValue) {
    try { const records = JSON.parse(event.newValue); if (Array.isArray(records)) { state.records = records; renderHistory(); } } catch {}
  }
});
function chartPeriods() {
  const now=new Date();
  if(state.chartScope==="month") { const keys=new Set(state.records.map(r=>String(r.date||"").slice(0,7)).filter(k=>/^\d{4}-\d{2}$/.test(k))); keys.add(`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`); return [...keys].sort().reverse(); }
  const keys=new Set(state.records.map(r=>String(r.date||"").slice(0,4)).filter(k=>/^\d{4}$/.test(k))); keys.add(String(now.getFullYear())); return [...keys].sort().reverse();
}
function renderAnalytics() {
  if (!$("analyticsChart")) return;
  const select=$("chartPeriod"), periods=chartPeriods(), old=select.value;
  select.innerHTML=periods.map(k=>`<option value="${k}">${state.chartScope==="month"?new Intl.DateTimeFormat("es-ES",{month:"long",year:"numeric"}).format(new Date(`${k}-15T12:00:00`)):k}</option>`).join(""); if(periods.includes(old)) select.value=old;
  const period=select.value||periods[0]; $("chartPeriodLabel").textContent=state.chartScope==="month"?"Mes":"Año";
  document.querySelectorAll("[data-chart-scope]").forEach(b=>b.classList.toggle("active",b.dataset.chartScope===state.chartScope));
  let buckets=[];
  if(state.chartScope==="month") { const [year,month]=period.split("-").map(Number), count=new Date(year,month,0).getDate(); buckets=Array.from({length:count},(_,i)=>({label:String(i+1),key:`${period}-${String(i+1).padStart(2,"0")}`})); }
  else buckets=Array.from({length:12},(_,i)=>({label:["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"][i],key:`${period}-${String(i+1).padStart(2,"0")}`}));
  const values=buckets.map(b=>{const rows=state.records.filter(r=>r.mode===state.mode&&String(r.date||"").startsWith(b.key));const t=C.aggregate(rows,state.config);return {...b,revenue:t.revenue,expenses:t.expenses,net:t.net,count:rows.length};});
  const max=Math.max(1,...values.map(v=>Math.max(v.revenue,v.expenses,v.net,0)));
  $("analyticsChart").innerHTML=values.map(v=>`<div class="chart-column" title="${v.label}: ingresos ${fmt(v.revenue)}, gastos ${fmt(v.expenses)}, beneficio ${fmt(v.net)}"><div class="chart-bars"><i class="bar-income" style="height:${Math.max(2,v.revenue/max*100)}%"></i><i class="bar-expense" style="height:${Math.max(2,v.expenses/max*100)}%"></i><i class="bar-net" style="height:${Math.max(2,Math.max(0,v.net)/max*100)}%"></i></div><span>${v.label}</span></div>`).join("");
  const active=values.filter(v=>v.count>0), revenue=active.reduce((a,v)=>a+v.revenue,0), net=active.reduce((a,v)=>a+v.net,0), best=active.slice().sort((a,b)=>b.net-a.net)[0], average=active.length?net/active.length:0, unit=state.chartScope==="month"?"día":"mes";
  $("analyticsInsights").innerHTML=`<div><span>Ingresos del periodo</span><strong>${fmt(revenue)}</strong></div><div><span>Beneficio neto</span><strong>${fmt(net)}</strong></div><div><span>Media por ${unit} trabajado</span><strong>${fmt(average)}</strong></div><div><span>Mejor ${unit}</span><strong>${best?`${best.label} · ${fmt(best.net)}`:"Sin datos"}</strong></div>`;
}

function movePeriod(direction) {
  const d = state.cursor;
  if (state.period === "day") d.setDate(d.getDate() + direction);
  if (state.period === "week") d.setDate(d.getDate() + direction * 7);
  if (state.period === "month") d.setMonth(d.getMonth() + direction);
  if (state.period === "year") d.setFullYear(d.getFullYear() + direction);
  renderHistory();
}

function toast(message) {
  const el = $("toast");
  el.textContent = message; el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 2200);
}

// ------------------------------------------------------- diálogo de gastos

// Se construye una sola vez por fila: nunca se vuelve a pintar un input
// mientras el usuario escribe dentro de él.
function customRow(item) {
  const row = document.createElement("div");
  row.className = "custom-row";
  row.innerHTML = `
    <input class="custom-name" type="text" autocomplete="off" placeholder="Nombre del gasto" maxlength="60">
    <div class="money"><input class="custom-amount" inputmode="decimal" autocomplete="off" placeholder="0,00"><b>€</b></div>
    <select class="custom-period"><option value="month">/ mes</option><option value="year">/ año</option></select>
    <button type="button" class="custom-remove" aria-label="Eliminar gasto">×</button>`;
  const name = row.querySelector(".custom-name");
  const amount = row.querySelector(".custom-amount");
  const period = row.querySelector(".custom-period");
  name.value = item.name;
  amount.value = comma(item.amount);
  period.value = item.period;
  name.addEventListener("input", () => { item.name = name.value; });
  amount.addEventListener("input", () => { item.amount = parseMoney(amount.value); updateShiftPreview(); });
  period.addEventListener("change", () => { item.period = period.value; updateShiftPreview(); });
  row.querySelector(".custom-remove").addEventListener("click", () => {
    state.draft = state.draft.filter((x) => x !== item);
    row.remove(); updateShiftPreview();
  });
  return row;
}

function renderCustomList() {
  const list = $("customList");
  list.innerHTML = "";
  state.draft.forEach((item) => list.appendChild(customRow(item)));
}

function readShiftForm() {
  const weekdays = [...$("weekdayPicker").querySelectorAll("input:checked")].map((i) => Number(i.value));
  return { weekdays, weekend: $("weekendMode").value, anchor: $("weekendAnchor").value || C.DEFAULT_ANCHOR };
}

// Vista previa: usa la configuración escrita en el diálogo sin guardarla todavía.
function draftConfig() {
  const config = { ...state.config };
  fixedFieldIds.forEach((id) => { config[id] = parseMoney($(id).value); });
  config.custom = state.draft.map((x) => ({ ...x }));
  config.shift = readShiftForm();
  return C.normalizeConfig(config);
}

function updateShiftPreview() {
  const config = draftConfig();
  C.clearShiftCache();
  const now = state.cursor instanceof Date && !Number.isNaN(state.cursor.getTime()) ? state.cursor : new Date();
  const year = now.getFullYear(); const month = now.getMonth();
  const shifts = C.shiftsInMonth(year, month, config);
  $("shiftMonthLabel").textContent = new Intl.DateTimeFormat("es-ES", { month: "long", year: "numeric" }).format(new Date(year, month, 1));
  $("shiftCount").textContent = String(shifts);
  $("shiftShare").textContent = fmt(C.fixedPerShift(year, month, config));
  $("shiftWarning").hidden = shifts > 0;
  $("anchorLabel").hidden = config.shift.weekend !== "alt";
}

function openSettings() {
  fixedFieldIds.forEach((id) => { $(id).value = comma(state.config[id]); });
  state.draft = state.config.custom.map((x) => ({ ...x }));
  renderCustomList();
  const shift = state.config.shift;
  $("weekdayPicker").querySelectorAll("input").forEach((input) => { input.checked = shift.weekdays.includes(Number(input.value)); });
  $("weekendMode").value = shift.weekend;
  $("weekendAnchor").value = shift.anchor;
  updateShiftPreview();
  $("settingsDialog").showModal();
}

async function saveSettings(e) {
  e.preventDefault();
  const config = draftConfig();
  config.custom = config.custom.filter((x) => x.name.trim() || x.amount > 0);
  state.config = config;
  localStorage.setItem(CONFIG_KEY, JSON.stringify(state.config));
  C.clearShiftCache();
  $("settingsDialog").close();
  updatePreview(); renderHistory();
  try {
    const response = await fetch("/api/account/settings", { method: "PUT", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ settings: state.config }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "No se pudo sincronizar la configuración.");
    toast("Configuración guardada y sincronizada");
  } catch (error) {
    toast("Guardada en este dispositivo, pero pendiente de sincronizar: " + (error.message || "sin conexión"));
  }
}

function addCustomExpense() {
  const item = { id: `gasto-${Date.now().toString(36)}`, name: "", amount: 0, period: "month" };
  state.draft.push(item);
  const row = customRow(item);
  $("customList").appendChild(row);
  row.querySelector(".custom-name").focus();
}

// ------------------------------------------------------------------ informes PDF

function availablePeriods(scope) {
  const keys = new Set(state.records.map((r) => String(r.date).slice(0, scope === "month" ? 7 : 4)).filter(Boolean));
  const today = localDate();
  keys.add(today.slice(0, scope === "month" ? 7 : 4));
  return [...keys].sort().reverse();
}

function periodKeyLabel(scope, key) {
  if (scope === "year") return key;
  const [y, m] = key.split("-");
  const label = new Intl.DateTimeFormat("es-ES", { month: "long", year: "numeric" }).format(new Date(Number(y), Number(m) - 1, 1));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function fillPdfPeriods() {
  const scope = state.pdfScope;
  $("pdfPeriodLabel").textContent = scope === "month" ? "Mes" : "Año";
  const select = $("pdfPeriod");
  const current = localDate().slice(0, scope === "month" ? 7 : 4);
  select.innerHTML = availablePeriods(scope).map((key) => `<option value="${key}">${periodKeyLabel(scope, key)}</option>`).join("");
  const cursorKey = localDate(state.cursor).slice(0, scope === "month" ? 7 : 4);
  select.value = [...select.options].some((o) => o.value === cursorKey) ? cursorKey : current;
}

function openPdfDialog() {
  state.pdfScope = state.period === "year" ? "year" : "month";
  $("pdfScopeTabs").querySelectorAll("[data-scope]").forEach((b) => b.classList.toggle("active", b.dataset.scope === state.pdfScope));
  fillPdfPeriods();
  $("pdfMode").value = state.mode;
  $("pdfError").textContent = "";
  $("pdfDialog").showModal();
}

function reportRows(scope, key, mode) {
  const len = scope === "month" ? 7 : 4;
  return state.records
    .filter((r) => r.mode === mode && String(r.date).slice(0, len) === key)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
}

function openPrintableReport(scope, key, mode) {
  const rows = reportRows(scope, key, mode);
  if (!rows.length) return false;
  const owner = mode === "owner";
  const totals = C.aggregate(rows, state.config);
  const title = `MiTaxi-${owner ? "autonomo" : "asalariado"}-${key}`;
  const money = (v) => `${money2(v)} €`;
  const dateLabel = (value) => {
    const d = new Date(`${value}T12:00:00`);
    return Number.isNaN(d.getTime()) ? escapeHtml(value) : new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
  };
  const columns = owner
    ? ["Fecha", "Recaudación", "Efectivo", "Tarjeta", "Apps", "Gasolina", "Otros", "Fijos", "Neto"]
    : ["Fecha", "Recaudación", "Efectivo", "Tarjeta", "Apps", "Gasolina", "%", "Tu parte", "Al jefe"];
  const body = rows.map((r) => {
    const v = C.recordTotals(r, state.config);
    const values = owner
      ? [dateLabel(r.date), money(v.revenue), money(v.cash), money(v.card), money(v.apps), money(v.fuel), money(v.other), money(v.fixed), money(v.net)]
      : [dateLabel(r.date), money(v.revenue), money(v.cash), money(v.card), money(v.apps), money(v.fuel), `${v.percentage}%`, money(v.driver), money(v.delivery)];
    return `<tr>${values.map((x) => `<td>${escapeHtml(x)}</td>`).join("")}</tr>`;
  }).join("");
  const fixed = owner ? `<section><h2>Gastos fijos prorrateados</h2><p>Total gastos fijos: <strong>${money(totals.fixed)}</strong></p><ul>${C.fixedBreakdown(rows, state.config).filter((x) => x.amount >= 0.005).map((x) => `<li>${escapeHtml(x.label)}: ${money(x.amount)}</li>`).join("")}</ul></section>` : "";
  const summary = owner
    ? `<section><h2>Resultado</h2><p>Gastos variables: ${money(totals.fuel + totals.other)}</p><p>Total de gastos: ${money(totals.expenses)}</p><p class="total">Beneficio neto: ${money(totals.net)}</p></section>`
    : `<section><h2>Resultado</h2><p>Tu parte (conductor): ${money(totals.driver)}</p><p>Gasolina pagada por el conductor: ${money(totals.fuel)}</p><p class="total">A entregar al jefe: ${money(totals.delivery)}</p><p>De ello, en efectivo: ${money(totals.balance)}</p></section>`;
  const win = window.open("", "_blank");
  if (!win) throw new Error("El navegador ha bloqueado la ventana del informe. Permite las ventanas emergentes para esta página.");
  win.document.open();
  win.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>
    @page{size:A4 landscape;margin:12mm}*{box-sizing:border-box}body{font:12px Arial,sans-serif;color:#222;margin:0}header{border-bottom:2px solid #222;padding-bottom:12px;margin-bottom:18px}h1{font-size:24px;margin:0 0 6px}h2{font-size:14px;text-transform:uppercase;border-bottom:1px solid #ccc;padding-bottom:5px;margin:20px 0 10px}p{margin:5px 0}.muted{color:#666}.total{font-size:16px;font-weight:bold;margin-top:10px}section{break-inside:avoid}table{width:100%;border-collapse:collapse;font-size:9px;margin-top:10px}th,td{padding:6px 4px;border-bottom:1px solid #ddd;text-align:right;white-space:nowrap}th:first-child,td:first-child{text-align:left}th{background:#eee}tbody tr:nth-child(even){background:#f8f8f8}footer{margin-top:20px;color:#777;font-size:9px}.actions{position:sticky;top:0;background:#fff;padding:10px 0;border-bottom:1px solid #ddd;margin-bottom:15px}button{padding:9px 14px;font-size:14px}@media print{.actions{display:none}}
    </style></head><body><div class="actions"><button onclick="window.print()">Imprimir / Guardar como PDF</button> <span class="muted">En el destino, elige «Guardar como PDF».</span></div><header><h1>MiTaxi Control</h1><div>Informe ${scope === "month" ? "mensual" : "anual"} · ${escapeHtml(periodKeyLabel(scope, key))}</div><p class="muted">${owner ? "Autónomo / Propietario" : "Asalariado"} · ${rows.length} jornadas · Generado el ${escapeHtml(new Intl.DateTimeFormat("es-ES", { dateStyle: "long" }).format(new Date()))}</p></header><section><h2>Recaudación</h2><p>Recaudación total: <strong>${money(totals.revenue)}</strong></p><p>Efectivo: ${money(totals.cash)} · Tarjeta: ${money(totals.card)} · Aplicaciones: ${money(totals.apps)}</p><p>Gasolina: ${money(totals.fuel)}${owner ? ` · Otros gastos variables: ${money(totals.other)}` : ""}</p></section>${fixed}${summary}<section><h2>Detalle de jornadas</h2><table><thead><tr>${columns.map((c) => `<th>${escapeHtml(c)}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table></section><footer>MiTaxi Control · Los gastos fijos se reparten entre las jornadas reales de cada mes.</footer><script>window.addEventListener('load',()=>setTimeout(()=>window.print(),300));</script></body></html>`);
  win.document.close();
  return true;
}

async function generatePdf() {
  const scope = state.pdfScope;
  const key = $("pdfPeriod").value;
  const mode = $("pdfMode").value;
  if (!key) { $("pdfError").textContent = "Elige un periodo."; return; }
  $("pdfError").textContent = "";
  $("pdfDownloadText").textContent = "Preparando…";
  try {
    const rows = reportRows(scope, key, mode);
    if (!rows.length) { $("pdfError").textContent = "No hay jornadas guardadas en ese periodo para ese tipo de conductor."; return; }
    openPrintableReport(scope, key, mode);
    $("pdfDialog").close();
    toast("Informe preparado. En la ventana de impresión, elige Guardar como PDF.");
  } catch (error) {
    console.error("Error al preparar el informe PDF:", error);
    $("pdfError").textContent = error instanceof Error ? error.message : "No se ha podido preparar el informe. Inténtalo de nuevo.";
  } finally {
    $("pdfDownloadText").textContent = "Guardar PDF";
  }
}

// -------------------------------------------------------------------- arranque

document.querySelectorAll("[data-mode]").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));
document.querySelectorAll("[data-period]").forEach((b) => b.addEventListener("click", () => {
  state.period = b.dataset.period; state.cursor = new Date();
  document.querySelectorAll("[data-period]").forEach((x) => x.classList.toggle("active", x === b));
  renderHistory();
}));
formMoneyIds.forEach((id) => $(id).addEventListener("input", updatePreview));
$("date").addEventListener("change", updatePreview);
$("recordForm").addEventListener("submit", submitRecord);
$("cancelEdit").addEventListener("click", resetForm);
$("settingsBtn").addEventListener("click", openSettings);
$("saveSettings").addEventListener("click", saveSettings);
$("addCustom").addEventListener("click", addCustomExpense);
fixedFieldIds.forEach((id) => $(id).addEventListener("input", updateShiftPreview));
$("weekdayPicker").addEventListener("change", updateShiftPreview);
$("weekendMode").addEventListener("change", updateShiftPreview);
$("weekendAnchor").addEventListener("change", updateShiftPreview);
$("prevPeriod").addEventListener("click", () => movePeriod(-1));
$("nextPeriod").addEventListener("click", () => movePeriod(1));
$("pdfBtn").addEventListener("click", () => openPdfDialog());

$("pdfScopeTabs").querySelectorAll("[data-scope]").forEach((b) => b.addEventListener("click", () => {
  state.pdfScope = b.dataset.scope;
  $("pdfScopeTabs").querySelectorAll("[data-scope]").forEach((x) => x.classList.toggle("active", x === b));
  fillPdfPeriods();
}));
$("pdfDownload").addEventListener("click", () => generatePdf(false));

$("pdfShare").hidden = true;
document.querySelectorAll("[data-chart-scope]").forEach(b=>b.addEventListener("click",()=>{state.chartScope=b.dataset.chartScope;renderAnalytics();}));
$("chartPeriod").addEventListener("change",renderAnalytics);
$("recordList").addEventListener("click", (e) => {
  const edit = e.target.closest("[data-edit]");
  const del = e.target.closest("[data-delete]");
  if (edit) editRecord(edit.dataset.edit);
  if (del) removeRecord(del.dataset.delete);
});

resetForm(); setMode("owner"); renderHistory(); pullSettings().then(pullRemote);
