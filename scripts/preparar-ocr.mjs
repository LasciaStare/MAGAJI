// Prepara recursos de Windows x64: no necesita Python y nunca se ejecuta en la PC del cliente.
import { createHash } from 'node:crypto';
import { readFile, writeFile, copyFile, mkdir, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const resources = join(root, 'src-tauri/resources/ocr');
const cache = join(root, 'src-tauri/target');
const seedIndex = process.argv.indexOf('--modelos');
const seed = seedIndex >= 0 ? process.argv[seedIndex + 1] : undefined;
if (seedIndex >= 0 && !seed) throw new Error('Falta la carpeta después de --modelos.');
if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error('La distribución OCR actual requiere Windows x64.');
}

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function valid(path, hash) {
  try { return sha(await readFile(path)) === hash; } catch { return false; }
}
async function download(url, path, hash) {
  if (await valid(path, hash)) return;
  console.log(`Preparando ${path.split(/[\\/]/).at(-1)}...`);
  const response = await fetch(url, { signal: AbortSignal.timeout(180_000) });
  if (!response.ok) throw new Error(`Descarga fallida: HTTP ${response.status} (${url})`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (sha(bytes) !== hash) throw new Error(`El archivo no coincide con SHA256: ${url}`);
  await writeFile(path, bytes);
}
function extract(archive, directory) {
  const script = 'Expand-Archive -LiteralPath $env:MAGAJI_OCR_ARCHIVE -DestinationPath $env:MAGAJI_OCR_EXTRACT -Force';
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    env: { ...process.env, MAGAJI_OCR_ARCHIVE: archive, MAGAJI_OCR_EXTRACT: directory },
    windowsHide: true, encoding: 'utf8',
  });
  if (result.error || result.status !== 0) throw new Error(`No se pudo extraer ${archive}: ${result.error ?? result.stderr}`);
}

await Promise.all(['runtime','modelos','licencias'].map(folder => mkdir(join(resources,folder),{recursive:true})));
await mkdir(cache,{recursive:true});
const models = [
  ['PP-OCRv6_det_small.onnx', 'onnx/PP-OCRv6/det/PP-OCRv6_det_small.onnx', '090f04abcd9d9a7498bc4ebf677e4cb9bdce1fe4197ddb7e529f1ef44e1ff94f'],
  ['PP-OCRv6_rec_small.onnx', 'onnx/PP-OCRv6/rec/PP-OCRv6_rec_small.onnx', '6f327246b50388f3c176ae304bd95767ea6dc0c9ae92153ef8cbe210b3c14884'],
];
for (const [name,path,hash] of models) {
  const target = join(resources,'modelos',name);
  if (seed && !await valid(target,hash) && await valid(join(seed,name),hash)) await copyFile(join(seed,name),target);
  await download(`https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.9.0/${path}`,target,hash);
}
await download('https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/master/paddle/PP-OCRv6/rec/PP-OCRv6_rec_small/ppocrv6_dict.txt',
  join(resources,'modelos/ppocrv6_dict.txt'),'b5f2bfe2bdd9448429e3e82b51c789775d9b42f2403d082b00662eb77e401c5d');

const ortArchive = join(cache,'onnxruntime-win-x64-1.31.0.zip');
await download('https://github.com/microsoft/onnxruntime/releases/download/v1.31.0/onnxruntime-win-x64-1.31.0.zip',
  ortArchive,'3958d8a44984160692c1b4ffd0de3cb48f8c39f9d34bb31e433db06e30b82195');
const ortDir = join(cache,'onnxruntime-oficial/onnxruntime-win-x64-1.31.0');
try { await stat(join(ortDir,'lib/onnxruntime.dll')); } catch { extract(ortArchive,join(cache,'onnxruntime-oficial')); }
for (const name of ['onnxruntime.dll','onnxruntime_providers_shared.dll']) {
  await copyFile(join(ortDir,'lib',name),join(resources,'runtime',name));
}
for (const name of ['LICENSE','ThirdPartyNotices.txt']) {
  await copyFile(join(ortDir,name),join(resources,'licencias',`ONNXRuntime-${name}`));
}

// DLL oficiales de Microsoft, incluidas junto al ejecutable: no requiere instalar Visual C++.
const vcArchive = join(cache,'vclibs-desktop-x64.zip');
await download('https://download.microsoft.com/download/4/7/c/47c6134b-d61f-4024-83bd-b9c9ea951c25/Microsoft.VCLibs.x64.14.00.Desktop.appx',
  vcArchive,'b56a9101f706f9d95f815f5b7fa6efbac972e86573d378b96a07cff5540c5961');
const vcDir = join(cache,'vclibs-ocr');
try { await stat(join(vcDir,'msvcp140.dll')); } catch { extract(vcArchive,vcDir); }
for (const name of ['msvcp140.dll','msvcp140_1.dll','vcruntime140.dll','vcruntime140_1.dll']) {
  await copyFile(join(vcDir,name),join(resources,'runtime',name));
}
await copyFile(join(root,'docs/OCR-DISTRIBUCION.md'),join(resources,'licencias/LEEME.md'));
await download('https://raw.githubusercontent.com/White-NX/rapidocr-rs/d49bfdfbf72dd1d9a403b03b3f95c27d61c47e34/LICENSE',
  join(resources,'licencias/Apache-2.0.txt'),'c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4');
console.log('RapidOCR Rust preparado: modelos Small, ONNX Runtime CPU y bibliotecas Windows x64.');
