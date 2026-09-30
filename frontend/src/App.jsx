import { useState, useEffect, useMemo, useDeferredValue } from 'react'
import './App.css'

/* ------------------------------------------------------------------ */
/* Configuration                                                       */
/* ------------------------------------------------------------------ */
const CSV_URL = '/students_processed.csv'
const PAGE_SIZE = 10
const REQUIRED_COLUMNS = [
  'student_id',
  'name',
  'course',
  'maths',
  'python',
  'dbms',
  'attendance',
]

/* ------------------------------------------------------------------ */
/* Inline SVG icons (no extra dependencies)                            */
/* ------------------------------------------------------------------ */
function Icon({ name, size = 20 }) {
  const paths = {
    dashboard: (
      <>
        <rect x="3" y="3" width="7" height="9" rx="1.5" />
        <rect x="14" y="3" width="7" height="5" rx="1.5" />
        <rect x="14" y="12" width="7" height="9" rx="1.5" />
        <rect x="3" y="16" width="7" height="5" rx="1.5" />
      </>
    ),
    students: (
      <>
        <path d="M22 10 12 5 2 10l10 5 10-5z" />
        <path d="M6 12v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5" />
      </>
    ),
    reports: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
    users: (
      <>
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" />
      </>
    ),
    award: (
      <>
        <circle cx="12" cy="9" r="6" />
        <path d="m8.5 14-1.5 8 5-3 5 3-1.5-8" />
      </>
    ),
    calendar: (
      <>
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <path d="M16 2v4M8 2v4M3 10h18" />
        <path d="m9 16 2 2 4-4" />
      </>
    ),
    book: (
      <>
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z" />
        <path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5" />
      </>
    ),
    search: (
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="m21 21-4.3-4.3" />
      </>
    ),
    close: <path d="M18 6 6 18M6 6l12 12" />,
    left: <path d="m15 18-6-6 6-6" />,
    right: <path d="m9 18 6-6-6-6" />,
    alert: (
      <>
        <circle cx="12" cy="12" r="10" />
        <path d="M12 8v4M12 16h.01" />
      </>
    ),
    inbox: (
      <>
        <path d="M22 12h-6l-2 3h-4l-2-3H2" />
        <path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.7 4H7.3a2 2 0 0 0-1.8 1.1z" />
      </>
    ),
    refresh: (
      <>
        <path d="M21 12a9 9 0 0 0-15.5-6.2L3 8" />
        <path d="M3 3v5h5" />
        <path d="M3 12a9 9 0 0 0 15.5 6.2L21 16" />
        <path d="M21 21v-5h-5" />
      </>
    ),
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths[name]}
    </svg>
  )
}

/* ------------------------------------------------------------------ */
/* CSV parsing                                                         */
/* ------------------------------------------------------------------ */

// RFC 4180-style parser: quoted fields, commas inside quotes, escaped
// quotes ("") and both \n and \r\n line endings.
function parseCSV(text) {
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0 // skip BOM
  const n = text.length

  for (; i < n; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += c
      }
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      field = ''
      rows.push(row)
      row = []
    } else {
      field += c
    }
  }

  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

function normaliseHeader(h) {
  return h.trim().toLowerCase().replace(/\s+/g, '_')
}

// Turns raw CSV text into student objects plus load metadata.
function buildDataset(text) {
  const trimmed = text.trimStart()
  if (trimmed.startsWith('<!doctype') || trimmed.startsWith('<html')) {
    throw new Error(
      'The server returned an HTML page instead of a CSV. Make sure the file exists at public/students_processed.csv.'
    )
  }

  const rows = parseCSV(text)
  if (rows.length < 2) {
    throw new Error('The CSV file is empty or contains only a header row.')
  }

  const header = rows[0].map(normaliseHeader)
  const missing = REQUIRED_COLUMNS.filter((c) => !header.includes(c))
  if (missing.length > 0) {
    throw new Error(
      `Missing required column(s): ${missing.join(', ')}. Columns found: ${header.join(', ')}.`
    )
  }

  const idx = {}
  header.forEach((h, j) => {
    if (!(h in idx)) idx[h] = j
  })

  const students = []
  let skipped = 0

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]
    if (row.length === 1 && row[0].trim() === '') continue // blank line

    const get = (key) => {
      const j = idx[key]
      return j === undefined ? '' : (row[j] ?? '').trim()
    }
    const num = (key) => {
      const v = get(key).replace('%', '')
      if (v === '') return NaN
      const x = Number(v)
      return Number.isFinite(x) ? x : NaN
    }

    const id = get('student_id')
    const name = get('name')
    if (!id && !name) {
      skipped++
      continue
    }

    const maths = num('maths')
    const python = num('python')
    const dbms = num('dbms')

    let average = num('average_marks')
    if (!Number.isFinite(average)) {
      const parts = [maths, python, dbms].filter(Number.isFinite)
      average = parts.length
        ? parts.reduce((a, b) => a + b, 0) / parts.length
        : NaN
    }

    students.push({
      rowId: r,
      id,
      name,
      course: get('course') || 'Unknown',
      gender: get('gender'),
      maths,
      python,
      dbms,
      average,
      attendance: num('attendance'),
      idLower: id.toLowerCase(),
      nameLower: name.toLowerCase(),
      idNum: /\d+/.test(id) ? Number(id.match(/\d+/)[0]) : NaN,
    })
  }

  if (students.length === 0) {
    throw new Error('No valid student records were found in the CSV file.')
  }

  // If attendance is stored as a fraction (0 to 1), convert to percentage.
  let maxAttendance = 0
  for (const s of students) {
    if (Number.isFinite(s.attendance) && s.attendance > maxAttendance) {
      maxAttendance = s.attendance
    }
  }
  if (maxAttendance > 0 && maxAttendance <= 1) {
    for (const s of students) {
      if (Number.isFinite(s.attendance)) s.attendance *= 100
    }
  }

  return { students, skipped }
}

/* ------------------------------------------------------------------ */
/* Formatting helpers                                                  */
/* ------------------------------------------------------------------ */
const intFormat = new Intl.NumberFormat()
const decimalFormat = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})

const formatInt = (v) => intFormat.format(v)
const formatScore = (v) => (Number.isFinite(v) ? decimalFormat.format(v) : '—')
const formatPercent = (v) =>
  Number.isFinite(v) ? `${decimalFormat.format(v)}%` : '—'

/* ---------- Search helpers ---------- */
// A token like "s1", "12" or "S000123" is treated as a student-ID query.
const ID_LIKE = /^([a-z]*)(\d+)$/

function tokenise(query) {
  return query.toLowerCase().split(/\s+/).filter(Boolean)
}

// Every token must match: either the ID (prefix or numeric shorthand, so
// "1" and "s1" both find S000001) or the name (any substring).
function matchesToken(s, tok) {
  const m = ID_LIKE.exec(tok)
  if (m) {
    if (s.idLower.startsWith(tok)) return true
    if (s.idNum === Number(m[2]) && s.idLower.startsWith(m[1])) return true
    return s.nameLower.includes(tok)
  }
  return s.nameLower.includes(tok) || s.idLower.includes(tok)
}

// Lower rank = better match. Used to put the most relevant rows first.
function rankStudent(s, tokens, q) {
  if (tokens.length === 1) {
    const m = ID_LIKE.exec(tokens[0])
    if (m && s.idNum === Number(m[2]) && s.idLower.startsWith(m[1])) return 0
  }
  if (s.idLower === q) return 0
  if (s.idLower.startsWith(q)) return 1
  if (s.nameLower === q) return 1
  if (s.nameLower.startsWith(q)) return 2
  const padded = ` ${s.nameLower}`
  if (tokens.every((t) => padded.includes(` ${t}`))) return 3
  return 4
}

function Highlight({ text, pattern }) {
  if (!text) return '—'
  if (!pattern) return text
  const parts = text.split(pattern)
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="hit">
            {part}
          </mark>
        ) : (
          part
        )
      )}
    </>
  )
}

function courseTone(course) {
  let hash = 0
  for (let i = 0; i < course.length; i++) {
    hash = (hash * 31 + course.charCodeAt(i)) >>> 0
  }
  return hash % 6
}

function attendanceLevel(v) {
  if (!Number.isFinite(v)) return 'na'
  if (v >= 85) return 'good'
  if (v >= 75) return 'fair'
  return 'low'
}

function scoreLevel(v) {
  if (!Number.isFinite(v)) return 'na'
  if (v >= 75) return 'good'
  if (v >= 50) return 'fair'
  return 'low'
}

/* ------------------------------------------------------------------ */
/* Components                                                          */
/* ------------------------------------------------------------------ */
const NAV_ITEMS = [
  { label: 'Dashboard', icon: 'dashboard', active: true },
  { label: 'Students', icon: 'students', active: false },
  { label: 'Reports', icon: 'reports', active: false },
]

function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark">
          <Icon name="students" size={22} />
        </span>
        <span className="brand-name">StudentHub</span>
      </div>

      <nav className="nav" aria-label="Main">
        <ul className="nav-list">
          {NAV_ITEMS.map((item) => (
            <li
              key={item.label}
              className={`nav-item${item.active ? ' is-active' : ''}`}
              aria-current={item.active ? 'page' : undefined}
            >
              <Icon name={item.icon} />
              <span className="nav-label">{item.label}</span>
            </li>
          ))}
        </ul>
      </nav>

      <div className="profile">
        <span className="profile-avatar" aria-hidden="true">
          A
        </span>
        <div className="profile-text">
          <span className="profile-name">Admin</span>
          <span className="profile-role">Academic office</span>
        </div>
      </div>
    </aside>
  )
}

function StatCard({ label, value, hint, icon, tone }) {
  return (
    <article className="stat-card">
      <span className={`stat-icon tone-${tone}`}>
        <Icon name={icon} size={24} />
      </span>
      <div className="stat-body">
        <p className="stat-label">{label}</p>
        <p className="stat-value">{value}</p>
        <p className="stat-hint">{hint}</p>
      </div>
    </article>
  )
}

function StatCardSkeleton() {
  return (
    <article className="stat-card is-skeleton" aria-hidden="true">
      <span className="stat-icon skeleton" />
      <div className="stat-body">
        <span className="skeleton skeleton-line short" />
        <span className="skeleton skeleton-line tall" />
        <span className="skeleton skeleton-line" />
      </div>
    </article>
  )
}

/* ------------------------------------------------------------------ */
/* App                                                                 */
/* ------------------------------------------------------------------ */
export default function App() {
  const [status, setStatus] = useState('loading') // loading | ready | error
  const [students, setStudents] = useState([])
  const [skipped, setSkipped] = useState(0)
  const [errorMessage, setErrorMessage] = useState('')
  const [attempt, setAttempt] = useState(0)

  const [search, setSearch] = useState('')
  const [course, setCourse] = useState('all')
  const [page, setPage] = useState(1)

  const deferredSearch = useDeferredValue(search)

  /* Load and parse the CSV */
  useEffect(() => {
    const controller = new AbortController()

    async function load() {
      setStatus('loading')
      setErrorMessage('')
      try {
        const response = await fetch(CSV_URL, { signal: controller.signal })
        if (!response.ok) {
          throw new Error(
            `Could not load ${CSV_URL} (HTTP ${response.status}). Check that the file is inside the public folder.`
          )
        }
        const text = await response.text()
        // Let the loading state paint before the heavy parse begins.
        await new Promise((resolve) => setTimeout(resolve, 0))
        if (controller.signal.aborted) return

        const dataset = buildDataset(text)
        setStudents(dataset.students)
        setSkipped(dataset.skipped)
        setStatus('ready')
      } catch (err) {
        if (err.name === 'AbortError') return
        setErrorMessage(err.message || 'Something went wrong while loading the dataset.')
        setStatus('error')
      }
    }

    load()
    return () => controller.abort()
  }, [attempt])

  /* Statistics from real records */
  const stats = useMemo(() => {
    let markSum = 0
    let markCount = 0
    let attSum = 0
    let attCount = 0
    const courseSet = new Set()

    for (const s of students) {
      if (Number.isFinite(s.average)) {
        markSum += s.average
        markCount++
      }
      if (Number.isFinite(s.attendance)) {
        attSum += s.attendance
        attCount++
      }
      courseSet.add(s.course)
    }

    return {
      total: students.length,
      avgMarks: markCount ? markSum / markCount : NaN,
      avgAttendance: attCount ? attSum / attCount : NaN,
      courses: courseSet.size,
      courseList: Array.from(courseSet).sort((a, b) => a.localeCompare(b)),
    }
  }, [students])

  /* Filtering */
  const searchTokens = useMemo(() => tokenise(deferredSearch), [deferredSearch])

  const hlPattern = useMemo(() => {
    if (searchTokens.length === 0) return null
    const escaped = [...searchTokens]
      .sort((a, b) => b.length - a.length)
      .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    return new RegExp(`(${escaped.join('|')})`, 'gi')
  }, [searchTokens])

  const filtered = useMemo(() => {
    if (searchTokens.length === 0) {
      return course === 'all'
        ? students
        : students.filter((s) => s.course === course)
    }
    const q = searchTokens.join(' ')
    const ranked = []
    for (const s of students) {
      if (course !== 'all' && s.course !== course) continue
      if (!searchTokens.every((t) => matchesToken(s, t))) continue
      ranked.push({ s, r: rankStudent(s, searchTokens, q) })
    }
    ranked.sort((a, b) => a.r - b.r) // stable: keeps CSV order within a rank
    return ranked.map((x) => x.s)
  }, [students, searchTokens, course])

  const isPending = search !== deferredSearch

  /* Pagination */
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const startIndex = (currentPage - 1) * PAGE_SIZE
  const pageRows = useMemo(
    () => filtered.slice(startIndex, startIndex + PAGE_SIZE),
    [filtered, startIndex]
  )

  const handleSearch = (e) => {
    setSearch(e.target.value)
    setPage(1)
  }
  const clearSearch = () => {
    setSearch('')
    setPage(1)
  }
  const handleSearchKey = (e) => {
    if (e.key === 'Escape' && search) clearSearch()
  }
  const handleCourse = (e) => {
    setCourse(e.target.value)
    setPage(1)
  }
  const clearFilters = () => {
    setSearch('')
    setCourse('all')
    setPage(1)
  }

  const isReady = status === 'ready'
  const isFiltering = search.trim() !== '' || course !== 'all'

  const statusBadge = {
    loading: { cls: 'is-loading', text: 'Loading dataset' },
    error: { cls: 'is-error', text: 'Load failed' },
    ready: { cls: 'is-ready', text: `${formatInt(stats.total)} records loaded` },
  }[status]

  return (
    <div className="app-shell">
      <Sidebar />

      <div className="main">
        <header className="page-header">
          <div>
            <h1 className="page-title">Student Analytics Dashboard</h1>
            <p className="page-subtitle">
              Marks, attendance and course activity across every student record.
            </p>
          </div>
          <span className={`status-badge ${statusBadge.cls}`}>
            <span className="status-dot" aria-hidden="true" />
            {statusBadge.text}
          </span>
        </header>

        <main className="content">
          {/* Statistic cards */}
          <section className="stat-grid" aria-label="Summary statistics">
            {isReady ? (
              <>
                <StatCard
                  label="Total Students"
                  value={formatInt(stats.total)}
                  hint={
                    skipped > 0
                      ? `${formatInt(skipped)} unreadable rows skipped`
                      : 'All rows loaded from CSV'
                  }
                  icon="users"
                  tone={0}
                />
                <StatCard
                  label="Average Marks"
                  value={formatScore(stats.avgMarks)}
                  hint="Mean across all students"
                  icon="award"
                  tone={1}
                />
                <StatCard
                  label="Average Attendance"
                  value={formatPercent(stats.avgAttendance)}
                  hint="Mean across all students"
                  icon="calendar"
                  tone={2}
                />
                <StatCard
                  label="Total Courses"
                  value={formatInt(stats.courses)}
                  hint="Unique course names"
                  icon="book"
                  tone={3}
                />
              </>
            ) : (
              [0, 1, 2, 3].map((n) => <StatCardSkeleton key={n} />)
            )}
          </section>

          {/* Student records */}
          <section className="panel" aria-label="Student records">
            <div className="panel-header">
              <div>
                <h2 className="panel-title">Student records</h2>
                <p className="panel-subtitle">
                  {isReady
                    ? `${formatInt(filtered.length)} matching ${
                        filtered.length === 1 ? 'record' : 'records'
                      }${searchTokens.length ? ` for “${searchTokens.join(' ')}”` : ''}`
                    : 'Search by name or ID, or filter by course'}
                </p>
              </div>

              <div className="toolbar">
                <div className="search-box">
                  <Icon name="search" size={18} />
                  <input
                    type="text"
                    aria-label="Search students by name or ID"
                    placeholder="Search name or ID (e.g. aditya singh, S12)"
                    autoComplete="off"
                    spellCheck="false"
                    value={search}
                    onChange={handleSearch}
                    onKeyDown={handleSearchKey}
                    disabled={!isReady}
                  />
                  {search && (
                    <button
                      type="button"
                      className="search-clear"
                      aria-label="Clear search"
                      onClick={clearSearch}
                    >
                      <Icon name="close" size={16} />
                    </button>
                  )}
                </div>

                <label className="select-box">
                  <span className="visually-hidden">Filter by course</span>
                  <select
                    value={course}
                    onChange={handleCourse}
                    disabled={!isReady}
                  >
                    <option value="all">All courses</option>
                    {stats.courseList.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            {status === 'loading' && (
              <div className="state-box" role="status">
                <span className="spinner" aria-hidden="true" />
                <h3 className="state-title">Loading student records</h3>
                <p className="state-text">
                  Reading and processing the CSV file. Large datasets can take a
                  few seconds.
                </p>
              </div>
            )}

            {status === 'error' && (
              <div className="state-box is-error" role="alert">
                <span className="state-icon">
                  <Icon name="alert" size={28} />
                </span>
                <h3 className="state-title">Couldn’t load the dataset</h3>
                <p className="state-text">{errorMessage}</p>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setAttempt((a) => a + 1)}
                >
                  <Icon name="refresh" size={16} />
                  Try again
                </button>
              </div>
            )}

            {isReady && filtered.length === 0 && (
              <div className="state-box">
                <span className="state-icon is-muted">
                  <Icon name="inbox" size={28} />
                </span>
                <h3 className="state-title">No students match your filters</h3>
                <p className="state-text">
                  Check the spelling of the name or ID, or choose a different
                  course.
                </p>
                {isFiltering && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={clearFilters}
                  >
                    Clear filters
                  </button>
                )}
              </div>
            )}

            {isReady && filtered.length > 0 && (
              <>
                <div className={`table-scroll${isPending ? ' is-pending' : ''}`}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th scope="col">Student ID</th>
                        <th scope="col">Student Name</th>
                        <th scope="col">Course</th>
                        <th scope="col">Gender</th>
                        <th scope="col" className="num">Maths</th>
                        <th scope="col" className="num">Python</th>
                        <th scope="col" className="num">DBMS</th>
                        <th scope="col" className="num">Average Marks</th>
                        <th scope="col">Attendance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pageRows.map((s) => (
                        <tr key={s.rowId}>
                          <td className="cell-id">
                            <Highlight text={s.id} pattern={hlPattern} />
                          </td>
                          <td className="cell-name">
                            <Highlight text={s.name} pattern={hlPattern} />
                          </td>
                          <td>
                            <span className={`badge course-badge tone-${courseTone(s.course)}`}>
                              {s.course}
                            </span>
                          </td>
                          <td>{s.gender || '—'}</td>
                          <td className="num">{formatScore(s.maths)}</td>
                          <td className="num">{formatScore(s.python)}</td>
                          <td className="num">{formatScore(s.dbms)}</td>
                          <td className="num">
                            <span className={`score score-${scoreLevel(s.average)}`}>
                              {formatScore(s.average)}
                            </span>
                          </td>
                          <td>
                            <span className={`badge attendance-badge level-${attendanceLevel(s.attendance)}`}>
                              {formatPercent(s.attendance)}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <footer className="pagination">
                  <p className="pagination-info">
                    Showing {formatInt(startIndex + 1)}–
                    {formatInt(startIndex + pageRows.length)} of{' '}
                    {formatInt(filtered.length)}
                  </p>
                  <div className="pagination-controls">
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => setPage(currentPage - 1)}
                      disabled={currentPage <= 1}
                    >
                      <Icon name="left" size={16} />
                      Previous
                    </button>
                    <span className="page-indicator">
                      Page {formatInt(currentPage)} of {formatInt(totalPages)}
                    </span>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => setPage(currentPage + 1)}
                      disabled={currentPage >= totalPages}
                    >
                      Next
                      <Icon name="right" size={16} />
                    </button>
                  </div>
                </footer>
              </>
            )}
          </section>
        </main>
      </div>
    </div>
  )
}