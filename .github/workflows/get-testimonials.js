import sharp from "sharp";
import fs from "fs/promises";
import path from "path";
import yaml from "js-yaml";

// Configuration
const TESTIMONIALS_FILE = "../../data/testimonials.yaml";
const OUTPUT_IMAGE = "../../generated/x.webp";
const OUTPUT_JSON = "../../generated/testimonials.json";
const IMAGE_SIZE = 72;
const MAX_WEBP_WIDTH = 16383; // Maximum width for WebP images

async function readTestimonials() {
  console.log("Reading testimonials from file...");
  try {
    const data = await fs.readFile(TESTIMONIALS_FILE, "utf8");
    const yamlData = yaml.load(data);
    return yamlData || [];
  } catch (error) {
    throw new Error(`Failed to read testimonials file: ${error.message}`);
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function processAvatar(username) {
  try {
    await delay(2000);

    const avatarUrl = `https://unavatar.io/x/@${username}?fallback=false&ttl=28d`;
    const response = await fetch(avatarUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/94.0.4606.81 Safari/537.36",
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch avatar for ${username}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    return await sharp(buffer).resize(IMAGE_SIZE, IMAGE_SIZE).toBuffer();
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
      const image = await processAvatar(testimonial.username);
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

  // Calculate how many images can fit in a row based on MAX_WEBP_WIDTH
  const imagesPerRow = Math.floor(MAX_WEBP_WIDTH / IMAGE_SIZE);
  // Calculate how many rows are needed
  const rows = Math.ceil(images.length / imagesPerRow);
  
  // Calculate the actual width (might be less than MAX_WEBP_WIDTH for the last row)
  const lastRowImageCount = images.length % imagesPerRow || imagesPerRow;
  const width = Math.min(IMAGE_SIZE * imagesPerRow, MAX_WEBP_WIDTH);
  const height = rows * IMAGE_SIZE;
  
  console.log(`Creating sprite with dimensions ${width}x${height}, ${rows} rows`);
  
  return sharp({
    create: {
      width: width,
      height: height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(
      images.map((image, index) => {
        const row = Math.floor(index / imagesPerRow);
        const col = index % imagesPerRow;
        
        return {
          input: image,
          top: row * IMAGE_SIZE,
          left: col * IMAGE_SIZE,
        };
      })
    )
    .webp({ quality: 100 })
    .toBuffer();
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
  const imagesPerRow = Math.floor(MAX_WEBP_WIDTH / IMAGE_SIZE);
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
