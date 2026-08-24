/**
 * The manual, in both languages at once.
 *
 * The two sit **adjacent** rather than in two files, and that is the whole design decision here. Two
 * files drift silently: somebody changes a sentence in one, the other keeps describing behaviour that
 * no longer exists, and nothing about the change looks wrong. Side by side, a paragraph edited on its
 * own is visible in the diff — and `manual.test.ts` fails on a passage with one language missing.
 *
 * Written rather than translated. A manual that reads like it was run through a machine teaches worse
 * than one written twice, so the Spanish says the same things in its own words.
 *
 * **It is written for whoever is using the instrument, not for whoever built it.** No passage in here
 * explains how something is implemented; every one of them says what a control does to the sound and
 * when somebody would reach for it. Where the two are in tension the user's answer wins, even when the
 * developer's answer is more interesting.
 *
 * The shape is three movements. The idea everything follows from, then the picture on the screen, then
 * one chapter per module — each of them **in the order its own panel is in**, so reading the manual and
 * looking at the panel are the same act. After the modules, the things you do to a finished patch:
 * play it, watch what it costs, get it out. Nothing in here restates a label that is already on screen.
 */

export interface Passage {
  en: string
  es: string
}

/** A named thing and what it is: the manual is a reference, and a reference is scanned rather than read. */
export interface Term {
  term: Passage
  text: Passage
}

/**
 * A run of entries under the heading the panel itself uses.
 *
 * The heading is a bare string rather than a `Passage`, and that is deliberate: `SEQUENCE` and `VOICE`
 * are words printed on the screen, not prose. Translating them would leave the manual naming a group
 * the panel does not have. Only sentences have a language here.
 */
export interface DetailGroup {
  title?: string
  terms: Term[]
}

export interface Section {
  id: string
  title: Passage
  body: Passage[]
  terms?: Term[]
  /**
   * Every control the section owns, one at a time, behind a Read more.
   *
   * Split from the prose rather than merged into it because the two audiences want opposite things.
   * Somebody who has used a synthesiser before wants the idea and the differences and will not read
   * past them; somebody who has not needs to know what every slider does, and hitting that wall first
   * tells them this is not for them. Folding it away lets the short version stay short and the long
   * version be as long as it has to be — which, for an oscillator with twenty controls, is long.
   */
  detail?: DetailGroup[]
}

/** Every detail entry of a section, flattened. What the tests count and what the page renders. */
export function detailTerms(section: Section): Term[] {
  return (section.detail ?? []).flatMap((group) => group.terms)
}

export const MANUAL: Section[] = [
  {
    id: 'idea',
    title: { en: 'The one idea', es: 'La idea' },
    body: [
      {
        en: 'Most patchers run everything at once. This one runs downward. An IGNITE fires, the oscillator wired below it plays its sequence, and when that finishes it triggers whatever is wired below *it*. The patch lights up and branches down, and you watch the flow travel while you hear it.',
        es: 'La mayoría de los entornos modulares lo ejecutan todo a la vez. Este lo ejecuta hacia abajo. Un IGNITE dispara, el oscilador cableado debajo toca su secuencia, y cuando termina dispara lo que esté cableado debajo de *él*. El patch se enciende y se ramifica hacia abajo, y ves viajar el flujo mientras lo oyes.',
      },
      {
        en: 'That is why a pass has no fixed length. Each one lasts as long as its longest branch, so the cycle breathes instead of holding a pulse. Everything else in here follows from that: there is no bar to fill, and two branches of different lengths will drift against each other for as long as you let them run.',
        es: 'Por eso una pasada no tiene duración fija. Cada una dura lo que su rama más larga, así que el ciclo respira en vez de sostener un pulso. Todo lo demás sale de ahí: no hay compás que rellenar, y dos ramas de distinta duración se van desfasando entre sí todo el tiempo que las dejes correr.',
      },
      {
        en: 'Work the same way as you read: choose one thing on the canvas and the panel on the right shows that thing and nothing else. There is never a second set of controls on screen competing for the same slider.',
        es: 'Trabaja como lees: elige una cosa en el lienzo y el panel de la derecha muestra esa cosa y nada más. Nunca hay un segundo juego de controles en pantalla peleando por el mismo slider.',
      },
    ],
    detail: [
      {
        terms: [
          {
            term: { en: 'A pass', es: 'Una pasada' },
            text: {
              en: 'One run of the whole cascade, from every IGNITE down to the last branch that has anything left to do. It ends when nothing is still travelling, not after a set number of bars — so adding a longer branch makes the pass longer. With LOOP on, the next one starts as soon as the last has drained.',
              es: 'Una ejecución de la cascada entera, desde cada IGNITE hasta la última rama que le quede algo por hacer. Termina cuando ya no viaja nada, no tras un número fijo de compases — así que añadir una rama más larga alarga la pasada. Con LOOP puesto, la siguiente arranca en cuanto la anterior se vacía.',
            },
          },
          {
            term: { en: 'Firing', es: 'Disparar' },
            text: {
              en: 'A node does its work and then passes a trigger to whatever hangs below it. That trigger is an instant, not a sound: it carries no audio at all. Two branches under one node fire together and then run independently, which is how a patch grows sideways as well as downward.',
              es: 'Un nodo hace su trabajo y luego pasa un disparo a lo que cuelgue debajo. Ese disparo es un instante, no un sonido: no lleva audio ninguno. Dos ramas bajo un mismo nodo disparan a la vez y luego corren por separado, que es como un patch crece también a lo ancho.',
            },
          },
          {
            term: { en: 'Why there is no clock', es: 'Por qué no hay claqueta' },
            text: {
              en: 'Because the length of a pass belongs to the patch. A grid would force every branch to fit a bar, and the thing worth having here is branches of different lengths drifting against each other. If you want a steady pulse, make every branch the same length and you have one.',
              es: 'Porque la duración de una pasada es del patch. Una rejilla obligaría a cada rama a caber en un compás, y lo que merece la pena aquí es que ramas de distinta duración se desfasen entre sí. Si quieres un pulso fijo, haz todas las ramas igual de largas y ya lo tienes.',
            },
          },
          {
            term: { en: 'Seven kinds of node', es: 'Siete tipos de nodo' },
            text: {
              en: 'IGNITE starts a cascade. OSC is the only one that makes a sound. DELAY holds a trigger and passes it on late, and SIEVE holds one and passes it on only sometimes. FX processes what it is fed. MOD moves a parameter while you listen. WARP bends everything below where it is attached. Each has its own chapter here, in that order of how often you will touch it.',
              es: 'IGNITE arranca una cascada. OSC es el único que produce sonido. DELAY retiene un disparo y lo pasa más tarde, y SIEVE lo retiene y lo pasa solo a veces. FX procesa lo que se le alimenta. MOD mueve un parámetro mientras escuchas. WARP dobla todo lo que hay por debajo de donde está enganchado. Cada uno tiene aquí su capítulo, en ese orden de cuánto lo vas a tocar.',
            },
          },
          {
            term: { en: 'Two ways to add one', es: 'Dos maneras de añadir uno' },
            text: {
              en: 'Drag it out of the palette on the left onto empty canvas, or drop it straight onto an existing cable — which puts it inside that cable, joined to both ends. The second is how a DELAY gets between two nodes that are already wired together without unwiring them first.',
              es: 'Arrástralo desde la paleta de la izquierda al lienzo vacío, o suéltalo justo encima de un cable ya hecho — eso lo mete dentro de ese cable, unido a los dos extremos. Lo segundo es como un DELAY entra entre dos nodos ya cableados sin tener que descablearlos antes.',
            },
          },
          {
            term: { en: 'The empty panel', es: 'El panel vacío' },
            text: {
              en: 'With nothing selected, the right-hand panel shows the basics and a HELP button that opens this manual. That is the one place it is always reachable from, and closing the manual leaves the patch exactly where it was — it is a window over the canvas, not another page.',
              es: 'Sin nada seleccionado, el panel de la derecha muestra lo básico y un botón HELP que abre este manual. Ese es el sitio desde el que siempre se llega, y cerrar el manual deja el patch justo donde estaba — es una ventana sobre el lienzo, no otra página.',
            },
          },
        ],
      },
    ],
  },
  {
    id: 'canvas',
    title: { en: 'Reading the picture', es: 'Leer el dibujo' },
    body: [
      {
        en: 'There are four kinds of cable, and you tell them apart by where they attach and how they move rather than by remembering a colour. Colour here means something else: how deep down the cascade a node sits.',
        es: 'Hay cuatro tipos de cable, y se distinguen por dónde se enganchan y cómo se mueven antes que por recordar un color. El color aquí significa otra cosa: a qué profundidad de la cascada está un nodo.',
      },
      {
        en: 'You never choose which kind you are drawing. A node has ports on its top and bottom for triggers and one on each side for everything else, and what a side cable becomes is decided by what is at its two ends. Draw one backwards and it is turned round rather than refused.',
        es: 'Nunca eliges qué tipo estás dibujando. Un nodo tiene puertos arriba y abajo para los disparos y uno a cada lado para todo lo demás, y lo que un cable de costado llega a ser lo deciden sus dos extremos. Dibuja uno al revés y se da la vuelta en vez de rechazarse.',
      },
    ],
    terms: [
      {
        term: { en: 'Triggers — top and bottom', es: 'Disparos — arriba y abajo' },
        text: {
          en: 'Thin, and they flow downward. This is the cascade: what fires what, and in what order.',
          es: 'Finos, y corren hacia abajo. Esta es la cascada: qué dispara a qué, y en qué orden.',
        },
      },
      {
        term: { en: 'Audio — the sides', es: 'Audio — los lados' },
        text: {
          en: 'Thicker, and they glow. An oscillator feeding an effect. Audio does not cascade: everything sounding plays at once into the output, and an effect is a send off it.',
          es: 'Más gruesos, y brillan. Un oscilador alimentando un efecto. El audio no cae en cascada: todo lo que suena va a la vez a la salida, y un efecto es un envío desde ahí.',
        },
      },
      {
        term: { en: 'Modulation — the sides too', es: 'Modulación — también los lados' },
        text: {
          en: 'Dotted, and they breathe at the rate of whatever is moving. A MOD sweeping one parameter of whatever it points at.',
          es: 'Punteados, y respiran al ritmo de lo que se esté moviendo. Un MOD barriendo un parámetro de lo que tenga apuntado.',
        },
      },
      {
        term: { en: 'Warp — the sides as well', es: 'Warp — también por los lados' },
        text: {
          en: 'Dashed, and completely still. A WARP does not move anything while you listen; it changes what the next pass will be, so a cable that pulsed would be describing something that is not happening.',
          es: 'A trazos, y completamente quieto. Un WARP no mueve nada mientras escuchas; cambia lo que será la próxima pasada, así que un cable que pulsara estaría describiendo algo que no ocurre.',
        },
      },
    ],
    detail: [
      {
        title: 'CABLES',
        terms: [
          {
            term: { en: 'Making one', es: 'Hacer uno' },
            text: {
              en: 'Drag from a port to a port. The ports on the top and bottom take triggers; the one on each side takes audio, modulation or a warp, and which of the three it becomes comes from what you joined rather than from a setting you have to find first.',
              es: 'Arrastra de un puerto a otro. Los puertos de arriba y abajo toman disparos; el de cada costado toma audio, modulación o warp, y cuál de los tres es sale de lo que uniste, no de un ajuste que tengas que encontrar antes.',
            },
          },
          {
            term: { en: 'Removing one', es: 'Quitar uno' },
            text: {
              en: 'Click it, or drag it off the port it is plugged into. Both leave the nodes where they are.',
              es: 'Púlsalo, o arrástralo fuera del puerto donde está enchufado. Las dos cosas dejan los nodos donde están.',
            },
          },
          {
            term: { en: 'Dropping a node on a cable', es: 'Soltar un nodo en un cable' },
            text: {
              en: 'Drop a node with nothing wired to it onto an existing cable and it takes the place of that cable, joined to both ends. It only happens to a node that has no cables of its own, so moving something you have already wired never rearranges your patch behind your back.',
              es: 'Suelta un nodo sin nada cableado encima de un cable ya hecho y ocupa el sitio de ese cable, unido a los dos extremos. Solo pasa con un nodo que no tenga cables propios, así que mover algo que ya cableaste nunca te reordena el patch a tus espaldas.',
            },
          },
          {
            term: { en: 'Why audio does not cascade', es: 'Por qué el audio no cae en cascada' },
            text: {
              en: 'A trigger is an order and audio is a substance. Everything sounding goes to the output at once, and an effect is a send off that — so wiring an oscillator into an effect does not put the effect after it in time, it puts it in the signal path. That is why effect cables go sideways and trigger cables go down.',
              es: 'Un disparo es una orden y el audio es una sustancia. Todo lo que suena va a la vez a la salida, y un efecto es un envío desde ahí — así que cablear un oscilador a un efecto no lo pone después en el tiempo, lo pone en el camino de la señal. Por eso los cables de efecto van de lado y los de disparo van hacia abajo.',
            },
          },
          {
            term: { en: 'One source, several destinations', es: 'Una fuente, varios destinos' },
            text: {
              en: 'An oscillator can feed several effects at once and an effect can take several oscillators. The same is true downward: two nodes under one node both fire when it finishes, and from there they are independent.',
              es: 'Un oscilador puede alimentar varios efectos a la vez y un efecto puede tomar varios osciladores. Lo mismo hacia abajo: dos nodos bajo uno disparan los dos cuando termina, y desde ahí van por su cuenta.',
            },
          },
        ],
      },
      {
        title: 'COLOUR AND MOVEMENT',
        terms: [
          {
            term: { en: 'What the colour means', es: 'Qué significa el color' },
            text: {
              en: 'How far down the cascade a thing sits, and nothing else — not what kind of thing it is. Nodes at the same depth share a colour, so a wide patch reads as bands and you can see which branches are level with each other.',
              es: 'Lo hondo que está algo en la cascada, y nada más — no de qué tipo es. Los nodos a la misma profundidad comparten color, así que un patch ancho se lee como franjas y ves qué ramas van a la par.',
            },
          },
          {
            term: { en: 'Colour belongs to the cascade', es: 'El color es de la cascada' },
            text: {
              en: 'Only trigger cables are coloured, and each one is a blend from the depth of the node above it to the depth of the node below — which is why a long branch reads as one continuous sweep rather than as stacked bands. Every side cable is grey, whichever of the three it is. So the quickest way to see the shape of a patch is that the coloured lines are the order things happen in, and the grey ones are everything else.',
              es: 'Solo los cables de disparo llevan color, y cada uno es una mezcla entre la profundidad del nodo de arriba y la del de abajo — por eso una rama larga se lee como un barrido continuo y no como franjas apiladas. Todos los cables de costado son grises, sea cual sea de los tres. Así que la manera más rápida de ver la forma de un patch es esta: las líneas de color son el orden en que pasan las cosas, y las grises son todo lo demás.',
            },
          },
          {
            term: { en: 'The three states of a node', es: 'Los tres estados de un nodo' },
            text: {
              en: 'Every node looks one of three ways: unwired and dim, wired and lit, or working right now and brighter still. It is worth a glance before you start hunting for a fault — a node that never lights up is a node nothing ever reaches.',
              es: 'Todo nodo se ve de una de tres formas: sin cablear y apagado, cableado y encendido, o trabajando ahora mismo y más brillante todavía. Merece un vistazo antes de empezar a buscar un fallo — un nodo que nunca se enciende es un nodo al que nunca llega nada.',
            },
          },
          {
            term: { en: 'The bars under an oscillator', es: 'Las barras bajo un oscilador' },
            text: {
              en: 'One bar per step, its height the note. Drag a bar to move that note; click it to open that single step in the panel. While a sequence plays, the step sounding is marked, so you can follow a line you cannot pick out by ear.',
              es: 'Una barra por paso, y su altura es la nota. Arrastra una barra para mover esa nota; púlsala para abrir ese paso suelto en el panel. Mientras suena la secuencia, el paso que suena está marcado, así que puedes seguir una línea que no distingues de oído.',
            },
          },
          {
            term: { en: 'Moving around', es: 'Moverse' },
            text: {
              en: 'Drag the canvas to move it and scroll to zoom. Drag a node to move it. Nothing about where a node sits changes what it does — position is for you, not for the patch, and two nodes are joined by a cable or they are not.',
              es: 'Arrastra el lienzo para moverlo y usa la rueda para acercarte. Arrastra un nodo para moverlo. Nada de dónde está un nodo cambia lo que hace — la posición es para ti, no para el patch, y dos nodos están unidos por un cable o no lo están.',
            },
          },
        ],
      },
    ],
  },
  {
    id: 'ignite',
    title: { en: 'IGNITE — where a cascade starts', es: 'IGNITE — donde arranca una cascada' },
    body: [
      {
        en: 'An IGNITE makes no sound. It is the thing that says *now*, and everything wired below it starts from there. A patch can hold as many as you like, and each one is an independent cascade — which is how one patch becomes a drone you leave running and a phrase you play over it.',
        es: 'Un IGNITE no hace ningún sonido. Es lo que dice *ahora*, y todo lo cableado debajo arranca desde ahí. Un patch puede tener tantos como quieras, y cada uno es una cascada independiente — así es como un patch se convierte en un dron que dejas corriendo y una frase que tocas encima.',
      },
      {
        en: 'By default it fires when you press PLAY. Set it to a key or a note instead and PLAY leaves it alone: it waits for your finger. That is the difference between a patch you start and a patch you perform.',
        es: 'Por defecto dispara cuando pulsas PLAY. Ponlo en una tecla o una nota y PLAY lo deja en paz: espera a tu dedo. Esa es la diferencia entre un patch que arrancas y un patch que tocas.',
      },
    ],
    detail: [
      {
        title: 'THE PANEL',
        terms: [
          {
            term: { en: 'Trigger', es: 'Trigger' },
            text: {
              en: 'On Play, or on a key or note. On Play means it goes with the transport and needs nothing from you. On a key or note takes it out of the transport entirely — PLAY will not start it, and pressing whatever you bound to it will.',
              es: 'En Play, o en una tecla o nota. En Play significa que va con el transporte y no necesita nada de ti. En tecla o nota lo saca del transporte del todo — PLAY no lo arranca, y pulsar lo que le hayas asignado sí.',
            },
          },
          {
            term: { en: 'The binding button', es: 'El botón de asignación' },
            text: {
              en: 'Press it and then press what you want: a computer key or a note on a MIDI keyboard, whichever arrives first. It shows what is bound, and pressing it again replaces that. Two IGNITEs on two different notes is a patch you play with two fingers.',
              es: 'Púlsalo y luego pulsa lo que quieras: una tecla del ordenador o una nota de un teclado MIDI, lo que llegue primero. Muestra qué está asignado, y volver a pulsarlo lo reemplaza. Dos IGNITE en dos notas distintas es un patch que tocas con dos dedos.',
            },
          },
          {
            term: { en: 'While', es: 'While' },
            text: {
              en: 'Held down runs the cascade for as long as your finger is there and stops when you let go — good for a stab or a swell you want to control by hand. Until pressed again starts on one press and stops on the next, which leaves your hands free for something else while it runs.',
              es: 'Held down corre la cascada mientras tengas el dedo puesto y para al soltar — bueno para un golpe o un crescendo que quieras controlar a mano. Until pressed again arranca con una pulsación y para con la siguiente, lo que te deja las manos libres para otra cosa mientras corre.',
            },
          },
        ],
      },
      {
        terms: [
          {
            term: { en: 'Several at once', es: 'Varios a la vez' },
            text: {
              en: 'Each IGNITE runs its own cascade on its own timing, and they do not wait for each other. Two on PLAY start together and drift apart if their branches are different lengths. One on PLAY and one on a key gives you a bed and something to play over it.',
              es: 'Cada IGNITE corre su propia cascada con su propio tiempo, y no se esperan entre ellos. Dos en PLAY arrancan juntos y se van desfasando si sus ramas duran distinto. Uno en PLAY y otro en una tecla te da una base y algo que tocar encima.',
            },
          },
          {
            term: { en: 'When nothing sounds', es: 'Cuando no suena nada' },
            text: {
              en: 'The first thing to check is whether there is an oscillator below the IGNITE at all. A trigger travels through DELAYs and FXs without making a sound; only an OSC turns it into one.',
              es: 'Lo primero que hay que mirar es si hay algún oscilador debajo del IGNITE. Un disparo atraviesa DELAY y FX sin hacer ningún sonido; solo un OSC lo convierte en uno.',
            },
          },
        ],
      },
    ],
  },
  {
    id: 'osc',
    title: { en: 'OSC — the sequencer and the voice', es: 'OSC — el secuenciador y la voz' },
    body: [
      {
        en: 'The only node that makes a sound. It is a short sequencer and a single voice in one: the bars under it are the notes, and everything in the panel below the sequence decides what those notes sound like.',
        es: 'El único nodo que produce sonido. Es un secuenciador corto y una voz, las dos cosas: las barras de debajo son las notas, y todo lo que hay en el panel por debajo de la secuencia decide a qué suenan esas notas.',
      },
      {
        en: 'The panel reads the way the cascade does — what happens first is written first. A note is chosen, then it is given a tone, then a shape over its life, then a colour, and last of all the patch is told what to fire next. Five groups, in that order.',
        es: 'El panel se lee como se lee la cascada — lo que pasa primero está escrito primero. Se elige una nota, se le da un timbre, luego una forma a lo largo de su vida, luego un color, y al final se le dice al patch qué disparar después. Cinco grupos, en ese orden.',
      },
      {
        en: 'One thing to know before you start turning things: an oscillator commits its whole sequence the moment it is triggered. Change something while it is playing and you hear it on the next pass, not in the middle of this one. Nothing is broken when that happens — wait one lap.',
        es: 'Una cosa que hay que saber antes de empezar a girar cosas: un oscilador se compromete con su secuencia entera en el momento en que se dispara. Cambia algo mientras suena y lo oyes en la pasada siguiente, no en medio de esta. Nada está roto cuando pasa eso — espera una vuelta.',
      },
    ],
    detail: [
      {
        title: 'SEQUENCE',
        terms: [
          {
            term: { en: 'Steps', es: 'Steps' },
            text: {
              en: 'How many notes the sequence has: anything from one to sixteen. It is also how long this branch takes, and therefore when whatever hangs below it starts — so five steps against four is two lines that come apart and keep coming apart, which is the thing this instrument is for. One step is a drone, or a trigger for whatever hangs below it.',
              es: 'Cuántas notas tiene la secuencia: de una a dieciséis. Es también lo que tarda esta rama, y por tanto cuándo arranca lo que cuelgue debajo — así que cinco pasos contra cuatro son dos líneas que se separan y siguen separándose, que es para lo que existe este instrumento. Un solo paso es un dron, o un disparo para lo que cuelgue debajo.',
            },
          },
          {
            term: { en: 'Division', es: 'Division' },
            text: {
              en: 'How long one step lasts, against the tempo: 1/4, 1/8 or 1/16. Faster divisions make the branch shorter as well as busier, so changing it moves everything below this node earlier or later.',
              es: 'Cuánto dura un paso, contra el tempo: 1/4, 1/8 o 1/16. Las divisiones rápidas hacen la rama más corta además de más densa, así que cambiarla adelanta o atrasa todo lo que hay debajo de este nodo.',
            },
          },
          {
            term: { en: 'Direction', es: 'Direction' },
            text: {
              en: 'Which way the steps are read. Reverse plays the phrase backwards; Ping-pong runs forward one pass and back the next. Only the *notes* turn round — where each slot falls, how long it lasts and which half of a swung pair it is all stay exactly where they were, so a reversed phrase still swings forward. That is what a musician means by playing something backwards, and it is not what a tape running the wrong way does.',
              es: 'Hacia dónde se leen los pasos. Reverse toca la frase al revés; Ping-pong va hacia delante una pasada y hacia atrás la siguiente. Solo dan la vuelta las *notas* — dónde cae cada hueco, cuánto dura y de qué mitad del par con swing es se quedan exactamente donde estaban, así que una frase invertida sigue swingueando hacia delante. Eso es lo que un músico quiere decir con tocar algo al revés, y no es lo que hace una cinta girando al contrario.',
            },
          },
          {
            term: { en: 'Ping-pong', es: 'Ping-pong' },
            text: {
              en: 'Turns round once per **pass**, not inside one — an oscillator commits its whole sequence the moment it is triggered, so there is nowhere in the middle to change its mind. Which means the ends repeat: four steps give 1 2 3 4 then 4 3 2 1. On an odd number of steps it is worth more, because the turn lands on a different beat every time round.',
              es: 'Da la vuelta una vez por **pasada**, no dentro de una — un oscilador compromete su secuencia entera en el momento en que se dispara, así que no hay sitio en medio para cambiar de idea. Eso significa que los extremos se repiten: cuatro pasos dan 1 2 3 4 y luego 4 3 2 1. Con un número impar de pasos vale más, porque el giro cae en un pulso distinto cada vuelta.',
            },
          },
          {
            term: { en: 'Gate', es: 'Gate' },
            text: {
              en: 'What share of its step each note holds. Low is short and detached, one is a note that lasts until the next one begins. It is the difference between a plucked line and a legato one, and on a slow division a low gate leaves audible silence between notes.',
              es: 'Qué parte de su paso ocupa cada nota. Bajo es corto y separado, uno es una nota que dura hasta que empieza la siguiente. Es la diferencia entre una línea punteada y una ligada, y con una división lenta un gate bajo deja silencio audible entre notas.',
            },
          },
          {
            term: { en: 'Swing on an odd length', es: 'Swing en una longitud impar' },
            text: {
              en: 'A swing pairs the steps two by two, so a sequence of five ends mid-pair. Rather than start the next pass over — which would put two long halves together and make the loop lurch — the pairing carries on across it, so a five-step line swings continuously and its pattern comes round every second pass instead of every one. The cost is that those two passes are not the same length. That is honest rather than a fault: a swing genuinely does not fit an odd count in one pass, and this instrument has never promised a fixed one.',
              es: 'Un swing empareja los pasos de dos en dos, así que una secuencia de cinco termina a media pareja. En vez de empezar de cero en la pasada siguiente — lo que juntaría dos mitades largas y haría que el bucle cojeara — el emparejamiento continúa a través de ella, así que una línea de cinco pasos hace swing sin interrupción y su patrón vuelve cada dos pasadas en lugar de cada una. El precio es que esas dos pasadas no duran lo mismo. Eso es honesto y no un fallo: un swing de verdad no cabe en un conteo impar dentro de una pasada, y este instrumento nunca ha prometido una duración fija.',
            },
          },
          {
            term: { en: 'Swing and Feel', es: 'Swing y Feel' },
            text: {
              en: "Makes each pair of this sequence's steps uneven — the first long, the second late and short. Feel is how uneven: Shuffle is what most machines call swing, Triplet is the long half lasting twice the short. A pair keeps its total, so the sequence takes exactly as long swung as straight and hands the cascade on at the same moment. A WARP has this too, and scales what is set here — the same relation Division has to a warp's Speed. It is on both because a warp reaches everything below whatever it is attached to, so swinging one oscillator that has anything hanging off it can only be done from here.",
              es: 'Vuelve desigual cada par de pasos de esta secuencia — el primero largo, el segundo tarde y corto. Feel es cuánto: Shuffle es lo que casi todas las máquinas llaman swing, Triplet es la mitad larga durando el doble que la corta. Un par conserva su total, así que la secuencia dura lo mismo con swing que recta y pasa la cascada en el mismo momento. Un WARP también lo tiene, y escala lo que pongas aquí — la misma relación que tiene Division con el Speed de un warp. Está en los dos porque un warp alcanza todo lo que hay debajo de donde se engancha, así que dar swing a un solo oscilador que tenga algo colgando solo se puede desde aquí.',
            },
          },
          {
            term: { en: 'Slop and Looseness', es: 'Slop y Looseness' },
            text: {
              en: "Plays every note of this sequence a little away from where it was written, differently each time. Looseness is how far, measured against this sequence's own shortest gap rather than in milliseconds — so one setting means the same thing however fast the line runs. At its most, two notes can meet and never cross: a note landing before the one in front of it does not sound loose, it sounds broken. A WARP adds its own on top, and again the reason it is here as well is that a warp cannot loosen one oscillator without loosening everything under it.",
              es: 'Toca cada nota de esta secuencia un poco fuera de donde estaba escrita, distinto cada vez. Looseness es cuánto, medido contra el hueco más corto de esta secuencia y no en milisegundos — así un mismo ajuste significa lo mismo por rápido que corra la línea. Al máximo, dos notas pueden juntarse y nunca cruzarse: una nota que cae antes que la anterior no suena floja, suena rota. Un WARP suma el suyo encima, y otra vez la razón de que esté aquí también es que un warp no puede aflojar un oscilador sin aflojar todo lo que hay debajo.',
            },
          },
          {
            term: { en: 'Scale', es: 'Scale' },
            text: {
              en: 'Which notes the bars are allowed to land on. Free lets any note through; choose a scale and dragging a bar can only stop on a note of that scale, so you can drag carelessly and stay in key. It belongs to this oscillator alone, so a bass in Minor pentatonic against a lead in Dorian is perfectly ordinary.',
              es: 'En qué notas pueden caer las barras. Free deja pasar cualquiera; elige una escala y arrastrar una barra solo puede pararse en una nota de esa escala, así que puedes arrastrar sin cuidado y seguir en tono. Es de este oscilador y de nadie más, así que un bajo en Minor pentatonic contra un lead en Dorian es de lo más normal.',
            },
          },
          {
            term: { en: 'Root', es: 'Root' },
            text: {
              en: 'Which note the scale is built from. It only appears once there is a scale to have a root in. Changing it moves the whole set of allowed notes without touching the shape of the scale.',
              es: 'Desde qué nota se construye la escala. Solo aparece cuando ya hay una escala en la que tener raíz. Cambiarla mueve el conjunto entero de notas permitidas sin tocar la forma de la escala.',
            },
          },
          {
            term: { en: 'FIT TO SCALE', es: 'FIT TO SCALE' },
            text: {
              en: 'Choosing a scale never retunes notes you already wrote — what is on the screen has to be what plays. This button is how you ask for that: it moves every existing note to the nearest one in the scale, once, in front of you. Undo covers it.',
              es: 'Elegir una escala nunca retoca notas que ya escribiste — lo que está en la pantalla tiene que ser lo que suena. Este botón es cómo lo pides: mueve cada nota existente a la más cercana de la escala, una vez, delante de ti. El undo lo cubre.',
            },
          },
          {
            term: { en: 'Step chance', es: 'Step chance' },
            text: {
              en: 'Switches on a per-step probability, which then appears in each step. Off, every step plays. On, a step you set to sixty per cent plays about six passes in ten — which is how a sixteen-step line stops repeating itself without you writing a variation.',
              es: 'Enciende una probabilidad por paso, que luego aparece en cada paso. Apagado, todos los pasos suenan. Encendido, un paso al sesenta por ciento suena unas seis pasadas de cada diez — así es como una línea de dieciséis pasos deja de repetirse sin que escribas una variación.',
            },
          },
          {
            term: { en: 'Ratchets', es: 'Ratchets' },
            text: {
              en: 'Switches on rolls, which then appear in each step: a step can fire up to four hits inside its own slot instead of one. They share the step rather than running over the next one, so a roll never pushes the sequence out of time.',
              es: 'Enciende los redobles, que luego aparecen en cada paso: un paso puede disparar hasta cuatro golpes dentro de su propio hueco en vez de uno. Se reparten el paso en vez de invadir el siguiente, así que un redoble nunca saca la secuencia de tiempo.',
            },
          },
        ],
      },
      {
        title: 'VOICE',
        terms: [
          {
            term: { en: 'Waveform', es: 'Waveform' },
            text: {
              en: 'What the voice is made of. Square and Pulse are hollow and reedy, Sawtooth and Ramp bright and buzzing, Triangle soft, Sine pure and almost featureless on its own. The four noises make no pitch at all: White is hissy and bright, Pink darker and more even, Brown a low rumble, Blue thin and sharp.',
              es: 'De qué está hecha la voz. Square y Pulse son huecas y nasales, Sawtooth y Ramp brillantes y zumbonas, Triangle suave, Sine pura y casi sin carácter a solas. Los cuatro ruidos no tienen tono ninguno: White silba y es brillante, Pink más oscuro y parejo, Brown un retumbe bajo, Blue fino y afilado.',
            },
          },
          {
            term: { en: 'Pulse width', es: 'Pulse width' },
            text: {
              en: 'Only on Pulse, and it is the reason to choose Pulse over Square. It sets how lopsided the wave is: in the middle it *is* a square, and towards either end it thins out into something nasal and small. Sweeping it with a MOD is the classic way to make one voice sound like two.',
              es: 'Solo en Pulse, y es la razón de elegir Pulse en vez de Square. Fija lo desigual que es la onda: en el centro *es* una cuadrada, y hacia los extremos se adelgaza en algo nasal y pequeño. Barrerlo con un MOD es la manera clásica de hacer que una voz suene como dos.',
            },
          },
          {
            term: { en: 'Detune', es: 'Detune' },
            text: {
              en: 'Shifts the whole oscillator by up to fifty cents either way — half a semitone, so it never changes which note you wrote. Its use is two oscillators playing the same line a few cents apart: the two drift against each other and the pair sounds wider and thicker than either alone.',
              es: 'Desplaza el oscilador entero hasta cincuenta centésimas a cada lado — medio semitono, así que nunca cambia la nota que escribiste. Su uso son dos osciladores tocando la misma línea con unas centésimas de diferencia: los dos se baten entre sí y el par suena más ancho y más grueso que cualquiera solo.',
            },
          },
          {
            term: { en: 'Gain', es: 'Gain' },
            text: {
              en: 'How loud this oscillator is against the others. It is the balance control: reach for it when one voice is burying another, and leave the master volume for how loud the whole thing is in the room.',
              es: 'Lo fuerte que suena este oscilador frente a los demás. Es el control de balance: úsalo cuando una voz esté enterrando a otra, y deja el volumen general para lo fuerte que suena todo en la sala.',
            },
          },
        ],
      },
      {
        title: 'SHAPE',
        terms: [
          {
            term: { en: 'Attack', es: 'Attack' },
            text: {
              en: 'How long a note takes to arrive at full volume. A few milliseconds is a hard edge and a percussive hit; a couple of hundred is a swell that has no attack you can point to. On a fast division a long attack means no note ever reaches full loudness, which is a usable sound rather than a mistake.',
              es: 'Cuánto tarda una nota en llegar a su volumen pleno. Unos pocos milisegundos es un canto duro y un golpe percusivo; un par de cientos es un crescendo sin ataque que puedas señalar. Con una división rápida un ataque largo significa que ninguna nota llega nunca a sonar del todo, que es un sonido utilizable y no un error.',
            },
          },
          {
            term: { en: 'Decay', es: 'Decay' },
            text: {
              en: 'How long it takes to fall away *while the note is still held*. At zero a note sits at full level for its whole gate; open it and every note leans downward from its own attack, which is what makes a line sound plucked rather than blown.',
              es: 'Cuánto tarda en caer *mientras la nota sigue sostenida*. En cero una nota se queda a nivel pleno todo su gate; ábrelo y cada nota se inclina hacia abajo desde su propio ataque, que es lo que hace que una línea suene punteada y no soplada.',
            },
          },
          {
            term: { en: 'Release', es: 'Release' },
            text: {
              en: 'How long a note takes to die after its gate closes. Long releases are what makes a sequence sound like a chord: notes overlap with the ones after them. That is also where the budget goes, since every note still fading is still a voice.',
              es: 'Cuánto tarda una nota en morir después de que su gate se cierra. Los release largos son lo que hace que una secuencia suene a acorde: las notas se solapan con las siguientes. Ahí es también donde se va el presupuesto, porque cada nota que aún se apaga sigue siendo una voz.',
            },
          },
          {
            term: { en: 'Glide', es: 'Glide' },
            text: {
              en: 'How long a slide between two notes takes. On its own it does nothing: it is the *time*, and which notes slide is a switch on each step. Set the time here, then tick Glide on the steps you want to arrive from below — that split is what lets one line have both slides and stabs.',
              es: 'Cuánto tarda un deslizamiento entre dos notas. Por sí solo no hace nada: es el *tiempo*, y qué notas se deslizan es un interruptor de cada paso. Pon el tiempo aquí y luego marca Glide en los pasos que quieras que lleguen desde abajo — ese reparto es lo que permite que una línea tenga deslizamientos y golpes a la vez.',
            },
          },
        ],
      },
      {
        title: 'FILTER',
        terms: [
          {
            term: { en: 'Filter', es: 'Filter' },
            text: {
              en: 'Off, Low pass, High pass or Band pass — one per note, so it is the fastest way to change the character of a whole line. Low pass takes the brightness off, High pass takes the body out, Band pass keeps a narrow window and throws away both ends. Off costs nothing; the other three each cost about one extra voice per note.',
              es: 'Off, Low pass, High pass o Band pass — uno por nota, así que es la manera más rápida de cambiar el carácter de una línea entera. Low pass le quita brillo, High pass le quita cuerpo, Band pass conserva una ventana estrecha y tira los dos extremos. Off no cuesta nada; los otros tres cuestan como una voz más por nota.',
            },
          },
          {
            term: { en: 'Cutoff', es: 'Cutoff' },
            text: {
              en: 'Where the filter acts. On a Low pass, everything above it is taken away, so bringing it down darkens and eventually muffles the voice. The slider moves in octaves rather than in a straight line, which is why the low end has as much travel as the top.',
              es: 'Dónde actúa el filtro. En un Low pass se quita todo lo que esté por encima, así que bajarlo oscurece y al final ahoga la voz. El slider se mueve en octavas y no en línea recta, y por eso la zona baja tiene tanto recorrido como la alta.',
            },
          },
          {
            term: { en: 'Resonance', es: 'Resonance' },
            text: {
              en: 'How much the filter emphasises the cutoff itself. A little adds a vocal edge; a lot makes the filter whistle and turns a slow cutoff sweep into the most recognisable sound a synthesiser has. Combine it with a MOD on the cutoff before you try anything else.',
              es: 'Cuánto realza el filtro su propio corte. Un poco añade un canto vocal; mucho hace que el filtro pite y convierte un barrido lento del corte en el sonido más reconocible que tiene un sintetizador. Combínalo con un MOD en el corte antes de probar otra cosa.',
            },
          },
          {
            term: { en: 'Key follow', es: 'Key follow' },
            text: {
              en: 'Makes the cutoff rise with the note, so high notes stay as bright as low ones instead of getting swallowed. At zero the filter stands still and the top of your line goes dull; at one it tracks the pitch and the whole range keeps an even tone. It only ever opens the filter, never closes it.',
              es: 'Hace que el corte suba con la nota, así que las notas agudas se mantienen igual de brillantes que las graves en vez de quedar tragadas. En cero el filtro se queda quieto y la parte alta de tu línea se apaga; en uno sigue al tono y todo el rango conserva un timbre parejo. Solo abre el filtro, nunca lo cierra.',
            },
          },
        ],
      },
      {
        title: 'NEXT',
        terms: [
          {
            term: { en: 'Propagation', es: 'Propagation' },
            text: {
              en: 'When this node fires whatever is wired below it. It is not about this oscillator at all — it is where this one ends and the next begins, and it is one of the few controls that changes the shape of a whole patch rather than the sound of one voice.',
              es: 'Cuándo dispara este nodo lo que tenga cableado debajo. No trata de este oscilador en absoluto — trata de dónde acaba este y empieza el siguiente, y es uno de los pocos controles que cambia la forma de un patch entero en vez del sonido de una voz.',
            },
          },
          {
            term: { en: 'When it ends (cascade)', es: 'When it ends (cascade)' },
            text: {
              en: 'The default and the one the whole instrument is named after: the branch below waits for this sequence to finish. Chain a few and you get a phrase that hands over to a phrase that hands over to another.',
              es: 'El de por defecto y el que da nombre al instrumento: la rama de abajo espera a que esta secuencia termine. Encadena unos cuantos y tienes una frase que da paso a otra frase que da paso a otra.',
            },
          },
          {
            term: { en: 'When it starts (parallel)', es: 'When it starts (parallel)' },
            text: {
              en: 'The branch below starts at the same moment this one does, so the two run together. This is how you stack voices into a chord or a layer instead of a sequence of phrases.',
              es: 'La rama de abajo arranca en el mismo momento que esta, así que las dos corren juntas. Así es como apilas voces en un acorde o una capa en vez de una secuencia de frases.',
            },
          },
          {
            term: { en: 'On every step (dense)', es: 'On every step (dense)' },
            text: {
              en: 'Fires the branch below once per step, so a sixteen-step oscillator triggers it sixteen times a pass. It is the loudest and most expensive of the three by a wide margin, and it is also how a patch becomes a texture rather than a line — watch the meter when you use it.',
              es: 'Dispara la rama de abajo una vez por paso, así que un oscilador de dieciséis pasos la dispara dieciséis veces por pasada. Es el más denso y el más caro de los tres con diferencia, y también es como un patch se vuelve una textura en vez de una línea — mira el medidor cuando lo uses.',
            },
          },
        ],
      },
      {
        terms: [
          {
            term: { en: 'Why a change waits a lap', es: 'Por qué un cambio espera una vuelta' },
            text: {
              en: 'An oscillator books its whole sequence the instant it is triggered, so anything you change lands on the next pass. A MOD is the exception: it is a live thing and moves what you are hearing now, which is exactly what to reach for when you want a control that responds under your hand.',
              es: 'Un oscilador reserva su secuencia entera en el instante en que se dispara, así que lo que cambies cae en la pasada siguiente. El MOD es la excepción: es algo vivo y mueve lo que estás oyendo ahora, que es justo lo que hay que usar cuando quieres un control que responda bajo la mano.',
            },
          },
          {
            term: { en: 'Layering against itself', es: 'Superponerse sobre sí mismo' },
            text: {
              en: 'A fast division with a long release means one oscillator has many notes in the air at once. That is a fine sound and it is also where the budget goes; if the meter is high, this is the second place to look after reverb decay.',
              es: 'Una división rápida con un release largo significa que un oscilador tiene muchas notas en el aire a la vez. Es un buen sonido y es también donde se va el presupuesto; si el medidor está alto, este es el segundo sitio donde mirar después del decay de un reverb.',
            },
          },
        ],
      },
    ],
  },
  {
    id: 'step',
    title: { en: 'A step on its own', es: 'Un paso suelto' },
    body: [
      {
        en: 'Click a bar under an oscillator and the panel shows that single step in place of the oscillator. The title says where you are — the oscillator on the left, the step number on the right — and pressing the oscillator part of it is the way back up.',
        es: 'Pulsa una barra bajo un oscilador y el panel muestra ese paso suelto en lugar del oscilador. El título dice dónde estás — el oscilador a la izquierda, el número de paso a la derecha — y pulsar la parte del oscilador es la manera de volver arriba.',
      },
      {
        en: 'This is where a sequence stops being a row of pitches. A step can be quieter than its neighbours, silent, unlikely, a roll of up to four hits, or the one note in the line that slides into place.',
        es: 'Aquí es donde una secuencia deja de ser una fila de alturas. Un paso puede ser más suave que sus vecinos, mudo, improbable, un redoble de hasta cuatro golpes, o la única nota de la línea que llega deslizándose.',
      },
    ],
    detail: [
      {
        title: 'THIS STEP',
        terms: [
          {
            term: { en: 'Note', es: 'Note' },
            text: {
              en: 'The same value the bar shows, named as you drag it. Use the slider when you know the note you want and the bar when you are looking for it by ear. If the oscillator has a scale, both obey it.',
              es: 'El mismo valor que muestra la barra, con su nombre mientras arrastras. Usa el slider cuando sepas la nota que quieres y la barra cuando la estés buscando de oído. Si el oscilador tiene escala, las dos la respetan.',
            },
          },
          {
            term: { en: 'Volume', es: 'Volume' },
            text: {
              en: 'How loud this one note is. It is how a flat row of notes becomes a line with an accent in it, and it does two jobs at once: wherever a MOD envelope is set to scale by velocity, a quiet step also gets a smaller sweep.',
              es: 'Lo fuerte que suena esta nota. Es como una fila plana de notas se convierte en una línea con acento, y hace dos trabajos a la vez: donde una envolvente de MOD esté puesta para escalar por velocidad, un paso suave recibe además un barrido más pequeño.',
            },
          },
          {
            term: { en: 'Mute', es: 'Mute' },
            text: {
              en: 'Silences this step without deleting the note in it, so you can take a note out of a line and put it back without having to find the pitch again. A muted step still takes its time: the sequence keeps its length and its shape, with a hole in it.',
              es: 'Silencia este paso sin borrar la nota que tiene, así que puedes quitar una nota de una línea y devolverla sin volver a buscar la altura. Un paso mudo sigue ocupando su tiempo: la secuencia conserva su duración y su forma, con un hueco.',
            },
          },
          {
            term: { en: 'Chance', es: 'Chance' },
            text: {
              en: 'How often this step plays, as a percentage. It only appears once the oscillator has Step chance switched on. A hundred is every pass; sixty is a step that is usually there and sometimes not, which is enough to keep a repeating line from sounding mechanical.',
              es: 'Cada cuánto suena este paso, en porcentaje. Solo aparece cuando el oscilador tiene Step chance encendido. Cien es todas las pasadas; sesenta es un paso que casi siempre está y a veces no, que es suficiente para que una línea repetida no suene mecánica.',
            },
          },
          {
            term: { en: 'Ratchet', es: 'Ratchet' },
            text: {
              en: 'How many hits this step fires, one to four. They divide the step between them, so the sequence stays in time and the step gets faster inside itself. One hit on a sixteen-step line is an accent; four is a snare roll.',
              es: 'Cuántos golpes dispara este paso, de uno a cuatro. Se reparten el paso entre ellos, así que la secuencia sigue en tiempo y el paso se acelera por dentro. Un golpe en una línea de dieciséis pasos es un acento; cuatro son un redoble de caja.',
            },
          },
          {
            term: { en: 'Roll', es: 'Roll' },
            text: {
              en: 'How the hits of a roll change in level, and it only appears once there are two of them. Zero is flat, upward fades the roll away, downward makes it swell into the next step. A fading roll is the one that sounds like a real one — four even hits sound like four notes stuck together.',
              es: 'Cómo cambian de nivel los golpes de un redoble, y solo aparece cuando hay dos. Cero es plano, hacia arriba lo desvanece, hacia abajo lo hace crecer hacia el paso siguiente. Un redoble que se apaga es el que suena de verdad — cuatro golpes iguales suenan a cuatro notas pegadas.',
            },
          },
          {
            term: { en: 'Glide', es: 'Glide' },
            text: {
              en: 'Whether this note slides up from the one before it. The label says so when the oscillator has no glide time set, because on its own this switch cannot do anything: which notes slide lives here and how long a slide lasts lives on the oscillator.',
              es: 'Si esta nota llega deslizándose desde la anterior. La etiqueta lo dice cuando el oscilador no tiene tiempo de glide puesto, porque por sí solo este interruptor no puede hacer nada: qué notas se deslizan vive aquí y cuánto dura un deslizamiento vive en el oscilador.',
            },
          },
        ],
      },
      {
        terms: [
          {
            term: { en: 'What the bar shows', es: 'Qué muestra la barra' },
            text: {
              en: 'Its height is the note and the square under it says whether the step is muted. With Step chance on, that square is part-filled to the step’s odds; with Ratchets on, the bar itself is divided into as many segments as the step has hits. So a sequence can be read without opening a single step.',
              es: 'Su altura es la nota y el cuadrado de debajo dice si el paso está mudo. Con Step chance encendido, ese cuadrado se rellena en proporción a sus probabilidades; con Ratchets encendido, la barra se divide en tantos segmentos como golpes tenga el paso. Así una secuencia se lee sin abrir ni un paso.',
            },
          },
          {
            term: { en: 'Switching a feature off', es: 'Apagar una función' },
            text: {
              en: 'Turning Step chance or Ratchets off on the oscillator hides those controls but keeps what the steps hold, so you can switch back on and find the sequence as you left it rather than as it was born.',
              es: 'Apagar Step chance o Ratchets en el oscilador esconde esos controles pero conserva lo que tienen los pasos, así que puedes volver a encenderlos y encontrar la secuencia como la dejaste y no como nació.',
            },
          },
        ],
      },
    ],
  },
  {
    id: 'delay',
    title: { en: 'DELAY — moving a branch in time', es: 'DELAY — mover una rama en el tiempo' },
    body: [
      {
        en: 'A DELAY makes no sound of its own. It catches a trigger and passes it on later, which moves everything below it later too. It is the simplest way to pull two branches out of step with each other.',
        es: 'Un DELAY no hace ningún sonido propio. Atrapa un disparo y lo pasa más tarde, lo que mueve también todo lo que hay debajo. Es la manera más simple de desfasar dos ramas entre sí.',
      },
      {
        en: 'Note what it is not: it is not an echo. An echo repeats audio and lives in FX; this moves *when something happens*. Two oscillators under one IGNITE with a DELAY on one of them play the same phrase a fixed distance apart, and stay that far apart for ever.',
        es: 'Fíjate en lo que no es: no es un eco. Un eco repite audio y vive en FX; esto mueve *cuándo pasa algo*. Dos osciladores bajo un IGNITE con un DELAY en uno de ellos tocan la misma frase a una distancia fija, y se quedan a esa distancia para siempre.',
      },
    ],
    detail: [
      {
        title: 'THE PANEL',
        terms: [
          {
            term: { en: 'Wait', es: 'Wait' },
            text: {
              en: 'How long it holds the trigger, in milliseconds. Type it into the readout when you want an exact figure and drag when you are listening for one. Short waits thicken a doubled line; long ones turn a second branch into an answer to the first.',
              es: 'Cuánto retiene el disparo, en milisegundos. Escríbelo en el lector cuando quieras una cifra exacta y arrastra cuando lo estés buscando de oído. Las esperas cortas engordan una línea doblada; las largas convierten una segunda rama en una respuesta a la primera.',
            },
          },
        ],
      },
      {
        terms: [
          {
            term: { en: 'Where to put one', es: 'Dónde poner uno' },
            text: {
              en: 'Drop it straight onto a cable that already exists and it goes inside that cable, joined to both ends — no unwiring needed. That is almost always what you want, since a DELAY is a thing you put *between* two nodes.',
              es: 'Suéltalo justo encima de un cable que ya existe y entra dentro de ese cable, unido a los dos extremos — sin descablear nada. Eso es casi siempre lo que quieres, porque un DELAY es algo que pones *entre* dos nodos.',
            },
          },
          {
            term: { en: 'A fixed distance, not a drift', es: 'Una distancia fija, no un desfase' },
            text: {
              en: 'A DELAY sets two branches apart and holds them there. If you want them to keep moving away from each other, that is a WARP with its Speed changed, or two oscillators of different lengths — both of those drift, and drift is a different musical thing from a delay.',
              es: 'Un DELAY separa dos ramas y las mantiene ahí. Si quieres que se sigan alejando la una de la otra, eso es un WARP con el Speed cambiado, o dos osciladores de distinta duración — esos dos se desfasan, y desfasarse es musicalmente otra cosa que un retardo.',
            },
          },
        ],
      },
    ],
  },
  {
    id: 'sieve',
    title: { en: 'SIEVE — passing a trigger sometimes', es: 'SIEVE — dejar pasar a veces' },
    body: [
      {
        en: 'The DELAY’s sibling. A DELAY holds a trigger and passes it on late; a SIEVE holds one and passes it on *sometimes*. Everything below it happens only on the passes it lets through, so one node decides whether a whole branch is part of this time round.',
        es: 'El hermano del DELAY. Un DELAY retiene un disparo y lo pasa más tarde; un SIEVE lo retiene y lo pasa *a veces*. Todo lo que hay debajo ocurre solo en las pasadas que deja pasar, así que un nodo decide si una rama entera forma parte de esta vuelta.',
      },
      {
        en: 'There is no bar in this instrument, so a pass is the only thing that recurs — and by default that is what a SIEVE counts. It says its condition on the node itself, written the way a musician writes it: 1:2 is the first of every two.',
        es: 'En este instrumento no hay compás, así que una pasada es lo único que se repite — y por defecto es lo que cuenta un SIEVE. Dice su condición en el propio nodo, escrita como la escribiría un músico: 1:2 es la primera de cada dos.',
      },
      {
        en: 'It can count the triggers reaching it instead, and that is a different instrument. Under an OSC sending on every step, one trigger arrives per step, so a SIEVE at 1:4 fires its branch on every fourth note of the sequence above — a divider on the steps rather than on the passes.',
        es: 'También puede contar los disparos que le llegan, y eso es otro instrumento. Bajo un OSC que envía en cada paso llega un disparo por paso, así que un SIEVE en 1:4 dispara su rama cada cuarta nota de la secuencia de arriba — un divisor sobre los pasos y no sobre las pasadas.',
      },
    ],
    detail: [
      {
        title: 'THE PANEL',
        terms: [
          {
            term: { en: 'Counts', es: 'Counts' },
            text: {
              en: 'Whether the run is counted in passes of the cascade or in the triggers that arrive here. In a plain chain they are the same number — one trigger reaches a node once per pass — so this changes nothing until the SIEVE sits somewhere they come apart: under an OSC sending on every step, below more than one parent, or inside a loop, where *which pass is this* has stopped meaning anything and *how many have reached me* still does.',
              es: 'Si la tanda se cuenta en pasadas de la cascada o en los disparos que llegan aquí. En una cadena simple son el mismo número — a un nodo le llega un disparo por pasada — así que esto no cambia nada hasta que el SIEVE está donde se separan: bajo un OSC que envía en cada paso, debajo de más de un padre, o dentro de un bucle, donde *qué pasada es esta* ya no significa nada y *cuántos me han llegado* sigue significándolo.',
            },
          },
          {
            term: { en: 'Every', es: 'Every' },
            text: {
              en: 'How long the run is. At one it counts nothing and everything goes through, which is where a SIEVE starts — dropping one into a chain is not a change until you ask it to be. At two the branch below happens every other time round, at four every fourth, and past about eight it stops being a rhythm and becomes a surprise.',
              es: 'Cuánto dura la tanda. En uno no cuenta nada y pasa todo, que es donde empieza un SIEVE — meter uno en una cadena no es un cambio hasta que se lo pidas. En dos, la rama de abajo ocurre una vuelta sí y otra no; en cuatro, una de cada cuatro; y pasado ocho deja de ser un ritmo y se vuelve una sorpresa.',
            },
          },
          {
            term: { en: 'On pass', es: 'On pass' },
            text: {
              en: 'Which of that run is this one’s, counting from one — it reads *On trigger* when that is what is being counted. It only appears once there is a run to have a place in. And it is the whole of alternation: two SIEVEs over the same run, one on the first pass and one on the second, is two branches taking turns — no feature of its own, just two nodes disagreeing about which passes are theirs.',
              es: 'Cuál de esa tanda es la suya, contando desde uno — dice *On trigger* cuando eso es lo que se cuenta. Solo aparece cuando ya hay una tanda en la que tener sitio. Y es la alternancia entera: dos SIEVE sobre la misma tanda, uno en la primera pasada y otro en la segunda, son dos ramas turnándose — sin ninguna función propia, solo dos nodos discrepando sobre qué pasadas son suyas.',
            },
          },
          {
            term: { en: 'Chance', es: 'Chance' },
            text: {
              en: 'And how often it lets one through when the count says it may. A hundred per cent is always, which is where it starts. The two conditions compose: a branch can happen on every other pass *and* only most of the time, which is a thing that repeats without being predictable.',
              es: 'Y cada cuánto deja pasar cuando la cuenta lo permite. Cien por cien es siempre, que es donde empieza. Las dos condiciones se combinan: una rama puede ocurrir una vuelta sí y otra no *y además* solo casi siempre, que es algo que se repite sin ser previsible.',
            },
          },
        ],
      },
      {
        terms: [
          {
            term: { en: 'It costs the cascade nothing', es: 'No le cuesta nada a la cascada' },
            text: {
              en: 'A SIEVE holds nothing back in time — it ends where it begins. So a branch that does not happen this pass takes no length off the lap, and the shape of the cycle is the same whether or not it let anything through. It is the one node here that changes what happens without changing when.',
              es: 'Un SIEVE no retiene nada en el tiempo — termina donde empieza. Así que una rama que no ocurre en esta pasada no le quita duración a la vuelta, y la forma del ciclo es la misma deje pasar o no. Es el único nodo de aquí que cambia qué ocurre sin cambiar cuándo.',
            },
          },
          {
            term: { en: 'Two dividers off one line', es: 'Dos divisores de una sola línea' },
            text: {
              en: 'Put an OSC on *every step* above two SIEVEs counting triggers, one of every three and one of every five, and three rhythms come out of a sequence that has only one. The count carries on across the pass boundary rather than starting again, so where each lands moves every time round — sixteen steps against three and five takes fifteen passes to come back to the beginning. The preset called SIFT is exactly this, with a third SIEVE beside them counting passes — hung off the IGNITE rather than off the tick, because a sieve counting passes wants one arrival a pass to count.',
              es: 'Pon un OSC en *cada paso* encima de dos SIEVE contando disparos, uno de cada tres y otro de cada cinco, y salen tres ritmos de una secuencia que solo tiene uno. La cuenta sigue de una pasada a la siguiente en vez de empezar de nuevo, así que dónde cae cada uno se mueve cada vuelta — dieciséis pasos contra tres y cinco tardan quince pasadas en volver al principio. El preset llamado SIFT es exactamente esto, con un tercer SIEVE al lado contando pasadas — colgado del IGNITE y no del tick, porque un sieve que cuenta pasadas quiere una llegada por pasada que contar.',
            },
          },
          {
            term: { en: 'Why it counts and does not wait', es: 'Por qué cuenta y no espera' },
            text: {
              en: 'The obvious node for a loop is one that waits for all its parents before firing. It cannot exist here. A parent can hang below the node that waits for it, so it only fires after — and then the waiting never ends and neither does the pass. Counting is defined everywhere, cannot deadlock, and does not quietly put the bar back by making branches wait for one another.',
              es: 'El nodo obvio para un bucle es uno que espera a todos sus padres antes de disparar. Aquí no puede existir. Un padre puede colgar por debajo del nodo que lo espera, así que solo dispara después — y entonces la espera no termina nunca y la pasada tampoco. Contar está definido en todas partes, no se puede bloquear, y no devuelve el compás a hurtadillas haciendo que unas ramas esperen a otras.',
            },
          },
          {
            term: { en: 'It lights only on its own passes', es: 'Se enciende solo en sus pasadas' },
            text: {
              en: 'A node that flashed every time a trigger reached it would be saying something true of every pass and therefore saying nothing. Lighting on the ones it passes makes the pattern visible: two SIEVEs alternating are two nodes taking turns on the canvas, which is the thing you are trying to see.',
              es: 'Un nodo que parpadeara cada vez que le llega un disparo estaría diciendo algo cierto en todas las pasadas y por tanto no diría nada. Encenderse en las que deja pasar hace visible el patrón: dos SIEVE alternando son dos nodos turnándose en el lienzo, que es justo lo que intentas ver.',
            },
          },
        ],
      },
    ],
  },
  {
    id: 'fx',
    title: { en: 'FX — the fifteen effects', es: 'FX — los quince efectos' },
    body: [
      {
        en: 'Wire an oscillator’s side port into an FX to feed it. Several oscillators can share one effect and one oscillator can feed several, because an effect is a send off the output rather than a stage in a chain — which is also why it does not matter where on the canvas you put it.',
        es: 'Cablea el puerto lateral de un oscilador a un FX para alimentarlo. Varios osciladores pueden compartir un efecto y un oscilador puede alimentar varios, porque un efecto es un envío desde la salida y no una etapa de una cadena — que es también por qué da igual dónde lo pongas en el lienzo.',
      },
      {
        en: 'Every effect has a Mix, and it sits directly under the choice of effect rather than under that effect’s own controls. An oscillator with nothing attached is heard whole; once something is attached, Mix says how much of it you hear through that thing.',
        es: 'Todo efecto tiene un Mix, y está justo debajo de la elección de efecto y no debajo de los controles de ese efecto. Un oscilador sin nada enganchado se oye entero; en cuanto tiene algo, Mix dice cuánto de él oyes a través de esa cosa.',
      },
    ],
    detail: [
      {
        title: 'THE PANEL',
        terms: [
          {
            term: { en: 'Effect', es: 'Effect' },
            text: {
              en: 'Which of the fifteen this node is. Changing it replaces the controls below with that effect’s own, and the Mix above stays where it was — which is why Mix is above them rather than below, where it would slide up and down the panel every time you changed your mind.',
              es: 'Cuál de los quince es este nodo. Cambiarlo reemplaza los controles de abajo por los de ese efecto, y el Mix de arriba se queda donde estaba — por eso el Mix va encima y no debajo, donde se desplazaría por el panel cada vez que cambiaras de idea.',
            },
          },
          {
            term: { en: 'Mix', es: 'Mix' },
            text: {
              en: 'All clean at one end, all effect at the other. On a reverb or an echo you usually want a little; on a filter or a bitcrusher you usually want all of it, because half a filter is just a quieter version of the unfiltered sound sitting underneath.',
              es: 'Todo limpio en un extremo, todo efecto en el otro. En un reverb o un eco normalmente quieres poco; en un filtro o un bitcrusher normalmente quieres todo, porque medio filtro es solo una versión más suave del sonido sin filtrar que sigue debajo.',
            },
          },
        ],
      },
      {
        title: 'THE EFFECTS',
        terms: [
          {
            term: { en: 'Reverb', es: 'Reverb' },
            text: {
              en: 'Puts the sound in a room. Decay is how big that room is, in seconds, and Tone darkens the tail so it sits behind the dry sound instead of on top of it. It is by far the most expensive thing here and it grows with Decay, so a long tail is the first place to look when the meter is high.',
              es: 'Pone el sonido en una sala. Decay es lo grande que es esa sala, en segundos, y Tone oscurece la cola para que se quede detrás del sonido seco en vez de encima. Es de largo lo más caro de aquí y crece con el Decay, así que una cola larga es lo primero que hay que mirar cuando el medidor está alto.',
            },
          },
          {
            term: { en: 'Distortion', es: 'Distortion' },
            text: {
              en: 'Makes the sound harder and louder by deforming it. Shape chooses how: Overdrive is warm and gentle, Distortion harder, Fuzz ragged, and Octave up folds the wave over so a ghost octave appears above the note. Drive is how far in, and Tone tames the top end afterwards.',
              es: 'Hace el sonido más duro y más fuerte deformándolo. Shape elige cómo: Overdrive es cálido y suave, Distortion más duro, Fuzz desgarrado, y Octave up dobla la onda de modo que aparece una octava fantasma por encima de la nota. Drive es cuánto entras, y Tone doma la parte alta después.',
            },
          },
          {
            term: { en: 'Bitcrusher', es: 'Bitcrusher' },
            text: {
              en: 'Two kinds of digital damage in one. Bits throws away resolution, which adds grit that gets louder as the sound gets quieter; Decimate throws away sample rate, which adds a metallic ring and eventually turns the pitch to nonsense. Tone rounds off what the two of them do.',
              es: 'Dos tipos de daño digital en uno. Bits tira resolución, lo que añade una arenilla que se oye más cuanto más suave es el sonido; Decimate tira frecuencia de muestreo, lo que añade un timbre metálico y al final vuelve absurda la afinación. Tone redondea lo que hacen los dos.',
            },
          },
          {
            term: { en: 'Echo', es: 'Echo' },
            text: {
              en: 'Repeats what it is fed. Time is set in divisions rather than milliseconds, so the repeats land on the grid the sequences are on. Feedback is how many repeats there are, Spread pushes them out to the sides, and Tone makes each one darker than the last.',
              es: 'Repite lo que se le alimenta. Time se pone en divisiones y no en milisegundos, así que las repeticiones caen en la misma rejilla que las secuencias. Feedback es cuántas repeticiones hay, Spread las abre hacia los lados, y Tone hace cada una más oscura que la anterior.',
            },
          },
          {
            term: { en: 'Filter', es: 'Filter' },
            text: {
              en: 'The same three shapes an oscillator has, but on the sound of everything wired into it and with only one to pay for rather than one per note. Type, Cutoff and Resonance. Reach for this instead of the oscillator’s filter when several voices should move together, and point a MOD at the cutoff.',
              es: 'Las mismas tres formas que tiene un oscilador, pero sobre el sonido de todo lo que se le cablee y pagando uno solo en vez de uno por nota. Type, Cutoff y Resonance. Usa este en vez del filtro del oscilador cuando varias voces deban moverse juntas, y apunta un MOD al corte.',
            },
          },
          {
            term: { en: 'Chorus', es: 'Chorus' },
            text: {
              en: 'Makes one voice sound like several by mixing it with slightly delayed, slowly wandering copies of itself. Sweep is how far those copies wander, Rate how fast, Depth how much of the wandering you get, and Feedback thickens it towards a metallic flange. Wide and expensive-sounding for very little cost.',
              es: 'Hace que una voz suene como varias mezclándola con copias de sí misma ligeramente retardadas y que van vagando despacio. Sweep es cuánto vagan esas copias, Rate a qué velocidad, Depth cuánto de ese vagar recibes, y Feedback lo espesa hacia un flange metálico. Ancho y de sonido caro por muy poco coste.',
            },
          },
          {
            term: { en: 'Phaser', es: 'Phaser' },
            text: {
              en: 'The sweeping, hollow whoosh. Rate is how fast it sweeps, Depth how deep, Feedback how sharp and resonant the notches are, and Centre where in the spectrum it happens. On a sustained chord it is unmistakable; on a short percussive line it barely registers.',
              es: 'Ese barrido hueco y silbante. Rate es lo rápido que barre, Depth lo profundo, Feedback lo afiladas y resonantes que son las muescas, y Centre en qué parte del espectro ocurre. Sobre un acorde sostenido es inconfundible; sobre una línea corta y percusiva apenas se nota.',
            },
          },
          {
            term: { en: 'Tremolo', es: 'Tremolo' },
            text: {
              en: 'Turns the volume up and down at a steady rate. Rate and Depth, and nothing else. It is the cheapest way to give a static drone a pulse, and at high rates it stops sounding like a pulse and starts sounding like a texture.',
              es: 'Sube y baja el volumen a un ritmo constante. Rate y Depth, y nada más. Es la manera más barata de darle pulso a un dron estático, y a velocidades altas deja de sonar a pulso y empieza a sonar a textura.',
            },
          },
          {
            term: { en: 'Ring mod', es: 'Ring mod' },
            text: {
              en: 'Multiplies the sound by a fixed tone, which throws away the original pitch and leaves something bell-like or robotic in its place. Freq is that tone: low is a tremble, high is a clangorous metal. There is no way to make this subtle, which is the point of it.',
              es: 'Multiplica el sonido por un tono fijo, lo que tira la altura original y deja en su lugar algo de campana o robótico. Freq es ese tono: bajo es un temblor, alto es un metal estridente. No hay manera de hacer esto sutil, y en eso está su gracia.',
            },
          },
          {
            term: { en: 'Pan', es: 'Pan' },
            text: {
              en: 'Places the sound between the two speakers. Pan is where, and Width spreads it out from that point instead of leaving it as a dot. Two oscillators panned apart is the cheapest stereo picture you can build.',
              es: 'Coloca el sonido entre los dos altavoces. Pan es dónde, y Width lo abre desde ese punto en vez de dejarlo como un punto. Dos osciladores separados en el panorama es la imagen estéreo más barata que puedes construir.',
            },
          },
          {
            term: { en: 'Octave', es: 'Octave' },
            text: {
              en: 'Adds a note an octave below what it is fed, which is how a thin line gets a bottom without a second oscillator. Tone shapes that added octave. It works best on something monophonic and clearly pitched; on a chord or a noise it has nothing to track.',
              es: 'Añade una nota una octava por debajo de lo que se le alimenta, que es como una línea fina consigue un fondo sin un segundo oscilador. Tone modela esa octava añadida. Funciona mejor sobre algo monofónico y de altura clara; sobre un acorde o un ruido no tiene nada que seguir.',
            },
          },
          {
            term: { en: 'Comb', es: 'Comb' },
            text: {
              en: 'A resonator: it rings at one note, and whatever you feed it excites that note. Nothing about the sound coming in survives except its shape in time — feed it a click and you get a plucked string, feed it a drum and you get a tuned drum, feed it a chord and you get your one note. It is the only effect here that decides the pitch rather than the source.',
              es: 'Un resonador: suena en una nota, y lo que le metas excita esa nota. Nada del sonido que entra sobrevive salvo su forma en el tiempo — mételе un clic y sale una cuerda pulsada, mételе un tambor y sale un tambor afinado, mételе un acorde y sale tu nota. Es el único efecto de aquí que decide la altura en vez de la fuente.',
            },
          },
          {
            term: { en: 'Pitch', es: 'Pitch' },
            text: {
              en: 'Which note the resonator rings at, said as a note because it has to agree with the sequence and nobody agrees with a sequence in hertz. Whole semitones only — a resonator between two of them is out of tune with everything rather than interestingly detuned. It reaches from C1 to C7. Wire a MOD to it and the resonator bends, which is the best thing this effect does.',
              es: 'En qué nota suena el resonador, dicho como nota porque tiene que estar de acuerdo con la secuencia y nadie está de acuerdo con una secuencia en hercios. Solo semitonos enteros — un resonador entre dos está desafinado con todo, no interesantemente desafinado. Llega de C1 a C7. Cablea un MOD y el resonador se dobla, que es lo mejor que hace este efecto.',
            },
          },
          {
            term: { en: 'Ring', es: 'Ring' },
            text: {
              en: 'How long it goes on sounding after it is struck, in seconds. A time and not an amount of feedback, which is not the same thing: one trip round a resonator is one cycle of the note, so a fixed feedback would ring eight times longer at the bottom of the range than at the top. Asking for a time means retuning it does not change the length of the note.',
              es: 'Cuánto sigue sonando después del golpe, en segundos. Un tiempo y no una cantidad de realimentación, que no es lo mismo: una vuelta al resonador es un ciclo de la nota, así que una realimentación fija sonaría ocho veces más en la parte baja del rango que en la alta. Pedir un tiempo hace que reafinarlo no cambie la duración de la nota.',
            },
          },
          {
            term: { en: 'Stutter', es: 'Stutter' },
            text: {
              en: 'Takes a slice and plays it again *instead of* what happened next. That is the whole difference from an echo: an echo adds a copy later while the original carries on underneath, and this replaces the music with itself. What you hear is a bar that stops advancing — and what actually happened during the repeat is gone, not queued.',
              es: 'Toma una porción y la vuelve a tocar *en lugar de* lo que pasó después. Esa es toda la diferencia con un eco: un eco añade una copia más tarde y el original sigue debajo, y esto reemplaza la música por sí misma. Lo que oyes es un compás que deja de avanzar — y lo que de verdad ocurrió durante la repetición se pierde, no se guarda en cola.',
            },
          },
          {
            term: { en: 'Slice', es: 'Slice' },
            text: {
              en: 'How much is captured, as a beat division. It follows the tempo, so moving the BPM does not put the repeats out of step — and since it is a length of *audio* rather than a gap, the shorter divisions are where it stops sounding like a repeat and starts sounding like a pitch.',
              es: 'Cuánto se captura, como división del pulso. Sigue al tempo, así que mover el BPM no descoloca las repeticiones — y como es una duración de *audio* y no un hueco, en las divisiones más cortas deja de sonar a repetición y empieza a sonar a altura.',
            },
          },
          {
            term: { en: 'Repeats', es: 'Repeats' },
            text: {
              en: 'How many times each slice is played before the next one is taken, and the whole model of the effect. At one it is a wire — every slice live, nothing repeated — which is also why it needs no on-off switch of its own: wire a MOD here and *that* is the momentary control every beat-repeat has. A square LFO turns it on and off in time; a slow shape makes it come and go.',
              es: 'Cuántas veces se toca cada porción antes de tomar la siguiente, y todo el modelo del efecto. En uno es un cable — cada porción en directo, nada repetido — que es también por qué no necesita interruptor propio: cablea un MOD aquí y *ese* es el control momentáneo que tiene todo beat-repeat. Un LFO cuadrado lo enciende y apaga a tiempo; una forma lenta lo hace ir y venir.',
            },
          },
          {
            term: { en: 'EQ', es: 'EQ' },
            text: {
              en: 'Three bands: a shelf below, a bell in the middle and a shelf above. Not a filter — a filter takes something away from one end, and this pushes or pulls any of the three without touching the others, which is what you want when a patch is nearly right and one part of it is too much. It is the one effect here with no Tone control, because an EQ *is* the tone control.',
              es: 'Tres bandas: un estante abajo, una campana en medio y un estante arriba. No es un filtro — un filtro quita algo de un extremo, y esto empuja o tira de cualquiera de las tres sin tocar las otras, que es lo que quieres cuando un patch está casi bien y una parte suena de más. Es el único efecto de aquí sin control de Tone, porque un EQ *es* el control de tono.',
            },
          },
          {
            term: { en: 'Low · Mid · High', es: 'Low · Mid · High' },
            text: {
              en: 'Each band in decibels, nought being flat — and flat is exactly a wire, so an EQ dropped into a patch is not a change until you ask it to be. Fifteen either way, which is more than an EQ usually offers: the extra few are what let it be used as a blunt filter rather than only as a correction. All three take a MOD, and they are the cheapest destinations in the instrument — a slow shape on the top band is a tremolo that touches only the air.',
              es: 'Cada banda en decibelios, cero es plano — y plano es exactamente un cable, así que un EQ metido en un patch no es un cambio hasta que se lo pidas. Quince a cada lado, que es más de lo que suele ofrecer un EQ: esos de más son los que permiten usarlo como filtro bruto y no solo como corrección. Las tres aceptan un MOD, y son los destinos más baratos del instrumento — una forma lenta en la banda alta es un trémolo que solo toca el aire.',
            },
          },
          {
            term: { en: 'Mid Hz', es: 'Mid Hz' },
            text: {
              en: 'Where the middle band sits. The two shelves do not move — they hinge at 250 Hz and 3 kHz, which is where a shelf belongs — and this one does, because a mid band you cannot aim is not a mid band. It is deliberately broad rather than sharp: wide enough that a boost sounds like a tone change instead of a resonance, which is the difference between this and the Filter three rows up.',
              es: 'Dónde está la banda del medio. Los dos estantes no se mueven — bisagran en 250 Hz y 3 kHz, que es donde va un estante — y esta sí, porque una banda media que no puedes apuntar no es una banda media. Es ancha a propósito y no afilada: lo bastante ancha para que un realce suene a cambio de timbre y no a resonancia, que es la diferencia entre esto y el Filter tres filas arriba.',
            },
          },
          {
            term: { en: 'Fold', es: 'Fold' },
            text: {
              en: 'Where a distortion squashes a signal that gets too loud, this **reflects** it — the peak turns round and comes back down. So a louder note is not the same tone louder, it is a *different* tone, because how far into the folds it reaches depends on how hard it arrived. It is the one effect here whose timbre follows the playing rather than a control, which makes it the one that gets something out of step velocities for free.',
              es: 'Donde una distorsión achata una señal que se pasa de fuerte, esto la **refleja** — el pico da la vuelta y baja otra vez. Así que una nota más fuerte no es el mismo timbre más fuerte, es *otro* timbre, porque hasta dónde entra en los pliegues depende de con cuánta fuerza llegó. Es el único efecto de aquí cuyo timbre sigue a la interpretación y no a un control, lo que lo hace el único que le saca algo a las velocidades de los pasos gratis.',
            },
          },
          {
            term: { en: 'Bias', es: 'Bias' },
            text: {
              en: 'How far off centre the signal is pushed before it folds, and the reason the effect is worth having. Folded down the middle, both halves reflect alike and you get odd harmonics only — hollow, reedy, the same tone however hard you drive it. Off centre they fold differently, and that difference is even harmonics. Wire a MOD to it and you are moving *which* harmonics are there rather than how loud or how bright the sound is, which nothing else here does.',
              es: 'Cuánto se desplaza la señal del centro antes de plegarse, y la razón por la que el efecto merece la pena. Plegada por el medio, las dos mitades se reflejan igual y salen solo armónicos impares — hueco, de caña, el mismo timbre por mucho que lo empujes. Descentrada se pliegan distinto, y esa diferencia son armónicos pares. Cablea un MOD y estás moviendo *qué* armónicos hay, no cuánto suena ni cuán brillante es, que no lo hace nada más aquí.',
            },
          },
          {
            term: { en: 'Damping', es: 'Damping' },
            text: {
              en: 'A low-pass *inside* the loop, so every trip round loses a little more of its top. That is the whole difference between a struck string and a metallic buzz, and it shortens the note as well as darkening it — which is what a real string does too. Open at the top of the control, where the resonator keeps whatever brightness it was given.',
              es: 'Un pasa-bajos *dentro* del bucle, así que cada vuelta pierde un poco más de agudo. Esa es toda la diferencia entre una cuerda pulsada y un zumbido metálico, y acorta la nota además de oscurecerla — que es lo que hace también una cuerda de verdad. Abierto arriba del control, donde el resonador conserva el brillo que se le dio.',
            },
          },
        ],
      },
      {
        title: 'NAMES THAT REPEAT',
        terms: [
          {
            term: { en: 'Tone, Cutoff, Centre, Freq', es: 'Tone, Cutoff, Centre, Freq' },
            text: {
              en: 'All four are a frequency, and each effect calls it what it means there. Tone is a tone control on a shaping effect; Cutoff is a filter’s corner; Centre is where a phaser sweeps around; Freq is the tone a ring modulator multiplies by. The same number does a different job in each.',
              es: 'Los cuatro son una frecuencia, y cada efecto la llama por lo que significa ahí. Tone es un control de timbre en un efecto de modelado; Cutoff es la esquina de un filtro; Centre es alrededor de dónde barre un phaser; Freq es el tono por el que multiplica un modulador de anillo. El mismo número hace un trabajo distinto en cada uno.',
            },
          },
          {
            term: { en: 'Rate and Depth', es: 'Rate y Depth' },
            text: {
              en: 'Wherever an effect moves something by itself, Rate is how fast and Depth is how far. Slow and deep is a shape you hear as movement; fast and shallow is a texture you hear as part of the tone.',
              es: 'Donde un efecto mueve algo por su cuenta, Rate es lo rápido y Depth lo lejos. Lento y profundo es una forma que oyes como movimiento; rápido y superficial es una textura que oyes como parte del timbre.',
            },
          },
          {
            term: { en: 'Feedback', es: 'Feedback' },
            text: {
              en: 'How much of the effect’s output goes back into it. On an echo that is the number of repeats; on a chorus or a phaser it sharpens the effect towards a ring. Everywhere, high values are where an effect stops being polite.',
              es: 'Cuánto de la salida del efecto vuelve a entrar en él. En un eco eso es el número de repeticiones; en un chorus o un phaser afila el efecto hacia un timbre resonante. En todos, los valores altos son donde un efecto deja de ser educado.',
            },
          },
        ],
      },
    ],
  },
  {
    id: 'mod',
    title: { en: 'MOD — the only live control', es: 'MOD — el único control vivo' },
    body: [
      {
        en: 'Everything else in a patch is decided when a node fires. A MOD is the exception: it moves a parameter while you are listening, and you hear it now rather than next pass. Wire it to the side of an oscillator or an effect and it offers whatever that thing has to move.',
        es: 'Todo lo demás en un patch se decide cuando un nodo dispara. El MOD es la excepción: mueve un parámetro mientras escuchas, y lo oyes ahora y no en la pasada siguiente. Cablealo al costado de un oscilador o un efecto y te ofrece lo que esa cosa tenga para mover.',
      },
      {
        en: 'It is two instruments under one name. An LFO runs continuously at its own rate whatever the music is doing; an envelope runs once, when something starts it. Choose which at the top of the panel, because that choice decides what the rest of the panel even contains.',
        es: 'Son dos instrumentos bajo un mismo nombre. Un LFO corre sin parar a su propio ritmo pase lo que pase con la música; una envolvente corre una vez, cuando algo la arranca. Elige cuál arriba en el panel, porque esa elección decide qué contiene el resto del panel.',
      },
    ],
    detail: [
      {
        title: 'THE PANEL',
        terms: [
          {
            term: { en: 'Kind', es: 'Kind' },
            text: {
              en: 'LFO or Envelope, and it comes first because the panel should read as a sentence: an envelope, fired on every note, sweeping the cutoff. It also decides which controls exist below — a shape and a rate for an LFO, a trigger and two times for an envelope.',
              es: 'LFO o Envelope, y va primero porque el panel debe leerse como una frase: una envolvente, disparada en cada nota, barriendo el corte. Decide además qué controles existen debajo — una forma y una velocidad para un LFO, un disparo y dos tiempos para una envolvente.',
            },
          },
          {
            term: { en: 'Pitch, as a target', es: 'Pitch, como destino' },
            text: {
              en: 'Pointed at an oscillator, a MOD can bend its pitch — which is vibrato with an LFO, and the drop at the front of a percussive sound with a per-note envelope. At full depth it reaches a semitone either way, so the useful settings are low: a tenth is ten cents, which is the shimmer most patches want. It is built per note, so each one wobbles on its own rather than the whole oscillator sliding together. On the noise waveforms it shifts the grain instead of a pitch, which is a texture rather than a note.',
              es: 'Apuntado a un oscilador, un MOD puede doblar su altura — que es vibrato con un LFO, y la caída del principio de un sonido percusivo con una envolvente por nota. A profundidad plena llega a un semitono a cada lado, así que los ajustes útiles son bajos: una décima son diez centésimas, que es el temblor que quiere casi todo patch. Se construye por nota, así que cada una tiembla por su cuenta en vez de deslizarse el oscilador entero. En las ondas de ruido desplaza el grano en lugar de una altura, que es una textura y no una nota.',
            },
          },
          {
            term: { en: 'Target', es: 'Target' },
            text: {
              en: 'Which parameter it moves. The list is whatever the thing at the other end of the cable actually has, so a MOD on a reverb offers that reverb’s decay and one on a chorus offers its sweep. An entry that cannot work right now is shown greyed with the reason on it rather than hidden.',
              es: 'Qué parámetro mueve. La lista es lo que de verdad tiene la cosa al otro extremo del cable, así que un MOD en un reverb ofrece el decay de ese reverb y uno en un chorus ofrece su sweep. Una entrada que ahora no puede funcionar se muestra en gris con el motivo puesto, en vez de esconderse.',
            },
          },
          {
            term: { en: 'Fires on', es: 'Fires on' },
            text: {
              en: 'For an envelope only. A trigger means one sweep each time something reaches the port on its top — under an IGNITE that is once a pass, under a node deep in a branch it is once when that branch lights up. Every note means one sweep per note, which is the classic filter envelope.',
              es: 'Solo para una envolvente. A trigger significa un barrido cada vez que algo llega al puerto de arriba — bajo un IGNITE eso es una vez por pasada, bajo un nodo hondo en una rama es una vez cuando esa rama se enciende. Every note significa un barrido por nota, que es la envolvente de filtro clásica.',
            },
          },
          {
            term: { en: 'Scale by velocity', es: 'Scale by velocity' },
            text: {
              en: 'Only on an envelope firing per note. With it ticked, a quiet step gets a smaller sweep and a loud one gets a bigger one, so the sequence’s accents move the filter as well as the volume. It is the single fastest way to make a line sound played rather than programmed.',
              es: 'Solo en una envolvente que dispara por nota. Marcado, un paso suave recibe un barrido más pequeño y uno fuerte uno más grande, así que los acentos de la secuencia mueven también el filtro y no solo el volumen. Es la manera más rápida de que una línea suene tocada y no programada.',
            },
          },
          {
            term: { en: 'Attack and Decay', es: 'Attack y Decay' },
            text: {
              en: 'An envelope’s two times: how long it takes to reach full depth and how long it takes to fall back. A short attack and a medium decay is a plucked, snapping filter; a long attack is a swell that arrives after the note it belongs to.',
              es: 'Los dos tiempos de una envolvente: cuánto tarda en llegar a su profundidad plena y cuánto en volver. Un ataque corto con un decay medio es un filtro punteado y chasqueante; un ataque largo es un crescendo que llega después de la nota a la que pertenece.',
            },
          },
          {
            term: { en: 'Shape', es: 'Shape' },
            text: {
              en: 'An LFO’s waveform. Sine and Triangle are smooth, Square jumps between two values, Saw ramps and snaps back. Random is different in kind: it holds a value and jumps to a new one at the rate, and it is the one shape here that does not repeat — the only modulation you cannot learn by ear.',
              es: 'La onda de un LFO. Sine y Triangle son suaves, Square salta entre dos valores, Saw sube y vuelve de golpe. Random es de otra clase: mantiene un valor y salta a otro nuevo al ritmo fijado, y es la única forma de aquí que no se repite — la única modulación que no puedes aprender de oído.',
            },
          },
          {
            term: { en: 'Sync to tempo', es: 'Sync to tempo' },
            text: {
              en: 'Counts an LFO’s cycle in beats instead of in seconds, so a wobble that is in time at one tempo stays in time at another. The echo has always worked this way; this is the same idea reaching the control most likely to want it. It is a switch beside the rate rather than a replacement for it, so the hertz are remembered and a wobble can be put on the grid and taken off again without losing what it was.',
              es: 'Cuenta el ciclo de un LFO en pulsos en vez de en segundos, así que un temblor que va a tiempo a un tempo sigue a tiempo a otro. El eco siempre ha funcionado así; esto es la misma idea llegando al control que más la quiere. Es un interruptor al lado de la velocidad y no un reemplazo, así que los hercios se recuerdan y un temblor se puede poner en la rejilla y quitarlo sin perder lo que era.',
            },
          },
          {
            term: { en: 'Every', es: 'Every' },
            text: {
              en: 'How many beats one cycle takes, once it is synced. Counted in beats and not in bars, because this instrument has no time signature and therefore no bar of its own — four beats is what most people would call one, and it says so, but the beat is the fact and the bar is your own frame. Long cycles are where this earns its keep: something that comes round every eight beats is a shape the music moves through rather than a texture in it.',
              es: 'Cuántos pulsos dura un ciclo, una vez sincronizado. Contado en pulsos y no en compases, porque este instrumento no tiene compás propio ni indicación de compás — cuatro pulsos es lo que casi todo el mundo llamaría uno, y lo dice, pero el pulso es el hecho y el compás es tu propio marco. Los ciclos largos son donde esto se gana el sueldo: algo que vuelve cada ocho pulsos es una forma por la que atraviesa la música, no una textura dentro de ella.',
            },
          },
          {
            term: { en: 'Rate', es: 'Rate' },
            text: {
              en: 'How fast an LFO runs, in cycles a second. Under about one it is a shape you follow; over about five it is a texture you hear as part of the tone. The cable pulses at the rate so you can see it, up to the speed where a flickering cable would read as broken.',
              es: 'Lo rápido que corre un LFO, en ciclos por segundo. Por debajo de uno es una forma que sigues; por encima de cinco es una textura que oyes como parte del timbre. El cable pulsa a ese ritmo para que lo veas, hasta la velocidad en la que un cable parpadeando parecería roto.',
            },
          },
          {
            term: { en: 'Depth', es: 'Depth' },
            text: {
              en: 'How much of the parameter’s range the sweep covers, so one control means the same thing wherever it is pointed. It goes below zero as well, which reads the modulation the other way round — an envelope that closes a filter rather than opening one, or two LFOs set against each other. At zero the MOD is running and doing nothing, which is worth remembering when a cable is drawn and lit and you cannot hear it.',
              es: 'Cuánto del rango del parámetro cubre el barrido, así que un solo control significa lo mismo apunte donde apunte. Baja de cero también, lo que lee la modulación al revés — una envolvente que cierra un filtro en vez de abrirlo, o dos LFO puestos en contra. En cero el MOD está corriendo y no hace nada, que conviene recordar cuando un cable está dibujado y encendido y no lo oyes.',
            },
          },
        ],
      },
      {
        terms: [
          {
            term: { en: 'The port on top', es: 'El puerto de arriba' },
            text: {
              en: 'A trigger means *start now*, and it means that for both kinds. An envelope fires: one sweep, from an IGNITE for once a pass or from a node further down for once when that branch lights up. An LFO begins its cycle again, so the wobble lines up with the cascade instead of drifting against it. Leave the port unwired and an LFO free-runs exactly as it always did — the cable is the setting, and there is nothing to switch on.',
              es: 'Un disparo significa *empieza ahora*, y significa eso para los dos tipos. Una envolvente dispara: un barrido, desde un IGNITE para una vez por pasada o desde un nodo más abajo para una vez cuando esa rama se enciende. Un LFO vuelve a empezar su ciclo, así que el temblor se alinea con la cascada en vez de irse por su lado. Deja el puerto sin cablear y un LFO corre libre exactamente como siempre — el cable es el ajuste, y no hay nada que encender.',
            },
          },
          {
            term: { en: 'When it says it is doing nothing', es: 'Cuando dice que no hace nada' },
            text: {
              en: 'The panel warns you rather than leaving you to work it out: an envelope waiting for a trigger it was never given, a MOD pointed at a filter that is switched off, or one set to fire per note against something that has no notes. Each says which setting stopped meaning anything.',
              es: 'El panel te avisa en vez de dejarte adivinar: una envolvente esperando un disparo que nunca recibió, un MOD apuntando a un filtro apagado, o uno puesto a disparar por nota contra algo que no tiene notas. Cada uno dice qué ajuste dejó de significar algo.',
            },
          },
          {
            term: { en: 'Ducking', es: 'Ducking' },
            text: {
              en: 'A MOD set to an envelope, fired by a trigger, pointed at an oscillator’s Level, with the Depth taken *below* zero. Now whenever that trigger fires, this oscillator gets out of the way and comes back — Attack is how fast it ducks and Decay is how long it takes to return. Wire the ducker from the same place that fires the branch you want to hear through the gap, and the two can never drift apart.',
              es: 'Un MOD puesto en envolvente, disparado por un trigger, apuntando al Level de un oscilador, con el Depth *por debajo* de cero. Ahora, cada vez que ese disparo ocurre, este oscilador se aparta y vuelve — Attack es lo rápido que se aparta y Decay lo que tarda en volver. Cablea el ducker desde el mismo sitio que dispara la rama que quieres oír por el hueco, y los dos no pueden desfasarse.',
            },
          },
          {
            term: {
              en: 'Why keying on a trigger is different',
              es: 'Por qué disparar y no escuchar',
            },
            text: {
              en: 'Everywhere else a sidechain listens to a *signal* and guesses at the beat from how loud it got. Here the key is the trigger itself, so the pad moves because the other branch fired — not because something crossed a threshold. It cannot mistime, and a quiet hit ducks exactly as much as a loud one. The preset called DUCK is this and nothing else.',
              es: 'En cualquier otro sitio un sidechain escucha una *señal* y adivina el pulso por lo fuerte que sonó. Aquí la llave es el disparo mismo, así que el pad se aparta porque la otra rama disparó — no porque algo cruzara un umbral. No puede desajustarse, y un golpe flojo agacha exactamente lo mismo que uno fuerte. El preset llamado DUCK es esto y nada más.',
            },
          },
          {
            term: { en: 'Per note means per voice', es: 'Por nota es por voz' },
            text: {
              en: 'An envelope firing per note gets its own sweep on every note, because an oscillator’s filter is built fresh for each one. That is also why it is the most expensive kind of modulation there is: one cable, and as many sweeps as there are notes in the air.',
              es: 'Una envolvente que dispara por nota tiene su propio barrido en cada nota, porque el filtro de un oscilador se construye nuevo para cada una. Por eso es también la modulación más cara que hay: un cable, y tantos barridos como notas haya en el aire.',
            },
          },
        ],
      },
    ],
  },
  {
    id: 'warp',
    title: { en: 'WARP — bending a whole branch', es: 'WARP — doblar una rama entera' },
    body: [
      {
        en: 'A WARP attaches to the side of an oscillator and bends that oscillator and everything the cascade reaches from it. Attach it to the one at the top of a branch and it takes the branch; attach it to the last one and it takes only that. An oscillator, because an oscillator is the thing that plays notes — there is nothing in a trigger or a wait for a warp to bend.',
        es: 'Un WARP se engancha al costado de un oscilador y dobla ese oscilador y todo lo que la cascada alcanza desde él. Engánchalo al de arriba de una rama y se lleva la rama; engánchalo al último y se lleva solo ese. Un oscilador, porque un oscilador es lo que toca notas — en un disparo o en una espera no hay nada que un warp pueda doblar.',
      },
      {
        en: 'It is not part of the chain, which is the whole point of it: nothing gets rewired and nothing fires twice. Every control starts at a neutral point, so a WARP you have just added leaves the patch exactly as it was until you move something.',
        es: 'No forma parte de la cadena, y en eso está su gracia: no se recablea nada y nada dispara dos veces. Cada control arranca en un punto neutro, así que un WARP recién añadido deja el patch tal como estaba hasta que muevas algo.',
      },
    ],
    detail: [
      {
        title: 'THE PANEL',
        terms: [
          {
            term: { en: 'Pitch', es: 'Pitch' },
            text: {
              en: 'Moves every note below it. On an oscillator with a scale it moves by degrees of that scale, and on a free one by semitones — so a bass in Pentatonic and a lead in Minor can both move a third and both stay in key. One control, transposing a whole branch, without editing a single step.',
              es: 'Mueve todas las notas de debajo. En un oscilador con escala se mueve por grados de esa escala, y en uno libre por semitonos — así un bajo en Pentatonic y un lead en Minor pueden moverse los dos una tercera y quedarse los dos en tono. Un control que transporta una rama entera sin editar ni un paso.',
            },
          },
          {
            term: { en: 'Speed', es: 'Speed' },
            text: {
              en: 'Stretches or squeezes every step below it. This is the thing a DELAY cannot do: a delay sets two branches a fixed distance apart, and a ratio makes them drift and keep drifting. A list of musical ratios rather than a slider, because against a grid a half and a third are worth having and 0.87 is only out of time.',
              es: 'Estira o comprime todos los pasos de debajo. Esto es lo que un DELAY no puede hacer: un retardo separa dos ramas a una distancia fija, y una razón las hace desfasarse y seguir desfasándose. Es una lista de razones musicales y no un slider, porque contra una rejilla un medio y un tercio valen la pena y 0.87 solo está a contratiempo.',
            },
          },
          {
            term: { en: 'Swing', es: 'Swing' },
            text: {
              en: 'Makes each pair of steps below it uneven: the first long, the second late and short. It is a switch beside its own value rather than a value with an off end, because what you do with a groove is listen straight, then swung, then straight again — and a control you had to walk back to straight would lose the setting every time. Off to begin with, so a WARP you have just added still does nothing.',
              es: 'Vuelve desigual cada par de pasos de debajo: el primero largo, el segundo tarde y corto. Es un interruptor al lado de su valor y no un valor con un extremo apagado, porque lo que haces con un groove es escucharlo recto, luego con swing, luego recto otra vez — y un control que hubiera que devolver a recto perdería el ajuste cada vez. Empieza apagado, así que un WARP recién puesto sigue sin hacer nada.',
            },
          },
          {
            term: { en: 'Feel', es: 'Feel' },
            text: {
              en: 'How uneven, as the long half against the short. Shuffle is the one most machines call swing; Triplet is the long half lasting twice the short, which is the jazz feel; past that it stops being a groove and becomes two hits with a gap. Whatever you choose, a pair keeps its total — so a sequence takes exactly as long swung as straight, and hands the cascade on at the same moment. Swing changes how a branch feels, never when it ends.',
              es: 'Cuánto de desigual, como la mitad larga contra la corta. Shuffle es el que casi todas las máquinas llaman swing; Triplet es la mitad larga durando el doble que la corta, el aire del jazz; más allá deja de ser un groove y son dos golpes con un hueco. Elijas lo que elijas, un par conserva su total — así que una secuencia dura exactamente lo mismo con swing que recta, y pasa la cascada en el mismo momento. El swing cambia cómo se siente una rama, nunca cuándo termina.',
            },
          },
          {
            term: { en: 'Slop', es: 'Slop' },
            text: {
              en: 'Plays every note below a little away from where it was written, differently each time. It sits beside Swing rather than instead of it, and the two compose: Swing decides the shape of the bar and this decides how closely it is respected — a drummer with a shuffle who is not perfectly tight. Off to begin with, and its own switch, so a groove can be heard tight and loose without losing the setting.',
              es: 'Toca cada nota de debajo un poco fuera de donde estaba escrita, distinto cada vez. Va al lado de Swing y no en su lugar, y los dos se combinan: Swing decide la forma del compás y esto decide cuánto se respeta — un baterista con shuffle que no va perfectamente apretado. Empieza apagado, y con su propio interruptor, para poder oír un groove apretado y flojo sin perder el ajuste.',
            },
          },
          {
            term: { en: 'Looseness', es: 'Looseness' },
            text: {
              en: 'How far a note may fall from its place — measured against the shortest gap in that oscillator’s own sequence, not in milliseconds. Which is why one setting sounds the same everywhere: thirty milliseconds is nothing in a slow bass and total chaos in a fast line with a heavy swing, so a fixed time would have to be re-dialled on every branch. At its most, two notes can meet and never cross: a note landing before the one in front of it does not sound loose, it sounds broken.',
              es: 'Cuánto puede caerse una nota de su sitio — medido contra el hueco más corto de la secuencia de ese oscilador, no en milisegundos. Por eso un mismo ajuste suena igual en todas partes: treinta milisegundos no son nada en un bajo lento y son un caos en una línea rápida con swing fuerte, así que un tiempo fijo habría que reajustarlo en cada rama. Al máximo, dos notas pueden juntarse y nunca cruzarse: una nota que cae antes que la anterior no suena floja, suena rota.',
            },
          },
          {
            term: { en: 'Velocity', es: 'Velocity' },
            text: {
              en: 'Scales what every note below is worth. It is the way to duck a whole branch under another without touching either oscillator’s gain — and wherever an envelope takes its depth from velocity, a quieter branch also gets smaller sweeps.',
              es: 'Escala lo que vale cada nota de debajo. Es la manera de meter una rama entera por debajo de otra sin tocar el gain de ningún oscilador — y donde una envolvente tome su profundidad de la velocidad, una rama más suave recibe además barridos más pequeños.',
            },
          },
          {
            term: { en: 'Chance', es: 'Chance' },
            text: {
              en: 'Thins the branch out. It applies whether or not the oscillators below use per-step chance, which is the useful part: "this whole branch happens half the time" is worth wanting without setting a chance on sixteen steps first.',
              es: 'Ralea la rama. Se aplica usen o no los osciladores de debajo la probabilidad por paso, y eso es lo útil: «esta rama entera pasa la mitad de las veces» merece la pena sin haber puesto antes una probabilidad en dieciséis pasos.',
            },
          },
        ],
      },
      {
        terms: [
          {
            term: { en: 'How far it reaches', es: 'Hasta dónde llega' },
            text: {
              en: 'Downward only, from the oscillator it is attached to. Everything the cascade can reach from there is bent; everything above it and everything on another branch is untouched. So a whole cascade is one warp on the oscillator at the top of it, and a phrase inside that cascade is another further down. Attach the same WARP to two oscillators and it reaches both.',
              es: 'Solo hacia abajo, desde el oscilador al que está enganchado. Todo lo que la cascada alcance desde ahí se dobla; todo lo de arriba y todo lo de otra rama queda intacto. Así que una cascada entera es un warp en el oscilador de arriba, y una frase de dentro es otro más abajo. Engancha el mismo WARP a dos osciladores y llega a los dos.',
            },
          },
          {
            term: { en: 'Stacking two of them', es: 'Apilar dos de ellos' },
            text: {
              en: 'Any number can reach the same notes and they combine without one winning. Pitch adds — two warps of a third up come to a sixth up — and the three ratios multiply, so two at half speed come to a quarter. That is why you can put one at the top of a branch for all of it and another further down for part of it, and read the result off the two.',
              es: 'Cualquier número puede llegar a las mismas notas y se combinan sin que uno gane. El Pitch suma — dos warps de una tercera arriba dan una sexta arriba — y las tres razones multiplican, así que dos a media velocidad dan un cuarto. Por eso puedes poner uno arriba de una rama para toda ella y otro más abajo para una parte, y leer el resultado de los dos.',
            },
          },
          {
            term: { en: 'It waits for the next pass', es: 'Espera la pasada siguiente' },
            text: {
              en: 'Because the oscillators it bends have already booked their sequences. Move a WARP control while a patch is playing and you hear it on the next lap, not in the middle of this one. Its cable is drawn still and dashed for that reason — a cable that pulsed would be promising something live.',
              es: 'Porque los osciladores que dobla ya reservaron sus secuencias. Mueve un control de WARP mientras suena un patch y lo oyes en la vuelta siguiente, no en medio de esta. Su cable se dibuja quieto y a trazos por eso — un cable que pulsara estaría prometiendo algo en vivo.',
            },
          },
          {
            term: { en: 'A common mistake', es: 'Un error común' },
            text: {
              en: 'Looking for somewhere to attach it other than an oscillator. There is nowhere: an IGNITE and a DELAY have no side port, because neither has anything a warp could bend — a wait is a number in milliseconds that no ratio scales, and a trigger has no pitch. To bend a whole cascade, attach it to the oscillator at the top. The panel warns you when it is attached to nothing that makes a note.',
              es: 'Buscar dónde engancharlo que no sea un oscilador. No hay otro sitio: un IGNITE y un DELAY no tienen puerto lateral, porque ninguno tiene nada que un warp pueda doblar — una espera es un número en milisegundos que ninguna razón escala, y un disparo no tiene altura. Para doblar una cascada entera, engánchalo al oscilador de arriba. El panel avisa cuando no está enganchado a nada que haga una nota.',
            },
          },
        ],
      },
    ],
  },
  {
    id: 'playing',
    title: { en: 'Playing it', es: 'Tocarlo' },
    body: [
      {
        en: 'PLAY starts the transport and, with LOOP on, fires the cascade again as soon as every branch has drained. The dice in the corner rolls a whole patch worth listening to — press it on impulse, because undo covers it in one step.',
        es: 'PLAY arranca el transporte y, con LOOP puesto, vuelve a disparar la cascada en cuanto todas las ramas se han vaciado. El dado de la esquina tira un patch entero que merece la pena oír — púlsalo sin pensar, que el undo lo cubre en un solo paso.',
      },
      {
        en: 'To play a patch rather than start it, set an IGNITE to a key or a note and press its binding button, then press what you want. Whatever arrives first is what gets bound — a computer key or a note from a MIDI keyboard. The socket beside the volume says whether there is a keyboard there and names it when there is.',
        es: 'Para tocar un patch en vez de arrancarlo, pon un IGNITE en tecla o nota y pulsa su botón de asignación, luego pulsa lo que quieras. Lo que llegue primero es lo que queda asignado — una tecla del ordenador o una nota de un teclado MIDI. El conector junto al volumen dice si hay teclado y lo nombra cuando lo hay.',
      },
    ],
    detail: [
      {
        title: 'THE TRANSPORT',
        terms: [
          {
            term: { en: 'PLAY and STOP', es: 'PLAY y STOP' },
            text: {
              en: 'PLAY fires every IGNITE that is set to fire on it. STOP lets whatever is already sounding finish rather than cutting it, so a long reverb tail is not chopped off mid-air. Nothing you change while it runs is lost — it lands on the next pass.',
              es: 'PLAY dispara todos los IGNITE puestos para disparar con él. STOP deja terminar lo que ya suena en vez de cortarlo, así que una cola larga de reverb no se trunca en el aire. Nada de lo que cambies mientras corre se pierde — cae en la pasada siguiente.',
            },
          },
          {
            term: { en: 'RESET', es: 'RESET' },
            text: {
              en: 'Rebuilds the patch from scratch, back to the one it starts with. This is what to reach for if something sounds stuck rather than wrong — and it is one undo step, so it is not a decision you have to be sure about.',
              es: 'Reconstruye el patch de cero, de vuelta al que trae al empezar. Es a lo que hay que ir si algo suena atascado más que mal — y es un paso de undo, así que no es una decisión de la que tengas que estar seguro.',
            },
          },
          {
            term: { en: 'BPM', es: 'BPM' },
            text: {
              en: 'The tempo the divisions are measured against, typed rather than dragged because it is a number you usually know. It scales every sequence at once, so it changes how long a pass takes as well as how fast it sounds.',
              es: 'El tempo contra el que se miden las divisiones, escrito en vez de arrastrado porque suele ser un número que ya sabes. Escala todas las secuencias a la vez, así que cambia cuánto dura una pasada además de lo rápido que suena.',
            },
          },
          {
            term: { en: 'LOOP', es: 'LOOP' },
            text: {
              en: 'Whether a pass is followed by another. Off, PLAY runs the cascade once and stops — which is the honest way to hear how long a pass actually is, since it has no fixed length.',
              es: 'Si a una pasada le sigue otra. Apagado, PLAY corre la cascada una vez y para — que es la manera honesta de oír cuánto dura de verdad una pasada, ya que no tiene duración fija.',
            },
          },
          {
            term: { en: 'VOL', es: 'VOL' },
            text: {
              en: 'How loud the whole thing is. It is not a mixer: use an oscillator’s Gain to balance one voice against another, and leave this for the room.',
              es: 'Lo fuerte que suena todo. No es una mesa de mezclas: usa el Gain de un oscilador para equilibrar una voz frente a otra, y deja esto para la sala.',
            },
          },
        ],
      },
      {
        title: 'BY HAND',
        terms: [
          {
            term: { en: 'Binding a key or a note', es: 'Asignar una tecla o una nota' },
            text: {
              en: 'Any IGNITE can be bound, and several can be bound to different things — that is how a patch becomes something you perform rather than something you start. One on PLAY and two on keys gives you a bed and two things to punch in over it.',
              es: 'Cualquier IGNITE se puede asignar, y varios pueden ir a cosas distintas — así es como un patch pasa de algo que arrancas a algo que tocas. Uno en PLAY y dos en teclas te da una base y dos cosas que meter encima.',
            },
          },
          {
            term: { en: 'Held or toggled', es: 'Sostenido o conmutado' },
            text: {
              en: 'They feel different under the fingers. Held down wants you to keep pressing and gives you control over the length of every phrase; until pressed again wants one press and leaves your hands free for the next thing.',
              es: 'Se sienten distinto bajo los dedos. Sostenido pide que sigas pulsando y te da control sobre la duración de cada frase; hasta volver a pulsar pide una pulsación y te deja las manos libres para lo siguiente.',
            },
          },
          {
            term: { en: 'MIDI', es: 'MIDI' },
            text: {
              en: 'Plug a class-compliant keyboard in and the socket beside the volume lights up and names it. There is nothing to configure: notes go to whichever IGNITEs are bound to them and the channel is ignored. Grey socket means no device, and hovering it says so.',
              es: 'Enchufa un teclado que cumpla el estándar y el conector junto al volumen se enciende y lo nombra. No hay nada que configurar: las notas van a los IGNITE que las tengan asignadas y el canal se ignora. Conector gris significa que no hay dispositivo, y al pasar por encima lo dice.',
            },
          },
          {
            term: { en: 'The dice', es: 'El dado' },
            text: {
              en: 'Rolls a complete patch: nodes, cables, sequences and settings. It is not random noise — it builds patches that are meant to be listenable, and it is one undo step, so the cheapest way to find a sound you would not have written is to keep pressing it.',
              es: 'Tira un patch completo: nodos, cables, secuencias y ajustes. No es ruido al azar — construye patches pensados para poder escucharse, y es un paso de undo, así que la manera más barata de encontrar un sonido que no habrías escrito es seguir pulsándolo.',
            },
          },
        ],
      },
    ],
  },
  {
    id: 'budget',
    title: { en: 'The budget', es: 'El presupuesto' },
    body: [
      {
        en: 'The meter counts work, not voices. One point is one plain oscillator voice, and the ceiling is what this machine can actually manage before the audio thread starts dropping samples — measured rather than chosen.',
        es: 'El medidor cuenta trabajo, no voces. Un punto es una voz de oscilador simple, y el techo es lo que esta máquina aguanta de verdad antes de que el hilo de audio empiece a perder muestras — medido, no elegido.',
      },
      {
        en: 'Past three quarters of it, a retriggered oscillator restarts instead of layering, so a heavy patch degrades before it glitches. Effects are never switched off behind your back: you put them there, and they stay.',
        es: 'Pasados tres cuartos, un oscilador redisparado reinicia en vez de superponerse, así que un patch cargado se degrada antes de romperse. Los efectos nunca se apagan a tus espaldas: los pusiste tú, y se quedan.',
      },
    ],
    detail: [
      {
        terms: [
          {
            term: { en: 'Reading the meter', es: 'Leer el medidor' },
            text: {
              en: 'A percentage of what this machine can do before it starts dropping audio. Under about a fifth it tells you very little and moves around; above that it is worth watching. It is a warning rather than a limit — nothing stops you going past it.',
              es: 'Un porcentaje de lo que puede esta máquina antes de empezar a perder audio. Por debajo de un quinto dice muy poco y se mueve; por encima merece la pena mirarlo. Es un aviso y no un límite — nada te impide pasarte.',
            },
          },
          {
            term: { en: 'What costs what', es: 'Qué cuesta qué' },
            text: {
              en: 'A reverb is worth about forty plain voices at the tail it arrives with, and a hundred and fifty at its longest — so Decay is the most expensive control in the instrument, not merely the most expensive effect. A distortion is about a dozen, a phaser about nine, and most of the rest a handful each. A filter on an oscillator costs roughly one extra voice per note, because there is one per note.',
              es: 'Un reverb vale unas cuarenta voces simples con la cola que trae de fábrica, y ciento cincuenta en su máximo — así que el Decay es el control más caro del instrumento, no solo el efecto más caro. Una distorsión son cerca de doce, un phaser unos nueve, y casi todo lo demás un puñado cada uno. Un filtro en un oscilador cuesta como una voz más por nota, porque hay uno por nota.',
            },
          },
          {
            term: { en: 'What to do when it is high', es: 'Qué hacer cuando está alto' },
            text: {
              en: 'Shorten a reverb Decay first; that is where the points are. Then look for oscillators layering on top of themselves — a fast Division with a long Release means many notes sounding at once. Turning a filter off on an oscillator that does not need it takes a voice off every note it plays.',
              es: 'Acorta primero el Decay de un reverb; ahí están los puntos. Después busca osciladores superponiéndose sobre sí mismos — una Division rápida con un Release largo significa muchas notas sonando a la vez. Apagar un filtro en un oscilador que no lo necesita quita una voz de cada nota que toque.',
            },
          },
          {
            term: { en: 'The most expensive setting', es: 'El ajuste más caro' },
            text: {
              en: 'Propagation set to on every step, on a sixteen-step oscillator, feeding a branch that has anything in it. It fires that branch sixteen times a pass. It is a real sound worth having and it is also the one control that can take a light patch to the ceiling in a single click.',
              es: 'Propagation puesto en cada paso, en un oscilador de dieciséis pasos, alimentando una rama con algo dentro. Dispara esa rama dieciséis veces por pasada. Es un sonido de verdad que merece la pena y es también el único control que puede llevar un patch ligero al techo con un solo clic.',
            },
          },
        ],
      },
    ],
  },
  {
    id: 'sharing',
    title: { en: 'Getting it out', es: 'Sacarlo de aquí' },
    body: [
      {
        en: 'The whole patch packs into one string of text. GENERATE publishes it and puts a six-character code in the field — that code refers to the patch rather than containing it, so the same patch always gets the same code. Paste either kind into the field to load one.',
        es: 'El patch entero se empaqueta en una sola cadena de texto. GENERATE lo publica y pone un código de seis caracteres en el campo — ese código se refiere al patch en vez de contenerlo, así que el mismo patch recibe siempre el mismo código. Pega cualquiera de los dos en el campo para cargar uno.',
      },
      {
        en: 'SHARE puts it in the gallery, which opens as a window over the canvas: choosing a patch there loads it into the canvas that is already underneath. EXPORT renders a WAV offline, faster than listening to it, and its length is measured in repetitions of the cascade rather than in seconds — because a pass has no fixed length and you should not have to measure it first.',
        es: 'SHARE lo pone en la galería, que se abre como una ventana sobre el lienzo: elegir un patch ahí lo carga en el lienzo que ya está debajo. EXPORT renderiza un WAV offline, más rápido que escucharlo, y su duración se mide en repeticiones de la cascada y no en segundos — porque una pasada no tiene duración fija y no deberías tener que medirla antes.',
      },
    ],
    detail: [
      {
        terms: [
          {
            term: { en: 'The two kinds of code', es: 'Los dos tipos de código' },
            text: {
              en: 'The long one is the patch itself, packed into text — it works offline and needs nothing from anywhere. The short six-character one is a reference to a published patch, so it is easier to type but only works while there is a network. Pasting either into the field loads it.',
              es: 'El largo es el patch en sí, empaquetado en texto — funciona sin conexión y no necesita nada de fuera. El corto de seis caracteres es una referencia a un patch publicado, así que es más fácil de teclear pero solo funciona con red. Pegar cualquiera de los dos en el campo lo carga.',
            },
          },
          {
            term: { en: 'COPY and GENERATE', es: 'COPY y GENERATE' },
            text: {
              en: 'COPY takes whatever is in the field. GENERATE publishes the patch you have now and replaces the field with its short code. The same patch always generates the same code, so pressing it twice is not a way to get two.',
              es: 'COPY se lleva lo que haya en el campo. GENERATE publica el patch que tengas ahora y reemplaza el campo con su código corto. El mismo patch genera siempre el mismo código, así que pulsarlo dos veces no es una manera de tener dos.',
            },
          },
          {
            term: { en: 'The gallery', es: 'La galería' },
            text: {
              en: 'Two tabs: the presets that ship with the instrument, and the patches people have shared. Both load into the canvas underneath, so closing the gallery leaves you looking at whatever you chose. Start with the presets if you want to see what a finished patch looks like.',
              es: 'Dos pestañas: los presets que vienen con el instrumento y los patches que ha compartido la gente. Los dos cargan en el lienzo de debajo, así que cerrar la galería te deja mirando lo que hayas elegido. Empieza por los presets si quieres ver qué aspecto tiene un patch terminado.',
            },
          },
          {
            term: { en: 'EXPORT and REPS', es: 'EXPORT y REPS' },
            text: {
              en: 'REPS is how many times the cascade repeats in the rendered file. It is counted in passes rather than in seconds because a pass has no fixed length — asking for eight seconds would mean measuring the patch yourself first, and the answer would change the moment you lengthened a branch.',
              es: 'REPS es cuántas veces se repite la cascada en el archivo renderizado. Se cuenta en pasadas y no en segundos porque una pasada no tiene duración fija — pedir ocho segundos significaría medir el patch tú antes, y la respuesta cambiaría en cuanto alargaras una rama.',
            },
          },
        ],
      },
    ],
  },
  {
    id: 'shortcuts',
    title: { en: 'Shortcuts', es: 'Atajos' },
    body: [],
    terms: [
      {
        term: { en: 'Cmd or Ctrl + Z', es: 'Cmd o Ctrl + Z' },
        text: {
          en: 'Undo. One step is one completed gesture, so a slider drag comes back in one go rather than a hundred.',
          es: 'Deshacer. Un paso es un gesto completo, así que el arrastre de un slider vuelve de una vez y no en cien.',
        },
      },
      {
        term: { en: 'Cmd or Ctrl + Shift + Z', es: 'Cmd o Ctrl + Shift + Z' },
        text: { en: 'Redo.', es: 'Rehacer.' },
      },
      {
        term: { en: 'Cmd or Ctrl + C, then V', es: 'Cmd o Ctrl + C, luego V' },
        text: {
          en: 'Copy and paste nodes, with their parameters and the cables between them.',
          es: 'Copiar y pegar nodos, con sus parámetros y los cables que los unen.',
        },
      },
      {
        term: { en: 'Shift + drag', es: 'Shift + arrastrar' },
        text: {
          en: 'Select several nodes at once.',
          es: 'Seleccionar varios nodos a la vez.',
        },
      },
      {
        term: { en: 'Click a cable', es: 'Clic en un cable' },
        text: { en: 'Removes it.', es: 'Lo quita.' },
      },
      {
        term: { en: 'Escape', es: 'Escape' },
        text: {
          en: 'Steps back out of a manual page, and closes the manual from the list.',
          es: 'Sale de una página del manual, y cierra el manual desde la lista.',
        },
      },
    ],
    detail: [
      {
        terms: [
          {
            term: { en: 'With the mouse', es: 'Con el ratón' },
            text: {
              en: 'Drag the canvas to move it and scroll to zoom. Drag a node to move it, and click it to bring its controls up in the panel. Drag from a port to make a cable, and drag a cable off its port to remove it.',
              es: 'Arrastra el lienzo para moverlo y usa la rueda para acercarte. Arrastra un nodo para moverlo, y púlsalo para traer sus controles al panel. Arrastra desde un puerto para hacer un cable, y arrastra un cable fuera de su puerto para quitarlo.',
            },
          },
          {
            term: { en: 'What undo covers', es: 'Qué cubre el undo' },
            text: {
              en: 'One step is one finished gesture, so a slider you dragged across its whole range comes back in a single undo rather than a hundred. Rolling the dice is one step too, which is what makes it safe to press on impulse.',
              es: 'Un paso es un gesto terminado, así que un slider que arrastraste de punta a punta vuelve en un solo undo y no en cien. Tirar el dado es también un paso, que es lo que hace seguro pulsarlo sin pensar.',
            },
          },
          {
            term: {
              en: 'The clipboard outlives a patch',
              es: 'El portapapeles sobrevive a un patch',
            },
            text: {
              en: 'What you copied survives loading another patch, so an oscillator worth keeping can be carried from one roll of the dice to the next — copy it, roll again, paste it in.',
              es: 'Lo que copiaste sobrevive a cargar otro patch, así que un oscilador que merezca la pena se puede llevar de una tirada del dado a la siguiente — cópialo, vuelve a tirar, pégalo.',
            },
          },
          {
            term: { en: 'Typing a number', es: 'Escribir un número' },
            text: {
              en: 'Where a control shows its value as a field rather than as plain text, you can type into it. Out-of-range typing is held while you finish the word and clamped when you leave the field, so a value on the way to 180 is not clamped at 1.',
              es: 'Donde un control muestra su valor como campo y no como texto simple, puedes escribir en él. Lo que escribas fuera de rango se mantiene mientras acabas la palabra y se ajusta al salir del campo, así que un valor camino de 180 no se recorta en 1.',
            },
          },
        ],
      },
    ],
  },
]
