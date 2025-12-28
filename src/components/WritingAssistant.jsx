import React, { useState, useCallback, useRef, useEffect } from 'react';

const OPENAI_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const OPENAI_MODEL = 'gpt-4o-mini';

const initialText = '';

const initialSuggestions = [];
const initialKeywords = [];

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

const buildAnalysisMessages = (content) => [
  {
    role: 'system',
    content:
      'You are a concise writing assistant that returns JSON describing suggestions to improve academic emails. Keep outputs short and actionable.'
  },
  {
    role: 'user',
    content: `Analyze the following text and respond with a JSON object containing:
- "score": integer from 0-100 (higher is better).
- "suggestions": up to 6 items. Each item must have id, type ("correctness", "clarity", "engagement", or "delivery"), title, description, original (exact text span), replacement (improved version), startIndex, endIndex (character offsets in the provided text, endIndex exclusive).
- "keywords": up to 3 missing keywords to add, each with id, keyword, and description.

Use character indexes based on the exact text. If the text is already strong, keep arrays short.

Text to analyze:
"""${content}"""`
  }
];

async function requestAnalysisFromOpenAI(content, apiKey, signal) {
  const response = await fetch(OPENAI_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages: buildAnalysisMessages(content),
      temperature: 0.2,
      max_tokens: 600,
      response_format: { type: 'json_object' }
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
  const [sessions, setSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [showAnalysis, setShowAnalysis] = useState(false);
  
  // Mouse-based drag state
  const [draggingKeyword, setDraggingKeyword] = useState(null);
  const [cursorPos, setCursorPos] = useState({ x: 0, y: 0 });
  const [insertionIndex, setInsertionIndex] = useState(null);
  
  const editorRef = useRef(null);
  const requestIdRef = useRef(0);
  const abortControllerRef = useRef(null);

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

  const runAnalysis = useCallback(async (content) => {
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

    const apiKey = import.meta.env.VITE_OPENAI_API_KEY;
    if (!apiKey) {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      setAnalysisError('Add VITE_OPENAI_API_KEY in a .env file to enable OpenAI-powered suggestions.');
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
      const result = await requestAnalysisFromOpenAI(content, apiKey, controller.signal);
      if (requestIdRef.current !== requestId) return;

      const incomingSuggestions = Array.isArray(result?.suggestions) ? result.suggestions : [];
      const incomingKeywords = Array.isArray(result?.keywords) ? result.keywords : [];
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
  }, [resetFeedbackState, activeSessionId]);

  useEffect(() => () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  }, []);

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

  const handleAnalyzeNow = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed) {
      setShowAnalysis(false);
      runAnalysis(text);
      return;
    }
    setShowAnalysis(true);
    runAnalysis(text);
  }, [runAnalysis, text]);

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
    setSuggestions(session.suggestions || []);
    setKeywords(session.keywords || []);
    setAiScore(Number.isFinite(session.score) ? session.score : null);
    setHasAnalyzed(true);
    setIsAnalyzing(false);
    setAnalysisError(null);
    setHoveredSuggestion(null);
    setSelectedSuggestion(null);
  }, [sessions]);

  const handleStartNewSession = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    setText('');
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
            onClick={() => setSelectedSuggestion(s.id)}
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
      `}</style>
    </>
  );

  if (!showAnalysis) {
    return (
      <div style={{
        minHeight: '100vh',
        backgroundColor: '#FAFAF9',
        fontFamily: "'Source Serif 4', Georgia, serif",
        cursor: draggingKeyword ? 'none' : 'default',
        userSelect: draggingKeyword ? 'none' : 'auto'
      }}>
        {sharedHead}

        <div style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-end',
          padding: '40px 20px 72px'
        }}>
          <div style={{ maxWidth: '980px', margin: '0 auto', width: '100%' }}>
            {analysisError && (
              <div style={{
                marginBottom: '12px',
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

            <div style={{
              backgroundColor: '#FFFFFF',
              border: '1px solid #E7E5E4',
              borderRadius: '16px',
              padding: '22px 24px 18px',
              boxShadow: '0 18px 40px rgba(15,23,42,0.12)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '14px', flexWrap: 'wrap' }}>
              </div>

              <textarea
                value={text}
                onChange={handleTextChange}
                placeholder="Drop your message or paste text to improve..."
                style={{
                  width: '100%',
                  minHeight: '150px',
                  borderRadius: '12px',
                  border: '1px solid #D6D3D1',
                  padding: '14px 16px',
                  fontFamily: "''DM Sans', sans-serif",
                  fontSize: '13px',
                  lineHeight: 1,
                  resize: 'vertical',
                  outline: 'none',
                  color: '#1C1917',
                  backgroundColor: '#FFFFFF',
                  boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.03)'
                }}
              />

              <div style={{ marginTop: '14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
                <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '13px', color: '#6B7280' }}>
                  Editing clears previous AI suggestions. Run analysis to store this draft in history.
                </span>
                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                  <button
                    onClick={() => handleTextChange('')}
                    style={{
                      fontFamily: "'DM Sans', sans-serif",
                      fontSize: '13px',
                      fontWeight: 700,
                      padding: '10px 14px',
                      backgroundColor: '#F5F5F4',
                      color: '#57534E',
                      border: '1px solid #E7E5E4',
                      borderRadius: '10px',
                      cursor: 'pointer',
                      minWidth: '90px'
                    }}
                  >
                    Clear
                  </button>
                  <button
                    onClick={handleAnalyzeNow}
                    disabled={isAnalyzing}
                    style={{
                      fontFamily: "'DM Sans', sans-serif",
                      fontSize: '13px',
                      fontWeight: 800,
                      padding: '10px 16px',
                      backgroundColor: isAnalyzing ? '#2a57de' : '#2a57de',
                      color: isAnalyzing ? '#6287f5' : '#FFFFFF',
                      border: 'none',
                      borderRadius: '12px',
                      cursor: isAnalyzing ? 'not-allowed' : 'pointer',
                      boxShadow: '0 14px 28px rgba(15,23,42,0.22)',
                      minWidth: '120px'
                    }}
                  >
                    {isAnalyzing ? 'Working…' : 'Analyze text'}
                  </button>
                </div>
              </div>

              {isAnalyzing && (
                <div style={{
                  marginTop: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  fontFamily: "'DM Sans', sans-serif",
                  fontSize: '13px',
                  color: '#6B7280'
                }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1C1917" strokeWidth="1.5">
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 7v5l3 2" />
                  </svg>
                  <span>Analyzing with OpenAI…</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: '#FAFAF9',
      fontFamily: "'Source Serif 4', Georgia, serif",
      cursor: draggingKeyword ? 'none' : 'default',
      userSelect: draggingKeyword ? 'none' : 'auto'
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

      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr 380px', minHeight: '100vh' }}>
        <aside
          className="hide-scrollbar"
          style={{
            background: 'linear-gradient(180deg, #111827 0%, #1F2937 100%)',
            color: '#E5E7EB',
            padding: '20px 18px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            borderRight: '1px solid #0F172A',
            minHeight: '100vh',
            overflowY: 'auto'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{
                width: '36px',
                height: '36px',
                borderRadius: '10px',
                background: 'linear-gradient(135deg, #FACC15 0%, #F97316 100%)',
                color: '#0F172A',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontFamily: "'DM Sans', sans-serif",
                fontWeight: 800,
                fontSize: '16px'
              }}>WA</div>
              <div>
                <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '13px', fontWeight: 700, color: '#F8FAFC' }}>
                  Writing assistant
                </div>
                <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: '12px', color: '#CBD5E1' }}>
                  Conversation history
                </div>
              </div>
            </div>
            <button
              onClick={handleStartNewSession}
              style={{
                fontFamily: "'DM Sans', sans-serif",
                fontSize: '12px',
                fontWeight: 700,
                padding: '8px 12px',
                backgroundColor: '#F8FAFC',
                color: '#111827',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                boxShadow: '0 8px 24px rgba(15,23,42,0.35)'
              }}
            >
              New
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '4px' }}>
            <span style={{
              fontFamily: "'DM Sans', sans-serif",
              fontSize: '12px',
              letterSpacing: '0.5px',
              textTransform: 'uppercase',
              color: '#E5E7EB'
            }}>Recent</span>
            <span style={{
              fontFamily: "'DM Sans', sans-serif",
              fontSize: '11px',
              backgroundColor: '#0EA5E9',
              color: '#0B1220',
              padding: '4px 8px',
              borderRadius: '10px'
            }}>
              {sessions.length}
            </span>
          </div>

          {sessions.length === 0 ? (
            <div style={{
              marginTop: '12px',
              backgroundColor: 'rgba(255,255,255,0.06)',
              border: '1px dashed rgba(255,255,255,0.12)',
              borderRadius: '10px',
              padding: '14px',
              fontFamily: "'DM Sans', sans-serif",
              fontSize: '13px',
              color: '#CBD5E1',
              lineHeight: 1.5
            }}>
              No analyses yet. Paste a snippet in the center pane to start.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '10px' }}>
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
                      padding: '12px',
                      borderRadius: '10px',
                      backgroundColor: isActive ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.04)',
                      border: `1px solid ${isActive ? 'rgba(255,255,255,0.24)' : 'rgba(255,255,255,0.08)'}`,
                      color: '#F8FAFC',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                      boxShadow: isActive ? '0 8px 22px rgba(0,0,0,0.25)' : 'none'
                    }}
                  >
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginBottom: '6px',
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
                      <span style={{ fontSize: '11px', color: '#CBD5E1' }}>
                        {formatTimestamp(session.updatedAt)}
                      </span>
                    </div>
                    <div style={{
                      fontFamily: "'Source Serif 4', serif",
                      fontSize: '14px',
                      lineHeight: 1.4,
                      color: '#E5E7EB'
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
          borderRight: '1px solid #E7E5E4',
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column'
        }}>
          <header style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '14px 32px',
            borderBottom: '1px solid #E7E5E4',
            position: 'sticky',
            top: 0,
            zIndex: 20,
            backgroundColor: 'rgba(255,255,255,0.92)',
          backdropFilter: 'blur(6px)',
          gap: '16px'
        }}>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{
                fontFamily: "'DM Sans', sans-serif",
                fontSize: '14px',
                fontWeight: 600,
                padding: '8px 16px',
                backgroundColor: scoreBackground,
                color: scoreColor,
                borderRadius: '10px',
                minWidth: '150px',
                textAlign: 'center'
              }}>
                {scoreLabel}
              </div>
            </div>
          </header>

          {isAnalyzing && (
            <div style={{ padding: '12px 32px 0', backgroundColor: '#FFFFFF' }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                marginBottom: '8px',
                fontFamily: "'DM Sans', sans-serif",
                fontSize: '13px',
                color: '#57534E'
              }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4aa150" strokeWidth="12.5">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 7v5l3 2" />
                </svg>
                <span>Analyzing with OpenAI…</span>
              </div>
              <div style={{
                height: '6px',
                backgroundColor: '#E7E5E4',
                borderRadius: '999px',
                overflow: 'hidden',
                position: 'relative'
              }}>
                <div style={{
                  position: 'absolute',
                  left: '-40%',
                  width: '100%',
                  height: '100%',
                  background: 'linear-gradient(90deg,rgb(200, 238, 211) 0%,rgb(130, 244, 88) 100%)',
                  borderRadius: '999px',
                  animation: 'indeterminate 1s ease-in-out infinite'
                }} />
              </div>
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
            style={{
              padding: '24px 48px 40px',
              flex: 1,
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
                <div style={{ fontSize: '17px', lineHeight: '1.9', color: '#111827', whiteSpace: 'pre-wrap' }}>
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
            backgroundColor: '#FFFFFF',
            padding: '20px 22px 28px',
            overflowY: 'auto',
            minHeight: '100vh'
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
                    onClick={() => !draggingKeyword && setSelectedSuggestion(isSelected ? null : s.id)}
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
