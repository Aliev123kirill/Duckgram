import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const keyPath = path.join(dir, 'key.pem');
const manifestPath = path.join(dir, 'manifest.json');
const outDir = path.join(dir, 'dist');

let privateKey;
if (fs.existsSync(keyPath)) {
  privateKey = crypto.createPrivateKey(fs.readFileSync(keyPath, 'utf8'));
} else {
  const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  privateKey = pair.privateKey;
  fs.writeFileSync(keyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }));
  console.log('ключ создан:', keyPath);
}

const spkiDer = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
const spkiB64 = spkiDer.toString('base64');
const sha256 = crypto.createHash('sha256').update(spkiDer).digest();
const crxId = sha256.subarray(0, 16);
const extId = [...crxId].map((b) => 'abcdefghijklmnop'[b >> 4] + 'abcdefghijklmnop'[b & 15]).join('');

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (manifest.key !== spkiB64) {
  manifest.key = spkiB64;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log('манифест обновлён полем key');
}
const version = manifest.version;

const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};

const entries = [];
const walk = (abs, rel) => {
  for (const name of fs.readdirSync(abs).sort()) {
    const a = path.join(abs, name);
    const r = rel ? `${rel}/${name}` : name;
    if (fs.statSync(a).isDirectory()) walk(a, r);
    else entries.push({ name: r, data: fs.readFileSync(a) });
  }
};
for (const item of ['manifest.json', 'background.js', 'open.html', 'open.js', 'welcome.html', 'welcome.js', 'icons']) {
  const abs = path.join(dir, item);
  if (!fs.existsSync(abs)) continue;
  if (fs.statSync(abs).isDirectory()) walk(abs, item);
  else entries.push({ name: item, data: fs.readFileSync(abs) });
}

const now = new Date();
const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xffff;
const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff;

const locals = [];
const centrals = [];
let offset = 0;
for (const e of entries) {
  const nameBuf = Buffer.from(e.name, 'utf8');
  const crc = crc32(e.data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6);
  local.writeUInt16LE(0, 8);
  local.writeUInt16LE(dosTime, 10);
  local.writeUInt16LE(dosDate, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(e.data.length, 18);
  local.writeUInt32LE(e.data.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  local.writeUInt16LE(0, 28);
  locals.push(local, nameBuf, e.data);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(0, 10);
  central.writeUInt16LE(dosTime, 12);
  central.writeUInt16LE(dosDate, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(e.data.length, 20);
  central.writeUInt32LE(e.data.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt16LE(0, 30);
  central.writeUInt16LE(0, 32);
  central.writeUInt16LE(0, 34);
  central.writeUInt16LE(0, 36);
  central.writeUInt32LE(0, 38);
  central.writeUInt32LE(offset, 42);
  centrals.push(central, nameBuf);

  offset += local.length + nameBuf.length + e.data.length;
}
const cd = Buffer.concat(centrals);
const eocd = Buffer.alloc(22);
eocd.writeUInt32LE(0x06054b50, 0);
eocd.writeUInt16LE(entries.length, 8);
eocd.writeUInt16LE(entries.length, 10);
eocd.writeUInt32LE(cd.length, 12);
eocd.writeUInt32LE(offset, 16);
const zip = Buffer.concat([...locals, cd, eocd]);

fs.mkdirSync(outDir, { recursive: true });
const zipPath = path.join(outDir, `tg-links-extension-${version}.zip`);
fs.writeFileSync(zipPath, zip);

const varint = (n) => {
  const out = [];
  while (n > 127) {
    out.push((n & 0x7f) | 0x80);
    n >>>= 7;
  }
  out.push(n);
  return Buffer.from(out);
};
const tag = (field, wire) => varint(field * 8 + wire);
const lenField = (field, buf) => Buffer.concat([tag(field, 2), varint(buf.length), buf]);

const signedHeaderData = lenField(1, crxId);
const proof = Buffer.concat([lenField(1, spkiDer), lenField(2, Buffer.alloc(0))]);

const signedInput = Buffer.concat([
  Buffer.from('CRX3 SignedData\x00', 'binary'),
  (() => {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(signedHeaderData.length, 0);
    return b;
  })(),
  signedHeaderData,
  zip,
]);
const signature = crypto.sign('sha256', signedInput, privateKey);

const proofSigned = Buffer.concat([lenField(1, spkiDer), lenField(2, signature)]);
const header = Buffer.concat([lenField(2, proofSigned), lenField(10000, signedHeaderData)]);

const crxHead = Buffer.alloc(12);
crxHead.write('Cr24', 0, 'binary');
crxHead.writeUInt32LE(3, 4);
crxHead.writeUInt32LE(header.length, 8);

const crx = Buffer.concat([crxHead, header, zip]);
const crxPath = path.join(outDir, `tg-links-extension-${version}.crx`);
fs.writeFileSync(crxPath, crx);

const read = Buffer.from(crx);
const okMagic = read.subarray(0, 4).toString('binary') === 'Cr24' && read.readUInt32LE(4) === 3;
const headLen = read.readUInt32LE(8);
const bodyZip = read.subarray(12 + headLen);
const bodyOk = bodyZip.equals(zip);
const verifySig = crypto.verify('sha256', signedInput, crypto.createPublicKey(privateKey), signature);

console.log('id          :', extId);
console.log('версия      :', version);
console.log('файлов      :', entries.length);
console.log('zip         :', zipPath, zip.length + ' Б');
console.log('crx3        :', crxPath, crx.length + ' Б');
console.log('магия/версия:', okMagic ? 'ok' : 'ОШИБКА');
console.log('zip внутри  :', bodyOk ? 'совпадает' : 'ОШИБКА');
console.log('подпись     :', verifySig ? 'верна' : 'ОШИБКА');
