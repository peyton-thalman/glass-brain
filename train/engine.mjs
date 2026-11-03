// The fingerprint of the planning-engine build in web/js/vendor/ (written by train/vendor/build.mjs). Every script
// that labels data with the engine records it, and the training scripts carry it into the brain they write.
import fs from 'fs';

export const ENGINE = JSON.parse(fs.readFileSync(new URL('../web/js/vendor/engine.json', import.meta.url), 'utf8')).fingerprint;
