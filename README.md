WebP images from [saadeghi/daisyui](https://github.com/saadeghi/daisyui) are moved to this repo so the builds are faster.

## Local image conversion

Set up the repository once after cloning:

```sh
bun install --cwd .github/workflows --no-save
git config core.hooksPath .githooks
```

The pre-commit hook converts staged PNG and JPEG files under `images/` to WebP
and stages the generated files in the same commit. Images in `images/daisyui/`
and `images/daisyui-logo/` remain unchanged.

To regenerate every WebP file manually:

```sh
bun run --cwd .github/workflows convert:webp
```
