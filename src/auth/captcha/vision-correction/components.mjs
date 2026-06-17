function pixelStats(r, g, b, alpha) {
  if (alpha < 24) {
    return null;
  }
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const saturation = max === 0 ? 0 : (max - min) / max;
  const brightness = max / 255;
  return {
    saturation,
    brightness,
  };
}

function saturatedPixelMaskScore(r, g, b, alpha) {
  const stats = pixelStats(r, g, b, alpha);
  if (!stats) {
    return 0;
  }
  const { saturation, brightness } = stats;
  if (saturation >= 0.22 && brightness >= 0.16 && brightness <= 0.92) {
    return saturation * (1 - Math.abs(brightness - 0.48));
  }
  return 0;
}

function neutralPixelMaskScore(r, g, b, alpha) {
  const stats = pixelStats(r, g, b, alpha);
  if (!stats) {
    return 0;
  }
  const { saturation, brightness } = stats;
  if (saturation <= 0.16 && brightness >= 0.22 && brightness <= 0.62) {
    return 0.35 * (1 - Math.abs(brightness - 0.42));
  }
  return 0;
}

function findMaskedComponents(image, maskScore) {
  const { width, height, pixels } = image;
  const visited = new Uint8Array(width * height);
  const queue = [];
  const components = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const component = consumeComponent({
        image,
        maskScore,
        queue,
        startIndex: y * width + x,
        startX: x,
        startY: y,
        visited,
      });
      if (component) {
        components.push(component);
      }
    }
  }
  return components;
}

function consumeComponent({ image, maskScore, queue, startIndex, startX, startY, visited }) {
  if (visited[startIndex]) {
    return null;
  }
  const { width, pixels } = image;
  const offset = startIndex * 4;
  const startScore = maskScore(pixels[offset], pixels[offset + 1], pixels[offset + 2], pixels[offset + 3]);
  if (startScore <= 0) {
    visited[startIndex] = 1;
    return null;
  }
  let head = 0;
  let count = 0;
  let scoreSum = 0;
  let minX = startX;
  let maxX = startX;
  let minY = startY;
  let maxY = startY;
  queue.length = 0;
  queue.push({ index: startIndex, score: startScore });
  visited[startIndex] = 1;
  while (head < queue.length) {
    const currentEntry = queue[head];
    head += 1;
    const current = currentEntry.index;
    count += 1;
    scoreSum += currentEntry.score;
    const cy = Math.floor(current / width);
    const cx = current - cy * width;
    minX = Math.min(minX, cx);
    maxX = Math.max(maxX, cx);
    minY = Math.min(minY, cy);
    maxY = Math.max(maxY, cy);
    enqueueNeighbors({
      cx,
      cy,
      current,
      image,
      maskScore,
      queue,
      visited,
    });
  }
  const component = buildComponent({ count, maxX, maxY, minX, minY, scoreSum });
  return component.area >= 8 ? component : null;
}

function enqueueNeighbors({ cx, cy, current, image, maskScore, queue, visited }) {
  const { width, pixels } = image;
  const neighbors = [current - 1, current + 1, current - width, current + width];
  for (const next of neighbors) {
    if (next < 0 || next >= visited.length || visited[next]) {
      continue;
    }
    const ny = Math.floor(next / width);
    const nx = next - ny * width;
    if (Math.abs(nx - cx) + Math.abs(ny - cy) !== 1) {
      continue;
    }
    const nextOffset = next * 4;
    const nextScore = maskScore(
      pixels[nextOffset],
      pixels[nextOffset + 1],
      pixels[nextOffset + 2],
      pixels[nextOffset + 3],
    );
    if (nextScore <= 0) {
      visited[next] = 1;
      continue;
    }
    visited[next] = 1;
    queue.push({ index: next, score: nextScore });
  }
}

function buildComponent({ count, maxX, maxY, minX, minY, scoreSum }) {
  const boxWidth = maxX - minX + 1;
  const boxHeight = maxY - minY + 1;
  const boxArea = Math.max(1, boxWidth * boxHeight);
  return {
    area: count,
    x: minX,
    y: minY,
    width: boxWidth,
    height: boxHeight,
    center_x: minX + boxWidth / 2,
    center_y: minY + boxHeight / 2,
    density: count / boxArea,
    average_score: scoreSum / Math.max(1, count),
  };
}

export {
  findMaskedComponents,
  neutralPixelMaskScore,
  saturatedPixelMaskScore,
};
