"""
Download and extract prediction market analysis data.
Downloads 36GB compressed archive from S3 and extracts Parquet files.
Run: python scripts/download-research-data.py
"""

import os
import sys
import time
import urllib.request
import zstandard
import tarfile
import io

DATA_URL = "https://s3.jbecker.dev/data.tar.zst"
DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "prediction-market-data", "data")
ARCHIVE_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "prediction-market-data", "data.tar.zst")

def format_bytes(b):
    for unit in ['B', 'KB', 'MB', 'GB']:
        if b < 1024:
            return f"{b:.1f} {unit}"
        b /= 1024
    return f"{b:.1f} TB"

def download_with_progress(url, dest):
    """Download file with progress reporting."""
    print(f"Downloading: {url}")
    print(f"Destination: {dest}")

    req = urllib.request.Request(url, headers={'User-Agent': 'PolyTrade/1.0'})
    response = urllib.request.urlopen(req)

    total_size = int(response.headers.get('content-length', 0))
    downloaded = 0
    chunk_size = 1024 * 1024  # 1MB chunks
    start_time = time.time()

    print(f"Total size: {format_bytes(total_size)}")

    with open(dest, 'wb') as f:
        while True:
            chunk = response.read(chunk_size)
            if not chunk:
                break
            f.write(chunk)
            downloaded += len(chunk)

            elapsed = time.time() - start_time
            speed = downloaded / elapsed if elapsed > 0 else 0
            pct = (downloaded / total_size * 100) if total_size > 0 else 0
            eta = (total_size - downloaded) / speed if speed > 0 else 0

            sys.stdout.write(
                f"\r  Progress: {pct:.1f}% ({format_bytes(downloaded)}/{format_bytes(total_size)}) "
                f"Speed: {format_bytes(speed)}/s ETA: {int(eta)}s"
            )
            sys.stdout.flush()

    print(f"\nDownload complete: {format_bytes(downloaded)}")

def extract_zst_tar(archive_path, dest_dir):
    """Extract .tar.zst archive."""
    print(f"Extracting: {archive_path}")
    print(f"Destination: {dest_dir}")

    dctx = zstandard.ZstdDecompressor()

    with open(archive_path, 'rb') as compressed:
        with dctx.stream_reader(compressed) as reader:
            with tarfile.open(fileobj=reader, mode='r|') as tar:
                tar.extractall(path=os.path.dirname(dest_dir))

    print("Extraction complete.")

def main():
    if os.path.exists(DATA_DIR) and os.listdir(DATA_DIR):
        print(f"Data directory already exists: {DATA_DIR}")
        print("Skipping download. Delete the data directory to re-download.")
        return

    os.makedirs(os.path.dirname(DATA_DIR), exist_ok=True)

    try:
        # Download
        if not os.path.exists(ARCHIVE_PATH):
            download_with_progress(DATA_URL, ARCHIVE_PATH)
        else:
            print(f"Archive already exists: {ARCHIVE_PATH}")

        # Extract
        extract_zst_tar(ARCHIVE_PATH, DATA_DIR)

        # Cleanup
        if os.path.exists(ARCHIVE_PATH):
            print("Cleaning up archive...")
            os.remove(ARCHIVE_PATH)

        print(f"\nData ready at: {DATA_DIR}")

        # List what we got
        for root, dirs, files in os.walk(DATA_DIR):
            level = root.replace(DATA_DIR, '').count(os.sep)
            indent = '  ' * level
            print(f"{indent}{os.path.basename(root)}/")
            if level < 2:
                for f in files[:5]:
                    print(f"{indent}  {f}")
                if len(files) > 5:
                    print(f"{indent}  ... and {len(files) - 5} more files")

    except KeyboardInterrupt:
        print("\n\nDownload interrupted. Run again to resume.")
        sys.exit(1)
    except Exception as e:
        print(f"\nError: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
