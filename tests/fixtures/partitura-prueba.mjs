// Partitura de prueba (sin derechos de nadie): n compases de 4/4, mano derecha con una escala
// en negras y mano izquierda con redondas. Sirve para las pruebas de la partitura en Chrome.

const ESCALA = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

function nota(paso, octava, duracion, tipo, pentagrama, voz) {
  return `<note><pitch><step>${paso}</step><octave>${octava}</octave></pitch><duration>${duracion}</duration><voice>${voz}</voice><type>${tipo}</type><staff>${pentagrama}</staff></note>`;
}

// Textos como los de los ficheros convertidos de Capella (Tobi's Notenarchiv): título, autor y movimiento
// metidos dentro de los compases. Y una indicación musical («dolce») que NO se debe quitar.
const TEXTOS_CAPELLA = {
  1: '<direction placement="above"><direction-type><words font-size="17" font-weight="bold" justify="center">Invención de prueba.</words></direction-type><staff>1</staff></direction>',
  2: '<direction placement="above"><direction-type><words font-size="10" justify="right">Juan Sebastián Prueba\nBWV 999</words></direction-type><staff>1</staff></direction>',
  3: '<direction placement="above"><direction-type><words font-size="12" font-weight="bold">2. Fughetta</words></direction-type><staff>1</staff></direction>',
  4: '<direction placement="below"><direction-type><words font-style="italic">dolce</words></direction-type><staff>1</staff></direction>',
};

/**
 * @param {number} compases
 * @param {{silencios?: number[], textosCapella?: boolean}} o
 *   silencios: compases con media parte de silencio en la mano derecha; textosCapella: añade TEXTOS_CAPELLA
 */
export function partituraPrueba(compases = 25, { silencios = [], textosCapella = false } = {}) {
  let medidas = '';
  for (let m = 1; m <= compases; m++) {
    const atributos =
      m === 1
        ? '<attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>'
        : '';
    let derecha = '';
    const notas = silencios.includes(m) ? 2 : 4;
    for (let t = 0; t < notas; t++) derecha += nota(ESCALA[(m + t) % 7], 4 + Math.floor((m + t) / 7) % 2, 1, 'quarter', 1, 1);
    if (notas === 2) derecha += '<note><rest/><duration>2</duration><voice>1</voice><type>half</type><staff>1</staff></note>';
    const izquierda = nota(ESCALA[m % 7], 3, 4, 'whole', 2, 2);
    const texto = textosCapella ? TEXTOS_CAPELLA[m] ?? '' : '';
    medidas += `<measure number="${m}">${atributos}${texto}${derecha}<backup><duration>4</duration></backup>${izquierda}</measure>`;
  }
  return `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="3.1"><part-list><score-part id="P1"><part-name></part-name></score-part></part-list><part id="P1">${medidas}</part></score-partwise>`;
}
