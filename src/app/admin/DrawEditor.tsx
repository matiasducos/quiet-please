'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { saveManualDraw, saveManualResults, parsePdfDraw, type ManualMatch, type ManualResult } from './actions'

// ── Constants ─────────────────────────────────────────────────────────────────

const ROUNDS = ['R128', 'R64', 'R32', 'R16', 'QF', 'SF', 'F'] as const
type Round = typeof ROUNDS[number]

const ROUND_MATCH_COUNTS: Record<Round, number> = {
  R128: 64, R64: 32, R32: 16, R16: 8, QF: 4, SF: 2, F: 1,
}

const RESULT_ROUNDS = ['R128', 'R64', 'R32', 'R16', 'QF', 'SF', 'F'] as const

// ── Parsing helpers ───────────────────────────────────────────────────────────

/**
 * Parse a single player line like:
 *   "Carlos Alcaraz (1) [ESP]"
 *   "Jannik Sinner (2)"
 *   "Lorenzo Sonego [ITA]"
 *   "Taylor Fritz"
 */
function parsePlayerLine(line: string): { name: string; seed: string; country: string } {
  const trimmed = line.trim()
  let rest = trimmed
  let country = ''
  let seed = ''

  // Extract [CTY] suffix
  const ctryMatch = rest.match(/\s*\[([A-Za-z]{2,3})\]\s*$/)
  if (ctryMatch) {
    country = ctryMatch[1].toUpperCase()
    rest = rest.slice(0, rest.length - ctryMatch[0].length).trim()
  }

  // Extract (seed) suffix
  const seedMatch = rest.match(/\s*\((\d+)\)\s*$/)
  if (seedMatch) {
    seed = seedMatch[1]
    rest = rest.slice(0, rest.length - seedMatch[0].length).trim()
  }

  return { name: rest.trim(), seed, country }
}

/**
 * Parse the textarea into pairs of players → ManualMatch[].
 * Empty lines are ignored; every two non-empty lines become one match.
 */
function parseDrawText(text: string): ManualMatch[] {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0)
  const matches: ManualMatch[] = []
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const p1 = parsePlayerLine(lines[i])
    const p2 = parsePlayerLine(lines[i + 1])
    matches.push({
      player1Name:    p1.name,
      player1Seed:    p1.seed ? parseInt(p1.seed) : null,
      player1Country: p1.country,
      player2Name:    p2.name,
      player2Seed:    p2.seed ? parseInt(p2.seed) : null,
      player2Country: p2.country,
    })
  }
  return matches
}

/**
 * Parse results text — each line: "Winner d. Loser 6-3 6-4"
 * or "Winner / Loser / score"
 */
function parseResultsText(text: string, round: string): ManualResult[] {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0)
  return lines.map(line => {
    // Format A: "Alcaraz d. Sonego 6-3 7-5"
    const fmtA = line.match(/^(.+?)\s+d\.\s+(.+?)\s+([\d\-\(\)\s,]+)$/)
    if (fmtA) {
      return { round, winnerName: fmtA[1].trim(), loserName: fmtA[2].trim(), score: fmtA[3].trim() }
    }
    // Format B: "Alcaraz / Sonego / 6-3 7-5" (slash-separated)
    const fmtB = line.match(/^(.+?)\s*\/\s*(.+?)\s*\/\s*(.+)$/)
    if (fmtB) {
      return { round, winnerName: fmtB[1].trim(), loserName: fmtB[2].trim(), score: fmtB[3].trim() }
    }
    // Fallback: "Winner vs Loser" without score
    const fmtC = line.match(/^(.+?)\s+(?:vs\.?|beat)\s+(.+)$/)
    if (fmtC) {
      return { round, winnerName: fmtC[1].trim(), loserName: fmtC[2].trim() }
    }
    // Last resort: first half = winner, second half = loser (comma or tab)
    const parts = line.split(/[,\t]/).map(p => p.trim())
    if (parts.length >= 2) {
      return { round, winnerName: parts[0], loserName: parts[1], score: parts[2] }
    }
    return { round, winnerName: line, loserName: '' }
  }).filter(r => r.winnerName && r.loserName)
}

// ── Shared styles ─────────────────────────────────────────────────────────────

const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)' }
const labelStyle: React.CSSProperties = {
  ...mono,
  fontSize: '0.65rem',
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--muted)',
}
const inputStyle: React.CSSProperties = {
  ...mono,
  fontSize: '0.8rem',
  padding: '4px 8px',
  border: '1px solid var(--chalk-dim)',
  borderRadius: '2px',
  background: 'white',
  color: 'var(--ink)',
}
const btnPrimary: React.CSSProperties = {
  padding: '7px 16px',
  background: 'var(--court)',
  color: 'white',
  border: 'none',
  borderRadius: '2px',
  fontSize: '0.875rem',
  fontWeight: 500,
  cursor: 'pointer',
}
const btnSecondary: React.CSSProperties = {
  ...mono,
  fontSize: '0.75rem',
  padding: '5px 12px',
  background: 'var(--ink)',
  color: 'white',
  border: 'none',
  borderRadius: '2px',
  cursor: 'pointer',
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  tournamentId: string
  externalId:   string
  name:         string
  status:       string
  onClose:      () => void
}

export default function DrawEditor({ tournamentId, externalId, name, status, onClose }: Props) {
  const router = useRouter()

  // Tab: 'draw' | 'results'
  const [tab, setTab] = useState<'draw' | 'results'>('draw')

  // ── Draw state ────────────────────────────────────────────────────────────
  const [drawRound, setDrawRound]               = useState<Round>('R32')
  const [drawText, setDrawText]                 = useState('')
  const [drawParsed, setDrawParsed]             = useState<ManualMatch[] | null>(null)
  const [openPredictions, setOpenPredictions]   = useState(
    status === 'draw_published' || status === 'upcoming'
  )
  const [drawSaving, setDrawSaving]             = useState(false)
  const [drawResult, setDrawResult]             = useState<{ ok: boolean; msg: string } | null>(null)

  // ── PDF upload state ──────────────────────────────────────────────────────
  const [pdfFile, setPdfFile]                   = useState<File | null>(null)
  const [pdfParsing, setPdfParsing]             = useState(false)
  const [pdfResult, setPdfResult]               = useState<{ ok: boolean; msg: string } | null>(null)

  // ── Results state ─────────────────────────────────────────────────────────
  const [resRound, setResRound]                 = useState('QF')
  const [resText, setResText]                   = useState('')
  const [resParsed, setResParsed]               = useState<ManualResult[] | null>(null)
  const [markInProgress, setMarkInProgress]     = useState(status === 'accepting_predictions')
  const [resSaving, setResSaving]               = useState(false)
  const [resResult, setResResult]               = useState<{ ok: boolean; msg: string } | null>(null)

  // ── PDF handler ───────────────────────────────────────────────────────────
  async function handlePdfParse() {
    if (!pdfFile) return
    setPdfParsing(true)
    setPdfResult(null)
    setDrawParsed(null)
    setDrawResult(null)
    try {
      const formData = new FormData()
      formData.append('pdf', pdfFile)
      const res = await parsePdfDraw(formData)
      if (res.ok && res.matches) {
        setDrawParsed(res.matches)
        setDrawRound((res.firstRound ?? 'R64') as Round)
        setPdfResult({ ok: true, msg: `✓ Extracted ${res.matches.length} matches (${res.firstRound})` })
      } else {
        setPdfResult({ ok: false, msg: `✗ ${res.error ?? 'Unknown error'}` })
      }
    } catch (err) {
      setPdfResult({ ok: false, msg: `✗ ${String(err)}` })
    } finally {
      setPdfParsing(false)
    }
  }

  // ── Draw handlers ─────────────────────────────────────────────────────────
  function handleDrawParse() {
    setDrawParsed(parseDrawText(drawText))
    setDrawResult(null)
  }

  async function handleDrawSave() {
    if (!drawParsed?.length) return
    setDrawSaving(true)
    setDrawResult(null)
    try {
      const res = await saveManualDraw(tournamentId, externalId, drawRound, drawParsed, openPredictions)
      setDrawResult({
        ok:  res.ok,
        msg: res.ok
          ? `✓ Saved ${res.matchCount} total matches (${drawParsed.length} with players + TBD rounds)` +
            (openPredictions ? ' — predictions opened' : '')
          : `✗ ${res.error}`,
      })
      if (res.ok) router.refresh()
    } catch (err) {
      setDrawResult({ ok: false, msg: `✗ ${String(err)}` })
    } finally {
      setDrawSaving(false)
    }
  }

  // ── Results handlers ──────────────────────────────────────────────────────
  function handleResParse() {
    setResParsed(parseResultsText(resText, resRound))
    setResResult(null)
  }

  async function handleResSave() {
    if (!resParsed?.length) return
    setResSaving(true)
    setResResult(null)
    try {
      const res = await saveManualResults(tournamentId, externalId, resParsed, markInProgress)
      setResResult({
        ok:  res.ok,
        msg: res.ok
          ? `✓ Saved ${res.count} result${res.count !== 1 ? 's' : ''}` +
            (markInProgress ? ' — tournament set to in_progress' : '')
          : `✗ ${res.error}`,
      })
      if (res.ok) router.refresh()
    } catch (err) {
      setResResult({ ok: false, msg: `✗ ${String(err)}` })
    } finally {
      setResSaving(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  const expectedMatchCount = ROUND_MATCH_COUNTS[drawRound]

  return (
    <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--chalk-dim)' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
        <span style={labelStyle}>Manual Entry — {name}</span>
        <button onClick={onClose} style={{ ...mono, fontSize: '0.7rem', color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer' }}>
          ✕ close
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0', borderBottom: '1px solid var(--chalk-dim)', marginBottom: '1rem' }}>
        {(['draw', 'results'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              ...mono,
              fontSize: '0.75rem',
              padding: '6px 14px',
              background: 'none',
              border: 'none',
              borderBottom: tab === t ? '2px solid var(--court)' : '2px solid transparent',
              color: tab === t ? 'var(--ink)' : 'var(--muted)',
              cursor: 'pointer',
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              marginBottom: '-1px',
            }}
          >
            {t === 'draw' ? 'Enter Draw' : 'Enter Results'}
          </button>
        ))}
      </div>

      {/* ── DRAW TAB ── */}
      {tab === 'draw' && (
        <div>
          {/* PDF Upload */}
          <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: '2px', padding: '0.65rem', marginBottom: '0.75rem' }}>
            <p style={{ ...labelStyle, marginBottom: '0.4rem', color: '#0369a1' }}>Upload draw PDF</p>
            <p style={{ fontSize: '0.75rem', color: '#0369a1', marginBottom: '0.5rem', lineHeight: 1.5 }}>
              Upload the official ATP/WTA draw sheet PDF to auto-populate the bracket.
              Supports 128-player draws (seeds + R128 byes).
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              <input
                type="file"
                accept=".pdf,application/pdf"
                onChange={e => {
                  const f = e.target.files?.[0] ?? null
                  setPdfFile(f)
                  setPdfResult(null)
                  setDrawParsed(null)
                }}
                style={{ ...mono, fontSize: '0.75rem', color: 'var(--ink)', flex: '1 1 auto', minWidth: 0 }}
              />
              <button
                onClick={handlePdfParse}
                disabled={!pdfFile || pdfParsing}
                style={{
                  ...mono, fontSize: '0.75rem', padding: '5px 14px',
                  background: '#0369a1', color: 'white', border: 'none',
                  borderRadius: '2px', cursor: pdfFile && !pdfParsing ? 'pointer' : 'not-allowed',
                  opacity: pdfFile && !pdfParsing ? 1 : 0.45, whiteSpace: 'nowrap',
                }}
              >
                {pdfParsing ? 'Parsing…' : 'Parse PDF'}
              </button>
            </div>
            {pdfResult && (
              <p style={{ ...mono, fontSize: '0.7rem', marginTop: '0.4rem', color: pdfResult.ok ? '#166534' : '#991b1b' }}>
                {pdfResult.msg}
              </p>
            )}
          </div>

          <p style={{ ...labelStyle, marginBottom: '0.4rem' }}>— or enter manually —</p>

          {/* Format help */}
          <div style={{ background: '#f8fafc', border: '1px solid var(--chalk-dim)', borderRadius: '2px', padding: '0.65rem', marginBottom: '0.75rem', fontSize: '0.78rem', color: 'var(--muted)', lineHeight: 1.6 }}>
            Paste player names <strong>one per line</strong> — consecutive pairs form matches (lines 1+2 = match 1, etc.).
            Optionally add <code style={mono}>(seed)</code> and/or <code style={mono}>[CTY]</code> after names.
            <pre style={{ ...mono, fontSize: '0.7rem', margin: '0.4rem 0 0', color: 'var(--ink)' }}>{`Carlos Alcaraz (1) [ESP]
Lorenzo Sonego [ITA]
Jannik Sinner (2)
Taylor Fritz (5) [USA]`}</pre>
          </div>

          {/* Round selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
            <span style={labelStyle}>Draw opens at</span>
            <select
              value={drawRound}
              onChange={e => { setDrawRound(e.target.value as Round); setDrawParsed(null) }}
              style={inputStyle}
            >
              {ROUNDS.map(r => (
                <option key={r} value={r}>{r} — {ROUND_MATCH_COUNTS[r]} matches ({ROUND_MATCH_COUNTS[r] * 2} players)</option>
              ))}
            </select>
          </div>

          {/* Textarea */}
          <textarea
            value={drawText}
            onChange={e => { setDrawText(e.target.value); setDrawParsed(null) }}
            rows={14}
            placeholder={`Carlos Alcaraz (1) [ESP]\nLorenzo Sonego [ITA]\nJannik Sinner (2)\nTaylor Fritz (5) [USA]\n...`}
            style={{
              width: '100%', ...mono, fontSize: '0.75rem',
              padding: '8px', border: '1px solid var(--chalk-dim)',
              borderRadius: '2px', background: 'white', color: 'var(--ink)',
              resize: 'vertical', outline: 'none', lineHeight: 1.6,
              marginBottom: '0.5rem', boxSizing: 'border-box',
            }}
          />

          {/* Parse */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
            <button
              onClick={handleDrawParse}
              disabled={!drawText.trim()}
              style={{ ...btnSecondary, opacity: drawText.trim() ? 1 : 0.4 }}
            >
              Parse
            </button>
            {drawParsed !== null && (
              <span style={{ ...mono, fontSize: '0.7rem', color: drawParsed.length === expectedMatchCount ? '#166534' : '#92400e' }}>
                {drawParsed.length} match{drawParsed.length !== 1 ? 'es' : ''} parsed
                {drawParsed.length !== expectedMatchCount && ` (expected ${expectedMatchCount} for ${drawRound})`}
              </span>
            )}
          </div>

          {/* Preview */}
          {drawParsed !== null && drawParsed.length > 0 && (
            <div style={{ background: '#f8fafc', border: '1px solid var(--chalk-dim)', borderRadius: '2px', padding: '0.75rem', marginBottom: '0.75rem', maxHeight: '220px', overflowY: 'auto' }}>
              <p style={{ ...labelStyle, marginBottom: '0.5rem' }}>Preview — {drawRound}</p>
              {drawParsed.map((m, i) => (
                <div key={i} style={{ ...mono, fontSize: '0.7rem', color: 'var(--ink)', marginBottom: '2px' }}>
                  <span style={{ color: 'var(--muted)', display: 'inline-block', width: '2.2em', textAlign: 'right', marginRight: '0.5em' }}>
                    {i + 1}.
                  </span>
                  {m.player1Name
                    ? <><strong>{m.player1Name}</strong>
                        {m.player1Seed    != null && <span style={{ color: 'var(--muted)' }}> ({m.player1Seed})</span>}
                        {m.player1Country          && <span style={{ color: 'var(--muted)' }}> [{m.player1Country}]</span>}</>
                    : <em style={{ color: 'var(--muted)' }}>TBD</em>
                  }
                  <span style={{ color: 'var(--muted)' }}> vs </span>
                  {m.player2Name
                    ? <><strong>{m.player2Name}</strong>
                        {m.player2Seed    != null && <span style={{ color: 'var(--muted)' }}> ({m.player2Seed})</span>}
                        {m.player2Country          && <span style={{ color: 'var(--muted)' }}> [{m.player2Country}]</span>}</>
                    : <em style={{ color: 'var(--muted)' }}>TBD</em>
                  }
                </div>
              ))}
            </div>
          )}

          {/* Open predictions checkbox */}
          {drawParsed !== null && drawParsed.length > 0 && (
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem', cursor: 'pointer' }}>
              <input type="checkbox" checked={openPredictions} onChange={e => setOpenPredictions(e.target.checked)} />
              <span style={{ fontSize: '0.8rem', color: 'var(--ink)' }}>
                Transition to <code style={mono}>accepting_predictions</code> after saving (notifies all users)
              </span>
            </label>
          )}

          {/* Save */}
          {drawParsed !== null && drawParsed.length > 0 && (
            <button onClick={handleDrawSave} disabled={drawSaving} style={{ ...btnPrimary, opacity: drawSaving ? 0.6 : 1, cursor: drawSaving ? 'wait' : 'pointer' }}>
              {drawSaving ? 'Saving…' : `Save Draw (${drawParsed.length} first-round matches + TBD rounds)`}
            </button>
          )}

          {/* Result */}
          {drawResult && (
            <div style={{ marginTop: '0.75rem', padding: '0.5rem 0.75rem', background: drawResult.ok ? '#f0fdf4' : '#fee2e2', borderLeft: `3px solid ${drawResult.ok ? '#22c55e' : '#ef4444'}`, borderRadius: '2px' }}>
              <p style={{ ...mono, fontSize: '0.7rem', color: drawResult.ok ? '#166534' : '#991b1b', margin: 0 }}>
                {drawResult.msg}
              </p>
            </div>
          )}

          {/* ID note */}
          <p style={{ fontSize: '0.72rem', color: 'var(--muted)', marginTop: '0.75rem', lineHeight: 1.5 }}>
            Player IDs are derived from names (e.g. "Carlos Alcaraz" → <code style={mono}>carlos-alcaraz</code>).
            Use the Results tab to enter match results with the same name-based IDs.
          </p>
        </div>
      )}

      {/* ── RESULTS TAB ── */}
      {tab === 'results' && (
        <div>
          {/* Format help */}
          <div style={{ background: '#f8fafc', border: '1px solid var(--chalk-dim)', borderRadius: '2px', padding: '0.65rem', marginBottom: '0.75rem', fontSize: '0.78rem', color: 'var(--muted)', lineHeight: 1.6 }}>
            Enter one result per line. Supported formats:
            <pre style={{ ...mono, fontSize: '0.7rem', margin: '0.4rem 0 0', color: 'var(--ink)' }}>{`Alcaraz d. Sonego 6-3 7-5
Sinner d. Fritz 6-4 7-6(3)
Alcaraz / Djokovic / 7-6 6-4
Medvedev beat Rublev`}</pre>
          </div>

          {/* Round selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
            <span style={labelStyle}>Round</span>
            <select
              value={resRound}
              onChange={e => { setResRound(e.target.value); setResParsed(null) }}
              style={inputStyle}
            >
              {RESULT_ROUNDS.map(r => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>

          {/* Textarea */}
          <textarea
            value={resText}
            onChange={e => { setResText(e.target.value); setResParsed(null) }}
            rows={10}
            placeholder={`Alcaraz d. Sonego 6-3 7-5\nSinner d. Fritz 6-4 7-6(3)\n...`}
            style={{
              width: '100%', ...mono, fontSize: '0.75rem',
              padding: '8px', border: '1px solid var(--chalk-dim)',
              borderRadius: '2px', background: 'white', color: 'var(--ink)',
              resize: 'vertical', outline: 'none', lineHeight: 1.6,
              marginBottom: '0.5rem', boxSizing: 'border-box',
            }}
          />

          {/* Parse */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
            <button
              onClick={handleResParse}
              disabled={!resText.trim()}
              style={{ ...btnSecondary, opacity: resText.trim() ? 1 : 0.4 }}
            >
              Parse
            </button>
            {resParsed !== null && (
              <span style={{ ...mono, fontSize: '0.7rem', color: 'var(--muted)' }}>
                {resParsed.length} result{resParsed.length !== 1 ? 's' : ''} parsed
              </span>
            )}
          </div>

          {/* Preview */}
          {resParsed !== null && resParsed.length > 0 && (
            <div style={{ background: '#f8fafc', border: '1px solid var(--chalk-dim)', borderRadius: '2px', padding: '0.75rem', marginBottom: '0.75rem', maxHeight: '180px', overflowY: 'auto' }}>
              <p style={{ ...labelStyle, marginBottom: '0.5rem' }}>Preview — {resRound}</p>
              {resParsed.map((r, i) => (
                <div key={i} style={{ ...mono, fontSize: '0.7rem', color: 'var(--ink)', marginBottom: '2px' }}>
                  <span style={{ color: 'var(--muted)', display: 'inline-block', width: '2.2em', textAlign: 'right', marginRight: '0.5em' }}>{i + 1}.</span>
                  <strong style={{ color: '#166534' }}>{r.winnerName}</strong>
                  <span style={{ color: 'var(--muted)' }}> d. </span>
                  <span>{r.loserName}</span>
                  {r.score && <span style={{ color: 'var(--muted)' }}>  {r.score}</span>}
                </div>
              ))}
            </div>
          )}

          {/* Mark in_progress checkbox */}
          {resParsed !== null && resParsed.length > 0 && (
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem', cursor: 'pointer' }}>
              <input type="checkbox" checked={markInProgress} onChange={e => setMarkInProgress(e.target.checked)} />
              <span style={{ fontSize: '0.8rem', color: 'var(--ink)' }}>
                Transition to <code style={mono}>in_progress</code> after saving (if currently <code style={mono}>accepting_predictions</code>)
              </span>
            </label>
          )}

          {/* Save */}
          {resParsed !== null && resParsed.length > 0 && (
            <button onClick={handleResSave} disabled={resSaving} style={{ ...btnPrimary, opacity: resSaving ? 0.6 : 1, cursor: resSaving ? 'wait' : 'pointer' }}>
              {resSaving ? 'Saving…' : `Save ${resParsed.length} Result${resParsed.length !== 1 ? 's' : ''}`}
            </button>
          )}

          {/* Result */}
          {resResult && (
            <div style={{ marginTop: '0.75rem', padding: '0.5rem 0.75rem', background: resResult.ok ? '#f0fdf4' : '#fee2e2', borderLeft: `3px solid ${resResult.ok ? '#22c55e' : '#ef4444'}`, borderRadius: '2px' }}>
              <p style={{ ...mono, fontSize: '0.7rem', color: resResult.ok ? '#166534' : '#991b1b', margin: 0 }}>
                {resResult.msg}
              </p>
            </div>
          )}

          <p style={{ fontSize: '0.72rem', color: 'var(--muted)', marginTop: '0.75rem', lineHeight: 1.5 }}>
            Player names are matched case-insensitively against the stored draw.
            Running <strong>Award Points</strong> cron after saving will score all correct predictions.
          </p>
        </div>
      )}
    </div>
  )
}
