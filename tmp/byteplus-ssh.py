import argparse
import pathlib
import sys
sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')

sys.path.insert(0, str(pathlib.Path(__file__).parent / 'byteplus-ssh-tools'))
import paramiko

parser = argparse.ArgumentParser()
parser.add_argument('--command-file')
parser.add_argument('--put', nargs=2, action='append', default=[])
parser.add_argument('--get', nargs=2, action='append', default=[])
parser.add_argument('--timeout', type=int, default=600)
args = parser.parse_args()

client = paramiko.SSHClient()
client.load_host_keys(str(pathlib.Path.home() / '.ssh' / 'known_hosts'))
client.set_missing_host_key_policy(paramiko.RejectPolicy())
try:
    credential = pathlib.Path('key.txt').read_text(encoding='utf-8-sig').strip()
    client.connect('43.172.66.90', username='ubuntu', password=credential,
                   allow_agent=False, look_for_keys=False, timeout=15, auth_timeout=15)
    if args.put:
        with client.open_sftp() as sftp:
            for local, remote in args.put:
                sftp.put(local, remote)
    if args.get:
        with client.open_sftp() as sftp:
            for remote, local in args.get:
                pathlib.Path(local).parent.mkdir(parents=True, exist_ok=True)
                sftp.get(remote, local)
    if args.command_file:
        command = pathlib.Path(args.command_file).read_text(encoding='utf-8-sig')
        _, stdout, stderr = client.exec_command(command, timeout=args.timeout)
        for line in stdout:
            sys.stdout.write(line)
            sys.stdout.flush()
        sys.stderr.write(stderr.read().decode('utf-8', errors='replace'))
        sys.exit(stdout.channel.recv_exit_status())
finally:
    client.close()
