"""
StudentHub backend (Flask + pandas)

Serves the real students_processed.csv through a small REST API that mirrors
everything the React dashboard shows: summary statistics, course list,
searchable / filterable / paginated student records, per-course reports, and
the original /analyze endpoint.

Run:
    pip install -r requirements.txt
    python app.py
"""

import os
import re
from pathlib import Path

import numpy as np
import pandas as pd
from flask import Flask, jsonify, request

app = Flask(__name__)
app.json.sort_keys = False

# ----------------------------------------------------------------------------
# Configuration
# ----------------------------------------------------------------------------
REQUIRED_COLUMNS = ["student_id", "name", "course", "maths", "python", "dbms", "attendance"]
SCORE_COLUMNS = ["maths", "python", "dbms"]
PUBLIC_COLUMNS = [
    "student_id", "name", "course", "age", "gender",
    "maths", "python", "dbms", "average_marks", "attendance", "enrollment_date",
]
DEFAULT_PAGE_SIZE = 10
MAX_PAGE_SIZE = 100

ALLOWED_ORIGINS = {
    o.strip()
    for o in os.environ.get(
        "CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
    ).split(",")
    if o.strip()
}


# ----------------------------------------------------------------------------
# Dataset loading (runs once at startup)
# ----------------------------------------------------------------------------
def find_csv() -> Path:
    """Locate students_processed.csv. Override with the STUDENTS_CSV env var."""
    here = Path(__file__).resolve().parent
    candidates = []
    if os.environ.get("STUDENTS_CSV"):
        candidates.append(Path(os.environ["STUDENTS_CSV"]))
    candidates += [
        here / "students_processed.csv",
        here / "data" / "students_processed.csv",
        here.parent / "frontend" / "public" / "students_processed.csv",
        here.parent / "students_processed.csv",
    ]
    for path in candidates:
        if path.is_file():
            return path
    searched = "\n  ".join(str(p) for p in candidates)
    raise FileNotFoundError(
        "students_processed.csv not found. Searched:\n  "
        + searched
        + "\nSet the STUDENTS_CSV environment variable to the full path."
    )


def _round(value, digits=2):
    return None if pd.isna(value) else round(float(value), digits)


def load_dataset():
    path = find_csv()
    df = pd.read_csv(
        path,
        dtype=str,
        keep_default_na=False,
        encoding="utf-8-sig",
        skipinitialspace=True,
        on_bad_lines="skip",
    )
    df.columns = [re.sub(r"\s+", "_", c.strip().lower()) for c in df.columns]

    missing = [c for c in REQUIRED_COLUMNS if c not in df.columns]
    if missing:
        raise ValueError(
            f"CSV is missing required column(s): {', '.join(missing)}. "
            f"Columns found: {', '.join(df.columns)}"
        )

    for col in df.columns:
        df[col] = df[col].str.strip()

    # Optional columns: create them if absent so every record has the same shape.
    for col in ("gender", "enrollment_date"):
        if col not in df.columns:
            df[col] = ""
    for col in ("age", "average_marks"):
        if col not in df.columns:
            df[col] = ""

    # Skip rows that have neither an ID nor a name (same rule as the frontend).
    blank = (df["student_id"] == "") & (df["name"] == "")
    skipped = int(blank.sum())
    df = df[~blank].reset_index(drop=True)
    if df.empty:
        raise ValueError("No valid student records were found in the CSV file.")

    df.loc[df["course"] == "", "course"] = "Unknown"

    # Numeric conversion (tolerates values such as "85%").
    for col in ["age", *SCORE_COLUMNS, "attendance", "average_marks"]:
        df[col] = pd.to_numeric(df[col].str.replace("%", "", regex=False), errors="coerce")

    # average_marks: use the column when present, otherwise mean of the 3 subjects.
    df["average_marks"] = df["average_marks"].fillna(df[SCORE_COLUMNS].mean(axis=1))

    # Attendance stored as a fraction (0-1) is converted to a percentage.
    max_att = df["attendance"].max()
    if pd.notna(max_att) and 0 < max_att <= 1:
        df["attendance"] = df["attendance"] * 100

    for col in [*SCORE_COLUMNS, "average_marks", "attendance"]:
        df[col] = df[col].round(2)
    df["age"] = df["age"].round().astype("Int64")

    # Search helpers, built once so every query stays fast.
    df["_id"] = df["student_id"].str.lower()
    df["_name"] = df["name"].str.lower()
    df["_pname"] = " " + df["_name"]  # padded so word-start checks are simple
    df["_idnum"] = pd.to_numeric(
        df["student_id"].str.extract(r"(\d+)", expand=False), errors="coerce"
    )

    return df, skipped, path


def build_stats(df, skipped):
    courses = sorted(df["course"].unique(), key=str.lower)
    return {
        "total_students": int(len(df)),
        "average_marks": _round(df["average_marks"].mean()),
        "average_attendance": _round(df["attendance"].mean()),
        "total_courses": len(courses),
        "courses": courses,
        "skipped_rows": skipped,
    }


DF, SKIPPED_ROWS, CSV_PATH = load_dataset()
STATS = build_stats(DF, SKIPPED_ROWS)
print(f"[StudentHub] Loaded {len(DF):,} records from {CSV_PATH}")


def to_records(frame):
    """DataFrame -> list of JSON-safe dicts (NaN / <NA> become null)."""
    part = frame[PUBLIC_COLUMNS].astype(object)
    part = part.where(frame[PUBLIC_COLUMNS].notna(), None)
    return part.to_dict(orient="records")


# ----------------------------------------------------------------------------
# Search (same rules as the dashboard's search box)
# ----------------------------------------------------------------------------
ID_LIKE = re.compile(r"^([a-z]*)(\d+)$")


def _id_number_match(frame, tok):
    """True where the ID's numeric part equals the token's digits ('1' or 's1' -> S000001)."""
    m = ID_LIKE.match(tok)
    if not m:
        return pd.Series(False, index=frame.index)
    return (frame["_idnum"] == int(m.group(2))) & frame["_id"].str.startswith(m.group(1))


def search_students(frame, query):
    """
    Multi-word search over student ID and name, best matches first.

    * Every word must match (AND), in any order: "singh aditya" == "aditya singh".
    * ID-like words ("1", "s1", "S000001", "s0000") match by ID prefix or number.
    * Other words match anywhere in the name (or ID).
    * Results are ranked: exact ID, ID/name prefix, whole-word matches, then the rest.
    """
    tokens = query.lower().split()
    if not tokens:
        return frame

    mask = pd.Series(True, index=frame.index)
    for tok in tokens:
        if ID_LIKE.match(tok):
            tok_mask = (
                frame["_id"].str.startswith(tok)
                | _id_number_match(frame, tok)
                | frame["_name"].str.contains(tok, regex=False)
            )
        else:
            tok_mask = (
                frame["_name"].str.contains(tok, regex=False)
                | frame["_id"].str.contains(tok, regex=False)
            )
        mask &= tok_mask

    hits = frame[mask]
    if hits.empty:
        return hits

    q = " ".join(tokens)
    word_start = pd.Series(True, index=hits.index)
    for tok in tokens:
        word_start &= hits["_pname"].str.contains(" " + tok, regex=False)

    exact_id = hits["_id"] == q
    if len(tokens) == 1:
        exact_id |= _id_number_match(hits, tokens[0])

    rank = np.select(
        [
            exact_id,
            hits["_id"].str.startswith(q) | (hits["_name"] == q),
            hits["_name"].str.startswith(q),
            word_start,
        ],
        [0, 1, 2, 3],
        default=4,
    )
    return hits.iloc[np.argsort(rank, kind="stable")]


# ----------------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------------
def int_arg(name, default, minimum=1, maximum=None):
    raw = request.args.get(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        value = int(raw)
    except ValueError:
        raise ValueError(f"'{name}' must be a whole number.")
    if value < minimum:
        raise ValueError(f"'{name}' must be at least {minimum}.")
    if maximum is not None:
        value = min(value, maximum)
    return value


def error(message, status):
    return jsonify({"error": message}), status


# ----------------------------------------------------------------------------
# CORS (lets the Vite dev server at :5173 call this API directly)
# ----------------------------------------------------------------------------
@app.after_request
def add_cors_headers(response):
    origin = request.headers.get("Origin")
    if origin in ALLOWED_ORIGINS:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Vary"] = "Origin"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type"
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    return response


# ----------------------------------------------------------------------------
# Routes
# ----------------------------------------------------------------------------
@app.route("/")
def home():
    return jsonify({
        "message": "Student Performance Backend is running!",
        "records_loaded": STATS["total_students"],
        "endpoints": [
            "GET  /api/health",
            "GET  /api/stats",
            "GET  /api/courses",
            "GET  /api/students?search=&course=&page=1&page_size=10",
            "GET  /api/students/<student_id>",
            "GET  /api/reports/courses",
            "POST /analyze",
        ],
    })


@app.route("/api/health")
def health():
    return jsonify({
        "status": "ok",
        "records_loaded": STATS["total_students"],
        "skipped_rows": STATS["skipped_rows"],
        "source": CSV_PATH.name,
    })


@app.route("/api/stats")
def stats():
    """The four dashboard cards."""
    return jsonify(STATS)


@app.route("/api/courses")
def courses():
    """Course dropdown options with student counts."""
    counts = DF["course"].value_counts()
    items = [
        {"course": c, "students": int(counts[c])}
        for c in STATS["courses"]
    ]
    return jsonify({"total": len(items), "items": items})


@app.route("/api/students")
def students():
    """Search + course filter + pagination for the student table."""
    try:
        page = int_arg("page", 1)
        page_size = int_arg("page_size", DEFAULT_PAGE_SIZE, maximum=MAX_PAGE_SIZE)
    except ValueError as exc:
        return error(str(exc), 400)

    search = (request.args.get("search") or "").strip()
    course = (request.args.get("course") or "").strip()

    mask = pd.Series(True, index=DF.index)
    if course and course.lower() != "all":
        if course not in set(STATS["courses"]):
            return error(f"Unknown course '{course}'.", 400)
        mask &= DF["course"] == course

    filtered = search_students(DF[mask], search)
    total = int(len(filtered))
    total_pages = max(1, -(-total // page_size))
    page = min(page, total_pages)
    start = (page - 1) * page_size
    chunk = filtered.iloc[start:start + page_size]

    return jsonify({
        "items": to_records(chunk),
        "page": page,
        "page_size": page_size,
        "total": total,
        "total_pages": total_pages,
        "start": start + 1 if total else 0,
        "end": start + len(chunk),
    })


@app.route("/api/students/<student_id>")
def student_detail(student_id):
    match = DF[DF["student_id"].str.lower() == student_id.strip().lower()]
    if match.empty:
        return error(f"Student '{student_id}' not found.", 404)
    return jsonify(to_records(match.iloc[:1])[0])


@app.route("/api/reports/courses")
def course_report():
    """Per-course averages for the Reports section."""
    grouped = (
        DF.groupby("course")
        .agg(
            students=("student_id", "size"),
            average_marks=("average_marks", "mean"),
            average_attendance=("attendance", "mean"),
            average_maths=("maths", "mean"),
            average_python=("python", "mean"),
            average_dbms=("dbms", "mean"),
        )
        .reset_index()
    )
    items = []
    for row in grouped.sort_values("course", key=lambda s: s.str.lower()).itertuples(index=False):
        items.append({
            "course": row.course,
            "students": int(row.students),
            "average_marks": _round(row.average_marks),
            "average_attendance": _round(row.average_attendance),
            "average_maths": _round(row.average_maths),
            "average_python": _round(row.average_python),
            "average_dbms": _round(row.average_dbms),
        })
    return jsonify({"total": len(items), "items": items})


@app.route("/analyze", methods=["POST"])
def analyze():
    """Score + category for one student's marks (original endpoint, now validated)."""
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return error("Send a JSON body with name, maths, python and dbms.", 400)

    name = data.get("name")
    if not isinstance(name, str) or not name.strip():
        return error("'name' is required.", 400)

    marks = {}
    for field in SCORE_COLUMNS:
        value = data.get(field)
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            return error(f"'{field}' is required and must be a number.", 400)
        if not 0 <= value <= 100:
            return error(f"'{field}' must be between 0 and 100.", 400)
        marks[field] = value

    score = sum(marks.values()) / 3

    if score >= 80:
        category = "Excellent"
    elif score >= 60:
        category = "Good"
    elif score >= 40:
        category = "Average"
    else:
        category = "Needs Improvement"

    return jsonify({
        "name": name.strip(),
        "score": round(score, 2),
        "category": category,
    })


# ----------------------------------------------------------------------------
# Error handlers (always JSON)
# ----------------------------------------------------------------------------
@app.errorhandler(404)
def not_found(_):
    return error("Endpoint not found.", 404)


@app.errorhandler(405)
def method_not_allowed(_):
    return error("Method not allowed for this endpoint.", 405)


@app.errorhandler(500)
def server_error(_):
    return error("Internal server error.", 500)


if __name__ == "__main__":
    app.run(
        host="127.0.0.1",
        port=int(os.environ.get("PORT", 5000)),
        debug=True,
    )