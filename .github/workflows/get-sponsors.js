import sharp from "sharp";
import fs from "fs/promises";
import path from "path";

const url = "https://opencollective.com/daisyui/members/all.json";
const outputImage = "../../generated/sponsors.webp";
const outputJson = "../../generated/sponsors.json";
const MAX_WEBP_WIDTH = 16383; // Maximum width for WebP images
const AVATAR_SIZE = 64; // Size of each avatar in pixels

async function fetchMembers() {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch data: ${response.statusText}`);
  }
  return response.json();
}

async function createTransparentImage() {
  return sharp({
    create: {
      width: 64,
      height: 64,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .png()
    .toBuffer();
}

async function processMemberImage(imageUrl, name) {
  try {
    const response = await fetch(imageUrl);
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    return await sharp(buffer).resize(64, 64).toBuffer();
  } catch (error) {
    console.error(`Failed to process image for member ${name}:`, error);
    return createTransparentImage();
  }
}

async function processMembers(members) {
  const images = [];
  const membersData = [];

  for (const member of members) {
    const memberData = { name: member.name, image: false };

    if (member.image) {
      const image = await processMemberImage(member.image, member.name);
      images.push(image);
      memberData.image = true;
    } else {
      const transparentImage = await createTransparentImage();
      images.push(transparentImage);
    }

    membersData.push(memberData);
  }

  return { images, membersData };
}

async function createSpriteImage(images) {
  // Calculate how many images can fit in a row based on MAX_WEBP_WIDTH
  const imagesPerRow = Math.floor(MAX_WEBP_WIDTH / AVATAR_SIZE);
  // Calculate how many rows are needed
  const rows = Math.ceil(images.length / imagesPerRow);

  // Calculate the actual width (might be less than MAX_WEBP_WIDTH for the last row)
  const lastRowImageCount = images.length % imagesPerRow || imagesPerRow;
  const width = Math.min(AVATAR_SIZE * imagesPerRow, MAX_WEBP_WIDTH);
  const height = rows * AVATAR_SIZE;

  console.log(
    `Creating sprite with dimensions ${width}x${height}, ${rows} rows`
  );

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
          top: row * AVATAR_SIZE,
          left: col * AVATAR_SIZE,
        };
      })
    )
    .webp()
    .toBuffer();
}

async function saveFiles(spriteBuffer, membersData) {
  const dir = path.dirname(outputImage);
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (error) {
    if (error.code !== "EEXIST") {
      throw error;
    }
  }

  // Calculate sprite dimensions for the metadata
  const imagesPerRow = Math.floor(MAX_WEBP_WIDTH / AVATAR_SIZE);
  const rows = Math.ceil(membersData.length / imagesPerRow);

  const metadata = {
    sponsors: membersData,
    sprite: {
      imagesPerRow,
      rows,
      avatarSize: AVATAR_SIZE,
    },
  };

  await fs.writeFile(outputImage, spriteBuffer);
  await fs.writeFile(outputJson, JSON.stringify(metadata, null, 2));

  console.log(
    `Sprite created with ${rows} rows and ${imagesPerRow} images per row`
  );
}

async function main() {
  try {
    const members = await fetchMembers();
    console.log(`Total members found: ${members.length}`);
    console.log(`Processing ${members.length} members...`);

    const { images, membersData } = await processMembers(members);
    const spriteBuffer = await createSpriteImage(images);
    await saveFiles(spriteBuffer, membersData);

    console.log("Sprite image and JSON file created successfully.");
  } catch (error) {
    console.error("Error:", error);
  }
}

main();
