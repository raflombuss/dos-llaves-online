# Dos Llaves — juego cooperativo online para dos

Un pequeño videojuego de puzles 2D para jugar en pareja desde dos navegadores. Cada jugador ve **su propio laberinto**, activa un interruptor que abre la puerta del otro, busca un cristal cuando toca y llega a la salida. Cuando ambos llegan, pasan juntos al siguiente nivel.

## Requisitos

- Node.js **20 o superior**.
- Un navegador moderno (Chrome, Firefox, Safari o Edge).
- **Sin dependencias externas:** no necesitas ejecutar `npm install`.

## Probarlo en tu ordenador

```bash
npm start
```

Abre **http://localhost:3000**. Pulsa **Crear una sala** y copia el enlace. La otra persona abre ese enlace en otro navegador o en una ventana privada y pulsa **Entrar con un código**. Si compartís ordenador, usa dos navegadores distintos para probar ambos jugadores.

Para comprobar que funciona:

```bash
npm test
```

Para desarrollo con reinicio automático:

```bash
npm run dev
```

## Cómo jugar desde dos sitios distintos

Hay que **alojar el servidor Node.js en Internet**. Una opción es un servicio que permita desplegar proyectos Node.js y mantenga un servidor HTTP con conexiones de larga duración (SSE), como Render o Railway. El proceso general es:

1. Sube los archivos del proyecto a un repositorio de Git.
2. Crea un servicio web de Node.js en tu proveedor de hosting y conecta el repositorio.
3. Usa `npm start` como comando de inicio; la aplicación escucha en el puerto indicado por la variable `PORT`.
4. Abre el enlace HTTPS público, crea una sala y comparte **ese mismo enlace** con tu pareja.

**Importante:** `http://localhost:3000` solo funciona en tu equipo. No compartas una dirección `localhost` con alguien que esté en otra casa. El servidor debe estar activo para jugar y ambos navegadores deben poder conectarse a él.

## Contenido

- `server.mjs`: servidor HTTP, salas privadas, lógica del juego y sincronización mediante **Server-Sent Events (SSE)**.
- `levels.mjs`: los tres niveles y los mapas de los jugadores Sol y Luna.
- `public/index.html`: interfaz web.
- `public/styles.css`: estilo adaptable a móviles y ordenadores.
- `public/game.js`: cliente, teclado/controles táctiles, estado y chat.
- `tests/server.test.mjs`: pruebas automáticas para completar todos los niveles entre dos clientes.

## Reglas

- Cada sala admite **dos participantes**. El primero recibe el papel de Sol y el segundo Luna.
- Cada personaje solo puede ver su laberinto; colaboráis mediante el chat o hablando.
- Al pisar un interruptor, la puerta del **otro jugador** queda desbloqueada permanentemente durante ese nivel.
- En los niveles 2 y 3 hay que conseguir el cristal antes de llegar a la salida.
- Los dos debéis llegar a la salida para avanzar.
- Las salas viven en memoria del servidor; **se pierden si se reinicia**. Las salas inactivas se limpian pasadas unas 12 horas.
- Una persona puede reconectar con su papel si conserva el mismo navegador (se guarda una credencial aleatoria en `localStorage`).

## Limitaciones del prototipo

- Está pensado para **salas privadas informales**; los códigos de invitación son cortos y no es un sistema de autenticación de alta seguridad.
- No tiene base de datos: los niveles y mensajes se borran al reiniciar el servidor.
- Requiere **un único proceso de servidor**. Para varias instancias necesitaría un almacenamiento compartido y mensajería entre procesos.
- El chat no está cifrado de extremo a extremo; usa **HTTPS** al publicarlo.
- En hosting gratuito, si el servicio entra en reposo, puede retrasarse la reconexión.

## Personalizar los niveles

En `levels.mjs`, cada nivel contiene dos matrices de caracteres del mismo tamaño. Leyenda:

| Símbolo | Significado |
| --- | --- |
| `#` | Pared |
| `.` | Suelo |
| `S` | Inicio |
| `P` | Interruptor que abre la puerta del otro |
| `D` | Puerta propia, cerrada hasta que el otro la desbloquee |
| `E` | Salida |
| `C` | Cristal opcional (debe recogerse para llegar a la salida) |

Diseña siempre una salida inaccesible antes de abrir la puerta, y asegúrate de que cada interruptor y cristal sea alcanzable sin necesitar esa puerta.

## Licencia

MIT. Puedes modificar y distribuir esta primera versión.
