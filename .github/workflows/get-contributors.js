import sharp from "sharp";
import fs from "fs/promises";
import path from "path";

// Configuration
const GH_API_KEY = process.env.GH_API_KEY;
const outputImage = "../../generated/contributors.webp";
const outputJson = "../../generated/contributors.json";
const PER_PAGE = 100;

const createGithubApiUrl = (page) =>
  `https://api.github.com/repos/saadeghi/daisyui/contributors?page=${page}&per_page=${PER_PAGE}`;

async function fetchContributors(page) {
  console.log(`Fetching page ${page}...`);
  const response = await fetch(createGithubApiUrl(page), {
    headers: { Authorization: `token ${GH_API_KEY}` },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch data: ${response.statusText}`);
  }

  return response.json();
}

async function fetchAllContributors() {
  let currentPage = 1;
  let allContributors = [];

  while (true) {
    const contributors = await fetchContributors(currentPage);

    if (contributors.length === 0) break;

    allContributors = [...allContributors, ...contributors];

    if (contributors.length < PER_PAGE) {
      console.log(
        `Page ${currentPage} returned ${contributors.length} contributors (less than ${PER_PAGE}). Stopping.`,
      );
      break;
    }

    console.log(
      `Page ${currentPage} returned ${contributors.length} contributors. Fetching next page...`,
    );
    currentPage++;
  }

  return allContributors;
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

async function processAvatar(avatarUrl, login) {
  try {
    const response = await fetch(avatarUrl);
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    return await sharp(buffer).resize(64, 64).toBuffer();
  } catch (error) {
    console.error(`Failed to process image for contributor ${login}:`, error);
    return createTransparentImage();
  }
}

async function processContributors(contributors) {
  const images = [];
  const contributorsData = [];

  for (const { login, avatar_url } of contributors) {
    const contributorData = { name: login, image: false };

    if (avatar_url) {
      const image = await processAvatar(avatar_url, login);
      images.push(image);
      contributorData.image = true;
    } else {
      const transparentImage = await createTransparentImage();
      images.push(transparentImage);
    }

    // contributorsData.push(contributorData);
    contributorsData.push(login);
  }

  return { images, contributorsData };
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

async function saveFiles(spriteBuffer, contributorsData) {
  const dir = path.dirname(outputImage);
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch (error) {
    if (error.code !== "EEXIST") {
      throw error;
    }
  }
  await fs.writeFile(outputImage, spriteBuffer);
  await fs.writeFile(outputJson, JSON.stringify(contributorsData, null, 2));
}

async function main() {
  try {
    const contributors = await fetchAllContributors();
    console.log(`Total contributors found: ${contributors.length}`);
    console.log(`Processing ${contributors.length} contributors...`);

    const { images, contributorsData } =
      await processContributors(contributors);
    const spriteBuffer = await createSpriteImage(images);
    await saveFiles(spriteBuffer, contributorsData);

    console.log("Sprite image and JSON file created successfully.");
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

main();
