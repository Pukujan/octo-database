"""One-time Google Drive OAuth authorization helper for Octo."""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

PORT = 8085
REDIRECT_URI = f"http://localhost:{PORT}"
SCOPE = "https://www.googleapis.com/auth/drive.file"


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


def update_env_refresh_token(env_path: Path, refresh_token: str) -> None:
    lines = env_path.read_text(encoding="utf-8").splitlines()
    found = False
    new_lines = []
    for line in lines:
        if line.startswith("GOOGLE_DRIVE_REFRESH_TOKEN="):
            new_lines.append(f"GOOGLE_DRIVE_REFRESH_TOKEN={refresh_token}")
            found = True
        else:
            new_lines.append(line)
    if not found:
        new_lines.append(f"GOOGLE_DRIVE_REFRESH_TOKEN={refresh_token}")
    env_path.write_text("\n".join(new_lines) + "\n", encoding="utf-8")


def exchange_code(
    client_id: str, client_secret: str, code: str, redirect_uri: str
) -> dict[str, object]:
    token_url = "https://oauth2.googleapis.com/token"
    data = urllib.parse.urlencode(
        {
            "client_id": client_id,
            "client_secret": client_secret,
            "code": code,
            "grant_type": "authorization_code",
            "redirect_uri": redirect_uri,
        }
    ).encode("utf-8")

    req = urllib.request.Request(token_url, data=data, method="POST")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode("utf-8"))  # type: ignore[no-any-return]


class OAuthHandler(BaseHTTPRequestHandler):
    auth_code: str | None = None
    auth_error: str | None = None

    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        params = urllib.parse.parse_qs(parsed.query)

        if "code" in params:
            OAuthHandler.auth_code = params["code"][0]
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(
                b"<h1>Authorization Successful!</h1>"
                b"<p>You can close this tab and return to the terminal.</p>"
            )
        elif "error" in params:
            OAuthHandler.auth_error = params["error"][0]
            self.send_response(400)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            err_msg = OAuthHandler.auth_error.encode("utf-8")
            self.wfile.write(b"<h1>Authorization Failed</h1><p>" + err_msg + b"</p>")
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format: str, *args: object) -> None:
        pass


def main() -> int:
    env_path = Path(".env")
    env = load_env(env_path)
    client_id = env.get("GOOGLE_DRIVE_CLIENT_ID") or env.get("GOOGLE_CLIENT_ID")
    client_secret = env.get("GOOGLE_DRIVE_CLIENT_SECRET") or env.get("GOOGLE_CLIENT_SECRET")

    if not client_id or not client_secret:
        print("Error: Missing GOOGLE_DRIVE_CLIENT_ID or GOOGLE_DRIVE_CLIENT_SECRET in .env")
        return 1

    params = {
        "client_id": client_id,
        "redirect_uri": REDIRECT_URI,
        "response_type": "code",
        "scope": SCOPE,
        "access_type": "offline",
        "prompt": "consent",
    }
    auth_url = f"https://accounts.google.com/o/oauth2/v2/auth?{urllib.parse.urlencode(params)}"

    print("==================================================================")
    print("Google Drive Authorization for Octo")
    print("==================================================================")
    print(f"\n1. Opening browser at:\n   {auth_url}\n")
    print(f"2. Waiting for callback on {REDIRECT_URI} ...")

    webbrowser.open(auth_url)

    server = HTTPServer(("localhost", PORT), OAuthHandler)
    server.timeout = 120

    while OAuthHandler.auth_code is None and OAuthHandler.auth_error is None:
        server.handle_request()

    server.server_close()

    if OAuthHandler.auth_error:
        print(f"\nAuthorization failed with error: {OAuthHandler.auth_error}")
        return 1

    code = OAuthHandler.auth_code
    if not code:
        print("\nTimed out or no code received.")
        return 1

    try:
        tokens = exchange_code(client_id, client_secret, code, REDIRECT_URI)
    except urllib.error.HTTPError as exc:
        err_body = exc.read().decode("utf-8", errors="ignore")
        print(f"\nFailed to exchange code: {exc} - Details: {err_body}")
        return 1
    except Exception as exc:
        print(f"\nFailed to exchange code: {exc}")
        return 1

    refresh_token = str(tokens.get("refresh_token") or "")
    if not refresh_token:
        print(
            "\nWarning: No refresh token returned. "
            "(Google only returns it when prompt=consent is used)"
        )
        return 1

    update_env_refresh_token(env_path, refresh_token)
    print("\nSUCCESS! GOOGLE_DRIVE_REFRESH_TOKEN saved to .env")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
