/** Install one checksum-pinned macOS ARM64 runtime into the explicit service data directory. */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, copyFile, chmod, mkdtemp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
const version = '1.2.4';
const asset = `biliupR-v${version}-aarch64-macos`;
const archiveHash = 'f2341fbb2c95be4f0934d070d13e3891ff83a68fa35c20bcebc5518bee7cf15b';
const binaryHash = '1a0d178ae7be6be76f060e12d7910b30798334d1f1921f226a8311ad003a588a';
const args = process.argv.slice(2);
if (args[0] !== '--data-dir' || !args[1]) throw new Error('Usage: node scripts/install-biliup.mjs --data-dir <service-data-dir> [--archive <downloaded-file>]');
if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('This pinned runtime currently supports macOS ARM64 only.');
const destination = join(resolve(args[1]), 'platform-runtime', 'biliup', version);
const temporary = await mkdtemp(join(tmpdir(), 'azu-biliup-install-'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
try {
  let bytes;
  if (args[2] === '--archive' && args[3]) bytes = await readFile(resolve(args[3]));
  else {
    const response = await fetch(`https://github.com/biliup/biliup/releases/download/v${version}/${asset}.tar.xz`, {signal:AbortSignal.timeout(120000)});
    if (!response.ok) throw new Error(`Runtime download failed: HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  if (hash(bytes) !== archiveHash) throw new Error('Runtime archive checksum mismatch.');
  const archive = join(temporary, 'archive.tar.xz');
  await writeFile(archive, bytes);
  execFileSync('/usr/bin/tar', ['-xJf', archive, '-C', temporary]);
  const binary = join(temporary, asset, 'biliup');
  if (hash(await readFile(binary)) !== binaryHash) throw new Error('Runtime executable checksum mismatch.');
  const output = execFileSync(binary, ['--version'], {encoding:'utf8',timeout:10000}).trim();
  if (output !== `biliup-cli ${version}`) throw new Error('Unexpected runtime version.');
  execFileSync('python3', ['-c', 'import pty, select, signal'], {timeout:10000});
  await mkdir(destination, {recursive:true, mode:0o700});
  await copyFile(binary, join(destination, 'biliup'));
  await chmod(join(destination, 'biliup'), 0o700);
  await writeFile(join(destination, 'manifest.json'), JSON.stringify({version, source:`https://github.com/biliup/biliup/releases/tag/v${version}`,archiveHash,binaryHash},null,2)+'\n',{mode:0o600});
  console.log(`Installed ${output} with verified checksum into ${destination}`);
} finally { await rm(temporary,{recursive:true,force:true}); }
