#!/usr/bin/env python3
"""Set the BabyLog login password. Stores only a hash, in an env file.

    python set_password.py                 # writes ./babylog.env
    python set_password.py /opt/babylog/babylog.env
"""
import getpass
import pathlib
import sys

from werkzeug.security import generate_password_hash

env = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "babylog.env")
pw = getpass.getpass("Choose BabyLog password: ")
if len(pw) < 8:
    raise SystemExit("Too short — use at least 8 characters.")
if getpass.getpass("Repeat password: ") != pw:
    raise SystemExit("Passwords did not match.")

lines = env.read_text().splitlines() if env.exists() else []
lines = [l for l in lines if not l.startswith(("BABYLOG_PASSWORD_HASH=", "BABYLOG_PASSWORD="))]
lines.append("BABYLOG_PASSWORD_HASH=" + generate_password_hash(pw))
env.write_text("\n".join(lines) + "\n")
env.chmod(0o600)
print(f"Password hash saved to {env}. Restart BabyLog to apply.")
