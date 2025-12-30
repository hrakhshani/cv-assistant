import React, { useState, useCallback, useRef, useEffect } from 'react';

const OPENAI_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const OPENAI_MODEL = 'gpt-5.2';

const initialText = '';

const initialSuggestions = [];
const initialKeywords = [];
const API_KEY_REQUIRED_MESSAGE = 'Enter your OpenAI API key to enable AI-powered suggestions.';
const API_KEY_STORAGE_KEY = 'writingAssistantApiKey';
const API_KEY_REMEMBER_KEY = 'writingAssistantRememberApiKey';

const makeSessionTitle = (content) => {
  const cleaned = (content || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return 'Untitled note';
  return cleaned.length > 64 ? `${cleaned.slice(0, 64)}…` : cleaned;
};

const formatTimestamp = (iso) => {
  if (!iso) return 'Recent';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return 'Recent';
  return parsed.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

const alignSuggestionsToText = (items, content) =>
  items
    .map((s, idx) => {
      const original = s.original || '';
      if (!original) return null;

      const providedStart = Number.isInteger(s.startIndex) && s.startIndex >= 0 ? s.startIndex : null;
      const providedSpan =
        Number.isInteger(s.startIndex) && Number.isInteger(s.endIndex) && s.endIndex > s.startIndex
          ? s.endIndex - s.startIndex
          : null;

      const matchesAtProvided =
        providedStart !== null &&
        content.slice(providedStart, providedStart + original.length) === original;

      const occurrences = [];
      let searchIndex = 0;
      while (searchIndex <= content.length) {
        const found = content.indexOf(original, searchIndex);
        if (found === -1) break;
        occurrences.push(found);
        searchIndex = found + original.length;
      }

      let start = null;
      if (matchesAtProvided) {
        start = providedStart;
      } else if (occurrences.length > 0) {
        start =
          providedStart === null
            ? occurrences[0]
            : occurrences.reduce((closest, current) =>
                Math.abs(current - providedStart) < Math.abs(closest - providedStart) ? current : closest
              , occurrences[0]);
      }

      if (start === null) return null;

      const spanLength = start === providedStart && providedSpan ? providedSpan : original.length;
      const end = start + spanLength;
      const safeStart = Math.max(0, Math.min(start, content.length));
      const safeEnd = Math.max(safeStart, Math.min(end, content.length));
      if (safeEnd <= safeStart) return null;

      return { ...s, id: s.id ?? `s-${idx}`, startIndex: safeStart, endIndex: safeEnd };
    })
    .filter(Boolean);

    const extractTextFromPdf = async (file) => {
      const data = new Uint8Array(await file.arrayBuffer());
    
      const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf");
      const workerSrc = (await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url"))
        .default;
      pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;
    
      const pdf = await pdfjsLib.getDocument({ data }).promise;
    
      const pageTexts = [];
    
      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
        const page = await pdf.getPage(pageNum);
    
        // Improves mapping to human coordinates (optional but recommended)
        const viewport = page.getViewport({ scale: 1.0 });
    
        const content = await page.getTextContent({
          includeMarkedContent: true,
          disableCombineTextItems: false,
        });
    
        const text = buildTextWithLayout(content.items, viewport);
        if (text.trim()) pageTexts.push(text.trim());
      }
    
      // Keep page boundaries as blank line (tune as you wish)
      return pageTexts.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
    };
    
    // ---- helpers ----
    
    function buildTextWithLayout(items, viewport) {
      // Convert item coordinates to viewport coords and keep useful geometry
      const mapped = items
        .filter((it) => it.str && it.str.trim() !== "")
        .map((it) => {
          const tx = pdfjsLib.Util.transform(
            pdfjsLib.Util.transform(viewport.transform, it.transform),
            [1, 0, 0, 1, 0, 0]
          );
    
          // tx = [a,b,c,d,e,f] where (e,f) is the transformed origin
          const x = tx[4];
          const y = tx[5];
    
          // Approx item width/height in viewport space
          const w = it.width * viewport.scale;
          const h = it.height * viewport.scale;
    
          return {
            str: it.str,
            x,
            y,
            w,
            h,
          };
        });
    
      if (!mapped.length) return "";
    
      // Sort top-to-bottom then left-to-right
      // NOTE: in viewport coords, y typically increases downward.
      mapped.sort((a, b) => (a.y - b.y) || (a.x - b.x));
    
      // Group into lines by y
      const lines = [];
      const yTolerance = 3; // tune: 2–6 depending on PDFs
      let currentLine = [];
      let currentY = mapped[0].y;
    
      for (const it of mapped) {
        if (Math.abs(it.y - currentY) <= yTolerance) {
          currentLine.push(it);
        } else {
          lines.push(currentLine);
          currentLine = [it];
          currentY = it.y;
        }
      }
      if (currentLine.length) lines.push(currentLine);
    
      // For each line, sort by x and stitch fragments with spacing heuristics
      const lineTexts = [];
      let prevLineY = null;
      let prevLineH = null;
    
      for (const line of lines) {
        line.sort((a, b) => a.x - b.x);
    
        // Stitch line fragments
        let out = "";
        let prev = null;
    
        for (const frag of line) {
          if (!prev) {
            out += frag.str;
            prev = frag;
            continue;
          }
    
          const gap = frag.x - (prev.x + prev.w);
    
          // Heuristic: insert a space if there is a visible gap
          // Threshold scaled by text height; tune factor if needed.
          const spaceThreshold = Math.max(2, prev.h * 0.25);
    
          // Also avoid duplicating spaces if frag already starts with one
          if (gap > spaceThreshold && !out.endsWith(" ") && !frag.str.startsWith(" ")) {
            out += " ";
          }
    
          out += frag.str;
          prev = frag;
        }
    
        out = normalizeLine(out);
    
        // Decide newline vs paragraph break
        if (prevLineY == null) {
          lineTexts.push(out);
        } else {
          const dy = line[0].y - prevLineY;
          const typicalLineHeight = Math.max(prevLineH ?? 10, line[0].h);
    
          // If there is a bigger-than-normal vertical gap, treat as paragraph break
          const paragraphGap = typicalLineHeight * 1.4;
    
          if (dy > paragraphGap) lineTexts.push("", out); // blank line between paragraphs
          else lineTexts.push(out);
        }
    
        prevLineY = line[0].y;
        prevLineH = line[0].h;
      }
    
      // Final text
      return lineTexts.join("\n").replace(/[ \t]+\n/g, "\n");
    }
    
    function normalizeLine(s) {
      // Keep indentation? If you want indentation, remove the trimStart().
      // Many PDFs encode indentation as x-position, so trimming usually helps.
      return s
        .replace(/\s+/g, " ")
        .trim();
    }
const categoryColors = {
  correctness: { bg: '#FEE2E2', text: '#DC2626', bar: '#EF4444', light: '#FEF2F2' },
  clarity: { bg: '#DBEAFE', text: '#2563EB', bar: '#3B82F6', light: '#EFF6FF' },
  engagement: { bg: '#D1FAE5', text: '#059669', bar: '#10B981', light: '#ECFDF5' },
  delivery: { bg: '#FEF3C7', text: '#D97706', bar: '#F59E0B', light: '#FFFBEB' },
  keyword: { bg: '#E9D5FF', text: '#7C3AED', bar: '#8B5CF6', light: '#F5F3FF' }
};

const categoryLabels = {
  correctness: 'Correctness',
  clarity: 'Clarity',
  engagement: 'Engagement',
  delivery: 'Delivery',
  keyword: 'Keywords'
};

const asideBaseStyle = {
  backgroundColor: '#FFFFFF',
  color: '#0F172A',
  padding: '20px 22px 24px',
  height: '100%',
  minHeight: 0,
  overflowY: 'auto',
  boxSizing: 'border-box'
};

const buildAnalysisMessages = (content, jobDescription) => [
  {
    role: 'system',
    content:
      'You are a concise writing assistant that returns JSON describing suggestions to improve a CV or resume so it aligns with a job description. Keep outputs short and actionable and only reference positions from the CV text.'
  },
  {
    role: 'user',
    content: `Use the job description to tailor the candidate CV. Respond with a JSON object containing:
- "score": integer from 0-100 (higher is better).
- "suggestions":  Each item must have id, type ("correctness", "clarity", "engagement", or "delivery"), title, description, original (exact text span from the CV), replacement (improved version), startIndex, endIndex (character offsets in the CV text, endIndex exclusive). Prioritize suggestions that make the CV better match the job description.

Job description (context only, do NOT index against this text):
"""${jobDescription || 'Not provided'}"""

Candidate CV/resume text (use this for indexing):
"""${content}"""`
  }
];

const buildKeywordMessages = (jobDescription) => [
  {
    role: 'system',
    content:
      'You extract concise keyword lists from job descriptions to help candidates tailor their CVs. Respond only with JSON.'
  },
  {
    role: 'user',
    content: `Given the following job description, which keywords can increase my chance during the interview? Return only a JSON object with a single key "keywords" that contains an array of the most important single words or short phrases (no explanations, no extra keys).

Job description:
"""${jobDescription}"""`
  }
];

const parseKeywordsFromContent = (rawContent) => {
  if (!rawContent) return [];
  const trimmed = rawContent.trim();

  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed?.keywords)) return parsed.keywords;
  } catch (err) {
    // Fall through to newline parsing
  }

  return trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
};

async function requestKeywordsFromOpenAI(jobDescription, apiKey, signal) {
  if (!jobDescription?.trim()) return [];

  const response = await fetch(OPENAI_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: buildKeywordMessages(jobDescription),
      max_completion_tokens: 800,
      response_format: { type: 'json_object' },
      temperature: 0.2
    }),
    signal
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.error?.message || 'Unable to extract keywords with OpenAI.';
    throw new Error(message);
  }

  const rawContent = payload?.choices?.[0]?.message?.content;
  if (!rawContent) {
    throw new Error('OpenAI returned an empty keyword response.');
  }

  const parsedKeywords = parseKeywordsFromContent(rawContent)
    .map((kw) => (typeof kw === 'string' ? kw.trim() : ''))
    .filter(Boolean);

  if (parsedKeywords.length === 0) {
    throw new Error('OpenAI did not return any keywords.');
  }

  return parsedKeywords;
}

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const keywordExistsInText = (content, keyword) => {
  if (!keyword || !content) return false;
  const safeKeyword = escapeRegExp(keyword).replace(/\s+/g, '\\s+');
  const regex = new RegExp(`\\b${safeKeyword}\\b`, 'i');
  return regex.test(content);
};

const findMissingKeywords = (keywords, content) => {
  const seen = new Set();
  const missing = [];

  keywords.forEach((kw, idx) => {
    const normalized = (kw || '').trim();
    if (!normalized) return;

    const key = normalized.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);

    if (!keywordExistsInText(content, normalized)) {
      missing.push({
        id: `kw-${idx}`,
        keyword: normalized,
        description: 'Mention this to align with the job description.'
      });
    }
  });

  return missing;
};

async function requestAnalysisFromOpenAI(content, jobDescription, apiKey, signal) {
  const response = await fetch(OPENAI_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: buildAnalysisMessages(content, jobDescription),
      max_completion_tokens: 4000,
      response_format: { type: 'json_object' },
      temperature: 0.2
    }),
    signal
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.error?.message || 'Unable to analyze with OpenAI.';
    throw new Error(message);
  }

  const rawContent = payload?.choices?.[0]?.message?.content;
  if (!rawContent) {
    throw new Error('OpenAI returned an empty response.');
  }

  try {
    return JSON.parse(rawContent);
  } catch (err) {
    throw new Error('OpenAI returned a non-JSON response.');
  }
}

export default function WritingAssistant() {
  const [text, setText] = useState(initialText);
  const [suggestions, setSuggestions] = useState(initialSuggestions);
  const [keywords, setKeywords] = useState(initialKeywords);
  const [hoveredSuggestion, setHoveredSuggestion] = useState(null);
  const [selectedSuggestion, setSelectedSuggestion] = useState(null);
  const [aiScore, setAiScore] = useState(null);
  const [hasAnalyzed, setHasAnalyzed] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState(null);
  const [apiKey, setApiKey] = useState('');
  const [rememberApiKey, setRememberApiKey] = useState(false);
  const [hasHydratedApiKey, setHasHydratedApiKey] = useState(false);
  const [jobDescription, setJobDescription] = useState('');
  const [cvAttachmentName, setCvAttachmentName] = useState(null);
  const [attachmentError, setAttachmentError] = useState(null);
  const [isParsingAttachment, setIsParsingAttachment] = useState(false);
  const [sessions, setSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [showAnalysis, setShowAnalysis] = useState(false);
  
  // Mouse-based drag state
  const [draggingKeyword, setDraggingKeyword] = useState(null);
  const [cursorPos, setCursorPos] = useState({ x: 0, y: 0 });
  const [insertionIndex, setInsertionIndex] = useState(null);
  
  const editorRef = useRef(null);
  const previewScrollRef = useRef(null);
  const suggestionRefs = useRef({});
  const requestIdRef = useRef(0);
  const abortControllerRef = useRef(null);
  const fileInputRef = useRef(null);
  const apiKeyInputRef = useRef(null);

  const resetFeedbackState = useCallback(() => {
    setSuggestions([]);
    setKeywords([]);
    setAiScore(null);
    setHasAnalyzed(false);
    setHoveredSuggestion(null);
    setSelectedSuggestion(null);
    setAnalysisError(null);
  }, []);

  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  const totalIssues = suggestions.length + keywords.length;
  const displayedScore = aiScore;
  const scoreLabel = isAnalyzing
    ? 'Analyzing…'
    : displayedScore !== null
      ? `${displayedScore} Overall score`
      : 'Awaiting analysis';
  const scoreBackground = isAnalyzing
    ? '#E7E5E4'
    : displayedScore !== null
      ? displayedScore >= 80 ? '#D1FAE5' : '#FEF3C7'
      : '#F5F5F4';
  const scoreColor = isAnalyzing
    ? '#78716C'
    : displayedScore !== null
      ? displayedScore >= 80 ? '#059669' : '#D97706'
      : '#A8A29E';

  const categoryCounts = {
    correctness: suggestions.filter(s => s.type === 'correctness').length,
    clarity: suggestions.filter(s => s.type === 'clarity').length,
    engagement: suggestions.filter(s => s.type === 'engagement').length,
    delivery: suggestions.filter(s => s.type === 'delivery').length,
    keyword: keywords.length
  };

  const runAnalysis = useCallback(async (content, jobDesc) => {
    const trimmed = content.trim();
    if (!trimmed) {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      resetFeedbackState();
      setIsAnalyzing(false);
      return;
    }

    const trimmedApiKey = apiKey.trim();
    if (!trimmedApiKey) {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      setAnalysisError(API_KEY_REQUIRED_MESSAGE);
      setIsAnalyzing(false);
      setAiScore(null);
      setHasAnalyzed(false);
      return;
    }

    const requestId = ++requestIdRef.current;
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsAnalyzing(true);
    setAnalysisError(null);

    try {
      const extractedKeywords = await requestKeywordsFromOpenAI(jobDesc, trimmedApiKey, controller.signal);
      const missingKeywords = findMissingKeywords(extractedKeywords, content);
      const result = await requestAnalysisFromOpenAI(content, jobDesc, trimmedApiKey, controller.signal);
      if (requestIdRef.current !== requestId) return;

      const incomingSuggestions = Array.isArray(result?.suggestions) ? result.suggestions : [];
      const incomingKeywords = Array.isArray(missingKeywords) ? missingKeywords : [];
      const normalizedSuggestions = alignSuggestionsToText(incomingSuggestions, content);
      const normalizedKeywords = incomingKeywords
        .map((kw, idx) => ({
          id: kw.id ?? `kw-${idx}`,
          keyword: (kw.keyword || '').trim(),
          description: kw.description || 'Suggested keyword to add'
        }))
        .filter(k => k.keyword);

      const scoreValue = Number.isFinite(result?.score) ? Math.max(0, Math.min(100, Math.round(result.score))) : null;

      setSuggestions(normalizedSuggestions);
      setKeywords(normalizedKeywords);
      setAiScore(scoreValue);
      setHasAnalyzed(true);
      setHoveredSuggestion(null);
      setSelectedSuggestion(null);

      const sessionId = activeSessionId || `session-${Date.now()}`;
      const sessionTitle = makeSessionTitle(content);
      const updatedAt = new Date().toISOString();

      setSessions(prev => {
        const filtered = prev.filter(s => s.id !== sessionId);
        const next = [
          {
            id: sessionId,
            title: sessionTitle,
            text: content,
            jobDescription: jobDesc,
            suggestions: normalizedSuggestions,
            keywords: normalizedKeywords,
            score: scoreValue,
            updatedAt
          },
          ...filtered
        ];
        return next.slice(0, 12);
      });
      setActiveSessionId(sessionId);
    } catch (err) {
      if (err.name === 'AbortError') return;
      setAnalysisError(err.message || 'Unable to analyze text right now.');
    } finally {
      if (requestIdRef.current === requestId) {
        setIsAnalyzing(false);
        abortControllerRef.current = null;
      }
    }
  }, [resetFeedbackState, activeSessionId, apiKey]);

  useEffect(() => () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  }, []);
  
  useEffect(() => {
    try {
      const storedRemember = localStorage.getItem(API_KEY_REMEMBER_KEY);
      const shouldRemember = storedRemember === 'true';
      setRememberApiKey(shouldRemember);
      if (shouldRemember) {
        const storedKey = localStorage.getItem(API_KEY_STORAGE_KEY);
        if (storedKey) {
          setApiKey(storedKey);
        }
      }
    } catch (err) {
      // Ignore storage issues (private mode, etc.)
    }
    setHasHydratedApiKey(true);
  }, []);

  useEffect(() => {
    if (!hasHydratedApiKey) return;
    try {
      const trimmed = apiKey.trim();
      if (rememberApiKey && trimmed) {
        localStorage.setItem(API_KEY_STORAGE_KEY, trimmed);
        localStorage.setItem(API_KEY_REMEMBER_KEY, 'true');
      } else {
        localStorage.removeItem(API_KEY_STORAGE_KEY);
        localStorage.setItem(API_KEY_REMEMBER_KEY, rememberApiKey ? 'true' : 'false');
      }
    } catch (err) {
      // Ignore storage issues (private mode, etc.)
    }
  }, [rememberApiKey, apiKey, hasHydratedApiKey]);

  const handleTextChange = useCallback((eOrValue) => {
    const newValue = typeof eOrValue === 'string' ? eOrValue : eOrValue?.target?.value ?? '';

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    setIsAnalyzing(false);
    resetFeedbackState();
    setText(newValue);
    setActiveSessionId(null);
  }, [resetFeedbackState]);

  const handleJobDescriptionChange = useCallback((eOrValue) => {
    const newValue = typeof eOrValue === 'string' ? eOrValue : eOrValue?.target?.value ?? '';

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    setIsAnalyzing(false);
    resetFeedbackState();
    setJobDescription(newValue);
    setActiveSessionId(null);
  }, [resetFeedbackState]);

  const handleFileChange = useCallback(async (event) => {
    const file = event.target?.files?.[0];
    if (!file) return;

    setAttachmentError(null);
    setIsParsingAttachment(true);
    setAnalysisError(null);

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    try {
      let parsedText = '';
      const fileName = file.name || 'CV';
      const lowerName = fileName.toLowerCase();

      if (file.type === 'text/plain' || lowerName.endsWith('.txt')) {
        parsedText = (await file.text()).trim();
      } else if (file.type === 'application/pdf' || lowerName.endsWith('.pdf')) {
        parsedText = await extractTextFromPdf(file);
      } else {
        throw new Error('Please attach a PDF or plain text (.txt) CV.');
      }

      if (!parsedText) {
        throw new Error('No readable text found in the selected file.');
      }

      handleTextChange(parsedText);
      setCvAttachmentName(fileName);
    } catch (err) {
      setCvAttachmentName(null);
      setAttachmentError(err.message || 'Unable to read the attachment.');
    } finally {
      setIsParsingAttachment(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  }, [handleTextChange]);

  const handleAnalyzeNow = useCallback(() => {
    if (isParsingAttachment) {
      setAnalysisError('Please wait while we finish reading your attached CV.');
      return;
    }

    const trimmedKey = apiKey.trim();
    if (!trimmedKey) {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      setShowAnalysis(false);
      setIsAnalyzing(false);
      setHasAnalyzed(false);
      setAiScore(null);
      setAnalysisError(API_KEY_REQUIRED_MESSAGE);
      if (apiKeyInputRef.current) {
        apiKeyInputRef.current.focus();
      }
      return;
    }

    const trimmed = text.trim();
    if (!trimmed) {
      setShowAnalysis(false);
      runAnalysis(text, jobDescription);
      return;
    }
    setShowAnalysis(true);
    runAnalysis(text, jobDescription);
  }, [apiKey, isParsingAttachment, runAnalysis, text, jobDescription]);

  const handleSelectSession = useCallback((sessionId) => {
    const session = sessions.find(s => s.id === sessionId);
    if (!session) return;

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    setShowAnalysis(true);
    setActiveSessionId(sessionId);
    setText(session.text || '');
    setJobDescription(session.jobDescription || '');
    setSuggestions(session.suggestions || []);
    setKeywords(session.keywords || []);
    setAiScore(Number.isFinite(session.score) ? session.score : null);
    setHasAnalyzed(true);
    setIsAnalyzing(false);
    setAnalysisError(null);
    setAttachmentError(null);
    setHoveredSuggestion(null);
    setSelectedSuggestion(null);
  }, [sessions]);

  const handleStartNewSession = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    setText('');
    setJobDescription('');
    setCvAttachmentName(null);
    setAttachmentError(null);
    setIsParsingAttachment(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    resetFeedbackState();
    setIsAnalyzing(false);
    setAnalysisError(null);
    setActiveSessionId(null);
    setShowAnalysis(false);
  }, [resetFeedbackState]);

  // Find nearest text position to cursor
  const findNearestPosition = useCallback((clientX, clientY) => {
    if (!editorRef.current) return null;
    
    const editorRect = editorRef.current.getBoundingClientRect();
    
    if (clientX < editorRect.left - 50 || clientX > editorRect.right + 50 ||
        clientY < editorRect.top - 20 || clientY > editorRect.bottom + 20) {
      return null;
    }

    let nearestIndex = 0;
    let minDistance = Infinity;

    const walker = document.createTreeWalker(
      editorRef.current,
      NodeFilter.SHOW_TEXT,
      null,
      false
    );

    let node;
    let currentIndex = 0;

    while ((node = walker.nextNode())) {
      const range = document.createRange();
      
      for (let i = 0; i <= node.textContent.length; i++) {
        range.setStart(node, i);
        range.setEnd(node, i);
        
        const rect = range.getBoundingClientRect();
        const distance = Math.sqrt(
          Math.pow(clientX - rect.left, 2) + 
          Math.pow(clientY - rect.top, 2)
        );
        
        if (distance < minDistance) {
          minDistance = distance;
          nearestIndex = currentIndex + i;
        }
      }
      currentIndex += node.textContent.length;
    }

    return minDistance < 100 ? nearestIndex : null;
  }, []);

  // Mouse move handler for dragging
  useEffect(() => {
    if (!draggingKeyword) return;

    const handleMouseMove = (e) => {
      setCursorPos({ x: e.clientX, y: e.clientY });
      const pos = findNearestPosition(e.clientX, e.clientY);
      setInsertionIndex(pos);
    };

    const handleMouseUp = () => {
      if (draggingKeyword && insertionIndex !== null) {
        // Insert the keyword
        let insertText = draggingKeyword.keyword;
        const charBefore = text[insertionIndex - 1];
        const charAfter = text[insertionIndex];
        
        if (charBefore && charBefore !== ' ' && charBefore !== '\n') {
          insertText = ' ' + insertText;
        }
        if (charAfter && charAfter !== ' ' && charAfter !== '\n') {
          insertText = insertText + ' ';
        }
        
        const newText = text.slice(0, insertionIndex) + insertText + text.slice(insertionIndex);
        setText(newText);
        
        setKeywords(prev => prev.filter(k => k.id !== draggingKeyword.id));
        
        const lengthAdded = insertText.length;
        setSuggestions(prev => prev.map(s => {
          if (s.startIndex >= insertionIndex) {
            return { ...s, startIndex: s.startIndex + lengthAdded, endIndex: s.endIndex + lengthAdded };
          }
          return s;
        }));
      }
      
      setDraggingKeyword(null);
      setInsertionIndex(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [draggingKeyword, insertionIndex, text, findNearestPosition]);

  // Start dragging
  const handleMouseDown = useCallback((e, keyword) => {
    e.preventDefault();
    setCursorPos({ x: e.clientX, y: e.clientY });
    setDraggingKeyword(keyword);
  }, []);

  const acceptSuggestion = useCallback((suggestion) => {
    const newText = text.slice(0, suggestion.startIndex) + suggestion.replacement + text.slice(suggestion.endIndex);
    const lengthDiff = suggestion.replacement.length - (suggestion.endIndex - suggestion.startIndex);
    
    setText(newText);
    setSuggestions(prev => prev
      .filter(s => s.id !== suggestion.id)
      .map(s => s.startIndex > suggestion.startIndex 
        ? { ...s, startIndex: s.startIndex + lengthDiff, endIndex: s.endIndex + lengthDiff }
        : s
      )
    );
    setSelectedSuggestion(null);
  }, [text]);

  const dismissSuggestion = useCallback((id) => {
    setSuggestions(prev => prev.filter(s => s.id !== id));
  }, []);

  const dismissKeyword = useCallback((id) => {
    setKeywords(prev => prev.filter(k => k.id !== id));
  }, []);

  const scrollToSuggestion = useCallback((suggestionId) => {
    if (!suggestionId) return;
    const target = suggestionRefs.current[suggestionId];
    if (!target) return;

    const container = previewScrollRef.current;
    if (!container) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
      return;
    }

    const targetRect = target.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const offsetWithinContainer = targetRect.top - containerRect.top + container.scrollTop;
    const desiredScrollTop = offsetWithinContainer - container.clientHeight / 2 + targetRect.height / 2;

    container.scrollTo({
      top: Math.max(0, desiredScrollTop),
      behavior: 'smooth'
    });
  }, []);

  useEffect(() => {
    if (!selectedSuggestion) return;
    scrollToSuggestion(selectedSuggestion);
  }, [selectedSuggestion, scrollToSuggestion]);

  // Render text with highlights and insertion caret
  const renderText = () => {
    if (!text.trim()) {
      return (
        <span style={{ color: '#A8A29E' }}>
          Start typing in the editor above to see your formatted text here.
        </span>
      );
    }

    const parts = [];
    const sorted = [...suggestions].sort((a, b) => a.startIndex - b.startIndex);
    let lastIndex = 0;

    const positions = [];
    sorted.forEach(s => {
      positions.push({ type: 'start', index: s.startIndex, suggestion: s });
      positions.push({ type: 'end', index: s.endIndex, suggestion: s });
    });
    
    if (draggingKeyword && insertionIndex !== null) {
      positions.push({ type: 'caret', index: insertionIndex });
    }
    
    positions.sort((a, b) => a.index - b.index || (a.type === 'caret' ? -1 : 1));

    let inHighlight = null;

    positions.forEach((pos, i) => {
      if (pos.index > lastIndex && !inHighlight) {
        parts.push(<span key={`t-${i}`}>{text.slice(lastIndex, pos.index)}</span>);
        lastIndex = pos.index;
      }

      if (pos.type === 'caret' && !inHighlight) {
        parts.push(
          <span
            key="caret"
            style={{
              display: 'inline-block',
              width: '3px',
              height: '1.2em',
              backgroundColor: categoryColors.keyword.bar,
              borderRadius: '2px',
              margin: '0 1px',
              verticalAlign: 'text-bottom',
              animation: 'pulse 0.8s ease-in-out infinite',
              boxShadow: `0 0 8px ${categoryColors.keyword.bar}`
            }}
          />
        );
      }

      if (pos.type === 'start') {
        inHighlight = pos.suggestion;
        if (pos.index > lastIndex) {
          parts.push(<span key={`tb-${i}`}>{text.slice(lastIndex, pos.index)}</span>);
        }
      }

      if (pos.type === 'end' && inHighlight) {
        const s = inHighlight;
        const isActive = hoveredSuggestion === s.id || selectedSuggestion === s.id;
        const colors = categoryColors[s.type];

        parts.push(
          <span
            key={`hl-${s.id}`}
            ref={(node) => {
              if (node) {
                suggestionRefs.current[s.id] = node;
              } else {
                delete suggestionRefs.current[s.id];
              }
            }}
            onClick={() => {
              setSelectedSuggestion(s.id);
              scrollToSuggestion(s.id);
            }}
            onMouseEnter={() => setHoveredSuggestion(s.id)}
            onMouseLeave={() => setHoveredSuggestion(null)}
            style={{
              backgroundColor: isActive ? colors.bg : 'transparent',
              borderBottom: `2px solid ${colors.bar}`,
              cursor: 'pointer',
              padding: isActive ? '1px 3px' : '0',
              borderRadius: isActive ? '3px' : '0',
              transition: 'all 0.15s ease'
            }}
          >
            {text.slice(s.startIndex, s.endIndex)}
          </span>
        );
        lastIndex = pos.index;
        inHighlight = null;
      }
    });

    if (lastIndex < text.length) {
      parts.push(<span key="end">{text.slice(lastIndex)}</span>);
    }

    return parts;
  };

  const sharedHead = (
    <>
      <link
        href="https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,400;8..60,500;8..60,600&family=DM+Sans:wght@400;500;600;700&display=swap"
        rel="stylesheet"
      />
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }

        @keyframes indeterminate {
          0% { transform: translateX(-120%); }
          50% { transform: translateX(-35%); }
          100% { transform: translateX(120%); }
        }

        .hide-scrollbar {
          scrollbar-width: none;
          -ms-overflow-style: none;
        }

        .hide-scrollbar::-webkit-scrollbar {
          display: none;
        }

        .composer-shell {
          border: 1px solid #E7E5E4;
          box-shadow: 0 18px 40px rgba(15,23,42,0.12);
          transition: box-shadow 0.18s ease, border-color 0.18s ease, transform 0.18s ease;
        }

        .composer-shell:focus-within {
          border-color: #C7D2FE;
          box-shadow: 0 20px 44px rgba(42,87,222,0.18);
          transform: translateY(-1px);
        }

        .composer-textarea {
          border: none;
          outline: none;
          resize: none;
          width: 100%;
          background: transparent;
          font-family: "'DM Sans', sans-serif";
          font-size: 15px;
          line-height: 1.6;
          color: #111827;
          padding: 0;
        }

        .composer-textarea::placeholder {
          color: #9CA3AF;
        }

        .composer-btn-ghost {
          width: 34px;
          height: 34px;
          border-radius: 10px;
          border: 1px solid #E7E5E4;
          background: #F9FAFB;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.16s ease;
        }

        .composer-btn-ghost:hover {
          background: #EEF2FF;
          border-color: #C7D2FE;
        }

        .composer-send-btn {
          width: 42px;
          height: 42px;
          border-radius: 50%;
          border: none;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          color: #FFFFFF;
          background: linear-gradient(135deg,rgb(26, 142, 26) 0%,rgb(25, 169, 53) 100%);
          box-shadow: 0 16px 34px rgba(133, 241, 131, 0.28);
          cursor: pointer;  
          transition: transform 0.14s ease, box-shadow 0.16s ease, opacity 0.16s ease;
        }

        .composer-send-btn:disabled {
          opacity: 0.55;
          cursor: not-allowed;
          box-shadow: none;
        }

        .composer-send-btn:not(:disabled):hover {
          transform: translateY(-1px);
          box-shadow: 0 20px 42px rgba(69, 217, 36, 0.34);
        }
      `}</style>
    </>
  );

  if (!showAnalysis) {
    const hasText = text.trim().length > 0;

    return (
      <div style={{
        minHeight: '100vh',
        backgroundColor: '#F4F4F5',
        fontFamily: "'Source Serif 4', Georgia, serif",
        cursor: draggingKeyword ? 'none' : 'default',
        userSelect: draggingKeyword ? 'none' : 'auto'
      }}>
        {sharedHead}

        <div style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '56px 20px 80px'
        }}>
          <div style={{
            maxWidth: '980px',
            margin: '0 auto',
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            gap: '22px'
          }}>
            <div style={{ textAlign: 'center', color: '#0F172A' }}>
              <div style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                padding: '10px 18px',
                backgroundColor: '#FFFFFF',
                borderRadius: '999px',
                border: '1px solid #E7E5E4',
                boxShadow: '0 10px 30px rgba(15,23,42,0.08)'
              }}>
                <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '15px', fontWeight: 700 }}>
                  Where should we begin?
                </span>
              </div>
              <p style={{
                marginTop: '10px',
                fontFamily: "'DM Sans', sans-serif",
                fontSize: '14px',
                color: '#6B7280'
              }}>
                Paste your note or question and we will polish it with AI-powered suggestions.
              </p>
            </div>

            {analysisError && (
              <div style={{
                marginBottom: '4px',
                padding: '10px 14px',
                backgroundColor: '#FEF2F2',
                border: '1px solid #FECACA',
                color: '#991B1B',
                borderRadius: '8px',
                fontFamily: "'DM Sans', sans-serif",
                fontSize: '13px'
              }}>
                {analysisError}
              </div>
            )}

            <div style={{ padding: '0 6px' }}>
              <div
                className="composer-shell"
                style={{
                  backgroundColor: '#FFFFFF',
                  borderRadius: '28px',
                  padding: '16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px'
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '12px', fontWeight: 700, color: '#475569' }}>
                      OpenAI API key
                    </label>
                    <input
                      ref={apiKeyInputRef}
                      type="password"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder="sk-..."
                      autoComplete="off"
                      spellCheck={false}
                      style={{
                        border: '1px solid #E7E5E4',
                        borderRadius: '12px',
                        padding: '12px',
                        background: '#F9FAFB',
                        fontFamily: "'DM Sans', sans-serif",
                        fontSize: '13px',
                        color: '#0F172A'
                      }}
                    />
                    <span style={{
                      fontFamily: "'DM Sans', sans-serif",
                      fontSize: '11px',
                      color: '#6B7280'
                    }}>
                      Stored for this session. Enable "Remember on this browser" to keep it locally.
                    </span>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontFamily: "'DM Sans', sans-serif", fontSize: '12px', color: '#475569', marginTop: '4px' }}>
                      <input
                        type="checkbox"
                        checked={rememberApiKey}
                        onChange={(e) => setRememberApiKey(e.target.checked)}
                        style={{ width: '14px', height: '14px' }}
                      />
                      Remember on this browser (stored locally)
                    </label>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '12px', fontWeight: 700, color: '#475569' }}>
                      Job description / target role
                    </label>
                    <textarea
                      value={jobDescription}
                      onChange={handleJobDescriptionChange}
                      placeholder="Paste the job description you want to match against."
                      rows={3}
                      className="composer-textarea hide-scrollbar"
                      style={{
                        minHeight: '250px',
                        overflowY: 'auto',
                        border: '1px solid #E7E5E4',
                        borderRadius: '12px',
                        padding: '12px',
                        background: '#F9FAFB',
                        fontFamily: "'DM Sans', sans-serif",
                        fontSize: '12px'
                      }}
                    />
                  </div>

                  <textarea
                      className="composer-textarea hide-scrollbar"
                      value={text}
                      onChange={handleTextChange}
                      placeholder="Attach a CV or paste your resume content here..."
                      rows={4}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                          e.preventDefault();
                          if (!hasText) return;
                          handleAnalyzeNow();
                        }
                      }}
                      style={{
                        minHeight: '250px',
                        overflowY: 'auto',
                        border: '1px solid #E7E5E4',
                        borderRadius: '12px',
                        padding: '12px',
                        background: '#F9FAFB',
                        fontFamily: "'DM Sans', sans-serif",
                        fontSize: '12px'
                      }}
                    />
                
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'auto 1fr auto',
                    gap: '12px',
                    alignItems: 'stretch'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px', paddingLeft: '4px' }}>
                    <button
                      type="button"
                      className="composer-btn-ghost"
                      onClick={() => fileInputRef.current?.click()}
                      aria-label="Attach a CV (PDF or text)"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0F172A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21.44 11.05 12.5 20a5 5 0 0 1-7.07-7.07l9.55-9.55a3.5 3.5 0 1 1 4.95 4.95l-9.2 9.2a2 2 0 0 1-2.83-2.83L14 7.5" />
                      </svg>
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".pdf,application/pdf,text/plain,.txt"
                      style={{ display: 'none' }}
                      onChange={handleFileChange}
                    />
                  </div>


                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingRight: '4px' }}>

                    <button
                      type="button"
                      className="composer-send-btn"
                      onClick={handleAnalyzeNow}
                      disabled={!hasText || isAnalyzing || isParsingAttachment}
                      aria-label="Analyze text"
                      style={{ marginLeft: 'auto' }}
                    >
                      <svg className="w-6 h-6 text-gray-800 dark:text-white" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" viewBox="0 0 24 24">
                        <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="m9 5 7 7-7 7"/>
                      </svg>
                    </button>
                  </div>
                </div>

                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '10px',
                  flexWrap: 'wrap',
                  padding: '0 4px'
                }}>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    fontFamily: "'DM Sans', sans-serif",
                    fontSize: '12px',
                    color: attachmentError ? '#991B1B' : '#57534E'
                  }}>
                    <span>
                      {isParsingAttachment
                        ? 'Reading attachment…'
                        : cvAttachmentName
                          ? `Attached: ${cvAttachmentName}`
                          : 'Attach a PDF or TXT CV to auto-fill the editor.'}
                    </span>
                    {cvAttachmentName && !isParsingAttachment && (
                      <button
                        type="button"
                        onClick={() => {
                          setCvAttachmentName(null);
                          setAttachmentError(null);
                        }}
                        style={{
                          fontFamily: "'DM Sans', sans-serif",
                          fontSize: '12px',
                          color: '#0F172A',
                          background: '#F1F5F9',
                          border: '1px solid #E2E8F0',
                          borderRadius: '8px',
                          padding: '6px 10px',
                          cursor: 'pointer'
                        }}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  {attachmentError && (
                    <span style={{
                      fontFamily: "'DM Sans', sans-serif",
                      fontSize: '12px',
                      color: '#991B1B'
                    }}>
                      {attachmentError}
                    </span>
                  )}
                </div>
              </div>

              <div style={{
                marginTop: '10px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '12px',
                flexWrap: 'wrap'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                  <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '13px', color: '#6B7280' }}>
                    Editing clears previous AI suggestions. Press Ctrl/Cmd + Enter to analyze quickly.
                  </span>
                  {isAnalyzing && (
                    <span style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      fontFamily: "'DM Sans', sans-serif",
                      fontSize: '12px',
                      color: '#0F172A',
                      backgroundColor: '#EEF2FF',
                      padding: '6px 10px',
                      borderRadius: '10px'
                    }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0F172A" strokeWidth="1.5">
                        <circle cx="12" cy="12" r="9" />
                        <path d="M12 7v5l3 2" />
                      </svg>
                      Working…
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    onClick={() => {
                      handleTextChange('');
                      setCvAttachmentName(null);
                      setAttachmentError(null);
                      if (fileInputRef.current) {
                        fileInputRef.current.value = '';
                      }
                    }}
                    style={{
                      fontFamily: "'DM Sans', sans-serif",
                      fontSize: '13px',
                      fontWeight: 700,
                      padding: '10px 14px',
                      backgroundColor: '#FFFFFF',
                      color: '#57534E',
                      border: '1px solid #E7E5E4',
                      borderRadius: '10px',
                      cursor: 'pointer',
                      minWidth: '90px',
                      boxShadow: '0 6px 16px rgba(15,23,42,0.08)'
                    }}
                  >
                    Clear
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      height: '100vh',
      backgroundColor: '#FAFAF9',
      fontFamily: "'Source Serif 4', Georgia, serif",
      cursor: draggingKeyword ? 'none' : 'default',
      userSelect: draggingKeyword ? 'none' : 'auto',
      overflow: 'hidden'
    }}>
      {sharedHead}

      {draggingKeyword && (
        <div
          style={{
            position: 'fixed',
            left: cursorPos.x,
            top: cursorPos.y,
            pointerEvents: 'none',
            zIndex: 10000,
            transform: 'translate(8px, 8px)'
          }}
        >
          <div style={{
            width: '36px',
            height: '36px',
            borderRadius: '50%',
            backgroundColor: categoryColors.keyword.bar,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 4px 14px rgba(139, 92, 246, 0.5)',
            border: '3px solid #FFFFFF'
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2.5" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19"/>
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
          </div>
          
          <div style={{
            marginTop: '6px',
            padding: '6px 12px',
            backgroundColor: '#FFFFFF',
            borderRadius: '6px',
            fontFamily: "'DM Sans', sans-serif",
            fontSize: '12px',
            fontWeight: 600,
            color: categoryColors.keyword.text,
            boxShadow: '0 4px 14px rgba(0,0,0,0.15)',
            whiteSpace: 'nowrap',
            border: `1px solid ${categoryColors.keyword.light}`
          }}>
            {draggingKeyword.keyword}
          </div>
        </div>
      )}

      {draggingKeyword && (
        <div style={{
          position: 'fixed',
          bottom: '24px',
          left: '50%',
          transform: 'translateX(-50%)',
          backgroundColor: insertionIndex !== null ? categoryColors.keyword.bar : '#78716C',
          color: '#FFFFFF',
          padding: '10px 20px',
          borderRadius: '8px',
          fontFamily: "'DM Sans', sans-serif",
          fontSize: '13px',
          fontWeight: 500,
          boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
          zIndex: 1000,
          transition: 'background-color 0.2s ease'
        }}>
          {insertionIndex !== null 
            ? '✓ Release to insert here' 
            : 'Move into the document to place keyword'}
        </div>
      )}

      <div style={{
        display: 'grid',
        gridTemplateColumns: '280px 1fr 380px',
        gridTemplateRows: '1fr',
        height: '100%',
        overflow: 'hidden',
        columnGap: '20px',
        padding: '22px 20px 40px',
        boxSizing: 'border-box'
      }}>
        <aside
          className="hide-scrollbar"
          style={{
            ...asideBaseStyle,
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            borderRight: '1px solid #E7E5E4',
            topmargin: '22px',
            borderradius: '12px',
            borderRadius: '12px',
            boxShadow: 'inset -1px 0 0 #E7E5E4, rgba(15, 23, 42, 0.08) 0px 10px 28px',
            border: '1px solid rgb(231, 229, 228)'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'left', justifyContent: 'flex-start', gap: '1px' }}>
            <div style={{ display: 'flex', alignItems: 'left', gap: '10px' }}>

              <div>
                <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '12px', color: '#6B7280' }}>
                  
                </div>
              </div>
            </div>
                            <button
                  onClick={handleStartNewSession}
                  style={{
                    width: '32px',
                    height: '32px',
                    backgroundColor: '#2a57de',
                    border: '1px solid #2a57de',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    boxShadow: '0 10px 24px rgba(42,87,222,0.25)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                  aria-label="New"
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="white"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                  </svg>
                </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '4px' }}>
            <span style={{
              fontFamily: "'DM Sans', sans-serif",
              fontSize: '12px',
              letterSpacing: '0.5px',
              textTransform: 'uppercase',
              color: '#78716C'
            }}>Recent</span>
            <span style={{
              fontFamily: "'DM Sans', sans-serif",
              fontSize: '11px',
              backgroundColor: '#EEF2FF',
              color: '#1D4ED8',
              padding: '4px 8px',
              borderRadius: '10px'
            }}>
              {sessions.length}
            </span>
          </div>

          {sessions.length === 0 ? (
            <div style={{
              marginTop: '12px',
              backgroundColor: '#F8FAFC',
              border: '1px dashed #E7E5E4',
              borderRadius: '10px',
              padding: '14px',
              fontFamily: "'DM Sans', sans-serif",
              fontSize: '13px',
              color: '#6B7280',
              lineHeight: 1.5
            }}>
              No analyses yet. Paste a snippet in the center pane to start.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '10px'}}>
              {sessions.map((session) => {
                const isActive = session.id === activeSessionId;
                const sessionScore = Number.isFinite(session.score) ? session.score : null;

                return (
                  <button
                    key={session.id}
                    onClick={() => handleSelectSession(session.id)}
                    style={{
                      textAlign: 'left',
                      width: '100%',
                      padding: '10px 12px',
                      borderRadius: '10px',
                      backgroundColor: isActive ? '#EEF2FF' : '#FFFFFF',
                      border: `1px solid ${isActive ? '#C7D2FE' : '#E7E5E4'}`,
                      color: '#0F172A',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                      boxShadow: isActive ? '0 10px 24px rgba(15,23,42,0.08)' : 'none'
                    }}
                  >
                    <div style={{
                      display: 'flex',
                      alignItems: 'left',
                      marginBottom: '4px',
                      fontFamily: "'DM Sans', sans-serif"
                    }}>
                      <span style={{
                        fontSize: '12px',
                        fontWeight: 700,
                        padding: '3px 8px',
                        borderRadius: '999px',
                        backgroundColor: sessionScore !== null ? '#DCFCE7' : '#E0F2FE',
                        color: sessionScore !== null ? '#166534' : '#0EA5E9'
                      }}>
                        {sessionScore !== null ? `${sessionScore}/100` : 'Draft'}
                      </span>
                      <span style={{ fontSize: '11px', color: '#A8A29E' }}>
                        {formatTimestamp(session.updatedAt)}
                      </span>
                    </div>
                    <div style={{
                      fontFamily: "'Source Serif 4', serif",
                      fontSize: '10px',
                      lineHeight: 2,
                      color: '#1C1917'
                    }}>
                      {session.title}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </aside>

        <section style={{
          backgroundColor: '#FFFFFF',
          height: '100%',
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}>


        {isAnalyzing && (
          <div
            style={{
              height: '6px',
              backgroundColor: '#E7E5E4',
              borderRadius: '999px',
              overflow: 'hidden',
              position: 'relative'
            }}
          >
            <div
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                background:
                  'linear-gradient(90deg, rgb(200, 238, 211) 0%, rgb(130, 244, 88) 100%)',
                borderRadius: '999px',
                transform: 'translateX(-100%) scaleX(0.4)',
                animation: 'indeterminate 1.4s cubic-bezier(0.4, 0, 0.2, 1) infinite'
              }}
            />
          </div>
        )}

          {analysisError && (
            <div style={{
              margin: '12px 32px 0',
              padding: '10px 14px',
              backgroundColor: '#FEF2F2',
              border: '1px solid #FECACA',
              color: '#991B1B',
              borderRadius: '8px',
              fontFamily: "'DM Sans', sans-serif",
              fontSize: '13px'
            }}>
              {analysisError}
            </div>
          )}

          <div
            className="hide-scrollbar"
            ref={previewScrollRef}
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
              backgroundColor: '#FAFAF9'
            }}
          >



            <section
              style={{
                backgroundColor: '#FFFFFF',
                border: '1px solid #E7E5E4',
                borderRadius: '12px',
                padding: '22px',
                boxShadow: '0 10px 28px rgba(15, 23, 42, 0.08)'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px', gap: '12px', flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '13px', fontWeight: 700, color: '#0F172A' }}>Live preview & inline highlights</div>
                  <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '12px', color: '#78716C' }}>
                    Hover a suggestion on the right to jump to the right spot.
                  </div>
                </div>
                <div style={{
                  fontFamily: "'DM Sans', sans-serif",
                  fontSize: '12px',
                  backgroundColor: '#0F172A',
                  color: '#FFFFFF',
                  padding: '6px 10px',
                  borderRadius: '8px'
                }}>
                  {totalIssues} open items
                </div>
              </div>

              <div
                ref={editorRef}
                style={{
                  backgroundColor: '#FFFFFF',
                  borderRadius: '10px',
                  padding: '32px 36px',
                  border: draggingKeyword
                    ? `2px solid ${insertionIndex !== null ? categoryColors.keyword.bar : '#D6D3D1'}`
                    : '1px solid #E7E5E4',
                  minHeight: '520px',
                  boxShadow: 'inset 0 1px 0 rgba(231, 229, 228, 0.7)',
                  transition: 'border-color 0.2s ease'
                }}
              >
                <div style={{ fontSize: '14px', lineHeight: '2', color: '#111827', whiteSpace: 'pre-wrap', fontFamily: "'DM Sans', sans-serif"}}>
                  {renderText()}
                </div>
              </div>

              <div style={{
                marginTop: '14px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                fontFamily: "'DM Sans', sans-serif",
                fontSize: '13px',
                color: '#78716C',
                flexWrap: 'wrap',
                gap: '8px'
              }}>
                <span>{wordCount} words</span>
                <span>Analysis shows {totalIssues} opportunities to improve.</span>
              </div>
            </section>
          </div>
        </section>

        <aside
          className="hide-scrollbar"
          style={{
            ...asideBaseStyle,
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            borderRight: '1px solid #E7E5E4',
            topmargin: '22px',
            borderradius: '12px',
            borderRadius: '12px',
            boxShadow: 'inset -1px 0 0 #E7E5E4, rgba(15, 23, 42, 0.08) 0px 10px 28px',
            border: '1px solid rgb(231, 229, 228)'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px', gap: '8px' }}>
            <div>
              <h2 style={{
                fontFamily: "'DM Sans', sans-serif",
                fontSize: '18px',
                fontWeight: 700,
                color: '#0F172A',
                margin: 0
              }}>
                Analysis & suggestions
              </h2>
              <p style={{
                fontFamily: "'DM Sans', sans-serif",
                fontSize: '12px',
                color: '#78716C',
                margin: '4px 0 0 0'
              }}>
                Review issues and missing keywords flagged by the model.
              </p>
            </div>
            <span style={{
              backgroundColor: '#0F172A',
              color: '#FFFFFF',
              fontSize: '13px',
              fontWeight: 700,
              padding: '6px 12px',
              borderRadius: '12px',
              minWidth: '24px',
              textAlign: 'center'
            }}>
              {totalIssues}
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '10px', marginBottom: '18px' }}>
            {Object.entries(categoryLabels).map(([key, label]) => {
              const count = categoryCounts[key];
              const colors = categoryColors[key];
              
              return (
                <div key={key} style={{ textAlign: 'center' }}>
                  <div style={{
                    height: '4px',
                    borderRadius: '2px',
                    backgroundColor: count > 0 ? colors.bar : '#E7E5E4',
                    marginBottom: '6px'
                  }} />
                  <span style={{
                    fontFamily: "'DM Sans', sans-serif",
                    fontSize: '11px',
                    color: count > 0 ? '#57534E' : '#A8A29E',
                    fontWeight: count > 0 ? 600 : 400
                  }}>
                    {label}
                  </span>
                </div>
              );
            })}
          </div>

          {keywords.length > 0 && (
            <div style={{ marginBottom: '18px' }}>
              <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: '8px', 
                marginBottom: '10px',
                paddingBottom: '8px',
                borderBottom: '1px solid #F5F5F4'
              }}>
                <span style={{
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  backgroundColor: categoryColors.keyword.bar
                }} />
                <span style={{
                  fontFamily: "'DM Sans', sans-serif",
                  fontSize: '12px',
                  fontWeight: 700,
                  color: categoryColors.keyword.text,
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px'
                }}>
                  Missing Keywords
                </span>
                <span style={{
                  fontFamily: "'DM Sans', sans-serif",
                  fontSize: '11px',
                  color: '#A8A29E'
                }}>
                  · Drag to insert
                </span>
              </div>
              
              {keywords.map(kw => (
                <div
                  key={kw.id}
                  onMouseDown={(e) => handleMouseDown(e, kw)}
                  style={{
                    padding: '12px 14px',
                    backgroundColor: draggingKeyword?.id === kw.id ? categoryColors.keyword.light : '#FFFFFF',
                    border: `2px dashed ${categoryColors.keyword.bar}`,
                    borderRadius: '8px',
                    cursor: draggingKeyword ? 'none' : 'grab',
                    marginBottom: '8px',
                    opacity: draggingKeyword?.id === kw.id ? 0.5 : 1,
                    transition: 'all 0.15s ease',
                    position: 'relative',
                    userSelect: 'none'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                    <span style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '18px',
                      height: '18px',
                      backgroundColor: categoryColors.keyword.bg,
                      borderRadius: '4px',
                      color: categoryColors.keyword.text
                    }}>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <line x1="12" y1="5" x2="12" y2="19"/>
                        <line x1="5" y1="12" x2="19" y2="12"/>
                      </svg>
                    </span>
                    <span style={{
                      fontFamily: "'Source Serif 4', serif",
                      fontSize: '14px',
                      fontWeight: 500,
                      color: '#1C1917'
                    }}>"{kw.keyword}"</span>
                  </div>
                  
                  <p style={{
                    fontFamily: "'DM Sans', sans-serif",
                    fontSize: '12px',
                    color: '#78716C',
                    margin: '0 0 0 26px'
                  }}>{kw.description}</p>
                  
                  <button
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={() => dismissKeyword(kw.id)}
                    style={{
                      position: 'absolute',
                      top: '8px',
                      right: '8px',
                      width: '18px',
                      height: '18px',
                      border: 'none',
                      backgroundColor: 'transparent',
                      cursor: 'pointer',
                      color: '#A8A29E',
                      padding: 0
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="18" y1="6" x2="6" y2="18"/>
                      <line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}

          {!hasAnalyzed ? (
            <div style={{ textAlign: 'center', padding: '32px 12px', color: '#A8A29E' }}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#A8A29E" strokeWidth="1.5" style={{ margin: '0 auto 12px' }}>
                <path d="M10 2h4l1 7h-6l1-7z" />
                <path d="M5 9h14l-1 12H6L5 9z" />
              </svg>
              <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '14px', margin: 0 }}>
                Run an analysis to see targeted suggestions.
              </p>
            </div>
          ) : suggestions.length === 0 && keywords.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '32px 12px', color: '#10B981' }}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="1.5" style={{ margin: '0 auto 12px' }}>
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                <polyline points="22 4 12 14.01 9 11.01"/>
              </svg>
              <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '14px', margin: 0 }}>
                All suggestions addressed!
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {suggestions.map((s) => {
                const colors = categoryColors[s.type];
                const isSelected = selectedSuggestion === s.id;
                
                return (
                  <div
                    key={s.id}
                    onMouseEnter={() => !draggingKeyword && setHoveredSuggestion(s.id)}
                    onMouseLeave={() => !draggingKeyword && setHoveredSuggestion(null)}
                    onClick={() => {
                      if (draggingKeyword) return;
                      const nextSelection = isSelected ? null : s.id;
                      setSelectedSuggestion(nextSelection);
                      if (nextSelection) {
                        scrollToSuggestion(nextSelection);
                      }
                    }}
                    style={{
                      padding: '12px',
                      borderRadius: '10px',
                      border: `1px solid ${isSelected ? colors.bar : '#E7E5E4'}`,
                      backgroundColor: isSelected ? colors.light : '#FFFFFF',
                      cursor: draggingKeyword ? 'none' : 'pointer',
                      transition: 'all 0.15s ease',
                      boxShadow: isSelected ? '0 8px 18px rgba(0,0,0,0.04)' : 'none'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                      <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: colors.bar }} />
                      <span style={{
                        fontFamily: "'DM Sans', sans-serif",
                        fontSize: '11px',
                        fontWeight: 700,
                        color: colors.text,
                        textTransform: 'uppercase'
                      }}>{s.type}</span>
                      <span style={{
                        fontFamily: "'DM Sans', sans-serif",
                        fontSize: '11px',
                        color: '#A8A29E'
                      }}>· {s.title}</span>
                    </div>
                    
                    <p style={{
                      fontFamily: "'DM Sans', sans-serif",
                      fontSize: '13px',
                      color: '#44403C',
                      margin: '0 0 8px 0',
                      lineHeight: 1.4
                    }}>{s.description}</p>
                    
                    <div style={{
                      fontFamily: "'Source Serif 4', serif",
                      fontSize: '13px',
                      padding: '6px 8px',
                      backgroundColor: '#F5F5F4',
                      borderRadius: '4px',
                      marginBottom: '8px'
                    }}>
                      <span style={{ textDecoration: 'line-through', color: '#A8A29E' }}>{s.original}</span>
                      <span style={{ color: '#059669', marginLeft: '6px' }}>→ {s.replacement}</span>
                    </div>
                    
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button
                        onClick={(e) => { e.stopPropagation(); acceptSuggestion(s); }}
                        style={{
                          fontFamily: "'DM Sans', sans-serif",
                          fontSize: '12px',
                          fontWeight: 600,
                          padding: '6px 10px',
                          backgroundColor: '#0F172A',
                          color: '#FFF',
                          border: 'none',
                          borderRadius: '6px',
                          cursor: 'pointer'
                        }}
                      >Accept</button>
                      <button
                        onClick={(e) => { e.stopPropagation(); dismissSuggestion(s.id); }}
                        style={{
                          fontFamily: "'DM Sans', sans-serif",
                          fontSize: '12px',
                          fontWeight: 600,
                          padding: '6px 10px',
                          backgroundColor: 'transparent',
                          color: '#78716C',
                          border: '1px solid #D6D3D1',
                          borderRadius: '6px',
                          cursor: 'pointer'
                        }}
                      >Dismiss</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
