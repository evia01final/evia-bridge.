# Evia Bridge — Cloudflare Worker

API y página web para intercambiar mensajes entre dos dispositivos usando Cloudflare Workers y Durable Objects con SQLite.

## Archivos del repositorio
- `index.js`: Worker HTTP, interfaz web y autenticación por token.
- `storage.js`: Durable Object con almacenamiento SQL persistente.
- `wrangler.toml`: configuración del Worker y migración del Durable Object.

## Configuración y despliegue
1. En Cloudflare Workers, crea o abre el Worker `evia-bridge`.
2. Asegúrate de que el proyecto use Wrangler y que el comando de despliegue se ejecute desde la raíz del repositorio.
3. Configura el secreto `EVIA_BRIDGE_TOKEN` en los ajustes del Worker. Usa un token aleatorio largo y mantenlo privado.
4. Despliega el Worker desde el repositorio o ejecuta `npx wrangler deploy` en un entorno con Wrangler configurado.

El archivo `wrangler.toml` apunta a `index.js`, que es la ubicación real del archivo en este repositorio. El Durable Object `EviaStorage` usa almacenamiento SQLite y está declarado en la migración `v1`.

## Rutas
- `GET /`: interfaz web.
- `GET /health`: estado básico de configuración.
- `POST /send`: envía un mensaje; requiere el header `X-Evia-Token`.
- `GET /messages`: lista los últimos mensajes; requiere el header `X-Evia-Token`.

## Uso
Abre la URL del Worker en ambos teléfonos. Introduce el mismo token secreto en los dos dispositivos y usa nombres diferentes, por ejemplo `iphone` y `samsung`. Los mensajes enviados desde un dispositivo se ocultan de la lista de ese mismo dispositivo.

## Seguridad y límites
- No compartas el token; cualquier persona que lo tenga puede leer mensajes recientes y enviar mensajes.
- El Worker permite solicitudes CORS desde cualquier origen; la API sigue requiriendo el token.
- Se conservan hasta los últimos 100 mensajes para la vista de la API; los registros más antiguos permanecen almacenados actualmente.
- `/health` revela únicamente si existen las configuraciones, no el valor del secreto.
- Este cambio corrige la ruta de entrada y la documentación; no significa que el Worker ya esté desplegado.