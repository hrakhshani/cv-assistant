# CV Optimizer (AI Resume Tailor)

AI-powered CV optimizer and resume keyword matcher built with React and Vite. Upload a PDF/TXT resume, paste a job description, and get ATS-friendly edits, keyword gaps, and an overall fit score.

![CV optimizer demo](public/animation.gif)

## Highlights

- **CV optimizer & resume improver** — Tailors resumes to job descriptions using OpenAI (bring your own API key)
- **ATS keyword checker** — Extracts job keywords and shows where they are missing in your CV
- **Grammar, clarity, delivery, and engagement fixes** — Underlines issues directly in the editor with color-coded categories
- **PDF resume parsing** — Attach a PDF or TXT and keep session history for quick iterations
- **Interactive editor** — Accept/dismiss suggestions, reposition keyword insertions, and watch the score update live

## Quick Start

Prerequisites: Node.js 18+, npm or yarn.

```bash
cd cv-assistant
npm install
npm run dev
# open http://localhost:5173
```

### Build & Preview

```bash
npm run build
npm run preview
```

## Usage

1. Paste or upload your CV/resume (PDF or TXT).
2. Paste the target job description.
3. Add your OpenAI API key (required for analysis).
4. Click **Analyze** to get a fit score, ATS keywords, and inline edits.
5. Accept or dismiss suggestions; drag/drop keyword insertions where they make sense.

## Project Structure

```
cv-assistant/
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

## Search Keywords

CV optimizer, resume optimizer, ATS resume checker, resume keyword matcher, AI resume writer, CV keyword extractor, PDF resume parser, OpenAI CV analyzer, job description alignment, resume improvement tool.

## License

Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0). Free for research, academic, and experimental use; commercial use requires prior written consent. See `LICENSE` for details and the full legal code.
