"""Generate the 1024x1024 source icon at src-tauri/icon-source.png. Needs Pillow."""

from pathlib import Path

from PIL import Image, ImageDraw

SIZE = 1024
OUT = Path(__file__).resolve().parents[1] / "src-tauri" / "icon-source.png"


def main() -> None:
    image = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((64, 64, SIZE - 64, SIZE - 64), radius=200, fill=(37, 99, 214, 255))
    draw.ellipse((272, 272, SIZE - 272, SIZE - 272), outline=(255, 255, 255, 255), width=56)
    draw.ellipse((420, 420, SIZE - 420, SIZE - 420), fill=(255, 255, 255, 255))
    image.save(OUT)


if __name__ == "__main__":
    main()
