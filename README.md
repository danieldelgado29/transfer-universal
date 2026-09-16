# TRANSFER V3 — P2P TEXT

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
