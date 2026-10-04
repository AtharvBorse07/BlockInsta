"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const sizes = [16, 32, 48, 64, 96, 128, 256, 512];
const outputDirectory = path.resolve(__dirname, "..", "extension", "icons");
const oversample = 4;

function makeCrcTable() {
  return Array.from({ length: 256 }, (_, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) !== 0
        ? 0xedb88320 ^ (value >>> 1)
        : value >>> 1;
    }
    return value >>> 0;
  });
}

const crcTable = makeCrcTable();

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBuffer.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 8 + data.length);
  return chunk;
}

function roundedRectangleDistance(x, y, left, top, right, bottom, radius) {
  const centerX = Math.max(left + radius, Math.min(x, right - radius));
  const centerY = Math.max(top + radius, Math.min(y, bottom - radius));
  return Math.hypot(x - centerX, y - centerY) - radius;
}

function segmentDistance(x, y, x1, y1, x2, y2) {
  const deltaX = x2 - x1;
  const deltaY = y2 - y1;
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;
  const amount = lengthSquared === 0
    ? 0
    : Math.max(0, Math.min(1,
      ((x - x1) * deltaX + (y - y1) * deltaY) / lengthSquared));
  return Math.hypot(x - (x1 + amount * deltaX), y - (y1 + amount * deltaY));
}

function blendPixel(pixels, index, color, alpha = 1) {
  const sourceAlpha = (color[3] / 255) * alpha;
  const destinationAlpha = pixels[index + 3] / 255;
  const resultAlpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha);
  if (resultAlpha <= 0) {
    return;
  }

  for (let channel = 0; channel < 3; channel += 1) {
    pixels[index + channel] = Math.round(
      (color[channel] * sourceAlpha
        + pixels[index + channel] * destinationAlpha * (1 - sourceAlpha))
        / resultAlpha,
    );
  }
  pixels[index + 3] = Math.round(resultAlpha * 255);
}

function renderLargeCanvas(size) {
  const dimension = size * oversample;
  const pixels = new Uint8Array(dimension * dimension * 4);
  const scale = dimension / 100;

  for (let y = 0; y < dimension; y += 1) {
    for (let x = 0; x < dimension; x += 1) {
      const unitX = (x + 0.5) / scale;
      const unitY = (y + 0.5) / scale;
      const index = (y * dimension + x) * 4;
      const backgroundDistance = roundedRectangleDistance(
        unitX,
        unitY,
        3,
        3,
        97,
        97,
        23,
      );

      if (backgroundDistance <= 0) {
        const blend = Math.max(0, Math.min(1, (unitX + unitY) / 200));
        pixels[index] = Math.round(43 + 38 * blend);
        pixels[index + 1] = Math.round(34 + 23 * blend);
        pixels[index + 2] = Math.round(104 + 72 * blend);
        pixels[index + 3] = 255;
      }

      const cameraOuter = roundedRectangleDistance(
        unitX,
        unitY,
        24,
        24,
        76,
        76,
        14,
      );
      const cameraInner = roundedRectangleDistance(
        unitX,
        unitY,
        31,
        31,
        69,
        69,
        8,
      );
      if (cameraOuter <= 0 && cameraInner > 0) {
        blendPixel(pixels, index, [255, 255, 255, 255]);
      }

      const lensDistance = Math.abs(Math.hypot(unitX - 50, unitY - 50) - 11.5);
      if (lensDistance <= 3.4) {
        blendPixel(pixels, index, [255, 255, 255, 255]);
      }

      if (Math.hypot(unitX - 65.5, unitY - 34.5) <= 4) {
        blendPixel(pixels, index, [255, 255, 255, 255]);
      }

      if (segmentDistance(unitX, unitY, 20, 79, 80, 19) <= 6.2) {
        blendPixel(pixels, index, [244, 124, 108, 255]);
      }
      if (segmentDistance(unitX, unitY, 20, 79, 80, 19) <= 2.4) {
        blendPixel(pixels, index, [255, 184, 142, 255]);
      }
    }
  }

  return { dimension, pixels };
}

function downsample(source, targetSize) {
  const output = Buffer.alloc(targetSize * targetSize * 4);
  for (let targetY = 0; targetY < targetSize; targetY += 1) {
    for (let targetX = 0; targetX < targetSize; targetX += 1) {
      const totals = [0, 0, 0, 0];
      for (let offsetY = 0; offsetY < oversample; offsetY += 1) {
        for (let offsetX = 0; offsetX < oversample; offsetX += 1) {
          const sourceX = targetX * oversample + offsetX;
          const sourceY = targetY * oversample + offsetY;
          const sourceIndex = (sourceY * source.dimension + sourceX) * 4;
          for (let channel = 0; channel < 4; channel += 1) {
            totals[channel] += source.pixels[sourceIndex + channel];
          }
        }
      }
      const targetIndex = (targetY * targetSize + targetX) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        output[targetIndex + channel] = Math.round(
          totals[channel] / (oversample * oversample),
        );
      }
    }
  }
  return output;
}

function encodePng(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;

  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let row = 0; row < size; row += 1) {
    const rawOffset = row * (stride + 1);
    raw[rawOffset] = 0;
    rgba.copy(raw, rawOffset + 1, row * stride, (row + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

fs.mkdirSync(outputDirectory, { recursive: true });
for (const size of sizes) {
  const source = renderLargeCanvas(size);
  const rgba = downsample(source, size);
  fs.writeFileSync(
    path.join(outputDirectory, `icon-${size}.png`),
    encodePng(size, rgba),
  );
}

process.stdout.write(`Generated ${sizes.length} extension icons.\n`);

