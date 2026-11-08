# MTaxi Control — versión completamente gratuita

Esta edición elimina los planes Básico/Premium, el límite mensual de jornadas y cualquier integración de cobro.

## Funciones disponibles para todas las cuentas
- Registro, inicio de sesión y cambio de contraseña.
- Datos separados por cuenta de usuario.
- Registro, edición y eliminación de jornadas.
- Cálculo de ingresos, gastos y beneficio.
- Gastos fijos y personalizados.
- Historial por día, semana, mes y año.
- Gráficos y análisis mensuales/anuales.
- Informes PDF.
- Interfaz adaptable a móvil y ordenador.

## Sin pagos
No se utiliza Stripe ni existen endpoints de compra, facturación o suscripciones. No hay comprobaciones de plan en el servidor ni en la interfaz.

## Desarrollo y prueba local
Requisitos: Node.js 22 o posterior.

```bash
npm install
LOCAL_PREVIEW=true npm start
```

Abre `http://127.0.0.1:3000`. En modo local, los usuarios, sesiones y registros se guardan en archivos dentro de `data/`. Este modo sirve para pruebas locales, no para alojar una web pública multiusuario.

## Despliegue público
Para publicar con cuentas y sincronización multiusuario se necesita una base de datos PostgreSQL persistente y variables de entorno seguras. Configura `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` y `PUBLIC_BASE_URL` en el proveedor de alojamiento. Ejecuta los SQL de `postgresql_independiente/` en orden. No publiques archivos `.env` ni expongas la base de datos directamente a Internet.

Los planes gratuitos de alojamiento y base de datos tienen límites y pueden suspender proyectos inactivos. Por tanto, que MTaxi Control no cobre a sus usuarios no garantiza que su infraestructura sea gratuita o ilimitada para el propietario.
