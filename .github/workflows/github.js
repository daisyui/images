import sharp from "sharp";
import fs from "fs/promises";
import path from "path";

// Configuration
const GH_API_KEY = process.env.GH_API_KEY;
const outputImage = "../../generated/github/contributors.webp";
const outputJson = "../../generated/github/contributors.json";
const PER_PAGE = 100;

/**
 * Creates the GitHub API URL for fetching contributors
 * @param {number} page - Page number to fetch
 * @returns {string} Formatted GitHub API URL
 */
const createGithubApiUrl = (page) =>
  `https://api.github.com/repos/saadeghi/daisyui/contributors?page=${page}&per_page=${PER_PAGE}`;

/**
 * Fetches a single page of contributors from GitHub API
 * @param {number} page - Page number to fetch
 * @returns {Promise<Array>} Array of contributors
 */
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

/**
 * Fetches all contributors across multiple pages
 * @returns {Promise<Array>} Combined array of all contributors
 */
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

/**
 * Creates a transparent placeholder image
 * @returns {Promise<Buffer>} Buffer containing the transparent image
 */
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

/**
 * Downloads and processes a contributor's avatar
 * @param {string} avatarUrl - URL of the avatar image
 * @param {string} login - GitHub username for error reporting
 * @returns {Promise<Buffer>} Processed image buffer
 */
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

/**
 * Extracts contributor data and processes their avatars
 * @param {Array} contributors - Array of contributor objects
 * @returns {Promise<Object>} Object containing processed images and logins
 */
async function processContributors(contributors) {
  const images = [];
  const logins = [];

  for (const { login, avatar_url } of contributors) {
    logins.push(login);
    const image = avatar_url
      ? await processAvatar(avatar_url, login)
      : await createTransparentImage();
    images.push(image);
  }

  return { images, logins };
}

/**
 * Creates a sprite image from processed avatars
 * @param {Array<Buffer>} images - Array of processed image buffers
 * @returns {Promise<Buffer>} Sprite image buffer
 */
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

/**
 * Saves the sprite image and JSON data to disk
 * @param {Buffer} spriteBuffer - The sprite image buffer
 * @param {Array<string>} logins - Array of contributor logins
 */
async function saveFiles(spriteBuffer, logins) {
  await fs.mkdir(path.dirname(outputImage), { recursive: true });
  await fs.writeFile(outputImage, spriteBuffer);
  await fs.writeFile(outputJson, JSON.stringify(logins, null, 2));
}

/**
 * Main execution function
 */
async function main() {
  try {
    const contributors = await fetchAllContributors();
    console.log(`Total contributors found: ${contributors.length}`);
    console.log(`Processing ${contributors.length} contributors...`);

    const { images, logins } = await processContributors(contributors);
    const spriteBuffer = await createSpriteImage(images);
    await saveFiles(spriteBuffer, logins);

    console.log("Sprite image and JSON file created successfully.");
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

main();
