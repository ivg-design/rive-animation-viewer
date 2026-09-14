import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const publicDir = path.resolve(process.cwd(), "public");

const images = [
  {
    source: "media/screenshots/hero-rav-window.webp",
    outputStem: "media/responsive/hero-rav-window",
    widths: [384, 768, 1100, 1600],
    options: { quality: 82, smartSubsample: true },
  },
  {
    source: "docs/vm-controls-panel.webp",
    outputStem: "media/responsive/vm-controls-panel",
    widths: [400, 800],
    options: { quality: 82, smartSubsample: true },
  },
  {
    source: "docs/export-controls.webp",
    outputStem: "media/responsive/export-controls",
    widths: [400, 800, 1200],
    options: { quality: 82, smartSubsample: true },
  },
  {
    source: "docs/mcp-setup.webp",
    outputStem: "media/responsive/mcp-setup",
    widths: [400, 800, 1200],
    options: { quality: 82, smartSubsample: true },
  },
  {
    source: "images/app-icon.png",
    outputStem: "media/responsive/app-icon",
    widths: [32, 64],
    options: { lossless: true },
  },
];

for (const image of images) {
  const source = path.join(publicDir, image.source);
  for (const width of image.widths) {
    const output = path.join(publicDir, `${image.outputStem}-w${width}.webp`);
    await fs.mkdir(path.dirname(output), { recursive: true });
    await sharp(source)
      .resize({ width, withoutEnlargement: true })
      .webp(image.options)
      .toFile(output);
  }
}

console.log(`Generated ${images.reduce((total, image) => total + image.widths.length, 0)} responsive image variants.`);
