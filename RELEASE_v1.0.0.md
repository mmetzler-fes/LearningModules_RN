# LearningModules v1.0.0

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
