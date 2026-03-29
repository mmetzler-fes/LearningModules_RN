// Hilfsmodul für Excel/CSV-Parsing
const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');

/**
 * Liest eine Excel- oder CSV-Datei und gibt ein Array von User-Objekten zurück.
 * Erwartete Spalten: login, password, class, role, firstname, lastname, email
 */
function parseUserImportFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  let rows = [];
  if (ext === '.csv') {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split(/\r?\n/).filter(Boolean);
    const header = lines[0].split(',').map(h => h.trim().toLowerCase());
    for (let i = 1; i < lines.length; ++i) {
      const values = lines[i].split(',');
      const row = {};
      header.forEach((h, idx) => row[h] = (values[idx] || '').trim());
      rows.push(row);
    }
  } else {
    const wb = xlsx.readFile(filePath);
    const ws = wb.Sheets[wb.SheetNames[0]];
    rows = xlsx.utils.sheet_to_json(ws, { defval: '' });
  }
  // Normalisiere Keys
  return rows.map(row => ({
    login: row.login || row.username || '',
    password: row.password || '',
    class: row.class || '',
    role: row.role || '',
    firstname: row.firstname || '',
    lastname: row.lastname || '',
    email: row.email || '',
  }));
}

module.exports = { parseUserImportFile };
