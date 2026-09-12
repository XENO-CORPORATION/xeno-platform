# infra/ — the estate as code (P2.10)

Everything about these machines that is **not** in the application repo:
packages, the WireGuard link, the DR schedule, file modes, and the hypervisor's
watchdog and alerting units.

## Run it

The control node is the **Proxmox host**, deliberately: it is always on, it sits
*below* the VMs, and rebuilding a VM starts there anyway. A control node living
on one of its own targets cannot rebuild that target.

```sh
ssh bnkr-node-001
cd /root/xeno-infra
ansible-playbook -i inventory.ini site.yml --check   # dry run — ALWAYS first
ansible-playbook -i inventory.ini site.yml           # apply
```

## 🔴 It contains no secrets, and that is deliberate

Not the `.env` files, not the R2 credentials, not the GPG private key. Those
live encrypted in R2 (`scripts/secrets-backup.sh`) and at rest in
`~/.xeno-secrets`. IaC carrying plaintext credentials turns "reproducible" into
"leaked in git forever".

It does **assert** the secrets are present and fails loudly when they are not,
because a perfectly configured box with no credentials is still down. The
remedy it prints is the restore procedure in `docs/DR.md` §0e.

## What a dry run is FOR

`--check` reporting `changed=0` on every host is the proof that this file
describes reality. Anything else is drift, and the drift is the point — it is
the difference between infrastructure-as-code and infrastructure-as-fiction.

⚠️ **The first dry run earned its keep.** Ansible's `cron` module manages
entries by name with `#Ansible:` markers; the hand-written DR entries had none,
so applying would have created a SECOND copy of each — WAL shipping and backups
running twice, concurrently, against a `wal-ship.sh` with no lock. The
hand-written entries were removed and Ansible now owns them. Do not re-add DR
cron by hand; change it here.

⚠️ **Stale host keys block everything.** The hypervisor's `known_hosts` held old
ECDSA keys for both VMs (recycled IPs). The fix is to verify the current
fingerprint through a trusted path and pin it — never to disable host-key
checking, which is the weakness the SSH tunnel already had.
