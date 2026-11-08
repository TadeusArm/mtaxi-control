# Cuentas de usuario en MTaxi Control

Esta versión añade creación de cuenta, inicio/cierre de sesión y separación de jornadas por cuenta.

## Prueba local
1. Descomprime todo el ZIP.
2. Ejecuta `INICIAR_MTaxi_LOCAL.bat`.
3. Abre `http://localhost:3000` y crea una cuenta con un correo válido y una contraseña de al menos 10 caracteres.
4. Guarda una jornada, cierra sesión y vuelve a entrar. Las jornadas deben seguir en esa cuenta.
5. Puedes crear otra cuenta para comprobar que no ve las jornadas de la primera.

Las cuentas y sesiones de la previsualización se guardan en `data/users.json` y `data/sessions.json`; las jornadas, en `data/local-records.json`. Son archivos de prueba local, no se sincronizan con Netlify ni con otros equipos.

## Para publicarla en tu servidor
1. Configura PostgreSQL y el archivo `.env` a partir de `.env.example`.
2. Ejecuta `psql "$DATABASE_URL" -f postgresql_independiente/01_crear_esquema.sql` (o importa el SQL desde tu herramienta de PostgreSQL).
3. Instala dependencias con `npm install` y arranca con `npm start`.
4. Publica detrás de HTTPS (por ejemplo, Nginx/Caddy con certificado TLS). En producción la cookie de sesión requiere HTTPS.
5. Haz una prueba de alta, login, logout y aislamiento de datos con dos cuentas antes de abrir el registro al público.

## Seguridad y limitaciones
- Las contraseñas se procesan con scrypt y salt aleatorio; no se guardan en texto plano.
- Las sesiones se guardan como hashes de tokens aleatorios, con cookie HttpOnly y vencimiento a los 14 días.
- Este es un acceso básico, no un sistema empresarial completo: antes de un lanzamiento público conviene añadir verificación de correo, recuperación de contraseña, limitación de intentos, monitorización y política de privacidad revisada.
- No uses el modo `LOCAL_PREVIEW=true` para alojar la web en Internet.
- Las cuentas nuevas no importan automáticamente los registros antiguos de Netlify; la migración de datos debe hacerse por separado y verificarse.
