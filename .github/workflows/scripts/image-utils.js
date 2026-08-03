import { deflateSync, inflateSync } from "node:zlib";

// Bun.Image handles resizing and encoding; RGBA pixels provide the missing
// composition layer needed to build the existing sprite layout.
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const IHDR_CHUNK_TYPE = Buffer.from("IHDR");
const IDAT_CHUNK_TYPE = Buffer.from("IDAT");
const IEND_CHUNK_TYPE = Buffer.from("IEND");
const PNG_SIGNATURE_LENGTH = PNG_SIGNATURE.length;
const PNG_CHUNK_HEADER_LENGTH = 8;
const PNG_CHUNK_CRC_LENGTH = 4;
const PNG_IHDR_LENGTH = 13;
const PNG_BIT_DEPTH = 8;
const PNG_RGBA_COLOR_TYPE = 6;
const PNG_COMPRESSION_METHOD = 0;
const PNG_FILTER_METHOD = 0;
const PNG_INTERLACE_METHOD = 0;
const PNG_BYTES_PER_PIXEL = 4;
const PNG_FILTER_NONE = 0;
const PNG_FILTER_SUB = 1;
const PNG_FILTER_UP = 2;
const PNG_FILTER_AVERAGE = 3;
const PNG_FILTER_PAETH = 4;
const CRC32_INITIAL_VALUE = 0xffffffff;
const CRC32_POLYNOMIAL = 0xedb88320;
const BITS_PER_BYTE = 8;
const IMAGE_INPUT_OPTIONS = Object.freeze({ autoOrient: false });
const COVER_RESIZE_OPTIONS = Object.freeze({
  fit: "fill",
  filter: "lanczos3",
});

const calculateCrc32 = (bytes) => {
  let crc = CRC32_INITIAL_VALUE;

  for (const byte of bytes) {
    crc ^= byte;

    for (let bit = 0; bit < BITS_PER_BYTE; bit++) {
      crc = (crc >>> 1) ^ (CRC32_POLYNOMIAL & -(crc & 1));
    }
  }

  return (crc ^ CRC32_INITIAL_VALUE) >>> 0;
};

const createPngChunk = (type, data) => {
  const chunk = Buffer.alloc(
    PNG_CHUNK_HEADER_LENGTH + data.length + PNG_CHUNK_CRC_LENGTH,
  );
  chunk.writeUInt32BE(data.length, 0);
  type.copy(chunk, 4);
  data.copy(chunk, PNG_CHUNK_HEADER_LENGTH);
  chunk.writeUInt32BE(
    calculateCrc32(chunk.subarray(4, PNG_CHUNK_HEADER_LENGTH + data.length)),
    PNG_CHUNK_HEADER_LENGTH + data.length,
  );
  return chunk;
};

const encodeRgbaPng = (pixels, width, height) => {
  const rowLength = width * PNG_BYTES_PER_PIXEL;

  if (pixels.length !== rowLength * height) {
    throw new Error("RGBA pixel data does not match the image dimensions");
  }

  const header = Buffer.alloc(PNG_IHDR_LENGTH);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = PNG_BIT_DEPTH;
  header[9] = PNG_RGBA_COLOR_TYPE;
  header[10] = PNG_COMPRESSION_METHOD;
  header[11] = PNG_FILTER_METHOD;
  header[12] = PNG_INTERLACE_METHOD;

  const scanlines = Buffer.alloc((rowLength + 1) * height);
  const source = Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength);

  for (let row = 0; row < height; row++) {
    const sourceOffset = row * rowLength;
    const destinationOffset = row * (rowLength + 1);
    scanlines[destinationOffset] = PNG_FILTER_NONE;
    source.copy(
      scanlines,
      destinationOffset + 1,
      sourceOffset,
      sourceOffset + rowLength,
    );
  }

  return Buffer.concat([
    PNG_SIGNATURE,
    createPngChunk(IHDR_CHUNK_TYPE, header),
    createPngChunk(IDAT_CHUNK_TYPE, deflateSync(scanlines)),
    createPngChunk(IEND_CHUNK_TYPE, Buffer.alloc(0)),
  ]);
};

const calculatePaethPredictor = (left, above, upperLeft) => {
  const prediction = left + above - upperLeft;
  const distanceFromLeft = Math.abs(prediction - left);
  const distanceFromAbove = Math.abs(prediction - above);
  const distanceFromUpperLeft = Math.abs(prediction - upperLeft);

  if (
    distanceFromLeft <= distanceFromAbove &&
    distanceFromLeft <= distanceFromUpperLeft
  ) {
    return left;
  }

  if (distanceFromAbove <= distanceFromUpperLeft) return above;
  return upperLeft;
};

const applyPngFilter = (filter, encoded, left, above, upperLeft) => {
  if (filter === PNG_FILTER_NONE) return encoded;
  if (filter === PNG_FILTER_SUB) return (encoded + left) & 0xff;
  if (filter === PNG_FILTER_UP) return (encoded + above) & 0xff;
  if (filter === PNG_FILTER_AVERAGE) {
    return (encoded + Math.floor((left + above) / 2)) & 0xff;
  }
  if (filter === PNG_FILTER_PAETH) {
    return (encoded + calculatePaethPredictor(left, above, upperLeft)) & 0xff;
  }

  throw new Error(`Unsupported PNG filter: ${filter}`);
};

const decodeRgbaPng = (png) => {
  const bytes = Buffer.from(png.buffer, png.byteOffset, png.byteLength);

  if (!bytes.subarray(0, PNG_SIGNATURE_LENGTH).equals(PNG_SIGNATURE)) {
    throw new Error("Invalid PNG signature");
  }

  let offset = PNG_SIGNATURE_LENGTH;
  let width;
  let height;
  const compressedParts = [];

  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const typeOffset = offset + 4;
    const dataOffset = offset + PNG_CHUNK_HEADER_LENGTH;
    const dataEnd = dataOffset + length;
    const type = bytes.toString("ascii", typeOffset, dataOffset);
    const data = bytes.subarray(dataOffset, dataEnd);

    if (type === IHDR_CHUNK_TYPE.toString("ascii")) {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);

      if (
        data[8] !== PNG_BIT_DEPTH ||
        data[9] !== PNG_RGBA_COLOR_TYPE ||
        data[10] !== PNG_COMPRESSION_METHOD ||
        data[11] !== PNG_FILTER_METHOD ||
        data[12] !== PNG_INTERLACE_METHOD
      ) {
        throw new Error("Bun returned an unsupported PNG pixel format");
      }
    } else if (type === IDAT_CHUNK_TYPE.toString("ascii")) {
      compressedParts.push(data);
    } else if (type === IEND_CHUNK_TYPE.toString("ascii")) {
      break;
    }

    offset = dataEnd + PNG_CHUNK_CRC_LENGTH;
  }

  if (
    width === undefined ||
    height === undefined ||
    compressedParts.length === 0
  ) {
    throw new Error("PNG is missing required image data");
  }

  const rowLength = width * PNG_BYTES_PER_PIXEL;
  const filtered = inflateSync(Buffer.concat(compressedParts));
  const expectedLength = (rowLength + 1) * height;

  if (filtered.length !== expectedLength) {
    throw new Error("PNG image data does not match its dimensions");
  }

  const pixels = Buffer.alloc(rowLength * height);
  let sourceOffset = 0;

  for (let row = 0; row < height; row++) {
    const filter = filtered[sourceOffset++];
    const rowOffset = row * rowLength;

    for (let column = 0; column < rowLength; column++) {
      const pixelOffset = rowOffset + column;
      const left =
        column >= PNG_BYTES_PER_PIXEL
          ? pixels[pixelOffset - PNG_BYTES_PER_PIXEL]
          : 0;
      const above = row > 0 ? pixels[pixelOffset - rowLength] : 0;
      const upperLeft =
        row > 0 && column >= PNG_BYTES_PER_PIXEL
          ? pixels[pixelOffset - rowLength - PNG_BYTES_PER_PIXEL]
          : 0;

      pixels[pixelOffset] = applyPngFilter(
        filter,
        filtered[sourceOffset++],
        left,
        above,
        upperLeft,
      );
    }
  }

  return { pixels, width, height };
};

const calculateCoverBounds = (
  sourceWidth,
  sourceHeight,
  targetWidth,
  targetHeight,
) => {
  if (sourceWidth * targetHeight >= targetWidth * sourceHeight) {
    return {
      width: Math.max(
        targetWidth,
        Math.round((sourceWidth * targetHeight) / sourceHeight),
      ),
      height: targetHeight,
    };
  }

  return {
    width: targetWidth,
    height: Math.max(
      targetHeight,
      Math.round((sourceHeight * targetWidth) / sourceWidth),
    ),
  };
};

const cropCenter = (image, targetWidth, targetHeight) => {
  if (image.width < targetWidth || image.height < targetHeight) {
    throw new Error("Resized image is smaller than the requested crop");
  }

  const left = Math.round((image.width - targetWidth) / 2);
  const top = Math.round((image.height - targetHeight) / 2);
  const sourceRowLength = image.width * PNG_BYTES_PER_PIXEL;
  const targetRowLength = targetWidth * PNG_BYTES_PER_PIXEL;
  const pixels = Buffer.alloc(targetRowLength * targetHeight);

  for (let row = 0; row < targetHeight; row++) {
    const sourceOffset =
      (top + row) * sourceRowLength + left * PNG_BYTES_PER_PIXEL;
    image.pixels.copy(
      pixels,
      row * targetRowLength,
      sourceOffset,
      sourceOffset + targetRowLength,
    );
  }

  return pixels;
};

export const createTransparentPixels = (width, height) =>
  Buffer.alloc(width * height * PNG_BYTES_PER_PIXEL);

export const resizeToCoverPixels = async (input, width, height) => {
  const metadata = await new Bun.Image(input, IMAGE_INPUT_OPTIONS).metadata();
  const bounds = calculateCoverBounds(
    metadata.width,
    metadata.height,
    width,
    height,
  );
  const png = await new Bun.Image(input, IMAGE_INPUT_OPTIONS)
    .resize(bounds.width, bounds.height, COVER_RESIZE_OPTIONS)
    .png()
    .buffer();

  return cropCenter(decodeRgbaPng(png), width, height);
};

export const createSpritePixels = (
  images,
  { imageWidth, imageHeight, imagesPerRow, width, height },
) => {
  const imageRowLength = imageWidth * PNG_BYTES_PER_PIXEL;
  const spriteRowLength = width * PNG_BYTES_PER_PIXEL;
  const expectedImageLength = imageRowLength * imageHeight;
  const pixels = Buffer.alloc(spriteRowLength * height);

  for (const [index, image] of images.entries()) {
    if (image.length !== expectedImageLength) {
      throw new Error("Sprite image does not match the configured dimensions");
    }

    const imageLeft = (index % imagesPerRow) * imageWidth;
    const imageTop = Math.floor(index / imagesPerRow) * imageHeight;

    for (let row = 0; row < imageHeight; row++) {
      const sourceOffset = row * imageRowLength;
      const destinationOffset =
        (imageTop + row) * spriteRowLength +
        imageLeft * PNG_BYTES_PER_PIXEL;
      image.copy(
        pixels,
        destinationOffset,
        sourceOffset,
        sourceOffset + imageRowLength,
      );
    }
  }

  return pixels;
};

export const encodePixelsToWebp = async (
  pixels,
  width,
  height,
  options,
) => {
  const image = new Bun.Image(
    encodeRgbaPng(pixels, width, height),
    IMAGE_INPUT_OPTIONS,
  );
  const webp = options === undefined ? image.webp() : image.webp(options);
  return webp.buffer();
};

export const encodePixelsToAvif = async (
  pixels,
  width,
  height,
  options,
) => {
  const image = new Bun.Image(
    encodeRgbaPng(pixels, width, height),
    IMAGE_INPUT_OPTIONS,
  );
  const avif = options === undefined ? image.avif() : image.avif(options);
  return avif.buffer();
};
