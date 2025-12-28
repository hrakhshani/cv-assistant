# Writing Assistant

A Grammarly-inspired writing assistant UI built with React and Vite.

## Features

- **Real-time text highlighting** — Suggestions are underlined in the editor with category-specific colors
- **Multiple suggestion types:**
  - Correctness (red) — Grammar and spelling
  - Clarity (blue) — Readability improvements
  - Engagement (green) — Style enhancements
  - Delivery (yellow) — Tone adjustments
  - Keywords (purple) — Missing keyword suggestions
- **Accept/Dismiss actions** — Apply or ignore suggestions
- **Dynamic scoring** — Overall score updates as you address suggestions
- **Repositionable keywords** — Click expanded keyword markers or use "Move" button to reposition

## Getting Started

### Prerequisites

- Node.js 18+ installed
- npm or yarn

### Installation

1. Navigate to the project directory:
   ```bash
   cd writing-assistant-app
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the development server:
   ```bash
   npm run dev
   ```

4. Open your browser and visit `http://localhost:5173`

### Build for Production

```bash
npm run build
```

The built files will be in the `dist` directory.

### Preview Production Build

```bash
npm run preview
```

## Usage

1. **View suggestions** — Hover over underlined text or click suggestion cards in the sidebar
2. **Accept changes** — Click "Accept" or "Insert" to apply a suggestion
3. **Dismiss suggestions** — Click "Dismiss" to ignore a suggestion
4. **Move keywords** — 
   - Hover over a purple + marker to expand it
   - Click the expanded marker to enter repositioning mode
   - Or click "Move" button in the sidebar
   - Click any drop zone to place the keyword

## Project Structure

```
writing-assistant-app/
├── index.html
├── package.json
├── vite.config.js
└── src/
    ├── main.jsx
    ├── index.css
    ├── App.jsx
    └── components/
        └── WritingAssistant.jsx
```

## Customization

### Adding New Suggestions

Edit the `initialSuggestions` array in `WritingAssistant.jsx`:

```javascript
{
  id: 10,
  type: 'keyword', // or 'correctness', 'clarity', 'engagement', 'delivery'
  title: 'Your title',
  description: 'Your description',
  original: '', // empty for insertions
  replacement: 'text to insert ',
  startIndex: 100, // position in text
  endIndex: 100, // same as startIndex for insertions
  isInsertion: true // true for keywords, false for replacements
}
```

### Customizing Colors

Edit the `categoryColors` object to change the color scheme for each category.

## License

MIT
