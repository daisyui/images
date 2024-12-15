import sharp from "sharp";
import fs from "fs/promises";

const url = "https://opencollective.com/daisyui/members/all.json";
const outputImage = "../../generated/open-collective/contributors.webp";
const outputJson = "../../generated/open-collective/contributors.json";

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

async function createSprite(members) {
  const images = [];
  const membersData = [];

  for (const member of members) {
    const memberData = { name: member.name, image: false };

    if (member.image) {
      try {
        const response = await fetch(member.image);
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const resizedImage = await sharp(buffer).resize(64, 64).toBuffer();
        images.push(resizedImage);
        memberData.image = true;
      } catch (error) {
        console.error(
          `Failed to process image for member ${member.name}:`,
          error,
        );
        const transparentImage = await createTransparentImage();
        images.push(transparentImage);
      }
    } else {
      const transparentImage = await createTransparentImage();
      images.push(transparentImage);
    }

    membersData.push(memberData);
  }

  const sprite = await sharp({
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

  await fs.mkdir("../../generated/open-collective", { recursive: true });
  await fs.writeFile(outputImage, sprite);
  await fs.writeFile(outputJson, JSON.stringify(membersData, null, null));
}

async function main() {
  try {
    const members = await fetchMembers();
    await createSprite(members);
    console.log("Sprite image and JSON file created successfully.");
  } catch (error) {
    console.error("Error:", error);
  }
}

main();
