# TRANSFER V3.6 — P2P TEXT + AUTO UPDATE + NATIVE WINDOW CHROME

Base independiente de TRANSFER.

## V3

- Conserva las interfaces específicas de iPhone, Android, Mac y Windows.
- Claro / oscuro / automático.
- WebRTC P2P real usando PeerJS para señalización.
- Cada instalación genera un ID `tr-...` persistente.
- Vinculación entre dos dispositivos con ID + PIN temporal de 6 dígitos.
- Después de vincular, se guarda un token privado distinto para ese par de dispositivos.
- Reconexión automática mientras la PWA está abierta.
- `Enviar a…` transmite texto real al dispositivo seleccionado.
- El dispositivo receptor guarda el texto en TRANSFER y lo deja listo para pulsar `Copiar`.
- Historial local de textos enviados, recibidos y dispositivos vinculados.

## Límites intencionales de esta etapa

- Los archivos todavía no se transmiten; el botón queda preparado para la siguiente etapa.
- Una PWA no puede vigilar ni escribir libremente el portapapeles del sistema en segundo plano. El pegado completamente transparente requerirá las apps/componentes nativos.
- PeerJS Cloud se usa únicamente para señalización WebRTC. Los datos P2P viajan por WebRTC entre los dispositivos cuando la ruta directa es posible.
- Algunas redes con NAT restrictivo pueden necesitar un servidor TURN propio como respaldo.
- Para la primera vinculación, ambos dispositivos deben tener TRANSFER abierto y conexión a Internet.


## V3.1

- Los botones `×` de Enviar a…, Apariencia y Vincular dispositivo cierran siempre la ventana y ya no disparan formularios.
- Tocar el fondo oscuro de una ventana modal también la cierra.
- ID y PIN tienen botones independientes: `Copiar ID` y `Copiar PIN`.
- Cada botón copia únicamente el valor correspondiente, sin etiquetas ni texto adicional.
- El campo ID limpia automáticamente textos antiguos como `TRANSFER ID: tr-...` al pegar.
- Los controles de ventana dibujados de Windows se marcan como decorativos; el cierre real de la PWA corresponde al control nativo del sistema.


## V3.2 — actualización automática

- La PWA se instala una sola vez.
- Al abrir TRANSFER ejecuta `registration.update()` con `updateViaCache: none`.
- También comprueba `version.json` con `cache: no-store`.
- Si existe un Service Worker nuevo, lo activa con `SKIP_WAITING` y recarga una sola vez.
- Al volver al primer plano y cada 5 minutos vuelve a comprobar si existe una versión nueva.
- El Service Worker usa red primero para HTML/JS/CSS/manifest/version y conserva caché como respaldo offline.
- Una actualización no borra `localStorage`: se mantienen ID, PIN, tokens de vinculación, dispositivos, tema, interfaz e historial local.
- No es necesario reinstalar la PWA después de cada versión.


## V3.3 — controles nativos de ventana

- Se eliminan de la interfaz los botones simulados de cerrar, minimizar y maximizar en Mac y Windows.
- La PWA instalada usa exclusivamente los controles reales que proporciona macOS o Windows.
- Se elimina el espacio reservado de 36 px del encabezado falso para recuperar área útil.
- La barra lateral de escritorio comienza debajo del marco real de la ventana y ocupa toda el área disponible.
- iPhone y Android no cambian.
- Se conserva la actualización automática de V3.2 y todos los datos locales.


## V3.6 — Bridge Mac HTTPS

- Añade integración con el helper local `TRANSFER Mac Bridge` en `127.0.0.1:8765`.
- El helper vigila el portapapeles real de macOS continuamente.
- TRANSFER detecta el último texto sin depender del permiso Clipboard API del navegador.
- Cuando un texto llega por P2P a la Mac, TRANSFER lo escribe al portapapeles del sistema a través del bridge.
- Los textos detectados en Mac se envían automáticamente a Android/Windows que estén conectados.
- Se mantiene el botón Pegar en escritorio como respaldo manual.
- El bridge guarda el último texto aunque la PWA esté cerrada; la sincronización P2P automática aún requiere TRANSFER abierta en esta etapa.


### Corrección V3.6

- El Bridge conserva HTTP en `127.0.0.1:8765` para diagnóstico y añade HTTPS en `127.0.0.1:8766`.
- La PWA intenta primero HTTPS para evitar el bloqueo del WebKit/Safari al acceder desde GitHub Pages a un servicio HTTP local.
- Se mantiene fallback HTTP para otros navegadores.
- `fetch()` marca explícitamente el destino como `loopback` cuando el navegador soporta Local Network Access.
- No se toca ningún componente EGP / Logic Bridge.


## V3.7 - Android nativo

- Recibido por P2P en la app Android nativa -> portapapeles real Android automático.
- Copiar en otra app Android -> al volver a TRANSFER se detecta sin tocar Pegar.
- El texto detectado en Android se envía automáticamente a Mac/Windows conectados.
- Se evita el rebote del mismo texto al escribirlo desde TRANSFER al portapapeles Android.
- La PWA normal conserva Copiar/Pegar como respaldo.
- No se modifica ningún componente EGP / Logic Bridge.


## V3.8 - Vinculación por QR

- Todos los dispositivos muestran su propio QR de vinculación.
- `Escanear QR` abre la cámara dentro de TRANSFER.
- Al reconocer un QR válido, la vinculación P2P comienza automáticamente.
- ID + código quedan ocultos en `Vinculación manual avanzada`.
- El código del QR cambia después de una vinculación exitosa o al generar un QR nuevo.
- Android nativo V1.2 añade permiso de cámara para el escáner interno.
- No se modifica EGP / Logic Bridge.


## V3.8.1 - Corrección visual QR

- Corrige el QR duplicado/desbordado en la ventana de vinculación.
- QRCodeJS vuelve a controlar correctamente si muestra `canvas` o `img`.
- El QR queda contenido dentro de su tarjeta.
- No cambia el protocolo de vinculación.
- No requiere reconstruir el APK Android V1.2.
- No modifica EGP / Logic Bridge.


## V3.8.2 - Vinculación QR bilateral y confiable

Corrige el caso donde el Mac podía guardar al Android pero el Android no alcanzaba a guardar al Mac.

Flujo nuevo: `pair-request -> pair-accepted (reintentos) -> pair-confirmed -> pair-complete`.

- `pair-accepted` se reenvía automáticamente hasta recibir confirmación.
- El PIN/QR no cambia hasta que ambos lados confirmaron.
- El lector QR ignora lecturas duplicadas mientras una vinculación está en curso.
- La ventana solo muestra éxito cuando ambos dispositivos completaron el intercambio.
- No requiere reconstruir ni reinstalar Android nativo V1.2.
- No modifica EGP / Logic Bridge.


## V3.8.3 - Vinculación QR con reintento automático

- El dispositivo que escanea reintenta la conexión P2P automáticamente.
- `pair-request`, `pair-confirmed` y `pair-complete` se repiten hasta completar el intercambio.
- Se añadió `pair-complete-ack`: ambas ventanas se cierran automáticamente solo cuando el vínculo quedó confirmado.
- No se guarda un dispositivo a medias en el lado que escanea.
- Cerrar una conexión vieja ya no marca como desconectada una conexión nueva válida.
- En Android/iPhone, `Escanear QR / Abrir cámara` aparece como primera sección.
- No requiere reinstalar el APK Android V1.2.
- No modifica EGP / Logic Bridge.


## V3.8.4 - Corrección real de vinculación QR

Causa encontrada:
las conexiones PeerJS entrantes eran tratadas como reconexiones normales. Al abrirse,
TRANSFER buscaba un token previo y, como el dispositivo todavía no estaba vinculado,
cerraba la conexión antes de que pudiera llegar `pair-request`.

Corrección:
- `attachConnection` distingue ahora conexiones entrantes nuevas.
- Una conexión entrante no se cierra por no tener token previo.
- `handleMessage` recibe y valida `pair-request` normalmente.
- Las reconexiones de dispositivos ya vinculados siguen validando token.
- Se conserva cámara primero en Android/iPhone.
- Se conserva cierre automático al completar la vinculación.
- No requiere reinstalar el APK Android V1.2.
- No modifica EGP / Logic Bridge.
