const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const svgPath = path.resolve(__dirname, '../public/bus-mascot.svg');
const publicDir = path.resolve(__dirname, '../public');

async function generate() {
  const svgBuffer = fs.readFileSync(svgPath);

  // 192x192 PNG
  await sharp(svgBuffer)
    .resize(192, 192)
    .png()
    .toFile(path.join(publicDir, 'icon-192.png'));
  console.log('Created icon-192.png');

  // 512x512 PNG
  await sharp(svgBuffer)
    .resize(512, 512)
    .png()
    .toFile(path.join(publicDir, 'icon-512.png'));
  console.log('Created icon-512.png');

  // 512x512 maskable PNG (with safe padding)
  await sharp(svgBuffer)
    .resize(410, 410)
    .extend({
      top: 51,
      bottom: 51,
      left: 51,
      right: 51,
      background: '#0b132b'
    })
    .png()
    .toFile(path.join(publicDir, 'icon-maskable.png'));
  console.log('Created icon-maskable.png');
}

generate().catch(console.error);
