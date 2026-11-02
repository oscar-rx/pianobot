// Nombres de notas. Numeración científica: Do4 = Do central = MIDI 60.

const NOMBRES = ['Do', 'Do#', 'Re', 'Re#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si'];
const INGLES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export const octava = (midi) => Math.floor(midi / 12) - 1;
export const nombreNota = (midi) => `${NOMBRES[((midi % 12) + 12) % 12]}${octava(midi)}`;
export const nombreIngles = (midi) => `${INGLES[((midi % 12) + 12) % 12]}${octava(midi)}`;
export const frecuenciaAMidi = (f) => 69 + 12 * Math.log2(f / 440);
export const midiAFrecuencia = (m) => 440 * Math.pow(2, (m - 69) / 12);
export const esTeclaNegra = (midi) => [1, 3, 6, 8, 10].includes(((midi % 12) + 12) % 12);
