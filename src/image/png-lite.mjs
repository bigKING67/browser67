import { inflateSync } from "node:zlib";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function readPngDimensions(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < PNG_SIGNATURE.length + 25) {
    throw new Error("invalid PNG buffer");
  }
  if (!buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error("invalid PNG signature");
  }
  const firstChunkLength = buffer.readUInt32BE(PNG_SIGNATURE.length);
  const firstChunkType = buffer.toString("ascii", PNG_SIGNATURE.length + 4, PNG_SIGNATURE.length + 8);
  if (firstChunkType !== "IHDR" || firstChunkLength < 13) {
    throw new Error("invalid PNG IHDR");
  }
  return {
    width: buffer.readUInt32BE(PNG_SIGNATURE.length + 8),
    height: buffer.readUInt32BE(PNG_SIGNATURE.length + 12),
    bit_depth: buffer[PNG_SIGNATURE.length + 16],
    color_type: buffer[PNG_SIGNATURE.length + 17],
  };
}

function paethPredictor(left, above, upperLeft) {
  const p = left + above - upperLeft;
  const pa = Math.abs(p - left);
  const pb = Math.abs(p - above);
  const pc = Math.abs(p - upperLeft);
  if (pa <= pb && pa <= pc) {
    return left;
  }
  return pb <= pc ? above : upperLeft;
}

function bytesPerPixel(colorType) {
  if (colorType === 6) {
    return 4;
  }
  if (colorType === 2) {
    return 3;
  }
  if (colorType === 0) {
    return 1;
  }
  throw new Error(`unsupported PNG color type: ${String(colorType)}`);
}

function applyFilter(filter, row, previous, bpp) {
  for (let index = 0; index < row.length; index += 1) {
    const left = index >= bpp ? row[index - bpp] : 0;
    const above = previous ? previous[index] : 0;
    const upperLeft = previous && index >= bpp ? previous[index - bpp] : 0;
    let delta = 0;
    if (filter === 1) {
      delta = left;
    } else if (filter === 2) {
      delta = above;
    } else if (filter === 3) {
      delta = Math.floor((left + above) / 2);
    } else if (filter === 4) {
      delta = paethPredictor(left, above, upperLeft);
    } else if (filter !== 0) {
      throw new Error(`unsupported PNG filter: ${String(filter)}`);
    }
    row[index] = (row[index] + delta) & 0xff;
  }
  return row;
}

function decodePng(buffer) {
  const dimensions = readPngDimensions(buffer);
  const { width, height } = dimensions;
  const bitDepth = dimensions.bit_depth;
  const colorType = dimensions.color_type;
  let offset = PNG_SIGNATURE.length;
  let interlace = 0;
  const idatChunks = [];
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > buffer.length) {
      throw new Error("truncated PNG chunk");
    }
    const data = buffer.subarray(dataStart, dataEnd);
    if (type === "IHDR") {
      interlace = data[12];
    } else if (type === "IDAT") {
      idatChunks.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset = dataEnd + 4;
  }
  if (!width || !height || bitDepth !== 8 || interlace !== 0) {
    throw new Error("unsupported PNG layout");
  }
  const bpp = bytesPerPixel(colorType);
  const rowBytes = width * bpp;
  const inflated = inflateSync(Buffer.concat(idatChunks));
  const pixels = new Uint8ClampedArray(width * height * 4);
  let inputOffset = 0;
  let previous = null;
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[inputOffset];
    inputOffset += 1;
    const row = Uint8Array.from(inflated.subarray(inputOffset, inputOffset + rowBytes));
    inputOffset += rowBytes;
    applyFilter(filter, row, previous, bpp);
    previous = row;
    for (let x = 0; x < width; x += 1) {
      const source = x * bpp;
      const target = (y * width + x) * 4;
      if (colorType === 0) {
        const value = row[source];
        pixels[target] = value;
        pixels[target + 1] = value;
        pixels[target + 2] = value;
        pixels[target + 3] = 255;
      } else {
        pixels[target] = row[source];
        pixels[target + 1] = row[source + 1];
        pixels[target + 2] = row[source + 2];
        pixels[target + 3] = colorType === 6 ? row[source + 3] : 255;
      }
    }
  }
  return {
    width,
    height,
    pixels,
    color_type: colorType,
    bit_depth: bitDepth,
  };
}

export {
  decodePng,
  readPngDimensions,
};
