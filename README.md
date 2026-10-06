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
- Cuentas de usuario: las crea el administrador o, si se activa, cada usuario se registra solo.
- Diagramas guardados en el servidor (SQLite).
- Exportación de SQL para MySQL, MariaDB, PostgreSQL, SQLite, SQL Server y Oracle, con opciones
  configurables y revisión previa de los problemas (ver [Exportar SQL](#exportar-sql)).
- Exportación a Protobuf (`.proto`) con numeración de campos estable
  (ver [Exportar Protobuf](#exportar-protobuf)).
- Sincronización opcional de cada diagrama con un repositorio Git.
- **No hace peticiones a Internet:** sin telemetría, CDNs ni contenidos incrustados; iconos,
  editor, código fuente y licencias van dentro de la propia instancia. La única excepción es la
  sincronización con Git, si se configura.

## Despliegue rápido

Requisitos: Podman, o Docker Engine, con Compose.

```bash
git clone https://github.com/ElUtku/drawdb-collaborative.git
cd drawdb-collaborative
podman compose up -d --build
podman logs drawdb-collaborative     # muestra el código de instalación
```

Abre <http://127.0.0.1:3000> → **Set up this instance** y crea la cuenta de administrador
con el **código de instalación** que aparece en el registro del servidor
(`Setup code for the administrator account: ...`). Sin ese código nadie puede reclamar la
instancia aunque llegue antes a la URL. También puedes fijarlo de antemano con `SETUP_CODE`.

El archivo `.env` es **opcional**. Sin él, la aplicación arranca con valores seguros por defecto.

## Configuración (opcional)

Si necesitas cambiar algo, copia `.env.example` a `.env` y edítalo antes de arrancar:

| Variable | Por defecto | Cuándo cambiarla |
|---|---|---|
| `SETUP_CODE` | *(generado)* | Para elegir tú el código de instalación (mínimo 8 caracteres) en lugar de leerlo del registro. Deja de usarse en cuanto existe el administrador. |
| `OPEN_REGISTRATION` | `false` | Ponla a `true` para que cualquiera con acceso a la URL pueda crearse una cuenta de usuario normal. Actívala solo si la URL no es accesible para desconocidos. |
| `TRUST_PROXY` | `false` | **Es obligatorio ponerla a `1` si hay un proxy inverso delante.** Si no, todos los usuarios comparten el límite de intentos de login y la cookie no se marca como `Secure`. |
| `ALLOWED_ORIGINS` | *(vacía)* | Solo si el WebSocket rechaza conexiones porque el proxy cambia la cabecera `Host`. Ejemplo: `https://drawdb.example.local` |
| `GIT_SYNC_ENABLED` | `true` | Ponla a `false` para desactivar la sincronización con Git. |
| `GIT_ALLOWED_HOSTS` | *(vacía)* | Recomendada si usas Git: servidores permitidos, separados por comas (admite `*.dominio`). Vacía permite cualquiera, y cualquier usuario podría hacer que el servidor conecte con otros equipos de la red. |
| `GIT_SECRET_KEY` | *(vacía)* | Recomendada si usas Git. Cifra los tokens de acceso; sin ella, la clave de cifrado se guarda en la propia base de datos. Genera una con `openssl rand -hex 32`. |

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

La construcción de la imagen descarga paquetes (npm y Debian), así que hay que hacerla en un
equipo con conexión y llevarla al servidor. `better-sqlite3` se compila desde su código fuente
durante la construcción; no se descarga ningún binario precompilado.

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
y servidor x86), añade `--platform linux/amd64` a `podman build`. Para usar una réplica de la
imagen base o fijarla por digest: `--build-arg NODE_IMAGE=...`.

El contenedor se ejecuta como usuario sin privilegios, con el sistema de archivos de solo
lectura (salvo `/data`), sin *capabilities* y con un *healthcheck*.

## Usuarios y permisos

- La primera cuenta es la de administrador y requiere el código de instalación. Solo puede
  haber uno.
- Después, el administrador crea las cuentas desde el icono de personas de la barra del editor.
  Con `OPEN_REGISTRATION=true`, además, cada persona puede crearse su cuenta desde la pantalla
  de inicio de sesión (máximo 5 registros por hora y por IP). En ambos casos son usuarios normales.
- El panel de administración muestra **todas** las cuentas, incluidas las autorregistradas, con
  su fecha de creación.
- Cada usuario puede cambiar su contraseña desde su avatar → **Cambiar contraseña**. Al hacerlo
  se cierran sus demás sesiones abiertas.
- Las contraseñas **nunca se guardan**: solo se almacena un hash `scrypt` (coste 2^16, sal
  única por usuario). Los hashes de versiones anteriores, más débiles, se actualizan solos la
  próxima vez que su dueño inicia sesión. Las sesiones también se guardan como hash. Ni el
  administrador puede ver contraseñas.
- Los intentos de login fallidos se limitan por usuario y también por dirección IP.
- Quien crea un diagrama es su dueño: lo ve en su lista y es el único que puede borrarlo o
  configurar su sincronización con Git.
- **Cualquier usuario con el enlace de un diagrama puede abrirlo y editarlo.** Comparte los
  enlaces solo con quien deba tener acceso.
- No hay recuperación de contraseña por correo. Si un usuario olvida la suya, el administrador
  le pone una nueva desde el panel (**Restablecer contraseña**) y el usuario la cambia después.
- Si se pierde la cuenta de administrador, se recupera por SQL:
  `UPDATE users SET is_admin = 1 WHERE username = '<usuario>';`

## Exportar SQL

**Archivo → Exportar SQL** genera el DDL del diagrama para su base de datos (o, en un diagrama
genérico, para la que elijas). El diálogo muestra a la izquierda el script y a la derecha:

- **Revisión**: lo que se ha tenido que adaptar u omitir (avisos) y lo que el motor rechazará si
  no se corrige el diagrama (errores), por ejemplo una FK `SET NULL` sobre una columna
  `NOT NULL`, tipos incompatibles entre FK y PK, o rutas de cascada múltiples en SQL Server.
- **Opciones**, cada una con su descripción: qué hacer si los objetos ya existen (`CREATE`,
  `IF NOT EXISTS` o borrar y recrear), FKs dentro de `CREATE TABLE` o con `ALTER TABLE`,
  comentarios, índices, esquema y transacción; y en **Avanzado** nombres de restricciones,
  entrecomillado, orden de tablas, columnas de identidad, motor/juego de caracteres de MySQL,
  separadores `GO` de SQL Server, `BOOLEAN` de Oracle, etc. Las opciones se recuerdan por
  navegador y motor, y son las que se usan también al sincronizar con Git.

El generador escapa todos los nombres y textos (comillas, barras invertidas, saltos de línea),
ordena las tablas por dependencias, nombra las restricciones de forma única y dentro del límite
de longitud de cada motor, y escribe los `DEFAULT`, autoincrementos y claves como cada motor
los acepta. Se ha validado ejecutando los scripts en **MySQL 8.4, MariaDB 10.11,
PostgreSQL 16, SQLite, SQL Server 2022 y Oracle 23**: todos los tipos de datos de cada motor,
nombres con caracteres especiales y palabras reservadas, FKs compuestas, cíclicas y
autorreferenciadas, todas las acciones `ON DELETE`/`ON UPDATE` y todas las combinaciones de
opciones (1.598 scripts; los únicos rechazos son los que el diálogo ya marca como error).

Límites conocidos: las expresiones `CHECK` y los valores por defecto con funciones se copian tal
cual (en un diagrama genérico deben usar funciones que existan en el motor de destino); y con
**Oracle** anterior a 23ai no se pueden usar `JSON`, `VECTOR` ni `BOOLEAN` nativo.

## Exportar Protobuf

**Archivo → Exportar como → Protobuf** convierte cada tabla en un `message` (proto3), los enums
y tipos compuestos en `enum` y `message`, y opcionalmente añade un servicio gRPC CRUD por tabla.
Los `.proto` generados se han validado con `protoc` y compilando en C++ el código generado.

Los **números de campo** son lo que permite leer datos serializados después de cambiar el
esquema. Por eso:

- Pulsa **Guardar la numeración en el diagrama** la primera vez: cada columna guarda su número
  (también editable en los detalles de la columna, «Nº de campo Protobuf»).
- Desde entonces, añadir, mover o borrar columnas no renumera nada. Al borrar una columna, su
  número y su nombre quedan como `reserved` para que nunca se reutilicen.
- Los valores de un enum se numeran por su orden: añade los nuevos siempre al final.

No hace falta un tipo de diagrama distinto para Protobuf: la misma tabla genera el SQL y el
mensaje, y los datos propios de Protobuf (números y reservas) viajan con el diagrama.

## Sincronización con Git

Desde **Archivo → Sync with git**, cada diagrama puede vincularse a un repositorio
(`https://`, `ssh://` o `git@host:ruta`). Al pulsar **Commit and push** se sube un único
commit con dos archivos: `<nombre>.json` (el diagrama) y `<nombre>.sql` (el DDL).
**Pull from repository** sustituye el diagrama por la versión del repositorio para todos
los que lo tengan abierto.

Las credenciales HTTPS se guardan cifradas, nunca se devuelven por la API y se pasan a `git`
por variables de entorno (no por la línea de comandos), limitadas al host del repositorio.
Para SSH, monta la clave y el `known_hosts` en el contenedor. El contenido del repositorio se
trata como no confiable: los enlaces simbólicos se extraen como ficheros normales y no se
ejecutan *hooks*.

## Seguridad

- Cabeceras de seguridad, incluida una *Content Security Policy* que solo permite recursos del
  propio servidor.
- Comprobación de `Origin` en el WebSocket y cookie de sesión `HttpOnly`, `SameSite=Lax` y
  `Secure` detrás de HTTPS.
- Código de instalación para la cuenta de administrador, hashes `scrypt` y límites de intentos.
- Sincronización con Git aislada (ver arriba) y restringible con `GIT_ALLOWED_HOSTS`.
- Sin dependencias con vulnerabilidades conocidas (`npm audit`) en el momento de la revisión.

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
npm test             # tests del servidor, de importación y de exportación SQL/Protobuf
npm run lint
npm run build
```

`npm run test:engines` ejecuta el SQL generado en motores reales a través de sus clientes de
línea de comandos (SQLite siempre; el resto si defines `SQL_PSQL`, `SQL_MYSQL`, `SQL_MARIADB`,
`SQL_SQLCMD` o `SQL_SQLPLUS`; ver `scripts/sql-engines/run.js`). Los tests de Protobuf usan
`protoc` si está instalado.

## Licencias

Este programa es software libre bajo la [GNU AGPL-3.0](LICENSE), heredada de
[drawDB](https://github.com/drawdb-io/drawdb). Puede usarse, modificarse y desplegarse sin
pagar licencias. La condición principal (sección 13) es ofrecer el código fuente a quien use
una versión modificada a través de la red: cada instancia lo sirve en **Ayuda → Código fuente**
(`/source`), incluido el de la versión exacta con la que se construyó la imagen, así que se
cumple también sin Internet. El código de esta versión está en
<https://github.com/ElUtku/drawdb-collaborative>.

Todas las dependencias son software libre con licencias compatibles (MIT, Apache-2.0, BSD, ISC,
MPL-2.0, OFL…); la compilación falla si aparece una que no lo sea, y sus textos de licencia se
publican en **Ayuda → Licencias de terceros** (`/third-party-licenses.txt`). La imagen se basa
en Debian y Node.js (libres). Para construirla y ejecutarla basta con Podman o Docker Engine,
ambos libres; Docker **Desktop** es un producto distinto con licencia de pago para algunas
organizaciones y no es necesario.

Los cambios respecto a las versiones de las que deriva se describen en [NOTICE](NOTICE) y en el
historial de Git.

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
