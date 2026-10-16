import os
import hashlib
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / 'byteplus-ssh-tools'))
import paramiko

ROOT = Path(__file__).resolve().parent.parent
HOST = '43.172.66.90'
REMOTE = '/opt/quickreels'


def connect():
    password = (ROOT / 'key.txt').read_text(encoding='utf-8').strip()
    client = paramiko.SSHClient()
    client.load_host_keys(str(Path.home() / '.ssh' / 'known_hosts'))
    client.set_missing_host_key_policy(paramiko.RejectPolicy())
    client.connect(HOST, username='ubuntu', password=password, look_for_keys=False, allow_agent=False, timeout=10)
    return client


def run(client, command):
    _, stdout, stderr = client.exec_command(command, timeout=120)
    output = stdout.read().decode('utf-8', errors='replace')
    error = stderr.read().decode('utf-8', errors='replace')
    code = stdout.channel.recv_exit_status()
    print(output, end='')
    if error:
        print(error, file=sys.stderr, end='')
    if code:
        raise RuntimeError(f'Remote command failed with exit code {code}')


client = connect()
try:
    if sys.argv[1] == 'inspect':
        run(client, "cd /opt/quickreels && printf 'HEAD ' && git rev-parse --short HEAD && printf 'ADMIN FILE STATUS\\n' && git status --short -- apps/admin-web/src/main.tsx apps/admin-web/src/styles.css && printf 'ADMIN FILE HASHES\\n' && sha256sum apps/admin-web/src/main.tsx apps/admin-web/src/styles.css && printf 'CONTAINERS\\n' && sudo -n docker compose --env-file .env.production -f compose.production.self-hosted.yml ps admin && printf 'DISK\\n' && df -h .")
    elif sys.argv[1] == 'fetch':
        sftp = client.open_sftp()
        try:
            sftp.get(f'{REMOTE}/apps/admin-web/src/main.tsx', str(ROOT / 'tmp' / 'batch-remote-main.tsx'))
            sftp.get(f'{REMOTE}/apps/admin-web/src/styles.css', str(ROOT / 'tmp' / 'batch-remote-styles.css'))
        finally:
            sftp.close()
        print('Downloaded current server source for comparison.')
    elif sys.argv[1] == 'deploy':
        files = ['apps/admin-web/src/main.tsx', 'apps/admin-web/src/styles.css']
        expected = {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in files}
        backup = f'/home/ubuntu/quickreels-admin-batch-{datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")}'
        quoted_names = ' '.join(files)
        run(client, f"cd {REMOTE} && mkdir -p {backup} && cp --parents {quoted_names} {backup}/ && echo 'Backed up existing admin source.'")
        sftp = client.open_sftp()
        try:
            for name in files:
                sftp.put(str(ROOT / name), f'{REMOTE}/{name}')
        finally:
            sftp.close()
        checks = ' && '.join(f"test \"$(sha256sum {name} | cut -d ' ' -f 1)\" = {digest}" for name, digest in expected.items())
        run(client, f"cd {REMOTE} && {checks} && sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml build admin && sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml up -d --no-deps --force-recreate admin && sudo docker compose --env-file .env.production -f compose.production.self-hosted.yml ps admin && printf 'ADMIN HEALTH ' && curl --retry 8 --retry-delay 2 --retry-all-errors --max-time 8 --fail --silent --show-error https://admin.evergreenprosper.com/health")
        print(f'Production admin deployment completed. Backup: {backup}')
    else:
        raise RuntimeError('Unknown mode')
finally:
    client.close()
