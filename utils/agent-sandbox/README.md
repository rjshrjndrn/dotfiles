# pi-sandbox

Run the `pi` coding agent with the host **filesystem** isolated, using
[bubblewrap](https://github.com/containers/bubblewrap) (`bwrap`).

The goal is to prevent *accidental* damage to your host: a runaway command
or agent edit cannot touch files outside the current project. It is **not**
a defence against actively malicious code — the sandbox shares the host
kernel and network by design.

## Boundary

```
  tmpfs $HOME  (home wiped to empty)
    ├─ RO  /usr /etc /opt                 host tools + libc (no glibc mismatch)
    ├─ RO  ~/.local/share/mise            pi + every mise-managed CLI
    ├─ RO  ~/.cargo ~/.bun ~/.local/bin   more toolchain
    ├─ RO  ~/go/bin ~/apps/bin ~/.config/mise
    ├─ RO  ~/dotfiles/pi ~/private-skills pi extensions / skills
    ├─ RW  <git root>                     the project (auto-detected)
    └─ RW  ~/.pi                          pi config + sessions
```

Anything not bound simply **does not exist** inside the sandbox, so
`~/.ssh`, `~/.aws`, and the rest of `$HOME` cannot be read or damaged.

The working directory is preserved with `--chdir "$PWD"`, mounted at the
same absolute path, so git worktrees resolve their `.git` pointers and
`git commit` works normally.

```
  HOST                          SANDBOX
  /home/you/dotfiles      ───▶  /home/you/dotfiles   (RW, same path)
  $PWD = .../worktree-x         cd $PWD → .git links resolve
```

## Requirements

- `bwrap` (bubblewrap) on the host
- run from inside a git repository (the git root is the RW workspace)

## Usage

```sh
cd /path/to/your/worktree
pi-sandbox                 # launch pi inside the sandbox
pi-sandbox --dry-run       # print the bwrap command without running it
pi-sandbox <pi args...>    # extra args are passed straight to pi
```

Extra mounts via environment variables (space-separated, added if present):

```sh
EXTRA_RO="/data/models /opt/ref"  pi-sandbox   # read-only binds
EXTRA_RW="/scratch"               pi-sandbox   # read-write binds
```

## Install

```sh
make install     # symlink pi-sandbox into ~/.local/bin
make uninstall   # remove it
```

Override the location with `make install PREFIX=/somewhere/bin`.

## Tests

Plain-bash specs (no external test framework):

```sh
make test          # all specs
make test-dryrun   # asserts the generated bwrap command (secrets NOT bound)
make test-live     # enters the real sandbox and probes the boundary
make test-extra    # EXTRA_RO / EXTRA_RW behaviour
```

## Caveats

- **Filesystem only.** Network and PID namespaces are shared with the host.
- Mounting `~/.pi` read-write means the agent can modify your pi sessions
  and memory. This is accepted so sessions persist across runs.
- Host toolchain paths (mise, cargo, bun, ...) are hard-coded in the
  launcher. If your layout differs, edit the bind list in `pi-sandbox`.
```
