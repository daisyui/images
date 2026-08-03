import fs from "fs/promises";
import path from "path";
import {
  createSpritePixels,
  encodePixelsToAvif,
  resizeToCoverPixels,
} from "./image-utils.js";

// Configuration
const PROJECT_ROOT = path.resolve(import.meta.dir, "../../..");
const TESTIMONIALS_FILE = path.join(PROJECT_ROOT, "data/testimonials.yaml");
const OUTPUT_IMAGE = path.join(PROJECT_ROOT, "generated/x.avif");
const OUTPUT_JSON = path.join(PROJECT_ROOT, "generated/testimonials.json");
const IMAGE_SIZE = 72;
const MAX_AVIF_WIDTH = 16383;
const REQUEST_DELAY_MS = 100;

async function readTestimonials() {
  console.log("Reading testimonials from file...");
  try {
    const data = await fs.readFile(TESTIMONIALS_FILE, "utf8");
    const yamlData = Bun.YAML.parse(data);
    return yamlData || [];
  } catch (error) {
    throw new Error(`Failed to read testimonials file: ${error.message}`);
  }
}

async function processAvatar(username, testimonialId) {
  try {
    await Bun.sleep(REQUEST_DELAY_MS);
    const tweetResponse = await fetch(
      `https://api.fxtwitter.com/2/status/${encodeURIComponent(testimonialId)}`,
    );

    if (!tweetResponse.ok) {
      throw new Error(
        `Failed to fetch avatar for ${username}: tweet lookup returned ${tweetResponse.status} ${tweetResponse.statusText}`,
      );
    }

    const tweetData = await tweetResponse.json();
    const avatarUrl = tweetData?.status?.author?.avatar_url;

    if (!avatarUrl) {
      throw new Error(
        `Failed to fetch avatar for ${username}: tweet lookup did not return an author avatar`,
      );
    }

    await Bun.sleep(REQUEST_DELAY_MS);
    const response = await fetch(avatarUrl);

    if (!response.ok) {
      throw new Error(
        `Failed to fetch avatar for ${username}: tweet author avatar returned ${response.status} ${response.statusText}`,
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    return await resizeToCoverPixels(buffer, IMAGE_SIZE, IMAGE_SIZE);
  } catch (error) {
    console.error(`Failed to process image for ${username}:`, error);
    throw error; // Re-throw the error instead of returning transparent image
  }
}

async function processTestimonials(testimonials) {
  const images = [];
  const successfulTestimonials = [];

  for (const testimonial of testimonials) {
    try {
      const image = await processAvatar(testimonial.username, testimonial.id);
      images.push(image);
      successfulTestimonials.push(testimonial);
      console.log(`Processed avatar for: ${testimonial.username}`);
    } catch (error) {
      console.log(`Skipping ${testimonial.username} due to error`);
    }
  }

  return { images, successfulTestimonials };
}

async function createSpriteImage(images) {
  if (images.length === 0) {
    throw new Error("No images to process");
  }

  // Calculate how many images can fit in a row based on MAX_AVIF_WIDTH
  const imagesPerRow = Math.floor(MAX_AVIF_WIDTH / IMAGE_SIZE);
  // Calculate how many rows are needed
  const rows = Math.ceil(images.length / imagesPerRow);
  
  // Calculate the actual width (might be less than MAX_AVIF_WIDTH for the last row)
  const lastRowImageCount = images.length % imagesPerRow || imagesPerRow;
  const width = Math.min(IMAGE_SIZE * imagesPerRow, MAX_AVIF_WIDTH);
  const height = rows * IMAGE_SIZE;
  
  console.log(`Creating sprite with dimensions ${width}x${height}, ${rows} rows`);
  
  const pixels = createSpritePixels(images, {
    imageWidth: IMAGE_SIZE,
    imageHeight: IMAGE_SIZE,
    imagesPerRow,
    width,
    height,
  });

  return encodePixelsToAvif(pixels, width, height, { quality: 80 });
}

async function saveFile(spriteBuffer) {
  const dir = path.dirname(OUTPUT_IMAGE);
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (error) {
    if (error.code !== "EEXIST") {
      throw error;
    }
  }
  await fs.writeFile(OUTPUT_IMAGE, spriteBuffer);
}

async function saveJson(testimonials) {
  const dir = path.dirname(OUTPUT_JSON);
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (error) {
    if (error.code !== "EEXIST") {
      throw error;
    }
  }

  // Calculate sprite dimensions for the metadata
  const imagesPerRow = Math.floor(MAX_AVIF_WIDTH / IMAGE_SIZE);
  const rows = Math.ceil(testimonials.length / imagesPerRow);

  const outputData = {
    generated_at: new Date().toISOString(),
    testimonials: testimonials,
    sprite: {
      imagesPerRow,
      rows,
      avatarSize: IMAGE_SIZE
    }
  };

  await fs.writeFile(OUTPUT_JSON, JSON.stringify(outputData, null, 2), "utf8");
}

async function main() {
  try {
    const testimonials = await readTestimonials();
    console.log(`Processing ${testimonials.length} testimonials...`);

    if (testimonials.length === 0) {
      console.error("No testimonials found");
      process.exit(1);
    }

    const { images, successfulTestimonials } =
      await processTestimonials(testimonials);

    if (images.length === 0) {
      console.error("No valid images processed");
      process.exit(1);
    }

    const spriteBuffer = await createSpriteImage(images);
    await saveFile(spriteBuffer);
    await saveJson(successfulTestimonials);

    console.log(
      `Sprite image created successfully with ${images.length} images.`,
    );
    console.log(
      `JSON file created with ${successfulTestimonials.length} testimonials.`,
    );
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

main();
