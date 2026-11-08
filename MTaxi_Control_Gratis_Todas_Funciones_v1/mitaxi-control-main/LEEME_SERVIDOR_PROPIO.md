# MTaxi Control: servidor propio

## Prueba local rápida
Sigue `LEEME_PRUEBA_LOCAL.md` y ejecuta `INICIAR_MTaxi_LOCAL.bat` en Windows.

## Despliegue PostgreSQL con Docker
1. Instala Docker Engine + Docker Compose en el servidor.
2. Copia `.env.example` a `.env` y define `POSTGRES_PASSWORD` con una contraseña larga, única y privada.
3. Ejecuta `docker compose up -d --build`.
4. Verifica logs con `docker compose logs -f app` y estado con `curl http://127.0.0.1:3000/healthz`.
5. Configura Caddy/Nginx con HTTPS y tu dominio cuando lo compres.

## Antes de abrir al público
- Ya incluye registro, inicio/cierre de sesión y autorización de jornadas por cuenta. Las contraseñas se almacenan como hash scrypt y las sesiones usan cookies HttpOnly.
- No incluye los registros reales de Netlify: exporta y comprueba los datos antes de migrar.
- Antes de publicarlo ampliamente, añade verificación de correo, recuperación de contraseña y limitación de intentos; configura HTTPS en el proxy (la cookie de producción requiere HTTPS).
- Exporta y comprueba los datos de Netlify antes de migrar.
- Prueba crear/editar/eliminar registros, sincronización, PDF y modo offline.
- No elimines Netlify hasta confirmar que el nuevo servidor funciona y tiene los datos necesarios.

El diseño y el resto de la interfaz se mantienen. La generación del informe usa la ventana de impresión del navegador para que puedas elegir «Guardar como PDF», sin depender de una biblioteca PDF externa que fallaba al cargar. La nueva API implementa la misma ruta `/api/registros`.
