<div align="center">
  <img width="64" alt="drawDB" src="./src/assets/icon-dark.png">
  <h1>drawDB Collaborative</h1>
  <p>Editor de diagramas de bases de datos, autoalojado y colaborativo en tiempo real.</p>
  <img width="700" alt="Captura de drawDB" src="drawdb.png">
</div>

## Qué es

Fork de [drawDB](https://github.com/drawdb-io/drawdb) basado en
[artempas/drawdb-collaborative-with-auth](https://github.com/artempas/drawdb-collaborative-with-auth),
preparado para autoalojarse, incluso en servidores sin Internet.

- Varios usuarios editando el mismo diagrama a la vez, con cursores y nombres.
- Cuentas de usuario gestionadas por un administrador. No hay registro libre.
- Diagramas guardados en el servidor (SQLite).
- Importación y exportación de SQL (MySQL, PostgreSQL, SQLite, MariaDB, SQL Server, Oracle).
- Sincronización opcional de cada diagrama con un repositorio Git.
- **No hace peticiones a Internet:** sin telemetría ni CDNs; iconos y editor van empaquetados.
  La única excepción es la sincronización con Git, si se configura.

## Despliegue rápido

Requisitos: Podman o Docker con Compose.

```bash
git clone https://github.com/ElUtku/drawdb-collaborative.git
cd drawdb-collaborative
podman compose up -d --build
```

Abre <http://127.0.0.1:3000> y **registra la primera cuenta enseguida**: será la de
administrador. Mientras no exista, cualquiera con acceso a la URL podría reclamarla.

El archivo `.env` es **opcional**. Sin él, la aplicación arranca con valores seguros por defecto.

## Configuración (opcional)

Si necesitas cambiar algo, copia `.env.example` a `.env` y edítalo antes de arrancar:

| Variable | Por defecto | Cuándo cambiarla |
|---|---|---|
| `TRUST_PROXY` | `false` | **Es obligatorio ponerla a `1` si hay un proxy inverso delante.** Si no, todos los usuarios comparten el límite de intentos de login y la cookie no se marca como `Secure`. |
| `GIT_SECRET_KEY` | *(vacía)* | Recomendada si usas la sincronización con Git. Cifra los tokens de acceso; sin ella, la clave de cifrado se guarda en la propia base de datos. Genera una con `openssl rand -hex 32`. |
| `ALLOWED_ORIGINS` | *(vacía)* | Solo si el WebSocket rechaza conexiones porque el proxy cambia la cabecera `Host`. Ejemplo: `https://drawdb.example.local` |

Después de cambiar el `.env`, ejecuta `podman compose up -d` para aplicarlo.

## Acceso desde otros equipos

El contenedor solo escucha en `127.0.0.1:3000`. Para acceder desde otros equipos hay dos opciones.

**Con proxy inverso y HTTPS (recomendado).** Pon `TRUST_PROXY=1` en `.env`. El proxy debe
reenviar el WebSocket (`/ws/...`) y conservar la cabecera `Host`.

Caddy:

```
drawdb.example.local {
    tls internal
    reverse_proxy 127.0.0.1:3000
}
```

nginx:

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
```

**Sin proxy (solo en una red de confianza).** En `compose.yml` cambia el puerto a
`"3000:3000"` y deja `TRUST_PROXY=false`. Las contraseñas viajarán sin cifrar.

## Servidor sin Internet

La construcción de la imagen descarga paquetes, así que hay que hacerla en un equipo con
conexión y llevarla al servidor:

```bash
# En el equipo con Internet
podman build -t drawdb-collaborative .
podman save -o drawdb-collaborative.tar drawdb-collaborative

# Copia drawdb-collaborative.tar y compose.yml al servidor (y .env si lo usas)

# En el servidor
podman load -i drawdb-collaborative.tar
podman compose up -d
```

Si el equipo de compilación y el servidor tienen distinta arquitectura (por ejemplo, Mac ARM
y servidor x86), añade `--platform linux/amd64` a `podman build`.

## Usuarios y permisos

- La primera cuenta registrada es la de administrador. Después, el registro queda cerrado y
  el administrador crea las cuentas desde el icono de personas de la barra del editor.
- Quien crea un diagrama es su dueño: lo ve en su lista y es el único que puede borrarlo o
  configurar su sincronización con Git.
- **Cualquier usuario con el enlace de un diagrama puede abrirlo y editarlo.** Comparte los
  enlaces solo con quien deba tener acceso.
- Si se pierde la cuenta de administrador, se recupera por SQL:
  `UPDATE users SET is_admin = 1 WHERE username = '<usuario>';`

## Sincronización con Git

Desde **Archivo (File) → Sync with git**, cada diagrama puede vincularse a un repositorio
(`https://`, `ssh://` o `git@host:ruta`). Al pulsar **Commit and push** se sube un único
commit con dos archivos: `<nombre>.json` (el diagrama) y `<nombre>.sql` (el DDL).
**Pull from repository** sustituye el diagrama por la versión del repositorio para todos
los que lo tengan abierto.

Las credenciales HTTPS se guardan cifradas y nunca se devuelven por la API. Para SSH, monta
la clave en el contenedor.

## Mantenimiento

```bash
podman logs -f drawdb-collaborative     # ver registros
podman compose down                     # parar
podman compose up -d --build            # actualizar tras un git pull
podman volume inspect drawdb-collaborative_drawdb-data   # ubicación de los datos
```

**Copias de seguridad:** copia el contenido del volumen (`drawdb.sqlite` y la carpeta `git/`).
Contiene todos los diagramas, los usuarios y los tokens cifrados.

## Desarrollo local

```bash
npm install
npm run dev          # servidor API + Vite con recarga en caliente
npm run test:server  # tests
npm run build
```

## Cambios respecto al fork de artempas

- Eliminados Vercel Analytics, el contador de estrellas de GitHub y la página de reporte de
  errores, que enviaba datos a un servidor externo.
- Iconos y editor Monaco empaquetados en lugar de cargarse desde jsDelivr y cdnjs.
- `trust proxy` configurable (`TRUST_PROXY`) para evitar que se falsee la IP en el login.
- Cabeceras de seguridad y comprobación de `Origin` en el WebSocket.
- Dependencias actualizadas (`npm audit fix`).
- Página no indexable por buscadores.

## Descargo de responsabilidad

Este software se ofrece **"tal cual", sin garantía de ningún tipo**, expresa o implícita,
incluidas las de comerciabilidad, idoneidad para un fin concreto, seguridad o ausencia de
errores. El autor de este fork **no ofrece soporte ni mantenimiento**, no se compromete a
corregir fallos ni vulnerabilidades y **no se hace responsable** de ningún daño, pérdida de
datos, incidente de seguridad o cualquier otra consecuencia derivada de su uso o de la
imposibilidad de usarlo.

Quien lo despliegue lo hace bajo su propia responsabilidad y debe revisar el código, la
configuración y la seguridad antes de usarlo, y mantener sus propias copias de seguridad.
Las secciones 15 y 16 de la [licencia AGPL-3.0](LICENSE) recogen estas mismas exclusiones.

## Licencia

[AGPL-3.0](LICENSE), heredada de [drawDB](https://github.com/drawdb-io/drawdb). Si ofreces
una versión modificada a otras personas por red, tienen derecho a obtener su código fuente
(sección 13). El código de esta versión está en <https://github.com/ElUtku/drawdb-collaborative>.
