# Desarrollo personal de T3 Code

Fork: <https://github.com/GuillermoMGV/t3code>. Base oficial: <https://github.com/pingdotgg/t3code>.
Checkout: `C:\Users\Guille\Documents\Other Projects\t3code`.

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

## Problemas conocidos y limitaciones

- `vp run dev` muestra la URL de emparejamiento solo en una terminal interactiva; con la salida redirigida usa el comando `pair` de la sección de arranque.
- La dependencia móvil `react-native-enriched-markdown` avisa al extraer RaTeX para iOS en Windows durante `vp i`. No afecta al escritorio; iOS no se ha compilado ni probado.
- `vp i` puede mostrar `Agent skills awaiting approval`. Es una función de pnpm para skills de agentes incluidas en dependencias; no hace falta aprobarlas para desarrollar ni compilar.
- La cuenta activa de `gh` en este equipo es la de trabajo. Este repo no depende de ella (helper local), pero `gh` sin `--repo` o sin `GH_TOKEN` actuará con esa cuenta.
- Git del sistema es 2.36; funciona con este flujo, pero conviene actualizarlo cuando sea posible.

## Validación de este equipo (17-11-2026)

- Fork `GuillermoMGV/t3code` reutilizado: público, relación de fork con `pingdotgg/t3code` verificada. La carpeta local se había vaciado, así que se clonó de nuevo y se recreó la configuración local con los valores de `setup-local-git.ps1`.
- `main`, `origin/main` y `upstream/main` coinciden en `e8e7fb7e9a6770706d54986fcf3ca9a2d0fe3a3e` (fast-forward de 3 commits desde `c24255826b`). `main` se fusionó en `custom` sin conflictos y `custom` sigue a `origin/custom`.
- Push a `origin` autenticado como `GuillermoMGV`; push a `upstream` rechazado (`DISABLED`).
- Entorno: Vite+ 1.4.0, Node 26.13.1 y pnpm 12.14.0 desde el manifiesto; Rust 1.100.0 con target MSVC; Visual Studio Build Tools 2022; Python 3.11.
- `vp i --frozen-lockfile` completado. `vp run check:changed --concurrency 1` y `vp run typecheck` (41 paquetes, 0 errores) pasaron. No se ha ejecutado la suite completa de tests.
- Desarrollo con estado aislado en `.t3`: interfaz emparejada en el navegador, proyecto y rama Git detectados, turno gratuito `Replay (dev)` completado con streaming y título automático. Replay simula herramientas: el árbol de trabajo quedó limpio.
- Windows x64: `build-windows.ps1` generó `T3-Code-0.1.9-preview.20261117.1-x64.exe` (~200 MB). Payload validado (67 archivos, 26 nativos) y verificación oficial de Windows superada. El instalador no se ha instalado, publicado ni distribuido. arm64 no se ha probado.
- Proveedores de IA reales (Codex, Claude, Cursor, etc.) no configurados: se autentican después desde la aplicación y no forman parte de la instalación de T3 Code.
