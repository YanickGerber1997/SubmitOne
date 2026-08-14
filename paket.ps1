# =====================================================================
#  Serverpaket fuer submitone.ch zusammenstellen
#  ---------------------------------------------------------------------
#  Aufruf:   .\paket.ps1
#  Ergebnis: der Ordner  hochladen\  - sein ganzer Inhalt gehoert nach httpdocs
#
#  Was entsteht
#  ------------
#    hochladen\
#      index.html ...        die Verkaufsseite (aus web\)
#      api\                  Anmeldung und Auswertung - config.php bleibt UNANGETASTET
#      appswitch.js  bridge.js  ui\*.css          von allen Apps per ../ gebraucht
#      one\                  SubmitOne          (config.js OHNE Supabase)
#      write\                SubPaper           (pdf\ verlinkt fest auf ../write/)
#      pdf\                  Submit PDF
#      mappe\                SubZeit + kern + ui   (ui\ nur noch Marke und mappe.css)
#
#  Wichtig
#  -------
#  * api\config.php enthaelt Datenbank-Kennwort und Salt. Das Skript liest die
#    Datei vor dem Aufraeumen ein und legt sie danach unveraendert zurueck.
#  * Textdateien werden als UTF-8 OHNE BOM geschrieben. Ein BOM in einer
#    PHP-Datei erzeugt "headers already sent" - deshalb werden .php-Dateien
#    nur kopiert und nie umgeschrieben.
#  * Diese Datei bewusst nur in ASCII: PowerShell 5.1 liest .ps1 ohne BOM
#    als ANSI, Sonderzeichen zerbrechen dann den Parser.
# =====================================================================

$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

$Ziel = Join-Path $PSScriptRoot 'hochladen'
$UTF8 = New-Object System.Text.UTF8Encoding $false

function Schreibe($pfad, $text) { [System.IO.File]::WriteAllText($pfad, $text, $UTF8) }
function Lies($pfad) { [System.IO.File]::ReadAllText($pfad) }
function Ordner($pfad) { if (-not (Test-Path $pfad)) { New-Item -ItemType Directory -Path $pfad -Force | Out-Null } }

Write-Host ''
Write-Host '=== Serverpaket fuer submitone.ch ===' -ForegroundColor Cyan

# ---------------------------------------------------------------------
# 1) Zugangsdaten retten, dann aufraeumen
# ---------------------------------------------------------------------
$configPfad = Join-Path $Ziel 'api\config.php'
$configInhalt = $null
if (Test-Path $configPfad) {
    $configInhalt = [System.IO.File]::ReadAllBytes($configPfad)
    Write-Host ('  api\config.php gesichert ({0} Bytes), wird unveraendert zurueckgelegt' -f $configInhalt.Length) -ForegroundColor Yellow
}

if (Test-Path $Ziel) {
    $verdaechtig = Get-ChildItem $Ziel -Force | Where-Object { $_.Name -eq '.git' }
    if ($verdaechtig) {
        throw 'In hochladen liegt ein .git-Ordner. Abbruch, das ist nicht das Paketverzeichnis.'
    }
    Remove-Item -Path (Join-Path $Ziel '*') -Recurse -Force
} else {
    Ordner $Ziel
}

# ---------------------------------------------------------------------
# 2) Die Verkaufsseite (aus web\) in die Wurzel
#    Ohne die Anleitungen, die sind fuer dich und nicht fuer den Server.
# ---------------------------------------------------------------------
Get-ChildItem 'web' -Force | Where-Object { $_.Name -notmatch '\.md$' } | ForEach-Object {
    Copy-Item $_.FullName -Destination $Ziel -Recurse -Force
}
Write-Host '  web\        -> Wurzel'

# pruefen.php ist die Einrichtungshilfe: Sie sagt, ob PHP, Datenbank und
# Schreibrechte stimmen - und empfiehlt sich danach selbst zur Loeschung.
# Dauerhaft auf einem oeffentlichen Server verraet sie nur Innenleben.
# Wer sie braucht, kopiert sie von Hand aus web\api\ hinauf.
$pruef = Join-Path $Ziel 'api\pruefen.php'
if (Test-Path $pruef) {
    Remove-Item $pruef -Force
    Write-Host '  api\pruefen.php -> NICHT ins Paket (Einrichtungshilfe)'
}

# ---------------------------------------------------------------------
# 3) Von write\ und pdf\ per ../ gebrauchte Dateien
# ---------------------------------------------------------------------
Copy-Item 'appswitch.js' -Destination $Ziel -Force
Copy-Item 'bridge.js'    -Destination $Ziel -Force
Ordner (Join-Path $Ziel 'ui')
Copy-Item 'ui\tokens.css'       -Destination (Join-Path $Ziel 'ui') -Force
Copy-Item 'ui\bausteine.css'    -Destination (Join-Path $Ziel 'ui') -Force
Copy-Item 'ui\wochenraster.css' -Destination (Join-Path $Ziel 'ui') -Force
Write-Host '  appswitch.js  bridge.js  ui\*.css  -> Wurzel'

# ---------------------------------------------------------------------
# 4) SubmitOne  ->  one\
# ---------------------------------------------------------------------
$eins = Join-Path $Ziel 'one'
Ordner $eins
$einsDateien = @(
    'index.html', 'app.js', 'styles.css', 'sw.js', 'manifest.webmanifest',
    'appswitch.js', 'bridge.js', 'icon.svg', 'paged.polyfill.js'
)
foreach ($d in $einsDateien) {
    if (Test-Path $d) { Copy-Item $d -Destination $eins -Force }
    else { Write-Host ('  ! fehlt: {0}' -f $d) -ForegroundColor Red }
}
# Der gemeinsame Unterbau landet in one\kern\, NICHT in one\submit\kern\.
# Grund: Der Server liefert jeden Pfad mit dem Ordner «submit» mit 403 aus.
# Geprueft am 13.08.2026 - /one/config.js und /mappe/kern/ gehen, /one/submit/
# nicht. Lokal bleibt es bei submit\kern\; nur das Paket biegt es um.
Ordner (Join-Path $eins 'kern')
Copy-Item 'submit\kern\uebersetzer.js'    -Destination (Join-Path $eins 'kern') -Force
Copy-Item 'submit\kern\ordner.js'         -Destination (Join-Path $eins 'kern') -Force
Copy-Item 'submit\kern\ablage-browser.js' -Destination (Join-Path $eins 'kern') -Force
Copy-Item 'submit\kern\zeitrechnung.js'   -Destination (Join-Path $eins 'kern') -Force
Copy-Item 'submit\kern\wochenraster.js'   -Destination (Join-Path $eins 'kern') -Force

# Die gemeinsamen Design-Tokens. index.html verweist auf ui\tokens.css -
# lokal liegt das neben der Seite, im Paket muss es mit nach one\.
Ordner (Join-Path $eins 'ui')
Copy-Item 'ui\tokens.css'       -Destination (Join-Path $eins 'ui') -Force
Copy-Item 'ui\bausteine.css'    -Destination (Join-Path $eins 'ui') -Force
Copy-Item 'ui\wochenraster.css' -Destination (Join-Path $eins 'ui') -Force

$einsSeite = Join-Path $eins 'index.html'
if (Test-Path $einsSeite) {
    $t = Lies $einsSeite
    $neu = $t -replace 'src="submit/kern/', 'src="kern/'
    if ($neu -ne $t) { Schreibe $einsSeite $neu; Write-Host '  submit/kern -> kern  (Server sperrt Pfade mit «submit»)' -ForegroundColor Green }
}
Write-Host '  Wurzel      -> one\'

# config.js OHNE Supabase - auf dem Server soll niemand ein Konto brauchen.
$serverConfig = @'
/* ============================================================
   SubmitOne - Konfiguration (Server)
   ------------------------------------------------------------
   Leer = lokaler Modus. Kein Konto, keine Anmeldung.
   Wer seine Daten als Dateien halten will, waehlt unter
   Einstellungen > Daten einen Arbeitsordner.

   ERZEUGT VON paket.ps1 - Aenderungen hier werden beim
   naechsten Lauf ueberschrieben.
   ============================================================ */
window.SUBMITONE_CONFIG = {
  SUPABASE_URL: '',
  SUPABASE_ANON_KEY: '',
  STRIPE_LINKS: {},
};
'@
Schreibe (Join-Path $eins 'config.js') $serverConfig
Write-Host '  config.js   -> ohne Supabase erzeugt' -ForegroundColor Green

# ---------------------------------------------------------------------
# 5) SubPaper und Submit PDF
#    Der Ordner heisst lokal write\, auf dem Server paper\ - so wie das
#    Produkt heisst. Die festen Querverweise ../write/ in Submit PDF werden
#    deshalb mit umgeschrieben, sonst zeigen sie ins Leere.
# ---------------------------------------------------------------------
Copy-Item 'write' -Destination (Join-Path $Ziel 'paper') -Recurse -Force
Copy-Item 'pdf'   -Destination $Ziel -Recurse -Force
Get-ChildItem (Join-Path $Ziel 'paper') -Recurse -Include '*.md' -File | Remove-Item -Force
Get-ChildItem (Join-Path $Ziel 'pdf')   -Recurse -Include '*.md' -File | Remove-Item -Force
Remove-Item (Join-Path $Ziel 'paper\test') -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path $Ziel 'pdf\test')   -Recurse -Force -ErrorAction SilentlyContinue
Write-Host '  write\ -> paper\ ,  pdf\  (ohne test\ und *.md)'

# ../write/ auf ../paper/ umbiegen - in beiden Apps, in allen Textdateien.
$umbenannt = 0
foreach ($ordner in @('pdf', 'paper')) {
    Get-ChildItem (Join-Path $Ziel $ordner) -Recurse -File -Include '*.html', '*.js', '*.css' | ForEach-Object {
        $t = Lies $_.FullName
        if ($t -match '\.\./write/') {
            Schreibe $_.FullName ($t -replace '\.\./write/', '../paper/')
            $umbenannt++
        }
    }
}
Write-Host ('  ../write/   -> ../paper/  in {0} Dateien' -f $umbenannt) -ForegroundColor Green

# ---------------------------------------------------------------------
# 6) SubZeit und die Mappe  ->  mappe\
#    kern\ und ui\ bleiben dabei. Seit dem 14.08.2026 traegt submit\ui\ nur
#    noch die Marke und mappe.css: Farben und Bausteine kommen aus ui\ an
#    der Wurzel, und beide Seiten finden sie ueber dieselbe Anzahl Ebenen
#    - lokal submit\index.html -> ..\ui\, im Paket mappe\index.html -> ..\ui\.
# ---------------------------------------------------------------------
$mappe = Join-Path $Ziel 'mappe'
Ordner $mappe
Copy-Item 'submit\index.html' -Destination $mappe -Force
Copy-Item 'submit\manifest.webmanifest' -Destination $mappe -Force
Copy-Item 'submit\kern' -Destination $mappe -Recurse -Force
Copy-Item 'submit\ui'   -Destination $mappe -Recurse -Force
Copy-Item 'submit\zeit' -Destination $mappe -Recurse -Force
Write-Host '  submit\     -> mappe\  (kern + ui + zeit beisammen)'

# ---------------------------------------------------------------------
# 7) Der Umschaltpille die Serverpfade beibringen
#    Lokal liegt SubmitOne an der Wurzel, auf dem Server in one\.
# ---------------------------------------------------------------------
function SoApps($basis) {
    return "<script>window.SO_APPS={basis:'" + $basis + "',one:'one/',paper:'paper/',pdf:'pdf/',zeit:'mappe/zeit/'};</script>"
}

# Je Seite die Tiefe, aus der sie zur Wurzel zurueckfindet.
$seiten = @{
    'one\index.html'        = '../'
    'paper\index.html'      = '../'
    'pdf\index.html'        = '../'
    'mappe\index.html'      = '../'
    'mappe\zeit\index.html' = '../../'
}

$anzahl = 0
foreach ($seite in $seiten.Keys) {
    $pfad = Join-Path $Ziel $seite
    if (-not (Test-Path $pfad)) { Write-Host ('  ! Seite fehlt: {0}' -f $seite) -ForegroundColor Red; continue }
    $text = Lies $pfad
    $zeile = SoApps $seiten[$seite]

    if ($text -match '<script>window\.SO_APPS=[^<]*</script>') {
        # Die Seite bringt schon eine Angabe fuer den lokalen Aufbau mit - ersetzen.
        $neu = [regex]::Replace($text, '<script>window\.SO_APPS=[^<]*</script>', $zeile, 1)
    } else {
        $neu = [regex]::Replace($text, '(?=<script[^>]*src="[^"]*appswitch\.js)', ($zeile + "`r`n  "), 1)
    }

    if ($neu -ne $text) { Schreibe $pfad $neu; $anzahl++ }
    else { Write-Host ('  ! appswitch.js nicht gefunden in {0}' -f $seite) -ForegroundColor Red }
}
Write-Host ('  SO_APPS     -> in {0} von {1} Seiten gesetzt' -f $anzahl, $seiten.Count) -ForegroundColor Green

# ---------------------------------------------------------------------
# 8) Zugangsdaten zurueck
# ---------------------------------------------------------------------
Ordner (Join-Path $Ziel 'api')
if ($configInhalt) {
    [System.IO.File]::WriteAllBytes($configPfad, $configInhalt)
    Write-Host '  api\config.php zurueckgelegt, unveraendert' -ForegroundColor Yellow
} elseif (-not (Test-Path $configPfad)) {
    Write-Host '  ! api\config.php fehlt - vor dem Hochladen ausfuellen (siehe web\EINRICHTEN.md)' -ForegroundColor Red
}

# ---------------------------------------------------------------------
# 8b) Fassungsstempel gegen zwischengespeicherte Dateien
#     ---------------------------------------------------------------
#     Ohne diesen Schritt sieht ein Besucher nach einer Aenderung tagelang
#     die alte Gestaltung: .htaccess erlaubt .css und .js einen Tag Cache,
#     und der Dienstarbeiter haelt sie zusaetzlich fest.
#
#     Der Stempel ist die Pruefsumme des Inhalts, nicht eine Zahl von Hand.
#     Aendert sich nichts, bleibt er gleich - der Cache wird also nur dann
#     verworfen, wenn es wirklich noetig ist.
# ---------------------------------------------------------------------
function Stempel($pfad) {
    if (-not (Test-Path $pfad)) { return $null }
    return (Get-FileHash $pfad -Algorithm MD5).Hash.Substring(0, 8).ToLower()
}

# Bis zum 14.08.2026 stempelte dieser Schritt NUR die Seiten in der Wurzel,
# und auch dort nur drei Dateinamen von Hand. one\index.html blieb bei einem
# handgesetzten "app.js?v=397" stehen - Besucher bekamen nach jedem Upload
# weiter die alte, zwischengespeicherte app.js. Jetzt wird jede Seite in
# jedem Ordner durchgegangen, und jeder Verweis auf eine eigene .js- oder
# .css-Datei bekommt die Pruefsumme genau der Datei, auf die er zeigt.
$gestempelt = 0; $verweise = 0
$muster = '(?<attr>src|href)="(?<pfad>[^"?:#]+\.(?:js|css))(?<alt>\?v=[^"]*)?"'

Get-ChildItem $Ziel -Recurse -File -Include '*.html', '*.php' | ForEach-Object {
    $seite = $_
    $t = Lies $seite.FullName
    $eval = [System.Text.RegularExpressions.MatchEvaluator] {
        param($m)
        $rel = $m.Groups['pfad'].Value
        if ($rel -match '^(https?:)?//') { return $m.Value }          # fremder Server
        $ziel = Join-Path $seite.DirectoryName $rel
        $h = Stempel $ziel
        if (-not $h) { return $m.Value }                              # gibt es nicht: unveraendert
        $script:verweise++
        return ('{0}="{1}?v={2}"' -f $m.Groups['attr'].Value, $rel, $h)
    }
    $neu = [regex]::Replace($t, $muster, $eval)
    if ($neu -ne $t) { Schreibe $seite.FullName $neu; $gestempelt++ }
}

# Jeder Dienstarbeiter bekommt eine Fassung aus den Dateien SEINES Ordners.
#
# Der Name der Konstanten ist nicht ueberall gleich - eine heisst FASSUNG,
# eine andere CACHE. Bis zum 14.08.2026 wurde nur FASSUNG ersetzt; one\sw.js
# blieb deshalb ewig bei 'submitone-v397' stehen und lieferte den alten
# Zwischenspeicher aus, egal was hochgeladen wurde. Jetzt wird beides
# ersetzt, und ein Dienstarbeiter ohne solche Zeile wird gemeldet statt
# stillschweigend uebergangen.
$swOhne = @()
Get-ChildItem $Ziel -Recurse -File -Filter 'sw.js' | ForEach-Object {
    $ordner = $_.DirectoryName
    $teile = @()
    foreach ($n in @('app.js', 'styles.css', 'index.html')) {
        $h = Stempel (Join-Path $ordner $n)
        if ($h) { $teile += $h }
    }
    if (-not $teile.Count) { return }
    $marke = 'submitone-' + ($teile -join '')
    $sw = Lies $_.FullName
    $vorher = $sw
    $sw = $sw -replace "const\s+FASSUNG\s*=\s*'[^']*'", ("const FASSUNG = '" + $marke + "'")
    $sw = $sw -replace "const\s+CACHE\s*=\s*'[^']*'",   ("const CACHE = '" + $marke + "'")
    # Nur melden, wenn der Dienstarbeiter ueberhaupt Dateien vorraetig haelt.
    # pdf\sw.js loescht bewusst alle Caches und laedt immer frisch - der
    # braucht keine Fassung, und eine Warnung waere dort nur Laerm.
    if ($sw -eq $vorher) {
        if ($vorher -match 'addAll\s*\(') { $swOhne += $_.FullName.Substring($Ziel.Length + 1) }
    } else { Schreibe $_.FullName $sw }
}
if ($swOhne.Count) {
    Write-Host ('  ! Dienstarbeiter haelt Dateien vorraetig, hat aber keine Fassungszeile: ' + ($swOhne -join ', ')) -ForegroundColor Yellow
    Write-Host '    Sein Zwischenspeicher erneuert sich nach einem Upload nicht von selbst.' -ForegroundColor Yellow
}

Write-Host ('  Fassung     -> {0} Verweise in {1} Seiten gestempelt' -f $verweise, $gestempelt) -ForegroundColor Green

# ---------------------------------------------------------------------
# 9) Probe: zeigt jeder Verweis auf eine Datei, die es gibt?
#    Ein toter Verweis faellt sonst erst auf dem Server auf, und dort
#    sieht man nur eine weisse Seite.
# ---------------------------------------------------------------------
$tot = @(); $anzVerweise = 0
Get-ChildItem $Ziel -Recurse -Filter *.html -File | ForEach-Object {
    $datei = $_
    $inhalt = Lies $_.FullName
    [regex]::Matches($inhalt, '(?:src|href)="([^"]+)"') | ForEach-Object {
        $u = $_.Groups[1].Value
        if ($u -match '^(https?:|data:|mailto:|tel:|#|//)') { return }
        $rein = ($u -split '[?#]')[0]
        if (-not $rein) { return }
        $anzVerweise++
        if (-not (Test-Path -LiteralPath (Join-Path $datei.DirectoryName $rein))) {
            $tot += ('{0}  ->  {1}' -f $datei.FullName.Replace($Ziel + '\', ''), $u)
        }
    }
}
if ($tot) {
    Write-Host ''
    Write-Host ('  TOTE VERWEISE ({0}):' -f $tot.Count) -ForegroundColor Red
    $tot | Sort-Object -Unique | ForEach-Object { Write-Host ('    ' + $_) -ForegroundColor Red }
    Write-Host '  Das Paket ist unvollstaendig. Bitte beheben, bevor es hochgeht.' -ForegroundColor Red
} else {
    Write-Host ('  Verweise    -> alle {0} Ziele vorhanden' -f $anzVerweise) -ForegroundColor Green
}

# ---------------------------------------------------------------------
# 10) Bericht
# ---------------------------------------------------------------------
$dateien = Get-ChildItem $Ziel -Recurse -File
$mb = [math]::Round(($dateien | Measure-Object Length -Sum).Sum / 1MB, 1)
Write-Host ''
Write-Host ('Fertig: {0} Dateien, {1} MB in  hochladen\' -f $dateien.Count, $mb) -ForegroundColor Cyan
Write-Host ''
Write-Host 'Auf den Server: den INHALT von hochladen\ nach httpdocs kopieren.'
Write-Host 'Danach pruefen:'
Write-Host '  submitone.ch/            Verkaufsseite'
Write-Host '  submitone.ch/one/        SubmitOne'
Write-Host '  submitone.ch/paper/      SubPaper'
Write-Host '  submitone.ch/pdf/        Submit PDF'
Write-Host '  submitone.ch/mappe/zeit/ SubZeit'
Write-Host '  submitone.ch/mappe/      Projektmappe'
Write-Host ''
