import sharp from "sharp";
import fs from "fs/promises";
import path from "path";

const url = "https://opencollective.com/daisyui/members/all.json";
const outputImage = "../../generated/sponsors.webp";
const outputJson = "../../generated/sponsors.json";

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
  return sharp({
    create: {
      width: 64 * images.length,
      height: 64,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(
      images.map((image, index) => ({
        input: image,
        top: 0,
        left: 64 * index,
      })),
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
  await fs.writeFile(outputImage, spriteBuffer);
  await fs.writeFile(outputJson, JSON.stringify(membersData, null, null));
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
