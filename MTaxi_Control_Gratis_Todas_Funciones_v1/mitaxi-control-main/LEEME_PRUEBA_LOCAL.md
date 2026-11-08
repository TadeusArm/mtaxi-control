# Probar MTaxi Control en tu PC (Windows)

## Inicio rápido
1. Descomprime TODO el ZIP en una carpeta normal, por ejemplo `Documentos\MTaxi-Control`.
2. Instala Node.js LTS desde https://nodejs.org/ si aún no lo tienes.
3. Haz doble clic en `INICIAR_MTaxi_LOCAL.bat`.
4. No necesitas instalar paquetes para la prueba local.
5. Se abrirá `http://localhost:3000`.

## Qué puedes probar
- La interfaz original, los cálculos y el historial.
- Crear, editar y eliminar jornadas.
- Informe PDF: pulsa «Guardar PDF» y, en la ventana de impresión que se abre, selecciona «Guardar como PDF» como destino. Si el navegador bloquea la ventana emergente, permite las ventanas emergentes para localhost.
- La API local de prueba, que guarda registros sincronizados en `data/local-records.json`.
- Estado de salud en `http://localhost:3000/healthz`.

## Importante
- Esta es una previsualización LOCAL, no pública; escucha solo en tu propio ordenador.
- Los datos de prueba se guardan en `data/local-records.json`. Haz una copia si quieres conservarlos.
- No uses registros reales ni contraseñas de producción en la prueba.
- No borres `data/local-records.json` si quieres conservar los registros de prueba.
- Para detener el servidor, ve a la ventana negra y pulsa `Ctrl+C`.
- Para volver a iniciarlo, ejecuta de nuevo el `.bat`.
- La prueba local funciona sin descargar dependencias adicionales; Node.js sí debe estar instalado.

## Servidor propio con PostgreSQL
La modalidad de producción se configura mediante `docker-compose.yml`, `.env` y `server.mjs`. Debes configurar una contraseña larga, importar la copia de la base de datos y añadir autenticación real antes de exponer la API a Internet. El identificador de cliente de la app no es autenticación suficiente para datos privados.

## Alcance y seguridad
Esta entrega conserva los archivos originales de interfaz y añade una API Node. No incluye dominio, servidor contratado, secretos ni registros reales de Netlify. La ruta de producción no se debe abrir a Internet hasta implementar autenticación y autorización reales y probar una migración completa.


## Cuentas de usuario
La aplicación ahora requiere iniciar sesión. En la primera visita, selecciona «Crear cuenta» y usa una contraseña de al menos 10 caracteres. Para comprobar que los datos están separados, crea dos cuentas y guarda una jornada con cada una. Consulta `LEEME_CUENTAS_Y_ACCESO.md` para el despliegue.


## Importante si no aparece el inicio de sesión
- No abras `index.html` directamente con doble clic. Debes ejecutar `INICIAR_MTaxi_LOCAL.bat` y entrar en `http://localhost:3000`.
- Cierra otras ventanas de MTaxi Control, detén el servidor anterior con Ctrl+C y vuelve a ejecutar el `.bat`.
- Recarga con Ctrl+F5. Si ya habías instalado la web como aplicación, ciérrala y abre primero `http://localhost:3000` en el navegador para que actualice el service worker.
- Esta versión aumenta la versión de caché e incluye `auth.js` en los archivos del service worker para evitar que quede una interfaz antigua sin acceso.
- La prueba local guarda usuarios y jornadas en archivos de este ordenador. Para que dos dispositivos compartan datos, hay que publicar la aplicación en un servidor con PostgreSQL.
