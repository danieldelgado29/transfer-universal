# TRANSFER V3.3 — P2P TEXT + AUTO UPDATE + NATIVE WINDOW CHROME

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
