import React, { useState, useCallback, useRef, useEffect } from 'react';

const initialText = `Dear Professor,

I hope you are doing well!

My name is Hojjat, and I am a graduate Ph.D. student in Computer Science. The title of my dissertation was Interplay of Machine Learning and meta-heuristics, which investigates the possible synergies between machine learning and stochastic optimization methods.

I am following your ongoing IVADO research program, and I have the honor to present my application. Please find the attached documents for my application, including my curriculum vitae, list of publications, cover letter, research statement, and reference letters.

I appreciate your attention and I remain at your disposal for any further information.

Best regards,
Hojjat.`;

const initialSuggestions = [
  {
    id: 1,
    type: 'correctness',
    title: 'Word choice',
    description: 'Consider removing "graduate" as it\'s redundant with "Ph.D. student"',
    original: 'graduate Ph.D. student',
    replacement: 'Ph.D. student',
    startIndex: 75,
    endIndex: 97
  },
  {
    id: 2,
    type: 'correctness',
    title: 'Verb tense',
    description: 'Use present tense for ongoing work',
    original: 'was Interplay',
    replacement: 'is Interplay',
    startIndex: 148,
    endIndex: 161
  },
  {
    id: 3,
    type: 'clarity',
    title: 'Simplify phrase',
    description: 'Use a more direct expression',
    original: 'I remain at your disposal',
    replacement: 'I am available',
    startIndex: 606,
    endIndex: 631
  },
  {
    id: 4,
    type: 'clarity',
    title: 'Improve readability',
    description: 'Consider breaking this into shorter sentences',
    original: 'which investigates the possible synergies between machine learning and stochastic optimization methods',
    replacement: 'investigating synergies between machine learning and stochastic optimization',
    startIndex: 203,
    endIndex: 305
  },
  {
    id: 5,
    type: 'engagement',
    title: 'Strengthen opening',
    description: 'Make the opening more engaging',
    original: 'I hope you are doing well!',
    replacement: 'I hope this message finds you well.',
    startIndex: 17,
    endIndex: 43
  },
  {
    id: 6,
    type: 'delivery',
    title: 'Professional tone',
    description: 'Consider a warmer closing',
    original: 'Best regards,',
    replacement: 'Warm regards,',
    startIndex: 662,
    endIndex: 675
  }
];

const alignSuggestionsToText = (items, content) =>
  items.map(s => {
    const start = content.indexOf(s.original);
    if (start === -1) return s;
    return { ...s, startIndex: start, endIndex: start + s.original.length };
  });

const initialKeywords = [
  {
    id: 101,
    keyword: 'at the University of Montreal',
    description: 'Add your institution name for credibility'
  },
  {
    id: 102,
    keyword: 'deep learning and',
    description: 'Highlight your expertise in deep learning'
  },
  {
    id: 103,
    keyword: 'postdoctoral',
    description: 'Specify the position type'
  }
];

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

const contentAreaHeight = 'calc(100vh - 65px)';

export default function WritingAssistant() {
  const [text, setText] = useState(initialText);
  const [suggestions, setSuggestions] = useState(() => alignSuggestionsToText(initialSuggestions, initialText));
  const [keywords, setKeywords] = useState(initialKeywords);
  const [hoveredSuggestion, setHoveredSuggestion] = useState(null);
  const [selectedSuggestion, setSelectedSuggestion] = useState(null);
  
  // Mouse-based drag state
  const [draggingKeyword, setDraggingKeyword] = useState(null);
  const [cursorPos, setCursorPos] = useState({ x: 0, y: 0 });
  const [insertionIndex, setInsertionIndex] = useState(null);
  
  const editorRef = useRef(null);

  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  const totalIssues = suggestions.length + keywords.length;
  const score = Math.max(70, 100 - totalIssues * 2);

  const categoryCounts = {
    correctness: suggestions.filter(s => s.type === 'correctness').length,
    clarity: suggestions.filter(s => s.type === 'clarity').length,
    engagement: suggestions.filter(s => s.type === 'engagement').length,
    delivery: suggestions.filter(s => s.type === 'delivery').length,
    keyword: keywords.length
  };

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

  return (
    <div style={{ 
      minHeight: '100vh', 
      backgroundColor: '#FAFAF9', 
      fontFamily: "'Source Serif 4', Georgia, serif",
      cursor: draggingKeyword ? 'none' : 'default',
      userSelect: draggingKeyword ? 'none' : 'auto'
    }}>
      <link href="https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,400;8..60,500;8..60,600&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
      
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }

        .hide-scrollbar {
          scrollbar-width: none;
          -ms-overflow-style: none;
        }

        .hide-scrollbar::-webkit-scrollbar {
          display: none;
        }
      `}</style>

      {/* Custom cursor when dragging */}
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
          {/* Purple circle with + */}
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
          
          {/* Keyword label */}
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

      {/* Header */}
      <header style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 24px',
        backgroundColor: '#FFFFFF',
        borderBottom: '1px solid #E7E5E4',
        position: 'sticky',
        top: 0,
        zIndex: 100
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{
            width: '36px',
            height: '36px',
            borderRadius: '8px',
            background: 'linear-gradient(135deg, #1C1917 0%, #44403C 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#FFFFFF',
            fontFamily: "'DM Sans', sans-serif",
            fontWeight: 600,
            fontSize: '16px'
          }}>W</div>
          <span style={{
            fontFamily: "'DM Sans', sans-serif",
            fontSize: '14px',
            color: '#78716C',
            padding: '4px 12px',
            backgroundColor: '#F5F5F4',
            borderRadius: '6px'
          }}>Untitled document</span>
        </div>
        
        <div style={{
          fontFamily: "'DM Sans', sans-serif",
          fontSize: '14px',
          fontWeight: 600,
          padding: '8px 16px',
          backgroundColor: score >= 80 ? '#D1FAE5' : '#FEF3C7',
          color: score >= 80 ? '#059669' : '#D97706',
          borderRadius: '8px'
        }}>
          {score} Overall score
        </div>
      </header>

      {/* Status bar when dragging */}
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

      <div style={{ display: 'flex', height: contentAreaHeight, overflow: 'hidden' }}>
        {/* Editor */}
        <main
          className="hide-scrollbar"
          style={{ 
          flex: 1, 
          padding: '48px 64px', 
          maxWidth: '800px', 
          margin: '0 auto',
          overflowY: 'auto',
          height: '100%'
        }}>
          <div
            ref={editorRef}
            style={{
              backgroundColor: '#FFFFFF',
              borderRadius: '12px',
              padding: '48px 56px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.02)',
              minHeight: '600px',
              border: draggingKeyword 
                ? `2px solid ${insertionIndex !== null ? categoryColors.keyword.bar : '#D6D3D1'}` 
                : '2px solid transparent',
              transition: 'border-color 0.2s ease'
            }}
          >
            <div style={{ fontSize: '17px', lineHeight: '2', color: '#1C1917', whiteSpace: 'pre-wrap' }}>
              {renderText()}
            </div>
          </div>
          
          <div style={{
            marginTop: '16px',
            textAlign: 'center',
            fontFamily: "'DM Sans', sans-serif",
            fontSize: '13px',
            color: '#A8A29E'
          }}>
            {wordCount} words
          </div>
        </main>

        {/* Sidebar */}
        <aside className="hide-scrollbar" style={{
          width: '380px',
          backgroundColor: '#FFFFFF',
          borderLeft: '1px solid #E7E5E4',
          padding: '24px',
          overflowY: 'auto',
          height: '100%'
        }}>
          {/* Review suggestions header */}
          <div style={{ marginBottom: '24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
              <h2 style={{
                fontFamily: "'DM Sans', sans-serif",
                fontSize: '20px',
                fontWeight: 700,
                color: '#1C1917',
                margin: 0
              }}>
                Review suggestions
              </h2>
              <span style={{
                backgroundColor: '#1C1917',
                color: '#FFFFFF',
                fontSize: '13px',
                fontWeight: 600,
                padding: '3px 10px',
                borderRadius: '12px',
                minWidth: '24px',
                textAlign: 'center'
              }}>
                {totalIssues}
              </span>
            </div>
            
            {/* Category progress bars */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '12px' }}>
              {Object.entries(categoryLabels).map(([key, label]) => {
                const count = categoryCounts[key];
                const colors = categoryColors[key];
                
                return (
                  <div key={key} style={{ textAlign: 'center' }}>
                    <div style={{
                      height: '4px',
                      borderRadius: '2px',
                      backgroundColor: count > 0 ? colors.bar : '#E7E5E4',
                      marginBottom: '8px'
                    }} />
                    <span style={{
                      fontFamily: "'DM Sans', sans-serif",
                      fontSize: '11px',
                      color: count > 0 ? '#57534E' : '#A8A29E',
                      fontWeight: count > 0 ? 500 : 400
                    }}>
                      {label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Keywords section */}
          {keywords.length > 0 && (
            <div style={{ marginBottom: '24px' }}>
              <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: '8px', 
                marginBottom: '12px',
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
                  fontWeight: 600,
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

          {/* Suggestions */}
          {suggestions.length === 0 && keywords.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: '#A8A29E' }}>
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
                      borderRadius: '8px',
                      border: `1px solid ${isSelected ? colors.bar : '#E7E5E4'}`,
                      backgroundColor: isSelected ? colors.light : '#FFF',
                      cursor: draggingKeyword ? 'none' : 'pointer',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                      <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: colors.bar }} />
                      <span style={{
                        fontFamily: "'DM Sans', sans-serif",
                        fontSize: '11px',
                        fontWeight: 600,
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
                          fontWeight: 500,
                          padding: '5px 10px',
                          backgroundColor: '#1C1917',
                          color: '#FFF',
                          border: 'none',
                          borderRadius: '4px',
                          cursor: 'pointer'
                        }}
                      >Accept</button>
                      <button
                        onClick={(e) => { e.stopPropagation(); dismissSuggestion(s.id); }}
                        style={{
                          fontFamily: "'DM Sans', sans-serif",
                          fontSize: '12px',
                          fontWeight: 500,
                          padding: '5px 10px',
                          backgroundColor: 'transparent',
                          color: '#78716C',
                          border: '1px solid #D6D3D1',
                          borderRadius: '4px',
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
