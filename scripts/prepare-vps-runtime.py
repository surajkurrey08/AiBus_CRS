#!/usr/bin/env python3
"""Prepare only BookMyBus private runtime files; never print credentials.

Run as the dedicated deployment user. stdin optionally contains existing signing
keys copied securely from this application's local backend; no keys in arguments.
Existing values/Redis identity are preserved. No database/service calls are made.
"""
import json
import os
import re
import secrets
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

os.umask(0o077)
root = Path('/opt/bookmybus-crs')
assert root.is_dir() and not root.is_symlink()
assert (root / '.project-owner').read_text().strip() == 'bookmybus-crs'
env_path = root / 'shared/api.env'
original = env_path.read_text()
values = {}
for line in original.splitlines():
    if line.strip() and not line.lstrip().startswith('#') and '=' in line:
        key, value = line.split('=', 1)
        assert re.fullmatch(r'[A-Z][A-Z0-9_]*', key)
        values[key] = value
provided = json.load(sys.stdin)
for key in ['JWT_SECRET', 'PUBLIC_API_JWT_SECRET', 'PUBLIC_WEBHOOK_SIGNING_KEY']:
    if not values.get(key):
        value = provided.get(key)
        if not value and key != 'JWT_SECRET':
            # This production DB has no public API signing configuration; the
            # isolated sandbox's identity must never be reused for production.
            value = secrets.token_hex(32 if key == 'PUBLIC_WEBHOOK_SIGNING_KEY' else 48)
        if not value:
            raise RuntimeError('Existing application signing key missing: ' + key)
        assert '\n' not in value and '\r' not in value
        values[key] = value
assert len(values['JWT_SECRET']) >= 48
assert len(values['PUBLIC_API_JWT_SECRET']) >= 64
assert values['JWT_SECRET'] != values['PUBLIC_API_JWT_SECRET']
assert re.fullmatch('[a-f0-9]{64}', values['PUBLIC_WEBHOOK_SIGNING_KEY'])
tls = root / 'shared/redis-tls'
tls.mkdir(mode=0o700, exist_ok=True)
assert not tls.is_symlink()
def openssl(*args):
    subprocess.run(['openssl', *args], cwd=tls, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
if not (tls / '.prepared').exists():
    if any(tls.iterdir()):
        raise RuntimeError('Partial Redis TLS preparation exists; inspect without overwriting')
    openssl('req', '-x509', '-newkey', 'rsa:3072', '-nodes', '-sha256', '-days', '3650', '-subj', '/CN=BookMyBus private Redis CA', '-keyout', 'ca.key', '-out', 'ca.crt')
    openssl('req', '-new', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=bookmybus-redis', '-keyout', 'server.key', '-out', 'server.csr')
    (tls / 'server.ext').write_text('subjectAltName=DNS:bookmybus-redis,DNS:redis\nbasicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n')
    openssl('x509', '-req', '-in', 'server.csr', '-CA', 'ca.crt', '-CAkey', 'ca.key', '-CAcreateserial', '-out', 'server.crt', '-days', '365', '-sha256', '-extfile', 'server.ext')
    password = secrets.token_hex(32)
    (tls / 'redis.password').write_text(password)
    (tls / 'redis.conf').write_text('port 0\ntls-port 6379\nbind 0.0.0.0\nprotected-mode yes\ntls-cert-file /etc/bookmybus-redis/server.crt\ntls-key-file /etc/bookmybus-redis/server.key\ntls-ca-cert-file /etc/bookmybus-redis/ca.crt\ntls-auth-clients no\ntls-protocols "TLSv1.2 TLSv1.3"\nrequirepass ' + password + '\ndir /data\nappendonly yes\nappendfsync everysec\nmaxmemory 128mb\nmaxmemory-policy noeviction\n')
    # Host parent is 0700. Read access within the Redis-only mount is needed by
    # the image's unprivileged redis user. CA signing key is never mounted.
    for name in ['ca.crt', 'server.crt', 'server.key', 'redis.conf', 'redis.password']:
        (tls / name).chmod(0o444)
    # Move CA private signing material outside the Redis-mounted directory.
    signing = root / 'shared/redis-ca-private'
    signing.mkdir(mode=0o700, exist_ok=True)
    for name in ['ca.key', 'ca.srl', 'server.csr', 'server.ext']:
        if (tls / name).exists():
            (tls / name).rename(signing / name)
    (tls / '.prepared').write_text('BookMyBus private TLS Redis; renew server certificate before one year\n')
password = (tls / 'redis.password').read_text().strip()
values.update(NODE_ENV='production', PORT='4000', TRUST_PROXY='2', WEB_ORIGIN='https://bookmybus.pro', ADMIN_WEB_ORIGIN='https://admin.bookmybus.pro', PARTNER_WEB_ORIGIN='https://partner.bookmybus.pro', REDIS_URL='rediss://default:' + password + '@bookmybus-redis:6379', PUBLIC_API_SANDBOX='false', FINANCE_TEST_MODE='false')
backup = root / ('shared/api.env.before-runtime-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
backup.write_text(original)
backup.chmod(0o600)
temporary = env_path.with_suffix('.env.pending')
temporary.write_text('\n'.join(key + '=' + value for key, value in values.items()) + '\n')
temporary.chmod(0o600)
temporary.replace(env_path)
print('BookMyBus private runtime prepared; existing signing keys preserved; credentials were not printed.')
