# Desarrollo personal de T3 Code

Fork: <https://github.com/GuillermoMGV/t3code>. Base oficial: <https://github.com/pingdotgg/t3code>.
Checkout: `C:\Users\Guille\Documents\Other Projects\t3code`.

## Ciclo rápido: cambiar algo y usarlo

Todo desde PowerShell en la raíz del repo. Cada paso está detallado en su sección.

```powershell
# 0. (Opcional) Traer novedades oficiales a custom
./docs/personal/sync-upstream.ps1

# 1. Cambiar el código en custom
git switch custom

# 2. Probar en desarrollo (datos aislados en .t3). Ctrl+C para salir.
. ./docs/personal/custom-env.ps1
vp run dev --home-dir .t3 --no-seed

# 3. Comprobar, confirmar y subir
vp run check:changed
git add <archivos-revisados>
git commit -m 'feat: describe el cambio'
git push origin custom

# 4. Compilar, verificar e instalar en este equipo (árbol limpio, dev cerrado). ~8 min.
./docs/personal/build-and-install.ps1
```

## Para agentes de IA

Lee esta sección antes de compilar, instalar, sincronizar o hacer commits en este repo. Las normas de código del proyecto están en `AGENTS.md`.

Para implementar cualquier funcionalidad o cambio, sigue la skill [`fork-feature`](.agents/skills/fork-feature/SKILL.md): recoge el flujo completo (estudiar, planificar, implementar sin romper futuras sincronizaciones, probar, verificar en la app, documentar, comprobar, subir e instalar) y los errores típicos de lint y Effect ya resueltos. En Windows el enlace `.claude/skills` no funciona como symlink, así que ábrela directamente.

Reglas:

- Trabaja en `custom` (o en una rama creada desde `custom`). Nunca hagas commits en `main`: es una copia exacta de `upstream/main`.
- Sube solo a `origin` (`GuillermoMGV/t3code`). El push a `upstream` está bloqueado (`DISABLED`); no lo desbloquees ni abras PRs contra `pingdotgg/t3code`.
- Sin `--force`, `reset --hard` ni reescritura de historia sin permiso explícito del usuario. Integra el oficial con merge, no con rebase.
- En los conflictos de sincronización, conserva la intención de ambos lados; no elijas ours/theirs en bloque. Los archivos propios del fork son `CUSTOM_DEVELOPMENT.md`, `docs/personal/*`, `.agents/skills/fork-feature/`, el bloque inicial de `AGENTS.md` y lo que lista «Personalizaciones del fork».
- No pongas en Git `.t3/`, `release/`, `.env`, tokens ni URLs de emparejamiento (llevan credenciales).
- En desarrollo usa siempre `--home-dir .t3`. Nunca apuntes un servidor de desarrollo a `~/.t3/userdata`: son los datos reales de la app instalada.

Si `git remote -v` no muestra `origin` y `upstream` como arriba (por ejemplo, en un clon nuevo), ejecuta `./docs/personal/setup-local-git.ps1`.

Cada terminal PowerShell nueva necesita el entorno antes de `vp`, `node`, `pnpm` o `cargo`:

```powershell
. ./docs/personal/custom-env.ps1
```

| Tarea                              | Comando                                               | Duración aprox. |
| ---------------------------------- | ----------------------------------------------------- | --------------- |
| Instalar dependencias              | `vp i --frozen-lockfile`                              | 4 min (en frío) |
| Comprobaciones de lo cambiado      | `vp run check:changed`                                | < 1 min         |
| Typecheck de todo el monorepo      | `vp run typecheck`                                    | 3-5 min         |
| Desarrollo web (servidor + Vite)   | `vp run dev --home-dir .t3 --no-seed`                 | continuo        |
| Desarrollo escritorio (Electron)   | `vp run dev:desktop --home-dir .t3 --no-seed`         | continuo        |
| URL de emparejamiento de dev       | ver «Entorno y arranque»                              | segundos        |
| Solo compilar el instalador        | `./docs/personal/build-windows.ps1 -BuildVersion <v>` | 6-8 min         |
| Compilar e instalar en este equipo | `./docs/personal/build-and-install.ps1`               | 7-9 min         |
| Traer novedades oficiales a custom | `./docs/personal/sync-upstream.ps1`                   | 1-5 min         |

Trucos que ahorran tiempo:

- Los scripts de `docs/personal/` ya activan el entorno; se ejecutan directamente.
- `build-windows.ps1` y `build-and-install.ps1` exigen el árbol limpio: confirma los cambios antes. Detén el servidor de desarrollo antes de compilar.
- Lanza dev y los builds en segundo plano y vigila su salida. Con la salida redirigida, `vp run` oculta la de las tareas hijas: la URL de emparejamiento no aparece y hay que generarla con el comando `pair`.
- Las comprobaciones de UI se hacen en el navegador: el proveedor `Replay (dev)` hace turnos completos sin coste ni cambios reales en archivos.
- Para no esperar al typecheck completo, `vp run check:changed` cubre los paquetes afectados por tus cambios.
- Windows PowerShell 5.1 descarta los argumentos vacíos (`''`) y rompe las comillas dobles internas al llamar a programas nativos; usa `--%` o evita esas comillas.
- No digas que algo funciona sin haberlo ejecutado. Para cambios de interfaz, comprueba la app real.

## Scripts del fork

| Script                                  | Qué hace                                                                                        |
| --------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `docs/personal/custom-env.ps1`          | Activa Vite+, Node y pnpm del `package.json` y Cargo en la terminal actual (dot-source).        |
| `docs/personal/setup-local-git.ps1`     | Recrea remotos, bloqueo de push, identidad y credenciales de `GuillermoMGV`. Idempotente.       |
| `docs/personal/sync-upstream.ps1`       | Actualiza `main` desde el oficial y la integra en `custom`. Se detiene ante cualquier problema. |
| `docs/personal/build-windows.ps1`       | Compila el instalador Windows y lo verifica como el release oficial. No instala.                |
| `docs/personal/build-and-install.ps1`   | `build-windows.ps1` + cierra la app, copia los datos e instala. Versión automática.             |
| `docs/personal/mock-issue-trackers.mjs` | APIs de Linear y Jira simuladas para probar la integración sin credenciales reales (ver abajo). |

## Personalizaciones del fork

Funciones propias de este fork. Cada una vive sobre todo en archivos nuevos; la tabla «Toca» lista las líneas añadidas en archivos oficiales, que son los únicos puntos donde una sincronización puede dar conflicto. Al resolverlo, conserva el cambio oficial y vuelve a añadir la línea del fork.

### Tickets de Linear y Jira en el panel del hilo

Qué hace: el panel de detalles del hilo (icono arriba a la derecha) muestra el ticket de Linear y el de Jira asociados al hilo, cada uno con título, clave, **estado con su color y asignado**. Se actualizan cada minuto mientras el panel está abierto. Solo aparece la fila de un gestor si está conectado o si el hilo menciona uno de sus tickets; sin ninguno conectado, la fila «Connect Linear or Jira» lleva a Ajustes.

- **Conectar:** Ajustes → Connections → **Issue trackers**. Linear pide una personal API key (Linear → Settings → Security & access → Personal API keys). Jira pide el sitio (`tu-equipo.atlassian.net`), el email de la cuenta de Atlassian y un API token **sin scopes** (<https://id.atlassian.com/manage-profile/security/api-tokens>). Las credenciales se validan contra el gestor antes de guardarlas en `userdata/secrets/` (`linear-api-key.bin`, `jira-credentials.bin`). La página muestra la cuenta conectada y permite desconectar.
- **Vincular automáticamente:** si un mensaje tuyo del hilo contiene una URL `https://linear.app/<workspace>/issue/ABC-123/...` o `https://<sitio>.atlassian.net/browse/ABC-123` (también `?selectedIssue=ABC-123` de los tableros), el ticket aparece solo.
- **Vincular a mano:** «Link Linear issue» / «Link Jira issue» abre un buscador que busca **mientras escribes** (espera 500 ms, `ISSUE_SEARCH_DEBOUNCE_MS` en `issueTrackerRows.logic.ts`). Sin texto muestra tus tickets abiertos. Un clic en un resultado lo vincula; con el teclado, ↑/↓ mueve el resaltado y Enter vincula. Una URL o clave pegada se vincula con Enter sin esperar a la búsqueda.
- **Menú ⋯:** abrir en el gestor, copiar enlace, cambiar de ticket, refrescar, desvincular (también oculta los tickets detectados en el hilo) e ir a sus ajustes.
- **Listado de hilos:** cada hilo con ticket muestra, a la derecha de su rama, una insignia con el estado (con su color) y otra con el asignado (nombre de pila); al pasar el ratón se ve la clave, el título y el nombre completo. Si un hilo tiene ticket de Linear y de Jira, muestra el de Linear. El listado hace una sola petición para todos los hilos (`issueTrackers.getThreadSummaries`) cada minuto y el servidor guarda cada ticket en caché un minuto. Un ticket **detectado** en los mensajes aparece en el listado después de abrir el panel de ese hilo una vez (el servidor lo recuerda como `detected` en el archivo de vínculos); los vinculados a mano, siempre.
- La sección del panel se oculta con clic derecho en el panel → «Linear and Jira issues».
- Los vínculos se guardan en `userdata/issue-tracker-links.json` (por hilo y gestor: ticket manual y detectados descartados), no en el modelo del hilo: no viajan al exportar o migrar un hilo. Al primer uso se importa el `linear-links.json` de la primera versión.
- Limitaciones de Jira: solo Jira Cloud con API token clásico (los tokens con scopes usan `api.atlassian.com/ex/jira/{cloudId}` y no están soportados); Jira Server/Data Center no está probado. La búsqueda usa `POST /rest/api/3/search/jql` con `text ~ "..."`; tus abiertos, `assignee = currentUser() AND statusCategory != Done`.

| Parte     | Archivos nuevos                                                                                                                                                                                                                                                                                                                         |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contratos | `packages/contracts/src/issueTracker.ts` (+ test)                                                                                                                                                                                                                                                                                       |
| Servidor  | `apps/server/src/issueTrackers/linearApi.ts` (GraphQL), `jiraApi.ts` (REST v3), `IssueTrackerService.ts` (credenciales, vínculos, RPC) (+ test)                                                                                                                                                                                         |
| Web       | `apps/web/src/state/issueTrackers.ts`, `components/chat/ThreadDetailsIssueTrackerRows.tsx`, `IssueTrackerLinkDialog.tsx`, `IssueTrackerParts.tsx`, `issueTrackerRows.logic.ts` (+ test), `components/settings/IssueTrackersSettings.tsx`, `routes/_chat.settings.issue-trackers.tsx`, `components/sidebar/SidebarThreadIssueBadges.tsx` |

| Toca (archivos oficiales)                                 | Qué añade                                                                                             |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `packages/contracts/src/rpc.ts`                           | import, 5 métodos `issueTrackers.*` en `WS_METHODS`, 5 `Rpc.make` y su registro en `WsRpcGroup`       |
| `packages/contracts/src/index.ts`                         | `export * from "./issueTracker.ts"`                                                                   |
| `apps/server/src/auth/RpcAuthorization.ts`                | permisos de los 5 métodos (leer: orchestration read; modificar: operate)                              |
| `apps/server/src/observability/RpcInstrumentation.ts`     | categoría de los 5 métodos                                                                            |
| `apps/server/src/server.ts`                               | import y capa `IssueTrackerService.layer`                                                             |
| `apps/server/src/ws.ts`                                   | import, `yield* IssueTrackerService` y los 5 handlers                                                 |
| `apps/server/src/ws.test.ts`                              | import y `Layer.mock(IssueTrackerService)`                                                            |
| `apps/web/src/components/chat/threadDetailsItems.ts`      | elemento `issueTrackers` del menú «Choose what to show»                                               |
| `apps/web/src/components/chat/ThreadDetailsPanel.tsx`     | import y la sección que renderiza las filas                                                           |
| `apps/web/src/components/sidebar/SidebarThreadRow.tsx`    | import, `useThreadIssueSummary` y las insignias tras la rama (también cuentan para mostrar esa línea) |
| `apps/web/src/components/settings/settingsSearch.ts`      | ruta `/settings/issue-trackers` (tipo, etiqueta, grupo Connections, ámbito) y 2 entradas de búsqueda  |
| `apps/web/src/components/settings/SettingsSidebarNav.tsx` | icono de la página                                                                                    |
| `apps/web/src/routes/_chat.settings.tsx`                  | la página usa un solo entorno, como Secrets                                                           |
| `apps/web/src/routeTree.gen.ts`                           | generado por el plugin de TanStack Router al arrancar dev o compilar                                  |

Probar sin credenciales reales: `docs/personal/mock-issue-trackers.mjs` simula Linear (puerto 4567, key `test-key`) y Jira (puerto 4568, email `dev@example.com`, token `test-token`). La variable `T3CODE_LINEAR_API_URL` redirige Linear; para Jira basta con poner `http://127.0.0.1:4568` como sitio (http solo se acepta en localhost).

```powershell
node docs/personal/mock-issue-trackers.mjs   # en otra terminal
$env:T3CODE_LINEAR_API_URL = 'http://127.0.0.1:4567/graphql'
. ./docs/personal/custom-env.ps1
vp run dev --home-dir .t3 --no-seed
```

Tests: `vp test run packages/contracts/src/issueTracker.test.ts apps/server/src/issueTrackers/IssueTrackerService.test.ts apps/web/src/components/chat/issueTrackerRows.logic.test.ts`. Las consultas de Linear se comprobaron contra su esquema GraphQL oficial; las de Jira, contra la documentación de autenticación y el changelog de Atlassian (la forma de la respuesta se decodifica de forma tolerante). Ambas se han ejecutado solo contra los mocks.

### Gestor de orgs de Salesforce en el panel del hilo

Qué hace: en hilos cuya carpeta es un proyecto Salesforce DX (tiene `sfdx-project.json`), el panel del hilo muestra la **org por defecto** del workspace (la que usan los agentes cuando ejecutan `sf` sin `-o`), con su tipo (**PROD** en rojo, Dev Hub, Sandbox, Scratch) y un punto de estado (verde conectada, rojo con error, gris sin comprobar). En carpetas que no son DX no aparece nada.

- **Cambiar de org:** clic en la fila → buscador con todas las orgs autenticadas → elegir una ejecuta `sf config set target-org` en la carpeta del hilo (escribe `.sf/config.json`). Elegir una org de producción (o Dev Hub) pide confirmación explícita.
- **Añadir org:** «Add org…» → alias (se valida que no exista), URL de login (Production/Developer, Sandbox o URL propia) y «Set as default» → `sf org login web`. Muestra «Waiting for login in the browser…» con **Cancel login**, que mata el proceso y libera el puerto 1717.
- **Favoritas:** la estrella de «Manage orgs…» marca o desmarca una org como favorita. Las favoritas salen arriba del todo, en ese diálogo y en el buscador de la fila (con una estrella). Se guardan por usuario de Salesforce en `userdata/salesforce-favorites.json`, compartidas por todos los proyectos y clientes del servidor.
- **Manage orgs…:** lista con alias, usuario, URL, estado y último uso. Clic en la fila la fija como org por defecto (producción pide confirmación). Acciones por org: favorita, abrir en el navegador (`sf org open`, el CLI abre el navegador y la URL con sesión nunca llega a T3 Code), re-autenticar (si no está conectada; reutiliza alias y URL), copiar usuario y cerrar sesión (con confirmación).
- **Sincronización:** el servidor vigila (solo lectura) `<proyecto>/.sf/`, la carpeta del proyecto, `~/.sf/` y `~/.sfdx/`. Un cambio hecho desde VS Code o la terminal se ve en unos segundos (medido: menos de 7 s).
- **Carga:** primero la lista rápida (`--skip-connection-status`, ~15 s en este equipo), después los estados en segundo plano (`sf org list`, 20–45 s con 23 orgs). El resultado queda en memoria por carpeta; la web lo lee cada 3 s sin lanzar `sf`.
- **Seguridad:** `sf org list --json` incluye `accessToken`; el parser (`parseOrgList`) solo deja pasar una lista blanca de campos, con un test que lo comprueba. El runner de procesos solo registra el nombre del comando, no la salida. No se leen los archivos de `~/.sfdx/` con tokens.
- Sin `sf` instalado, la fila muestra «Salesforce CLI not found» con instrucciones. La fila se oculta con clic derecho en el panel → «Salesforce org».

| Parte     | Archivos nuevos                                                                                                                                                                                             |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contratos | `packages/contracts/src/salesforce.ts`                                                                                                                                                                      |
| Servidor  | `apps/server/src/salesforce/sfCli.ts` (ejecuta `sf --json`, parser sin secretos) (+ test), `SalesforceService.ts` (caché por carpeta, vigilancia, escrituras en serie, login cancelable, favoritas)         |
| Web       | `apps/web/src/state/salesforce.ts`, `components/chat/ThreadDetailsSalesforceRow.tsx`, `SalesforceOrgsDialog.tsx`, `SalesforceLoginDialog.tsx`, `SalesforceOrgParts.tsx`, `salesforceOrgs.logic.ts` (+ test) |

| Toca (archivos oficiales)                             | Qué añade                                                                        |
| ----------------------------------------------------- | -------------------------------------------------------------------------------- |
| `packages/contracts/src/rpc.ts`                       | import, `salesforce.getState` y `salesforce.mutate` (métodos, `Rpc.make`, grupo) |
| `packages/contracts/src/index.ts`                     | `export * from "./salesforce.ts"`                                                |
| `apps/server/src/auth/RpcAuthorization.ts`            | permisos (leer: orchestration read; modificar: operate)                          |
| `apps/server/src/observability/RpcInstrumentation.ts` | categoría de los 2 métodos                                                       |
| `apps/server/src/server.ts`, `ws.ts`, `ws.test.ts`    | capa del servicio, handlers y mock                                               |
| `apps/web/src/components/chat/threadDetailsItems.ts`  | elemento `salesforce` del menú «Choose what to show»                             |
| `apps/web/src/components/chat/ThreadDetailsPanel.tsx` | import y la fila (que pinta su propia sección)                                   |

Limitaciones: no hay comandos en la paleta de comandos (es un archivo oficial de 3.000 líneas muy cambiante; el selector de la fila cubre lo mismo). No está implementado el login por device code (`sf org login device`). Cerrar sesión y abrir org no se han probado contra orgs reales, por seguridad. Probado en el proyecto real `PROPERTI`: org por defecto correcta, cambio DEV ↔ QA2 (restaurado a QA2), cambio externo reflejado, confirmación de PROD (cancelada), estados reales de las 23 orgs, diálogo de re-autenticación y login iniciado y cancelado (proceso terminado, puerto 1717 libre, sin org añadida). Ningún token en registros ni trazas.

### Rama origen y destino en la lista de pull requests

Qué hace: cada fila de la pantalla «Pull requests» muestra `rama origen → rama destino`. En «Filters» hay un submenú **Target branch** con las ramas destino de las PR cargadas; al elegir una solo quedan las PR que van a esa rama (cuenta en el número de filtros y queda en la URL como `?base=develop`).

El filtro se aplica en el cliente sobre las PR ya cargadas, sin tocar la consulta al host ni su caché (que son oficiales y cambian a menudo). Si una rama tiene PR más allá de la primera página, aparecen con «Load more». No se guarda entre sesiones (los demás filtros sí) y no existe el calificador `base:` en el buscador.

| Parte | Archivos nuevos                                                                 |
| ----- | ------------------------------------------------------------------------------- |
| Web   | `apps/web/src/components/pullRequest/pullRequestTargetBranch.logic.ts` (+ test) |

| Toca (archivos oficiales)                                        | Qué añade                                                                    |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `apps/web/src/components/pullRequest/PullRequestRow.tsx`         | import y `PullRequestRowBranches` (ya existía) en la línea de metadatos      |
| `apps/web/src/components/pullRequest/PullRequestListFilters.tsx` | icono, constante `ANY_TARGET_BRANCH`, 3 props opcionales, contador y submenú |
| `apps/web/src/components/pullRequest/PullRequestsPage.tsx`       | import, `base` en `updateSearch`, filtrado de grupos y props del menú        |
| `apps/web/src/components/pullRequest/usePullRequestListView.ts`  | campo `base` en `PullRequestsSearch`                                         |
| `apps/web/src/routes/_chat.pull-requests.tsx`                    | lectura del parámetro `base` de la URL                                       |

## Entorno y arranque

Usa PowerShell desde la raíz. Activa las versiones del `package.json` en cada terminal:

```powershell
cd 'C:\Users\Guille\Documents\Other Projects\t3code'
. ./docs/personal/custom-env.ps1
node --version
pnpm --version
vp i --frozen-lockfile
vp run dev --home-dir .t3 --no-seed
```

`custom-env.ps1` activa Vite+ y resuelve Node y pnpm desde el manifiesto oficial; no cambia el Node global ni el perfil de PowerShell. En la preparación inicial: Vite+ 1.4.0, Node 26.13.1 y pnpm 12.14.0. Es necesario tener Vite+ instalado según [el runbook oficial](docs/operations/development.md).

Abre la URL de emparejamiento que imprime el runner. Incluye una credencial: no la publiques. Los puertos efectivos aparecen en `[dev-runner]`. Si no ves la URL (por ejemplo, con la salida redirigida a un archivo, `vp run` no muestra la salida de las tareas), genera otra contra el servidor en marcha desde otra terminal:

````powershell
. ./docs/personal/custom-env.ps1
cd apps/server
node src/bin.ts pair --base-dir ../../.t3 --ttl 1h
cd ../..
``` Para Electron:

```powershell
vp run dev:desktop --home-dir .t3 --no-seed
````

La carpeta ignorada `.t3` mantiene los datos de esta copia separados. No arranques desarrollo contra `~/.t3/userdata`, la instalación real. No establezcas `VITE_HTTP_URL` ni `VITE_WS_URL`: Vite ya hace proxy. No hace falta copiar `.env.example` para el uso local; sus variables habilitan servicios cloud opcionales. No se han configurado proveedores de pago ni credenciales de IA. `Replay (dev)` permite probar turnos locales gratuitos en el modo web.

## Arquitectura y puntos de entrada

| Área                            | Ubicación                                                                                       |
| ------------------------------- | ----------------------------------------------------------------------------------------------- |
| Interfaz React y rutas          | `apps/web/src`, `apps/web/src/routes`                                                           |
| Conversación y composición      | `apps/web/src/components/ChatView.tsx` y componentes asociados                                  |
| Navegación y paneles            | `Sidebar.tsx`, `AppSidebarLayout.tsx`, `DiffPanel.tsx`, dentro de `apps/web/src/components`     |
| Estilos y temas                 | `apps/web/src/index.css`, `themeCss.ts`, `themePalette.ts`; componentes base en `components/ui` |
| Estado compartido web/móvil     | `packages/client-runtime/src`                                                                   |
| Contratos de comunicación       | `packages/contracts`                                                                            |
| Servidor, WebSocket y servicios | `apps/server/src`, `apps/server/src/ws.ts`                                                      |
| Conversaciones persistentes     | `apps/server/src/orchestration-v2`                                                              |
| Proveedores                     | `packages/provider-*`, `packages/effect-codex-app-server`, servicios en `apps/server`           |
| Aplicación Electron             | `apps/desktop/src`                                                                              |
| Cliente React Native            | `apps/mobile`                                                                                   |
| Empaquetado                     | `scripts/build-desktop-artifact.ts` y configuración Vite de desktop/server/web                  |
| Monitor nativo Rust             | `native/resource-monitor`                                                                       |

El cliente envía peticiones WebSocket tipadas. El orquestador decide eventos; el servidor guarda eventos, proyecciones y efectos pendientes en una transacción. Un worker ejecuta efectos y adapta la comunicación con los agentes. Cada turno puede producir checkpoints Git. Los proveedores se ejecutan como procesos externos y sus adaptadores traducen sus protocolos.

`apps/server/src/config.ts` define las rutas: bajo el home elegido, `userdata/statev2.sqlite`, `userdata/settings.json`, temas, secretos y registros. Electron añade preferencias propias. Trata todo el home como datos privados; nunca lo añadas a Git. Consulta [overview](docs/internals/overview.md) y `AGENTS.md` antes de modificar servicios.

## Remotos y ramas

```text
origin    https://github.com/GuillermoMGV/t3code.git
upstream  https://github.com/pingdotgg/t3code.git
upstream push: DISABLED
```

`remote.pushDefault=origin` y `push.default=simple`. `main` sigue a `origin/main` y se mantiene idéntica a la base oficial, sin personalizaciones. `custom` sigue a `origin/custom` y contiene esta guía y los scripts personales. Se conserva todo el historial.

El fork copió miles de ramas del proyecto oficial. Por eso `origin` solo descarga `main` y `custom`, y `upstream` solo `main`. Para seguir otra rama propia del fork: `git config --add remote.origin.fetch '+refs/heads/<rama>:refs/remotes/origin/<rama>'`.

La identidad de commits se ha configurado solo en este repo como `GuillermoMGV` con su correo noreply. Un helper de credenciales local (en `.git/config`) pide el token al almacén de `gh` para esa cuenta explícita: no guarda tokens y no depende de la cuenta activa de `gh` (en este equipo, la de trabajo). La configuración Git local no viaja en los commits. Para recrearla en un clon nuevo u otro ordenador, autentica `gh` con `GuillermoMGV` y ejecuta:

```powershell
git clone --branch custom https://github.com/GuillermoMGV/t3code.git t3code
cd t3code
./docs/personal/setup-local-git.ps1
git fetch origin
git fetch upstream
git branch --track main origin/main
```

El script es idempotente y se detiene si algún remoto apunta a otra URL.

## Desarrollar y publicar

```powershell
git switch custom
. ./docs/personal/custom-env.ps1
# Editar y verificar el comportamiento afectado.
git diff
git add <archivos-revisados>
vp run check:changed
git commit -m 'feat(web): describe el cambio'
git push origin custom
```

Puedes usar ramas de trabajo desde `custom` y fusionarlas de vuelta. Mantén cambios pequeños. Para lógica, ejecuta los tests específicos junto al código; para UI, comprueba la aplicación real. `vp run check:changed` es la comprobación habitual; el CI oficial ejecuta las suites completas. No añadas secretos, `.env`, `.t3`, capturas privadas ni ejecutables. Las futuras funciones se desarrollan en `custom`, nunca en `main`.

## Incorporar actualizaciones oficiales

Primero guarda y confirma tus cambios. Ejecuta desde la raíz del repositorio:

```powershell
./docs/personal/sync-upstream.ps1
# Revisar la aplicación después de las comprobaciones.
git push origin custom
```

Para publicar automáticamente `custom` después de instalar y pasar las comprobaciones:

```powershell
./docs/personal/sync-upstream.ps1 -PublishCustom
```

El script verifica checkout limpio, rama, operaciones Git pendientes, URLs de remotos, bloqueo de push oficial y que la rama oficial siga siendo `main`. Obtiene ambas ramas remotas; exige que las ramas main local y del fork sean ancestros de la oficial. Actualiza `main` por fast-forward, publica `origin/main`, incorpora `origin/custom` solo por fast-forward y hace merge de `main` en `custom`. Después instala con lockfile congelado y ejecuta `check:changed`. Se detiene ante cualquier error. No usa force, reset ni stash automático. `origin/main` puede haber quedado actualizada aunque una fase posterior falle; eso es seguro y esperado.

Equivalente manual:

```powershell
git status --short
# Continuar únicamente con checkout limpio y sin operaciones pendientes.
git fetch upstream main
git fetch origin main custom
git switch main
git merge --ff-only upstream/main
git push origin main
git switch custom
git merge --ff-only origin/custom
git merge main
. ./docs/personal/custom-env.ps1
vp i --frozen-lockfile
vp run check:changed
# Comprobar la aplicación antes de publicar.
git push origin custom
```

Si un fast-forward falla, inspecciona `git log --graph --oneline --decorate --all`: no fuerces la historia. Ante conflictos del merge con main, permanece en `custom`, usa `git status`, revisa cada archivo y conserva la intención de ambos cambios. No elijas globalmente ours/theirs. Después:

```powershell
git add <archivos-resueltos>
git merge --continue
. ./docs/personal/custom-env.ps1
vp i --frozen-lockfile
vp run check:changed
# Probar el flujo afectado.
git push origin custom
```

Para cancelar un merge iniciado con checkout limpio: `git merge --abort`. Si el fallo fue de instalación o comprobaciones, corrígelo y repite esos pasos antes del push; el script no publica una integración fallida. El script ejecuta código actualizado del proyecto: revisa los cambios oficiales antes de lanzarlo.

## Compilar Windows

Requisitos: Python 3, Rust estable con el target `x86_64-pc-windows-msvc`, Visual Studio Build Tools con **Desktop development with C++**, Windows SDK, MSVC y bibliotecas Spectre x64. NSIS lo descarga electron-builder. WSL no es necesario para el payload Windows; incluir el payload WSL requiere además el archivo Linux descrito en [release.md](docs/operations/release.md).

Con el árbol de trabajo limpio y el servidor de desarrollo detenido:

```powershell
./docs/personal/build-windows.ps1 -BuildVersion 0.1.9-preview.20261117.1
```

El instalador sin firma queda en `release/T3-Code-<versión>-x64.exe`, junto a su `.blockmap`. Electron-builder se invoca con `--publish never`: compilar no publica releases. Usa una versión preview nueva en cada build (fecha y contador) y súbela cuando cambie la base oficial (`apps/desktop/package.json`).

Por qué existe el script: el release oficial **no compila Windows en Windows**. Lo empaqueta en Linux y verifica el paquete después en un runner Windows (`.github/workflows/release.yml` y `release-desktop.yml`). En Linux no se puede ejecutar el binario Windows, así que el `afterPack` oficial omite la caché V8 del servidor y se salta el auto-chequeo del bundle. En un host Windows esa caché sí se genera (22 archivos más), el paquete llega a 90 archivos y el validador oficial lo rechaza (límite de 80). El script reproduce el flujo oficial sin tocar código:

1. Compila el monitor Rust del commit actual y lo reutiliza (`T3CODE_DESKTOP_REUSE_RESOURCE_MONITOR=1`). Esto evita un falso negativo del preflight oficial en este equipo: el registro del SDK apunta a `C:\Program Files\Windows Kits\10`, pero el SDK está en `C:\Program Files (x86)\Windows Kits\10`. No se ha cambiado el registro.
2. Empaqueta con `T3CODE_DESKTOP_UNTRUSTED_BUNDLE=true`, que omite la caché y el auto-chequeo igual que el build en Linux. El validador oficial del payload (límite de archivos y nativos) sí se ejecuta.
3. Ejecuta `scripts/verify-windows-desktop-artifact.ts`, la misma verificación que el job oficial de Windows: carga del nativo `fff` y auto-chequeo del bundle.
4. Limpia las variables de entorno y el directorio temporal de staging.

La única diferencia con un release oficial es la falta de firma y de la caché V8, que el oficial tampoco lleva. Una compilación sin firma puede mostrar avisos de SmartScreen. `--build-version` alinea temporalmente las versiones de varios manifiestos y después las restaura; si dev está abierto, sus watchers reinician la aplicación.

Identidad y actualizaciones: se conservan `com.t3tools.t3code` y el nombre oficial, así que instalar este build **sustituye o convive con la instalación oficial** y comparte `~/.t3/userdata`. No lo instales encima de la oficial sin decidirlo antes. El código reconoce las versiones preview y omite la configuración de publicación/actualización correspondiente. Una versión distribuible propia necesita decidir conjuntamente identidad (appId), protocolo, rutas de datos, nombre, iconos, firma y feed de actualizaciones: si usa el feed oficial, una actualización oficial sustituiría tus personalizaciones. `T3CODE_DESKTOP_UPDATE_REPOSITORY` configura el destino de actualizaciones cuando se decida habilitar uno propio; no se ha modificado.

## Instalar tu versión

Lo normal es compilar e instalar de una vez:

```powershell
./docs/personal/build-and-install.ps1
```

Sin parámetros calcula la versión `<versión de apps/desktop/package.json>-preview.<AAAAMMDD>.<N>`, con el siguiente `N` libre según `release/` y la versión instalada. También admite `-BuildVersion <v>` y `-SkipBackup`. El script:

1. Compila y verifica con `build-windows.ps1` (se detiene si algo falla, sin tocar la instalación).
2. Cierra T3 Code instalado si está abierto: primero intenta cerrar la ventana y, si sigue abierto a los 15 s, lo fuerza. Si tienes un turno de un agente en curso, espera a que termine antes de lanzarlo.
3. Copia `~/.t3/userdata` a `~/.t3/userdata-backup-<AAAAMMDD-HHMMSS>`. Las copias no se borran solas (unos 60 MB cada una); elimina las antiguas a mano.
4. Ejecuta el instalador y comprueba que la versión instalada es la esperada. La app se abre sola al terminar.

Alternativa manual, por ejemplo con un instalador ya compilado. Cierra T3 Code, copia los datos y ejecuta el instalador:

```powershell
$version = '0.1.9-preview.AAAAMMDD.N'
Copy-Item "$env:USERPROFILE\.t3\userdata" "$env:USERPROFILE\.t3\userdata-backup-$(Get-Date -Format yyyyMMdd-HHmm)" -Recurse
Start-Process ".\release\T3-Code-$version-x64.exe" -Wait
```

El instalador es de un clic y por usuario (no pide administrador). Instala en `%LOCALAPPDATA%\Programs\t3code`, crea o actualiza el acceso directo **T3 Code (Beta)** en el escritorio y en el menú Inicio, y abre la app al terminar. Las versiones preview se llaman "Beta". Una versión nueva se instala encima de la anterior; conversaciones y ajustes se conservan porque viven en `~/.t3/userdata`, no en la carpeta de la app. Para desinstalar: Configuración de Windows > Aplicaciones > T3 Code (Beta); los datos de `~/.t3` no se borran.

Si la app nueva falla con tus datos, cierra la app, renombra `~/.t3/userdata` y restaura la copia con el nombre `userdata`. Borra las copias antiguas cuando ya no las necesites.

## Problemas conocidos y limitaciones

- `vp run dev` muestra la URL de emparejamiento solo en una terminal interactiva; con la salida redirigida usa el comando `pair` de la sección de arranque.
- La dependencia móvil `react-native-enriched-markdown` avisa al extraer RaTeX para iOS en Windows durante `vp i`. No afecta al escritorio; iOS no se ha compilado ni probado.
- `vp i` puede mostrar `Agent skills awaiting approval`. Es una función de pnpm para skills de agentes incluidas en dependencias; no hace falta aprobarlas para desarrollar ni compilar.
- La cuenta activa de `gh` en este equipo es la de trabajo. Este repo no depende de ella (helper local), pero `gh` sin `--repo` o sin `GH_TOKEN` actuará con esa cuenta.
- Git del sistema es 2.36; funciona con este flujo, pero conviene actualizarlo cuando sea posible.
- En **modo dev** el servidor se reinicia (o se cae) cada pocos minutos en este equipo, sin errores en las trazas; empezó antes de la integración de Salesforce y no ocurre en la app instalada (comprobado con su proceso de servidor vivo más de 10 min). Si pasa, la web muestra un 502: espera a que vuelva o reinicia `vp run dev`. Las operaciones largas de Salesforce (estados, login) se cortan si coincide un reinicio.
- Los tests de navegador (`*.browser.test.tsx`) necesitan el Chromium de Playwright; sin él, `check:changed` falla con `Executable doesn't exist ... chrome-headless-shell.exe`. Ya está instalado en este equipo. En un equipo nuevo, o si una actualización oficial sube la versión de `playwright` en `apps/web/package.json`, instálalo de nuevo desde `apps/web` (unos 100 MB):

  ```powershell
  . ../../docs/personal/custom-env.ps1
  pnpm exec playwright install chromium-headless-shell
  ```

  Playwright borra al instalar las versiones antiguas que considera sin uso en `%LOCALAPPDATA%\ms-playwright`.

## Validación de este equipo (17-11-2026)

- Fork `GuillermoMGV/t3code` reutilizado: público, relación de fork con `pingdotgg/t3code` verificada. La carpeta local se había vaciado, así que se clonó de nuevo y se recreó la configuración local con los valores de `setup-local-git.ps1`.
- Sincronización manual: fast-forward de `main` de `c24255826b` a `e8e7fb7e9a` (3 commits) y merge en `custom` sin conflictos.
- `sync-upstream.ps1` probado de punta a punta tras llegar 3 commits oficiales más: `main`, `origin/main` y `upstream/main` coinciden en `b79d277cddaf65858418f29d73b87fcc3d1a19c5`, merge en `custom` sin conflictos, instalación y `check:changed` correctos. `custom` sigue a `origin/custom`.
- Push a `origin` autenticado como `GuillermoMGV`; push a `upstream` rechazado (`DISABLED`).
- Entorno: Vite+ 1.4.0, Node 26.13.1 y pnpm 12.14.0 desde el manifiesto; Rust 1.100.0 con target MSVC; Visual Studio Build Tools 2022; Python 3.11.
- `vp i --frozen-lockfile` completado. `vp run check:changed --concurrency 1` y `vp run typecheck` (41 paquetes, 0 errores, repetido sobre `b79d277`) pasaron. No se ha ejecutado la suite completa de tests.
- Desarrollo con estado aislado en `.t3`: interfaz emparejada en el navegador, proyecto y rama Git detectados, turno gratuito `Replay (dev)` completado con streaming y título automático. Replay simula herramientas: el árbol de trabajo quedó limpio.
- Windows x64 (base `e8e7fb7`): `build-windows.ps1` generó `T3-Code-0.1.9-preview.20261117.2-x64.exe` (~200 MB). Payload validado (67 archivos, 26 nativos) y verificación oficial de Windows superada. arm64 no se ha probado.
- Instalación: copia de `~/.t3/userdata` en `userdata-backup-20261117`, instalador ejecutado (código 0), acceso directo `T3 Code (Beta)` creado en el escritorio, app abierta con su servidor interno respondiendo. No había otra instalación de T3 Code en el equipo. Nada publicado ni distribuido.
- `build-and-install.ps1` sin parámetros: eligió `0.1.9-preview.20261117.3`, compiló y verificó (67 archivos), cerró la app abierta, copió los datos a `userdata-backup-20261117-005223`, instaló y comprobó la versión; la app se reabrió y no quedaron cambios en Git ni carpetas temporales.
- Proveedores de IA reales (Codex, Claude, Cursor, etc.) no configurados: se autentican después desde la aplicación y no forman parte de la instalación de T3 Code.
