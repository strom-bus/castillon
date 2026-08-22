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
 * What it explains, in order of what somebody needs first: the one idea everything follows from, then
 * how to read the picture, then the parts, then playing it, then getting it out. Nothing here restates
 * a label that is already on screen.
 */

export interface Passage {
  en: string
  es: string
}

/** A named thing and what it is, for the parts of the manual that are really a glossary. */
export interface Term {
  term: Passage
  text: Passage
}

export interface Section {
  id: string
  title: Passage
  body: Passage[]
  terms?: Term[]
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
        en: 'That is why a pass has no fixed length. Each one lasts as long as its longest branch, so the cycle breathes instead of holding a pulse. Everything else in here follows from that.',
        es: 'Por eso una pasada no tiene duración fija. Cada una dura lo que su rama más larga, así que el ciclo respira en vez de sostener un pulso. Todo lo demás sale de ahí.',
      },
    ],
  },
  {
    id: 'cables',
    title: { en: 'Reading the picture', es: 'Leer el dibujo' },
    body: [
      {
        en: 'There are three kinds of cable, and you can tell them apart by direction and by behaviour rather than by remembering a colour. Colour here means something else: how deep down the cascade a node sits.',
        es: 'Hay tres tipos de cable, y se distinguen por dirección y por comportamiento antes que por recordar un color. El color aquí significa otra cosa: a qué profundidad de la cascada está un nodo.',
      },
    ],
    terms: [
      {
        term: { en: 'Triggers — top and bottom', es: 'Disparos — arriba y abajo' },
        text: {
          en: 'Thin, and they flow. This is the cascade: what fires what, and in what order.',
          es: 'Finos, y corren. Esta es la cascada: qué dispara a qué, y en qué orden.',
        },
      },
      {
        term: { en: 'Audio — the sides', es: 'Audio — los lados' },
        text: {
          en: 'Thicker, and they glow. An oscillator feeds an effect. Audio does not cascade: everything sounding plays at once into the output, and effects are sends off it.',
          es: 'Más gruesos, y brillan. Un oscilador alimenta un efecto. El audio no cae en cascada: todo lo que suena va a la vez a la salida, y los efectos son envíos desde ahí.',
        },
      },
      {
        term: { en: 'Modulation — the sides too', es: 'Modulación — también los lados' },
        text: {
          en: 'Dotted, and they breathe. A MOD sweeping a parameter of whatever it points at. One port per side takes either kind: what a cable *is* comes from what is at its ends, so a cable drawn backwards is turned round rather than refused.',
          es: 'Punteados, y respiran. Un MOD barriendo un parámetro de lo que tenga apuntado. Un puerto por lado acepta cualquiera de los dos: lo que un cable *es* lo deciden sus extremos, así que un cable dibujado al revés se da la vuelta en vez de rechazarse.',
        },
      },
    ],
  },
  {
    id: 'nodes',
    title: { en: 'The parts', es: 'Las piezas' },
    body: [],
    terms: [
      {
        term: { en: 'IGNITE', es: 'IGNITE' },
        text: {
          en: 'Where a cascade starts. It fires by itself when you press Play, or waits for a key or a MIDI note — held, so it sounds while the key is down, or toggled, starting on one press and stopping on the next.',
          es: 'Donde arranca una cascada. Dispara sola al pulsar Play, o espera una tecla o una nota MIDI — sostenida, que suena mientras la tecla está pulsada, o conmutada, que arranca en una pulsación y para en la siguiente.',
        },
      },
      {
        term: { en: 'OSC', es: 'OSC' },
        text: {
          en: 'A sequencer and a voice in one. Two to sixteen steps: drag a bar to tune it, click the square underneath to mute it. Ten waveforms, four noises among them, and a filter built per note rather than shared. Its envelope has a decay but no sustain, because the length of a note is decided in advance here: a short decay is a pluck, a long one a flat top. Glide slides from one step into the next, Detune sets it a few cents off so that two oscillators read as one thick voice, and Key follow opens the filter as the pitch rises — which matters because the die picks the register, not you.',
          es: 'Un secuenciador y una voz a la vez. De dos a dieciséis pasos: arrastra una barra para afinarla, pulsa el cuadrado de debajo para silenciarla. Diez formas de onda, cuatro ruidos entre ellas, y un filtro construido por nota y no compartido. Su envolvente tiene decay pero no sustain, porque aquí la duración de una nota se decide de antemano: un decay corto es un pluck, uno largo un techo plano. Glide desliza de un paso al siguiente, Detune la desafina unos cents para que dos osciladores se lean como una sola voz gorda, y Key follow abre el filtro a medida que sube la altura — que importa porque el registro lo elige el dado, no tú.',
        },
      },
      {
        term: { en: 'DELAY', es: 'DELAY' },
        text: {
          en: 'Holds a trigger and passes it on later. It makes no sound: it shifts when the branch below it starts, which is how branches drift out of step with each other.',
          es: 'Retiene un disparo y lo pasa más tarde. No suena: desplaza cuándo empieza la rama de debajo, que es cómo las ramas se desfasan entre sí.',
        },
      },
      {
        term: { en: 'FX', es: 'FX' },
        text: {
          en: 'Eleven effects behind one selector, wired to an oscillator’s side as a send. Several effects can share one oscillator, and one effect can take several.',
          es: 'Once efectos detrás de un selector, cableados al lado de un oscilador como un envío. Varios efectos pueden compartir un oscilador, y un efecto puede recibir de varios.',
        },
      },
      {
        term: { en: 'MOD', es: 'MOD' },
        text: {
          en: 'Sweeps one parameter of whatever it points at, and which parameters it offers depends on what that is. An LFO keeps its own rate; an envelope runs once, when the cascade triggers it or on every note. Where you wire the trigger decides the gesture: under an IGNITE it runs once per pass, under a node deep in the tree it runs when that branch lights up. Four of the LFO shapes repeat; Random holds a value and jumps instead, so it varies without ever coming round again. An envelope firing on every note can take its depth from that note velocity, which is what makes a step velocity a source rather than a second volume control.',
          es: 'Barre un parámetro de lo que tenga apuntado, y qué parámetros ofrece depende de qué sea. Un LFO mantiene su propio ritmo; una envolvente corre una vez, cuando la cascada la dispara o en cada nota. Dónde cableas el disparo decide el gesto: bajo un IGNITE corre una vez por pasada, bajo un nodo profundo corre cuando esa rama se enciende. Cuatro de las formas del LFO se repiten; Random en cambio sostiene un valor y salta, así que varía sin volver nunca al principio. Una envolvente que dispara en cada nota puede tomar su profundidad de la velocity de esa nota, que es lo que convierte la velocity de un paso en una fuente y no en un segundo control de volumen.',
        },
      },
    ],
  },
  {
    id: 'playing',
    title: { en: 'Playing it', es: 'Tocarlo' },
    body: [
      {
        en: 'Play starts the transport and loops the whole cascade: when every branch has drained, it fires again. Reset rebuilds the patch from scratch. The dice in the corner rolls a patch worth listening to — press it on impulse, because undo covers it.',
        es: 'Play arranca el transporte y repite la cascada entera: cuando todas las ramas se han vaciado, dispara otra vez. Reset reconstruye el patch de cero. El dado de la esquina tira un patch que merece la pena oír — púlsalo sin pensar, que el undo lo cubre.',
      },
      {
        en: 'To play an IGNITE by hand, set its trigger to a key or note and press the Trigger button — then play it. Whatever arrives first is what gets bound, a computer key or a note from a MIDI keyboard. The socket beside the volume says whether there is a keyboard there, and names it when there is.',
        es: 'Para tocar un IGNITE a mano, pon su disparo en tecla o nota y pulsa el botón Trigger — luego tócalo. Lo que llegue primero es lo que queda asignado, una tecla del ordenador o una nota de un teclado MIDI. El conector junto al volumen dice si hay un teclado, y lo nombra cuando lo hay.',
      },
    ],
  },
  {
    id: 'budget',
    title: { en: 'The budget', es: 'El presupuesto' },
    body: [
      {
        en: 'The meter counts work, not voices. One point is one plain oscillator voice, and the ceiling is what the machine can actually manage before the audio thread starts dropping samples — measured, not chosen. A reverb costs about fifty voices, a per-voice filter about one, noise a little over two. Those numbers are measured twice: once against an offline render, once against the audio thread in real time.',
        es: 'El medidor cuenta trabajo, no voces. Un punto es una voz de oscilador simple, y el techo es lo que la máquina aguanta de verdad antes de que el hilo de audio empiece a perder muestras — medido, no elegido. Un reverb cuesta unas cincuenta voces, un filtro por voz cerca de una, el ruido algo más de dos. Esos números están medidos dos veces: contra un render offline y contra el hilo de audio en directo.',
      },
      {
        en: 'Past three quarters of the budget a retriggered oscillator restarts instead of layering, so a heavy patch degrades before it glitches. That three quarters is the safety margin — the ceiling is what one machine managed, and a slower one runs out sooner. Effects are never switched off behind your back: you put them there.',
        es: 'Pasados tres cuartos del presupuesto, un oscilador redisparado reinicia en vez de superponerse, así que un patch cargado se degrada antes de romperse. Ese tres cuartos es el margen de seguridad — el techo es lo que aguantó una máquina, y otra más lenta se queda sin aire antes. Los efectos nunca se apagan a tus espaldas: los pusiste tú.',
      },
    ],
  },
  {
    id: 'sharing',
    title: { en: 'Getting it out', es: 'Sacarlo de aquí' },
    body: [
      {
        en: 'The whole patch packs into one string. Generate publishes it and puts a six-character code in the field — that code refers to the patch rather than containing it, so the same patch always gets the same code. Paste either kind of code to load one.',
        es: 'El patch entero se empaqueta en una sola cadena. Generate lo publica y pone un código de seis caracteres en el campo — ese código se refiere al patch en vez de contenerlo, así que el mismo patch siempre recibe el mismo código. Pega cualquiera de los dos tipos de código para cargar uno.',
      },
      {
        en: 'Share puts it in the gallery, which opens as a window over the canvas: choosing a patch there loads it into the canvas already underneath. Export renders a WAV offline, faster than listening, and its length is measured in repetitions of the cascade rather than in seconds — because a cascade’s length belongs to the patch and is not something you should have to measure.',
        es: 'Share lo pone en la galería, que se abre como una ventana sobre el lienzo: elegir un patch ahí lo carga en el lienzo que ya está debajo. Export renderiza un WAV offline, más rápido que escucharlo, y su duración se mide en repeticiones de la cascada y no en segundos — porque la duración de una cascada es del patch y no algo que debas medir tú.',
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
          en: 'Copy and paste nodes, with their parameters and the cables between them. The clipboard outlives loading another patch, so an oscillator worth keeping can be carried from one roll of the dice to the next.',
          es: 'Copiar y pegar nodos, con sus parámetros y los cables entre ellos. El portapapeles sobrevive a cargar otro patch, así que un oscilador que merezca la pena se puede llevar de una tirada del dado a la siguiente.',
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
    ],
  },
]
