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

Abre la URL de emparejamiento que imprime el runner. Incluye una credencial: no la publiques. Los puertos efectivos aparecen en `[dev-runner]`. Para Electron:

```powershell
vp run dev:desktop --home-dir .t3 --no-seed
```

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

La identidad de commits se ha configurado solo en este repo como `GuillermoMGV` con su correo noreply. El helper local `.git/credential-guillermomgv.sh` obtiene las credenciales del almacén de `gh` para esa cuenta explícita; no guarda tokens y no depende de la cuenta activa de otras terminales. Para otro ordenador, autentica `gh` con esa cuenta y configura su helper allí. La configuración Git local no viaja en los commits.

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

Requisitos oficiales: Python 3, Rust estable (al menos 1.95 para los componentes que lo exigen), target `x86_64-pc-windows-msvc`, Visual Studio Build Tools con **Desktop development with C++**, Windows SDK, MSVC y bibliotecas Spectre x64. NSIS lo descarga electron-builder. WSL no es necesario para el payload Windows; incluir el payload WSL requiere además el archivo Linux descrito en [release.md](docs/operations/release.md).

```powershell
. ./docs/personal/custom-env.ps1
rustup target add x86_64-pc-windows-msvc
vp run dist:desktop:win --arch x64
```

Los artefactos locales sin firma se generan en `release/`. El script de empaquetado invoca electron-builder con `--publish never`: compilar no publica releases. No instales la prueba encima de una instalación oficial sin revisar las colisiones de identidad y datos.

Detén el servidor de desarrollo antes de empaquetar. `--build-version` alinea temporalmente las versiones de cuatro manifiestos durante el build y después restaura sus contenidos; si dev está abierto, sus watchers reinician la aplicación. No confirmes esos cambios temporales.

Para distinguir una prueba sin cambiar nombres ni identificadores internos, puedes pasar `--build-version 0.1.9-preview.20261116.1` y elegir un directorio con `--output-dir`. Revisa primero `vp run dist:desktop:artifact --help`. El código reconoce las versiones preview y omite la configuración de publicación/actualización correspondiente. La versión y el commit de base identifican el artefacto; actualiza la versión de ejemplo cuando cambie la base.

Se conserva `com.t3tools.t3code` y el nombre oficial, tal como se solicitó. Una versión distribuible propia necesitará decidir identidad, protocolo, rutas de datos, nombre, iconos, firma y feed de actualizaciones conjuntamente. No basta cambiar el nombre del archivo: una actualización oficial podría sustituir personalizaciones si se usa su feed. `T3CODE_DESKTOP_UPDATE_REPOSITORY` configura el destino de actualizaciones cuando se decide habilitar uno propio; no se ha modificado. Una compilación local sin firma puede mostrar avisos de SmartScreen y no equivale a una release oficial firmada.

## Validación de este equipo

- Fork público creado, relación con `pingdotgg/t3code` y permiso ADMIN verificados.
- `main`, `origin/main` y `upstream/main` coinciden en la base `c24255826be5aabb0f32ee18f6ac7dec0b3f1347` descargada durante el setup. `custom` está publicada y sigue `origin/custom`.
- Dependencias instaladas con lockfile congelado; `vp run check:changed --concurrency 1` pasó. Para estos archivos de documentación y operación comprueba el formato; no se ha ejecutado toda la suite del monorepo.
- Scripts PowerShell analizados sin errores de sintaxis; se verificó que sincronizar con cambios pendientes se detiene. El entorno activado devuelve Node 26.13.1 y pnpm 12.14.0.
- Desarrollo iniciado con estado aislado en `.t3`; interfaz emparejada en Chrome, navegación, rama Git y turno gratuito Replay verificados hasta la aprobación.
- Instalados Vite+ 1.4.0, Rust 1.100.0 mediante rustup 1.29.3 y Visual Studio Build Tools 2022 17.14.45 con C++, SDK y Spectre. Python 3.11 ya estaba instalado. Monitor Rust compilado correctamente, también para `x86_64-pc-windows-msvc`.
- La dependencia móvil `react-native-enriched-markdown` mostró un aviso al extraer RaTeX para iOS en Windows. No afecta a la instalación del escritorio; iOS no se ha compilado ni probado.
- El registro del SDK apunta a `C:\Program Files\Windows Kits\10`, pero el SDK se encuentra en `C:\Program Files (x86)\Windows Kits\10`. El preflight oficial de empaquetado devuelve un falso negativo de MSVC/SDK. No se ha cambiado el registro. Rust sí compila con las herramientas instaladas. Alternativa local para empaquetar usando el monitor recién compilado:

```powershell
. ./docs/personal/custom-env.ps1
cargo build --locked --release --target x86_64-pc-windows-msvc --manifest-path native/resource-monitor/Cargo.toml
$env:T3CODE_DESKTOP_REUSE_RESOURCE_MONITOR = '1'
try {
    vp run dist:desktop:win --arch x64 --build-version 0.1.9-preview.20261116.1
} finally {
    Remove-Item Env:T3CODE_DESKTOP_REUSE_RESOURCE_MONITOR -ErrorAction SilentlyContinue
}
```

No actives reutilización sin compilar primero el monitor del commit actual. El empaquetador exige el binario en el directorio del target; no se ha sustituido por un archivo descargado ni se ha modificado el código oficial para omitir errores.

Resultado del empaquetado: frontend, servidor, Electron, monitor nativo y generación NSIS completados, pero **la compilación Windows no está validada**. El validador oficial termina con `WindowsPackagedPayloadValidationError: Windows packaged payload contains 90 files; expected at most 80`. No se ha aumentado el límite ni omitido la validación. La comprobación de ejecución del paquete sucede después de este límite y por tanto no llegó a ejecutarse. El instalador no se ha instalado, publicado ni distribuido.

La segunda ejecución usa `--skip-build --keep-stage` para conservar el paquete y estudiar el problema. Es una salida de diagnóstico, no una release verificada. Los recursos incluyen caché del servidor y varias copias de componentes nativos; no se ha determinado todavía qué exclusiones pueden cambiarse sin afectar a su carga. Para obtener un instalador validado hay que resolver ese problema de empaquetado o incorporar una corrección oficial y repetir el build completo.
