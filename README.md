# Evia Bridge — Cloudflare Worker

## Archivos
- `src/index.js`: API y página web para los dos teléfonos.
- `src/storage.js`: almacenamiento persistente SQLite con Durable Objects.
- `wrangler.toml`: binding y migración del Durable Object.

## Importante
Este paquete no está desplegado por sí mismo. Para instalarlo se necesita que Cloudflare despliegue los tres archivos juntos y que el secreto `EVIA_BRIDGE_TOKEN` se configure en Settings > Variables and Secrets.

Después de desplegar:
- `/health` muestra el estado de configuración.
- `/` abre la interfaz web.
- `POST /send` y `GET /messages` requieren el header `X-Evia-Token`.

En la interfaz de cada teléfono, usa el mismo token y nombres de dispositivo distintos, por ejemplo `iphone` y `samsung`.
