"""BabyLog — Flask + SQLite backend with a security layer for public hosting.

Serves a single-page frontend and a JSON API. Data lives in one SQLite file on
the server, so multiple devices (e.g. both parents) share the same baby's log.

Security (all opt-in via env vars, so local dev stays friction-free):
  * Session login with a shared password (hashed).
  * Brute-force lockout on the login endpoint (per IP).
  * Basic per-IP request rate limiting.
  * Optional geo-blocking by country (Cloudflare header or GeoIP2 DB).
  * CSRF protection on state-changing API calls.
  * Hardened security headers + Secure/HttpOnly/SameSite cookies.

Run (dev):   python app.py
Run (prod):  gunicorn -w 1 --threads 4 -b 127.0.0.1:8000 app:app
"""
import os
import re
import time
import base64
import hmac
import sqlite3
import secrets
from collections import defaultdict, deque
from datetime import datetime, timezone, timedelta

from flask import (
    Flask, g, jsonify, request, session, redirect, abort,
    send_from_directory, render_template_string, make_response,
)
from werkzeug.middleware.proxy_fix import ProxyFix
from werkzeug.security import check_password_hash, generate_password_hash

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.environ.get("BABYLOG_DB", os.path.join(BASE_DIR, "babylog.db"))
# Milestone photos live as JPEG files next to the database (not in SQLite, so
# the 6s /api/data poll stays small).
PHOTO_DIR = os.environ.get(
    "BABYLOG_PHOTOS", os.path.join(os.path.dirname(os.path.abspath(DB_PATH)), "photos")
)
PHOTO_ID_RE = re.compile(r"^[0-9a-f]{16}$")

# ---- security configuration (all optional) -------------------------------
# Password: set ONE of these to require login. If neither is set, the app is
# open (fine for a private LAN, NOT for the public internet).
PASSWORD_HASH = os.environ.get("BABYLOG_PASSWORD_HASH", "")
PASSWORD_PLAIN = os.environ.get("BABYLOG_PASSWORD", "")
if PASSWORD_PLAIN and not PASSWORD_HASH:
    PASSWORD_HASH = generate_password_hash(PASSWORD_PLAIN)
AUTH_ENABLED = bool(PASSWORD_HASH)

# Signing key for the session cookie. Set BABYLOG_SECRET in production so
# sessions survive restarts; otherwise a random key is used (logs everyone out
# on restart).
SECRET_KEY = os.environ.get("BABYLOG_SECRET") or secrets.token_hex(32)

# Send cookies only over HTTPS + enable HSTS. Turn on in production (set to 1).
SECURE_COOKIES = os.environ.get("BABYLOG_SECURE_COOKIES", "0") == "1"

SESSION_DAYS = int(os.environ.get("BABYLOG_SESSION_DAYS", "30"))

# Geo-block: comma list of allowed ISO country codes, e.g. "EE,FI,SE".
# Empty = disabled. Country comes from Cloudflare's CF-IPCountry header, or an
# optional MaxMind GeoLite2 DB (set BABYLOG_GEOIP_DB to its path).
ALLOWED_COUNTRIES = {
    c.strip().upper() for c in os.environ.get("BABYLOG_ALLOWED_COUNTRIES", "").split(",") if c.strip()
}
GEOIP_DB = os.environ.get("BABYLOG_GEOIP_DB", "")
_geo_reader = None
if GEOIP_DB:
    try:
        import geoip2.database  # type: ignore
        _geo_reader = geoip2.database.Reader(GEOIP_DB)
    except Exception as exc:  # noqa: BLE001
        print(f"[babylog] GeoIP DB not loaded ({exc}); geo-block uses headers only")

# Brute-force lockout on login.
LOGIN_MAX_FAILS = int(os.environ.get("BABYLOG_LOGIN_MAX_FAILS", "8"))
LOGIN_WINDOW = int(os.environ.get("BABYLOG_LOGIN_WINDOW", "900"))  # seconds

# General per-IP rate limit.
RATE_MAX = int(os.environ.get("BABYLOG_RATE_MAX", "600"))
RATE_WINDOW = int(os.environ.get("BABYLOG_RATE_WINDOW", "60"))  # seconds

app = Flask(__name__, static_folder="static", static_url_path="/static")
app.secret_key = SECRET_KEY
# Trust one reverse proxy (nginx) for client IP + scheme.
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1)
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Strict",
    SESSION_COOKIE_SECURE=SECURE_COOKIES,
    PERMANENT_SESSION_LIFETIME=timedelta(days=SESSION_DAYS),
    MAX_CONTENT_LENGTH=1 * 1024 * 1024,  # 1 MB request cap
)

# In-memory security state (per worker — run gunicorn with a single worker so
# these counters are authoritative; use --threads for concurrency).
_login_fails = defaultdict(list)   # ip -> [timestamps]
_rate_hits = defaultdict(deque)    # ip -> deque[timestamps]


# ---------------------------------------------------------------- db helpers
def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


@app.teardown_appcontext
def close_db(_exc):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    os.makedirs(PHOTO_DIR, exist_ok=True)
    with sqlite3.connect(DB_PATH) as db:
        with open(os.path.join(BASE_DIR, "schema.sql"), "r", encoding="utf-8") as f:
            db.executescript(f.read())


def uid():
    return secrets.token_hex(8)


def now_iso():
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


# ---------------------------------------------------------------- security
def client_ip():
    return request.remote_addr or "unknown"


def client_country():
    c = request.headers.get("CF-IPCountry") or request.headers.get("X-Country")
    if c:
        return c.upper()
    if _geo_reader:
        try:
            return _geo_reader.country(client_ip()).country.iso_code
        except Exception:  # noqa: BLE001
            return None
    return None


def geo_blocked():
    if not ALLOWED_COUNTRIES:
        return False
    c = client_country()
    if not c:
        return False  # fail open when country is unknown, to avoid lockout
    return c not in ALLOWED_COUNTRIES


def rate_limited(ip):
    now = time.time()
    dq = _rate_hits[ip]
    while dq and now - dq[0] > RATE_WINDOW:
        dq.popleft()
    dq.append(now)
    return len(dq) > RATE_MAX


def login_locked(ip):
    now = time.time()
    fails = [t for t in _login_fails[ip] if now - t < LOGIN_WINDOW]
    _login_fails[ip] = fails
    return len(fails) >= LOGIN_MAX_FAILS


def record_login_fail(ip):
    _login_fails[ip].append(time.time())


def password_ok(pw):
    return bool(PASSWORD_HASH) and check_password_hash(PASSWORD_HASH, pw)


PUBLIC_PATHS = {"/login", "/logout", "/health", "/manifest.webmanifest", "/favicon.ico"}


@app.before_request
def guard():
    # /health is always reachable (uptime checks), skips geo + auth.
    if request.path == "/health":
        return
    if geo_blocked():
        abort(403)
    if rate_limited(client_ip()):
        abort(429)

    p = request.path
    if p.startswith("/static/") or p in PUBLIC_PATHS:
        return
    if not AUTH_ENABLED:
        return
    if session.get("auth"):
        # Backfill a CSRF token for sessions that predate it or lost the cookie;
        # after_request re-issues the matching csrf_token cookie so writes work.
        if not session.get("csrf"):
            session["csrf"] = secrets.token_hex(16)
        # CSRF: mutating API calls must echo the per-session token.
        if request.method in ("POST", "PUT", "DELETE") and p.startswith("/api/"):
            token = request.headers.get("X-CSRF-Token", "")
            if not token or not hmac.compare_digest(token, session.get("csrf", "")):
                abort(403)
        return
    # not authenticated
    if p.startswith("/api/"):
        abort(401)
    return redirect("/login")


@app.after_request
def security_headers(resp):
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["X-Frame-Options"] = "DENY"
    resp.headers["Referrer-Policy"] = "no-referrer"
    resp.headers["Content-Security-Policy"] = (
        "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; "
        "script-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
    )
    if SECURE_COOKIES:
        resp.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    # Keep the JS-readable csrf_token cookie in sync with the session token, so a
    # cleared/expired cookie self-heals on the next page load instead of making
    # every write (e.g. stopping a timer) fail with 403.
    if AUTH_ENABLED and session.get("auth") and session.get("csrf"):
        resp.set_cookie(
            "csrf_token", session["csrf"],
            secure=SECURE_COOKIES, samesite="Strict",
            max_age=SESSION_DAYS * 86400,
        )
    return resp


# ---------------------------------------------------------------- login
LOGIN_HTML = """<!doctype html><html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="/static/styles.css"><title>BabyLog · Sign in</title></head>
<body><div class="app"><div class="center-screen">
<div style="font-size:48px;margin-bottom:8px">👶</div>
<h1>BabyLog</h1>
<p>Enter the access password.</p>
<form method="post" style="width:100%;max-width:320px">
  <div class="field"><label>Password</label>
  <input type="password" name="password" autofocus autocomplete="current-password"
         style="width:100%;border:.5px solid var(--accent-soft);border-radius:10px;padding:11px 12px;font-size:16px"></div>
  {% if error %}<p style="color:var(--danger);font-size:13px;margin:0 0 10px">{{ error }}</p>{% endif %}
  <button class="btn block" type="submit">Sign in</button>
</form></div></div></body></html>"""


def render_login(error="", status=200):
    return render_template_string(LOGIN_HTML, error=error), status


@app.route("/login", methods=["GET", "POST"])
def login():
    if not AUTH_ENABLED:
        return redirect("/")
    ip = client_ip()
    if request.method == "POST":
        if login_locked(ip):
            return render_login("Too many attempts. Try again in a few minutes.", 429)
        if password_ok(request.form.get("password", "")):
            session.clear()
            session["auth"] = True
            session["csrf"] = secrets.token_hex(16)
            session.permanent = True
            _login_fails.pop(ip, None)
            resp = make_response(redirect("/"))
            resp.set_cookie(
                "csrf_token", session["csrf"],
                secure=SECURE_COOKIES, samesite="Strict",
                max_age=SESSION_DAYS * 86400,
            )
            return resp
        record_login_fail(ip)
        return render_login("Wrong password.", 401)
    if session.get("auth"):
        return redirect("/")
    return render_login()


@app.route("/logout")
def logout():
    session.clear()
    resp = make_response(redirect("/login" if AUTH_ENABLED else "/"))
    resp.delete_cookie("csrf_token")
    return resp


@app.route("/health")
def health():
    return "ok", 200


# ---------------------------------------------------------------- serializers
def baby_dict(r):
    return {"id": r["id"], "name": r["name"], "sex": r["sex"], "birthISO": r["birth_iso"]}


def event_dict(r):
    d = {"id": r["id"], "babyId": r["baby_id"], "type": r["type"], "atISO": r["at_iso"]}
    for src, dst in (
        ("end_iso", "endISO"), ("duration_sec", "durationSec"), ("side", "side"),
        ("ml", "ml"), ("celsius", "celsius"), ("grams", "grams"), ("note", "note"),
    ):
        if r[src] is not None:
            d[dst] = r[src]
    return d


def timer_dict(r):
    return {"id": r["id"], "babyId": r["baby_id"], "kind": r["kind"], "startISO": r["start_iso"]}


# ---------------------------------------------------------------- routes: app
@app.route("/")
def index():
    return send_from_directory("static", "index.html")


@app.route("/manifest.webmanifest")
def manifest():
    return send_from_directory("static", "manifest.webmanifest",
                               mimetype="application/manifest+json")


# ---------------------------------------------------------------- routes: api
@app.get("/api/data")
def get_data():
    db = get_db()
    babies = [baby_dict(r) for r in db.execute("SELECT * FROM babies ORDER BY created")]
    events = [event_dict(r) for r in db.execute("SELECT * FROM events ORDER BY at_iso")]
    timers = [timer_dict(r) for r in db.execute("SELECT * FROM timers")]
    return jsonify({"babies": babies, "events": events, "timers": timers})


@app.post("/api/babies")
def create_baby():
    b = request.get_json(force=True)
    bid = uid()
    get_db().execute(
        "INSERT INTO babies (id, name, sex, birth_iso, created) VALUES (?,?,?,?,?)",
        (bid, b["name"], b["sex"], b["birthISO"], now_iso()),
    )
    get_db().commit()
    return jsonify({"id": bid, "name": b["name"], "sex": b["sex"], "birthISO": b["birthISO"]})


@app.put("/api/babies/<bid>")
def update_baby(bid):
    b = request.get_json(force=True)
    get_db().execute(
        "UPDATE babies SET name=?, sex=?, birth_iso=? WHERE id=?",
        (b["name"], b["sex"], b["birthISO"], bid),
    )
    get_db().commit()
    return jsonify({"ok": True})


@app.delete("/api/babies/<bid>")
def delete_baby(bid):
    get_db().execute("DELETE FROM babies WHERE id=?", (bid,))
    get_db().commit()
    return jsonify({"ok": True})


EVENT_FIELDS = ("endISO", "durationSec", "side", "ml", "celsius", "grams", "note")
FIELD_COL = {
    "endISO": "end_iso", "durationSec": "duration_sec", "side": "side",
    "ml": "ml", "celsius": "celsius", "grams": "grams", "note": "note",
}


def insert_event(db, e):
    eid = e.get("id") or uid()
    cols = ["id", "baby_id", "type", "at_iso"]
    vals = [eid, e["babyId"], e["type"], e["atISO"]]
    for f in EVENT_FIELDS:
        if f in e and e[f] is not None:
            cols.append(FIELD_COL[f])
            vals.append(e[f])
    placeholders = ",".join("?" * len(vals))
    db.execute(f"INSERT INTO events ({','.join(cols)}) VALUES ({placeholders})", vals)
    return eid


@app.post("/api/events")
def create_event():
    e = request.get_json(force=True)
    db = get_db()
    eid = insert_event(db, e)
    db.commit()
    return jsonify({"id": eid})


@app.delete("/api/events/<eid>")
def delete_event(eid):
    get_db().execute("DELETE FROM events WHERE id=?", (eid,))
    get_db().commit()
    return jsonify({"ok": True})


@app.post("/api/photos")
def upload_photo():
    # Body: {"data": "data:image/jpeg;base64,..."} — the client downsizes first.
    data = (request.get_json(force=True) or {}).get("data", "")
    m = re.match(r"^data:image/jpeg;base64,(.+)$", data, re.S)
    if not m:
        abort(400)
    try:
        raw = base64.b64decode(m.group(1), validate=True)
    except Exception:
        abort(400)
    if not raw.startswith(b"\xff\xd8\xff") or len(raw) > 900 * 1024:
        abort(400)
    pid = uid()
    with open(os.path.join(PHOTO_DIR, pid + ".jpg"), "wb") as f:
        f.write(raw)
    return jsonify({"id": pid})


@app.get("/api/photos/<pid>")
def get_photo(pid):
    if not PHOTO_ID_RE.match(pid):
        abort(404)
    return send_from_directory(PHOTO_DIR, pid + ".jpg", mimetype="image/jpeg", max_age=31536000)


@app.delete("/api/photos/<pid>")
def delete_photo(pid):
    if not PHOTO_ID_RE.match(pid):
        abort(404)
    try:
        os.remove(os.path.join(PHOTO_DIR, pid + ".jpg"))
    except FileNotFoundError:
        pass
    return jsonify({"ok": True})


@app.post("/api/timers/start")
def start_timer():
    t = request.get_json(force=True)
    db = get_db()
    existing = db.execute(
        "SELECT * FROM timers WHERE baby_id=? AND kind=?", (t["babyId"], t["kind"])
    ).fetchone()
    if existing:
        return jsonify(timer_dict(existing))
    tid = uid()
    start = now_iso()
    db.execute(
        "INSERT INTO timers (id, baby_id, kind, start_iso) VALUES (?,?,?,?)",
        (tid, t["babyId"], t["kind"], start),
    )
    db.commit()
    return jsonify({"id": tid, "babyId": t["babyId"], "kind": t["kind"], "startISO": start})


@app.post("/api/timers/cancel")
def cancel_timer():
    t = request.get_json(force=True)
    get_db().execute("DELETE FROM timers WHERE baby_id=? AND kind=?", (t["babyId"], t["kind"]))
    get_db().commit()
    return jsonify({"ok": True})


@app.post("/api/timers/stop")
def stop_timer():
    """Stop a running timer and write the corresponding event."""
    t = request.get_json(force=True)
    db = get_db()
    row = db.execute(
        "SELECT * FROM timers WHERE baby_id=? AND kind=?", (t["babyId"], t["kind"])
    ).fetchone()
    if not row:
        return jsonify({"ok": False, "error": "no such timer"}), 404
    start = datetime.fromisoformat(row["start_iso"])
    end = datetime.now(start.tzinfo) if start.tzinfo else datetime.now()
    duration = max(0, int((end - start).total_seconds()))
    db.execute("DELETE FROM timers WHERE id=?", (row["id"],))
    if row["kind"] == "sleep":
        e = {
            "babyId": t["babyId"], "type": "sleep", "atISO": row["start_iso"],
            "endISO": end.isoformat(timespec="seconds"), "durationSec": duration,
        }
        if t.get("side"):
            e["side"] = t["side"]
    else:
        e = {
            "babyId": t["babyId"], "type": "breast", "atISO": row["start_iso"],
            "side": "L" if row["kind"] == "breast-L" else "R", "durationSec": duration,
        }
    eid = insert_event(db, e)
    db.commit()
    return jsonify({"id": eid, "durationSec": duration})


@app.get("/api/export")
def export_all():
    return get_data()


# Ensure the schema exists whether launched via `python app.py` or gunicorn.
init_db()
if not AUTH_ENABLED:
    print("[babylog] WARNING: no password set — the app is OPEN. "
          "Set BABYLOG_PASSWORD before exposing it to the internet.")

if __name__ == "__main__":
    # Dev server only (use gunicorn in production). The interactive debugger is
    # opt-in: never turn it on where other people can reach the port.
    app.run(host=os.environ.get("HOST", "127.0.0.1"), port=int(os.environ.get("PORT", 8000)),
            debug=os.environ.get("BABYLOG_DEBUG") == "1")
