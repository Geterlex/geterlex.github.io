Set-Location -LiteralPath $PSScriptRoot
if (Get-Command py -ErrorAction SilentlyContinue) {
    py -3 serve_local.py
} else {
    python serve_local.py
}
