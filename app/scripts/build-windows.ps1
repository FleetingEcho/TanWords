param(
    [switch]$Portable
)

$ErrorActionPreference = "Stop"

if (-not $Portable) {
    if (-not (Test-Path Env:TAURI_SIGNING_PRIVATE_KEY_PATH)) {
        $env:TAURI_SIGNING_PRIVATE_KEY_PATH = Join-Path $HOME ".tauri\tanwords.key"
    }
    if (-not (Test-Path Env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD)) {
        $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
    }

    if (-not (Test-Path -LiteralPath $env:TAURI_SIGNING_PRIVATE_KEY_PATH)) {
        throw "Tauri signing private key was not found at: $env:TAURI_SIGNING_PRIVATE_KEY_PATH"
    }
}

$llvmPrefix = (scoop prefix llvm).Trim()
if (-not $llvmPrefix) {
    throw "LLVM is not installed. Run: scoop install llvm"
}

$env:LIBCLANG_PATH = Join-Path $llvmPrefix "bin"
$libclang = Join-Path $env:LIBCLANG_PATH "libclang.dll"
if (-not (Test-Path -LiteralPath $libclang)) {
    throw "libclang.dll was not found at: $libclang"
}

# sherpa-rs-sys creates hard links from its cache into Cargo's output folders.
# On a later release build it tries to copy the cache file over the same file,
# which Windows rejects. Remove only those generated links before rebuilding.
$releaseDir = Join-Path (Split-Path $PSScriptRoot -Parent) "src-tauri\target\release"
$sherpaDlls = @(
    "onnxruntime.dll",
    "onnxruntime_providers_shared.dll",
    "sherpa-onnx-c-api.dll",
    "sherpa-onnx-cxx-api.dll"
)
if (Test-Path -LiteralPath $releaseDir) {
    Get-ChildItem -LiteralPath $releaseDir -Recurse -File |
        Where-Object { $_.Name -in $sherpaDlls } |
        Remove-Item -Force
}

if ($Portable) {
    & bunx tauri build --no-bundle
} else {
    & bunx tauri build --bundles nsis
}
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

if ($Portable) {
    $appExe = Join-Path $releaseDir "tanwords.exe"
    if (-not (Test-Path -LiteralPath $appExe)) {
        throw "Portable executable is missing: $appExe"
    }

    $sherpaCache = Join-Path $env:LOCALAPPDATA "sherpa-rs"
    $portableFiles = @($appExe)
    foreach ($dll in $sherpaDlls) {
        $cachedDll = Get-ChildItem -LiteralPath $sherpaCache -Recurse -File -Filter $dll |
            Where-Object { $_.Directory.Name -eq "lib" } |
            Select-Object -First 1
        if (-not $cachedDll) {
            throw "Sherpa DLL was not found in its cache: $dll"
        }
        $portableFiles += $cachedDll.FullName
    }

    $portableDir = Join-Path $releaseDir "bundle\portable"
    New-Item -ItemType Directory -Path $portableDir -Force | Out-Null
    $archive = Join-Path $portableDir "TanWords_0.1.3_windows_x64_portable.zip"
    Compress-Archive -LiteralPath $portableFiles -DestinationPath $archive -Force
    Write-Output "Portable app created: $archive"
}
