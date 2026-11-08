import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Carga opcional de .env para instalaciones propias. Las variables ya definidas
// por el sistema/plataforma siempre tienen prioridad. No registrar secretos.
const ENV_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), ".env");
try {
  const envText = fs.readFileSync(ENV_FILE, "utf8");
  for (const line of envText.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || Object.prototype.hasOwnProperty.call(process.env, match[1])) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
} catch (error) { if (error.code !== "ENOENT") throw error; }
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const LOCAL_PREVIEW = process.env.LOCAL_PREVIEW === "true";
const PORT = Number(process.env.PORT || 3000);
const HOST = LOCAL_PREVIEW ? "127.0.0.1" : (process.env.HOST || "0.0.0.0");
const MAX_BODY_BYTES = 1024 * 1024;
const LOCAL_DATA_DIR = path.join(ROOT, "data");
const LOCAL_DATA_FILE = path.join(LOCAL_DATA_DIR, "local-records.json");
const LOCAL_USERS_FILE = path.join(LOCAL_DATA_DIR, "users.json");
const LOCAL_SESSIONS_FILE = path.join(LOCAL_DATA_DIR, "sessions.json");
const SESSION_COOKIE = "mtaxi_session";
const SESSION_DAYS = 14;
const AUTH_ATTEMPTS = new Map();
const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT = 10;

function requestIp(req) {
  // Solo confiar en X-Forwarded-For cuando el despliegue declara un proxy de confianza.
  return process.env.TRUST_PROXY === "true"
    ? String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown").split(",").at(-1).trim()
    : String(req.socket.remoteAddress || "unknown");
}
function rateLimited(req, key, limit = RATE_LIMIT) {
  const now = Date.now();
  // Limpieza oportunista para evitar que peticiones desde muchas IP llenen el Map.
  if (AUTH_ATTEMPTS.size > 5000) {
    for (const [entry, value] of AUTH_ATTEMPTS) if (value.resetAt <= now) AUTH_ATTEMPTS.delete(entry);
  }
  const id = `${requestIp(req)}:${key}`;
  const item = AUTH_ATTEMPTS.get(id);
  if (!item || item.resetAt <= now) { AUTH_ATTEMPTS.set(id, { count: 1, resetAt: now + RATE_WINDOW_MS }); return false; }
  item.count += 1;
  return item.count > limit;
}
function sameOriginRequest(req) {
  const site = req.headers["sec-fetch-site"];
  if (site === "cross-site") return false;
  const origin = req.headers.origin;
  if (!origin) return site === "same-origin" || site === "none" || LOCAL_PREVIEW;
  try {
    const expected = new URL(process.env.PUBLIC_BASE_URL || `http://${req.headers.host || "localhost"}`);
    const actual = new URL(origin);
    return actual.origin === expected.origin || (LOCAL_PREVIEW && actual.hostname === "127.0.0.1");
  } catch { return false; }
}

let pool = null;
if (!LOCAL_PREVIEW) {
  const { Pool } = await import("pg");
  if (!process.env.PGPASSWORD) {
    console.error("Falta PGPASSWORD. Configura el archivo .env antes de iniciar el servidor PostgreSQL.");
    process.exit(1);
  }
  pool = new Pool({
    host: process.env.PGHOST || "127.0.0.1",
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER || "mitaxi",
    password: process.env.PGPASSWORD,
    database: process.env.PGDATABASE || "mitaxi",
    ssl: process.env.PGSSLMODE === "require" ? { rejectUnauthorized: false } : undefined,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });
}
const securityHeaders = {
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Cache-Control": "no-store",
};
const validId = (value) => typeof value === "string" && /^[a-zA-Z0-9-]{8,64}$/.test(value);

function sendJson(res, status, value) {
  res.writeHead(status, { ...securityHeaders, "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(value));
}
async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) { const e = new Error("Cuerpo demasiado grande"); e.status = 413; throw e; }
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { const e = new Error("JSON no válido"); e.status = 400; throw e; }
}
async function loadLocalRecords() {
  try { return JSON.parse(await fs.promises.readFile(LOCAL_DATA_FILE, "utf8")); }
  catch (e) { if (e.code === "ENOENT") return []; throw e; }
}
async function saveLocalRecords(records) {
  await fs.promises.mkdir(LOCAL_DATA_DIR, { recursive: true });
  const temp = LOCAL_DATA_FILE + ".tmp";
  await fs.promises.writeFile(temp, JSON.stringify(records, null, 2), { encoding: "utf8", mode: 0o600 });
  await fs.promises.rename(temp, LOCAL_DATA_FILE);
}
async function readArray(file) { try { const v = JSON.parse(await fs.promises.readFile(file, "utf8")); return Array.isArray(v) ? v : []; } catch (e) { if (e.code === "ENOENT") return []; throw e; } }
async function writeArray(file, value) { await fs.promises.mkdir(LOCAL_DATA_DIR, { recursive: true }); const tmp = file + ".tmp"; await fs.promises.writeFile(tmp, JSON.stringify(value, null, 2), { mode: 0o600 }); await fs.promises.rename(tmp, file); }
function cookieValue(req, name) { const header = req.headers.cookie || ""; for (const part of header.split(";")) { const i = part.indexOf("="); if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim()); } return ""; }
function cookieHeader(token, maxAge = SESSION_DAYS * 86400) { return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${LOCAL_PREVIEW ? "" : "; Secure"}`; }
function hashToken(token) { return crypto.createHash("sha256").update(token).digest("hex"); }
function passwordHash(password, salt = crypto.randomBytes(16).toString("hex")) { return new Promise((resolve, reject) => crypto.scrypt(password, salt, 64, (err, key) => err ? reject(err) : resolve({ salt, hash: key.toString("hex") }))); }
async function findSession(req) {
  const token = cookieValue(req, SESSION_COOKIE); if (!token) return null;
  const digest = hashToken(token);
  if (LOCAL_PREVIEW) {
    const sessions = await readArray(LOCAL_SESSIONS_FILE); const session = sessions.find(x => x.tokenHash === digest && x.expiresAt > Date.now());
    if (!session) return null; const users = await readArray(LOCAL_USERS_FILE); const user = users.find(x => x.id === session.userId);
    return user ? { id: user.id, email: user.email } : null;
  }
  const r = await pool.query(`SELECT u.id, u.email FROM public.mtaxi_sessions s JOIN public.mtaxi_users u ON u.id = s.user_id WHERE s.token_hash=$1 AND s.expires_at > NOW()`, [digest]);
  return r.rows[0] || null;
}
async function authApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/auth/me") { const user = await findSession(req); return sendJson(res, 200, { user: user ? { id: user.id, email: user.email } : null, preview: LOCAL_PREVIEW }); }
  if (req.method === "POST" && ["/api/auth/register", "/api/auth/login"].includes(url.pathname)) {
    if (!sameOriginRequest(req)) return sendJson(res, 403, { error: "Solicitud de origen no permitido." });
    if (rateLimited(req, url.pathname, url.pathname.endsWith("login") ? 8 : 5)) return sendJson(res, 429, { error: "Demasiados intentos. Espera 15 minutos antes de volver a intentarlo." });
    const body = await readJson(req); const email = String(body.email || "").trim().toLowerCase(); const password = String(body.password || "");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return sendJson(res, 400, { error: "Introduce un correo electrónico válido." });
    if (password.length > 200 || (url.pathname.endsWith("register") && password.length < 10)) return sendJson(res, 400, { error: "La contraseña debe tener entre 10 y 200 caracteres." });
    let user;
    if (LOCAL_PREVIEW) {
      const users = await readArray(LOCAL_USERS_FILE); user = users.find(x => x.email === email);
      if (url.pathname.endsWith("register")) { if (user) return sendJson(res, 409, { error: "Ya existe una cuenta con ese correo." }); const ph = await passwordHash(password); user = { id: crypto.randomUUID(), email, ...ph, createdAt: new Date().toISOString() }; users.push(user); await writeArray(LOCAL_USERS_FILE, users); }
      else { if (!user) return sendJson(res, 401, { error: "Correo o contraseña incorrectos." }); const ph = await passwordHash(password, user.salt); if (ph.hash !== user.hash) return sendJson(res, 401, { error: "Correo o contraseña incorrectos." }); }
      const token = crypto.randomBytes(32).toString("hex"), sessions = await readArray(LOCAL_SESSIONS_FILE); sessions.push({ tokenHash: hashToken(token), userId: user.id, expiresAt: Date.now() + SESSION_DAYS * 86400000 }); await writeArray(LOCAL_SESSIONS_FILE, sessions);
      res.setHeader("Set-Cookie", cookieHeader(token)); return sendJson(res, url.pathname.endsWith("register") ? 201 : 200, { user: { id: user.id, email: user.email }, preview: true });
    }
    if (url.pathname.endsWith("register")) {
      const ph = await passwordHash(password);
      try { const r = await pool.query(`INSERT INTO public.mtaxi_users(email,password_salt,password_hash) VALUES($1,$2,$3) RETURNING id,email`, [email,ph.salt,ph.hash]); user = r.rows[0]; }
      catch (e) { if (e.code === "23505") return sendJson(res,409,{error:"Ya existe una cuenta con ese correo."}); throw e; }
    } else {
      const r = await pool.query(`SELECT id,email,password_salt,password_hash FROM public.mtaxi_users WHERE email=$1`, [email]); user = r.rows[0];
      if (!user) { await passwordHash(password); return sendJson(res,401,{error:"Correo o contraseña incorrectos."}); }
      const ph = await passwordHash(password,user.password_salt); if (ph.hash !== user.password_hash) return sendJson(res,401,{error:"Correo o contraseña incorrectos."});
    }
    const token = crypto.randomBytes(32).toString("hex"), expires = new Date(Date.now()+SESSION_DAYS*86400000);
    await pool.query(`INSERT INTO public.mtaxi_sessions(token_hash,user_id,expires_at) VALUES($1,$2,$3)`,[hashToken(token),user.id,expires]);
    res.setHeader("Set-Cookie",cookieHeader(token)); return sendJson(res,url.pathname.endsWith("register")?201:200,{user:{id:user.id,email:user.email},preview:false});
  }
  if (req.method === "POST" && url.pathname === "/api/auth/change-password") {
    if (!sameOriginRequest(req)) return sendJson(res, 403, { error: "Solicitud de origen no permitido." });
    const user = await findSession(req);
    if (!user) return sendJson(res, 401, { error: "Tu sesión ha caducado. Inicia sesión de nuevo." });
    const body = await readJson(req);
    const currentPassword = String(body.currentPassword || "");
    const newPassword = String(body.newPassword || "");
    if (newPassword.length < 10 || newPassword.length > 200) return sendJson(res, 400, { error: "La nueva contraseña debe tener entre 10 y 200 caracteres." });
    if (currentPassword === newPassword) return sendJson(res, 400, { error: "La nueva contraseña debe ser diferente de la actual." });
    const currentToken = cookieValue(req, SESSION_COOKIE);
    if (LOCAL_PREVIEW) {
      const users = await readArray(LOCAL_USERS_FILE); const index = users.findIndex(x => x.id === user.id);
      if (index < 0) return sendJson(res, 401, { error: "No se encuentra la cuenta." });
      const check = await passwordHash(currentPassword, users[index].salt);
      if (check.hash !== users[index].hash) return sendJson(res, 400, { error: "La contraseña actual no es correcta." });
      const next = await passwordHash(newPassword); users[index] = { ...users[index], ...next }; await writeArray(LOCAL_USERS_FILE, users);
      const sessions = await readArray(LOCAL_SESSIONS_FILE); await writeArray(LOCAL_SESSIONS_FILE, sessions.filter(x => x.userId !== user.id || x.tokenHash === hashToken(currentToken)));
    } else {
      const result = await pool.query(`SELECT password_salt,password_hash FROM public.mtaxi_users WHERE id=$1`, [user.id]);
      const row = result.rows[0]; if (!row) return sendJson(res, 401, { error: "No se encuentra la cuenta." });
      const check = await passwordHash(currentPassword, row.password_salt);
      if (check.hash !== row.password_hash) return sendJson(res, 400, { error: "La contraseña actual no es correcta." });
      const next = await passwordHash(newPassword);
      await pool.query(`UPDATE public.mtaxi_users SET password_salt=$2,password_hash=$3 WHERE id=$1`, [user.id,next.salt,next.hash]);
      await pool.query(`DELETE FROM public.mtaxi_sessions WHERE user_id=$1 AND token_hash<>$2`, [user.id,hashToken(currentToken)]);
    }
    return sendJson(res, 200, { ok: true });
  }
  if (req.method === "POST" && url.pathname === "/api/auth/logout") {
    if (!sameOriginRequest(req)) return sendJson(res, 403, { error: "Solicitud de origen no permitido." });
    const token = cookieValue(req,SESSION_COOKIE); if (token) { if (LOCAL_PREVIEW) await writeArray(LOCAL_SESSIONS_FILE,(await readArray(LOCAL_SESSIONS_FILE)).filter(x=>x.tokenHash!==hashToken(token))); else await pool.query("DELETE FROM public.mtaxi_sessions WHERE token_hash=$1",[hashToken(token)]); }
    res.setHeader("Set-Cookie",cookieHeader("",0)); return sendJson(res,200,{ok:true});
  }
  return sendJson(res,404,{error:"Ruta de autenticación no encontrada."});
}
async function accountSettingsApi(req, res, url) {
  const user = await findSession(req);
  if (!user) return sendJson(res, 401, { error: "Inicia sesión primero." });
  if (url.pathname !== "/api/account/settings") return sendJson(res, 404, { error: "Ruta de cuenta no encontrada." });
  if (req.method === "GET") {
    if (LOCAL_PREVIEW) {
      const users = await readArray(LOCAL_USERS_FILE);
      const current = users.find(x => x.id === user.id);
      return sendJson(res, 200, { settings: current?.settings || null });
    }
    const result = await pool.query("SELECT settings FROM public.mtaxi_users WHERE id=$1", [user.id]);
    return sendJson(res, 200, { settings: result.rows[0]?.settings || null });
  }
  if (req.method === "PUT") {
    if (!sameOriginRequest(req)) return sendJson(res, 403, { error: "Solicitud de origen no permitido." });
    const body = await readJson(req);
    if (!body.settings || typeof body.settings !== "object" || Array.isArray(body.settings) || JSON.stringify(body.settings).length > 20000) {
      return sendJson(res, 400, { error: "Configuración no válida." });
    }
    const settings = body.settings;
    if (!Array.isArray(settings.weekdays || settings.shift?.weekdays || []) || !Array.isArray(settings.custom || [])) {
      return sendJson(res, 400, { error: "Configuración de jornadas no válida." });
    }
    if (LOCAL_PREVIEW) {
      const users = await readArray(LOCAL_USERS_FILE); const index = users.findIndex(x => x.id === user.id);
      if (index < 0) return sendJson(res, 404, { error: "No se encuentra la cuenta." });
      users[index] = { ...users[index], settings };
      await writeArray(LOCAL_USERS_FILE, users);
    } else {
      await pool.query("UPDATE public.mtaxi_users SET settings=$2::jsonb WHERE id=$1", [user.id, JSON.stringify(settings)]);
    }
    return sendJson(res, 200, { ok: true });
  }
  res.setHeader("Allow", "GET, PUT");
  return sendJson(res, 405, { error: "Método no permitido." });
}


async function handleApi(req, res, url) {
  const user = await findSession(req);
  if (!user) return sendJson(res, 401, { error: "Inicia sesión para acceder a tus jornadas." });
  const clientId = user.id;

  if (req.method === "GET") {
    if (LOCAL_PREVIEW) {
      const all = await loadLocalRecords();
      return sendJson(res, 200, all.filter((r) => r.clientId === clientId).map((r) => r.payload));
    }
    const result = await pool.query("SELECT payload FROM public.taxi_records WHERE client_id = $1 ORDER BY updated_at ASC", [clientId]);
    return sendJson(res, 200, result.rows.map((row) => row.payload));
  }
  if (req.method === "PUT") {
    if (!sameOriginRequest(req)) return sendJson(res, 403, { error: "Solicitud de origen no permitido." });
    const payload = await readJson(req);
    if (!payload || !validId(payload.id) || !/^\d{4}-\d{2}-\d{2}$/.test(payload.date || "")) {
      return sendJson(res, 400, { error: "Registro no válido" });
    }
    if (LOCAL_PREVIEW) {
      const all = await loadLocalRecords();
      const idx = all.findIndex((r) => r.clientId === clientId && r.recordId === payload.id);
      const now = new Date().toISOString();
      const item = { clientId, recordId: payload.id, payload, createdAt: idx >= 0 ? (all[idx].createdAt || all[idx].updatedAt || now) : now, updatedAt: now };
      if (idx >= 0) all[idx] = item; else all.push(item);
      await saveLocalRecords(all);
      return sendJson(res, 200, { ok: true, preview: true });
    }
    const dbClient = await pool.connect();
    try {
      await dbClient.query("BEGIN");
      await dbClient.query(
        `INSERT INTO public.taxi_records (client_id, record_id, payload, created_at, updated_at)
         VALUES ($1, $2, $3::jsonb, NOW(), NOW())
         ON CONFLICT (client_id, record_id)
         DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()`,
        [clientId, payload.id, JSON.stringify(payload)]
      );
      await dbClient.query("COMMIT");
    } catch (error) { await dbClient.query("ROLLBACK"); throw error; }
    finally { dbClient.release(); }
    return sendJson(res, 200, { ok: true });
  }
  if (req.method === "DELETE") {
    if (!sameOriginRequest(req)) return sendJson(res, 403, { error: "Solicitud de origen no permitido." });
    const recordId = url.searchParams.get("id");
    if (!validId(recordId)) return sendJson(res, 400, { error: "Registro no válido" });
    if (LOCAL_PREVIEW) {
      const all = await loadLocalRecords();
      await saveLocalRecords(all.filter((r) => !(r.clientId === clientId && r.recordId === recordId)));
      return sendJson(res, 200, { ok: true, preview: true });
    }
    await pool.query("DELETE FROM public.taxi_records WHERE client_id = $1 AND record_id = $2", [clientId, recordId]);
    return sendJson(res, 200, { ok: true });
  }
  res.setHeader("Allow", "GET, PUT, DELETE");
  return sendJson(res, 405, { error: "Método no permitido" });
}
const mimeTypes = {
  ".html":"text/html; charset=utf-8",".css":"text/css; charset=utf-8",".js":"text/javascript; charset=utf-8",
  ".mjs":"text/javascript; charset=utf-8",".json":"application/json; charset=utf-8",
  ".webmanifest":"application/manifest+json; charset=utf-8",".svg":"image/svg+xml",".png":"image/png",
  ".jpg":"image/jpeg",".jpeg":"image/jpeg",".ico":"image/x-icon",".pdf":"application/pdf",".txt":"text/plain; charset=utf-8"
};
async function serveStatic(req, res, url) {
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { res.writeHead(400, securityHeaders).end("Solicitud no válida"); return; }
  if (pathname === "/privacidad") pathname = "/privacidad.html";
  if (pathname === "/eliminar-datos") pathname = "/eliminar-datos.html";
  if (pathname === "/") pathname = "/index.html";
  const target = path.resolve(ROOT, "." + pathname);
  if (!(target.startsWith(ROOT + path.sep)) || pathname.split("/").some(part => part.startsWith(".")) ||
      /\.(env|sql|md|ts|lock|ya?ml|toml|conf|pem|key|crt)$/i.test(pathname) ||
      /(^|\/)(data|db|postgresql_independiente|netlify|node_modules)(\/|$)/i.test(pathname) ||
      ["server.mjs", "package.json", "Dockerfile", "Caddyfile", "drizzle.config.ts"].includes(path.basename(pathname))) {
    res.writeHead(404, securityHeaders).end("No encontrado"); return;
  }
  try {
    const realTarget = await fs.promises.realpath(target);
    if (!realTarget.startsWith(await fs.promises.realpath(ROOT) + path.sep)) { res.writeHead(404, securityHeaders).end("No encontrado"); return; }
    const stat = await fs.promises.stat(realTarget);
    if (!stat.isFile()) throw new Error("not file");
    const headers = { ...securityHeaders, "Content-Type": mimeTypes[path.extname(target).toLowerCase()] || "application/octet-stream" };
    if (["/", "/index.html", "/auth.js", "/app.js", "/calc.js", "/sw.js", "/manifest.webmanifest"].includes(pathname)) headers["Cache-Control"] = "no-cache, no-store, must-revalidate";
    if (pathname.startsWith("/icons/")) headers["Cache-Control"] = "public, max-age=31536000, immutable";
    res.writeHead(200, headers);
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(realTarget).pipe(res);
  } catch { res.writeHead(404, { ...securityHeaders, "Content-Type": "text/plain; charset=utf-8" }).end("No encontrado"); }
}
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    if (url.pathname === "/healthz") {
      if (LOCAL_PREVIEW) return sendJson(res, 200, { ok: true, mode: "local-preview", storage: "json-file" });
      await pool.query("SELECT 1");
      return sendJson(res, 200, { ok: true, database: true });
    }
    if (url.pathname.startsWith("/api/auth/")) return await authApi(req, res, url);
    if (url.pathname.startsWith("/api/account/")) return await accountSettingsApi(req,res,url);
    if (url.pathname === "/api/registros") return await handleApi(req, res, url);
    if (!["GET", "HEAD"].includes(req.method || "GET")) { res.writeHead(405, { ...securityHeaders, Allow: "GET, HEAD" }).end("Método no permitido"); return; }
    return await serveStatic(req, res, url);
  } catch (error) {
    console.error("Error de solicitud:", error?.message || error);
    if (!res.headersSent) sendJson(res, Number(error?.status) || 500, { error: Number(error?.status) ? error.message : "Error interno del servidor" });
    else res.destroy();
  }
});
server.listen(PORT, HOST, () => {
  console.log(`MTaxi Control escuchando en http://${HOST}:${PORT}${LOCAL_PREVIEW ? " (PREVISUALIZACIÓN LOCAL: datos en data/local-records.json)" : ""}`);
});
async function shutdown() {
  server.close(async () => { if (pool) await pool.end(); process.exit(0); });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
