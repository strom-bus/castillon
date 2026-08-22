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
  /**
   * What the section leaves out, one control at a time, behind a Read more.
   *
   * Split rather than merged because the two audiences want opposite things. Somebody who has used a
   * synthesiser before wants the idea and the differences and will not read past them; somebody who has
   * not needs to know what every slider does, and hitting that wall first tells them this is not for them.
   * Folding it away lets the short version stay short and the long version be as long as it has to be.
   */
  detail?: Term[]
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
    detail: [
      {
        term: { en: 'A pass', es: 'Una pasada' },
        text: {
          en: 'One run of the whole cascade, from every IGNITE down to the last branch that has anything left to do. It ends when nothing is still travelling, not after a set number of bars — so adding a longer branch makes the pass longer. With Play on, the next one starts as soon as the last has drained.',
          es: 'Una ejecución de la cascada entera, desde cada IGNITE hasta la última rama que le quede algo por hacer. Termina cuando ya no viaja nada, no tras un número fijo de compases — así que añadir una rama más larga alarga la pasada. Con Play puesto, la siguiente arranca en cuanto la anterior se vacía.',
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
    detail: [
      {
        term: { en: 'Making one', es: 'Hacer uno' },
        text: {
          en: 'Drag from a port to a port. The ports on the top and bottom of a node take triggers; the one on its side takes audio or modulation, and which of the two it becomes is decided by what you wired, not by a setting. Drag a cable away from its port to remove it.',
          es: 'Arrastra de un puerto a otro. Los puertos de arriba y abajo de un nodo toman disparos; el del costado toma audio o modulación, y cuál de los dos es lo decide lo que cableaste, no un ajuste. Arrastra un cable fuera de su puerto para quitarlo.',
        },
      },
      {
        term: { en: 'Depth colour', es: 'El color de profundidad' },
        text: {
          en: 'The colour of a node is how far down the cascade it sits, not what kind of thing it is. Nodes at the same depth share a colour, so a wide patch reads as bands and you can see which branches are level with each other. It carries no other meaning.',
          es: 'El color de un nodo es lo hondo que está en la cascada, no de qué tipo es. Los nodos a la misma profundidad comparten color, así que un patch ancho se lee como franjas y ves qué ramas van a la par. No significa nada más.',
        },
      },
      {
        term: { en: 'Why audio does not cascade', es: 'Por qué el audio no cae en cascada' },
        text: {
          en: 'A trigger is an order and audio is a substance. Everything sounding goes to the output at once, and an effect is a send off that — so wiring an oscillator to an effect does not put the effect after it in time, it puts it in the signal path. That is why effect cables go sideways and trigger cables go down.',
          es: 'Un disparo es una orden y el audio es una sustancia. Todo lo que suena va a la salida a la vez, y un efecto es un envío desde ahí — así que cablear un oscilador a un efecto no lo pone después en el tiempo, lo pone en el camino de la señal. Por eso los cables de efecto van de lado y los de disparo van hacia abajo.',
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
    detail: [
      {
        term: { en: 'IGNITE', es: 'IGNITE' },
        text: {
          en: 'Trigger decides what starts it: on its own when you press Play, or on a computer key or a MIDI note. Press the Trigger button and then play the key or note you want — whatever arrives first is what gets bound. Behaviour decides what a press means: held sounds while the key is down, toggled starts on one press and stops on the next.',
          es: 'Trigger decide qué lo arranca: solo al pulsar Play, o con una tecla del ordenador o una nota MIDI. Pulsa el botón Trigger y luego toca la tecla o nota que quieras — lo que llegue primero es lo que queda asignado. Behaviour decide qué significa una pulsación: sostenido suena mientras la tecla está abajo, conmutado arranca en una y para en la siguiente.',
        },
      },
      {
        term: { en: 'OSC — the notes', es: 'OSC — las notas' },
        text: {
          en: 'Two to sixteen steps. Drag a bar up or down to tune that step; click the square underneath to silence it without losing the note. Division is how long a step lasts in musical time, so 1/16 runs four times as fast as 1/4. Gate is the fraction of the step the note actually sounds: low is staccato, one is legato with each note running into the next.',
          es: 'De dos a dieciséis pasos. Arrastra una barra arriba o abajo para afinar ese paso; pulsa el cuadrado de debajo para silenciarlo sin perder la nota. Division es cuánto dura un paso en tiempo musical, así que 1/16 corre cuatro veces más rápido que 1/4. Gate es la fracción del paso que la nota suena de verdad: bajo es staccato, uno es legato y cada nota entra en la siguiente.',
        },
      },
      {
        term: { en: 'OSC — the sound', es: 'OSC — el sonido' },
        text: {
          en: 'Waveform is the raw tone: sine is bare, square and sawtooth are bright, pulse is square with a width control that thins it, and four noises are pitched by playback rate rather than by frequency. Detune shifts it a few cents off, which does nothing on its own and thickens two oscillators into one voice when they disagree slightly. Gain is its level in the mix.',
          es: 'Waveform es el tono crudo: sine es desnudo, square y sawtooth son brillantes, pulse es cuadrada con un control de anchura que la adelgaza, y cuatro ruidos se afinan por velocidad de reproducción en vez de por frecuencia. Detune la desafina unos cents, que a solas no hace nada y engorda dos osciladores en una sola voz cuando discrepan un poco. Gain es su nivel en la mezcla.',
        },
      },
      {
        term: { en: 'OSC — the shape of a note', es: 'OSC — la forma de una nota' },
        text: {
          en: "Attack is how long it takes to reach full volume — short is a hit, long is a swell. Decay is how long it takes to fall back to silence, and zero holds the level until the note ends: that is the difference between a pluck and an organ. Release is the tail after the note is over. Glide slides from the previous step's pitch into this one instead of jumping, which turns a list of notes into a line.",
          es: 'Attack es lo que tarda en llegar a todo volumen — corto es un golpe, largo es una crecida. Decay es lo que tarda en caer al silencio, y cero mantiene el nivel hasta que acaba la nota: esa es la diferencia entre un pluck y un órgano. Release es la cola después de que la nota termine. Glide desliza desde la altura del paso anterior hasta esta en vez de saltar, lo que convierte una lista de notas en una línea.',
        },
      },
      {
        term: { en: 'OSC — the filter', es: 'OSC — el filtro' },
        text: {
          en: 'One filter per note rather than one for the whole oscillator, so sixteen notes get sixteen. Lowpass removes what is above the cutoff and darkens it, highpass removes what is below and thins it, bandpass keeps only what is near it. Resonance emphasises the cutoff itself and at high settings whistles. Key follow makes the cutoff rise with the pitch, which keeps high notes from sounding dull when the patch spans several octaves.',
          es: 'Un filtro por nota y no uno para todo el oscilador, así que dieciséis notas llevan dieciséis. Lowpass quita lo que está por encima del corte y lo oscurece, highpass quita lo de debajo y lo adelgaza, bandpass deja solo lo cercano. Resonance realza el propio corte y en valores altos silba. Key follow hace que el corte suba con la altura, que es lo que evita que las notas agudas suenen apagadas cuando el patch abarca varias octavas.',
        },
      },
      {
        term: { en: 'OSC — what happens next', es: 'OSC — qué pasa después' },
        text: {
          en: 'Propagation decides when this oscillator fires whatever is below it. When it ends is the cascade proper, one branch after another. When it starts fires both at once, so they run in parallel. On every step fires the branch below once per note, which multiplies quickly and is the densest thing in here.',
          es: 'Propagation decide cuándo dispara este oscilador lo que tenga debajo. When it ends es la cascada propiamente dicha, una rama tras otra. When it starts dispara las dos a la vez, así que corren en paralelo. On every step dispara la rama de abajo una vez por nota, lo que se multiplica deprisa y es lo más denso que hay aquí.',
        },
      },
      {
        term: { en: 'DELAY', es: 'DELAY' },
        text: {
          en: 'It makes no sound at all. It catches a trigger, waits the number of milliseconds you set, and passes it on — so the branch below starts late. Put one between two branches that would otherwise fire together and they drift apart. That is the simplest way to get something other than everything landing on the same instant.',
          es: 'No suena en absoluto. Atrapa un disparo, espera los milisegundos que le pongas y lo pasa — así la rama de abajo empieza tarde. Pon uno entre dos ramas que si no dispararían juntas y se separan. Es la forma más simple de conseguir que no todo caiga en el mismo instante.',
        },
      },
      {
        term: { en: 'FX — the shared controls', es: 'FX — los controles comunes' },
        text: {
          en: 'Effect chooses which one it is, and the controls below change with it. Mix is how much of the effect you hear against the untreated signal: at zero it is doing nothing audible while still costing what it costs. Most effects also have a tone control on their output — named Cutoff, Centre, Freq or Tone depending on what it means there — which darkens what the effect adds without touching the dry signal.',
          es: 'Effect elige cuál es, y los controles de abajo cambian con él. Mix es cuánto del efecto oyes contra la señal sin tratar: a cero no hace nada audible y sigue costando lo que cuesta. Casi todos llevan además un control de tono en su salida — llamado Cutoff, Centre, Freq o Tone según lo que signifique ahí — que oscurece lo que el efecto añade sin tocar la señal seca.',
        },
      },
      {
        term: { en: 'FX — space and time', es: 'FX — espacio y tiempo' },
        text: {
          en: 'Reverb is a room, and Decay is how long its tail lasts — it is by far the dearest thing here and the price grows with the tail. Echo repeats: Time is the gap in musical divisions, Feedback is how much of each repeat feeds the next, and Spread pans the repeats apart, at one hard left and right so they ping-pong. Chorus and Phaser both sweep: Rate is how fast, Depth how far, and Sweep on the chorus sets how far the pitch wobbles.',
          es: 'Reverb es una sala, y Decay es lo que dura su cola — es con diferencia lo más caro de aquí y el precio crece con la cola. Echo repite: Time es el hueco en divisiones musicales, Feedback cuánto de cada repetición alimenta la siguiente, y Spread separa las repeticiones en el estéreo, a uno duro izquierda y derecha para que hagan ping-pong. Chorus y Phaser barren los dos: Rate es a qué velocidad, Depth cuánto, y Sweep en el chorus fija cuánto oscila la altura.',
        },
      },
      {
        term: { en: 'FX — dirt and movement', es: 'FX — suciedad y movimiento' },
        text: {
          en: 'Distortion has a Shape that picks the character and Drive for how hard it is pushed. Bitcrusher is the digital kind of dirt: Bits throws away resolution and Decimate throws away sample rate, and the two sound quite different. Tremolo shakes the volume and Pan moves it across the stereo field, both with Rate and Depth. Ring mod multiplies the signal against a tone set by Freq, which is metallic rather than musical. Octave adds a note an octave below.',
          es: 'Distortion tiene un Shape que elige el carácter y Drive para cuánto se empuja. Bitcrusher es la suciedad digital: Bits tira resolución y Decimate tira frecuencia de muestreo, y las dos suenan muy distinto. Tremolo agita el volumen y Pan lo mueve por el estéreo, los dos con Rate y Depth. Ring mod multiplica la señal contra un tono fijado por Freq, que es metálico y no musical. Octave añade una nota una octava por debajo.',
        },
      },
      {
        term: { en: 'MOD — what it is', es: 'MOD — qué es' },
        text: {
          en: "It moves one control of whatever it points at, on its own, while the patch plays. Wire it to a node and pick a Target from the list — the list changes with what you wired it to, so a MOD on a reverb can sweep its decay and one on a chorus its rate. Depth is how far it moves that control, as a share of the control's own range.",
          es: 'Mueve un control de aquello a lo que apunte, por su cuenta, mientras el patch suena. Cablealo a un nodo y elige un Target de la lista — la lista cambia según lo que hayas cableado, así que un MOD sobre un reverb puede barrer su decay y uno sobre un chorus su rate. Depth es cuánto mueve ese control, como fracción del rango del propio control.',
        },
      },
      {
        term: { en: 'MOD — its clock', es: 'MOD — su reloj' },
        text: {
          en: 'Kind is the difference that matters, and it is not the shape but what decides when it moves. An LFO runs at its own Rate for ever, indifferent to the music — four repeating shapes and Random, which holds a value and jumps instead of repeating. An Envelope runs once and stops, with Attack for how fast it moves out and Decay for how slowly it comes back.',
          es: 'Kind es la diferencia que importa, y no es la forma sino qué decide cuándo se mueve. Un LFO corre a su propio Rate para siempre, indiferente a la música — cuatro formas que se repiten y Random, que sostiene un valor y salta en vez de repetirse. Una Envelope corre una vez y para, con Attack para lo rápido que sale y Decay para lo lento que vuelve.',
        },
      },
      {
        term: { en: 'MOD — when an envelope runs', es: 'MOD — cuándo corre una envolvente' },
        text: {
          en: "Fires on decides that. A trigger means once each time one reaches the port on top, so where you wire it is the gesture: under an IGNITE it runs once a pass, under a node deep in the tree it runs when that branch lights up. Every note means one sweep per note, each on that note's own filter, and only an oscillator has notes. On that setting, Scale by velocity lets a hard step open the filter further than a soft one — which is what makes a step's velocity worth setting at all.",
          es: 'Fires on lo decide. A trigger significa una vez cada vez que llega uno al puerto de arriba, así que dónde lo cablees es el gesto: bajo un IGNITE corre una vez por pasada, bajo un nodo hondo corre cuando esa rama se enciende. Every note significa un barrido por nota, cada uno sobre el filtro de esa nota, y solo un oscilador tiene notas. En ese ajuste, Scale by velocity deja que un paso fuerte abra el filtro más que uno flojo — que es lo que hace que valga la pena poner la velocity de un paso.',
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
    detail: [
      {
        term: { en: 'The transport', es: 'El transporte' },
        text: {
          en: 'Play runs the cascade and loops it. Stop lets what is already sounding finish rather than cutting it, so a long reverb tail is not chopped. Reset rebuilds the patch from scratch, which is what to reach for if something sounds stuck. Tempo sets the musical grid the divisions are measured against.',
          es: 'Play corre la cascada y la repite. Stop deja terminar lo que ya suena en vez de cortarlo, así que una cola larga de reverb no se trunca. Reset reconstruye el patch de cero, que es a lo que hay que ir si algo suena atascado. Tempo fija la rejilla musical contra la que se miden las divisiones.',
        },
      },
      {
        term: { en: 'Playing by hand', es: 'Tocarlo a mano' },
        text: {
          en: 'Any IGNITE can be bound to a computer key or a MIDI note, and several can be bound to different ones — that is how a patch becomes something you perform rather than something you start. Held and toggled behave differently under the fingers: held wants you to keep pressing, toggled wants one press and leaves you free.',
          es: 'Cualquier IGNITE puede asignarse a una tecla del ordenador o a una nota MIDI, y varios pueden ir a teclas distintas — así es como un patch pasa de algo que arrancas a algo que tocas. Sostenido y conmutado se comportan distinto bajo los dedos: sostenido pide que sigas pulsando, conmutado pide una pulsación y te deja libre.',
        },
      },
      {
        term: { en: 'MIDI', es: 'MIDI' },
        text: {
          en: 'Plug a class-compliant keyboard in and the socket beside the volume lights up and names it. Nothing needs configuring: notes go to whichever IGNITEs are bound to them, and the channel is ignored. If the socket is grey there is no device, and hovering it says so.',
          es: 'Enchufa un teclado que cumpla el estándar y el conector junto al volumen se enciende y lo nombra. No hay nada que configurar: las notas van a los IGNITE que las tengan asignadas, y el canal se ignora. Si el conector está gris no hay dispositivo, y al pasar por encima lo dice.',
        },
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
    detail: [
      {
        term: { en: 'Reading the meter', es: 'Leer el medidor' },
        text: {
          en: 'The number is a percentage of what this machine can do before the audio thread starts dropping samples. Under about a fifth it tells you very little and moves around; it becomes worth watching above that, and it is a warning rather than a limit.',
          es: 'El número es un porcentaje de lo que esta máquina puede hacer antes de que el hilo de audio empiece a perder muestras. Por debajo de un quinto dice muy poco y se mueve; empieza a valer la pena mirarlo por encima de eso, y es un aviso y no un límite.',
        },
      },
      {
        term: { en: 'What costs what', es: 'Qué cuesta qué' },
        text: {
          en: 'One point is one plain oscillator voice. A reverb is worth about forty of those and grows with its decay, so a long tail is the single most expensive thing you can add. A distortion is about a dozen, a phaser about nine, and most of the rest are a handful each. A filter on an oscillator costs about one voice on top of the voice, because there is one per note.',
          es: 'Un punto es una voz de oscilador simple. Un reverb vale unas cuarenta de esas y crece con su decay, así que una cola larga es lo más caro que puedes añadir. Una distorsión son cerca de doce, un phaser unos nueve, y casi todo lo demás un puñado cada uno. Un filtro en un oscilador cuesta como una voz más sobre la voz, porque hay uno por nota.',
        },
      },
      {
        term: { en: 'What to do when it is high', es: 'Qué hacer cuando está alto' },
        text: {
          en: 'Shorten a reverb decay before anything else; it is where the points are. After that, look for oscillators layering on top of themselves — a fast division with a long release means many notes sounding at once. Turning the filter off on an oscillator that does not need it takes a voice off every note it plays.',
          es: 'Acorta primero el decay de un reverb; ahí están los puntos. Después, busca osciladores superponiéndose sobre sí mismos — una división rápida con un release largo significa muchas notas sonando a la vez. Apagar el filtro en un oscilador que no lo necesita quita una voz de cada nota que toque.',
        },
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
    detail: [
      {
        term: { en: 'The two kinds of code', es: 'Los dos tipos de código' },
        text: {
          en: "The long one is the patch itself, packed into text — it works offline and needs nothing from anywhere. The short six-character one is a reference published to the gallery's store, so it is easier to type but only works while there is a network. Pasting either into the field loads it.",
          es: 'El largo es el patch en sí, empaquetado en texto — funciona sin conexión y no necesita nada de fuera. El corto de seis caracteres es una referencia publicada en el almacén de la galería, así que es más fácil de teclear pero solo funciona con red. Pegar cualquiera de los dos en el campo lo carga.',
        },
      },
      {
        term: { en: 'Exporting audio', es: 'Exportar audio' },
        text: {
          en: 'Export renders a WAV offline, which is faster than listening to it because nothing has to happen in real time. Its length is set in repetitions of the cascade rather than in seconds, since a pass has no fixed length and counting bars would mean measuring it yourself first.',
          es: 'Export renderiza un WAV offline, que es más rápido que escucharlo porque nada tiene que ocurrir en tiempo real. Su duración se pone en repeticiones de la cascada y no en segundos, ya que una pasada no tiene duración fija y contar compases significaría medirla tú antes.',
        },
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
    detail: [
      {
        term: { en: 'With the mouse', es: 'Con el ratón' },
        text: {
          en: 'Drag the canvas to move it and scroll to zoom. Drag a node to move it, and click it to select it and bring its controls up in the panel. Drag from a port to make a cable, and drag a cable off its port to remove it.',
          es: 'Arrastra el lienzo para moverlo y usa la rueda para acercarte. Arrastra un nodo para moverlo, y púlsalo para seleccionarlo y traer sus controles al panel. Arrastra desde un puerto para hacer un cable, y arrastra un cable fuera de su puerto para quitarlo.',
        },
      },
      {
        term: { en: 'What undo covers', es: 'Qué cubre el undo' },
        text: {
          en: 'One step is one finished gesture, so a slider you dragged across its whole range comes back in a single undo rather than a hundred. Rolling the dice is one step too, which is what makes it safe to press on impulse.',
          es: 'Un paso es un gesto terminado, así que un slider que arrastraste de punta a punta vuelve en un solo undo y no en cien. Tirar el dado es también un paso, que es lo que hace seguro pulsarlo sin pensar.',
        },
      },
    ],
  },
]
