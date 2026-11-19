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
- `build-and-install.ps1` lanza la instalación con `Win32_Process.Create`, fuera de su árbol de procesos: cerrar T3 Code mata las terminales de sus agentes, así que desde un agente de T3 Code el script muere al cerrar la app, pero la instalación sigue y la app se reabre. El progreso queda en `%TEMP%	3code-install-<versión>.log`, cuya última línea es `OK <versión>` o `ERROR …`.
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
| `docs/personal/build-and-install.ps1`   | `build-windows.ps1` + `install-windows.ps1`. Versión automática.                                |
| `docs/personal/install-windows.ps1`     | Cierra la app, copia los datos, instala, comprueba la versión y la reabre (proceso aparte).     |
| `docs/personal/mock-issue-trackers.mjs` | APIs de Linear y Jira simuladas para probar la integración sin credenciales reales (ver abajo). |
| `docs/personal/mock-slack.mjs`          | API de Slack simulada para probar «Remind» y las menciones sin tocar Slack real.                |
| `docs/personal/mock-salesforce-api.mjs` | REST API de Salesforce simulada para probar Salesforce Export sin tocar una org (ver abajo).    |

## Personalizaciones del fork

Funciones propias de este fork. Cada una vive sobre todo en archivos nuevos; la tabla «Toca» lista las líneas añadidas en archivos oficiales, que son los únicos puntos donde una sincronización puede dar conflicto. Al resolverlo, conserva el cambio oficial y vuelve a añadir la línea del fork.

### Tickets de Linear y Jira en el panel del hilo

Qué hace: el panel de detalles del hilo (icono arriba a la derecha) muestra el ticket de Linear y el de Jira asociados al hilo, cada uno con título, clave, **estado con su color y asignado** (los dos se cambian con un clic, ver «Cambiar estado y asignado de un ticket»). Se actualizan cada minuto mientras el panel está abierto. Solo aparece la fila de un gestor si está conectado o si el hilo menciona uno de sus tickets; sin ninguno conectado, la fila «Connect Linear or Jira» lleva a Ajustes.

- **Conectar:** Ajustes → Connections → **Issue trackers**. Linear pide una personal API key (Linear → Settings → Security & access → Personal API keys). Jira pide el sitio (`tu-equipo.atlassian.net`), el email de la cuenta de Atlassian y un API token **sin scopes** (<https://id.atlassian.com/manage-profile/security/api-tokens>). Las credenciales se validan contra el gestor antes de guardarlas en `userdata/secrets/` (`linear-api-key.bin`, `jira-credentials.bin`). La página muestra la cuenta conectada y permite desconectar.
- **Vincular automáticamente:** si un mensaje tuyo del hilo contiene una URL `https://linear.app/<workspace>/issue/ABC-123/...` o `https://<sitio>.atlassian.net/browse/ABC-123` (también `?selectedIssue=ABC-123` de los tableros), el ticket aparece solo.
- **Vincular a mano:** «Link Linear issue» / «Link Jira issue» abre un buscador que busca **mientras escribes** (espera 500 ms, `ISSUE_SEARCH_DEBOUNCE_MS` en `issueTrackerRows.logic.ts`). Sin texto muestra tus tickets abiertos. Un clic en un resultado lo vincula; con el teclado, ↑/↓ mueve el resaltado y Enter vincula. Una URL o clave pegada se vincula con Enter sin esperar a la búsqueda.
- **Menú ⋯:** abrir en el gestor, copiar enlace, cambiar de ticket, refrescar, desvincular (también oculta los tickets detectados en el hilo) e ir a sus ajustes.
- **Listado de hilos:** cada hilo con ticket muestra, en una línea propia debajo de la de git (rama, PR, diff), una insignia con el estado (con su color), otra con el asignado (nombre de pila) y la fecha de vencimiento si la tiene; al pasar el ratón se ve la clave, el título y el nombre completo. Si un hilo tiene ticket de Linear y de Jira, muestra el de Linear. El listado hace una sola petición para todos los hilos (`issueTrackers.getThreadSummaries`) cada minuto y el servidor guarda cada ticket en caché un minuto. Un ticket **detectado** en los mensajes aparece en el listado después de abrir el panel de ese hilo una vez (el servidor lo recuerda como `detected` en el archivo de vínculos); los vinculados a mano, siempre.
- **Filtrar y refrescar el listado:** junto a los iconos de la cabecera de la barra lateral aparecen dos botones (solo si algún hilo tiene ticket). El del ticket filtra los hilos por **estado** y por **asignado** («Unassigned» incluido): varios valores del mismo tipo se suman y los dos tipos se combinan; con un filtro activo se ocultan los hilos sin ticket y el botón muestra un punto. «Clear issue filter» lo quita. El filtro dura mientras la app esté abierta (no se guarda al recargar). El de refrescar vacía la caché de tickets del servidor (`refreshIssues`) y vuelve a pedir estado y asignado de todos los hilos al momento.
- La sección del panel se oculta con clic derecho en el panel → «Linear and Jira issues».
- Los vínculos se guardan en `userdata/issue-tracker-links.json` (por hilo y gestor: ticket manual y detectados descartados), no en el modelo del hilo: no viajan al exportar o migrar un hilo. Al primer uso se importa el `linear-links.json` de la primera versión.
- Limitaciones de Jira: solo Jira Cloud con API token clásico (los tokens con scopes usan `api.atlassian.com/ex/jira/{cloudId}` y no están soportados); Jira Server/Data Center no está probado. La búsqueda usa `POST /rest/api/3/search/jql` con `text ~ "..."`; tus abiertos, `assignee = currentUser() AND statusCategory != Done`.

| Parte     | Archivos nuevos                                                                                                                                                                                                                                                                                                                                                                                             |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contratos | `packages/contracts/src/issueTracker.ts` (+ test)                                                                                                                                                                                                                                                                                                                                                           |
| Servidor  | `apps/server/src/issueTrackers/linearApi.ts` (GraphQL), `jiraApi.ts` (REST v3), `IssueTrackerService.ts` (credenciales, vínculos, RPC) (+ test)                                                                                                                                                                                                                                                             |
| Web       | `apps/web/src/state/issueTrackers.ts`, `components/chat/ThreadDetailsIssueTrackerRows.tsx`, `IssueTrackerLinkDialog.tsx`, `IssueTrackerParts.tsx`, `issueTrackerRows.logic.ts` (+ test), `components/settings/IssueTrackersSettings.tsx`, `routes/_chat.settings.issue-trackers.tsx`, `components/sidebar/SidebarThreadIssueBadges.tsx`, `SidebarIssueControls.tsx`, `sidebarIssueFilter.logic.ts` (+ test) |

| Toca (archivos oficiales)                                 | Qué añade                                                                                                                                                                                                       |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/contracts/src/rpc.ts`                           | import, 6 métodos `issueTrackers.*` en `WS_METHODS`, 6 `Rpc.make` y su registro en `WsRpcGroup`                                                                                                                 |
| `packages/contracts/src/index.ts`                         | `export * from "./issueTracker.ts"`                                                                                                                                                                             |
| `apps/server/src/auth/RpcAuthorization.ts`                | permisos de los 6 métodos (leer: orchestration read; modificar: operate)                                                                                                                                        |
| `apps/server/src/observability/RpcInstrumentation.ts`     | categoría de los 6 métodos                                                                                                                                                                                      |
| `apps/server/src/server.ts`                               | import y capa `IssueTrackerService.layer`                                                                                                                                                                       |
| `apps/server/src/ws.ts`                                   | import, `yield* IssueTrackerService` y los 6 handlers                                                                                                                                                           |
| `apps/server/src/ws.test.ts`                              | import y `Layer.mock(IssueTrackerService)`                                                                                                                                                                      |
| `apps/web/src/components/chat/threadDetailsItems.ts`      | elemento `issueTrackers` del menú «Choose what to show»                                                                                                                                                         |
| `apps/web/src/components/chat/ThreadDetailsPanel.tsx`     | import y la sección que renderiza las filas                                                                                                                                                                     |
| `apps/web/src/components/sidebar/SidebarThreadRow.tsx`    | import, `useThreadIssueSummary` y `issueLine`: una línea con las insignias bajo la de git, en tarjetas y filas de carpeta de dos líneas (altura automática y pistas de `contain-intrinsic-size` para esa línea) |
| `apps/web/src/components/sidebar/SidebarThreadHeader.tsx` | prop opcional `issueControls` pintada tras el filtro de proyectos                                                                                                                                               |
| `apps/web/src/components/Sidebar.tsx`                     | import, `useIssueFilteredThreads` sobre los hilos listados y `<SidebarIssueControls>` en la cabecera                                                                                                            |
| `apps/web/src/components/settings/settingsSearch.ts`      | ruta `/settings/issue-trackers` (tipo, etiqueta, grupo Connections, ámbito) y 2 entradas de búsqueda                                                                                                            |
| `apps/web/src/components/settings/SettingsSidebarNav.tsx` | icono de la página                                                                                                                                                                                              |
| `apps/web/src/routes/_chat.settings.tsx`                  | la página usa un solo entorno, como Secrets                                                                                                                                                                     |
| `apps/web/src/routeTree.gen.ts`                           | generado por el plugin de TanStack Router al arrancar dev o compilar                                                                                                                                            |

Probar sin credenciales reales: `docs/personal/mock-issue-trackers.mjs` simula Linear (puerto 4567, key `test-key`) y Jira (puerto 4568, email `dev@example.com`, token `test-token`). La variable `T3CODE_LINEAR_API_URL` redirige Linear; para Jira basta con poner `http://127.0.0.1:4568` como sitio (http solo se acepta en localhost).

```powershell
node docs/personal/mock-issue-trackers.mjs   # en otra terminal
$env:T3CODE_LINEAR_API_URL = 'http://127.0.0.1:4567/graphql'
. ./docs/personal/custom-env.ps1
vp run dev --home-dir .t3 --no-seed
```

Tests: `vp test run packages/contracts/src/issueTracker.test.ts apps/server/src/issueTrackers/IssueTrackerService.test.ts apps/web/src/components/chat/issueTrackerRows.logic.test.ts`. Las consultas de Linear se comprobaron contra su esquema GraphQL oficial; las de Jira, contra la documentación de autenticación y el changelog de Atlassian (la forma de la respuesta se decodifica de forma tolerante). Ambas se han ejecutado solo contra los mocks.

### Fecha de vencimiento de los tickets

Qué hace: en lugar de la prioridad, los tickets de Linear y Jira muestran su **fecha de vencimiento** (Linear `dueDate`, Jira `duedate`) con un icono de calendario en todos los sitios: página Issues, panel del hilo, insignias del listado de hilos, insignias de la lista de pull requests y tarjetas bajo las respuestas del agente. Sin fecha no se muestra nada.

- **Texto:** «Overdue N days», «Due today», «Due tomorrow», «Due in N days» (hasta 7 días) y, más lejos, la fecha («Due Nov 30», con año si no es el actual). Al pasar el ratón se ve la fecha completa.
- **En rojo** si quedan 3 días o menos o ya venció (`URGENT_DAYS` en `issueDueDate.logic.ts`), salvo que el ticket esté terminado o cancelado (Linear `completed`/`canceled`, Jira `done`). Los días se cuentan en días naturales de tu zona horaria y se recalculan cada minuto.
- La prioridad ya no se pide a los gestores. `dueDate` es opcional en el contrato porque los tickets guardados antes no lo traen; se rellena al siguiente refresco (un minuto de caché).

| Parte | Archivos nuevos                                               |
| ----- | ------------------------------------------------------------- |
| Web   | `apps/web/src/components/chat/issueDueDate.logic.ts` (+ test) |

Archivos del fork que cambian: `issueTracker.ts` (contrato: `dueDate` sustituye a `priorityLabel`), `linearApi.ts`, `jiraApi.ts`, `IssueTrackerParts.tsx` (`IssueDueDate`), `SidebarThreadIssueBadges.tsx` (`IssueDueDateChip`), `PullRequestIssueBadges.tsx`, `IssuesPage.tsx`, `ReplyCards.tsx`, `ThreadDetailsIssueTrackerRows.tsx` y `mock-issue-trackers.mjs` (fechas relativas a hoy: mañana, vencido hace 2 días, dentro de 5…). No toca archivos oficiales.

Probar: con los mocks (sección de Linear y Jira), la página Issues muestra PRO-1234 «Due tomorrow» y OPS-7 «Overdue 2 days» en rojo, OPS-12 «Due in 5 days» normal y SUP-301 (Done) vencido pero sin rojo. Tests: `vp test run apps/web/src/components/chat/issueDueDate.logic.test.ts apps/server/src/issueTrackers/IssueTrackerService.test.ts`.

### Títulos de hilo a partir de un ticket

Al enviar un borrador abierto desde **Issues** o vincular un ticket de Linear o Jira desde el panel de detalles, el hilo toma el título `PRO-123 — Título del ticket`. Si vinculas otro ticket, el último que vincules da nombre al hilo. Puedes editar el título después. Desvincular un ticket conserva el título que tenga el hilo en ese momento.

El servidor guarda el título del ticket en `userdata/issue-tracker-links.json` cuando lo vincula. Así, un borrador puede usarlo al enviarse sin volver a consultar el gestor. Para vincular un ticket, la cuenta conectada debe poder leerlo.

| Parte    | Archivo del fork                                                               |
| -------- | ------------------------------------------------------------------------------ |
| Servidor | `apps/server/src/issueTrackers/issueThreadTitle.ts` y `IssueTrackerService.ts` |

| Toca (archivos oficiales)                                      | Qué añade                                              |
| -------------------------------------------------------------- | ------------------------------------------------------ |
| `apps/server/src/orchestration-v2/ThreadMessageIntake.ts`      | Aplica el título vinculado al crear el hilo            |
| `apps/server/src/orchestration-v2/ThreadLaunchService.test.ts` | Prueba la creación y el renombrado con Linear y Jira   |
| `apps/server/src/server.ts`                                    | Conecta el servicio de tickets con la gestión de hilos |
| `apps/server/src/ws.ts`, `apps/server/src/ws.test.ts`          | Proporcionan la integración al flujo de creación       |

Prueba de integración con gestores simulados en `ThreadLaunchService.test.ts`, caso `uses the linked Linear or Jira ticket title when starting or renaming a thread`.

### Cambiar estado y asignado de un ticket

Qué hace: el estado y el asignado de un ticket se cambian con un clic en tres sitios: el panel del hilo (donde ahora van en líneas separadas: clave, estado y asignado), la página de tickets y la línea del ticket en la lista de pull requests. Se abre un desplegable con buscador (escribe para filtrar; ↑/↓ y Enter, o clic) y el cambio se hace en Linear o Jira.

- **Estados:** Linear ofrece los estados del equipo del ticket, en el orden de su tablero. Jira ofrece los estados a los que llevan las **transiciones** disponibles del ticket (como en Jira, el actual no aparece); si una transición exige campos (por ejemplo, una resolución), Jira la rechaza y el aviso muestra su motivo.
- **Asignados:** Linear, los miembros activos del equipo; Jira, los usuarios asignables al ticket (hasta 1000, sin apps ni cuentas desactivadas). «Unassigned» quita el asignado.
- **Nombres de Linear:** cuando un usuario no tiene nombre completo, Linear guarda su email en `name`; en ese caso se muestra su `displayName` (como hace Linear), en asignados, desplegable y notificaciones. Jira ya usa `displayName`.
- Tras el cambio, el servidor vuelve a leer el ticket y refresca su caché; el panel, la página de tickets, la lista de PR y las insignias de la barra lateral muestran el valor nuevo al momento. Como las búsquedas de los gestores se indexan con retraso, el cliente recuerda el ticket leído tras el cambio (`editedIssueAtom`) y lo muestra mientras la lista no traiga algo igual de nuevo (`shownIssue` compara `updatedAt`).
- Las opciones se piden al abrir el desplegable (`issueTrackers.getEditOptions`, un minuto de caché en el cliente). Los cambios son `setIssueState` (id de estado de Linear o id de transición de Jira) y `setIssueAssignee` (id de usuario de Linear o accountId de Jira; null desasigna) dentro de `issueTrackers.mutate`.

| Parte       | Archivos                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nuevos      | `apps/web/src/components/chat/IssueFieldPicker.tsx`, `issueFieldPicker.logic.ts` (+ test)                                                                                                                                                                                                                                                                                                       |
| Ya del fork | `issueTracker.ts` (contrato), `linearApi.ts` (`editOptions`, `updateIssue`), `jiraApi.ts` (`editOptions`, `transitionIssue`, `assignIssue`; `request` admite PUT), `IssueTrackerService.ts`, `state/issueTrackers.ts`, `ThreadDetailsIssueTrackerRows.tsx`, `IssuesPage.tsx`, `PullRequestIssueBadges.tsx`, `SidebarThreadIssueBadges.tsx` (insignias reutilizables), `mock-issue-trackers.mjs` |

| Toca (archivos oficiales)                             | Qué añade                                               |
| ----------------------------------------------------- | ------------------------------------------------------- |
| `packages/contracts/src/rpc.ts`                       | `issueTrackersGetEditOptions`, su `Rpc.make` y registro |
| `apps/server/src/auth/RpcAuthorization.ts`            | permiso de lectura del método                           |
| `apps/server/src/observability/RpcInstrumentation.ts` | categoría del método                                    |
| `apps/server/src/ws.ts`                               | handler `getEditOptions`                                |

Probar: el mock de gestores sirve estados, transiciones y personas y aplica los cambios en memoria (en Jira, pasar a «Done» falla a propósito con «Resolution is required.» para ver el aviso de error). Tests: `vp test run apps/server/src/issueTrackers/IssueTrackerService.test.ts apps/web/src/components/chat/issueFieldPicker.logic.test.ts`. Comprobado en dev contra los mocks: página de tickets (Linear y Jira: estado, asignado, búsqueda y error) y panel del hilo (la insignia de la barra lateral se actualiza a la vez). La lista de PR usa el mismo selector, pero no se probó en vivo porque ninguna PR listada nombraba un ticket. Las llamadas reales (`issueUpdate` de Linear; `POST /issue/{key}/transitions` y `PUT /issue/{key}/assignee` de Jira) siguen la documentación oficial y solo se han ejecutado contra los mocks. Limitaciones: no está en la app móvil ni en las tarjetas de ticket bajo las respuestas del agente.

### Comentarios del ticket en el panel del hilo

Qué hace: si el ticket de Linear o Jira del hilo tiene comentarios, su fila del panel muestra un **bocadillo** a la derecha del estado. Al pulsarlo aparece una tarjeta flotante abajo a la derecha, en la misma columna y con el mismo ancho que el panel del hilo (si el panel se muestra como popover por falta de sitio, encima de la caja de texto), con todos los comentarios del más nuevo al más antiguo: autor, fecha y texto. El bocadillo (o la X de la tarjeta) la oculta. La tarjeta sigue abierta aunque el panel se cierre y se oculta al cambiar de hilo.

- **Check in thread:** cada comentario lleva este botón. Usa el mismo hook que el botón de la campana (`useCheckCommentInThread`), apuntando al hilo abierto: añade al final de la caja de texto `Check this comment on ticket <clave> (<título>), posted by <autor> on <fecha>:`, el comentario citado y la URL del ticket, **sin enviar**, sin repetirlo si ya está, y deja el foco en la caja.
- **Datos:** los comentarios llegan con la misma consulta del panel (`issueTrackers.getThreadIssues`, campo opcional `comments` de cada fila), así que no hay RPC nueva y se refrescan cada minuto con el resto del ticket. Linear: `issue(id) { comments(first: 100) }` con el cuerpo en markdown. Jira: `GET /rest/api/3/issue/{clave}/comment?orderBy=-created&maxResults=100`, con el cuerpo ADF pasado a texto (una línea por bloque). Si los comentarios fallan, el ticket se muestra igual sin bocadillo y el servidor deja un aviso en el log.
- **Límites:** hasta 100 comentarios por ticket. Los comentarios de integraciones (sin usuario) salen como «Unknown author». El texto se muestra plano, sin formato markdown. No está en la app móvil.

| Parte    | Archivos nuevos                                                                                                              |
| -------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Servidor | `apps/server/src/issueTrackers/issueComments.ts`                                                                             |
| Web      | `apps/web/src/components/chat/IssueComments.tsx` (bocadillo y tarjeta), `issueComments.logic.ts` (+ test) (texto del prompt) |

Archivos del fork que cambian: `issueTracker.ts` (contrato: `TrackerIssueComment` y `comments` en la fila), `IssueTrackerService.ts` (pide los comentarios junto al ticket), `issueTrackerRows.logic.ts` (`commentCount`), `ThreadDetailsIssueTrackerRows.tsx` (bocadillo junto al estado) y `mock-issue-trackers.mjs` (PRO-1234 trae 3 comentarios; los tickets de Jira, los de su actividad).

| Toca (archivos oficiales)              | Qué añade                                                                     |
| -------------------------------------- | ----------------------------------------------------------------------------- |
| `apps/web/src/components/ChatView.tsx` | import y `<ThreadIssueComments>` junto al panel del hilo (pasa `composerRef`) |

Probar: con los mocks (sección de Linear y Jira), vincula PRO-1234 a un hilo; el bocadillo dice «Show 3 comments». Tests: `vp test run apps/server/src/issueTrackers/IssueTrackerService.test.ts apps/web/src/components/chat/issueComments.logic.test.ts apps/web/src/components/chat/issueTrackerRows.logic.test.ts`. Comprobado en dev contra los mocks (abrir, cerrar, alineación con el panel, «Check in thread» sin duplicar); Jira solo con tests y el mock, y ninguno contra los gestores reales.

### Campana de notificaciones de Linear, Jira y Slack

Qué hace: con Linear, Jira o Slack conectado, aparece una **campana** en el pie de la barra lateral (junto a Ajustes, Pull requests y Uso). Un globo rojo con el número indica las notificaciones sin leer; no se anima. Al pulsarla se abre una lista, de la más nueva a la más antigua. Cada notificación indica el gestor (icono y nombre), quién lo hizo, el tipo (te asignaron, te quitaron, comentó, te mencionó, cambió el estado, ...), la clave y el título del ticket y, si es un comentario, su texto.

- **Leer y desmarcar:** pulsar una notificación abre el ticket y la marca como leída. El círculo de la derecha la marca como leída o no leída. «Mark all as read» marca todas. Las leídas siguen en la lista, atenuadas, así que no se pierde nada. Con dos o más fuentes conectadas, el panel muestra un filtro **All / Linear / Jira / Slack** (solo las conectadas; solo en el cliente, no se guarda); con una fuente elegida, «Mark all as read» marca solo las suyas. Por encima de 9 sin leer, el globo muestra «9+».
- **Check in thread / Check in new thread:** las notificaciones de comentario y de mención de Linear y Jira llevan este botón; dice «Check in new thread» cuando no se encuentra ningún hilo del ticket. Lo marca como leído, cierra el popover y abre el hilo más reciente del ticket (la misma búsqueda que «Go to thread» de la página Issues: vinculado, detectado y recordado, o con la clave en la rama o el título; sin archivados) con `Check the last comment posted on <clave> (<título>).` y la URL del ticket en la caja de texto, **sin enviar**. Si el composer ya tenía texto, el prompt se añade detrás y no se repite. Sin hilo, abre un borrador nuevo con ese texto en el proyecto del hilo abierto o, si no hay, en el que usaría «New thread», y vincula el ticket a ese hilo para que el siguiente comentario lo encuentre. El proyecto se puede cambiar en el propio borrador. Slack no lo tiene.
- **Comprobación:** el servidor consulta los gestores **cada 5 minutos**, una sola vez para todos los clientes conectados, y guarda la lista en memoria. Los clientes leen esa copia cada minuto sin llegar a los gestores. El botón de refrescar del popover comprueba al momento. Un gestor conectado después del arranque se comprueba la primera vez que un cliente pide la lista. Si un gestor falla, su error sale en el popover y en el log una sola vez por mensaje distinto; las notificaciones del otro gestor se siguen viendo.
- **Linear:** usa la API oficial de notificaciones (`notifications`, las 50 últimas, sin archivadas ni pospuestas, solo las de tickets). El estado leído **se sincroniza con Linear**: marcar aquí la marca allí (`notificationUpdate`) y lo que leas en Linear aparece leído aquí en la siguiente comprobación.
- **Jira:** Atlassian **no tiene una API pública para la campana de Jira Cloud**, así que T3 Code deduce los avisos. Cada comprobación busca, con el token clásico, `(assignee WAS currentUser() OR reporter = currentUser() OR watcher = currentUser()) AND updated >= -3d` (hasta 50 tickets) con el historial de cambios y los comentarios. De ahí saca: asignado o desasignado a ti, cambio de estado, comentario nuevo y mención (un nodo `mention` con tu `accountId`). Tus propias acciones se descartan. El estado leído de Jira es **solo local**.
- **Slack (solo menciones):** usa el mismo user token de «Remind» (Ajustes → Issue trackers → Slack), que ahora necesita también el scope **`search:read`**; un token conectado antes debe reinstalarse con ese scope, y mientras tanto el popover muestra el error de scope que falta. Cada comprobación llama a `auth.test` (tu id de miembro, guardado en memoria) y a `search.messages` con `<@tuId>` (las 50 más nuevas). Se descartan tus propios mensajes y los de más de 7 días. Cada fila muestra quién te mencionó, el canal (`#canal`, «Direct message» o «Group message») y el texto con las menciones y enlaces de Slack ya legibles (nombres sacados de `users.list`, en caché una hora). Pulsarla abre el permalink del mensaje. El estado leído es **solo local**, como en Jira, y la primera comprobación da por leído lo que tenga más de 24 h. Un mensaje directo sin `@mención` no aparece.
- **Límites de Jira:** solo se ven los últimos 3 días. No se detectan menciones en tickets que no te asignaron, no creaste ni sigues (Jira no permite buscarlas). No aparecen otros tipos de aviso de la campana real (reacciones, aprobaciones, avisos de Confluence...). Un ticket con muchísimos cambios puede llegar con el historial recortado. La primera comprobación da por leído todo lo que tenga más de 24 h, para no llenar el globo.
- **Datos guardados:** `userdata/issue-tracker-notifications.json` contiene solo la hora de la última comprobación y, para Jira y Slack, el sitio o la cuenta (`<workspace>:<miembro>`) y los ids leídos (se podan al salir de su ventana). Las notificaciones no se guardan: tras reiniciar se vuelven a pedir. Las credenciales son las de «Tickets de Linear y Jira» y la de Slack de «Remind», y no se registran nunca.
- **Superficies:** web y escritorio. Móvil no tiene campana (no tiene la barra lateral de escritorio). Con varios servidores, la campana usa el servidor principal o, sin él, el primero conectado.
- **Número en el icono de la app:** las sin leer de la campana aparecen también fuera de la app, en cualquier página: un círculo rojo con el número sobre el icono de la barra de tareas en Windows, el globo del Dock en macOS y el favicon en la web. Se actualiza con la misma lectura de cada minuto, no se borra al enfocar la ventana (solo al marcarlas como leídas) y desaparece al cerrar la app. Sustituye al número de upstream, que contaba avisos de escritorio de hilos y se borraba al enfocar: los avisos de hilos siguen saliendo, pero ya no tocan el número.

| Parte     | Archivos nuevos                                                                                                                                                                                                                                              |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Contratos | `packages/contracts/src/issueTrackerNotifications.ts` (`NotificationSource`: linear, jira, slack)                                                                                                                                                            |
| Servidor  | `apps/server/src/issueTrackers/IssueTrackerNotifications.ts` (servicio y sondeo), `notificationEvents.ts` (Linear y derivación de eventos de Jira) (+ test), `apps/server/src/slack/slackMentions.ts` (menciones de Slack y texto legible) (+ test)          |
| Web       | `apps/web/src/state/issueTrackerNotifications.ts`, `components/sidebar/SidebarIssueNotifications.tsx`, `SidebarIssueNotifications.logic.ts` (+ test), `useCheckCommentInThread.ts`, `components/issues/useIssueThreads.ts` (compartido con la página Issues) |

| Toca (archivos oficiales)                             | Qué añade                                                                               |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `packages/contracts/src/rpc.ts`                       | import, 2 métodos (`issueTrackers.getNotifications`, `.mutateNotifications`) y registro |
| `packages/contracts/src/index.ts`                     | `export * from "./issueTrackerNotifications.ts"`                                        |
| `apps/server/src/auth/RpcAuthorization.ts`            | permisos (leer: orchestration read; marcar: operate)                                    |
| `apps/server/src/observability/RpcInstrumentation.ts` | categoría de los 2 métodos                                                              |
| `apps/server/src/server.ts`                           | import y capa `IssueTrackerNotifications.layer`                                         |
| `apps/server/src/ws.ts`                               | import, `yield*` del servicio y los 2 handlers                                          |
| `apps/server/src/ws.test.ts`                          | import y `Layer.mock(IssueTrackerNotifications)`                                        |
| `apps/server/src/issueTrackers/linearApi.ts`          | devuelve también `graphql`                                                              |
| `apps/server/src/issueTrackers/jiraApi.ts`            | devuelve también `request` y `readJson`                                                 |
| `apps/web/src/components/sidebar/SidebarChrome.tsx`   | import y `<SidebarIssueNotificationsItem />` tras el botón de Uso                       |
| `apps/web/src/routes/__root.tsx`                      | import y `<IssueNotificationsBadgeCoordinator />` en `appHosts`                         |
| `apps/web/src/threadNotifications.ts`                 | `setNotificationBadge` (hilos) queda vacío; el dibujo pasa a `showNotificationBadge`    |
| `apps/desktop/src/ipc/methods/notificationBadge.ts`   | ya no borra el número al enfocar una ventana (+ test ajustado)                          |

También cambia archivos del fork: `slackApi.ts` añade `identity` y `searchMentions`, `SlackService.ts` usa `slackDisplayName`, y `SlackSettingsSection.tsx` pide el scope `search:read`.

Probar sin credenciales: los mocks de «Tickets de Linear y Jira» ya sirven notificaciones (Linear: 4, una leída; Jira: asignación, cambio de estado, mención y un comentario antiguo; tu propio comentario no aparece). `curl http://127.0.0.1:4567/mock/notify` añade un comentario nuevo en Linear y `curl http://127.0.0.1:4568/mock/notify` uno en Jira; se ven tras pulsar refrescar o en la siguiente comprobación. Si otro checkout ya usa los puertos 4567/4568, `MOCK_LINEAR_PORT` y `MOCK_JIRA_PORT` los cambian (ajusta `T3CODE_LINEAR_API_URL` y el sitio de Jira). Slack: `node docs/personal/mock-slack.mjs` y dev con `$env:T3CODE_SLACK_API_URL = 'http://127.0.0.1:4569/api'`; conecta con el token `xoxp-test` y el mock sirve 4 menciones (una tuya, que no aparece, y una de ayer, que sale leída). `curl http://127.0.0.1:4569/mock/mention` añade una nueva. Tests: `vp test run apps/server/src/issueTrackers/notificationEvents.test.ts apps/server/src/slack/slackMentions.test.ts apps/web/src/components/sidebar/SidebarIssueNotifications.logic.test.ts`. `search.messages` sigue la documentación de la Web API de Slack y solo se ha ejecutado contra el mock. La consulta y las mutaciones de Linear se comprobaron contra su esquema GraphQL; la búsqueda de Jira, contra su API REST v3. Ambas se han ejecutado solo contra los mocks.

### Gestor de orgs de Salesforce en el panel del hilo

Qué hace: en hilos cuya carpeta es un proyecto Salesforce DX (tiene `sfdx-project.json`), el panel del hilo muestra la **org por defecto** del workspace (la que usan los agentes cuando ejecutan `sf` sin `-o`), con su tipo (**PROD** en rojo, Dev Hub, Sandbox, Scratch) y un punto de estado (verde conectada, rojo con error, gris sin comprobar). En carpetas que no son DX no aparece nada.

- **Cambiar de org:** clic en la fila → buscador con todas las orgs autenticadas → elegir una ejecuta `sf config set target-org` en la carpeta del hilo (escribe `.sf/config.json`). Elegir una org de producción (o Dev Hub) pide confirmación explícita.
- **Añadir org:** «Add org…» → alias (se valida que no exista), URL de login (Production/Developer, Sandbox o URL propia) y «Set as default» → `sf org login web`. Muestra «Waiting for login in the browser…» con **Cancel login**, que mata el proceso y libera el puerto 1717.
- **Favoritas:** la estrella de «Manage orgs…» marca o desmarca una org como favorita. Las favoritas salen arriba del todo, en ese diálogo y en el buscador de la fila (con una estrella). Se guardan por usuario de Salesforce en `userdata/salesforce-favorites.json`, compartidas por todos los proyectos y clientes del servidor.
- **Manage orgs…:** lista con alias, usuario, URL, estado y último uso. Clic en la fila la fija como org por defecto (producción pide confirmación). Acciones por org: favorita, abrir en el navegador (`sf org open`, el CLI abre el navegador y la URL con sesión nunca llega a T3 Code), re-autenticar (si no está conectada; reutiliza alias y URL), copiar usuario y cerrar sesión (con confirmación).
- **Open instance:** el enlace pequeño bajo la org abre esa org, ya con la sesión iniciada, en el navegador integrado del hilo (panel derecho). El servidor ejecuta `sf org open --url-only` y devuelve la URL de acceso; la web la abre como pestaña del navegador sin guardarla en recientes ni en el historial (lleva una sesión). Si el navegador integrado no está disponible, la abre en el navegador del sistema. Tarda lo que tarde `sf` (30–50 s en este equipo si coincide con la comprobación de estados). Lógica en `useOpenSalesforceOrgInBrowser.ts`; `parseOrgOpenUrl` (`sfCli.ts`, con test) solo acepta URLs `https://`.
- **Sincronización:** el servidor vigila (solo lectura) `<proyecto>/.sf/`, la carpeta del proyecto, `~/.sf/` y `~/.sfdx/`. Un cambio hecho desde VS Code o la terminal se ve en unos segundos (medido: menos de 7 s).
- **Carga:** primero la lista rápida (`--skip-connection-status`, ~15 s en este equipo), después los estados en segundo plano (`sf org list`, 20–45 s con 23 orgs). El resultado queda en memoria por carpeta; la web lo lee cada 3 s sin lanzar `sf`.
- **Seguridad:** `sf org list --json` incluye `accessToken`; el parser (`parseOrgList`) solo deja pasar una lista blanca de campos, con un test que lo comprueba. El runner de procesos solo registra el nombre del comando, no la salida. No se leen los archivos de `~/.sfdx/` con tokens.
- Sin `sf` instalado, la fila muestra «Salesforce CLI not found» con instrucciones. La fila se oculta con clic derecho en el panel → «Salesforce org».

| Parte     | Archivos nuevos                                                                                                                                                                                                                                 |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contratos | `packages/contracts/src/salesforce.ts`                                                                                                                                                                                                          |
| Servidor  | `apps/server/src/salesforce/sfCli.ts` (ejecuta `sf --json`, parser sin secretos) (+ test), `SalesforceService.ts` (caché por carpeta, vigilancia, escrituras en serie, login cancelable, favoritas)                                             |
| Web       | `apps/web/src/state/salesforce.ts`, `components/chat/ThreadDetailsSalesforceRow.tsx`, `SalesforceOrgsDialog.tsx`, `SalesforceLoginDialog.tsx`, `SalesforceOrgParts.tsx`, `salesforceOrgs.logic.ts` (+ test), `useOpenSalesforceOrgInBrowser.ts` |

| Toca (archivos oficiales)                             | Qué añade                                                                         |
| ----------------------------------------------------- | --------------------------------------------------------------------------------- |
| `packages/contracts/src/rpc.ts`                       | import, `salesforce.getState` y `salesforce.mutate` (métodos, `Rpc.make`, grupo)  |
| `packages/contracts/src/index.ts`                     | `export * from "./salesforce.ts"`                                                 |
| `apps/server/src/auth/RpcAuthorization.ts`            | permisos (leer: orchestration read; modificar: operate)                           |
| `apps/server/src/observability/RpcInstrumentation.ts` | categoría de los 2 métodos                                                        |
| `apps/server/src/server.ts`, `ws.ts`, `ws.test.ts`    | capa del servicio, handlers y mock                                                |
| `apps/web/src/components/chat/threadDetailsItems.ts`  | elemento `salesforce` del menú «Choose what to show»                              |
| `apps/web/src/components/chat/ThreadDetailsPanel.tsx` | import y la fila (que pinta su propia sección), con `threadId` para Open instance |

Limitaciones: no hay comandos en la paleta de comandos (es un archivo oficial de 3.000 líneas muy cambiante; el selector de la fila cubre lo mismo). No está implementado el login por device code (`sf org login device`). Cerrar sesión y abrir org no se han probado contra orgs reales, por seguridad. Probado en el proyecto real `PROPERTI`: org por defecto correcta, cambio DEV ↔ QA2 (restaurado a QA2), cambio externo reflejado, confirmación de PROD (cancelada), estados reales de las 23 orgs, diálogo de re-autenticación y login iniciado y cancelado (proceso terminado, puerto 1717 libre, sin org añadida). Ningún token en registros ni trazas.

### IDs de Salesforce clicables en el chat

Qué hace: en los mensajes de un hilo (tuyos y del agente) cuya carpeta es un proyecto Salesforce DX, los IDs de registro aparecen subrayados con puntos. Un clic abre un menú con las orgs autenticadas: primero la **org por defecto** del workspace (con ✓), después las favoritas (★) y el resto, cada una con su tipo (**PROD** en rojo) y su estado. Elegir una ejecuta `sf org open --target-org <org> --path /<id>` en el servidor: el CLI abre el navegador y la URL con sesión nunca llega a T3 Code. Sirve para abrir el registro en cualquier org, no solo en la del hilo. El menú tiene buscador y «Copy ID».

- **Qué se detecta** (`salesforceRecordIds.logic.ts`): palabras sueltas de 15 o 18 caracteres alfanuméricos que empiezan por dígito o minúscula (prefijos estándar `001`, `500`… y personalizados `a0X`, `m00`…). Las de 18 deben tener el **checksum** correcto (los 3 últimos caracteres). Las de 15, al no tener checksum, deben tener los ceros reservados en las posiciones 6-8 y alguna letra fuera de `a-f`: así no casan SHA de git, hashes hex, números ni palabras. Nada pegado a `_`, `-` u otras letras.
- **Dónde no se detecta:** bloques de código (se copian como código), enlaces y botones. El código en línea sí, solo si contiene un ID y nada más (los agentes suelen escribir `` `001…` ``).
- **Cuándo no aparece:** fuera de un proyecto DX, sin `sf` instalado (el ID queda como texto) o en markdown que no es un mensaje de hilo (descripciones de PR, vistas de archivos).
- **Rendimiento:** la detección es un plugin rehype que corre al parsear el mensaje, y el parse ya está en la caché compartida del renderizador. Cada ID lee un booleano de una consulta (`salesforce.getState`) que deja de repetirse en cuanto termina la comprobación del CLI. La lista completa de orgs solo se consulta (cada 3 s) mientras el menú está abierto.

| Parte     | Archivos nuevos                                                                                                    |
| --------- | ------------------------------------------------------------------------------------------------------------------ |
| Contratos | `packages/contracts/src/salesforce.test.ts`                                                                        |
| Web       | `apps/web/src/components/chat/salesforceRecordIds.logic.ts` (+ test), `components/chat/SalesforceRecordIdLink.tsx` |

| Toca                                                     | Qué añade                                                                                                                        |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/components/ChatMarkdown.tsx`               | 2 imports, `rehypeSalesforceRecordIds` en las 2 listas de plugins rehype, `useSalesforceRecordTarget` y el spread de componentes |
| `packages/contracts/src/salesforce.ts` (fork)            | `SalesforceRecordId` y `recordId` opcional en la mutación `open`                                                                 |
| `apps/server/src/salesforce/SalesforceService.ts` (fork) | `--path /<id>` en `open`                                                                                                         |
| `apps/web/src/state/salesforce.ts` (fork)                | consulta `recordLinks`                                                                                                           |

Tests: `vp test run apps/web/src/components/chat/salesforceRecordIds.logic.test.ts packages/contracts/src/salesforce.test.ts`. Para probarlo en dev con Replay, edita temporalmente el texto de `apps/server/scripts/dev-replay/command_output_transcript.ndjson` para que incluya un ID, crea un hilo en una carpeta con `sfdx-project.json` (`node src/bin.ts thread start --base-dir <.t3> --provider devReplay --model command-output <carpeta> "..."`) y revierte el transcript. Probado así contra las orgs reales de este equipo: detección (ID de 18 y código en línea enlazados; bloque SQL, SHA y un 18 con checksum erróneo no), orden con la org por defecto primero y apertura en la sandbox `Properti DEV` con un ID inexistente (`sf org open --path` correcto, ~35 s). Limitaciones: un ID de 15 caracteres atípico sin los ceros reservados no se enlaza; no hay entrada en la paleta de comandos.

### Salesforce Export en el panel derecho

Qué hace: una pestaña **Salesforce Export** en el panel derecho del hilo (junto a Browser, Terminal, Files, Diff, Device y Side chat; atajo `E` en el selector) inspirada en el «Data Export» de Salesforce Inspector. Ejecuta SOQL contra la **org por defecto del hilo** (la de la fila Salesforce del panel de detalles) y muestra el resultado en una tabla. Sin proyecto DX, sin `sf` o sin org, la pestaña explica qué falta y remite a esa fila.

- **Editor:** pestañas de consulta (+ para añadir, × para cerrar; cada una se llama como el objeto de su `FROM`), «Clear» y `Ctrl+Enter` para ejecutar. «Templates» trae consultas habituales; «History» guarda las últimas 30 de **cada org**; «Saved» guarda consultas con la etiqueta de «Query label» → «Save query». Pestañas, historial, guardadas e interruptores viven en el `localStorage` del navegador (`t3code:salesforce-export:v1`), compartidos por todos los hilos.
- **Interruptores:** «Deleted/archived records» usa `queryAll`; «Tooling API» usa `/tooling/` (los dos a la vez no existen en la API, así que el primero se desactiva).
- **Run export / Stop:** pide la primera página y sigue `nextRecordsUrl` desde el cliente, página a página (2.000 registros), hasta un máximo de 50.000 (`MAX_EXPORT_RECORDS`). «Stop» deja de pedir páginas y conserva lo cargado. La línea de estado muestra «Exported N records · X ms» (o «Stopped at N of M»).
- **Query plan** (`?explain=`) y **Field info** (describe del objeto del `FROM`): se muestran compactos bajo el editor. Un clic en un campo lo inserta en el cursor (sustituto barato del autocompletado).
- **Resultados:** relaciones aplanadas (`Owner.Name`), subconsultas como JSON, tabla virtualizada (solo las filas visibles están en el DOM). Las columnas que acaban en `Id` con un ID válido abren el registro en la org del hilo (`sf org open --path`, como los IDs del chat). «Filter» filtra por todas las palabras; el ojo oculta columnas vacías. «Copy (Excel)» copia TSV, «Copy (CSV)», «Copy (JSON)» y el botón de descarga guarda un CSV; todo sobre las filas y columnas visibles.
- **Delete records:** borra los registros **mostrados** (con el filtro aplicado) con `DELETE /composite/sobjects?allOrNone=false`, de 200 en 200. Pide confirmación con el número de registros, la org y el usuario; si la org es de producción (o Dev Hub) añade un aviso rojo. Los fallos se informan por registro y los borrados desaparecen de la tabla. No disponible con Tooling API.
- **Cómo llama a la API:** el servidor obtiene token, instance URL y versión de API con `sf org display --target-org <usuario> --json` (que renueva la sesión), lo guarda en memoria y llama a la REST API con `HttpClient`. Ante un 401 lo pide de nuevo una vez. El token nunca sale del servicio (test incluido). Todo pasa por un único RPC `salesforce.data` (consulta, página siguiente, plan, describe y borrado) con permiso operate.

| Parte    | Archivos nuevos                                                                                                                                                     |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Servidor | `apps/server/src/salesforce/SalesforceDataService.ts` (+ test)                                                                                                      |
| Web      | `apps/web/src/components/salesforceExport/SalesforceExportPanel.tsx`, `SalesforceExportTable.tsx`, `salesforceExportStore.ts`, `salesforceExport.logic.ts` (+ test) |
| Mock     | `docs/personal/mock-salesforce-api.mjs`                                                                                                                             |

| Toca                                                        | Qué añade                                                                                       |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `packages/contracts/src/rpc.ts`                             | import, método `salesforce.data`, su `Rpc.make` y el registro en el grupo                       |
| `apps/server/src/auth/RpcAuthorization.ts`                  | permiso operate de `salesforce.data`                                                            |
| `apps/server/src/observability/RpcInstrumentation.ts`       | categoría del método                                                                            |
| `apps/server/src/server.ts`, `ws.ts`, `ws.test.ts`          | capa `SalesforceDataService`, handler y mock                                                    |
| `apps/web/src/rightPanelStore.ts`                           | tipo `salesforce-export` (lista de tipos, unión de superficies y `singletonSurface`)            |
| `apps/web/src/closedViewStore.ts`                           | `salesforce-export` válido al reabrir una pestaña cerrada                                       |
| `apps/web/src/components/RightPanelTabs.tsx`                | import del icono, props opcionales, entrada en los dos selectores (vacío y «+»), título e icono |
| `apps/web/src/components/chat/RightPanelSurfaceContent.tsx` | import diferido del panel y su `case`                                                           |
| `apps/web/src/components/ChatView.tsx`                      | `onAddSalesforceExport` y `salesforceExportAvailable` en `ChatRightPanel`                       |
| `packages/contracts/src/salesforce.ts` (fork)               | esquemas `SalesforceDataRequest`/`SalesforceDataResult` y el motivo de error `api`              |
| `apps/web/src/state/salesforce.ts` (fork)                   | comando `data`                                                                                  |

Probar sin org real: `node docs/personal/mock-salesforce-api.mjs` (puerto 4569, `MOCK_SALESFORCE_PORT` lo cambia; 4.500 cuentas en páginas de 2.000 con 400 ms de retardo, plan, describe de Account, error con `FORM` y un borrado que falla de cada lote) y arranca dev con `$env:T3CODE_SALESFORCE_API_URL = 'http://127.0.0.1:4569'`: con esa variable el servicio no llama a `sf org display` y **todas** las peticiones van al mock, aunque la org del hilo sea real. Comprueba primero que la tabla muestra «Mock Account …» antes de probar un borrado. Probado así (proyecto DX temporal con `target-org` = `Properti DEV` y luego `PROPERTI PROD`): exportación con LIMIT, paginación hasta 4.500, Stop a 2.000, filtro, ocultar columnas vacías, plan, field info, error de SOQL, borrado de 333 registros en 2 lotes con 2 fallos informados, aviso de producción (cancelado), historial por org, mensaje sin proyecto DX y atajo `E`. Tests: `vp test run apps/server/src/salesforce/SalesforceDataService.test.ts apps/web/src/components/salesforceExport/salesforceExport.logic.test.ts`.

Limitaciones: sin autocompletado de campos mientras se escribe (solo insertar desde Field info); los resultados son uno por panel, no por pestaña de consulta; no hay exportación Bulk API, así que el máximo práctico son 50.000 registros; no está en la app móvil ni en la paleta de comandos. Copiar y descargar no se probaron en el navegador integrado (la lógica de formatos sí tiene tests). No se ha ejecutado contra una org real.

### Tarjetas de tickets y PR bajo las respuestas del agente

Qué hace: cuando termina el turno, debajo de cada respuesta del agente aparecen tarjetas compactas con los tickets de Linear o Jira y las pull requests de GitHub que menciona. Las genera el cliente: el agente no gasta tokens ni usa herramientas.

- **Ticket:** icono del gestor, clave, título, estado (con su color), asignado y fecha de vencimiento (ver «Fecha de vencimiento de los tickets»). Acciones: abrir en el gestor y **vincular al hilo** (solo si no está ya vinculado; sustituye el vínculo manual de ese gestor, como «Change issue» del panel).
- **PR:** estado (abierta, fusionada, cerrada, borrador), título y número, `rama origen → rama destino`, CI (el mismo popover de checks que la lista de PR) y la insignia del ticket de la PR (clave en el título o la rama, como en la lista de PR). Acción: abrir, que respeta «Open pull request links in T3 Code».
- **Qué se detecta** (`replyCards.logic.ts`): URLs de Linear y Jira (la misma detección que el vínculo automático), claves sueltas en mayúsculas (`PRO-123`, también en código en línea), URLs `https://github.com/<owner>/<repo>/pull/<n>` y `PR #12` / `pull request #12`. Un `#12` suelto no cuenta: puede ser un issue, un punto de una lista o un título; con «PR» delante solo puede ser una PR, y se resuelve contra el repositorio de GitHub del proyecto del hilo (sin repositorio de GitHub, se ignora). No cuentan los bloques de código, las claves en minúsculas o dentro de rutas (`feat/pro-12`) ni las que parecen estándares (`UTF-8`, `SHA-256`, `CVE-2024-…`).
- **Límites:** como mucho 4 tarjetas por respuesta, sin repetidos; el resto se agrupa en «+N more», que despliega todas («Show fewer» las vuelve a plegar).
- **Ajustes:** Ajustes → Chat → **Reply cards**, un interruptor para tickets y otro para PR (activados por defecto).
- **Sin ruido:** sin gestor conectado, ticket inexistente o servidor sin conexión, no hay tarjeta de ticket. Una PR de un repositorio que no es un proyecto del servidor, o que no se puede leer, queda como tarjeta mínima `owner/repo #n` con el botón de abrir. Nunca se muestran errores en el chat.
- **Rendimiento:** solo en mensajes terminados cuyo turno ya acabó (nada mientras se transmite). La detección corre una vez por texto (caché). Los tickets de todo el hilo se piden en **una sola** llamada `issueTrackers.getIssues` con todas las claves de las respuestas terminadas; la lista de claves solo cambia cuando termina una respuesta nueva, así que hacer scroll o re-renderizar no repite la petición, y el servidor ya cachea cada ticket un minuto (30 min los que no existen). Cada PR lee su `pullRequests.detail`, la misma consulta cacheada (y persistida) que usan el panel y los popovers de PR; no hay endpoint por lotes para PR, y son como mucho 4 por respuesta.
- Para añadir otro tipo de tarjeta (p. ej. registros de Salesforce): un miembro nuevo en `ReplyCardRef`, su detector en `scanReplyCardRefs`, un ajuste y un `case` en `ReplyCard`.

| Parte | Archivos nuevos                                                                                                                                                                               |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web   | `apps/web/src/components/chat/replyCards.logic.ts` (+ test), `components/chat/ReplyCards.tsx`, `ReplyCardParts.tsx`, `ReplyPullRequestCard.tsx`, `components/settings/ReplyCardsSettings.tsx` |

| Toca (archivos oficiales)                                | Qué añade                                                                             |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `packages/contracts/src/settings.ts`                     | `replyCardsIssues` y `replyCardsPullRequests` en `ClientSettingsSchema` y en su patch |
| `apps/web/src/components/chat/TimelineAssistantRows.tsx` | import y `<ReplyCards row={row} />` tras el texto de la respuesta                     |
| `apps/web/src/components/settings/SettingsPanels.tsx`    | import y `<ReplyCardsSettingsSection />` en la página Chat                            |
| `apps/web/src/components/settings/settingsSearch.ts`     | 2 entradas de búsqueda                                                                |

Tests: `vp test run apps/web/src/components/chat/replyCards.logic.test.ts`. Para probarlo en dev con Replay: arranca `mock-issue-trackers.mjs` con `MOCK_LINEAR_ANY_KEY=1`, conecta Linear (`test-key`), edita temporalmente el texto de `apps/server/scripts/dev-replay/command_output_transcript.ndjson` para que incluya claves y URLs de PR, crea una carpeta con `git init` y `origin` en un repositorio público de GitHub, añádela (`node src/bin.ts project add --base-dir ../../.t3 <carpeta>`), lanza `node src/bin.ts thread start --base-dir ../../.t3 --provider devReplay --model command-output <carpeta> "..."` y revierte el transcript. Probado así con `pingdotgg/t3code`: 2 tickets y 5 PR (4 tarjetas + «+3 more», que despliega; la PR de un repositorio ajeno queda mínima), `UTF-8` ignorado, vincular desde la tarjeta (el panel y la barra lateral se actualizan al momento; tras desvincular en el panel vuelve el botón), el interruptor de Ajustes y su reset. La traza mostró 3 `getIssues` en 2 minutos para todo el hilo (al abrir, el refresco de cada minuto y al volver al hilo). Limitaciones: solo GitHub para PR; el escritorio lo hereda de la web, el móvil no lo tiene; no hay entrada en la paleta de comandos (son tarjetas pasivas, sus acciones ya existen en el panel del hilo y en la lista de PR).

### Ramas y ticket en la lista de pull requests

Qué hace: cada fila de la pantalla «Pull requests» muestra `rama origen → rama destino` en la segunda línea y, en una tercera línea propia, el **ticket** de Linear o Jira de la PR: clave, estado (con su color) y asignado. Si la PR no tiene ticket, la fila mantiene dos líneas.

- La rama destino es una insignia con color según el tipo (`targetBranchKind`): ámbar para `master`/`main`, azul para `develop`, gris para el resto. La rama origen va en texto atenuado y recortada por el medio.
- Clic (o Enter) en las insignias del ticket lo abre en el navegador sin seleccionar la PR.

- **Cómo se relaciona la PR con el ticket:** por la clave que aparece en el **título** (en mayúsculas, como `fix(PRO-2238): …` o `PRO-3853 …`) o, si no hay, en la **rama origen** (`feat/pro-2239-…` también vale). Es la convención que ya usan los títulos y ramas de Properti. No hace falta vincular nada a mano ni que Linear o Jira estén enlazados con GitHub.
- El servidor busca todas las claves de la lista en una sola petición (`issueTrackers.getIssues`): primero en Linear y, si no existe, en Jira; solo con los gestores conectados en Ajustes. Los aciertos se guardan un minuto (como en el listado de hilos) y las claves que no son tickets (`UTF-8`, `issue-123` en ramas de otros repos) 30 minutos, para no gastar el límite de peticiones de Linear. El botón de refrescar de la barra lateral vacía las dos cachés.
- Sin clave reconocible, o sin gestor conectado, la fila queda como antes.
- Para probar con PR reales sin credenciales: `$env:MOCK_LINEAR_ANY_KEY = '1'` antes de arrancar `mock-issue-trackers.mjs` hace que el mock de Linear responda a cualquier clave `PRO-`.

**Filtro por rama destino.** En «Filters» hay un submenú **Target branch** con las ramas destino de las PR cargadas; al elegir una solo quedan las PR que van a esa rama (cuenta en el número de filtros y queda en la URL como `?base=develop`).

El filtro se aplica en el cliente sobre las PR ya cargadas, sin tocar la consulta al host ni su caché (que son oficiales y cambian a menudo). Si una rama tiene PR más allá de la primera página, aparecen con «Load more». Se guarda entre sesiones junto a los demás filtros y no existe el calificador `base:` en el buscador.

**Filtro Checks → Failing / Conflicts.** El filtro oficial enviaba `status:failure` a la búsqueda de GitHub, que ignora los checks de GitHub Actions, así que «Failing» nunca devolvía nada. Ahora no se envía ese calificador y el servidor filtra cada fila por su `checksState`. Además hay una opción **Conflicts** (`checks: "conflicting"`, también `checks:conflicts` en el buscador) que deja solo las PR con conflictos de merge. Como el filtro ya no reduce la búsqueda en GitHub, una página puede traer menos filas; «Load more» trae el resto.

| Parte    | Archivos nuevos                                                                                                                                     |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web      | `apps/web/src/components/pullRequest/pullRequestTargetBranch.logic.ts` (+ test), `pullRequestIssue.logic.ts` (+ test), `PullRequestIssueBadges.tsx` |
| Servidor | `getIssues` en `IssueTrackerService.ts` y el método `issueTrackers.getIssues` (ver la tabla de Linear y Jira)                                       |

| Toca (archivos oficiales)                                           | Qué añade                                                                                                                 |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/components/pullRequest/PullRequestRow.tsx`            | imports, `PullRequestTargetBranches` en la línea de metadatos y `PullRequestIssueLine` como `footer`                      |
| `apps/web/src/components/pullRequest/PullRequestListRow.tsx`        | prop opcional `footer` en `PullRequestRowLines` (tercera línea)                                                           |
| `packages/contracts/src/pullRequest.ts`                             | valor `conflicting` en `PullRequestListFilters.checks`                                                                    |
| `packages/source-control-github/src/server/GitHubPullRequestApi.ts` | sin calificador `status:`; `conflicting` compara `mergeability`                                                           |
| `apps/server/src/pullRequest/PullRequestService.ts`                 | `matchesRowFilters`: `conflicting` compara `mergeability`                                                                 |
| `packages/client-runtime/src/pullRequestQuery.ts`                   | `checks:conflicts` en el buscador                                                                                         |
| `apps/mobile/src/features/pull-requests/*`                          | opción «Conflicts» y su filtro local                                                                                      |
| `apps/web/src/components/pullRequest/PullRequestListFilters.tsx`    | icono, constante `ANY_TARGET_BRANCH`, 3 props opcionales, contador y submenú                                              |
| `apps/web/src/components/pullRequest/PullRequestsPage.tsx`          | imports, `base` en `updateSearch`, filtrado de grupos, props del menú y `PullRequestIssuesProvider` alrededor de la lista |
| `apps/web/src/components/pullRequest/pullRequestListPreferences.ts` | campo `base` guardado con las demás preferencias                                                                          |
| `apps/web/src/components/pullRequest/usePullRequestListView.ts`     | campo `base` en `PullRequestsSearch`                                                                                      |
| `apps/web/src/routes/_chat.pull-requests.tsx`                       | lectura del parámetro `base` de la URL                                                                                    |

### Atajos de revisión en la lista de pull requests

Qué hace: a la derecha de cada fila de la página **Pull requests** aparecen, solo cuando aplican, dos botones:

- **Address review** (llave inglesa): en PR abiertas con «changes requested». Un clic busca el hilo de esa PR y le envía un turno que pide al agente leer los comentarios de revisión sin resolver, aplicar los cambios, pasar las comprobaciones y hacer commit y push, con la URL de la PR. Orden de búsqueda: hilo vinculado a la PR (`pullRequests`, `linkedPullRequest`, `branchPullRequest`), luego hilo en la rama de la PR (primero el mismo proyecto; un mismo repo suele estar añadido como varios proyectos) y luego hilo vinculado al ticket de la PR (`getThreadSummaries`); gana el más reciente. Una rama igual a la base (PR desde `main` de un fork) no cuenta. Sin hilo, prepara un **worktree en la rama de la PR** (`git.preparePullRequestThread`, como «Check out PR into thread»), crea el hilo «Address review on #N» con el modelo y el modo por defecto del proyecto, le envía el mismo turno, vincula la PR y el ticket y lo abre. Si no hay ningún modelo disponible, deja el prompt en un borrador sobre ese worktree.
- **Remind** (campana): en PR abiertas sin aprobar con revisores pedidos que aún no han revisado (GitHub quita la petición en cuanto el revisor revisa, así que se usa `reviewRequestLogins`; el autor queda fuera). Abre un popover con un mensaje corto e informal elegido al azar entre plantillas (nombre de pila del revisor si GitHub lo da, y la URL), editable, con «Another message» para cambiarlo y **Send**. Tras enviar, un toast confirma a quién. Sin Slack conectado, el botón lleva a Ajustes.

**Slack:** Ajustes → Issue trackers → **Slack**. El servidor de T3 no puede usar el conector de Slack de Claude, así que usa un **user token** propio: crea una app en <https://api.slack.com/apps>, añade los _User Token Scopes_ `chat:write`, `im:write`, `users:read`, `users:read.email` y `search:read` (este último para las menciones de la campana), instálala en el workspace y pega el _User OAuth Token_ (`xoxp-…`). Se valida con `auth.test` y se guarda en `userdata/secrets/slack-user-token.bin`. El mensaje sale como tú: `conversations.open` + `chat.postMessage` al DM del revisor.

Cómo se encuentra al revisor en Slack: 1) el mapeo manual (`slack-reviewers.json` en `userdata`, login de GitHub → email o ID de miembro de Slack); 2) si no hay, `users.list` (caché de 10 min) buscando un único miembro activo cuyo handle sea el login de GitHub o cuyo nombre sea el nombre de GitHub; con cero o varios candidatos no adivina. Si falla, el popover pide el email de Slack del revisor, lo resuelve con `users.lookupByEmail` y lo recuerda. La sección de Slack en Ajustes lista, añade y borra mapeos.

| Parte     | Archivos nuevos                                                                                                                                                       |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contratos | `packages/contracts/src/slack.ts`                                                                                                                                     |
| Servidor  | `apps/server/src/slack/SlackService.ts`, `slackApi.ts` (+ `SlackService.test.ts`)                                                                                     |
| Web       | `components/pullRequest/PullRequestReviewActions.tsx`, `pullRequestReviewActions.logic.ts` (+ test), `components/settings/SlackSettingsSection.tsx`, `state/slack.ts` |
| Mock      | `docs/personal/mock-slack.mjs`                                                                                                                                        |

También cambia archivos del fork: `PullRequestIssueBadges.tsx` exporta `usePullRequestIssue`, e `IssueTrackersSettings.tsx` muestra la sección de Slack.

| Toca (archivos oficiales)                                                                                   | Qué añade                                                          |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `packages/contracts/src/pullRequest.ts`                                                                     | campo opcional `reviewRequestLogins` en `PullRequestListEntry`     |
| `apps/server/src/pullRequest/PullRequestService.ts`                                                         | rellena `reviewRequestLogins` en cada entrada de la lista          |
| `packages/contracts/src/rpc.ts`, `index.ts`                                                                 | `slack.getState` y `slack.mutate`, export de `slack.ts`            |
| `apps/server/src/{server,ws,ws.test}.ts`, `auth/RpcAuthorization.ts`, `observability/RpcInstrumentation.ts` | una línea de registro cada uno                                     |
| `apps/web/src/components/pullRequest/PullRequestRow.tsx`                                                    | import y `<PullRequestReviewActions />` antes de las speed actions |
| `apps/web/src/components/settings/settingsSearch.ts`                                                        | entrada de búsqueda «Slack»                                        |

Probar sin Slack real: `node docs/personal/mock-slack.mjs` (puerto 4569, token `xoxp-test`, miembros `ada@example.com`, `grace@example.com`…; `GET /mock/sent` lista lo enviado) y arranca dev con `$env:T3CODE_SLACK_API_URL = 'http://127.0.0.1:4569/api'`. Para la lista, añade una carpeta con `git init` y `origin` en `https://github.com/pingdotgg/t3code.git` y busca una PR con cambios pedidos y revisor pendiente (por ejemplo #31721). **Antes de probar «Address review» pon `"defaultModelSelection": {"instanceId": "devReplay", "model": "command-output"}` en `.t3/userdata/settings.json`**: sin hilo que coincida, el botón crea un hilo y arranca un turno real con el modelo por defecto (en una prueba sin ese ajuste arrancó Codex). Probado así: los botones solo salen en las filas que aplican; «Remind» sin Slack abre Ajustes; conectar con el mock; revisor desconocido → pide email → enviado y mapeo guardado; segundo envío sin pedir email; toast «Reminder sent to Ada on Slack»; «Another message» cambia el texto; «Address review» con un hilo Replay en la rama de la PR (en otro proyecto del mismo repo) le envía el turno y lo abre; sin hilo, crea el worktree `t3code/pr-31721/…`, el hilo y arranca el turno. Tests: `vp test run apps/server/src/slack/SlackService.test.ts apps/web/src/components/pullRequest/pullRequestReviewActions.logic.test.ts`.

Limitaciones: la API de Slack solo se ha probado contra el mock (las llamadas siguen la documentación de la Web API). Los revisores pedidos solo salen de proveedores que los informan (GitHub sí; en Bitbucket y Azure DevOps la lista incluye a quien ya aprobó, aunque el botón desaparece al aprobarse la PR); los equipos pedidos como revisores no cuentan. «Address review» no pregunta aunque haya varios hilos candidatos, y el vínculo al ticket no se ha probado en la app (la PR de prueba no tenía clave). No existe en la app móvil ni en la paleta de comandos.

### Página de tickets: empezar un hilo desde un ticket

Qué hace: el icono del ticket en la parte inferior de la barra lateral (junto a «Pull requests») abre la página **Issues** (`/issues`), fuera de cualquier conversación. Sin ningún gestor conectado, la página lo explica y lleva a Ajustes → Issue trackers.

- **Pestañas Linear y Jira:** solo las de los gestores conectados (con uno solo, no hay pestañas). La pestaña queda en la URL (`?tracker=jira`).
- **Lista:** sin texto muestra los **30 tickets actualizados más recientemente** del gestor, de cualquier persona y estado (Linear: `issues(orderBy: updatedAt)`; Jira: `updated >= -90d ORDER BY updated DESC`, porque Jira rechaza las JQL sin límite). Es `scope: "recent"` en `issueTrackers.search`; sin `scope`, la consulta vacía sigue dando tus abiertos, que es lo que usa el diálogo de vincular. El buscador busca mientras escribes, con la misma espera y la misma búsqueda que el diálogo de vincular (`useIssueSearch.ts`). Una URL o clave pegada encuentra ese ticket. Cada fila muestra clave, título, estado con su color, asignado, **proyecto** (Linear: el proyecto; Jira: el proyecto del ticket; clic lo abre), fecha de vencimiento y hace cuánto se actualizó. Clic en la clave abre el ticket en el gestor.
- **Filtros:** el botón de **proyecto** junto al buscador (carpeta, «All projects» o el nombre elegido) filtra por proyecto; por defecto viene puesto **Salesforce** en Linear y **Proyecto Salesforce** en Jira (`DEFAULT_ISSUE_PROJECTS` en `issuesPage.logic.ts`). El botón «Filters» filtra por **asignado** (a mí, a otras personas, sin asignar) y por **estado**; su «Clear filters» no toca el proyecto. Varios valores del mismo tipo se suman y los tipos se combinan. **Se recuerdan** por gestor en el `localStorage` del navegador (`t3code:issues-filter:<gestor>:v2`; el `v2` hizo que el proyecto por defecto se aplicara una vez sobre los filtros guardados antes), como los filtros de la página de pull requests: siguen ahí al cerrar la pantalla o la app, pero no viajan a otro navegador o dispositivo. «A mí» compara el nombre del asignado con el de la cuenta conectada (Linear `viewer.name`, Jira `myself.displayName`), porque los gestores solo envían el nombre del asignado.
- **Pull requests del ticket:** si hay PR cuyo título o rama origen nombra la clave (la misma regla que las insignias de ticket en la lista de PR, `pullRequestIssueKey`), la fila muestra una tercera línea con hasta 3 (abiertas primero): icono de estado (abierta, borrador, fusionada, cerrada), número y título, checks y revisión, con los mismos iconos que la página de PR. Clic abre la PR en esa página. Se leen con una sola lista por servidor (`state: "all"`, 99 PR, la misma consulta que usa la página de PR), no una petición por ticket.
- **Go to thread:** si el ticket ya tiene hilo, el botón de la derecha pasa de «Start thread» a «Go to thread» y lleva al hilo más reciente (con varios, un menú del más reciente al más antiguo; los archivados no cuentan). Cuenta como hilo del ticket: el vinculado (a mano o detectado y recordado, de `getThreadSummaries`, lo que ya carga la barra lateral) y el que nombra la clave en su **rama** (`feat/pro-12-…`, sin distinguir mayúsculas) o en su **título**. Solo se leen los hilos ya cargados en el cliente, sin peticiones por fila ni lectura de mensajes, así que una clave que solo aparece en los mensajes no cuenta hasta que el hilo se vincula. Una clave en una rama o título vale para Linear y Jira, porque no dice de qué gestor es.
- **Start thread:** pide el proyecto (con buscador) y abre un borrador en un **worktree nuevo** con el prompt `Work on PRO-123: <título>` y la URL del ticket. **No se envía**: lo revisas y lo envías tú. El ticket se vincula al hilo en ese momento (vínculo manual), porque la detección automática por la URL del prompt solo se ejecuta con el panel del hilo abierto; así la fila pasa a «Go to thread» en cuanto envías el borrador. Un borrador que nunca se envía deja un vínculo huérfano que no se muestra.
- **Refrescar:** el botón de la cabecera (arriba a la derecha) vuelve a pedir la lista de tickets, las opciones de filtro y las PR de los tickets; antes vacía la caché de PR del servidor (`pullRequests.invalidate`), igual que el refresco de la página de PR. La lista vive en `IssueList`, así que el botón se pinta en la cabecera con un portal. En la página **Pull requests** el botón de refrescar oficial también pasa a la cabecera, siempre visible, en vez de la fila de filtros (ver la tabla «Toca»).
- **Nombre de la rama:** lo decide el ajuste de nombres de rama de worktree (Ajustes → Worktrees, instrucciones propias). Para que empiece por la clave, añade allí una instrucción como «start the branch name with the issue key, for example pro-123-short-title».

| Parte | Archivos nuevos                                                                                                                                                          |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Web   | `apps/web/src/routes/_chat.issues.tsx`, `components/issues/IssuesPage.tsx`, `IssuePullRequests.tsx`, `issuesPage.logic.ts` (+ test), `components/chat/useIssueSearch.ts` |

También cambia archivos del fork: `IssueTrackerLinkDialog.tsx` usa `useIssueSearch`, y el atom de tickets por hilo pasó de `SidebarIssueControls.tsx` a `state/issueTrackers.ts` (`threadIssuesAtom`) para que la página y el filtro de la barra lateral lean lo mismo.

| Toca (archivos oficiales)                                    | Qué añade                                                                                     |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `apps/web/src/components/sidebar/SidebarChrome.tsx`          | icono `TicketIcon` y el botón «Issues»                                                        |
| `apps/web/src/components/sidebar/mainAppLocation.ts`         | `/issues` cuenta como página de utilidad («Back»)                                             |
| `apps/web/src/components/pullRequest/PullRequestsColumn.tsx` | el botón de refrescar siempre en la cabecera (arriba a la derecha) y no en la fila de filtros |
| `apps/web/src/routeTree.gen.ts`                              | generado por el plugin de TanStack Router                                                     |

Probar: con los mocks de `mock-issue-trackers.mjs` (ver la sección de Linear y Jira), abre Issues, pulsa «Start thread» en un ticket, elige proyecto, envía el borrador con `Replay (dev)` y vuelve a Issues: la fila muestra «Go to thread». El campo opcional `project` de `TrackerIssue` (contratos) lo rellenan `linearApi.ts` (`project { name url }`) y `jiraApi.ts` (campo `project`, URL `<sitio>/browse/<clave del proyecto>`). Tests: `vp test run apps/web/src/components/issues/issuesPage.logic.test.ts`.

Limitaciones (fase 1): el prompt solo lleva clave, título y URL (ni descripción ni comentarios); no hay entrada en la paleta de comandos ni se recuerda el proyecto por equipo; no existe en la app móvil.

### Acceso directo a tareas programadas

Qué hace: el icono del calendario con reloj en la parte inferior de la barra lateral (entre «Issues» y «Usage») abre Ajustes → **Scheduled tasks** (`/settings/scheduled-tasks`) en un clic. Se muestra siempre, igual que la entrada de Ajustes; los permisos de crear tareas los sigue decidiendo esa página. En la paleta de comandos ya aparece «Scheduled tasks» (sale de la búsqueda de ajustes), así que no hay entrada nueva ni atajo de teclado.

| Toca (archivos oficiales)                           | Qué añade                                              |
| --------------------------------------------------- | ------------------------------------------------------ |
| `apps/web/src/components/sidebar/SidebarChrome.tsx` | icono `CalendarClockIcon` y el botón «Scheduled tasks» |

### Icono de scheduler en el listado de hilos

Qué hace: los hilos en los que corre una tarea programada (la tarea los tiene como hilo asociado) llevan un calendario con reloj verde justo antes del título. Si todas sus tareas están desactivadas, el verde sale apagado. Al pasar el ratón se ve el nombre de cada tarea, su frecuencia y si está en pausa. Los datos salen de la misma suscripción en vivo que usa Ajustes → Scheduled tasks (una por entorno, compartida por todas las filas). Las tareas sin hilo fijo, que crean un hilo nuevo en cada ejecución, no marcan esos hilos.

| Archivo nuevo                                                    | Qué contiene            |
| ---------------------------------------------------------------- | ----------------------- |
| `apps/web/src/components/sidebar/SidebarThreadSchedulerIcon.tsx` | el icono con su tooltip |

| Toca (archivos oficiales)                              | Qué añade                                                          |
| ------------------------------------------------------ | ------------------------------------------------------------------ |
| `apps/web/src/components/sidebar/SidebarThreadRow.tsx` | import y `<SidebarThreadSchedulerIcon>` antes de los dos `{title}` |

### Copiar el nombre de una rama desde el selector

Qué hace: cada fila del desplegable de ramas lleva a la derecha un botón pequeño con el icono de portapapeles que copia el nombre completo de la rama (aunque la fila lo muestre recortado) y cambia a un check un momento. Pulsarlo no selecciona la rama ni cierra el desplegable, y funciona también en filas deshabilitadas. Sale en todos los selectores que usan `BranchPickerRefItem`: el de la barra de ramas del hilo y el de rama base del worktree en Ajustes → Scheduled tasks. Las filas «Create new ref» no lo llevan.

| Archivo nuevo                                  | Qué contiene                                            |
| ---------------------------------------------- | ------------------------------------------------------- |
| `apps/web/src/components/BranchCopyButton.tsx` | el botón, que frena sus eventos para no activar la fila |

| Toca (archivos oficiales)                  | Qué añade                                              |
| ------------------------------------------ | ------------------------------------------------------ |
| `apps/web/src/components/BranchPicker.tsx` | import y `<BranchCopyButton>` en `BranchPickerRefItem` |

### Ir al ticket y a las PR desde el menú del hilo

Qué hace: el menú contextual del hilo (clic derecho en la barra lateral, o el menú de la cabecera del chat) muestra, justo encima de «Rename thread»:

- «Go to ticket» si el hilo tiene un ticket de Linear o Jira vinculado. Usa el primer ticket de los resúmenes que ya carga la lista de hilos (el mismo que pintan sus insignias), así que no hace peticiones nuevas; si los resúmenes aún no han cargado, la opción no aparece.
- «Open PR» si el hilo tiene una PR vinculada, u «Open PRs» con un submenú si tiene varias. Cada entrada del submenú se llama por su rama destino («PR to master», «PR to develop») y lleva el número solo si dos PR van a la misma rama, o «PR #123» si aún no se conoce la rama. Usa `thread.pullRequests` sin las PR descartadas de un stack.

Todo se abre en el navegador externo. En la app de escritorio el menú es nativo y solo pintaba el icono de borrar en macOS; `forkMenuIcons.ts` añade PNG para los iconos `git-pull-request` y `external-link`, así que estas entradas llevan icono también en Windows.

| Archivo nuevo                                              | Qué contiene                                                         |
| ---------------------------------------------------------- | -------------------------------------------------------------------- |
| `apps/web/src/components/threadLinksMenu.logic.ts` (+test) | nombres de las PR, entradas «Open PR(s)» y URL de la entrada pulsada |
| `apps/desktop/src/electron/forkMenuIcons.ts`               | PNG en base64 de los iconos del menú nativo                          |

| Toca (archivos oficiales)                           | Qué añade                                                                                 |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `apps/web/src/components/threadActionMenu.logic.ts` | import, ids `open-ticket` y `open-pr*`, campos `ticketUrl` y `pullRequests`, sus entradas |
| `apps/web/src/components/Sidebar.tsx`               | imports, `ticketUrl`, `pullRequestTargets` y la apertura de ticket y PR                   |
| `apps/web/src/hooks/useThreadActionMenu.ts`         | lo mismo para el menú de la cabecera                                                      |
| `apps/web/src/contextMenuFallback.ts`               | iconos `external-link` y `git-pull-request` del menú web                                  |
| `apps/desktop/src/electron/ElectronMenu.ts`         | import y `forkMenuIcon(item.icon)` en `buildTemplate`                                     |

`readThreadIssueSummary` vive en el archivo del fork `apps/web/src/state/issueTrackers.ts`.

### Una cuenta de GitHub por repositorio

Qué hace: si `gh` tiene **varias cuentas en el mismo host** (por ejemplo `Guillermo-Miranda-01` para Properti y `GuillermoMGV` para ASTI, ver `gh auth status`), cada petición a GitHub usa la cuenta que llega a su repositorio, en vez de la cuenta activa para todo. No hay que configurar nada: basta con haber hecho `gh auth login` con cada cuenta.

- **Cómo elige la cuenta:** si el owner del repositorio se llama como una de las cuentas (repo personal, `GuillermoMGV/ASTI`), usa esa. Si no, prueba cada cuenta, la activa primero, con `gh api repos/<owner>/<repo> --jq .permissions.push` y se queda con la primera que puede hacer push; si ninguna, con la primera que puede leerlo; si ninguna lo ve, con la cuenta por defecto (la activa o la elegida en Ajustes → Source Control). El resultado se guarda una hora (un fallo, un minuto) y la lista de cuentas, 5 minutos.
- **De dónde sale el repositorio:** del `repository` (`owner/nombre`) de la llamada o, si no viene, de los remotos git del proyecto (`cwd`), con la misma regla que usa el proveedor de GitHub. Viaja a `GitHubCredentials` como la referencia `GitHubRequestRepository`, que también separa los lotes de GraphQL para no mezclar cuentas.
- **Página de pull requests:** las búsquedas «mías» de cada repositorio usan el login de su cuenta, y el servidor añade a `viewers` una entrada `"<host> <owner/nombre>"` cuando un repositorio va con otra cuenta que la de su host, para que sus PR salgan en «Authored». Con varias cuentas no se usa la búsqueda combinada de varios repositorios (`listChangeRequestsAcross`): cada repositorio se lee aparte.
- **Sin efecto con una sola cuenta por host:** al arrancar, el driver de GitHub mira `gh auth status --json hosts`; si ningún host tiene más de una cuenta, devuelve la instancia original y todo funciona como en el oficial.

| Parte    | Archivos nuevos                                                                                                                                                       |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Servidor | `packages/source-control-github/src/server/GitHubAccountRouting.ts` (elección de cuenta), `GitHubAccountRoutedInstance.ts` (envuelve los métodos del driver) (+ test) |

| Toca (archivos oficiales)                                             | Qué añade                                                                             |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `packages/source-control-github/src/server/GitHubCredentials.ts`      | `routeAccount` y `accountFor`: la cuenta enrutada antes que la elegida en Ajustes     |
| `packages/source-control-github/src/server/GitHubCredentials.test.ts` | parámetro `routing` en el arnés y tres casos                                          |
| `packages/source-control-github/src/server/gitHubGraphQlClient.ts`    | `GitHubRequestRepository` en `batchKey`                                               |
| `packages/source-control-github/src/server/driver.ts`                 | import y `withAccountRouting` sobre la instancia                                      |
| `apps/server/src/pullRequest/PullRequestService.ts`                   | viewers por repositorio en `listUncached` y su uso en `readSlice`                     |
| `apps/web/src/components/pullRequest/pullRequestList.logic.ts`        | `pullRequestEntryViewer` mira primero la clave por repositorio (+ un caso en su test) |

Probar: `vp test run packages/source-control-github/src/server/GitHubCredentials.test.ts packages/source-control-github/src/server/GitHubAccountRoutedInstance.test.ts apps/web/src/components/pullRequest/pullRequestList.logic.test.ts`. Probado en dev con los repos reales: antes, `GET /repos/guillermomgv/asti/pulls` devolvía 404 con la cuenta activa; con el cambio devuelve 200 con `GuillermoMGV`, la PR #23 de ASTI sale en «Authored» y las de `Properti-AG/salesforce` siguen saliendo con `Guillermo-Miranda-01`.

Limitaciones: una cuenta añadida con `gh auth login` mientras el servidor corre no activa el enrutado hasta reiniciar (si antes había una sola). Un token guardado en Ajustes, `GH_TOKEN` o la app «T3 Code for GitHub» siguen teniendo prioridad y no se enrutan. Las imágenes de PR sin repositorio conocido y la lista de repos para clonar usan la cuenta por defecto.

### Inventario de skills en Ajustes

Qué hace: Ajustes → Agents → **Skills** (`/settings/skills`) lista todas las skills (`<carpeta>/SKILL.md`) de la máquina del servidor, separadas en **User skills** y **Project skills**, con la papelera **Recently deleted** cuando tiene algo.

- **Dónde busca.** Usuario: `~/.claude/skills`, `~/.codex/skills`, `~/.agents/skills`, `~/.cursor/skills`, `~/.gemini/skills`, `~/.config/opencode/skills`. Gestionadas (solo lectura): las integradas de Codex (`~/.codex/skills/.system`), las sincronizadas desde claude.ai (`~/.claude/skills/synced/<bucket>`) y las de plugins de Claude (misma detección que el composer). Proyecto: `.claude/skills`, `.agents/skills`, `.cursor/skills`, `.gemini/skills` y `.opencode/skills` en la carpeta de cada proyecto no archivado de T3 Code. Las carpetas que empiezan por punto se ignoran.
- **Para qué agente.** Cada skill lleva el agente según su carpeta (Claude, Codex, Shared (.agents), Cursor, Gemini, OpenCode): es la carpeta la que decide quién la carga. Las de usuario se agrupan por agente; las de proyecto, por proyecto (desplegables), con una insignia del agente.
- **Repetidas.** Las skills con el mismo nombre (sin mayúsculas ni prefijo de plugin) llevan una insignia «×N»: azul si el contenido es igual, ámbar si difiere. El detalle dice si cada copia es un enlace a la misma carpeta, una copia idéntica o un contenido distinto, y permite saltar a ella.
- **Problemas.** Avisa de skills sin frontmatter, con YAML inválido, sin `description` o con un `name` distinto de la carpeta.
- **Resumen y filtros.** Totales, nombres repetidos, skills con problemas y los tokens aproximados (caracteres/4) que cuestan las descripciones de usuario en cada sesión de cada agente. Búsqueda por nombre, descripción o ruta, filtro por agente y vista All / Repeated / Problems. El botón de refrescar vuelve a escanear el disco.
- **Detalle.** Clic en una skill: ruta (copiable), destino si es un enlace, fecha, archivos de la carpeta con tamaño y el SKILL.md renderizado (frontmatter como bloque YAML). «Open in editor» abre el SKILL.md en el editor preferido.
- **Borrar y recuperar.** Solo las skills `local` se borran. Borrar mueve la carpeta a `userdata/skills-trash/<id>` (lista en `userdata/skills-trash.json`); si la skill es un enlace simbólico solo se quita el enlace y su destino queda intacto. Desde «Recently deleted» se restaura (falla si ya hay algo en la ruta original) o se borra para siempre.
- **Superficies.** Web y escritorio. Funciona en remoto (el servidor escanea su propia máquina). Móvil no tiene esta página.

| Parte     | Archivos nuevos                                                                                                                                                                   |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contratos | `packages/contracts/src/skills.ts`                                                                                                                                                |
| Servidor  | `apps/server/src/skills/skillsDiscovery.ts` (carpetas, frontmatter, escaneo), `SkillsService.ts` (inventario, detalle, papelera) (+ test)                                         |
| Web       | `apps/web/src/state/skills.ts`, `routes/_chat.settings.skills.tsx`, `components/settings/skills/SkillsSettings.tsx`, `SkillDetailDialog.tsx`, `skillsInventory.logic.ts` (+ test) |

| Toca (archivos oficiales)                                 | Qué añade                                                                                          |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `packages/contracts/src/rpc.ts`                           | import, 3 métodos `skills.*` en `WS_METHODS`, 3 `Rpc.make` y su registro en `WsRpcGroup`           |
| `packages/contracts/src/index.ts`                         | `export * from "./skills.ts"`                                                                      |
| `apps/server/src/auth/RpcAuthorization.ts`                | permisos (listar y leer: filesystem read; borrar/restaurar: filesystem write)                      |
| `apps/server/src/observability/RpcInstrumentation.ts`     | categoría de los 3 métodos                                                                         |
| `apps/server/src/server.ts`                               | import y capa `SkillsService.layer`                                                                |
| `apps/server/src/ws.ts`                                   | import, `yield*` del servicio, lista de proyectos (`projectService.listShells()`) y los 3 handlers |
| `apps/server/src/ws.test.ts`                              | import y `Layer.mock(SkillsService)`                                                               |
| `apps/web/src/components/settings/settingsSearch.ts`      | ruta `/settings/skills` (tipo, etiqueta, grupo Agents, ámbito) y 4 entradas de búsqueda            |
| `apps/web/src/components/settings/SettingsSidebarNav.tsx` | icono `LibraryBigIcon`                                                                             |
| `apps/web/src/routes/_chat.settings.tsx`                  | la página usa un solo entorno                                                                      |
| `apps/web/src/routeTree.gen.ts`                           | generado por el plugin de TanStack Router                                                          |

Tests: `vp test run apps/server/src/skills/SkillsService.test.ts apps/web/src/components/settings/skills/skillsInventory.logic.test.ts`. Para probar el borrado sin tocar skills reales, crea una de prueba en `~/.agents/skills/<nombre>/SKILL.md`, pulsa refrescar, bórrala, restáurala y bórrala para siempre.

Limitaciones: usa `~/.claude` y `~/.codex` aunque `CLAUDE_CONFIG_DIR`, `CODEX_HOME` o el `homePath` de Claude en T3 apunten a otra carpeta; no busca skills en subcarpetas de un proyecto (monorepos con `.claude/skills` en un paquete) ni en proyectos que no estén en T3 Code; las skills de plugins y sincronizadas no se pueden borrar desde aquí; no se pueden editar (usa «Open in editor»).

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
