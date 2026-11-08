// Endpoint deshabilitado intencionadamente: esta función antigua aceptaba un
// clientId enviado por el navegador sin autenticar la sesión y exponía datos.
// MTaxi Control debe desplegarse con server.mjs, que valida la cookie de sesión.
export default async () => Response.json(
  { error: "Este endpoint está deshabilitado. Despliega MTaxi Control con el servidor autenticado." },
  { status: 410, headers: { "Cache-Control": "no-store" } },
);
