# LearningModules

Interaktive Lernmodule mit H5P — eine Electron Desktop-Applikation.

## Features

- **18 H5P-Modultypen** mit visuellen Editoren und interaktiven Vorschauen
- **Import/Export** von Lerninhalten im JSON-Format
- **Moderne Benutzeroberfläche** mit Sidebar-Navigation, Dashboard und Modulverwaltung
- **Offline-fähig** — alle Daten werden lokal gespeichert

## Unterstützte Lernmodule

| Modul | Kategorie | Beschreibung |
|-------|-----------|--------------|
| Accordion | Darstellung | Aufklappbare Textabschnitte |
| Arithmetic Quiz | Quiz | Mathematik-Quiz mit Rechenaufgaben |
| Audio Recorder | Medien | Audioaufnahmen erstellen |
| Branching Scenario | Interaktiv | Verzweigte Lernszenarien |
| Collage | Medien | Bildcollagen erstellen |
| Course Presentation | Präsentation | Interaktive Folien |
| Dialog Cards | Lernen | Lernkarten mit Vorder-/Rückseite |
| Dictation | Sprache | Diktatübungen |
| Drag and Drop | Interaktiv | Elemente auf Zielzonen ziehen |
| Drag the Words | Sprache | Wörter in Lücken ziehen |
| Fill in the Blanks | Sprache | Lückentext-Aufgaben |
| Flashcards | Lernen | Karteikarten |
| IFRAME Embedder | Medien | Externe Webinhalte einbetten |
| Image Hotspots | Interaktiv | Interaktive Punkte auf Bildern |
| Mark the Words | Sprache | Wörter im Text markieren |
| Multiple Choice | Quiz | Fragen mit Antwortmöglichkeiten |
| True False Question | Quiz | Wahr/Falsch-Fragen |
| Video | Medien | Videos einbetten |

## Installation

```bash
# Repository klonen
git clone https://github.com/mmetzler-fes/LearningModules_RN.git
cd LearningModules_RN

# Abhängigkeiten installieren
npm install

# App starten
npm start
```

## Entwicklung

```bash
# Electron-App im Entwicklungsmodus starten
npm start
```

## Build

```bash
# Linux (AppImage + deb)
npm run build:linux

# Windows (NSIS Installer)
npm run build:win

# macOS (DMG)
npm run build:mac
```

## JSON Import/Export-Format

Module können als JSON-Dateien exportiert und importiert werden:

```json
{
  "exportVersion": "1.0",
  "exportDate": "2026-03-22T12:00:00.000Z",
  "modules": [
    {
      "id": "mod_abc123",
      "title": "Mein Quiz",
      "type": "multipleChoice",
      "description": "Ein Beispiel-Quiz",
      "content": {
        "question": "Was ist 2+2?",
        "answers": [
          { "text": "3", "correct": false },
          { "text": "4", "correct": true },
          { "text": "5", "correct": false }
        ],
        "singleAnswer": true
      },
      "createdAt": "2026-03-22T12:00:00.000Z",
      "updatedAt": "2026-03-22T12:00:00.000Z"
    }
  ]
}
```

## Projektstruktur

```
LearningModules_RN/
├── src/
│   ├── main/
│   │   ├── main.js          # Electron Hauptprozess
│   │   └── preload.js        # Preload-Script (Context Bridge)
│   └── renderer/
│       ├── index.html         # Hauptseite
│       ├── css/
│       │   └── styles.css     # Styling
│       └── js/
│           ├── app.js         # App-Logik
│           ├── h5p-types.js   # H5P-Typdefinitionen
│           └── content-editors.js  # Dynamische Editoren
├── h5p-content/               # H5P-Inhalte
├── assets/                    # Icons und Ressourcen
├── package.json
└── README.md
```

## Technologien

- **Electron** — Desktop-Applikation
- **H5P Standalone** — Interaktive Lernmodule
- **Vanilla JS/CSS** — Kein Framework-Overhead

## Lizenz

MIT
