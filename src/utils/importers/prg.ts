import { fs } from '../electronImports';
import { framebufFromJson } from '../../redux/workspace';
import {
  CHARSET_LOWER,
  CHARSET_UPPER,
  DEFAULT_BACKGROUND_COLOR,
  DEFAULT_BORDER_COLOR,
} from '../../redux/editor';
import { Pixel } from '../../redux/types';
import { chunkArray, executablePrgTemplate } from '../../utils';

// Petmate's "Executable .prg" exporter (see utils/exporters/index.ts,
// saveExecutablePRG) patches a fixed .prg template:
//
//   - the LDA operand before "STA $d020" -> border color
//   - the LDA operand before "STA $d021" -> background color
//   - the LDA operand before "STA $d018" -> charset select ($14 upper, $17 lower)
//   - 1000 screencodes starting at file offset 0x62
//   - 1000 color codes starting at file offset 0x62 + 1000
//
// This importer recognizes such a file by matching it byte for byte against
// the same template, ignoring only the bytes listed above.
//
// It also recognizes the simpler "disk art" .prg format (see
// utils/exporters/index.ts, saveDiskartPRG): just a 2-byte $0400 load
// address followed by the 1000 raw screencodes, with no color RAM, border
// or background color stored.

const SCREENCODE_OFFS = 0x62;
const WIDTH = 40;
const HEIGHT = 25;
const NUM_CELLS = WIDTH * HEIGHT; // 1000
const DISKART_DEFAULT_TEXT_COLOR = 14;

function findMarker(buf: Buffer, marker: number[]) {
  return buf.indexOf(Buffer.from(marker));
}

function loadDiskartPrg(buf: Buffer) {
  if (buf.length !== 2 + NUM_CELLS || buf[0] !== 0x00 || buf[1] !== 0x04) {
    return undefined;
  }

  const codes: Pixel[] = [];
  for (let i = 0; i < NUM_CELLS; i++) {
    codes.push({
      code: buf[2 + i],
      color: DISKART_DEFAULT_TEXT_COLOR,
    });
  }

  return framebufFromJson({
    width: WIDTH,
    height: HEIGHT,
    backgroundColor: DEFAULT_BACKGROUND_COLOR,
    borderColor: DEFAULT_BORDER_COLOR,
    charset: CHARSET_UPPER,
    framebuf: chunkArray(codes, WIDTH),
  });
}

export function loadPrg(filename: string) {
  try {
    const buf = fs.readFileSync(filename);
    const template: Buffer = executablePrgTemplate;

    if (buf.length !== template.length) {
      const diskart = loadDiskartPrg(buf);
      if (diskart !== undefined) {
        return diskart;
      }
      throw new Error('This does not look like a Petmate-exported executable .prg or disk art .prg (unexpected file size).');
    }

    // "STA $d020", "STA $d021", "STA $d018"
    const d020idx = findMarker(buf, [0x8d, 0x20, 0xd0]);
    const d021idx = findMarker(buf, [0x8d, 0x21, 0xd0]);
    const d018idx = findMarker(buf, [0x8d, 0x18, 0xd0]);
    if (d020idx < 1 || d021idx < 1 || d018idx < 1) {
      throw new Error('This does not look like a Petmate-exported executable .prg (missing marker).');
    }

    const variableOffsets = new Set<number>([d020idx - 1, d021idx - 1, d018idx - 1]);
    for (let i = SCREENCODE_OFFS; i < SCREENCODE_OFFS + NUM_CELLS * 2; i++) {
      variableOffsets.add(i);
    }
    for (let i = 0; i < template.length; i++) {
      if (!variableOffsets.has(i) && buf[i] !== template[i]) {
        throw new Error('This does not look like a Petmate-exported executable .prg (content mismatch).');
      }
    }

    const borderColor = buf[d020idx - 1] & 0xf;
    const backgroundColor = buf[d021idx - 1] & 0xf;
    const charset = buf[d018idx - 1] === 0x17 ? CHARSET_LOWER : CHARSET_UPPER;

    const codes: Pixel[] = [];
    for (let i = 0; i < NUM_CELLS; i++) {
      codes.push({
        code: buf[SCREENCODE_OFFS + i],
        color: buf[SCREENCODE_OFFS + NUM_CELLS + i] & 0xf,
      });
    }

    return framebufFromJson({
      width: WIDTH,
      height: HEIGHT,
      backgroundColor,
      borderColor,
      charset,
      framebuf: chunkArray(codes, WIDTH),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    alert(`Failed to load file '${filename}'!\n\n${msg}`);
    console.error(e);
    return undefined;
  }
}
