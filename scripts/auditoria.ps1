# Auditoría de solo lectura de Mi@Social_ia. No crea, borra ni modifica nada.
# Uso (desde G:\chocoSocial_IA):  powershell -ExecutionPolicy Bypass -File .\scripts\auditoria.ps1
# Resultado: auditoria-resultado.txt (ignorado por Git). Revisalo antes de compartirlo.

$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root "auditoria-resultado.txt"
$app = Join-Path $root "app"

function Section($title) { "`n===== $title =====" }

& {
  Section "Fecha"
  (Get-Date).ToUniversalTime().ToString("u")

  Section "1. Versiones"
  "node:     $(node -v)"
  "npm:      $(npm -v)"
  "wrangler global: $(try { (wrangler --version 2>&1 | Select-Object -Last 1) } catch { 'no instalado' })"
  Push-Location $app
  "wrangler proyecto: $(npx --no-install wrangler --version 2>&1 | Select-Object -Last 1)"

  Section "2. Cuenta de Cloudflare (wrangler whoami)"
  npx --no-install wrangler whoami 2>&1

  Section "5. Worker misocial-ia ya existente? (error = no existe, es lo esperado)"
  npx --no-install wrangler deployments list --name misocial-ia 2>&1 | Select-Object -First 15

  Section "6. R2: buckets existentes"
  npx --no-install wrangler r2 bucket list 2>&1

  Section "D1: bases existentes"
  npx --no-install wrangler d1 list 2>&1
  Pop-Location

  Section "4. DNS publico de social.choco.uy y media.choco.uy (vacio = no existe)"
  foreach ($h in "social.choco.uy", "media.choco.uy") {
    "--- $h"
    try { Resolve-DnsName $h -ErrorAction Stop | Format-Table -AutoSize | Out-String } catch { "sin registro: $($_.Exception.Message)" }
  }
  "--- choco.uy NS (debe mostrar *.ns.cloudflare.com)"
  try { Resolve-DnsName choco.uy -Type NS -ErrorAction Stop | Where-Object { $_.Type -eq 'NS' } | ForEach-Object { $_.NameHost } } catch { $_.Exception.Message }
  "--- choco.uy y www.choco.uy (A/CNAME)"
  foreach ($h in "choco.uy", "www.choco.uy") {
    try { Resolve-DnsName $h -ErrorAction Stop | Where-Object { $_.Type -in 'A','AAAA','CNAME' } | ForEach-Object { "$h $($_.Type) $($_.IPAddress)$($_.NameHost)" } } catch { "$h sin registro: $($_.Exception.Message)" }
  }

  Section "9. Fuente de contenido de choco.uy (4 lecturas livianas)"
  foreach ($u in "https://choco.uy/robots.txt", "https://choco.uy/sitemap.xml", "https://www.choco.uy/robots.txt", "http://choco.uy/") {
    try {
      $r = Invoke-WebRequest $u -UseBasicParsing -TimeoutSec 15 -ErrorAction Stop
      "--- $u -> $($r.StatusCode) ($($r.Headers['Content-Type']))"
      ($r.Content -split "`n" | Select-Object -First 25) -join "`n"
    } catch { "--- $u -> $($_.Exception.Message)" }
  }
  try {
    $page = Invoke-WebRequest "https://choco.uy/" -UseBasicParsing -TimeoutSec 15 -ErrorAction Stop
    "--- Plataforma detectada (cabeceras y generator):"
    $page.Headers.GetEnumerator() | Where-Object { $_.Key -match "server|powered|x-shopify|x-wix|x-generator" } | ForEach-Object { "$($_.Key): $($_.Value)" }
    ([regex]::Matches($page.Content, '<meta[^>]+generator[^>]+>') | ForEach-Object Value)
  } catch { "--- home: $($_.Exception.Message)" }
} *>&1 | Tee-Object -FilePath $out

"`nListo. Resultado guardado en $out"
