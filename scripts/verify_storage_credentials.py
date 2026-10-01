"""Verify storage provider configuration without leaking credentials."""

from __future__ import annotations

import json
import urllib.parse
import urllib.request
from pathlib import Path


def load_env(env_path: Path) -> dict[str, str]:
    if not env_path.exists():
        return {}
    values: dict[str, str] = {}
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        values[k.strip()] = v.strip().strip("'\"")
    return values


def verify_r2(env: dict[str, str]) -> bool:
    endpoint = env.get("R2_ENDPOINT") or env.get("CLOUDFLARE_R2_ENDPOINT")
    access_key = env.get("R2_ACCESS_KEY_ID") or env.get("CLOUDFLARE_R2_ACCESS_KEY_ID")
    secret_key = env.get("R2_SECRET_ACCESS_KEY") or env.get("CLOUDFLARE_R2_SECRET_ACCESS_KEY")
    bucket = env.get("R2_BUCKET") or env.get("CLOUDFLARE_R2_BUCKET")

    print("[Cloudflare R2 Status]")
    print(f"  Endpoint configured: {'YES' if endpoint else 'NO'}")
    print(f"  Access Key configured: {'YES' if access_key else 'NO'}")
    print(f"  Secret Key configured: {'YES' if secret_key else 'NO'}")
    print(f"  Target Bucket: {bucket if bucket else 'NONE'}")

    if not (endpoint and access_key and secret_key):
        print("  Result: INCOMPLETE (missing endpoint or credentials)\n")
        return False

    try:
        import boto3  # type: ignore[import-untyped]

        s3 = boto3.client(
            "s3",
            endpoint_url=endpoint,
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            region_name="auto",
        )
        response = s3.list_buckets()
        bucket_names = [b["Name"] for b in response.get("Buckets", [])]
        names_str = ", ".join(bucket_names)
        print(f"  Connection: SUCCESS (found {len(bucket_names)} buckets: {names_str})")
        if bucket and bucket in bucket_names:
            print(f"  Bucket '{bucket}': VERIFIED ACCESSIBLE")
        elif bucket:
            print(f"  Bucket '{bucket}': Not found in bucket list (check name or permissions)")
        print("  Result: READY FOR SLICE 2 ACTIVE STORAGE\n")
        return True
    except ImportError:
        print("  Connection: boto3 not installed, skipping live check.")
        print("  Result: CONFIG VALIDATED\n")
        return True
    except Exception as exc:
        print(f"  Connection FAILED: {type(exc).__name__}: {exc}")
        print("  Result: CONNECTION ERROR\n")
        return False


def verify_google_drive(env: dict[str, str]) -> bool:
    client_id = env.get("GOOGLE_DRIVE_CLIENT_ID") or env.get("GOOGLE_CLIENT_ID")
    client_secret = env.get("GOOGLE_DRIVE_CLIENT_SECRET") or env.get("GOOGLE_CLIENT_SECRET")
    refresh_token = env.get("GOOGLE_DRIVE_REFRESH_TOKEN")
    api_key = env.get("GOOGLE_DRIVE_API_KEY")

    print("[Google Drive Status]")
    print(f"  Client ID configured: {'YES' if client_id else 'NO'}")
    print(f"  Client Secret configured: {'YES' if client_secret else 'NO'}")
    print(f"  OAuth Refresh Token configured: {'YES' if refresh_token else 'NO'}")
    print(f"  API Key configured: {'YES' if api_key else 'NO'}")

    if client_id and client_secret and refresh_token:
        try:
            token_data = urllib.parse.urlencode(
                {
                    "client_id": client_id,
                    "client_secret": client_secret,
                    "refresh_token": refresh_token,
                    "grant_type": "refresh_token",
                }
            ).encode("utf-8")
            token_req = urllib.request.Request(
                "https://oauth2.googleapis.com/token",
                data=token_data,
                method="POST",
            )
            token_req.add_header("Content-Type", "application/x-www-form-urlencoded")
            with urllib.request.urlopen(token_req) as resp:
                tokens = json.loads(resp.read().decode("utf-8"))

            access_token = tokens.get("access_token")
            about_url = "https://www.googleapis.com/drive/v3/about?fields=storageQuota,user"
            about_req = urllib.request.Request(
                about_url,
                headers={"Authorization": f"Bearer {access_token}"},
            )
            with urllib.request.urlopen(about_req) as resp2:
                about = json.loads(resp2.read().decode("utf-8"))

            user = about.get("user", {})
            quota = about.get("storageQuota", {})
            limit_tb = int(quota.get("limit", 0)) / (1024**4)
            used_gb = int(quota.get("usage", 0)) / (1024**3)

            email = user.get("emailAddress", "unknown")
            print(f"  Live Connection: SUCCESS ({user.get('displayName')}, {email})")
            print(f"  Available Quota: {limit_tb:.2f} TB (Used: {used_gb:.2f} GB)")
            print("  Result: READY FOR SLICE 5 ARCHIVAL STORAGE (VERIFIED LIVE)\n")
            return True
        except Exception as exc:
            print(f"  Live connection check failed: {exc}")
            print("  Result: CONFIG PRESENT BUT LIVE CHECK FAILED\n")
            return False

    if api_key:
        print("  Result: PARTIAL (API Key for public metadata; OAuth needed for private archive)\n")
        return False
    print("  Result: PENDING (Requires OAuth 2.0 Client ID + Secret + Refresh Token)\n")
    return False


def main() -> int:
    env_path = Path(".env")
    env = load_env(env_path)
    if not env:
        print("Warning: .env file not found or empty.")
    r2_ok = verify_r2(env)
    drive_ok = verify_google_drive(env)
    return 0 if (r2_ok or drive_ok) else 1


if __name__ == "__main__":
    raise SystemExit(main())
