// Generates an original one-second test tone in a temporary directory for browser media checks.
// This is not part of the game's soundtrack and contains no third-party music.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const samples = 22050, buffer = Buffer.alloc(44 + samples * 2);
buffer.write('RIFF', 0); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8);
buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
buffer.writeUInt32LE(samples, 24); buffer.writeUInt32LE(samples * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
buffer.write('data', 36); buffer.writeUInt32LE(samples * 2, 40);
for (let i = 0; i < samples; i++) buffer.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 220 * i / samples) * 1200 * Math.sin(Math.PI * i / samples) ** 2), 44 + i * 2);
const file = join(mkdtempSync(join(tmpdir(), 'throwdown-audio-')), 'original-test-tone.wav');
writeFileSync(file, buffer); console.log(file);
