(() => {
  const $ = (id) => document.getElementById(id);
  const gate = $("authGate"), app = $("appShell"), form = $("authForm");
  if (!gate || !app || !form) return;
  let mode = "login", currentUser = null;
  const showError = (message) => { $("authError").textContent = message || ""; };
  function setMode(next) {
    mode = next;
    document.querySelectorAll("[data-auth-mode]").forEach(b => b.classList.toggle("active", b.dataset.authMode === mode));
    $("authTitle").textContent = mode === "login" ? "Tu cuenta, tus jornadas" : "Crea tu cuenta";
    $("authSubmit").textContent = mode === "login" ? "Iniciar sesión" : "Crear cuenta";
    $("authPassword").autocomplete = mode === "login" ? "current-password" : "new-password";
    showError();
  }
  function showApp(user) {
    currentUser = user;
    const oldId = localStorage.getItem("mitaxi-active-account");
    if (oldId !== user.id) {
      localStorage.setItem("mitaxi-active-account", user.id);
      location.reload();
      return;
    }
    gate.hidden = true; app.hidden = false;
    if (!document.getElementById("accountBar")) {
      const bar = document.createElement("div"); bar.id = "accountBar"; bar.className = "account-bar";
      bar.innerHTML = `<span class="account-email">${escapeText(user.email)}</span><button type="button" id="openAccountBtn">Mi cuenta</button><button type="button" id="logoutBtn">Cerrar sesión</button>`;
      app.prepend(bar);
      const accountOverlay = document.createElement("div"); accountOverlay.id = "accountOverlay"; accountOverlay.className = "account-overlay"; accountOverlay.hidden = true;
      accountOverlay.innerHTML = `<section class="account-panel" role="dialog" aria-modal="true" aria-labelledby="accountTitle"><div class="account-head"><div><p class="kicker">PERFIL Y SEGURIDAD</p><h2 id="accountTitle">Mi cuenta</h2><p>Gestiona tus datos de acceso.</p></div><button type="button" id="closeAccountBtn" class="account-close" aria-label="Cerrar mi cuenta">Cerrar ×</button></div><div class="account-details"><p><strong>Correo electrónico</strong><span id="accountEmailValue">${escapeText(user.email)}</span></p><p class="account-detail">El cambio de correo estará disponible cuando añadamos la verificación de la nueva dirección.</p></div><div class="account-security"><h3>Seguridad y privacidad</h3><ul><li>Usa una contraseña única que no utilices en otras páginas.</li><li>No compartas tu contraseña ni códigos de acceso.</li><li>Cierra sesión si utilizas un ordenador compartido.</li></ul><div class="account-links"><a href="/privacidad.html" target="_blank" rel="noopener noreferrer">Política de privacidad</a><a href="/eliminar-datos.html" target="_blank" rel="noopener noreferrer">Información sobre eliminación de datos</a></div></div><form id="changePasswordForm" class="change-password-form"><h3>Cambiar contraseña</h3><label class="auth-label">Contraseña actual<input id="currentPassword" name="currentPassword" type="password" autocomplete="current-password" minlength="10" maxlength="200" required></label><label class="auth-label">Nueva contraseña<input id="newPassword" name="newPassword" type="password" autocomplete="new-password" minlength="10" maxlength="200" required></label><label class="auth-label">Repite la nueva contraseña<input id="confirmPassword" name="confirmPassword" type="password" autocomplete="new-password" minlength="10" maxlength="200" required></label><button type="submit" id="changePasswordBtn" class="account-primary">Guardar nueva contraseña</button><p id="accountMessage" class="account-message" role="status" aria-live="polite"></p></form></section>`;
      app.append(accountOverlay);
      const openAccount = () => { accountOverlay.hidden = false; document.body.classList.add("account-open"); accountOverlay.querySelector("#currentPassword").focus(); };
      const closeAccount = () => { accountOverlay.hidden = true; document.body.classList.remove("account-open"); accountOverlay.querySelector("#changePasswordForm").reset(); accountOverlay.querySelector("#accountMessage").textContent = ""; };
      $("openAccountBtn").addEventListener("click", openAccount);
      accountOverlay.querySelector("#closeAccountBtn").addEventListener("click", closeAccount);
      accountOverlay.addEventListener("click", event => { if (event.target === accountOverlay) closeAccount(); });
      document.addEventListener("keydown", event => { if (event.key === "Escape" && !accountOverlay.hidden) closeAccount(); });
      accountOverlay.querySelector("#changePasswordForm").addEventListener("submit", async event => {
        event.preventDefault();
        const currentPassword = $("currentPassword").value, newPassword = $("newPassword").value, confirmPassword = $("confirmPassword").value;
        const msg = $("accountMessage"), btn = $("changePasswordBtn"); msg.textContent = "";
        if (newPassword.length < 10) { msg.textContent = "La nueva contraseña debe tener al menos 10 caracteres."; return; }
        if (newPassword !== confirmPassword) { msg.textContent = "Las nuevas contraseñas no coinciden."; return; }
        btn.disabled = true; btn.textContent = "Guardando…";
        try {
          const r = await fetch("/api/auth/change-password", {method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({currentPassword,newPassword})});
          const d = await r.json(); if (!r.ok) throw new Error(d.error || "No se pudo cambiar la contraseña.");
          msg.textContent = "Contraseña cambiada correctamente. Por seguridad, vuelve a iniciar sesión en tus otros dispositivos.";
          accountOverlay.querySelector("#changePasswordForm").reset();
        } catch (e) { msg.textContent = e.message; }
        finally { btn.disabled = false; btn.textContent = "Guardar nueva contraseña"; }
      });
      $("logoutBtn").addEventListener("click", async () => {
        await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }).catch(() => {});
        localStorage.removeItem("mitaxi-active-account"); location.reload();
      });
    }
  }
  function escapeText(s) { const el = document.createElement("span"); el.textContent = s; return el.innerHTML; }
  document.querySelectorAll("[data-auth-mode]").forEach(b => b.addEventListener("click", () => setMode(b.dataset.authMode)));
  form.addEventListener("submit", async (e) => {
    e.preventDefault(); showError();
    const email = $("authEmail").value.trim(), password = $("authPassword").value;
    if (mode === "register" && password.length < 10) { showError("La contraseña debe tener al menos 10 caracteres."); return; }
    const button = $("authSubmit"); button.disabled = true; button.textContent = "Un momento…";
    try {
      const response = await fetch(`/api/auth/${mode === "login" ? "login" : "register"}`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se ha podido completar la operación.");
      localStorage.setItem("mitaxi-active-account", data.user.id);
      location.reload();
    } catch (err) { showError(err.message || "No se ha podido conectar con el servidor."); }
    finally { button.disabled = false; button.textContent = mode === "login" ? "Iniciar sesión" : "Crear cuenta"; }
  });
  (async () => {
    try {
      const response = await fetch("/api/auth/me", { credentials: "same-origin", cache: "no-store" });
      const data = await response.json();
      if (data.user) showApp(data.user);
      else { gate.hidden = false; app.hidden = true; localStorage.removeItem("mitaxi-active-account"); }
    } catch { gate.hidden = false; app.hidden = true; showError("No se puede conectar con el servidor. Comprueba que MTaxi Control está iniciado."); }
  })();
})();
