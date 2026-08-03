import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const scriptDirectory = import.meta.dirname;
const repositoryRoot = path.resolve(scriptDirectory, "../../..");
const sourcePattern = /\.(png|jpe?g)$/i;
const excludedDirectories = ["images/daisyui-logo", "images/daisyui"];
const maxWebpDimension = 16383;
const imageInputOptions = Object.freeze({ autoOrient: false });

const toRepositoryPath = (filePath) =>
  path.relative(repositoryRoot, path.resolve(repositoryRoot, filePath));

const shouldSkipPath = (filePath) => {
  const repositoryPath = toRepositoryPath(filePath);

  return excludedDirectories.some(
    (directory) =>
      repositoryPath === directory ||
      repositoryPath.startsWith(`${directory}${path.sep}`),
  );
};

// Function to recursively find all PNG and JPG images
const findImages = (directory) => {
  let images = [];

  for (const file of fs.readdirSync(directory)) {
    const filePath = path.join(directory, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
      // Skip processing if the directory path matches excluded paths
      if (!shouldSkipPath(filePath)) {
        images = images.concat(findImages(filePath));
      }
    } else {
      // Skip processing if the file path matches excluded paths
      if (!shouldSkipPath(filePath) && sourcePattern.test(file)) {
        images.push(filePath);
      }
    }
  }

  return images;
};

// Function to convert images to WebP
const convertToWebP = async (imagePath) => {
  const absoluteImagePath = path.resolve(repositoryRoot, imagePath);
  const webpPath = absoluteImagePath.replace(sourcePattern, ".webp");
  const temporaryPath = `${webpPath}.${process.pid}.tmp`;

  try {
    const image = new Bun.Image(absoluteImagePath, imageInputOptions);
    const { width, height } = await image.metadata();

    if (width > maxWebpDimension || height > maxWebpDimension) {
      console.warn(
        `Skipping ${toRepositoryPath(absoluteImagePath)}: Image is too large for the WebP format`,
      );
      return null;
    }

    await image.webp().write(temporaryPath);
    fs.renameSync(temporaryPath, webpPath);
    console.log(
      `${toRepositoryPath(absoluteImagePath)} ——→ ${toRepositoryPath(webpPath)}`,
    );
    return webpPath;
  } catch (error) {
    fs.rmSync(temporaryPath, { force: true });

    if (
      error instanceof Error &&
      error.message.includes("too large for the WebP format")
    ) {
      console.warn(
        `Skipping ${toRepositoryPath(absoluteImagePath)}: ${error.message}`,
      );
      return null;
    }

    throw error;
  }
};

const getStagedImages = () => {
  const output = execFileSync(
    "git",
    [
      "diff",
      "--cached",
      "--name-only",
      "--diff-filter=ACMR",
      "-z",
      "--",
      "images",
    ],
    { cwd: repositoryRoot },
  ).toString();

  return output
    .split("\0")
    .filter(Boolean)
    .filter((filePath) => sourcePattern.test(filePath))
    .filter((filePath) => !shouldSkipPath(filePath));
};

const processImages = async (images, { stageOutputs = false } = {}) => {
  const outputPaths = [];

  for (const image of images) {
    const outputPath = await convertToWebP(image);
    if (outputPath) outputPaths.push(outputPath);
  }

  if (stageOutputs && outputPaths.length > 0) {
    execFileSync(
      "git",
      ["add", "--", ...outputPaths.map(toRepositoryPath)],
      { cwd: repositoryRoot, stdio: "inherit" },
    );
  }
};

const argumentsList = process.argv.slice(2);
const stagedOnly = argumentsList[0] === "--staged";
const requestedImages = stagedOnly ? getStagedImages() : argumentsList;
const images =
  requestedImages.length > 0
    ? requestedImages.filter(
        (filePath) => sourcePattern.test(filePath) && !shouldSkipPath(filePath),
      )
    : stagedOnly
      ? []
      : findImages(repositoryRoot);

await processImages(images, { stageOutputs: stagedOnly });
