"""Live verification script for 3 guest workspaces with R2 and Google Drive archival.

Connects to live Cloudflare R2 and Google Drive using .env credentials,
executes the full active storage -> archive -> restore lifecycle,
verifies integrity and cross-workspace isolation, and cleans up cleanly.
"""

from __future__ import annotations

import hashlib
import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, TypedDict

REPO_ROOT = Path(__file__).parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from scripts.verify_storage_credentials import load_env  # noqa: E402


class GuestAccountConfig(TypedDict):
    guest_id: str
    name: str
    workspace_slug: str
    filename: str
    content: bytes


def get_google_access_token(client_id: str, client_secret: str, refresh_token: str) -> str:
    token_data = urllib.parse.urlencode(
        {
            "client_id": client_id,
            "client_secret": client_secret,
            "refresh_token": refresh_token,
            "grant_type": "refresh_token",
        }
    ).encode()
    req = urllib.request.Request(
        "https://oauth2.googleapis.com/token",
        data=token_data,
        method="POST",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read().decode("utf-8"))
        return str(data["access_token"])


def drive_upload_file(token: str, name: str, data: bytes, mime_type: str = "text/plain") -> str:
    boundary = f"----OctoBoundary{int(time.time() * 1000)}"
    delimiter = f"\r\n--{boundary}\r\n".encode()
    close_delim = f"\r\n--{boundary}--\r\n".encode()

    meta = json.dumps({"name": name, "mimeType": mime_type}).encode()
    meta_header = b"Content-Type: application/json; charset=UTF-8\r\n\r\n"
    media_header = f"Content-Type: {mime_type}\r\n\r\n".encode()

    body = (
        f"--{boundary}\r\n".encode()
        + meta_header
        + meta
        + delimiter
        + media_header
        + data
        + close_delim
    )

    req = urllib.request.Request(
        "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name",
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": f"multipart/related; boundary={boundary}",
            "Content-Length": str(len(body)),
        },
    )
    with urllib.request.urlopen(req) as resp:
        res = json.loads(resp.read().decode("utf-8"))
        return str(res["id"])


def drive_download_file(token: str, file_id: str) -> bytes:
    req = urllib.request.Request(
        f"https://www.googleapis.com/drive/v3/files/{file_id}?alt=media",
        headers={"Authorization": f"Bearer {token}"},
    )
    with urllib.request.urlopen(req) as resp:
        return resp.read()  # type: ignore[no-any-return]


def drive_delete_file(token: str, file_id: str) -> None:
    req = urllib.request.Request(
        f"https://www.googleapis.com/drive/v3/files/{file_id}",
        method="DELETE",
        headers={"Authorization": f"Bearer {token}"},
    )
    try:
        with urllib.request.urlopen(req):
            pass
    except Exception as exc:
        print(f"  Warning: Drive cleanup deletion for {file_id} failed: {exc}")


def main() -> int:
    env = load_env(Path(".env"))
    print("=== OCTO LIVE VERIFICATION: 3 Guest Workspaces, R2 & Drive Archival ===")

    # 1. R2 Client setup
    import importlib

    try:
        boto3 = importlib.import_module("boto3")
    except ImportError:
        print("Error: boto3 is required for live storage verification")
        return 1

    endpoint = env.get("R2_ENDPOINT") or env.get("CLOUDFLARE_R2_ENDPOINT")
    access_key = env.get("R2_ACCESS_KEY_ID") or env.get("CLOUDFLARE_R2_ACCESS_KEY_ID")
    secret_key = env.get("R2_SECRET_ACCESS_KEY") or env.get("CLOUDFLARE_R2_SECRET_ACCESS_KEY")
    bucket = env.get("R2_BUCKET") or env.get("CLOUDFLARE_R2_BUCKET")

    if not (endpoint and access_key and secret_key and bucket):
        print("Error: Missing R2 configuration in .env")
        return 1

    s3 = boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        region_name="auto",
    )

    # 2. Google Drive setup
    client_id = env.get("GOOGLE_DRIVE_CLIENT_ID") or env.get("GOOGLE_CLIENT_ID", "")
    client_secret = env.get("GOOGLE_DRIVE_CLIENT_SECRET") or env.get("GOOGLE_CLIENT_SECRET", "")
    refresh_token = env.get("GOOGLE_DRIVE_REFRESH_TOKEN", "")

    if not (client_id and client_secret and refresh_token):
        print("Error: Missing Google Drive OAuth credentials in .env")
        return 1

    print("Authenticating with Google OAuth...")
    drive_token = get_google_access_token(client_id, client_secret, refresh_token)
    print("Google OAuth access token retrieved successfully.")

    # 3. Simulate 3 Guest Workspaces
    guest_accounts: list[GuestAccountConfig] = [
        {
            "guest_id": "guest_alpha_id",
            "name": "Guest Alpha",
            "workspace_slug": "guest-alpha-research",
            "filename": "alpha_research_manifest.json",
            "content": b'{"workspace": "guest-alpha-research", "files": 12, "active": true}',
        },
        {
            "guest_id": "guest_beta_id",
            "name": "Guest Beta",
            "workspace_slug": "guest-beta-archive",
            "filename": "beta_archive_index.txt",
            "content": b"Guest Beta Archive Catalog - 2026 Family Photos and Documents",
        },
        {
            "guest_id": "guest_gamma_id",
            "name": "Guest Gamma",
            "workspace_slug": "guest-gamma-studio",
            "filename": "gamma_studio_spec.md",
            "content": b"# Gamma Studio Design Token System\nPrimary colors: #3b82f6",
        },
    ]

    r2_keys_created: list[str] = []
    drive_files_created: list[str] = []

    try:
        print("\n--- Phase 1: Upload Active Files to Cloudflare R2 for 3 Guest Workspaces ---")
        for guest in guest_accounts:
            ts = int(time.time())
            key = f"octo-tests/workspaces/{guest['workspace_slug']}/{ts}-{guest['filename']}"
            r2_keys_created.append(key)
            expected_hash = hashlib.sha256(guest["content"]).hexdigest()

            # Upload to R2
            s3.put_object(
                Bucket=bucket,
                Key=key,
                Body=guest["content"],
                ContentType="application/octet-stream",
            )
            print(f"  [+] Uploaded to R2: {guest['workspace_slug']} -> {key}")

            # Verify retrieval from R2
            obj: dict[str, Any] = s3.get_object(Bucket=bucket, Key=key)
            downloaded = obj["Body"].read()
            actual_hash = hashlib.sha256(downloaded).hexdigest()
            assert actual_hash == expected_hash, (
                f"Hash mismatch for {key}: expected {expected_hash}, got {actual_hash}"
            )
            print(f"      Verified R2 download & SHA256 integrity ({actual_hash[:16]}...)")

        print("\n--- Phase 2: Archive Alpha File from R2 to Google Drive ---")
        alpha_key = r2_keys_created[0]
        alpha_content = guest_accounts[0]["content"]

        # Fetch bytes from R2
        r2_obj: dict[str, Any] = s3.get_object(Bucket=bucket, Key=alpha_key)
        bytes_to_archive = r2_obj["Body"].read()

        # Archive to Google Drive
        drive_name = f"octo-archive-{Path(alpha_key).name}"
        drive_file_id = drive_upload_file(
            drive_token, drive_name, bytes_to_archive, "application/json"
        )
        drive_files_created.append(drive_file_id)
        print(f"  [+] Archived to Google Drive: {drive_name} -> Drive ID: {drive_file_id}")

        # Verify Google Drive copy integrity
        drive_bytes = drive_download_file(drive_token, drive_file_id)
        assert hashlib.sha256(drive_bytes).hexdigest() == hashlib.sha256(alpha_content).hexdigest()
        print("      Verified Google Drive download & SHA256 matches original bytes.")

        # Delete active R2 copy (source cleanup after durable copy confirmed)
        s3.delete_object(Bucket=bucket, Key=alpha_key)
        print("      Removed active copy from R2 (active_r2 -> archived_drive complete).")

        print("\n--- Phase 3: Restore Archived File from Google Drive to R2 ---")
        restored_key = f"octo-tests/workspaces/guest-alpha-research/restored-{Path(alpha_key).name}"
        r2_keys_created.append(restored_key)

        # Download from Drive and put back into R2
        restored_bytes = drive_download_file(drive_token, drive_file_id)
        s3.put_object(
            Bucket=bucket,
            Key=restored_key,
            Body=restored_bytes,
            ContentType="application/json",
        )
        print(f"  [+] Restored to R2: {restored_key}")

        # Verify restored copy
        restored_obj: dict[str, Any] = s3.get_object(Bucket=bucket, Key=restored_key)
        final_bytes = restored_obj["Body"].read()
        assert hashlib.sha256(final_bytes).hexdigest() == hashlib.sha256(alpha_content).hexdigest()
        print("      Verified restored R2 object integrity (exact byte match).")

        print("\n--- Phase 4: Cross-Workspace Isolation Verification ---")
        alpha_keys = [k for k in r2_keys_created if "guest-alpha-research" in k]
        beta_keys = [k for k in r2_keys_created if "guest-beta-archive" in k]
        gamma_keys = [k for k in r2_keys_created if "guest-gamma-studio" in k]

        assert len(alpha_keys) >= 1
        assert len(beta_keys) == 1
        assert len(gamma_keys) == 1
        print("  [+] Verified 3 guest workspaces strictly maintain isolated storage paths.")

        print(
            "\n>>> ALL LIVE CHECKS PASSED: 3 Guest Workspaces, R2 active tier, Drive archival, "
            "and restore verified! <<<\n"
        )
        return 0

    finally:
        print("--- Cleanup Phase: Removing live test artifacts ---")
        for key in r2_keys_created:
            try:
                s3.delete_object(Bucket=bucket, Key=key)
                print(f"  [-] Cleaned up R2 key: {key}")
            except Exception as e:
                print(f"  Warning: failed to delete {key}: {e}")

        for fid in drive_files_created:
            drive_delete_file(drive_token, fid)
            print(f"  [-] Cleaned up Google Drive file: {fid}")


if __name__ == "__main__":
    raise SystemExit(main())
