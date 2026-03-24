# LearningModules v1.0.0

## Nachtrag (2026-03-23)

### H5P Native Import/Export erweitert

- Neuer Workflow in **Lernthemen verwalten**: **H5P importieren** und **H5P exportieren**
- Import-Filter verbessert: bekannte H5P-Libraries werden als **native Modultypen** übernommen statt pauschal als `h5p_native`
- Unterstützte Native-Mappings beim Import: `MultiChoice`, `TrueFalse`, `Blanks`, `DragQuestion`, `DragText`, `MarkTheWords`, `Essay`
- `DragQuestion`-Import verbessert: Hintergrundbild und Drop-Zonen werden korrekt übernommen
- Export zurück nach H5P erweitert: native Typen werden als echte H5P-Libraries exportiert
- Neue Export-Mappings: `dragAndDrop`, `multipleChoice`, `trueFalse`, `fillInTheBlanks`, `dragTheWords`, `markTheWords`, `accordion`, `flashcards`, `essay`
- Smoke-Test-Skript ergänzt: `scripts/h5p-roundtrip-smoke.js`

### Verlustfreier H5P-Roundtrip (h5pSource-Erhaltung)

- Beim Import wird das **Original-H5P-Paket pro Modul** als `h5pSource` gespeichert (Params, Metadaten, Library-Info, subContentId)
- Beim Export werden native Editor-Felder per **Deep-Merge** in die Originalstruktur zurückgeschrieben – unbekannte H5P-Felder gehen nicht verloren
- Hilfsfunktionen `deepMergeObjects()` und `buildQuestionWithSource()` sichern den vollständigen Roundtrip für alle 8 nativen Typen
- `save-module` behält `h5pSource` beim Bearbeiten eines Moduls erhalten, solange der Typ nicht geändert wird

### Erweiterte Verhaltenfelder im nativen Editor

Neue Felder im Editor für alle Quiz-Typen, die beim Import/Export korrekt übernommen werden:

| Feld | Bedeutung |
|------|-----------|
| `enableRetry` | „Nochmals versuchen"-Schaltfläche |
| `enableSolutionsButton` | „Lösung anzeigen"-Schaltfläche |
| `randomAnswers` | Antworten zufällig sortieren |
| `passPercentage` | Mindestprozentsatz zum Bestehen |
| `showSolutionsRequiresInput` | Lösung erst nach Eingabe einblendbar |
| `instantFeedback` | Sofortiges Feedback bei Auswahl |
| `ignoreScoring` | Modul nicht in Gesamtpunktzahl einrechnen |
| `pointsHost` | Punktevergabe beim Lehrergerät |

### Gruppierter Editor mit „Erweiterte Optionen"

- Felder mit `advanced: true` im Typen-Schema werden in einem **aufklappbaren Abschnitt** „Erweiterte Optionen" am Ende des Editors angezeigt
- Reduziert die sichtbare Formularlänge für typische Anwendungsfälle
- Gilt für alle Quiz-Typen: `multipleChoice`, `trueFalse`, `fillInTheBlanks`, `dragTheWords`, `markTheWords`, `essay`

### Essay als nativer Modultyp

- `H5P.Essay 1.5` vollständig als nativer Typ integriert
- Felder: Aufgabenstellung, Musterlösung, Min. Zeichenanzahl, Eingabefeldgröße
- Import, Export, Vorschau und Quiz-Auswertung vollständig umgesetzt

### Sonstige Verbesserungen

- Import-Modus Abfrage (nativ/roh) entfernt – Import läuft immer im nativen Modus
- Rahmenbedingungen für „Raw"-H5P-Themen (1:1-Paketerhaltung, schreibgeschützte Modulliste, Badge „RAW H5P") als optionale Backend-Grundlage erhalten

**Interaktive Lernmodule für den Unterricht** – eine Desktop-App für Lehrkräfte und Schüler:innen, mit der sich vielfältige Übungsformate erstellen, verwalten und im Klassenzimmer per WLAN verteilen lassen.

---

## Highlights

- **18 interaktive Aufgabentypen** – von Multiple Choice über Drag & Drop bis hin zu Diktat und Flashcards
- **WLAN-Zugriff per QR-Code** – Schüler:innen öffnen die App im Browser, ohne Installation
- **Quiz-Modus mit Auswertung** – automatische Punktevergabe und Ergebnis-Übersicht für die Lehrkraft
- **Komplett offline nutzbar** – alle Daten lokal gespeichert, kein Cloud-Konto nötig
- **Dark Theme & zweisprachig** – Deutsch und Englisch, dunkles oder helles Design

---

## Aufgabentypen

| Kategorie | Typen |
|-----------|-------|
| **Quiz** | Multiple Choice, True/False, Arithmetic Quiz |
| **Sprache** | Fill in the Blanks, Drag the Words, Mark the Words, Dictation |
| **Lernen** | Flashcards, Dialog Cards |
| **Interaktiv** | Drag and Drop, Branching Scenario, Image Hotspots |
| **Darstellung** | Accordion, Course Presentation |
| **Medien** | Video, Collage, Audio Recorder, IFRAME Embedder |

---

## Lehrer-Funktionen

- **Themen & Module verwalten** – Themen anlegen, Module erstellen, bearbeiten und in der Vorschau prüfen
- **Visueller Editor** – für jeden Aufgabentyp ein eigener Editor mit Live-Vorschau
- **Import / Export** – Themen und Module als JSON-Datei austauschen
- **Ergebnis-Übersicht** – alle Quiz-Ergebnisse einsehen, nach Schüler:in filtern, einzeln löschen
- **Module gezielt freigeben** – pro Thema und Modul einzeln auswählbar, was Schüler:innen sehen

## Schüler-Funktionen

- **Themen auswählen** – aus den von der Lehrkraft freigegebenen Themen wählen
- **Quiz starten** – Module der Reihe nach bearbeiten, Fortschrittsbalken, Ergebnis am Ende
- **Browser-Zugang** – QR-Code scannen oder URL eingeben, kein Download nötig

---

## WLAN-Zugriff im Klassenzimmer

Die App startet automatisch einen lokalen Webserver. Schüler:innen können über das WLAN des Lehrer-PCs per Browser auf die Lernmodule zugreifen:

1. Lehrkraft startet die App → QR-Code wird auf der Login-Seite angezeigt
2. Schüler:innen scannen den QR-Code mit dem Handy/Tablet
3. Die App öffnet sich im Browser – ohne Installation
4. Quiz-Ergebnisse werden automatisch an den Lehrer-PC übertragen

---

## Technische Details

| | |
|---|---|
| **Framework** | Electron 41 + Express.js |
| **Datenspeicherung** | Lokale JSON-Datei (kein Datenbankserver nötig) |
| **Sicherheit** | Context Isolation, Content Security Policy |
| **Sprachen** | Deutsch, Englisch (umschaltbar) |
| **Lizenz** | GPL-3.0 |

---

## Downloads

| Plattform | Datei |
|-----------|-------|
| **Linux** | `LearningModules-1.0.0.AppImage` |
| **Windows** | `LearningModules-Setup-1.0.0.exe` |

### Installation

**Linux:** AppImage herunterladen, ausführbar machen (`chmod +x`), starten.  
**Windows:** Setup-Datei ausführen, Installation folgen.

---

*Designed by Martin Metzler, implementation assisted by AI.*
