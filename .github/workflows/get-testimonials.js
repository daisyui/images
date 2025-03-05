import sharp from "sharp";
import fs from "fs/promises";
import path from "path";

// Configuration
const TESTIMONIALS_FILE = "../../data/testimonials.json";
const OUTPUT_IMAGE = "../../generated/x.webp";
const IMAGE_SIZE = 72;

async function readTestimonials() {
  console.log("Reading testimonials from file...");
  try {
    const data = await fs.readFile(TESTIMONIALS_FILE, "utf8");
    const jsonData = JSON.parse(data);
    return jsonData.tweets || []; // Access the tweets array from the JSON
  } catch (error) {
    throw new Error(`Failed to read testimonials file: ${error.message}`);
  }
}

async function createTransparentImage() {
  return sharp({
    create: {
      width: IMAGE_SIZE,
      height: IMAGE_SIZE,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .png()
    .toBuffer();
}

async function processAvatar(username) {
  try {
    const avatarUrl = `https://unavatar.io/x/${username}?fallback=false`;
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
    return createTransparentImage();
  }
}

async function processTestimonials(testimonials) {
  const images = [];

  for (const testimonial of testimonials) {
    const image = await processAvatar(testimonial.username);
    images.push(image);
    console.log(`Processed avatar for: ${testimonial.username}`);
  }

  return images;
}

async function createSpriteImage(images) {
  if (images.length === 0) {
    throw new Error("No images to process");
  }

  return sharp({
    create: {
      width: IMAGE_SIZE * images.length,
      height: IMAGE_SIZE,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(
      images.map((image, index) => ({
        input: image,
        top: 0,
        left: IMAGE_SIZE * index,
      })),
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

async function main() {
  try {
    const testimonials = await readTestimonials();
    console.log(`Processing ${testimonials.length} testimonials...`);

    if (testimonials.length === 0) {
      console.error("No testimonials found");
      process.exit(1);
    }

    const images = await processTestimonials(testimonials);
    const spriteBuffer = await createSpriteImage(images);
    await saveFile(spriteBuffer);

    console.log("Sprite image created successfully.");
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

main();
