// Nombres de notas. Numeración científica: Do4 = Do central = MIDI 60.

const NOMBRES = ['Do', 'Do#', 'Re', 'Re#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si'];
const INGLES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const octava = (midi) => Math.floor(midi / 12) - 1;
export const nombreNota = (midi) => `${NOMBRES[midi % 12]}${octava(midi)}`;
export const nombreIngles = (midi) => `${INGLES[midi % 12]}${octava(midi)}`;
