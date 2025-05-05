import sharp from "sharp";
import fs from "fs/promises";
import path from "path";

// Configuration
const GH_API_KEY = process.env.GH_API_KEY;
const outputImage = "../../generated/contributors.webp";
const outputJson = "../../generated/contributors.json";
const PER_PAGE = 100;
const MAX_WEBP_WIDTH = 16383; // Maximum width for WebP images
const AVATAR_SIZE = 64; // Size of each avatar in pixels

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
        `Page ${currentPage} returned ${contributors.length} contributors (less than ${PER_PAGE}). Stopping.`
      );
      break;
    }

    console.log(
      `Page ${currentPage} returned ${contributors.length} contributors. Fetching next page...`
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

async function saveFiles(spriteBuffer, contributorsData) {
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
  const rows = Math.ceil(contributorsData.length / imagesPerRow);

  const metadata = {
    contributors: contributorsData,
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
    const contributors = await fetchAllContributors();
    console.log(`Total contributors found: ${contributors.length}`);
    console.log(`Processing ${contributors.length} contributors...`);

    const { images, contributorsData } = await processContributors(
      contributors
    );
    const spriteBuffer = await createSpriteImage(images);
    await saveFiles(spriteBuffer, contributorsData);

    console.log("Sprite image and JSON file created successfully.");
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

main();
