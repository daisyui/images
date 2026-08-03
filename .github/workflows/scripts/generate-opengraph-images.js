import { access, appendFile, mkdir } from "node:fs/promises"
import { dirname, resolve } from "node:path"

const workflowsDirectory = resolve(import.meta.dirname, "..")
const projectRoot = resolve(workflowsDirectory, "..", "..")
const pathsFile = resolve(projectRoot, "data", "opengraph-paths.yaml")
const imagesDirectory = resolve(projectRoot, "images")
const siteBaseUrl = new URL("https://daisyui.com/")
const imageViewport = { width: 1600, height: 900 }
const borderSize = 100
const pageViewport = {
  width: imageViewport.width - borderSize * 2,
  height: imageViewport.height - borderSize * 2,
}
const borderColor = "#ffffff"
const imageDocumentPrefix = `<!doctype html>
<style>
  html,
  body {
    width: 100%;
    height: 100%;
    margin: 0;
    overflow: hidden;
    background: ${borderColor};
  }

  body {
    display: flex;
    align-items: center;
    justify-content: center;
  }

  img {
    display: block;
    width: ${pageViewport.width}px;
    height: ${pageViewport.height}px;
  }
</style>
<img alt="" src="`
const imageDocumentSuffix = '">'
const browserCachePath = resolve(workflowsDirectory, "node_modules", ".cache", "ms-playwright")
const playwrightCliPath = resolve(workflowsDirectory, "node_modules", "playwright", "cli.js")
const githubOutputPath = process.env.GITHUB_OUTPUT
const githubOutputDelimiter = "GENERATED_OPENGRAPH_IMAGES"

process.env.PLAYWRIGHT_BROWSERS_PATH = browserCachePath

const configuredPaths = Bun.YAML.parse(await Bun.file(pathsFile).text())

if (!Array.isArray(configuredPaths) || configuredPaths.length === 0) {
  throw new Error(`${pathsFile} must contain a non-empty YAML list of page paths`)
}

const { chromium } = await import("playwright")
const chromiumExecutablePath = chromium.executablePath()

try {
  await access(chromiumExecutablePath)
} catch {
  const installProcess = Bun.spawn(
    [process.execPath, playwrightCliPath, "install", "chromium"],
    {
      cwd: workflowsDirectory,
      env: process.env,
      stdout: "inherit",
      stderr: "inherit",
    },
  )
  const installExitCode = await installProcess.exited

  if (installExitCode !== 0) {
    throw new Error(`Chromium installation failed with exit code ${installExitCode}`)
  }
}

const browser = await chromium.launch({ headless: true })
const generatedImagePaths = []

try {
  const page = await browser.newPage({ viewport: pageViewport, deviceScaleFactor: 1 })
  const imagePage = await browser.newPage({ viewport: imageViewport, deviceScaleFactor: 1 })
  const imageSession = await imagePage.context().newCDPSession(imagePage)

  for (const configuredPath of configuredPaths) {
    if (typeof configuredPath !== "string") {
      throw new Error("Every page path must be a string")
    }

    const pagePath = configuredPath.replace(/^\/+|\/+$/g, "")
    const pathSegments = pagePath.split("/")

    if (pagePath.length === 0 || pagePath.includes("\\") || pagePath.includes("?") || pagePath.includes("#")) {
      throw new Error(`Invalid page path: ${configuredPath}`)
    }

    for (const pathSegment of pathSegments) {
      if (pathSegment.length === 0 || pathSegment === "." || pathSegment === "..") {
        throw new Error(`Invalid page path: ${configuredPath}`)
      }
    }

    const pageUrl = new URL(`${pagePath}/`, siteBaseUrl)

    if (pageUrl.origin !== siteBaseUrl.origin) {
      throw new Error(`Page path must resolve within ${siteBaseUrl.origin}: ${configuredPath}`)
    }

    const imageRelativePath = `images/${pagePath}.webp`
    const imageOutputPath = resolve(imagesDirectory, `${pagePath}.webp`)

    await page.goto(pageUrl.href, { waitUntil: "networkidle" })

    const pageScreenshot = await page.screenshot({ type: "png" })
    const imageSource = `data:image/png;base64,${pageScreenshot.toString("base64")}`

    await imagePage.setContent(`${imageDocumentPrefix}${imageSource}${imageDocumentSuffix}`, {
      waitUntil: "load",
    })

    const imageScreenshot = await imageSession.send("Page.captureScreenshot", {
      format: "webp",
      captureBeyondViewport: false,
      fromSurface: true,
    })

    await mkdir(dirname(imageOutputPath), { recursive: true })
    await Bun.write(imageOutputPath, Buffer.from(imageScreenshot.data, "base64"))

    generatedImagePaths.push(imageRelativePath)
    console.log(`Saved ${pageUrl.href} to ${imageRelativePath}`)
  }
} finally {
  await browser.close()
}

if (githubOutputPath) {
  await appendFile(
    githubOutputPath,
    `paths<<${githubOutputDelimiter}\n${generatedImagePaths.join("\n")}\n${githubOutputDelimiter}\n`,
  )
}
