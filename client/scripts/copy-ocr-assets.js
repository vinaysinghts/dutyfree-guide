// Copies the Tesseract.js worker, WASM core and English model into public/ocr
// so the web app serves them itself instead of loading them from third-party
// CDNs at runtime (privacy, reliability, works behind strict firewalls).
// Runs automatically after `npm install` (postinstall). public/ocr is gitignored.
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const out = path.join(root, 'public', 'ocr');
fs.mkdirSync(path.join(out, 'lang'), { recursive: true });

const copy = (from, to) => fs.copyFileSync(path.join(root, 'node_modules', from), path.join(out, to));

copy('tesseract.js/dist/worker.min.js', 'worker.min.js');
// We run the LSTM engine (OEM 1), so only its two builds (with/without SIMD) are needed.
  for (const f of fs.readdirSync(path.join(root, 'node_modules/tesseract.js-core'))) {
  if (/^tesseract-core(-simd)?-lstm\.(js|wasm|wasm\.js)$/.test(f)) copy(`tesseract.js-core/${f}`, f);
}
copy('@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'lang/eng.traineddata.gz');
console.log('OCR assets copied to public/ocr');
