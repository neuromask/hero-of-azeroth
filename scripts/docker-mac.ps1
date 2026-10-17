#Requires -Version 5.1
<#
.SYNOPSIS
  Runs the trial copy of Hero of Azeroth on a Mac on the same network, driven from
  this Windows checkout.

.DESCRIPTION
  The image is built by the Mac's own Docker engine (OrbStack), so it is a native
  linux/arm64 image: nothing is emulated and nothing has to be rebuilt for Apple
  Silicon. The sources stay in this checkout - `docker compose` sends the build
  context over SSH every time - so the Mac needs no clone, no git and no
  node_modules. The `.env` is read here too, so the Battle.net credentials never
  sit on the Mac.

  One-time setup on the Mac:
    - OrbStack installed and running (it puts `docker` and `docker compose` in
      /usr/local/bin);
    - System Settings -> General -> Sharing -> Remote Login turned on;
    - this machine's public key in ~/.ssh/authorized_keys, so no password is asked;
    - if a non-interactive SSH session cannot find `docker` ("exec: docker: not
      found"), add this line to ~/.zshenv and open a new session:
        export PATH="/usr/local/bin:$HOME/.orbstack/bin:$PATH"

  The site is then at http://<Remote>:<HostPort> from the LAN - and, on the Mac
  itself, at http://hero-of-azeroth.orb.local (OrbStack's own domain for the
  container, no port needed).

  Windows has no mDNS resolver, so the Bonjour name `mac-mini.local` does not
  resolve from it: pass the Mac's address instead (`-Remote 192.168.8.97`). The
  context is created once, so later runs can leave `-Remote` out.

.EXAMPLE
  ./scripts/docker-mac.ps1 up -Remote 192.168.8.97 -User aleksandr

.EXAMPLE
  ./scripts/docker-mac.ps1 rebuild -Remote 192.168.8.97 -User aleksandr

.EXAMPLE
  ./scripts/docker-mac.ps1 logs
#>
param(
  [Parameter(Position = 0)]
  [ValidateSet('up', 'rebuild', 'down', 'logs', 'ps', 'check')]
  [string]$Action = 'up',

  # The Mac's Bonjour name or LAN address.
  [string]$Remote = 'mac-mini.local',

  # The macOS account that owns OrbStack. SSH asks for its password unless a key
  # is in ~/.ssh/authorized_keys.
  [string]$User = $env:USERNAME,

  # The docker context this script creates once and then reuses.
  [string]$Context = 'macmini',

  [int]$HostPort = 3100,

  # Canonical host for SEO, hreflang and the sign-in callback. Empty means
  # "http://<Remote>:<HostPort>", which is the address a reader on the LAN uses.
  [string]$SiteUrl = ''
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
Push-Location $root

try {
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw 'The docker CLI is not on PATH. Start Docker Desktop (or install the CLI) on this machine first.'
  }

  # A context is created once. From then on every command below talks to the Mac's
  # engine over SSH, and `docker context use` is deliberately not called: this
  # machine keeps its own local context for local work.
  docker context inspect $Context *> $null
  if ($LASTEXITCODE -ne 0) {
    Write-Host "creating docker context '$Context' -> ssh://$User@$Remote" -ForegroundColor Cyan
    docker context create $Context --docker "host=ssh://$User@$Remote"
    if ($LASTEXITCODE -ne 0) {
      throw "Could not create the context. Is Remote Login on and is OrbStack running on $Remote?"
    }
  }

  # Read by `docker-compose.yml` on this side: the port published on the Mac and
  # the canonical host the rendered pages advertise.
  $env:HOST_PORT = "$HostPort"
  if (-not $env:NUXT_PUBLIC_SITE_URL) {
    $env:NUXT_PUBLIC_SITE_URL = if ($SiteUrl) { $SiteUrl } else { "http://${Remote}:${HostPort}" }
  }

  # A helper that turns a failed remote command into the sentence that fixes it,
  # because "exec: docker: not found" is the one failure a fresh Mac produces.
  function Invoke-Compose {
    param([string[]]$ComposeArgs)
    docker --context $Context compose @ComposeArgs
    if ($LASTEXITCODE -ne 0) {
      Write-Host ''
      Write-Host 'The remote command failed. Check, in order:' -ForegroundColor Yellow
      Write-Host '  - OrbStack is running on the Mac (menu bar icon);'
      Write-Host "  - Remote Login is on and 'ssh $User@$Remote' works from this machine;"
      Write-Host "  - a non-interactive SSH session can find docker (~/.zshenv, see this script's help)."
      exit $LASTEXITCODE
    }
  }

  switch ($Action) {
    'up' {
      Invoke-Compose @('up', '-d', '--build')
      Write-Host "Up. Open http://${Remote}:${HostPort} (on the Mac: http://hero-of-azeroth.orb.local)" -ForegroundColor Green
    }
    'rebuild' {
      Invoke-Compose @('build', '--no-cache')
      Invoke-Compose @('up', '-d')
      Write-Host "Rebuilt. Open http://${Remote}:${HostPort}" -ForegroundColor Green
    }
    'down' {
      Invoke-Compose @('down')
      Write-Host 'Stopped. The hoa-data volume (the database) is kept.' -ForegroundColor Green
    }
    'logs' {
      Invoke-Compose @('logs', '-f')
    }
    'ps' {
      Invoke-Compose @('ps')
    }
    'check' {
      docker --context $Context version
      if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
      docker --context $Context compose version
      if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
      Write-Host "The Mac's engine answers. The site is at http://${Remote}:${HostPort} after 'up'." -ForegroundColor Green
    }
  }
}
finally {
  Pop-Location
}
